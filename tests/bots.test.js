// Grok Bots externos por webhook: un "Grok Bot" falso (servidor local) recibe el turno firmado, lo verifica y responde a
// "responder_a" pasando por la puerta pública (puerta-bots.js), como hará el bot real a través del túnel de Cloudflare.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const { verifyStandard, createBots } = require('../lib/bots');
const { createGate } = require('../puerta-bots');

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'officematrix-bots-'));
const fake = path.join(__dirname, 'helpers', 'fake-agent.js');
fs.writeFileSync(path.join(home, 'agents.json'), JSON.stringify({
  agents: [{ id: 'cli', name: 'CLI', role: 'Probador', color: '#fff', cmd: 'node', stream: 'text', args: [fake, 'cli', 'ok', 'text', '{prompt}'] }],
  maxRounds: 1, minScore: 9, turnTimeoutMinutes: 0.03, relatorMinutes: 0, idleTimeoutMinutes: 0, // 1,8 s: el bot mudo caduca rápido
}));
process.env.OFFICEMATRIX_HOME = home;
process.env.OFFICEMATRIX_CONFIG = path.join(home, 'agents.json');

const WHSEC = `whsec_${crypto.randomBytes(24).toString('base64')}`;
const BEARER = `crsr_${crypto.randomBytes(16).toString('hex')}`;
const REPLY = 'Revisé el pedido y el trabajo: está bien.\nOBJECIONES:\n- ninguna\nRESPUESTAS:\n- ninguna\nNOTA: 9/10\nVEREDICTO: APROBADO';

// El "Grok Bot" falso: /std verifica Standard Webhooks, /bearer la llave Bearer, /mudo acepta y nunca responde.
const received = [];
const grok = http.createServer((req, res) => {
  const chunks = [];
  req.on('data', c => chunks.push(c));
  req.on('end', () => {
    const body = Buffer.concat(chunks).toString('utf8');
    const ok = req.url === '/std' ? verifyStandard(WHSEC, req.headers, body)
      : req.url === '/bearer' ? req.headers.authorization === `Bearer ${BEARER}` : req.url === '/mudo';
    received.push({ url: req.url, ok, body: JSON.parse(body) });
    if (!ok) { res.writeHead(401); return res.end(); }
    res.writeHead(202); res.end();
    if (req.url === '/mudo') return;
    const p = JSON.parse(body);
    const texto = p.tipo === 'ping' ? 'pong' : REPLY;
    setTimeout(() => fetch(p.responder_a, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ texto }) }).catch(() => {}), 50);
  });
});

const { server, running } = require('../server');
let base, gate, gateBase, grokBase;
const listen = s => new Promise(r => s.listen(0, '127.0.0.1', () => r(`http://127.0.0.1:${s.address().port}`)));
test.before(async () => {
  base = await listen(server);
  gate = createGate({ target: server.address().port });
  gateBase = await listen(gate);
  grokBase = await listen(grok);
  process.env.OFFICEMATRIX_BOTS_URL = gateBase; // la "URL pública del túnel" apunta a la puerta
});
test.after(() => {
  for (const s of [server, gate, grok]) { s.close(); s.closeAllConnections?.(); }
  fs.rmSync(home, { recursive: true, force: true });
});

const api = async (url, opts = {}, key) => {
  const res = await fetch(base + url, { ...opts, headers: { 'Content-Type': 'application/json', ...(key ? { Authorization: `Bearer ${key}` } : {}) } });
  return { status: res.status, body: await res.json().catch(() => null) };
};
const waitIdle = async id => { for (let i = 0; i < 300 && running.has(id); i++) await new Promise(r => setTimeout(r, 100)); };

