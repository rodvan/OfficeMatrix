// Cliente mínimo de Discord sin dependencias: el Gateway v10 por el WebSocket nativo de Node (22+) y la API REST con
// fetch. El bot se conecta HACIA Discord: no abre puertos ni necesita túnel.
// Intents: GUILDS, GUILD_MESSAGES y DIRECT_MESSAGES. Sin el privilegiado MESSAGE_CONTENT, Discord igual entrega el texto
// de los mensajes que mencionan al bot y el de los mensajes directos, que es justo lo que usa OfficeMatrix.
const API = 'https://discord.com/api/v10';
const GATEWAY = 'wss://gateway.discord.gg/?v=10&encoding=json';
const INTENTS = (1 << 0) | (1 << 9) | (1 << 12);
const MAX_LEN = 2000;
// Ver canales, enviar mensajes, insertar enlaces, adjuntar archivos y leer el historial: lo que pide el enlace de invitación.
const PERMISSIONS = 1024 + 2048 + 16384 + 32768 + 65536;
// Cierres del Gateway que no se arreglan reconectando: token inválido, intents no permitidos, versión, shard.
const FATAL = new Set([4004, 4010, 4011, 4012, 4013, 4014]);

const SNOWFLAKE_RE = /^\d{15,22}$/;
const TOKEN_RE = /^[\w-]{20,}\.[\w-]{4,}\.[\w-]{20,}$/;
const sleep = ms => new Promise(r => { const t = setTimeout(r, ms); t.unref?.(); });

const isSnowflake = s => SNOWFLAKE_RE.test(String(s || ''));
const isToken = s => TOKEN_RE.test(String(s || '').trim());
// El id de la aplicación va en la primera parte del token (base64 del id del bot): sirve para el enlace de invitación.
function appIdOf(token) {
  try { const id = Buffer.from(String(token).split('.')[0], 'base64').toString('utf8'); return isSnowflake(id) ? id : null; } catch { return null; }
}
const inviteUrl = appId => (isSnowflake(appId) ? `https://discord.com/oauth2/authorize?client_id=${appId}&scope=bot&permissions=${PERMISSIONS}` : null);

// Parte un texto en trozos de 2000 caracteres como máximo, por líneas cuando se puede.
function split(text, max = MAX_LEN) {
  const out = [];
  let rest = String(text ?? '');
  while (rest.length > max) {
    let cut = rest.lastIndexOf('\n', max);
    if (cut < max / 2) cut = rest.lastIndexOf(' ', max);
    if (cut < max / 2) cut = max;
    out.push(rest.slice(0, cut));
    rest = rest.slice(cut).replace(/^\s+/, '');
  }
  if (rest.trim() || !out.length) out.push(rest);
  return out;
}

function createRest(token, { fetchImpl = globalThis.fetch, api = API } = {}) {
  async function call(method, route, { json, files } = {}, tries = 0) {
    const headers = { Authorization: `Bot ${token}`, 'User-Agent': 'DiscordBot (https://github.com/rodvan/OfficeMatrix, 1.0)' };
    let body;
    if (files?.length) {
      body = new FormData();
      body.append('payload_json', JSON.stringify(json || {}));
      files.forEach((f, i) => body.append(`files[${i}]`, new Blob([f.data], { type: f.type || 'application/octet-stream' }), f.name));
    } else if (json !== undefined) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(json);
    }
    const r = await fetchImpl(api + route, { method, headers, body });
    if (r.status === 429 && tries < 3) {
      const j = await r.json().catch(() => ({}));
      await sleep(Math.min(10, Number(j.retry_after) || 1) * 1000);
      return call(method, route, { json, files }, tries + 1);
    }
    const text = await r.text().catch(() => '');
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { /* sin cuerpo JSON */ }
    if (!r.ok) throw Object.assign(new Error(`Discord ${r.status}: ${String(data?.message || text).slice(0, 160)}`), { status: r.status, code: data?.code });
    return data;
  }
  // Nunca se notifica a nadie por un texto que traiga @everyone o <@id>: allowed_mentions vacío.
  const message = m => ({ ...m, allowed_mentions: { parse: [], replied_user: false } });
  return {
    call,
    me: () => call('GET', '/users/@me'),
    send: (channelId, m, files) => call('POST', `/channels/${channelId}/messages`, { json: message(m), files }),
    edit: (channelId, messageId, m) => call('PATCH', `/channels/${channelId}/messages/${messageId}`, { json: message(m) }),
    typing: channelId => call('POST', `/channels/${channelId}/typing`).catch(() => null),
    interaction: (id, itoken, type, data) => call('POST', `/interactions/${id}/${itoken}/callback`, { json: { type, ...(data ? { data: message(data) } : {}) } }),
  };
}

