const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { spawnSync } = require('node:child_process');
const catalog = require('../public/primeros-pasos');

test('Primeros pasos: falta una CLI, opcionales apagadas y prueba de un único agente en edificio', async () => {
  const elements = new Map();
  const $ = id => {
    if (!elements.has(id)) elements.set(id, { open: false, showModal() { this.open = true; }, close() { this.open = false; } });
    return elements.get(id);
  };
  const calls = [];
  let opened;
  const context = vm.createContext({ $, primerosPasosCatalog: catalog, esc: s => String(s ?? '').replaceAll('<', '&lt;').replaceAll('"', '&quot;'),
    localStorage: { setItem() {} }, toast() {}, openChat: async id => { opened = id; }, t: require('../lib/i18n').t,
    fetch: async (url, opts) => {
      calls.push({ url, opts });
      return { ok: true, json: async () => url.startsWith('/api/agents') ? { agents: [
        { id: 'claude', name: '<Claude>', installed: true, enabled: true },
        { id: 'codex', name: 'Codex', installed: false, enabled: true },
        { id: 'kimi', name: 'Kimi', installed: true, enabled: false },
      ] } : { id: 'prueba' } };
    },
  });
  const source = fs.readFileSync(require.resolve('../public/app.js'), 'utf8');
  vm.runInContext(source.slice(source.indexOf('async function setupRequest'), source.indexOf('// Un fallo de la interfaz')), context);
  await context.showSetup();
  assert.match($('setupAgents').innerHTML, /&lt;Claude>/);
  assert.match($('setupAgents').innerHTML, /data-setup-test="codex" disabled/);
  assert.match($('setupAgents').innerHTML, /data-setup-test="kimi" disabled/);
  assert.match($('setupAgents').innerHTML, /Codex · Not installed/, 'el asistente sale en inglés por defecto');
  assert.match($('setupAgents').innerHTML, /Optional\. Turn it on in agents\.json/);
  const btn = { disabled: false, dataset: { setupTest: 'claude' } };
  await $('setupAgents').onclick({ target: { closest: () => btn } });
  assert.equal(opened, 'prueba');
  assert.equal(calls[1].url, '/api/chats?oficina=edificio');
  const body = JSON.parse(calls[1].opts.body);
  assert.deepEqual(body.config.team, [{ id: 'claude' }]);
  assert.equal(body.config.maxRounds, 1);
  assert.equal(body.config.workflow, 'relevo');
});

test('instalar.ps1 acepta la versión de Node y crea el acceso directo', { skip: process.platform !== 'win32' && 'solo Windows' }, () => {
  const root = path.join(__dirname, '..');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'om-instalar-'));
  for (const rel of ['instalar.ps1', 'agents.example.json', 'scripts/comprobar-clis.js', 'public/primeros-pasos.js', 'lib/i18n.js', 'public/i18n.js', 'public/i18n/en.json', 'public/i18n/es.json']) {
    const dest = path.join(dir, rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(path.join(root, rel), dest);
  }
  const r = spawnSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(dir, 'instalar.ps1')], {
    cwd: dir, encoding: 'utf8', env: { ...process.env, FORCE_COLOR: '1', NO_COLOR: '1' },
  });
  assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
  assert.match(fs.readFileSync(path.join(dir, 'iniciar-officematrix.cmd'), 'utf8'), /node server\.js/);
  fs.rmSync(dir, { recursive: true, force: true });
});
