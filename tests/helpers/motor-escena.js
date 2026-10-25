// El motor real de la escena (public/nave.js) con un DOM mínimo y un reloj y un azar deterministas, para simular
// minutos de escena en una prueba. Lo usan tests/escena-viva.test.js y la sonda de evidencia.
const vm = require('node:vm');
const fs = require('node:fs');
const Escenas = require('../../public/escenas');

class Element {
  constructor() {
    this.children = []; this.parts = {}; this.dataset = {}; this.style = { setProperty() {} }; this.attrs = {}; this.className = '';
    this.classList = { contains: n => this.className.split(' ').includes(n), add() {}, remove() {}, toggle() {} };
  }
  set innerHTML(html) {
    this.parts = {};
    for (const cls of ['stage', 'room', 'body', 'emote', 'say', 'tag', 'aviso']) if (html.includes(`class="${cls}"`)) {
      const el = new Element(); this.parts['.' + cls] = el; el.parentElement = this; this.children.push(el);
    }
    if (this.parts['.stage'] && this.parts['.room']) this.parts['.stage'].parts['.room'] = this.parts['.room'];
  }
  querySelector(k) { return this.parts[k] || this.children.find(x => '.' + x.className === k) || null; }
  appendChild(el) { this.children.push(el); el.parentElement = this; }
  remove() { if (this.parentElement) this.parentElement.children = this.parentElement.children.filter(e => e !== this); }
  replaceChildren(...els) { this.children = []; for (const el of els) this.appendChild(el); }
  setAttribute(k, v) { this.attrs[k] = v; }
  getAttribute(k) { return this.attrs[k]; }
  addEventListener() {}
  before(el) { this.previous = el; }
}

function motor(seed = 42) {
  const elements = { stations: new Element(), deck: new Element(), viewBtn: new Element() };
  let frame, now = 0, rnd = seed;
  const SeededMath = Object.create(Math);
  SeededMath.random = () => (rnd = (rnd * 16807) % 2147483647) / 2147483647;
  const context = { window: {}, t: require('../../lib/i18n').t, Escenas, Math: SeededMath, performance: { now: () => now }, localStorage: { getItem: () => null, setItem() {} },
    document: { hidden: false, createElement: () => new Element(), getElementById: id => elements[id], addEventListener() {} },
    requestAnimationFrame: fn => { frame = fn; return 1; }, Image: class {}, setTimeout, clearTimeout };
  vm.runInNewContext(fs.readFileSync(require.resolve('../../public/nave'), 'utf8'), context);
  const api = context.window.Nave;
  api.init();
  const stage = elements.stations.previous.querySelector('.stage');
  // Cada actor tal como se ve: clave (agent:<id> o crew:<staff>), pies en % y lo que hace.
  const actors = () => stage.children.filter(e => e.className.startsWith('actor'))
    .map(el => ({ key: el.dataset.hover || '?', pos: [parseFloat(el.style.left), parseFloat(el.style.top)], act: el.dataset.act, el }));
  return { api, stage, actors, step: t => { now = t; frame(t); } };
}

const DT = 50;                         // ms por cuadro (el bucle real avanza cada 50 ms)
const MAX_STEP = 5 * DT / 1000 * 1.02; // velocidad máxima (trabajo: 5 por segundo, en unidades de suelo) con margen
const MIN_SEP = 1.2;                   // unidades de suelo entre los pies de dos personajes
const SIT_MIN = 5000;                  // ms: sentarse y levantarse antes de esto es un bucle
const SEATED = ['sit', 'wait', 'sitBack'];
const ground = (a, b) => Math.hypot(b[0] - a[0], (b[1] - a[1]) * 1.6);

