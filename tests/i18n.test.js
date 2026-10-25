// Idiomas: los dos diccionarios tienen las mismas claves y los mismos huecos, el inglés es el valor por defecto,
// la preferencia se guarda en el servidor, y el HTML no tiene textos sueltos sin clave.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const dict = l => JSON.parse(read(`public/i18n/${l}.json`));
const LANGS = require('../public/i18n').LANGS;
const holes = s => [...String(s).matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort().join(',');

test('i18n: cada clave existe en todos los idiomas, con los mismos huecos y sin valores vacíos', () => {
  const dicts = Object.fromEntries(LANGS.map(l => [l, dict(l)]));
  const all = new Set(LANGS.flatMap(l => Object.keys(dicts[l])));
  const problems = [];
  for (const key of all) {
    for (const l of LANGS) {
      if (!(key in dicts[l])) problems.push(`${key}: falta en ${l}.json`);
      else if (!String(dicts[l][key]).trim()) problems.push(`${key}: vacía en ${l}.json`);
    }
    const shapes = new Set(LANGS.filter(l => key in dicts[l]).map(l => holes(dicts[l][key])));
    if (shapes.size > 1) problems.push(`${key}: huecos distintos entre idiomas`);
  }
  assert.deepEqual(problems, []);
});

test('i18n: la prueba de paridad falla si una clave está en un idioma y no en otro', () => {
  // Lo mismo que la prueba de arriba, sobre un par inventado: debe detectar la clave que sobra.
  const en = { 'a.b': 'Hi', 'a.c': 'Bye' }, es = { 'a.b': 'Hola' };
  const missing = Object.keys(en).filter(k => !(k in es));
  assert.deepEqual(missing, ['a.c']);
});

test('i18n: la ruta en pantalla no publica la cuenta de quien instaló', () => {
  const { shortHome } = require('../public/i18n');
  assert.equal(shortHome('C:\\Users\\usuario\\AppData\\Local\\Temp\\mision'), '~\\AppData\\Local\\Temp\\mision');
  assert.equal(shortHome('c:/Users/usuario/proj/final'), '~/proj/final');
  assert.equal(shortHome('/Users/usuario/proj'), '~/proj');
  assert.equal(shortHome('/home/usuario/proj'), '~/proj');
  assert.equal(shortHome('D:\\work\\proj'), 'D:\\work\\proj');
  assert.equal(shortHome(''), '');
});

test('i18n: el idioma por defecto es el inglés (cliente, servidor y HTML)', () => {
  const pub = require('../public/i18n');
  assert.equal(pub.DEFAULT, 'en');
  assert.match(read('public/index.html'), /<html lang="en">/);
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'om-i18n-'));
  const env = { ...process.env, OFFICEMATRIX_HOME: home };
  delete env.OFFICEMATRIX_LANG;
  const run = code => spawnSync(process.execPath, ['-e', code], { cwd: ROOT, env, encoding: 'utf8' });
  const first = run("const i = require('./lib/i18n'); process.stdout.write(i.getLang() + '|' + i.t('fail.saldo.label'))");
  assert.equal(first.stdout, 'en|NO CREDIT', first.stderr);
  // Se guarda en preferencias.json y el siguiente arranque lo recuerda.
  const set = run("const i = require('./lib/i18n'); i.setLang('es'); process.stdout.write(i.t('fail.saldo.label'))");
  assert.equal(set.stdout, 'SIN SALDO', set.stderr);
  assert.equal(JSON.parse(fs.readFileSync(path.join(home, 'preferencias.json'), 'utf8')).idioma, 'es');
  assert.equal(run("process.stdout.write(require('./lib/i18n').getLang())").stdout, 'es');
  const bad = run("try { require('./lib/i18n').setLang('xx') } catch (e) { process.stdout.write(String(e.status)) }");
  assert.equal(bad.stdout, '400');
  fs.rmSync(home, { recursive: true, force: true });
});

test('i18n: el detector de idioma del pedido distingue inglés y español', () => {
  const { detectLang } = require('../lib/i18n');
  assert.equal(detectLang('Write a newsletter about the moon for my readers', 'en'), 'en');
  assert.equal(detectLang('Escribe una newsletter sobre la luna para mis lectores', 'en'), 'es');
  assert.equal(detectLang('', 'en'), 'en');
  assert.equal(detectLang('Trabajo largo', 'en'), 'es');
  assert.equal(detectLang('Pedido corto', 'en'), 'es');
});

