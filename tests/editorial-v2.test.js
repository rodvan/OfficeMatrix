// Editorial v2 (docs/BRIEF-EDITORIAL-V2.md, docs/EDITORIAL-V2.md): rutinas permanentes, cadena «lo que pegó → más como
// eso», semáforo antidesinformación, encargos, galería y vuelta de ViralHunt. Todo contra un ViralHunt SIMULADO
// (tests/helpers/viralhunt-falso.js) y agentes falsos: nunca se llama a la API real.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const ed = require('../lib/editorial');
const rut = require('../lib/rutinas');
const cadena = require('../lib/cadena');
const { crearViralHuntFalso } = require('./helpers/viralhunt-falso');

// ---------- Funciones puras: el planificador ----------

const at = (dia, h) => ed.instante('UTC', dia, h);
const rutina = extra => rut.normalizarRutinas([{ tipo: 'radar', activa: true, cadaMin: 60, ...extra }]).rutinas.find(r => r.tipo === 'radar');

test('rutina horaria: dispara a la hora, una sola vez, y tras dormir hace UNA de recuperación', () => {
  const r = rutina({});
  const st = { activadaEn: new Date(at('2026-10-26', '06:30')).toISOString() };
  assert.strictEqual(rut.rutinaDebida({ rut: r, st, zona: 'UTC', ahora: at('2026-10-26', '06:59') }).motivo, 'antes-de-activar');
  const d = rut.rutinaDebida({ rut: r, st, zona: 'UTC', ahora: at('2026-10-26', '07:00') });
  assert.strictEqual(d.lanzar, true);
  assert.strictEqual(d.franja.clave, '2026-10-26T07:00');
  st.ultimaClave = d.franja.clave;
  assert.strictEqual(rut.rutinaDebida({ rut: r, st, zona: 'UTC', ahora: at('2026-10-26', '07:01') }).motivo, 'ya-lanzada');
  assert.strictEqual(rut.rutinaDebida({ rut: r, st, zona: 'UTC', ahora: at('2026-10-26', '07:59') }).motivo, 'ya-lanzada');
  assert.strictEqual(rut.rutinaDebida({ rut: r, st, zona: 'UTC', ahora: at('2026-10-26', '08:00') }).franja.clave, '2026-10-26T08:00');
  // Dormido de 07:05 a 12:20: cinco franjas perdidas, se lanza solo la de las 12:00, marcada como recuperación.
  const tras = rut.rutinaDebida({ rut: r, st, zona: 'UTC', ahora: at('2026-10-26', '12:20') });
  assert.deepStrictEqual([tras.lanzar, tras.franja.clave, tras.recuperacion], [true, '2026-10-26T12:00', true]);
  // Mientras la anterior sigue abierta, no se duplica.
  assert.strictEqual(rut.rutinaDebida({ rut: r, st, zona: 'UTC', ahora: at('2026-10-26', '13:00'), abierta: true }).motivo, 'anterior-abierta');
});

test('rutina: ventana horaria, tope diario con aviso, pausa y mínimo de 30 min', () => {
  const r = rutina({ ventana: { desde: '07:00', hasta: '23:00' }, topeDiario: 10 });
  const franjas = rut.franjasRutina(r, 'UTC', at('2026-10-26', '12:00')).filter(f => f.dia === '2026-10-26').map(f => f.hora);
  assert.strictEqual(franjas[0], '07:00');
  assert.strictEqual(franjas[franjas.length - 1], '22:00');
  assert.strictEqual(franjas.length, 16);
  // A las 03:00 la última franja permitida es la de ayer a las 22:00 (ya lanzada): no hay nada que hacer de noche.
  const st = { ultimaClave: '2026-10-25T22:00' };
  assert.strictEqual(rut.rutinaDebida({ rut: r, st, zona: 'UTC', ahora: at('2026-10-26', '03:00') }).motivo, 'ya-lanzada');
  // Ventana que cruza la medianoche.
  assert.strictEqual(rut.enVentana('23:30', { desde: '22:00', hasta: '06:00' }), true);
  assert.strictEqual(rut.enVentana('12:00', { desde: '22:00', hasta: '06:00' }), false);
  // Tope: con 8 de 10 turnos usados, una ejecución de 4 no cabe; el panel avisa al llegar al 80 %.
  const lleno = { ultimaClave: '2026-10-26T07:00', turnosHoy: { dia: '2026-10-26', turnos: 8 } };
  assert.strictEqual(rut.rutinaDebida({ rut: r, st: lleno, zona: 'UTC', ahora: at('2026-10-26', '08:00'), coste: 4 }).motivo, 'tope');
  assert.match(rut.vistaRutina(r, lleno, { zona: 'UTC', ahora: at('2026-10-26', '08:00') }).avisoTope, /8 of 10/);
  // Al día siguiente el contador vuelve a cero.
  assert.strictEqual(rut.rutinaDebida({ rut: r, st: lleno, zona: 'UTC', ahora: at('2026-10-27', '08:00'), coste: 4 }).lanzar, true);
  assert.strictEqual(rut.rutinaDebida({ rut: { ...r, activa: false }, st: {}, zona: 'UTC', ahora: at('2026-10-26', '08:00') }).motivo, 'pausada');
  const { errores } = rut.normalizarRutinas([{ tipo: 'radar', cadaMin: 10 }]);
  assert.match(errores.join(), /30 minutes/);
});

