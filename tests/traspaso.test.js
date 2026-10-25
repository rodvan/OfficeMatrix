const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createTraspasos } = require('../lib/traspaso');

test('traspasos con igual título y segundo conservan ambas entradas y aceptan nombres anteriores', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'om-traspaso-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  t.mock.method(Date.prototype, 'toISOString', () => '2026-10-23T12:34:56.000Z');
  const registry = {
    read: id => ({ nombre: id }),
    dirs: id => ({ memoria: path.join(dir, id, 'memoria') }),
  };
  for (const id of ['a', 'b']) fs.mkdirSync(registry.dirs(id).memoria, { recursive: true });
  // Título largo: también se debe poder listar y aceptar el nombre con sufijo.
  const title = 'a'.repeat(50);
  for (const [name, content] of [['uno.md', 'PRIMERA'], ['dos.md', 'SEGUNDA']]) {
    fs.writeFileSync(path.join(registry.dirs('a').memoria, name), `### ${title}\n${content}\n`);
  }
  const tr = createTraspasos(dir, registry);
  const first = tr.traspasar('a', { name: 'uno.md', index: 0, destino: 'b' });
  const second = tr.traspasar('a', { name: 'dos.md', index: 0, destino: 'b' });
  assert.notEqual(first.archivo, second.archivo);
  const pending = tr.listar('b');
  assert.equal(pending.length, 2);
  assert.match(pending.find(e => e.archivo === first.archivo).content, /PRIMERA/);
  assert.match(pending.find(e => e.archivo === second.archivo).content, /SEGUNDA/);
  tr.aceptar('b', first.archivo, 'lecciones.md');
  tr.aceptar('b', second.archivo, 'lecciones.md');
  assert.match(fs.readFileSync(path.join(registry.dirs('b').memoria, 'lecciones.md'), 'utf8'), /PRIMERA[\s\S]*SEGUNDA/);
  assert.deepEqual(tr.listar('b'), []);
});
