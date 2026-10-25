// Evidencia visual de la escena en el navegador real: congela lo que la app manda al motor, pone un equipo falso
// (unos trabajan, otros esperan, otros libres), deja pasar el tiempo y dibuja encima suelo (cian), muebles (rojo),
// sillas (amarillo) y el rastro de cada personaje (un punto cada 300 ms). Mide en la página lo mismo que las pruebas:
// pies fuera del suelo o sobre un mueble, sentados fuera de una silla y la distancia mínima entre dos personajes.
//   node tests/helpers/escena-sonda.js <url> <captura.png> [equipo=6] [ms=20000] [ancho,alto=1440,900] [frames=1,0] [consejo=0]
// Ejemplo (oficina): node tests/helpers/escena-sonda.js "http://localhost:4400/#s=acme-ciencia-redaccion" docs/evidencia/escena/oficina.png 8 25000
// Usa SOLO los puertos 4400–4499 (nunca la app en vivo).
const { execFileSync } = require('child_process');
const path = require('path');

const [url, shot, n = '6', ms = '20000', size = '1440,900', frames = '1,0', consejo = '0'] = process.argv.slice(2);
if (!url || !shot) { console.error('uso: escena-sonda.js <url> <captura.png> [equipo] [ms] [ancho,alto] [frames] [consejo]'); process.exit(2); }

const SONDA = `(async () => {
  const N = ${Number(n)}, MS = ${Number(ms)}, COUNCIL = ${consejo === '1'};
  const sync = Nave.sync.bind(Nave), council = Nave.setCouncil.bind(Nave);
  Nave.sync = () => {}; Nave.setCouncil = () => {}; Nave.activity = () => {};
  const names = ['Ada Ruiz', 'Bruno Sol', 'Carla Vega', 'Dario Paz', 'Elena Mar', 'Fede Luz', 'Gala Rey', 'Hugo Gil'];
  const colors = ['#f2a65a', '#c084fc', '#60a5fa', '#34d399', '#f87171', '#facc15', '#2dd4bf', '#e879f9'];
  // Dos trabajan (uno «pensando»), tres esperan turno sentados, el resto libres (pasean, café, charlan).
  const team = Array.from({ length: N }, (_, i) => ({ id: 'p' + i, name: names[i], color: colors[i],
    cls: i < 2 ? 'working' : 'ready', queued: i >= 2 && i < 5, activity: i === 0 ? 'pensando…' : i === 1 ? 'editando informe.md' : '' }));
  council(COUNCIL);
  sync(team);
  const S = Nave.SCENE, stage = document.querySelector('.deck.nave .stage');
  const pts = new Map(), ground = (a, b) => Math.hypot(b[0] - a[0], (b[1] - a[1]) * 1.6);
  let minSep = Infinity, fuera = 0, malSentado = 0, muestras = 0;
  const t0 = performance.now();
  while (performance.now() - t0 < MS) {
    await new Promise(r => setTimeout(r, 300));
    const list = [...stage.querySelectorAll('.actor')].map(el => ({ el, k: el.dataset.hover, p: [parseFloat(el.style.left), parseFloat(el.style.top)], act: el.dataset.act }));
    for (const a of list) {
      muestras++;
      if (!Escenas.walkable(S, a.p)) fuera++;
      if (['sit', 'wait', 'sitBack'].includes(a.act) && !Escenas.isChair(S, a.p)) malSentado++;
      (pts.get(a.k) || pts.set(a.k, { c: getComputedStyle(a.el).getPropertyValue('--c'), p: [] }).get(a.k)).p.push(a.p);
    }
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) minSep = Math.min(minSep, ground(list[i].p, list[j].p));
  }
  const poly = (ps, st) => '<polygon points="' + ps.map(p => p.join(',')).join(' ') + '" ' + st + '/>';
  let svg = '<svg viewBox="0 0 100 100" preserveAspectRatio="none" style="position:absolute;inset:0;width:100%;height:100%;z-index:3000;pointer-events:none">';
  svg += poly(S.floor, 'fill="none" stroke="#3fd0ff" stroke-width=".25"');
  for (const o of S.obstacles || []) svg += poly(o, 'fill="#ff3b3b33" stroke="#ff3b3b" stroke-width=".2"');
  for (const c of [...(S.seats || []), ...(S.meeting || []), S.console]) svg += '<ellipse cx="' + c[0] + '" cy="' + c[1] + '" rx=".55" ry=".9" fill="#ffd60a"/>';
  for (const { c, p } of pts.values()) for (const q of p) svg += '<ellipse cx="' + q[0] + '" cy="' + q[1] + '" rx=".22" ry=".35" fill="' + (c.trim() || '#ff2bd6') + '"/>';
  stage.insertAdjacentHTML('beforeend', svg + '</svg>');
  return { escena: S.id, actores: pts.size, muestras, fuera, malSentado, separacionMinima: +minSep.toFixed(2) };
})()`;

const out = execFileSync(process.execPath, [path.join(__dirname, 'ui-probe.js'), url, '--wait=6000', `--size=${size}`, `--eval=${SONDA}`, `--shot=${shot}`, `--frames=${frames}`],
  { encoding: 'utf8', timeout: Number(ms) + 120000 });
console.log(out);
