const test = require('node:test');
const assert = require('node:assert');
const { expandir, deReg, fusionar } = require('../lib/ruta-sistema');

test('deReg saca el valor de Path de reg query', () => {
  const out = '\r\nHKEY_CURRENT_USER\\Environment\r\n    Path    REG_EXPAND_SZ    %USERPROFILE%\\.grok\\bin;C:\\x\r\n\r\n';
  assert.strictEqual(deReg(out), '%USERPROFILE%\\.grok\\bin;C:\\x');
  assert.strictEqual(deReg(''), '');
});

test('expandir resuelve %VAR% sin importar mayúsculas y deja las desconocidas', () => {
  assert.strictEqual(expandir('%userprofile%\\a;%NOPE%', { USERPROFILE: 'C:\\U' }), 'C:\\U\\a;%NOPE%');
});

test('fusionar añade lo que falta del registro, sin duplicados ni entradas rotas', () => {
  const env = { USERPROFILE: 'C:\\U' };
  const r = fusionar('C:\\U\\.local\\bin;C:\\npm\\', ["%USERPROFILE%\\.grok\\bin;C:\\npm;[Environment]::GetEnvironmentVariable('PATH', 'User')", 'C:\\U\\.kimi-code\\bin'], env);
  assert.deepStrictEqual(r.split(';'), ['C:\\U\\.local\\bin', 'C:\\npm\\', 'C:\\U\\.grok\\bin', 'C:\\U\\.kimi-code\\bin']);
});