test('coste por ejecución: el radar gasta una ronda de 2 agentes como mucho; la redacción, 2 ciclos del equipo; las del servidor, 0', () => {
  assert.deepStrictEqual(
    [['radar', ['a']], ['radar', ['a', 'b', 'c']], ['redaccion', ['a', 'b', 'c']], ['desempeno', ['a']]].map(([tipo, equipo]) => rut.costeEstimado({ tipo, equipo })),
    [1, 2, 6, 0]);
  assert.strictEqual(rut.normalizarRutinas([{ tipo: 'radar' }]).rutinas.find(r => r.tipo === 'radar').topeDiario, 48, 'cada hora con 2 agentes cabe en el día');
});

test('zip: CRC-32 correcta también sin zlib.crc32 (Node 18) y nombres en UTF-8', () => {
  const zlib = require('zlib');
  const nativa = zlib.crc32;
  try {
    zlib.crc32 = undefined;
    assert.strictEqual(ed.crc32(Buffer.from('123456789')), 0xCBF43926);
    const zip = ed.crearZip([{ nombre: 'propuestas/Año «uno».txt', datos: 'hola' }]);
    assert.strictEqual(zip.readUInt32LE(14), ed.crc32(Buffer.from('hola')));
    assert.strictEqual(zip.readUInt16LE(6) & 0x0800, 0x0800, 'flag UTF-8 en la cabecera local');
  } finally { zlib.crc32 = nativa; }
  if (typeof nativa === 'function') assert.strictEqual(ed.crc32(Buffer.from('123456789')), nativa(Buffer.from('123456789')));
});

test('rutina encadenada: «Más como este» corre una vez tras cada «Desempeño»', () => {
  const r = rut.normalizarRutinas([{ tipo: 'mas-como-este', activa: true }]).rutinas.find(x => x.tipo === 'mas-como-este');
  assert.strictEqual(r.tras, 'desempeno');
  const pred = { ultima: { fin: '2026-10-26T08:01:00.000Z' } };
  assert.strictEqual(rut.rutinaDebida({ rut: r, st: {}, zona: 'UTC', ahora: at('2026-10-26', '08:02'), predecesor: { ultima: { fin: null } } }).motivo, 'esperando');
  const d = rut.rutinaDebida({ rut: r, st: {}, zona: 'UTC', ahora: at('2026-10-26', '08:02'), predecesor: pred });
  assert.strictEqual(d.lanzar, true);
  assert.strictEqual(rut.rutinaDebida({ rut: r, st: { ultimaClave: d.franja.clave }, zona: 'UTC', ahora: at('2026-10-26', '09:00'), predecesor: pred }).motivo, 'esperando');
});

// ---------- Funciones puras: semáforo y desempeño ----------

