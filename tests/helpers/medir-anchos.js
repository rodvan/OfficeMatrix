// Mide la interfaz a varios anchos con tests/helpers/ui-probe.js: scroll horizontal, elementos que se salen, objetivos
// táctiles de menos de 44 px, si la escena cabe sin deformarse y si los paneles se tapan. Guarda una captura por ancho.
//   node tests/helpers/medir-anchos.js <url> <carpeta> [prefijo=gui] [anchos=360,390,768,1024,1440]
// Ejemplo: node tests/helpers/medir-anchos.js "http://localhost:4400/#s=acme-ciencia-redaccion" docs/evidencia/gui antes
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const [url, dir, prefix = 'gui', list = '360,390,768,1024,1440'] = process.argv.slice(2);
if (!url || !dir) { console.error('uso: medir-anchos.js <url> <carpeta> [prefijo] [anchos]'); process.exit(2); }
fs.mkdirSync(dir, { recursive: true });

// Se evalúa en la página. Solo cuenta lo visible (con caja y sin visibility:hidden).
const MEDIR = `(() => {
  const W = innerWidth, vis = e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== 'hidden'; };
  const name = e => e.tagName.toLowerCase() + (e.id ? '#' + e.id : '') + (typeof e.className === 'string' && e.className ? '.' + e.className.trim().split(/\\s+/).slice(0, 2).join('.') : '');
  // Se sale por la derecha y no está dentro de un contenedor con su propio scroll horizontal.
  const clipped = e => { for (let p = e.parentElement; p; p = p.parentElement) { const s = getComputedStyle(p); if (/(auto|scroll|hidden)/.test(s.overflowX) && p !== document.body && p !== document.documentElement) return true; } return false; };
  const fuera = [...document.querySelectorAll('body *')].filter(e => vis(e) && e.getBoundingClientRect().right > W + 1 && !clipped(e)).map(name);
  const tactiles = [...document.querySelectorAll('button, a[href], select, input:not([type=hidden]), summary, label.btn, [role=tab]')]
    .filter(e => vis(e) && !e.closest('dialog:not([open])')).map(e => [name(e), e.getBoundingClientRect()]).filter(([, r]) => r.height < 44 || r.width < 44);
  const stage = document.querySelector('.deck.nave .stage'), sr = stage && stage.getBoundingClientRect();
  const ratio = stage && Number((stage.style.aspectRatio || getComputedStyle(stage).aspectRatio).split('/').reduce((a, b) => a / b));
  const panel = s => { const e = document.querySelector(s); if (!e || !vis(e)) return null; const r = e.getBoundingClientRect(); return [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)]; };
  return {
    ancho: W, scrollX: document.documentElement.scrollWidth - W,
    fuera: [...new Set(fuera)].slice(0, 12), nFuera: fuera.length,
    tactilesPequenos: tactiles.length, ejemplos: [...new Set(tactiles.map(([n, r]) => n + ' ' + Math.round(r.width) + 'x' + Math.round(r.height)))].slice(0, 10),
    escena: sr ? { ancho: Math.round(sr.width), alto: Math.round(sr.height), cabe: sr.left >= -1 && sr.right <= W + 1, deformada: ratio ? Math.abs(sr.width / sr.height - ratio) > 0.02 : null } : null,
    paneles: { misiones: panel('.missions'), ops: panel('.ops'), intel: panel('.intel'), tablero: panel('.board') },
  };
})()`;

const out = {};
for (const w of list.split(',').map(Number)) {
  const shot = path.join(dir, `${prefix}-${w}.png`);
  const h = w < 800 ? 800 : 900;
  const res = execFileSync(process.execPath, [path.join(__dirname, 'ui-probe.js'), url, '--wait=7000', `--size=${w},${h}`, `--eval=${MEDIR}`, `--shot=${shot}`], { encoding: 'utf8' });
  const line = res.split('\n').find(l => l.trim().startsWith('{'));
  out[w] = line ? JSON.parse(line) : res;
  console.log(w, JSON.stringify(out[w]));
}
fs.writeFileSync(path.join(dir, `${prefix}-medidas.json`), JSON.stringify(out, null, 2));
