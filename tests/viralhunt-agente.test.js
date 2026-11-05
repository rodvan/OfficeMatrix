// La oficina como agente de ViralHunt (fase 6 de "pídele a tu agente", 2026-10-28). ViralHunt firma un POST a /bots/vh/<oficina>
// por la puerta pública (puerta-bots.js), el servidor verifica la llave acordada en el panel, contesta pong inline a un ping y
// corre un encargo con la CLI anfitriona; el JSON que esa CLI escribe llega a reply_to (aquí un ViralHunt simulado en
// 127.0.0.1:44xx, el único http que lib/viralhunt.js acepta). La llave nunca sale por la API: solo una vez, cuando se genera.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const { signedHeaders } = require('../lib/bots');
const { createGate } = require('../puerta-bots');
const { replyUrlOk, taskPrompt, parseTaskReply } = require('../lib/viralhunt');

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'officematrix-vh-agente-'));
const fake = path.join(__dirname, 'helpers', 'fake-agent.js');
fs.writeFileSync(path.join(home, 'agents.json'), JSON.stringify({
  agents: [{ id: 'cli', name: 'CLI', role: 'Redactor', color: '#fff', cmd: 'node', stream: 'text', args: [fake, 'cli', 'vh', 'text', '{prompt}'] }],
  maxRounds: 1, minScore: 9, turnTimeoutMinutes: 0.5, relatorMinutes: 0, idleTimeoutMinutes: 0,
}));
process.env.OFFICEMATRIX_HOME = home;
process.env.OFFICEMATRIX_CONFIG = path.join(home, 'agents.json');

// El ViralHunt simulado: recibe las respuestas de los encargos en /api/hooks/r/<token>.
const replies = [];
const vhSim = http.createServer((req, res) => {
  const chunks = [];
  req.on('data', c => chunks.push(c));
  req.on('end', () => {
    let body = null;
    try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch {}
    replies.push({ url: req.url, body });
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, status: 'done' }));
  });
});

const { server } = require('../server');
let base, gate, gateBase, vhBase;
const listen = s => new Promise(r => s.listen(0, '127.0.0.1', () => r(`http://127.0.0.1:${s.address().port}`)));
// El simulador tiene que vivir en 4400-4499 (la regla de lib/viralhunt.js): se prueba un puerto tras otro.
const listen44 = s => new Promise((ok, ko) => {
  const tryPort = p => {
    if (p > 4499) return ko(new Error('ningún puerto 44xx libre'));
    s.once('error', () => tryPort(p + 1));
    s.listen(p, '127.0.0.1', () => { s.removeAllListeners('error'); ok(`http://127.0.0.1:${p}`); });
  };
  tryPort(4470);
});
test.before(async () => {
  base = await listen(server);
  gate = createGate({ target: server.address().port });
  gateBase = await listen(gate);
  vhBase = await listen44(vhSim);
  process.env.OFFICEMATRIX_BOTS_URL = gateBase;            // la "URL pública del túnel" apunta a la puerta
  process.env.OFFICEMATRIX_VIRALHUNT_URL = `${vhBase}/`;   // y las respuestas pueden ir al simulador local
});
test.after(() => {
  for (const s of [server, gate, vhSim]) { s.close(); s.closeAllConnections?.(); }
  fs.rmSync(home, { recursive: true, force: true });
});

const api = async (url, opts = {}) => {
  const res = await fetch(base + url, { ...opts, headers: { 'Content-Type': 'application/json' } });
  return { status: res.status, body: await res.json().catch(() => null) };
};
const call = async (office, key, payload, headersOverride = null) => {
  const body = JSON.stringify(payload);
  const res = await fetch(`${gateBase}/bots/vh/${office}`, { method: 'POST', headers: headersOverride || signedHeaders(key, body), body });
  return { status: res.status, body: await res.json().catch(() => null) };
};
const until = async (fn, ms = 8000) => { for (let i = 0; i < ms / 50 && !fn(); i++) await new Promise(r => setTimeout(r, 50)); return fn(); };

let KEY = null;

