// Visor de entregables: qué tipo de vista lleva cada archivo, cómo se sirve sin salir de la carpeta del proyecto
// y con qué cabeceras, y cuál es el entregable principal de una misión. Lógica pura (con pruebas en tests/visor.test.js).
const fs = require('fs');
const path = require('path');
const { t } = require('./i18n');

const MIME = {
  '.html': 'text/html', '.htm': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.json': 'application/json', '.map': 'application/json', '.txt': 'text/plain', '.md': 'text/plain', '.markdown': 'text/plain', // el navegador muestra text/plain en la pestaña; text/markdown lo descarga
  '.csv': 'text/csv', '.xml': 'application/xml', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.avif': 'image/avif', '.ico': 'image/x-icon',
  '.bmp': 'image/bmp', '.pdf': 'application/pdf', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf',
  '.otf': 'font/otf', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.mp4': 'video/mp4', '.webm': 'video/webm',
};
const IMAGE = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.avif', '.ico', '.bmp']);
const CODE = new Set(['.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx', '.css', '.json', '.py', '.sh', '.ps1', '.bat', '.yml', '.yaml',
  '.toml', '.ini', '.xml', '.csv', '.txt', '.log', '.sql', '.go', '.rs', '.java', '.c', '.h', '.cpp', '.cs', '.rb', '.php', '.env', '.gitignore']);

const RAW_MAX = 100 * 1024 * 1024; // binarios en streaming, hasta 100 MB
// Carpetas internas que el visor nunca sirve (aunque estén dentro del proyecto).
const HIDDEN = new Set(['.office', '.git', 'node_modules']);

// Vista que corresponde a un archivo: html | md | image | pdf | media | code | binary.
function kindOf(file) {
  const ext = path.extname(String(file)).toLowerCase();
  const base = path.basename(String(file)).toLowerCase();
  if (ext === '.html' || ext === '.htm') return 'html';
  if (ext === '.md' || ext === '.markdown') return 'md';
  if (IMAGE.has(ext)) return 'image';
  if (ext === '.pdf') return 'pdf';
  if (/^\.(mp3|wav|ogg|mp4|webm)$/.test(ext)) return 'media';
  if (CODE.has(ext) || CODE.has(base) || !ext) return 'code';
  return 'binary';
}

const mimeOf = file => MIME[path.extname(String(file)).toLowerCase()] || 'application/octet-stream';

// El HTML (y el SVG, que también ejecuta scripts) de un proyecto corre en un origen opaco: no puede leer la app ni
// llamarla. connect-src 'none' corta fetch/XHR/EventSource y form-action 'none' los formularios; el servidor además
// rechaza cualquier POST/PUT/DELETE a /api que no venga de la propia app (ver sameOriginWrite en server.js).
const SANDBOX_CSP = [
  'sandbox allow-scripts allow-popups allow-modals allow-downloads',
  "default-src 'self' data: blob: https:",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' data: blob: https:",
  "style-src 'self' 'unsafe-inline' data: https:",
  "connect-src 'none'",
  "form-action 'none'",
  'frame-src data: blob: https:',
  "base-uri 'self'",
].join('; ');

// Cabeceras de un archivo servido por /raw. El PDF va sin "sandbox": Chrome no abre su visor en un documento aislado.
function rawHeaders(file, size) {
  const type = mimeOf(file);
  const text = /^text\/|json|xml|svg/.test(type);
  return {
    'Content-Type': text ? `${type}; charset=utf-8` : type,
    ...(size != null ? { 'Content-Length': String(size) } : {}),
    'Cache-Control': 'no-cache',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Content-Security-Policy': kindOf(file) === 'pdf' ? "default-src 'none'; object-src 'self'" : SANDBOX_CSP,
  };
}

// Ruta real de "rel" dentro de "dir", o un error con su código HTTP. Rechaza rutas absolutas, "..", bytes nulos,
// carpetas internas y enlaces simbólicos que apunten fuera del proyecto.
function resolveInside(dir, rel) {
  const fail = (status, error) => ({ status, error });
  const clean = String(rel ?? '').replace(/\\/g, '/');
  if (!clean || clean.includes('\0')) return fail(400, t('preview.err.badPath'));
  if (path.isAbsolute(clean) || /^[a-z]:/i.test(clean) || clean.startsWith('/')) return fail(403, t('preview.err.outside'));
  const segs = clean.split('/');
  if (segs.includes('..')) return fail(403, t('preview.err.outside'));
  if (segs.some(s => HIDDEN.has(s.toLowerCase()))) return fail(403, t('preview.err.internal'));
  const root = path.resolve(dir);
  const target = path.resolve(root, clean);
  if (!target.startsWith(root + path.sep)) return fail(403, t('preview.err.outside'));
  if (!fs.existsSync(target)) return fail(404, t('preview.err.missing'));
  let real;
  try { real = fs.realpathSync(target); } catch { return fail(404, t('preview.err.missing')); }
  const realRoot = fs.realpathSync(root);
  if (!real.startsWith(realRoot + path.sep)) return fail(403, t('preview.err.outside'));
  const stat = fs.statSync(real);
  if (!stat.isFile()) return fail(404, t('preview.err.notFile'));
  if (stat.size > RAW_MAX) return fail(413, t('preview.err.tooBig'));
  return { file: real, size: stat.size };
}

// Archivos que son contabilidad de la oficina, no trabajo entregado.
const BOOKKEEPING = /^(HANDOFF\.md|MEMORIA\.md|docs\/DISCUSION\.md|memoria-oficina\/|borradores\/[^/]+\/LEEME\.md$)/i;
const RANK = { html: 0, md: 1, pdf: 2, image: 3, media: 4, code: 5, binary: 6 };

// Entregables de una misión, el principal primero. "files" es el árbol del proyecto ({ path, dir, size, mtime });
// "messages" los mensajes del chat (para saber qué tocó el último ciclo). Prioridad: final/ (Delphi y Consejo),
// después lo que tocó el último ciclo, y dentro de eso HTML > Markdown > PDF > imagen > resto.
function deliverables(files, messages = []) {
  const lastCycle = [...messages].reverse().find(m => m.cycle)?.cycle;
  const touched = new Set(messages.filter(m => m.kind === 'agent' && m.cycle === lastCycle)
    .flatMap(m => m.workFiles || m.files || []).map(f => String(f).replace(/\\/g, '/')));
  const list = files.filter(f => !f.dir && !BOOKKEEPING.test(f.path)).map(f => {
    const kind = kindOf(f.path);
    const inFinal = /^final\//.test(f.path);
    const base = path.basename(f.path).toLowerCase();
    const score = (inFinal ? 0 : touched.has(f.path) ? 100 : 200) + RANK[kind] * 10 +
      (/^(index|articulo|article|final|post|guion|informe|report)\./.test(base) ? 0 : 3) + (f.path.split('/').length - 1);
    return { path: f.path, kind, size: f.size, mtime: f.mtime, final: inFinal, touched: touched.has(f.path), score };
  });
  list.sort((a, b) => a.score - b.score || (b.mtime || 0) - (a.mtime || 0));
  // Un README del proyecto solo es principal si no hay nada mejor (el de la raíz describe el proyecto, no lo entrega).
  const main = list.find(d => d.kind !== 'code' && d.kind !== 'binary' && !/^readme\.md$/i.test(d.path)) || list[0] || null;
  return { main: main?.path || null, items: list.map(({ score, ...d }) => d) };
}

module.exports = { kindOf, mimeOf, rawHeaders, resolveInside, deliverables, SANDBOX_CSP, RAW_MAX, HIDDEN };
