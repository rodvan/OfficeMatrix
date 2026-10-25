// Pruebas unitarias de la lógica pura de lib/: protocolo del reporte, hilo de discusión, fusión de memoria,
// handoff y regla de fin de ciclo.
const test = require('node:test');
const assert = require('node:assert');
const { parseReport } = require('../lib/protocol');
const { addObjections, applyReplies, pendingFor, blocking, setObjectionStatus } = require('../lib/debate');
const { mergeText, relevantEntries, searchDocs } = require('../lib/memory');
const { upsertStatus, statusBlock, agentHandoff, handoffQuality, HANDOFF_TEMPLATE } = require('../lib/handoff');
const { normalizeCycleConfig, cycleOutcome, judgeVerdict, plateauOutcome, plateauSummary } = require('../lib/cycle');
const { snapshot, diffSnapshots, workChanges, textDiffs } = require('../lib/snapshot');
const { computeAgentStats } = require('../lib/stats');
const { buildTurnBrief } = require('../lib/brief');

test('protocolo: lee la ÚLTIMA nota/veredicto y las secciones aunque vengan con Markdown', () => {
  const r = parseReport(`Cité "NOTA: 3/10" del brief.\n\n**OBJECIONES:**\n- El CSS no es responsive porque\n  se rompe en 1100px\n- ninguna\n**RESPUESTAS:**\n- #2 RECHAZADA: el test ya lo cubre\n- **#5 DE ACUERDO**: bien visto\nNOTA: 8,5/10\nVEREDICTO: **CAMBIOS**\nTERMINADO: NO`);
  assert.strictEqual(r.score, 8.5);
  assert.strictEqual(r.verdict, 'CAMBIOS');
  assert.strictEqual(r.done, false);
  assert.deepStrictEqual(r.objections, ['El CSS no es responsive porque se rompe en 1100px']);
  assert.deepStrictEqual(r.replies.map(x => [x.id, x.stance]), [[2, 'rechazada'], [5, 'apoyo']]);
  const empty = parseReport('sin formato');
  assert.strictEqual(empty.verdict, 'SIN_VEREDICTO');
  assert.strictEqual(empty.score, null);
  assert.strictEqual(parseReport('TERMINADO: SÍ').done, true); // regresión: \b detrás de "Í" no casaba
  assert.strictEqual(parseReport('TERMINADO: **Si**.').done, true);
  assert.strictEqual(parseReport('TERMINADO: NOVEDAD').done, null);
});

test('debate: abierta → disputada → mantenida → resuelta, y solo el autor puede retirar', () => {
  const d = [];
  const a = { agentId: 'a', agentName: 'A', round: 1 }, b = { agentId: 'b', agentName: 'B', round: 1 };
  addObjections(d, a, ['Falta X', 'falta x']); // duplicada: se ignora
  assert.strictEqual(d.length, 1);
  assert.deepStrictEqual(pendingFor(d, 'b').map(o => o.id), [1]);
  assert.deepStrictEqual(pendingFor(d, 'a'), []);
  applyReplies(d, b, [{ id: 1, stance: 'rechazada', text: 'no hace falta' }]);
  assert.strictEqual(d[0].status, 'disputada');
  assert.deepStrictEqual(pendingFor(d, 'a').map(o => o.id), [1]);
  const { ignored } = applyReplies(d, b, [{ id: 1, stance: 'retirada', text: '' }, { id: 9, stance: 'resuelta', text: '' }]);
  assert.strictEqual(ignored.length, 2);
  applyReplies(d, a, [{ id: 1, stance: 'mantenida', text: 'sí hace falta porque…' }]);
  assert.strictEqual(d[0].status, 'abierta');
  assert.strictEqual(blocking(d, ['a', 'b']).length, 1);
  assert.strictEqual(blocking(d, ['b']).length, 0); // el autor salió del ciclo: ya no bloquea
  applyReplies(d, b, [{ id: 1, stance: 'resuelta', text: 'hecho' }]);
  assert.strictEqual(d[0].status, 'resuelta');
  assert.strictEqual(d[0].replies.length, 3);
});

