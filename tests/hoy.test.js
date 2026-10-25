// «Hoy en la oficina» (lib/hoy.js): función pura, con un «ahora» y una zona fijos.
const test = require('node:test');
const assert = require('node:assert');
const { tablero, diaDe } = require('../lib/hoy');

const equipo = [
  { id: 'irene', name: 'Irene Vidal', role: 'Directora', modeloLabel: 'claude opus' },
  { id: 'kenji', name: 'Kenji Morales', role: 'Verificador', modeloLabel: 'codex' },
];
const oficina = { id: 'redaccion', nombre: 'Redacción', marca: { nombre: 'Acme Ciencia', zona: 'America/Mexico_City' }, empleados: [{ id: 'irene' }, { id: 'kenji' }] };
const cycle = 1000;
// 23-oct 05:30 UTC = 22-oct 23:30 en Ciudad de México: cuenta para el día 22, no el 23.
const turno = (agentId, agentName, ts, extra = {}) => ({ kind: 'agent', agentId, agentName, ts, cycle, seconds: 90, verdict: 'APROBADO', score: 9, ...extra });
const mision = {
  id: 'm1', title: 'Artículo del martes', outcome: 'ok', debate: [],
  messages: [
    { kind: 'system', ts: '2026-10-23T15:00:00Z', cycle, outcome: 'started', text: 'Comienza el ciclo' },
    turno('irene', 'Irene Vidal', '2026-10-23T15:05:00Z', { usage: { totalTokens: 1000, inputTokens: 700, outputTokens: 100, cachedTokens: 200 } }),
    // Kenji DICE que publicó: el tablero no lo cree, solo cuenta el turno.
    turno('kenji', 'Kenji Morales', '2026-10-23T15:10:00Z', { text: 'Hecho: publicado en WordPress', reserva: { motivo: 'SIN SALDO', de: 'codex', a: 'claude opus', diversidadReducida: true } }),
    { kind: 'system', ts: '2026-10-23T15:11:00Z', text: '🧠 Cerebro actualizado por Kenji Morales: lecciones.md, fuentes.md (fusionado con cambios de otro ciclo)' },
    { kind: 'system', ts: '2026-10-23T15:12:00Z', cycle, outcome: 'unanime', text: '✅ Impecable' },
    turno('irene', 'Irene Vidal', '2026-10-23T05:30:00Z', { cycle: 1, score: 7 }),
  ],
};
const ahora = new Date('2026-10-23T18:00:00Z');

test('HOY: última actividad, reserva y fallo dependen de la fecha del turno, no del orden de las misiones', () => {
  const mensaje = (ts, label) => turno('irene', 'Irene Vidal', ts, {
    failure: { label, hint: label }, reserva: { a: label }, modelo: { id: label },
  });
  const reciente = { id: 'reciente', title: 'Nueva', messages: [mensaje('2026-10-23T17:00:00Z', 'actual')] };
  const antigua = { id: 'antigua', title: 'Reanudada', messages: [
    mensaje('2026-10-23T15:00:00Z', 'anterior'),
    turno('irene', 'Irene Vidal', '2026-10-23T17:30:00Z'),
  ] };
  for (const misiones of [[reciente, antigua], [antigua, reciente]]) {
    const h = tablero({ oficina, equipo, misiones, ahora });
    const e = h.equipo[0];
    assert.strictEqual(e.ultimo.chatId, 'antigua', 'la misión reanudada tiene el último turno');
    assert.strictEqual(e.ultimo.hora, '11:30');
    assert.strictEqual(e.reserva.a, 'actual');
    assert.strictEqual(e.reserva.chatId, 'reciente');
    assert.strictEqual(e.fallo.label, 'actual');
    assert.strictEqual(e.fallo.chatId, 'reciente');
    assert.strictEqual(e.turnos, 3);
  }
});

