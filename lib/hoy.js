// Tablero «Hoy en la oficina» (§4.5 de docs/simulaciones/SIMULACIONES.md), versión S1: sin rutinas, bandeja ni
// presupuesto todavía. Se arma con lo que el SERVIDOR dejó escrito en las misiones de la oficina (turnos, cierres de
// ciclo, «Cerebro actualizado», reservas, fallos) y con los entrantes. Nunca con lo que un agente dice haber hecho.
// Sin IA y sin efectos: función pura, para poder probarla con cualquier «ahora» y cualquier zona horaria.

const { t, getLang } = require('./i18n');

// Cómo se cerró una misión. El texto sale del diccionario (hoy.cierre.<estado>) en el idioma pedido.
const ICONO = { unanime: '✅', consenso: '✅', meseta: '⏸', retroceso: '⚠', aceptado: '✅', agotado: '⏹', detenido: '■', 'sin-agentes': '⚠', error: '⚠' };
function cierreDe(m, lang) {
  const estado = m.userAccepted ? 'aceptado' : m.outcome;
  return ICONO[estado] ? { estado, icono: ICONO[estado], texto: t(`hoy.cierre.${estado}`, {}, lang) } : { estado, icono: '·', texto: m.outcome };
}

// Zona de la marca (marca.zona) si es válida; si no, la del sistema.
function zonaValida(zona) {
  if (!zona) return undefined;
  try { new Intl.DateTimeFormat('en-CA', { timeZone: zona }); return zona; } catch { return undefined; }
}
const partes = (d, zona) => Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
  timeZone: zona, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', weekday: 'short',
}).formatToParts(new Date(d)).map(p => [p.type, p.value]));
const diaDe = (d, zona) => { const p = partes(d, zona); return `${p.year}-${p.month}-${p.day}`; };
const horaDe = (d, zona) => { const p = partes(d, zona); return `${p.hour}:${p.minute}`; };
function fechaTexto(dia, lang = getLang()) {
  const [y, m, d] = dia.split('-').map(Number);
  const wd = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return t('hoy.date', { weekday: t('hoy.days', {}, lang).split(',')[wd], day: d, month: t('hoy.months', {}, lang).split(',')[m - 1] }, lang);
}

const media = xs => (xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10 : null);

/**
 * @param {object} p
 * @param {object} p.oficina      oficina.json (nombre, marca, empleados…)
 * @param {Array}  p.equipo       agentes de la oficina: {id, name, role, modeloLabel, reserva}
 * @param {Array}  p.misiones     chats completos: {id, title, running, outcome, messages, debate}
 * @param {Array}  p.entrantes    traspasos que esperan: {archivo, desde, content}
 * @param {Date}   [p.ahora]
 * @param {string} [p.dia]        AAAA-MM-DD; por defecto, hoy en la zona de la marca
 * @param {string} [p.lang]       idioma de los textos; por defecto, el del servidor
 */
