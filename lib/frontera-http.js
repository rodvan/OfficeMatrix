// S1F: adaptador HTTP /w/v1 del controlador. Escucha en su propio puerto de 127.0.0.1, nunca en el del panel:
// el token de un worker no abre /api y la cookie del panel no abre /w/v1. server.js NO lo monta (D35).
'use strict';
const http = require('node:http');

const LOOPBACK = new Set(['127.0.0.1', '::ffff:127.0.0.1']);

function crearAdaptador(frontera, { limit = 4.5e6, host = () => null } = {}) {
  return (req, res) => {
    const send = (status, body) => {
      res.writeHead(status, body === undefined ? { 'Cache-Control': 'no-store' } : { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(body === undefined ? undefined : JSON.stringify(body));
    };
    // Un navegador manda Origin (o cookie): una página no puede hablar con el worker ni por DNS rebinding.
    if (!LOOPBACK.has(req.socket.remoteAddress) || req.headers.origin || req.headers.cookie) return send(403);
    const expected = host();
    if (expected && req.headers.host !== expected) return send(403);
    const route = String(req.url || '').split('?')[0];
    const token = /^Bearer (\S+)$/.exec(req.headers.authorization || '')?.[1];
    // Sin token, 404 también si el método no es el de la ruta: un 405 delataría que /w/v1/trabajo existe.
    if (!frontera.scope(token)) return send(404);
    const get = route === '/w/v1/trabajo';
    if (req.method !== (get ? 'GET' : 'POST')) return send(405);
    const chunks = []; let size = 0, tooBig = false;
    req.on('data', b => {
      if (tooBig) return;
      size += b.length;
      if (size <= limit) return chunks.push(b);
      tooBig = true;
      res.setHeader('Connection', 'close');
      res.once('finish', () => req.destroy());
      send(413);
    });
    req.on('end', () => {
      if (tooBig) return;
      let body;
      if (!get) {
        try { body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}; } catch { return send(400); }
      }
      const out = frontera.route(token, route, body);
      send(out.status, out.status === 200 ? out.body : undefined);
    });
  };
}

// Solo 127.0.0.1. Devuelve la base que el worker usa con transport() y el servidor para cerrarlo.
function escuchar(frontera, { port = 0, limit } = {}) {
  let base = null;
  const server = http.createServer(crearAdaptador(frontera, { limit, host: () => base && new URL(base).host }));
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      base = `http://127.0.0.1:${server.address().port}`;
      resolve({ server, base, close: () => new Promise(r => server.close(() => r())) });
    });
  });
}

module.exports = { crearAdaptador, escuchar };
