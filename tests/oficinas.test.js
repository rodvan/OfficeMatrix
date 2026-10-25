// Oficinas (simulaciones aisladas): cada una con sus misiones, su cerebro y su equipo, sin fugas entre ellas,
// y llaves de agente que solo abren su oficina. Ciclo real con agentes falsos y la API HTTP.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'officematrix-oficinas-'));
const fake = path.join(__dirname, 'helpers', 'fake-agent.js');
const agent = (id, name, script) => ({ id, name, role: 'Probador', color: '#fff', cmd: 'node', stream: 'text', args: [fake, id, script, 'text', '{prompt}'] });
fs.writeFileSync(path.join(home, 'agents.json'), JSON.stringify({
  agents: [agent('autor', 'Autor', 'autor'), agent('revisor', 'Revisor', 'revisor'), agent('intruso', 'Intruso', 'revisor')],
  maxRounds: 3, minScore: 9, turnTimeoutMinutes: 1, idleTimeoutMinutes: 0,
}));
fs.mkdirSync(path.join(home, 'memoria'), { recursive: true });
fs.writeFileSync(path.join(home, 'memoria', 'lecciones.md'), '# Lecciones aprendidas\n\n- Secreto del edificio: la clave del wifi.\n');
process.env.OFFICEMATRIX_HOME = home;
process.env.OFFICEMATRIX_CONFIG = path.join(home, 'agents.json');
delete process.env.FAKE_GLOBAL_MEMORY;

const { server, running } = require('../server');
let base;
test.before(() => new Promise(resolve => server.listen(0, '127.0.0.1', () => { base = `http://127.0.0.1:${server.address().port}`; resolve(); })));
test.after(() => { server.close(); server.closeAllConnections?.(); fs.rmSync(home, { recursive: true, force: true }); });

const api = async (url, opts = {}, key) => {
  const headers = { 'Content-Type': 'application/json', ...(key ? { Authorization: `Bearer ${key}` } : {}) };
  const res = await fetch(base + url, { ...opts, headers });
  return { status: res.status, body: await res.json().catch(() => null) };
};
const waitIdle = async id => {
  for (let i = 0; i < 300 && running.has(id); i++) await new Promise(r => setTimeout(r, 100));
  assert.ok(!running.has(id), 'el ciclo debería haber terminado');
};

let acme, acmeChat, edificioChat, key;

test('crear una oficina con su equipo; el edificio siempre existe', async () => {
  const { status, body } = await api('/api/oficinas', { method: 'POST', body: JSON.stringify({ nombre: 'Acme', descripcion: 'Cotizaciones', equipo: ['autor', 'revisor', 'no-existe'] }) });
  assert.strictEqual(status, 201);
  acme = body;
  assert.strictEqual(acme.id, 'acme');
  assert.deepStrictEqual(acme.equipo, ['autor', 'revisor'], 'solo IAs que existen');
  const { body: list } = await api('/api/oficinas');
  assert.deepStrictEqual(list.map(o => o.id), ['edificio', 'acme']);
  assert.strictEqual((await api('/api/oficinas', { method: 'POST', body: JSON.stringify({ nombre: 'Edificio' }) })).status, 400, 'nombre reservado');
  assert.strictEqual((await api('/api/chats?oficina=no-existe')).status, 404);
});

test('una misión de oficina: solo su equipo, su cerebro, sin ver el del edificio', async () => {
  const { status, body } = await api('/api/chats?oficina=acme', { method: 'POST', body: JSON.stringify({
    text: 'Analiza la cotización', config: { mode: 'rondas', maxRounds: 2, team: [{ id: 'autor' }, { id: 'revisor' }, { id: 'intruso' }] },
  }) });
  assert.strictEqual(status, 201);
  acmeChat = body;
  assert.strictEqual(acmeChat.oficina, 'acme');
  assert.deepStrictEqual(acmeChat.config.team.map(t => t.id), ['autor', 'revisor'], 'el intruso no es del equipo de Acme');
  await waitIdle(acmeChat.id);

  const dir = path.join(home, 'oficinas', 'acme', 'proyectos', acmeChat.id);
  assert.ok(fs.existsSync(dir), 'la misión vive dentro de la oficina');
  assert.ok(!fs.existsSync(path.join(home, 'proyectos', acmeChat.id)));
  const { body: detail } = await api(`/api/chats/${acmeChat.id}`);
  assert.ok(detail.messages.some(m => m.kind === 'agent'), 'trabajaron');
  assert.ok(detail.messages.filter(m => m.kind === 'agent').every(m => m.agentId !== 'intruso'));
  assert.strictEqual(detail.oficina, 'acme');

  // El cerebro: lo aprendido queda en Acme; el secreto del edificio nunca llegó a la misión ni al brief.
  const acmeMem = fs.readFileSync(path.join(home, 'oficinas', 'acme', 'memoria', 'lecciones.md'), 'utf8');
  assert.match(acmeMem, /Lección del autor/);
  assert.doesNotMatch(acmeMem, /Secreto del edificio/);
  const edificioMem = fs.readFileSync(path.join(home, 'memoria', 'lecciones.md'), 'utf8');
  assert.doesNotMatch(edificioMem, /Lección del autor/, 'nada de Acme en el edificio');
  for (const f of fs.readdirSync(path.join(dir, 'memoria-oficina'))) {
    assert.doesNotMatch(fs.readFileSync(path.join(dir, 'memoria-oficina', f), 'utf8'), /Secreto del edificio/);
  }
  assert.doesNotMatch(fs.readFileSync(path.join(dir, '.office', 'turno.md'), 'utf8'), /Secreto del edificio/);
});