test('HOY: día en la zona de la marca, gasto medido frente a desconocido, hecho solo por cierres del servidor', () => {
  const h = tablero({ oficina, equipo, misiones: [mision], ahora });
  assert.strictEqual(h.dia, '2026-10-23');
  assert.strictEqual(h.fecha, 'Friday, Oct 23');
  assert.strictEqual(h.zona, 'America/Mexico_City');
  assert.deepStrictEqual([h.gasto.turnos, h.gasto.turnosMedidos, h.gasto.desconocidos, h.gasto.tokens, h.gasto.cache, h.gasto.minutos], [2, 1, 1, 1000, 200, 3]);
  assert.strictEqual(h.hecho.length, 1);
  assert.deepStrictEqual({ ...h.hecho[0], ts: undefined }, { chatId: 'm1', hora: '09:12', ts: undefined, titulo: 'Artículo del martes', estado: 'unanime', icono: '✅', texto: 'approved by everyone', turnos: 2, nota: 9, quien: ['Irene Vidal', 'Kenji Morales'] });
  assert.ok(!JSON.stringify(h.hecho).includes('WordPress'), 'lo que dice un agente no es un hecho');
  assert.deepStrictEqual(h.aprendido, [{ chatId: 'm1', hora: '09:11', quien: 'Kenji Morales', archivos: ['lecciones.md', 'fuentes.md'] }]);
  const kenji = h.equipo.find(e => e.id === 'kenji');
  assert.deepStrictEqual([kenji.turnos, kenji.reserva.a, kenji.ultimo.hora], [1, 'claude opus', '09:10']);
  assert.match(h.atencion[0].texto, /Kenji Morales worked with the backup \(claude opus\): sin saldo on codex/);
  assert.match(h.atencion[0].pista, /Reduced diversity/);
  // En español si se pide (o si el servidor está en español).
  const es = tablero({ oficina, equipo, misiones: [mision], ahora, lang: 'es' });
  assert.strictEqual(es.fecha, 'viernes 23 oct');
  assert.strictEqual(es.hecho[0].texto, 'aprobada por todos');
  assert.match(es.atencion[0].texto, /Kenji Morales trabajó con la reserva \(claude opus\): sin saldo en codex/);
  assert.match(es.atencion[0].pista, /Diversidad reducida/);
  assert.match(es.proximo.texto, /Sin rutinas/);
  // El turno de las 05:30 UTC es del día 22 en Ciudad de México.
  const ayer = tablero({ oficina, equipo, misiones: [mision], ahora, dia: '2026-10-22' });
  assert.deepStrictEqual([ayer.gasto.turnos, ayer.equipo[0].nota, ayer.hoy], [1, 7, false]);
  assert.strictEqual(diaDe('2026-10-23T05:30:00Z', 'UTC'), '2026-10-23');
});

test('HOY: esperan tu decisión (entrantes, interrumpidas, objeciones) y zona inválida = la del sistema', () => {
  const cortada = { id: 'm2', title: 'Retro', outcome: 'interrupted', messages: [], debate: [{ status: 'abierta' }] };
  const conObj = { id: 'm3', title: 'Guion', outcome: 'partial', messages: [], debate: [{ status: 'disputada' }, { status: 'resuelta' }] };
  const enCurso = { id: 'm4', title: 'Newsletter', running: true, outcome: 'running', messages: [{ kind: 'system', ts: '2026-10-23T17:00:00Z', outcome: 'started' }], debate: [{ status: 'abierta' }] };
  const entrantes = [{ archivo: '20261023-100000-fuentes.md', desde: 'Edificio', content: '> Traspaso desde: Edificio · lecciones.md · «Fuentes fiables»\n' }];
  const aceptada = { id: 'm5', title: 'Ya decidida', outcome: 'ok', messages: [{ kind: 'system', ts: '2026-10-23T16:00:00Z', outcome: 'aceptado', userAccepted: true, text: 'El usuario aceptó' }], debate: [{ status: 'abierta' }] };
  const h = tablero({ oficina: { ...oficina, marca: { zona: 'Marte/Olympus' } }, equipo, misiones: [cortada, conObj, enCurso, aceptada], entrantes, ahora });
  assert.deepStrictEqual(h.esperan.map(x => `${x.tipo}:${x.chatId || x.archivo}`), ['entrante:20261023-100000-fuentes.md', 'reanudar:m2', 'objeciones:m3']);
  assert.ok(h.hecho.some(x => x.chatId === 'm5' && x.texto === 'accepted by you'));
  assert.match(h.esperan[0].texto, /“Fuentes fiables”/);
  assert.match(h.esperan[2].texto, /1 open objection/);
  assert.deepStrictEqual(h.hecho.map(x => `${x.chatId}:${x.estado}`), ['m5:aceptado', 'm4:en-curso']);
  assert.strictEqual(h.zona, Intl.DateTimeFormat().resolvedOptions().timeZone);
  assert.ok(h.equipo.every(e => e.turnos === 0 && e.ultimo === null));
  assert.match(h.proximo.texto, /S2/);
});

