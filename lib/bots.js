// Bots externos (Grok Bots del usuario) como empleados de una oficina, por webhook.
// Ida: cuando le toca a un bot, OfficeMatrix manda su turno al webhook de la rutina del bot, con "responder_a": una URL
// pública (el túnel de Cloudflare, que apunta solo a puerta-bots.js) con un token de un solo uso.
// Vuelta: el bot hace el trabajo en su mundo y manda su respuesta por POST a esa URL; el turno queda registrado como el
// de cualquier otro agente.
// Firma de la ida: llave "whsec_…" = Standard Webhooks (docs.x.ai/grok/automations/webhooks); otra llave = Bearer
// (rutinas de Grok Bot con llave "crsr_…").
// Los datos públicos de los bots viven en <oficina>/bots.json; las URL y llaves, en <oficina>/bots.secreto.json, que
// la API nunca devuelve. Las llaves no se escriben en logs ni en el chat de la misión.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { t } = require('./i18n');

const CMD = 'grok-bot';             // "cmd" de los agentes-bot: no es una CLI, no se lanza ningún proceso
const AVATARS = ['lider', 'elegido', 'piloto', 'capitana', 'operador', 'sabia'];
const MAX_BODY = 1024 * 1024;       // 1 MiB, en los dos sentidos
const SEND_TIMEOUT_MS = 20000;

const slug = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30);
const hash = t => crypto.createHash('sha256').update(String(t)).digest('hex');
const httpErr = (status, message) => Object.assign(new Error(message), { status });

// Cabeceras firmadas de la llamada al webhook del bot.
function signedHeaders(llave, body, { id = `msg_${crypto.randomBytes(12).toString('hex')}`, timestamp = Math.floor(Date.now() / 1000) } = {}) {
  const headers = { 'content-type': 'application/json' };
  if (/^whsec_/.test(llave)) {
    const key = Buffer.from(llave.slice(6), 'base64');
    const sig = crypto.createHmac('sha256', key).update(`${id}.${timestamp}.${body}`).digest('base64');
    Object.assign(headers, { 'webhook-id': id, 'webhook-timestamp': String(timestamp), 'webhook-signature': `v1,${sig}` });
  } else if (llave) {
    headers.authorization = `Bearer ${llave}`;
  }
  return headers;
}

