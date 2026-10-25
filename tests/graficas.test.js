// Reportes y gráficas de cada misión (docs/BRIEF-GUI-RESPONSIVE-ESCENA.md §2, D63): el resumen dice en lenguaje llano
// por qué terminó, qué se hizo y qué falta; las gráficas tienen un solo eje, el color sigue al agente y no se recicla,
// y no llevan un número en cada punto.
const test = require('node:test');
const assert = require('node:assert/strict');
const Charts = require('../public/charts');

const agents = [{ id: 'claude', name: 'Claude', color: '#d0704f' }, { id: 'gemini', name: 'Gemini', color: '#4f8df5' }];
const turn = (agentId, round, extra = {}) => ({ kind: 'agent', agentId, agentName: agentId === 'claude' ? 'Claude' : 'Gemini', round, cycle: 1,
  ts: `2026-10-24T10:0${round}:00Z`, seconds: 30, verdict: 'CAMBIOS', score: 8, ...extra });
const plain = html => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
const chat = (outcome, extra = {}) => ({
  running: false, config: { maxRounds: 3 }, path: 'C:/p/mision', deliverables: { main: 'final/informe.md' },
  messages: [
    { kind: 'user', text: 'pedido' },
    turn('claude', 1, { usage: { totalTokens: 1200, inputTokens: 1000, outputTokens: 200 }, workFiles: ['final/informe.md'] }),
    turn('gemini', 1, { usage: { totalTokens: 800 }, workFiles: ['final/informe.md', 'src/a.js'] }),
    ...(outcome ? [{ kind: 'system', outcome, text: '⏸ Meseta: la media no cambió.' }] : []),
  ],
  debate: [
    { id: 1, by: 'gemini', byName: 'Gemini', round: 1, cycle: 1, status: 'abierta', text: 'Faltan las fuentes', replies: [] },
    { id: 2, by: 'claude', byName: 'Claude', round: 1, cycle: 1, status: 'resuelta', text: 'Título largo', replies: [{ by: 'gemini', round: 2, stance: 'resuelta' }] },
  ],
  ...extra,
});

test('resumen: la ruta del entregable no enseña la cuenta de la casa', () => {
  const html = Charts.summary({ ...chat('unanime'), path: 'C:\\Users\\usuario\\AppData\\Local\\Temp\\mision' }, agents);
  assert.match(html, /~\\AppData\\Local\\Temp\\mision/);
  assert.doesNotMatch(html, /Users\\usuario/);
});

test('gráficas: el veredicto interno se pinta en el idioma de la interfaz', () => {
  const html = Charts.dataTable([turn('claude', 1, { verdict: 'APROBADO', score: 9 })], agents);
  assert.match(html, />APPROVED</);
  assert.doesNotMatch(html, />APROBADO</);
  assert.match(Charts.dataTable([turn('claude', 1)], agents), />CHANGES</);
  assert.match(Charts.scoreLine([turn('claude', 1, { verdict: 'APROBADO', score: 9 })], agents, 9, 500), /APPROVED/);
});

