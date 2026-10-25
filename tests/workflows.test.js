// Modos de trabajo: lógica pura (rotación, anonimato, puntajes, sugerencia) y dos misiones reales con agentes falsos.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const wf = require('../lib/workflows');

test('rotación: nadie revisa su propio borrador y en n-1 rondas cada borrador pasa por todos', () => {
  const ids = ['a', 'b', 'c', 'd'];
  const drafts = ids.map(id => ({ owner: id }));
  const seen = new Map(ids.map(id => [id, new Set()]));
  for (let r = 1; r <= 3; r++) {
    const plan = wf.rotation(ids, drafts, d => d.owner, r);
    assert.strictEqual(plan.length, 4);
    assert.strictEqual(new Set(plan.map(p => p.draft.owner)).size, 4, 'cada ronda reparte los 4 borradores');
    for (const p of plan) {
      assert.notStrictEqual(p.reviewer, p.draft.owner);
      seen.get(p.draft.owner).add(p.reviewer);
    }
  }
  for (const [owner, reviewers] of seen) assert.strictEqual(reviewers.size, 3, `el borrador de ${owner} pasó por los otros 3`);
  // Si un revisor cae, los demás siguen sin revisar lo suyo.
  const plan = wf.rotation(['a', 'c', 'd'], drafts, d => d.owner, 1);
  assert.ok(plan.every(p => p.reviewer !== p.draft.owner));
});

test('anonimato: letras estables por semilla y que no siguen el orden del equipo', () => {
  const map = wf.anonymize(['claude', 'gemini', 'codex', 'grok'], 12345);
  assert.deepStrictEqual(Object.keys(map), ['A', 'B', 'C', 'D']);
  assert.deepStrictEqual(Object.values(map).sort(), ['claude', 'codex', 'gemini', 'grok']);
  assert.deepStrictEqual(wf.anonymize(['claude', 'gemini', 'codex', 'grok'], 12345), map);
  assert.strictEqual(wf.letterOf(map, map.C), 'C');
});

test('puntajes del consejo, medias y el mejor borrador', () => {
  const report = 'Evalué todo.\n\nPUNTAJES:\n- A: 8/10 buen gancho\n- **B**: 9,5 / 10 el mejor\n- Borrador C — 7 flojo\nOBJECIONES:\n- ninguna\nNOTA: 8/10';
  assert.deepStrictEqual(wf.parseRatings(report), { A: 8, B: 9.5, C: 7 });
  assert.deepStrictEqual(wf.parseRatings('NOTA: 9/10'), {});
  const avgs = wf.averageByDraft([{ draft: 'A', score: 8 }, { draft: 'A', score: 9 }, { draft: 'B', score: 9 }, { draft: 'C', score: null }]);
  assert.deepStrictEqual(avgs, { A: 8.5, B: 9 });
  assert.strictEqual(wf.bestDraft(avgs), 'B');
});

test('sugerencia de modo y configuración normalizada', () => {
  assert.strictEqual(wf.suggestWorkflow('Arregla el bug de la app web'), 'relevo');
  assert.strictEqual(wf.suggestWorkflow('Investiga y compara las fuentes sobre el estudio'), 'delphi');
  assert.strictEqual(wf.suggestWorkflow('Escribe un post viral para LinkedIn con 3 hooks'), 'consejo');
  assert.strictEqual(wf.suggestWorkflow('hola'), null);
  const team = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  assert.deepStrictEqual(wf.normalizeWorkflow({}, team), { workflow: 'relevo', chair: null, maxParallel: 2 });
  assert.deepStrictEqual(wf.normalizeWorkflow({ workflow: 'consejo', chair: 'zz', maxParallel: 9 }, team), { workflow: 'consejo', chair: 'a', maxParallel: 3 });
  assert.deepStrictEqual(wf.normalizeWorkflow({ workflow: 'consejo', chair: 'c', maxParallel: 0 }, team).chair, 'c');
});

test('pool: nunca más de "limit" tareas a la vez y resultados en orden', async () => {
  let now = 0, peak = 0;
  const tasks = [30, 5, 20, 10, 1].map((ms, i) => async () => {
    now++; peak = Math.max(peak, now);
    await new Promise(r => setTimeout(r, ms));
    now--;
    return i;
  });
  assert.deepStrictEqual(await wf.pool(tasks, 2), [0, 1, 2, 3, 4]);
  assert.strictEqual(peak, 2);
});

// ---------- Misiones reales con agentes falsos ----------

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'officematrix-wf-'));
const fake = path.join(__dirname, 'helpers', 'fake-agent.js');
const agent = id => ({ id, name: id.toUpperCase(), role: 'Probador', color: '#fff', cmd: 'node', stream: 'text', args: [fake, id, 'paralelo', 'text', '{prompt}'] });
fs.writeFileSync(path.join(home, 'agents.json'), JSON.stringify({
  agents: [agent('p1'), agent('p2'), agent('p3')], maxRounds: 3, minScore: 9, turnTimeoutMinutes: 1, idleTimeoutMinutes: 0,
}));
fs.mkdirSync(path.join(home, 'memoria'), { recursive: true });
process.env.OFFICEMATRIX_HOME = home;
process.env.OFFICEMATRIX_CONFIG = path.join(home, 'agents.json');
const { server, running } = require('../server');
let base;