test('la llave de agente: se genera y se enseña una sola vez, no vuelve a salir por la API, queda en el archivo secreto', async () => {
  assert.strictEqual((await api('/api/oficinas', { method: 'POST', body: JSON.stringify({ nombre: 'Agencia' }) })).status, 201);
  const r = await api('/api/oficinas/agencia/viralhunt/agente', { method: 'POST', body: '{}' });
  assert.strictEqual(r.status, 200);
  assert.match(r.body.llave, /^whsec_[A-Za-z0-9+/=]{40,}$/);
  assert.deepStrictEqual(r.body.agente, { configurado: true, firma: 'standard-webhooks' });
  assert.strictEqual(r.body.url, `${gateBase}/bots/vh/agencia`, 'la URL que se pega en ViralHunt sale de la URL pública de la puerta');
  assert.strictEqual(r.body.configurado, false, 'el token de salida sigue sin configurar: son dos cosas');
  KEY = r.body.llave;
  const again = await api('/api/oficinas/agencia/viralhunt/agente');
  assert.strictEqual(again.body.agente.configurado, true);
  assert.ok(!('llave' in again.body), 'la llave no vuelve a salir');
  const everything = JSON.stringify([(await api('/api/oficinas')).body, (await api('/api/oficinas/agencia/viralhunt')).body, again.body]);
  assert.ok(!everything.includes(KEY), 'ningún secreto sale por la API');
  assert.ok(fs.readFileSync(path.join(home, 'oficinas', 'agencia', 'viralhunt.secreto.json'), 'utf8').includes(KEY), 'el secreto queda en su archivo aparte');
  assert.strictEqual((await api('/api/oficinas/agencia/viralhunt/agente', { method: 'POST', body: JSON.stringify({ llave: 'corta' }) })).status, 400, 'una llave de juguete se rechaza');
});

test('ping firmado por la puerta: pong en la misma respuesta; firma ajena 401; oficina desconocida 404; otro type 200 y nada', async () => {
  const ping = { type: 'ping', source: 'viralhunt', version: 1, reply_to: 'https://viralhunt.io/tool/api/hooks/r/' + 'a'.repeat(43) };
  const ok = await call('agencia', KEY, ping);
  assert.strictEqual(ok.status, 200);
  assert.deepStrictEqual(ok.body, { text: 'pong' });
  const bad = await call('agencia', `whsec_${crypto.randomBytes(32).toString('base64')}`, ping);
  assert.strictEqual(bad.status, 401);
  assert.ok(!JSON.stringify(bad.body).includes(KEY));
  assert.strictEqual((await call('fantasma', KEY, ping)).status, 404);
  const other = await call('agencia', KEY, { type: 'review_request', source: 'viralhunt' });
  assert.strictEqual(other.status, 200);
  assert.deepStrictEqual(other.body, { ok: true });
});

