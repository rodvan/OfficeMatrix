// Prueba de extremo a extremo: un ciclo real con agentes falsos (procesos de Node) y la API HTTP.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'officematrix-test-'));
const fake = path.join(__dirname, 'helpers', 'fake-agent.js');
const agent = (id, name, script, stream) => ({ id, name, role: 'Probador', color: '#fff', cmd: 'node', stream, args: [fake, id, script, stream, '{prompt}'] });
fs.writeFileSync(path.join(home, 'agents.json'), JSON.stringify({
  agents: [
    agent('autor', 'Autor', 'autor', 'claude'), agent('revisor', 'Revisor', 'revisor', 'text'),
    { ...agent('roto', 'Roto', 'falla', 'text'), enabled: false }, { ...agent('tramposo', 'Tramposo', 'tramposo', 'claude'), enabled: false },
    { ...agent('pobre', 'Pobre', 'sin-saldo', 'text'), enabled: false }, { ...agent('colgado', 'Colgado', 'colgado', 'text'), enabled: false },
    ...[['meseta1', 'meseta'], ['meseta2', 'meseta'], ['baja1', 'baja'], ['baja2', 'baja'], ['cortado', 'cortado']].map(([id, g]) => ({ ...agent(id, id[0].toUpperCase() + id.slice(1), g, 'text'), enabled: false })),
  ],
  maxRounds: 3, minScore: 9, autoMaxRounds: 4, turnTimeoutMinutes: 1, relatorMinutes: 0, idleTimeoutMinutes: 0.05,
}));
fs.mkdirSync(path.join(home, 'memoria'), { recursive: true });
fs.writeFileSync(path.join(home, 'memoria', 'lecciones.md'), '# Lecciones aprendidas\n\n- Lección base.\n');
process.env.OFFICEMATRIX_HOME = home;
process.env.OFFICEMATRIX_CONFIG = path.join(home, 'agents.json');
process.env.FAKE_GLOBAL_MEMORY = path.join(home, 'memoria', 'lecciones.md');

const { server, running } = require('../server');
let base;

test.before(() => new Promise(resolve => server.listen(0, '127.0.0.1', () => { base = `http://127.0.0.1:${server.address().port}`; resolve(); })));
test.after(() => { server.close(); server.closeAllConnections?.(); });

const api = async (url, opts = {}) => {
  const res = await fetch(base + url, { headers: { 'Content-Type': 'application/json' }, ...opts });
  return { status: res.status, body: await res.json() };
};
const waitIdle = async id => {
  for (let i = 0; i < 300 && running.has(id); i++) await new Promise(r => setTimeout(r, 100));
  assert.ok(!running.has(id), 'el ciclo debería haber terminado');
};

