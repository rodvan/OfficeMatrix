const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');

// Ejecutar las funciones de carga reales con respuestas HTTP deliberadamente fuera de orden.
test('S1-UI: una respuesta de A no repinta misiones, empleados, memoria ni entrantes de B', async () => {
  const source=fs.readFileSync(require.resolve('../public/app'),'utf8');
  const pending=[];
  const nodes=new Map();
  const context={api:()=>new Promise(r=>pending.push(r)),$:id=>{if(!nodes.has(id))nodes.set(id,{});return nodes.get(id);},
    esc:String,renderChats(){},loadInbound(){}, t: require('../lib/i18n').t};
  vm.createContext(context);
  vm.runInContext('let officeEpoch=0,chats=[],agents=[],globalCfg={},workflowsMeta=[];',context);
  for (const name of ['loadChats','loadAgents','loadMemory','loadInbound']) {
    const start=source.indexOf(`async function ${name}(`), end=source.indexOf('\n}',start)+2;
    vm.runInContext(source.slice(start,end),context);
  }
  for (const [name,a,b,read] of [
    ['loadChats',[{id:'A'}],[{id:'B'}],'chats[0].id'],
    ['loadAgents',{agents:[{id:'A'}]},{agents:[{id:'B'}]},'agents[0].id'],
    ['loadMemory',[{name:'A.md',versions:0,size:1,entries:1}],[{name:'B.md',versions:0,size:1,entries:1}],null],
    ['loadInbound',[{archivo:'A',desde:'A',content:'a\nb\nc\nd'}],[{archivo:'B',desde:'B',content:'a\nb\nc\nd'}],null],
  ]) {
    // loadMemory encadena entrantes; se verifica por separado abajo.
    const original=context.loadInbound;
    if(name==='loadMemory')context.loadInbound=()=>{};
    const old=context[name]();const oldResolve=pending.shift();
    vm.runInContext('officeEpoch++',context);
    const fresh=context[name]();const newResolve=pending.shift();
    newResolve(b);await fresh;
    oldResolve(a);await old;
    if(read) assert.equal(vm.runInContext(read,context),'B');
    else assert.doesNotMatch(nodes.get(name==='loadMemory'?'memory':'inbound').innerHTML, name==='loadMemory'?/A\.md/:/data-file="A"/);
    context.loadInbound=original;
  }
});
test('S1-UI: el editor recuerda la época y se cierran todos los diálogos al cambiar de oficina', () => {
  const source = fs.readFileSync(require.resolve('../public/app'), 'utf8');
  assert.match(source, /editing\.epoch !== officeEpoch/);
  assert.match(source, /for \(const dlgId of \['editor', 'viewer', 'officeDialog', 'empDialog', 'xferDialog', 'simWizard', 'tplDialog', 'editorialDialog', 'decisionDialog'\]\)/);
  const css = fs.readFileSync(require.resolve('../public/style.css'), 'utf8');
  assert.match(css, /@media \(max-width: 760px\)/);
  // Las tarjetas van en una franja bajo la escena (ya no se colocan a los lados ni tapan la oficina).
  assert.doesNotMatch(css, /\.deck\.nave \.station:nth-child/);
  assert.match(css, /\.deck\.nave \.stations \{ grid-template-columns: repeat\(auto-fit, minmax\(100px, 1fr\)\); \}/);
  assert.match(css, /\.ops\s*\{\s*overflow-y:\s*auto;\s*\}/);
  assert.match(css, /\.board\s*\{\s*min-height:\s*380px;\s*\}/);
  assert.match(css, /\.composer\.compact[^{}]*\.cycle-config/);
});
test('S1-UI: una ficha o un traspaso que llegan tarde no se abren ni se guardan en la oficina nueva', async () => {
  const source = fs.readFileSync(require.resolve('../public/app'), 'utf8');
  const slice = name => {
    const start = source.indexOf(`async function ${name}(`);
    assert.ok(start > 0, name);
    return source.slice(start, source.indexOf('\n}', start) + 2);
  };
  const opened = [];
  const calls = [];
  const nodes = new Map();
  const blank = () => ({ showModal() { opened.push('open'); }, close() { opened.push('close'); }, innerHTML: '', textContent: '', value: '' });
  const context = {
    officeNow: () => ({ id: context.oficina, nombre: context.oficina.toUpperCase(), empleados: [{ id: 'irene', nombre: 'Irene', puesto: 'Directora', modelo: { cli: 'claude', id: 'opus' } }] }),
    esc: s => String(s ?? ''),
    agentOf: () => ({ color: '#fff' }),
    stationStats: () => null,
    modelText: () => 'claude opus',
    empFieldsHtml: () => '<div>ficha</div>',
    toast() { opened.push('toast'); },
    readEmp: (_root, prev) => ({ ...prev, nombre: 'Irene editada' }),
    loadOffices: async () => { calls.push('loadOffices'); },
    loadAgents: async () => { calls.push('loadAgents'); },
    fillComposerFromConfig() { calls.push('fill'); },
    renderStations() { calls.push('stations'); },
    current: null,
    currentId: null,
    t: require('../lib/i18n').t,
    $: id => { if (!nodes.has(id)) nodes.set(id, blank()); return nodes.get(id); },
  };
  vm.createContext(context);
  vm.runInContext('var officeEpoch=0, oficina="a", oficinas=[{id:"a",nombre:"A"},{id:"b",nombre:"B"}], editing={name:"lecciones.md",epoch:0}, empEditing=null, xferEpoch=0;', context);
  vm.runInContext(slice('openEmployee'), context);
  vm.runInContext(slice('openXfer'), context);
  vm.runInContext(slice('saveEmployee'), context);

  context.loadModels = async () => { context.officeEpoch++; context.oficina = 'b'; };
  await context.openEmployee('irene');
  assert.equal(opened.includes('open'), false, 'la ficha de A no se abre sobre B');
  assert.equal(nodes.has('empDialog'), false);

  context.officeEpoch = 0; context.oficina = 'a'; opened.length = 0;
  context.loadModels = async () => {};
  await context.openEmployee('irene');
  assert.ok(opened.includes('open'));
  assert.equal(context.empEditing.officeId, 'a');

  context.officeEpoch = 0; context.oficina = 'a'; context.editing = { name: 'lecciones.md', epoch: 0 }; opened.length = 0; nodes.clear();
  context.api = async url => { calls.push(url); context.officeEpoch++; context.oficina = 'b'; return [{ index: 0, text: 'CANARIO-DE-A' }]; };
  await context.openXfer();
  assert.equal(opened.includes('open'), false, 'el traspaso de A no se abre sobre B');
  assert.equal(nodes.has('xferList'), false, 'las entradas de A no se pintan en B');

  context.officeEpoch = 0; context.oficina = 'a';
  context.empEditing = { id: 'irene', officeId: 'a', epoch: 0 };
  calls.length = 0;
  context.api = async url => { calls.push(url); context.officeEpoch++; context.oficina = 'b'; return {}; };
  await context.saveEmployee();
  assert.ok(calls.includes('/api/oficinas/a'), 'el PATCH sale hacia la oficina de la ficha');
  assert.equal(calls.includes('fill'), false, 'no rehace el compositor de la oficina nueva');
  assert.equal(calls.includes('stations'), false);
});
test('HOY-UI: el tablero de A no se pinta en B y escapa los títulos de las misiones', async () => {
  const source = fs.readFileSync(require.resolve('../public/app'), 'utf8');
  const pending = [];
  const painted = [];
  const context = { api: () => new Promise(r => pending.push(r)), current: null, agentOf: () => ({ color: '#fff' }),
    fmtTokens: n => String(n), renderReports() { painted.push(context.getHoy()?.oficina.id); },
    t: require('../lib/i18n').t };
  vm.createContext(context);
  vm.runInContext("let officeEpoch=0, oficina='a', hoyData=null, hoyDia=null; var esc = s => String(s ?? '').replace(/[&<>\"']/g, c => '&#' + c.charCodeAt(0) + ';');", context);
  for (const name of ['loadHoy', 'hoyHtml']) {
    const start = source.search(new RegExp(`(async )?function ${name}[(]`)), end = source.indexOf('\n}', start) + 2;
    vm.runInContext(source.slice(start, end), context);
  }
  vm.runInContext('globalThis.getHoy = () => hoyData; globalThis.go = id => { oficina = id; officeEpoch++; };', context);
  const board = id => ({ dia: '2026-10-23', hoy: true, fecha: 'viernes 23 oct', zona: 'UTC', oficina: { id, nombre: id.toUpperCase() }, frontera: { texto: 'contexto' },
    gasto: { turnos: 1, turnosMedidos: 0, desconocidos: 1, tokens: 0, minutos: 1 }, esperan: [], aprendido: [], atencion: [], proximo: { texto: 'S2' },
    hecho: [{ chatId: 'm1', hora: '10:00', icono: '✅', titulo: '<img src=x onerror=alert(1)>', texto: 'aprobada por todos', turnos: 2, nota: 9, quien: ['Irene'], estado: 'unanime' }],
    equipo: [{ id: 'irene', nombre: 'Irene', puesto: 'Directora', modelo: 'claude opus', activo: true, turnos: 1, nota: 9, ultimo: { hora: '10:00', titulo: 'x', veredicto: 'APROBADO' } }] });
  const old = context.loadHoy(); const oldResolve = pending.shift();
  context.go('b');
  const fresh = context.loadHoy(); const newResolve = pending.shift();
  newResolve(board('b')); await fresh;
  oldResolve(board('a')); await old;
  assert.equal(context.getHoy().oficina.id, 'b');
  assert.deepEqual(painted, ['b'], 'la respuesta tardía de A no repinta');
  const html = context.hoyHtml();
  assert.doesNotMatch(html, /<img/);
  assert.match(html, /data-open-chat="m1"/);
  assert.match(html, /data-emp="irene"/);
  assert.match(html, /(?:1 con uso desconocido|1 with unknown usage)/);
  assert.match(html, /(?:ESPERAN TU DECISIÓN|AWAITING YOUR DECISION) <b>\(0\)<\/b>/);
});
test('S1-UI: la ficha pinta no_hace y poderes mal tipados sin lanzar', () => {
  const source = fs.readFileSync(require.resolve('../public/app'), 'utf8');
  const start = source.indexOf('let modelCatalog');
  const end = source.indexOf('function readEmp');
  assert.ok(start > 0 && end > start);
  const context = { esc: s => String(s ?? ''), Escenas: require('../public/escenas'), t: require('../lib/i18n').t };
  vm.createContext(context);
  vm.runInContext(source.slice(start, end), context);
  vm.runInContext('modelCatalog = [{ id: "claude", name: "Claude", kind: "claude", installed: true, modelos: ["opus"] }]', context);
  const bad = context.empFieldsHtml({ nombre: 'X', puesto: 'P', modelo: { cli: 'claude', id: 'opus' }, no_hace: 'publicar', poderes: { includes: true } });
  assert.match(bad, /name="no_hace"[^>]*value="publicar"/);
  assert.doesNotMatch(bad, /value="vetar" checked/);
  const one = context.empFieldsHtml({ nombre: 'X', puesto: 'P', modelo: { cli: 'claude', id: 'opus' }, no_hace: ['a', 'b'], poderes: 'vetar' });
  assert.match(one, /value="a; b"/);
  assert.match(one, /value="vetar" checked/);
  // Personaje: automático por defecto; el elegido sale marcado; cada selector tiene su propio grupo (el asistente pinta varios).
  assert.match(one, /value="" checked>/);
  const team = [{ id: 'a', nombre: 'Ana', avatar: { base: 'irene' } }, { id: 'b', nombre: 'Bea' }];
  const chosen = context.empFieldsHtml({ ...team[0], puesto: 'P', modelo: { cli: 'claude', id: 'opus' } }, team);
  assert.match(chosen, /value="irene" checked/);
  const auto = context.empFieldsHtml({ ...team[1], puesto: 'P', modelo: { cli: 'claude', id: 'opus' } }, team);
  assert.match(auto, /(?:Automático|Automatic) \(lider\)/);
  assert.match(auto, /irene · (?:ya lo lleva|already used by) Ana/);
  const groups = [chosen, auto].map(h => /name="(avatar-\d+)"/.exec(h)[1]);
  assert.notEqual(groups[0], groups[1]);
});


