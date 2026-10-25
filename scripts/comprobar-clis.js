// Solo detección: no ejecuta una CLI ni toca la autenticación. Los textos salen en el idioma elegido (EN por defecto).
const { spawnSync } = require('child_process');
const catalog = require('../public/primeros-pasos');
const { t } = require('../lib/i18n');
for (const a of require('../agents.example.json').agents) {
  const windows = process.platform === 'win32';
  const r = windows ? spawnSync('where.exe', [a.cmd], { windowsHide: true })
    : spawnSync('sh', ['-c', 'command -v "$1"', 'check', a.cmd]);
  console.log(t('setup.cli.line', { name: a.name, state: t(r.status === 0 ? 'setup.cli.found' : 'setup.cli.missing'), enabled: a.enabled }));
  const help = catalog[a.id];
  if (help) {
    if (r.status !== 0) console.log(`  ${t('setup.install')}: ${help[windows ? 'windows' : 'unix']}`);
    console.log(`  ${t('setup.login')}: ${help.login}`);
    if (help.noteKey) console.log(`  ${t(help.noteKey)}`);
  }
}
