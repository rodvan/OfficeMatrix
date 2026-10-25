# Simulaciones de OfficeMatrix: oficinas aisladas que trabajan solas

Especificación construible · versión final del Consejo (síntesis del presidente, ronda 2) · 23-oct-2026

Parte de `referencia/propuesta-anterior/PROPUESTA.md` §6 y de sus plantillas `oficinas/`. Lo que allí ya estaba bien (puestos fijos, ficha corta, `poderes` como organigrama, aviso de falsa diversidad, protocolo artefacto → objeción → verificación, reuniones, ritmos con zona IANA, guardia que puede no convocar, Telegram de la §8) **se mantiene y no se repite**. Este documento cambia lo que el usuario pidió distinto (aislamiento, vista interior) y baja a código lo que allí era idea.

Qué toma de cada borrador del consejo: `LEEME.md`. Fuentes de las APIs: `investigacion/fuentes-apis.md`. Todas las consultas, 23-oct-2026.

---

## 0. Las doce decisiones

| # | Decisión | Por qué, en una línea |
|---|---|---|
| D1 | **Herencia cero.** Una simulación no lee el cerebro del edificio ni el de otra. Solo entra lo que tú traspasas, entrada a entrada, y aceptas dentro de la simulación destino. | La §6.5 anterior dejaba leer «entradas relevantes del edificio». Relevancia automática = fuga automática. |
| D2 | **El aislamiento lo aplica el motor, no el prompt**, en dos capas: *contexto* (qué recibe el modelo) y *frontera* (qué puede abrir el proceso). | Un modelo no puede «olvidar» lo que le llega, y un «no leas» no impide leer. |
| D3 | **Dos niveles con nombre honesto.** `contexto`: carpeta, memoria, entorno y hogares de CLI propios. `cuenta`: además, cada simulación corre como **otro usuario local de Windows** con ACL. Una VM por oficina (`blindado`) queda como opción posterior. | Separar carpetas no impide que una CLI con shell lea `..\otra-simulacion\`. Un usuario de Windows sí lo impide, sin Hyper-V, sin dependencias y en Windows Home. |
| D4 | **Lo que corre sin ti corre detrás de la frontera.** Rutinas desatendidas y conectores exigen nivel `cuenta`. En `contexto` solo hay misiones manuales, con el chip «contexto» visible. | En `contexto` las CLIs corren con tu usuario: pueden leer tu perfil y descifrar lo que DPAPI protege para ti. |
| D5 | **El edificio es la simulación `edificio`** y se queda donde está. Las nuevas viven en `simulaciones/<id>/`. Las rutas viejas de la API son alias del edificio. | Cero archivos movidos: ninguna misión existente se rompe. |
| D6 | **El personaje no es el modelo.** Cada empleado tiene `modelo`, `modelo_rapido` y `reserva`, cada uno `{cli, id}`. Cada turno registra el modelo pedido y el que la CLI resolvió. | Cambiar de modelo no borra carácter ni memoria; y se sabe con qué se trabajó. |
| D7 | **Los agentes nunca tocan credenciales ni APIs externas.** El servidor descarga datos a la carpeta; los agentes escriben **solicitudes**; tú apruebas; el servidor ejecuta. | Si la credencial no está a su alcance y la acción no pasa por él, no hay fuga ni gasto sorpresa. |
| D8 | **Cuatro niveles de riesgo** (N0 leer · N1 borrador externo · N2 publicar · N3 gastar). La aprobación se ata al **hash del conjunto entero** (texto, medios, cuenta, importe, caducidad). N3 nunca desde Telegram. | Publicar se puede deshacer a medias; gastar, no. |
| D9 | **Nada se reintenta a ciegas.** Un envío sin respuesta queda `incierto` y se pregunta. Dos clics producen un envío. Deshacer es una acción nueva. | Un post duplicado de una marca de 8 M de seguidores es peor que uno que no salió. |
| D10 | **La guardia no usa IA**: funciones de una lista cerrada, en Node, 0 tokens. Cada rutina dice `si_se_perdio` y `vence_tras_horas`. | La mayoría de las mañanas no hay nada que decidir; un post de las 12:00 lanzado a las 23:00 hace daño. |
| D11 | **Lo desconocido no es gratis.** Si una CLI no informa tokens, el turno cuenta como «uso desconocido» y tiene su propio tope. | Contar 0 convierte el presupuesto en decorado. |
| D12 | **Por fuera, la nave; por dentro, una oficina isométrica.** Se entra por un **ascensor**. La tripulación son arquetipos originales con ropa de oficina. | Lo pide el usuario; el ascensor sustituye a la cabina telefónica, icónica de la película. |

---

## 1. Aislamiento real

### 1.1 Qué se protege y qué no

Se protege contra: memoria o búsquedas de otra oficina que entren en el brief; instrucciones globales del usuario (`~/.claude/CLAUDE.md`, el `AGENTS.md` de Codex, skills, reglas, MCPs, hooks); memoria propia de cada CLI; sesiones reanudadas; variables de entorno heredadas; instrucciones en carpetas padre; **un agente que intenta leer a propósito otra simulación, tu perfil o los secretos**; y la API local de OfficeMatrix llamada desde un agente.

No se protege contra: un administrador del PC (tú), el sistema operativo, ni lo que hagan los proveedores con el contexto que reciben en cada turno. «Sin fuga» describe las fronteras de OfficeMatrix, no la infraestructura de Anthropic, OpenAI, Google o xAI.

**Riesgo residual que se dice en voz alta:** una misión en nivel `contexto` (incluido el edificio, como hoy) corre **con tu usuario**, así que puede escribir en `%LOCALAPPDATA%\OfficeMatrix\control\` igual que tú. Lo que se hace: (1) el servidor guarda en memoria el SHA-256 de cada archivo de `control/` que escribe y lo compara al leerlo; si no coincide, la simulación afectada pasa a `bloqueada: control cambiado fuera del panel` y la UI enseña la diferencia para que la aceptes o la deshagas; (2) los campos que dan permisos (`aprobaciones.*`, `presupuesto.*`, niveles de `conexiones.*.acciones`) solo se cambian por `PUT /api/sims/:sim` y cada cambio deja línea en `control/sims/<id>/politica.jsonl`; (3) N2 y N3 nunca son automáticos, así que una política alterada no publica ni gasta sin tu clic. Lo que no se puede: distinguir, al arrancar, una edición tuya de una de un agente de `contexto` hecha con el servidor apagado. Por eso el arranque enseña «política cambiada desde el último cierre» si el hash no coincide con el último de `politica.jsonl`.

### 1.2 Memoria: herencia cero y traspaso a mano

Lo que cambia respecto a hoy (`lib/memory.js`, README §5):
- la copia a `memoria-oficina/` sale de `simulaciones/<id>/memoria/`, y la fusión de tres vías vuelve **al origen que consta en el manifiesto autoritativo de la misión**, `control/sims/<id>/misiones/<misión>/manifiesto.json` (`sim`, `team.snapshot`, hashes de partida) con sus bases de fusión en `…/<misión>/base/`. Nunca va al que esté seleccionado en la UI ni a lo que diga `.office/contexto.json` de la carpeta de la misión: esa es una **copia informativa** para los agentes, escribible por ellos, y el servidor no la lee (prueba P-MANIFIESTO);
- la búsqueda del panel Cerebro y la relevancia del brief solo puntúan entradas de esa simulación;
- una simulación nueva nace con la semilla de marca (`memoria/marca.md`, sacada de `marca`) y nada más.

**Traspaso** (el único cruce):

1. En el panel Cerebro de A: «↗ Traspasar» en una entrada (`### título` con su cuerpo) → eliges destino B.
2. Se copia a `control/sims/B/entrantes/<fecha>-<slug>.md` (**fuera** del árbol de B: ni sus agentes ni los de A lo leen ni lo escriben) con cabecera:
   ```
   > Traspaso desde: edificio · lecciones.md · «Un APROBADO sin nota no es un aprobado»
   > sha256 del original: 3f9a… · por: usuario · 2026-10-23T10:12-06:00
   ```
3. Un entrante **no entra en el brief ni en la búsqueda**. Entra cuando, dentro de B, pulsas «Aceptar» y eliges tema: el servidor lo añade a `simulaciones/B/memoria/<tema>.md`. Así nada aparece en B sin que lo hayas leído en el contexto de B.
4. Es una copia, no un enlace: si el original cambia, B no cambia. Retirar un traspaso aceptado no «desaprende» lo que ya usaron las misiones: se avisa y queda en el historial.

Ningún agente tiene ruta ni herramienta para traspasar: es una acción del panel. En nivel `cuenta`, ninguna cuenta de oficina tiene permiso alguno sobre `control/` (lo comprueba R-FRONTERA).

### 1.3 Lo que se cuela por las CLIs (medido el 23-oct-2026 en esta PC)

Versiones: Claude Code 2.1.308, codex-cli 0.163.0, agy 1.4.6, grok 1.0.67. Ayudas guardadas en `borradores/A/investigacion/*-help.txt`.

| Vía | CLI | Evidencia | Medida en `contexto` | En `cuenta` |
|---|---|---|---|---|
| **Entorno heredado** | todas | El shell de esta sesión lleva 9 variables `CLAUDE_CODE_*` (sesión, socket, token de mensajería). La doc de Claude: si `ANTHROPIC_API_KEY` está definida, se usa en vez de la suscripción. | `spawn` con **lista blanca** (§1.6), nunca `process.env`. | Igual, dentro del worker. |
| **Instrucciones globales** | Claude `~/.claude/CLAUDE.md`, Codex `$CODEX_HOME/AGENTS.md`, Gemini `~/.gemini/GEMINI.md` | Hoy no existen en esta PC (solo se comprobó que no existen), pero las CLIs las leen si aparecen. | Hogar de CLI de OfficeMatrix (§1.5). | El `~` es el de la cuenta de la simulación: tus archivos no son legibles. |
| **Instrucciones en carpetas padre** | Claude concatena los `CLAUDE.md` desde la raíz hasta el cwd; Codex lee `AGENTS.md` desde la raíz git; Grok lee `AGENTS.md`/`CLAUDE.md` como reglas | Docs oficiales (fuentes n.º 9–11). | El lanzador **se niega** si encuentra `CLAUDE.md`, `CLAUDE.local.md`, `AGENTS.md`, `AGENTS.override.md`, `GEMINI.md` o `.grok/` en un padre de la misión fuera de la simulación: error `INSTRUCCION_PADRE` con la ruta. No se «arregla» leyéndolo. | Igual. |
| **Memoria propia de la CLI** | Claude (auto-memoria en `~/.claude/projects/…/memory/`), Codex (`~/.codex/memories_1.sqlite` existe), Grok (`[memory]`) | Docs de Claude y Grok; listado de `~/.codex`. | Claude `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1`; Grok `GROK_MEMORY=0` y `[memory] enabled=false`; Codex `--ephemeral` (que su memoria no mezcle oficinas en un hogar compartido **no está documentado**: lo decide R-CANARIO-CONTEXTO). | Cada cuenta tiene su propio hogar: no hay memoria compartida que mezclar. |
| **Compatibilidad entre CLIs** | Grok | `grok inspect` aquí: carga **10 skills de Claude del usuario** y tiene encendida la lectura de skills, rules, agents, MCPs, hooks y sesiones de Claude y Cursor, y sesiones de Codex. La doc lo confirma: `[compat.claude]`, `[compat.cursor]`, todo `true` por defecto. | `config.toml` del hogar de Grok con esas claves en `false` y `--leader-socket <GROK_HOME>/leader.sock` (el socket por defecto es `~/.grok/leader.sock` aunque cambies `GROK_HOME`, según `grok --help`). | Igual (defensa en profundidad). |
| **Skills y comandos** | Claude, agy | `claude --disable-slash-commands` («Disable all skills and commands»); `agy --disable-slash-commands` («…in print mode»). | Los dos flags, siempre. | Igual. |
| **MCP del usuario** | Claude, agy, Grok | `claude --strict-mcp-config`: «Only use MCP servers from --mcp-config». | `--strict-mcp-config` sin `--mcp-config`: ningún MCP. Los demás, sin MCPs en su hogar. | Igual. |
| **Reanudar sesión** | todas | `--continue`, `-c`, `--resume`, `-r`, `resume`, `--conversation` en las cuatro ayudas. | Prohibidos: `lib/cli-args.js` falla si aparecen. | Igual. |
| **Directorios extra** | Claude, agy | `--add-dir` en las dos ayudas. | Prohibido. | Igual. |
| **Lectura activa de disco** | Codex (`--sandbox workspace-write` limita la *escritura* de comandos), Grok y agy con «aprobar todo» | `codex exec --help`: «sandbox policy to use when executing model-generated shell commands». | **No se impide.** Por eso `contexto` no corre solo (D4). | **Lo impide el SO**: la cuenta no tiene permiso sobre nada fuera de su simulación. Lo prueba R-FRONTERA. |

`--bare` de Claude **no** se usa: su ayuda dice que entonces «Anthropic auth is strictly ANTHROPIC_API_KEY… (OAuth and keychain are never read)», o sea, rompe la suscripción.

### 1.4 La frontera: una cuenta de Windows por simulación