test('resumen: por qué terminó, cifras y, en lenguaje llano, qué se hizo y qué falta', () => {
  const s = plain(Charts.summary(chat('meseta'), agents));
  assert.match(s, /(?:Se detuvo por meseta|Stopped by plateau)/);
  assert.match(s, /(?:Rondas|Rounds) 1 \/ 3/);
  assert.match(s, /(?:Turnos|Turns) 2/);
  assert.match(s, /(?:Tokens|Tokens) 2\.0k/);
  assert.match(s, /(?:1 abierta · 1 cerrada|1 open · 1 closed)/);
  assert.match(s, /(?:Qué se hizo|What was done)\. Meseta: la media no cambió\./, 'el cierre del motor, sin su icono');
  assert.match(s, /(?:Cambiaron 2 archivos de trabajo|2 work file\(s\) changed)/);
  assert.match(s, /(?:Entregable principal|Main deliverable): final\/informe\.md/);
  assert.match(s, /(?:Qué falta|What is pending)\. #1 Faltan las fuentes \((?:de|by) Gemini\)/);
  assert.match(s, /(?:decide si la aceptas|decide to accept)/);
  // Cada final con su motivo.
  assert.equal(Charts.outcomeOf(chat('unanime')), 'unanime');
  assert.equal(Charts.outcomeOf(chat('agotado')), 'agotado');
  assert.equal(Charts.outcomeOf(chat('started')), 'interrupted');
  assert.equal(Charts.outcomeOf(chat(null)), 'interrupted');
  assert.equal(Charts.outcomeOf(chat('unanime', { running: true })), 'running');
  assert.match(plain(Charts.summary(chat('agotado'), agents)), /(?:tope de rondas sin aprobar|round limit without approval)/);
  assert.match(plain(Charts.summary(chat('started'), agents)), /(?:Reanuda el ciclo|Resume the cycle)/);
  assert.match(plain(Charts.summary(chat('retroceso'), agents)), /(?:la nota media bajó|average score dropped)/);
  assert.match(plain(Charts.summary(chat('detenido'), agents)), /(?:La detuviste tú|Resume with another pass)/);
  const ok = chat('unanime', { debate: [] });
  assert.match(plain(Charts.summary(ok, agents)), /(?:Qué falta\. Nada pendiente\.|What is pending\. Nothing pending\.)/);
  // Escapa lo que viene de los agentes.
  const xss = chat('unanime', { debate: [{ id: 3, round: 1, status: 'abierta', text: '<img src=x onerror=alert(1)>', replies: [] }] });
  assert.doesNotMatch(Charts.summary(xss, agents), /<img src=x/);
});

test('tokens por turno: una barra por turno medido, del color de su agente, sin número en cada barra', () => {
  const turns = chat('unanime').messages.filter(m => m.kind === 'agent');
  turns.push(turn('claude', 2)); // sin uso medido: hueco, no barra
  const html = Charts.tokenBars(turns, agents, 500);
  const bars = html.match(/<rect class="bar"[^>]*>/g) || [];
  assert.equal(bars.length, 2);
  assert.match(bars[0], /fill="#d0704f"/);
  assert.match(bars[1], /fill="#4f8df5"/);
  assert.doesNotMatch(html, /class="val"/, 'sin valor sobre cada barra: va en el tooltip');
  assert.match(html, /data-tip="Claude · (?:turno|turn) 1[^"]*1\.2k tokens \((?:entrada|input) 1\.0k, (?:salida|output) 200\)/);
  assert.match(html, /(?:1 turno\(s\) sin medir|1 unmeasured turn\(s\))/);
  assert.match(Charts.tokenBars([turn('claude', 1)], agents, 500), /(?:no informaron tokens|reported no tokens)/);
});

test('objeciones por ronda: planteadas, cerradas y abiertas al cerrar cada ronda', () => {
  const html = Charts.objections(chat('meseta').debate, 500);
  assert.match(html, /(?:Ronda|Round) 1\n(?:Round 1\n)?2 (?:planteada\(s\)|raised) · 0 (?:cerrada\(s\)|closed) · 2 (?:abierta\(s\) al terminar la ronda|open at round end)/);
  assert.match(html, /(?:Ronda|Round) 2\n(?:Round 2\n)?0 (?:planteada\(s\)|raised) · 1 (?:cerrada\(s\)|closed) · 1 (?:abierta\(s\) al terminar la ronda|open at round end)/);
  assert.match(html, /2 (?:en este ciclo|in this cycle) · 1 (?:abiertas|open)/);
  assert.match(Charts.objections([], 500), /(?:Nadie planteó objeciones|No objections were raised)/);
});

