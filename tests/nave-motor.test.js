// Contrato del motor con DOM mínimo. La revisión de píxeles en navegador es una comprobación separada.
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const Escenas = require('../public/escenas');

class Element {
  constructor() {
    this.children=[]; this.parts={}; this.dataset={}; this.style={setProperty(){}}; this.attrs={}; this.className='';
    this.classList={ contains:n=>this.className.split(' ').includes(n), add:()=>{}, remove:()=>{}, toggle:()=>{} };
  }
  set innerHTML(html) {
    this.parts={};
    for (const cls of ['stage','room','body','emote','say','tag','aviso']) if (html.includes(`class="${cls}"`)) {
      const el = new Element(); this.parts['.'+cls]=el; el.parentElement=this; this.children.push(el);
    }
    if (this.parts['.stage'] && this.parts['.room']) {
      this.parts['.stage'].parts['.room']=this.parts['.room'];
    }
  }
  querySelector(k) { return this.parts[k] || this.children.find(x=>'.'+x.className===k) || null; }
  appendChild(el) { this.children.push(el); el.parentElement=this; }
  remove() { if(this.parentElement) this.parentElement.children=this.parentElement.children.filter(e=>e!==this); }
  replaceChildren(...els) { this.children=[]; for (const el of els) this.appendChild(el); }
  setAttribute(k,v) { this.attrs[k]=v; }
  getAttribute(k) { return this.attrs[k]; }
  addEventListener() {}
  before(el) { this.previous=el; }
}
function motor() {
  const elements={stations:new Element(),deck:new Element(),viewBtn:new Element()};
  let frame;
  const context={window:{},t:require('../lib/i18n').t,Escenas,performance:{now:()=>0},localStorage:{getItem:()=>null,setItem(){}},
    document:{hidden:false,createElement:()=>new Element(), getElementById:id=>elements[id],addEventListener(){}},
    requestAnimationFrame:fn=>{frame=fn;return 1;}, Image:class{},setTimeout,clearTimeout};
  vm.runInNewContext(fs.readFileSync(require.resolve('../public/nave'),'utf8'),context);
  const api=context.window.Nave; api.init();
  const stage=elements.stations.previous.querySelector('.stage');
  return {api,stage,elements,step:t=>frame(t)};
}
test('V1 motor: entrar, caminar, Consejo y volver conservan un único motor sin actores de otra oficina', () => {
  const {api,stage,elements,step}=motor();
  let destination;
  const offices=[{id:'edificio',nombre:'Edificio'},{id:'redaccion',nombre:'Redacción'}];
  const staff=Array.from({length:6},(_,i)=>({id:'empleado'+i,name:'Persona '+i,modeloLabel:'CLI modelo',cls:'working'}));
  api.setOffice(offices[1],offices,id=>destination=id); api.sync(staff);
  assert.equal(stage.dataset.scene,'oficina');
  assert.equal(stage.children.filter(e=>e.className==='occluder').length,8);
  assert.ok(stage.children.some(e=>e.dataset.layer==='cristal' && Number(e.style.zIndex)===460));
  // Los seis empleados más el operador y la sabia, que también viven en cada oficina.
  assert.equal(stage.children.filter(e=>e.className.startsWith('actor')).length,8);
  step(100); step(500);
  assert.ok(stage.children.filter(e=>e.parts['.body']).every(e=>e.parts['.body'].attrs.src.startsWith('/oficina/')));
  // Sin personaje propio, cada empleado lleva un tripulante de la nave con su ropa de oficina.
  const srcs=stage.children.filter(e=>e.parts['.body']).map(e=>e.parts['.body'].attrs.src);
  for (const av of ['lider','elegido','piloto','capitana','operador','sabia']) assert.ok(srcs.some(s=>s.startsWith(`/oficina/${av}-`)), av);
  api.setCouncil(true); step(1000);
  assert.equal(stage.dataset.council,'true');
  const nav=elements.stations.previous.querySelector('.elevators');
  nav.children[0].onclick(); assert.equal(destination,'edificio');
  api.setOffice(offices[0],offices,id=>destination=id); api.sync([{id:'claude',name:'Claude',cls:'ready'}]);
  assert.equal(stage.dataset.scene,'nave');
  assert.equal(stage.children.filter(e=>e.className.startsWith('actor')).length,3);
  nav.children[0].onclick(); assert.equal(destination,'redaccion');
});

test('PERSONAJE: la tripulación es el reparto por defecto, la ficha elige y nadie sale repetido en la escena', () => {
  const r = Escenas.reparto([{ id: 'a' }, { id: 'b', avatar: 'lider' }, { id: 'c', avatar: 'neo' }, { id: 'd', avatar: 'irene' }]);
  assert.deepEqual({ ...r }, { b: 'lider', d: 'irene', a: 'elegido', c: 'piloto' });
  const {api,stage,step}=motor();
  const offices=[{id:'edificio',nombre:'Edificio'},{id:'redaccion',nombre:'Redacción'}];
  api.setOffice(offices[1],offices,()=>{});
  const team=[{id:'irene',name:'Irene Vidal',avatar:'lider',cls:'working'},{id:'sara',name:'Sara Quintero',avatar:'operador',cls:'ready',queued:true},
    {id:'nico',name:'Nico Ferrer',cls:'off'},{id:'nico2',name:'Nico Pardo',cls:'ready',queued:true}];
  api.sync(team); step(100); step(400);
  const actors=()=>stage.children.filter(e=>e.className.startsWith('actor'));
  // Sara lleva al operador: el operador de la consola no sale. La sabia sí.
  assert.equal(actors().length, 5);
  const tags=actors().map(e=>e.parts['.tag'].textContent);
  const tr = require('../lib/i18n').t;
  const sage = tr('ui.avatar.sabia').toUpperCase();
  const operator = tr('ui.avatar.operador').toUpperCase();
  assert.ok(tags.includes('IRENE') && tags.includes('SARA') && tags.includes(sage) && !tags.some(x => x.startsWith(operator)), tags.join());
  // Dos Nico: nombre completo para distinguirlos.
  assert.ok(tags.includes('NICO FERRER') && tags.includes('NICO PARDO'), tags.join());
  // Cambiar de personaje en la ficha cambia el sprite sin duplicar al actor.
  api.sync(team.map(s=>s.id==='irene'?{...s,avatar:'kenji'}:s)); step(800);
  assert.equal(actors().length, 5);
  assert.ok(actors().some(e=>e.parts['.body'].attrs.src?.startsWith('/oficina/kenji-')));
});
