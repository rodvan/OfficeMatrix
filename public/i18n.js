// Idiomas de la interfaz, sin dependencias. Los textos viven en public/i18n/<idioma>.json (los mismos que lee
// lib/i18n.js en el servidor). En el HTML, un elemento se traduce con atributos:
//   data-i18n="clave"            → textContent
//   data-i18n-html="clave"       → innerHTML (solo textos propios del diccionario, con <b> o <code>)
//   data-i18n-title / -placeholder / -aria-label="clave" → ese atributo
//   data-i18n-hover="clave"      → data-hover="txt:…" (el tooltip propio de la app)
// En el código: t('clave', { nombre }) con {nombre} como hueco. Cambiar de idioma no recarga la página: se vuelve a
// aplicar el HTML y se emite el evento «om-lang» para que cada panel se pinte otra vez.
(function (root) {
  const LANGS = ['en', 'es'];
  const DEFAULT = 'en';
  const norm = l => {
    const s = String(l || '').trim().slice(0, 2).toLowerCase();
    return LANGS.includes(s) ? s : null;
  };
  const format = (str, vars) => String(str).replace(/\{(\w+)\}/g, (m, k) => (vars && vars[k] != null ? String(vars[k]) : m));
  // La cuenta de quien instaló no sale en pantalla ("C:\\Users\\usuario", "/Users/usuario/", "/home/usuario/"). El resto de la ruta sí.
  const shortHome = p => String(p ?? '')
    .replace(/^[A-Za-z]:[\\/]Users[\\/][^\\/]+/i, '~')
    .replace(/^\/(?:Users|home)\/[^/]+/, '~');
  const api = { LANGS, DEFAULT, norm, format, shortHome };
  if (typeof module === 'object' && module.exports) { module.exports = api; return; }

  const dicts = {};
  let lang = DEFAULT;
  try { lang = norm(localStorage.getItem('om-lang')) || DEFAULT; } catch {}
  const t = (key, vars) => {
    const s = dicts[lang]?.[key] ?? dicts[DEFAULT]?.[key];
    return s == null ? key : format(s, vars);
  };
  async function load(l) {
    if (!dicts[l]) dicts[l] = await (await fetch(`/i18n/${l}.json`, { cache: 'no-cache' })).json();
  }
  const ATTRS = [['i18nTitle', 'title'], ['i18nPlaceholder', 'placeholder'], ['i18nAriaLabel', 'aria-label']];
  function apply(scope = document) {
    for (const el of scope.querySelectorAll('[data-i18n], [data-i18n-html], [data-i18n-title], [data-i18n-placeholder], [data-i18n-aria-label], [data-i18n-hover]')) {
      const d = el.dataset;
      if (d.i18n) el.textContent = t(d.i18n);
      if (d.i18nHtml) el.innerHTML = t(d.i18nHtml);
      for (const [k, attr] of ATTRS) if (d[k]) el.setAttribute(attr, t(d[k]));
      if (d.i18nHover) d.hover = 'txt:' + t(d.i18nHover);
    }
    if (scope === document) {
      document.documentElement.lang = lang;
      document.title = t('ui.pageTitle');
      for (const b of document.querySelectorAll('[data-lang]')) {
        b.classList.toggle('on', b.dataset.lang === lang);
        b.setAttribute('aria-pressed', String(b.dataset.lang === lang));
      }
      for (const s of document.querySelectorAll('select[data-lang-select]')) s.value = lang;
    }
  }
  const save = l => fetch('/api/preferencias', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ idioma: l }) }).catch(() => {});
  async function setLang(l) {
    l = norm(l) || DEFAULT;
    await load(l);
    lang = l;
    try { localStorage.setItem('om-lang', l); } catch {}
    save(l);
    apply();
    root.dispatchEvent(new CustomEvent('om-lang', { detail: l }));
  }
  // Primero lo elegido en este navegador; si no hay, la preferencia del servidor; si no, inglés.
  const ready = (async () => {
    let stored = null, server = null;
    try { stored = norm(localStorage.getItem('om-lang')); } catch {}
    try { server = norm((await (await fetch('/api/preferencias')).json()).idioma); } catch {}
    lang = stored || server || DEFAULT;
    await Promise.all([load(DEFAULT), load(lang)]).catch(() => {});
    if (stored && stored !== server) save(stored);
    apply();
    document.addEventListener('click', e => {
      const b = e.target.closest('[data-lang]');
      if (b) setLang(b.dataset.lang);
    });
    document.addEventListener('change', e => {
      if (e.target.matches('select[data-lang-select]')) setLang(e.target.value);
    });
  })();
  root.I18N = { ...api, t, apply, setLang, ready, get lang() { return lang; } };
  root.t = t;
})(globalThis);
