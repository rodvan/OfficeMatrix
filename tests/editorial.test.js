// Editorial continua (docs/BRIEF-EDITORIAL.md): horario, tandas, bandeja, gusto y conector ViralHunt contra un
// ViralHunt SIMULADO en 44xx (tests/helpers/viralhunt-falso.js). Nunca se llama a la API real.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const ed = require('../lib/editorial');
const { baseUrl } = require('../lib/viralhunt');
const { crearViralHuntFalso } = require('./helpers/viralhunt-falso');

// ---------- Funciones puras ----------

test('horario: la franja en la zona de la marca, también con cambio de hora', () => {
  assert.strictEqual(ed.instante('America/Mexico_City', '2026-10-24', '09:00'), Date.UTC(2026, 9, 24, 15, 0));
  assert.strictEqual(ed.instante('Europe/Madrid', '2026-10-24', '09:00'), Date.UTC(2026, 9, 24, 7, 0)); // verano, UTC+2
  assert.strictEqual(ed.instante('Europe/Madrid', '2026-10-26', '09:00'), Date.UTC(2026, 9, 26, 8, 0)); // invierno, UTC+1
});

test('horario: se lanza a la hora, no se duplica, no pisa una tanda abierta y tras dormir va una sola vez', () => {
  const regla = ed.normalizarRegla({ activa: true, zona: 'America/Mexico_City', horas: ['17:00', '09:00'] });
  assert.deepStrictEqual(regla.horas, ['09:00', '17:00']);
  const at = (dia, h) => ed.instante(regla.zona, dia, h);
  const estado = { activadaEn: new Date(at('2026-10-24', '08:00')).toISOString(), ultimaFranja: null };

  assert.strictEqual(ed.tandaDebida({ regla, estado, ahora: at('2026-10-24', '08:59') }).lanzar, false);
  const d = ed.tandaDebida({ regla, estado, ahora: at('2026-10-24', '09:00') });
  assert.strictEqual(d.lanzar, true);
  assert.strictEqual(d.franja.clave, '2026-10-24T09:00');
  // Ya lanzada: el reloj vuelve a mirar en el minuto siguiente y no la repite.
  estado.ultimaFranja = d.franja.clave;
  assert.strictEqual(ed.tandaDebida({ regla, estado, ahora: at('2026-10-24', '09:01') }).motivo, 'ya-lanzada');
  assert.strictEqual(ed.tandaDebida({ regla, estado, ahora: at('2026-10-24', '16:59') }).motivo, 'ya-lanzada');
  // A las 17:00 la de la mañana sigue abierta: no se lanza otra.
  assert.strictEqual(ed.tandaDebida({ regla, estado, ahora: at('2026-10-24', '17:00'), abierta: true }).motivo, 'anterior-abierta');
  // El PC durmió del 24 a las 17:30 al 26 a las 18:10: cuatro franjas perdidas, se lanza SOLO la última, una vez.
  estado.ultimaFranja = '2026-10-24T17:00';
  const tras = ed.tandaDebida({ regla, estado, ahora: at('2026-10-26', '18:10') });
  assert.strictEqual(tras.lanzar, true);
  assert.strictEqual(tras.franja.clave, '2026-10-26T17:00');
  assert.strictEqual(tras.atrasada, true);
  estado.ultimaFranja = tras.franja.clave;
  assert.strictEqual(ed.tandaDebida({ regla, estado, ahora: at('2026-10-26', '18:11') }).lanzar, false);
  // Una franja anterior a la activación no se lanza al encender.
  assert.strictEqual(ed.tandaDebida({ regla, estado: { activadaEn: new Date(at('2026-10-24', '09:30')).toISOString() }, ahora: at('2026-10-24', '09:31') }).motivo, 'antes-de-activar');
  assert.strictEqual(ed.tandaDebida({ regla: { ...regla, activa: false }, estado: {}, ahora: at('2026-10-24', '09:00') }).motivo, 'inactiva');
  assert.strictEqual(ed.proximaFranja(regla, at('2026-10-24', '10:00')).clave, '2026-10-24T17:00');
});

