#!/bin/sh
# No instala software ni modifica PATH. Uso: sh instalar.sh. Mensajes en inglés (idioma por defecto).
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
command -v node >/dev/null 2>&1 || { echo 'Node 18+ is missing: https://nodejs.org'; exit 1; }
# stdout.write evita el color de node -p (FORCE_COLOR pinta ESC[33m24ESC[39m).
major=$(node -e 'process.stdout.write(String(parseInt(process.versions.node,10)))')
case $major in ''|*[!0-9]*) echo 'Node 18 or newer is required.'; exit 1 ;; esac
[ "$major" -ge 18 ] || { echo 'Node 18 or newer is required.'; exit 1; }
command -v git >/dev/null 2>&1 || { echo 'git is missing: https://git-scm.com'; exit 1; }
echo 'Node and git are available. Agents (login is not checked):'
node "$root/scripts/comprobar-clis.js"
cat > "$root/iniciar-officematrix.sh" <<'SH'
#!/bin/sh
set -eu
cd -- "$(dirname -- "$0")"
exec node server.js
SH
chmod +x "$root/iniciar-officematrix.sh"
echo 'Install and log in: docs/INSTALL.md and docs/AGENTS.md (Kimi).'
echo 'Done: run ./iniciar-officematrix.sh and open http://localhost:4321 (or your PORT).'
