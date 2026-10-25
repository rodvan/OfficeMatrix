// Adjuntos del usuario: nombre seguro, subida temporal, paso a <proyecto>/adjuntos/ y texto extraído de los PDF.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { stage, attach, describe, safeName } = require('../lib/adjuntos');

// PDF mínimo de una página con el texto "Contrato de prueba".
function tinyPdf() {
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    null,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  const stream = 'BT /F1 18 Tf 20 100 Td (Contrato de prueba) Tj ET';
  objs[3] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
  let out = '%PDF-1.4\n';
  const offsets = [];
  objs.forEach((o, i) => { offsets.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map(n => `${String(n).padStart(10, '0')} 00000 n \n`).join('')}`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

test('nombre seguro: sin rutas ni caracteres prohibidos en Windows', () => {
  assert.strictEqual(safeName('../../etc/passwd'), 'passwd');
  assert.strictEqual(safeName('C:\\Users\\demo\\contrato final.pdf'), 'contrato final.pdf');
  assert.strictEqual(safeName('a<b>:c?.pdf'), 'a_b__c_.pdf');
  assert.strictEqual(safeName('...'), 'archivo');
});

test('subida → misión: se mueve a adjuntos/, sin pisar otro del mismo nombre, y el PDF trae su texto', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'om-adj-'));
  const staging = path.join(tmp, '.subidas'), project = path.join(tmp, 'proyecto');
  fs.mkdirSync(project);
  const a = stage(staging, 'contrato.pdf', tinyPdf());
  const b = stage(staging, 'contrato.pdf', tinyPdf());
  const c = stage(staging, 'nota.txt', Buffer.from('hola'));
  const items = attach(staging, [a.id, b.id, c.id, 'no-es-un-id', '../../x'], project);
  assert.deepStrictEqual(items.map(i => i.file), ['adjuntos/contrato.pdf', 'adjuntos/contrato (2).pdf', 'adjuntos/nota.txt']);
  assert.ok(fs.existsSync(path.join(project, 'adjuntos', 'nota.txt')));
  assert.deepStrictEqual(fs.readdirSync(staging), [], 'el área temporal queda vacía');
  if (items[0].text) { // solo si hay pdftotext (viene con Git para Windows)
    assert.match(fs.readFileSync(path.join(project, items[0].text), 'utf8'), /Contrato de prueba/);
    assert.strictEqual(items[0].pages, 1);
    assert.strictEqual(items[0].scanned, false);
  }
  const block = describe(items);
  assert.match(block, /adjuntos\/contrato\.pdf/);
  assert.match(block, /adjuntos\/nota\.txt \(1 KB\)/);
  assert.strictEqual(describe([]), '');
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('un archivo vacío se rechaza', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'om-adj-'));
  assert.throws(() => stage(tmp, 'x.pdf', Buffer.alloc(0)), /empty/);
  fs.rmSync(tmp, { recursive: true, force: true });
});
