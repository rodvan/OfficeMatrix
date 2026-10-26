// Rutinas permanentes de la Editorial v2 (docs/BRIEF-EDITORIAL-V2.md §1 y §6, docs/EDITORIAL-V2.md).
// Una rutina NO es una misión: no tiene meseta ni tope de rondas global. Cada ejecución es corta y termina; la rutina
// sigue viva y vuelve a disparar según su frecuencia. Nunca se apaga sola: solo el dueño la pausa.
//   Tipos:
//     radar          agentes · temas que suben en el nicho → editorial/radar/<fecha>.json + semillas
//     desempeno      servidor · stats.php → ganadores frente a la media → editorial/desempeno/<fecha>.json
//     mas-como-este  servidor · tras «desempeno»: search.php con el tema de cada ganador → semillas
//     aprender       servidor · schedule.php?action=edit_log y estado de los posts → gusto
//     redaccion      agentes · semillas → propuestas completas con imagen, fuentes y semáforo (la «tanda» de v1)
// Frecuencia: `cadaMin` (≥ 30) o `horas` fijas, con una `ventana` local opcional; o `tras` otra rutina.
// El estado vive en oficinas/<id>/editorial/rutinas.json (lo escribe el servidor).
const fs = require('fs');
const path = require('path');
const { instante, diaLocal } = require('./editorial');
const { t } = require('./i18n');

const TIPOS = {
  radar: { agentes: true, cadaMin: 60, tope: 48 }, // cada hora con 2 agentes: 24 × 2 turnos caben en el día
  desempeno: { agentes: false, horas: ['08:00'], tope: 0 },
  'mas-como-este': { agentes: false, tras: 'desempeno', tope: 0 },
  aprender: { agentes: false, horas: ['07:30'], tope: 0 },
  redaccion: { agentes: true, tope: 30 },
};
const MIN_CADA = 30;
const HORA_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
const AVISO_TOPE = 0.8;

const httpErr = (status, message, extra = {}) => Object.assign(new Error(message), { status, ...extra });
const sumarDia = (dia, n) => new Date(Date.parse(`${dia}T12:00:00Z`) + n * 864e5).toISOString().slice(0, 10);
const aMin = h => { const [a, b] = h.split(':').map(Number); return a * 60 + b; };
const aHora = m => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

// ¿La hora local cae en la ventana? Admite ventanas que cruzan la medianoche («22:00 a 06:00»).
function enVentana(hora, ventana) {
  if (!ventana) return true;
  const h = aMin(hora), d = aMin(ventana.desde), a = aMin(ventana.hasta);
  return d <= a ? h >= d && h < a : h >= d || h < a;
}

// Las rutinas de la regla: completa las que faltan con su valor por defecto (todas en pausa salvo «redaccion»,
// que hereda las horas de la v1 para que una oficina ya configurada siga igual).
function normalizarRutinas(input, regla = {}) {
  const prev = Array.isArray(input) ? input : [];
  const errores = [];
  const out = Object.keys(TIPOS).map(tipo => {
    const d = TIPOS[tipo];
    const r = prev.find(x => x && x.tipo === tipo) || {};
    const rut = {
      tipo, id: tipo,
      activa: 'activa' in r ? r.activa === true : tipo === 'redaccion',
      cadaMin: null, horas: [], tras: null, ventana: null,
      equipo: Array.isArray(r.equipo) ? r.equipo.map(String).filter(Boolean).slice(0, 6) : [],
      topeDiario: Number.isFinite(Number(r.topeDiario)) && r.topeDiario !== '' && r.topeDiario != null ? Math.round(Number(r.topeDiario)) : d.tope,
      cantidad: Math.round(Number(r.cantidad)) || (tipo === 'radar' ? 3 : null),
    };
    // «redaccion» con horas fijas usa SIEMPRE regla.horas (una sola fuente de verdad con la v1; ya validadas allí).
    const heredadas = tipo === 'redaccion' && (r.cadaMin == null || r.cadaMin === '') && !r.tras;
    if (r.tras || (!r.cadaMin && !r.horas && d.tras)) rut.tras = r.tras || d.tras;
    else if (r.cadaMin != null && r.cadaMin !== '') rut.cadaMin = Math.round(Number(r.cadaMin));
    else if (heredadas) rut.horas = [...(regla.horas || ['09:00', '17:00'])];
    else if (Array.isArray(r.horas) && r.horas.length) rut.horas = [...new Set(r.horas.map(String))].sort();
    else if (d.cadaMin) rut.cadaMin = d.cadaMin;
    else rut.horas = [...(d.horas || [])];
    if (r.ventana && (r.ventana.desde || r.ventana.hasta)) rut.ventana = { desde: String(r.ventana.desde || '00:00'), hasta: String(r.ventana.hasta || '23:59') };

    const L = t(`ed.routine.${tipo}`);
    if (rut.tras && !TIPOS[rut.tras]) errores.push(t('ed.routine.errAfter', { routine: L }));
    if (rut.tras === tipo) errores.push(t('ed.routine.errAfter', { routine: L }));
    if (rut.cadaMin != null && !(rut.cadaMin >= MIN_CADA && rut.cadaMin <= 1440)) errores.push(t('ed.routine.errEvery', { routine: L, min: MIN_CADA }));
    if (!heredadas && (rut.horas.length > 24 || rut.horas.some(h => !HORA_RE.test(h)))) errores.push(t('ed.routine.errHours', { routine: L }));
    if (rut.ventana && (!HORA_RE.test(rut.ventana.desde) || !HORA_RE.test(rut.ventana.hasta) || rut.ventana.desde === rut.ventana.hasta)) errores.push(t('ed.routine.errWindow', { routine: L }));
    if (!(rut.topeDiario >= 0 && rut.topeDiario <= 500)) errores.push(t('ed.routine.errCap', { routine: L }));
    if (tipo === 'radar' && !(rut.cantidad >= 1 && rut.cantidad <= 3)) errores.push(t('ed.routine.errIdeas'));
    return rut;
  });
  return { rutinas: out, errores };
}

