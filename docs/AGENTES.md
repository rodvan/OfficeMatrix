# Cómo conectar tu propio agente

OfficeMatrix no habla con ninguna API: lanza **la CLI que ya usas en tu terminal**, en la carpeta de la misión, con un prompt
corto («lee `.office/turno.md` y sigue sus instrucciones»). Cualquier CLI que acepte un prompt sin preguntar nada y escriba
en archivos puede entrar en la oficina. Todo se configura en `agents.json`.

> `agents.json` es tuyo y git lo ignora. La primera vez que arrancas, la app lo copia de `agents.example.json` (la plantilla
> del repositorio). Edita siempre `agents.json`; los cambios valen desde el siguiente ciclo, sin reiniciar. Solo reinicia
> `node server.js` si **instalaste** una CLI nueva, para que la detecte.

## 1. Los campos

```jsonc
{
  "id": "mi-cli",               // identificador interno, único, en minúsculas
  "name": "Mi CLI",             // nombre que se ve en la oficina
  "role": "Investigador",       // rol por defecto; cada misión puede cambiarlo
  "color": "#7c5cff",           // color de su estación y de su burbuja
  "avatar": "piloto",           // opcional: lider | elegido | piloto | capitana | operador | sabia
  "enabled": false,             // false = la CLI está configurada pero no entra por defecto en los equipos
  "cmd": "mi-cli",              // ejecutable (en el PATH, o la ruta completa)
  "stream": "text",             // cómo leer su salida en vivo: claude | agy | codex | grok | kimi | text
  "args": ["--prompt", "{prompt}"], // argumentos; {prompt} se reemplaza por el prompt del turno
  "models": ["modelo-a", "modelo-b"], // opcional: si el primero se queda sin cupo, el turno se repite con el siguiente
  "modelFlag": "--model",       // opcional: el flag con el que la CLI elige modelo (obligatorio si hay "models")
  "modelCooldownHours": 24      // opcional: cuánto tiempo se salta un modelo que se quedó sin cupo
}
```

Y fuera de la lista de agentes, para todos:

| Campo | Qué hace | Por defecto |
|---|---|---|
| `maxRounds` | Rondas del modo «rondas fijas» | 3 |
| `autoMaxRounds` | Tope de seguridad del modo automático | 6 |
| `minScore` | Nota mínima para que un APROBADO o un TERMINADO cuenten | 9 |
| `turnTimeoutMinutes` | Tiempo máximo por turno | 20 |
| `idleTimeoutMinutes` | Corta una CLI que lleva este tiempo sin escribir nada (colgada); `0` lo desactiva | 10 |

**El orden** de la lista es el orden por defecto de los turnos.

### `stream`: cómo se lee la salida

| Valor | Para qué CLI | Qué ves |
|---|---|---|
| `claude` | `claude --output-format stream-json --verbose` | Burbuja con cada herramienta, archivos tocados y tokens |
| `codex` | `codex exec --json` | Igual |
| `grok` | `grok --output-format streaming-json` | Igual |
| `agy` | `agy --output-format stream-json` | Igual |
| `kimi` | `kimi -p … --output-format stream-json` | Herramientas y archivos tocados; Kimi no informa de tokens |
| `text` | **Cualquier otra CLI** | Su salida en texto, línea a línea. Sin detalle de herramientas ni tokens |

Con `text` todo lo importante funciona: el turno se lanza, los archivos que tocó se detectan comparando la carpeta antes y
después (no hace falta que la CLI lo cuente), y la nota y el veredicto se leen del bloque final del reporte. Empieza
siempre con `text`; un lector propio solo añade detalle a la burbuja.

### Requisitos para que una CLI funcione

1. **Modo no interactivo:** recibe el prompt por argumento y termina sola. Si se queda esperando una tecla, el turno se corta
   por inactividad.
2. **Escribe archivos sin pedir permiso**, dentro de la carpeta de la misión. Cada CLI tiene su flag (`--permission-mode
   acceptEdits`, `--sandbox workspace-write`, `--always-approve`…). Prefiere el que limita la escritura a la carpeta actual.
3. **Inicio de sesión hecho antes**, en tu terminal. La oficina no puede responder a un navegador ni a un código.

**En el chat de la oficina, la CLI solo lee.** Para un turno de chat, OfficeMatrix quita los flags de escritura de las
CLIs conocidas (`claude`: `--permission-mode plan` y `--disallowedTools Write,Edit,MultiEdit,NotebookEdit,Bash`; `codex`:
`--sandbox read-only`; `grok` y `agy`: sin autoaprobar). Para otra CLI, pon un `"chatArgs"` opcional: sustituye a `args`
solo en el chat.

