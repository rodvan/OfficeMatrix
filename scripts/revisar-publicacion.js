#!/usr/bin/env node
// Revisa que el repositorio se pueda publicar: nada personal, ningún secreto y nada ignorado dentro del índice.
// Sin dependencias. Mira lo que `git add -A` subiría (índice y archivos nuevos no ignorados), no la carpeta entera.
//   node scripts/revisar-publicacion.js [carpeta] [--historial]
// --historial revisa además cada versión de cada archivo en todas las ramas: lo que se borró sigue en la historia.
// Sale con código 1 si encuentra algo. Lo usa tests/publicacion.test.js.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

// Los nombres se arman por partes para que este archivo no se denuncie a sí mismo.
const NOMBRES_PRIVADOS = [['hip', 'atia'], ['co', 'coa']].map(p => p.join(''));

// Quien aparece en una ruta de ejemplo. Cualquier otro nombre en C:\Users\<alguien> o /home/<alguien> se denuncia.
const USUARIOS_DE_EJEMPLO = new Set(['demo', 'usuario', 'tu-usuario', 'tuusuario', 'user', 'username', 'you', 'yo', 'public',
  'default', 'all users', '<tú>', '<tu-usuario>', '<usuario>', '<user>', '<alguien>', '%username%', '$user', '${user}', '...', '…']);
const DOMINIOS_DE_EJEMPLO = /(^|\.)(example\.(com|org|net)|invalid|test|example|localhost|users\.noreply\.github\.com)$/i;

