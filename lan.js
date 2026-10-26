// Acceso desde el celular u otro equipo de la red de casa, sin tocar el servidor (que solo escucha en 127.0.0.1).
// Es un proxy con clave: quien entre a la oficina puede lanzar misiones y las CLIs escriben en tu disco, así que
// nadie de la red pasa sin la clave. La clave se guarda en lan-clave.secreto.json (fuera de git) para que no cambie en
// cada arranque; OFFICEMATRIX_LAN_TOKEN la sustituye.
// Desde internet, SOLO detrás de un túnel de Cloudflare con Cloudflare Access: lo que llega por el túnel necesita además
// la firma de Access verificada aquí (lib/acceso-remoto.js). Nunca con redirección de puertos en el router.
// Uso: node lan.js   (con la app ya abierta con node server.js)
const http = require('http');
const os = require('os');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { loadConfig, viaTunnel, tokenOf, createVerifier } = require('./lib/acceso-remoto');
const { t } = require('./lib/i18n');

const TARGET = Number(process.env.PORT) || 4321;
const LAN_PORT = Number(process.env.LAN_PORT) || 4322;
const DATA = process.env.OFFICEMATRIX_HOME || __dirname;
const COOKIE = 'om_lan';

function lanToken() {
  if (process.env.OFFICEMATRIX_LAN_TOKEN) return process.env.OFFICEMATRIX_LAN_TOKEN;
  const file = path.join(DATA, 'lan-clave.secreto.json');
  try { const t = JSON.parse(fs.readFileSync(file, 'utf8')).clave; if (t) return t; } catch { /* primera vez */ }
  const t = crypto.randomBytes(18).toString('base64url');
  fs.writeFileSync(file, JSON.stringify({ clave: t }, null, 2));
  return t;
}
const TOKEN = lanToken();
const REMOTE = loadConfig(DATA);
const verifier = REMOTE && createVerifier(REMOTE);

const same = (a, b) => {
  const x = Buffer.from(String(a || '')), y = Buffer.from(TOKEN);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};
const cookieOf = req => (req.headers.cookie || '').split(';').map(c => c.trim().split('=')).find(([k]) => k === COOKIE)?.[1];

const server = http.createServer(async (req, res) => {
  // Por el túnel: primero el candado de Cloudflare Access. Sin configuración, nadie entra desde internet.
  const remote = viaTunnel(req);
  if (remote) {
    if (!verifier) return deny(res, 403, t('lan.remoteOff'));
    const v = await verifier.verify(tokenOf(req));
    if (!v.ok) return deny(res, 403, t('lan.accessDenied', { reason: v.reason }));
  }
  const url = new URL(req.url, 'http://lan');
  // Primera visita con ?clave=…: se guarda en una cookie y se quita de la dirección.
  if (url.searchParams.has('clave')) {
    if (!same(url.searchParams.get('clave'))) return deny(res);
    url.searchParams.delete('clave');
    res.writeHead(302, {
      'Set-Cookie': `${COOKIE}=${TOKEN}; HttpOnly; SameSite=Strict; Path=/; Max-Age=2592000${remote ? '; Secure' : ''}`,
      Location: url.pathname + url.search,
    });
    return res.end();
  }
  // Un agente externo entra con su llave de oficina (Authorization: Bearer om_…): la valida el servidor y solo le abre
  // su oficina. Sin llave, hace falta la cookie de la clave de red.
  const agent = /^Bearer\s+om_/i.test(req.headers.authorization || '');
  if (!agent && !same(cookieOf(req))) return deny(res);

  const headers = { ...req.headers, host: `127.0.0.1:${TARGET}` };
  delete headers.cookie; // la app no usa cookies: ni la clave ni la sesión de Access salen del proxy
  delete headers['cf-access-jwt-assertion'];
  // El navegador manda Origin = esta dirección (http en casa, https por el túnel); para el servidor, es su propio
  // origen. Otro origen (una web cualquiera abierta en el navegador) no puede escribir en la oficina.
  if (headers.origin) {
    if (headers.origin !== `${remote ? 'https' : 'http'}://${req.headers.host}`) { res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end(t('lan.badOrigin')); }
    headers.origin = `http://127.0.0.1:${TARGET}`;
  }
  const up = http.request({ host: '127.0.0.1', port: TARGET, method: req.method, path: req.url, headers }, r => {
    res.writeHead(r.statusCode, r.headers);
    r.pipe(res); // también los eventos en vivo (SSE)
  });
  up.on('error', () => { if (!res.headersSent) res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end(t('lan.down')); });
  req.pipe(up);
  res.on('close', () => up.destroy());
});

function deny(res, code = 401, text = t('lan.noKey')) {
  res.writeHead(code, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(`<meta name="viewport" content="width=device-width"><body style="background:#000;color:#39e58c;font-family:monospace;padding:24px">${text}</body>`);
}

if (require.main === module) {
  server.requestTimeout = 0; // los eventos en vivo duran horas
  server.listen(LAN_PORT, '0.0.0.0', () => {
    const ips = Object.values(os.networkInterfaces()).flat()
      .filter(i => i && i.family === 'IPv4' && !i.internal).map(i => i.address);
    console.log(t('lan.title'));
    for (const ip of ips) console.log(`     http://${ip}:${LAN_PORT}/?clave=${TOKEN}`);
    console.log(t('lan.hint'));
    console.log(REMOTE
      ? t('lan.internetOn', { team: REMOTE.teamDomain, key: TOKEN })
      : t('lan.internetOff'));
  });
}

module.exports = { server };
