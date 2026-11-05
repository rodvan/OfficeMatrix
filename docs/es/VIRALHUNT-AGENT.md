# Esta oficina como agente de ViralHunt

[![English](https://img.shields.io/badge/Language-English-blue.svg)](../VIRALHUNT-AGENT.md)
[![Español](https://img.shields.io/badge/Idioma-Español-orange.svg)](VIRALHUNT-AGENT.md)

El compositor de ViralHunt tiene un cuadro **Pídele a un agente**: la persona elige un agente, escribe "acorta esto para X y Bluesky" o "revísalo antes de publicar", y el agente recibe el post tal como está en la pantalla. Una oficina de OfficeMatrix puede ser ese agente. No hay nada que instalar: ViralHunt llama a la oficina por la misma puerta y el mismo túnel que usan los Grok Bots, y contesta el anfitrión del chat de la oficina.

Es la dirección contraria al conector editorial (`docs/es/EDITORIAL.md`): allí la oficina llama a ViralHunt con un token; aquí **ViralHunt llama a la oficina** con una llave compartida. Son independientes. Una oficina puede tener una cosa, la otra o las dos.

## Cómo se conecta, en cuatro pasos

1. **Puerta y túnel.** En el ⚙ de la oficina, *Conectar un Grok Bot*: la puerta en 4323 encendida y la **URL pública del túnel** guardada (**Arrancar el túnel** lo arranca y la guarda; ver [El túnel](#el-túnel)). ViralHunt llega a la oficina en `<túnel>/bots/vh/<id de la oficina>`. Sin URL de túnel la tarjeta del agente no muestra URL.
2. **La llave.** Abre `/editorial`, elige la oficina, pestaña *Conexión ViralHunt*, tarjeta **Esta oficina como agente de ViralHunt**. Pulsa **Generar y guardar una llave**. La llave se muestra una sola vez; cópiala. (O genera la llave en la página Agentes de ViralHunt y pégala aquí con **Guardar esta llave**.) Queda en `oficinas/<id>/viralhunt.secreto.json`, junto al token editorial cuando lo hay, y no vuelve a viajar al chat, a los logs ni a ninguna respuesta de la API.
3. **Pega las dos cosas en ViralHunt.** ViralHunt → Account → **Agentes** → Conectar un agente: la URL de la tarjeta y la misma llave. Marca qué sabe hacer la oficina (textos, revisión; imágenes solo si su CLI puede generarlas).
4. **Probar.** El botón **Probar** de ViralHunt manda un ping. La oficina contesta `pong` en la misma respuesta HTTP y la página de ViralHunt muestra la latencia. La bitácora de la oficina dice "ViralHunt probó esta oficina como agente".

## El túnel

ViralHunt está en internet y no pueden llamar a tu ordenador por su nombre. Un túnel de Cloudflare le da a la puerta (`http://localhost:4323`, y solo a la puerta) una dirección pública `https://`. OfficeMatrix nunca descarga ni instala `cloudflared` y nunca pide permisos de administrador: el programa lo pones tú en tu equipo, y OfficeMatrix solo lo arranca cuando pulsas el botón.

### 1. Instalar cloudflared

- **Windows, con winget:** `winget install --id Cloudflare.cloudflared`.
- **Windows, sin winget (descarga directa):** abre [github.com/cloudflare/cloudflared/releases](https://github.com/cloudflare/cloudflared/releases), baja `cloudflared-windows-amd64.exe` (`-arm64` en un PC ARM), crea la carpeta `%USERPROFILE%\cloudflared` y guarda ahí el archivo **renombrado a `cloudflared.exe`**. No se ejecuta ningún instalador y no hace falta ser administrador.
- **macOS:** `brew install cloudflared`, o el `cloudflared-darwin-*.tgz` de la misma página, descomprimido en `/usr/local/bin`.
- **Linux:** el archivo `cloudflared-linux-amd64` (o `-arm64`) de la página de versiones, guardado como `~/.cloudflared/cloudflared` y con permiso de ejecución (`chmod +x`), o el paquete de tu distribución.

OfficeMatrix lo busca en este orden: la ruta que pegaste en el diálogo (**Ruta de cloudflared**, guardada en `bots-ajustes.json` como `cloudflaredPath`), el `PATH`, y después `%USERPROFILE%\cloudflared\`, `%ProgramFiles%\cloudflared\`, `~/.cloudflared/`, `/usr/local/bin` y `/opt/homebrew/bin`. Si no lo encuentra, el diálogo dice qué archivo bajar y dónde ponerlo.

### 2. Túnel rápido (para probar)

En el ⚙ de la oficina → *Conectar un Grok Bot*, pulsa **Arrancar el túnel**. OfficeMatrix ejecuta

```
cloudflared tunnel --url http://localhost:4323
```

escribe su salida en `logs/cloudflared.log`, lee de ese log la dirección `https://<palabras-al-azar>.trycloudflare.com` y la guarda por ti como **URL pública del túnel**. Si ya hay un túnel en marcha (el que arrancó él, o uno que arrancaste a mano y ya contesta), no lanza otro. Nada arranca solo.

También puedes hacerlo a mano: ejecuta el mismo comando en una terminal y pega la dirección que imprime en **URL pública del túnel**.

### 3. Túnel con nombre (para quedarte con la dirección)

Un túnel rápido no tiene garantía de disponibilidad y Cloudflare dice que para lo que tenga que seguir en pie se use un túnel con nombre. Con una cuenta de Cloudflare y un dominio en Cloudflare:

```
cloudflared tunnel login
cloudflared tunnel create officematrix-bots
cloudflared tunnel route dns officematrix-bots bots.tudominio.com
```

Después, un `config.yml` junto al archivo de credenciales del túnel (`~/.cloudflared/` o `%USERPROFILE%\.cloudflared\`):

```yaml
tunnel: officematrix-bots
credentials-file: <la ruta del .json que imprimió "tunnel create">
ingress:
  - hostname: bots.tudominio.com
    service: http://localhost:4323
  - service: http_status:404
```

Arráncalo con `cloudflared tunnel run officematrix-bots` (o instálalo como servicio) y pega `https://bots.tudominio.com` en **URL pública del túnel**. El panel de Zero Trust (Networks → Tunnels) hace lo mismo con clics.

El servicio tiene que ser exactamente `http://localhost:4323`, la puerta de los bots. No apuntes nunca el túnel al puerto 4321, al 4322 ni al panel. `BOTS_PORT` cambia el puerto de la puerta; el túnel apunta entonces a ese puerto, y solo a la puerta.

### La dirección del túnel rápido cambia

> ⚠️ Una dirección `*.trycloudflare.com` es nueva **cada vez que el túnel arranca** (después de reiniciar el equipo, de cerrar su ventana, o de volver a pulsar el botón cuando se cayó). El diálogo y la tarjeta del agente de ViralHunt muestran un aviso mientras la URL pública sea una de estas. Después de cada reinicio, copia la URL nueva en ViralHunt → Account → Agents y en tus rutinas de Grok Bot. Para una dirección que no cambie, usa un túnel con nombre.

El mismo túnel sirve a los Grok Bots de todas las oficinas ([GROK-BOTS.md](GROK-BOTS.md#el-túnel)).

## Qué pasa con un encargo

ViralHunt hace un POST firmado con `type: "task"`: la petición de la persona, el post (texto, primer comentario, notas, media, hilo), las cuentas del proyecto con sus límites de texto, la voz de la marca y el idioma del proyecto, los límites por red, un `reply_schema` y un `reply_to` de un solo uso. La oficina:

1. Verifica la firma (Standard Webhooks con una llave `whsec_`, la misma comprobación que un turno de Grok Bot; `Authorization: Bearer` con cualquier otra llave). Una firma mala es un 401 y no se ejecuta nada.
2. Contesta al momento `202 {ok: true, status: "working"}`.
3. Escribe el pedido en el **chat de la oficina** como mensaje de "<persona> · ViralHunt" y se lo pasa al **anfitrión** del chat (⚙ del chat; si no, Claude; si no, la primera CLI) en un turno de solo lectura con un prompt hecho para esto: la petición, la voz de la marca primero, el post como dato, las cuentas con sus límites, y la orden de contestar con un solo objeto JSON.
4. Lee el JSON que escribió la CLI (una valla ```json, o el primer objeto; prosa sola pasa a `text`) y lo manda a `reply_to`. La línea de la CLI también queda en el chat de la oficina.

ViralHunt aplica los `fields` en la pantalla de la persona con un botón Deshacer. **El agente no publica ni guarda nada**: guarda la persona.

Lo que la CLI puede devolver (el contrato de ViralHunt): `text` para la persona; `fields` solo con lo que cambia (`body`, `first_comment`, `author_notes`, `kind`, `overrides` por id de cuenta con `body`, `first_comment`, `thread`; `thread`; `media_add` / `media_replace` como URLs https); `warnings` como `[{code, text, network}]`. El prompt lo dice; una CLI que contesta solo prosa llega igual a la persona como `text`.

## Límites y seguridad

- Un encargo corre un turno de CLI en solo lectura y en una carpeta temporal, como un mensaje de chat: no toca ningún archivo de la oficina.
- El contenido del post es dato. El prompt lo dice; los flags de solo lectura de las CLIs hacen el resto.
- `reply_to` tiene que ser una URL de respuesta de ViralHunt (`https://…/api/hooks/r/<token>`). Cualquier otra se rechaza antes de trabajar.
- Aplica el tiempo máximo del turno de chat (`OFFICEMATRIX_CHAT_CLI_MS`, 3 minutos por defecto). ViralHunt espera la respuesta 15 minutos.
- La puerta reenvía solo las cabeceras de la firma y el cuerpo; la respuesta del servidor vuelve tal cual (un `pong` tiene que llegar inline).

## Qué puede salir mal

Todo esto pasó en la primera prueba en vivo (28-oct-2026).

| Lo que ves | Por qué | Cómo se arregla |
| --- | --- | --- |
| El diálogo dice que cloudflared no está en el equipo, pero lo descargaste. | `cloudflared.exe` no está en el `PATH` ni en una carpeta conocida (lo que baja el navegador queda en *Descargas*). | Muévelo a `%USERPROFILE%\cloudflared\cloudflared.exe`, o pega su ruta completa en **Ruta de cloudflared** y guarda. |
| La tarjeta del agente en `/editorial` no muestra URL. | El túnel corre pero su dirección nunca se guardó como URL pública (un túnel arrancado a mano imprime la dirección; nadie la copia). | Pulsa **Arrancar el túnel** (guarda la dirección él solo) o pega la dirección en **URL pública del túnel** y guarda. La tarjeta muestra entonces `<túnel>/bots/vh/<oficina>`. |
| El **Probar** de ViralHunt recibe un 404 `Not found` (genérico), no `Office not found`. | `server.js` o `puerta-bots.js` siguen corriendo el código viejo, de antes de que existiera `/bots/vh`. | Cierra las dos ventanas y arráncalas otra vez (o reinicia OfficeMatrix). Con el código nuevo una oficina desconocida contesta 404 `Office not found` y una oficina conocida sin firma válida contesta 401. |
| El **Probar** de ViralHunt recibe un 530 o un 404 de Cloudflare, y antes funcionaba. | Un túnel rápido se reinició y su dirección `trycloudflare.com` cambió; ViralHunt sigue llamando a la vieja. | Copia la URL nueva de la tarjeta del agente en ViralHunt → Account → Agents. Para siempre: un [túnel con nombre](#el-túnel). |
| El **Probar** de ViralHunt recibe un 401. | La llave de ViralHunt no es la que guardó la oficina. | Genera otra llave en la tarjeta y pega la misma en ViralHunt. |

## Quitarlo

**Quitar** en la tarjeta borra la llave; desde entonces las llamadas de ViralHunt reciben 401. Borra también la conexión en la página Agentes de ViralHunt para que deje de ofrecer la oficina en sus menús.
