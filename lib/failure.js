// Diagnóstico de un turno fallido: traduce la salida de una CLI que no pudo trabajar a una causa que el usuario
// entiende de un vistazo (sin saldo, límite de uso, sesión caducada, colgada…) y a qué hacer. El ciclo saca al
// agente y sigue con el resto; la UI lo muestra en su estación y en el reporte.

// El orden importa: un 402 que además dice "limit" es falta de saldo, no un límite temporal; y un 529 "Overloaded"
// (servidor saturado) va antes que el límite, porque su mensaje dice "try again in a moment" y no es tu cuota.
const { parseScore, parseVerdict } = require('./protocol');
const { t } = require('./i18n');

// La etiqueta y el qué hacer de cada causa están en el diccionario (fail.<kind>.label / .hint), en el idioma elegido.
const CAUSES = [
  // Bots externos (Grok Bots por webhook): sus mensajes los escribe OfficeMatrix con estas marcas, y van primero para que
  // un "401" o un "fetch failed" del webhook no se confundan con la sesión o la red de una CLI.
  { kind: 'bot-sin-respuesta', re: /\[bot-sin-respuesta\]/ },
  { kind: 'bot-webhook', re: /\[bot-webhook\]/ },
  { kind: 'saturado', re: /\b529\b|overloaded|server.?side issue|\b503\b|service unavailable|temporarily unavailable/i },
  { kind: 'saldo', re: /\b402\b|payment required|balance (?:is )?(?:exhausted|too low)|insufficient (?:credit|balance|funds|quota)|out of credits?|no (?:remaining )?credits?|credit balance|billing/i },
  { kind: 'limite', re: /\b429\b|rate.?limit|usage limit|too many requests|quota|resource.?exhausted|limit (?:reached|exceeded)|hit your (?:usage )?limit|try again (?:later|in)/i },
  { kind: 'sesion', re: /\b401\b|\b403\b|unauthori[sz]ed|forbidden|not (?:logged|signed) in|log ?in (?:again|first|required)|please (?:run|use) [`'"]?\S+ (?:auth )?login|authenticat(?:e|ion) (?:required|failed|error)|invalid (?:api key|token|credentials)|(?:token|session|credentials?) (?:has )?expired/i },
  { kind: 'no-instalada', re: /no se reconoce como (?:un )?comando|is not recognized as an internal or external command|command not found|\bENOENT\b|cannot find module/i },
  { kind: 'red', re: /\bECONNREFUSED\b|\bECONNRESET\b|\bENOTFOUND\b|\bETIMEDOUT\b|network error|fetch failed|getaddrinfo|socket hang up|\b50[24]\b/i },
];

// Falla si: se colgó (sin salida), agotó el tiempo, o salió con error SIN un reporte con NOTA/VEREDICTO.
// Un reporte completo con código distinto de 0 se trata como turno válido: algunas CLIs salen con 1 por avisos menores.
// Devuelve null si el turno es válido, o { kind, label, detail, hint }.
function classifyFailure({ code = 0, stdout = '', stderr = '', report = '', idle = false, timedOut = false, idleMinutes = 0, timeoutMinutes = 0 } = {}) {
  const hasReport = parseScore(report) !== null && parseVerdict(report) !== 'SIN_VEREDICTO';
  if (idle) return diagnosis('colgada', t('fail.colgada.detail', { min: idleMinutes }));
  if (timedOut && !hasReport) return diagnosis('tiempo', t('fail.tiempo.detail', { min: timeoutMinutes }));
  if (hasReport) return null;
  const text = errorText(stderr, stdout, report);
  const cause = CAUSES.find(c => c.re.test(text));
  // Alguna CLI imprime el error de cuenta y sale con 0: solo cuenta si la salida es corta (un mensaje de error, no un trabajo).
  if (code === 0 && !(cause && ['saldo', 'limite', 'sesion'].includes(cause.kind) && (report || stdout).trim().length < 600)) return null;
  const detail = firstUsefulLine(text);
  if (cause) return diagnosis(cause.kind, detail);
  return diagnosis('fallo', detail || t('fail.fallo.detail', { code }));
}

const diagnosis = (kind, detail) => ({ kind, label: t(`fail.${kind}.label`), detail, hint: t(`fail.${kind}.hint`) });

// Lo que se lee para diagnosticar: stderr y el FINAL de la salida, sin las líneas de arranque de la CLI. Claude Code
// imprime al empezar su lista de herramientas y skills, cuyas descripciones dicen "limit", "quota"…: leer toda la salida
// confundía un 529 (servidor saturado) con tu límite de uso.
// El aviso informativo de cuota de Claude Code («rate_limit_event» con status "allowed") dice "rate_limit" sin que haya
// límite: tampoco se lee.
const STARTUP = /^\{"type":"system","subtype":"(?:init|commands_changed|hook_\w+)"|^\{"type":"rate_limit_event".*"status":"allowed"/;
function errorText(stderr, stdout, report) {
  const tail = t => String(t || '').split(/\r?\n/).filter(l => !STARTUP.test(l.trim())).join('\n').slice(-4000);
  const out = tail(stdout), rep = tail(report);
  return `${String(stderr || '').slice(-4000)}\n${out}${rep && rep !== out ? `\n${rep}` : ''}`;
}

// La línea que mejor explica el error: el "API Error: …" de la CLI si lo hay; si no, la primera que nombra un error o un
// código HTTP; si no, la primera no vacía.
function firstUsefulLine(text) {
  const api = String(text).match(/API Error:[^"\\\n]{0,180}/);
  if (api) return api[0].trim();
  const lines = String(text).split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const msg = lines.map(l => l.match(/"message"\s*:\s*"([^"]+)"/)).find(Boolean);
  if (msg) return msg[1].slice(0, 200);
  return (lines.find(l => /error|fail|denied|\b[45]\d\d\b/i.test(l)) || lines[0] || '').slice(0, 200);
}

// Un turno cortado por tiempo o por silencio que ya cambió archivos de trabajo queda PARCIAL, no ERROR (D47):
// el trabajo no se tira, pero tampoco se da por bueno. Una caída de cuenta (saldo, sesión…) sigue siendo ERROR.
const PARTIAL_KINDS = ['tiempo', 'colgada'];
const isPartial = (failure, workFiles = []) => !!failure && PARTIAL_KINDS.includes(failure.kind) && workFiles.length > 0;

module.exports = { classifyFailure, isPartial, CAUSES, errorText };
