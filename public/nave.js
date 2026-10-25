// Vista "Nave": la oficina como el puente isométrico de una nave, con la tripulación viva en la cubierta.
// Cada IA es un tripulante. Cuando le toca trabajar camina a su sillón, se sienta y teclea (y a ratos se levanta a
// pensar). En espera pasea, toma café en la cocina, conversa con otros o con el Operador, piensa. Al aprobar, celebra.
// Las tarjetas de las estaciones (app.js) siguen siendo el mismo HTML, a los lados de la escena.
// Arte: public/nave/ (nave, poses y acciones de Codex; los originales y sus prompts no se publican: ver docs/DECISIONES.md IN1).
(() => {
  // Arquetipos originales: la UI pública no usa nombres de personajes de la película (SIMULACIONES.md §6.3).
  // Ids de arquetipo. El rótulo sale de ui.avatar.* en cada pintado: el selector de idioma lo cambia sin recargar.
  const CREW_IDS = ['lider', 'elegido', 'piloto', 'capitana', 'operador', 'sabia'];
  const DEFAULT = { claude: 'lider', codex: 'elegido', gemini: 'piloto', grok: 'capitana' };
  const KEY = 'officematrix.vista';

  // Puntos de la escena en % de la imagen (x, y = donde pisan los pies). Ajustados a public/nave/escena-iso.jpg.
  let SCENE = Escenas.resolve();
  let officeId = 'edificio', council = false;
  const OFFICE_POSE = { front:[1], back:[4], walkFront:[15,16,17,18,19,20,21,22], walkBack:[23,24,25,26,27,28,29,30], sit:[5], think:[6], talk:[1,6], cheer:[6], coffee:[1], sitBack:[5], wait:[5] };
  const sprite = (av, n) => SCENE.fixed ? `/nave/iso/${av}-${n}.png` : `/oficina/${av}-${n}.png`;
  const poses = () => SCENE.fixed ? POSE : OFFICE_POSE;


  // Poses (public/nave/iso/<avatar>-N.png). 1 de pie de frente, 4 de pie de espaldas; 7-14 acciones;
  // 15-22 ciclo de caminata de frente (abajo-derecha) y 23-30 de espaldas (arriba-izquierda), 8 cuadros cada uno.
  // El espejo da las direcciones que faltan.
  const POSE = {
    front: [1], back: [4],
    walkFront: [15, 16, 17, 18, 19, 20, 21, 22], walkBack: [23, 24, 25, 26, 27, 28, 29, 30],
    sit: [7, 8], think: [9, 10], talk: [11, 1], cheer: [12, 12], coffee: [13, 1], sitBack: [14, 14], wait: [7],
  };
  // Cada cuánto cambia de cuadro cada acción (ms) y su icono encima de la cabeza.
  const TEMPO = { sit: 380, think: 1400, talk: 520, cheer: 9e9, coffee: 2200, sitBack: 9e9, wait: 9e9 };
  const EMOTE = { think: '💭', talk: '💬', cheer: '✔', coffee: '☕', sit: '⌨', sitBack: '⌨', wait: '⏳' };
  // Estado de un vistazo: con el ciclo en marcha quien espera turno se sienta en su escritorio con ⏳ y quien no está en
  // la misión se va a la barra con 💤. Solo quien trabaja lleva globo. La leyenda de la escena cuenta cuántos hay de cada.
  const STATE_ICON = { failed: '⛔', off: '💤' };
  const STAND_H = 200; // alto en px de una pose de pie (las sentadas son más bajas y se escalan igual)
  const THINKING = /pens|razon|analiz|planific|reflexion|thinking|reason/i;

  const avatarOf = a => (a.avatar && CREW_IDS.includes(a.avatar) ? a.avatar : DEFAULT[a.id] || 'operador');
  const crewName = a => {
    const id = avatarOf(a);
    const key = `ui.avatar.${id}`;
    const s = t(key);
    return s === key ? id : s;
  };
  const roleTag = key => crewName({ avatar: key }).toUpperCase();
  // No se mira "reducir movimiento" (Windows lo activa al quitar las animaciones): el usuario pidió verlos moverse,
  // y si saltaran de un punto a otro parecería que aparecen de la nada. El botón OFICINA es la vista quieta.
  // Distancias «de suelo»: % del ancho, con el eje y ×1,6 (el suelo isométrico está aplastado). Ver D62.
  const SPEED = { idle: 3.5, work: 5 };   // crucero, por segundo
  const ACCEL = 6, BRAKE = 7;             // por segundo²: arranca en ~0,7 s y frena en ~0,6 s, sin saltos de velocidad
  // Lo que avanza un ciclo completo (dos pasos). El cuadro del ciclo sale de la distancia recorrida, no del reloj:
  // los pies acompañan al avance aunque acelere, frene o espere a otro, y no patina.
  const STRIDE = 7;
  // Espacio personal: mira LOOK por delante. Si su camino pasaría a menos de PASS de otro (SEAT_PASS si está sentado:
  // sus pies asoman al pasillo), frena y se para a STOP de frente o a SIDE de lado. Y nunca, por nada, da un paso que lo
  // deje a menos de MIN_GAP de nadie: así nadie atraviesa a nadie.
  const LOOK = 3.6, STOP = 2.2, SIDE = 1.6, PASS = 1.5, SEAT_PASS = 1.25, MIN_GAP = 1.25;
  const SIT_MIN = 8000;                   // ms que sigue sentado antes de levantarse: sin bucles sentarse/levantarse
  const GAP = [6, 4.5];                   // distancia mínima (x, y en %) entre los destinos de dos tripulantes
  const SEATED = ['sit', 'wait', 'sitBack'];
  const rand = (a, b) => a + Math.random() * (b - a);
  const pick = list => list[(Math.random() * list.length) | 0];
  const ground = (a, b) => Math.hypot(b[0] - a[0], (b[1] - a[1]) * 1.6);

  let on = true;
  try { on = localStorage.getItem(KEY) !== 'oficina'; } catch {}

  let stage, raf = 0, last = 0;
  const actors = new Map();
  const heights = new Map(); // src -> alto natural, para escalar sentadas/de pie con la misma proporción

  // ---------- Geometría ----------
  const inside = (p, poly) => {
    let c = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [xi, yi] = poly[i], [xj, yj] = poly[j];
      if ((yi > p[1]) !== (yj > p[1]) && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) c = !c;
    }
    return c;
  };
  function randomFloor() {
    // Oficina: solo celdas libres de la zona conectada (nunca detrás de la barra ni dentro de un mueble).
    if (SCENE.nav && Escenas.randomFree) return Escenas.randomFree(SCENE, Math.random); // el azar de esta página (sembrado en las pruebas)
    const xs = SCENE.floor.map(p => p[0]), ys = SCENE.floor.map(p => p[1]);
    for (let i = 0; i < 50; i++) {
      const p = [rand(Math.min(...xs), Math.max(...xs)), rand(Math.min(...ys), Math.max(...ys))];
      if (Escenas.walkable ? Escenas.walkable(SCENE, p) : inside(p, SCENE.floor)) return p;
    }
    return [...SCENE.floor[0]];
  }
  const near = (p, dx, dy) => [p[0] + dx, p[1] + dy];
  // Libre = ningún otro tripulante está ni va a estar ahí (cuenta su destino, no solo dónde está ahora).
  const goalOf = o => o.route?.length ? o.route[o.route.length - 1] : null;
  const taken = (p, self) => [...actors.values()].some(o => o !== self &&
    [o.pos, goalOf(o)].some(q => q && Math.abs(q[0] - p[0]) < GAP[0] && Math.abs(q[1] - p[1]) < GAP[1]));
  const freeFloor = self => {
    for (let i = 0; i < 30; i++) { const p = randomFloor(); if (!taken(p, self)) return p; }
    return randomFloor();
  };
  const freeOf = (spots, self) => spots.find(p => !taken(p, self));
  const seatOf = home => near(home, SCENE.sit[0], SCENE.sit[1]);

  // ---------- Actores ----------
  function makeActor(key, av, label, color, pos) {
    const el = document.createElement('div');
    el.className = 'actor';
    el.style.setProperty('--c', color || '#7dffb0');
    el.innerHTML = `<div class="halo"></div><span class="aviso" hidden aria-label="${t('nave.outOfService')}">⚠</span><img class="body" alt="">
      <span class="say" hidden></span><span class="tag"></span><span class="emote" hidden></span>`;
    el.querySelector('.tag').textContent = label;
    stage.appendChild(el);
    const a = {
      key, av, el, img: el.querySelector('.body'), emote: el.querySelector('.emote'), say: el.querySelector('.say'),
      pos: pos ? [...pos] : freeFloor(), route: null, v: 0, phase: 0, act: 'stand', facing: 'front', flip: false, step: 0, until: 0, mode: 'idle', queue: [],
    };
    // Precarga todas sus poses: si un cuadro llegara tarde, el tripulante parpadearía al caminar.
    for (const n of new Set(Object.values(poses()).flat())) {
      const src = sprite(av, n), im = new Image();
      im.onload = () => heights.set(src, im.naturalHeight);
      im.src = src;
    }
    a.img.onload = () => { heights.set(a.img.getAttribute('src'), a.img.naturalHeight); size(a); };
    actors.set(key, a);
    draw(a);
    return a;
  }

  function size(a) {
    const h = heights.get(a.img.getAttribute('src'));
    if (h) a.img.style.height = `${(h / STAND_H) * (SCENE.fixed ? 20 : 15)}cqh`;
  }

  function frameOf(a, now) {
    const pose = poses();
    // Parado esperando a que otro pase: de pie, no congelado a mitad de zancada.
    if (a.act === 'walk' && a.v > 0.05) { const f = a.facing === 'back' ? pose.walkBack : pose.walkFront; return f[a.step % f.length]; }
    if (a.act === 'stand' || a.act === 'walk') return (a.facing === 'back' ? pose.back : pose.front)[0];
    const frames = pose[a.act];
    return frames[Math.floor(now / TEMPO[a.act]) % frames.length];
  }

  function draw(a, now = performance.now()) {
    const src = sprite(a.av, frameOf(a, now));
    if (a.img.getAttribute('src') !== src) { a.img.setAttribute('src', src); size(a); }
    a.el.style.left = `${a.pos[0]}%`;
    a.el.style.top = `${a.pos[1]}%`;
    a.el.style.zIndex = String(Math.round(a.pos[1] * 10));
    a.img.classList.toggle('flip', a.flip);
    const icon = STATE_ICON[a.mode] || EMOTE[a.act] || '';
    // Mientras trabaja lleva un globo con lo que está haciendo (lo mismo que su tarjeta) y, debajo, lo último que
    // pensó o dijo. Quien espera turno no lleva globo (con 6 empleados eran 5 globos amontonados): lleva ⏳.
    const head = a.mode === 'work' ? `${THINKING.test(a.activity || '') ? '💭' : icon || '⌨'} ${a.activity || t('nave.working')}` : '';
    const said = a.mode === 'work' && a.said ? `«${a.said}»` : '';
    if (a.sayHead !== head || a.saySaid !== said) {
      a.sayHead = head; a.saySaid = said;
      a.say.replaceChildren(Object.assign(document.createElement('b'), { textContent: head }), Object.assign(document.createElement('i'), { textContent: said }));
    }
    a.say.hidden = !head;
    a.say.classList.toggle('queued', a.mode !== 'work');
    const say = head;
    if (a.emote.textContent !== icon) a.emote.textContent = icon;
    a.emote.hidden = !icon || !!say;
    a.el.dataset.act = a.act;
  }

  // ---------- Guiones: una cola de pasos { go:[x,y] } | { act, ms, facing } ----------
  const go = p => ({ go: p });
  const doing = (act, ms, extra = {}) => ({ act, ms, ...extra });

  // Qué hace a continuación según su estado. Trabajar manda; en espera, se elige algo al azar.
  function plan(a, now) {
    if (a.key === 'sabia') {
      return a.lit ? [doing('talk', 3000)] : [go(SCENE.kitchen), doing(pick(['stand', 'stand', 'coffee', 'think']), rand(4000, 9000))];
    }
    if (a.key === 'operador') {
      if (a.busyAny) return [go(SCENE.console), doing('sitBack', 6000, { facing: 'back', flip: true })];
      return pick([
        [go(SCENE.console), doing('sitBack', rand(5000, 9000), { facing: 'back', flip: true })],
        [go(freeOf(SCENE.coffee, a) || freeFloor(a)), doing('coffee', rand(7000, 12000))],
        [go(freeFloor(a)), doing('stand', rand(4000, 8000))],
      ]);
    }
    // Consejo: todos a la sala de juntas, sentados (quien trabaja lleva su globo). Si no hay silla, de pie junto a la mesa.
    // La ruta ya entra por la puerta (sin pararse en ella: si todos se detienen en el mismo punto, se atascan).
    if (!SCENE.fixed && council && !['failed', 'off'].includes(a.mode)) {
      return [go(a.meeting), doing(Escenas.isChair(SCENE, a.meeting) ? 'sit' : 'stand', 9e9)];
    }
    // Trabaja o piensa: a SU silla, y sentado todo el turno. Lo que hace (o que está pensando, 💭) va en su globo; no se
    // levanta a pensar (las CLIs alternan «pensando» y herramientas cada pocos segundos: sería un bucle).
    if (a.mode === 'work') return [go(seatOf(a.home)), doing(a.chair ? 'sit' : 'think', 9e9)];
    // Caído: de pie en el pasillo junto a su puesto (no encima de la silla).
    if (a.mode === 'failed') return [go(Escenas.accessOf(SCENE, a.home)), doing('stand', 9e9)];
    // Fuera de la misión: en la oficina, a la zona del café (lejos de los escritorios); en la nave, junto a su sillón.
    if (a.mode === 'off') return [go(SCENE.fixed ? Escenas.accessOf(SCENE, a.home) : freeOf(SCENE.coffee, a) || freeFloor(a)), doing('stand', 9e9)];
    // Espera su turno: sentado en su escritorio, quieto. Cada uno en su sitio, así no se juntan en el pasillo.
    if (a.queued) return [go(seatOf(a.home)), doing(a.chair ? 'wait' : 'stand', 9e9)];
    // En espera.
    const others = [...actors.values()].filter(o => o !== a && o.mode === 'idle' && o.key !== 'sabia' && !['walk', 'cheer'].includes(o.act) && !o.queue.length);
    const r = Math.random();
    const cup = freeOf(SCENE.coffee, a);
    if (r < 0.18 && cup) return [go(cup), doing('coffee', rand(8000, 14000))];
    if (r < 0.32 && others.length) {
      // Conversa con alguien: va a su lado y los dos hablan un rato.
      const o = pick(others);
      const spot = near(o.pos, o.pos[0] > 50 ? -4.5 : 4.5, 1.5);
      if ((SCENE.nav ? Escenas.isFree(SCENE, spot) : inside(spot, SCENE.floor)) && !taken(spot, a)) {
        o.queue = [doing('talk', 8000)];
        o.until = 0;
        return [go(spot), doing('talk', 8000)];
      }
    }
    const chat = freeOf(SCENE.chat, a);
    if (r < 0.45 && chat) return [go(chat), doing('talk', rand(5000, 9000))];
    if (r < 0.62) return [doing('think', rand(5000, 9000))];
    return [go(freeFloor(a)), doing('stand', rand(5000, 10000))];
  }
  // Recién sentado no se levanta todavía: si el plan lo saca de la silla (o lo pone de pie ahí mismo), antes cumple
  // SIT_MIN sentado. Así un cambio de estado de ida y vuelta (espera → libre → espera) no es sentarse y levantarse.
  function nextScript(a, now) { return guard(a, plan(a, now), now); }
  function guard(a, script, now) {
    if (!SEATED.includes(a.act) || a.satAt == null || now - a.satAt >= SIT_MIN) return script;
    const [first, second] = script;
    const staysSeated = first && (first.go ? ground(first.go, a.pos) < 0.2 && SEATED.includes(second?.act) : SEATED.includes(first.act));
    return staysSeated ? script : [doing(a.act, SIT_MIN - (now - a.satAt)), ...script];
  }

  // Isométrico: hacia abajo = de frente; hacia arriba = de espaldas. El espejo cubre izquierda/derecha. Con margen: en
  // un tramo casi horizontal conserva la orientación que traía (si no, una curva suave lo haría girar a cada paso).
  function face(a, dx, dy) {
    const d = Math.hypot(dx, dy);
    if (d < 1e-6) return;
    if (dy > 0.3 * d) a.facing = 'front';
    else if (dy < -0.3 * d) a.facing = 'back';
    if (Math.abs(dx) > 0.2 * d) a.flip = a.facing === 'front' ? dx < 0 : dx > 0;
  }

  // ---------- Caminar: aceleración, frenado, ceder el paso y rodear ----------
  const rank = o => (o.mode === 'work' ? 3 : o.queued ? 2 : o.mode === 'idle' ? 1 : 0);
  // Quién le estorba al avanzar: alguien a menos de LOOK por delante cuyo punto de máximo acercamiento (si sigue recto)
  // queda a menos de PASS. d = distancia «efectiva»: con d ≤ STOP hay que estar parado.
  function blocker(a, now) {
    if (now < (a.ghostUntil || 0)) return null;
    const next = a.route[0];
    let ux = next[0] - a.pos[0], uy = (next[1] - a.pos[1]) * 1.6;
    const n = Math.hypot(ux, uy);
    if (n < 1e-6) return null;
    ux /= n; uy /= n;
    let best = null;
    for (const o of actors.values()) {
      if (o === a) continue;
      const dx = o.pos[0] - a.pos[0], dy = (o.pos[1] - a.pos[1]) * 1.6, d = Math.hypot(dx, dy);
      if (d > LOOK || d < 1e-6) continue;
      const ahead = dx * ux + dy * uy;
      if (ahead <= 0) continue; // detrás o al lado: no se acerca
      const seated = SEATED.includes(o.act), lateral = Math.sqrt(Math.max(0, d * d - ahead * ahead));
      if (lateral >= (seated ? SEAT_PASS : PASS)) continue; // pasa por su lado sin rozarlo
      // De frente se para a STOP; de lado (o junto a un sentado) puede quedar más cerca.
      const stop = seated ? MIN_GAP + 0.05 : ahead / d >= 0.7 ? STOP : SIDE;
      const g = d + STOP - stop;
      if (!best || g < best.d) best = { o, d: g };
    }
    return best;
  }
  // Un punto libre a 3–5 pasos que se aleja de quien viene (para dejarle pasar en un sitio estrecho).
  function aside(a, o) {
    let best = null, score = -Infinity;
    for (let k = 0; k < 16; k++) {
      const ang = (k / 16) * Math.PI * 2, r = 3 + (k % 3);
      const p = [a.pos[0] + Math.cos(ang) * r, a.pos[1] + (Math.sin(ang) * r) / 1.6];
      if (!Escenas.isFree(SCENE, p) || !Escenas.lineFree(SCENE, a.pos, p)) continue;
      const ahead = goalOf(o) || o.pos;
      const s = Math.min(ground(p, o.pos), ground(p, ahead) + 1) - (taken(p, a) ? 5 : 0);
      if (s > score) { score = s; best = p; }
    }
    return best;
  }
  // Ruta que rodea a quien está sentado (sus piernas asoman al pasillo y no se va a mover); si así no hay camino, la normal.
  const seatedAvoid = a => [...actors.values()].filter(o => o !== a && SEATED.includes(o.act)).map(o => ({ p: o.pos, r: 1.6 }));
  function planRoute(a, goal) {
    if (!Escenas.route) return [goal];
    const around = SCENE.nav ? Escenas.route(SCENE, a.pos, goal, { avoid: seatedAvoid(a) }) : null;
    return (around && around.length ? around : Escenas.route(SCENE, a.pos, goal)).filter(Boolean);
  }
  function setRoute(a, goal, now) {
    a.goal = goal;
    a.route = planRoute(a, goal);
    a.act = 'walk';
    a.blockedAt = 0;
    a.lastWalk = now;
  }
  // Cuando lleva un rato parado detrás de alguien: primero busca otro camino que lo rodee; si no lo hay y se bloquean
  // los dos, cede el de menos prioridad (quien trabaja pasa primero) apartándose; a quien está quieto de pie se le pide
  // que se aparte. Como último recurso (más de 9 s) pasa: nunca se queda atascado para siempre.
  function unblock(a, o, now) {
    const waited = now - a.blockedAt;
    if (waited > 9000) { a.ghostUntil = now + 1500; a.blockedAt = 0; return; }
    if (waited < 900 || now - (a.replanAt || 0) < 1500) return;
    a.replanAt = now;
    const avoid = [...actors.values()].filter(x => x !== a && ground(x.pos, a.pos) < 10)
      .map(x => ({ p: x.pos, r: SEATED.includes(x.act) ? 1.6 : STOP }));
    const alt = Escenas.route ? Escenas.route(SCENE, a.pos, a.goal, { avoid }) : null;
    if (alt && alt.length) { a.route = alt; a.blockedAt = 0; return; }
    if (waited < 2000) return;
    const still = o.act !== 'walk' || !o.route;
    if (still && !SEATED.includes(o.act) && o.mode !== 'work' && o.key !== 'operador' && o.key !== 'sabia') {
      const p = aside(o, a);
      if (p) { o.queue.unshift(doing(o.act === 'walk' ? 'stand' : o.act, Math.max(0, o.until - now)), ); o.queue.unshift({ go: p }); o.until = 0; o.route = null; }
      return;
    }
    const mutual = !still && o.blockedAt && o.route && blocker(o, now)?.o === a;
    if (mutual && (rank(a) < rank(o) || (rank(a) === rank(o) && a.key > o.key))) {
      const p = aside(a, o);
      if (p) { a.queue.unshift({ go: a.goal }); a.goal = p; a.route = planRoute(a, p); a.blockedAt = 0; }
    }
  }
  function walk(a, now, dt) {
    const s = dt / 1000, pace = a.mode === 'work' ? SPEED.work : SPEED.idle;
    let left = ground(a.pos, a.route[0]);
    for (let i = 1; i < a.route.length; i++) left += ground(a.route[i - 1], a.route[i]);
    // Frena para llegar parado; +0,3 para no quedarse a milímetros del destino.
    let cap = Math.min(pace, Math.sqrt(2 * BRAKE * left) + 0.3);
    const ahead = blocker(a, now);
    if (ahead) cap = ahead.d <= STOP ? 0 : Math.min(cap, (pace * (ahead.d - STOP)) / (LOOK - STOP));
    a.v = a.v < cap ? Math.min(cap, a.v + ACCEL * s) : Math.max(cap, a.v - 2 * BRAKE * s);
    if (ahead && a.v < 0.3) { a.blockedAt = a.blockedAt || now; unblock(a, ahead.o, now); }
    else if (!ahead) a.blockedAt = 0;
    let move = a.v * s;
    const from = a.pos, route0 = [...a.route];
    while (move > 0 && a.route?.length) {
      const p = a.route[0], d = ground(a.pos, p);
      if (d <= move) { a.pos = [...p]; a.route.shift(); move -= d; }
      else { a.pos = [a.pos[0] + ((p[0] - a.pos[0]) * move) / d, a.pos[1] + ((p[1] - a.pos[1]) * move) / d]; move = 0; }
    }
    // Tope duro: si este paso lo deja a menos de MIN_GAP de alguien (y más cerca que antes), no lo da.
    for (const o of actors.values()) {
      if (o === a) continue;
      const after = ground(a.pos, o.pos);
      if (after < MIN_GAP && after < ground(from, o.pos)) { a.pos = from; a.route = route0; a.v = 0; a.blockedAt = a.blockedAt || now; break; }
    }
    const moved = ground(from, a.pos);
    if (moved > 1e-4) face(a, a.pos[0] - from[0], (a.pos[1] - from[1]) * 1.6);
    else if (a.route?.length) face(a, a.route[0][0] - a.pos[0], (a.route[0][1] - a.pos[1]) * 1.6);
    a.phase += (moved / STRIDE) * poses().walkFront.length;
    a.step = Math.floor(a.phase);
    a.act = 'walk';
    if (!a.route?.length) { a.route = null; a.v = 0; }
  }

  function stepActor(a, now, dt) {
    if (a.route) {
      walk(a, now, dt);
      if (a.route) { draw(a, now); return; }
      a.until = 0;
    }
    if (now >= a.until) {
      if (!a.queue.length) a.queue = nextScript(a, now);
      // Un "ve a" donde ya está no cuenta como caminar (si no, el sentado se pararía un instante).
      while (a.queue[0]?.go && ground(a.queue[0].go, a.pos) < 0.2) a.queue.shift();
      if (!a.queue.length) a.queue = nextScript(a, now);
      let s = a.queue.shift();
      // Si al pararse queda encima de otro, primero se aparta a un sitio libre (por el camino, no en línea recta).
      if (!s.go && a.mode === 'idle' && a.key !== 'sabia' && ['stand', 'think'].includes(s.act) && taken(a.pos, a)) {
        a.queue.unshift(s);
        s = { go: freeFloor(a) };
      }
      if (s.go) setRoute(a, s.go, now);
      else {
        if (SEATED.includes(s.act) && !SEATED.includes(a.act)) a.satAt = now;
        a.act = s.act;
        a.until = now + s.ms;
        // Sentado en su sillón mira al frente (los sillones dan a la cubierta); en la consola, de espaldas.
        if (s.facing) { a.facing = s.facing; a.flip = !!s.flip; }
        else if (s.act === 'sit' || s.act === 'wait') { a.facing = 'front'; a.flip = false; }
        else if (s.act !== 'stand') a.facing = 'front';
      }
    }
    draw(a, now);
  }

  function loop(t) {
    raf = 0;
    if (!on || document.hidden) return;
    if (t - last >= 50) {
      const dt = last ? Math.min(200, t - last) : 50;
      last = t;
      for (const a of actors.values()) stepActor(a, t, dt);
    }
    raf = requestAnimationFrame(loop);
  }
  function start() { if (!raf && on && !document.hidden) { last = 0; raf = requestAnimationFrame(loop); } }

  // Cambia ya lo que hace (al empezar o terminar su turno no espera a acabar el café).
  // La ruta se corta pero la velocidad se conserva: si iba andando, frena o gira desde donde está, sin saltos.
  function interrupt(a, script) { a.queue = script || []; a.until = 0; a.route = null; }

  // ---------- API para app.js ----------

  // Personal fijo (operador en la consola, sabia en la barra): sale salvo que un empleado lleve su personaje.
  function staff(taken) {
    const want = [['operador', 'operador', 'console'], ['sabia', 'sabia', 'kitchen']];
    for (const [key, av, spot] of want) {
      const a = actors.get(key);
      if (taken.includes(av)) { if (a) { a.el.remove(); actors.delete(key); } continue; }
      if (a) {
        // El operador con ciclo en marcha lleva la fase en la etiqueta (setBusy). La sabia, solo su nombre.
        if (key === 'sabia') a.el.querySelector('.tag').textContent = roleTag(key);
        else if (!a.busyText) a.el.querySelector('.tag').textContent = roleTag(key);
        continue;
      }
      // Nace ya en su puesto (antes nacía al azar y saltaba a él en el primer cuadro).
      const n = makeActor(key, av, roleTag(key), key === 'operador' ? '#7dffb0' : '#39e58c', SCENE[spot]);
      n.el.dataset.hover = `crew:${key}`;
      if (key === 'sabia') n.el.classList.add('sabia');
    }
  }

  // Leyenda de la escena: cuántos trabajan, esperan turno o están fuera, con el mismo icono que llevan encima.
  function legend(list) {
    const el = stage?.parentElement.querySelector('.scene-legend');
    if (!el) return;
    const n = { working: 0, queued: 0, off: 0, failed: 0 };
    for (const s of list) {
      if (s.cls === 'working') n.working++;
      else if (s.cls === 'failed') n.failed++;
      else if (s.cls === 'off') n.off++;
      else if (s.queued) n.queued++;
    }
    const parts = [[n.working, '⌨', 'nave.legend.workingOne', 'nave.legend.workingMany'], [n.queued, '⏳', 'nave.legend.queuedOne', 'nave.legend.queuedMany'],
      [n.off, '💤', 'nave.legend.offOne', 'nave.legend.offMany'], [n.failed, '⛔', 'nave.legend.failedOne', 'nave.legend.failedMany']]
      .filter(([k]) => k).map(([k, i, one, many]) => `${i} ${k} ${t(k === 1 ? one : many)}`);
    el.textContent = parts.join(' · ') || t('nave.legend.idle', { n: list.length, place: t(SCENE.fixed ? 'nave.legend.ship' : 'nave.legend.office') });
  }

  // Sincroniza la tripulación con las estaciones:
  // [{ id, name, color, avatar, cls: working|ready|failed|off, activity, lastTs, verdict }].
  function sync(list) {
    if (!stage) return;
    const seen = new Set(['operador', 'sabia']);
    // En la oficina, el reparto por defecto es la tripulación con ropa de oficina; la ficha puede elegir cualquier
    // personaje (Escenas.reparto). Si un empleado lleva el del operador o la sabia, ese personal no sale.
    const cast = SCENE.fixed ? {} : Escenas.reparto(list.map(s => ({ id: s.id, avatar: s.avatar })));
    staff(Object.values(cast));
    // Etiqueta corta en la oficina: el nombre de pila (o el completo si dos lo comparten). Modelo y puesto, en el tooltip.
    const first = s => String(s.name || s.id).split(/\s+/)[0];
    const shared = new Set(list.map(first).filter((n, i, arr) => arr.indexOf(n) !== i));
    // Consejo: quien ya trabaja en una silla de la sala la conserva; los demás toman las libres por orden y, si no
    // quedan, se quedan de pie junto a la mesa. Nadie comparte silla.
    const homes = list.map((s, i) => Escenas.seat(SCENE, s.id, i));
    const spare = [...(SCENE.meeting || []).filter(m => !homes.includes(m)), ...(SCENE.standRoom || [])];
    let nextSpare = 0;
    list.forEach((s, i) => {
      seen.add(s.id);
      const av = SCENE.fixed ? avatarOf(s) : cast[s.id];
      let a = actors.get(s.id);
      if (a && a.av !== av) { a.el.remove(); actors.delete(s.id); a = null; } // cambió de personaje en la ficha
      a = a || makeActor(s.id, av, s.name.toUpperCase(), s.color);
      a.home = homes[i];
      a.chair = Escenas.isChair(SCENE, a.home);
      a.meeting = SCENE.meeting?.includes(a.home) ? a.home : spare[nextSpare++ % Math.max(1, spare.length)];
      a.el.querySelector('.tag').textContent = (SCENE.fixed || shared.has(first(s)) ? s.name : first(s)).toUpperCase();
      a.activity = s.activity;
      a.said = s.said;
      const mode = s.cls === 'working' ? 'work' : s.cls === 'failed' ? 'failed' : s.cls === 'off' ? 'off' : 'idle';
      if (mode !== a.mode || !!s.queued !== a.queued) { a.mode = mode; a.queued = !!s.queued; interrupt(a); }
      // Turno nuevo terminado con APROBADO: celebra en su sitio.
      if (s.lastTs && a.lastTs && s.lastTs !== a.lastTs && mode === 'idle' && s.verdict === 'APROBADO') interrupt(a, guard(a, [doing('cheer', 3500)], performance.now()));
      a.lastTs = s.lastTs;
      a.el.className = `actor ${s.cls}${a.el.classList.contains('hl') ? ' hl' : ''}`;
      a.el.querySelector('.aviso').hidden = s.cls !== 'failed';
      a.el.dataset.hover = `agent:${s.id}`; // tooltip propio de app.js: quién es, qué hace, qué piensa, cuánto lleva
    });
    for (const [k, a] of actors) if (!seen.has(k)) { a.el.remove(); actors.delete(k); }
    legend(list);
    const operadorCrew = actors.get('operador');
    if (operadorCrew) {
      const busy = list.some(s => s.cls === 'working');
      if (busy !== operadorCrew.busyAny) { operadorCrew.busyAny = busy; interrupt(operadorCrew); }
    }
    start();
  }

  // Lo que hace ahora un agente que trabaja. Sigue sentado: si piensa, su globo lleva 💭 (ver draw).
  function activity(id, text, said) {
    const a = actors.get(id);
    if (!a) return;
    a.activity = text;
    a.said = said;
    draw(a);
  }

  // El Operador muestra en su etiqueta la fase y la ronda del ciclo.
  function setBusy(text) {
    const a = actors.get('operador');
    if (!a) return;
    a.busyText = text || '';
    const tag = a.el.querySelector('.tag');
    const name = roleTag('operador');
    if (tag) tag.textContent = a.busyText ? `${name} · ${a.busyText}` : name;
  }

  // El Oráculo se ilumina (y habla) cuando alguien guarda en el cerebro compartido.
  let sabiaTimer;
  function sabia() {
    const o = actors.get('sabia');
    if (!o) return;
    o.lit = true;
    o.el.classList.add('lit');
    interrupt(o);
    clearTimeout(sabiaTimer);
    sabiaTimer = setTimeout(() => { o.lit = false; o.el.classList.remove('lit'); }, 4000);
  }

  function apply() {
    document.getElementById('deck').classList.toggle('nave', on);
    relabel();
    start();
  }

  // El texto del botón de vista, en el idioma elegido (también al cambiar de idioma).
  function relabel() {
    const btn = document.getElementById('viewBtn');
    const [icon, key] = on ? (SCENE.fixed ? ['🛸', 'nave.view.ship'] : ['🏢', 'nave.view.office']) : ['▦', 'nave.view.cards'];
    btn.innerHTML = `${icon} <span class="lbl">${t(key)}</span>`; // en móvil solo el icono (style.css)
    btn.dataset.hover = 'txt:' + t(on ? 'nave.view.sceneHover' : 'nave.view.cardsHover');
    for (const a of actors.values()) a.el.querySelector('.aviso')?.setAttribute('aria-label', t('nave.outOfService'));
    const sage = actors.get('sabia');
    if (sage) sage.el.querySelector('.tag').textContent = roleTag('sabia');
    const op = actors.get('operador');
    if (op) setBusy(op.busyText || '');
  }

  // La selección cambia datos y actores, conservando un único bucle de animación.
  function setOffice(o, offices = [], navigate) {
    if (!stage) return;
    const changed = officeId !== o.id;
    if (changed) {
      officeId = o.id;
      SCENE = Escenas.resolve(o);
      for (const a of actors.values()) a.el.remove();
      actors.clear();
      stage.querySelector('.room').src = SCENE.image;
      stage.style.aspectRatio = SCENE.ratio;
      stage.dataset.scene = SCENE.id;
      mountLayers();
      stage.dataset.council = 'false';
      council = false;
      // El operador y la sabia viven en la nave y en cada oficina (en la oficina, la sabia atiende la barra del café).
      staff([]);
    }
    let nav = stage.parentElement.querySelector('.elevators');
    if (!nav) { nav = document.createElement('nav'); nav.className = 'elevators'; nav.setAttribute('aria-label', t('nave.elevators')); stage.parentElement.appendChild(nav); }
    const destinations = SCENE.fixed ? offices.filter(x => x.id !== 'edificio') : [{id:'edificio', nombre:t('nave.backToShip')}];
    const signature = JSON.stringify(destinations.map(d => [d.id,d.nombre]));
    if (nav.dataset.destinations === signature) { apply(); return; }
    nav.dataset.destinations = signature;
    nav.replaceChildren();
    for (const dest of destinations) {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'btn small';
      b.textContent = `↕ ${dest.nombre}`; b.onclick = () => navigate(dest.id);
      nav.appendChild(b);
    }
    apply();
  }
  // Copia recortada de la misma placa: el mobiliario tapa a quien tiene los pies más lejos.
  function mountLayers() {
    for (const el of [...stage.children]) if (el.className === 'occluder') el.remove();
    for (const layer of SCENE.occluders || []) {
      const el = document.createElement('div');
      el.className = 'occluder';
      el.dataset.layer = layer.id;
      el.style.zIndex = String(Math.round(layer.y * 10));
      const img = document.createElement('img');
      img.className = 'veil';
      img.alt = '';
      img.setAttribute('src', SCENE.image);
      img.style.clipPath = layer.clip;
      el.appendChild(img);
      stage.appendChild(el);
    }
  }
  function setCouncil(value) {
    value = !!value && !SCENE.fixed;
    if (value === council) return;
    council = value;
    stage.dataset.council = String(value);
    // Cada uno rehace su plan; quien sale de la sala lo hace por la puerta porque su ruta pasa por ella.
    for (const a of actors.values()) interrupt(a);
  }

  function init() {
    const host = document.getElementById('stations');
    const scene = document.createElement('div');
    scene.className = 'scene';
    scene.setAttribute('aria-label', t('nave.sceneLabel')); // decorativa: lo mismo está en las tarjetas (los tripulantes sí reciben el ratón)
    scene.innerHTML = '<div class="stage"><img class="room" src="/nave/escena-iso.jpg" alt=""></div><div class="scene-legend" aria-live="polite"></div>';
    host.before(scene);
    stage = scene.querySelector('.stage');
    staff([]);
    // Pasar el ratón por una tarjeta resalta a su tripulante.
    const hl = (e, v) => { const st = e.target.closest('.station'); if (st) actors.get(st.id.slice(3))?.el.classList.toggle('hl', v); };
    host.addEventListener('mouseover', e => hl(e, true));
    host.addEventListener('mouseout', e => hl(e, false));
    document.getElementById('viewBtn').onclick = () => {
      on = !on;
      try { localStorage.setItem(KEY, on ? 'nave' : 'oficina'); } catch {}
      apply();
    };
    document.addEventListener('visibilitychange', start);
    apply();
  }

  window.Nave = { init, relabel, sync, activity, crewName, setBusy, sabia, setOffice, setCouncil, get SCENE() { return SCENE; },
    // Estado interno de cada actor, solo para pruebas y sondas (no lo usa app.js).
    debug: () => [...actors.values()].map(a => ({ key: a.key, pos: a.pos, act: a.act, v: a.v, route: a.route, goal: a.goal, blockedAt: a.blockedAt, mode: a.mode, queue: a.queue })) };
})();
