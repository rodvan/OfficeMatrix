// Prepara la rama huérfana «publico» con un solo commit, sin mover HEAD ni tocar el índice ni los archivos de trabajo:
// usa un índice temporal (lo mismo que entraría con `git add -A`), escribe docs/LISTA-PUBLICA.txt con la lista de
// archivos, crea el commit sin padre y lo comprueba desde un clon de solo esa rama con `revisar-publicacion --historial`.
//   node scripts/preparar-publico.js [--rehacer]   (--rehacer sustituye una rama «publico» que ya exista)
// No sube nada. El push lo hace a mano quien mantiene el repositorio (ver docs/PUBLICAR.md).
'use strict';
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = path.join(__dirname, '..');
const RAMA = 'publico';
const MENSAJE = 'OfficeMatrix: first public release\n\nCo-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>';
const git = (args, opts = {}) => execFileSync('git', args, { cwd: root, encoding: 'utf8', ...opts }).trim();
const escaner = (cwd, extra = []) => execFileSync(process.execPath, [path.join(cwd, 'scripts/revisar-publicacion.js'), ...extra], { cwd, encoding: 'utf8' });

function main() {
  const existe = (() => { try { git(['rev-parse', '--verify', '--quiet', `refs/heads/${RAMA}`]); return true; } catch { return false; } })();
  if (existe && !process.argv.includes('--rehacer')) throw new Error(`Branch ${RAMA} already exists. Use --rehacer to replace it.`);
  if (git(['symbolic-ref', '--short', 'HEAD']) === RAMA) throw new Error(`You are on ${RAMA}: switch back to your working branch before rebuilding it.`);
  console.log(escaner(root).trim());

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'om-publico-'));
  const env = { ...process.env, GIT_INDEX_FILE: path.join(tmp, 'index') };
  try {
    git(['add', '-A'], { env });
    const lista = path.join(root, 'docs', 'LISTA-PUBLICA.txt');
    const archivos = new Set(git(['ls-files'], { env }).split('\n').filter(Boolean));
    archivos.add('docs/LISTA-PUBLICA.txt');
    fs.writeFileSync(lista, [...archivos].sort().join('\n') + '\n');
    git(['add', 'docs/LISTA-PUBLICA.txt'], { env });
    const arbol = git(['write-tree'], { env });
    const commit = execFileSync('git', ['commit-tree', arbol], { cwd: root, encoding: 'utf8', input: `${MENSAJE}\n` }).trim();
    git(['update-ref', `refs/heads/${RAMA}`, commit]);
    console.log(`Branch ${RAMA}: parentless commit ${commit.slice(0, 10)}, ${archivos.size} files (list in docs/LISTA-PUBLICA.txt).`);

    // Un usuario nuevo solo verá esta rama: se comprueba su historia entera desde un clon.
    const clon = path.join(tmp, 'clon');
    git(['clone', '--quiet', '--single-branch', '-b', RAMA, root, clon]);
    const commits = execFileSync('git', ['rev-list', '--all', '--count'], { cwd: clon, encoding: 'utf8' }).trim();
    if (commits !== '1') throw new Error(`The clone has ${commits} commits; it should have 1`);
    console.log(escaner(clon, ['--historial']).trim());
    console.log('Nothing has been pushed. To publish: git push <remote> publico:main');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

try { main(); } catch (err) { console.error(err.stdout || err.message); process.exit(1); }
