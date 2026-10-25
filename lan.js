// Acceso desde el celular u otro equipo de la red de casa, sin tocar el servidor (que solo escucha en 127.0.0.1).
// Es un proxy con clave: quien entre a la oficina puede lanzar misiones y las CLIs escriben en tu disco, así que
// nadie de la red pasa sin la clave. La clave cambia en cada arranque (o fíjala con OFFICEMATRIX_LAN_TOKEN).
// No lo expongas a internet (ni redirección de puertos en el router ni túneles públicos).
// Uso: node lan.js   (con la app ya abierta con node server.js)
const http = require('http');
const os = require('os');
const crypto = require('crypto');
const { t } = require('./lib/i18n');

const TARGET = Number(process.env.PORT) || 4321;
const LAN_PORT = Number(process.env.LAN_PORT) || 4322;
const TOKEN = process.env.OFFICEMATRIX_LAN_TOKEN || crypto.randomBytes(9).toString('base64url');
const COOKIE = 'om_lan';

const same = (a, b) => {
  const x = Buffer.from(String(a || '')), y = Buffer.from(TOKEN);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};
const cookieOf = req => (req.headers.cookie || '').split(';').map(c => c.trim().split('=')).find(([k]) => k === COOKIE)?.[1];

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://lan');
  // Primera visita con ?clave=…: se guarda en una cookie y se quita de la dirección.
  if (url.searchParams.has('clave')) {
    if (!same(url.searchParams.get('clave'))) return deny(res);
    url.searchParams.delete('clave');
    res.writeHead(302, {
      'Set-Cookie': `${COOKIE}=${TOKEN}; HttpOnly; SameSite=Strict; Path=/; Max-Age=2592000`,
      Location: url.pathname + url.search,
    });
    return res.end();
  }
  // Un agente externo entra con su llave de oficina (Authorization: Bearer om_…): la valida el
  // servidor y solo le abre su oficina. Sin llave, hace falta la cookie de la clave de red.
  const agent = /^Bearer\s+om_/i.test(req.headers.authorization || '');
  if (!agent && !same(cookieOf(req))) return deny(res);

  const headers = { ...req.headers, host: `127.0.0.1:${TARGET}` };
  delete headers.cookie; // la app no usa cookies: la clave no sale del proxy
  // El navegador del celular manda Origin = esta dirección de red; para el servidor, es su propio origen.
  // Otro origen (una web cualquiera abierta en el celular) no puede escribir en la oficina.
  if (headers.origin) {
    if (headers.origin !== `http://${req.headers.host}`) { res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end(t('lan.badOrigin')); }
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

function deny(res) {
  res.writeHead(401, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end('<meta name="viewport" content="width=device-width"><body style="background:#000;color:#39e58c;font-family:monospace;padding:24px">'
    + `${t('lan.noKey')}</body>`);
}

server.requestTimeout = 0; // los eventos en vivo duran horas
server.listen(LAN_PORT, '0.0.0.0', () => {
  const ips = Object.values(os.networkInterfaces()).flat()
    .filter(i => i && i.family === 'IPv4' && !i.internal).map(i => i.address);
  console.log(t('lan.title'));
  for (const ip of ips) console.log(`     http://${ip}:${LAN_PORT}/?clave=${TOKEN}`);
  console.log(t('lan.hint'));
});
