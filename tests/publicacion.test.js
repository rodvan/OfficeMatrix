// El escáner de publicación (scripts/revisar-publicacion.js): denuncia lo personal y lo secreto, y este repositorio pasa.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { revisar, revisarTexto } = require('../scripts/revisar-publicacion');

const hayGit = (() => { try { execFileSync('git', ['--version'], { stdio: 'ignore' }); return true; } catch { return false; } })();
const ROOT = path.join(__dirname, '..');
const esRepo = hayGit && fs.existsSync(path.join(ROOT, '.git'));
// Armados por partes para que este archivo no se denuncie a sí mismo.
const NOMBRE = ['Hip', 'atia'].join('');
const tipos = texto => revisarTexto(texto, 'x.md').map(h => h.tipo);

test('publicación: denuncia correos, rutas reales, llaves, secretos, tokens, IPs y los nombres privados', () => {
  assert.deepStrictEqual(tipos(['ana', 'correo-real.com'].join('@')), ['correo']);
  assert.deepStrictEqual(tipos(['cwd: C:', 'Users', 'an' + 'a', 'Documents'].join('\\')), ['ruta personal']);
  assert.deepStrictEqual(tipos(`cwd: "/home/${'an' + 'a'}/code"`), ['ruta personal']);
  assert.deepStrictEqual(tipos(`om_acme_${'A'.repeat(24)}`), ['llave de oficina']);
  assert.deepStrictEqual(tipos(`whsec_${'b'.repeat(32)}`), ['secreto de webhook']);
  assert.deepStrictEqual(tipos(`crsr_${'c'.repeat(16)}`), ['secreto de webhook']);
  assert.deepStrictEqual(tipos(`token sk-ant-${'d'.repeat(30)}`), ['token']);
  assert.deepStrictEqual(tipos(`http://${[192, 168, 1, 37].join('.')}:4322`), ['IP de red local']);
  assert.deepStrictEqual(tipos(`pregúntale a ${NOMBRE}`), ['nombre privado']);
  assert.deepStrictEqual(tipos(['CO', 'COA'].join('')), ['nombre privado']);
});

test('publicación: los ejemplos genéricos pasan', () => {
  for (const ok of ['C:\\Users\\demo\\proyecto', 'C:\\Users\\<tú>\\.claude', '/home/usuario/code/', 'http://192.168.x.x:4322',
    'Authorization: Bearer om_…', 'om_<oficina>_…', 'whsec_…', 'om_grokeros_llaveinventada123', 'git@github.com:rodvan/OfficeMatrix.git',
    'noreply@anthropic.com', ['tu', 'example.com'].join('@'), 'una empresa ficticia como Acme', 'http://10.0.0.1:1']) {
    assert.deepStrictEqual(tipos(ok), [], ok);
  }
});

test('publicación: en un repositorio de prueba encuentra contenido y archivos ignorados que siguen en el índice', { skip: !hayGit && 'sin git' }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'om-publicacion-'));
  const g = (...a) => execFileSync('git', a, { cwd: dir, stdio: 'ignore' });
  g('init', '-q');
  fs.writeFileSync(path.join(dir, 'README.md'), `Hecho con ${NOMBRE}.\n`);
  fs.writeFileSync(path.join(dir, 'MEMORIA.md'), 'interno\n');
  g('add', '.');
  fs.writeFileSync(path.join(dir, '.gitignore'), 'MEMORIA.md\n');
  g('add', '.gitignore');
  // Aún no está en el índice: `git add -A` lo subiría igual, así que el escáner tiene que verlo.
  fs.writeFileSync(path.join(dir, 'suelto.md'), `Nota con ${NOMBRE}.\n`);
  const h = revisar(dir);
  assert.ok(h.some(x => x.archivo === 'README.md' && x.linea === 1 && x.tipo === 'nombre privado'));
  assert.ok(h.some(x => x.archivo === 'MEMORIA.md' && x.tipo === 'ignorado pero en el índice'));
  assert.ok(h.some(x => x.archivo === 'suelto.md' && x.tipo === 'nombre privado'));
  fs.rmSync(dir, { recursive: true, force: true });
});

test('publicación: este repositorio está limpio (lo que git subiría hoy)', { skip: !esRepo && 'no es un clon de git' }, () => {
  const h = revisar(ROOT);
  assert.deepStrictEqual(h.map(x => `${x.archivo}:${x.linea} [${x.tipo}] ${x.muestra}`), []);
});
