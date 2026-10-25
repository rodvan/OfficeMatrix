// Datos de escena compartidos por el motor y sus pruebas; no contiene otro motor.
(function (root) {
  // ---------- Nave: calibrada contra public/nave/escena-iso.jpg (1672×941) el 24-oct-2026 (D62) ----------
  // Cinco sillones contra la pared del fondo a la izquierda (miran a la cubierta), la consola del operador a la derecha
  // y la cocina en el rincón. Asiento = donde quedan los pies del sprite sentado, delante del cojín de su sillón.
  const naveSeats = [[10.5,51.6],[19,47.8],[27.5,43.8],[35.8,39.8],[44,35.4]];
  const nave = {
    id: 'nave', image: '/nave/escena-iso.jpg', ratio: '1672 / 941', fixed: true, nav: true,
    seats: naveSeats, sit: [0,0],
    access: naveSeats.map(([x, y]) => [+(x + 1.4).toFixed(1), +(y + 3).toFixed(1)]),
    console: [66.6,42.6], kitchen: [87,71], coffee: [[80.8,73.6],[76.5,75.5],[83.6,72.4]],
    chat: [[62.5,50],[57.5,53.5]],
    standing: [[56,47.5],[49,53],[63,58]],   // trabajo de pie (6.º empleado en adelante: no hay más sillones)
    // Suelo: la plancha sin el reborde (el borde de abajo sigue la arista delantera; los de arriba, las paredes).
    floor: [[7,53.6],[6,50],[50.5,26.5],[82.5,43.5],[98,51],[97.5,65.8],[56.9,92.4]],
    obstacles: [
      [[4,54.3],[48.5,32.7],[48.5,14],[4,30]],                          // fila de sillones con sus consolas
      [[46,24],[57,24],[57,32.2],[51,31.8],[46,31.4]],                 // armarios del rincón del fondo
      [[57,27],[82.5,39.5],[82.5,48],[79,48.3],[59,37.5]],             // consola del operador (mesa y cajoneras)
      [[74.6,49],[80.6,49],[80.6,70.6],[74.6,70.2]],                   // tabique y alacena de la cocina
      [[80.6,47],[98,47],[98,69],[92.5,69.2],[86,68.3],[80.6,70.6]],   // cocina: fogón, fregadero, taburete y nevera
    ],
  };
  // ---------- Oficina: calibrada contra los píxeles de public/oficina/escena.png (1774×887; todo en % de la imagen) ----------
  // Medido el 24-oct-2026 con una rejilla al 1 % sobre la imagen ampliada (ver docs/DECISIONES.md, «Escena de oficina»).
  // Los puntos son donde pisan los pies. La fila larga de escritorios es una banda diagonal: su borde delantero (donde
  // apoyan los cajones y quedan las ruedas de las sillas) sigue y = x + 31,4 y el trasero (pie de la mampara) y = x + 16,7.
  // Las sillas miran a su monitor (arriba a la derecha); la pose sentada de oficina mira a la derecha, así que no se voltea.
  // Asiento = ruedas de la silla + (0,9, 1,1): las caderas del sprite sentado quedan sobre el cojín.
  // 1–4: fila larga (4 sillas reales); 5–6: los dos escritorios añadidos junto al ascensor.
  const chairs = [[14.7,46.5],[21.3,52.6],[28.0,60.0],[35.2,66.4],[63.2,69.1],[68.2,79.0]];
  const seats = chairs.map(([x, y]) => [+(x + 0.9).toFixed(1), +(y + 1.1).toFixed(1)]);
  // Acceso a cada silla desde el pasillo: un paso atrás y a la izquierda, siempre en suelo libre.
  const access = seats.map(([x, y]) => [+(x - 1.6).toFixed(1), +(y + 2.6).toFixed(1)]);
  // Pared fina (cristal de la sala): rectángulo de medio grosor w alrededor del tramo a→b.
  const wall = (a, b, w = 0.6) => {
    const dx = b[0] - a[0], dy = b[1] - a[1], n = Math.hypot(dx, dy) || 1, ox = (-dy / n) * w, oy = (dx / n) * w;
    return [[a[0] + ox, a[1] + oy], [b[0] + ox, b[1] + oy], [b[0] - ox, b[1] - oy], [a[0] - ox, a[1] - oy]];
  };
  // Sala de juntas: caja de cristal con esquinas en el suelo izquierda (51,1, 42,4), delante (64,4, 55), derecha
  // (84,8, 42,8) y fondo (~71,5, 27,5). Se entra SOLO por la puerta del cristal delantero izquierdo (entre x 58,5 y 63,4).
  const room = [[51.1,42.4],[64.4,55],[84.8,42.8],[71.5,27.5]];
  const door = [61, 51.8];
  const oficina = {
    id: 'oficina', image: '/oficina/escena.png', ratio: '1774 / 887', fixed: false, nav: true,
    seats, access, sit: [0,0],
    // Operador: silla del extremo izquierdo de la mesa de juntas. Sabia: junto al extremo de la barra (el hueco de
    // detrás de la barra queda cerrado por la barandilla en la imagen). Café: de pie junto a los taburetes.
    console: [59.3,38.3], kitchen: [75.2,71.5], coffee: [[77.4,74],[80.6,77.6],[84,80.4]],
    chat: [[30,33],[35,36]], board: [30,33.5],
    // Sillas de la sala de juntas (Consejo): las cinco visibles alrededor de la mesa más una al pie de la mesa.
    meeting: [[60.6,43.3],[67.2,43.6],[71.7,41.3],[74.6,37.2],[56.6,40.8],[64.3,45.4]],
    // De pie junto a la mesa, para el Consejo cuando ya no quedan sillas libres en la sala.
    standRoom: [[78.5,39.5],[70,46.5],[76,44]],
    door, elevator: [52,92.5],
    rooms: [{ id: 'juntas', poly: room, door }],
    // Suelo transitable: el contorno real (ventanal y pared del fondo, sala de juntas, barra, barandilla del borde).
    floor: [
      [0.5,47.5],[8.5,44.5],[8.5,38.5],[12,31.5],[17,30.5],[25,28],[36,24],[38,24.5],[46.5,30.5],[46.5,37],[50.5,37],
      [51.1,42.4],[71.5,27.5],[84.8,42.8],[86,42],[98,46],[98,53.5],[99,62],[100,74],[78,88.5],[64.5,95.5],[56,98.5],
      [47,98.5],[41.3,97.5],[39,92.5],[30.4,82.5],[10.4,60],
    ],
    // Puntos de paso de referencia (la navegación usa la rejilla; estos se comprueban libres en las pruebas).
    waypoints: [door, [61.4,57.4], [45.5,64], [72,63], [57,92], [30,40]],
    obstacles: [
      [[8,38.9],[37.8,68.7],[45.2,61.4],[15.3,31.5]],       // fila larga de escritorios (cajones, mampara y monitores)
      [[60.3,65.3],[65.6,70.6],[70.3,65.9],[65,60.6]],      // escritorio 5
      [[65.7,74.8],[72.7,81.8],[77.4,77.1],[70.4,70.1]],    // escritorio 6
      [[41.3,70],[55.5,61],[59.6,61.3],[59.6,86.3],[55,88.6],[47,93.6],[41.3,97]], // bloque del ascensor
      [[59.2,81.5],[62.8,81.5],[62.8,86.8],[59.2,86.8]],    // maceta junto al ascensor
      [[38,85],[43,85],[43,94],[38,94]],                    // maceta de la esquina
      [[44.8,37.5],[50.2,37.5],[50.2,44],[44.8,44]],        // columna y maceta junto a la sala
      [[37.5,24],[46,30],[46,37],[38,31.5]],                // aparador bajo el corcho
      [[25.5,28],[34.5,24.5],[35.5,27.8],[26.5,31.3]],      // pizarra con ruedas
      [[75.6,61],[78.8,53.5],[98,53.5],[98,62.3],[89.8,65.5],[89.8,82],[88.6,82],[76,69.8]], // barra en L
      [[86.5,42],[91,42],[91,48],[86.5,48]],                // banco bajo el ventanal derecho
      [[60.2,34.8],[67.5,29.6],[74.4,33],[67,38.8]],        // mesa de juntas
      wall([51.1,42.4],[58.5,49.4]), wall([63.4,54.1],[64.4,55]), wall([64.4,55],[84.8,42.8]), // cristal (puerta abierta)
    ],
  };
  // Oclusores: copia recortada de la placa que tapa a quien tiene los pies MÁS ARRIBA (más lejos) que su y.
  // Cada tramo de la fila larga cubre el escritorio de su silla (cajones, tablero, monitores y mampara); su y queda justo
  // por encima de la silla, para que quien se sienta se vea delante de su mesa y quien pasa por detrás quede tapado.
  const rowFront = x => x + 31.4;
  function rowSegment(id, cx, cy) {
    const x0 = cx - 3.5, x1 = cx + 3.5;
    const pts = [[x0, rowFront(x0) + 0.5], [x1, rowFront(x1) + 0.5], [x1 + 7.6, rowFront(x1) - 17], [x0 + 7.6, rowFront(x0) - 17]];
    return { id, y: cy - 1.2, clip: `polygon(${pts.map(([x, y]) => `${x.toFixed(1)}% ${y.toFixed(1)}%`).join(', ')})` };
  }
  oficina.occluders = [
    ...chairs.slice(0, 4).map(([x, y], i) => rowSegment(`escritorio-${i + 1}`, x, y)),
    { id: 'escritorio-5', y: chairs[4][1] - 1.2, clip: 'polygon(60.2% 66.2%, 65.8% 71.6%, 71.5% 66.4%, 71% 56%, 65% 55%, 60% 60%)' },
    { id: 'escritorio-6', y: chairs[5][1] - 1.2, clip: 'polygon(65.6% 75.8%, 72.8% 82.6%, 78.2% 77.6%, 77.6% 66.5%, 71.5% 64.5%, 65.5% 69%)' },
    // El cristal es transparente: solo el marco bajo de las paredes delanteras tapa los pies de quien está dentro de
    // la sala (y ≤ 45,4), no a quien pasa por delante (y > 46). La barra tapa a quien pasa por detrás.
    { id: 'cristal', y: 46, clip: 'polygon(50.6% 41.4%, 64.4% 54.2%, 85.3% 41.6%, 85.3% 43.8%, 64.4% 56.2%, 50.6% 43.6%)' },
    { id: 'barra', y: 66, clip: 'polygon(75.4% 54%, 79% 47%, 98.5% 47%, 98.5% 63%, 90% 66.5%, 90% 82.5%, 88.4% 82.5%, 75.6% 70.5%)' },
  ];

  function resolve(o = {}) {
    if (!o.id || o.id === 'edificio') return { ...nave };
    return { ...oficina, puestos: o.escena?.puestos || {} };
  }
  // Puesto de un empleado: el escritorio declarado en su ficha o, por orden, uno de los seis escritorios. Si hay más
  // empleados que escritorios, los siguientes trabajan en las sillas de la sala de juntas (nadie comparte silla).
  // En la nave, sillones alternos (1.º, 3.º, 5.º, 2.º, 4.º) para que los globos de dos que trabajan a la vez no se pisen;
  // del 6.º en adelante trabajan de pie en la cubierta (solo hay cinco sillones).
  function seat(scene, id, index) {
    const declared = scene.puestos?.[id];
    const n = /^escritorio-([1-6])$/.exec(declared || '');
    if (n) return scene.seats[Number(n[1]) - 1];
    if (scene.fixed) return index < 5 ? scene.seats[[0, 2, 4, 1, 3][index]] : nave.standing[(index - 5) % nave.standing.length];
    if (index < scene.seats.length || !scene.meeting) return scene.seats[index % scene.seats.length];
    return scene.meeting[(index - scene.seats.length) % scene.meeting.length];
  }
  // ¿Es una silla de verdad? (escritorio, sillón o silla de la sala de juntas). Solo ahí se sienta alguien.
  const same = (a, b) => Math.abs(a[0] - b[0]) < 0.15 && Math.abs(a[1] - b[1]) < 0.15;
  function chairList(scene) { return [...(scene.seats || []), ...(scene.meeting || []), ...(scene.console ? [scene.console] : [])]; }
  function isChair(scene, p) { return !!p && chairList(scene).some(c => same(c, p)); }
  // Punto del pasillo desde el que se entra a una silla (o el propio punto si no es una silla con acceso).
  function accessOf(scene, p) {
    const i = (scene.seats || []).findIndex(s => same(s, p));
    return i >= 0 && scene.access ? scene.access[i] : p;
  }
  function inside(p, poly) {
    let c = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [xi, yi] = poly[i], [xj, yj] = poly[j];
      if ((yi > p[1]) !== (yj > p[1]) && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) c = !c;
    }
    return c;
  }
  function crosses(a, b, c, d) {
    const side = (p, q, r) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
    const d1 = side(c, d, a), d2 = side(c, d, b), d3 = side(a, b, c), d4 = side(a, b, d);
    return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
  }
  function hits(a, b, poly) {
    if (inside(a, poly) || inside(b, poly)) return true;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) if (crosses(a, b, poly[j], poly[i])) return true;
    return false;
  }
  function clearSegment(scene, a, b) {
    return !(scene.obstacles || []).some(poly => hits(a, b, poly));
  }
  function walkable(scene, p) {
    if (scene.floor && !inside(p, scene.floor)) return false;
    return !(scene.obstacles || []).some(poly => inside(p, poly));
  }
  function distance(a, b) { return Math.hypot(a[0] - b[0], (a[1] - b[1]) * 1.6); }

  // ---------- Navegación por rejilla (escenas con nav: true) ----------
  // Rejilla de CELL % sobre la imagen. Una celda es libre si su centro y cuatro puntos a la distancia de holgura (el
  // ancho de los pies) están en el suelo y fuera de todo obstáculo. Solo cuenta la zona conectada más grande: un
  // rincón encerrado (detrás de la barra) nunca es destino. Se calcula una vez por escena.
  const CELL = 0.5, CLEAR = [0.6, 0.45], DIAG = Math.hypot(CELL, CELL * 1.6);
  const grids = new Map();
  function navGrid(scene) {
    const key = scene.id + ':' + scene.floor.length + ':' + scene.obstacles.length;
    if (grids.has(key)) return grids.get(key);
    const nx = Math.round(100 / CELL), ny = Math.round(100 / CELL);
    const free = new Uint8Array(nx * ny);
    const ok = p => walkable(scene, p);
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const c = [(i + 0.5) * CELL, (j + 0.5) * CELL];
      if (ok(c) && ok([c[0] - CLEAR[0], c[1]]) && ok([c[0] + CLEAR[0], c[1]]) && ok([c[0], c[1] - CLEAR[1]]) && ok([c[0], c[1] + CLEAR[1]])) free[j * nx + i] = 1;
    }
    // Componente conectada más grande (8 vecinos).
    const comp = new Int32Array(nx * ny).fill(-1), sizes = [];
    for (let s = 0; s < free.length; s++) {
      if (!free[s] || comp[s] >= 0) continue;
      const id = sizes.length, stack = [s];
      comp[s] = id; let n = 0;
      while (stack.length) {
        const u = stack.pop(); n++;
        const ui = u % nx, uj = (u / nx) | 0;
        for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
          const vi = ui + di, vj = uj + dj;
          if ((di || dj) && vi >= 0 && vj >= 0 && vi < nx && vj < ny) {
            const v = vj * nx + vi;
            if (free[v] && comp[v] < 0) { comp[v] = id; stack.push(v); }
          }
        }
      }
      sizes.push(n);
    }
    const main = sizes.indexOf(Math.max(...sizes));
    const cells = [];
    for (let s = 0; s < free.length; s++) { free[s] = comp[s] === main ? 1 : 0; if (free[s]) cells.push(s); }
    const g = { nx, ny, free, cells };
    grids.set(key, g);
    return g;
  }
  const cellOf = (g, p) => {
    const i = Math.min(g.nx - 1, Math.max(0, Math.floor(p[0] / CELL))), j = Math.min(g.ny - 1, Math.max(0, Math.floor(p[1] / CELL)));
    return j * g.nx + i;
  };
  const centerOf = (g, s) => [+(((s % g.nx) + 0.5) * CELL).toFixed(2), +((((s / g.nx) | 0) + 0.5) * CELL).toFixed(2)];
  // ¿Se puede pisar este punto? (celda libre de la zona principal)
  function isFree(scene, p) { const g = navGrid(scene); return !!g.free[cellOf(g, p)]; }
  // Celda libre más cercana (búsqueda por anillos).
  function nearestFree(scene, p) {
    const g = navGrid(scene), s0 = cellOf(g, p);
    if (g.free[s0]) return s0;
    const i0 = s0 % g.nx, j0 = (s0 / g.nx) | 0;
    for (let r = 1; r < Math.max(g.nx, g.ny); r++) {
      let best = -1, bd = Infinity;
      for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) {
        if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
        const i = i0 + di, j = j0 + dj;
        if (i < 0 || j < 0 || i >= g.nx || j >= g.ny) continue;
        const s = j * g.nx + i;
        if (g.free[s]) { const d = distance(centerOf(g, s), p); if (d < bd) { bd = d; best = s; } }
      }
      if (best >= 0) return best;
    }
    return g.cells[0];
  }
  function randomFree(scene, rnd = Math.random) {
    const g = navGrid(scene);
    return centerOf(g, g.cells[Math.floor(rnd() * g.cells.length)]);
  }
  // Celdas libres para una ruta concreta: la rejilla menos un radio alrededor de otros personajes que estorban (para
  // rodearlos). Sin nadie que evitar es la rejilla tal cual.
  function freeFor(scene, avoid) {
    const g = navGrid(scene);
    if (!avoid || !avoid.length) return g.free;
    const free = g.free.slice();
    for (const { p, r } of avoid) {
      const ri = Math.ceil(r / CELL), rj = Math.ceil(r / 1.6 / CELL), c = cellOf(g, p), ci = c % g.nx, cj = (c / g.nx) | 0;
      for (let dj = -rj; dj <= rj; dj++) for (let di = -ri; di <= ri; di++) {
        const i = ci + di, j = cj + dj;
        if (i < 0 || j < 0 || i >= g.nx || j >= g.ny) continue;
        if (distance(centerOf(g, j * g.nx + i), p) <= r) free[j * g.nx + i] = 0;
      }
    }
    return free;
  }
  // Línea de vista sobre la rejilla: cada muestra (cada 0,2 %) cae en celda libre.
  function lineFree(scene, a, b, free = navGrid(scene).free) {
    const g = navGrid(scene), n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 0.2));
    for (let k = 0; k <= n; k++) {
      const t = k / n;
      if (!free[cellOf(g, [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t])]) return false;
    }
    return true;
  }
  // A* entre dos celdas libres (8 vecinos, coste con el suelo isométrico «aplastado»), y suavizado por línea de vista.
  function astar(scene, s, t, free = navGrid(scene).free) {
    const g = navGrid(scene);
    if (s === t) return [s];
    const ti = (t % g.nx + 0.5) * CELL, tj = (((t / g.nx) | 0) + 0.5) * CELL;
    const h = u => Math.hypot((u % g.nx + 0.5) * CELL - ti, ((((u / g.nx) | 0) + 0.5) * CELL - tj) * 1.6);
    if (!g.cost || g.cost.length !== g.free.length) { g.cost = new Float64Array(g.free.length); g.prev = new Int32Array(g.free.length); g.mark = new Int32Array(g.free.length); g.epoch = 0; }
    const epoch = ++g.epoch; // marca de esta búsqueda: evita limpiar los arreglos entre rutas
    const seen = u => g.mark[u] === epoch || g.mark[u] === -epoch;
    const costOf = u => (seen(u) ? g.cost[u] : Infinity);
    const cost = { get: u => g.cost[u], has: u => seen(u) && g.prev[u] >= 0, set: (u, c) => { if (!seen(u)) g.mark[u] = epoch; g.cost[u] = c; } };
    const prev = { has: u => seen(u) && g.prev[u] >= 0, get: u => g.prev[u], set: (u, p) => { g.prev[u] = p; } };
    const closed = { has: u => g.mark[u] === -epoch, add: u => { g.mark[u] = -epoch; } };
    g.mark[s] = epoch; g.cost[s] = 0; g.prev[s] = -1;
    const heap = [[h(s), s]];
    const push = item => { heap.push(item); let i = heap.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
    const pop = () => {
      const top = heap[0], last = heap.pop();
      if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } }
      return top;
    };
    while (heap.length) {
      const [, u] = pop();
      if (u === t) break;
      if (closed.has(u)) continue;
      closed.add(u);
      const ui = u % g.nx, uj = (u / g.nx) | 0;
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        if (!di && !dj) continue;
        const vi = ui + di, vj = uj + dj;
        if (vi < 0 || vj < 0 || vi >= g.nx || vj >= g.ny) continue;
        const v = vj * g.nx + vi;
        if (!free[v] || closed.has(v)) continue;
        // En diagonal, las dos celdas de al lado también libres: no se corta una esquina.
        if (di && dj && (!free[uj * g.nx + vi] || !free[vj * g.nx + ui])) continue;
        const c = cost.get(u) + (di && dj ? DIAG : dj ? CELL * 1.6 : CELL);
        if (c < costOf(v)) { cost.set(v, c); prev.set(v, u); push([c + h(v), v]); }
      }
    }
    if (!prev.has(t)) return null;
    const cells = [t];
    for (let u = t; prev.has(u); u = prev.get(u)) cells.push(prev.get(u));
    return cells.reverse();
  }
  function smooth(scene, pts, free) {
    const out = [pts[0]];
    let i = 0;
    while (i < pts.length - 1) {
      let j = pts.length - 1;
      while (j > i + 1 && !lineFree(scene, pts[i], pts[j], free)) j--;
      out.push(pts[j]);
      i = j;
    }
    return out;
  }
  const roomOf = (scene, p) => (scene.rooms || []).find(r => inside(p, r.poly)) || null;
  // Asiento declarado más cercano (para entrar y salir por su acceso).
  function seatIndex(scene, p) {
    return (scene.seats || []).findIndex(s => Math.abs(s[0] - p[0]) < 0.15 && Math.abs(s[1] - p[1]) < 0.15);
  }
  // Celda libre más cercana (y no tapada por quien se evita) a la que se llega en línea recta sin pisar un mueble. Sin
  // esa recta, una celda «cercana» al otro lado de la esquina de un escritorio haría cruzarlo.
  function nearestOpen(scene, p, free) {
    const g = navGrid(scene), s0 = cellOf(g, p), i0 = s0 % g.nx, j0 = (s0 / g.nx) | 0;
    for (let r = 0; r < Math.max(g.nx, g.ny); r++) {
      const ring = [];
      for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) {
        if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
        const i = i0 + di, j = j0 + dj;
        if (i < 0 || j < 0 || i >= g.nx || j >= g.ny || !free[j * g.nx + i]) continue;
        ring.push([distance(centerOf(g, j * g.nx + i), p), j * g.nx + i]);
      }
      ring.sort((a, b) => a[0] - b[0]);
      for (const [, c] of ring) if (segmentWalkable(scene, p, centerOf(g, c))) return c;
    }
    return -1;
  }
  function gridLeg(scene, from, to, free) {
    // Con línea de vista (y dentro del suelo en todo el tramo), directo.
    if (lineFree(scene, from, to, free) || (distance(from, to) < 1.5 && segmentWalkable(scene, from, to))) return [];
    const g = navGrid(scene);
    const s = nearestOpen(scene, from, free), t = nearestOpen(scene, to, free);
    if (s < 0 || t < 0) return null;
    const cells = astar(scene, s, t, free);
    if (!cells) return null;
    const pts = smooth(scene, [centerOf(g, s), ...cells.slice(1, -1).map(c => centerOf(g, c)), centerOf(g, t)], free);
    // Si el origen está en celda libre, el primer punto de la rejilla sobra (ya se está ahí).
    if (free[cellOf(g, from)] && lineFree(scene, from, pts[1] || pts[0], free)) pts.shift();
    return pts;
  }
  // Camino por la rejilla: sale de su silla por el acceso, cruza la puerta si entra o sale de la sala, y llega a una
  // silla por su acceso. El último punto es siempre el destino exacto. Con opts.avoid ([{ p, r }]) rodea a esos
  // personajes; si así no hay camino devuelve null (el motor espera o se aparta).
  function gridRoute(scene, from, to, opts = {}) {
    const free = freeFor(scene, opts.avoid);
    const legs = [];
    const fromSeat = seatIndex(scene, from), toSeat = seatIndex(scene, to);
    let at = from;
    if (fromSeat >= 0 && scene.access) { legs.push(scene.access[fromSeat]); at = scene.access[fromSeat]; }
    const goal = toSeat >= 0 && scene.access ? scene.access[toSeat] : to;
    const ra = roomOf(scene, at), rb = roomOf(scene, goal);
    const stops = ra !== rb ? [...(ra ? [ra.door] : []), ...(rb && rb !== ra ? [rb.door] : [])] : [];
    for (const stop of [...stops, goal]) {
      if (stop !== goal && distance(stop, at) < 0.5) continue; // ya está en la puerta
      const leg = gridLeg(scene, at, stop, free);
      if (!leg && opts.avoid) return null;
      if (leg) legs.push(...leg.filter(p => distance(p, at) > 0.3 && distance(p, stop) > 0.3));
      legs.push(stop);
      at = stop;
    }
    if (goal !== to) legs.push(to);
    // Sin puntos repetidos seguidos ni el punto de partida.
    const out = [];
    for (const p of legs) if (distance(p, out.length ? out[out.length - 1] : from) > 0.05 || p === to) out.push(p);
    return curve(scene, from, out.length ? out : [to]);
  }
  // Esquinas en curva: cada vértice intermedio se cambia por un arco (Bézier cuadrática) que empieza y acaba a r del
  // vértice. Solo se acepta si todo el arco pisa suelo con holgura; si no, se prueba con la mitad y, al final, se deja
  // la esquina. El destino exacto no se toca.
  const roomy = (scene, p) => walkable(scene, p) && walkable(scene, [p[0] - 0.35, p[1]]) && walkable(scene, [p[0] + 0.35, p[1]])
    && walkable(scene, [p[0], p[1] - 0.25]) && walkable(scene, [p[0], p[1] + 0.25]);
  function curve(scene, from, pts) {
    const all = [from, ...pts], out = [];
    for (let i = 1; i < all.length; i++) {
      const a = all[i - 1], p = all[i], b = all[i + 1];
      if (!b) { out.push(p); break; }
      const la = distance(a, p), lb = distance(p, b);
      if (la < 1e-6 || lb < 1e-6) { out.push(p); continue; }
      // Giro en el plano del suelo (y ×1,6): casi recto no necesita curva.
      const ua = [(p[0] - a[0]) / la, (p[1] - a[1]) * 1.6 / la], ub = [(b[0] - p[0]) / lb, (b[1] - p[1]) * 1.6 / lb];
      const turn = 1 - (ua[0] * ub[0] + ua[1] * ub[1]);
      let arc = null;
      for (let r = Math.min(1.6, la / 2, lb / 2); turn > 0.05 && r >= 0.4 && !arc; r /= 2) {
        const k0 = r / la, k1 = r / lb;
        const A = [p[0] - (p[0] - a[0]) * k0, p[1] - (p[1] - a[1]) * k0], B = [p[0] + (b[0] - p[0]) * k1, p[1] + (b[1] - p[1]) * k1];
        const n = 5, q = [];
        for (let k = 0; k <= n; k++) {
          const t = k / n, u = 1 - t;
          q.push([+(u * u * A[0] + 2 * u * t * p[0] + t * t * B[0]).toFixed(2), +(u * u * A[1] + 2 * u * t * p[1] + t * t * B[1]).toFixed(2)]);
        }
        let ok = true;
        for (let k = 1; k < q.length && ok; k++) for (let m = 0; m <= 4 && ok; m++) {
          ok = roomy(scene, [q[k - 1][0] + (q[k][0] - q[k - 1][0]) * m / 4, q[k - 1][1] + (q[k][1] - q[k - 1][1]) * m / 4]);
        }
        if (ok) arc = q;
      }
      if (arc) out.push(...arc); else out.push(p);
    }
    return out;
  }
  // Tramo corto dentro del suelo y fuera de muebles (sin exigir la holgura de la rejilla): para salir de una silla o de
  // la puerta hacia la celda libre de al lado.
  function segmentWalkable(scene, a, b) {
    const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 0.2));
    for (let k = 0; k <= n; k++) if (!walkable(scene, [a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n])) return false;
    return true;
  }
  // Camino por el pasillo. Si no hay salida, devuelve la recta: el actor no se queda parado.
  function route(scene, from, to, opts) {
    if (!from || !to) return [to];
    if (scene.nav) return gridRoute(scene, from, to, opts);
    if (distance(from, to) < 0.2 || clearSegment(scene, from, to)) return [to];
    const nodes = [from, ...(scene.waypoints || []), to];
    const n = nodes.length, adj = Array.from({ length: n }, () => []);
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) if (clearSegment(scene, nodes[i], nodes[j])) {
      const w = distance(nodes[i], nodes[j]);
      adj[i].push([j, w]); adj[j].push([i, w]);
    }
    const cost = Array(n).fill(Infinity), prev = Array(n).fill(-1), used = Array(n).fill(false);
    cost[0] = 0;
    for (let k = 0; k < n; k++) {
      let u = -1;
      for (let i = 0; i < n; i++) if (!used[i] && (u < 0 || cost[i] < cost[u])) u = i;
      if (u < 0 || cost[u] === Infinity) break;
      used[u] = true;
      for (const [v, w] of adj[u]) if (cost[u] + w < cost[v]) { cost[v] = cost[u] + w; prev[v] = u; }
    }
    if (prev[n - 1] < 0) return [to];
    const path = [];
    for (let u = n - 1; u >= 0; u = prev[u]) path.push(nodes[u]);
    path.reverse();
    return path.slice(1);
  }
  // Personajes con ropa de oficina (public/oficina/<id>-N.png). La tripulación de la nave es el reparto por defecto;
  // los de la redacción (irene, tomas…) se eligen en la ficha. El operador y la sabia también son el personal fijo de
  // cada oficina (consola y barra): si un empleado lleva uno de los dos, ese personal no sale, para no ver dos iguales.
  const TRIPULACION = ['lider', 'elegido', 'piloto', 'capitana', 'operador', 'sabia'];
  const PERSONAJES = [...TRIPULACION, 'irene', 'tomas', 'lucia', 'kenji', 'sara', 'nico'];
  const PERSONAL = ['operador', 'sabia'];
  const POR_DEFECTO = ['lider', 'elegido', 'piloto', 'capitana', 'irene', 'tomas', 'lucia', 'kenji', 'sara', 'nico', 'operador', 'sabia'];
  // Reparto de una oficina: [{ id, avatar }] → { id: personaje }. Primero los elegidos en la ficha; el resto toma, por
  // orden, el primer personaje libre de POR_DEFECTO. Pura y determinista: el mismo equipo se ve igual en cada recarga.
  function reparto(list) {
    const out = {}, used = new Set();
    for (const s of list) if (PERSONAJES.includes(s.avatar)) { out[s.id] = s.avatar; used.add(s.avatar); }
    let i = 0;
    for (const s of list) {
      if (out[s.id]) continue;
      while (i < POR_DEFECTO.length && used.has(POR_DEFECTO[i])) i++;
      out[s.id] = POR_DEFECTO[i % POR_DEFECTO.length] || POR_DEFECTO[0];
      used.add(out[s.id]); i++;
    }
    return out;
  }
  const api = { resolve, seat, inside, clearSegment, walkable, route, reparto, TRIPULACION, PERSONAJES, PERSONAL,
    isFree, randomFree, lineFree, navGrid, isChair, accessOf, distance };
  if (typeof module !== 'undefined') module.exports = api;
  else root.Escenas = api;
})(typeof window === 'undefined' ? globalThis : window);
