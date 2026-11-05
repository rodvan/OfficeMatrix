// El túnel rápido de Cloudflare (lib/tunel.js, D85): OfficeMatrix nunca descarga cloudflared; lo busca en la ruta guardada,
// el PATH y rutas conocidas, y de su log saca la URL https://*.trycloudflare.com. Aquí nunca se lanza cloudflared de verdad:
// el buscador recibe un `existe` falso y el parser, líneas de log como las que imprime cloudflared 2026.10.3.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const tunel = require('../lib/tunel');
const { createBots } = require('../lib/bots');

const LOG = [
  '2026-10-28T01:02:03Z INF Thank you for trying Cloudflare Tunnel. Doing so, without a Cloudflare account, is a quick way to experiment and try it out. However, be aware that these account-less Tunnels have no uptime guarantee.',
  '2026-10-28T01:02:03Z INF Requesting new quick Tunnel on trycloudflare.com...',
  '2026-10-28T01:02:05Z INF +--------------------------------------------------------------------------------------------+',
  '2026-10-28T01:02:05Z INF |  Your quick Tunnel has been created! Visit it at (it may take some time to be reachable):  |',
  '2026-10-28T01:02:05Z INF |  https://alpha-beta-gamma-delta.trycloudflare.com                                          |',
  '2026-10-28T01:02:05Z INF +--------------------------------------------------------------------------------------------+',
  '2026-10-28T01:02:06Z INF Registered tunnel connection connIndex=0 location=mia01 protocol=quic',
].join('\n');

test('parser: saca la URL del recuadro, ignora api.trycloudflare.com y se queda con la del último arranque', () => {
  assert.strictEqual(tunel.urlDelLog(LOG), 'https://alpha-beta-gamma-delta.trycloudflare.com');
  assert.strictEqual(tunel.urlDelLog('2026-10-28T01:00:00Z ERR failed to request quick Tunnel: Post "https://api.trycloudflare.com/tunnel": dial tcp: i/o timeout'), null);
  assert.strictEqual(tunel.urlDelLog(''), null);
  assert.strictEqual(tunel.urlDelLog('INF requesting... no url yet'), null);
  const dos = `${LOG}\n2026-10-28T02:00:00Z INF |  https://otra-direccion-nueva.trycloudflare.com  |`;
  assert.strictEqual(tunel.urlDelLog(dos), 'https://otra-direccion-nueva.trycloudflare.com');
  // Un dominio que solo se parece no cuenta.
  assert.strictEqual(tunel.urlDelLog('https://evil.trycloudflare.com.attacker.net'), null);
});

test('URL efímera: solo *.trycloudflare.com', () => {
  assert.strictEqual(tunel.esEfimera('https://alpha-beta.trycloudflare.com'), true);
  assert.strictEqual(tunel.esEfimera('https://bots.ejemplo.com'), false);
  assert.strictEqual(tunel.esEfimera('https://trycloudflare.com.ejemplo.com'), false);
  assert.strictEqual(tunel.esEfimera(''), false);
  assert.strictEqual(tunel.esEfimera(null), false);
});

test('Windows: ruta guardada primero, luego PATH, luego %USERPROFILE%\\cloudflared y %ProgramFiles%', () => {
  const env = { PATH: 'C:\\Windows\\system32;"C:\\Tools"', USERPROFILE: 'C:\\Users\\demo', ProgramFiles: 'C:\\Program Files' };
  const lista = tunel.candidatos({ env, platform: 'win32', home: 'C:\\Users\\demo', guardada: 'D:\\cf\\cloudflared.exe' });
  assert.deepStrictEqual(lista.slice(0, 3).map(c => [c.ruta, c.origen]), [
    ['D:\\cf\\cloudflared.exe', 'ajuste'],
    ['C:\\Windows\\system32\\cloudflared.exe', 'path'],
    ['C:\\Tools\\cloudflared.exe', 'path'],
  ]);
  assert.ok(lista.some(c => c.ruta === 'C:\\Users\\demo\\cloudflared\\cloudflared.exe' && c.origen === 'conocida'));
  assert.ok(lista.some(c => c.ruta === 'C:\\Program Files\\cloudflared\\cloudflared.exe'));
  // El caso de hoy: fuera del PATH, en %USERPROFILE%\cloudflared.
  const hallado = tunel.buscarCloudflared({ env, platform: 'win32', home: 'C:\\Users\\demo', existe: r => r === 'C:\\Users\\demo\\cloudflared\\cloudflared.exe' });
  assert.deepStrictEqual(hallado, { ruta: 'C:\\Users\\demo\\cloudflared\\cloudflared.exe', origen: 'conocida' });
  // En el PATH gana al de rutas conocidas.
  const enPath = tunel.buscarCloudflared({ env, platform: 'win32', home: 'C:\\Users\\demo', existe: r => /cloudflared\.exe$/.test(r) && !r.startsWith('D:') });
  assert.strictEqual(enPath.origen, 'path');
  assert.strictEqual(tunel.buscarCloudflared({ env, platform: 'win32', home: 'C:\\Users\\demo', existe: () => false }), null);
});