test('semáforo: nunca mejor que sus fuentes; roja bloquea y amarilla pide confirmación', () => {
  const equipo = [{ id: 'grok' }, { id: 'claude' }];
  const v = (raw, extra) => cadena.normalizarVerificacion(raw, { equipo, ...extra }).verificacion.semaforo;
  assert.strictEqual(v({ semaforo: 'verde', verificador: 'claude', fuentes: [{ url: 'https://a.org/estudio', tipo: 'primaria' }] }), 'verde');
  assert.strictEqual(v({ semaforo: 'verde', verificador: 'claude', fuentes: [{ url: 'https://blog.example/nota' }] }), 'amarillo', 'solo secundarias');
  assert.strictEqual(v({ semaforo: 'verde', verificador: 'claude', fuentes: [] }), 'rojo', 'sin fuente');
  assert.strictEqual(v({ semaforo: 'verde', verificador: 'nadie', fuentes: [{ url: 'https://a.org/x', tipo: 'primaria' }] }), 'amarillo', 'sin verificador del equipo');
  assert.strictEqual(v({ verificador: 'claude', contradicha: true, fuentes: [{ url: 'https://a.org/x', tipo: 'primaria' }] }), 'rojo');
  assert.strictEqual(v(null, { fuenteUrl: 'https://x.com/1' }), 'amarillo', 'v1: la fuente viral cuenta como secundaria');
  assert.strictEqual(cadena.puedeAprobar({ verificacion: { semaforo: 'rojo' } }, { confirmarAmarillo: true }).codigo, 'semaforo_rojo');
  assert.strictEqual(cadena.puedeAprobar({ verificacion: { semaforo: 'amarillo' } }).codigo, 'confirmar_amarillo');
  assert.strictEqual(cadena.puedeAprobar({ verificacion: { semaforo: 'amarillo' } }, { confirmarAmarillo: true }).ok, true);
  assert.strictEqual(cadena.puedeAprobar({ verificacion: { semaforo: 'verde' } }).ok, true);
});

test('desempeño: con ready:false no hay números; con datos, ganadores frente a la media y por qué', () => {
  const nada = cadena.analizarDesempeno({ ready: false }, []);
  assert.deepStrictEqual([nada.ready, nada.media, nada.ganadores.length], [false, null, 0]);
  const sinCifras = cadena.analizarDesempeno({ ready: true, top_posts: [{ id: 1, network: 'x', body: 'hola' }] }, []);
  assert.deepStrictEqual([sinCifras.media, sinCifras.ganadores.length], [null, 0], 'sin cifras no se nombra ganador');
  const d = cadena.analizarDesempeno({ ready: true, top_posts: [
    { id: 555, network: 'tiktok', permalink: 'https://tiktok.com/@faro/video/555', body: 'Agujeros negros que cantan', engagement: 12000 },
    { id: 556, network: 'x', body: 'otro', engagement: 300 }, { id: 557, network: 'x', body: 'otro más', engagement: 300 },
  ] }, [{ id: '2026-10-25-1', tema: 'Agujeros negros', hook: 'Escucha', tipo: 'fact', hora: '2026-10-25T18:00:00Z', viralhunt: { id: 555 } }]);
  assert.strictEqual(d.media, 4200);
  assert.strictEqual(d.ganadores.length, 1);
  const g = d.ganadores[0];
  assert.deepStrictEqual([g.id, g.tema, g.propuesta, g.factores.formato, g.factores.hora], ['555', 'Agujeros negros', '2026-10-25-1', 'fact', '18:00']);
  assert.match(g.porQue.join(' | '), /2\.9× the average/);
  const semillas = cadena.semillasMasComoEste(d, { 'Agujeros negros': [{ titulo: 'Agujeros negros que cantan', enlace: 'https://tiktok.com/@faro/video/555' }, { titulo: 'El sonido de Saturno', enlace: 'https://e.com/s', plataforma: 'tiktok' }] });
  assert.strictEqual(semillas[0].origen.similar.titulo, 'El sonido de Saturno', 'el propio ganador no cuenta como similar');
  assert.match(cadena.lineaOrigen({ ...semillas[0].origen, tema: 'Agujeros negros' }, 'en'), /From the winner «Agujeros negros» \(12,000 interactions on tiktok\) → similar trending topic «El sonido de Saturno»/);
});