test('un ciclo completo: discusión, aprobación verificada, handoff, memoria fusionada y estadísticas', async () => {
  const { status, body: chat } = await api('/api/chats', { method: 'POST', body: JSON.stringify({ text: 'Haz un trabajo de prueba', config: { mode: 'rondas', maxRounds: 3, team: [{ id: 'autor' }, { id: 'revisor', role: 'Crítico' }] } }) });
  assert.strictEqual(status, 201);
  await waitIdle(chat.id);

  const { body: detail } = await api(`/api/chats/${chat.id}`);
  const turns = detail.messages.filter(m => m.kind === 'agent');
  assert.deepStrictEqual(turns.map(t => `${t.agentId}:${t.verdict}`), ['autor:CAMBIOS', 'revisor:CAMBIOS', 'autor:APROBADO', 'revisor:APROBADO']);
  assert.strictEqual(turns[1].role, 'Crítico');

  // El hilo de discusión: la objeción del autor la resolvió el revisor con un argumento.
  assert.strictEqual(detail.debate.length, 1);
  assert.strictEqual(detail.debate[0].status, 'resuelta');
  assert.strictEqual(detail.debate[0].replies[0].byName, 'Revisor');

  // Streaming (Claude) y texto plano (revisor) funcionan; se registran archivos tocados y herramientas.
  assert.strictEqual(turns[0].streaming, true);
  assert.strictEqual(turns[1].streaming, false);
  assert.ok(turns[0].files.includes('trabajo.txt'));
  assert.ok(turns[0].toolCounts.write >= 1);
  assert.ok(turns.every(t => t.handoff && t.handoffComplete));

  const summary = detail.messages.filter(m => m.kind === 'system').pop();
  assert.match(summary.text, /Unanimous approval/);

  // HANDOFF.md tiene el bloque de estado de OfficeMatrix y el traspaso del último agente.
  assert.match(detail.handoff, /officematrix:estado/);
  assert.match(detail.handoff, /\*\*De:\*\* revisor/);

  // La memoria global conserva la anotación del ciclo Y la que llegó "a la vez" desde fuera.
  const global = fs.readFileSync(path.join(home, 'memoria', 'lecciones.md'), 'utf8');
  assert.match(global, /Lección del autor/);
  assert.match(global, /Lección de otro ciclo simultáneo/);
  assert.match(global, /Lección base/);

  // Estadísticas por agente (incluyendo tokens y coste del streaming).
  const autor = detail.stats.find(s => s.id === 'autor');
  assert.strictEqual(autor.turns, 2);
  assert.strictEqual(autor.approvals, 1);
  assert.strictEqual(autor.objectionsRaised, 1);
  assert.strictEqual(autor.avgScore, 8);
  assert.strictEqual(autor.tokens, 3000);
  assert.strictEqual(autor.avgTokens, 1500);
  assert.strictEqual(autor.costUsd, 0.03);

  // El log de actividad queda guardado y es legible.
  const { body: log } = await api(`/api/chats/${chat.id}/activity`);
  assert.ok(log.some(e => e.agentId === 'autor' && e.kind === 'write' && /trabajo\.txt/.test(e.label)));
  assert.ok(log.some(e => e.agentId === 'revisor' && e.kind === 'raw'));

  // El brief del turno contiene el handoff y el hilo de discusión.
  const brief = fs.readFileSync(path.join(home, 'proyectos', chat.id, '.office', 'turno.md'), 'utf8');
  assert.match(brief, /HANDOFF: lee esto primero/);
  assert.match(brief, /OBJECIONES:/);
  const ctx = fs.readFileSync(path.join(home, 'proyectos', chat.id, '.office', 'contexto.md'), 'utf8');
  assert.strictEqual(ctx, brief, 'contexto.md es el mismo brief, no un segundo paquete');
  assert.ok(brief.length <= 16000);
});

test('un APROBADO que cambia archivos no cuenta como aprobación; un agente que falla sale del ciclo', async () => {
  const { body: chat } = await api('/api/chats', { method: 'POST', body: JSON.stringify({ text: 'Otra prueba', config: { mode: 'auto', team: [{ id: 'roto' }, { id: 'revisor' }] } }) });
  await waitIdle(chat.id);
  const { body: detail } = await api(`/api/chats/${chat.id}`);
  const turns = detail.messages.filter(m => m.kind === 'agent');
  assert.strictEqual(turns[0].verdict, 'ERROR');
  assert.strictEqual(detail.config.maxRounds, 4); // tope del modo automático
  // El revisor "aprueba" en su primer turno pero cambió trabajo.txt: el servidor lo corrige a CAMBIOS.
  assert.strictEqual(turns[1].verdict, 'CAMBIOS');
  assert.match(turns[1].downgraded, /changed/);
  assert.strictEqual(turns[2].verdict, 'APROBADO');
});

