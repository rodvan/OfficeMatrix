// Discord por oficina (docs/DISCORD.md): el cliente del Gateway con un WebSocket falso, y los bots de las oficinas con un
// Gateway y una API REST falsos. Ninguna prueba sale a internet. Se comprueba el aislamiento: el bot de una oficina solo
// llama al chat de SU oficina, la Nave solo pregunta a las que comparten con ella, y el token nunca vuelve al panel.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'om-discord-'));
const fake = path.join(__dirname, 'helpers', 'fake-agent.js');
fs.writeFileSync(path.join(home, 'agents.json'), JSON.stringify({
  agents: [{ id: 'cli', name: 'Grok', role: 'Lead', color: '#c062d6', avatar: 'capitana', cmd: 'node', stream: 'text', args: [fake, 'cli', 'chat', 'text', '{prompt}'] }],
  maxRounds: 1, minScore: 9, turnTimeoutMinutes: 0.05,
}));
process.env.OFFICEMATRIX_HOME = home;
process.env.OFFICEMATRIX_CONFIG = path.join(home, 'agents.json');
process.env.OFFICEMATRIX_CHAT_CLI_MS = '8000';
process.env.OFFICEMATRIX_LANG = 'en';

const discord = require('../lib/discord');
const { createDiscord, normalizar } = require('../lib/discord-oficinas');
const { readOnlyArgs } = require('../lib/chat-oficina');

const APP = '123456789012345678';
const TOKEN = `${Buffer.from(APP).toString('base64')}.GabcDE.${'x'.repeat(27)}`;
const TOKEN2 = `${Buffer.from('223456789012345678').toString('base64')}.GzzzZZ.${'y'.repeat(27)}`;
const OWNER = '111111111111111111', STRANGER = '999999999999999999', CANAL = '333333333333333333', AVISOS = '444444444444444444';
const tick = () => new Promise(r => setImmediate(r));
const until = async (fn, ms = 3000) => { const end = Date.now() + ms; while (!fn()) { if (Date.now() > end) throw new Error('timeout'); await new Promise(r => setTimeout(r, 10)); } };

// ---------- lib/discord.js ----------
test('split respeta los 2000 caracteres y no pierde texto', () => {
  const text = Array.from({ length: 300 }, (_, i) => `línea ${i} ${'x'.repeat(20)}`).join('\n');
  const parts = discord.split(text);
  assert.ok(parts.length > 1);
  assert.ok(parts.every(p => p.length <= 2000));
  assert.strictEqual(parts.join('\n').replace(/\s+/g, ''), text.replace(/\s+/g, ''));
  assert.deepStrictEqual(discord.split('hola'), ['hola']);
});

test('token, ids e invitación', () => {
  assert.ok(discord.isToken(TOKEN));
  assert.ok(!discord.isToken('abc'));
  assert.strictEqual(discord.appIdOf(TOKEN), APP);
  assert.ok(discord.inviteUrl(APP).includes(`client_id=${APP}`));
  assert.ok(discord.inviteUrl(APP).includes('scope=bot'));
  assert.strictEqual(discord.inviteUrl('x'), null);
  assert.throws(() => normalizar({ token: 'no-es-token' }), e => e.codigo === 'token_invalido');
  const n = normalizar({ token: TOKEN, usuarios: `${OWNER}, abc, ${OWNER}`, canalAvisos: 'nope' });
  assert.deepStrictEqual(n.usuarios, [OWNER]);
  assert.strictEqual(n.canalAvisos, null);
  assert.strictEqual(n.permitirNave, true);
});

