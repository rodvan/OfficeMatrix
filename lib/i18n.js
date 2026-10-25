// Idiomas en el servidor. El diccionario es el mismo que usa la interfaz (public/i18n/<idioma>.json): una sola
// fuente de verdad por idioma, y tests/i18n.test.js comprueba que los dos tienen las mismas claves.
// El idioma por defecto es el inglés. El usuario lo cambia con el selector EN | ES y se guarda en preferencias.json
// (en la carpeta de datos), para que los avisos del servidor y los diagnósticos de fallo salgan en su idioma.
const fs = require('fs');
const path = require('path');
const { LANGS, DEFAULT, norm, format } = require('../public/i18n');

const DICT_DIR = path.join(__dirname, '..', 'public', 'i18n');
const dicts = Object.fromEntries(LANGS.map(l => [l, JSON.parse(fs.readFileSync(path.join(DICT_DIR, `${l}.json`), 'utf8'))]));

const DATA = process.env.OFFICEMATRIX_HOME ? path.resolve(process.env.OFFICEMATRIX_HOME) : path.join(__dirname, '..');
const PREFS = path.join(DATA, 'preferencias.json');

// En `npm test` sin OFFICEMATRIX_HOME no se lee el idioma que el usuario eligió en su propia carpeta de datos:
// las pruebas esperan el valor por defecto aunque quien las ejecute use la app en español.
const OWN_DATA_IN_TESTS = !!process.env.NODE_TEST_CONTEXT && !process.env.OFFICEMATRIX_HOME;
function readPrefs() {
  if (OWN_DATA_IN_TESTS) return {};
  try { return JSON.parse(fs.readFileSync(PREFS, 'utf8')) || {}; } catch { return {}; }
}

// OFFICEMATRIX_LANG manda sobre lo guardado (útil en instaladores y pruebas); si no, lo guardado; si no, inglés.
let current = norm(process.env.OFFICEMATRIX_LANG) || norm(readPrefs().idioma) || DEFAULT;

const getLang = () => current;

function setLang(lang) {
  const l = norm(lang);
  if (!l) throw Object.assign(new Error(t('server.langInvalid', { langs: LANGS.join(', ') })), { status: 400 });
  current = l;
  fs.writeFileSync(PREFS, JSON.stringify({ ...readPrefs(), idioma: l }, null, 2));
  return l;
}

// t('fail.saldo.label') en el idioma actual; t(clave, vars, 'es') en uno concreto. Sin traducción, cae al inglés;
// sin clave, devuelve la clave (la prueba de paridad impide que eso llegue a publicarse).
function t(key, vars, lang = current) {
  const s = dicts[norm(lang) || DEFAULT]?.[key] ?? dicts[DEFAULT][key];
  return s == null ? key : format(s, vars);
}

// ¿En qué idioma viene un pedido? Los briefs a los agentes van en inglés salvo que el pedido venga en otro idioma.
// Heurística sin dependencias: signos y palabras frecuentes del español frente a las del inglés.
const ES_WORDS = /\b(que|de|la|el|los|las|una?|para|por|con|del|en|es|se|lo|al|como|más|pero|sus?|este|esta|quiero|haz|hazme|crea|escribe|sobre|también|pedido|trabajo|y)\b/gi;
const EN_WORDS = /\b(the|and|of|to|for|with|is|are|this|that|on|in|it|be|an?|make|write|create|about|please|i|want|my|your|from)\b/gi;
function detectLang(text, fallback = current) {
  const s = String(text || '');
  if (!s.trim()) return fallback;
  const es = (s.match(ES_WORDS) || []).length + 3 * (s.match(/[ñ¿¡áéíóú]/gi) || []).length;
  const en = (s.match(EN_WORDS) || []).length;
  if (es === en) return fallback;
  return es > en ? 'es' : 'en';
}

module.exports = { LANGS, DEFAULT, t, getLang, setLang, detectLang, dicts };