test('API de memoria: listar, buscar, editar con fusión, crear e historial', async () => {
  const { body: files } = await api('/api/memory');
  assert.ok(files.some(f => f.name === 'lecciones.md'));

  const { body: file } = await api('/api/memory/file?name=lecciones.md');
  const baseText = file.content;
  // Mientras el usuario edita, otro ciclo añade una línea: al guardar no se pierde ninguna de las dos.
  fs.appendFileSync(path.join(home, 'memoria', 'lecciones.md'), '- Añadida por un ciclo.\n');
  const { body: saved } = await api('/api/memory/file', { method: 'PUT', body: JSON.stringify({ name: 'lecciones.md', base: baseText, content: baseText + '- Añadida por el usuario.\n' }) });
  assert.match(saved.content, /Añadida por un ciclo/);
  assert.match(saved.content, /Añadida por el usuario/);
  assert.strictEqual(saved.merged, true);

  const { body: again } = await api('/api/memory/file?name=lecciones.md');
  assert.ok(again.history.length >= 1);

  const { status } = await api('/api/memory/file', { method: 'POST', body: JSON.stringify({ name: 'ingenieria.md', content: '# Ingeniería\n\n- Probar con node --test.\n' }) });
  assert.strictEqual(status, 200);
  const { status: dup } = await api('/api/memory/file', { method: 'POST', body: JSON.stringify({ name: 'ingenieria.md', content: 'x' }) });
  assert.strictEqual(dup, 409);
  const { status: bad } = await api('/api/memory/file', { method: 'PUT', body: JSON.stringify({ name: '../fuera.md', content: 'x' }) });
  assert.ok([200, 400].includes(bad));
  assert.ok(!fs.existsSync(path.join(home, 'fuera.md')));

  const { body: search } = await api('/api/memory/search?q=' + encodeURIComponent('node test'));
  assert.ok(search.hits.some(h => h.file === 'ingenieria.md'));
});

