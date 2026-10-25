# Instalar OfficeMatrix desde cero

Esta guía es para quien nunca vio el proyecto. Sigue los pasos en orden. Windows va primero; en cada paso hay una nota para
macOS y Linux. No necesitas API keys ni permisos de administrador: cada IA entra con **tu suscripción**.

| Paso | Qué haces | Tiempo |
|---|---|---|
| 1 | Instalar Node 18+ y git | 5 min |
| 2 | Clonar y arrancar (`node server.js`) | 2 min |
| 3 | Abrir `http://localhost:4321` | 1 min |
| 4 | Instalar e iniciar sesión en tus CLIs (una basta) | 5 min cada una |
| 5 | Primera misión de prueba | 3 min |
| 6 | Opcional: oficinas, celular, agentes externos, Grok Bots, ViralHunt | — |

> **Atajo:** después del paso 2 puedes ejecutar el instalador (`instalar.ps1` o `instalar.sh`). Comprueba Node y git, te dice
> qué CLIs tienes y cuáles faltan, y crea el acceso directo. No instala nada ni toca tu PATH sin preguntarte.

Desde la carpeta clonada, ejecuta `powershell -NoProfile -ExecutionPolicy Bypass -File .\instalar.ps1` en Windows
(el permiso solo afecta a ese proceso), o `sh instalar.sh` en macOS/Linux. Se crea `iniciar-officematrix.cmd` o
`iniciar-officematrix.sh` en esa misma carpeta. Los comandos mostrados son instrucciones: el instalador no los ejecuta.
En macOS/Linux arranca después con `./iniciar-officematrix.sh`.

---

## 1. Node.js 18 o más nuevo, y git

**Windows** (PowerShell, sin administrador):

```powershell
winget install OpenJS.NodeJS.LTS
winget install Git.Git
```

Cierra la terminal y abre otra. Comprueba:

```powershell
node --version   # v18 o más
git --version
```

Si `winget` no existe, descarga los instaladores de https://nodejs.org y https://git-scm.com.