test('listas, búsqueda y estadísticas no cruzan oficinas', async () => {
  const { body: ed } = await api('/api/chats', { method: 'POST', body: JSON.stringify({ text: 'Tarea del edificio', config: { mode: 'rondas', maxRounds: 1, team: [{ id: 'revisor' }] } }) });
  edificioChat = ed;
  await waitIdle(ed.id);
  assert.strictEqual(ed.oficina, 'edificio');
  assert.deepStrictEqual((await api('/api/chats')).body.map(c => c.id), [ed.id]);
  assert.deepStrictEqual((await api('/api/chats?oficina=acme')).body.map(c => c.id), [acmeChat.id]);
  assert.strictEqual((await api('/api/memory/search?oficina=acme&q=secreto')).body.hits.length, 0);
  assert.ok((await api('/api/memory/search?q=secreto')).body.hits.length > 0, 'en el edificio sí está');
  assert.strictEqual((await api('/api/memory/search?q=autor')).body.hits.filter(h => /Lección del autor/.test(h.text || h.snippet || JSON.stringify(h))).length, 0);
  assert.deepStrictEqual((await api('/api/memory?oficina=acme')).body.map(f => f.name), ['lecciones.md']);
  const { body: list } = await api('/api/oficinas');
  assert.strictEqual(list.find(o => o.id === 'acme').misiones, 1);
});

test('llave de agente: solo su oficina, se guarda como hash y se puede revocar', async () => {
  const { status, body } = await api('/api/oficinas/acme/llaves', { method: 'POST', body: JSON.stringify({ nombre: 'asistente' }) });
  assert.strictEqual(status, 201);
  key = body.llave;
  assert.match(key, /^om_acme_/);
  assert.ok(!fs.readFileSync(path.join(home, 'oficinas', 'acme', 'oficina.json'), 'utf8').includes(key), 'solo el hash en disco');
  assert.strictEqual((await api('/api/oficinas')).body.find(o => o.id === 'acme').llaves[0].nombre, 'asistente');

  // Lo que sí puede: ver y crear misiones en Acme (aunque pida otra oficina), leer su cerebro.
  assert.deepStrictEqual((await api('/api/oficinas', {}, key)).body.map(o => o.id), ['acme']);
  assert.deepStrictEqual((await api('/api/chats?oficina=edificio', {}, key)).body.map(c => c.id), [acmeChat.id]);
  assert.strictEqual((await api(`/api/chats/${acmeChat.id}`, {}, key)).status, 200);
  assert.strictEqual((await api('/api/memory/search?oficina=edificio&q=secreto', {}, key)).body.hits.length, 0);
  const { status: st, body: made } = await api('/api/chats?oficina=edificio', { method: 'POST', body: JSON.stringify({ text: 'Investiga a fondo', config: { mode: 'rondas', maxRounds: 1, team: [{ id: 'revisor' }] } }) }, key);
  assert.strictEqual(st, 201);
  assert.strictEqual(made.oficina, 'acme', 'la llave manda: la misión nace en Acme');
  await waitIdle(made.id);

  // Lo que no: misiones de otra oficina, eventos del edificio, crear oficinas, abrir carpetas, llaves falsas.
  assert.strictEqual((await api(`/api/chats/${edificioChat.id}`, {}, key)).status, 403);
  assert.strictEqual((await api(`/raw/${edificioChat.id}/HANDOFF.md`, {}, key)).status, 403);
  assert.strictEqual((await api('/api/events', {}, key)).status, 403);
  assert.strictEqual((await api('/api/oficinas', { method: 'POST', body: JSON.stringify({ nombre: 'X' }) }, key)).status, 403);
  assert.strictEqual((await api(`/api/chats/${acmeChat.id}/open`, { method: 'POST', body: '{}' }, key)).status, 403);
  assert.strictEqual((await api(`/api/chats/${acmeChat.id}/accept`, { method: 'POST', body: '{}' }, key)).status, 403, 'la llave no acepta el entregable por el usuario');
  assert.strictEqual((await api('/api/memory/file?oficina=acme&name=lecciones.md', { method: 'PUT', body: JSON.stringify({ content: 'x' }) }, key)).status, 403);
  assert.strictEqual((await api('/api/chats', {}, key.slice(0, -2) + 'xx')).status, 401);

  assert.strictEqual((await api('/api/oficinas/acme/llaves/asistente', { method: 'DELETE' })).status, 200);
  assert.strictEqual((await api('/api/chats', {}, key)).status, 401, 'revocada');
});