// ---------- Integración: la cadena completa ----------

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'officematrix-editorial-v2-'));
const agente = path.join(__dirname, 'helpers', 'agente-editorial.js');
fs.writeFileSync(path.join(home, 'agents.json'), JSON.stringify({
  agents: [
    ...['grok', 'claude'].map(id => ({ id, name: id, role: 'Editorial', color: '#fff', cmd: 'node', stream: 'text', args: [agente, id, '{prompt}'] })),
    // Una CLI que cae por límite de uso: la rutina sigue con las demás y el informe lo dice.
    { id: 'rota', name: 'rota', role: 'Editorial', color: '#f00', cmd: 'node', stream: 'text', args: ['-e', "console.error('Error 429: usage limit reached'); process.exit(1)", '{prompt}'] },
  ],
  maxRounds: 2, autoMaxRounds: 6, minScore: 9, turnTimeoutMinutes: 1, relatorMinutes: 0, idleTimeoutMinutes: 0,
}));
process.env.OFFICEMATRIX_HOME = home;
process.env.OFFICEMATRIX_CONFIG = path.join(home, 'agents.json');
const TOKEN = `vhk_${crypto.randomBytes(18).toString('hex')}`;

const { server, running, relojEditorial } = require('../server');
let base, vh, office;
test.before(async () => {
  vh = await crearViralHuntFalso({ token: TOKEN });
  process.env.OFFICEMATRIX_VIRALHUNT_URL = vh.url;
  base = await new Promise(r => server.listen(0, '127.0.0.1', () => r(`http://127.0.0.1:${server.address().port}`)));
});
test.after(async () => {
  server.close(); server.closeAllConnections?.();
  await vh.close();
  delete process.env.OFFICEMATRIX_VIRALHUNT_URL;
  fs.rmSync(home, { recursive: true, force: true });
});

const respuestas = [];
const api = async (url, opts = {}) => {
  const res = await fetch(base + url, { ...opts, headers: { 'content-type': 'application/json', ...(opts.headers || {}) } });
  const text = await res.text();
  respuestas.push(text);
  let body; try { body = JSON.parse(text); } catch { body = text; }
  return { status: res.status, body };
};
const post = (url, body = {}) => api(url, { method: 'POST', body: JSON.stringify(body) });
const esperar = async (fn, ms = 20000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (await fn()) return true; await new Promise(r => setTimeout(r, 100)); }
  return false;
};
const cerrada = id => esperar(() => !running.has(id));
const E = () => `/api/oficinas/${office}/editorial`;
const rutinaVista = async tipo => (await api(`${E()}/rutinas`)).body.find(r => r.tipo === tipo);
const semillas = async () => (await api(`${E()}/semillas`)).body;