**macOS:** `brew install node git` (con [Homebrew](https://brew.sh)). **Linux:** el Node de tu distribución suele ser viejo;
usa el de https://nodejs.org o `nvm`. `git` viene en casi todas (`sudo apt install git` si no).

### Permitir scripts en PowerShell (Windows, una sola vez)

Varias CLIs se instalan como scripts `.ps1`, y Windows los bloquea por defecto (error *running scripts is disabled on this
system*). Esto solo afecta a tu usuario y no pide administrador:

```powershell
Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
```

## 2. Clonar y arrancar

```powershell
git clone https://github.com/rodvan/OfficeMatrix.git
cd OfficeMatrix
node server.js
```

OfficeMatrix **no tiene dependencias**: no hace falta `npm install`. La ventana del servidor muestra qué agentes encontró:

```
  ✅ Claude    streaming: claude
  ❌ Codex     streaming: codex
  ❌ Gemini   (desactivado) streaming: agy
```

Un ❌ no es un error: esa CLI aún no está instalada y la oficina funciona con las que haya.

La primera vez se crean solos:

- `agents.json`, copiado de `agents.example.json`. Es **tu** configuración: git lo ignora y un `git pull` nunca lo pisa.
- `proyectos/` (tus misiones) y `memoria/` (el cerebro compartido). También están en `.gitignore`.

Para arrancar otro día: doble clic en `iniciar-officematrix.cmd` (Windows) o `./iniciar-officematrix.sh` (macOS y Linux). Los crea el instalador y respetan `PORT`. El repositorio trae también `iniciar.bat`, que arranca siempre en el puerto 4321 y abre el navegador.
Si cierras la ventana del servidor, la oficina se apaga.

## 3. Abrir la oficina

Abre **http://localhost:4321**. La primera vez aparece **Primeros pasos**: la lista de CLIs con su estado, el comando para
instalar cada una, el de iniciar sesión y un botón **Probar** que lanza un turno mínimo. Puedes volver a abrirlo desde el
botón **Primeros pasos** de la barra superior.

¿El puerto 4321 está ocupado? Usa otro: `$env:PORT=4330; node server.js` (macOS/Linux: `PORT=4330 node server.js`).

## 4. Tus agentes: instalar e iniciar sesión

Con **una** CLI ya puedes trabajar; con dos o más empiezan las revisiones cruzadas. Para cada una: instala, **abre una
terminal nueva**, inicia sesión con tu cuenta y haz la prueba. Si la prueba responde `OK`, vuelve a la app y pulsa
**Probar** en Primeros pasos (o reinicia `node server.js` para que la detecte).

| CLI | Suscripción | Comando |
|---|---|---|
| Claude Code | Claude Pro o Max | `claude` |
| Codex | ChatGPT Plus o Pro | `codex` |
| Grok Build | X Premium o SuperGrok | `grok` |
| Antigravity (Gemini) | Google AI Pro o Ultra | `agy` — **desactivada por defecto**, lee el aviso |

¿Quieres otra (Kimi, o la que salga mañana)? Ver [docs/AGENTES.md](AGENTES.md).

### Claude Code (Anthropic)

```powershell
irm https://claude.ai/install.ps1 | iex      # macOS/Linux: curl -fsSL https://claude.ai/install.sh | bash
claude                                       # la primera vez abre el navegador: entra con tu cuenta Pro o Max
claude -p "Responde solo: OK"
```

- Al iniciar sesión, elige la cuenta con suscripción, no «API key / Console»: con API key pagas por uso.
- La primera ejecución dentro de una carpeta pregunta si confías en ella. OfficeMatrix lanza cada turno en la carpeta de la
  misión con `--permission-mode acceptEdits` y una lista de herramientas permitidas (ver `agents.example.json`).

### Codex (OpenAI / ChatGPT)

```powershell
npm install -g @openai/codex
codex login                                  # entra con tu cuenta de ChatGPT
codex exec --skip-git-repo-check "Responde solo: OK"
```

- En Windows, si sale *running scripts is disabled*, vuelve al paso 1 (PowerShell) o usa `codex.cmd`.
- OfficeMatrix lo lanza con `--sandbox workspace-write`: solo escribe dentro de la carpeta de la misión.

### Grok Build (xAI)

```powershell
irm https://x.ai/cli/install.ps1 | iex       # macOS/Linux: ver https://x.ai/cli
grok --version
grok login                                   # entra con la cuenta de X que tiene tu membresía
grok -p "Responde solo: OK"
```

- Usa la CLI **oficial**. El paquete de npm `@vibe-kit/grok-cli` no es oficial, pide API key de pago y también se llama
  `grok`. Si lo tienes: `npm uninstall -g @vibe-kit/grok-cli`.
- xAI no publica qué membresías incluyen la CLI. Si la tuya no la incluye, deja a Grok desactivado y sigue con los demás.

### Antigravity (`agy`, modelos Gemini) — desactivada por defecto

> ⚠️ **Lee esto antes de activarla.** Los términos de Antigravity (sección 6) dicen que usar software de terceros para
> acceder al servicio es un incumplimiento del acuerdo. OfficeMatrix es software de terceros que lanza `agy` por ti. Por eso
> viene con `"enabled": false`. Si aceptas ese riesgo con tu cuenta, cámbialo a `true` en tu `agents.json`.
>
> La antigua Gemini CLI (`gemini`) ya no funciona con cuentas personales desde el 18-jun-2026 (*This client is no longer
> supported for Gemini Code Assist for individuals*).

```powershell
irm https://antigravity.google/cli/install.ps1 | iex
agy --version
agy                                          # abre el navegador: entra con la cuenta de tu suscripción
agy -p "Responde solo: OK"
```

Si Google te muestra un **código de autorización**, pégalo en la misma terminal de `agy` antes de 60 segundos. No lo compartas.

### Problemas típicos

| Síntoma | Qué hacer |
|---|---|
| `no se reconoce como nombre de un cmdlet` / `command not found` justo después de instalar | Cierra la terminal y abre otra: el PATH nuevo solo lo ven las terminales nuevas. Después reinicia `node server.js` |
| Sigue sin encontrarse | Comprueba dónde quedó: `where.exe claude` (Windows) o `command -v claude`. Si no aparece, reinstala; el instalador **no** toca tu PATH |
| `running scripts is disabled on this system` | `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` (paso 1) |
| La primera ejecución se queda esperando | La CLI está preguntando algo (confiar en la carpeta, iniciar sesión). Ejecútala una vez a mano en una terminal y responde |
| `401`, `not logged in`, `token expired` | Vuelve a iniciar sesión en esa CLI |
| `usage limit`, `rate limit`, `402` | Se acabó el cupo de tu plan. La app lo marca en el turno y sigue con los demás; vuelve a intentarlo cuando se renueve |
| Grok: `API key required` | Tienes la CLI no oficial de npm (ver arriba) |

Más casos en la sección «Solución de problemas» del [README](../README.es.md).

## 5. Primera misión de prueba (barata)

1. En la app, **Nueva misión**.
2. Pedido: `Escribe un README.md de diez líneas que explique qué es una lista de tareas.`
3. Modo **Relevo**, **1 ronda**, y solo uno o dos agentes.
4. Lanza. Verás a cada agente caminar a su puesto, la burbuja con lo que hace y, al final, su nota y su veredicto.
5. Abre el entregable en el visor (clic en el archivo).

Una misión así gasta pocos minutos de tu cupo. Cuando funcione, sube rondas y agentes.

¿Quieres verla sin gastar nada? La demo con agentes falsos:

```powershell
node tests/helpers/demo-server.js 4400 120   # abre http://localhost:4400; se cierra sola a los 120 s
```

## 6. Opcional

- **Oficinas:** espacios aislados, cada uno con sus misiones, su cerebro y su equipo. Botón 🏢 en la barra superior. Ver la
  sección «Oficinas» del README.
- **Desde el celular, en tu red:** `node lan.js` publica la oficina en `http://192.168.x.x:4322` con una contraseña. Ver
  `lan.js`.
- **Un agente externo** (tu propio asistente) puede crear y seguir misiones de una sola oficina con una **llave de oficina**
  y el cliente `om.js`. Ver [docs/PARA-AGENTES.md](PARA-AGENTES.md).
- **Grok Bots:** tus bots de Grok como empleados de una oficina, por webhook. Ver [docs/es/GROK-BOTS.md](es/GROK-BOTS.md).
- **ViralHunt:** la oficina editorial propone piezas y tú apruebas; los borradores quedan en ViralHunt. Ver el README.

## Desinstalar

Cierra el servidor y borra la carpeta. Tus misiones y tu cerebro están dentro (`proyectos/`, `memoria/`, `oficinas/`):
cópialos antes si los quieres conservar. Las CLIs se desinstalan con su propio método (`npm uninstall -g @openai/codex`, etc.).