test.before(() => new Promise(resolve => server.listen(0, '127.0.0.1', () => { base = `http://127.0.0.1:${server.address().port}`; resolve(); })));
test.after(() => { server.close(); server.closeAllConnections?.(); });

const api = async (url, opts = {}) => {
  const res = await fetch(base + url, { headers: { 'Content-Type': 'application/json' }, ...opts });
  return { status: res.status, body: await res.json() };
};
const waitIdle = async id => {
  for (let i = 0; i < 400 && running.has(id); i++) await new Promise(r => setTimeout(r, 100));
  assert.ok(!running.has(id), 'el ciclo debería haber terminado');
};

test('Delphi: borradores en paralelo, rotación hasta converger y el mejor en final/', async () => {
  const { body: chat } = await api('/api/chats', { method: 'POST', body: JSON.stringify({ text: 'Investiga algo', config: { workflow: 'delphi', maxRounds: 3, maxParallel: 2, team: [{ id: 'p1' }, { id: 'p2' }] } }) });
  await waitIdle(chat.id);
  const { body: d } = await api(`/api/chats/${chat.id}`);
  const turns = d.messages.filter(m => m.kind === 'agent');
  assert.deepStrictEqual(turns.map(t => `${t.phase}:${t.verdict}`).sort(), [
    'borrador:BORRADOR', 'borrador:BORRADOR', 'revision:APROBADO', 'revision:APROBADO', 'revision:CAMBIOS', 'revision:CAMBIOS',
  ]);
  // Cada revisión editó el borrador de OTRO agente, y se le atribuye solo eso.
  for (const t of turns.filter(x => x.phase === 'revision')) {
    assert.notStrictEqual(t.targetOwner, t.agentId);
    assert.ok(t.files.every(f => f.startsWith(`borradores/${t.target}/`)), t.files.join(','));
  }
  const summary = d.messages.filter(m => m.kind === 'system').pop();
  assert.strictEqual(summary.outcome, 'unanime');
  assert.match(summary.text, /Converged in 2 rotation round/);
  assert.match(fs.readFileSync(path.join(d.path, 'final', 'propuesta.md'), 'utf8'), /revisado/);
  assert.match(d.handoff, /Parallel \+ rotation/);
  assert.strictEqual(d.config.workflow, 'delphi');
  assert.strictEqual(d.outcome, 'ok');
  assert.ok(fs.existsSync(path.join(d.path, '.office', 'turno-p1.md')));
});

test('Consejo: evaluación cruzada con puntajes, síntesis del presidente y aprobación', async () => {
  const { body: chat } = await api('/api/chats', { method: 'POST', body: JSON.stringify({ text: 'Escribe un post', config: { workflow: 'consejo', chair: 'p2', maxRounds: 2, maxParallel: 3, team: [{ id: 'p1' }, { id: 'p2' }, { id: 'p3' }] } }) });
  await waitIdle(chat.id);
  const { body: d } = await api(`/api/chats/${chat.id}`);
  const turns = d.messages.filter(m => m.kind === 'agent');
  const phases = turns.map(t => t.phase);
  assert.deepStrictEqual(phases.filter(p => p === 'borrador').length, 3);
  assert.deepStrictEqual(phases.filter(p => p === 'evaluacion').length, 3);
  const synth = turns.filter(t => t.phase === 'sintesis');
  assert.deepStrictEqual(synth.map(t => t.agentId), ['p2']);
  assert.deepStrictEqual(turns.filter(t => t.phase === 'aprobacion').map(t => t.verdict), ['APROBADO', 'APROBADO']);
  // Los puntajes llegan por letra y el servidor los traduce a agentes solo para el usuario.
  const ev = turns.find(t => t.phase === 'evaluacion');
  assert.strictEqual(Object.keys(ev.ratings).length, 2, 'califica los otros dos borradores, no el suyo');
  assert.ok(Object.keys(ev.ratingOwners).every(id => ['p1', 'p2', 'p3'].includes(id) && id !== ev.agentId));
  assert.match(fs.readFileSync(path.join(d.path, 'final', 'final.md'), 'utf8'), /p2/);
  const summary = d.messages.filter(m => m.kind === 'system').pop();
  assert.match(summary.text, /The council approved P2's final version/);
  // El presidente escribe el HANDOFF; los demás no "lo olvidan" en las estadísticas.
  assert.ok(d.stats.filter(s => s.id !== 'p2').every(s => s.handoffMissing === 0));
});

test('modos paralelos: la directiva en vivo del usuario llega al brief de cada IA (solo la de este ciclo)', () => {
  const { buildParallelBrief } = require('../lib/brief');
  const chat = { config: {}, messages: [
    { kind: 'user', text: 'Escribe un artículo' },
    { kind: 'user', intervention: true, cycle: 1, text: 'Directiva de un ciclo anterior' },
    { kind: 'user', intervention: true, cycle: 2, text: 'Cita fuentes primarias' },
  ] };
  const brief = buildParallelBrief({ chat, agent: { id: 'a', name: 'A', role: 'x' }, info: { round: 1, maxRounds: 2, minScore: 9, workflow: 'delphi', cycle: 2 },
    phase: 'borrador', folder: 'borradores/A/', memoryDir: 'memoria-oficina' });
  assert.match(brief, /Directivas del usuario durante este ciclo[\s\S]*Cita fuentes primarias/);
  assert.doesNotMatch(brief, /ciclo anterior/);
});
