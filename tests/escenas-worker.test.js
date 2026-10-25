'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {resolve,seat} = require('../public/escenas');
const worker = require('../worker/worker');
const {Frontera}=require('../lib/frontera');
const os=require('node:os');
const {spawn}=require('node:child_process');

test('V1: escena interior en todas las oficinas, edificio intacto y puestos explícitos', () => {
  assert.equal(resolve({id:'edificio'}).image,'/nave/escena-iso.jpg');
  const office = resolve({id:'redaccion',escena:{puestos:{ana:'escritorio-6'}}});
  assert.equal(office.fixed,false);
  assert.equal(office.image,'/oficina/escena.png');
  assert.deepEqual(seat(office,'ana',0),office.seats[5]);
  assert.equal(office.meeting.length,6);
  assert.ok(office.door);
  assert.equal(office.seats.length, 6);
  assert.equal(office.occluders.length, 8);
  for (const spot of [...office.seats, ...office.coffee, ...office.meeting, office.door, office.elevator, ...office.waypoints]) {
    assert.equal(office.obstacles.some(poly => require('../public/escenas').inside(spot, poly)), false, `punto dentro de un mueble: ${spot}`);
  }
});
test('V1: el camino al café y a la sala no atraviesa escritorios ni la barra', () => {
  const {resolve, route, clearSegment} = require('../public/escenas');
  const scene = resolve({id:'redaccion'});
  assert.equal(clearSegment(scene, scene.seats[0], scene.coffee[0]), false);
  for (const target of [scene.coffee[0], scene.meeting[0], scene.elevator]) {
    const path = route(scene, scene.seats[0], target);
    let at = scene.seats[0];
    path.forEach((point, i) => {
      assert.equal(clearSegment(scene, at, point), true, `tramo ${i} hacia ${target}`);
      at = point;
    });
    assert.deepEqual(path[path.length - 1], target);
  }
  const council = route(scene, scene.seats[0], scene.meeting[0]);
  assert.ok(council.some(p => Math.hypot(p[0] - scene.door[0], p[1] - scene.door[1]) < 1));
});
test('V1: entre cualquier par de destinos hay camino; la recta de reserva nunca cruza un mueble', () => {
  const {resolve, route, clearSegment} = require('../public/escenas');
  const scene = resolve({id:'redaccion'});
  const spots = [...scene.seats, ...scene.coffee, ...scene.meeting, ...scene.chat,
    scene.door, scene.elevator, scene.board, scene.kitchen, scene.console];
  for (const from of spots) for (const to of spots) {
    if (from === to) continue;
    let at = from;
    for (const point of route(scene, from, to)) {
      assert.equal(clearSegment(scene, at, point), true, `${from} → ${to} cruza un mueble en ${at} → ${point}`);
      at = point;
    }
  }
});
test('V1: las 132 poses existen como PNG y no se sustituyen con sprites de la nave', () => {
  for (const name of ['irene','tomas','lucia','kenji','sara','nico']) for (const i of [1,2,3,4,5,6,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30]) {
    const bytes = fs.readFileSync(path.join(__dirname,'../public/oficina',`${name}-${i}.png`));
    assert.equal(bytes.subarray(1,4).toString(),'PNG');
  }
  const report = require('./fixtures/recorte-oficina.json');
  assert.equal(report.sprites.length,132);
  assert.ok(report.sprites.every(s=>s.opaque_magenta === 0));
});
test('S1F: entorno ajeno bloquea antes de ejecutar, incluida diferencia de perfil', async () => {
  const home = process.cwd();
  const fuera = path.join(path.dirname(home), 'perfil-ajeno');
  assert.doesNotThrow(()=>worker.validateEnvironment({USERPROFILE:home}, home));
  assert.doesNotThrow(()=>worker.validateEnvironment({
    USERPROFILE: home,
    APPDATA: path.join(home, 'AppData', 'Roaming'),
    TEMP: path.join(home, 'AppData', 'Local', 'Temp'),
    HOMEDRIVE: path.parse(home).root.replace(/\\$/, ''),
    HOMEPATH: home.slice(path.parse(home).root.length - 1),
  }, home));
  for (const key of ['CLAUDE_CODE_SESSION_ID','ANTHROPIC_API_KEY','OM_SECRET','TOKEN']) {
    assert.throws(()=>worker.validateEnvironment({USERPROFILE:home,[key]:'no'},home),/ENTORNO_AJENO/);
  }
  assert.throws(()=>worker.validateEnvironment({USERPROFILE:home},path.dirname(home)),/ENTORNO_AJENO/);
  // USERPROFILE reescrito no autoriza el APPDATA ni el TEMP del que lanzó el proceso.
  assert.throws(()=>worker.validateEnvironment({USERPROFILE:home, APPDATA:path.join(fuera,'AppData','Roaming')}, home), /ENTORNO_AJENO/);
  assert.throws(()=>worker.validateEnvironment({USERPROFILE:home, TEMP:path.join(fuera,'Temp')}, home), /ENTORNO_AJENO/);
  assert.throws(()=>worker.validateEnvironment({USERPROFILE:home, HOMEDRIVE:'C:', HOMEPATH:'\\Users\\ajeno'}, home), /ENTORNO_AJENO/);
  const limpio = worker.cleanEnvironment({
    USERPROFILE: home, PATH: 'x', OM_SECRET: 'no',
    APPDATA: path.join(fuera, 'AppData', 'Roaming'),
    LOCALAPPDATA: path.join(home, 'AppData', 'Local'),
    TEMP: path.join(fuera, 'Temp'),
    HOMEDRIVE: 'C:', HOMEPATH: '\\Users\\ajeno',
  });
  assert.equal(limpio.OM_SECRET, undefined);
  assert.equal(limpio.APPDATA, undefined);
  assert.equal(limpio.TEMP, undefined);
  assert.equal(limpio.HOMEDRIVE, undefined);
  assert.equal(limpio.LOCALAPPDATA, path.join(home, 'AppData', 'Local'));
  const events = [];
  const result = await worker.runJob({
    cmd: process.execPath,
    args: ['-e', 'console.log(process.env.APPDATA || "sin-appdata")'],
    cwd: __dirname,
  }, {
    root: __dirname,
    env: { USERPROFILE: home, APPDATA: path.join(fuera, 'AppData', 'Roaming'), PATH: process.env.PATH, SystemRoot: process.env.SystemRoot },
    emit: e => events.push(e),
  });
  assert.equal(result.code, 0);
  assert.match(events.map(e => e.text).join(''), /sin-appdata/);
  assert.doesNotMatch(events.map(e => e.text).join(''), /perfil-ajeno/);
});
test('S1F: transporte solo local, token fuera de argv, sin acceso a API del panel', async () => {
  const calls=[];
  const tx=worker.transport('http://127.0.0.1:4400','worker-falso',async (url,opts)=>{calls.push({url,opts});return {ok:true,status:204};});
  await tx('/w/v1/latido',{});
  assert.equal(calls[0].opts.headers.Authorization,'Bearer worker-falso');
  await assert.rejects(tx('/api/oficinas'),/RUTA_WORKER/);
  assert.throws(()=>worker.transport('http://example.com','x'),/SERVIDOR_NO_LOCAL/);
});
test('S1F: CLI falsa ejecuta solo en raíz permitida y no recibe secretos', async () => {
  const events=[];
  const result=await worker.runJob({cmd:process.execPath,args:['-e','console.log(process.env.OM_SECRET || "limpio")'],cwd:__dirname}, {root:__dirname,env:{...process.env,OM_SECRET:'CANARIO'},emit:e=>events.push(e)});
  assert.equal(result.code,0);
  assert.match(events.map(e=>e.text).join(''),/limpio/);
  assert.doesNotMatch(events.map(e=>e.text).join(''),/CANARIO/);
  await assert.rejects(worker.runJob({cmd:process.execPath,args:[],cwd:path.dirname(__dirname)}, {root:__dirname,env:process.env}),/RUTA_FUERA/);
});
test('S1F: scripts preparados exigen Aplicar y ShouldProcess; prueba nunca los ejecuta', () => {
  for (const name of ['crear','quitar']) {
    const script=fs.readFileSync(path.join(__dirname,`../scripts/frontera-${name}.ps1`),'utf8');
    assert.match(script,/SupportsShouldProcess=\$true/);
    assert.match(script,/if \(!\$Aplicar\)/);
    assert.match(script,/\$PSCmdlet.ShouldProcess/);
  }
  const plan = fs.readFileSync(path.join(__dirname,'../scripts/frontera-crear.ps1'),'utf8');
  for (const piece of ['ProgramData', 'OfficeMatrix-Sims', 'worker.token', 'dpapi', 'node.exe']) assert.match(plan, new RegExp(piece, 'i'));
  assert.match(plan, /plan-sin-ejecutar/);
  assert.match(plan, /Remove-LocalUser/);
});
test('S1F-WORKER: token de A nunca accede al turno de B; sin latido se bloquea; reserva espera corte confirmado', () => {
  let now=0;
  const f=new Frontera({now:()=>now}), a='a'.repeat(32), b='b'.repeat(32);
  f.register('a',a);f.register('b',b);
  assert.equal(f.route(a,'/api/oficinas').status,404);
  assert.equal(f.route('incorrecto','/w/v1/trabajo').status,404);
  f.route(a,'/w/v1/latido');f.route(b,'/w/v1/latido');
  f.enqueue('b',{id:'turno-b'});
  assert.equal(f.route(a,'/w/v1/trabajo').status,204);
  assert.equal(f.route(b,'/w/v1/trabajo').body.id,'turno-b');
  assert.equal(f.route(a,'/w/v1/turnos/turno-b/fin',{treeDead:true}).status,404);
  assert.equal(f.route(b,'/w/v1/turnos/turno-b/fin',{treeDead:false}).status,409);
  assert.equal(f.status('b').active,'turno-b');
  assert.equal(f.route(b,'/w/v1/turnos/turno-b/fin',{treeDead:true}).status,204);
  const roto = new Frontera({ onTurno() { throw new Error('motor'); } });
  const tok = 'c'.repeat(32);
  roto.register('c', tok);
  roto.route(tok, '/w/v1/latido');
  roto.enqueue('c', { id: 'turno-c' });
  assert.equal(roto.route(tok, '/w/v1/trabajo').body.id, 'turno-c');
  assert.equal(roto.route(tok, '/w/v1/turnos/turno-c/fin', { treeDead: true }).status, 500);
  assert.equal(roto.status('c').active, 'turno-c');
  now=90001;assert.equal(f.status('b').blocked,true);
  assert.throws(()=>f.enqueue('b',{id:'otro'}),/WORKER_SIN_LATIDO/);
});
test('S1F-COMPROBAR: exclusión, alcance local, canario en log, persistencia e invalidación', async t => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'om-frontera-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const file=path.join(dir,'comprobaciones.jsonl'),f=new Frontera({file}), token='a'.repeat(32);
  f.register('a',token);f.route(token,'/w/v1/latido');
  let release;
  const running=f.check('a',{versions:{node:'v1'},probes:()=>new Promise(r=>release=r)});
  await assert.rejects(f.check('a',{probes:async()=>[]}),/COMPROBACION_EN_CURSO/);
  release([{id:'canario',ok:true}]);await running;
  await assert.rejects(f.check('a',{local:false}),/SOLO_LOCAL/);
  const row=await f.check('a',{versions:{node:'v1'},probes:async()=>[{ok:true}],logs:['secreto CANARIO-X'],canaries:['CANARIO-X']});
  assert.equal(row.estado,'rojo');
  const leakDir=path.join(dir,'salida'); fs.mkdirSync(leakDir); fs.writeFileSync(path.join(leakDir,'notas.txt'),'vio CANARIO-ARCHIVO');
  const hidden=await f.check('a',{versions:{node:'v1'},probes:async()=>[{ok:true}],logs:[],canaries:['CANARIO-ARCHIVO'],roots:[leakDir]});
  assert.equal(hidden.estado,'rojo');
  assert.ok(hidden.archivos.includes('notas.txt'));
  if (process.platform === 'win32') {
    const real = path.join(dir, 'fuera');
    const root = path.join(dir, 'raiz-j');
    fs.mkdirSync(real); fs.mkdirSync(root);
    fs.writeFileSync(path.join(real, 'otro.txt'), 'sin-canario');
    const link = path.join(root, 'puente');
    const mk = require('node:child_process').spawnSync('cmd.exe', ['/c', 'mklink', '/j', link, real], { windowsHide: true });
    assert.equal(mk.status, 0, String(mk.stderr || mk.stdout));
    const via = await f.check('a', { versions: { node: 'v1' }, probes: async () => [{ ok: true }], logs: [], canaries: ['NO-ESTA'], roots: [root] });
    assert.equal(via.estado, 'rojo');
    assert.ok(via.archivos.includes('puente'));
    fs.rmdirSync(link);
  }
  const restarted=new Frontera({file});
  const previas = process.platform === 'win32' ? 4 : 3;
  assert.equal(restarted.history.length, previas);
  assert.equal(restarted.latest('a',{node:'v2'}).estado,'invalidada');
  assert.equal(new Frontera({file}).history.length, previas + 1);
});
// Algunos ejecutores (sandbox de un agente) no dejan matar procesos: taskkill responde
// «Access denied» incluso con un hijo propio. Eso es el entorno, no el programa: se salta
// con el motivo. Cualquier otro fallo de taskkill sigue saliendo en rojo.
async function corteBloqueadoPorEjecutor() {
  if (process.platform !== 'win32') return null;
  const victima = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { stdio: 'ignore', windowsHide: true });
  try {
    const salida = await new Promise((resolve, reject) => {
      const k = spawn('taskkill', ['/pid', String(victima.pid), '/T', '/F'], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
      let texto = '';
      k.stdout.on('data', b => { texto += b; });
      k.stderr.on('data', b => { texto += b; });
      k.once('error', reject);
      k.once('close', code => resolve({ code, texto }));
    });
    if (salida.code !== 0 && /denied|denegado|refus|verweigert|negato/i.test(salida.texto)) return salida.texto.trim();
    return null;
  } finally {
    try { victima.kill(); } catch {}
  }
}
test('S1F: taskkill mata al hijo y al nieto de este proceso', async t => {
  const bloqueo = await corteBloqueadoPorEjecutor();
  if (bloqueo) return t.skip(`este ejecutor no deja matar procesos (taskkill: ${bloqueo}); en una máquina normal la prueba se exige`);
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'om-arbol-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const marker=path.join(dir,'nieto.txt'), grand=path.join(dir,'nieto.js'), child=path.join(dir,'hijo.js');
  fs.writeFileSync(marker,'');
  fs.writeFileSync(grand,'setInterval(() => require("fs").appendFileSync(process.argv[2], "x"), 80);\n');
  fs.writeFileSync(child,'const {spawn}=require("child_process"); const g=spawn(process.execPath,[process.argv[3],process.argv[2]],{stdio:"ignore"}); console.log(String(g.pid)); setInterval(()=>{},1000);\n');
  const parent=spawn(process.execPath,[child,marker,grand],{stdio:['ignore','pipe','inherit']});
  let pid=''; parent.stdout.on('data',b=>{pid+=b;});
  // Si taskkill falla, la aserción debe salir en rojo sin dejar hijos infinitos
  // ni bloquear la suite. Solo limpiamos los PID creados por esta prueba.
  t.after(async () => {
    const grandPid = Number(pid.trim());
    if (Number.isInteger(grandPid) && grandPid > 0) {
      try { process.kill(grandPid); } catch {}
    }
    parent.kill();
    if (parent.exitCode == null && parent.signalCode == null) {
      await new Promise(r => parent.once('exit', r));
    }
  });
  const readyUntil = Date.now() + 5000;
  while ((!pid.trim() || fs.statSync(marker).size === 0) && Date.now() < readyUntil) {
    await new Promise(r=>setTimeout(r,25));
  }
  assert.ok(fs.statSync(marker).size>0, 'el nieto no llegó a escribir');
  await worker.killTree(parent);
  await new Promise(r=>setTimeout(r,400));
  const settled=fs.statSync(marker).size;
  await new Promise(r=>setTimeout(r,400));
  assert.equal(fs.statSync(marker).size, settled, 'el nieto siguió escribiendo después del corte');
  assert.throws(()=>process.kill(Number(pid.trim()),0));
});
test('S1F: watchdog no resuelve antes de confirmar el corte (CLI y corte falsos)', async () => {
  let killed=false;
  const start=Date.now();
  const result=await worker.runJob({cmd:process.execPath,args:['-e','setInterval(()=>{},1000)'],cwd:__dirname,idleMs:100,totalMs:3000}, {
    root:__dirname,env:process.env,
    kill:async child=>{child.kill();await new Promise(r=>setTimeout(r,50));killed=true;},
  });
  assert.equal(killed,true);assert.equal(result.reason,'COLGADA');assert.equal(result.treeDead,true);
  assert.ok(Date.now()-start<3000);
});
test('S1F: bucle de worker valida cuenta y entorno, lee token de archivo y entrega eventos antes de fin', async t => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'om-worker-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const tokenFile=path.join(dir,'worker.token');fs.writeFileSync(tokenFile,'x'.repeat(32));
  const ctrl=new AbortController(),calls=[];
  const options={base:'http://127.0.0.1:4400',tokenFile,root:dir,expectedUser:'om-prueba',account:{username:'om-prueba',homedir:dir},env:{USERPROFILE:dir},signal:ctrl.signal,
    request:async(route,body)=>{calls.push({route,body});if(route==='/w/v1/trabajo')return {id:'turno'};if(route.endsWith('/fin'))ctrl.abort();},
    run:async(job,{emit})=>{emit({type:'stdout',text:'reporte falso'});return {code:0,treeDead:true};}};
  await worker.serve(options);
  assert.deepEqual(calls.map(x=>x.route),['/w/v1/latido','/w/v1/trabajo','/w/v1/turnos/turno/eventos','/w/v1/turnos/turno/fin']);
  assert.equal(calls[2].body.events[0].text,'reporte falso');
  await assert.rejects(worker.serve({...options,expectedUser:'om-otra'}),/CUENTA_AJENA/);
  await assert.rejects(worker.serve({...options,env:{USERPROFILE:dir,ANTHROPIC_API_KEY:'no'}}),/ENTORNO_AJENO/);
});
