// S1F: runtime preparado, NO conectado al lanzamiento de misiones de producción.
// El transporte lo recibe del controlador; jamás recibe la cookie del panel.
'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

// realpath: una junction dentro del perfil que sale hacia otro usuario no cuenta como «dentro».
function canon(p) {
  const abs = path.resolve(String(p));
  try { return fs.realpathSync(abs); } catch { return abs; }
}
function samePath(a, b) {
  return canon(a).toLowerCase() === canon(b).toLowerCase();
}
function underHome(home, value) {
  if (value == null || value === '') return true;
  const rel = path.relative(canon(home).toLowerCase(), canon(value).toLowerCase());
  if (rel === '') return true;
  if (path.isAbsolute(rel)) return false;
  return !rel.split(/[/\\]/).includes('..');
}
// APPDATA, TEMP y el par HOMEDRIVE+HOMEPATH tienen que ser el perfil de la cuenta.
// Copiarlos «porque están en la lista blanca» con USERPROFILE reescrito deja el hogar real de las CLIs.
const PERFIL = ['APPDATA', 'LOCALAPPDATA', 'TEMP', 'TMP'];
function perfilAjeno(env, home) {
  if (!env.USERPROFILE || !samePath(env.USERPROFILE, home)) return true;
  if (PERFIL.some(k => env[k] != null && env[k] !== '' && !underHome(home, env[k]))) return true;
  const drive = env.HOMEDRIVE != null && env.HOMEDRIVE !== '';
  const homePath = env.HOMEPATH != null && env.HOMEPATH !== '';
  if (drive !== homePath) return true;
  if (drive && !samePath(String(env.HOMEDRIVE) + String(env.HOMEPATH), home)) return true;
  return false;
}
function validateEnvironment(env, actualHome = os.userInfo().homedir) {
  if (perfilAjeno(env, actualHome) ||
      Object.keys(env).some(k => /^CLAUDE_CODE_|^CLAUDECODE$|API_KEY|TOKEN|SECRET|PASSWORD/i.test(k))) {
    throw new Error('ENTORNO_AJENO');
  }
}
function cleanEnvironment(env) {
  const out = {};
  const home = env.USERPROFILE;
  for (const k of ['SystemRoot','SYSTEMROOT','windir','ComSpec','PATH','Path','PATHEXT']) {
    if (env[k] != null) out[k] = env[k];
  }
  if (home) out.USERPROFILE = home;
  for (const k of PERFIL) {
    if (home && env[k] != null && env[k] !== '' && underHome(home, env[k])) out[k] = env[k];
  }
  if (home && env.HOMEDRIVE && env.HOMEPATH && samePath(String(env.HOMEDRIVE) + String(env.HOMEPATH), home)) {
    out.HOMEDRIVE = env.HOMEDRIVE;
    out.HOMEPATH = env.HOMEPATH;
  }
  out.CLAUDE_CODE_DISABLE_AUTO_MEMORY = '1';
  out.GROK_MEMORY = '0';
  return out;
}
function inside(root, target) {
  const r = fs.realpathSync(root), t = fs.realpathSync(target), rel = path.relative(r, t);
  if (rel.startsWith('..') || path.isAbsolute(rel)) throw new Error('RUTA_FUERA');
  return t;
}
function killTree(child) {
  return new Promise((resolve, reject) => {
    if (process.platform === 'win32') {
      const killer = spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide:true, stdio:'ignore' });
      killer.once('error', reject);
      killer.once('close', code => code === 0 ? resolve() : reject(new Error('CORTE_NO_CONFIRMADO')));
    } else {
      try { process.kill(-child.pid, 'SIGKILL'); resolve(); } catch (e) { if (e.code === 'ESRCH') resolve(); else reject(e); }
    }
  });
}
async function runJob(job, { root, env, emit = () => {}, kill = killTree }) {
  const cwd = inside(root, job.cwd);
  if (!path.isAbsolute(job.cmd) || !Array.isArray(job.args) || job.args.some(a => typeof a !== 'string')) throw new Error('TRABAJO_INVALIDO');
  const child = spawn(job.cmd, job.args, { cwd, env:cleanEnvironment(env), shell:false, windowsHide:true, detached:process.platform !== 'win32', stdio:['ignore','pipe','pipe'] });
  let idle, total, cutting, reason;
  const stop = cause => {
    if (cutting) return;
    reason = cause;
    cutting = kill(child).then(() => true, () => false);
  };
  const touch = () => { clearTimeout(idle); idle = setTimeout(() => stop('COLGADA'), job.idleMs || 180000); };
  touch(); total = setTimeout(() => stop('TIEMPO_AGOTADO'), job.totalMs || 1800000);
  for (const [name, stream] of [['stdout',child.stdout], ['stderr',child.stderr]]) stream.on('data', b => { touch(); emit({type:name, text:b.toString().slice(0,65536)}); });
  return new Promise(resolve => {
    let done = false;
    const finish = async (code, error) => {
      if (done) return; done = true;
      clearTimeout(idle); clearTimeout(total);
      const killed = cutting ? await cutting : null;
      // Nunca liberar una reserva si no se confirmó el corte del árbol.
      resolve({ code, error:error?.message, reason, treeDead: cutting ? killed : true });
    };
    child.once('error', e => finish(null,e)); child.once('close', code => finish(code));
  });
}
function transport(base, token, fetcher = fetch) {
  const url = new URL(base);
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.username || url.password) throw new Error('SERVIDOR_NO_LOCAL');
  return async (route, body) => {
    if (!/^\/w\/v1\//.test(route) || route.includes('..')) throw new Error('RUTA_WORKER');
    const res = await fetcher(new URL(route,url), { method:body === undefined ? 'GET':'POST', headers:{Authorization:`Bearer ${token}`, 'Content-Type':'application/json'}, body:body === undefined ? undefined:JSON.stringify(body), redirect:'error', signal:AbortSignal.timeout(30000) });
    if (!res.ok) throw new Error(`WORKER_HTTP_${res.status}`);
    return res.status === 204 ? null : res.json();
  };
}
// El token se lee desde archivo protegido: no se acepta en argv ni en el entorno.
async function serve({ base, tokenFile, root, expectedUser, account = os.userInfo(), env = process.env, signal, request, run = runJob }) {
  if (!/^om-[a-z0-9-]+$/.test(expectedUser || '') || account.username.toLowerCase() !== expectedUser.toLowerCase()) throw new Error('CUENTA_AJENA');
  validateEnvironment(env, account.homedir);
  const token = fs.readFileSync(tokenFile,'utf8').trim();
  if (token.length < 32) throw new Error('TOKEN_INVALIDO');
  const tx = request || transport(base, token);
  let alive = true, heartbeatError;
  const heartbeat = async () => {
    try { await tx('/w/v1/latido', {}); } catch (e) { heartbeatError=e; alive=false; }
  };
  await heartbeat();
  if (!alive) throw heartbeatError;
  const timer = setInterval(heartbeat,15000);
  try {
    while (alive && !signal?.aborted) {
      const job = await tx('/w/v1/trabajo');
      if (!job) { await new Promise(r=>setTimeout(r,100)); continue; }
      const events=[];
      let bytes=0;
      const result = await run(job,{root,env,emit:event=>{
        const size=Buffer.byteLength(JSON.stringify(event));
        if(events.length<10000 && bytes+size<=4e6) {events.push(event);bytes+=size;}
      }});
      const id=encodeURIComponent(job.id);
      // Un único lote ordenado evita promesas de eventos huérfanas después de fin.
      await tx(`/w/v1/turnos/${id}/eventos`,{events});
      await tx(`/w/v1/turnos/${id}/fin`,result);
      if (!result.treeDead) throw new Error('CORTE_NO_CONFIRMADO');
    }
    if (heartbeatError) throw heartbeatError;
  } finally { clearInterval(timer); }
}
module.exports = { validateEnvironment, cleanEnvironment, inside, runJob, killTree, transport, serve };