test('un encargo: se acepta al momento, la CLI anfitriona contesta el JSON del contrato y llega a reply_to; el chat lo registra', async () => {
  const token = crypto.randomBytes(32).toString('base64url');
  const task = {
    type: 'task', source: 'viralhunt', version: 1,
    task: { id: 12, surface: 'post', prompt: 'Acorta para X y Bluesky', requested_by: { id: 5, name: 'Ana' } },
    connection: { id: 3, name: 'Agencia', capabilities: ['text', 'review'] },
    organization: { id: 1, name: 'Cerebro Digital' },
    context: {
      post: { body: 'Un texto largo sobre el cerebro…', first_comment: '', author_notes: 'fuente: nature.com', kind: 'fact', media: [], thread: [],
              accounts: [{ id: 7, network: 'twitter', name: '@cerebro', selected: true, text_limit: 280, has_own_copy: false }, { id: 9, network: 'bluesky', name: 'cerebro.bsky.social', selected: true, text_limit: 300, has_own_copy: false }],
              overrides: {} },
      project: { id: 2, name: 'Cerebro Digital', lang: 'es', voice: 'Directo, sin exclamaciones.' },
      limits: { twitter: { text: 280 }, bluesky: { text: 300 } },
    },
    reply_schema: { how: '…' },
    reply_to: `${vhBase}/api/hooks/r/${token}`,
    expires_at: new Date(Date.now() + 900e3).toISOString(), sent_at: new Date().toISOString(),
  };
  const r = await call('agencia', KEY, task);
  assert.strictEqual(r.status, 202);
  assert.deepStrictEqual(r.body, { ok: true, status: 'working' });
  assert.ok(await until(() => replies.length > 0), 'la respuesta llegó a reply_to');
  const got = replies[0];
  assert.strictEqual(got.url, `/api/hooks/r/${token}`);
  assert.strictEqual(got.body.text, 'vh:cli:ok');
  assert.strictEqual(got.body.fields.body, 'ACORTADO');
  assert.deepStrictEqual(Object.keys(got.body.fields.overrides).sort(), ['7', '9'], 'una copia por cuenta que el prompt enumeró');
  assert.strictEqual(got.body.warnings[0].code, 'fix_source');
  // el pedido y la respuesta quedan en el chat de la oficina, sin la llave
  const chat = fs.readFileSync(path.join(home, 'oficinas', 'agencia', 'chat', 'mensajes.jsonl'), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
  assert.strictEqual(chat.length, 2);
  assert.match(chat[0].texto, /Acorta para X y Bluesky/);
  assert.strictEqual(chat[0].autor.nombre, 'Ana · ViralHunt');
  assert.strictEqual(chat[1].autor.id, 'cli');
  assert.strictEqual(chat[1].texto, 'vh:cli:ok');
  assert.ok(!JSON.stringify(chat).includes(KEY));
});

test('un reply_to que no es la puerta de ViralHunt se rechaza antes de trabajar', async () => {
  const r2 = await call('agencia', KEY, { type: 'task', task: { id: 14, prompt: 'x' }, context: {}, reply_to: 'http://evil.example/x' });
  assert.strictEqual(r2.status, 400);
  assert.strictEqual((await call('agencia', KEY, { type: 'task', task: { id: 15, prompt: 'x' }, context: {} })).status, 400, 'sin reply_to no hay a quién contestar');
});

test('una llave Bearer (no whsec_) viaja como Authorization y también verifica; quitar la llave cierra la puerta', async () => {
  const bearer = `vh_${crypto.randomBytes(16).toString('hex')}`;
  const r = await api('/api/oficinas/agencia/viralhunt/agente', { method: 'POST', body: JSON.stringify({ llave: bearer }) });
  assert.deepStrictEqual(r.body.agente, { configurado: true, firma: 'bearer' });
  assert.ok(!('llave' in r.body), 'una llave pegada no se repite');
  const ping = { type: 'ping' };
  assert.deepStrictEqual((await call('agencia', bearer, ping)).body, { text: 'pong' });
  assert.strictEqual((await call('agencia', KEY, ping)).status, 401, 'la llave anterior ya no vale');
  assert.strictEqual((await api('/api/oficinas/agencia/viralhunt/agente', { method: 'DELETE' })).body.agente.configurado, false);
  assert.strictEqual((await call('agencia', bearer, ping)).status, 401);
});

test('puras: replyUrlOk, parseTaskReply y taskPrompt', () => {
  assert.ok(replyUrlOk('https://viralhunt.io/tool_dev/api/hooks/r/' + 'c'.repeat(43), {}));
  assert.ok(replyUrlOk('https://other.example/api/hooks/r/' + 'c'.repeat(43), {}), 'otro dominio con la forma de la puerta: ViralHunt puede vivir ahí; la firma ya probó quién llama');
  assert.ok(!replyUrlOk('https://viralhunt.io/tool_dev/api/hooks/r/short', {}));
  assert.ok(!replyUrlOk('http://127.0.0.1:4477/api/hooks/r/' + 'c'.repeat(43), {}), 'el simulador solo con la variable de entorno');
  assert.ok(replyUrlOk('http://127.0.0.1:4477/api/hooks/r/' + 'c'.repeat(43), { OFFICEMATRIX_VIRALHUNT_URL: 'http://127.0.0.1:4477/' }));
  assert.ok(!replyUrlOk('http://127.0.0.1:4321/api/hooks/r/' + 'c'.repeat(43), { OFFICEMATRIX_VIRALHUNT_URL: 'http://127.0.0.1:4477/' }), 'nunca la app');
  const p = parseTaskReply('Listo, lo acorté.\n```json\n{"fields":{"body":"corto"}}\n```');
  assert.deepStrictEqual(p, { fields: { body: 'corto' }, text: 'Listo, lo acorté.' });
  assert.deepStrictEqual(parseTaskReply('Sin JSON, solo una frase.'), { text: 'Sin JSON, solo una frase.' });
  assert.strictEqual(parseTaskReply(''), null);
  assert.deepStrictEqual(parseTaskReply('{"text":"a","warnings":[]} y un comentario'), { text: 'a', warnings: [] });
  const prompt = taskPrompt({ task: { prompt: 'Acorta', requested_by: { name: 'Ana' } }, organization: { name: 'Org' }, context: { post: { body: 'b', accounts: [{ id: 7, network: 'twitter', name: 'x', selected: true, text_limit: 280 }] }, project: { name: 'P', lang: 'es', voice: 'Directo.' } } }, { nombre: 'Claude' });
  for (const s of ['You are Claude', 'THE REQUEST: Acorta', 'BRAND VOICE', 'Directo.', '7: twitter «x» (selected), text_limit 280', 'ONE JSON OBJECT ONLY', 'Read-only']) assert.ok(prompt.includes(s), s);
});