test('memoria: la fusión de tres vías no pierde anotaciones de nadie', () => {
  const base = '# Lecciones\n\n## Código\n- a\n\n## Texto\n- t\n';
  const ours = base.replace('- a\n', '- a\n- nuestra\n');
  const theirs = base.replace('- t\n', '- t\n- suya\n');
  const m = mergeText(base, ours, theirs);
  assert.match(m, /- a\n- nuestra/);
  assert.match(m, /- t\n- suya/);
  assert.strictEqual(mergeText(base, base, theirs), theirs);
  assert.strictEqual(mergeText(base, ours, base), ours);
  // Un borrado nuestro se respeta aunque el otro lado haya añadido cosas.
  const del = mergeText(base, base.replace('- a\n', ''), theirs);
  assert.ok(!/^- a$/m.test(del) && /- suya/.test(del));
  // Lo que ambos añadieron igual no se duplica.
  const both = base + '- igual\n';
  assert.strictEqual(mergeText(base, both, both), both);
});

test('memoria: relevancia y búsqueda ignoran tildes y mayúsculas', () => {
  const docs = [{ file: 'hooks-virales.md', content: '# Hooks\n\n### Pregunta incómoda\n- Qué: abrir con una pregunta que duela.\n' },
    { file: 'ingenieria.md', content: '# Ingeniería\n\n- Probar con node --test antes de entregar.\n' }];
  assert.strictEqual(relevantEntries('Escribe posts con una pregunta incomoda de apertura', docs)[0].file, 'hooks-virales.md');
  assert.strictEqual(searchDocs('INGENIERÍA', docs)[0].file, 'ingenieria.md');
});

