'use strict';
// S1F con falsos y sin administrador: worker y controlador hablan por HTTP real en 127.0.0.1.
// El worker corre con la cuenta de esta prueba (cuenta falsa en `account`): no es una frontera entre cuentas.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const worker = require('../worker/worker');
const { Frontera } = require('../lib/frontera');
const { escuchar } = require('../lib/frontera-http');
const { createManifests, controlDir } = require('../lib/manifiestos');

const raw = (base, route, { method = 'GET', headers = {}, body } = {}) => new Promise((resolve, reject) => {
  const u = new URL(route, base);
  const req = http.request({ host: u.hostname, port: u.port, path: u.pathname, method, headers }, res => {
    let text = ''; res.on('data', b => { text += b; }); res.on('end', () => resolve({ status: res.statusCode, text }));
  });
  req.on('error', reject);
  req.end(body);
});

test('S1F-HTTP: el worker recoge el turno por /w/v1, ejecuta la CLI falsa y entrega eventos y fin', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'om-http-'));
  const turnos = [];
  let terminado;
  const llegado = new Promise(r => { terminado = r; });
  const f = new Frontera({ onTurno: x => { turnos.push(x); terminado(); } });
  const token = 'w'.repeat(40), otro = 'z'.repeat(40);
  f.register('redaccion', token); f.register('ventas', otro);
  const ctl = await escuchar(f);
  const stop = new AbortController();
  t.after(async () => { stop.abort(); await ctl.close(); fs.rmSync(dir, { recursive: true, force: true }); });

  const tokenFile = path.join(dir, 'worker.token'); fs.writeFileSync(tokenFile, token);
  // OM_CLAVE no la frena validateEnvironment (busca SECRET, TOKEN…): lo tiene que quitar la lista blanca.
  const env = { USERPROFILE: dir, PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, OM_CLAVE: "filtrada" };
  const vivo = worker.serve({ base: ctl.base, tokenFile, root: dir, expectedUser: 'om-redaccion',
    account: { username: 'om-redaccion', homedir: dir }, env, signal: stop.signal });

  for (let i = 0; i < 50 && f.status('redaccion').blocked; i++) await new Promise(r => setTimeout(r, 20));
  assert.equal(f.status('redaccion').blocked, false, 'el latido no llegó por HTTP');
  assert.equal(f.status('ventas').blocked, true, 'el latido de una oficina no desbloquea otra');
  f.enqueue('redaccion', { id: 'turno-1', cmd: process.execPath, cwd: dir, idleMs: 5000, totalMs: 10000,
    args: ['-e', 'console.log("hola desde " + process.cwd()); console.log("secreto=" + (process.env.OM_CLAVE || "no"))'] });
  await llegado;
  stop.abort();
  await vivo;

  assert.equal(turnos.length, 1);
  const [x] = turnos;
  assert.equal(x.oficina, 'redaccion'); assert.equal(x.id, 'turno-1');
  assert.equal(x.result.code, 0); assert.equal(x.result.treeDead, true);
  const out = x.events.filter(e => e.type === 'stdout').map(e => e.text).join('');
  assert.match(out, /hola desde /);
  assert.match(out, /secreto=no/);
  assert.equal(f.status('redaccion').active, null);
});

