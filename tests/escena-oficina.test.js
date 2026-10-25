// La oficina isométrica no se atraviesa: con el motor real (public/nave.js) y varios minutos simulados, nadie pisa un
// mueble ni sale del suelo en ningún cuadro, ninguna ruta cruza un obstáculo, y quien trabaja acaba sentado en SU silla.
// La escena está calibrada contra public/oficina/escena.png (ver docs/DECISIONES.md, «Escena de oficina»).
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const Escenas = require('../public/escenas');

const scene = Escenas.resolve({ id: 'prueba' });
const near = (a, b, d = 0.15) => Math.abs(a[0] - b[0]) < d && Math.abs(a[1] - b[1]) < d;

test('todos los puntos de la escena están en suelo libre y son alcanzables', () => {
  const spots = { seats: scene.seats, access: scene.access, coffee: scene.coffee, meeting: scene.meeting, chat: scene.chat,
    otros: [scene.door, scene.elevator, scene.board, scene.kitchen, scene.console], waypoints: scene.waypoints };
  for (const [kind, list] of Object.entries(spots)) for (const p of list) {
    assert.ok(Escenas.walkable(scene, p), `${kind} ${p} fuera del suelo o dentro de un mueble`);
    // Los asientos pegan a su mesa (excepción declarada a la holgura); su acceso sí es celda libre.
    if (kind !== 'seats') assert.ok(Escenas.isFree(scene, p), `${kind} ${p} no es celda libre de la zona conectada`);
  }
  // Nadie comparte silla: seis escritorios, luego las sillas de la sala; distintas del operador y la sabia.
  const taken = Array.from({ length: 12 }, (_, i) => Escenas.seat(scene, 'e' + i, i).join(','));
  assert.equal(new Set(taken).size, 12);
  for (const fixed of [scene.console, scene.kitchen]) assert.ok(!taken.includes(fixed.join(',')));
});

test('ninguna ruta cruza un obstáculo ni sale del suelo, y siempre llega al destino exacto', () => {
  const spots = [...scene.seats, ...scene.coffee, ...scene.meeting, ...scene.chat, scene.door, scene.elevator, scene.board,
    scene.kitchen, scene.console];
  let rnd = 7;
  const random = () => (rnd = (rnd * 16807) % 2147483647) / 2147483647;
  for (let k = 0; k < 12; k++) spots.push(Escenas.randomFree(scene, random));
  for (const from of spots) for (const to of spots) {
    if (from === to) continue;
    const path = Escenas.route(scene, from, to);
    assert.deepEqual(path[path.length - 1], to);
    let at = from;
    for (const p of path) {
      const n = Math.max(1, Math.ceil(Math.hypot(p[0] - at[0], p[1] - at[1]) / 0.2));
      for (let i = 0; i <= n; i++) {
        const q = [at[0] + (p[0] - at[0]) * i / n, at[1] + (p[1] - at[1]) * i / n];
        assert.ok(Escenas.walkable(scene, q), `${from} → ${to}: el tramo ${at} → ${p} pasa por ${q.map(v => v.toFixed(2))}`);
      }
      at = p;
    }
  }
});

// ---------- El motor real con un DOM mínimo (como tests/nave-motor.test.js) ----------
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
  const context = { window: {}, t: require('../lib/i18n').t, Escenas, Math: SeededMath, performance: { now: () => now }, localStorage: { getItem: () => null, setItem() {} },
    document: { hidden: false, createElement: () => new Element(), getElementById: id => elements[id], addEventListener() {} },
    requestAnimationFrame: fn => { frame = fn; return 1; }, Image: class {}, setTimeout, clearTimeout };
  vm.runInNewContext(fs.readFileSync(require.resolve('../public/nave'), 'utf8'), context);
  const api = context.window.Nave; api.init();
  const stage = elements.stations.previous.querySelector('.stage');
  return { api, stage, step: t => { now = t; frame(t); } };
}

test('varios minutos en la oficina: nadie atraviesa nada y quien trabaja termina sentado en su silla', () => {
  const { api, stage, step } = motor();
  const offices = [{ id: 'edificio', nombre: 'Edificio' }, { id: 'prueba', nombre: 'Prueba' }];
  api.setOffice(offices[1], offices, () => {});
  const staff = cls => Array.from({ length: 6 }, (_, i) => ({ id: 'e' + i, name: 'Persona ' + i, cls, queued: cls === 'queued' }))
    .map(s => ({ ...s, cls: s.cls === 'queued' ? 'ready' : s.cls }));
  const actors = () => stage.children.filter(e => e.className.startsWith('actor'));
  const posOf = el => [parseFloat(el.style.left), parseFloat(el.style.top)];
  const seatOfId = id => Escenas.seat(scene, id, Number(id.slice(1)));
  // Fases: trabajan, esperan turno, en espera libre (café, charla, pasear), Consejo en la sala y de nuevo a trabajar.
  const phases = [['working', 70e3], ['queued', 50e3], ['ready', 120e3], ['council', 60e3], ['working', 90e3]];
  let t = 0, frames = 0;
  for (const [phase, ms] of phases) {
    api.setCouncil(phase === 'council');
    api.sync(staff(phase === 'council' ? 'working' : phase));
    for (const end = t + ms; t < end; t += 50) {
      step(t);
      frames++;
      for (const el of actors()) {
        const p = posOf(el);
        assert.ok(Escenas.walkable(scene, p), `${el.dataset.hover || el.dataset.act} en ${p.map(v => v.toFixed(2))} (fase ${phase}, t=${t}) pisa un mueble o sale del suelo`);
      }
    }
  }
  assert.ok(frames > 7000);
  // Al final de la última fase de trabajo, cada empleado está en SU silla, sentado, y no hay dos en la misma.
  const seated = actors().filter(el => /^agent:e\d$/.test(el.dataset.hover || ''));
  assert.equal(seated.length, 6);
  const seatsUsed = new Set();
  for (const el of seated) {
    const id = el.dataset.hover.slice(6);
    assert.ok(near(posOf(el), seatOfId(id)), `${id} no está en su silla: ${posOf(el)} ≠ ${seatOfId(id)}`);
    assert.equal(el.dataset.act, 'sit', `${id} no está sentado (${el.dataset.act})`);
    seatsUsed.add(seatOfId(id).join(','));
  }
  assert.equal(seatsUsed.size, 6);
});