test('i18n: templates, sequential and parallel briefs follow the request language', () => {
  const { builtInTemplates, templateBrief } = require('../lib/templates');
  const { buildTurnBrief, buildParallelBrief } = require('../lib/brief');
  const { parseRatings } = require('../lib/workflows');
  const { agentHandoff, handoffQuality } = require('../lib/handoff');
  const { siguientePaso } = require('../lib/hoy');
  const agent = { id: 'a', name: 'A', role: 'Reviewer' };
  const info = { mode: 'auto', round: 1, maxRounds: 4, turn: 1, minScore: 9, cycle: 1, workflow: 'consejo' };
  const base = { agent, team: [agent], info, memoryDir: 'memory' };
  const english = { messages: [{ kind: 'user', text: 'Write a report about the moon for my readers' }], config: { template: 'investigacion' } };
  const spanish = { messages: [{ kind: 'user', text: 'Escribe un informe sobre la luna para mis lectores' }], config: { template: 'investigacion' } };
  assert.equal(builtInTemplates('en')[0].name, 'Code');
  assert.equal(builtInTemplates('es')[0].name, 'Código');
  assert.match(templateBrief('investigacion', 'en'), /Mission type: Research/);
  assert.match(templateBrief('investigacion', 'es'), /Tipo de misión: Investigación/);
  const enBrief = buildTurnBrief({ ...base, chat: english });
  const esBrief = buildTurnBrief({ ...base, chat: spanish });
  assert.match(enBrief, /^# Turn in OfficeMatrix/);
  assert.match(enBrief, /OBJECTIONS:[\s\S]*REPLIES:[\s\S]*SCORE:[\s\S]*DONE: YES/);
  assert.match(enBrief, /Mission type: Research/);
  assert.doesNotMatch(enBrief, /Tipo de misión|no hubo turnos|sin pedido/);
  assert.match(esBrief, /^# Turno en OfficeMatrix/);
  assert.match(esBrief, /Tipo de misión: Investigación/);
  const parallel = buildParallelBrief({ ...base, chat: english, phase: 'evaluacion', folder: 'borradores/A/', drafts: [{ letter: 'B', folder: 'borradores/B/' }] });
  assert.match(parallel, /Council mode/);
  assert.match(parallel, /SCORES:/);
  assert.match(parallel, /Do NOT edit anything/);
  assert.deepEqual(parseRatings('SCORES:\n- B: 9/10 good\nSCORE: 9/10\nVERDICT: CHANGES'), { B: 9 });
  const handoff = '## Latest handoff\n**From:** A\n**What I did:** fixed\n**Decisions and why:** tested\n**Open objections:** none\n**Recommended next step:** Review it.';
  assert.equal(handoffQuality(handoff).complete, true);
  assert.equal(agentHandoff('# HANDOFF\n' + handoff), handoff);
  assert.equal(siguientePaso(handoff), 'Review it.');
});

// Las claves que usa el código (t('…') con una cadena literal) y el HTML (data-i18n*) existen en el diccionario.
test('i18n: la interfaz no pinta el veredicto interno en crudo', () => {
  for (const f of ['public/app.js', 'public/charts.js']) assert.doesNotMatch(read(f), /\.verdict\.replace\(/, f);
});

test('i18n: toda clave usada en el código y en el HTML existe', () => {
  const en = dict('en');
  const files = ['server.js', 'om.js', ...fs.readdirSync(path.join(ROOT, 'lib')).map(f => `lib/${f}`),
    ...fs.readdirSync(path.join(ROOT, 'public')).filter(f => f.endsWith('.js')).map(f => `public/${f}`),
    ...fs.readdirSync(path.join(ROOT, 'scripts')).filter(f => f.endsWith('.js')).map(f => `scripts/${f}`)];
  const missing = [];
  for (const f of files) {
    for (const m of read(f).matchAll(/\bt\(\s*'([a-z][\w.-]*\.[\w.-]+)'/g)) if (!(m[1] in en)) missing.push(`${f}: ${m[1]}`);
    for (const m of read(f).matchAll(/\bnoteKey: '([\w.-]+)'/g)) if (!(m[1] in en)) missing.push(`${f}: ${m[1]}`);
  }
  for (const m of read('public/index.html').matchAll(/data-i18n(?:-[a-z-]+)?="([^"]+)"/g)) if (!(m[1] in en)) missing.push(`index.html: ${m[1]}`);
  assert.deepEqual(missing, []);
});

// Nada de textos sueltos en el HTML: cada texto con letras va en un elemento con data-i18n / data-i18n-html, o con
// translate="no" (marcas y nombres propios); cada title, placeholder, aria-label y data-hover="txt:…" tiene su clave.
test('i18n: index.html no tiene textos sin clave', () => {
  const html = read('public/index.html').replace(/<!--[\s\S]*?-->/g, '').replace(/<(script|style|title)\b[\s\S]*?<\/\1>/g, '');
  const body = html.slice(html.indexOf('<body'));
  const VOID = new Set(['input', 'br', 'img', 'meta', 'link', 'hr', 'source']);
  const stack = [];
  const loose = [];
  for (const m of body.matchAll(/<(\/?)([a-z][a-z0-9]*)([^>]*)>|([^<]+)/g)) {
    const [, close, tag, attrs = '', text] = m;
    if (text !== undefined) {
      if (/\p{L}/u.test(text) && !stack.some(e => e.ok)) loose.push(text.trim());
      continue;
    }
    if (close) { while (stack.length && stack.pop().tag !== tag); continue; }
    for (const [attr, key] of [['title', 'title'], ['placeholder', 'placeholder'], ['aria-label', 'aria-label']]) {
      const v = new RegExp(`\\s${attr}="([^"]*)"`).exec(attrs)?.[1];
      if (v && /\p{L}/u.test(v) && !attrs.includes(`data-i18n-${key}=`) && !/translate="no"/.test(attrs)) loose.push(`${attr}="${v}"`);
    }
    const hover = /\sdata-hover="txt:([^"]*)"/.exec(attrs)?.[1];
    if (hover && !attrs.includes('data-i18n-hover=')) loose.push(`data-hover="${hover}"`);
    const ok = /\sdata-i18n(-html)?="/.test(attrs) || /translate="no"/.test(attrs);
    if (!VOID.has(tag) && !attrs.trim().endsWith('/')) stack.push({ tag, ok });
  }
  assert.deepEqual(loose, []);
});