// Verificación del lado del bot (la usan las pruebas y sirve de referencia para quien monte su propio receptor).
function verifyStandard(llave, headers, body) {
  const id = headers['webhook-id'], ts = headers['webhook-timestamp'], sig = String(headers['webhook-signature'] || '');
  if (!id || !ts || !sig.startsWith('v1,')) return false;
  const want = crypto.createHmac('sha256', Buffer.from(llave.slice(6), 'base64')).update(`${id}.${ts}.${body}`).digest('base64');
  const a = Buffer.from(sig.slice(3)), b = Buffer.from(want);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function createBots(DATA, oficinas) {
  const SETTINGS = path.join(DATA, 'bots-ajustes.json');
  const dirOf = office => oficinas.dirs(office).root;
  const readJson = (file, fallback) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; } };
  const writeJson = (file, value) => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file + '.tmp', JSON.stringify(value, null, 2));
    fs.renameSync(file + '.tmp', file);
  };
  const pubFile = office => path.join(dirOf(office), 'bots.json');
  const secFile = office => path.join(dirOf(office), 'bots.secreto.json');

  // ---------- Ajustes: la URL pública del túnel ----------
  const settings = () => readJson(SETTINGS, {});
  function publicUrl() {
    return String(process.env.OFFICEMATRIX_BOTS_URL || settings().publicUrl || '').replace(/\/+$/, '');
  }
  function setPublicUrl(url) {
    const u = String(url || '').trim().replace(/\/+$/, '');
    if (u && !/^https:\/\/[^\s/]+(\/[^\s]*)?$/i.test(u)) throw httpErr(400, t('bots.err.publicUrl'));
    writeJson(SETTINGS, { ...settings(), publicUrl: u });
    return u;
  }

  // ---------- Bots de una oficina ----------
  const list = office => (oficinas.read(office) ? readJson(pubFile(office), []) : []);

  function add(office, input) {
    if (!oficinas.read(office) || office === oficinas.EDIFICIO) throw httpErr(400, t('bots.err.perOffice'));
    const nombre = String(input.nombre || '').trim().slice(0, 40);
    if (!nombre) throw httpErr(400, t('bots.err.name'));
    const url = String(input.url || '').trim();
    // https siempre; http solo hacia este mismo PC (un receptor local o las pruebas).
    if (!/^https:\/\/[^\s]+$/i.test(url) && !/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?\/[^\s]*$/i.test(url)) throw httpErr(400, t('bots.err.webhookUrl'));
    const llave = String(input.llave || '').trim();
    if (!llave) throw httpErr(400, t('bots.err.key'));
    const bots = list(office);
    let id = slug(input.id || nombre) || 'bot';
    for (let i = 2; bots.some(b => b.id === id); i++) id = `${slug(input.id || nombre) || 'bot'}-${i}`;
    const bot = {
      id, nombre,
      color: /^#[0-9a-f]{6}$/i.test(input.color || '') ? input.color : '#c062d6',
      avatar: AVATARS.includes(input.avatar) ? input.avatar : AVATARS[bots.length % 4],
      puesto: String(input.puesto || 'Grok Bot').trim().slice(0, 60),
      firma: /^whsec_/.test(llave) ? 'standard-webhooks' : 'bearer',
      pista: llave.slice(-4), host: new URL(url).host, creado: new Date().toISOString(), ultimaRespuesta: null,
    };
    writeJson(pubFile(office), [...bots, bot]);
    writeJson(secFile(office), { ...readJson(secFile(office), {}), [id]: { url, llave } });
    return bot;
  }

  function remove(office, id) {
    const bots = list(office);
    if (!bots.some(b => b.id === id)) throw httpErr(404, t('bots.err.missing'));
    writeJson(pubFile(office), bots.filter(b => b.id !== id));
    const sec = readJson(secFile(office), {});
    delete sec[id];
    writeJson(secFile(office), sec);
  }

  function touch(office, id, fields) {
    const bots = list(office);
    const b = bots.find(x => x.id === id);
    if (!b) return;
    Object.assign(b, fields);
    writeJson(pubFile(office), bots);
  }

  // Los bots como agentes de la oficina (para configFor, el compositor y el ciclo).
  // Sin llave no entra en una misión: no hay a quién llamar. En el chat sí se ve, marcado sinLlave.
  const agentsOf = office => list(office).filter(b => !b.sinLlave).map(b => ({
    id: `bot-${b.id}`, name: b.nombre, role: b.puesto, color: b.color, avatar: b.avatar, cmd: CMD, stream: 'text', args: [],
    enabled: true, bot: { oficina: office, id: b.id }, modeloLabel: 'Grok Bot',
  }));

  // ---------- Ida: POST al webhook del bot ----------
  async function send(office, botId, payload) {
    const sec = readJson(secFile(office), {})[botId];
    if (!sec) return { ok: false, error: t('bots.err.noWebhook') };
    const body = JSON.stringify(payload);
    if (Buffer.byteLength(body) > MAX_BODY) return { ok: false, error: t('bots.err.tooBig') };
    try {
      const res = await fetch(sec.url, { method: 'POST', headers: signedHeaders(sec.llave, body), body, signal: AbortSignal.timeout(SEND_TIMEOUT_MS), redirect: 'manual' });
      return res.status === 200 || res.status === 202 ? { ok: true, status: res.status } : { ok: false, status: res.status };
    } catch (err) {
      const why = err.name === 'TimeoutError' ? t('bots.err.timeout', { s: SEND_TIMEOUT_MS / 1000 }) : (err.cause?.code || err.message);
      return { ok: false, error: scrub(why, [sec.url, sec.llave]) };
    }
  }

  // URL y llave, solo para taparlas en el chat y en los errores. Nunca se devuelven por la API.
  function secretValues(office) {
    const sec = readJson(secFile(office), {});
    const out = [];
    for (const v of Object.values(sec)) {
      if (v && v.url) out.push(v.url);
      if (v && v.llave) out.push(v.llave);
    }
    return out;
  }

  function setSecret(office, id, input) {
    const bots = list(office);
    const b = bots.find(x => x.id === id);
    if (!b) throw httpErr(404, t('bots.err.missing'));
    const url = String(input.url || '').trim();
    if (!/^https:\/\/[^\s]+$/i.test(url) && !/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?\/[^\s]*$/i.test(url)) throw httpErr(400, t('bots.err.webhookUrl'));
    const llave = String(input.llave || '').trim();
    if (!llave) throw httpErr(400, t('bots.err.key'));
    writeJson(secFile(office), { ...readJson(secFile(office), {}), [id]: { url, llave } });
    Object.assign(b, { firma: /^whsec_/.test(llave) ? 'standard-webhooks' : 'bearer', pista: llave.slice(-4), host: new URL(url).host });
    delete b.sinLlave;
    writeJson(pubFile(office), bots);
    return b;
  }

  // Copia el personaje a otra oficina. La llave solo viaja si incluirLlave es exactamente true.
  function copyTo(office, id, { destino, incluirLlave = false } = {}) {
    if (!oficinas.read(destino) || destino === oficinas.EDIFICIO) throw httpErr(400, t('bots.err.dest'));
    if (destino === office) throw httpErr(400, t('bots.err.sameOffice'));
    const bot = list(office).find(b => b.id === id);
    if (!bot) throw httpErr(404, t('bots.err.missing'));
    const sec = readJson(secFile(office), {})[id];
    if (incluirLlave === true) {
      if (!sec?.llave) throw httpErr(400, t('bots.err.noKeyToCopy'));
      const copied = add(destino, { nombre: bot.nombre, avatar: bot.avatar, color: bot.color, puesto: bot.puesto, url: sec.url, llave: sec.llave });
      return { ...copied, llaveCopiada: true };
    }
    const dest = list(destino);
    let newId = bot.id;
    const base = slug(bot.id) || 'bot';
    for (let i = 2; dest.some(b => b.id === newId); i++) newId = `${base}-${i}`;
    const copy = {
      id: newId, nombre: bot.nombre, color: bot.color, avatar: bot.avatar, puesto: bot.puesto,
      firma: null, pista: '', host: '', sinLlave: true, copiadoDe: `${office}/${bot.id}`,
      creado: new Date().toISOString(), ultimaRespuesta: null,
    };
    writeJson(pubFile(destino), [...dest, copy]);
    return { ...copy, llaveCopiada: false };
  }

  const gatePort = () => Number(process.env.BOTS_PORT) || 4323;

  // La puerta local. Solo 127.0.0.1 y solo /bots/health: no abre nada más.
  async function gateUp(port = gatePort()) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/bots/health`, { signal: AbortSignal.timeout(1500), redirect: 'manual' });
      const body = await res.json().catch(() => ({}));
      return { ok: res.ok && body.ok === true && body.servicio === 'officematrix-bots', port };
    } catch (err) {
      return { ok: false, port, error: err.cause?.code || err.name || 'unreachable' };
    }
  }

  // Arranca puerta-bots.js sin elevación. Si ya escucha, no lanza otra.
  function startGate() {
    const child = spawn(process.execPath, [path.join(__dirname, '..', 'puerta-bots.js')], {
      detached: true, stdio: 'ignore', windowsHide: true, env: process.env,
    });
    child.unref();
    return { pid: child.pid || null };
  }

  // Ida y vuelta a la URL pública que el usuario guardó. Solo /bots/health, sin seguir redirecciones.
  async function tunnelUp() {
    const url = publicUrl();
    if (!url) return { ok: false, reason: 'missing' };
    let host = '';
    try { host = new URL(url).host; } catch { return { ok: false, reason: 'bad' }; }
    const local = /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/i.test(url);
    if (!/^https:\/\//i.test(url) && !local) return { ok: false, reason: 'bad', host };
    try {
      const t0 = Date.now();
      const res = await fetch(`${url}/bots/health`, { signal: AbortSignal.timeout(4000), redirect: 'manual' });
      const body = await res.json().catch(() => ({}));
      const ok = res.ok && body.ok === true && body.servicio === 'officematrix-bots';
      return { ok, host, ms: Date.now() - t0, status: res.status, reason: ok ? 'ok' : (res.status >= 300 && res.status < 400 ? 'redirect' : 'down') };
    } catch (err) {
      return { ok: false, host, reason: 'down', error: err.cause?.code || err.name || 'unreachable' };
    }
  }

  function blocks(lang) {
    const sample = {
      tipo: 'chat',
      oficina: 'your-office',
      mensaje: 'what the owner just wrote',
      historial: [{ de: 'Radar', texto: 'an earlier reply' }],
      responder_a: 'https://your-tunnel.example/bots/r/<one-time-token>',
      formato: 'Reply in plain text. One POST only.',
    };
    return { instruccion: t('wizard.instruction', {}, lang), json: JSON.stringify(sample, null, 2) };
  }

  // ---------- Vuelta: tokens de turno de un solo uso ----------
  // Se guardan por hash (el token no queda en memoria ni en disco) y la búsqueda es por hash: comparar es tiempo constante.
  const pending = new Map(); // hash -> { meta, expires, used, resolve }
  function openTurn(meta, ttlMs) {
    const token = crypto.randomBytes(32).toString('base64url');
    let resolve;
    const wait = new Promise(r => { resolve = r; });
    const entry = { meta, expires: Date.now() + ttlMs, used: false, resolve };
    pending.set(hash(token), entry);
    const timer = setTimeout(() => { entry.resolve(null); }, ttlMs);
    timer.unref?.();
    // Se olvida un rato después de caducar (mientras, un segundo intento recibe 410 en vez de 404).
    setTimeout(() => pending.delete(hash(token)), ttlMs + 3600e3).unref?.();
    return { token, wait, cancel: () => { entry.used = true; clearTimeout(timer); entry.resolve(null); } };
  }

  // { status: 200 | 404 | 410, meta? }
  function deliver(token, reply) {
    const entry = pending.get(hash(token));
    if (!entry) return { status: 404 };
    if (entry.used || Date.now() > entry.expires) return { status: 410 };
    entry.used = true;
    entry.resolve(reply);
    return { status: 200, meta: entry.meta };
  }

  const replyUrl = token => (publicUrl() ? `${publicUrl()}/bots/r/${token}` : null);

  return {
    CMD, list, add, remove, touch, agentsOf, send, openTurn, deliver, replyUrl, publicUrl, setPublicUrl,
    secretValues, setSecret, copyTo, gatePort, gateUp, startGate, tunnelUp, blocks,
  };
}

// Tapa una URL o una llave si un error de red las repite. No se usa para enseñar el secreto.
function scrub(text, secrets = []) {
  let s = String(text || '');
  for (const secret of secrets) if (secret && String(secret).length >= 8) s = s.split(secret).join('••••');
  return s.replace(/whsec_[A-Za-z0-9+/=_-]{6,}/g, 'whsec_••••').replace(/crsr_[A-Za-z0-9_-]{6,}/g, 'crsr_••••');
}

module.exports = { createBots, signedHeaders, verifyStandard, scrub, CMD, MAX_BODY, AVATARS };
