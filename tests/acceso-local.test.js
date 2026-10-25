// Cookie de panel, apagada salvo OFFICEMATRIX_COOKIE=1. No activa la frontera.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const acceso = require('../lib/acceso-local');

test('cookie: solo el valor exacto entra', () => {
  const panel = acceso.crear('a'.repeat(64));
  assert.equal(acceso.acepta(panel, { headers: { cookie: acceso.cabecera(panel).split(';')[0] } }), true);
  assert.equal(acceso.acepta(panel, { headers: {} }), false);
  assert.equal(acceso.acepta(panel, { headers: { cookie: 'om_panel=' + 'b'.repeat(64) } }), false);
  assert.equal(acceso.acepta(panel, { headers: { cookie: 'om_panel=' + 'a'.repeat(64) + 'x' } }), false);
  assert.match(acceso.cabecera(panel), /HttpOnly/);
  assert.match(acceso.cabecera(panel), /SameSite=Strict/);
});

test('API y /raw sin cookie responden 401; la página entrega la cookie', async t => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'om-cookie-'));
  fs.writeFileSync(path.join(home, 'agents.json'), JSON.stringify({ agents: [], maxRounds: 1, minScore: 9 }));
  fs.mkdirSync(path.join(home, 'memoria'));
  process.env.OFFICEMATRIX_HOME = home;
  process.env.OFFICEMATRIX_CONFIG = path.join(home, 'agents.json');
  process.env.OFFICEMATRIX_COOKIE = '1';
  const { server } = require('../server');
  t.after(() => { server.close(); server.closeAllConnections?.(); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const ask = (url, cookie) => new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: url, headers: cookie ? { cookie } : {} }, res => {
      res.resume(); res.on('end', () => resolve(res));
    });
    req.on('error', reject); req.end();
  });
  assert.equal((await ask('/api/agents')).statusCode, 401);
  assert.equal((await ask('/raw/no-existe/x')).statusCode, 401);
  const page = await ask('/');
  const set = page.headers['set-cookie'][0];
  assert.match(set, /om_panel=[a-f0-9]{64}/);
  assert.equal((await ask('/api/agents', set.split(';')[0])).statusCode, 200);
  assert.equal((await ask('/escenas.js')).statusCode, 200);
});