test('rutas: estáticos, 404 y protección de rutas fuera del proyecto', async () => {
  const res = await fetch(base + '/');
  assert.strictEqual(res.status, 200);
  assert.match(await res.text(), /OfficeMatrix/);
  const { status } = await api('/api/chats/no-existe');
  assert.strictEqual(status, 404);
  const { body: chats } = await api('/api/chats');
  const { status: forbidden } = await api(`/api/chats/${chats[0].id}/file?path=${encodeURIComponent('../../agents.json')}`);
  assert.strictEqual(forbidden, 403);
  const { body: agents } = await api('/api/agents');
  assert.strictEqual(agents.autoMaxRounds, 4);

  // Intervención del usuario, control del hilo de discusión y exportación a Markdown.
  const chatId = chats[0].id;
  const { status: intStatus, body: intBody } = await api(`/api/chats/${chatId}/intervene`, {
    method: 'POST',
    body: JSON.stringify({ text: 'Directiva del usuario: cuidar el contraste', asObjection: true }),
  });
  assert.strictEqual(intStatus, 200);
  assert.strictEqual(intBody.objection.by, 'user');
  assert.strictEqual(intBody.objection.status, 'abierta');
  // La misión ya cerró: la respuesta lo dice (no llega a ningún turno hasta otra pasada).
  assert.strictEqual(intBody.enCurso, false);
  assert.match(intBody.aviso, /not running/);

  const { status: debStatus, body: debBody } = await api(`/api/chats/${chatId}/debate`, {
    method: 'POST',
    body: JSON.stringify({ id: intBody.objection.id, status: 'resuelta' }),
  });
  assert.strictEqual(debStatus, 200);
  assert.strictEqual(debBody.objection.status, 'resuelta');

  const expRes = await fetch(`${base}/api/chats/${chatId}/export`);
  assert.strictEqual(expRes.status, 200);
  const expText = await expRes.text();
  assert.match(expText, /# Mission dossier:/);
  assert.match(expText, /Directiva del usuario: cuidar el contraste/);
});

test('crear o reabrir una objeción desde Discusión invalida la racha del ciclo activo', async () => {
  const { body: chats } = await api('/api/chats');
  const id = chats[0].id;
  // Estado activo controlado: ejercita las rutas HTTP sin lanzar otra CLI.
  const state = {
    progress: { round: 2, cycleStarted: 123, approvalsInRow: 3, doneInRow: 2, openObjections: 0 },
    intervened: false,
    activeIds: ['revisor'],
    turnCtx: {
      agent: { id: 'revisor', name: 'Revisor', role: 'Crítico' },
      team: [{ id: 'revisor', name: 'Revisor', role: 'Crítico' }],
      info: { round: 2, maxRounds: 3, turn: 4, cycle: 123, minScore: 9, mode: 'rondas' },
    },
  };
  running.set(id, state);
  try {
    const { status, body } = await api(`/api/chats/${id}/debate`, {
      method: 'POST', body: JSON.stringify({ text: 'Revisar la legibilidad antes de cerrar' }),
    });
    assert.strictEqual(status, 201);
    assert.strictEqual(state.intervened, true);
    assert.strictEqual(state.progress.approvalsInRow, 0);
    assert.strictEqual(state.progress.doneInRow, 0);
    const brief = fs.readFileSync(path.join(home, 'proyectos', id, '.office', 'turno.md'), 'utf8');
    assert.match(brief, /Revisar la legibilidad antes de cerrar/);
    await api(`/api/chats/${id}/debate`, {
      method: 'POST', body: JSON.stringify({ id: body.objection.id, status: 'resuelta' }),
    });
    state.intervened = false;
    state.progress.approvalsInRow = 2;
    const reopened = await api(`/api/chats/${id}/debate`, {
      method: 'POST', body: JSON.stringify({ id: body.objection.id, status: 'abierta' }),
    });
    assert.strictEqual(reopened.status, 200);
    assert.strictEqual(state.intervened, true);
    assert.strictEqual(state.progress.approvalsInRow, 0);
  } finally {
    running.delete(id);
  }
});

test('reanudar un ciclo interrumpido conserva el pedido y el diff del turno queda guardado', async () => {
  const { body: chat } = await api('/api/chats', { method: 'POST', body: JSON.stringify({ text: 'Pedido que no debe perderse', config: { mode: 'rondas', maxRounds: 1, team: [{ id: 'revisor' }] } }) });
  await waitIdle(chat.id);
  const file = path.join(home, 'proyectos', chat.id, '.office', 'chat.json');
  const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
  const first = saved.messages.find(m => m.kind === 'agent');
  assert.ok(first.diffs.some(d => d.file === 'trabajo.txt' && d.patch.includes('+API documentada')), JSON.stringify(first.diffs));
  saved.messages.push({ ts: new Date().toISOString(), kind: 'system', outcome: 'started', text: 'Comienza el ciclo y se corta aquí.' });
  fs.writeFileSync(file, JSON.stringify(saved));
  const { body: before } = await api(`/api/chats/${chat.id}`);
  assert.strictEqual(before.outcome, 'interrupted');
  const { status, body: resumed } = await api(`/api/chats/${chat.id}/messages`, { method: 'POST', body: JSON.stringify({ resume: true }) });
  assert.strictEqual(status, 202);
  assert.strictEqual(resumed.resumed, true);
  await waitIdle(chat.id);
  const { body: after } = await api(`/api/chats/${chat.id}`);
  const users = after.messages.filter(m => m.kind === 'user');
  assert.deepStrictEqual(users.map(m => m.text), ['Pedido que no debe perderse']);
  assert.ok(after.messages.some(m => m.kind === 'system' && /Resuming the interrupted cycle/.test(m.text)));
  const brief = fs.readFileSync(path.join(home, 'proyectos', chat.id, '.office', 'turno.md'), 'utf8');
  assert.match(brief, /## Pedido actual del usuario\nPedido que no debe perderse/);
  assert.match(brief, /Pedidos anteriores en este chat \(ya trabajados\)\n\(ninguno\)/);
});

test('plantilla de misión: /api/templates, se guarda en la misión, el brief trae sus criterios y el fin de ciclo avisa con resumen', async () => {
  const { status, body: list } = await api('/api/templates');
  assert.strictEqual(status, 200);
  assert.ok(list.some(t => t.id === 'codigo' && t.skeleton && t.criteria.length));

  // Escucha los eventos en vivo como lo hace la interfaz para recibir el aviso de fin de ciclo.
  const ctrl = new AbortController();
  const events = await fetch(base + '/api/events', { signal: ctrl.signal });
  const reader = events.body.getReader();
  let buffer = '';
  const ended = id => (async () => {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) return null;
      buffer += Buffer.from(value).toString();
      const ev = buffer.split('\n\n').filter(b => b.startsWith('data: ')).map(b => JSON.parse(b.slice(6))).find(e => e.type === 'cycle-ended' && e.chatId === id);
      if (ev) return ev;
    }
  })();

  const { body: chat } = await api('/api/chats', { method: 'POST', body: JSON.stringify({ text: 'Programa una utilidad pequeña', config: { mode: 'rondas', maxRounds: 2, template: 'codigo', team: [{ id: 'autor' }, { id: 'revisor' }] } }) });
  const ev = await ended(chat.id);
  ctrl.abort();
  await waitIdle(chat.id);
  assert.strictEqual(ev.title, 'Programa una utilidad pequeña');
  assert.strictEqual(ev.outcome, 'unanime');
  assert.match(ev.summary, /Unanimous approval/);

  const { body: detail } = await api(`/api/chats/${chat.id}`);
  assert.strictEqual(detail.config.template, 'codigo');
  const brief = fs.readFileSync(path.join(home, 'proyectos', chat.id, '.office', 'turno.md'), 'utf8');
  assert.match(brief, /## Tipo de misión: Código/);
  const { body: exp } = await api(`/api/chats/${chat.id}/export?format=json`);
  assert.match(exp.markdown, /\*\*Template:\*\* Code/);
});

// Escucha /api/events como la interfaz y devuelve los eventos recibidos hasta que "until" se cumple.
async function collectEvents(until) {
  const ctrl = new AbortController();
  const res = await fetch(base + '/api/events', { signal: ctrl.signal });
  const reader = res.body.getReader();
  const seen = [];
  let buffer = '';
  return (async () => {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) return seen;
      buffer += Buffer.from(value).toString();
      const blocks = buffer.split('\n\n');
      buffer = blocks.pop();
      for (const b of blocks) if (b.startsWith('data: ')) seen.push(JSON.parse(b.slice(6)));
      if (seen.some(until)) { ctrl.abort(); return seen; }
    }
  })().catch(() => seen);
}