const REGLAS = [
  { tipo: 'correo', re: /\b[A-Za-z0-9._%+-]+@([A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,})\b/g,
    ok: m => DOMINIOS_DE_EJEMPLO.test(m[1]) || /^git@/i.test(m[0]) || /^noreply@/i.test(m[0]) },
  { tipo: 'ruta personal', re: /\b[A-Za-z]:[\\/]+Users[\\/]+([^\\/\s"'`<>|*?:]+|<[^>]+>)/gi, ok: m => USUARIOS_DE_EJEMPLO.has(m[1].toLowerCase()) },
  { tipo: 'ruta personal', re: /(?:^|[\s"'`(=])\/(?:home|Users)\/([A-Za-z0-9._-]+|<[^>]+>)\//g, ok: m => USUARIOS_DE_EJEMPLO.has(m[1].toLowerCase()) },
  { tipo: 'llave de oficina', re: /\bom_[a-z0-9-]+_[A-Za-z0-9_-]{20,}/g },
  { tipo: 'secreto de webhook', re: /\b(?:whsec|vhk|crsr)_[A-Za-z0-9+/=_-]{12,}/g },
  { tipo: 'token', re: /\b(?:sk-(?:ant-|proj-)?[A-Za-z0-9_-]{20,}|ghp_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}|xai-[A-Za-z0-9]{20,}|AIza[0-9A-Za-z_-]{35}|AKIA[0-9A-Z]{16}|xox[abprs]-[A-Za-z0-9-]{10,})/g },
  { tipo: 'llave privada', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/g },
  { tipo: 'IP de red local', re: /\b(?:192\.168|172\.(?:1[6-9]|2\d|3[01]))\.\d{1,3}\.\d{1,3}\b/g },
  { tipo: 'nombre privado', re: new RegExp(`\\b(?:${NOMBRES_PRIVADOS.join('|')})\\b`, 'gi') },
];

const ESTE_ARCHIVO = 'scripts/revisar-publicacion.js';

function git(dir, args, opts = {}) {
  return execFileSync('git', args, { cwd: dir, maxBuffer: 256 * 1024 * 1024, ...opts });
}

const esBinario = buf => buf.subarray(0, 8000).includes(0);
// Muestra lo justo para encontrarlo sin volver a imprimir un secreto entero.
const tapar = s => (s.length > 14 ? `${s.slice(0, 10)}…` : s);

function revisarTexto(texto, archivo) {
  const hallazgos = [];
  const lineas = texto.split(/\r?\n/);
  lineas.forEach((linea, i) => {
    for (const r of REGLAS) {
      r.re.lastIndex = 0;
      for (const m of linea.matchAll(r.re)) {
        if (r.ok && r.ok(m)) continue;
        hallazgos.push({ archivo, linea: i + 1, tipo: r.tipo, muestra: tapar(m[0].trim()) });
      }
    }
  });
  return hallazgos;
}

function revisar(dir = process.cwd(), { historial = false } = {}) {
  dir = path.resolve(dir);
  const hallazgos = [];
  const archivos = git(dir, ['ls-files', '-co', '--exclude-standard', '-z']).toString('utf8').split('\0').filter(Boolean);
  for (const archivo of archivos) {
    if (archivo === ESTE_ARCHIVO) continue;
    for (const n of NOMBRES_PRIVADOS) if (archivo.toLowerCase().includes(n)) hallazgos.push({ archivo, linea: 0, tipo: 'nombre privado', muestra: 'in the file name' });
    let buf;
    try { buf = fs.readFileSync(path.join(dir, archivo)); } catch { continue; } // borrado en disco: lo verá el índice
    if (esBinario(buf)) continue;
    hallazgos.push(...revisarTexto(buf.toString('utf8'), archivo));
  }
  // Lo que .gitignore excluye pero ya está en el índice se publicaría igual.
  for (const archivo of git(dir, ['ls-files', '-ci', '--exclude-standard', '-z']).toString('utf8').split('\0').filter(Boolean)) {
    hallazgos.push({ archivo, linea: 0, tipo: 'ignorado pero en el índice', muestra: 'git rm --cached' });
  }
  if (historial) hallazgos.push(...revisarHistorial(dir));
  return hallazgos;
}

function revisarHistorial(dir) {
  let lista;
  try { lista = git(dir, ['rev-list', '--objects', '--all'], { stdio: ['ignore', 'pipe', 'ignore'] }).toString('utf8'); } catch { return []; }
  const rutaDe = new Map();
  for (const l of lista.split('\n')) {
    const [sha, ...resto] = l.split(' ');
    if (sha && resto.length) rutaDe.set(sha, resto.join(' '));
  }
  // Un solo `git cat-file --batch` para todo: lanzar un git por objeto tarda minutos con cientos de sprites.
  const shas = [...rutaDe].filter(([, a]) => a !== ESTE_ARCHIVO && !/\.(png|jpe?g|gif|webp|ico|pdf|zip)$/i.test(a)).map(([s]) => s);
  if (!shas.length) return [];
  const out = git(dir, ['cat-file', '--batch'], { input: shas.join('\n') + '\n' });
  const hallazgos = [];
  let i = 0;
  while (i < out.length) {
    const fin = out.indexOf(10, i);
    if (fin < 0) break;
    const [sha, tipo, tam] = out.subarray(i, fin).toString().split(' ');
    const size = Number(tam) || 0;
    const buf = out.subarray(fin + 1, fin + 1 + size);
    i = fin + 1 + size + 1;
    if (tipo !== 'blob' || esBinario(buf)) continue; // árboles, «missing» o binarios
    const archivo = rutaDe.get(sha);
    for (const h of revisarTexto(buf.toString('utf8'), archivo)) hallazgos.push({ ...h, archivo: `${archivo} (historial ${sha.slice(0, 7)})` });
  }
  return hallazgos;
}

module.exports = { revisar, revisarTexto, REGLAS };

if (require.main === module) {
  const args = process.argv.slice(2);
  const dir = args.find(a => !a.startsWith('--')) || path.join(__dirname, '..');
  let hallazgos;
  try { hallazgos = revisar(dir, { historial: args.includes('--historial') }); } catch (e) {
    console.error(`Could not check ${dir}: ${e.message}\nIs git installed, and is this a repository?`);
    process.exit(2);
  }
  if (!hallazgos.length) {
    console.log('Ready to publish: no personal data, secrets or ignored files in the index.');
    process.exit(0);
  }
  for (const h of hallazgos) console.log(`${h.archivo}${h.linea ? `:${h.linea}` : ''}  [${h.tipo}]  ${h.muestra}`);
  console.log(`\n${hallazgos.length} finding(s). Fix them before publishing.`);
  process.exit(1);
}
