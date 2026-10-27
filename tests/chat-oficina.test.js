// Chat de oficina y asistente de Grok Bots: menciones, anfitrión, bot que no contesta, CLI de solo lectura
// y llaves que no salen del archivo secreto. El bot y la CLI son falsos; la puerta escucha en un puerto 47xxx.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const { redact, recipients, readOnlyArgs } = require('../lib/chat-oficina');
const { verifyStandard } = require('../lib/bots');

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'om-office-chat-'));
const fake = path.join(__dirname, 'helpers', 'fake-agent.js');
fs.writeFileSync(path.join(home, 'agents.json'), JSON.stringify({
  agents: [
    { id: 'cli', name: 'Grok', role: 'Lead', color: '#c062d6', avatar: 'capitana', cmd: 'node', stream: 'text', args: [fake, 'cli', 'chat', 'text', '{prompt}'] },
    { id: 'sj', name: 'Stream', role: 'Audit', color: '#d0704f', avatar: 'sabia', cmd: 'node', stream: 'claude', args: [fake, 'sj', 'chat', 'claude', '{prompt}'] },
    { id: 'kimi', name: 'Kimi', role: 'Dev', color: '#3b6cff', cmd: 'node', stream: 'kimi', args: [fake, 'kimi', 'chat', 'text', '{prompt}'] },
  ],
  maxRounds: 1, minScore: 9, turnTimeoutMinutes: 0.05,
}));
process.env.OFFICEMATRIX_HOME = home;
process.env.OFFICEMATRIX_CONFIG = path.join(home, 'agents.json');
process.env.OFFICEMATRIX_CHAT_BOT_MS = '500';
process.env.OFFICEMATRIX_CHAT_CLI_MS = '8000';
process.env.OFFICEMATRIX_LANG = 'en';

const KEY = `whsec_${crypto.randomBytes(24).toString('base64')}`;
const MUDO = 'crsr_' + 'mudo'.repeat(4);
const received = [];
const grok = http.createServer((req, res) => {
  const chunks = [];
  req.on('data', c => chunks.push(c));
  req.on('end', () => {
    const body = Buffer.concat(chunks).toString('utf8');
    const p = JSON.parse(body || '{}');
    const ok = req.url === '/mudo' ? req.headers.authorization === `Bearer ${MUDO}` : verifyStandard(KEY, req.headers, body);
    received.push({ url: req.url, ok, body: p });
    if (!ok) { res.writeHead(401); return res.end(); }
    res.writeHead(202); res.end();
    if (req.url === '/mudo') return;
    const texto = p.tipo === 'ping' ? 'pong' : `desde-el-bot:${(p.historial || []).map(h => h.texto).join('|')}`;
    setTimeout(() => fetch(p.responder_a, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ texto }) }).catch(() => {}), 20);
  });
});

const { server } = require('../server');
const { createGate } = require('../puerta-bots');
let base, gate, gatePort, grokBase, startedPid = null;
const listen = (s, port = 0) => new Promise(r => s.listen(port, '127.0.0.1', () => r(s.address().port)));

test.before(async () => {
  base = `http://127.0.0.1:${await listen(server)}`;
  grokBase = `http://127.0.0.1:${await listen(grok)}`;
  gate = createGate({ target: server.address().port });
  gatePort = await listen(gate);
  process.env.BOTS_PORT = String(gatePort);
  process.env.OFFICEMATRIX_BOTS_URL = `http://127.0.0.1:${gatePort}`;
});
test.after(() => {
  if (startedPid) killPid(startedPid);
  for (const s of [server, gate, grok]) { try { s.close(); s.closeAllConnections?.(); } catch { /* ya cerrado */ } }
  fs.rmSync(home, { recursive: true, force: true });
});

const api = async (url, opts = {}, key) => {
  const res = await fetch(base + url, { ...opts, headers: { 'Content-Type': 'application/json', ...(key ? { Authorization: `Bearer ${key}` } : {}) } });
  return { status: res.status, body: await res.json().catch(() => null) };
};
const killPid = pid => {
  if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore' });
  else { try { process.kill(pid); } catch { /* ya no está */ } }
};
function filesUnder(dir) {
  const out = [];
  const walk = d => {
    for (const name of fs.readdirSync(d)) {
      const p = path.join(d, name);
      const st = fs.statSync(p);
      if (st.isDirectory()) walk(p);
      else out.push(p);
    }
  };
  walk(dir);
  return out;
}