test('Gateway: IDENTIFY con los intents sin privilegios, latido, READY, RESUME tras op 7 y cierre fatal sin reintentos', async () => {
  const sockets = [];
  class FakeWS {
    constructor(url) { this.url = url; this.sent = []; sockets.push(this); }
    send(d) { this.sent.push(JSON.parse(d)); }
    close() { this.closed = true; }
    push(p) { this.onmessage({ data: JSON.stringify(p) }); }
  }
  const events = [], states = [];
  const gw = discord.createGateway(TOKEN, { WebSocketImpl: FakeWS, onDispatch: (t, d) => events.push(t), onState: s => states.push(s.estado) }).start();
  const ws = sockets[0];
  ws.push({ op: 10, d: { heartbeat_interval: 60 } });
  const id = ws.sent.find(m => m.op === 2);
  assert.ok(id, 'identify');
  assert.strictEqual(id.d.token, TOKEN);
  assert.strictEqual(id.d.intents, 4609, 'GUILDS + GUILD_MESSAGES + DIRECT_MESSAGES, sin MESSAGE_CONTENT');
  await until(() => ws.sent.some(m => m.op === 1));
  ws.push({ op: 11 }); // el ACK llega antes del siguiente latido: la conexión sigue viva
  ws.push({ op: 0, s: 1, t: 'READY', d: { session_id: 'sess', resume_gateway_url: 'wss://resume.example', user: { id: APP, username: 'oficina-bot' } } });
  assert.strictEqual(gw.state.estado, 'conectado');
  assert.deepStrictEqual(gw.state.usuario, { id: APP, nombre: 'oficina-bot' });
  ws.push({ op: 0, s: 2, t: 'MESSAGE_CREATE', d: {} });
  assert.deepStrictEqual(events, ['READY', 'MESSAGE_CREATE']);
  ws.push({ op: 7 });
  assert.ok(ws.closed);
  const ws2 = sockets[1];
  assert.ok(ws2.url.startsWith('wss://resume.example'));
  ws2.push({ op: 10, d: { heartbeat_interval: 1000 } });
  const resume = ws2.sent.find(m => m.op === 6);
  assert.deepStrictEqual(resume.d, { token: TOKEN, session_id: 'sess', seq: 2 });
  ws2.onclose({ code: 4004 });
  assert.strictEqual(gw.state.estado, 'error');
  assert.strictEqual(gw.state.error, 'token');
  await new Promise(r => setTimeout(r, 50));
  assert.strictEqual(sockets.length, 2, 'un token inválido no se reintenta');
  gw.stop();
});

test('chat desde Discord: Claude sin herramientas de archivos', () => {
  const args = readOnlyArgs('claude', ['-p', '{prompt}', '--permission-mode', 'acceptEdits'], { sinArchivos: true });
  const deny = args[args.indexOf('--disallowedTools') + 1];
  for (const tool of ['Write', 'Bash', 'Read', 'Glob', 'Grep', 'WebFetch']) assert.ok(deny.split(',').includes(tool), tool);
  assert.ok(args.includes('plan'));
  assert.ok(!readOnlyArgs('claude', ['-p', 'x']).at(-1).includes('Read'), 'el chat del panel no cambia');
});