test('regla: valida todo junto y fija dos ciclos por tanda', () => {
  assert.throws(() => ed.normalizarRegla({ zona: 'Marte/Olympus', horas: ['25:00'], destino: 'publicar', redes: ['myspace'] }), err => {
    assert.strictEqual(err.status, 400);
    assert.strictEqual(err.errores.length, 4);
    return true;
  });
  const r = ed.normalizarRegla({ rondas: 7, destino: 'agendar', reglas: { noCopiar: false, noPublicar: ['política'] } });
  assert.strictEqual(r.rondas, 2);
  assert.strictEqual(r.reglas.noCopiar, true);
  assert.strictEqual(r.destino, 'agendar');
  assert.strictEqual(r.propuestasPorTanda, 5);
});

test('copia literal: igual o con 12 palabras seguidas de la fuente', () => {
  const fuente = 'Un estudio de la universidad muestra que dormir siete horas mejora la memoria de trabajo en adultos jóvenes';
  assert.strictEqual(ed.copiaLiteral(fuente.toUpperCase() + '!!', fuente), true);
  assert.strictEqual(ed.copiaLiteral(`Ojo: ${fuente.split(' ').slice(2, 15).join(' ')} y más`, fuente), true);
  assert.strictEqual(ed.copiaLiteral('Dormir siete horas ayuda a recordar mejor, dice un estudio universitario', fuente), false);
  // Sin `fuente.texto`, el copy tampoco puede copiar un post de la investigación de ViralHunt.
  const regla = ed.normalizarRegla({ redes: ['x'] });
  const raw = { tema: 't', hook: 'h', copy: { x: fuente }, fuente: { url: 'https://example.com/1' } };
  assert.deepStrictEqual(ed.normalizarPropuesta(raw, regla, ['imagen.png']).errores, []);
  assert.match(ed.normalizarPropuesta(raw, regla, ['imagen.png'], [fuente]).errores.join(), /word for word/);
});

