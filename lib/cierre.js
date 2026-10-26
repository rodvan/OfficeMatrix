// Informe de cierre de una misión (RF1–RF8 en docs/DECISIONES.md; contrato en docs/CIERRE.md).
// La parte objetiva la arma el servidor sin ninguna CLI: git contra el commit base, chat.json y el brief.
// Lo subjetivo (logros en palabras del usuario, ✔ del brief, riesgos) lo puede mejorar un relator después
// con fusionarRelato, que nunca toca los números y no acepta un ✔ sin una evidencia que exista en disco.

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { roundMean } = require('./cycle');
const { isEnvironmentBlock } = require('./debate');
const L = require('../public/cierre-textos.js');
const i18n = require('./i18n');

const VERSION = 1;
const CUT = new Set(['ERROR', 'PARCIAL']);
const BITACORA = new Set(['HANDOFF.md', 'MEMORIA.md', 'docs/DISCUSION.md']);
const IMAGEN = /\.(png|jpe?g|gif|webp)$/i;
const MAX_LINEAS_ARCHIVO = 5 * 1024 * 1024; // un archivo nuevo más grande no se cuenta línea a línea

// ---------- Secretos: nada de tokens, llaves om_ ni *.secreto.json en el informe (RF7) ----------
const SECRETOS = [
  /\bom_[A-Za-z0-9_-]{6,}/g, /\bsk-[A-Za-z0-9_-]{10,}/g, /\bxai-[A-Za-z0-9_-]{10,}/g, /\bgh[pousr]_[A-Za-z0-9]{10,}/g,
  /\bAIza[0-9A-Za-z_-]{20,}/g, /\bBearer\s+[A-Za-z0-9._~+/-]{12,}=*/g, /\b(token|apiKey|api_key|secret)(["']?\s*[:=]\s*["']?)[A-Za-z0-9._-]{12,}/gi,
];
const esSecreto = p => /\.secreto\.json$/i.test(p) || /(^|\/)\.env(\.|$)/.test(p);
function limpiar(text) {
  let s = String(text ?? '');
  // Sin grupos, el callback recibe (m, offset, string): solo el patrón «clave = valor» conserva la clave.
  for (const re of SECRETOS) s = s.replace(re, (m, ...g) => (g.length >= 4 && typeof g[0] === 'string' ? `${g[0]}${g[1]}[oculto]` : '[oculto]'));
  return s;
}

// ---------- Idioma del pedido: las etiquetas del informe van en ese idioma ----------
// El mismo detector que los briefs (lib/i18n.js). Sin pistas, el idioma de la app, que por defecto es el inglés.
const idiomaDe = text => i18n.detectLang(text, i18n.getLang());

// ---------- Git: números contra el commit base (RF3) ----------
function git(dir, args) {
  return execFileSync('git', ['-c', 'core.quotepath=false', ...args], { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 * 1024 * 1024, windowsHide: true });
}

// Solo vale el repositorio de la propia misión. Una misión sin .git dentro de proyectos/ de una app que sí es repo
// haría que git contara los cambios de la app (proyectos/ está ignorado allí): números de otro proyecto.
function repoPropio(dir) {
  try {
    const top = git(dir, ['rev-parse', '--show-toplevel']).trim();
    const real = p => fs.realpathSync.native(p).replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
    return real(top) === real(dir);
  } catch { return false; }
}

// El commit desde el que se cuenta: el que guardó el servidor al empezar la misión; si no (misiones viejas),
// el último commit anterior a la creación de la misión, y si tampoco, la raíz.
function commitBase(dir, chat = {}) {
  if (!repoPropio(dir)) return null;
  const probar = c => { try { return git(dir, ['rev-parse', '--verify', '--quiet', `${c}^{commit}`]).trim() || null; } catch { return null; } };
  if (chat.base?.commit && probar(chat.base.commit)) return { commit: probar(chat.base.commit), como: 'start' };
  if (chat.created) {
    try {
      const c = git(dir, ['rev-list', '-1', `--before=${chat.created}`, 'HEAD']).trim();
      if (c) return { commit: c, como: 'before-created' };
    } catch {}
  }
  try {
    const raiz = git(dir, ['rev-list', '--max-parents=0', 'HEAD']).trim().split(/\r?\n/).pop();
    if (raiz) return { commit: raiz, como: 'root' };
  } catch {}
  return null;
}

// Texto o binario. Un UTF-16 con BOM (los .txt que deja PowerShell) es texto, aunque lleve bytes nulos.
function lineasDe(file) {
  let buf;
  try {
    const st = fs.statSync(file);
    if (!st.isFile() || st.size > MAX_LINEAS_ARCHIVO) return null;
    buf = fs.readFileSync(file);
  } catch { return null; }
  if (!buf.length) return 0;
  let text;
  if (buf[0] === 0xff && buf[1] === 0xfe) text = buf.toString('utf16le');
  else if (buf.subarray(0, 8000).includes(0)) return null;
  else text = buf.toString('utf8');
  const n = (text.match(/\n/g) || []).length;
  return text.endsWith('\n') ? n : n + 1;
}

const tipoDe = p => (BITACORA.has(p) ? 'bitacora' : /^tests?\//.test(p) ? 'pruebas' : IMAGEN.test(p) ? 'imagen' : /\.md$/i.test(p) || /^docs\//.test(p) ? 'docs' : 'codigo');
const fuera = p => p.startsWith('.office/') || p.startsWith('.git/') || esSecreto(p);

function numerosGit(dir, base) {
  const porRuta = new Map();
  const status = git(dir, ['diff', '--name-status', '-M', base.commit]).split(/\r?\n/).filter(Boolean);
  for (const line of status) {
    const [st, a, b] = line.split('\t');
    const ruta = (b || a).replace(/\\/g, '/');
    if (fuera(ruta)) continue;
    // Borrado para git pero todavía en disco: salió del repositorio (git rm --cached, .gitignore), no se perdió.
    // El instalador sacó 61 archivos internos del repo público y todos seguían en la carpeta.
    const borrado = st[0] === 'D' ? (fs.existsSync(path.join(dir, ruta)) ? 'sacado' : 'borrado') : null;
    const estado = st[0] === 'A' ? 'nuevo' : borrado || (st[0] === 'R' ? 'renombrado' : 'modificado');
    porRuta.set(ruta, { ruta, estado, de: st[0] === 'R' ? a : undefined, mas: 0, menos: 0, binario: false, tipo: tipoDe(ruta) });
  }
  for (const line of git(dir, ['diff', '--numstat', '-M', base.commit]).split(/\r?\n/).filter(Boolean)) {
    const [mas, menos, ...resto] = line.split('\t');
    let ruta = resto.join('\t');
    // Renombrados: "a => b" o "dir/{a => b}/x".
    if (ruta.includes(' => ')) ruta = ruta.replace(/\{([^{}]*) => ([^{}]*)\}/, '$2').replace(/^.* => /, '').replace(/\/\//g, '/');
    const f = porRuta.get(ruta);
    if (!f) continue;
    if (mas === '-') f.binario = true;
    else { f.mas = Number(mas) || 0; f.menos = Number(menos) || 0; }
  }
  for (const r of git(dir, ['ls-files', '--others', '--exclude-standard']).split(/\r?\n/).filter(Boolean)) {
    const ruta = r.replace(/\\/g, '/');
    if (fuera(ruta) || porRuta.has(ruta)) continue;
    const n = lineasDe(path.join(dir, ruta));
    porRuta.set(ruta, { ruta, estado: 'nuevo', mas: n ?? 0, menos: 0, binario: n == null, tipo: tipoDe(ruta), sinCommit: true });
  }
  const archivos = [...porRuta.values()].sort((x, y) => x.ruta.localeCompare(y.ruta));
  const cuenta = e => archivos.filter(f => f.estado === e).length;
  return {
    fuente: 'git', base: base.commit, baseCorta: base.commit.slice(0, 7), baseComo: base.como,
    nuevos: cuenta('nuevo'), modificados: cuenta('modificado'), borrados: cuenta('borrado'), renombrados: cuenta('renombrado'), sacados: cuenta('sacado'),
    lineasMas: archivos.reduce((s, f) => s + f.mas, 0), lineasMenos: archivos.filter(f => f.estado !== 'sacado').reduce((s, f) => s + f.menos, 0),
    binarios: archivos.filter(f => f.binario).length, archivos,
  };
}

// Sin git: lo que vieron las instantáneas de cada turno. Sin líneas, y dicho así.
function numerosInstantaneas(turnos) {
  const rutas = new Set();
  for (const t of turnos) for (const f of t.files || []) if (!fuera(f)) rutas.add(f);
  const archivos = [...rutas].sort().map(ruta => ({ ruta, estado: 'tocado', mas: null, menos: null, tipo: tipoDe(ruta) }));
  return { fuente: 'instantaneas', base: null, nuevos: null, modificados: null, borrados: null, tocados: archivos.length, lineasMas: null, lineasMenos: null, archivos };
}

// Casos de prueba definidos: test('…') en tests/*.test.js, ahora y en el commit base. Objetivo y sin ejecutar nada.
const TEST_RE = /(^|[^\w.])test\(\s*['"`]/gm;
function pruebasDefinidas(dir, base) {
  const contar = text => (String(text).match(TEST_RE) || []).length;
  let despues = null, antes = null;
  try {
    const tdir = path.join(dir, 'tests');
    despues = fs.readdirSync(tdir).filter(f => f.endsWith('.test.js')).reduce((s, f) => s + contar(fs.readFileSync(path.join(tdir, f), 'utf8')), 0);
  } catch {}
  if (base) {
    try {
      const lista = git(dir, ['ls-tree', '--name-only', `${base.commit}:tests`]).split(/\r?\n/).filter(f => f.endsWith('.test.js'));
      antes = lista.reduce((s, f) => s + contar(git(dir, ['show', `${base.commit}:tests/${f}`])), 0);
    } catch { antes = 0; }
  }
  return { antes, despues };
}

// ---------- El ciclo que se informa ----------
// El último ciclo de la misión: desde su «Comienza el ciclo» hasta su mensaje de fin (o hasta el final, si se cortó).
function ultimoCiclo(chat) {
  const msgs = chat.messages || [];
  const inicio = [...msgs].reverse().find(m => m.kind === 'system' && m.outcome === 'started');
  if (!inicio) return null;
  const desde = msgs.indexOf(inicio);
  const posteriores = msgs.slice(desde);
  const turnos = posteriores.filter(m => m.kind === 'agent' && m.cycle === inicio.cycle);
  const fin = posteriores.find(m => m.kind === 'system' && m.cycle === inicio.cycle && m.outcome && m.outcome !== 'started');
  const aceptado = posteriores.find(m => m.kind === 'system' && (m.userAccepted || m.outcome === 'aceptado'));
  const previos = msgs.slice(0, desde).filter(m => m.kind === 'system' && m.outcome === 'started').length;
  // El pedido es el último mensaje del usuario antes de empezar que no sea una directiva a mitad de ciclo.
  const anteriores = [...msgs.slice(0, desde + 1)].reverse().filter(m => m.kind === 'user');
  const pedidos = anteriores.filter(m => !m.intervention);
  const pedido = pedidos[0] || anteriores[0] || null;
  const directivas = posteriores.filter(m => m.kind === 'user');
  return { id: inicio.cycle, inicio, fin, aceptado, turnos, previos, pedido, pedidos, directivas, finTs: (fin || turnos[turnos.length - 1] || inicio).ts };
}

const CAUSAS = { unanime: 'aprobado', consenso: 'aprobado', meseta: 'meseta', retroceso: 'retroceso', agotado: 'agotado', 'sin-agentes': 'sin-agentes', error: 'error', detenido: 'detenido' };

function causaDe(ciclo, enCurso) {
  if (!ciclo) return 'sin-ciclo';
  if (enCurso) return 'en-curso';
  if (ciclo.aceptado) return 'aceptado';
  if (!ciclo.fin) return 'interrumpido';
  return CAUSAS[ciclo.fin.outcome] || 'agotado';
}

const SEMAFORO = { aprobado: 'verde', aceptado: 'ambar', meseta: 'ambar', agotado: 'ambar', detenido: 'ambar', interrumpido: 'ambar', 'en-curso': 'gris', 'sin-ciclo': 'gris', retroceso: 'rojo', error: 'rojo', 'sin-agentes': 'rojo' };

// Por agente: turnos, notas por ronda, si cayó (salió del ciclo) o lo cortaron a medias (siguió), tiempo y consumo.
// Un PARCIAL no es «fuera del ciclo»: el resumen de una línea lo decía mal (editorial continua, Gemini).
function porAgente(turnos, minScore) {
  const mapa = new Map();
  for (const t of turnos) {
    const a = mapa.get(t.agentId) || { id: t.agentId, nombre: t.agentName, rol: t.role, turnos: 0, segundos: 0, notas: {}, cortes: [], tokens: 0, costeUsd: null, cli: t.cli || null, modelo: null };
    a.turnos++;
    a.segundos += t.seconds || 0;
    if (typeof t.score === 'number' && !t.self) a.notas[t.round] = t.score;
    if (t.failure) a.cortes.push({ ronda: t.round, tipo: t.verdict === 'PARCIAL' ? 'cortado' : 'cayo', motivo: t.failure.label, kind: t.failure.kind, detalle: limpiar(t.failure.detail || '') });
    if (t.usage) {
      a.tokens += t.usage.totalTokens || (t.usage.inputTokens || 0) + (t.usage.outputTokens || 0);
      if (typeof t.usage.costUsd === 'number') a.costeUsd = Math.round(((a.costeUsd || 0) + t.usage.costUsd) * 100) / 100;
    }
    a.modelo = t.model || t.modelo || a.modelo;
    a.ultimo = { ronda: t.round, veredicto: t.verdict, nota: t.score ?? null, terminado: t.done ?? null };
    mapa.set(t.agentId, a);
  }
  for (const a of mapa.values()) {
    const ultimoTurno = turnos.filter(t => t.agentId === a.id).pop();
    a.fuera = ultimoTurno?.verdict === 'ERROR';
    a.aprueba = !a.fuera && (a.ultimo.veredicto === 'APROBADO' || (a.ultimo.terminado === true && a.ultimo.nota != null && a.ultimo.nota >= minScore));
    a.minutos = Math.round(a.segundos / 6) / 10;
  }
  return [...mapa.values()];
}

function rondasDe(turnos, agentes) {
  const n = Math.max(0, ...turnos.map(t => t.round || 0));
  const out = [];
  for (let r = 1; r <= n; r++) {
    const ts = turnos.filter(t => t.round === r);
    const esperado = agentes.filter(a => turnos.some(t => t.agentId === a.id && t.round <= r) && !(a.fuera && a.cortes.some(c => c.tipo === 'cayo' && c.ronda < r))).length;
    // media: la de la regla de meseta (null si la ronda no está completa). mediaParcial: la de quien sí puso nota,
    // para la mini gráfica de una ronda que cerró por consenso antes de que hablaran todos.
    const notas = ts.filter(t => !t.self && typeof t.score === 'number' && !CUT.has(t.verdict)).map(t => t.score);
    const mediaParcial = notas.length ? Math.round(notas.reduce((s, x) => s + x, 0) / notas.length * 100) / 100 : null;
    out.push({ ronda: r, turnos: ts.length, media: roundMean(turnos, r, esperado), mediaParcial, cortes: ts.filter(t => CUT.has(t.verdict)).length });
  }
  return out;
}

// ---------- El brief, punto por punto (RF5) ----------
const SIN_ACENTO = s => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const VACIAS = new Set('para como cada desde donde entre sobre todo toda todos todas este esta esto estos estas pero porque cuando tiene tienen debe deben puede pueden hace hacer solo unos unas otra otro bien algo sino sean with that this from have will when then also should which their there would about into'.split(' '));

// El brief al que apunta el pedido («Lee docs/BRIEF-X.md…»); si no, el de un pedido anterior de la misma misión
// (una «otra pasada» no repite la ruta); si ninguno apunta a uno, el texto del pedido mismo.
function briefDelPedido(dir, texto, anteriores = []) {
  for (const t of [texto, ...anteriores]) {
    const rutas = [...String(t || '').matchAll(/(?:^|[\s`(«"])((?:docs\/)?[\w.-]*BRIEF[\w.-]*\.md)/gi)].map(m => m[1]);
    for (const r of rutas) {
      const ruta = r.includes('/') ? r : `docs/${r}`;
      const file = path.join(dir, ruta);
      if (fs.existsSync(file)) return { ruta, texto: fs.readFileSync(file, 'utf8') };
    }
  }
  return { ruta: null, texto: String(texto || '') };
}

// Las viñetas de primer y segundo nivel y los ### de las secciones que piden algo; no «Reglas» ni el contexto.
// Puntos = los ### y las viñetas de primer nivel. Las sub-viñetas («el hook», «el copy por red») son el detalle de su
// punto: cuentan para buscarlo, no se listan una a una (con 40 sub-viñetas el contraste era ruido).
const SECCION_FUERA = /reglas|lo que pide|problema|contexto|referencias|fuera de alcance|ya existe|se reutiliza|casos reales|\brules\b|what it asks|problem|context|references|out of scope|already exists|reused|real cases/i;
function puntosDelBrief(texto) {
  const out = [];
  let fueraDeSeccion = false;
  const limpio = s => s.replace(/\*\*/g, '').replace(/`/g, '').replace(/[:;,.]\s*$/, '').trim();
  for (const line of String(texto || '').split(/\r?\n/)) {
    const h2 = line.match(/^##\s+(.*)/);
    if (h2) { fueraDeSeccion = SECCION_FUERA.test(h2[1]); continue; }
    if (fueraDeSeccion || /^\s*>/.test(line)) continue;
    const sub = line.match(/^ {2,}[-*]\s+(.*)/);
    if (sub && out.length) { out[out.length - 1].detalle.push(limpio(sub[1])); continue; }
    const m = line.match(/^###\s+(.*)/) || line.match(/^ ?[-*]\s+(.*)/);
    if (!m) continue;
    const t = limpio(m[1]);
    if (t.length < 6 || out.some(p => p.texto === t)) continue;
    out.push({ n: out.length + 1, texto: t.length > 160 ? t.slice(0, 157) + '…' : t, detalle: [] });
    if (out.length >= 60) break;
  }
  return out;
}

// Sin relator, el servidor solo sabe si alguien lo mencionó al traspasar: «○ sin confirmar» o «✖ nadie lo menciona».
// Un ✔ (hecho) o ◐ (parcial) lo pone el relator con evidencia (fusionarRelato). Ante la duda, «○»: un ✖ falso
// asusta al dueño y le hace pagar una ronda por algo hecho.
const raiz = w => w.replace(/(es|s)$/, '');
function contrastarBrief(puntos, corpus) {
  const cuerpo = new Set(clavesCortas(corpus).map(raiz));
  return puntos.map(({ detalle = [], ...p }) => {
    const propias = clavesCortas(p.texto).map(raiz);
    const todas = [...new Set([...propias, ...detalle.flatMap(d => clavesCortas(d).map(raiz))])];
    const vistas = k => k.filter(w => cuerpo.has(w)).length;
    const mencionado = propias.length < 2 || vistas(propias) >= Math.ceil(propias.length * 0.4) || vistas(todas) >= Math.ceil(todas.length * 0.4);
    return { ...p, estado: mencionado ? 'sin-confirmar' : 'falta', evidencia: [] };
  });
}
const clavesCortas = s => [...new Set(SIN_ACENTO(s).match(/[a-z0-9ñ]{4,}/g) || [])].filter(w => !VACIAS.has(w));

// ---------- Lo que dicen los traspasos (texto de los agentes, marcado como tal) ----------
// Una sección del traspaso por su clave (did, objections, next), con su nombre en cualquiera de los idiomas.
const SECCIONES = clave => i18n.LANGS.map(l => i18n.t(`handoff.sec.${clave}`, null, l).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
function seccion(texto, clave) {
  const re = new RegExp(`\\*\\*(?:${SECCIONES(clave)})[^*]*:\\*\\*([\\s\\S]*?)(?=\\n\\*\\*[^*\\n]+:\\*\\*|\\n## |$)`, 'i');
  const m = String(texto || '').match(re);
  if (!m) return [];
  const body = m[1].trim();
  const vinetas = body.split(/\r?\n/).filter(l => /^\s*[-*]\s+/.test(l)).map(l => l.replace(/^\s*[-*]\s+/, '').trim());
  return (vinetas.length ? vinetas : [body]).map(s => s.trim()).filter(s => s && !/^(ningun[ao]|none)\.?$/i.test(s));
}

const RUTA_RE = /`([^`\s]+\.[A-Za-z0-9]{1,5})`|\b((?:docs|lib|public|tests|src|scripts|contenido)\/[\w./-]+\.[A-Za-z0-9]{1,5})\b/g;
const rutasEn = (texto, dir) => [...new Set([...String(texto).matchAll(RUTA_RE)].map(m => (m[1] || m[2]).replace(/[),.;:]+$/, '')))]
  .filter(r => !fuera(r) && fs.existsSync(path.join(dir, r))).slice(0, 4);

const HUMANO = /\b(push|token|inici(a|ar) sesi[oó]n|login|log in|grab(a|ar)|gif|rama hu[eé]rfana|credencial|pega(r)? (el|la|tu)|manualmente|solo (lo )?puede(s)? hacer (el )?(humano|usuario)|el usuario (debe|tiene que|podr[aá])|t[uú] (debes|tienes)|decisi[oó]n del usuario|promover|promueve|manually|credentials?|sign in|the (user|owner) (must|has to|should)|you (must|have to)|owner'?s? decision|promote)\b/i;
const OPCIONAL = /\b(opcional|optional)/i;
// Lo que no es una tarea: negaciones («Nadie hace push», «Sin push») y el propio cierre del ciclo («Cerrar el ciclo»,
// «Turno final de Grok… emitir APROBADO»), que el informe ya resuelve.
const NO_ES_TAREA = /^\s*(nadie|sin|no|ninguna?|nobody|none|without)\b|cerrar el ciclo|turno final|emitir (su )?(veredicto|aprobado)|consolidar el consenso|veredicto de cierre|revisi[oó]n de cierre|\bse cierra\b|para cerrar|close the cycle|final turn|issue (its |the )?(verdict|approved)|closing (verdict|review)|^#\d+\s+(resuelta|retirada|de acuerdo|rechazada|resolved|withdrawn|agreed|rejected)\b/i;

function pendientesDe(ciclo, chat, agentes, dir, aprobado = false, textos = L.en) {
  const otraRonda = [], tu = [];
  // Cuatro agentes dicen lo mismo con otras palabras: se queda el primero (mitad o más de palabras en común).
  const vistos = [];
  const poner = (lista, item) => {
    const k = new Set(clavesCortas(item.texto.replace(/^#\d+\s*/, '')));
    if (vistos.some(v => { const comunes = [...k].filter(w => v.has(w)).length; return comunes >= Math.min(k.size, v.size) * 0.5 && comunes >= 2; })) return;
    vistos.push(k);
    lista.push(item);
  };
  for (const o of (chat.debate || []).filter(o => o.status === 'abierta' || o.status === 'disputada')) {
    poner(o.by === 'user' ? tu : otraRonda, { texto: limpiar(`#${o.id} ${o.text}`), de: o.by === 'user' ? textos.deTi : o.agentName || o.by, tipo: 'objecion' });
  }
  for (const a of agentes.filter(a => a.fuera)) {
    const c = a.cortes[a.cortes.length - 1];
    poner(tu, { texto: textos.cayoPendiente(a.nombre, motivoLlano(c, textos), c.detalle || textos.revisaReporte).slice(0, 220), de: 'servidor', tipo: 'caida' });
  }
  // Solo los traspasos de la última ronda de cada agente: lo que se dijo antes puede estar ya hecho.
  const ultimos = new Map();
  for (const t of ciclo.turnos) if (t.handoffText) ultimos.set(t.agentId, t);
  for (const t of ultimos.values()) {
    for (const s of [...seccion(t.handoffText, 'next'), ...seccion(t.handoffText, 'objections')]) {
      for (const frase of s.split(/(?<=[.!?])\s+(?=[A-ZÁÉÍÓÚÑ¿])/)) {
        if (frase.length < 12 || NO_ES_TAREA.test(frase)) continue;
        const item = { texto: limpiar(frase).slice(0, 240), de: t.agentName, tipo: OPCIONAL.test(frase) ? 'opcional' : 'traspaso', evidencia: rutasEn(frase, dir) };
        // Aprobado por todos: el «siguiente paso» de cada uno era revisar o cerrar, y eso ya pasó. Quedan lo opcional y lo tuyo.
        if (aprobado && item.tipo !== 'opcional' && !HUMANO.test(frase)) continue;
        poner(HUMANO.test(frase) ? tu : otraRonda, item);
      }
    }
  }
  // Lo opcional que quedó sin hacer suele estar en «Decisiones» («`edit_log` y `stats` permanecen opcionales»).
  for (const t of ultimos.values()) {
    for (const frase of String(t.handoffText).split(/\r?\n|(?<=[.!?])\s+(?=[A-ZÁÉÍÓÚÑ¿`])/)) {
      const f = frase.replace(/^\s*[-*]\s+/, '').trim();
      if (OPCIONAL.test(f) && /sin hacer|pendiente|permanece|sigue|quedan?|quedó|no bloquea|para despu[eé]s|not done|pending|remains?|still|left for later|non-blocking|does not block/i.test(f) && !/^\s*(nadie|ning|nobody|none)/i.test(f)) {
        poner(otraRonda, { texto: limpiar(f).slice(0, 240), de: t.agentName, tipo: 'opcional', evidencia: rutasEn(f, dir) });
      }
    }
  }
  return { otraRonda: otraRonda.slice(0, 15), tu: tu.slice(0, 15) };
}

// Logros: el «Qué hice» de los turnos que cambiaron trabajo. Las rondas de pura verificación («sin cambios»,
// «145/145») no son funciones nuevas: van a «Qué se ejecutó».
const VERIFICACION = /^(sin cambios|no (cambi|toqu)|revalid|auditor[ií]a|verificaci[oó]n de cierre|ejecutad[oa] |`?npm test|suite\b|actualic[eé] `?(handoff|memoria)|no changes|(did not|didn't) (change|touch)|audit|closing (check|verification)|ran |updated `?(handoff|memoria|memory))/i;
function logrosDe(ciclo, dir) {
  const out = [];
  const ya = new Set();
  for (const t of ciclo.turnos) {
    if (Array.isArray(t.workFiles) && !t.workFiles.length) continue;
    for (const s of seccion(t.handoffText, 'did')) {
      const k = SIN_ACENTO(s).replace(/[^a-z0-9]+/g, ' ').slice(0, 70);
      if (ya.has(k) || s.length < 8 || VERIFICACION.test(s.replace(/^\*+/, '').trim())) continue;
      ya.add(k);
      out.push({ texto: limpiar(s).slice(0, 260), de: t.agentName, ronda: t.round, evidencia: rutasEn(s, dir), fuente: 'traspaso' });
    }
  }
  return out.slice(-20);
}

// Pruebas que dijeron haber corrido («159/159», «suite 144/145»): las dice el agente, no el servidor.
const PRUEBA_RE = /(?:npm test|suite|pruebas?|tests?)[^\n\d]{0,40}?\*{0,2}(\d{1,4})\s*\/\s*(\d{1,4})\*{0,2}(?:\s*(?:en|in)\s*([\d.,]+)\s*s)?/gi;
function ejecutadoDe(ciclo, numeros) {
  const pruebas = [];
  for (const t of ciclo.turnos) {
    const m = [...String(t.text || '').matchAll(PRUEBA_RE)].pop();
    if (m && Number(m[2]) >= Number(m[1])) pruebas.push({ de: t.agentName, ronda: t.round, pasan: Number(m[1]), total: Number(m[2]), segundos: m[3] ? Number(m[3].replace(',', '.')) : null, declarado: true });
  }
  const puertos = new Set();
  for (const t of ciclo.turnos) for (const m of String(t.text || '').matchAll(/(?:puerto|port|localhost:|127\.0\.0\.1:)\s*(\d{4,5})\b/gi)) puertos.add(Number(m[1]));
  const capturas = numeros.archivos.filter(f => f.tipo === 'imagen' && !['borrado', 'sacado'].includes(f.estado) && /evidencia|captura|screenshot/i.test(f.ruta)).map(f => f.ruta);
  const herramientas = {};
  for (const t of ciclo.turnos) for (const [k, v] of Object.entries(t.toolCounts || {})) herramientas[k] = (herramientas[k] || 0) + v;
  return { pruebas, puertos: [...puertos].sort(), capturas, herramientas };
}

function riesgosDe({ agentes, numeros, causa, ejecutado, minScore, chat, t, idioma }) {
  const out = [];
  const notaTxt = n => (idioma === 'en' ? String(n) : String(n).replace('.', ','));
  for (const a of agentes.filter(a => !a.fuera && a.ultimo.nota != null && a.ultimo.nota < minScore)) {
    out.push({ texto: t.riesgoNota(a.nombre, notaTxt(a.ultimo.nota), minScore), de: 'servidor' });
  }
  const todasAbiertas = (chat.debate || []).filter(o => o.status === 'abierta' || o.status === 'disputada');
  const abiertasProducto = todasAbiertas.filter(o => !isEnvironmentBlock(o)).length;
  if (abiertasProducto) out.push({ texto: t.riesgoObjeciones(abiertasProducto), de: 'servidor' });
  const bloqueosEntorno = todasAbiertas.filter(isEnvironmentBlock);
  for (const b of bloqueosEntorno) {
    out.push({ texto: t.riesgoEntorno(b.agentName || b.by || t.unAgente, limpiar(b.text)), de: 'servidor' });
  }
  if (numeros.borrados) out.push({ texto: t.riesgoBorrados(numeros.borrados), de: 'servidor' });
  if (numeros.sacados) out.push({ texto: t.riesgoSacados(numeros.sacados), de: 'servidor' });
  // La última serie que vio cada agente: lo de rondas anteriores puede estar ya arreglado.
  const ultimaDe = new Map();
  for (const p of ejecutado.pruebas) ultimaDe.set(p.de, p);
  const rojas = [...ultimaDe.values()].filter(p => p.pasan < p.total);
  if (!ejecutado.pruebas.length) out.push({ texto: t.riesgoSinPruebas, de: 'servidor' });
  else if (rojas.length) {
    const verdes = [...ultimaDe.values()].filter(p => p.pasan === p.total).map(p => p.de);
    out.push({ texto: t.riesgoRojas(rojas.map(p => t.vioPrueba(p.de, p.pasan, p.total)).join(', '), verdes.join(', ')), de: 'servidor' });
  }
  if (['interrumpido', 'error', 'detenido'].includes(causa)) out.push({ texto: t.riesgoMedias, de: 'servidor' });
  return out;
}

// ---------- Opciones: botones con la petición exacta que mandan (RF6) ----------
function opcionesDe({ chatId, causa, agentes, ciclo, pendientes, minutosCiclo, numeros, idioma }) {
  const t = L[idioma] || L.en;
  const equipo = agentes.filter(a => !a.fuera).length || agentes.length || 1;
  const porTurno = ciclo && ciclo.turnos.length ? minutosCiclo / ciclo.turnos.length : 10;
  const rondas = causa === 'aprobado' ? 1 : 2;
  const pend = [...pendientes.otraRonda].filter(p => p.tipo !== 'opcional').map(p => `- ${p.texto}`);
  const directiva = pend.length
    ? `${t.directivaPendiente}\n${pend.slice(0, 10).join('\n')}`
    : t.directivaOtra;
  const ruta = s => `/api/chats/${encodeURIComponent(chatId)}${s}`;
  const coste = n => t.coste(n * equipo, Math.round(n * equipo * porTurno));
  const sinAprobar = ['meseta', 'retroceso', 'agotado', 'detenido', 'tiempo', 'sin-agentes'].includes(causa);
  return [
    causa === 'interrumpido'
      ? { id: 'reanudar', etiqueta: t.reanudar, explica: t.explicaReanudar, coste: coste(1), metodo: 'POST', ruta: ruta('/messages'), cuerpo: { resume: true } }
      : { id: 'seguir', etiqueta: sinAprobar ? t.continuar : t.seguirN(rondas), explica: sinAprobar ? t.explicaContinuar : t.explicaSeguir, coste: coste(rondas), metodo: 'POST', ruta: ruta('/messages'), cuerpo: { text: directiva, config: { mode: 'auto', maxRounds: rondas } }, editable: 'text' },
    { id: 'cambios', etiqueta: t.pedirCambios, explica: t.explicaCambios, coste: coste(1), metodo: 'POST', ruta: ruta('/messages'), cuerpo: { text: '', config: { mode: 'auto', maxRounds: 1 } }, editable: 'text' },
    sinAprobar
      ? { id: 'aceptar', etiqueta: t.aceptar, explica: t.explicaAceptar, coste: t.ceroTurnos, metodo: 'POST', ruta: ruta('/accept'), cuerpo: {} }
      : { id: 'aceptar', etiqueta: t.aceptar, explica: causa === 'aprobado' ? t.explicaAceptarYa : t.explicaAceptarNo, coste: t.ceroTurnos, disponible: false },
    { id: 'promover', etiqueta: t.promover, explica: t.explicaPromover, coste: t.ceroTurnos, guia: guiaPromover(numeros, t) },
    { id: 'diff', etiqueta: t.verDiff, explica: t.explicaDiff, coste: t.ceroTurnos, metodo: 'POST', ruta: ruta('/open'), cuerpo: {} },
    { id: 'exportar', etiqueta: t.exportar, explica: t.explicaExportar, coste: t.ceroTurnos, metodo: 'GET', ruta: ruta('/cierre?format=md') },
  ];
}

function guiaPromover(numeros, t) {
  if (numeros.fuente !== 'git') return { pasos: [t.guiaSinGit], comandos: [] };
  return {
    pasos: t.guiaPasos,
    comandos: [
      `git diff --stat ${numeros.baseCorta}`,
      `git add -A && git diff --cached --binary ${numeros.baseCorta} > cierre.patch`,
      `git -C "${t.guiaCarpeta}" apply --3way cierre.patch`,
      'npm test',
    ],
  };
}

// ---------- Ensamblado ----------
function veredictoDe(causa, agentes, ciclo, abiertas, t) {
  const n = agentes.length;
  const aprueban = agentes.filter(a => a.aprueba).length;
  const faltan = agentes.filter(a => !a.aprueba).map(a => {
    const detalle = a.fuera ? t.detalleCayo : (a.ultimo.nota != null ? t.detalleNota(a.ultimo.nota) : t.detalleSinNota);
    return `${a.nombre} (${detalle})`;
  });
  let frase;
  if (causa === 'aprobado') frase = ciclo.fin.outcome === 'unanime' ? t.impecable : t.aprobado;
  else if (['meseta', 'agotado'].includes(causa) && aprueban && aprueban < n) frase = `${t.casi(aprueban, n, faltan.join(', '))}. ${causa === 'meseta' ? t.meseta : t.agotado}.`;
  else frase = { meseta: t.meseta, retroceso: t.retroceso, agotado: t.agotado, aceptado: t.aceptado, detenido: t.detenido, interrumpido: t.interrumpido, error: t.error, 'sin-agentes': t.sinAgentes, 'en-curso': t.enCurso, 'sin-ciclo': t.sinCiclo }[causa] || t.agotado;
  if (abiertas && causa !== 'aprobado') frase += ` · ${t.objecionesAbiertas(abiertas)}`;
  return { frase, aprueban, total: n, faltan };
}

function construirCierre({ chat, dir, enCurso = false, ahora = new Date(), conGit = true } = {}) {
  const ciclo = ultimoCiclo(chat);
  const causa = causaDe(ciclo, enCurso);
  const minScore = chat.config?.minScore || 9;
  const turnos = ciclo?.turnos || [];
  const agentes = porAgente(turnos, minScore);
  const idioma = idiomaDe(ciclo?.pedido?.text || chat.title);
  const t = L[idioma];
  const abiertas = (chat.debate || []).filter(o => o.status === 'abierta' || o.status === 'disputada').length;

  let numeros;
  const base = conGit ? commitBase(dir, chat) : null;
  try { numeros = base ? numerosGit(dir, base) : numerosInstantaneas(turnos); } catch { numeros = numerosInstantaneas(turnos); }
  const pruebasDef = pruebasDefinidas(dir, base);

  const inicioMs = ciclo?.id || Date.parse(chat.created) || 0;
  const finMs = Date.parse(ciclo?.finTs || '') || inicioMs;
  const minutosCiclo = Math.max(0, Math.round((finMs - inicioMs) / 60000));
  const brief = briefDelPedido(dir, ciclo?.pedido?.text || '', (ciclo?.pedidos || []).slice(1).map(m => m.text));
  const corpus = [...turnos.map(x => `${x.text || ''}\n${x.handoffText || ''}`), ...numeros.archivos.map(f => f.ruta.replace(/[/._-]/g, ' '))].join('\n');
  const puntos = contrastarBrief(puntosDelBrief(brief.texto), corpus);
  const pendientes = ciclo ? pendientesDe(ciclo, chat, agentes, dir, causa === 'aprobado', t) : { otraRonda: [], tu: [] };
  for (const p of puntos.filter(p => p.estado === 'falta')) pendientes.otraRonda.push({ texto: `${t.delPedidoNadie}: ${p.texto}`, de: 'servidor', tipo: 'brief' });
  const ejecutado = ciclo ? ejecutadoDe(ciclo, numeros) : { pruebas: [], puertos: [], capturas: [], herramientas: {} };

  const todasObjeciones = (chat.debate || []).filter(o => o.status === 'abierta' || o.status === 'disputada').map(o => ({
    id: o.id,
    texto: limpiar(o.text),
    de: o.agentName || o.by,
    estado: o.status,
    tipo: isEnvironmentBlock(o) ? 'entorno' : 'producto',
  }));

  // Detalles por modo (RF8): Delphi, Consejo y Editorial
  let modoDetalle = chat.modoDetalle || null;
  if (!modoDetalle && dir) {
    const wf = chat.config?.workflow;
    if (wf === 'delphi' || wf === 'consejo') {
      const finalDir = path.join(dir, 'final');
      const tieneFinal = fs.existsSync(finalDir) && fs.readdirSync(finalDir).length > 0;
      modoDetalle = {
        modo: wf,
        borrador: tieneFinal ? 'final' : null,
        autor: chat.config?.chair || (wf === 'consejo' ? t.presidente : t.equipo),
      };
    } else if (chat.editorial) {
      modoDetalle = {
        modo: 'editorial',
        tipo: chat.editorial.tipo,
        franja: chat.editorial.franja || null,
        creadas: chat.editorialResultado?.creadas ?? 0,
        descartadas: chat.editorialResultado?.descartadas ?? 0,
        temas: chat.editorialResultado?.temas || [],
      };
    }
  }

  const enMision = dir ? /(?:^|[\\/])(proyectos|misiones|om-proyectos)/i.test(dir) : false;
  const aplicado = Boolean(chat.aplicado || (!enMision && dir));

  const cierre = {
    version: VERSION, generado: ahora.toISOString(), autor: chat.editorial ? 'plantilla' : 'plantilla', idioma,
    mision: { id: chat.id, titulo: limpiar(chat.title), modo: chat.config?.workflow || 'relevo', ciclo: chat.config?.mode || 'rondas', minScore, ciclosPrevios: ciclo?.previos || 0 },
    causa, semaforo: SEMAFORO[causa] || 'gris',
    veredicto: ciclo ? veredictoDe(causa, agentes, ciclo, abiertas, t) : { frase: t.sinCiclo, aprueban: 0, total: 0, faltan: [] },
    resumenServidor: limpiar(ciclo?.fin?.text || ''),
    logros: ciclo ? logrosDe(ciclo, dir) : [],
    noLogrado: {
      objeciones: todasObjeciones.filter(o => o.tipo !== 'entorno'),
      bloqueosEntorno: todasObjeciones.filter(o => o.tipo === 'entorno'),
      caidas: agentes.flatMap(a => a.cortes.map(c => ({ agente: a.nombre, ...c, siguio: c.tipo === 'cortado' || !a.fuera }))),
      brief: puntos.filter(p => p.estado === 'falta'),
    },
    brief: { ruta: brief.ruta, puntos },
    numeros: {
      ...numeros,
      archivos: numeros.archivos.slice(0, 300),
      pruebasDefinidas: pruebasDef,
      minutos: minutosCiclo, turnos: turnos.length, rondas: Math.max(0, ...turnos.map(x => x.round || 0)),
      agentes: agentes.map(({ cortes, ...a }) => ({ ...a, cortes: cortes.length })),
      porRonda: rondasDe(turnos, agentes),
      tokens: agentes.reduce((s, a) => s + a.tokens, 0),
      costeUsd: agentes.some(a => a.costeUsd != null) ? Math.round(agentes.reduce((s, a) => s + (a.costeUsd || 0), 0) * 100) / 100 : null,
    },
    ejecutado,
    pendientes,
    riesgos: riesgosDe({ agentes, numeros, causa, ejecutado, minScore, chat, t, idioma }),
    opciones: opcionesDe({ chatId: chat.id, causa, agentes, ciclo, pendientes, minutosCiclo, numeros, idioma }),
    relato: null,
    modoDetalle,
    aplicado,
  };
  return sinSecretos(cierre);
}

// Última red: todo el informe pasa por limpiar, también lo que venga de un campo que nadie pensó en limpiar.
const sinSecretos = obj => JSON.parse(limpiar(JSON.stringify(obj)));

// ---------- Relator (RF2): lo subjetivo, validado contra el disco ----------
// relato = { frase?, logros?: [{ texto, evidencia: [rutas] }], brief?: [{ n, estado: 'hecho'|'parcial'|'falta', evidencia }],
//            riesgos?: [texto], tu?: [texto], otraRonda?: [texto] }
function fusionarRelato(cierre, relato, { dir, autor } = {}) {
  if (!relato || typeof relato !== 'object') return cierre;
  const existe = r => typeof r === 'string' && !fuera(r) && !r.includes('..') && fs.existsSync(path.join(dir, r));
  const evid = e => (Array.isArray(e) ? e : []).filter(existe).slice(0, 4);
  const txt = s => limpiar(String(s || '').trim()).slice(0, 300);
  const out = { ...cierre, autor: 'plantilla+relator', relato: { autor: autor || null, frase: relato.frase ? txt(relato.frase).slice(0, 160) : null } };
  if (Array.isArray(relato.logros) && relato.logros.length) {
    out.logros = relato.logros.slice(0, 12).map(l => ({ texto: txt(l.texto || l), evidencia: evid(l.evidencia), fuente: 'relator' })).filter(l => l.texto);
  }
  if (Array.isArray(relato.brief)) {
    out.brief = {
      ...cierre.brief,
      puntos: cierre.brief.puntos.map(p => {
        const r = relato.brief.find(x => Number(x.n) === p.n);
        if (!r || !['hecho', 'parcial', 'falta'].includes(r.estado)) return p;
        const e = evid(r.evidencia);
        // Un ✔ sin evidencia en disco baja a ◐: el relator no puede dar por hecho lo que no se ve.
        const estado = r.estado === 'hecho' && !e.length ? 'parcial' : r.estado;
        return { ...p, estado, evidencia: e, nota: r.nota ? txt(r.nota) : undefined };
      }),
    };
    out.noLogrado = { ...cierre.noLogrado, brief: out.brief.puntos.filter(p => p.estado === 'falta' || p.estado === 'parcial') };
  }
  const extra = (lista, k) => (Array.isArray(relato[k]) ? relato[k].map(txt).filter(Boolean).map(texto => ({ texto, de: 'relator' })) : []);
  out.riesgos = [...cierre.riesgos, ...extra(relato, 'riesgos')].slice(0, 15);
  out.pendientes = { tu: [...cierre.pendientes.tu, ...extra(relato, 'tu')], otraRonda: [...cierre.pendientes.otraRonda, ...extra(relato, 'otraRonda')] };
  return sinSecretos(out);
}

// El relato guardado en el chat se vuelve a aplicar en cada regeneración, solo si es del último ciclo y este ya cerró.
function conRelato(cierre, chat, dir) {
  const r = chat?.relato;
  if (!r || ['en-curso', 'sin-ciclo'].includes(cierre.causa)) return cierre;
  if ((ultimoCiclo(chat)?.id ?? null) !== r.ciclo) return cierre;
  if (!r.datos) {
    const t = L[cierre.idioma] || L.en;
    return { ...cierre, relatoFallo: t.relatorFallo(r.autor || '', t.relatorMotivo[r.fallo] || t.relatorMotivo.cayo) };
  }
  // Tras «Aceptar así» manda la frase del servidor («Aceptado por ti…»), no la que el relator escribió antes.
  const datos = cierre.causa === 'aceptado' ? { ...r.datos, frase: null } : r.datos;
  return fusionarRelato(cierre, datos, { dir, autor: r.autor });
}

// Quién relata (RF2): el presidente en Consejo; si no, el de mejor nota final que siga en el ciclo (empate: el que
// aprueba, luego el último en hablar). Solo agentes con CLI que sigan en el equipo: un bot por webhook no lee el disco.
// En la Editorial no hay relator, y tampoco si lo detuvo el usuario o no hubo ciclo.
function elegirRelator(cierre, equipo = [], { presidente = null } = {}) {
  if (!cierre || cierre.autor !== 'plantilla') return null;
  if (cierre.modoDetalle?.modo === 'editorial' || ['detenido', 'sin-ciclo', 'en-curso'].includes(cierre.causa)) return null;
  const aptos = equipo.filter(a => a && !a.bot);
  if (presidente) {
    const p = aptos.find(a => a.id === presidente);
    if (p) return p;
  }
  const candidatos = (cierre.numeros?.agentes || [])
    .map((a, i) => ({ a, i, agente: aptos.find(x => x.id === a.id) }))
    .filter(x => x.agente && !x.a.fuera && typeof x.a.ultimo?.nota === 'number');
  candidatos.sort((x, y) => (y.a.ultimo.nota - x.a.ultimo.nota) || (Number(y.a.aprueba) - Number(x.a.aprueba)) || (y.i - x.i));
  return candidatos[0]?.agente || null;
}

// El encargo del relator: solo leer y devolver JSON. Los números no se le piden: no los puede tocar.
// Va en el idioma del informe (el del pedido); los nombres de los campos del JSON no se traducen.
function briefRelator(cierre, { minutos = 3 } = {}) {
  const lang = i18n.LANGS.includes(cierre.idioma) ? cierre.idioma : i18n.DEFAULT;
  const tr = (k, v) => i18n.t(`cierre.relator.${k}`, v, lang);
  const datos = {
    mision: cierre.mision?.titulo, veredicto: cierre.veredicto?.frase, causa: cierre.causa,
    logrosSegunTraspasos: (cierre.logros || []).map(l => l.texto).slice(0, 12),
    brief: (cierre.brief?.puntos || []).map(p => ({ n: p.n, texto: p.texto, estadoServidor: p.estado })),
    objecionesAbiertas: (cierre.noLogrado?.objeciones || []).map(o => `#${o.id} (${o.de}): ${o.texto}`),
    archivosCambiados: (cierre.numeros?.archivos || []).map(f => f.ruta).slice(0, 80),
  };
  return [
    `# ${tr('title')}`,
    '',
    tr('intro'),
    '',
    tr('rules'),
    `1. ${tr('rule1')}`,
    `2. ${tr('rule2')}`,
    `3. ${tr('rule3')}`,
    `4. ${tr('rule4', { min: minutos })}`,
    '',
    tr('answer'),
    '```json',
    `{"frase": "${tr('fieldFrase')}",`,
    ` "logros": [{"texto": "${tr('fieldLogro')}", "evidencia": ["${tr('fieldPath')}"]}],`,
    ` "brief": [{"n": 1, "estado": "hecho|parcial|falta", "evidencia": ["${tr('fieldPath')}"], "nota": "${tr('fieldNota')}"}],`,
    ` "riesgos": ["${tr('fieldRiesgo')}"], "tu": ["${tr('fieldTu')}"], "otraRonda": ["${tr('fieldOtraRonda')}"]}`,
    '```',
    '',
    `## ${tr('known')}`,
    '```json',
    JSON.stringify(datos, null, 2),
    '```',
    '',
  ].join('\n');
}

// El JSON del relator: el último bloque ```json, o el último objeto {...} del texto. null si no hay uno válido.
function leerRelato(texto) {
  const s = String(texto || '');
  const bloques = [...s.matchAll(/```json\s*([\s\S]*?)```/gi)].map(m => m[1]);
  const i = s.indexOf('{'), j = s.lastIndexOf('}');
  if (i !== -1 && j > i) bloques.push(s.slice(i, j + 1));
  for (const b of bloques.reverse()) {
    try {
      const o = JSON.parse(b);
      if (o && typeof o === 'object' && !Array.isArray(o) && ['frase', 'logros', 'brief', 'riesgos', 'tu', 'otraRonda'].some(k => k in o)) return o;
    } catch { /* el siguiente */ }
  }
  return null;
}

// ---------- Markdown (CIERRE.md y Exportar) ----------
const MARCA = { hecho: '✔', parcial: '◐', falta: '✖', 'sin-confirmar': '○' };
const LUZ = { verde: '🟢', ambar: '🟡', rojo: '🔴', gris: '⚪' };

function motivoLlano(corte, t) {
  if (corte?.kind && t?.motivos?.[corte.kind]) return t.motivos[corte.kind];
  return String(corte?.motivo || '').toLowerCase();
}

function aMarkdown(c) {
  const t = L[c.idioma] || L.en;
  const n = c.numeros;
  const lineas = [];
  const add = (...xs) => lineas.push(...xs);
  const firma = de => (de ? ` _(${de === 'servidor' ? t.laAplicacion : de})_` : '');
  const ev = e => (e?.length ? ` — ${e.map(r => `[${r}](${r})`).join(', ')}` : '');
  const punto = n => (c.idioma === 'en' ? String(n) : String(n).replace('.', ','));
  const quien = c.autor === 'plantilla' ? t.quienAuto : t.quienRelator(c.relato?.autor || t.revisor);
  const cuando = c.generado.slice(0, 16).replace('T', ' ');
  add(`# ${t.titulo}: ${c.mision.titulo}`, '', `${LUZ[c.semaforo]} **${c.relato?.frase || c.veredicto.frase}**`, '');
  add(`_${t.generadoLinea(cuando, quien)}._${c.relatoFallo ? ` _${c.relatoFallo}_` : ''}`, '');
  if (c.resumenServidor) add(`> ${c.resumenServidor}`, '');

  add(`## ${t.logros}`, '');
  if (c.logros.length) for (const l of c.logros) add(`- ${l.texto}${firma(l.de)}${ev(l.evidencia)}`);
  else add(t.nadieEscribio);
  add('');

  if (c.brief.puntos.length) {
    add(`## ${t.brief}${c.brief.ruta ? ` (${c.brief.ruta})` : ''}`, '', t.leyendaBrief, '');
    for (const p of c.brief.puntos) add(`- ${MARCA[p.estado]} ${p.texto}${ev(p.evidencia)}`);
    add('');
  }

  add(`## ${t.noLogrado}`, '');
  const nl = c.noLogrado;
  if (!nl.objeciones.length && !nl.caidas.length && !nl.brief.length && !(nl.bloqueosEntorno && nl.bloqueosEntorno.length)) add(t.nadaPendienteMd);
  for (const o of nl.objeciones) add(t.objecionMd(o.id, t.ui.estadoObj[o.estado] || o.estado, o.de, o.texto));
  if (nl.bloqueosEntorno?.length) {
    for (const b of nl.bloqueosEntorno) add(t.limiteMd(b.de, b.id, b.texto));
  }
  for (const x of nl.caidas) add(t.caidaMd(x.agente, x.ronda, x.tipo, motivoLlano(x, t), x.siguio));
  for (const p of nl.brief) add(`- ${MARCA[p.estado]} ${t.delPedidoMd}: ${p.texto}`);
  add('');

  if (c.modoDetalle) {
    if (c.modoDetalle.modo === 'editorial') {
      add(`## ${t.editorialTitulo}`, '');
      add(t.editorialListas(c.modoDetalle.creadas ?? 0, c.modoDetalle.descartadas ?? 0));
      if (c.modoDetalle.temas?.length) add(t.editorialTemas(c.modoDetalle.temas.join(', ')));
      add('');
    } else if (c.modoDetalle.borrador) {
      add(`## ${t.modoTitulo(c.modoDetalle.modo.toUpperCase())}`, '');
      add(t.borradorMd(c.modoDetalle.borrador, c.modoDetalle.autor || t.equipo));
      add('');
    }
  }

  add(`## ${t.despliegue}`, '');
  add(c.aplicado ? t.yaEnApp : t.noEnApp);
  add('');

  add(`## ${t.numeros}`, '');
  if (n.fuente === 'git') {
    add(t.archivosGit(n.nuevos, n.modificados, n.borrados, n.renombrados ? t.conOtroNombre(n.renombrados) : ''));
    if (n.sacados) add(t.sacadosMd(n.sacados));
    add(t.lineasMd(n.lineasMas, n.lineasMenos, n.binarios ? t.binariosMd(n.binarios) : ''));
  } else add(t.sinHistorialMd(n.tocados));
  if (n.pruebasDefinidas.despues != null) add(t.pruebasDefMd(n.pruebasDefinidas.antes ?? '?', n.pruebasDefinidas.despues));
  add(t.tiempoMd(n.minutos, n.turnos, n.rondas, c.mision.ciclosPrevios ? t.ciclosPrevios(c.mision.ciclosPrevios) : ''));
  const media = r => (r.media != null ? punto(r.media) : r.mediaParcial != null ? `${punto(r.mediaParcial)}*` : '—');
  const serie = n.porRonda.map(r => `R${r.ronda} ${media(r)}`).join(' → ') || '—';
  add(`${t.mediaIntro(serie)}${n.porRonda.some(r => r.media == null && r.mediaParcial != null) ? t.mediaIncompleta : ''}`, '');
  add(t.tablaCabecera, t.tablaSep);
  const locale = c.idioma === 'en' ? 'en' : 'es';
  for (const a of n.agentes) {
    const final = a.aprueba ? t.apruebaPalabra : t.veredictoPalabra(a.ultimo.veredicto);
    add(`| ${a.nombre}${a.fuera ? t.cayoMarca : ''} | ${a.turnos} | ${punto(a.minutos)} | ${Object.entries(a.notas).map(([r, s]) => `R${r} ${punto(s)}`).join(' · ') || '—'} | ${final} | ${a.tokens.toLocaleString(locale)} | ${a.costeUsd != null ? `$${punto(a.costeUsd)}` : '—'} |`);
  }
  add('');
  if (n.archivos.length) {
    add(`<details><summary>${t.archivosResumen}</summary>`, '');
    for (const f of n.archivos) add(`- ${t.ui.archivo[f.estado] || f.estado} \`${f.ruta}\`${f.mas != null ? ` +${f.mas} −${f.menos}` : ''}${f.binario ? t.binarioMarca : ''}`);
    add('', '</details>', '');
  }

  add(`## ${t.ejecutado}`, '');
  const e = c.ejecutado;
  for (const p of e.pruebas) add(t.pruebaMd(p.de, p.ronda, p.pasan, p.total, p.segundos ? t.enSegundos(punto(p.segundos)) : ''));
  if (!e.pruebas.length) add(t.sinPruebasMd);
  if (e.puertos.length) add(t.puertosMd(e.puertos.map(p => t.puerto(p)).join(', ')));
  for (const r of e.capturas) add(t.capturaMd(path.basename(r), r));
  add('');

  add(`## ${t.pendientes}`, '', `### ${t.otraRonda}`, '');
  if (!c.pendientes.otraRonda.length) add(t.nadaMd);
  for (const p of c.pendientes.otraRonda) add(`- ${p.tipo === 'opcional' ? t.opcionalMarca : ''}${p.texto}${firma(p.de)}`);
  add('', `### ${t.tu}`, '');
  if (!c.pendientes.tu.length) add(t.nadaMd);
  for (const p of c.pendientes.tu) add(`- ${p.texto}${firma(p.de)}`);
  add('', `## ${t.riesgos}`, '');
  if (!c.riesgos.length) add(t.ningunRiesgo);
  for (const r of c.riesgos) add(`- ${r.texto}`);
  add('', `## ${t.opciones}`, '');
  for (const o of c.opciones) {
    add(`- **${o.etiqueta}** — ${o.explica} _${t.costePalabra}: ${o.coste}._${o.disponible === false ? ` (${t.noDisponible})` : ''}`);
    if (o.guia) for (const cmd of o.guia.comandos) add(`  - \`${cmd}\``);
  }
  return limpiar(lineas.join('\n')) + '\n';
}

function mensajeRondaCierre({ idioma, ronda, objeciones = [], puntos = [] } = {}) {
  const t = L[idioma] || L.en;
  const lineas = [...objeciones.map(o => t.objecionCierre(o)), ...puntos.map(p => t.puntoCierre(p))];
  if (!lineas.length) return null;
  return t.rondaCierre(ronda, lineas.map((d, i) => `${i + 1}. ${d}`).join('\n'));
}

function guardar(dir, cierre) {
  const office = path.join(dir, '.office');
  fs.mkdirSync(office, { recursive: true });
  const json = path.join(office, 'cierre.json');
  fs.writeFileSync(json + '.tmp', JSON.stringify(cierre, null, 2));
  fs.renameSync(json + '.tmp', json);
  fs.writeFileSync(path.join(office, 'CIERRE.md'), aMarkdown(cierre));
  return cierre;
}

function leer(dir) {
  try { return JSON.parse(fs.readFileSync(path.join(dir, '.office', 'cierre.json'), 'utf8')); } catch { return null; }
}

// Para la lista de misiones: solo el semáforo y la frase.
const resumenDe = c => ({ semaforo: c.semaforo, frase: c.relato?.frase || c.veredicto.frase, causa: c.causa, generado: c.generado, idioma: c.idioma || i18n.DEFAULT });
function resumen(dir) {
  const c = leer(dir);
  return c ? resumenDe(c) : null;
}

// HEAD al empezar la primera vez: así los números no dependen de commits que hagan los agentes.
function registrarBase(dir, chat) {
  if (chat.base || !repoPropio(dir)) return null;
  try { return { commit: git(dir, ['rev-parse', 'HEAD']).trim(), en: new Date().toISOString() }; } catch { return null; }
}

module.exports = {
  construirCierre, fusionarRelato, conRelato, elegirRelator, briefRelator, leerRelato, mensajeRondaCierre, textos: L, aMarkdown, guardar, leer, resumen, resumenDe, registrarBase,
  commitBase, numerosGit, puntosDelBrief, contrastarBrief, briefDelPedido, ultimoCiclo, limpiar, idiomaDe, lineasDe, SEMAFORO,
};