test('S1F-HTTP: navegador, otra oficina, método, tamaño y ruta del panel quedan fuera', async t => {
  const f = new Frontera();
  const a = 'a'.repeat(40), b = 'b'.repeat(40);
  f.register('a', a); f.register('b', b);
  const ctl = await escuchar(f, { limit: 1024 });
  t.after(() => ctl.close());
  const auth = tok => ({ Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' });

  assert.equal((await raw(ctl.base, '/w/v1/latido', { method: 'POST', headers: auth(a), body: '{}' })).status, 204);
  assert.equal((await raw(ctl.base, '/w/v1/latido', { method: 'POST', headers: auth(b), body: '{}' })).status, 204);
  f.enqueue('b', { id: 'turno-b' });
  // Con Origin o cookie (un navegador, o una página que hace DNS rebinding) no entra ni con el token bueno.
  assert.equal((await raw(ctl.base, '/w/v1/trabajo', { headers: { ...auth(b), Origin: 'http://evil.test' } })).status, 403);
  assert.equal((await raw(ctl.base, '/w/v1/trabajo', { headers: { ...auth(b), Cookie: 'om_panel=x' } })).status, 403);
  assert.equal((await raw(ctl.base, '/w/v1/trabajo', { headers: { ...auth(b), Host: 'evil.test' } })).status, 403);
  // Sin token o con uno desconocido: 404, igual que una ruta que no existe. Un POST no debe delatar la ruta con 405.
  assert.equal((await raw(ctl.base, '/w/v1/trabajo')).status, 404);
  assert.equal((await raw(ctl.base, '/w/v1/trabajo', { method: 'POST', body: '{}' })).status, 404);
  assert.equal((await raw(ctl.base, '/w/v1/trabajo', { headers: auth('q'.repeat(40)) })).status, 404);
  assert.equal((await raw(ctl.base, '/api/oficinas', { method: 'POST', headers: auth(a), body: '{}' })).status, 404);
  assert.equal((await raw(ctl.base, '/w/v1/trabajo', { method: 'POST', headers: auth(b), body: '{}' })).status, 405);
  // La oficina A no ve el turno de B ni puede cerrarlo.
  assert.equal((await raw(ctl.base, '/w/v1/trabajo', { headers: auth(a) })).status, 204);
  const job = await raw(ctl.base, '/w/v1/trabajo', { headers: auth(b) });
  assert.equal(job.status, 200); assert.equal(JSON.parse(job.text).id, 'turno-b');
  assert.equal((await raw(ctl.base, '/w/v1/turnos/turno-b/fin', { method: 'POST', headers: auth(a), body: '{"treeDead":true}' })).status, 404);
  assert.equal((await raw(ctl.base, '/w/v1/turnos/turno-b/eventos', { method: 'POST', headers: auth(b), body: 'no es json' })).status, 400);
  const big = JSON.stringify({ events: [{ type: 'stdout', text: 'x'.repeat(4096) }] });
  assert.equal((await raw(ctl.base, '/w/v1/turnos/turno-b/eventos', { method: 'POST', headers: auth(b), body: big })).status, 413);
  // Sin corte confirmado el turno sigue retenido.
  assert.equal((await raw(ctl.base, '/w/v1/turnos/turno-b/fin', { method: 'POST', headers: auth(b), body: '{"treeDead":false}' })).status, 409);
  assert.equal(f.status('b').active, 'turno-b');
});

test('S1F-HTTP: el transporte del worker rechaza servidores no locales antes de mandar el token', () => {
  for (const base of ['http://localhost:1', 'https://127.0.0.1:1', 'http://u:p@127.0.0.1:1', 'http://10.0.0.1:1']) {
    assert.throws(() => worker.transport(base, 'x'.repeat(32)), /SERVIDOR_NO_LOCAL/, base);
  }
});

test('S1F: manifiestos y entrantes pueden vivir fuera de la raíz de datos, nunca en un árbol de trabajo', t => {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'om-datos-'));
  const fuera = fs.mkdtempSync(path.join(os.tmpdir(), 'om-control-'));
  t.after(() => { fs.rmSync(data, { recursive: true, force: true }); fs.rmSync(fuera, { recursive: true, force: true }); });
  assert.equal(controlDir(data, {}), path.join(data, '.control'));
  assert.equal(controlDir(data, { OFFICEMATRIX_CONTROL: fuera }), path.resolve(fuera));
  for (const d of ['oficinas', 'proyectos', 'memoria']) {
    assert.throws(() => controlDir(data, { OFFICEMATRIX_CONTROL: path.join(data, d, 'x') }), /CONTROL_EN_ARBOL_DE_TRABAJO/);
  }
  const m = createManifests(data, fuera);
  m.create('redaccion', 'mision-1', [{ id: 'ana' }]);
  assert.ok(fs.existsSync(path.join(fuera, 'oficinas', 'redaccion', 'misiones', 'mision-1', 'manifiesto.json')));
  assert.equal(fs.existsSync(path.join(data, '.control')), false);
  assert.deepEqual(m.read('redaccion', 'mision-1').equipo, [{ id: 'ana' }]);
  assert.throws(() => m.create('redaccion', 'mision-1', []), /EEXIST/);
});