test('cadena completa: sin stats → radar; ganador → más como este → encargo → redacción que cita su origen → aprobar → galería publicada con métricas', async () => {
  const o = await post('/api/oficinas', { nombre: 'Faro Curioso', equipo: ['grok', 'claude', 'rota'] });
  office = o.body.id;
  await api(`/api/oficinas/${office}/viralhunt`, { method: 'PUT', body: JSON.stringify({ token: TOKEN }) });
  const regla = await api(E(), { method: 'PUT', body: JSON.stringify({
    activa: true, zona: 'UTC', horas: ['06:00'], modo: 'relevo', redes: ['instagram', 'x'], propuestasPorTanda: 3, destino: 'borrador', nichos: ['space'],
    equipo: [{ id: 'grok', rol: 'Writer and designer' }, { id: 'claude', rol: 'Verifier' }, { id: 'rota', rol: 'Researcher' }],
    marca: { nombre: 'Faro Curioso', tono: 'clear and friendly science for the curious', paleta: ['#0B1D3A', '#FFB400'], tipografias: ['Inter'], handles: { x: '@faro_x' }, proporcion: '4:5' },
    temas: [{ nombre: 'Space', escritores: ['grok'] }],
    rutinas: [
      { tipo: 'radar', activa: true, cadaMin: 60, cantidad: 2, equipo: ['rota', 'grok'] },
      { tipo: 'desempeno', activa: true, horas: ['08:00'] }, { tipo: 'mas-como-este', activa: true }, { tipo: 'aprender', activa: true, horas: ['07:30'] },
      { tipo: 'redaccion', activa: true, equipo: ['grok', 'claude'] },
    ],
  }) });
  assert.strictEqual(regla.status, 200, JSON.stringify(regla.body));
  assert.deepStrictEqual(regla.body.rutinas.map(r => [r.tipo, r.estado]), [['radar', 'activa'], ['desempeno', 'activa'], ['mas-como-este', 'activa'], ['aprender', 'activa'], ['redaccion', 'activa']]);
  assert.strictEqual(regla.body.rutinas.find(r => r.tipo === 'mas-como-este').proxima.tras, 'desempeno');

  // 1. Sin estadísticas (ready:false): «Desempeño» no inventa números y «Más como este» no crea semillas.
  const d0 = await post(`${E()}/rutinas/desempeno/ejecutar`);
  assert.strictEqual(d0.status, 202);
  assert.deepStrictEqual([d0.body.informe.ok, d0.body.informe.ready, d0.body.informe.ganadores], [true, false, 0]);
  const des0 = (await api(`${E()}/desempeno`)).body;
  assert.deepStrictEqual([des0.ready, des0.media, des0.ganadores.length], [false, null, 0]);
  assert.strictEqual((await post(`${E()}/rutinas/mas-como-este/ejecutar`)).body.informe.semillas, 0);
  // Si stats.php aún no está activo en el servidor (503), es lo mismo: sin números, y la rutina no falla.
  vh.cfg.stats = 'unavailable';
  const d503 = await post(`${E()}/rutinas/desempeno/ejecutar`);
  vh.cfg.stats = null;
  assert.deepStrictEqual([d503.body.informe.ok, d503.body.informe.ready, d503.body.informe.ganadores], [true, false, 0], JSON.stringify(d503.body));
  assert.strictEqual((await rutinaVista('desempeno')).estado, 'activa');

  // 2. …y la cadena sigue con el radar. Una CLI cae (429): el radar sale con la otra y el informe lo dice.
  const r1 = await post(`${E()}/rutinas/radar/ejecutar`);
  assert.strictEqual(r1.status, 202, JSON.stringify(r1.body));
  assert.ok(await cerrada(r1.body.mision));
  const radar = await rutinaVista('radar');
  assert.strictEqual(radar.ultima.informe.ok, true);
  assert.deepStrictEqual(radar.ultima.informe.cayeron.map(x => x.split(' ')[0]), ['rota']);
  assert.strictEqual(radar.ultima.informe.semillas, 2);
  assert.strictEqual(radar.estado, 'activa', 'la rutina sigue viva');
  assert.ok((await semillas()).some(s => s.tema === 'Tema del radar 1' && s.origen.tipo === 'radar'));
  assert.strictEqual((await api(`${E()}/radar`)).body.pasadas.length, 1);

  // 3. Llegan estadísticas con un ganador: «Desempeño» lo marca y el reloj encadena «Más como este».
  vh.cfg.stats = { ready: true, by_network: { tiktok: { engagement: 12000, posts: 1 }, x: { engagement: 600, posts: 2 } }, top_posts: [
    { id: 555, network: 'tiktok', permalink: 'https://tiktok.com/@faro/video/555', body: 'Black holes that sing', engagement: 12000 },
    { id: 556, network: 'x', body: 'other', engagement: 300 }, { id: 557, network: 'x', body: 'another', engagement: 300 },
  ] };
  assert.strictEqual((await post(`${E()}/rutinas/desempeno/ejecutar`)).body.informe.ganadores, 1);
  await relojEditorial(Date.now());
  assert.ok(await esperar(async () => (await rutinaVista('mas-como-este')).ultima?.fin), 'el reloj lanzó «Más como este» tras «Desempeño»');
  assert.ok(vh.pedidos.some(p => p.ep === 'search.php' && p.query.keyword === 'Black holes that sing'));
  const ganadora = (await semillas()).find(s => s.origen.tipo === 'ganador');
  assert.ok(ganadora, 'hay una semilla que sale del ganador');
  assert.deepStrictEqual([ganadora.origen.postId, ganadora.origen.interacciones, ganadora.origen.red], ['555', 12000, 'tiktok']);
  assert.match(ganadora.origen.similar.titulo, /Tendencia 1 parecida/);
  await relojEditorial(Date.now() + 1000);
  assert.strictEqual((await semillas()).filter(s => s.origen.tipo === 'ganador').length, 1, 'no se encadena dos veces');

  // 4. El dueño asigna un tema a un escritor: entra en la siguiente tanda con prioridad.
  assert.strictEqual((await post(`${E()}/encargos`, { escritor: 'nadie', tema: 'x' })).status, 400);
  const manana9 = new Date(Date.now() + 864e5); manana9.setUTCHours(9, 0, 0, 0);
  const enc = await post(`${E()}/encargos`, { escritor: 'grok', tema: 'Artemis III thread', para: manana9.toISOString(), pilar: 'space' });
  assert.strictEqual(enc.status, 201, JSON.stringify(enc.body));

  const t = await post(`${E()}/tanda`);
  assert.strictEqual(t.status, 201, JSON.stringify(t.body));
  assert.ok(await cerrada(t.body.id));
  const turno = fs.readFileSync(path.join(home, 'oficinas', office, 'proyectos', t.body.id, '.office', 'turno.md'), 'utf8');
  const lineas = turno.split('\n').filter(l => /^- `s-\d+`/.test(l));
  assert.strictEqual(lineas.length, 3);
  assert.match(lineas[0], new RegExp(`\`${enc.body.id}\` · Artemis III thread.*PRIORITY: owner assignment`), 'el encargo va primero');
  assert.match(lineas[1], new RegExp(`\`${ganadora.id}\``), 'luego el ganador');
  assert.match(turno, /Palette: #0B1D3A, #FFB400/);
  assert.match(turno, /The verifier is claude/);

  // 5. Las propuestas citan su origen y llevan su semáforo.
  const bandeja = (await api(`${E()}/galeria`)).body.filter(p => p.origen.chatId === t.body.id);
  assert.strictEqual(bandeja.length, 3);
  const deEncargo = bandeja.find(p => p.semilla === enc.body.id);
  assert.deepStrictEqual([deEncargo.cadena.tipo, deEncargo.autor, deEncargo.pilar, deEncargo.verificacion.semaforo], ['encargo', 'grok', 'space', 'verde']);
  const deGanador = bandeja.find(p => p.semilla === ganadora.id);
  assert.match(deGanador.lineaOrigen, /From the winner «Black holes that sing» \(12,000 interactions on tiktok\) → similar trending topic «Tendencia 1/);
  assert.ok((await semillas()).filter(s => [enc.body.id, ganadora.id].includes(s.id)).every(s => s.estado === 'usada'));

  // 6. Calendario: se mueve la hora antes de enviar; aprobada, ya no.
  const nueva = new Date(Date.now() + 3 * 864e5).toISOString();
  assert.strictEqual((await api(`${E()}/propuestas/${deGanador.id}/hora`, { method: 'PATCH', body: JSON.stringify({ hora: nueva }) })).body.hora, nueva);

  // 7. Aprobar (verde) → ViralHunt; luego se publica y stats.php trae sus métricas: la galería lo enseña.
  const ap = await post(`${E()}/propuestas/${deGanador.id}/aprobar`);
  assert.strictEqual(ap.status, 200, JSON.stringify(ap.body));
  assert.strictEqual((await api(`${E()}/propuestas/${deGanador.id}/hora`, { method: 'PATCH', body: JSON.stringify({ hora: nueva }) })).status, 409);
  const vhId = ap.body.viralhunt.id;
  vh.cfg.publicados = [vhId];
  vh.cfg.stats.top_posts.push({ id: vhId, network: 'x', permalink: `https://x.com/faro/status/${vhId}`, body: 'our post', engagement: 20000 });
  vh.cfg.editLog = [{ field: 'body', before: 'A very long caption that the owner found far too long to read on a phone', after: 'Short caption', who: 'owner', post_id: vhId }];
  const apr = await post(`${E()}/rutinas/aprender/ejecutar`);
  assert.deepStrictEqual([apr.body.informe.ok, apr.body.informe.revisados, apr.body.informe.ediciones], [true, 1, 1]);
  // Una segunda pasada que vuelve a recibir la misma edición (ventanas solapadas, o 7 días tras un fallo) no la cuenta dos veces.
  assert.strictEqual((await post(`${E()}/rutinas/aprender/ejecutar`)).body.informe.ediciones, 0);
  assert.strictEqual(JSON.parse(fs.readFileSync(path.join(home, 'oficinas', office, 'editorial', 'ediciones.json'), 'utf8')).total, 1);
  await post(`${E()}/rutinas/desempeno/ejecutar`);
  const pub = (await api(`${E()}/galeria?estado=publicada`)).body;
  assert.deepStrictEqual(pub.map(p => p.id), [deGanador.id]);
  assert.strictEqual(pub[0].metricas.interacciones, 20000);
  assert.deepStrictEqual(pub[0].viralhunt.remoto.permalinks, [`https://x.com/faro/status/${vhId}`]);
  assert.deepStrictEqual((await api(`${E()}/galeria?escritor=grok&rutina=encargo`)).body.map(p => p.id), [deEncargo.id]);

  // 8. Lo que el dueño editó en ViralHunt y sus notas a mano entran en el gusto; una decisión no borra las notas.
  await api(`${E()}/gusto`, { method: 'PUT', body: JSON.stringify({ notas: 'Never use the word «revolutionary».' }) });
  await post(`${E()}/propuestas/${deEncargo.id}/rechazar`, { nota: 'too long' });
  const gusto = (await api(`${E()}/gusto`)).body.contenido;
  assert.match(gusto, /Owner notes[\s\S]*revolutionary/);
  assert.match(gusto, /What the owner edited in ViralHunt[\s\S]*Shortened the copy 1 times/);
  const tablero = (await api(`${E()}/escritores`)).body.find(w => w.id === 'grok');
  assert.deepStrictEqual([tablero.aprobadas, tablero.tasaAprobacion, tablero.motivosRechazo[0].motivo, tablero.encargos.length], [1, 50, 'too long', 1]);

  // 9. «Reusar» crea una semilla nueva a partir de una pieza vieja.
  const re = await post(`${E()}/propuestas/${deGanador.id}/reusar`);
  assert.strictEqual(re.status, 201);
  assert.deepStrictEqual([re.body.origen.tipo, re.body.origen.propuesta], ['reuso', deGanador.id]);
});

test('semáforo en el servidor: una roja no se aprueba; una amarilla pide confirmación', async () => {
  for (const [luz, codigo] of [['rojo', 'semaforo_rojo'], ['amarillo', 'confirmar_amarillo']]) {
    process.env.EDITORIAL_SEMAFORO = luz;
    let t;
    try { t = await post(`${E()}/tanda`); assert.ok(await cerrada(t.body.id)); } finally { delete process.env.EDITORIAL_SEMAFORO; }
    const p = (await api(`${E()}/galeria`)).body.find(x => x.origen.chatId === t.body.id && x.estado === 'pendiente');
    assert.strictEqual(p.verificacion.semaforo, luz);
    const r = await post(`${E()}/propuestas/${p.id}/aprobar`);
    assert.deepStrictEqual([r.status, r.body.codigo], [409, codigo]);
    const conf = await post(`${E()}/propuestas/${p.id}/aprobar`, { confirmarAmarillo: true });
    assert.strictEqual(conf.status, luz === 'rojo' ? 409 : 200, JSON.stringify(conf.body));
  }
});

test('pausar y reanudar: una rutina en pausa no dispara; al reanudar no recupera lo que pasó en pausa', async () => {
  assert.strictEqual((await post(`${E()}/rutinas/radar/pausar`)).body.estado, 'pausada');
  const antes = (await rutinaVista('radar')).ultima.inicio;
  await relojEditorial(Date.now() + 2 * 3600e3);
  assert.strictEqual((await rutinaVista('radar')).ultima.inicio, antes, 'en pausa no se ejecuta');
  const v = (await post(`${E()}/rutinas/radar/reanudar`)).body;
  assert.strictEqual(v.estado, 'activa');
  assert.ok(v.proxima?.at, 'dice cuándo es la próxima');
  await relojEditorial(Date.now());
  assert.strictEqual((await rutinaVista('radar')).ultima.inicio, antes, 'la franja pasada durante la pausa no se lanza de golpe');
});

test('reloj del servidor: radar horario; si caen todas las CLI sigue viva y reintenta en la siguiente franja; el tope diario corta', async () => {
  // Otra oficina sola en el reloj: la de la cadena se apaga para que el reloj falso no la dispare.
  assert.strictEqual((await api(E(), { method: 'PUT', body: JSON.stringify({ activa: false }) })).status, 200);
  // Una zona de hora entera donde ahora son las 02:xx: las tres franjas de la prueba caen en el mismo día local.
  const desfaseH = (((2 - new Date().getUTCHours()) % 24) + 24) % 24;
  const off = desfaseH > 14 ? desfaseH - 24 : desfaseH;
  const zona = off === 0 ? 'Etc/GMT' : off > 0 ? `Etc/GMT-${off}` : `Etc/GMT+${-off}`;
  const o = await post('/api/oficinas', { nombre: 'Radar Solo', equipo: ['rota'] });
  const R = `/api/oficinas/${o.body.id}/editorial`;
  const regla = await api(R, { method: 'PUT', body: JSON.stringify({
    activa: true, zona, horas: ['06:00'], redes: ['x'], propuestasPorTanda: 1, destino: 'borrador', equipo: [{ id: 'rota', rol: 'Researcher' }],
    rutinas: [
      { tipo: 'radar', activa: true, cadaMin: 60, cantidad: 1, equipo: ['rota'], topeDiario: 2 },
      ...['desempeno', 'mas-como-este', 'aprender', 'redaccion'].map(tipo => ({ tipo, activa: false })),
    ],
  }) });
  assert.strictEqual(regla.status, 200, JSON.stringify(regla.body));
  const radar = async () => (await api(`${R}/rutinas`)).body.find(r => r.tipo === 'radar');
  const h1 = Math.ceil(Date.now() / 3600e3) * 3600e3 + 60e3; // un minuto después de la próxima hora en punto

  await relojEditorial(h1);
  const v1 = await radar();
  assert.ok(v1.ultima?.chatId, 'el reloj lanzó el radar a la hora');
  assert.ok(await cerrada(v1.ultima.chatId));
  const a = await radar();
  assert.deepStrictEqual([a.ultima.informe.ok, a.ultima.informe.cayeron.map(x => x.split(' ')[0]), a.estado, a.turnosHoy], [false, ['rota'], 'activa', 1]);
  assert.ok(a.ultima.informe.motivo, 'el informe dice por qué no salió nada');

  await relojEditorial(h1 + 5 * 60e3);
  assert.strictEqual((await radar()).ultima.chatId, v1.ultima.chatId, 'la misma franja no se duplica');

  await relojEditorial(h1 + 3600e3);
  const v2 = await radar();
  assert.notStrictEqual(v2.ultima.chatId, v1.ultima.chatId, 'la siguiente franja lo reintenta');
  assert.ok(await cerrada(v2.ultima.chatId));
  const b = await radar();
  assert.deepStrictEqual([b.estado, b.turnosHoy], ['activa', 2]);
  assert.ok(b.avisoTope, 'avisa al llegar al 80 % del tope');

  await relojEditorial(h1 + 2 * 3600e3);
  const c = await radar();
  assert.deepStrictEqual([c.ultima.chatId, c.estado, c.turnosHoy], [v2.ultima.chatId, 'activa', 2], 'con el tope lleno no lanza, pero no se apaga');
  assert.match(fs.readFileSync(path.join(home, 'oficinas', o.body.id, 'bitacora.md'), 'utf8'), /daily cap reached \(2\/2 turns\)/);
});

test('el token no aparece en ningún archivo, log ni respuesta (v2)', async () => {
  for (const u of ['', '/rutinas', '/semillas', '/escritores', '/galeria', '/desempeno', '/radar', '/gusto']) await api(`${E()}${u}`);
  assert.strictEqual(respuestas.filter(r => String(r).includes(TOKEN)).length, 0);
  const fugas = [];
  const recorrer = dir => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) recorrer(full);
      else if (e.name !== 'viralhunt.secreto.json' && fs.readFileSync(full).includes(TOKEN)) fugas.push(path.relative(home, full));
    }
  };
  recorrer(home);
  assert.deepStrictEqual(fugas, []);
});

test('/editorial sirve editorial.html y galeria/exportar entrega un .zip sin dependencias', async () => {
  const page = await fetch(base + '/editorial');
  assert.strictEqual(page.status, 200);
  assert.match(page.headers.get('content-type') || '', /text\/html/);
  const html = await page.text();
  assert.match(html, /id="edDashboard"/);
  assert.match(html, /OFFICEMATRIX/);

  const slash = await fetch(base + '/editorial/');
  assert.strictEqual(slash.status, 200);

  const exp = await fetch(base + `${E()}/galeria/exportar`);
  assert.strictEqual(exp.status, 200);
  assert.strictEqual(exp.headers.get('content-type'), 'application/zip');
  assert.match(exp.headers.get('content-disposition') || '', /attachment; filename="editorial-/);
  const buf = Buffer.from(await exp.arrayBuffer());
  assert.ok(buf.length > 22, 'el zip tiene contenido');
  assert.strictEqual(buf.readUInt32LE(0), 0x04034b50, 'firma de archivo zip válida');
});