// ---------- lib/discord-oficinas.js con Gateway y REST falsos ----------
function harness({ offices = ['viralhunt', 'cerebro', 'privada'] } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'om-dc-'));
  const list = [{ id: 'edificio', nombre: 'Ship' }, ...offices.map(id => ({ id, nombre: id === 'viralhunt' ? 'ViralHunt' : id }))];
  const oficinas = { list: () => list, read: id => list.find(o => o.id === id) || null, dirs: id => ({ root: path.join(root, id) }) };
  const gws = {}, sent = [], edits = [], callbacks = [], chats = [], approvals = [], rejections = [];
  let pendientes = {};
  const transport = {
    gateway: (token, h) => { const g = { token, h, state: { estado: 'conectado', usuario: { id: token === TOKEN ? APP : '223456789012345678', nombre: 'bot' } }, start() { gws[token] = g; h.onDispatch('READY', { user: { id: this.state.usuario.id, username: 'bot' } }); return g; }, stop() { this.stopped = true; } }; return g; },
    rest: token => ({
      send: async (canal, m, files) => { sent.push({ token, canal, ...m, files }); return { id: String(sent.length) }; },
      edit: async (canal, id, m) => { edits.push({ token, canal, id, ...m }); return {}; },
      typing: async () => null,
      interaction: async (id, itoken, type, data) => { callbacks.push({ id, type, data }); return null; },
    }),
  };
  const deps = {
    chat: async (office, texto, { autor }) => { chats.push({ office, texto, autor }); return [{ autor: { tipo: 'owner', nombre: autor }, texto }, { autor: { tipo: 'cli', nombre: 'Grok', puesto: 'Lead' }, texto: `respuesta de ${office}` }]; },
    aprobar: async (office, pid, input) => {
      approvals.push({ office, pid, input });
      const p = pendientes[office].find(x => x.id === pid);
      if (p.verificacion.semaforo === 'amarillo' && !input.confirmarAmarillo) throw Object.assign(new Error('amarilla'), { status: 409, codigo: 'confirmar_amarillo' });
      return { viralhunt: { donde: 'agendado' } };
    },
    rechazar: async (office, pid, input) => { rejections.push({ office, pid, input }); return {}; },
    propuestas: office => pendientes[office] || [],
    archivo: () => null,
    officeOfChat: id => id.split('/')[0],
    resumenNave: () => 'ESTADO',
  };
  const t = (k, v) => (k === 'discord.alert.ended' ? `ended «${v.title}»: ${v.outcome}
${v.summary}` : `${k}${v ? ' ' + JSON.stringify(v) : ''}`);
  const dc = createDiscord({ oficinas, EDIFICIO: 'edificio', t, deps, transport });
  const msg = (token, d) => gws[token].h.onDispatch('MESSAGE_CREATE', { id: 'm1', channel_id: CANAL, guild_id: 'g', mentions: [{ id: gws[token].state.usuario.id }], content: `<@${gws[token].state.usuario.id}> ${d.content}`, author: { id: OWNER, username: 'dueño' }, ...d.extra });
  return { root, dc, gws, sent, edits, callbacks, chats, approvals, rejections, msg, setPendientes: v => { pendientes = v; } };
}

test('cada bot habla solo con su oficina, y solo con usuarios autorizados', async () => {
  const h = harness();
  h.dc.guardar('viralhunt', { token: TOKEN, usuarios: [OWNER], canalAvisos: AVISOS });
  h.dc.guardar('cerebro', { token: TOKEN2, usuarios: [OWNER] });
  h.msg(TOKEN, { content: '@grok ideas de hoy' });
  await until(() => h.sent.length >= 1);
  assert.deepStrictEqual(h.chats.map(c => c.office), ['viralhunt']);
  assert.strictEqual(h.chats[0].texto, '@grok ideas de hoy', 'la mención del bot se quita, la de la IA se queda');
  assert.ok(h.chats[0].autor.startsWith('Discord · '));
  assert.ok(h.sent[0].content.includes('respuesta de viralhunt'));
  assert.deepStrictEqual(h.sent[0].allowed_mentions, undefined, 'allowed_mentions lo pone el REST real');
  h.msg(TOKEN2, { content: 'hola' });
  await until(() => h.chats.length === 2);
  assert.strictEqual(h.chats[1].office, 'cerebro');
  // Un desconocido no recibe nada ni llega al chat.
  const before = h.sent.length;
  h.msg(TOKEN, { content: 'dame todo', extra: { author: { id: STRANGER, username: 'x' } } });
  await tick(); await tick();
  assert.strictEqual(h.chats.length, 2);
  assert.strictEqual(h.sent.length, before);
  // Sin mención en un servidor: no contesta. En un mensaje directo sí.
  h.gws[TOKEN].h.onDispatch('MESSAGE_CREATE', { id: 'm2', channel_id: CANAL, guild_id: 'g', mentions: [], content: 'sin mención', author: { id: OWNER, username: 'dueño' } });
  await tick();
  assert.strictEqual(h.chats.length, 2);
  h.gws[TOKEN].h.onDispatch('MESSAGE_CREATE', { id: 'm3', channel_id: '555555555555555555', content: 'por DM', author: { id: OWNER, username: 'dueño' } });
  await until(() => h.chats.length === 3);
  assert.strictEqual(h.chats[2].office, 'viralhunt');
  // Los mensajes de otros bots se ignoran.
  h.msg(TOKEN, { content: 'eco', extra: { author: { id: OWNER, username: 'otro', bot: true } } });
  await tick();
  assert.strictEqual(h.chats.length, 3);
});