function tablero({ oficina, equipo = [], misiones = [], entrantes = [], ahora = new Date(), dia = null, lang = getLang() }) {
  const zona = zonaValida(oficina?.marca?.zona);
  const hoy = diaDe(ahora, zona);
  const day = /^\d{4}-\d{2}-\d{2}$/.test(dia || '') ? dia : hoy;
  const delDia = m => m?.ts && diaDe(m.ts, zona) === day;

  const hecho = [], aprendido = [], atencion = [], esperan = [];
  const porEmpleado = new Map(equipo.map(a => [a.id, { turnos: 0, notas: [], ultimo: null, reserva: null, fallo: null }]));
  const gasto = { tokens: 0, entrada: 0, salida: 0, cache: 0, turnosMedidos: 0, desconocidos: 0, segundos: 0, turnos: 0 };

  for (const c of misiones) {
    const msgs = c.messages || [];
    const turnosDia = msgs.filter(m => m.kind === 'agent' && delDia(m));
    for (const m of turnosDia) {
      gasto.turnos++;
      gasto.segundos += m.seconds || 0;
      const u = m.usage;
      if (u?.totalTokens) {
        gasto.turnosMedidos++;
        gasto.tokens += u.totalTokens;
        gasto.entrada += u.inputTokens || 0;
        gasto.salida += u.outputTokens || 0;
        gasto.cache += u.cachedTokens || 0;
      } else gasto.desconocidos++; // nunca «0 tokens» (§4.4)
      const e = porEmpleado.get(m.agentId);
      if (e) {
        e.turnos++;
        if (typeof m.score === 'number') e.notas.push(m.score);
        // Las misiones llegan por fecha de creación, no por fecha de sus turnos.
        // Una misión antigua reanudada puede contener la actividad más reciente.
        const ts = new Date(m.ts).getTime();
        if (e.ultimoTs == null || ts >= e.ultimoTs) {
          e.ultimoTs = ts;
          e.ultimo = { chatId: c.id, titulo: c.title, hora: horaDe(m.ts, zona), veredicto: m.verdict, nota: m.score ?? null, modelo: m.modelo || null };
        }
        if (m.reserva && (e.reservaTs == null || ts >= e.reservaTs)) {
          e.reservaTs = ts;
          e.reserva = { ...m.reserva, chatId: c.id };
        }
        if (m.failure && (e.falloTs == null || ts >= e.falloTs)) {
          e.falloTs = ts;
          e.fallo = { label: m.failure.label, hint: m.failure.hint, chatId: c.id };
        }
      }
      if (m.failure) atencion.push({ chatId: c.id, hora: horaDe(m.ts, zona), texto: t('hoy.failure', { name: m.agentName, label: m.failure.label.toLowerCase(), title: c.title }, lang), pista: m.failure.hint || '' });
      if (m.reserva) atencion.push({ chatId: c.id, hora: horaDe(m.ts, zona), texto: t('hoy.reserve', { name: m.agentName, to: m.reserva.a, reason: String(m.reserva.motivo || '').toLowerCase(), from: m.reserva.de }, lang), pista: m.reserva.diversidadReducida ? t('hoy.reserveSame', {}, lang) : '' });
    }

    // Lo aprendido: el servidor deja «🧠 Memory updated by X: archivos» (o «Cerebro actualizado por», en español o en
    // misiones antiguas) al fusionar la memoria.
    for (const m of msgs) {
      if (m.kind !== 'system' || !delDia(m)) continue;
      const a = /^🧠 (?:Cerebro actualizado por|Memory updated by) (.+?): (.+)$/.exec(m.text || '');
      if (a) aprendido.push({ chatId: c.id, hora: horaDe(m.ts, zona), quien: a[1], archivos: a[2].split(', ').map(f => f.replace(/ \((?:fusionado|merged).*\)$/, '')) });
    }

    // Hecho: cierres de ciclo de ese día (los escribe el orquestador con su «outcome»).
    for (const m of msgs) {
      if (m.kind !== 'system' || !m.outcome || m.outcome === 'started' || !delDia(m)) continue;
      const turnos = msgs.filter(t => t.kind === 'agent' && t.cycle === m.cycle);
      const notas = turnos.map(t => t.score).filter(s => typeof s === 'number');
      const quien = [...new Set(turnos.filter(t => t.verdict !== 'ERROR').map(t => t.agentName))];
      const k = cierreDe(m, lang);
      hecho.push({ chatId: c.id, hora: horaDe(m.ts, zona), ts: m.ts, titulo: c.title, estado: m.outcome, icono: k.icono, texto: k.texto,
        turnos: turnos.length, nota: media(notas), quien });
    }
    if (c.running && day === hoy) {
      const inicio = [...msgs].reverse().find(m => m.kind === 'system' && m.outcome === 'started');
      hecho.push({ chatId: c.id, hora: inicio?.ts ? horaDe(inicio.ts, zona) : '', ts: inicio?.ts || ahora.toISOString(), titulo: c.title, estado: 'en-curso', icono: '▶', texto: t('hoy.workingNow', {}, lang), turnos: 0, nota: null, quien: [] });
    }

    // Lo que espera tu decisión (en S1 no hay bandeja: entrantes, ciclos cortados y objeciones sin cerrar).
    const abiertas = (c.debate || []).filter(o => o.status === 'abierta' || o.status === 'disputada');
    const cierre = [...msgs].reverse().find(m => m.kind === 'system' && m.outcome);
    const aceptada = !!(cierre && cierre.outcome !== 'started' && (cierre.userAccepted || cierre.outcome === 'aceptado'));
    if (c.outcome === 'interrupted') esperan.push({ tipo: 'reanudar', chatId: c.id, texto: t('hoy.interrupted', { title: c.title }, lang), accion: t('hoy.resume', {}, lang) });
    else if (!c.running && !aceptada && abiertas.length) esperan.push({ tipo: 'objeciones', chatId: c.id, texto: t('hoy.openObjections', { title: c.title, count: abiertas.length }, lang), accion: t('hoy.anotherPass', {}, lang) });
  }
  for (const x of entrantes) {
    const titulo = (/«([^»]+)»/.exec(x.content || '')?.[1] || x.archivo).slice(0, 120);
    esperan.unshift({ tipo: 'entrante', archivo: x.archivo, texto: t('hoy.incoming', { from: x.desde || t('hoy.otherOffice', {}, lang), title: titulo }, lang), accion: t('hoy.acceptOrDiscard', {}, lang) });
  }

  hecho.sort((a, b) => String(a.ts).localeCompare(String(b.ts)));
  aprendido.sort((a, b) => a.hora.localeCompare(b.hora));
  atencion.sort((a, b) => a.hora.localeCompare(b.hora));

  const activos = new Set((oficina?.empleados || []).filter(e => e.activo !== false).map(e => e.id));
  const equipoOut = equipo.map(a => {
    const e = porEmpleado.get(a.id);
    return { id: a.id, nombre: a.name, puesto: a.role || '', modelo: a.modeloLabel || a.cli || '', reservaDe: a.reserva || null,
      activo: !activos.size || activos.has(a.id), turnos: e.turnos, nota: media(e.notas), ultimo: e.ultimo, reserva: e.reserva, fallo: e.fallo };
  });

  return {
    dia: day, hoy: day === hoy, fecha: fechaTexto(day, lang), zona: zona || Intl.DateTimeFormat().resolvedOptions().timeZone,
    oficina: { id: oficina?.id, nombre: oficina?.nombre, marca: oficina?.marca?.nombre || null },
    // En S1 el aislamiento es de contexto: los empleados corren con tu usuario (S1F, la frontera por cuenta, sin activar).
    frontera: { nivel: 'contexto', texto: t('hoy.frontier', {}, lang) },
    gasto: { ...gasto, minutos: Math.round(gasto.segundos / 6) / 10 },
    esperan, hecho, equipo: equipoOut, aprendido, atencion,
    // Sin rutinas hasta S2: el tablero lo dice en vez de inventar un «próximo».
    proximo: { texto: t('hoy.noRoutines', {}, lang) },
  };
}