test('añadir bots: la API nunca devuelve la URL ni la llave', async () => {
  assert.strictEqual((await api('/api/oficinas', { method: 'POST', body: JSON.stringify({ nombre: 'Grokeros' }) })).status, 201);
  const a = await api('/api/oficinas/grokeros/bots', { method: 'POST', body: JSON.stringify({ nombre: 'Radar', avatar: 'piloto', url: `${grokBase}/std`, llave: WHSEC }) });
  assert.strictEqual(a.status, 201);
  assert.strictEqual(a.body.firma, 'standard-webhooks');
  await api('/api/oficinas/grokeros/bots', { method: 'POST', body: JSON.stringify({ nombre: 'Crítico', url: `${grokBase}/bearer`, llave: BEARER }) });
  assert.strictEqual((await api('/api/oficinas/grokeros/bots', { method: 'POST', body: JSON.stringify({ nombre: 'X', url: 'http://ejemplo.com/hook', llave: 'k' }) })).status, 400, 'http solo hacia este PC');
  const everything = JSON.stringify([(await api('/api/oficinas/grokeros/bots')).body, (await api('/api/oficinas')).body, (await api('/api/agents?oficina=grokeros')).body]);
  for (const secret of [WHSEC, BEARER, `${grokBase}/std`]) assert.ok(!everything.includes(secret), 'ningún secreto sale por la API');
  assert.ok(fs.readFileSync(path.join(home, 'oficinas', 'grokeros', 'bots.secreto.json'), 'utf8').includes(WHSEC), 'el secreto queda en su archivo aparte');
  const agents = (await api('/api/agents?oficina=grokeros')).body.agents;
  assert.deepStrictEqual(agents.filter(x => x.bot).map(x => x.id), ['bot-radar', 'bot-critico']);
});

test('ping de ida y vuelta (firma Bearer) por la puerta pública', async () => {
  const r = await api('/api/oficinas/grokeros/bots/critico/probar', { method: 'POST', body: '{}' });
  assert.strictEqual(r.body.enviado, true);
  assert.strictEqual(r.body.status, 202);
  assert.strictEqual(r.body.error, null);
  assert.strictEqual(r.body.texto, 'pong');
  assert.strictEqual(r.body.pong, true);
  assert.ok(r.body.ms >= 0 && r.body.ms < 10000);
  for (let i = 0; i < 50 && !(await api('/api/oficinas/grokeros/bots')).body.find(b => b.id === 'critico').ultimaRespuesta; i++) await new Promise(r => setTimeout(r, 50));
  assert.ok((await api('/api/oficinas/grokeros/bots')).body.find(b => b.id === 'critico').ultimaRespuesta, 'el bot respondió');
  assert.ok(received.some(x => x.url === '/bearer' && x.ok && x.body.tipo === 'ping'));
});

test('un ciclo de relevo con una CLI y un Grok Bot: el turno del bot queda registrado y su aporte en aportes/', async () => {
  const { body: chat } = await api('/api/chats?oficina=grokeros', { method: 'POST', body: JSON.stringify({ text: 'Escribe un hook viral', config: { mode: 'rondas', maxRounds: 1, team: [{ id: 'cli' }, { id: 'bot-radar' }] } }) });
  await waitIdle(chat.id);
  const { body: d } = await api(`/api/chats/${chat.id}`);
  const turns = d.messages.filter(m => m.kind === 'agent');
  assert.deepStrictEqual(turns.map(t => `${t.agentId}:${t.verdict}:${t.score}`), ['cli:APROBADO:9', 'bot-radar:APROBADO:9']);
  const sent = received.find(x => x.url === '/std' && x.body.tipo === 'turno');
  assert.ok(sent.ok, 'la firma Standard Webhooks se verificó');
  assert.match(sent.body.brief, /Escribe un hook viral/);
  assert.ok(sent.body.archivos.some(f => f.ruta === 'HANDOFF.md'), 'el bot recibe el texto de los archivos citados');
  assert.match(sent.body.responder_a, /\/bots\/r\/[A-Za-z0-9_-]{40,}$/);
  const aporte = path.join(home, 'oficinas', 'grokeros', 'proyectos', chat.id, 'aportes', 'radar-relevo-1.md');
  assert.match(fs.readFileSync(aporte, 'utf8'), /NOTA: 9\/10/);
  assert.ok(/Unanimous approval|everyone approved/i.test(d.messages.filter(m => m.kind === 'system').map(m => m.text).join('\n')), 'el ciclo cierra con el bot dentro');
});