// Conexión al Gateway con latido, reanudación (RESUME) y reconexión con espera creciente.
// onDispatch(tipo, datos) recibe los eventos; onState({ estado, usuario, error }) los cambios de estado.
function createGateway(token, { WebSocketImpl = globalThis.WebSocket, url = GATEWAY, intents = INTENTS, onDispatch = () => {}, onState = () => {} } = {}) {
  let ws = null, seq = null, sessionId = null, resumeUrl = null, beat = null, acked = true, stopped = false, tries = 0, user = null;
  const state = { estado: 'desconectado', usuario: null, error: null };
  const setState = patch => { Object.assign(state, patch); try { onState({ ...state }); } catch { /* el estado es informativo */ } };
  const send = (op, d) => { try { ws?.send(JSON.stringify({ op, d })); } catch { /* el cierre lo reintenta */ } };

  function heartbeat(interval) {
    clearInterval(beat);
    acked = true;
    const tick = () => {
      // Sin ACK del latido anterior la conexión está muerta (zombie): se cierra y se reanuda.
      if (!acked) { reconnect(true); return; }
      acked = false;
      send(1, seq);
    };
    const first = setTimeout(() => { tick(); beat = setInterval(tick, interval); beat.unref?.(); }, Math.floor(interval * Math.random()));
    first.unref?.();
    beat = first;
  }

  function open(resume) {
    if (stopped) return;
    setState({ estado: 'conectando', error: null });
    const target = resume && resumeUrl ? `${resumeUrl}/?v=10&encoding=json` : url;
    ws = new WebSocketImpl(target);
    const socket = ws;
    socket.onmessage = ev => {
      if (socket !== ws) return;
      let p;
      try { p = JSON.parse(typeof ev.data === 'string' ? ev.data : Buffer.from(ev.data).toString('utf8')); } catch { return; }
      if (p.s != null) seq = p.s;
      if (p.op === 10) {
        heartbeat(p.d.heartbeat_interval);
        if (resume && sessionId) send(6, { token, session_id: sessionId, seq });
        else send(2, { token, intents, properties: { os: process.platform, browser: 'officematrix', device: 'officematrix' } });
      } else if (p.op === 11) acked = true;
      else if (p.op === 1) send(1, seq);
      else if (p.op === 7) reconnect(true);
      else if (p.op === 9) { if (!p.d) { sessionId = null; seq = null; } sleep(1000 + Math.random() * 4000).then(() => reconnect(!!p.d)); }
      else if (p.op === 0) {
        if (p.t === 'READY') {
          sessionId = p.d.session_id; resumeUrl = p.d.resume_gateway_url || null; user = p.d.user;
          tries = 0;
          setState({ estado: 'conectado', usuario: { id: user.id, nombre: user.username }, error: null });
        } else if (p.t === 'RESUMED') { tries = 0; setState({ estado: 'conectado', error: null }); }
        try { onDispatch(p.t, p.d); } catch { /* un evento mal manejado no tumba la conexión */ }
      }
    };
    socket.onclose = ev => {
      if (socket !== ws) return;
      clearInterval(beat); clearTimeout(beat);
      if (stopped) return;
      if (FATAL.has(ev.code)) {
        setState({ estado: 'error', error: ev.code === 4004 ? 'token' : ev.code === 4014 ? 'intents' : `cierre ${ev.code}` });
        return;
      }
      tries++;
      setState({ estado: 'conectando' });
      sleep(Math.min(60000, 1000 * 2 ** Math.min(tries, 6))).then(() => open(!!sessionId));
    };
    socket.onerror = () => { /* llega también un close: ahí se decide */ };
  }

  function reconnect(resume) {
    clearInterval(beat); clearTimeout(beat);
    const old = ws;
    ws = null;
    try { old?.close(resume ? 4000 : 1000); } catch { /* ya estaba cerrado */ }
    if (!resume) { sessionId = null; seq = null; }
    if (!stopped) open(resume);
  }

  return {
    start() { stopped = false; open(false); return this; },
    stop() { stopped = true; clearInterval(beat); clearTimeout(beat); const old = ws; ws = null; try { old?.close(1000); } catch { /* nada */ } setState({ estado: 'desconectado' }); },
    get state() { return { ...state }; },
    get user() { return user; },
  };
}

module.exports = { API, GATEWAY, INTENTS, MAX_LEN, PERMISSIONS, isSnowflake, isToken, appIdOf, inviteUrl, split, createRest, createGateway };
