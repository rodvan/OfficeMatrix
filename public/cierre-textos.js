// Textos del informe de cierre y de la ronda de cierre. Viven en public/i18n/<idioma>.json bajo «cierre.*», con
// el resto de la app (la prueba de paridad vigila que en y es tengan las mismas claves y huecos). Este archivo solo
// los arma con la forma que usan la tarjeta (public/cierre.js) y el servidor (lib/cierre.js): CIERRE_TEXTOS.en.titulo,
// CIERRE_TEXTOS.es.seguirN(2)… Las cadenas salen tal cual; los textos con huecos o plural se vuelven funciones.
(function (root) {
  // Huecos de cada texto, en el orden de los argumentos.
  const SIMPLE = {
    rondaCierre: 'round items', relatorFallo: 'name reason', riesgoNota: 'name score min', riesgoEntorno: 'who text',
    vioPrueba: 'who passed total', cayoPendiente: 'name reason detail', generadoLinea: 'when who', quienRelator: 'name',
    objecionMd: 'id state who text', limiteMd: 'who id text', editorialListas: 'created discarded', editorialTemas: 'topics',
    modoTitulo: 'mode', borradorMd: 'letter author', archivosGit: 'added changed deleted renamed', lineasMd: 'plus minus binary',
    pruebasDefMd: 'before after', mediaIntro: 'series', pruebaMd: 'who round passed total secs', enSegundos: 's',
    puertosMd: 'list', puerto: 'port', capturaMd: 'name path',
    'ui.reescritoPor': 'name', 'ui.chartTitulo': 'min', 'ui.ronda': 'n', 'ui.nuevosCambiados': 'added changed', 'ui.tocados': 'n',
    'ui.lineas': 'plus minus', 'ui.pruebasEscritas': 'before after', 'ui.consumo': 'n', 'ui.descartadas': 'n', 'ui.temas': 'list',
    'ui.pruebasDe': 'who passed total', 'ui.puerto': 'n', 'ui.rondaNota': 'round score', 'ui.archivosTitulo': 'n',
    'ui.minTurnos': 'min turns', 'ui.dinero': 'amount',
  };
  // Plural por el primer argumento: «clave.one» si es 1, «clave.other» si no.
  const PLURAL = {
    objecionesAbiertas: 'n', seguirN: 'n', coste: 'turns min', riesgoObjeciones: 'n', riesgoBorrados: 'n', riesgoSacados: 'n',
    conOtroNombre: 'n', sacadosMd: 'n', binariosMd: 'n', sinHistorialMd: 'n', ciclosPrevios: 'n',
  };

  const format = (s, vars) => String(s).replace(/\{(\w+)\}/g, (m, k) => (vars && vars[k] != null ? String(vars[k]) : m));
  const vars = (names, args) => Object.fromEntries(names.split(' ').map((n, i) => [n, args[i]]));

  // { 'cierre.ui.luz.verde': 'Verde', 'cierre.guiaPasos.1': … } → { ui: { luz: { verde } }, guiaPasos: [ … ] }
  function nest(dict) {
    const out = {};
    for (const [key, val] of Object.entries(dict)) {
      if (!key.startsWith('cierre.')) continue;
      const parts = key.slice(7).split('.');
      let o = out;
      for (const p of parts.slice(0, -1)) o = (o[p] = o[p] && typeof o[p] === 'object' ? o[p] : {});
      o[parts[parts.length - 1]] = val;
    }
    const arrays = o => {
      for (const [k, v] of Object.entries(o)) {
        if (v && typeof v === 'object') o[k] = Object.keys(v).every(x => /^\d+$/.test(x)) ? Object.keys(v).sort((a, b) => a - b).map(x => v[x]) : arrays(v);
      }
      return o;
    };
    return arrays(out);
  }

  function build(dict, lang) {
    const L = nest(dict);
    const tr = (key, v) => format(dict[`cierre.${key}`] ?? `cierre.${key}`, v);
    const set = (path, fn) => {
      const parts = path.split('.');
      const o = parts.length > 1 ? L[parts[0]] : L;
      o[parts[parts.length - 1]] = fn;
    };
    for (const [path, names] of Object.entries(SIMPLE)) set(path, (...a) => tr(path, vars(names, a)));
    for (const [path, names] of Object.entries(PLURAL)) set(path, (...a) => tr(`${path}.${a[0] === 1 ? 'one' : 'other'}`, vars(names, a)));
    // Los que eligen la frase por algo más que el plural.
    L.objecionCierre = o => tr('objecionCierre', { id: o.id, who: o.agentName || o.by, text: o.text });
    L.puntoCierre = p => tr(p.estado === 'falta' ? 'puntoCierreFalta' : 'puntoCierreParcial', { text: p.texto });
    L.casi = (approved, total, missing) => tr(missing ? 'casiFalta' : 'casi', { approved, total, missing });
    L.detalleNota = n => tr('detalleNota', { score: lang === 'es' ? String(n).replace('.', ',') : n });
    L.riesgoRojas = (list, green) => tr(green ? 'riesgoRojasVerdes' : 'riesgoRojas', { list, green });
    L.caidaMd = (agent, round, tipo, reason, stayed) => tr('caidaMd', {
      agent, round, reason, what: tr(tipo === 'cayo' ? 'caidaMdCayo' : 'caidaMdCortado'), after: tr(stayed ? 'caidaMdSiguio' : 'caidaMdSalio'),
    });
    L.tiempoMd = (min, turns, rounds, earlier) => tr(`tiempoMd.${rounds === 1 ? 'one' : 'other'}`, { min, turns, rounds, earlier });
    L.veredictoPalabra = v => (L.veredicto && L.veredicto[v]) || String(v || '').toLowerCase();
    L.ui.borradosLinea = (deleted, kept) => tr(kept ? 'ui.borradosLineaSacados' : 'ui.borradosLinea', { deleted, kept });
    // Las variantes ya viven dentro de su función; el brief del relator lo arma lib/cierre.js con i18n.t.
    for (const k of ['puntoCierreFalta', 'puntoCierreParcial', 'casiFalta', 'riesgoRojasVerdes', 'caidaMdCayo', 'caidaMdCortado', 'caidaMdSiguio', 'caidaMdSalio', 'relator']) delete L[k];
    delete L.ui.borradosLineaSacados;
    return L;
  }

  // El diccionario de cada idioma: en Node se lee del disco; en el navegador, el que ya cargó I18N (si aún no cargó
  // ese idioma, el inglés, que se carga siempre).
  const isNode = typeof module === 'object' && module.exports && typeof require === 'function' && typeof window === 'undefined';
  const dictOf = lang => {
    if (isNode) return JSON.parse(require('fs').readFileSync(require('path').join(__dirname, 'i18n', `${lang}.json`), 'utf8'));
    const i18n = root.I18N;
    return (i18n && i18n.dict && (i18n.dict(lang) || i18n.dict(i18n.DEFAULT))) || null;
  };
  const cache = {};
  const pack = lang => {
    const dict = dictOf(lang);
    if (!dict) return null;
    if (cache[lang]?.dict !== dict) cache[lang] = { dict, L: build(dict, lang) };
    return cache[lang].L;
  };
  const TEXTOS = { get en() { return pack('en'); }, get es() { return pack('es'); }, SIMPLE, PLURAL, build };

  if (isNode) module.exports = TEXTOS;
  else root.CIERRE_TEXTOS = TEXTOS;
}(typeof window !== 'undefined' ? window : globalThis));