test('handoff: el bloque de estado se actualiza sin tocar el traspaso del agente', () => {
  const block = statusBlock({ chatTitle: 'T', mode: 'auto', round: 2, maxRounds: 6, turns: [{ round: 1, agentName: 'A', score: 8, verdict: 'CAMBIOS', files: ['x'], seconds: 30 }] });
  let doc = upsertStatus('', block);
  assert.match(doc, /automatic \(limit 6 rounds\)/);
  assert.match(doc, /\| 1 \| A \| 8 \| CHANGES \|/);
  // En español si se pide; un traspaso escrito en español sigue valiendo con la plantilla en inglés.
  assert.match(statusBlock({ chatTitle: 'T', mode: 'auto', round: 2, maxRounds: 6, lang: 'es' }), /automático \(tope 6 rondas\)/);
  doc = doc.replace(/## Latest handoff[\s\S]*/,'## Último traspaso\n\n**De:** A\n\n**Qué hice:** x\n\n**Decisiones y por qué:** y\n\n**Objeciones abiertas:** ninguna\n\n**Siguiente paso recomendado:** z\n');
  const again = upsertStatus(doc, statusBlock({ chatTitle: 'T', mode: 'rondas', round: 3, maxRounds: 3 }));
  assert.match(again, /\*\*Siguiente paso recomendado:\*\* z/);
  assert.strictEqual((again.match(/<!-- officematrix:estado -->/g) || []).length, 1);
  assert.strictEqual(handoffQuality(agentHandoff(again)).complete, true);
  assert.deepStrictEqual(handoffQuality(agentHandoff(HANDOFF_TEMPLATE)).missing.length, 4);
  // Un HANDOFF escrito a mano sin marcadores recibe el bloque tras el título.
  assert.match(upsertStatus('# Mi handoff\nnotas', block), /^# Mi handoff\n\n<!-- officematrix:estado -->/);
});

test('ciclo: configuración elegida al crear la tarea y regla de fin', () => {
  const global = { agents: [{ id: 'a', role: 'R1' }, { id: 'b', role: 'R2', enabled: false }, { id: 'c', role: 'R3' }], maxRounds: 3, autoMaxRounds: 6, minScore: 9 };
  assert.deepStrictEqual(normalizeCycleConfig({}, global), { mode: 'rondas', maxRounds: 3, minScore: 9, team: [{ id: 'a', role: 'R1' }, { id: 'c', role: 'R3' }], template: null, workflow: 'relevo', chair: null, maxParallel: 2 });
  const auto = normalizeCycleConfig({ mode: 'auto', minScore: 15, team: [{ id: 'c', role: ' Crítica ' }, 'b', { id: 'zz' }, 'c'] }, global);
  assert.strictEqual(auto.maxRounds, 6);
  assert.strictEqual(auto.minScore, 10);
  assert.deepStrictEqual(auto.team, [{ id: 'c', role: 'Crítica' }, { id: 'b', role: 'R2' }]); // orden y roles del usuario
  assert.deepStrictEqual(cycleOutcome({ mode: 'rondas', approvalsInRow: 3, doneInRow: 0, activeCount: 3, blockingObjections: 0 }), { finished: true, reason: 'unanime' });
  assert.strictEqual(cycleOutcome({ mode: 'rondas', approvalsInRow: 0, doneInRow: 3, activeCount: 3, blockingObjections: 0 }).finished, false);
  assert.deepStrictEqual(cycleOutcome({ mode: 'auto', approvalsInRow: 0, doneInRow: 3, activeCount: 3, blockingObjections: 0 }), { finished: true, reason: 'consenso' });
  assert.strictEqual(cycleOutcome({ mode: 'auto', approvalsInRow: 3, doneInRow: 3, activeCount: 3, blockingObjections: 1 }).finished, false);
  // Un APROBADO sin nota no puede cerrar el ciclo.
  assert.deepStrictEqual(judgeVerdict({ verdict: 'APROBADO', score: null, minScore: 9, changedWork: [], objections: [] }), { verdict: 'CAMBIOS', downgraded: 'no score provided' });
  assert.strictEqual(judgeVerdict({ verdict: 'APROBADO', score: 8, minScore: 9 }).verdict, 'CAMBIOS');
  assert.strictEqual(judgeVerdict({ verdict: 'APROBADO', score: 9, minScore: 9, changedWork: ['a.js'] }).downgraded.startsWith('changed'), true);
  assert.strictEqual(judgeVerdict({ verdict: 'APROBADO', score: 9, minScore: 9, objections: ['x'] }).downgraded, 'raised new objections');
  assert.strictEqual(judgeVerdict({ verdict: 'APROBADO', score: 9.5, minScore: 9 }).verdict, 'APROBADO');
  assert.strictEqual(judgeVerdict({ verdict: 'CAMBIOS', score: null, minScore: 9 }).downgraded, null);
});

test('expediente: la contabilidad del turno no cuenta como archivo de trabajo', () => {
  const agents = [{ id: 'grok', name: 'Grok', color: '#fff', role: 'Auditor' }];
  const messages = [
    {
      kind: 'agent', agentId: 'grok', agentName: 'Grok', verdict: 'CAMBIOS', score: 9, seconds: 10,
      files: ['HANDOFF.md', 'MEMORIA.md', 'memoria-oficina/ingenieria.md', 'docs/DISCUSION.md', 'lib/streams.js'],
      workFiles: ['lib/streams.js'],
    },
    {
      kind: 'agent', agentId: 'grok', agentName: 'Grok', verdict: 'APROBADO', score: 9, seconds: 8,
      files: ['HANDOFF.md', 'MEMORIA.md'],
    },
  ];
  const stats = computeAgentStats(messages, agents).find(s => s.id === 'grok');
  assert.strictEqual(stats.filesTouched, 1);
  assert.deepStrictEqual(stats.topFiles, [{ file: 'lib/streams.js', n: 1 }]);
});

test('snapshot: detecta una edición que conserva tamaño y fecha y rebaja el APROBADO', () => {
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'office-snapshot-'));
  try {
    const file = path.join(dir, 'trabajo.txt');
    const stamp = new Date('2026-01-01T00:00:00Z');
    fs.writeFileSync(file, 'antes\n');
    fs.utimesSync(file, stamp, stamp);
    const before = snapshot(dir);
    fs.writeFileSync(file, 'nuevo\n');
    fs.utimesSync(file, stamp, stamp);
    const after = snapshot(dir);
    assert.strictEqual(before.get('trabajo.txt').sig, after.get('trabajo.txt').sig);
    const diff = diffSnapshots(before, after);
    assert.deepStrictEqual(diff.modified, ['trabajo.txt']);
    assert.match(textDiffs(before, after, diff)[0].patch, /-antes\n\+nuevo/);
    assert.strictEqual(judgeVerdict({ verdict: 'APROBADO', score: 9, minScore: 9, changedWork: workChanges(diff) }).verdict, 'CAMBIOS');
    assert.deepStrictEqual(diffSnapshots(after, snapshot(dir)).modified, []);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('diff por turno: muestra el cambio de texto y omite la contabilidad', () => {
  const before = new Map([
    ['trabajo.txt', { sig: '1', text: 'a\nb\nc\nd\ne\n' }],
    ['HANDOFF.md', { sig: '1', text: 'viejo\n' }],
  ]);
  const after = new Map([
    ['trabajo.txt', { sig: '2', text: 'a\nB\nc\nd\nE\n' }],
    ['HANDOFF.md', { sig: '2', text: 'nuevo\n' }],
    ['notas/nuevo.md', { sig: '3', text: 'hola\n' }],
  ]);
  const diffs = textDiffs(before, after, { added: ['notas/nuevo.md'], modified: ['trabajo.txt', 'HANDOFF.md'], deleted: [] });
  const work = diffs.find(d => d.file === 'trabajo.txt');
  assert.ok(work.patch.includes('-b') && work.patch.includes('+B') && work.patch.includes('+E'), work.patch);
  assert.ok(work.patch.includes('@@'));
  assert.ok(diffs.some(d => d.file === 'notas/nuevo.md' && d.patch.includes('+hola')));
  assert.ok(!diffs.some(d => d.file === 'HANDOFF.md'));
  const same = textDiffs(before, before, { added: [], modified: ['trabajo.txt'], deleted: [] });
  assert.strictEqual(same.length, 0);
});

test('intervención del usuario: objeciones de Usuario bloquean el cierre y no desplazan el pedido principal en el brief', () => {
  const d = [];
  addObjections(d, { agentId: 'user', agentName: 'Usuario', round: 1, cycle: 10 }, ['No usar fuentes externas']);
  assert.strictEqual(blocking(d, ['claude', 'gemini']).length, 1);
  assert.strictEqual(pendingFor(d, 'claude').length, 1);
  applyReplies(d, { agentId: 'claude', agentName: 'Claude', round: 1 },
    [{ id: 1, stance: 'rechazada', text: 'Discrepo con la restricción' }]);
  assert.strictEqual(d[0].status, 'disputada');
  assert.strictEqual(blocking(d, ['claude', 'gemini']).length, 1,
    'rechazar una objeción del usuario no permite ignorarla y cerrar');
  assert.strictEqual(pendingFor(d, 'gemini').length, 1,
    'el siguiente agente debe poder responder a la disputa del usuario');
  setObjectionStatus(d, 1, 'resuelta', { text: 'Corregido en CSS' });
  assert.strictEqual(d[0].status, 'resuelta');
  assert.strictEqual(blocking(d, ['claude', 'gemini']).length, 0);

  const brief = buildTurnBrief({
    chat: {
      messages: [
        { kind: 'user', text: 'Pedido principal de la misión' },
        { kind: 'user', intervention: true, cycle: 10, text: 'Directiva en mitad del ciclo: usar CSS Grid' },
      ],
    },
    agent: { id: 'claude', name: 'Claude', role: 'Arquitecto' },
    team: [{ id: 'claude', name: 'Claude', role: 'Arquitecto' }],
    info: { round: 1, maxRounds: 3, turn: 1, cycle: 10, minScore: 9, mode: 'rondas' },
    memoryDir: 'memoria-oficina',
  });
  assert.match(brief, /## Pedido actual del usuario\nPedido principal de la misión/);
  assert.match(brief, /### Directivas del usuario durante este ciclo[\s\S]*Directiva en mitad del ciclo: usar CSS Grid/);
  assert.match(brief, /## Pedidos anteriores en este chat \(ya trabajados\)\n\(ninguno\)/);
});

test('plantillas: válidas contra agents.json, se guardan en el ciclo y llegan al brief con sus criterios', () => {
  const { TEMPLATES, templateBrief } = require('../lib/templates');
  const real = require('../agents.example.json').agents.map(a => a.id);
  assert.ok(TEMPLATES.length >= 5);
  assert.strictEqual(new Set(TEMPLATES.map(t => t.id)).size, TEMPLATES.length);
  for (const t of TEMPLATES) {
    assert.ok(['rondas', 'auto'].includes(t.mode), t.id);
    assert.ok(t.skeleton.trim() && t.criteria.length >= 3 && t.output, t.id);
    // El equipo sugerido usa agentes que existen. Los opcionales (kimi) no entran en las plantillas.
    assert.ok(t.team.every(x => real.includes(x.id)), `${t.id}: el equipo sugerido usa los agentes reales`);
    assert.deepStrictEqual([...t.team.map(x => x.id)].sort(), ['claude', 'codex', 'gemini', 'grok'], `${t.id}: equipo base`);
    // La configuración sugerida sobrevive a la normalización sin cambios.
    const cfg = normalizeCycleConfig({ ...t, template: t.id }, { agents: require('../agents.example.json').agents });
    assert.deepStrictEqual([cfg.mode, cfg.maxRounds, cfg.minScore, cfg.team, cfg.template], [t.mode, t.maxRounds, t.minScore, t.team, t.id]);
  }
  assert.strictEqual(normalizeCycleConfig({ template: 'no-existe' }, { agents: [] }).template, null);
  assert.strictEqual(templateBrief(null), '');
  const brief = buildTurnBrief({
    chat: { config: { template: 'investigacion' }, messages: [{ kind: 'user', text: '¿Qué CLI de IA es más barata?' }] },
    agent: { id: 'gemini', name: 'Gemini', role: 'Investigador principal' },
    team: [{ id: 'gemini', name: 'Gemini', role: 'Investigador principal' }],
    info: { round: 1, maxRounds: 4, turn: 1, cycle: 1, minScore: 9, mode: 'auto' },
    memoryDir: 'memoria-oficina',
  });
  assert.match(brief, /## Tipo de misión: Investigación\nCriterios de calidad/);
  assert.match(brief, /cita su fuente/);
  assert.match(brief, /Dónde va el entregable: docs\/informe\.md/);
});

test('meseta y retroceso (D46): solo rondas completas, sin autonota y sin intervención del usuario', () => {
  const t = (round, score, extra = {}) => ({ round, score, verdict: 'CAMBIOS', ...extra });
  const flat = [t(1, 8), t(1, 8.5), t(2, 8.5), t(2, 8.4)];
  const p = plateauOutcome({ turns: flat, round: 2, expected: 2 });
  assert.strictEqual(p.reason, 'meseta');
  assert.deepStrictEqual([p.prev, p.last], [8.25, 8.45]);
  assert.match(plateauSummary(p, { open: 1 }), /^⏸ Stopped at a plateau, without approval: .*round 1: 8.25 → round 2: 8.45.*1 objection/);
  // Sube 0,5 o más: progresa, sigue.
  assert.strictEqual(plateauOutcome({ turns: [t(1, 7), t(1, 7), t(2, 7.5), t(2, 7.5)], round: 2, expected: 2 }), null);
  // Baja 0,5 o más: retroceso.
  assert.strictEqual(plateauOutcome({ turns: [t(1, 9), t(1, 8), t(2, 8), t(2, 8)], round: 2, expected: 2 }).reason, 'retroceso');
  // La autonota no entra en la media: un presidente que se pone 10 no mueve nada.
  const self = [t(1, 8), t(1, 8), t(1, 3, { self: true }), t(2, 8), t(2, 8), t(2, 10, { self: true })];
  assert.strictEqual(plateauOutcome({ turns: self, round: 2, expected: 3 }).last, 8);
  // Ronda incompleta: falta un turno, uno PARCIAL o ERROR, o uno sin nota.
  assert.strictEqual(plateauOutcome({ turns: [t(1, 8), t(2, 8), t(2, 8)], round: 2, expected: 2 }), null);
  assert.strictEqual(plateauOutcome({ turns: [t(1, 8), t(1, null, { verdict: 'PARCIAL' }), t(2, 8), t(2, 8)], round: 2, expected: 2 }), null);
  assert.strictEqual(plateauOutcome({ turns: [t(1, 8), t(1, null), t(2, 8), t(2, 8)], round: 2, expected: 2 }), null);
  // Ronda 1 sola o con intervención del usuario: no compara.
  assert.strictEqual(plateauOutcome({ turns: flat, round: 1, expected: 2 }), null);
  assert.strictEqual(plateauOutcome({ turns: flat, round: 2, expected: 2, intervenedRounds: [2] }), null);
});

test('PARCIAL (D47): solo un corte por tiempo o silencio con archivos de trabajo cambiados', () => {
  const { isPartial } = require('../lib/failure');
  assert.strictEqual(isPartial({ kind: 'tiempo' }, ['a.md']), true);
  assert.strictEqual(isPartial({ kind: 'colgada' }, ['a.md']), true);
  assert.strictEqual(isPartial({ kind: 'colgada' }, []), false);
  assert.strictEqual(isPartial({ kind: 'saldo' }, ['a.md']), false);
  assert.strictEqual(isPartial(null, ['a.md']), false);
});

test('contexto corto (D51 / §2.1 d): prefijo estable, diffs desde último turno de ese agente y mapa de archivos', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const os = require('node:os');
  const contexto = require('../lib/contexto');

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'om-ctx-'));
  fs.writeFileSync(path.join(tmp, 'archivo1.txt'), 'hola');
  fs.mkdirSync(path.join(tmp, 'docs'));
  fs.writeFileSync(path.join(tmp, 'docs', 'manual.md'), 'manual');

  const agent = { id: 'gemini', name: 'Gemini', role: 'Investigador' };
  const messages = [
    { kind: 'user', text: 'Haz el proyecto X' },
    { kind: 'agent', agentId: 'claude', agentName: 'Claude', round: 1, score: 8, verdict: 'CAMBIOS', workFiles: ['archivo1.txt'] },
    { kind: 'agent', agentId: 'gemini', agentName: 'Gemini', round: 1, score: 9, verdict: 'CAMBIOS', workFiles: ['docs/manual.md'] },
    { kind: 'agent', agentId: 'codex', agentName: 'Codex', round: 2, score: 8, verdict: 'CAMBIOS', workFiles: ['archivo1.txt'] },
  ];

  const diffs = contexto.diffsSinceLastTurn(messages, 'gemini');
  assert.match(diffs, /Codex/);
  assert.doesNotMatch(diffs, /Claude/); // Claude fue antes del último turno de Gemini

  // La copia de contexto recibe el brief real; no existe un segundo generador de prompts.
  const pkg = buildTurnBrief({
    chat: { messages }, agent, team: [agent],
    info: { round: 2, turn: 4, mode: 'auto', minScore: 9 },
    projectDir: tmp,
    relevant: [{ file: 'ingenieria.md', heading: 'Caché', text: 'El 90% es caché.' }],
    pending: [{ id: 1, byName: 'Codex', status: 'abierta', text: 'Revalidar' }],
  });
  assert.match(pkg, /PREFIJO ESTABLE/);
  assert.match(pkg, /archivo1\.txt/);
  assert.match(pkg, /manual\.md/);
  assert.match(pkg, /ingenieria\.md/);
  assert.match(pkg, /#1.*Codex.*Revalidar/);
  assert.ok(Buffer.byteLength(pkg, 'utf8') <= contexto.CONTEXT_MAX);
  contexto.writeContextFiles(tmp, agent.id, pkg);
  for (const name of contexto.contextNames(agent.id)) {
    assert.strictEqual(fs.readFileSync(path.join(tmp, '.office', name), 'utf8'), pkg);
  }

  // Un id con ruta no sale de .office.
  contexto.writeContextFiles(tmp, '../fuera', 'no sales');
  assert.ok(!fs.existsSync(path.join(tmp, 'fuera')));
  assert.ok(!fs.existsSync(path.join(path.dirname(tmp), 'fuera')));
  assert.deepStrictEqual(contexto.contextNames('../fuera'), ['contexto.md']);
  assert.deepStrictEqual(contexto.contextNames('gemini'), ['contexto.md', 'contexto-gemini.md']);

  // Una unión hacia fuera no entra en el mapa (el servidor sí podría leerla).
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'om-fuera-'));
  fs.writeFileSync(path.join(outside, 'secreto-fuera.txt'), 'no');
  fs.symlinkSync(outside, path.join(tmp, 'puente'), 'junction');
  const map = contexto.projectFileMap(tmp);
  assert.match(map, /archivo1\.txt/);
  assert.doesNotMatch(map, /secreto-fuera/);

  // El prefijo del brief no se mueve al cambiar la ronda, y un handoff enorme no se come el protocolo.
  const base = {
    chat: { messages: [{ kind: 'user', text: 'Pedido corto' }] },
    agent: { id: 'grok', name: 'Grok', role: 'Auditor' },
    team: [{ id: 'grok', name: 'Grok', role: 'Auditor' }],
    memoryDir: 'memoria-oficina',
  };
  const uno = buildTurnBrief({ ...base, info: { round: 1, maxRounds: 5, turn: 1, cycle: 1, minScore: 9, mode: 'auto' }, handoff: 'corto' });
  const dos = buildTurnBrief({
    ...base,
    chat: { messages: [{ kind: 'user', text: 'Otro pedido, más largo' }] },
    info: { round: 2, maxRounds: 5, turn: 4, cycle: 1, minScore: 9, mode: 'auto' },
    handoff: 'H'.repeat(80000),
    relevant: [{ file: 'x.md', heading: 'T', text: 'M'.repeat(80000) }],
  });
  const mark = contexto.DYNAMIC_MARK;
  assert.strictEqual(uno.slice(0, uno.indexOf(mark)), dos.slice(0, dos.indexOf(mark)));
  assert.ok(uno.indexOf(mark) < uno.indexOf('Pedido corto'));
  assert.ok(dos.length <= contexto.CONTEXT_MAX);
  assert.ok(dos.indexOf('PREFIJO ESTABLE') < dos.indexOf(mark));
  assert.match(dos.slice(0, dos.indexOf(mark)), /OBJECIONES:/);
});

test('contexto: el tope cuenta bytes UTF-8 sin cortar el prefijo ni los emojis', () => {
  const { assembleContext, CONTEXT_MAX, DYNAMIC_MARK } = require('../lib/contexto');
  const prefix = 'Identidad y protocolo: revisión en español 🏢';
  for (const unit of ['a', 'á', '漢', '🏢']) {
    const full = assembleContext(prefix, unit.repeat(CONTEXT_MAX), '');
    assert.ok(Buffer.byteLength(full, 'utf8') <= CONTEXT_MAX);
    assert.ok(full.startsWith(prefix));
    assert.match(full, /truncated to fit the context budget/);
    assert.strictEqual(Buffer.from(full, 'utf8').toString('utf8'), full);
    const fixed = `${prefix}\n---\n\n${DYNAMIC_MARK}\n`;
    assert.strictEqual(assembleContext(prefix, unit.repeat(100), '', Buffer.byteLength(fixed)), fixed);
  }
});