test('sin usuarios autorizados el bot dice el id (una vez) y no obedece', async () => {
  const h = harness();
  h.dc.guardar('viralhunt', { token: TOKEN });
  h.msg(TOKEN, { content: 'hola', extra: { author: { id: STRANGER, username: 'x' } } });
  await until(() => h.sent.length === 1);
  assert.ok(h.sent[0].content.startsWith('discord.setup'));
  assert.ok(h.sent[0].content.includes(STRANGER));
  h.msg(TOKEN, { content: 'otra vez', extra: { author: { id: STRANGER, username: 'x' } } });
  await tick(); await tick();
  assert.strictEqual(h.sent.length, 1);
  assert.strictEqual(h.chats.length, 0);
});

test('canales: fuera de la lista no escucha', async () => {
  const h = harness();
  h.dc.guardar('viralhunt', { token: TOKEN, usuarios: [OWNER], canales: ['777777777777777777'] });
  h.msg(TOKEN, { content: 'hola' });
  await tick(); await tick();
  assert.strictEqual(h.chats.length, 0);
  h.msg(TOKEN, { content: 'hola', extra: { channel_id: '777777777777777777' } });
  await until(() => h.chats.length === 1);
});

test('Nave: estado de todas, pregunta a una oficina que comparte y respeta a la que no', async () => {
  const h = harness();
  h.dc.guardar('edificio', { token: TOKEN, usuarios: [OWNER] });
  h.dc.guardar('privada', { token: TOKEN2, usuarios: [OWNER], permitirNave: false });
  h.msg(TOKEN, { content: 'estado' });
  await until(() => h.sent.some(s => s.content === 'ESTADO'));
  h.msg(TOKEN, { content: 'viralhunt: ¿cómo van las propuestas?' });
  await until(() => h.chats.length === 1);
  assert.deepStrictEqual(h.chats[0], { office: 'viralhunt', texto: '¿cómo van las propuestas?', autor: h.chats[0].autor });
  await until(() => h.sent.some(s => s.content.includes('ViralHunt') && s.content.includes('respuesta de viralhunt')));
  h.msg(TOKEN, { content: 'privada: muéstrame todo' });
  await until(() => h.sent.some(s => s.content.startsWith('discord.shipBlocked')));
  assert.strictEqual(h.chats.length, 1, 'la oficina privada no recibe la pregunta');
  h.msg(TOKEN, { content: 'hola nave' });
  await until(() => h.sent.some(s => s.content === 'discord.helpShip'));
  assert.strictEqual(h.chats.length, 1, 'sin oficina ni @IA, la Nave contesta con la ayuda');
  h.msg(TOKEN, { content: '@claude resume la semana' });
  await until(() => h.chats.length === 2);
  assert.strictEqual(h.chats[1].office, 'edificio');
});

test('avisos: misión terminada a su oficina, titular a la Nave; nada de la oficina que no comparte', async () => {
  const h = harness();
  h.dc.guardar('edificio', { token: TOKEN, usuarios: [OWNER], canalAvisos: AVISOS });
  h.dc.guardar('viralhunt', { token: TOKEN2, usuarios: [OWNER], canalAvisos: CANAL });
  h.dc.alEvento({ type: 'cycle-ended', chatId: 'viralhunt/m1', title: 'Landing', outcome: 'consenso', summary: 'detalle interno' });
  await until(() => h.sent.length === 2);
  const own = h.sent.find(s => s.token === TOKEN2), ship = h.sent.find(s => s.token === TOKEN);
  assert.strictEqual(own.canal, CANAL);
  assert.ok(own.content.includes('detalle interno'));
  assert.strictEqual(ship.canal, AVISOS);
  assert.ok(ship.content.includes('ViralHunt'));
  assert.ok(!ship.content.includes('detalle interno'), 'a la Nave solo llega el titular');
  h.dc.guardar('privada', { token: TOKEN2, usuarios: [OWNER], canalAvisos: CANAL, permitirNave: false });
  const n = h.sent.length;
  h.dc.alEvento({ type: 'cycle-ended', chatId: 'privada/m2', title: 'Secreta', outcome: 'consenso' });
  await until(() => h.sent.length === n + 1);
  assert.ok(!h.sent.slice(n).some(s => s.token === TOKEN));
  // Sin avisos de misiones: nada.
  h.dc.guardar('viralhunt', { avisos: { misiones: false } });
  const m = h.sent.length;
  h.dc.alEvento({ type: 'cycle-ended', chatId: 'viralhunt/m3', title: 'Otra', outcome: 'consenso' });
  await until(() => h.sent.length === m + 1); // solo la Nave
  assert.strictEqual(h.sent.at(-1).token, TOKEN);
});

