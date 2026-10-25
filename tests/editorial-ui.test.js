const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const source = fs.readFileSync(require.resolve('../public/editorial'), 'utf8');
function setup() {
  const nodes = new Map(), pending = [];
  const node = id => { if (!nodes.has(id)) nodes.set(id, { innerHTML: '', addEventListener() {}, showModal() { this.open = true; } }); return nodes.get(id); };
  const ctx = { URL, location: { origin: 'http://127.0.0.1:4400' }, document: { body: { insertAdjacentHTML() {} }, getElementById: node }, $: node,
    oficina: 'a', officeEpoch: 0, officeNow: () => ({ nombre: ctx.oficina }),
    esc: s => String(s ?? '').replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`),
    api: url => new Promise(resolve => pending.push({ url, resolve })),
    t: require('../lib/i18n').t };
  vm.createContext(ctx); vm.runInContext(source, ctx);
  return { ctx, nodes, pending };
}
const regla = { marca: { nombre: 'Marca' }, zona: 'UTC', horas: ['09:00', '17:00'], destino: 'borrador' };
test('bandeja: respuestas invertidas y A → B → A no cruzan propuestas ni diálogos', async () => {
  const { ctx, nodes, pending } = setup();
  const old = ctx.openEditorialConfig(); const stale = pending.splice(0);
  ctx.oficina = 'b'; ctx.officeEpoch++;
  ctx.oficina = 'a'; ctx.officeEpoch++;
  const fresh = ctx.loadEditorial();
  pending.shift().resolve({ regla, viralhunt: {}, configurada: true }); pending.shift().resolve([]); await fresh;
  stale[0].resolve({ regla: { ...regla, marca: { nombre: 'CANARIO-ANTIGUO' } }, viralhunt: {} }); stale[1].resolve([]); await old;
  assert.doesNotMatch(nodes.get('tab-editorial').innerHTML, /CANARIO/);
  assert.ok(!nodes.get('editorialDialog').open, 'un await antiguo no abre configuración');
});
test('tarjeta: escapa contenido, bloquea javascript y explica Review sin acciones de aprobación repetidas', () => {
  const { ctx } = setup();
  const html = ctx.edCard({ id: '2026-10-24-1', estado: 'aprobada', hook: '<script>x</script>', copy: { x: '<img onerror=x>' }, fuente: { url: 'javascript:alert(1)' }, viralhunt: { donde: 'revision', url: 'javascript:x' } }, regla, 'a');
  assert.doesNotMatch(html, /<script>|<img onerror|href="javascript|data-ed-action/);
  assert.match(html, /(?:En Review: falta autorización|In Review: .*authorization)/);
});
test('tarjeta: descarte y cambios pendientes explican su estado sin botones de decisión', () => {
  const { ctx } = setup();
  for (const estado of ['descartada', 'en-cambios']) {
    const html = ctx.edCard({ id: '2026-10-24-1', estado, hook: 'Idea', motivoDescarte: estado === 'descartada' ? 'Copia literal' : null }, regla, 'a');
    assert.doesNotMatch(html, /data-ed-action/);
    assert.match(html, estado === 'descartada' ? /(?:Copia literal|Literal copy)/ : /(?:El equipo está ajustando|team is adjusting)/i);
  }
});