test('el color sigue al agente y nunca se recicla', () => {
  const twins = Charts.distinct([{ id: 'a', color: '#10a37f' }, { id: 'b', color: '#10A37F' }, { id: 'c', color: '#c062d6' }]);
  assert.equal(twins[0].color, '#10a37f');
  assert.notEqual(twins[1].color.toLowerCase(), '#10a37f');
  assert.equal(twins[2].color, '#c062d6');
  const team = Charts.distinct(Array.from({ length: 12 }, (_, i) => ({ id: `empleado-${i}`, color: '#10a37f' })));
  assert.equal(new Set(team.map(a => a.color)).size, team.length, 'tampoco recicla colores con más de cinco empleados de la misma CLI');
  // La matriz de revisiones y la media del equipo no usan el color de ningún agente.
  const matrix = Charts.reviewMatrix([{ phase: 'revision', agentId: 'claude', targetOwner: 'gemini', score: 8 }], agents, null, 500);
  for (const a of agents) assert.doesNotMatch(matrix, new RegExp(`fill="${a.color}"`));
  const conv = Charts.convergence([turn('claude', 1, { score: 8 }), turn('claude', 2, { score: 9 }), turn('claude', 3, { score: 9.5 })], 9, 500);
  for (const a of agents) assert.doesNotMatch(conv, new RegExp(a.color));
  // Un solo número en la línea de convergencia: el de la última ronda.
  assert.equal((conv.match(/<text class="end"/g) || []).length, 1);
  assert.match(conv, />9\.5<\/text>/);
});

// Tema claro (D65): las gráficas pintan con las variables del tema, así que basta con que las tintas del tema claro
// tengan contraste y que los colores de agente se vean sobre el panel blanco.
test('tema claro: tintas con contraste AA y colores de agente visibles sobre el panel', () => {
  const fs = require('node:fs'), path = require('node:path');
  const css = fs.readFileSync(path.join(__dirname, '../public/style.css'), 'utf8');
  const vars = block => Object.fromEntries([...block.matchAll(/--([a-z0-9-]+):\s*(#[0-9a-f]{6})/gi)].map(m => [m[1], m[2]]));
  const claro = vars(css.match(/:root\[data-tema="claro"\]\s*\{([^}]+)\}/)[1]);
  const lum = hex => {
    const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(c => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
  for (const bg of [claro.panel, claro.bg]) {
    for (const ink of ['text', 'dim', 'accent', 'amber', 'ok', 'err']) assert.ok(ratio(claro[ink], bg) >= 4.5, `--${ink} sobre ${bg}: ${ratio(claro[ink], bg).toFixed(2)}`);
    assert.ok(ratio(claro.line, bg) < 1.5, 'la rejilla queda tenue, no compite con las series');
  }
  // Los colores de las cuatro CLIs (agents.example.json, lo que se publica) como marca gráfica: ≥ 3:1 sobre el panel claro (WCAG 1.4.11).
  for (const a of JSON.parse(fs.readFileSync(path.join(__dirname, '../agents.example.json'), 'utf8')).agents || []) {
    if (a.color) assert.ok(ratio(a.color, claro.panel) >= 3, `${a.id} ${a.color}: ${ratio(a.color, claro.panel).toFixed(2)}`);
  }
  // En claro las variantes de un color repetido se oscurecen (aclarar hacia el blanco borraría la línea) y no se repiten.
  const team = Charts.distinct(Array.from({ length: 12 }, (_, i) => ({ id: `e${i}`, color: '#10a37f' })), 'claro');
  assert.equal(new Set(team.map(a => a.color)).size, 12);
  for (const a of team.slice(1)) assert.match(a.color, /#000000\)$/);
  // La matriz de revisiones no fija un color claro a mano: usa la tinta del tema.
  assert.doesNotMatch(Charts.reviewMatrix([{ phase: 'revision', agentId: 'claude', targetOwner: 'gemini', score: 8 }], agents, null, 500), /fill="#/);
});