test('tokens: un solo uso (410), caducan (410), uno falso da 404', async () => {
  const b = createBots(home, require('../lib/oficinas').createRegistry(home));
  const t = b.openTurn({ x: 1 }, 60000);
  assert.strictEqual(b.deliver(t.token, { texto: 'a' }).status, 200);
  assert.strictEqual(b.deliver(t.token, { texto: 'b' }).status, 410);
  const short = b.openTurn({}, 30);
  await new Promise(r => setTimeout(r, 80));
  assert.strictEqual(b.deliver(short.token, { texto: 'tarde' }).status, 410);
  assert.strictEqual(b.deliver('x'.repeat(43), {}).status, 404);
  // Por HTTP a través de la puerta: un token que nadie emitió.
  assert.strictEqual((await fetch(`${gateBase}/bots/r/${'y'.repeat(43)}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"texto":"hola"}' })).status, 404);
});

test('un bot que no responde: SIN RESPUESTA DEL BOT y el ciclo no se cuelga', async () => {
  await api('/api/oficinas/grokeros/bots', { method: 'POST', body: JSON.stringify({ nombre: 'Mudo', url: `${grokBase}/mudo`, llave: 'k-mudo' }) });
  const { body: chat } = await api('/api/chats?oficina=grokeros', { method: 'POST', body: JSON.stringify({ text: 'Algo', config: { mode: 'rondas', maxRounds: 1, team: [{ id: 'bot-mudo' }] } }) });
  await waitIdle(chat.id);
  assert.ok(!running.has(chat.id), 'el ciclo terminó');
  const { body: d } = await api(`/api/chats/${chat.id}`);
  const t = d.messages.find(m => m.kind === 'agent');
  assert.strictEqual(t.verdict, 'ERROR');
  assert.strictEqual(t.failure.label, 'NO REPLY FROM THE BOT');
});

test('la puerta: /bots/health, /bots/r y /bots/o; el resto 404; llave mala 401; un bot con llave crea una misión en SU oficina', async () => {
  const health = await fetch(gateBase + '/bots/health');
  assert.strictEqual(health.status, 200);
  assert.deepStrictEqual(await health.json(), { ok: true, servicio: 'officematrix-bots' });
  for (const [method, p] of [['GET', '/'], ['POST', '/api/chats'], ['GET', '/raw/x/HANDOFF.md'], ['GET', '/bots/r/' + 'z'.repeat(43)], ['POST', '/index.html'], ['GET', '/bots/health/extra'], ['POST', '/bots/health']]) {
    assert.strictEqual((await fetch(gateBase + p, { method, headers: { 'content-type': 'application/json' }, ...(method === 'POST' ? { body: '{}' } : {}) })).status, 404, `${method} ${p}`);
  }
  const post = (p, body) => fetch(gateBase + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  assert.strictEqual((await post('/bots/o/grokeros/om_grokeros_llaveinventada123', { texto: 'hola' })).status, 401);
  assert.strictEqual((await fetch(`${gateBase}/bots/r/${'q'.repeat(43)}`, { method: 'POST', headers: { 'content-type': 'image/png' }, body: 'x' })).status, 415);
  const { body: k } = await api('/api/oficinas/grokeros/llaves', { method: 'POST', body: JSON.stringify({ nombre: 'radar' }) });
  const r = await post(`/bots/o/grokeros/${k.llave}`, { texto: 'Investiga tendencias de IA', config: { mode: 'rondas', maxRounds: 1, team: [{ id: 'cli' }] } });
  assert.strictEqual(r.status, 201);
  const { id } = await r.json();
  assert.strictEqual((await api(`/api/chats/${id}`)).body.oficina, 'grokeros');
  await waitIdle(id);
  // La llave de agente no da acceso a la configuración de los bots.
  assert.strictEqual((await api('/api/oficinas/grokeros/bots', {}, k.llave)).status, 403);
});
