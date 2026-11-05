// En Windows un proceso hereda el PATH de quien lo lanzó. Si el servidor arranca desde una terminal abierta antes
// de instalar una CLI (agy, grok, kimi…), no la ve y la marca «no instalada». Al arrancar sumamos el PATH guardado
// en el registro (máquina + usuario), sin quitar nada del heredado.
const path = require('path');
const { execFileSync } = require('child_process');

// Expande %VAR% con el entorno dado; deja intacta la que no existe.
function expandir(s, env) {
  return s.replace(/%([^%]+)%/g, (m, k) => {
    const hit = Object.keys(env).find(x => x.toLowerCase() === k.toLowerCase());
    return hit ? env[hit] : m;
  });
}

// Valor de «Path» en la salida de `reg query`.
function deReg(salida) {
  const m = /^\s*Path\s+REG(?:_EXPAND)?_SZ\s+(.*)$/im.exec(salida || '');
  return m ? m[1].trim() : '';
}

// PATH heredado + las entradas del registro que falten (sin duplicados, sin basura con comillas o vacías).
function fusionar(actual, extras, env = process.env) {
  const visto = new Set();
  const out = [];
  for (const parte of [actual || '', ...extras].join(';').split(';')) {
    const p = expandir(parte.trim(), env).replace(/^"|"$/g, '');
    if (!p || p.includes('::')) continue; // entradas rotas como «[Environment]::GetEnvironmentVariable(...)»; «Program Files (x86)» sí vale
    const k = p.toLowerCase().replace(/[\\/]+$/, '');
    if (visto.has(k)) continue;
    visto.add(k);
    out.push(p);
  }
  return out.join(';');
}

function refrescar(env = process.env, leer = clave => execFileSync(path.join(env.SystemRoot || 'C:\\Windows', 'System32', 'reg.exe'), ['query', clave, '/v', 'Path'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true })) {
  if (process.platform !== 'win32') return false;
  const extras = [];
  for (const clave of ['HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment', 'HKCU\\Environment']) {
    try { extras.push(deReg(leer(clave))); } catch {}
  }
  const nombre = Object.keys(env).find(k => k.toLowerCase() === 'path') || 'Path';
  env[nombre] = fusionar(env[nombre], extras, env);
  return true;
}

module.exports = { expandir, deReg, fusionar, refrescar };