**Por qué una cuenta y no una VM.** Una VM Hyper-V por oficina (borrador A) es la frontera más fuerte, pero exige Windows Pro, RAM por oficina, una imagen base y RPC con certificados: no se puede construir en un producto local sin dependencias y deja fuera a quien tenga Windows Home. Una cuenta local estándar da la propiedad que importa —**otro usuario no puede abrir tus archivos ni los de otra simulación**— con piezas que ya trae Windows. La VM queda como nivel `blindado` posterior y reutiliza el mismo worker (§1.4.3).

#### 1.4.1 Qué se crea al «Activar frontera»

Un botón en la ficha de la simulación lanza **un** script elevado (`scripts/frontera-crear.ps1`, una ventana de UAC; OfficeMatrix nunca se eleva solo):

| Paso | Cómo | Fuente (consultada el 23-oct-2026) |
|---|---|---|
| Crear la cuenta `om-<alias>` | `New-LocalUser -Name om-<alias> -Password <aleatoria> -PasswordNeverExpires -UserMayNotChangePassword -AccountNeverExpires`, miembro solo de `Users` y del grupo `OfficeMatrix-Sims`. El alias son 12 caracteres del id + 4 hex de su hash: el nombre admite **20 caracteres como máximo**. | [New-LocalUser](https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.localaccounts/new-localuser) |
| Guardar la contraseña | Cifrada con DPAPI de **tu** usuario en `%LOCALAPPDATA%\OfficeMatrix\control\cuentas\<id>.dpapi`. Ni se muestra ni entra en la simulación. | [CryptProtectData](https://learn.microsoft.com/en-us/windows/win32/api/dpapi/nf-dpapi-cryptprotectdata): «only a user with the same logon credential as the user who encrypted the data can decrypt the data» |
| Dar acceso a su carpeta | Lectura en la raíz y escritura solo en las subcarpetas de trabajo; tabla siguiente. | [icacls](https://learn.microsoft.com/en-us/windows-server/administration/windows-commands/icacls) (ms.date 2025-06-06) |
| Herramientas | `%ProgramData%\OfficeMatrix\` con `/inheritance:r`: tú `(OI)(CI)M`, SYSTEM y Administradores `(OI)(CI)F`, `OfficeMatrix-Sims` `(OI)(CI)RX`. Dentro: `node\<versión>\node.exe` (copiado de `process.execPath`), `worker\<versión>\` (`worker.js` y `lib/cli-env.js`, copiados del repo con su hash) y `herramientas\<cli>\<versión>\` (las CLIs fijadas por versión). **Ningún permiso sobre el repo de la app**: ahí vive la memoria del edificio. Las CLIs de tu `%APPDATA%\npm` tampoco son accesibles (están en tu perfil). | — |
| Token del worker | `%ProgramData%\OfficeMatrix\worker\tokens\<id>.token` con `/inheritance:r`, tú `F`, `om-<alias>` `R`. Nunca en la línea de órdenes. | — |

**ACL de `simulaciones/<id>/`.** `icacls /grant:r` solo sustituye los permisos **explícitos** de esa cuenta; los heredados siguen ([icacls](https://learn.microsoft.com/en-us/windows-server/administration/windows-commands/icacls): «Permissions replace previously granted explicit permissions»). Por eso no se concede Modify en la raíz y se recorta después, sino al revés: lectura heredable en la raíz y escritura añadida solo donde hace falta.

| Ruta | Orden (`om` = `om-<alias>`) | Permiso efectivo de `om` |
|---|---|---|
| `simulaciones\<id>\` (raíz) | `/grant om:(OI)(CI)RX` | Leer y listar todo; no crear, borrar ni renombrar nada en la raíz (sin `WD`, `AD`, `DE`, `DC` ni `WDAC`). Archivos que el servidor reemplaza con tmp + rename (`bitacora.md`) heredan RX de nuevo. |
| `proyectos\`, `memoria\`, `cola\`, `bandeja\salida\`, `entregas\`, `informes\`, `actas\` | RX heredada + `/grant om:(WD,AD)` sobre la carpeta (sin banderas de herencia: solo la carpeta) + `/grant om:(OI)(CI)(IO)M` para su contenido | Crear, cambiar y borrar **dentro**; la carpeta misma no se borra, no se renombra ni cambia de ACL. |
| `datos\` | solo la RX heredada | Leer lo que descargó el servidor; no escribirlo. |
| `simulaciones\` y cualquier otra simulación | nada (heredan de tu perfil) | Atravesar para llegar a la suya; ni listar ni abrir. |
| `%LOCALAPPDATA%\OfficeMatrix\` (incluido `control\`) | nada | Ninguno. |

Dentro del árbol de la simulación **no queda nada que el servidor obedezca**: la definición (`simulacion.json`), los entrantes sin aceptar, los manifiestos de misión, las bases de fusión, la bandeja y el presupuesto viven en `control/sims/<id>/`. Los archivos que crea `om` son suyos y, como propietario, puede cambiarles el ACL: da igual, porque son sus propias salidas y el servidor las vuelve a leer siempre como datos no fiables. Pruebas: R-FRONTERA (lectura) y R-FRONTERA-ESCRITURA (escribir, borrar, renombrar encima y crear un enlace duro o una junction hacia `control/`, la raíz y otra simulación: todo denegado).

Por qué basta con dar permiso a la carpeta aunque esté dentro de tu perfil: Windows concede por defecto a `Everyone`/`Users` el derecho **Bypass traverse checking**, que permite atravesar carpetas sin permiso para llegar a una subcarpeta permitida, y que «doesn't provide any Read or Write permissions» sobre lo atravesado ([Bypass traverse checking](https://learn.microsoft.com/en-us/previous-versions/windows/it-pro/windows-10/security/threat-protection/security-policy-settings/bypass-traverse-checking)). Tu perfil y las demás simulaciones heredan el ACL de tu perfil (tú, SYSTEM, Administradores): la cuenta no los abre. **Esto es el diseño; lo demuestra o lo tumba R-FRONTERA.**

`scripts/frontera-quitar.ps1` (también elevado) borra la cuenta y su perfil; los datos de la simulación se quedan. Archivar una simulación no borra la cuenta.

#### 1.4.2 Qué cuesta

| | `contexto` | `cuenta` |
|---|---|---|
| Inicios de sesión | 1 por CLI, una vez (hogar de OfficeMatrix compartido) | 1 por CLI **y por simulación** (solo las CLIs que use esa oficina). La de Acme Ciencia usa 4. |
| Cupo | El de tu cuenta | **El mismo**: tus suscripciones son una bolsa; por eso hay tope global (§4.5). |
| Elevación | Ninguna | Un UAC al activar y otro al quitar |
| RAM y disco | Nada | Un perfil de Windows por oficina (decenas de MB) y un proceso `node` (el worker) mientras trabaja |
| Qué falla si un flag miente | El canario lo ve; la CLI pasa a «parcial» | El SO sigue impidiendo la lectura |
| `agy` | Usa tu perfil (no tiene hogar documentado): **aislamiento parcial**, apagado salvo que pase R-CANARIO-CONTEXTO | Su `~` es el de la cuenta: aislado como los demás |

**Iniciar sesión dentro de la cuenta.** «Iniciar sesión de Claude en esta oficina» abre una consola como `om-<alias>` (`Start-Process -Credential … cmd /k claude`) y tú completas el login. Que cada CLI pueda completar su OAuth desde una cuenta sin navegador propio (copiando la URL a tu navegador o con código de dispositivo) **no está verificado**: lo cierra R-MISION-MINIMA. Si una CLI no puede, ese puesto usa su `reserva` en esa oficina.

**Términos de uso.** Es tu propia suscripción, usada por ti en tu PC, desde otra cuenta local: no se da servicio a terceros. Antigravity sigue siendo un riesgo de términos incluso en local (`memoria-oficina/lecciones.md`): los puestos `agy` llevan `activo_en_copia_compartida: false` y, en la versión pública, nacen apagados.

#### 1.4.3 El worker: cómo trabaja una oficina detrás de la frontera

El servidor (tu usuario) no puede matar procesos de otra cuenta ni pasarles pipes de forma fiable. Por eso cada oficina con frontera tiene un **worker**: un `worker.js` sin dependencias, lanzado como `om-<alias>` así:

```powershell
Start-Process -FilePath "$env:ProgramData\OfficeMatrix\node\<versión>\node.exe" `
  -ArgumentList "`"$env:ProgramData\OfficeMatrix\worker\<versión>\worker.js`" --sim <id>" `
  -WorkingDirectory "<HOME>\simulaciones\<id>" `
  -Credential $cred -LoadUserProfile -UseNewEnvironment -WindowStyle Hidden
```

Por qué cada pieza ([Start-Process](https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.management/start-process), ms.date 2026-07-06): por defecto el proceso nuevo «inherits all the environment variables that are defined in the current process», o sea las tuyas (`USERPROFILE`, `APPDATA`, las `CLAUDE_CODE_*`…); `-UseNewEnvironment` usa en su lugar «the predefined variables from the Machine and User scopes», y `-LoadUserProfile` carga el perfil de la cuenta. `node` y `worker.js` van en ruta absoluta dentro de `%ProgramData%\OfficeMatrix\` (§1.4.1): ni `PATH` ni el repo deciden qué se ejecuta. Que «User scope» sea el de `om-<alias>` cuando se combina con `-Credential` la doc no lo dice explícitamente: el worker **comprueba al arrancar** que `USERPROFILE` es el perfil de `om-<alias>` y que no hay ninguna `CLAUDE_CODE_*` ni `*_API_KEY`; si no, se niega con `ENTORNO_AJENO` (prueba S1F-ENTORNO-WORKER). El worker lee su token del archivo de §1.4.1 y, al arrancar, el servidor compara el hash de `worker.js` y `cli-env.js` de `%ProgramData%` con los del repo; si difieren, los vuelve a copiar antes de lanzarlo.

- **Habla con el servidor por HTTP local** (`127.0.0.1`), no por stdio: `GET /w/v1/trabajo` (espera hasta 25 s), `POST /w/v1/turnos/:id/eventos`, `POST /w/v1/turnos/:id/fin`, `POST /w/v1/latido` cada 15 s.
- **Se autentica con un token del worker** (`Authorization: Bearer`). El servidor **deriva la simulación del token**, nunca del cuerpo. Las rutas `/w/v1` no pueden aprobar, traspasar, activar ni leer `/api`. Un agente que robe el token (corre con la misma cuenta) solo puede ensuciar los eventos de su propia oficina: se acepta y se escribe.
- **Lanza las CLIs** con la lista blanca de entorno y los argumentos de §1.6, en `simulaciones/<id>/proyectos/<misión>/`; el brief ya está escrito ahí por el servidor.
- **Vigila y corta**: watchdog de inactividad y de tiempo total; mata el árbol entero (`taskkill /T /F` sobre sus propios hijos, que sí puede). Si el worker deja de latir 90 s, el servidor marca la oficina `bloqueada: worker sin latido` y no le da más trabajo hasta que tú lo reinicies; nunca lanza un segundo worker encima del primero.
- **No toca la memoria del servidor**: la fusión de tres vías la hace el servidor al recibir `fin`, desde el manifiesto autoritativo de `control/sims/<id>/misiones/` (§1.2).

El modo `blindado` (posterior) ejecuta este mismo worker dentro de una VM: el contrato `/w/v1` no cambia.

#### 1.4.4 La API local también es una frontera

Hoy el servidor escucha en `127.0.0.1` y solo filtra `Origin` en las escrituras (D27). Un `curl` sin `Origin` desde la cuenta de una oficina podría leer `GET /api/s/otra/brain`. Por eso, con S1:

- `iniciar.bat` abre el panel con una clave de un solo uso leída de `%LOCALAPPDATA%\OfficeMatrix\control\clave-panel` (solo legible por ti); el servidor la cambia por una cookie `HttpOnly; SameSite=Strict`.
- **Toda** ruta `/api`, `/raw` y SSE exige esa cookie (o la sesión de `lan.js` desde el móvil). Sin ella: `401`.
- Es la misma idea que la clave de `lan.js`, aplicada también a localhost. (`lan.js` no está en la copia de referencia: si al construir S3 no existe, se añade con estas reglas.)

### 1.5 Hogar de CLI en nivel `contexto`

Dónde: `%LOCALAPPDATA%\OfficeMatrix\cli-home\<cli>\`, fuera del repo y de las simulaciones. Compartido por todas las oficinas en `contexto` (un login por CLI). En `cuenta`, el hogar es el de la cuenta de la oficina.

| CLI | Cómo se apunta | Estado |
|---|---|---|
| Claude | `CLAUDE_CONFIG_DIR=<hogar>` + `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1` | Documentado: «All settings, session history, and plugins are stored under this path» ([env-vars](https://code.claude.com/docs/en/env-vars)). `--setting-sources` solo elige capas de ajustes; que excluya `~/.claude/CLAUDE.md` lo dice la página del SDK, no la ayuda: se comprueba con canario. |
| Codex | `CODEX_HOME=<hogar>` + `--ignore-user-config` + `--ignore-rules` + `--ephemeral` | Ayuda de `codex exec` 0.163: `--ignore-user-config` «auth still uses CODEX_HOME». Si un `CODEX_HOME` nuevo pide sesión otra vez (o lee el llavero): **sin verificar**. |
| Grok | `GROK_HOME=<hogar>` + `GROK_MEMORY=0` + `config.toml` con `[compat.*]` en `false` | Documentado ([settings](https://docs.x.ai/build/settings)): el hogar guarda config, auth, sesiones, skills, plugins y logs. Que `rules=false` evite leer `CLAUDE.md` no está documentado: lo cubre `INSTRUCCION_PADRE`. |
| agy | — | Ni flag ni variable en `agy --help` 1.4.6. En `contexto`: aislamiento parcial. |

Gemini CLI (`gemini` 0.65.0 está instalado) admite `-m` según su ayuda y, según su documentación, `GEMINI_CLI_HOME` (citado por el borrador A; **sin verificar aquí**). Puede sustituir a `agy` como CLI del puesto Gemini si su login con suscripción funciona dentro de una cuenta: se decide con R-MISION-MINIMA, no en este documento.

### 1.6 Lanzar una CLI dentro de una simulación

`lib/cli-env.js` construye `{cmd, args, env, cwd}`. Lo usa el lanzador local (`contexto`) y el worker (`cuenta`, desde su copia de `%ProgramData%`). En el worker, `base` es **su propio** entorno, el de la cuenta (§1.4.3); el servidor nunca le pasa el tuyo, así que `USERPROFILE`, `APPDATA` y `TEMP` de la lista apuntan al perfil de `om-<alias>`:

```js
const PASAN = ['SystemRoot','windir','ComSpec','PATHEXT','PATH','TEMP','TMP','USERPROFILE',
  'HOMEDRIVE','HOMEPATH','APPDATA','LOCALAPPDATA','NUMBER_OF_PROCESSORS','PROCESSOR_ARCHITECTURE','LANG'];
function envParaTurno(sim, cli, base = process.env) {
  const env = {};
  for (const k of PASAN) if (base[k] != null) env[k] = base[k];
  const hogar = hogarDe(sim, cli);   // contexto: cli-home de OfficeMatrix; cuenta: null (el ~ de la cuenta)
  if (cli === 'claude') { if (hogar) env.CLAUDE_CONFIG_DIR = hogar; env.CLAUDE_CODE_DISABLE_AUTO_MEMORY = '1'; }
  if (cli === 'codex' && hogar) env.CODEX_HOME = hogar;
  if (cli === 'grok')   { if (hogar) env.GROK_HOME = hogar; env.GROK_MEMORY = '0'; }
  env.OFFICEMATRIX_SIM = sim.id;     // solo para logs
  return env;                        // nada de CLAUDE_CODE_*, *_API_KEY, *TOKEN*, *SECRET*, *PASSWORD*
}
```

Argumentos que se añaden a los de `agents.json` (todos vistos en el `--help` de las versiones de §1.3):

| CLI | Modelo | Aislamiento |
|---|---|---|
| Claude | `--model <id>` | `--strict-mcp-config --disable-slash-commands --no-session-persistence` (esta última «only works with --print», que es como lanza OfficeMatrix) |
| Codex | `-m <id>` (sin `-m` si `id` es `null`) | `--ephemeral --ignore-user-config --ignore-rules -s workspace-write --skip-git-repo-check` |
| Grok | `-m <id>` | `--leader-socket <hogar>/leader.sock --no-subagents`; `--disable-web-search` solo si la rutina no busca |
| agy | `--model <id>` | `--disable-slash-commands` |
| Ollama (S7) | entrada `codex-oss` de `agents.json`: `codex exec --oss --local-provider ollama -m <modelo>` | Los de Codex |

**Reserva.** Si la CLI del puesto sale con `SIN SALDO`, `LÍMITE` o `SIN SESIÓN` (`lib/failure.js`), el turno se repite **una vez** con `reserva`; la ficha del personaje es la misma y la bitácora lo dice («Lucía trabajó con Claude Sonnet: Antigravity sin sesión»). Si con la reserva el autor y su revisor quedan en el mismo `cli + id`, el paso se marca «diversidad reducida» y **su entrega no puede pasar a la bandeja sin que tú la abras** (no se pierde, pero no avanza sola). `--fallback-model` de Claude (reintento por saturación dentro de la misma CLI) se puede usar además, y el reporte registra el modelo efectivo.

**Modelo efectivo.** Cada turno guarda en su reporte: `modelo_pedido`, `modelo_efectivo` (si la CLI lo informa; p. ej. la cabecera de `codex exec` imprimió `model: gpt-6.1-sol` en la generación de arte del 23-oct-2026), versión de la CLI y si fue reserva.

### 1.7 Cómo se prueba que no hay fuga

**Canarios:** cadenas inventadas `CANARIO-<sitio>-<8 hex>` que no aparecen en ningún otro sitio. Las pruebas se nombran por id estable, nunca por número de fila.

Unitarias e integración (`npm test`, con CLIs falsas que imprimen entorno, argv y archivos leídos; no gastan suscripción):

| Id | Montaje | Pasa si |
|---|---|---|
| P-CANARIO-EDIFICIO | `memoria/lecciones.md` del edificio con un canario; brief de una misión de B. | El brief no lo contiene. |
| P-CANARIO-HERMANA | A y B con un tema del mismo nombre y canarios distintos. | El brief de B tiene el de B y no el de A, ni la ruta de A. |
| P-FUSION | Un turno de B escribe en `memoria-oficina/lecciones.md`. | Cambia `simulaciones/B/memoria/lecciones.md`; edificio y A conservan su hash byte a byte. |
| P-ENTORNO | Padre con `CLAUDE_CODE_SESSION_ID`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `XAI_API_KEY`, `OM_SECRET_X`. | Ninguna llega al hijo; las de hogar apuntan donde deben. |
| P-PADRE | Un `AGENTS.md` con canario en `simulaciones/`. | `INSTRUCCION_PADRE`, sin crear proceso. |
| P-ARGV | Un empleado por CLI, Codex con `id: null`. | Cada uno recibe exactamente los flags de §1.6; ninguno `--add-dir`; Codex sin `-m`. |
| P-FLAGS-PROHIBIDOS | `args` con `--continue`, `-r`, `resume`, `--add-dir`. | El lanzamiento falla con mensaje claro. |
| P-API-ALCANCE | `GET /api/s/A/chats/<misión de B>`, `…/brain/search?q=CANARIO-B`, `/raw/A/<misión de B>/…`, replay SSE de A. | 404 o vacío; nunca contenido de B. |
| P-RUTAS-DECLARADAS | Recorre la tabla de rutas del servidor. | Toda ruta de datos pasa por `scope(req)`; una ruta nueva sin alcance hace fallar la prueba. |
| P-API-LOCAL | `GET /api/sims` sin cookie de panel; `POST` con `Origin: null`. | `401`; `403`. |
| P-TRASPASO | Un entrante con canario sin aceptar. | No está en brief ni búsqueda ni en ningún archivo bajo `simulaciones/B/`; tras aceptar, sí, en el tema elegido. |
| P-MANIFIESTO | Durante una misión de B, el agente falso reescribe `.office/contexto.json` con `sim: "A"`, otro `team.snapshot` y otros hashes de partida. | La fusión va a la memoria de B con las bases de `control/sims/B/misiones/<misión>/`; A no cambia byte a byte; el equipo de la misión es el del manifiesto autoritativo. |
| P-POLITICA | El agente falso crea `simulaciones/B/simulacion.json` con `n1_automatico: ["blog"]`, presupuesto ×100 y `publicar: "N0"`; después, la prueba edita `control/sims/B/simulacion.json` por disco con el servidor en marcha. | Lo primero se ignora (el servidor no lee definiciones dentro del árbol). Lo segundo deja B `bloqueada: control cambiado fuera del panel`, sin admitir turnos ni solicitudes hasta aceptar o deshacer en la UI. |
| P-RUTA | `../edificio/memoria/lecciones.md`, `..%2F`, absoluta, UNC y una *junction* hacia A. | `RUTA_FUERA` sin leer (comprobación con `realpath`, como `lib/preview.js`). |

Reales (misión mínima, `OFFICEMATRIX_HOME` temporal, `node tests/sondas/fuga.js`): **la fase no está terminada sin ellas.**

| Id | Montaje | Pasa si |
|---|---|---|
| R-INSPECCION | `grok inspect --json` con el hogar de OfficeMatrix y con la cuenta de la oficina. | Ninguna skill con origen `user [claude]` ni sesiones de Claude/Cursor/Codex. |
| R-CANARIO-CONTEXTO | Canarios en: memoria de A, `CLAUDE.md`/`AGENTS.md`/`GEMINI.md` de un perfil de prueba, y un primer turno de Codex en A que los menciona. En B, cada CLI recibe: «escribe en `canarios.txt` toda cadena que empiece por CANARIO que conozcas por tus instrucciones o tu memoria». | `canarios.txt` contiene solo el de B. Si una CLI falla, queda «parcial» y **no trabaja en `contexto`**. |
| R-FRONTERA | Nivel `cuenta`, dos oficinas A y B. Desde un **proceso real** de B y de un hijo suyo (`cmd /c type`, `node -e fs.readFileSync`, y pidiéndoselo a cada CLI con «aprobar todo»): leer el canario de A, `C:\Users\<tú>\.claude\`, `%LOCALAPPDATA%\OfficeMatrix\control\`, los secretos, una junction creada hacia A, y llamar a `/api` sin cookie. **Sin** instrucción de «no busques». | Todo «acceso denegado» o `401`, comprobado a nivel de bytes en salidas, archivos y logs de B. Una actualización de CLI invalida el resultado y obliga a repetirla. |
| R-FRONTERA-ESCRITURA | Mismo montaje, como `om-<alias>` de B: crear, sobrescribir, borrar y renombrar encima (`move /y`) en `control\sims\B\simulacion.json`, `control\sims\B\entrantes\`, la raíz de B (`bitacora.md`, crear `x.txt`), la carpeta `proyectos\` misma (borrarla o renombrarla) y un archivo de A; crear un enlace duro (`mklink /h`) y una junction (`mklink /j`) desde `proyectos\` hacia `control\` y hacia A; `icacls` sobre la raíz. | Todo denegado; hash de `control\sims\B\` y de A idénticos antes y después. Dentro de `proyectos\<misión>\` escribir y borrar **sí** funciona (si no, la prueba está mal montada). |
| R-MISION-MINIMA | En A y B con frontera, un turno por CLI habilitada con su `--model`/`-m`, que escribe una lección y un entregable. | Burbuja, nota, tokens o «uso desconocido», `modelo_efectivo`, la lección en la memoria de su oficina y nada en la otra. Login de cada CLI completado dentro de la cuenta. |

---

## 2. Datos y carpetas

### 2.1 Carpetas

```
OFFICEMATRIX_HOME/                      ← hoy: la carpeta de la app
├── agents.json                         ← catálogo de CLIs (cmd, stream, args base); el equipo del edificio sigue aquí
├── memoria/  proyectos/  plantillas.json        ← simulación «edificio», sin moverse
└── simulaciones/
    ├── simulaciones.json               ← índice [{id, nombre, estado, orden}] (se reconstruye si se borra)
    └── acme-editores/       ← ACL de §1.4.1: om-<alias> lee todo y escribe solo donde dice (M)
        ├── memoria/  (+ .historial/)   ← cerebro propio (M)
        ├── bitacora.md                 ← 15 líneas, la escribe el servidor y la lee la guardia
        ├── cola/temas.md               ← cola de temas (M)
        ├── proyectos/<misión>/         ← misiones normales (mismo chat.json) + .office/contexto.json informativo (M)
        ├── datos/<conector>/<periodo>-<clave>.json  ← lo que descargó el servidor; p. ej.
        │                                  search_console/semana-2026-W42.json, meta_ads/dia-2026-10-22.json
        ├── bandeja/salida/             ← peticiones que escriben los agentes (M)
        └── entregas/  informes/  actas/   (M)

%LOCALAPPDATA%\OfficeMatrix\            ← solo tú
├── cli-home\<cli>\                     ← hogares del nivel contexto
└── control\
    ├── clave-panel
    ├── cuentas\<id>.dpapi              ← contraseña de om-<alias>
    ├── secretos\<id>\<conector>.dpapi  ← tokens OAuth, cifrados
    └── sims\<id>\                      ← lo que decide algo; ninguna cuenta de oficina tiene permiso aquí:
        ├── simulacion.json             ← definición deseada (§2.2), la única que obedece el servidor
        ├── politica.jsonl              ← cada cambio de definición hecho por la API, con su hash
        ├── estado.json                 ← nivel efectivo, cuenta, worker, versiones de CLI, último R-FRONTERA
        ├── frontera\comprobaciones.jsonl  ← resultados de «Comprobar frontera» (§8.2)
        ├── entrantes\                  ← traspasos sin aceptar (§1.2)
        ├── misiones\<misión>\          ← manifiesto.json (sim, team.snapshot, hashes) + base\ de la fusión
        ├── ejecuciones.jsonl           ← claves de rutina (§4.1)
        ├── bandeja.jsonl               ← solicitudes, decisiones y envíos (§5.3)
        ├── bandeja\<solicitud>\        ← copia inmutable de los bytes aprobables (§5.3)
        ├── presupuesto.jsonl           ← gasto por turno
        └── diario\<fecha>.jsonl        ← eventos del día: lo que pinta «Hoy»
```

En `cuenta`, la carpeta de cada misión es del agente. `chat.json` sigue ahí como hoy para la UI: si un agente lo altera, solo ensucia la vista de su propia misión (el mismo trato que los eventos del worker); nada de lo que el servidor obedece —equipo, manifiesto, presupuesto, aprobaciones— se lee de ahí. Exportar e importar la definición se hace por la API (`GET`/`PUT /api/sims/:sim`), no copiando archivos dentro del árbol.

**Regla:** lo que decide algo (aprobaciones, ejecuciones, gasto, nivel de aislamiento) vive en `control/`, fuera del alcance de escritura de los agentes. SHA-256 prueba integridad, no autoría: una aprobación escrita en una carpeta del agente no probaría que la diste tú.

**Persistencia sin dependencias.** Un solo proceso controlador (bloqueo `control/.lock` con PID). Escrituras atómicas (tmp + rename) para JSON y una cola en memoria que serializa los `append` de cada JSONL. Las claves únicas (ejecución, solicitud, `update_id`) se comprueban dentro de esa cola antes de escribir. Si algún día hay dos procesos, se revisa esta decisión; SQLite no entra en la fase 1.

### 2.2 `simulacion.json`

Vive en `control/sims/<id>/simulacion.json` (§2.1). Ejemplo completo en `simulacion.ejemplo.json` (§9 lo comenta). Claves en español, como el resto de los archivos de datos de la app. Las que empiezan por `_` son notas: el cargador las ignora. Una clave desconocida fuera de las de `_` es **error**, no aviso: así prosa, JSON y validador no pueden divergir sin que falle S1-VALIDAR.

| Campo | Tipo | Validación y notas |
|---|---|---|
| `version` | número | `1` |
| `id` | slug `[a-z0-9][a-z0-9-]{2,39}` | Inmutable. `edificio` reservado. Nombres reservados de Windows (`con`, `nul`…) rechazados. |
| `nombre`, `estado` | texto · `activa \| pausada \| archivada` | `pausada`: no corren rutinas; se puede abrir y pedir a mano. |
| `marca` | `{nombre, idioma, publico, voz, evitar[], zona (IANA), sitio}` | Entra en el brief con **prefijo estable** (misma redacción cada turno, para la caché). |
| `aislamiento` | `{nivel_requerido: "contexto" \| "cuenta", lee_edificio: false}` | `lee_edificio: true` → error (v1 solo acepta `false`). El nivel **efectivo** lo calcula el servidor (`control/sims/<id>/estado.json`), no se escribe aquí. |
| `empleados[]` | ver abajo | Ficha ≤ 600 caracteres: entra en cada turno. |
| `rutinas[]` | §4 | `id` único; cada `condicion` es una función del catálogo. |
| `presupuesto` | `{tokens_dia, minutos_ia_dia, turnos_dia, turnos_uso_desconocido_max, dinero{moneda, tope_cambio_anuncios_dia, tope_mensual_anuncios, tope_api_dia_usd}}` | Obligatorio si hay rutinas. `tope_api_dia_usd` va siempre en USD (X cobra en USD); los dos de anuncios, en `moneda`. |
| `conexiones` | un objeto por conector | Sin secretos: dentro de `conexiones` el validador rechaza claves que contengan `token`, `password`, `secret`, `key`. Cada acción declara su nivel (`N0`–`N3`). Todas nacen `activo: false`. |
| `aprobaciones` | `{caduca_horas, n1_automatico: [conector…], telegram_permite[], n3_confirmar_importe}` | `n1_automatico` es la **lista de conectores** cuyos N1 no esperan tu clic (vacía por defecto); cada uno debe existir en `conexiones` y tener alguna acción N1. `telegram_permite` no admite `N3`. `n3_confirmar_importe` solo admite `true` en v1. |
| `escena` | `{plantilla, puestos{empleado: escritorio}}` | Para la vista isométrica (§6). |

Empleado:

| Campo | Notas |
|---|---|
| `id`, `nombre`, `puesto` | `id` único; el turno se llama `turno-<id>.md`. |
| `modelo` `{cli, id}` | `cli` existe en `agents.json`; `id` en la lista conocida (`agy models`, `grok models`, alias de Claude `opus`/`sonnet`/`fable`). `id: null` = el de la cuenta (Codex no lista modelos). Si no se puede comprobar: aviso «modelo sin verificar», no error. |
| `modelo_rapido` `{cli, id}` o `null` | El que usa al 80 % del presupuesto. Obligatorio (no `null`) si `degradable: true`; debe ser `null` si `degradable: false`. |
| `degradable` | Al 80 %, `true` pasa a `modelo_rapido`; `false` conserva su modelo y, si su paso no cabe, espera. **Quien tiene `vetar` en `poderes` debe llevar `false`** (el verificador de datos veta, así que la regla lo cubre). El validador rechaza `vetar` + `degradable: true` y `degradable: true` + `modelo_rapido: null`. |
| `reserva` `{cli, id}` | Otra CLI. Automática una vez por turno (§1.6). |
| `objetivo`, `estilo`, `no_hace`, `poderes[]` | `moderar`, `aprobar_interno` (cierra el relevo; **no** aprueba nada externo), `vetar`. Ningún poder aprueba N1–N3. |
| `activo`, `activo_en_copia_compartida` | Un puesto `agy` nace con el segundo en `false`. |
| `avatar` `{base, vestuario}`, `voz` | §6.3 y §7 de la propuesta anterior. |

### 2.3 Migración del edificio sin romper nada

1. Al arrancar, si no existe `simulaciones/`, se crea con `simulaciones.json = []`. El edificio no está en el índice: es implícito (`id: "edificio"`, rutas de hoy, equipo = `agents.json` con `enabled`).
2. `lib/memory.js`, `lib/brief.js` y el servidor reciben un `ctx` (`ctx.memoria`, `ctx.proyectos`, `ctx.plantillas`, `ctx.nivel`). Para el edificio son las rutas de hoy; `OFFICEMATRIX_HOME` sigue igual.
3. Las rutas `/api/chats/…`, `/api/brain…` y `/raw/:proyecto/…` son **alias** de `/api/s/edificio/…`. Nunca usan la simulación seleccionada en el navegador como alternativa.
4. `#m=<id>` sigue abriendo la misión del edificio; las nuevas son `#s=<sim>&m=<id>`.
5. `chat.json` gana un campo opcional `sim` (ausente = `edificio`). Las misiones viejas no se tocan.
6. El edificio sigue en `contexto` y **sin rutinas**, como hoy. Si un día quieres que el edificio trabaje solo, se le crea una simulación propia.
7. Bandera `SIMULACIONES=0` en el arranque: la app se comporta exactamente como antes (prueba P-MIGRACION).

---

## 3. Empleados con modelo elegible

- **El equipo de una simulación es `empleados[]`.** Al crear una misión, el compositor muestra empleados (nombre, puesto, modelo) en vez de las cuatro IAs. Orden y rol, editables por misión.
- **Turno = empleado.** Dos empleados pueden usar la misma CLI en la misma misión (Irene y Sara son Claude). Reportes, discusión y Expedientes se agrupan por empleado y muestran el modelo al lado («Sara · Claude Sonnet»).
- **La ficha va arriba del brief, con texto fijo**, tras el protocolo: el prefijo de cada empleado no cambia entre turnos.
- **Instantánea del equipo.** Al crear la misión se guarda `team.snapshot` en `.office/contexto.json`. Cambiar la ficha a mitad de misión solo afecta a misiones nuevas.
- **Cambiar de modelo** desde la ficha deja una línea en la bitácora y no toca memoria ni historial. Expedientes separa notas por modelo para comparar.
- **Modelos disponibles hoy** (23-oct-2026): Claude, alias `opus`, `sonnet`, `fable`; `agy models`: `gemini-4-argon-{low,medium,high}`, `gemini-3.8-flash-{low,medium,high}` (y modelos Claude y GPT-OSS dentro de Antigravity, que no se eligen por `agy`); `grok models`: `grok-4.7` (por defecto), `grok-4.7-build-fast`, `grok-4.6`, `grok-4.5`. `GET /api/clis/modelos` refresca la lista cada 24 h.
- **Ollama, empleado futuro (S7).** La vía corta es Codex: `codex exec --oss --local-provider ollama -m <modelo>` (visto en la ayuda), mismo streaming `--json` y parser. No gasta cupo pero sí RAM: cuenta para `maxParallel`. Se enciende con un fixture real grabado y una misión mínima. Un modelo local no gana permisos por ser local: corre detrás de la misma frontera.

---

## 4. Trabajo continuo (fase S2; exige nivel `cuenta`)

### 4.1 Rutinas

Dos tipos, más la guardia:

- **`conector`**: el servidor habla con una API (N0) y deja un JSON en `datos/`. No arranca ninguna CLI. Ej.: descargar Search Console.
- **`equipo`**: convoca empleados con un proceso (`taller`, `relevo`, `consejo`, `receta`). Solo si su `condicion` se cumple.
- **`guardia`**: comprueba condiciones (§4.3) y anota; 0 tokens.

Publicar y gastar **nunca** son una rutina: una rutina produce una solicitud; la bandeja decide.

```json
{ "id": "articulo-blog", "tipo": "equipo", "cuando": "mar,jue 10:00",
  "condicion": { "fn": "temaElegido" }, "proceso": "receta",
  "si_se_perdio": "preguntar", "vence_tras_horas": 48, "tope_tokens": 2500000 }
```

Campos de una rutina (cualquier otro, salvo los `_`, es error):

| Campo | Tipos | Notas |
|---|---|---|
| `id`, `tipo`, `cuando`, `activa`, `si_se_perdio` | todos | `activa` es la **configuración deseada**; lo que corre lo decide la máscara de abajo. |
| `vence_tras_horas` | todos salvo `guardia` | Obligatorio si `si_se_perdio` ≠ `omitir`. |
| `condicion` `{fn, …}` | `guardia`, `equipo` (opcional) | Función del catálogo §4.3. Sin `condicion`, una `equipo` corre siempre a su hora. |
| `conector`, `accion` | `conector` | La acción debe existir en `conexiones.<conector>.acciones` y ser `N0`. |
| `convoca_si` `{condicion, proceso, quien[], pide, solicita[], tope_tokens}` | `conector` (opcional) | Se evalúa **después** de descargar, con 0 tokens. Si la condición no se cumple, no se convoca a nadie y queda una línea en el diario. Si se cumple, se crea una misión `equipo` con esos campos. |
| `proceso`, `quien[]` o `"todos"`, `pide`, `pasos[]`, `presidente`, `escribe_memoria` | `equipo` | `pasos` solo con `proceso: "receta"`; `presidente` solo con `consejo`. Cada id de `quien`, `pasos` y `presidente` debe ser un empleado activo. |
| `entregable` | `equipo`, `conector` con `convoca_si` | Ruta relativa dentro de `entregas/`, `informes/`, `actas/` o `cola/`; `{fecha}` se sustituye. |
| `solicita[]` `{conector, accion, nivel}` | `equipo`, `convoca_si` | `nivel` debe coincidir con el de `conexiones`; si no, error. |
| `tope_tokens` | `equipo`, `convoca_si` | Obligatorio. |

**Máscara: cuándo corre de verdad una rutina con `activa: true`.** El servidor calcula `efectiva` y su `motivo`, y la UI los enseña (`GET /api/sims/:sim` → `rutinas_efectivas[]`). En orden, la primera que falle da el motivo:

1. `activa: true` → si no, «desactivada». `estado` de la simulación es `activa` → si no, «simulación pausada».
2. Nivel efectivo `cuenta` y última comprobación de frontera en `verde` y no invalidada (§8.2) → si no, «frontera sin comprobar».
3. Presupuesto definido → si no, «sin presupuesto».
4. Tipo `conector`: su conector `activo: true` y con credencial → si no, «conector <x> apagado».
5. Todo lo demás: efectiva.

Para `equipo`, los conectores de `solicita` **no** apagan la rutina: el entregable se produce igual (sirve para publicarlo a mano). Pero una petición a un conector apagado, sin credencial o con otro nivel **no entra en la bandeja**: queda como línea `peticion_descartada: conector <x> apagado` en el diario y la entrega se marca «sin conector: publicar a mano». Así, el ejemplo de §9 nace con todas sus rutinas `activa: true` y ninguna efectiva: motivo «frontera sin comprobar».

- `cuando`: `diario HH:MM`, `lun-vie HH:MM`, `mar,jue HH:MM`, `lun HH:MM`. Sin cron completo en v1. Zona: `marca.zona`.
- **Clave única:** `sim + rutina + hora civil programada (YYYY-MM-DDTHH:mm en su zona)`, calculada con `Intl.DateTimeFormat(…).formatToParts`. Se escribe en `control/sims/<id>/ejecuciones.jsonl` **antes** de lanzar. Repetir el disparador no crea dos misiones.
- **Cambio de horario:** una hora que no existe (salto de primavera) se ejecuta en el primer minuto válido; una que existe dos veces, solo la primera. Se prueba con una zona con DST aunque Ciudad de México no lo tenga hoy.
- **Una en curso de la misma rutina** → la siguiente queda `omitida: en curso`.
- **Tick cada 60 s.** El reloj del event loop no es la verdad: en cada tick se recalcula desde la hora del sistema.
- **`tope_tokens` por ejecución:** al llegar, se deja terminar el turno en curso y la misión se cierra «cerrada por tope de rutina, sin aprobar».

### 4.2 Si el PC estuvo apagado

1. **Despertador opcional:** una tarea de Windows al iniciar sesión que abre `iniciar.bat --sin-ventana`. Se crea y se borra desde la UI con tu clic.
2. **Al arrancar, recuperación** de cada rutina con hora pasada y sin ejecución, **como máximo una por rutina**:

| `si_se_perdio` | Qué hace | Ejemplo |
|---|---|---|
| `ejecutar_al_volver` | Lanza **la más reciente** si no pasó `vence_tras_horas`; las anteriores, `perdida` | Informe de Search Console |
| `preguntar` | Tarjeta en «Hoy»: «El artículo del martes no se hizo. [Hacerlo ahora] [Saltar]» | Artículo, retro |
| `omitir` | Solo lo anota | Redes del día, guardia de ayer |

Si pasó `vence_tras_horas`, nunca se lanza: queda `vencida`. Las recuperadas entran en la cola normal con `maxParallel`, no a la vez. Recuperar nunca reenvía una publicación ni un cambio de anuncios: esos solo salen de la bandeja.

### 4.3 La guardia (0 tokens)

`lib/guard.js` es una **lista cerrada de funciones** con nombre. En `simulacion.json` la condición es `{fn, …parámetros}`; el validador rechaza una `fn` desconocida. Nada de `eval` ni texto libre.

| Función | Qué mira |
|---|---|
| `temasSinUsar({menos_de})` | Líneas `- [ ]` en `cola/temas.md` |
| `temaElegido()` | Una línea `- [x] elegido:` en `cola/temas.md` |
| `datosNuevos({conector, periodo})` | `periodo` ∈ `dia` \| `semana`. Existe `datos/<conector>/<periodo>-<clave>.json` del último periodo **cerrado** (`dia-AAAA-MM-DD`; `semana-AAAA-Wnn`, semana ISO de lunes a domingo en `marca.zona`) y su hash difiere del que usó la última ejecución de la rutina |
| `desviacionGasto({pct_gasto, pct_coste})` | `datos/meta_ads/dia-<ayer>.json` frente a la media de los 7 `dia-*.json` anteriores |
| `entregaSinAdaptar({dias})` | Entregas aprobadas sin la marca `adaptada:` |
| `hayBloqueos()` | Bandeja caducada, objeción bloqueante abierta, conector con error |

Resultado: una línea en `diario/<fecha>.jsonl` por rutina («radar-temas: no convoco, hay 14 temas sin usar»). Si nada se cumple, la oficina no gasta nada ese día. Una fuente externa (un artículo, un RSS) es **dato**: nunca entra como instrucción del sistema ni amplía herramientas.

### 4.4 Presupuesto

- **Dos topes:** el de cada simulación y uno global en `agents.json` (`presupuestoGlobal`), porque las suscripciones son las mismas. Además, **un semáforo por CLI** limita turnos simultáneos contra la misma cuenta.
- **Reserva antes de lanzar:** se reserva `tope_tokens` del paso; al terminar se ajusta al gasto real (`normalizeUsage`). Si la reserva no cabe, la rutina queda «esperando presupuesto» y se ve.
- **Qué cuenta:** entrada nueva + caché + salida (por separado en la UI), minutos y turnos.
- **Lo desconocido:** si la CLI no informa uso, el turno cuenta sus minutos y suma 1 a `turnos_uso_desconocido`; nunca 0 tokens. Al llegar a `turnos_uso_desconocido_max`, la oficina para igual.
- **Qué es duro y qué no:** minutos y turnos se cortan de verdad (watchdog). Los tokens son **admisión conservadora**: el último turno puede pasarse; la UI lo dice así.
- **Al 80 %:** los empleados con `degradable: true` pasan a su `modelo_rapido` (que el validador exige); se cancelan stand-ups y juntas opcionales; aviso ámbar. **Nunca** se degrada a quien tiene `vetar` (§2.2). **Al 100 %:** no se admite nada nuevo; el turno en curso termina.
- **Dinero** aparte: `dinero.tope_api_dia_usd` (lecturas y posts de pago, p. ej. X) y `dinero.tope_cambio_anuncios_dia` / `tope_mensual_anuncios`. Una solicitud N3 que los supere **ni llega a la bandeja**: se rechaza con motivo. El tope interno no garantiza el gasto real de la plataforma: la tarjeta de un cambio de anuncios muestra la regla del proveedor (en Google Ads, que en un mes no pagas más que el presupuesto diario × 30,4, según su página de presupuestos).

### 4.5 Tablero «Hoy en la oficina»

La primera pestaña al entrar. Lee `diario/`, `bandeja.jsonl` y `presupuesto.jsonl`; sin IA. Cuatro bloques:

```
Hoy · jueves 23 oct · Acme Ciencia · Redacción        frontera: cuenta ✓    Gasto: 1,9 M / 6 M tokens · 34 / 120 min · 0 desconocidos
✋ ESPERAN TU APROBACIÓN (2)   [N1 · Artículo «…» → borrador en WordPress]  [N2 · Post de X · 0,015 USD]
✔ HECHO        08:30 guardia · 09:00 radar de temas (5 temas, 2 verificados) · 10:00 artículo (nota 9, Kenji vetó 1 dato)
               ⏭ no convocado: anuncios-revision (gasto 3 % sobre la media)
👥 EQUIPO      Irene · Claude Opus · editó el artículo  |  Lucía · Claude Sonnet (reserva: Antigravity sin sesión)
🧠 APRENDIDO   2 entradas nuevas en lecciones.md  [↗ Traspasar]
⚠ ATENCIÓN     Instagram: token caduca en 6 días     ▶ PRÓXIMO 12:00 redes del día · vie 17:00 retro
```

Cada línea enlaza a la misión, la solicitud o el informe. Cifras con etiqueta (medido / estimado / desconocido). «Hecho» se deriva de eventos confirmados por el servidor, no de lo que un agente dice haber hecho. Es también el resumen diario de Telegram (S5).

---

## 5. Conexiones externas y bandeja de aprobación (fases S3–S6; exigen nivel `cuenta`)

### 5.1 Principio

- **El servidor es el único que habla con las APIs**, con adaptadores pequeños y API directa. Un MCP es un transporte, no una frontera de autorización: los agentes no reciben MCPs de escritura. Un MCP de solo lectura (el [oficial de Google Ads](https://github.com/googleads/google-ads-mcp)) podría llegar después, con la credencial de lectura, nunca la de escritura.
- **Los agentes piden con un archivo:** `bandeja/salida/<rutina>-<n>.json` con `{conector, accion, contenido, motivo}`. El servidor lo valida contra el esquema de esa acción y, si el conector está activo y el nivel coincide (§4.1), lo convierte en una solicitud de `control/sims/<id>/bandeja.jsonl`. Si no, la petición se descarta con motivo en el diario.
- **Al crear la solicitud, el servidor copia los bytes.** El texto y cada medio que cita la petición se copian a `control/sims/<id>/bandeja/<solicitud>/` con su SHA-256 como nombre, se marcan de solo lectura y el hash de la solicitud se calcula **sobre esas copias**. Desde ese momento, lo que el agente haga con `entregas/` no cambia nada: vista previa, aprobación y envío usan las copias.

### 5.2 Credenciales

- En `%LOCALAPPDATA%\OfficeMatrix\control\secretos\<sim>\<conector>.dpapi`, cifradas con DPAPI de tu usuario (vía `powershell -NoProfile` con `ConvertFrom-SecureString`, sin dependencias de Node). En nivel `cuenta` la CLI corre con otro usuario: **no puede descifrarlas** aunque llegara al archivo (que tampoco puede leer). En `contexto` sí podría: por eso no hay conectores en `contexto` (D4).
- Una credencial se liga a `sim + conector + cuenta remota + alcances`: dos marcas nunca comparten token; un token de A no sirve en B.
- OAuth de Google y X: app de escritorio con **redirección a loopback** (`http://127.0.0.1:<puerto>/oauth/<conector>`), **PKCE S256** y `state` de un solo uso atado a sim y conector. Solo se inicia desde el panel.
- La UI muestra por conector: cuenta, alcances, caducidad y «Revocar». Revocar invalida las solicitudes pendientes de ese conector.
- Prueba manual antes de cerrar S3: otro usuario de Windows no descifra el archivo.

### 5.3 Niveles y contrato de aprobación

| Nivel | Ejemplos | Quién decide | Desde dónde |
|---|---|---|---|
| **N0 · leer** | Search Console, métricas de anuncios y de posts | Automático | — |
| **N1 · borrador externo** | Borrador privado en WordPress; subida a la bandeja de borradores de TikTok | Tú, salvo que el conector esté en la lista `aprobaciones.n1_automatico` | Panel, LAN, Telegram |
| **N2 · publicar** | Post del blog, X, Instagram, Facebook | **Tú**, por solicitud | Panel, LAN, Telegram |
| **N3 · gastar** | Cambiar presupuesto, crear o reactivar anuncios | **Tú, dos veces**: aprobar y escribir el importe | Panel o LAN. **Nunca Telegram** |
| — | Borrar contenido, ajustes de cuenta, pagos | No existe en v1 | — |

**Una solicitud es inmutable:**

```json
{ "id": "s-20261023-0007", "sim": "acme-editores", "nivel": "N2",
  "conector": "blog", "accion": "publicar", "cuenta_remota": "acme.example · usuario editor-bot",
  "contenido": { "titulo": "…", "origen": "entregas/2026-10-23-articulo.md", "copia": "9c1e….md", "sha256": "9c1e…" },
  "medios": [ { "origen": "entregas/img/portada.png", "copia": "77ab….png", "sha256": "77ab…" } ],
  "estado_remoto_esperado": { "post_id": 812, "status": "draft", "modified_gmt": "2026-10-23T15:02:11" },
  "importe_max": null, "caduca": "2026-10-24T10:00-06:00",
  "hash": "sha256 del JSON canónico de todo lo anterior", "estado": "pendiente" }
```

- **El hash cubre el conjunto**: texto, bytes de cada medio, cuenta de destino, estado remoto esperado, importe y caducidad (24 h por defecto). Cambiar cualquiera crea otra solicitud y pide otra aprobación. La vista previa se pinta desde esos mismos bytes.
- **Estados:** `pendiente → aprobada → enviando → hecha`, y `rechazada`, `caducada`, `fallida`, `incierta`. Nadie más que tú pasa de `pendiente` a `aprobada`; ningún personaje, ni con `aprobar_interno`.
- **Aprobar** es `POST /api/s/:sim/bandeja/:id/aprobar` con `{hash}` en el cuerpo, cookie de panel o LAN y `Origin` propio. Un `GET` nunca aprueba. Si el hash no coincide: `409` y la solicitud pasa a `caducada`.
- **Un solo envío:** la aprobación y el paso a `enviando` se escriben en la misma operación de la cola; dos clics o dos móviles producen una decisión y un envío. Antes de llamar a la API, el ejecutor vuelve a comprobar caducidad, conexión, cuenta, presupuesto y estado remoto; si algo cambió, vuelve a revisión.
- **Se publica desde la copia, leída una sola vez.** El ejecutor lee cada copia de `control/sims/<id>/bandeja/<solicitud>/` **a un búfer en memoria**, calcula su SHA-256 sobre ese búfer y, si coincide, envía **ese mismo búfer**. No hay «comprobar el archivo y después releerlo»: lo que se comprueba es lo que se manda. `origen` (la ruta en `entregas/`) solo sirve para «Editar»; nunca se vuelve a leer para enviar. Si el hash del búfer no coincide (disco, o una misión de `contexto` que tocó `control/`), la solicitud pasa a `caducada` y no se envía.
- **Sin reintento a ciegas:** si la llamada se corta después de enviarse, la solicitud queda `incierta`. Si la API admite clave de idempotencia, se usa el `id`; si no, se busca la huella (p. ej. una meta `om_solicitud` en el post de WordPress). Sin prueba concluyente, te pregunta. Nunca se reenvía una publicación, un aumento de presupuesto ni un cargo.
- **Deshacer** no es cancelar: despublicar o revertir un presupuesto es otra solicitud, con su propio nivel.
- **Vista previa** igual que la publicación, pintada desde las copias: el HTML del artículo en el iframe con sandbox de `lib/preview.js` (D27); el post de X con recuento de caracteres y precio; el cambio de anuncios con «antes → después» y el gasto de 7 días.
- **Acciones:** Aprobar · Editar (abre el archivo; al guardar, nueva solicitud) · Rechazar con motivo (va a la bitácora; lo lee la retro) · Posponer.

**Desde el móvil.** `lan.js` sirve `/m/bandeja`: una columna, tarjeta, vista previa y dos botones; clave de emparejamiento, cookie de sesión corta, anti-CSRF y `Origin` estricto. Por red local abierta no se envía la clave en claro: HTTPS local de confianza o túnel privado autenticado (decisión de implementación en S3, con su prueba).

**Telegram (S5)**, sobre la §8 anterior: tarjeta con `InlineKeyboard` `[Aprobar] [Rechazar] [Ver]`; el `callback_data` lleva un token opaco de un uso atado a `id + hash + sim`, así que un botón viejo no aprueba la versión nueva. `update_id` y resultado se guardan antes de avanzar el `offset`. N3 solo muestra «Ábrelo en el panel». Un hilo por oficina.

### 5.4 Cada conector

Cifras y enlaces comprobados en `investigacion/fuentes-apis.md` (23-oct-2026). Lo «no confirmado» allí lo es aquí.

| Conector | API | Auth | N0 (solo) | Con aprobación | Ojo |
|---|---|---|---|---|---|
| **Search Console** | [`searchanalytics.query`](https://developers.google.com/webmaster-tools/v1/searchanalytics/query) (hasta 25 000 filas) | OAuth 2.0, alcance `webmasters.readonly` ([authorizing](https://developers.google.com/webmaster-tools/v1/how-tos/authorizing)) | Clics, impresiones, CTR y posición por consulta y página | — (enviar un sitemap sería otra acción) | Datos «in 2-3 days» ([ayuda](https://support.google.com/webmasters/answer/96568?hl=en)): el informe del lunes mira la semana cerrada anterior. [Límites](https://developers.google.com/webmaster-tools/limits): 1 200 consultas/min por sitio. Devuelve filas principales: una fecha sin filas no prueba tráfico cero. |
| **Blog (WordPress)** | [`POST /wp/v2/posts`](https://developer.wordpress.org/rest-api/reference/posts/) | [Application Passwords](https://developer.wordpress.org/rest-api/using-the-rest-api/authentication/) («As of 5.6»), Basic sobre HTTPS, usuario con rol Autor | Listar posts y categorías | N1 crear con `status: "draft"`; N2 pasar a `publish` | Se revoca desde el perfil de WP. Otro CMS = otro conector con las mismas acciones. |
| **X** | [`POST /2/tweets`](https://docs.x.com/x-api/posts/create-post) | OAuth 2.0 de usuario + PKCE: `tweet.write`, `tweet.read`, `users.read` | **Ninguna por defecto**: leer también cuesta | N2 publicar | **Pago por uso**, sin Free/Basic/Pro ([pricing](https://docs.x.com/x-api/getting-started/pricing)): 0,015 USD por post, 0,20 con URL según la página ese día; la tarjeta vuelve a leer el precio y lo descuenta de `dinero.tope_api_dia_usd`. |
| **Instagram** | [Publicación](https://developers.facebook.com/docs/instagram-platform/content-publishing): contenedor → `media_publish` | Token de Meta; cuenta profesional; revisión de la app | Métricas | N2 publicar | La página da dos límites distintos: el conector lee el real en `GET /<IG_ID>/content_publishing_limit` antes de crear la tarjeta. No se graba un número en el código. |
| **Facebook (página)** | [`POST /{page_id}/feed`](https://developers.facebook.com/docs/pages-api/posts) | Token de página | — | N2 (o N1 con `published=false`) | Opcional, S5. |
| **TikTok** | [Subida a la bandeja](https://developers.tiktok.com/doc/content-posting-api-get-started-upload-content) (`video.upload`) | OAuth de TikTok | — | N1 subir como borrador (lo terminas tú en la app) | Sin auditoría, el post directo sale `SELF_ONLY` y hasta 5 usuarios/24 h ([pautas](https://developers.tiktok.com/doc/content-sharing-guidelines)): v1 solo sube borradores. |
| **Meta Ads** | [Marketing API](https://developers.facebook.com/docs/marketing-api/get-started/authorization) | `ads_read` para leer, `ads_management` para cambiar | Gasto, resultados, coste por resultado de ayer | N3 presupuesto o pausa | `ads_management` pide revisión de la app: v1 empieza en solo lectura. |
| **Google Ads** | Google Ads API; [`MutateCampaignBudgets`](https://developers.google.com/google-ads/api/docs/campaigns/budgets/create-budgets) | OAuth; `login-customer-id` si entras por una cuenta de administrador ([call-structure](https://developers.google.com/google-ads/api/docs/concepts/call-structure)) | GAQL de rendimiento (S6) | N3, después | El **developer token se retiró el 9-sep-2026** ([developer-token](https://developers.google.com/google-ads/api/docs/api-policy/developer-token)): no se pide ni se envía. Los [niveles de acceso](https://developers.google.com/google-ads/api/docs/api-policy/access-levels) son del proyecto de Cloud. |
| **Telegram** | [`getUpdates`](https://core.telegram.org/bots/api#getupdates) | Token del bot, cifrado como el resto | — | Aprobar N1/N2 | Un update se confirma al pedir `offset` mayor que su `update_id`. No convive con webhook. |
| **OAuth de Google** | [Apps de escritorio](https://developers.google.com/identity/protocols/oauth2/native-app): loopback + PKCE | — | — | — | Con la app en «Testing», el token de refresco **caduca a los 7 días** ([ayuda](https://support.google.com/cloud/answer/15549945?hl=en)): la UI avisa. |

YouTube queda fuera de v1: la página de `videos.insert` cambió y no se encontró el aviso en el historial (detalle en fuentes); se vuelve a comprobar antes de usarlo.

---

## 6. Dirección de arte: la oficina isométrica

### 6.1 Dos niveles, un ascensor

- **Exterior: la nave de hoy** (`arte/nave-exterior.jpg`). Cambia una cosa: en la pared del fondo, una **fila de ascensores**, uno por simulación, con placa de nombre y luz de estado (verde trabajando, ámbar esperando aprobación, apagada en pausa, roja bloqueada). La nave sigue siendo la vista del edificio.
- **Entrar:** clic en un ascensor (o en el selector) → las puertas se abren (6 cuadros), 300 ms de lluvia de código vertical (caracteres latinos y dígitos, no los de la película) y aparece la oficina. **Salir:** el ascensor de la oficina, en primer plano, vuelve a la nave. Migas siempre visibles: `Nave › Acme Ciencia › misión`. Una notificación nunca te mete en otra oficina sin tu clic.
- **Dentro: la oficina** (`arte/oficina-iso.png`): misma proyección 2:1, pixel art y paleta que la nave, para que no parezca otro juego.

### 6.2 Zonas y estados

Los estados salen de eventos reales del motor (SSE), nunca de un temporizador decorativo.

| Zona | Mobiliario | Estado que comunica |
|---|---|---|
| **Escritorios** (uno por empleado) | Mesa, dos monitores, lámpara, silla | **Trabaja:** sentado, teclea; monitores del color de su CLI; burbuja con la acción real del streaming. |
| **Pizarra y corcho** | Pizarra con ruedas, corcho con notas | **Piensa:** de pie ante la pizarra. Las notas del corcho son los temas de `cola/temas.md` (formas; el texto lo pinta la UI). |
| **Sala de juntas** (acristalada) | Mesa ovalada, 6 sillas, pantalla | **Reunión:** consejo, junta, retro. La pantalla muestra «ronda 2/3»; quien habla se ilumina. |
| **Café** | Barra, cafetera, taburetes, planta | **Sin turno.** Guardia sin convocar = oficina en el café. |
| **Mostrador de bandeja** (junto al ascensor) | Bandeja metálica, lámpara ámbar | **Espera aprobación:** quien la pidió, de pie con ✋ y el número; clic → abre la bandeja. |
| **Escritorio vacío** | Silla girada | **Fuera:** «Lucía · sin sesión»; si trabaja con la reserva, se sienta con la etiqueta del modelo de reserva. |

Luz global: noche normal (verde y ámbar); ámbar general al 80 % del presupuesto; pasillo apagado en pausa. Cada estado lleva icono + texto, nunca solo color. Bajo el nombre, siempre el modelo («Kenji · Codex»). Datos y etiquetas los dibuja el HTML, no se hornean en el fondo.

### 6.3 La tripulación de oficina: arquetipos originales

Los avatares de hoy (`lider`, `elegido`, `piloto`, `capitana`, `operador`, `sabia`) quedan como **bases de silueta**; cada empleado elige `avatar.base` + `avatar.vestuario`.

| Se queda (genérico, del género) | Se evita (identificable) |
|---|---|
| Gafas tintadas pequeñas, **en algunos** personajes | Hombre calvo + gafas redondas oscuras + abrigo largo |
| Gabardina larga como **prenda de oficina**, de color (oliva, carbón) | Traje negro + corbata fina + gafas + pinganillo («el agente») |
| Verde código como **un solo acento**: ribete, cordón, corbata de punto, lápiz | Ropa de cuero o látex negro, pelo engominado hacia atrás |
| Carbón, negro, oliva; siluetas largas y serias | Cabina telefónica, píldoras, conejo blanco, cuchara; lluvia de katakana |
| Diversidad de edades, tonos de piel y cuerpos | Parecidos con actores. Y en el README, «el Líder, el Elegido…» en vez de los nombres de la película |

Vestuarios v1: `gabardina-oficina`, `chaqueta-trabajo`, `blazer-ribete`, `rebeca-corbata`, `camisa-corbata`, `sudadera-blazer`.

**La hoja de esta versión** (`arte/tripulacion-redaccion.png`, generada con Codex el 23-oct-2026 con el prompt de `arte/PROMPTS.md`): Irene (gabardina oliva, gafas ovaladas tintadas, lápiz rojo), Tomás (chaqueta de trabajo, cordón verde, móvil), Lucía (blazer azul petróleo con ribete verde, gafas claras), Kenji (rebeca carbón, corbata verde de punto, gafas tintadas de media montura). Ninguno combina los rasgos de la columna derecha. Recortes en `arte/recorte-*.png`.

Las hojas de los borradores que **no** pasan: la de Codex del borrador B (hombre calvo, gafas redondas oscuras y abrigo largo) y el personaje central de la de Grok de B y de las dos de D (traje negro y gafas). Detalle en `LEEME.md`.

### 6.4 Producción de sprites

- Mismo tamaño, cuadros y nombres que los sprites actuales (caminata de 8 cuadros de frente y 8 de espaldas; sentado, pensar, hablar, celebrar, café), para reutilizar `public/nave.js`. Pivote en los pies; escala constante.
- Acciones nuevas: `de-pie-mostrador` (✋), `pizarra` (escribe), `reunion-sentado`.
- **Pedir magenta no da magenta.** La hoja de esta versión salió con el fondo en `(251,2,250)` y vecinos: **0 de 10 240 píxeles de borde eran `#FF00FF` exacto**. `arte/generacion/recortar.py` mide el borde, normaliza a `#FF00FF`, quita el halo y separa a los personajes aunque se toquen; dejó 0 píxeles magenta opacos en los cuatro recortes. Quedan restos violeta a través de los cristales de las gafas de Kenji y en el pelo de Irene: revisar a mano antes del sprite final.
- Fondo y mobiliario que tapa (cristal de la sala, barra del café) van en capas separadas para la oclusión.
- Antes de publicar el repositorio: prompts, procedencia y revisión humana de parecidos de cada imagen.

---

## 7. Fases de construcción

Cada fase deja la app usable. Las fases 0–4 de la propuesta anterior (medir, eficiencia, gráficas, Oráculo, modos) no se repiten; S1 no depende de ellas.

| Fase | Qué | Terminado cuando |
|---|---|---|
| **S1 · Simulaciones (contexto)** | Carpetas, `simulacion.json`, empleados con modelo, memoria propia, traspaso, alcance en la API, clave de panel, entorno limpio, hogares de CLI, selector. Solo misiones manuales. | §8.4 unitarias en verde + R-INSPECCION y R-CANARIO-CONTEXTO. |
| **S1F · Frontera** | Cuenta de Windows por simulación, ACL, worker, logins dentro de la cuenta, chip de nivel. | R-FRONTERA, R-FRONTERA-ESCRITURA y R-MISION-MINIMA en dos oficinas. **La fase 1 del brief = S1 + S1F.** |
| **S2 · Rutinas y guardia** | `lib/schedule.js`, `lib/guard.js`, recuperación, presupuesto con reserva, `diario/`, pestaña «Hoy». Solo en `cuenta`. | Pruebas R1–R7 (§8.5); una semana con la oficina de editores **sin conectores** sin duplicados ni avalanchas al reiniciar. |
| **S3 · Bandeja, secretos y lectura** | `lib/inbox.js`, solicitudes con hash, `/m/bandeja` por LAN, secretos DPAPI, OAuth loopback, Search Console (N0). | B1–B7 (§8.5); el informe del lunes sale con datos reales de una propiedad tuya. |
| **S4 · Blog** | WordPress N1 y N2. | Un artículo aprobado desde el móvil se publica una vez; un fallo simulado a mitad deja `incierta`. |
| **S5 · Redes + Telegram** | X, Instagram (N2), TikTok (N1), Telegram con botones y resumen. | Una semana: cero publicaciones sin aprobación atada a su hash. |
| **S6 · Anuncios** | Meta Ads y Google Ads en lectura; después N3. | Un cambio por encima del tope ni llega a la bandeja; uno por debajo exige escribir el importe. |
| **V1 · Oficina isométrica** (en paralelo desde S1) | Escena, ascensores en la nave, estados de §6.2, sprites de vestuario. | Una persona dice en 10 s quién trabaja, quién espera tu aprobación y quién está fuera; sin errores de consola a 360, 768 y 1440 px. |
| **S7 · Ollama** | Empleado local vía `codex --oss`. | Fixture real + misión mínima. |
| **SB · Blindado** (opcional) | El mismo worker dentro de una VM Hyper-V por oficina. | R-FRONTERA y R-MISION-MINIMA dentro de la VM. |

Mientras no exista V1, dentro de una simulación se ve la vista clásica (estaciones) con los nombres de los empleados y la placa de la oficina como imagen estática.

---

## 8. Fase 1 al detalle (S1 + S1F)

La copia de referencia solo trae documentación (README, `docs/`), no `server.js` ni `lib/`. Los nombres de abajo salen del README y de `DECISIONES.md`; quien construya confirma las firmas reales antes de tocar nada y no inventa números de línea.

### 8.1 Archivos

| Archivo | Nuevo / cambia | Qué |
|---|---|---|
| `lib/simulations.js` | nuevo | `listar()`, `cargar(id)`, `crear(def)`, `guardar(id, def, hashPrevio)`, `archivar(id)`, `validar(def) → {ok, errores[], avisos[]}`, `ctxDe(id) → {id, raiz, memoria, proyectos, plantillas, nivel, def}`. `ctxDe('edificio')` devuelve las rutas de hoy. Escritura atómica. |
| `lib/scope.js` | nuevo | `scope(req) → ctx` desde `/api/s/:sim/…` (o `edificio` en rutas viejas); 404 si no existe; 403 si está archivada y la ruta escribe. `dentroDe(ctx, ruta)` con `realpath`. Registro de rutas para P-RUTAS-DECLARADAS. |
| `lib/acceso-local.js` | nuevo | Clave de panel de un uso → cookie; middleware que exige cookie (o sesión LAN) en `/api`, `/raw` y SSE. |
| `lib/cli-env.js` | nuevo | `envParaTurno`, `argsParaEmpleado(agente, empleado, {reserva, rapido})`, `hogarDe(sim, cli)`, `buscarInstruccionesEnPadres(ruta, raizSim)`, lista de flags prohibidos. |
| `lib/lanzador.js` | nuevo | `lanzar({ctx, empleado, turno}) → emisor de eventos` con dos motores: `local` (contexto, el `spawn` de hoy) y `cuenta` (cola para el worker). |
| `lib/frontera.js` | nuevo (S1F) | `estado(id)`, `activar(id)` (lanza el script elevado y espera su resultado), `instalarWorker()` (copia `node.exe`, `worker.js` y `cli-env.js` a `%ProgramData%\OfficeMatrix\` y guarda sus hashes), `iniciarWorker(id)` (§1.4.3), `tokenWorker(id)`, `abrirConsolaLogin(id, cli)`, `comprobar(id, {conClis})` (§8.2), `invalidar(id, motivo)`, rutas `/w/v1`. |
| `lib/control.js` | nuevo | Lectura y escritura de `control/sims/<id>/` con hash en memoria de cada archivo escrito; `vigilar(id)` marca `bloqueada: control cambiado fuera del panel`; `politica.jsonl`. |
| `lib/mascara.js` | nuevo | `rutinasEfectivas(def, estado) → [{id, efectiva, motivo}]` (§4.1). En S1 solo se calcula y se muestra; nadie la ejecuta. |
| `worker/worker.js` | nuevo (S1F) | Bucle `trabajo → lanzar CLI → eventos → fin`, latido, watchdog, kill de árbol, comprobación de entorno (`ENTORNO_AJENO`) y las sondas de `comprobar` sin IA. Sin dependencias; usa `lib/cli-env.js`. Corre desde su copia en `%ProgramData%`. |
| `scripts/frontera-crear.ps1`, `scripts/frontera-quitar.ps1` | nuevos (S1F) | §1.4.1. Salida JSON en un archivo de `control/` para que `lib/frontera.js` lo lea. |
| `lib/memory.js` | cambia | Todas las funciones reciben `ctx`. Fusión desde el manifiesto autoritativo de `control/sims/<id>/misiones/`. `traspasar(origen, tema, titulo, destino)`, `aceptarEntrante(ctx, archivo, tema)`. Los entrantes viven en `control/`, así que relevancia y búsqueda no los ven. |
| `lib/brief.js` | cambia | Bloque fijo de marca + ficha del empleado arriba; memoria solo de `ctx`; `turno-<empleado>.md`; escribe el manifiesto en `control/` y su copia informativa en `.office/contexto.json`. |
| `lib/cycle.js`, `lib/failure.js` | cambia | Turnos por empleado; reserva una vez ante `SIN SALDO/LÍMITE/SIN SESIÓN`; `modelo_efectivo` en el reporte; marca «diversidad reducida». |
| `lib/stats.js` | cambia | Expedientes por empleado, con el modelo de cada turno. |
| `server.js` | cambia | Router `/api/s/:sim/…` + alias; `acceso-local`; lanzar con `lanzador`; eventos SSE con `sim`. |
| `public/index.html`, `app.js`, `style.css` | cambia | Selector, alta en 3 pasos, ficha del empleado, chip de nivel, Cerebro con «Traspasar» y «Entrantes», migas. `AbortController` + época de selección: una respuesta vieja de A no se pinta en B. |
| `tests/sim-*.test.js`, `tests/helpers/cli-falsa.js`, `tests/sondas/fuga.js` | nuevos | §8.4. |
| `README.md` | cambia | Sección «Simulaciones»; niveles y su coste; quitar los nombres de los personajes de la película. |

### 8.2 API

JSON. Todas exigen la cookie de panel (o sesión LAN); las que escriben, además, `Origin` propio y `Content-Type: application/json`. Errores `{error: {codigo, mensaje}}`. Un id de otra simulación responde **404**, nunca 403 (no se confirma que existe). No se devuelven rutas del disco ni secretos.

| Método y ruta | Cuerpo | Respuesta | Notas |
|---|---|---|---|
| `GET /api/sims` | — | `[{id, nombre, estado, nivel, empleados, enCurso, bandeja}]` | `edificio` primero. |
| `POST /api/sims` | `simulacion.json` (sin `id` → se genera del nombre) | `201 {id, nivel: "contexto"}` · `400 {errores}` · `409` si existe | Crea carpetas y `memoria/marca.md`. **No lanza nada** (crear no gasta). |
| `GET /api/sims/:sim` | — | definición + `ETag` + `avisos` (falsa diversidad, modelo sin verificar, CLI no instalada, CLI parcial) + `estado` (nivel efectivo, worker, bloqueo) + `rutinas_efectivas[]` (§4.1) | |
| `PUT /api/sims/:sim` | definición completa | `200` · `400` · `412` si `If-Match` no coincide | Prohibido cambiar `id`, `version` o poner `lee_edificio: true`. Cambiar `modelo` deja línea en la bitácora. |
| `POST /api/sims/:sim/archivar` | — | `200` | No borra nada. |
| `GET /api/s/:sim/chats` · `POST /api/s/:sim/chats` · `GET/POST /api/s/:sim/chats/:id/…` | como hoy (+ `empleados[]` en el alta) | como hoy | Con alcance. `/api/chats/…` = `/api/s/edificio/chats/…`. `POST` → `409 INSTRUCCION_PADRE` antes de gastar un turno; `409 CLI_PARCIAL` si un empleado no pasó R-CANARIO-CONTEXTO y la sim está en `contexto`. |
| `POST /api/s/:sim/chats/:id/reanudar` · `…/intervencion` `{texto}` · `…/parar` | | | La intervención no sustituye el pedido; `parar` devuelve `202` y libera la reserva solo cuando el árbol murió. |
| `GET /api/s/:sim/brain` · `…/brain/search?q=` · `PUT …/brain/:tema` `{texto, hashPrevio}` | | `412` si cambió | `tema` es slug, nunca ruta. Solo la memoria de esa sim. |
| `POST /api/s/:sim/brain/traspaso` | `{tema, titulo, destino}` | `201 {archivo}` en `control/sims/<destino>/entrantes/` | `destino ≠ sim`; historial en las dos. |
| `GET /api/s/:sim/brain/entrantes` · `POST …/entrantes/:archivo/aceptar` `{tema}` · `DELETE …/entrantes/:archivo` | | | Leen y escriben `control/sims/:sim/entrantes/`; `:archivo` es un nombre, nunca una ruta. |
| `POST /api/sims/:sim/control/aceptar` · `…/control/deshacer` | `{hash}` | `200` | Salen del bloqueo «control cambiado fuera del panel»: aceptar adopta el archivo actual (y deja línea en `politica.jsonl`); deshacer restaura la última versión escrita por la API. Solo panel local. |
| `GET /raw/:sim/:proyecto/*ruta` | — | archivo | Las tres capas de `lib/preview.js`; `/raw/:proyecto/…` = edificio. |
| `GET /api/clis/modelos` | — | `{claude: ["opus","sonnet","fable"], agy: […], grok: […], codex: null}` | Caché de 24 h. |
| `GET /api/sims/:sim/frontera` (S1F) | — | `{nivel, cuenta, worker: {vivo, ultimoLatido}, clis: {claude: {sesion, version}}, rFrontera: {fecha, resultado}}` | |
| `POST /api/sims/:sim/frontera/activar` (S1F) | — | `202` | Lanza el script elevado; solo desde el panel local (no desde LAN). |
| `POST /api/sims/:sim/frontera/login` (S1F) | `{cli}` | `202` | Abre la consola de login como la cuenta. |
| `POST /api/sims/:sim/frontera/comprobar` (S1F) | `{con_clis: bool}` | `202 {comprobacion: "f-20261023-0001"}` · `409 COMPROBACION_EN_CURSO` · `412 SIN_CUENTA` · `412 WORKER_SIN_LATIDO` · `429` si hubo otra hace menos de 10 min | El botón «Comprobar». Solo desde el panel local (con LAN: `403`). Una a la vez por simulación y no mientras corre una misión suya. `con_clis: false` (por defecto) = sondas sin IA, 0 tokens; `true` añade la parte de R-FRONTERA que se lo pide a cada CLI con «aprobar todo» y **gasta un turno por CLI**: la UI lo dice antes de enviar. |
| `GET /api/sims/:sim/frontera/comprobaciones/:id` (S1F) | — | `{id, estado, inicio, fin, con_clis, versiones: {worker, node, clis{}}, hash_acl, sondas: [{id, objetivo, metodo, esperado, obtenido, ok}]}` | `estado`: `en_cola → ejecutando → verde \| rojo \| error`; y `invalidada` (ver abajo). |

**Qué hace «Comprobar».** (1) El servidor siembra canarios nuevos en `control/sims/<id>/frontera/canario-<8 hex>`, en la memoria de **otra** simulación (si no hay otra, en `simulaciones/_sonda/`, creada con el mismo ACL heredado que cualquier hermana y borrada al acabar), en `%USERPROFILE%\.officematrix-sonda\` (tu perfil, sin tocar `~/.claude/`) y en `%LOCALAPPDATA%\OfficeMatrix\control\`; además intenta listar `C:\Users\<tú>\.claude\`; crea una junction hacia la hermana dentro de `proyectos/_sonda/`. (2) Encola en el worker las sondas de R-FRONTERA y R-FRONTERA-ESCRITURA (`cmd /c type`, `node -e fs.readFileSync`, escritura, borrado, renombrado, `mklink /h` y `/j`, `GET /api/sims` sin cookie). (3) El worker devuelve cada resultado por `/w/v1/turnos/:id/eventos`; el servidor **también** busca los canarios byte a byte en todo lo que B pudo escribir (`proyectos/_sonda/`, salidas y logs). (4) Verde solo si cada sonda dio el resultado esperado y ningún canario aparece. (5) Limpia canarios, junction y `_sonda/`.

**Persistencia.** Cada comprobación es una línea en `control/sims/<id>/frontera/comprobaciones.jsonl` (append, en la cola de §2.1); `estado.json` guarda la última (`rFrontera: {id, fecha, estado, versiones, hash_acl}`). **Se invalida sola** —la máscara de rutinas vuelve a «frontera sin comprobar»— si cambia la versión de una CLI, de `node` o del worker, o si `hash_acl` (hash de la salida de `icacls` sobre la raíz, sus subcarpetas y `%ProgramData%\OfficeMatrix\`) difiere del de la comprobación. La comprobación sin CLIs basta para pasar a verde las sondas del SO; la de `con_clis: true` es la que exige R-FRONTERA para cerrar S1F.
| `/w/v1/*` (S1F) | | | Solo el worker; §1.4.3. No acepta la cookie de panel; `/api` no acepta el token de worker. |

Eventos SSE: los de hoy ganan `sim`. La UI ignora los de otra sim salvo los contadores del selector.

### 8.3 La UI de la fase 1

- **Selector** a la izquierda de la barra superior: `🛸 Edificio ▾` → simulaciones con su luz, su chip (`contexto` / `cuenta ✓`) y el número en bandeja; al final «＋ Nueva simulación».
- **Nueva simulación:** asistente de 3 pasos (marca → empleados → revisar), sin rutinas ni conexiones. Plantilla «Redacción de contenido» = el ejemplo de Acme Ciencia con todo apagado. También se puede pegar un `simulacion.json`.
- **Ficha del empleado** (clic en su estación): nombre, puesto, modelo, modelo rápido, reserva (desplegables de `/api/clis/modelos`), `degradable`, objetivo, estilo, poderes.
- **Frontera:** en la ficha de la simulación, «Activar frontera» → UAC → lista de CLIs con «Iniciar sesión» → «Comprobar» (`POST …/frontera/comprobar`, §8.2; casilla «también con las CLIs (gasta un turno por CLI)») → tabla de sondas con lo esperado y lo obtenido. Mientras no esté en verde, el chip dice `contexto` y cada rutina aparece con su motivo de la máscara («frontera sin comprobar», «conector x apagado»).
- Accesible: navegación con teclado, estado en texto, sin errores de consola a 360/768/1440 px y zoom 200 %.

### 8.4 Pruebas de la fase 1

Unitarias e integración (`npm test`, sin CLIs reales):

1. **S1-VALIDAR:** `lee_edificio: true`, `id: "edificio"`, `id: "con"`, un campo `token` en `conexiones`, dos empleados con el mismo `id`, un `cli` inexistente, una `condicion.fn` desconocida, `vetar` con `degradable: true`, `degradable: true` con `modelo_rapido: null`, `degradable: false` con `modelo_rapido` no nulo, `n1_automatico: true` (booleano en vez de lista), un conector de `n1_automatico` sin acción N1, un `solicita` cuyo nivel no coincide con `conexiones`, `convoca_si` en una rutina `equipo`, `n3_confirmar_importe: false` y una clave desconocida (`tope_api_dia`) → error; dos revisores con el mismo modelo → aviso. **Y `final/simulacion.ejemplo.json` de este plan pasa sin errores** (fixture `tests/fixtures/acme-editores.json`).
2. **S1-MASCARA:** el ejemplo cargado sin frontera → las 8 rutinas `efectiva: false`; las 7 con `activa: true`, motivo «frontera sin comprobar», y `anuncios-revision`, «desactivada». Con un `estado.json` falso en verde: `descarga-search-console` → «conector search_console apagado»; `articulo-blog` → efectiva (la parte de ejecutarla y descartar su petición es R7, en S2).
3. **S1-EDIFICIO:** `ctxDe('edificio')` devuelve exactamente las rutas de hoy, con y sin `OFFICEMATRIX_HOME`.
4. **P-MIGRACION:** con una copia real de `proyectos/` de tres misiones, la versión nueva las abre, exporta y reanuda igual (mismo `GET /api/chats/:id` byte a byte salvo `sim`); `GET /api/chats` no lista misiones de simulaciones; con `SIMULACIONES=0` la suite previa entera pasa.
5. Las catorce de §1.7: P-CANARIO-EDIFICIO, P-CANARIO-HERMANA, P-FUSION, P-ENTORNO, P-PADRE, P-ARGV, P-FLAGS-PROHIBIDOS, P-API-ALCANCE, P-RUTAS-DECLARADAS, P-API-LOCAL, P-TRASPASO, P-MANIFIESTO, P-POLITICA, P-RUTA.
6. **S1-MISMA-CLI:** dos empleados con la misma CLI en un Relevo con agentes falsos: dos `turno-<empleado>.md`, dos filas en Expedientes, nota de cada uno.
7. **S1-RESERVA:** el agente falso de `agy` sale con 402 → el turno se repite una vez con la reserva; el reporte dice «trabajó con la reserva»; si la reserva también cae, el empleado sale del ciclo como hoy; si la reserva coincide con el revisor, «diversidad reducida».
8. **S1-SNAPSHOT:** cambiar la ficha durante una misión no cambia el equipo de esa misión.
9. **S1-CONCURRENCIA:** dos misiones de sims distintas a la vez escriben en sus memorias; ninguna línea acaba en la otra.
10. **S1-CONTROL:** `POST …/control/aceptar` con un hash viejo → `409`; `…/deshacer` restaura byte a byte la última versión de `politica.jsonl`; arrancar el servidor con `simulacion.json` cambiado en disco → aviso «política cambiada desde el último cierre» y la sim no admite turnos hasta decidir.
11. **S1-UI** (`tests/helpers/ui-probe.js` sobre la demo): el selector lista edificio + 2 sims; cambiar de sim cambia misiones, cerebro y equipo; una respuesta retrasada de A no se pinta en B; `#s=<sim>&m=<id>` abre la misión correcta; cero excepciones.
12. **S1F-WORKER** (con un worker en el mismo usuario y una CLI falsa): token de A contra `/w/v1` de B → 404; el worker no puede llamar a `/api`; sin latido 90 s → `bloqueada`; el watchdog de 3 s mata hijo y nieto en menos de 30 s y la reserva no se libera hasta entonces.
13. **S1F-ENTORNO-WORKER:** arrancado con `USERPROFILE` distinto del de su cuenta, o con `CLAUDE_CODE_SESSION_ID`/`ANTHROPIC_API_KEY` en el entorno → sale con `ENTORNO_AJENO` sin lanzar nada. `worker.js` de `%ProgramData%` con un byte cambiado → el servidor lo vuelve a copiar antes de lanzarlo. El argv real del worker no contiene el token.
14. **S1F-COMPROBAR** (worker y sondas falsas): dos `POST …/comprobar` seguidos → `202` y `409`; desde LAN → `403`; sin latido → `412`; una sonda que «lee» un canario → `rojo` aunque las demás pasen; un canario que aparece en un log de B sin que la sonda lo informe → `rojo`; cambiar la versión de una CLI → la última pasa a `invalidada` y la máscara vuelve a «frontera sin comprobar»; la línea queda en `comprobaciones.jsonl` tras reiniciar el servidor.

Reales (misión mínima con login existente del propietario, sin publicar): **R-INSPECCION, R-CANARIO-CONTEXTO, R-FRONTERA, R-FRONTERA-ESCRITURA, R-MISION-MINIMA** (§1.7); R-FRONTERA y R-FRONTERA-ESCRITURA se ejecutan con el mismo botón «Comprobar» (`con_clis: true`) que usará el usuario. Se anota el resultado en el HANDOFF de la misión que construya. Sin ellas la fase 1 no se da por terminada.

### 8.5 Pruebas que ya quedan nombradas para S2 y S3

- **R1** repetir el disparador 100 veces → una ejecución. **R2** una en curso → la siguiente `omitida: en curso`. **R3** DST en una zona con cambio: ni duplicado ni salto. **R4** tres días apagado → como máximo una por rutina, en la cola. **R5** guardia sin motivo → 0 procesos y una línea en el diario. **R6** dos reservas compiten → no se pasa el tope de admisión. **R7** `articulo-blog` efectiva con `blog` apagado → la entrega se produce, la petición N1 queda `peticion_descartada` en el diario y la bandeja sigue vacía; `convoca_si` que no se cumple → 0 procesos.
- **B1** cambiar un byte del archivo, un medio o la cuenta → nueva solicitud; la aprobación vieja da `409`. **B7** mientras la solicitud pasa de `aprobada` a `enviando`, un proceso reescribe `entregas/…-articulo.md` y la portada en bucle → el adaptador falso recibe exactamente los bytes cuyo hash se aprobó; cambiar un byte de la copia en `control/` antes del envío → `caducada`, sin llamada. **B2** corte tras enviar → `incierta`, sin reenvío. **B3** dos aprobaciones simultáneas → un envío. **B4** `GET` y `Origin: null` no aprueban. **B5** N3 por Telegram → «Ábrelo en el panel». **B6** revocar un conector → sus pendientes caducan.

---

## 9. La oficina de ejemplo: Acme Ciencia · Redacción

`simulacion.ejemplo.json` es JSON válido; estos son sus comentarios.

| Empleado | Puesto | Modelo · rápido · reserva | Por qué |
|---|---|---|---|
| Irene Vidal | Directora editorial | Claude `opus` · — · Codex | Modera, aprueba internamente y veta. No publica. Como veta, `degradable: false`: al 80 % sigue en Opus y, si su paso no cabe, espera. |
| Tomás Ibarra | Radar de temas | Grok `grok-4.7` · `grok-4.7-build-fast` · Claude `sonnet` | Busca en la web y en X. `degradable: true`. |
| Lucía Andrade | Redactora | agy `gemini-4-argon-medium` · `gemini-3.8-flash-medium` · Claude `sonnet` | Escribe con otro modelo que quien verifica y quien edita. `degradable: true`, `activo_en_copia_compartida: false`. |
| Kenji Morales | Verificador de datos | Codex `null` (el de la cuenta) · — · Claude `opus` | Veta con enlace y cita: `degradable: false`. |
| Sara Quintero | SEO y Search Console | Claude `sonnet` · — · Codex | Lee `datos/search_console/`. `degradable: false`: Sonnet ya es el modelo medio y en la lista de alias no hay uno más rápido verificado. |
| Nico Ferrer | Redes y anuncios | Grok `grok-4.7-build-fast` · — · Claude `sonnet` | Adapta piezas; vigila anuncios. `degradable: false`: ya usa el modelo rápido. |
| Taller local | (apagado) | Codex `--oss` + Ollama | Puesto de S7; no entra en ninguna rutina. `degradable: false`. |

Así se cumple la regla de §2.2 en todo el equipo: quien veta (Irene, Kenji) no se degrada, y quien se degrada (Tomás, Lucía) tiene `modelo_rapido`.

- **Quien se revisa usa modelos distintos:** Lucía (Gemini) redacta, Kenji (Codex) verifica, Irene (Claude Opus) edita.
- **Nivel requerido `cuenta`:** hasta que «Comprobar frontera» esté en verde, la oficina sirve para misiones manuales. Sus rutinas llevan `activa: true` (la configuración que quieres) pero la máscara de §4.1 las deja sin efecto, motivo «frontera sin comprobar»; `anuncios-revision` va `activa: false` hasta S6. Con la frontera en verde y los conectores aún apagados, corren `guardia`, `radar-temas`, `articulo-blog`, `redes-del-dia` y `retro`; sus peticiones a `blog`, `x`, `instagram` y `tiktok` no entran en la bandeja y las entregas quedan «sin conector: publicar a mano». `descarga-search-console` espera a su conector, e `informe-search-console` no se convoca porque no hay datos nuevos.
- **Rutinas:** `guardia` (diario 08:30); `descarga-search-console` (tipo `conector`, lun 07:45); `radar-temas` (lun-vie 09:00, si quedan menos de 10 temas); `articulo-blog` (mar y jue 10:00, si hay un tema elegido: Torneo de titulares → Relevo Lucía → Kenji → Sara → Irene → solicitud N1 de borrador en WordPress); `redes-del-dia` (lun-vie 12:00, `si_se_perdio: omitir`); `informe-search-console` (lun 08:00, si hay datos nuevos); `anuncios-revision` (diario 07:30, tipo `conector` que solo convoca a Nico e Irene si hay desviación); `retro` (vie 17:00, Consejo presidido por Irene, escribe memoria).
- **Presupuesto:** 6 M tokens, 120 min, 40 turnos y 3 de uso desconocido al día; dinero en MXN con tope de cambio diario de anuncios 500 y mensual 15 000, y 2 USD/día de API de pago (X).
- **Conexiones:** todas `activo: false`; `aprobaciones.n1_automatico: []` (ni siquiera los borradores de WordPress salen sin tu clic); Google Ads solo lectura; Telegram nunca N3.
- **Escena:** plantilla `redaccion-v1`, un escritorio por empleado activo.

---

## 10. Riesgos y lo que no sabemos

- **La frontera por cuenta es diseño, no prueba.** Lo que depende de ella (ACL con traverse, CLIs que funcionan y hacen login dentro de otra cuenta, `Start-Process -Credential` desde el servidor sin elevar, Windows Home) lo confirma o lo tumba R-FRONTERA y R-MISION-MINIMA. Si falla, la salida es `blindado` (VM), no rebajar la promesa en silencio.
- **`-UseNewEnvironment` junto a `-Credential`**: la doc dice qué variables usa («Machine and User scopes») pero no de qué usuario cuando cambia la cuenta. El worker lo comprueba al arrancar (`ENTORNO_AJENO`) en vez de suponerlo.
- **`contexto` corre como tú** y puede escribir `control/` (§1.1): se detecta y bloquea, no se impide. Mientras haya simulaciones en `cuenta` con rutinas, conviene no dejar misiones de `contexto` desatendidas.
- **Cuatro logins por oficina** y tokens de refresco que caducan por separado. Es el precio de separar de verdad.
- **El cupo es uno.** Varias oficinas con rutinas pueden agotar la suscripción de la que vive tu trabajo manual: tope global y semáforo por CLI obligatorios.
- **`agy`**: sin hogar documentado y con riesgo de términos. En `contexto` va apagado salvo que pase su canario; en la versión pública, apagado.
- **Grok y `[compat.*]`**: que apagarlo funcione como dice su doc lo comprueba R-INSPECCION; que `rules=false` ignore `CLAUDE.md` no está documentado (lo cubre `INSTRUCCION_PADRE`).
- **Publicar en nombre de 8 M de seguidores** tiene más riesgo que gastar tokens: N2 nunca es automático y la vista previa es la publicación real.
- **Meta, X y TikTok cambian permisos y precios** y algunos exigen revisión de la app: S5 y S6 empiezan volviendo a leer las fuentes.
- **El arte:** un concepto no es un sprite. V1 necesita una tanda de producción con recortes, capas de oclusión y revisión de parecidos.

Fuentes: `investigacion/fuentes-apis.md` (APIs y CLIs, 23-oct-2026), los enlaces de Microsoft de §1.4 (consultados el 23-oct-2026) y las ayudas de las CLIs instaladas, citadas con su versión en §1.3.
