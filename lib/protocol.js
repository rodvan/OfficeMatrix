// Lectura del reporte final de cada agente: nota, veredicto, "terminado" (modo automático),
// objeciones nuevas y respuestas a objeciones abiertas. Ver el formato en lib/brief.js.
// Bilingüe: el bloque llega en inglés (SCORE, VERDICT: APPROVED|CHANGES, DONE: YES|NO, OBJECTIONS, REPLIES) o en
// español (NOTA, VEREDICTO: APROBADO|CAMBIOS, TERMINADO: SÍ|NO…). Por dentro los valores siguen siendo los de siempre.

const lastMatch = (text, re) => {
  const all = [...String(text || '').matchAll(re)];
  return all.length ? all[all.length - 1] : null;
};

function parseVerdict(output) {
  const m = lastMatch(output, /(?:VEREDICTO|VERDICT):\s*\**\s*(APROBADO|CAMBIOS|APPROVED|CHANGES)/gi);
  if (!m) return 'SIN_VEREDICTO';
  const v = m[1].toUpperCase();
  return v === 'APPROVED' ? 'APROBADO' : v === 'CHANGES' ? 'CAMBIOS' : v;
}

function parseScore(output) {
  const m = lastMatch(output, /(?:NOTA|SCORE):\s*\**\s*(\d{1,2}(?:[.,]\d)?)\s*\/\s*10/gi);
  if (!m) return null;
  const n = Number(m[1].replace(',', '.'));
  return n >= 0 && n <= 10 ? n : null;
}

// Modo automático: "TERMINADO: SÍ" o "DONE: YES" = "lo que queda por mejorar no justifica otro turno".
function parseDone(output) {
  // Ojo: \b no funciona detrás de "Í" (no es carácter de palabra en JS), por eso el lookahead explícito.
  const m = lastMatch(output, /(?:TERMINADO|DONE):\s*\**\s*(S[IÍ]|YES|NO)(?![\p{L}\p{N}])/giu);
  if (!m) return null;
  return /^[sy]/i.test(m[1]);
}

const HEADER = /^\s*(?:#{1,4}\s*)?\**\s*(OBJECIONES|RESPUESTAS|NOTA|VEREDICTO|TERMINADO|OBJECTIONS|REPLIES|SCORE|VERDICT|DONE)\b\**\s*:?\**\s*(.*)$/i;
// El nombre en inglés de cada sección → el de siempre.
const SECTION = { OBJECTIONS: 'OBJECIONES', REPLIES: 'RESPUESTAS', SCORE: 'NOTA', VERDICT: 'VEREDICTO', DONE: 'TERMINADO' };
const BULLET = /^\s*(?:[-*•]|\d+[.)])\s+(.*\S)\s*$/;
const NONE = /^\(?\s*(ninguna|ninguno|sin objeciones|no hay|none|no objections|nothing|n\/a|-)\s*\.?\)?$/i;

// Devuelve las viñetas de la ÚLTIMA sección con ese nombre (el reporte final va al final).
function sectionBullets(text, name) {
  const lines = String(text || '').split(/\r?\n/);
  let items = null;
  let current = null;
  for (const line of lines) {
    const h = line.match(HEADER);
    if (h) {
      const section = h[1].toUpperCase();
      if ((SECTION[section] || section) === name) {
        current = [];
        items = current;
        const inline = h[2].replace(/\*+$/, '').trim();
        if (inline && !NONE.test(inline)) current.push(inline);
      } else current = null;
      continue;
    }
    if (!current) continue;
    const b = line.match(BULLET);
    if (b) current.push(b[1].trim());
    else if (/^\s*#{1,4}\s/.test(line)) current = null; // otro encabezado de Markdown cierra la sección
    else if (line.trim() && current.length && /^\s{2,}/.test(line)) current[current.length - 1] += ' ' + line.trim();
  }
  return (items || []).filter(i => !NONE.test(i.replace(/\*+/g, '').trim()));
}

function parseObjections(output) {
  return sectionBullets(output, 'OBJECIONES').map(t => t.replace(/^\*\*|\*\*$/g, '').trim()).filter(t => t.length > 3);
}

const STANCES = {
  RESUELTA: 'resuelta', ACEPTADA: 'resuelta', ACEPTO: 'resuelta', CORREGIDA: 'resuelta',
  RECHAZADA: 'rechazada', RECHAZO: 'rechazada',
  MANTENIDA: 'mantenida', MANTENGO: 'mantenida',
  RETIRADA: 'retirada', RETIRO: 'retirada',
  'DE ACUERDO': 'apoyo', APOYO: 'apoyo',
  RESOLVED: 'resuelta', ACCEPTED: 'resuelta', FIXED: 'resuelta',
  REJECTED: 'rechazada',
  MAINTAINED: 'mantenida', UPHELD: 'mantenida',
  WITHDRAWN: 'retirada',
  AGREED: 'apoyo', AGREE: 'apoyo',
};
const REPLY = /^#?\s*(\d+)\s*[:\-–—]?\s*\**\s*(RESUELTA|ACEPTADA|ACEPTO|CORREGIDA|RECHAZADA|RECHAZO|MANTENIDA|MANTENGO|RETIRADA|RETIRO|DE ACUERDO|APOYO|RESOLVED|ACCEPTED|FIXED|REJECTED|MAINTAINED|UPHELD|WITHDRAWN|AGREED|AGREE)\b\**\s*[:\-–—]?\s*(.*)$/i;

function parseReplies(output) {
  const out = [];
  for (const item of sectionBullets(output, 'RESPUESTAS')) {
    const m = item.replace(/\*\*/g, '').match(REPLY);
    if (m) out.push({ id: Number(m[1]), stance: STANCES[m[2].toUpperCase()], text: m[3].trim() });
  }
  return out;
}

function parseReport(output) {
  return {
    verdict: parseVerdict(output),
    score: parseScore(output),
    done: parseDone(output),
    objections: parseObjections(output),
    replies: parseReplies(output),
  };
}

module.exports = { parseVerdict, parseScore, parseDone, parseObjections, parseReplies, parseReport, sectionBullets };
