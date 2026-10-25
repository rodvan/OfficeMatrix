// Controlador S1F desacoplado, probado con falsos. No habilita nivel cuenta en server.js.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const hash = s=>crypto.createHash('sha256').update(s).digest('hex');

class Frontera {
  // onTurno recibe {oficina,id,events,result} cuando el worker confirma el corte: es la entrada del motor.
  constructor({file, now=Date.now, onTurno=()=>{}} = {}) {
    this.now=now; this.file=file; this.onTurno=onTurno; this.workers=new Map(); this.tokens=new Map(); this.checking=new Set();
    this.history=file && fs.existsSync(file) ? fs.readFileSync(file,'utf8').trim().split('\n').filter(Boolean).map(JSON.parse) : [];
  }
  register(id,token) {
    if (token.length<32 || this.workers.has(id)) throw new Error('WORKER_DUPLICADO_O_TOKEN_INVALIDO');
    const digest=hash(token);
    if (this.tokens.has(digest)) throw new Error('TOKEN_DUPLICADO');
    this.tokens.set(digest,id);
    this.workers.set(id,{last:null,queue:[],active:null,events:[]});
  }
  scope(token) { return this.tokens.get(hash(token || '')); }
  status(id) {
    const w=this.workers.get(id);
    return {blocked:!w || w.last === null || this.now()-w.last>=90000, active:w?.active?.id || null};
  }
  enqueue(id,job) {
    const w=this.workers.get(id);
    if(this.status(id).blocked) throw new Error('WORKER_SIN_LATIDO');
    if(!job.id || w.queue.some(x=>x.id===job.id) || w.active?.id===job.id) throw new Error('TURNO_DUPLICADO');
    w.queue.push(structuredClone(job));
  }
  route(token,route,body) {
    const id=this.scope(token), w=this.workers.get(id);
    if(!w || !route.startsWith('/w/v1/')) return {status:404};
    if(route==='/w/v1/latido') { w.last=this.now();return {status:204}; }
    if(route==='/w/v1/trabajo') {
      if(this.status(id).blocked) return {status:409};
      if(w.active) return {status:204};
      w.active=w.queue.shift() || null;
      return w.active ? {status:200,body:structuredClone(w.active)} : {status:204};
    }
    const m=/^\/w\/v1\/turnos\/([^/]+)\/(eventos|fin)$/.exec(route);
    if(!m || decodeURIComponent(m[1])!==w.active?.id) return {status:404};
    if(m[2]==='eventos') {
      if(!Array.isArray(body?.events) || w.events.length+body.events.length>10000) return {status:400};
      w.events.push(...body.events); return {status:204};
    }
    if(body?.treeDead!==true) return {status:409};
    // Si el motor rechaza el turno, el worker no puede creer que terminó: el turno sigue activo.
    const done={oficina:id,id:w.active.id,events:structuredClone(w.events),result:structuredClone(body)};
    try { this.onTurno(done); } catch { return {status:500}; }
    w.active=null;w.events=[];
    return {status:204};
  }
  persist(row) {
    if(this.file) {fs.mkdirSync(path.dirname(this.file),{recursive:true});fs.appendFileSync(this.file,JSON.stringify(row)+'\n');}
    this.history.push(row);
    return row;
  }
  async check(id,{local=true,versions,probes,logs=[],canaries=[],roots=[]}={}) {
    if(!local) throw new Error('SOLO_LOCAL');
    if(this.checking.has(id)) throw new Error('COMPROBACION_EN_CURSO');
    if(this.status(id).blocked) throw new Error('WORKER_SIN_LATIDO');
    if(this.status(id).active) throw new Error('MISION_EN_CURSO');
    this.checking.add(id);
    try {
      const results=await probes();
      const files=leerCanarios(roots, canaries);
      const leaked=canaries.some(c=>c && logs.some(l=>String(l).includes(c))) || files.length>0;
      return this.persist({id:crypto.randomUUID(),oficina:id,fecha:this.now(),versions,estado:results.length && results.every(x=>x.ok===true) && !leaked ? 'verde':'rojo',sondas:results,fugaEnLogs:leaked,archivos:files.map(f=>path.basename(f))});
    } finally {this.checking.delete(id);}
  }
  latest(id,versions) {
    const last=this.history.findLast(x=>x.oficina===id);
    if(!last || last.estado==='invalidada' || JSON.stringify(last.versions)===JSON.stringify(versions)) return last;
    return this.persist({...last,fecha:this.now(),estado:'invalidada',motivo:'versiones o ACL cambiaron',versions});
  }
}
// Lee todos los archivos bajo roots. Un canario que la sonda no declaró igual deja la comprobación en rojo.
function leerCanarios(roots, canaries) {
  const needles=(canaries||[]).filter(Boolean).map(c=>Buffer.from(String(c)));
  const found=[];
  const walk=dir=>{
    let entries; try { entries=fs.readdirSync(dir,{withFileTypes:true}); } catch { return; }
    for (const ent of entries) {
      const p=path.join(dir, ent.name);
      // En Windows una junction a veces no sale como symlink en el Dirent. lstat sí la ve, y no se sigue.
      let reparse=ent.isSymbolicLink();
      if (!reparse) { try { reparse=fs.lstatSync(p).isSymbolicLink(); } catch { reparse=false; } }
      if (reparse) { found.push(p); continue; }
      if (ent.isDirectory()) walk(p);
      else {
        let buf; try { buf=fs.readFileSync(p); } catch { continue; }
        if (needles.some(n=>n.length && buf.includes(n))) found.push(p);
      }
    }
  };
  for (const root of roots||[]) if (root && fs.existsSync(root)) walk(root);
  return found;
}
module.exports={Frontera, leerCanarios};