test('misiones: muestra el motivo sin aprobar y no arrastra la meseta al ciclo en curso', () => {
  const source = fs.readFileSync(require.resolve('../public/app'), 'utf8');
  const start = source.indexOf('function renderChats(');
  const nodes = new Map();
  const context = { chats: [
    { id: 'a', title: 'A', outcome: 'partial', stopReason: 'meseta', turns: 4 },
    { id: 'b', title: 'B', outcome: 'partial', stopReason: 'retroceso', turns: 4 },
    { id: 'c', title: 'C', outcome: 'partial', stopReason: 'agotado', turns: 4 },
    { id: 'd', title: 'D', outcome: 'running', stopReason: 'meseta', turns: 5 },
    { id: 'e', title: 'E', outcome: 'partial', turns: 1 },
  ], currentId: null, esc: String, $: id => {
    if (!nodes.has(id)) nodes.set(id, { value: '' });
    return nodes.get(id);
  } };
  context.t = require('../lib/i18n').t;
  vm.createContext(context);
  vm.runInContext(source.slice(start, source.indexOf('\n}', start) + 2), context);
  context.renderChats();
  const html = nodes.get('chatList').innerHTML;
  assert.match(html, /PLATEAU · NOT APPROVED/);
  assert.match(html, /REGRESSION · NOT APPROVED/);
  assert.match(html, /CAP · NOT APPROVED/);
  assert.match(html, /state running">IN PROGRESS/);
  assert.match(html, /state partial">OPEN/);
  assert.equal((html.match(/PLATEAU/g) || []).length, 1);
});

test('Charts.convergence: la misma media que roundMean, sin autonota ni ronda a medias', () => {
  const Charts = require('../public/charts');
  const { roundMean } = require('../lib/cycle');
  assert.equal(typeof Charts.convergence, 'function');
  const meanOf = html => (html.match(/data-round-mean="([^"]*)"/) || [, ''])[1];

  // 1) Sin notas
  const empty = Charts.convergence([], 9, 500);
  assert.match(empty, /(?:Aún no hay rondas con notas|No scored rounds yet)/);

  // 2) La autonota no entra. Un ERROR anula la ronda entera: no se promedia el resto.
  const r1 = Charts.convergence([
    { round: 1, agentId: 'a', score: 8, verdict: 'CAMBIOS' },
    { round: 1, agentId: 'b', score: 9, verdict: 'CAMBIOS' },
    { round: 1, agentId: 'c', score: 10, verdict: 'APROBADO', self: true },
  ], 9, 500, { expected: 3 });
  assert.match(r1, /(?:Convergencia por ronda|Round convergence)/);
  assert.match(r1, /(?:Ronda|Round) 1/);
  assert.match(r1, />8\.5<\/text>/);
  assert.equal(meanOf(r1), `1:${roundMean([
    { round: 1, score: 8, verdict: 'CAMBIOS' },
    { round: 1, score: 9, verdict: 'CAMBIOS' },
    { round: 1, score: 10, verdict: 'APROBADO', self: true },
  ], 1, 3)}`);

  const cut = Charts.convergence([
    { round: 1, agentId: 'a', score: 8, verdict: 'CAMBIOS' },
    { round: 1, agentId: 'b', score: 9, verdict: 'CAMBIOS' },
    { round: 1, agentId: 'd', score: 3, verdict: 'ERROR' },
  ], 9, 500, { expected: 3 });
  assert.match(cut, /(?:anula la media|voids the average)/);
  assert.doesNotMatch(cut, />8\.5<\/text>/);
  assert.equal(roundMean([
    { round: 1, score: 8, verdict: 'CAMBIOS' },
    { round: 1, score: 9, verdict: 'CAMBIOS' },
    { round: 1, score: 3, verdict: 'ERROR' },
  ], 1, 3), null);

  const partial = Charts.convergence([
    { round: 1, score: 8, verdict: 'CAMBIOS' },
    { round: 1, score: 9, verdict: 'PARCIAL' },
  ], 9, 500);
  assert.match(partial, /(?:anula la media|voids the average)/);

  // 3) Meseta (cambio < 0.5) y el sello coincide con el motor.
  const plateauTurns = [
    { round: 1, agentId: 'a', score: 8, verdict: 'CAMBIOS' },
    { round: 1, agentId: 'b', score: 8, verdict: 'CAMBIOS' },
    { round: 2, agentId: 'a', score: 8, verdict: 'CAMBIOS' },
    { round: 2, agentId: 'b', score: 8.3, verdict: 'CAMBIOS' },
  ];
  const plateau = Charts.convergence(plateauTurns, 9, 500, { expected: 2 });
  assert.match(plateau, /(?:Meseta|Plateau)/);
  assert.match(plateau, /(?:umbral meseta ±0,5|plateau threshold ±0\.5)/);
  assert.equal(meanOf(plateau), `1:${roundMean(plateauTurns, 1, 2)},2:${roundMean(plateauTurns, 2, 2)}`);

  // 4) Retroceso (caída >= 0.5), también si la media sigue sobre la nota mínima.
  const regression = Charts.convergence([
    { round: 1, agentId: 'a', score: 8.5, verdict: 'CAMBIOS' },
    { round: 2, agentId: 'a', score: 7.2, verdict: 'CAMBIOS' },
  ], 9, 500);
  assert.match(regression, /(?:Retroceso|Regression)/);
  assert.match(regression, /(?:bajó 1\.3 pts|dropped 1\.3 pts)/);
  const above = Charts.convergence([
    { round: 1, score: 9.5, verdict: 'CAMBIOS' },
    { round: 2, score: 9, verdict: 'CAMBIOS' },
  ], 9, 500);
  assert.match(above, /(?:Retroceso|Regression)/);
  assert.doesNotMatch(above, /(?:Meta alcanzada|Goal reached)/);

  // 5) Meta solo cuando la comparación no es meseta ni retroceso.
  const goal = Charts.convergence([
    { round: 1, agentId: 'a', score: 8.5, verdict: 'CAMBIOS' },
    { round: 2, agentId: 'a', score: 9.2, verdict: 'APROBADO' },
  ], 9, 500);
  assert.match(goal, /(?:Meta alcanzada|Goal reached)/);
  assert.match(goal, /9\.2 ≥ 9/);

  // 6) Consejo: la síntesis no sube la media. Delphi: el borrador tampoco.
  const consejo = [
    { round: 1, phase: 'sintesis', score: 10, verdict: 'CAMBIOS', agentId: 'chair' },
    { round: 1, phase: 'aprobacion', score: 8, verdict: 'CAMBIOS', agentId: 'a' },
    { round: 1, phase: 'aprobacion', score: 8, verdict: 'CAMBIOS', agentId: 'b' },
    { round: 2, phase: 'sintesis', score: 10, verdict: 'CAMBIOS', agentId: 'chair' },
    { round: 2, phase: 'aprobacion', score: 8, verdict: 'CAMBIOS', agentId: 'a' },
    { round: 2, phase: 'aprobacion', score: 8.4, verdict: 'CAMBIOS', agentId: 'b' },
  ];
  const consejoHtml = Charts.convergence(consejo, 9, 500, { workflow: 'consejo', expected: 2 });
  const votos = consejo.filter(t => t.phase === 'aprobacion');
  assert.match(consejoHtml, /(?:Meseta|Plateau)/);
  assert.equal(meanOf(consejoHtml), `1:${roundMean(votos, 1, 2)},2:${roundMean(votos, 2, 2)}`);
  assert.doesNotMatch(consejoHtml, /class="end"[^>]*>10</);
  const delphi = Charts.convergence([
    { round: 1, phase: 'borrador', score: 10, verdict: 'CAMBIOS' },
    { round: 1, phase: 'revision', score: 7, verdict: 'CAMBIOS' },
  ], 9, 500, { workflow: 'delphi', expected: 1 });
  assert.equal(meanOf(delphi), '1:7');

  // 7) Ronda a medias: no se pinta su nota ni se llama meta.
  const mid = Charts.convergence([
    { round: 1, score: 8, verdict: 'CAMBIOS', agentId: 'a' },
    { round: 1, score: 8, verdict: 'CAMBIOS', agentId: 'b' },
    { round: 2, score: 9.5, verdict: 'APROBADO', agentId: 'a' },
  ], 9, 500, { expected: 2 });
  assert.match(mid, /(?:Sin media en R2|No average in R2)/);
  assert.doesNotMatch(mid, /(?:Meta alcanzada|Goal reached)/);
  assert.equal(meanOf(mid), '1:8');

  // 8) Dos ciclos no se mezclan: manda el último.
  const mixed = Charts.convergence([
    { cycle: 1, round: 1, score: 6, verdict: 'CAMBIOS' },
    { cycle: 2, round: 1, score: 8, verdict: 'CAMBIOS' },
    { cycle: 2, round: 2, score: 8, verdict: 'CAMBIOS' },
  ], 9, 500);
  assert.equal(meanOf(mixed), '1:8,2:8');
  assert.match(mixed, /(?:Meseta|Plateau)/);

  const app = fs.readFileSync(require.resolve('../public/app'), 'utf8');
  assert.match(app, /Charts\.convergence\(chartTurns,/);
  assert.match(app, /workflow: wf, expected/);
});
