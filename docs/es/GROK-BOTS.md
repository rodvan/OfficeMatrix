# Grok Bots como empleados de una oficina

Los Grok Bots (el producto de agentes de xAI) no tienen API pública para leerles la respuesta. Lo que sí tienen:
- **rutinas con disparador webhook**, que es la entrada;
- **acciones salientes a una URL**, que es la salida.

OfficeMatrix usa las dos. No necesita API keys de pago: el bot corre con tu cuenta de Grok.

```
OfficeMatrix ──POST firmado (turno + responder_a)──▶ webhook de la rutina del Grok Bot
     ▲                                                          │
     │  /api/bots/respuesta/<token>                             │ el bot trabaja (su memoria, sus chats, sus herramientas)
     │                                                          ▼
puerta-bots.js :4323 ◀── túnel de Cloudflare (https) ◀── POST {texto} a responder_a
```

## Configuración

1. **Puerta:** `node puerta-bots.js`. Escucha en `127.0.0.1:4323` (con `BOTS_PORT` se cambia) y reenvía a la app (`PORT`, 4321).
2. **Túnel:** en Cloudflare Zero Trust, crea un túnel con un *public hostname* (p. ej. `bots.tudominio.com`) cuyo servicio sea
   `http://localhost:4323`. **No** lo apuntes al 4321: el panel no debe estar en internet.
3. **URL pública:** en la app, ⚙ de la oficina → *Grok Bots* → *URL pública del túnel* (`https://bots.tudominio.com`). Se guarda
   en `bots-ajustes.json`. La variable `OFFICEMATRIX_BOTS_URL` la sustituye (las pruebas la usan).
4. **Cada bot:** en Grok Bot, crea una rutina con **disparador webhook** y copia su URL y su llave. En la app, *＋ AÑADIR BOT*
   con nombre, personaje (la tripulación de oficina), color, URL y llave.
5. **Instrucción de la rutina**, lista para pegar:
   > Cuando recibas un webhook de OfficeMatrix, lee `brief` y `archivos` y haz el trabajo de tu turno como pide `formato`.
   > Al terminar, envía UNA vez un POST a la URL de `responder_a` con JSON `{"texto": "tu respuesta"}`. Tu texto termina con
   > `OBJECIONES:`, `RESPUESTAS:`, `NOTA: X/10` y `VEREDICTO: APROBADO o CAMBIOS`. Si `tipo` es `ping`, responde `{"texto": "pong"}`.

   Si Grok Bot pide aprobar la acción saliente (Auto-review), apruébala la
   primera vez o declárala en la rutina.
6. **PROBAR:** manda `{"tipo": "ping", "responder_a": …}`. El bot debe contestar `{"texto": "pong"}`.

## Lo que recibe el bot (POST a su webhook)

```json
{
  "tipo": "turno",
  "oficina": "grokeros",
  "mision": { "id": "2026-10-24-…", "titulo": "…" },
  "turno": { "ronda": 1, "fase": "relevo | borrador | revision | evaluacion | sintesis | aprobacion" },
  "bot": { "id": "radar", "nombre": "Radar", "puesto": "Grok Bot" },
  "brief": "el mismo brief que recibe una CLI en su turno (.office/turno*.md)",
  "archivos": [{ "ruta": "HANDOFF.md", "texto": "…" }],
  "responder_a": "https://bots.tudominio.com/bots/r/<token>",
  "caduca": "2026-10-24T07:00:00.000Z",
  "formato": "cómo responder"
}
```

- **Firma:**
  - llave `whsec_…`: Standard Webhooks, con las cabeceras `webhook-id`, `webhook-timestamp` y
    `webhook-signature: v1,<base64 HMAC-SHA256 de "{id}.{timestamp}.{cuerpo}">`;
  - otra llave: `Authorization: Bearer <llave>`.
- **Cuerpo y aceptación:** el cuerpo es de 1 MiB como máximo. `archivos` lleva los archivos que cita el brief, más `HANDOFF.md` y
  `MEMORIA.md`, recortados. 200 o 202 = aceptado; otro código = turno fallido con «WEBHOOK DEL BOT FALLÓ».

## Lo que devuelve el bot

- **Formato:** `POST responder_a` con `{"texto": "…"}` (también valen `text`, `respuesta` o texto plano).
- **Códigos:** 200 = registrado; 404 = token desconocido; 410 = ya usado o caducado.
- **Dónde queda el texto:** en `aportes/<bot>-<fase>-<ronda>.md`. Si es su borrador (Delphi o Consejo), en su carpeta
  `borradores/<letra>/aporte-<bot>.md`, y si es la síntesis, en `final/`. Los demás agentes lo leen ahí. `aportes/` no cuenta
  como «cambiar el trabajo», así que un bot puede APROBAR.

## Un bot que inicia algo

Con una llave de agente de la oficina (⚙ → *Llaves de agente*), el bot puede hacer
`POST <túnel>/bots/o/<oficina>/<llave>` con:
- `{"texto": "…", "config": {…}}`: misión nueva en esa oficina;
- `{"mision": "<id>", "texto": "…"}`: directiva en una misión en curso de esa oficina;
- `"objecion": true`: además la abre como objeción.

## Seguridad

- **La puerta solo tiene dos rutas.** El resto da 404: no sirve el panel, `/api` ni `/raw`. Acepta solo JSON o texto, hasta
  1 MiB, con un límite de 60 peticiones por minuto por IP (`CF-Connecting-IP` detrás de Cloudflare). No reenvía cookies ni
  `Origin`.
- **Tokens de turno:** 32 bytes aleatorios, de un solo uso y con caducidad igual al tope del turno. Se guardan por hash.
- **URL y llave de cada bot:** solo en `bots.secreto.json`, ignorado por git. No salen por la API ni se escriben en logs ni en el
  chat. Una llave de agente no da acceso a la configuración de los bots.
- **La llave del webhook de un bot equivale a una contraseña:** quien la tenga puede lanzar trabajo en tu cuenta de Grok.
  Si se filtra, rótala en Grok Bot y vuelve a añadir el bot.