test('robustez: una CLI sin saldo y otra colgada salen del ciclo con la causa a la vista y el resto termina', async () => {
  let chatId = null;
  const listening = collectEvents(e => e.type === 'cycle-ended' && e.chatId === chatId);
  await new Promise(r => setTimeout(r, 50));
  const started = Date.now();
  const { body: chat } = await api('/api/chats', { method: 'POST', body: JSON.stringify({ text: 'Prueba de robustez', config: { mode: 'rondas', maxRounds: 2, team: [{ id: 'pobre' }, { id: 'colgado' }, { id: 'revisor' }] } }) });
  chatId = chat.id;
  const events = await listening;
  await waitIdle(chat.id);
  // El vigilante (0,05 min = 3 s) tiene que matar el árbol del proceso. Si no lo mata, el agente falso
  // se apaga solo a los 120 s y la causa saldría igual: por eso se mide el tiempo, no solo la causa.
  const elapsed = Date.now() - started;
  assert.ok(elapsed < 30000, `el corte del colgado tardó ${Math.round(elapsed / 1000)} s: killTree no cortó el proceso`);
  const { body: detail } = await api(`/api/chats/${chat.id}`);
  const turns = detail.messages.filter(m => m.kind === 'agent');
  const pobre = turns.find(t => t.agentId === 'pobre');
  const colgado = turns.find(t => t.agentId === 'colgado');
  assert.strictEqual(pobre.verdict, 'ERROR');
  assert.strictEqual(pobre.failure.kind, 'saldo');
  assert.match(pobre.failure.detail, /balance exhausted/);
  assert.match(pobre.text, /still working: Colgado, Revisor/);
  assert.strictEqual(colgado.failure.kind, 'colgada');
  // Cada uno falla una sola vez: no se le vuelve a llamar en la ronda 2.
  assert.strictEqual(turns.filter(t => t.agentId !== 'revisor').length, 2);
  // El revisor sigue solo y cierra el ciclo; el resumen nombra a los caídos.
  assert.ok(turns.filter(t => t.agentId === 'revisor').length >= 2);
  const summary = detail.messages.filter(m => m.kind === 'system').pop();
  assert.match(summary.text, /Unanimous approval/);
  assert.match(summary.text, /Out of the cycle: Pobre \(no credit\), Colgado \(stuck\)/);
  const failedEv = events.filter(e => e.type === 'agent-failed' && e.chatId === chat.id);
  assert.deepStrictEqual(failedEv.map(e => e.failure.label), ['NO CREDIT', 'STUCK']);
  assert.deepStrictEqual(failedEv[0].remaining, ['Colgado', 'Revisor']);
  assert.strictEqual(detail.stats.find(s => s.id === 'pobre').errors, 1);
});