test('propuestas: tarjeta con botones, roja bloqueada, amarilla pide confirmación y solo el autorizado decide', async () => {
  const h = harness();
  h.setPendientes({ viralhunt: [] });
  h.dc.guardar('viralhunt', { token: TOKEN, usuarios: [OWNER], canalAvisos: AVISOS });
  h.setPendientes({ viralhunt: [
    { id: '2026-10-26-1', estado: 'pendiente', tema: 'Artemis', hook: 'Vuelve la Luna', copy: { x: 'texto' }, verificacion: { semaforo: 'verde', fuentes: [{ url: 'https://nasa.gov' }] } },
    { id: '2026-10-26-2', estado: 'pendiente', tema: 'Rumor', hook: 'h', copy: { x: 't' }, verificacion: { semaforo: 'rojo', fuentes: [] } },
    { id: '2026-10-26-3', estado: 'pendiente', tema: 'Dudosa', hook: 'h', copy: { x: 't' }, verificacion: { semaforo: 'amarillo', fuentes: [] } },
  ] });
  h.dc.alEvento({ type: 'editorial-updated', oficina: 'viralhunt' });
  await until(() => h.sent.length === 3);
  const [verde, roja] = h.sent;
  assert.ok(verde.content.includes('Artemis') && verde.content.includes('https://nasa.gov'));
  assert.strictEqual(verde.components[0].components[0].custom_id, 'om:ap:2026-10-26-1');
  assert.strictEqual(roja.components[0].components[0].disabled, true);
  // No se anuncian dos veces.
  h.dc.alEvento({ type: 'editorial-updated', oficina: 'viralhunt' });
  await tick(); await tick();
  assert.strictEqual(h.sent.length, 3);
  const press = (custom_id, user = OWNER) => h.gws[TOKEN].h.onDispatch('INTERACTION_CREATE', { id: 'i', token: 'itok', type: 3, channel_id: AVISOS, data: { custom_id }, member: { user: { id: user, username: 'dueño' } }, message: { id: '1', content: 'tarjeta' } });
  press('om:ap:2026-10-26-1', STRANGER);
  await until(() => h.callbacks.length === 1);
  assert.strictEqual(h.callbacks[0].data.flags, 64);
  assert.strictEqual(h.approvals.length, 0);
  press('om:ap:2026-10-26-1');
  await until(() => h.edits.length === 1);
  assert.strictEqual(h.approvals[0].pid, '2026-10-26-1');
  assert.ok(h.edits[0].content.includes('agendado'));
  assert.deepStrictEqual(h.edits[0].components, []);
  press('om:ap:2026-10-26-3');
  await until(() => h.edits.length === 2);
  assert.strictEqual(h.edits[1].components[0].components[0].custom_id, 'om:ay:2026-10-26-3');
  press('om:ay:2026-10-26-3');
  await until(() => h.edits.length === 3);
  assert.strictEqual(h.approvals.at(-1).input.confirmarAmarillo, true);
  press('om:re:2026-10-26-2');
  await until(() => h.rejections.length === 1);
  assert.ok(h.rejections[0].input.nota, 'rechazar lleva nota');
});