test('menciones: cero sin anfitrión, una, dos en orden, y el anfitrión si no hay @', async () => {
  assert.strictEqual((await api('/api/oficinas', { method: 'POST', body: JSON.stringify({ nombre: 'Sala' }) })).status, 201);
  await api('/api/oficinas', { method: 'POST', body: JSON.stringify({ nombre: 'Otra' }) });
  fs.mkdirSync(path.join(home, 'oficinas', 'sala', 'memoria'), { recursive: true });
  fs.writeFileSync(path.join(home, 'oficinas', 'sala', 'memoria', 'notas.md'), 'MEMTOKEN the office remembers this');
  fs.writeFileSync(path.join(home, 'oficinas', 'sala', 'canary.txt'), 'canary');
  const add = await api('/api/oficinas/sala/bots', { method: 'POST', body: JSON.stringify({ nombre: 'Radar', puesto: 'Research', avatar: 'piloto', color: '#c062d6', url: `${grokBase}/hook`, llave: KEY }) });
  assert.strictEqual(add.status, 201);
  assert.strictEqual(add.body.puesto, 'Research');
  assert.ok(!JSON.stringify(add.body).includes(KEY));

  const wizard = await api('/api/oficinas/sala/bots/asistente');
  assert.deepStrictEqual(wizard.body.comprobaciones.map(c => `${c.id}:${c.ok}`), ['puerta:true', 'tunel:true']);
  assert.match(wizard.body.bloques.instruccion, /tipo is chat/);
  assert.match(wizard.body.bloques.instruccion, /tipo is ping/);
  assert.match(wizard.body.bloques.json, /"tipo": "chat"/);
  assert.ok(!JSON.stringify(wizard.body).includes(KEY));

  // Kimi con -p aprueba sola sus herramientas: no entra al chat, que es de solo lectura.
  const sala = await api('/api/oficinas/sala/chat');
  assert.ok(!sala.body.miembros.some(m => m.id === 'kimi'));
  assert.ok(sala.body.miembros.some(m => m.id === 'sj'));

  const none = await api('/api/oficinas/sala/chat', { method: 'POST', body: JSON.stringify({ texto: 'hola sin mencion' }) });
  assert.strictEqual(none.status, 200);
  assert.deepStrictEqual(none.body.mensajes.map(m => m.autor.tipo), ['owner', 'system']);
  assert.match(none.body.mensajes[1].texto, /no chat host/);
  assert.strictEqual(received.length, 0, 'sin mención y sin anfitrión no se llama a nadie');

  assert.strictEqual((await api('/api/oficinas/sala/chat', { method: 'PUT', body: JSON.stringify({ anfitrion: 'cli' }) })).status, 200);
  const hosted = await api('/api/oficinas/sala/chat', { method: 'POST', body: JSON.stringify({ texto: 'solo el anfitrion' }) });
  assert.deepStrictEqual(hosted.body.mensajes.map(m => m.autor.tipo), ['owner', 'cli']);
  assert.match(hosted.body.mensajes[1].texto, /MEMTOKEN/, 'la CLI ve la memoria de la oficina');
  assert.strictEqual(received.length, 0, 'el anfitrión CLI no despierta al bot');

  const one = await api('/api/oficinas/sala/chat', { method: 'POST', body: JSON.stringify({ texto: '@radar una sola' }) });
  assert.deepStrictEqual(one.body.mensajes.map(m => m.autor.id), ['owner', 'radar']);
  assert.match(one.body.mensajes[1].texto, /^desde-el-bot:/);
  assert.strictEqual(received.at(-1).body.tipo, 'chat');

  const two = await api('/api/oficinas/sala/chat', { method: 'POST', body: JSON.stringify({ texto: '@radar @grok los dos' }) });
  assert.deepStrictEqual(two.body.mensajes.map(m => m.autor.id), ['owner', 'radar', 'cli']);
  assert.match(two.body.mensajes[2].texto, /desde-el-bot:/, 'la CLI ve la respuesta anterior del bot');
  assert.strictEqual(fs.readFileSync(path.join(home, 'oficinas', 'sala', 'canary.txt'), 'utf8'), 'canary');
  assert.ok(!filesUnder(path.join(home, 'oficinas', 'sala')).some(p => p.includes('intento-de-escritura')), 'el turno de chat no escribe en la oficina');
});

