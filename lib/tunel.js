// El túnel rápido de Cloudflare para la puerta de los bots (docs/GROK-BOTS.md, «The tunnel»).
// Misma filosofía que la puerta: OfficeMatrix NUNCA descarga ni instala cloudflared. Busca el binario que la persona
// ya tiene (la ruta que pegó en el panel, el PATH, rutas conocidas), y solo cuando la persona pulsa «Arrancar el túnel»
// lanza `cloudflared tunnel --url http://localhost:<puerta>`. La salida va a un archivo de log (no a una tubería), para que
// el túnel sobreviva a un reinicio del servidor igual que la puerta; de ese log sale la URL https://*.trycloudflare.com.
// Un túnel rápido cambia de URL en cada arranque y no tiene garantía: para dejarlo fijo, un túnel con nombre.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const RELEASES = 'https://github.com/cloudflare/cloudflared/releases';
const URL_RE = /https:\/\/[a-z0-9-]+\.trycloudflare\.com(?![\w.-])/i; // nada pegado detrás: «….trycloudflare.com.otro.net» no vale
const ESPERA_URL_MS = 30000;

const exeName = platform => (platform === 'win32' ? 'cloudflared.exe' : 'cloudflared');

// Rutas donde se busca, en orden: la guardada en el panel, el PATH y las conocidas. Sin duplicados.
function candidatos({ guardada = '', env = process.env, platform = process.platform, home = os.homedir() } = {}) {
  const p = platform === 'win32' ? path.win32 : path.posix;
  const exe = exeName(platform);
  const out = [];
  const add = (ruta, origen) => { if (ruta && !out.some(c => c.ruta === ruta)) out.push({ ruta, origen }); };
  if (guardada) add(String(guardada).trim(), 'ajuste');
  const PATH = env.PATH || env.Path || '';
  for (const dir of PATH.split(platform === 'win32' ? ';' : ':').map(d => d.trim().replace(/^"|"$/g, '')).filter(Boolean)) add(p.join(dir, exe), 'path');
  if (platform === 'win32') {
    const profile = env.USERPROFILE || home;
    add(p.join(profile, 'cloudflared', exe), 'conocida');
    if (env.ProgramFiles) add(p.join(env.ProgramFiles, 'cloudflared', exe), 'conocida');
    if (env['ProgramFiles(x86)']) add(p.join(env['ProgramFiles(x86)'], 'cloudflared', exe), 'conocida');
    add(p.join(profile, '.cloudflared', exe), 'conocida');
  } else {
    add(p.join(home, '.cloudflared', exe), 'conocida');
    add('/usr/local/bin/cloudflared', 'conocida');
    add('/opt/homebrew/bin/cloudflared', 'conocida');
    add('/usr/bin/cloudflared', 'conocida');
  }
  return out;
}

const esArchivo = ruta => { try { return fs.statSync(ruta).isFile(); } catch { return false; } };

// El primer candidato que existe, o null. `existe` se inyecta en las pruebas.
function buscarCloudflared({ guardada, env, platform, home, existe = esArchivo } = {}) {
  return candidatos({ guardada, env, platform, home }).find(c => existe(c.ruta)) || null;
}

// Una ruta pegada por la persona: tiene que ser un archivo llamado cloudflared (o cloudflared.exe). No se ejecuta aquí.
function rutaValida(ruta, { existe = esArchivo } = {}) {
  const r = String(ruta || '').trim().replace(/^"|"$/g, '');
  if (!r) return '';
  if (!/^cloudflared(\.exe)?$/i.test(path.basename(r)) || !existe(r)) return null;
  return r;
}

// Qué descargar y dónde ponerlo, según el sistema. Solo texto para el panel: la descarga la hace la persona.
function descarga({ platform = process.platform, arch = process.arch, home = os.homedir(), env = process.env } = {}) {
  const a = arch === 'arm64' ? 'arm64' : arch === 'ia32' ? '386' : 'amd64';
  if (platform === 'win32') {
    return { pagina: RELEASES, archivo: `cloudflared-windows-${a}.exe`, destino: path.win32.join(env.USERPROFILE || home, 'cloudflared', 'cloudflared.exe'), renombrar: true };
  }
  if (platform === 'darwin') {
    return { pagina: RELEASES, archivo: `cloudflared-darwin-${a === 'arm64' ? 'arm64' : 'amd64'}.tgz`, destino: '/usr/local/bin/cloudflared', renombrar: false, alternativa: 'brew install cloudflared' };
  }
  return { pagina: RELEASES, archivo: `cloudflared-linux-${a}`, destino: path.posix.join(home, '.cloudflared', 'cloudflared'), renombrar: true };
}

// La URL del túnel rápido en el log de cloudflared (la imprime en stderr dentro de un recuadro). La última gana:
// si el log tiene varios arranques, vale la del más reciente.
function urlDelLog(texto) {
  const all = String(texto || '').match(new RegExp(URL_RE.source, 'gi')) || [];
  const urls = all.filter(u => !/^https:\/\/api\.trycloudflare\.com$/i.test(u));
  return urls.length ? urls[urls.length - 1].toLowerCase() : null;
}

function esEfimera(url) {
  try { return /(^|\.)trycloudflare\.com$/i.test(new URL(String(url)).hostname); } catch { return false; }
}

const vivo = pid => { if (!pid) return false; try { process.kill(pid, 0); return true; } catch (err) { return err.code === 'EPERM'; } };

// Lanza cloudflared sin elevación, desacoplado, con stdout/stderr al log, y espera la URL en ese log.
// Devuelve { pid, url | null }. No decide si hace falta: eso lo mira quien llama (túnel que ya contesta, pid vivo).
async function arrancar({ bin, puerto, log, esperaMs = ESPERA_URL_MS, lanzar = spawn }) {
  fs.mkdirSync(path.dirname(log), { recursive: true });
  const fd = fs.openSync(log, 'w');
  let child;
  try {
    child = lanzar(bin, ['tunnel', '--no-autoupdate', '--url', `http://localhost:${puerto}`], {
      detached: true, stdio: ['ignore', fd, fd], windowsHide: true,
    });
  } finally {
    fs.closeSync(fd);
  }
  let fallo = null;
  child.on?.('error', err => { fallo = err; });
  child.unref?.();
  const t0 = Date.now();
  while (Date.now() - t0 < esperaMs) {
    await new Promise(r => setTimeout(r, 250));
    if (fallo) throw fallo;
    let texto = '';
    try { texto = fs.readFileSync(log, 'utf8'); } catch { /* aún no existe */ }
    const url = urlDelLog(texto);
    if (url) return { pid: child.pid || null, url };
    if (child.exitCode != null) break;
  }
  return { pid: child.pid || null, url: null, salio: child.exitCode != null };
}

module.exports = { candidatos, buscarCloudflared, rutaValida, descarga, urlDelLog, esEfimera, arrancar, vivo, exeName, RELEASES };