test('la vista nunca trae el token y el archivo es *.secreto.json', () => {
  const h = harness();
  const v = h.dc.guardar('viralhunt', { token: TOKEN, usuarios: [OWNER] });
  assert.ok(!JSON.stringify(v).includes(TOKEN));
  assert.ok(!JSON.stringify(v).includes('GabcDE'));
  assert.strictEqual(v.configurado, true);
  assert.ok(v.invitacion.includes(APP));
  assert.ok(fs.existsSync(path.join(h.root, 'viralhunt', 'discord.secreto.json')));
  assert.deepStrictEqual(h.dc.secretos('viralhunt'), [TOKEN]);
  // Guardar sin token conserva el anterior.
  h.dc.guardar('viralhunt', { usuarios: [] });
  assert.deepStrictEqual(h.dc.secretos('viralhunt'), [TOKEN]);
  const off = h.dc.borrar('viralhunt');
  assert.strictEqual(off.configurado, false);
  assert.ok(h.gws[TOKEN].stopped);
});

// ---------- El servidor ----------
const { server, discordBots } = require('../server');
let base;
test.before(async () => { base = await new Promise(r => server.listen(0, '127.0.0.1', () => r(`http://127.0.0.1:${server.address().port}`))); });
test.after(() => { discordBots.detenerTodas(); server.close(); server.closeAllConnections?.(); fs.rmSync(home, { recursive: true, force: true }); });
const api = async (url, opts = {}, key) => {
  const res = await fetch(base + url, { ...opts, headers: { 'Content-Type': 'application/json', ...(key ? { Authorization: `Bearer ${key}` } : {}) } });
  return { status: res.status, body: await res.json().catch(() => null) };
};

test('API: guardar, ver sin token, llave de agente sin acceso y un mensaje de Discord llega al chat de SU oficina', async () => {
  const sent = [];
  let handlers = null;
  discordBots.usarTransporte({
    gateway: (token, h) => ({ state: { estado: 'conectado', usuario: { id: APP, nombre: 'bot' } }, start() { handlers = h; h.onDispatch('READY', { user: { id: APP, username: 'bot' } }); return this; }, stop() {} }),
    rest: () => ({ send: async (c, m) => { sent.push(m); return {}; }, edit: async () => ({}), typing: async () => null, interaction: async () => null }),
  });
  assert.strictEqual((await api('/api/oficinas', { method: 'POST', body: JSON.stringify({ nombre: 'Discordia' }) })).status, 201);
  const bad = await api('/api/oficinas/discordia/discord', { method: 'PUT', body: JSON.stringify({ token: 'nope' }) });
  assert.strictEqual(bad.status, 400);
  const ok = await api('/api/oficinas/discordia/discord', { method: 'PUT', body: JSON.stringify({ token: TOKEN, usuarios: [OWNER] }) });
  assert.strictEqual(ok.status, 200);
  assert.ok(!JSON.stringify(ok.body).includes(TOKEN));
  assert.strictEqual(ok.body.estado, 'conectado');
  const got = await api('/api/oficinas/discordia/discord');
  assert.ok(!JSON.stringify(got.body).includes(TOKEN));
  // Una llave de agente de la oficina no puede leer ni cambiar el bot.
  const key = await api('/api/oficinas/discordia/llaves', { method: 'POST', body: JSON.stringify({ nombre: 'externo' }) });
  const llave = key.body?.llave || key.body?.key;
  assert.ok(llave);
  assert.strictEqual((await api('/api/oficinas/discordia/discord', {}, llave)).status, 403);
  // Mensaje del dueño en Discord → chat de la oficina «discordia» con la CLI falsa.
  handlers.onDispatch('MESSAGE_CREATE', { id: 'm', channel_id: CANAL, guild_id: 'g', mentions: [{ id: APP }], content: `<@${APP}> @grok hola equipo`, author: { id: OWNER, username: 'dueño' } });
  await until(() => sent.length >= 1, 15000);
  assert.ok(sent[0].content.includes('Grok'));
  const chat = await api('/api/oficinas/discordia/chat');
  const rows = Array.isArray(chat.body) ? chat.body : chat.body?.mensajes || [];
  assert.ok(rows.some(m => m.autor?.nombre === 'Discord · dueño' && m.texto === '@grok hola equipo'), 'queda en el chat de la oficina');
  const raw = fs.readFileSync(path.join(home, 'oficinas', 'discordia', 'chat', 'mensajes.jsonl'), 'utf8');
  assert.ok(!raw.includes(TOKEN));
  assert.strictEqual((await api('/api/oficinas/discordia/discord', { method: 'DELETE' })).status, 200);
});
