// Modelos de reserva: si se acaba la cuota de un modelo (429 RESOURCE_EXHAUSTED de Antigravity), el mismo turno se
// repite con el siguiente modelo de la lista y el agotado no se vuelve a probar en el siguiente ciclo.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createModels } = require('../lib/modelos');

test('lib/modelos: elige, agota, sustituye el flag y recuerda en disco', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'om-mod-')), '.cuotas.json');
  const agent = { id: 'gemini', args: ['-p', '{prompt}', '--model', 'viejo'], models: ['argon', 'flash'], modelFlag: '--model' };
  const m = createModels(file);
  assert.strictEqual(m.pick(agent), 'argon');
  assert.deepStrictEqual(m.argsFor(agent, 'argon'), ['-p', '{prompt}', '--model', 'argon'], 'sustituye el --model que ya traía');
  assert.strictEqual(m.exhaust(agent, 'argon'), 'flash');
  assert.strictEqual(createModels(file).pick(agent), 'flash', 'tras reiniciar sigue sabiendo que argon está agotado');
  assert.strictEqual(m.exhaust(agent, 'flash'), null);
  assert.strictEqual(m.pick({ id: 'x', args: [] }), null, 'sin lista: lo que diga la CLI');
  assert.deepStrictEqual(m.argsFor({ args: ['a'] }, null), ['a']);
  assert.ok(m.isQuota({ kind: 'limite' }) && m.isQuota({ kind: 'saldo' }) && !m.isQuota({ kind: 'sesion' }) && !m.isQuota(null));
});

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'officematrix-modelos-'));
const fake = path.join(__dirname, 'helpers', 'fake-agent.js');
fs.writeFileSync(path.join(home, 'agents.json'), JSON.stringify({
  agents: [{ id: 'gemini', name: 'Gemini', role: 'Probador', color: '#fff', cmd: 'node', stream: 'text',
    args: [fake, 'gemini', 'cuota', 'text', '{prompt}'], models: ['modelo-agotado', 'modelo-bueno'], modelFlag: '--model' }],
  maxRounds: 1, minScore: 9, turnTimeoutMinutes: 1, relatorMinutes: 0, idleTimeoutMinutes: 0,
}));
process.env.OFFICEMATRIX_HOME = home;
process.env.OFFICEMATRIX_CONFIG = path.join(home, 'agents.json');

const { server, running } = require('../server');
let base;
test.before(() => new Promise(resolve => server.listen(0, '127.0.0.1', () => { base = `http://127.0.0.1:${server.address().port}`; resolve(); })));
test.after(() => { server.close(); server.closeAllConnections?.(); fs.rmSync(home, { recursive: true, force: true }); });

const mission = async text => {
  const res = await fetch(`${base}/api/chats`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text, config: { mode: 'rondas', maxRounds: 1 } }) });
  const chat = await res.json();
  for (let i = 0; i < 300 && running.has(chat.id); i++) await new Promise(r => setTimeout(r, 100));
  return (await fetch(`${base}/api/chats/${chat.id}`)).json();
};

test('cuota agotada a mitad de turno: repite con el modelo de reserva y no sale del ciclo', async () => {
  const d = await mission('Trabajo de prueba');
  const turns = d.messages.filter(m => m.kind === 'agent');
  assert.strictEqual(turns.length, 1);
  assert.notStrictEqual(turns[0].verdict, 'ERROR', 'el turno no se pierde');
  assert.strictEqual(turns[0].model, 'modelo-bueno');
  assert.ok(d.messages.some(m => m.kind === 'system' && /modelo-agotado is out of quota; repeating the turn with modelo-bueno/.test(m.text)));

  // El siguiente ciclo ya empieza con el bueno: ni un intento perdido.
  const d2 = await mission('Otro trabajo');
  assert.ok(!d2.messages.some(m => m.kind === 'system' && /se acabó la cuota|is out of quota/.test(m.text)));
  assert.strictEqual(d2.messages.find(m => m.kind === 'agent').model, 'modelo-bueno');
});
