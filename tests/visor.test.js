// Visor de entregables: tipos de vista, entregable principal, la ruta /raw (MIME, streaming, cabeceras de aislamiento),
// path traversal y que el HTML de un proyecto no pueda escribir en la API de la app.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'officematrix-visor-'));
fs.writeFileSync(path.join(home, 'agents.json'), JSON.stringify({ agents: [], maxRounds: 1, minScore: 9 }));
fs.writeFileSync(path.join(home, 'secreto.txt'), 'fuera del proyecto');
process.env.OFFICEMATRIX_HOME = home;
process.env.OFFICEMATRIX_CONFIG = path.join(home, 'agents.json');

const ID = '2026-10-23-articulo';
const proj = path.join(home, 'proyectos', ID);
const PNG = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000', 'hex');
const put = (rel, content) => { fs.mkdirSync(path.dirname(path.join(proj, rel)), { recursive: true }); fs.writeFileSync(path.join(proj, rel), content); };
put('.office/chat.json', JSON.stringify({
  id: ID, title: 'Artículo', created: new Date().toISOString(), config: {}, debate: [],
  messages: [{ kind: 'agent', agentId: 'a', cycle: 1, workFiles: ['borradores/A/notas.md'] }],
}));
put('final/articulo.html', '<!doctype html><link rel="stylesheet" href="estilo.css"><img src="img/portada.png"><h1>Hola</h1>');
put('final/estilo.css', 'h1{color:red}');
put('final/img/portada.png', PNG);
put('borradores/A/notas.md', '# Notas\n\n![x](img.png)');
put('docs/informe.pdf', '%PDF-1.4\n%fake');
put('HANDOFF.md', '# HANDOFF');
put('README.md', '# Proyecto');
fs.mkdirSync(path.join(home, 'proyectos', 'otro', '.office'), { recursive: true });
fs.writeFileSync(path.join(home, 'proyectos', 'otro', 'privado.txt'), 'de otra misión');

const preview = require('../lib/preview');
const { server } = require('../server');
let port;
test.before(() => new Promise(resolve => server.listen(0, '127.0.0.1', () => { port = server.address().port; resolve(); })));
test.after(() => { server.close(); server.closeAllConnections?.(); });

// http.request y no fetch: así se controlan Origin y Sec-Fetch-Site tal como los mandaría un navegador.
const req = (method, url, { headers = {}, body } = {}) => new Promise((resolve, reject) => {
  const r = http.request({ host: '127.0.0.1', port, method, path: url, headers: { 'Content-Type': 'application/json', ...headers } }, res => {
    const chunks = [];
    res.on('data', c => chunks.push(c));
    res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
  });
  r.on('error', reject);
  r.end(body);
});

test('tipo de vista y MIME por extensión', () => {
  assert.deepStrictEqual(['a.html', 'b.MD', 'c.png', 'd.svg', 'e.pdf', 'f.js', 'g.mp4', 'h.zip', 'Makefile'].map(preview.kindOf),
    ['html', 'md', 'image', 'image', 'pdf', 'code', 'media', 'binary', 'code']);
  assert.strictEqual(preview.mimeOf('x.webp'), 'image/webp');
  assert.strictEqual(preview.mimeOf('x.desconocido'), 'application/octet-stream');
});

test('entregable principal: final/ manda, luego lo del último ciclo; HANDOFF y la memoria no cuentan', () => {
  const files = [
    { path: 'HANDOFF.md' }, { path: 'README.md' }, { path: 'memoria-oficina/lecciones.md' }, { path: 'borradores/A/notas.md' },
    { path: 'borradores/A/LEEME.md' }, { path: 'final/articulo.html' }, { path: 'final/img/portada.png' }, { path: 'final', dir: true },
  ];
  const d = preview.deliverables(files, [{ kind: 'agent', cycle: 1, workFiles: ['borradores/A/notas.md'] }]);
  assert.strictEqual(d.main, 'final/articulo.html');
  assert.ok(!d.items.some(i => /HANDOFF|memoria-oficina|LEEME/.test(i.path)));
  assert.ok(d.items.find(i => i.path === 'borradores/A/notas.md').touched);
  // Sin final/: lo que tocó el último ciclo antes que el README.
  assert.strictEqual(preview.deliverables(files.filter(f => !/^final/.test(f.path)), [{ kind: 'agent', cycle: 1, workFiles: ['borradores/A/notas.md'] }]).main, 'borradores/A/notas.md');
  assert.strictEqual(preview.deliverables([{ path: 'README.md' }]).main, 'README.md');
  assert.strictEqual(preview.deliverables([]).main, null);
});

test('resolveInside rechaza "..", rutas absolutas, carpetas internas y lo que no existe', () => {
  assert.strictEqual(preview.resolveInside(proj, 'final/articulo.html').size > 0, true);
  for (const bad of ['../otro/privado.txt', '../../secreto.txt', 'final/../../otro/privado.txt', '..\\..\\secreto.txt', '/etc/passwd', 'C:\\Windows\\win.ini', path.join(home, 'secreto.txt')]) {
    assert.strictEqual(preview.resolveInside(proj, bad).status, 403, bad);
  }
  assert.strictEqual(preview.resolveInside(proj, '.office/chat.json').status, 403);
  assert.strictEqual(preview.resolveInside(proj, 'no-existe.html').status, 404);
  assert.strictEqual(preview.resolveInside(proj, 'final').status, 404);
  assert.strictEqual(preview.resolveInside(proj, 'a\0b').status, 400);
});