test('un bot que no contesta no bloquea al siguiente ni al chat', async () => {
  await api('/api/oficinas/sala/bots', { method: 'POST', body: JSON.stringify({ nombre: 'Mudo', url: `${grokBase}/mudo`, llave: MUDO }) });
  const r = await api('/api/oficinas/sala/chat', { method: 'POST', body: JSON.stringify({ texto: '@mudo @grok seguid' }) });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.body.mensajes[1].autor.id, 'mudo');
  assert.strictEqual(r.body.mensajes[1].fallo.kind, 'bot-sin-respuesta');
  assert.strictEqual(r.body.mensajes[2].autor.id, 'cli');
  assert.ok(!r.body.mensajes[2].fallo, 'la CLI contestó después del silencio');
  const again = await api('/api/oficinas/sala/chat', { method: 'POST', body: JSON.stringify({ texto: '@grok otra vez' }) });
  assert.strictEqual(again.status, 200);
  assert.strictEqual(again.body.mensajes.at(-1).autor.id, 'cli');
});

test('una CLI con stream-json contesta con su texto, no con el JSON crudo', async () => {
  const r = await api('/api/oficinas/sala/chat', { method: 'POST', body: JSON.stringify({ texto: '@stream hola' }) });
  const reply = r.body.mensajes.at(-1);
  assert.strictEqual(reply.autor.id, 'sj');
  assert.ok(!reply.fallo, JSON.stringify(reply.fallo));
  assert.match(reply.texto, /^chat:sj:mem:/);
  assert.ok(!/"type"\s*:/.test(reply.texto), 'el chat no muestra las líneas stream-json');
});

test('la llave no aparece en el chat, en la API ni en la interfaz', async () => {
  const hook = `${grokBase}/hook`;
  const r = await api('/api/oficinas/sala/chat', { method: 'POST', body: JSON.stringify({ texto: `mi llave es ${KEY} y la url ${hook}` }) });
  const packed = JSON.stringify(r.body) + fs.readFileSync(path.join(home, 'oficinas', 'sala', 'chat', 'mensajes.jsonl'), 'utf8');
  assert.ok(!packed.includes(KEY));
  assert.ok(!packed.includes(hook));
  assert.match(packed, /whsec_••••/);
  const leaked = received.filter(x => JSON.stringify(x.body).includes(KEY) || JSON.stringify(x.body).includes(hook));
  assert.strictEqual(leaked.length, 0, 'el webhook del bot tampoco recibe la llave');
  const listed = JSON.stringify((await api('/api/oficinas/sala/bots')).body) + JSON.stringify((await api('/api/oficinas/sala/chat')).body);
  assert.ok(!listed.includes(KEY) && !listed.includes(MUDO));
  const page = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8') + fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
  assert.ok(!page.includes(KEY));
  const secrets = filesUnder(home).filter(p => !p.endsWith('bots.secreto.json'));
  for (const file of secrets) assert.ok(!fs.readFileSync(file, 'utf8').includes(KEY), file);
});

test('copiar un bot a otra oficina no copia la llave salvo confirmación explícita', async () => {
  const plain = await api('/api/oficinas/sala/bots/radar/copiar', { method: 'POST', body: JSON.stringify({ destino: 'otra', incluirLlave: false }) });
  assert.strictEqual(plain.status, 201);
  assert.strictEqual(plain.body.sinLlave, true);
  assert.strictEqual(plain.body.llaveCopiada, false);
  assert.ok(!JSON.stringify(plain.body).includes(KEY));
  assert.ok(!fs.existsSync(path.join(home, 'oficinas', 'otra', 'bots.secreto.json')));
  const withKey = await api('/api/oficinas/sala/bots/radar/copiar', { method: 'POST', body: JSON.stringify({ destino: 'otra', incluirLlave: true }) });
  assert.strictEqual(withKey.body.llaveCopiada, true);
  assert.ok(!JSON.stringify(withKey.body).includes(KEY));
  assert.ok(fs.readFileSync(path.join(home, 'oficinas', 'otra', 'bots.secreto.json'), 'utf8').includes(KEY));
  assert.strictEqual((await api('/api/oficinas/sala/bots/radar/copiar', { method: 'POST', body: JSON.stringify({ destino: 'otra', incluirLlave: 'true' }) })).body.llaveCopiada, false, 'una cadena no es una confirmación');
});