// Ejecuta las fases y devuelve los fallos (como mucho unos pocos de cada tipo, con contexto para depurar).
function simulate({ office, n, phases, seed = 7 }) {
  const { api, actors, step } = motor(seed);
  const debug = () => api.debug();
  const offices = [{ id: 'edificio', nombre: 'Edificio' }, { id: 'prueba', nombre: 'Prueba' }];
  api.setOffice(office ? offices[1] : offices[0], offices, () => {});
  const scene = api.SCENE;
  const ids = Array.from({ length: n }, (_, i) => 'e' + i);
  const fails = { obstaculo: [], silla: [], bucle: [], salto: [], cruce: [] };
  const note = (kind, msg) => { if (fails[kind].length < 5) fails[kind].push(msg); };
  const prev = new Map(), seatedSince = new Map(), lastStand = new Map();
  let t = 0, frames = 0;
  for (const phase of phases) {
    api.setCouncil(!!phase.council);
    api.sync(ids.map((id, i) => ({ id, name: 'Persona ' + i, color: '#888', ...phase.state(i, t) })));
    for (const end = t + phase.ms; t < end; t += DT) {
      // La misma fase puede cambiar dentro (relevo: cada uno trabaja su turno).
      if (phase.every && t % phase.every === 0) api.sync(ids.map((id, i) => ({ id, name: 'Persona ' + i, color: '#888', ...phase.state(i, t) })));
      step(t);
      frames++;
      const list = actors();
      for (const a of list) {
        const where = `${a.key} en ${a.pos.map(v => v.toFixed(2))} (${a.act}, ${phase.name}, t=${t})`;
        if (!Escenas.walkable(scene, a.pos)) note('obstaculo', `${where} pisa un mueble o sale del suelo`);
        if (SEATED.includes(a.act) && !Escenas.isChair(scene, a.pos)) note('silla', `${where} está sentado fuera de una silla`);
        const p = prev.get(a.key);
        if (p && ground(p, a.pos) > MAX_STEP) note('salto', `${where} saltó ${ground(p, a.pos).toFixed(2)} desde ${p.map(v => v.toFixed(2))}`);
        prev.set(a.key, a.pos);
        // Episodios sentado: cada uno dura al menos SIT_MIN; entre dos, al menos 2 s de pie.
        const seated = SEATED.includes(a.act);
        if (seated && !seatedSince.has(a.key)) {
          const stood = lastStand.get(a.key);
          if (stood != null && t - stood < 2000) note('bucle', `${where} se volvió a sentar ${t - stood} ms después de levantarse`);
          seatedSince.set(a.key, t);
        } else if (!seated && seatedSince.has(a.key)) {
          const sat = t - seatedSince.get(a.key);
          if (sat < SIT_MIN) note('bucle', `${where} se levantó tras ${sat} ms sentado`);
          seatedSince.delete(a.key);
          lastStand.set(a.key, t);
        }
      }
      for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
        const d = ground(list[i].pos, list[j].pos);
        if (d < MIN_SEP) note('cruce', `${list[i].key} (${list[i].act}) y ${list[j].key} (${list[j].act}) a ${d.toFixed(2)} en ${list[i].pos.map(v => v.toFixed(1))} (${phase.name}, t=${t})`);
      }
    }
  }
  return { fails, frames, actors: actors(), scene, ids, debug };
}

// Fases de una misión: relevo (uno trabaja, los demás esperan turno), en espera libre, Consejo, un caído y uno fuera,
// y otra vez todos a trabajar.
const relay = (n, turn) => ({ name: 'relevo', ms: turn * n, every: turn, state: (i, t) => {
  const k = Math.floor(t / turn) % n;
  return { cls: i === k ? 'working' : 'ready', queued: i !== k };
} });
const phasesFor = (n, office) => [
  relay(n, 20e3),
  { name: 'libres', ms: 90e3, state: () => ({ cls: 'ready' }) },
  ...(office ? [{ name: 'consejo', ms: 50e3, council: true, state: () => ({ cls: 'working' }) }] : []),
  { name: 'caido-y-fuera', ms: 40e3, state: i => ({ cls: i === 0 ? 'failed' : i === 1 ? 'off' : 'ready', queued: i > 1 }) },
  { name: 'trabajan', ms: 60e3, state: () => ({ cls: 'working' }) },
];

module.exports = { motor, Element, simulate, phasesFor, SEATED, ground };

