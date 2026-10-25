// La escena se siente viva y física (docs/BRIEF-GUI-RESPONSIVE-ESCENA.md §3, D62): con el motor real y varios minutos
// simulados, con 4 a 8 agentes en la oficina y en la nave, falla si alguien en algún cuadro
//   - pisa un mueble o sale del suelo;
//   - se sienta fuera de una silla;
//   - entra en un bucle de sentarse y levantarse;
//   - se teletransporta (avanza más de lo que permite su velocidad máxima en un cuadro);
//   - atraviesa a otro (sus pies quedan a menos de MIN_SEP de los de otro);
// y comprueba que quien trabaja acaba sentado en SU silla.
const test = require('node:test');
const assert = require('node:assert/strict');
const Escenas = require('../public/escenas');

const { simulate, phasesFor, SEATED, ground } = require('./helpers/motor-escena');

function assertClean(r) {
  const bad = Object.entries(r.fails).filter(([, v]) => v.length);
  assert.deepEqual(bad.map(([k]) => k), [], bad.map(([k, v]) => `${k}:\n  ${v.join('\n  ')}`).join('\n'));
}
// Al final de una fase de trabajo, cada uno sentado en SU silla.
function assertSeated(r, office) {
  for (const [i, id] of r.ids.entries()) {
    const a = r.actors.find(x => x.key === `agent:${id}`);
    const home = Escenas.seat(r.scene, id, i);
    if (!Escenas.isChair(r.scene, home)) continue; // en la nave, del 6.º en adelante trabajan de pie
    assert.ok(ground(a.pos, home) < 0.2, `${id} no está en su silla: ${a.pos} ≠ ${home} (${office ? 'oficina' : 'nave'})`);
    assert.ok(SEATED.includes(a.act), `${id} no está sentado (${a.act})`);
  }
}

// ESCENA_SEMILLAS=1-40 repite cada simulación con esas semillas (prueba de estrés; por defecto, una fija).
const seeds = (base) => {
  const m = /^(\d+)-(\d+)$/.exec(process.env.ESCENA_SEMILLAS || '');
  return m ? Array.from({ length: m[2] - m[1] + 1 }, (_, i) => Number(m[1]) + i) : [base];
};
for (const n of [4, 8]) for (const seed of seeds(11 + n)) {
  test(`oficina con ${n} empleados (semilla ${seed}): minutos de escena sin atravesar nada, sin saltos, sin bucles y cada uno en su silla`, () => {
    const r = simulate({ office: true, n, phases: phasesFor(n, true), seed });
    assert.ok(r.frames > 5000, `solo ${r.frames} cuadros`);
    assertClean(r);
    assertSeated(r, true);
  });
}
for (const seed of seeds(5)) test(`nave con 5 tripulantes (semilla ${seed}): lo mismo en el puente (sillones, consola y cocina son obstáculos)`, () => {
  const r = simulate({ office: false, n: 5, phases: phasesFor(5, false), seed });
  assert.ok(r.frames > 5000);
  assertClean(r);
  assertSeated(r, false);
});

test('la nave tiene suelo y muebles calibrados: sillones, accesos y puntos de reunión son libres y alcanzables', () => {
  const nave = Escenas.resolve();
  for (const p of [...nave.access, ...nave.coffee, ...nave.chat, ...nave.standing, nave.kitchen, nave.console]) {
    assert.ok(Escenas.isFree(nave, p), `${p} no es celda libre`);
  }
  for (const s of nave.seats) assert.ok(Escenas.walkable(nave, s) && Escenas.isChair(nave, s), `${s}`);
  // Cinco sillones distintos y el 6.º trabaja de pie (no comparte sillón).
  const homes = Array.from({ length: 7 }, (_, i) => Escenas.seat(nave, 'x' + i, i).join(','));
  assert.equal(new Set(homes).size, 7);
});

test('las rutas doblan las esquinas en curva y nunca salen del suelo libre de muebles', () => {
  for (const scene of [Escenas.resolve(), Escenas.resolve({ id: 'p' })]) {
    let rnd = 3;
    const random = () => (rnd = (rnd * 16807) % 2147483647) / 2147483647;
    let turns = 0, sharp = 0;
    for (let k = 0; k < 60; k++) {
      const from = Escenas.randomFree(scene, random), to = Escenas.randomFree(scene, random);
      const path = [from, ...Escenas.route(scene, from, to)];
      assert.deepEqual(path[path.length - 1], to);
      for (let i = 1; i < path.length; i++) {
        const a = path[i - 1], b = path[i], m = Math.max(1, Math.ceil(ground(a, b) / 0.2));
        for (let s = 0; s <= m; s++) {
          const q = [a[0] + (b[0] - a[0]) * s / m, a[1] + (b[1] - a[1]) * s / m];
          assert.ok(Escenas.walkable(scene, q), `${scene.id}: ${from} → ${to} pasa por ${q}`);
        }
      }
      // Ángulo entre tramos seguidos: con curva, cada giro se reparte en varios tramos de menos de 50°.
      for (let i = 2; i < path.length; i++) {
        const u = [path[i - 1][0] - path[i - 2][0], (path[i - 1][1] - path[i - 2][1]) * 1.6], v = [path[i][0] - path[i - 1][0], (path[i][1] - path[i - 1][1]) * 1.6];
        const cos = (u[0] * v[0] + u[1] * v[1]) / (Math.hypot(...u) * Math.hypot(...v) || 1);
        if (cos < 0.999) turns++;
        if (cos < Math.cos(50 * Math.PI / 180)) sharp++;
      }
    }
    assert.ok(turns > 5, `${scene.id}: casi no hay giros (${turns})`);
    assert.ok(sharp / turns < 0.1, `${scene.id}: ${sharp} de ${turns} giros son esquinas de más de 50°`);
  }
});
