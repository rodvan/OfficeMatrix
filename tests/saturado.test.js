// Servidor saturado (529 Overloaded de Anthropic): no es la cuota del usuario. Se diagnostica bien aunque el arranque de
// la CLI mencione "limit" o "quota", y el turno se repite tras una espera en vez de sacar al agente del ciclo.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { classifyFailure } = require('../lib/failure');

test('529 Overloaded es SERVIDOR SATURADO, no LÍMITE DE USO, aunque el arranque hable de límites', () => {
  const stdout = [
    '{"type":"system","subtype":"init","tools":["Bash"]}',
    '{"type":"system","subtype":"commands_changed","commands":[{"name":"x","description":"handles rate limit, usage limit and quota; try again later"}]}',
    '{"type":"assistant","message":{"content":[{"type":"text","text":"API Error: 529 Overloaded. This is a server-side issue, usually temporary — try again in a moment."}]}}',
  ].join('\n');
  const f = classifyFailure({ code: 1, stdout, report: stdout });
  assert.strictEqual(f.kind, 'saturado');
  assert.match(f.detail, /^API Error: 529 Overloaded/);
  // Los límites de verdad siguen siéndolo.
  assert.strictEqual(classifyFailure({ code: 1, stderr: 'AGY_ERROR: RESOURCE_EXHAUSTED (code 429)' }).kind, 'limite');
  assert.strictEqual(classifyFailure({ code: 1, stderr: "You've hit your usage limit. Try again at 5pm." }).kind, 'limite');
  assert.strictEqual(classifyFailure({ code: 1, stderr: 'HTTP 503 Service Unavailable' }).kind, 'saturado');
});

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'officematrix-saturado-'));
const fake = path.join(__dirname, 'helpers', 'fake-agent.js');
fs.writeFileSync(path.join(home, 'agents.json'), JSON.stringify({
  agents: [{ id: 'claude', name: 'Claude', role: 'Probador', color: '#fff', cmd: 'node', stream: 'claude', args: [fake, 'claude', 'saturado', 'claude', '{prompt}'] }],
  maxRounds: 1, minScore: 9, turnTimeoutMinutes: 1, relatorMinutes: 0, idleTimeoutMinutes: 0,
}));
process.env.OFFICEMATRIX_HOME = home;
process.env.OFFICEMATRIX_CONFIG = path.join(home, 'agents.json');
process.env.OFFICEMATRIX_RETRY_MS = '50,50';

const { server, running } = require('../server');
let base;
test.before(() => new Promise(resolve => server.listen(0, '127.0.0.1', () => { base = `http://127.0.0.1:${server.address().port}`; resolve(); })));
test.after(() => { server.close(); server.closeAllConnections?.(); fs.rmSync(home, { recursive: true, force: true }); });

test('servidor saturado a mitad de turno: espera, reintenta y el agente sigue en el ciclo', async () => {
  const res = await fetch(`${base}/api/chats`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: 'Trabajo', config: { mode: 'rondas', maxRounds: 1 } }) });
  const chat = await res.json();
  for (let i = 0; i < 300 && running.has(chat.id); i++) await new Promise(r => setTimeout(r, 100));
  const d = await (await fetch(`${base}/api/chats/${chat.id}`)).json();
  const turns = d.messages.filter(m => m.kind === 'agent');
  assert.strictEqual(turns.length, 1);
  assert.notStrictEqual(turns[0].verdict, 'ERROR', 'el turno no se pierde');
  assert.ok(d.messages.some(m => m.kind === 'system' && /server overloaded .*No es tu cuota: reintento 1 de 2/.test(m.text)));
});

test('un reporte seguido de un segundo «result» corto y el aviso de cuota «allowed» no es LÍMITE DE USO', () => {
  const { createStreamParser } = require('../lib/streams');
  const lines = [
    '{"type":"result","subtype":"success","is_error":false,"result":"Hecho.\\nNOTA: 9/10\\nVEREDICTO: APROBADO"}',
    '{"type":"rate_limit_event","rate_limit_info":{"status":"allowed","rateLimitType":"five_hour"}}',
    '{"type":"result","subtype":"success","is_error":false,"result":"El servidor de demo se detuvo al llegar a su límite de tiempo."}',
  ];
  const p = createStreamParser('claude');
  p.feed(lines.join('\n') + '\n');
  assert.match(p.finalText(), /NOTA: 9\/10/);
  // Aunque el reporte se perdiera, el aviso informativo de cuota no basta para diagnosticar un límite.
  assert.strictEqual(classifyFailure({ code: 0, stdout: lines.slice(1).join('\n'), report: 'El servidor de demo se detuvo.' }), null);
});