test('convertir el chat en misión deja el texto listo y no lanza el ciclo', async () => {
  const before = (await api('/api/chats?oficina=sala')).body.length;
  const chat = await api('/api/oficinas/sala/chat');
  const ids = chat.body.mensajes.filter(m => m.autor.tipo === 'owner').slice(0, 2).map(m => m.id);
  const draft = await api('/api/oficinas/sala/chat/mision', { method: 'POST', body: JSON.stringify({ ids }) });
  assert.strictEqual(draft.status, 200);
  assert.match(draft.body.texto, /From the office chat/);
  assert.ok(ids.length >= 1);
  assert.strictEqual((await api('/api/chats?oficina=sala')).body.length, before);
});

test('el edificio no tiene chat y una llave de agente no lee el de la oficina', async () => {
  assert.strictEqual((await api('/api/oficinas/edificio/chat')).status, 404);
  const key = (await api('/api/oficinas/sala/llaves', { method: 'POST', body: JSON.stringify({ nombre: 'externo' }) })).body.llave;
  assert.strictEqual((await api('/api/oficinas/sala/chat', {}, key)).status, 403);
  assert.strictEqual((await api('/api/oficinas/sala/bots/asistente', {}, key)).status, 403);
});

test('arrancar la puerta no pide administrador y no duplica una que ya escucha', async () => {
  const already = await api('/api/bots/puerta', { method: 'POST', body: '{}' });
  assert.strictEqual(already.body.ok, true);
  assert.strictEqual(already.body.already, true);
  const probe = http.createServer();
  const port = await new Promise(r => probe.listen(0, '127.0.0.1', () => r(probe.address().port)));
  await new Promise(r => probe.close(r));
  const prev = process.env.BOTS_PORT;
  process.env.BOTS_PORT = String(port);
  try {
    const started = await api('/api/bots/puerta', { method: 'POST', body: '{}' });
    assert.strictEqual(started.body.ok, true, started.body.error);
    startedPid = started.body.pid;
    const health = await fetch(`http://127.0.0.1:${port}/bots/health`);
    assert.strictEqual(health.status, 200);
  } finally {
    if (startedPid) killPid(startedPid);
    startedPid = null;
    process.env.BOTS_PORT = prev;
  }
});

test('un turno de chat de CLI no lleva flags de escritura', () => {
  const ejemplo = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'agents.example.json'), 'utf8')).agents;
  const argv = id => { const a = ejemplo.find(x => x.id === id); return readOnlyArgs(a.stream, a.args); };
  const claude = argv('claude');
  assert.ok(!claude.includes('acceptEdits') && !claude.includes('--allowedTools'), claude.join(' '));
  assert.match(claude[claude.indexOf('--disallowedTools') + 1], /Write.*Edit.*Bash/);
  assert.strictEqual(claude[claude.indexOf('--permission-mode') + 1], 'plan');
  assert.strictEqual(claude.filter(a => a === '--permission-mode').length, 1);
  assert.ok(claude.includes('{prompt}') && claude.includes('stream-json'));
  const codex = argv('codex');
  assert.strictEqual(codex[0], 'exec');
  assert.ok(!codex.includes('workspace-write'), codex.join(' '));
  assert.strictEqual(codex[codex.indexOf('--sandbox') + 1], 'read-only');
  assert.ok(!argv('grok').includes('--always-approve'));
  assert.ok(!argv('gemini').includes('--dangerously-skip-permissions'));
  assert.deepStrictEqual(readOnlyArgs('codex', ['exec', '--sandbox=danger-full-access', 'x']), ['exec', 'x', '--sandbox', 'read-only']);
  assert.deepStrictEqual(readOnlyArgs('text', ['a', '--b']), ['a', '--b'], 'un stream desconocido no se toca');
});

test('redact y destinatarios, sin servidor', () => {
  const members = [
    { id: 'cli', sceneId: 'cli', nombre: 'Grok', mencion: 'grok' },
    { id: 'radar', sceneId: 'bot-radar', nombre: 'Radar', mencion: 'radar' },
  ];
  assert.deepStrictEqual(recipients('hola', members, null).quienes.map(m => m.id), []);
  assert.deepStrictEqual(recipients('hola', members, 'cli').quienes.map(m => m.id), ['cli']);
  assert.deepStrictEqual(recipients('@radar @grok', members, 'cli').quienes.map(m => m.id), ['radar', 'cli']);
  assert.strictEqual(recipients('@nadie', members, 'cli').modo, 'nadie');
  const secret = 'whsec_' + 'abcdefghijklmnopqrstuv';
  assert.ok(!redact(`la llave ${secret} queda`, [secret]).includes(secret));
  assert.strictEqual(redact('hola', ['hola']), 'hola', 'un secreto corto no se come una palabra');
});