test('un enlace (unión de carpeta en Windows) que apunta fuera del proyecto no se sirve', t => {
  // Las uniones ("junction") no piden permisos de administrador en Windows; en el resto, un enlace de carpeta normal.
  try { fs.symlinkSync(home, path.join(proj, 'fuera'), 'junction'); } catch { return t.skip('no se pudo crear el enlace'); }
  try {
    assert.ok(fs.existsSync(path.join(proj, 'fuera', 'secreto.txt')));
    assert.strictEqual(preview.resolveInside(proj, 'fuera/secreto.txt').status, 403);
  } finally {
    // Se borra el enlace, nunca su destino (nada de borrado recursivo aquí).
    try { fs.unlinkSync(path.join(proj, 'fuera')); } catch { fs.rmdirSync(path.join(proj, 'fuera')); }
  }
});

test('/raw sirve el HTML aislado: sandbox sin allow-same-origin, sin fetch ni formularios, con su MIME', async () => {
  const r = await req('GET', `/raw/${ID}/final/articulo.html`);
  assert.strictEqual(r.status, 200);
  assert.match(r.headers['content-type'], /^text\/html; charset=utf-8/);
  const csp = r.headers['content-security-policy'];
  assert.match(csp, /^sandbox allow-scripts/);
  assert.doesNotMatch(csp, /allow-same-origin|allow-top-navigation/);
  assert.match(csp, /connect-src 'none'/);
  assert.match(csp, /form-action 'none'/);
  assert.strictEqual(r.headers['x-content-type-options'], 'nosniff');
  assert.match(r.body.toString(), /<h1>Hola<\/h1>/);
  // Sus recursos relativos (CSS e imagen) se resuelven en la misma ruta, con su tipo y en binario intacto.
  const css = await req('GET', `/raw/${ID}/final/estilo.css`);
  assert.match(css.headers['content-type'], /^text\/css/);
  const img = await req('GET', `/raw/${ID}/final/img/portada.png`);
  assert.strictEqual(img.headers['content-type'], 'image/png');
  assert.strictEqual(img.headers['content-length'], String(PNG.length));
  assert.ok(img.body.equals(PNG));
  const mdHead = await req('HEAD', `/raw/${ID}/borradores/A/notas.md`);
  assert.strictEqual(mdHead.status, 200);
  assert.match(mdHead.headers['content-type'], /^text\/plain; charset=utf-8/);
  // El PDF va sin sandbox (Chrome no abre su visor en un documento aislado) pero sin scripts.
  const pdf = await req('GET', `/raw/${ID}/docs/informe.pdf`);
  assert.strictEqual(pdf.headers['content-type'], 'application/pdf');
  assert.match(pdf.headers['content-security-policy'], /default-src 'none'/);
});

test('/raw no sale del proyecto ni sirve carpetas internas ni otras misiones', async () => {
  const cases = [
    [`/raw/${ID}/..%2F..%2Fsecreto.txt`, 403],
    [`/raw/${ID}/..%5C..%5Csecreto.txt`, 403],
    [`/raw/${ID}/..%2Fotro%2Fprivado.txt`, 403],
    [`/raw/${ID}/C%3A%5CWindows%5Cwin.ini`, 403],
    [`/raw/${ID}/.office/chat.json`, 403],
    [`/raw/${ID}/no-existe.html`, 404],
    [`/raw/no-existe/final/articulo.html`, 404],
    [`/raw/${ID}/%E0%A4%A`, 400],
  ];
  for (const [url, status] of cases) assert.strictEqual((await req('GET', url)).status, status, url);
  assert.strictEqual((await req('POST', `/raw/${ID}/final/articulo.html`)).status, 405);
});

test('la API rechaza escrituras desde otro origen (el HTML del visor tiene origen "null")', async () => {
  const body = JSON.stringify({ text: '' });
  for (const headers of [{ Origin: 'null' }, { Origin: 'http://evil.example' }, { 'Sec-Fetch-Site': 'cross-site' }, { 'Sec-Fetch-Site': 'same-site' }]) {
    const r = await req('POST', '/api/chats', { headers, body });
    assert.strictEqual(r.status, 403, JSON.stringify(headers));
  }
  // Desde la propia app (o sin Origin, como las pruebas y curl) pasa el control y llega a la validación normal.
  assert.strictEqual((await req('POST', '/api/chats', { headers: { Origin: `http://127.0.0.1:${port}`, 'Sec-Fetch-Site': 'same-origin' }, body })).status, 400);
  assert.strictEqual((await req('POST', '/api/chats', { body })).status, 400);
  // Leer sigue funcionando (GET no cambia nada).
  assert.strictEqual((await req('GET', '/api/chats', { headers: { Origin: 'null' } })).status, 200);
});

test('el detalle de la misión trae los entregables y /file ya no lee carpetas internas', async () => {
  const detail = JSON.parse((await req('GET', `/api/chats/${ID}`)).body);
  assert.strictEqual(detail.deliverables.main, 'final/articulo.html');
  assert.ok(detail.deliverables.items.some(i => i.path === 'final/img/portada.png' && i.kind === 'image'));
  const file = JSON.parse((await req('GET', `/api/chats/${ID}/file?path=README.md`)).body);
  assert.strictEqual(file.content, '# Proyecto');
  assert.strictEqual((await req('GET', `/api/chats/${ID}/file?path=.office%2Fchat.json`)).status, 403);
  assert.strictEqual((await req('POST', `/api/chats/${ID}/open`, { body: JSON.stringify({ path: '../../secreto.txt' }) })).status, 403);
});