## 2. Probar un agente nuevo

1. En una terminal, dentro de una carpeta vacía, ejecuta a mano exactamente lo que pondrás en `args`:
   ```powershell
   mkdir prueba; cd prueba
   mi-cli --prompt "Crea hola.txt con la palabra OK y responde: NOTA: 9/10"
   ```
   Debe terminar sola, crear `hola.txt` y no preguntar nada.
2. Añade el perfil a `agents.json` con `"enabled": true` y `"stream": "text"`.
3. Reinicia `node server.js`: la ventana debe mostrar ✅ junto a su nombre.
4. En la app, **Primeros pasos → Probar**, o una misión de una ronda con solo ese agente.
5. Si falla, la tarjeta del turno dice la causa (*no encontrada*, *sin sesión*, *sin cupo*, *colgada*) y qué hacer.

## 3. Ejemplo completo: Kimi (Moonshot AI)

> Comprobado en la documentación oficial el **24 de octubre de 2026**. Kimi no estaba instalado en el equipo de pruebas:
> el perfil se probó con una CLI falsa que imita su salida (`tests/helpers/kimi-falsa.js`). Antes de confiar en él,
> haz la prueba a mano del paso 4.

**En corto: sí funciona con la suscripción, sin API key.** La CLI oficial es **Kimi Code CLI** y el comando es `kimi`.

> ⚠️ **No instales la CLI vieja.** La anterior, `kimi-cli` (en Python, con `uv tool install kimi-cli`), se archivó el
> 23 de septiembre de 2026 y deja de funcionar. Si la tienes, `kimi migrate` pasa tus datos a la nueva. Muchas guías
> antiguas todavía la citan con `--print`.

### 1. Instalar

| Sistema | Comando |
|---|---|
| Windows (PowerShell) | `irm https://code.kimi.com/kimi-code/install.ps1 \| iex` |
| macOS y Linux | `curl -fsSL https://code.kimi.com/kimi-code/install.sh \| bash` |
| Con Homebrew | `brew install kimi-code` |
| Con npm (Node 22.19 o más) | `npm install -g @moonshot-ai/kimi-code` |

El script oficial no necesita Node. En Windows, Kimi necesita **Git for Windows**; si su Git Bash no está en el sitio
de siempre, indica la ruta con la variable `KIMI_SHELL_PATH`. Comprueba la instalación con `kimi --version` (la CLI
nueva va por la 0.x; si ves 1.x, es la vieja).

### 2. Iniciar sesión con la membresía

```powershell
kimi login
```

Abre el flujo de «código de dispositivo»: te da un código y una URL, entras con tu cuenta Kimi y listo. Las credenciales
quedan en `~/.kimi-code/`. También puedes abrir `kimi` y escribir `/login`, que ofrece dos opciones: elige **Kimi Code
OAuth** (tu membresía), no la API key de Moonshot Open Platform.

- **Qué plan hace falta:** Kimi Code va incluido en la membresía Kimi desde **Plus**. El plan Go no trae cupo de código.
  Los planes antiguos (Andante, Moderato, Allegretto) también sirven.
- **Una variable `KIMI_API_KEY` en la terminal no basta:** Kimi la ignora. Si de verdad quieres pagar por API, se configura
  en el `config.toml` de Kimi (ver §4). OfficeMatrix no la necesita.

### 3. Modo no interactivo, salida y permisos

- **El prompt va por argumento:** `kimi -p "<prompt>"`, una sola consulta sin abrir la interfaz. Termina sola. No hace
  falta mandar nada por stdin, así que encaja con cómo OfficeMatrix lanza las CLIs.
- **Formato:** `--output-format text` (por defecto) o `stream-json`, una línea JSON por mensaje, con forma de chat:
  ```json
  {"role":"assistant","content":"…","tool_calls":[{"function":{"name":"WriteFile","arguments":"{…}"}}]}
  {"role":"tool","tool_call_id":"…","content":"…"}
  {"role":"meta","type":"session.resume_hint","session_id":"session_…"}
  ```
  El progreso va a stderr y el pensamiento no se emite. Tampoco informa de tokens: la tarjeta del turno no tendrá ese
  dato. El lector `"stream": "kimi"` entiende este formato. Si un día cambia, pon `"stream": "text"` y quita
  `--output-format stream-json`: el turno sigue funcionando.