test('CONTINUIDAD (D56): las últimas misiones cerradas de la oficina, con su cierre y el siguiente paso, en el brief', () => {
  const { ultimasEntregas, siguientePaso } = require('../lib/hoy');
  const { buildTurnBrief } = require('../lib/brief');
  const handoff = `# HANDOFF\n<!-- officematrix:estado -->\nSiguiente paso recomendado: NO es este\n<!-- /officematrix:estado -->\n` +
    `## Último traspaso\n\n**De:** Irene, ronda 2\n\n**Qué hice:** el artículo\n\n**Siguiente paso recomendado:**\n- Publicar la segunda parte el jueves.\n`;
  assert.strictEqual(siguientePaso(handoff), 'Publicar la segunda parte el jueves.');
  assert.strictEqual(siguientePaso('sin traspaso'), '');
  assert.strictEqual(siguientePaso(`## Último traspaso\n**Siguiente paso recomendado:** ${'x'.repeat(400)}`).length, 301);

  const aceptada = { id: 'm2', title: 'Boletín', messages: [
    { kind: 'system', ts: '2026-10-22T10:00:00Z', cycle: 5, outcome: 'started' },
    { kind: 'agent', cycle: 5, score: 8 }, { kind: 'agent', cycle: 5, score: 7 },
    { kind: 'system', ts: '2026-10-22T11:00:00Z', cycle: 5, outcome: 'meseta' },
    { kind: 'system', ts: '2026-10-22T12:00:00Z', cycle: 5, outcome: 'aceptado', userAccepted: true },
  ] };
  const enCurso = { id: 'm3', title: 'A medias', messages: [{ kind: 'system', ts: '2026-10-23T09:00:00Z', outcome: 'started' }] };
  const actual = { id: 'yo', title: 'Esta', messages: mision.messages };
  // El servidor las pide en el idioma del pedido (aquí, español); sin idioma, en el del servidor (inglés).
  assert.match(ultimasEntregas([aceptada])[0].texto, /accepted by you/);
  const previas = ultimasEntregas([{ ...mision, handoff }, aceptada, enCurso, actual], { excluir: 'yo', lang: 'es' });
  assert.deepStrictEqual(previas.map(p => p.id), ['m1', 'm2'], 'la más reciente primero; ni la interrumpida ni la actual');
  assert.strictEqual(previas[0].siguiente, 'Publicar la segunda parte el jueves.');
  assert.strictEqual(previas[0].nota, 9);
  assert.match(previas[1].texto, /aceptada por ti/);
  assert.strictEqual(previas[1].nota, 7.5);
  assert.strictEqual(ultimasEntregas([mision, aceptada], { n: 1 }).length, 1);

  const info = { round: 1, maxRounds: 3, turn: 1, minScore: 9, cycle: 9 };
  const chat = { messages: [{ kind: 'user', text: 'Segunda parte del artículo' }], debate: [] };
  const agent = { id: 'irene', name: 'Irene', role: 'Directora' };
  const con = buildTurnBrief({ chat, agent, team: [agent], info, memoryDir: 'm', previas });
  const sin = buildTurnBrief({ chat, agent, team: [agent], info, memoryDir: 'm' });
  assert.match(con, /## Lo último que cerró esta oficina[\s\S]*«Artículo del martes»: ✅ aprobada por todos · media 9\/10\n  Siguiente paso que dejó su equipo: Publicar la segunda parte/);
  assert.doesNotMatch(sin, /Lo último que cerró/);
  // Va debajo de la marca: el prefijo estable no cambia.
  const mark = '<!-- dinámico -->';
  assert.strictEqual(con.slice(0, con.indexOf(mark)), sin.slice(0, sin.indexOf(mark)));
  assert.ok(con.indexOf('Lo último que cerró') > con.indexOf(mark));
});
