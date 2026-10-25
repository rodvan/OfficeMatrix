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
  const agentsOf = office => list(office).map(b => ({
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
      return { ok: false, error: err.name === 'TimeoutError' ? t('bots.err.timeout', { s: SEND_TIMEOUT_MS / 1000 }) : (err.cause?.code || err.message) };
    }
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

  return { CMD, list, add, remove, touch, agentsOf, send, openTurn, deliver, replyUrl, publicUrl, setPublicUrl };
}

module.exports = { createBots, signedHeaders, verifyStandard, CMD, MAX_BODY, AVATARS };