test('aviso: cuando un agente responde a una objeción del usuario llega un evento objection-answered', async () => {
  const { body: chat } = await api('/api/chats', { method: 'POST', body: JSON.stringify({ text: 'Base para objetar', config: { mode: 'rondas', maxRounds: 1, team: [{ id: 'revisor' }] } }) });
  await waitIdle(chat.id);
  const { body: added } = await api(`/api/chats/${chat.id}/debate`, { method: 'POST', body: JSON.stringify({ text: 'Falta un ejemplo de uso en el README' }) });
  const listening = collectEvents(e => e.type === 'cycle-ended' && e.chatId === chat.id);
  await new Promise(r => setTimeout(r, 50));
  await api(`/api/chats/${chat.id}/messages`, { method: 'POST', body: JSON.stringify({ text: '' }) });
  const events = await listening;
  await waitIdle(chat.id);
  const ev = events.find(e => e.type === 'objection-answered' && e.chatId === chat.id);
  assert.ok(ev, 'debería avisar de la respuesta');
  assert.strictEqual(ev.id, added.objection.id);
  assert.strictEqual(ev.agentName, 'Revisor');
  assert.strictEqual(ev.stance, 'resuelta');
  assert.strictEqual(ev.status, 'resuelta');
  assert.match(ev.objection, /ejemplo de uso/);
});

