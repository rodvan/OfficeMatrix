// Acceso por túnel de Cloudflare: lan.js exige la firma de Cloudflare Access en lo que llega por el túnel, falla cerrado sin
// configuración y deja igual el acceso desde el celular en casa (solo con la clave de red).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const { createVerifier, viaTunnel, loadConfig } = require('../lib/acceso-remoto');

const TEAM = 'equipo-demo.cloudflareaccess.com';
const AUD = 'aud-demo-123';
const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'k1', alg: 'RS256' };
const fetchImpl = async url => { assert.strictEqual(url, `https://${TEAM}/cdn-cgi/access/certs`); return { ok: true, json: async () => ({ keys: [jwk] }) }; };
const b64u = o => Buffer.from(typeof o === 'string' ? o : JSON.stringify(o)).toString('base64url');
function jwt(payload, { kid = 'k1', key = privateKey } = {}) {
  const head = b64u({ alg: 'RS256', kid, typ: 'JWT' }), body = b64u(payload);
  return `${head}.${body}.${crypto.sign('RSA-SHA256', Buffer.from(`${head}.${body}`), key).toString('base64url')}`;
}
// fetch no deja fijar Host: peticiones a mano, sin keep-alive.
function req(base, p, { method = 'GET', headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const r = http.request(`${base}${p}`, { method, headers, agent: false }, res => { let b = ''; res.on('data', d => { b += d; }); res.on('end', () => resolve({ status: res.statusCode, json: () => JSON.parse(b) })); });
    r.on('error', reject); r.end();
  });
}
const now = Math.floor(Date.now() / 1000);
const good = { aud: [AUD], iss: `https://${TEAM}`, exp: now + 600, nbf: now - 10, email: 'duena@example.com' };

test('verifica la firma de Access: válida, otra aplicación, caducada, alterada o de otra llave', async () => {
  const v = createVerifier({ teamDomain: TEAM, aud: AUD }, { fetchImpl });
  assert.deepStrictEqual(await v.verify(jwt(good)), { ok: true, email: 'duena@example.com' });
  assert.strictEqual((await v.verify(jwt({ ...good, aud: ['otra'] }))).ok, false);
  assert.strictEqual((await v.verify(jwt({ ...good, exp: now - 3600 }))).ok, false);
  assert.strictEqual((await v.verify(jwt({ ...good, iss: 'https://otro.cloudflareaccess.com' }))).ok, false);
  const [h, , s] = jwt(good).split('.');
  assert.strictEqual((await v.verify(`${h}.${b64u({ ...good, email: 'intruso@example.com' })}.${s}`)).ok, false);
  const otra = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey;
  assert.strictEqual((await v.verify(jwt(good, { key: otra }))).ok, false);
  assert.strictEqual((await v.verify('')).ok, false);
});

test('el túnel se reconoce por salir de esta máquina o por las cabeceras de Cloudflare', () => {
  assert.strictEqual(viaTunnel({ socket: { remoteAddress: '127.0.0.1' }, headers: {} }), true);
  assert.strictEqual(viaTunnel({ socket: { remoteAddress: '::ffff:127.0.0.1' }, headers: {} }), true);
  assert.strictEqual(viaTunnel({ socket: { remoteAddress: '10.0.0.20' }, headers: { 'cf-ray': 'x' } }), true);
  assert.strictEqual(viaTunnel({ socket: { remoteAddress: '10.0.0.20' }, headers: {} }), false);
});

test('lan.js: por el túnel sin configuración se rechaza; con Access + clave entra y el origen https vale', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'om-acceso-'));
  const app = http.createServer((req, res) => { res.end(JSON.stringify({ origin: req.headers.origin || null, cookie: req.headers.cookie || null, jwt: req.headers['cf-access-jwt-assertion'] || null })); });
  await new Promise(r => app.listen(0, '127.0.0.1', r));
  const run = async (withConfig) => {
    if (withConfig) fs.writeFileSync(path.join(home, 'acceso-remoto.json'), JSON.stringify({ teamDomain: TEAM, aud: AUD }));
    process.env.OFFICEMATRIX_HOME = home;
    process.env.PORT = String(app.address().port);
    process.env.OFFICEMATRIX_LAN_TOKEN = 'clave-de-prueba';
    delete require.cache[require.resolve('../lan')];
    const realFetch = globalThis.fetch;
    globalThis.fetch = async (url, ...rest) => (String(url).includes('cloudflareaccess') ? fetchImpl(url) : realFetch(url, ...rest));
    const { server } = require('../lan');
    await new Promise(r => server.listen(0, '127.0.0.1', r));
    const base = `http://127.0.0.1:${server.address().port}`;
    return { base, close: () => { server.close(); server.closeAllConnections?.(); globalThis.fetch = realFetch; } };
  };
  try {
    const a = await run(false);
    const r1 = await req(a.base, '/', { headers: { cookie: 'om_lan=clave-de-prueba' } });
    assert.strictEqual(r1.status, 403, 'sin acceso-remoto.json, el túnel no entra aunque tenga la clave');
    a.close();

    const b = await run(true);
    const sin = await req(b.base, '/', { headers: { cookie: 'om_lan=clave-de-prueba' } });
    assert.strictEqual(sin.status, 403, 'clave sin firma de Access: fuera');
    const soloAccess = await req(b.base, '/', { headers: { 'cf-access-jwt-assertion': jwt(good) } });
    assert.strictEqual(soloAccess.status, 401, 'Access sin la clave de red: fuera');
    const ok = await req(b.base, '/api/x', { method: 'POST', headers: { host: 'office.example.com', origin: 'https://office.example.com', cookie: `om_lan=clave-de-prueba; CF_Authorization=${jwt(good)}` } });
    assert.strictEqual(ok.status, 200);
    const seen = ok.json();
    assert.strictEqual(seen.cookie, null, 'ni la clave ni la sesión de Access llegan a la app');
    assert.match(seen.origin, /^http:\/\/127\.0\.0\.1:/);
    const malo = await req(b.base, '/api/x', { method: 'POST', headers: { host: 'office.example.com', origin: 'https://evil.example', cookie: `om_lan=clave-de-prueba; CF_Authorization=${jwt(good)}` } });
    assert.strictEqual(malo.status, 403);
    b.close();
  } finally {
    app.close(); app.closeAllConnections?.();
    delete process.env.OFFICEMATRIX_LAN_TOKEN;
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('la configuración se lee del archivo o de las variables', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'om-acceso-cfg-'));
  assert.strictEqual(loadConfig(home, {}), null);
  fs.writeFileSync(path.join(home, 'acceso-remoto.json'), JSON.stringify({ teamDomain: `https://${TEAM}/`, aud: AUD }));
  assert.deepStrictEqual(loadConfig(home, {}), { teamDomain: TEAM, aud: AUD });
  assert.deepStrictEqual(loadConfig(home, { OFFICEMATRIX_CF_AUD: 'otro' }), { teamDomain: TEAM, aud: 'otro' });
  fs.rmSync(home, { recursive: true, force: true });
});