// Las ejecuciones previstas de ayer, hoy y mañana en la zona, dentro de la ventana, en orden.
function franjasRutina(rut, zona, ahora) {
  if (rut.tras) return [];
  const hoy = diaLocal(zona, ahora);
  let horas = rut.horas;
  if (rut.cadaMin) {
    horas = [];
    for (let m = 0; m < 1440; m += rut.cadaMin) horas.push(aHora(m));
  }
  horas = horas.filter(h => enVentana(h, rut.ventana));
  return [-1, 0, 1].flatMap(n => {
    const dia = sumarDia(hoy, n);
    return horas.map(h => ({ clave: `${dia}T${h}`, dia, hora: h, at: instante(zona, dia, h) }));
  }).sort((a, b) => a.at - b.at);
}

// Turnos de agente que gasta una ejecución (para el tope diario). Las del servidor, 0. El radar es una ronda en relevo
// con 2 agentes como mucho; la redacción, 2 ciclos de todo el equipo.
// El reloj decide el tope con esta cifra y la ejecución apunta la misma, así el tope corta donde dice.
const costeEstimado = (rut, equipoPorDefecto = 1) => {
  if (!TIPOS[rut.tipo]?.agentes) return 0;
  const n = Math.max(1, rut.equipo?.length || equipoPorDefecto);
  return rut.tipo === 'radar' ? Math.min(2, n) : n * 2;
};

// ¿Toca ejecutar la rutina ahora? Función pura: se prueba con un reloj falso.
//   st: { ultimaClave, activadaEn, turnosHoy: { dia, turnos }, ultima: { inicio, fin } }
//   predecesor: el estado de la rutina de la que cuelga (`tras`).
// Tras dormir el PC varias franjas, se ejecuta solo la última, una vez (recuperación), nunca en cascada.
function rutinaDebida({ maestra = true, rut, st = {}, zona, ahora, abierta = false, predecesor = null, coste = 0 }) {
  if (!maestra) return { lanzar: false, motivo: 'inactiva' };
  if (!rut.activa) return { lanzar: false, motivo: 'pausada' };
  let franja;
  if (rut.tras) {
    const fin = predecesor?.ultima?.fin;
    if (!fin || (st.ultimaClave && `tras:${fin}` <= st.ultimaClave)) return { lanzar: false, motivo: 'esperando' };
    franja = { clave: `tras:${fin}`, dia: diaLocal(zona, ahora), hora: null, at: Date.parse(fin) };
  } else {
    const pasadas = franjasRutina(rut, zona, ahora).filter(f => f.at <= ahora);
    franja = pasadas[pasadas.length - 1];
    if (!franja) return { lanzar: false, motivo: 'sin-franja' };
    if (st.ultimaClave && franja.clave <= st.ultimaClave) return { lanzar: false, motivo: 'ya-lanzada', franja };
  }
  if (st.activadaEn && franja.at < Date.parse(st.activadaEn)) return { lanzar: false, motivo: 'antes-de-activar', franja };
  if (abierta) return { lanzar: false, motivo: 'anterior-abierta', franja };
  const hoy = diaLocal(zona, ahora);
  const usados = st.turnosHoy?.dia === hoy ? st.turnosHoy.turnos : 0;
  if (coste > 0 && rut.topeDiario > 0 && usados + coste > rut.topeDiario) return { lanzar: false, motivo: 'tope', franja, usados };
  return { lanzar: true, franja, recuperacion: !rut.tras && ahora - franja.at > 15 * 60e3 };
}