test('plantillas propias: se guardan desde la API, se usan en una misión (brief con criterios) y se borran', async () => {
  const bad = await api('/api/templates', { method: 'POST', body: JSON.stringify({ name: 'x', team: [{ id: 'autor' }] }) });
  assert.strictEqual(bad.status, 400);
  const created = await api('/api/templates', { method: 'POST', body: JSON.stringify({
    name: 'Newsletter semanal', desc: 'Boletín de los viernes', mode: 'auto', maxRounds: 2, minScore: 8,
    team: [{ id: 'revisor', role: 'Editor' }, { id: 'no-existe' }], skeleton: 'Tema de la semana:', criteria: '- Asunto de menos de 50 caracteres\n\nUn solo CTA', output: 'contenido/newsletters/',
  }) });
  assert.strictEqual(created.status, 201);
  const t = created.body.template;
  assert.strictEqual(t.id, 'u-newsletter-semanal');
  assert.deepStrictEqual(t.team, [{ id: 'revisor', role: 'Editor' }]);
  assert.deepStrictEqual(t.criteria, ['Asunto de menos de 50 caracteres', 'Un solo CTA']);
  const again = await api('/api/templates', { method: 'POST', body: JSON.stringify({ ...t, desc: 'Boletín actualizado' }) });
  assert.strictEqual(again.status, 200);
  assert.strictEqual(again.body.replaced, true);
  const { body: list } = await api('/api/templates');
  assert.strictEqual(list.filter(x => x.id === t.id).length, 1);
  assert.ok(list.some(x => x.id === 'codigo'));
  assert.ok(fs.existsSync(path.join(home, 'plantillas.json')));

  const { body: chat } = await api('/api/chats', { method: 'POST', body: JSON.stringify({ text: 'Tema de la semana: lanzamiento', config: { mode: 'auto', maxRounds: 1, template: t.id, team: t.team } }) });
  await waitIdle(chat.id);
  const { body: detail } = await api(`/api/chats/${chat.id}`);
  assert.strictEqual(detail.config.template, t.id);
  const brief = fs.readFileSync(path.join(home, 'proyectos', chat.id, '.office', 'turno.md'), 'utf8');
  assert.match(brief, /## Tipo de misión: Newsletter semanal\nCriterios de calidad[^\n]*\n- Asunto de menos de 50 caracteres\n- Un solo CTA\nDónde va el entregable: contenido\/newsletters\/\./);

  assert.strictEqual((await api('/api/templates/codigo', { method: 'DELETE' })).status, 404);
  assert.strictEqual((await api(`/api/templates/${t.id}`, { method: 'DELETE' })).status, 200);
  const { body: after } = await api('/api/templates');
  assert.ok(!after.some(x => x.id === t.id));
});

// D46: detener sin aprobar. Retoques menores con la misma nota en dos rondas completas = meseta.
test('meseta: dos rondas completas con la misma media de revisores detienen el ciclo automático sin aprobar', async () => {
  const { body: chat } = await api('/api/chats', { method: 'POST', body: JSON.stringify({ text: 'Pule algo', config: { mode: 'auto', maxRounds: 4, team: [{ id: 'meseta1' }, { id: 'meseta2' }] } }) });
  await waitIdle(chat.id);
  const { body: detail } = await api(`/api/chats/${chat.id}`);
  assert.strictEqual(detail.messages.filter(m => m.kind === 'agent').length, 4, 'se detiene al cerrar la ronda 2, no agota las 4');
  const end = detail.messages.filter(m => m.kind === 'system' && m.outcome && m.outcome !== 'started').pop();
  assert.strictEqual(end.outcome, 'meseta');
  const { body: listed } = await api('/api/chats');
  assert.strictEqual(listed.find(c => c.id === chat.id).outcome, 'partial');
  assert.strictEqual(listed.find(c => c.id === chat.id).stopReason, 'meseta');
  assert.match(end.text, /Stopped at a plateau, without approval: .*\(round 1: 8 → round 2: 8\)/);
  assert.notStrictEqual(detail.outcome, 'ok', 'detener no es aprobar');
});

test('retroceso: si la media de los revisores baja 0,5 o más se detiene y avisa', async () => {
  const { body: chat } = await api('/api/chats', { method: 'POST', body: JSON.stringify({ text: 'Mejora esto', config: { mode: 'rondas', maxRounds: 3, team: [{ id: 'baja1' }, { id: 'baja2' }] } }) });
  await waitIdle(chat.id);
  const { body: detail } = await api(`/api/chats/${chat.id}`);
  assert.strictEqual(detail.messages.filter(m => m.kind === 'agent').length, 4);
  const end = detail.messages.filter(m => m.kind === 'system' && m.outcome && m.outcome !== 'started').pop();
  assert.strictEqual(end.outcome, 'retroceso');
  const { body: listed } = await api('/api/chats');
  assert.strictEqual(listed.find(c => c.id === chat.id).stopReason, 'retroceso');
  assert.match(end.text, /Stopped for regression, without approval: .*9 \(round 1\) to 7 \(round 2\)/);
});

// D47: cortado a medias con cambios = PARCIAL; sigue en el ciclo y el siguiente lo verifica.
test('PARCIAL: un turno cortado que cambió archivos no es ERROR, sigue en el ciclo y el brief del siguiente dice qué cambió', async () => {
  const { body: chat } = await api('/api/chats', { method: 'POST', body: JSON.stringify({ text: 'Trabajo largo', config: { mode: 'rondas', maxRounds: 2, team: [{ id: 'cortado' }, { id: 'meseta1' }] } }) });
  await waitIdle(chat.id);
  const { body: detail } = await api(`/api/chats/${chat.id}`);
  const turns = detail.messages.filter(m => m.kind === 'agent');
  const cut = turns.filter(t => t.agentId === 'cortado');
  assert.strictEqual(cut[0].verdict, 'PARCIAL');
  assert.strictEqual(cut[0].failure.kind, 'colgada');
  assert.deepStrictEqual(cut[0].workFiles, ['trabajo.txt']);
  assert.strictEqual(cut.length, 2, 'no sale del ciclo: vuelve en la ronda 2');
  const seen = fs.readFileSync(path.join(home, 'proyectos', chat.id, '.office', 'vio-parcial-meseta1.txt'), 'utf8');
  assert.match(seen, /Cortado \(ronda 1\) se cortó por stuck después de cambiar: `trabajo\.txt`/);
  // Una ronda con un turno cortado no está completa: no puede haber meseta entre la 1 y la 2.
  const end = detail.messages.filter(m => m.kind === 'system' && m.outcome && m.outcome !== 'started').pop();
  assert.notStrictEqual(end.outcome, 'meseta');
  assert.strictEqual(detail.stats.find(s => s.id === 'cortado').errors, 1);
});

test('aceptar misión (§2.1 a): solo una detenida sin aprobar, y no queda como consenso', async () => {
  const { body: chat } = await api('/api/chats', { method: 'POST', body: JSON.stringify({ text: 'Aceptable', config: { mode: 'auto', maxRounds: 4, team: [{ id: 'meseta1' }, { id: 'meseta2' }] } }) });
  await waitIdle(chat.id);
  const before = await api(`/api/chats/${chat.id}`);
  assert.strictEqual(before.body.outcome, 'partial');
  assert.strictEqual(before.body.stopReason, 'meseta', 'el detalle trae el motivo: si no, el botón no sabe mostrarse');

  const { status, body: bodyAccept } = await api(`/api/chats/${chat.id}/accept`, { method: 'POST' });
  assert.strictEqual(status, 200);
  assert.strictEqual(bodyAccept.outcome, 'aceptado');

  const { body: detail } = await api(`/api/chats/${chat.id}`);
  assert.strictEqual(detail.outcome, 'ok', 'al aceptar pasa a ok');
  assert.strictEqual(detail.stopReason, null);
  assert.strictEqual(detail.accepted, true);
  const end = detail.messages.filter(m => m.kind === 'system' && m.outcome && m.outcome !== 'started').pop();
  assert.strictEqual(end.outcome, 'aceptado');
  assert.notStrictEqual(end.outcome, 'consenso');
  assert.match(end.text, /without approval/);
  const { body: listed } = await api('/api/chats');
  const found = listed.find(c => c.id === chat.id);
  assert.strictEqual(found.outcome, 'ok');
  assert.strictEqual(found.stopReason, null);
  assert.strictEqual(found.accepted, true);
  assert.strictEqual((await api(`/api/chats/${chat.id}/accept`, { method: 'POST' })).status, 409, 'no se acepta dos veces');

  const { body: closed } = await api('/api/chats', { method: 'POST', body: JSON.stringify({ text: 'Esto sí cierra', config: { mode: 'rondas', maxRounds: 2, team: [{ id: 'revisor' }] } }) });
  await waitIdle(closed.id);
  assert.strictEqual((await api(`/api/chats/${closed.id}`)).body.outcome, 'ok');
  assert.strictEqual((await api(`/api/chats/${closed.id}/accept`, { method: 'POST' })).status, 409, 'una misión aprobada no se «acepta»');
});

test('ronda de cierre: meseta con objeciones abiertas arma directivas numeradas y continúa automáticamente', async () => {
  const { body: chat } = await api('/api/chats', {
    method: 'POST',
    body: JSON.stringify({
      text: 'Misión con pendientes',
      config: { mode: 'auto', maxRounds: 4, team: [{ id: 'meseta1' }, { id: 'meseta2' }] },
    }),
  });
  // Añadir una objeción abierta de usuario
  await api(`/api/chats/${chat.id}/debate`, {
    method: 'POST',
    body: JSON.stringify({ text: 'Corregir espaciado de botones' }),
  });
  await waitIdle(chat.id);
  const { body: detail } = await api(`/api/chats/${chat.id}`);
  const msgs = detail.messages || [];
  const cierreMsg = msgs.find(m => m.kind === 'system' && m.rondaCierre);
  assert.ok(cierreMsg, 'se activó la ronda de cierre');
  assert.match(cierreMsg.text, /Ronda de cierre activada tras meseta/);
  assert.match(cierreMsg.text, /1\. Objeción/);
  const turnCount = msgs.filter(m => m.kind === 'agent').length;
  assert.ok(turnCount > 4, `continuó sola ejecutando ${turnCount} turnos (> 4)`);
});