- **Cambios en archivos:** con `-p`, Kimi **aprueba solo** sus herramientas (escribir archivos y ejecutar comandos), sin
  preguntar. Por eso la referencia prohíbe combinar `-p` con `--yolo`, `--auto` o `--plan`. Hoy **no hay un flag que limite
  la escritura a la carpeta actual** (como `--sandbox workspace-write` de Codex). Úsalo solo en misiones que no te importe
  que toquen fuera de su carpeta, y revisa lo que cambió.

### 4. El perfil

`agents.example.json` ya lo trae **desactivado**:

```json
{
  "id": "kimi",
  "name": "Kimi",
  "role": "Programador",
  "color": "#3b6cff",
  "enabled": false,
  "cmd": "kimi",
  "stream": "kimi",
  "args": ["-p", "{prompt}", "--output-format", "stream-json"]
}
```

Para activarlo:

1. Instala Kimi e inicia sesión (pasos 1 y 2).
2. Haz la prueba a mano en una carpeta vacía:
   ```powershell
   mkdir prueba; cd prueba
   kimi -p "Crea hola.txt con la palabra OK y responde: NOTA: 9/10"
   ```
   Debe terminar sola y dejar `hola.txt`.
3. En tu `agents.json`, cambia `"enabled": false` por `true`. Si tu `agents.json` es anterior a este perfil, copia el
   bloque de arriba dentro de `"agents"`.
4. Reinicia `node server.js` y comprueba que aparece ✅ junto a Kimi.
5. Para elegir modelo, añade `"modelFlag": "--model"` y `"models": [...]` con los alias que te muestre Kimi. Cada plan
   habilita modelos distintos.

### 5. Límites del plan

- Una **ventana móvil de 5 horas** y un **cupo mensual**. Cuando se acaba el mensual, Kimi Code se congela hasta que se
  renueva o mejoras el plan. Los planes antiguos tienen además una ventana semanal.
- El cupo es **uno solo** para todos tus dispositivos y llaves: la CLI, VS Code, la app de escritorio y las herramientas
  de terceros. Si usas Kimi a la vez fuera de la oficina, gastas del mismo cupo.
- Con `/usage`, dentro de `kimi`, ves cuánto te queda.
- Puedes activar «Extra Usage» para seguir pagando por uso. Viene apagado: déjalo así si no quieres sorpresas.
- La página de la membresía dice que las peticiones desde herramientas de terceros **cuentan** contra el cupo; no
  encontramos una prohibición como la de Antigravity. Aun así, lee los términos vigentes antes de dejarlo en ciclos
  automáticos (§5).

**Fuentes** (consultadas el 24-oct-2026):
- [Referencia del comando `kimi`](https://www.kimi.com/code/docs/en/kimi-code-cli/reference/kimi-command.html): `-p`,
  `--output-format`, `--yolo`, `--auto`, `kimi login`, `kimi migrate`.
- [Kimi Code: visión general](https://www.kimi.com/code/docs/en/) y
  [membresía](https://www.kimi.com/code/docs/en/kimi-code/membership.html): planes, cupos y terceros.
- [MoonshotAI/kimi-code](https://github.com/MoonshotAI/kimi-code): instalación y `/login`.
  [MoonshotAI/kimi-cli](https://github.com/MoonshotAI/kimi-cli): la CLI vieja, archivada.
- [paperclipai/paperclip#9879](https://github.com/paperclipai/paperclip/issues/9879): una captura de `stream-json` y la
  nota sobre `KIMI_API_KEY`, verificadas con kimi 0.27.0. Es una fuente de terceros.

## 4. CLIs que solo funcionan con API key

Algunas CLIs no aceptan una suscripción: solo una API key de pago por uso. Puedes conectarlas igual (la key va en la
configuración de **esa** CLI, nunca en `agents.json` ni en el repositorio), pero ten en cuenta:

- **Pagas cada token.** Un ciclo de tres rondas con cuatro agentes lee y escribe mucho; con API key puede costar varios
  dólares por misión. Con suscripción, el gasto es el cupo que ya pagas.
- **La regla del proyecto es preferir la suscripción.** OfficeMatrix no guarda ni pide API keys, y los perfiles que trae
  usan inicio de sesión. Si una CLI ofrece las dos cosas, documenta la de suscripción.
- Pon un tope de gasto en la consola de ese proveedor antes de activarla.

## 5. Antes de activar una CLI, lee sus términos

Algunos servicios prohíben usar su acceso de suscripción desde software de terceros. Antigravity lo dice en su sección 6 y
por eso viene desactivada (ver [INSTALAR.md](INSTALAR.md)). Revisa los términos de cualquier CLI nueva antes de ponerla a
trabajar en ciclos automáticos.