function proximaEjecucion(rut, zona, ahora) {
  if (!rut.activa) return null;
  if (rut.tras) return { tras: rut.tras };
  const f = franjasRutina(rut, zona, ahora).find(x => x.at > ahora);
  return f ? { clave: f.clave, at: new Date(f.at).toISOString() } : null;
}

// Lo que el panel ve de cada rutina: estado, próxima y última ejecución, turnos de hoy y aviso al acercarse al tope.
function vistaRutina(rut, st = {}, { zona, ahora, ejecutando = false }) {
  const hoy = diaLocal(zona, ahora);
  const usados = st.turnosHoy?.dia === hoy ? st.turnosHoy.turnos : 0;
  return {
    ...rut, nombre: t(`ed.routine.${rut.tipo}`), agentes: TIPOS[rut.tipo].agentes,
    estado: ejecutando ? 'ejecutando' : rut.activa ? 'activa' : 'pausada',
    proxima: proximaEjecucion(rut, zona, ahora), ultima: st.ultima || null, ultimaClave: st.ultimaClave || null,
    turnosHoy: usados,
    avisoTope: rut.topeDiario > 0 && usados >= Math.ceil(rut.topeDiario * AVISO_TOPE) ? t('ed.routine.capNear', { used: usados, cap: rut.topeDiario }) : null,
  };
}

// ---------- Almacén: oficinas/<id>/editorial/rutinas.json ----------

function createRutinasStore(dirOf) {
  const file = office => path.join(dirOf(office), 'rutinas.json');
  const leer = office => { try { return JSON.parse(fs.readFileSync(file(office), 'utf8')) || {}; } catch { return {}; } };
  const guardar = (office, all) => {
    fs.mkdirSync(path.dirname(file(office)), { recursive: true });
    fs.writeFileSync(file(office) + '.tmp', JSON.stringify(all, null, 2));
    fs.renameSync(file(office) + '.tmp', file(office));
  };
  const de = (office, tipo) => leer(office)[tipo] || {};
  const cambiar = (office, tipo, fn) => {
    const all = leer(office);
    all[tipo] = fn({ ...(all[tipo] || {}) }) || all[tipo];
    guardar(office, all);
    return all[tipo];
  };
  // La franja queda tomada ANTES de esperar a ViralHunt o a los agentes: el reloj no la repite.
  const tomar = (office, tipo, clave) => cambiar(office, tipo, s => { if (clave && (!s.ultimaClave || clave > s.ultimaClave)) s.ultimaClave = clave; return s; });
  const empezar = (office, tipo, { clave, manual = false, chatId = null, zona, ahora = Date.now(), coste = 0 }) => cambiar(office, tipo, s => {
    if (clave && !String(clave).startsWith('manual') && (!s.ultimaClave || clave > s.ultimaClave)) s.ultimaClave = clave;
    const hoy = diaLocal(zona, ahora);
    s.turnosHoy = { dia: hoy, turnos: (s.turnosHoy?.dia === hoy ? s.turnosHoy.turnos : 0) + coste };
    s.ultima = { inicio: new Date(ahora).toISOString(), fin: null, clave: clave || null, manual, chatId, informe: null };
    s.historial = [...(s.historial || []), s.ultima].slice(-30);
    return s;
  });
  // Al terminar: el informe (qué salió, qué CLI cayó) y los turnos reales en lugar del estimado.
  const terminar = (office, tipo, informe, { turnosReales = null, estimado = 0, zona, ahora = Date.now() } = {}) => cambiar(office, tipo, s => {
    const fin = new Date(ahora).toISOString();
    s.ultima = { ...(s.ultima || {}), fin, informe };
    if (s.historial?.length) s.historial[s.historial.length - 1] = s.ultima;
    const hoy = diaLocal(zona, ahora);
    if (turnosReales != null && s.turnosHoy?.dia === hoy) s.turnosHoy.turnos = Math.max(0, s.turnosHoy.turnos - estimado + turnosReales);
    return s;
  });
  const activar = (office, tipo, activa) => cambiar(office, tipo, s => { if (activa) s.activadaEn = new Date().toISOString(); return s; });
  return { leer, de, tomar, empezar, terminar, activar };
}

module.exports = { TIPOS, MIN_CADA, normalizarRutinas, franjasRutina, rutinaDebida, proximaEjecucion, vistaRutina, costeEstimado, enVentana, createRutinasStore };
