// Puerta pública para los bots externos (Grok Bots). El túnel de Cloudflare apunta SOLO aquí, nunca a la app:
// no sirve el panel, ni misiones, ni archivos. Solo acepta tres cosas:
//   GET  /bots/health                      comprobación del asistente (no reenvía nada; no lleva secretos)
//   POST /bots/r/<token>                   respuesta de un turno (token de un solo uso)        → /api/bots/respuesta/<token>
//   POST /bots/o/<oficina>/<llave_agente>  un bot inicia algo en su oficina (llave om_<oficina>_…) → /api/bots/mensaje
// Todo lo demás: 404. Cuerpo de 1 MiB como máximo, solo JSON o texto, y un límite de peticiones por IP.
// Uso: node puerta-bots.js   (con la app abierta: node server.js). Variables: BOTS_PORT (4323), PORT (4321).
const http = require('http');
const { t } = require('./lib/i18n');

const PORT = Number(process.env.BOTS_PORT) || 4323;
const TARGET = Number(process.env.PORT) || 4321;
const MAX_BODY = 1024 * 1024;
const RATE = { window: 60e3, max: Number(process.env.BOTS_RATE) || 60 }; // peticiones por IP y minuto
const TOKEN_RE = /^[A-Za-z0-9_-]{20,128}$/;
const OFFICE_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;
const KEY_RE = /^om_[a-z0-9-]+_[A-Za-z0-9_-]{10,}$/;

const hits = new Map(); // ip -> [marcas de tiempo]
setInterval(() => { const now = Date.now(); for (const [ip, t] of hits) if (!t.some(x => now - x < RATE.window)) hits.delete(ip); }, RATE.window).unref();

const reply = (res, status, body) => {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(JSON.stringify(body));
};

function route(method, url) {
  const parts = url.split('?')[0].split('/').filter(Boolean);
  if (parts[0] !== 'bots') return null;
  if (method === 'GET' && parts[1] === 'health' && parts.length === 2) return { health: true };
  if (method !== 'POST') return null;
  if (parts[1] === 'r' && parts.length === 3 && TOKEN_RE.test(parts[2])) return { path: `/api/bots/respuesta/${parts[2]}` };
  if (parts[1] === 'o' && parts.length === 4 && OFFICE_RE.test(parts[2]) && KEY_RE.test(decodeURIComponent(parts[3]))) {
    return { path: `/api/bots/mensaje?oficina=${parts[2]}`, auth: `Bearer ${decodeURIComponent(parts[3])}` };
  }
  return null;
}

function createGate({ target = TARGET } = {}) {
  return http.createServer((req, res) => {
    const r = route(req.method, req.url);
    if (!r) return reply(res, 404, { error: t('gate.notFound') });
    // Detrás de Cloudflare la IP real viene en CF-Connecting-IP; en local, la del socket.
    const ip = String(req.headers['cf-connecting-ip'] || req.socket.remoteAddress || '?');
    const now = Date.now();
    const recent = (hits.get(ip) || []).filter(t => now - t < RATE.window);
    if (recent.length >= RATE.max) return reply(res, 429, { error: t('gate.tooMany') });
    hits.set(ip, [...recent, now]);
    // La comprobación no reenvía nada al panel y no dice nada de oficinas, llaves ni misiones.
    if (r.health) return reply(res, 200, { ok: true, servicio: 'officematrix-bots' });
    const type = String(req.headers['content-type'] || 'text/plain');
    if (!/^(application\/json|text\/plain)/i.test(type)) return reply(res, 415, { error: t('gate.onlyJson') });
    const chunks = [];
    let size = 0, aborted = false;
    req.on('data', c => {
      size += c.length;
      if (size > MAX_BODY && !aborted) { aborted = true; reply(res, 413, { error: t('gate.tooBig') }); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      if (aborted) return;
      const body = Buffer.concat(chunks);
      // Solo se reenvía el tipo y el cuerpo: ninguna cabecera del exterior (cookies, Origin…) llega al servidor.
      const headers = { 'content-type': type.split(';')[0], 'content-length': body.length, ...(r.auth ? { authorization: r.auth } : {}) };
      const up = http.request({ host: '127.0.0.1', port: target, method: 'POST', path: r.path, headers }, ur => {
        const out = [];
        ur.on('data', c => out.push(c));
        ur.on('end', () => {
          let data = {};
          try { data = JSON.parse(Buffer.concat(out).toString('utf8')); } catch {}
          // Al exterior solo vuelve el estado y un mensaje corto (nada del panel).
          reply(res, ur.statusCode, ur.statusCode < 300 ? { ok: true, ...(data.id ? { id: data.id } : {}) } : { error: String(data.error || 'Error').slice(0, 200) });
        });
      });
      up.on('error', () => reply(res, 502, { error: t('gate.down') }));
      up.end(body);
    });
  });
}

if (require.main === module) {
  createGate().listen(PORT, '127.0.0.1', () => {
    console.log(t('gate.listening', { port: PORT }));
  });
}

module.exports = { createGate, route };