test('macOS y Linux: PATH, ~/.cloudflared, /usr/local/bin y /opt/homebrew/bin', () => {
  const lista = tunel.candidatos({ env: { PATH: '/usr/bin:/bin' }, platform: 'darwin', home: '/Users/demo' }).map(c => c.ruta);
  for (const r of ['/usr/bin/cloudflared', '/bin/cloudflared', '/Users/demo/.cloudflared/cloudflared', '/usr/local/bin/cloudflared', '/opt/homebrew/bin/cloudflared']) assert.ok(lista.includes(r), r);
  assert.strictEqual(new Set(lista).size, lista.length, 'sin duplicados');
  const hallado = tunel.buscarCloudflared({ env: { PATH: '/usr/bin' }, platform: 'linux', home: '/home/demo', existe: r => r === '/opt/homebrew/bin/cloudflared' });
  assert.strictEqual(hallado.ruta, '/opt/homebrew/bin/cloudflared');
});

test('qué descargar y dónde ponerlo, por sistema (solo texto: nada se descarga)', () => {
  const w = tunel.descarga({ platform: 'win32', arch: 'x64', env: { USERPROFILE: 'C:\\Users\\demo' } });
  assert.strictEqual(w.pagina, 'https://github.com/cloudflare/cloudflared/releases');
  assert.strictEqual(w.archivo, 'cloudflared-windows-amd64.exe');
  assert.strictEqual(w.destino, 'C:\\Users\\demo\\cloudflared\\cloudflared.exe');
  assert.strictEqual(tunel.descarga({ platform: 'darwin', arch: 'arm64' }).archivo, 'cloudflared-darwin-arm64.tgz');
  assert.strictEqual(tunel.descarga({ platform: 'linux', arch: 'arm64', home: '/home/demo' }).archivo, 'cloudflared-linux-arm64');
});

test('una ruta pegada tiene que ser un archivo cloudflared; vacía la borra', () => {
  assert.strictEqual(tunel.rutaValida('"C:\\cf\\cloudflared.exe"', { existe: () => true }), 'C:\\cf\\cloudflared.exe');
  assert.strictEqual(tunel.rutaValida('/usr/local/bin/cloudflared', { existe: () => true }), '/usr/local/bin/cloudflared');
  assert.strictEqual(tunel.rutaValida('C:\\Windows\\system32\\cmd.exe', { existe: () => true }), null);
  assert.strictEqual(tunel.rutaValida('C:\\cf\\cloudflared.exe', { existe: () => false }), null);
  assert.strictEqual(tunel.rutaValida('  '), '');
});

test('arrancar: lanza una vez, guarda la URL del log como pública y no lanza otro si sigue vivo', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'officematrix-tunel-'));
  const bin = path.join(home, process.platform === 'win32' ? 'cloudflared.exe' : 'cloudflared');
  fs.writeFileSync(bin, '');
  const bots = createBots(home, {});
  assert.strictEqual(bots.tunnelInfo().efimera, false);
  assert.throws(() => bots.setCloudflaredPath(path.join(home, 'otro.exe')), /cloudflared/);
  bots.setCloudflaredPath(bin);
  assert.deepStrictEqual(bots.tunnelInfo().cloudflared, { ruta: bin, origen: 'ajuste' });

  const lanzados = [];
  // Un cloudflared falso: escribe en el log lo que imprimiría el real. El pid es el de este proceso, que está vivo.
  const lanzar = (cmd, args, opts) => {
    lanzados.push([cmd, args]);
    fs.writeSync(opts.stdio[2], LOG);
    return { pid: process.pid, exitCode: null, on() {}, unref() {} };
  };
  const r = await bots.startTunnel({ lanzar });
  assert.deepStrictEqual(r, { ok: true, already: false, url: 'https://alpha-beta-gamma-delta.trycloudflare.com', pid: process.pid });
  assert.deepStrictEqual(lanzados, [[bin, ['tunnel', '--no-autoupdate', '--url', 'http://localhost:4323']]]);
  assert.strictEqual(bots.publicUrl(), 'https://alpha-beta-gamma-delta.trycloudflare.com');
  assert.strictEqual(bots.tunnelInfo().efimera, true);
  assert.strictEqual(bots.tunnelInfo().corriendo, true);

  const otra = await bots.startTunnel({ lanzar });
  assert.strictEqual(otra.already, true);
  assert.strictEqual(lanzados.length, 1, 'no lanza un segundo túnel');
  // Los ajustes conservan la ruta y la URL juntas.
  const ajustes = JSON.parse(fs.readFileSync(path.join(home, 'bots-ajustes.json'), 'utf8'));
  assert.strictEqual(ajustes.cloudflaredPath, bin);
  assert.strictEqual(ajustes.publicUrl, 'https://alpha-beta-gamma-delta.trycloudflare.com');
  fs.rmSync(home, { recursive: true, force: true });
});

test('arrancar sin cloudflared: no lanza nada y devuelve qué descargar', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'officematrix-tunel-'));
  const bots = createBots(home, {});
  const PATH = process.env.PATH, USERPROFILE = process.env.USERPROFILE, PF = process.env.ProgramFiles;
  process.env.PATH = ''; process.env.USERPROFILE = home; delete process.env.ProgramFiles;
  try {
    const info = bots.tunnelInfo();
    if (info.cloudflared) return; // este equipo tiene uno en una ruta conocida fuera de HOME (/usr/local/bin…): nada que probar
    let lanzado = false;
    const r = await bots.startTunnel({ lanzar: () => { lanzado = true; } });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.reason, 'missing');
    assert.match(r.descarga.pagina, /github\.com\/cloudflare\/cloudflared\/releases/);
    assert.strictEqual(lanzado, false);
  } finally {
    process.env.PATH = PATH; process.env.USERPROFILE = USERPROFILE; if (PF) process.env.ProgramFiles = PF;
    fs.rmSync(home, { recursive: true, force: true });
  }
});
