# No instala software ni modifica PATH. Ejecutar desde PowerShell, sin administrador. Mensajes en inglés (idioma por defecto).
$ErrorActionPreference = 'Stop'
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw 'Node 18+ is missing: https://nodejs.org. Open a new terminal after installing it.' }
# node -p pinta el número con color si FORCE_COLOR está definido (ESC[33m24ESC[39m).
# En pantalla se lee 24, pero [int] falla. stdout.write no colorea ni añade retorno.
$majorText = "$(& node -e 'process.stdout.write(String(parseInt(process.versions.node,10)))')".Trim()
if ($LASTEXITCODE -ne 0 -or $majorText -notmatch '^\d+$' -or [int]$majorText -lt 18) { throw 'Node 18 or newer is required.' }
if (-not (Get-Command git -ErrorAction SilentlyContinue)) { throw 'git is missing: https://git-scm.com. Open a new terminal after installing it.' }
Write-Host 'Node and git are available. Checking agents (login is not checked):'
& node (Join-Path $PSScriptRoot 'scripts/comprobar-clis.js')
if ($LASTEXITCODE -ne 0) { throw 'Could not check the CLIs.' }
Write-Host 'Install and log in to each CLI: docs/INSTALL.md and docs/AGENTS.md (Kimi).'
$launcher = '@echo off' + "`r`n" + 'cd /d "%~dp0"' + "`r`n" + 'node server.js' + "`r`n" + 'pause' + "`r`n"
Set-Content -LiteralPath (Join-Path $PSScriptRoot 'iniciar-officematrix.cmd') -Value $launcher -Encoding ASCII
Write-Host 'Done. Open iniciar-officematrix.cmd and visit http://localhost:4321. Set PORT to use another port.'