test('gusto: un resumen compacto que no crece sin fin', () => {
  const muchas = Array.from({ length: 500 }, (_, i) => ({ ts: new Date(Date.UTC(2026, 9, 1) + i * 6e4).toISOString(), accion: ['aprobar', 'cambios', 'rechazar'][i % 3], hook: `hook ${i}`, tema: `tema ${i}`, nota: `nota ${i}`, casillas: ['imagen'] }));
  const md = ed.resumenGusto(muchas);
  assert.ok(md.length < 4000, `el resumen mide ${md.length}`);
  assert.match(md, /## Hooks they liked/);
  assert.match(ed.resumenGusto(muchas, Date.now(), 'es'), /## Hooks que gustaron/);
  assert.match(ed.resumenGusto(muchas, Date.now(), 'es'), /## Hooks que gustaron/);
  assert.match(md, /imagen \d+/);
  assert.match(md, /«hook 497»: nota 497/); // el rechazo más reciente con su motivo
});

test('brief de la tanda: en el idioma de la marca, o en el del servidor (inglés) si no se nota', () => {
  const oficina = { nombre: 'Faro' };
  const en = ed.normalizarRegla({ redes: ['x'], marca: { nombre: 'Faro', tono: 'friendly and clear, for the curious' } });
  const es = ed.normalizarRegla({ redes: ['x'], marca: { nombre: 'Faro', tono: 'divulgación clara y cercana' } });
  assert.match(ed.briefTanda({ regla: en, oficina }), /propose 5 pieces[\s\S]*NEVER repeats the source word for word/);
  assert.match(ed.briefTanda({ regla: es, oficina }), /propongan 5 contenidos[\s\S]*NUNCA copia la fuente palabra por palabra/);
  assert.match(ed.briefTanda({ regla: ed.normalizarRegla({ redes: ['x'] }), oficina }), /^Editorial batch/);
  assert.match(ed.briefCambios({ regla: es, oficina, propuesta: { id: 'p1', hook: 'h' }, nota: '', casillas: [] }), /^Cambios pedidos por el usuario/);
});

test('conector: solo la API real o un simulador en 127.0.0.1:4400-4499', () => {
  assert.strictEqual(baseUrl({}), 'https://viralhunt.io/tool/api/v1/');
  assert.strictEqual(baseUrl({ OFFICEMATRIX_VIRALHUNT_URL: 'http://127.0.0.1:4410/tool/api/v1' }), 'http://127.0.0.1:4410/tool/api/v1/');
  for (const bad of ['http://127.0.0.1:4321/', 'http://127.0.0.1:4322/', 'https://evil.example/', 'http://localhost:4410/', 'http://127.0.0.1:5000/']) {
    assert.throws(() => baseUrl({ OFFICEMATRIX_VIRALHUNT_URL: bad }), /4400-4499/, bad);
  }
});

// ---------- Integración: servidor + agentes falsos + ViralHunt simulado ----------

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'officematrix-editorial-'));
const agente = path.join(__dirname, 'helpers', 'agente-editorial.js');
fs.writeFileSync(path.join(home, 'agents.json'), JSON.stringify({
  agents: ['grok', 'claude'].map(id => ({ id, name: id, role: 'Editorial', color: '#fff', cmd: 'node', stream: 'text', args: [agente, id, '{prompt}'] })),
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

const respuestas = []; // todo lo que devolvió la API, para buscar el token
const api = async (url, opts = {}) => {
  const res = await fetch(base + url, { ...opts, headers: { 'content-type': 'application/json', ...(opts.headers || {}) } });
  const text = await res.text();
  respuestas.push(text);
  let body; try { body = JSON.parse(text); } catch { body = text; }
  return { status: res.status, body };
};
const esperar = async (fn, ms = 20000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (await fn()) return true; await new Promise(r => setTimeout(r, 100)); }
  return false;
};
const cerrada = id => esperar(() => !running.has(id));
const tandas = () => JSON.parse(fs.readFileSync(path.join(home, 'oficinas', office, 'editorial', 'estado.json'), 'utf8')).tandas;
const gusto = () => fs.readFileSync(path.join(home, 'oficinas', office, 'memoria', 'gusto-editorial.md'), 'utf8');

test('editorial de punta a punta: token, tanda programada, bandeja, aprobar, cambios, rechazar y gusto', async () => {
  const o = await api('/api/oficinas', { method: 'POST', body: JSON.stringify({ nombre: 'Faro Curioso', equipo: ['grok', 'claude'] }) });
  assert.strictEqual(o.status, 201);
  office = o.body.id;

  // Token: se guarda en el secreto de la oficina y la API solo dice si hay uno.
  assert.strictEqual((await api(`/api/oficinas/${office}/viralhunt`, { method: 'PUT', body: JSON.stringify({ token: 'no-es-un-token' }) })).status, 400);
  const t = await api(`/api/oficinas/${office}/viralhunt`, { method: 'PUT', body: JSON.stringify({ token: TOKEN }) });
  assert.deepStrictEqual(t.body, { configurado: true });
  const probar = await api(`/api/oficinas/${office}/viralhunt/probar`, { method: 'POST', body: '{}' });
  assert.strictEqual(probar.body.plan, 'creator');
  assert.deepStrictEqual(probar.body.cuentas.map(c => c.network), ['instagram', 'x']);

  // Sin regla no hay tanda.
  assert.strictEqual((await api(`/api/oficinas/${office}/editorial/tanda`, { method: 'POST', body: '{}' })).status, 409);
  const regla = await api(`/api/oficinas/${office}/editorial`, { method: 'PUT', body: JSON.stringify({
    activa: true, zona: 'UTC', horas: ['06:00', '18:00'], modo: 'relevo', propuestasPorTanda: 3, redes: ['instagram', 'x'], fuentes: ['x', 'reddit'], nichos: ['neurociencia'],
    equipo: [{ id: 'grok', rol: 'Investigación viral e imagen' }], destino: 'borrador', viralhunt: { proyecto: 'Faro Curioso' }, marca: { nombre: 'Faro Curioso', tono: 'divulgación clara' },
  }) });
  assert.strictEqual(regla.status, 200, JSON.stringify(regla.body));
  assert.strictEqual(regla.body.regla.rondas, 2);
  assert.ok(regla.body.proxima, 'dice cuándo es la próxima tanda');

  // El reloj: las franjas de hoy son anteriores a la activación; mañana a esta hora toca una, una sola vez.
  await relojEditorial(Date.now());
  assert.strictEqual(tandas().length, 0, 'una franja anterior a activar no se lanza');
  const manana = Date.now() + 864e5;
  await relojEditorial(manana);
  assert.strictEqual(tandas().length, 1);
  const t1 = tandas()[0];
  assert.ok(running.has(t1.chatId), 'la tanda es una misión normal en curso');
  // Mientras sigue abierta: ni el reloj ni el botón lanzan otra.
  await relojEditorial(manana + 60e3);
  assert.strictEqual((await api(`/api/oficinas/${office}/editorial/tanda`, { method: 'POST', body: '{}' })).status, 409);
  assert.strictEqual(tandas().length, 1);
  assert.ok(await cerrada(t1.chatId), 'la tanda termina');

  // La misión recibió la investigación de ViralHunt (resultados, no el token) y el brief con regla y equipo.
  const mision = path.join(home, 'oficinas', office, 'proyectos', t1.chatId);
  const inv = JSON.parse(fs.readFileSync(path.join(mision, 'investigacion', 'viralhunt.json'), 'utf8'));
  assert.strictEqual(inv.tendencias.length, 2);
  assert.strictEqual(inv.mejorHora.length, 2);
  assert.ok(vh.pedidos.some(p => p.ep === 'trending.php' && p.query.source === 'x' && p.query.keyword === 'neurociencia'));
  const turno = fs.readFileSync(path.join(mision, '.office', 'turno.md'), 'utf8');
  assert.match(turno, /propongan 3 contenidos/);
  assert.match(turno, /NUNCA copia la fuente palabra por palabra/);

  // La bandeja: 3 propuestas pendientes con imagen, hook, copy por red, fuente y hora.
  let lista = (await api(`/api/oficinas/${office}/editorial/propuestas`)).body;
  assert.strictEqual(lista.length, 3);
  assert.ok(lista.every(p => p.estado === 'pendiente' && p.imagenes[0] === 'imagen.png' && p.hook && p.copy.x && p.copy.instagram && p.fuente.url && p.hora));
  const [p1, p2, p3] = [...lista].sort((a, b) => a.id.localeCompare(b.id));
  const img = await fetch(`${base}/api/oficinas/${office}/editorial/propuestas/${p1.id}/archivo/imagen.png`);
  assert.strictEqual(img.headers.get('content-type'), 'image/png');
  assert.strictEqual((await fetch(`${base}/api/oficinas/${office}/editorial/propuestas/${p1.id}/archivo/..%2F..%2Feditorial.json`)).status, 404);

  // Aprobar → borrador en ViralHunt: sube la imagen y crea con draft:true, la fuente en las notas, no en el cuerpo.
  const ap = await api(`/api/oficinas/${office}/editorial/propuestas/${p1.id}/aprobar`, { method: 'POST', body: '{}' });
  assert.strictEqual(ap.status, 200, JSON.stringify(ap.body));
  assert.strictEqual(ap.body.estado, 'aprobada');
  assert.strictEqual(ap.body.viralhunt.donde, 'borrador');
  assert.ok(ap.body.viralhunt.id >= 1000);
  assert.ok(vh.pedidos.some(p => p.action === 'upload' && p.multipart && p.bytes > 0));
  const create = vh.pedidos.find(p => p.action === 'create');
  assert.strictEqual(create.json.draft, true);
  assert.strictEqual(create.json.project, 'Faro Curioso');
  assert.deepStrictEqual(create.json.media, ['https://cdn.example.com/subida-1000.png']);
  assert.match(create.json.author_notes, /Source: https:\/\/example\.com\/x\/1/);
  assert.doesNotMatch(create.json.body, /https?:\/\//);
  assert.ok(create.json.overrides.x.body, 'el copy de X va como override de la red');
  assert.strictEqual((await api(`/api/oficinas/${office}/editorial/propuestas/${p1.id}/aprobar`, { method: 'POST', body: '{}' })).status, 409, 'no se aprueba dos veces');

  // Rechazar pide motivo y lo aprende.
  assert.strictEqual((await api(`/api/oficinas/${office}/editorial/propuestas/${p3.id}/rechazar`, { method: 'POST', body: '{}' })).status, 400);
  const re = await api(`/api/oficinas/${office}/editorial/propuestas/${p3.id}/rechazar`, { method: 'POST', body: JSON.stringify({ nota: 'no me gustó la imagen' }) });
  assert.strictEqual(re.body.estado, 'rechazada');

  // Pedir cambios relanza SOLO esa propuesta en un mini ciclo y vuelve a la bandeja con la versión nueva.
  const ca = await api(`/api/oficinas/${office}/editorial/propuestas/${p2.id}/cambios`, { method: 'POST', body: JSON.stringify({ nota: 'investiguen más hooks virales', casillas: ['hook', 'nada'] }) });
  assert.strictEqual(ca.status, 202, JSON.stringify(ca.body));
  assert.strictEqual(ca.body.propuesta.estado, 'en-cambios');
  assert.deepStrictEqual(ca.body.propuesta.cambiosPedidos.casillas, ['hook']);
  const miniDir = path.join(home, 'oficinas', office, 'proyectos', ca.body.mision);
  assert.match(fs.readFileSync(path.join(miniDir, '.office', 'turno.md'), 'utf8'), /investiguen más hooks virales/);
  assert.ok(fs.existsSync(path.join(miniDir, 'propuestas', '1', 'imagen.png')), 'la propuesta a cambiar viaja con su imagen');
  assert.ok(await cerrada(ca.body.mision));
  const mini = JSON.parse(fs.readFileSync(path.join(miniDir, '.office', 'chat.json'), 'utf8'));
  assert.ok(mini.messages.filter(m => m.kind === 'agent').length <= 2, 'el mini ciclo es de 1 a 2 turnos');
  const p2b = (await api(`/api/oficinas/${office}/editorial/propuestas/${p2.id}`)).body;
  assert.strictEqual(p2b.estado, 'pendiente');
  assert.strictEqual(p2b.hook, `${p2.hook} (v2)`);
  assert.strictEqual(p2b.version, 2);
  lista = (await api(`/api/oficinas/${office}/editorial/propuestas`)).body;
  assert.strictEqual(lista.length, 3, 'los cambios reemplazan la propuesta, no crean otra');

  // El gusto: las tres decisiones, con sus notas, y entra en el brief de la siguiente tanda.
  const g = gusto();
  assert.match(g, /«Hook viral número 1»/);
  assert.match(g, /no me gustó la imagen/);
  assert.match(g, /investiguen más hooks virales/);
  assert.match(g, /hook 1/);
  assert.match(g, /## Temas a evitar\n- Tema de prueba 3/);

  // El PC durmió tres días: el reloj lanza UNA tanda (la última franja), aunque mire dos veces.
  const despierta = Date.now() + 4 * 864e5;
  await relojEditorial(despierta);
  await relojEditorial(despierta + 1000);
  assert.strictEqual(tandas().length, 2);
  const t2 = tandas()[1];
  assert.ok(await cerrada(t2.chatId));
  const turno2 = fs.readFileSync(path.join(home, 'oficinas', office, 'proyectos', t2.chatId, '.office', 'turno.md'), 'utf8');
  assert.match(turno2, /Gusto del usuario/);
  assert.match(turno2, /no me gustó la imagen/);

  // Agendar con un token de escritor: ViralHunt lo deja en Review y la bandeja lo dice así.
  await api(`/api/oficinas/${office}/editorial`, { method: 'PUT', body: JSON.stringify({ destino: 'agendar' }) });
  vh.cfg.mustDraft = 'role';
  const nueva = (await api(`/api/oficinas/${office}/editorial/propuestas`)).body.find(p => p.estado === 'pendiente' && p.origen.chatId === t2.chatId);
  const ag = await api(`/api/oficinas/${office}/editorial/propuestas/${nueva.id}/aprobar`, { method: 'POST', body: '{}' });
  assert.strictEqual(ag.status, 200, JSON.stringify(ag.body));
  assert.strictEqual(ag.body.viralhunt.donde, 'revision');
  const create2 = vh.pedidos.filter(p => p.action === 'create').pop();
  assert.strictEqual(create2.json.draft, undefined);
  assert.strictEqual(create2.json.scheduled_at, new Date(Date.parse(nueva.hora)).toISOString().replace(/\.\d{3}Z$/, 'Z'));

  // Todas las llamadas a ViralHunt llevaron el token del servidor, y solo al simulador.
  assert.ok(vh.pedidos.length > 5 && vh.pedidos.every(p => p.headers.authorization === `Bearer ${TOKEN}`));
});

test('una propuesta que copia la fuente palabra por palabra no llega como aprobable', async () => {
  process.env.EDITORIAL_COPIA = '1';
  try {
    const r = await api(`/api/oficinas/${office}/editorial/tanda`, { method: 'POST', body: '{}' });
    assert.strictEqual(r.status, 201, JSON.stringify(r.body));
    assert.ok(await cerrada(r.body.id));
  } finally { delete process.env.EDITORIAL_COPIA; }
  const mias = (await api(`/api/oficinas/${office}/editorial/propuestas`)).body.filter(p => p.origen.chatId === tandas().pop().chatId);
  const copiada = mias.find(p => p.estado === 'descartada');
  assert.ok(copiada, 'la que copia queda descartada');
  assert.match(copiada.motivoDescarte, /word for word/); // avisos del servidor: en su idioma (inglés por defecto)
  assert.strictEqual((await api(`/api/oficinas/${office}/editorial/propuestas/${copiada.id}/aprobar`, { method: 'POST', body: '{}' })).status, 409);
});

test('el token nunca aparece en briefs, logs, chat.json, respuestas de la API ni en la UI', async () => {
  // api() ya guarda el texto de cada respuesta en `respuestas`.
  for (const url of [`/api/oficinas/${office}/editorial`, `/api/oficinas/${office}/editorial/gusto`, `/api/oficinas/${office}/viralhunt`, '/api/oficinas', `/api/oficinas/${office}/hoy`, `/api/oficinas/${office}/bitacora`]) await api(url);
  for (const c of (await api(`/api/chats?oficina=${office}`)).body) { await api(`/api/chats/${c.id}?oficina=${office}`); await api(`/api/chats/${c.id}/activity?oficina=${office}`); }
  for (const f of ['index.html', 'app.js', 'editorial.js']) respuestas.push(await (await fetch(`${base}/${f}`)).text());
  const enRespuestas = respuestas.filter(r => String(r).includes(TOKEN));
  assert.strictEqual(enRespuestas.length, 0, 'una respuesta de la API lleva el token');
  // Todo el disco de datos (briefs, turno.md, chat.json, actividad.jsonl, bitácora, propuestas, gusto) salvo el secreto.
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
  assert.ok(fs.readFileSync(path.join(home, 'oficinas', office, 'viralhunt.secreto.json'), 'utf8').includes(TOKEN), 'el secreto sí lo guarda');
  // Borrar el token: la oficina deja de poder aprobar y lo dice.
  assert.deepStrictEqual((await api(`/api/oficinas/${office}/viralhunt`, { method: 'DELETE' })).body, { configurado: false });
});