// «Siguiente paso recomendado» del último traspaso de una misión. Solo el texto del agente, recortado.
function siguientePaso(handoff, max = 300) {
  const text = String(handoff || '');
  const i = text.search(/^## (?:Último traspaso|Latest handoff)/m);
  const m = /\*\*(?:Siguiente paso recomendado|Recommended next step):\*\*\s*([\s\S]*?)(?=\n\s*\*\*[^*\n]+:\*\*|\n## |$)/.exec(i >= 0 ? text.slice(i) : '');
  const s = (m?.[1] || '').replace(/^\s*-\s*/gm, '').replace(/\s+/g, ' ').trim();
  return s.length > max ? s.slice(0, max) + '…' : s;
}

// Continuidad entre misiones de la misma oficina (D56): las últimas que se cerraron, con cómo se cerraron y lo que
// su equipo dejó como siguiente paso. Va en el brief de la misión nueva; no da rutas (no se sale de la carpeta).
// @param misiones [{id, title, messages, handoff}]
function ultimasEntregas(misiones = [], { excluir = null, n = 3, lang = getLang() } = {}) {
  const out = [];
  for (const c of misiones) {
    if (!c || c.id === excluir) continue;
    const msgs = c.messages || [];
    const cierre = [...msgs].reverse().find(m => m.kind === 'system' && m.outcome);
    if (!cierre || cierre.outcome === 'started' || !cierre.ts) continue;
    const k = cierreDe(cierre, lang);
    const notas = msgs.filter(t => t.kind === 'agent' && t.cycle === cierre.cycle).map(t => t.score).filter(s => typeof s === 'number');
    out.push({ id: c.id, titulo: String(c.title || c.id).slice(0, 120), ts: cierre.ts, dia: String(cierre.ts).slice(0, 10),
      estado: k.estado, icono: k.icono, texto: k.texto, nota: media(notas), siguiente: siguientePaso(c.handoff) });
  }
  return out.sort((a, b) => String(b.ts).localeCompare(String(a.ts))).slice(0, n);
}

module.exports = { tablero, ultimasEntregas, siguientePaso, diaDe, horaDe, fechaTexto, zonaValida };
