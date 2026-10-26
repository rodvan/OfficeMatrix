# Connect a Grok Bot

[![English](https://img.shields.io/badge/Language-English-blue.svg)](GROK-BOTS.md)
[![Español](https://img.shields.io/badge/Idioma-Español-orange.svg)](es/GROK-BOTS.md)

A Grok Bot has no public API you can read an answer from. A routine can start from a webhook (its own URL and key), and it can POST one reply back. OfficeMatrix uses those two doors. The bot runs on your own Grok account. You do not paste an API key into OfficeMatrix.

The office ⚙ dialog has a **Connect a Grok Bot** checklist. Each line is green or red, with the fix next to it. This picture is the English wizard. The port in the green line is whatever this demo was using. On your machine the gate is **4323**.

![Connect a Grok Bot, desktop](img/wizard-en-1440.png)

![Connect a Grok Bot, phone width](img/wizard-en-390.png)

## Do these six things, in order

1. **Gate on 4323.** OfficeMatrix talks to your bots through a small door, `node puerta-bots.js`, on `127.0.0.1:4323`. If the line is red, press **Start the gate**. That only starts the script. It does not ask for administrator rights and it does not install anything. If a gate is already listening, the button does nothing extra.
2. **Public tunnel.** Grok Bot lives on the internet, so it cannot call your computer by name. You install Cloudflare's `cloudflared` yourself (see the next section) and paste the `https://…` address into **Public tunnel URL**. OfficeMatrix then calls that address at `/bots/health` and checks the round trip. It does not follow redirects. Green means the door answered `{ "ok": true, "servicio": "officematrix-bots" }`.
3. **Copy the routine instruction and the sample JSON.** The two copy buttons match the language of the app. Paste the instruction into the Grok Bot routine that starts from a webhook.
4. **Paste the webhook URL and the key.** In the Grok Bot desktop app, open the routine's menu. The URL is there. The key stays hidden until you reveal it (Grok Bot 0.75.2, 22 Oct 2026). The bot cannot read them out loud for you. The key is stored only in that office's `bots.secreto.json`. It is not written to the chat, to logs, or to any API response.
5. **Ping.** **Test** sends `tipo: "ping"`. A healthy routine answers `pong`. The line shows that word and the latency. `200` or `202` only means the webhook accepted the call, not that the routine finished. The word `pong` is the proof.
6. **Character, role, and color.** Name, role, character (the same crew as the office), and color. You can add several bots to one office.

**Copy this bot to another office** copies the character. The webhook key stays behind unless you tick the box and confirm. A typed "yes" in JSON is not that confirmation: the field has to be the boolean `true`.

## Cloudflare, for beginners

OfficeMatrix never downloads `cloudflared` and never needs an admin prompt. You run these steps.

1. Install `cloudflared` from Cloudflare's own site.
2. **Quick tunnel** (try it on your machine). In a terminal:

   ```
   cloudflared tunnel --url http://localhost:4323
   ```

   Copy the `https://` address it prints into **Public tunnel URL**.
3. **Named tunnel** (keep the same address). In Cloudflare Zero Trust, create a tunnel and a public hostname. The service is only `http://localhost:4323`.
4. The service must be exactly `http://localhost:4323`. That is the bots' gate. The panel stays on your computer (port 4321).
5. Never point the tunnel at port 4321, 4322, or the panel. The gate forwards only bot replies and the health check.

`BOTS_PORT` changes the gate port. Leave it alone unless you already know you need to. The tunnel still has to point at that same port, and only at the gate.

## What you paste into the routine

The copy button is the text to trust. In short, the routine looks at `tipo`:

- `ping`: one POST to `responder_a` with `{"texto":"pong"}`.
- `turno`: read `brief` and `archivos`, do the turn, one POST with `{"texto":"your answer"}`, and end with the score block `formato` names. This is the mission contract. It did not change.
- `chat`: read `mensaje` and `historial`, answer in a short conversation, one POST with `{"texto":"your reply"}`. No score block.

Call `responder_a` once. The URL works a single time. If Grok Bot asks you to approve the outgoing POST (Auto-review), approve it the first time for this host, or add an **Allow automatically** rule for that POST. An approval card that came from a routine expires after about 10 minutes (xAI docs, Approvals, published 22 Oct 2026). After that the card says Expired and the reply is not sent. **Ask first** wins over **Allow automatically**.

There is still no way for OfficeMatrix to go and fetch the answer. If the POST never arrives, the chat or the mission shows **NO REPLY FROM THE BOT** and continues.

## What the bot receives

Field names stay as they are in every language. `brief` and `formato` follow the mission's language.

A mission turn:

```json
{
  "tipo": "turno",
  "oficina": "grokeros",
  "mision": { "id": "2026-10-24-…", "titulo": "…" },
  "turno": { "ronda": 1, "fase": "relevo | borrador | revision | evaluacion | sintesis | aprobacion" },
  "bot": { "id": "radar", "nombre": "Radar", "puesto": "Grok Bot" },
  "brief": "the same brief a CLI gets on its turn",
  "archivos": [{ "ruta": "HANDOFF.md", "texto": "…" }],
  "responder_a": "https://bots.yourdomain.com/bots/r/<token>",
  "caduca": "2026-10-24T07:00:00.000Z",
  "formato": "how to reply"
}
```

An office-chat turn (new, and it does not replace `turno` or `ping`):

```json
{
  "tipo": "chat",
  "oficina": "grokeros",
  "bot": { "id": "radar", "nombre": "Radar", "puesto": "Research" },
  "mensaje": "what the owner just wrote",
  "historial": [{ "de": "You", "texto": "an earlier line" }],
  "responder_a": "https://bots.yourdomain.com/bots/r/<token>",
  "caduca": "2026-10-26T12:00:00.000Z",
  "formato": "Reply in plain text. One POST only."
}
```

Signature, picked from the key you pasted:

- A `whsec_…` key is Standard Webhooks: headers `webhook-id`, `webhook-timestamp`, and `webhook-signature: v1,<base64 HMAC-SHA256 of "{id}.{timestamp}.{raw body}">`. The `whsec_` prefix is stripped and the rest is the base64 HMAC key.
- Any other key (a routine key such as `crsr_…`) is `Authorization: Bearer <key>`.

Mixing the two fails the call. The body is at most 1 MiB. `200` or `202` means accepted. Anything else is **BOT WEBHOOK FAILED**.

## What the bot sends back

`POST` the `responder_a` URL with `{"texto":"…"}`. `text`, `respuesta`, or plain text also work. `200` means OfficeMatrix recorded it. `404` is an unknown token. `410` means already used or expired.

On a mission, the text lands in `aportes/<bot>-<phase>-<round>.md`. A draft (Delphi or Council) also lands in that bot's `borradores/<letter>/` folder, and a synthesis lands in `final/`. `aportes/` does not count as changing the work, so a bot can approve. On a chat, the text is a message in `oficinas/<id>/chat/mensajes.jsonl`.

## A bot that starts something

With an office agent key (⚙ → Agent keys), the bot can `POST <tunnel>/bots/o/<office>/<key>` with:

- `{"texto":"…","config":{…}}` to open a new mission in that office;
- `{"mision":"<id>","texto":"…"}` to add a directive to a running mission;
- `"objecion": true` to also open that directive as an objection.

## Chat, on the same screen

Each office has a **Chat** tab next to missions. It is not a mission. Messages stay in `oficinas/<id>/chat/`. `@name` picks who replies. With no mention, the host you chose in this same dialog replies. **Turn into a mission** fills the composer with the selected lines and waits for you to edit and send. See the README section "Chat with your team".

## Security

- The gate has three routes: `GET /bots/health`, `POST /bots/r/<token>`, and `POST /bots/o/<office>/<key>`. Everything else is 404. Health returns only `{ "ok": true, "servicio": "officematrix-bots" }`. It does not proxy the panel and it carries no secret. The gate accepts only JSON or text, up to 1 MiB, at 60 requests a minute per IP (`CF-Connecting-IP` behind Cloudflare). It does not forward cookies or `Origin`.
- Turn tokens are 32 random bytes, single use, and they expire with the turn. OfficeMatrix stores the hash.
- Each bot's URL and key live only in `bots.secreto.json`, which git ignores. An agent key cannot read the bot settings, the wizard, or the office chat.
- The webhook key is a password for work on your Grok account. If it leaks, rotate it in Grok Bot and paste the new one with **Add key**.

Routine limits, from xAI, checked 26 Oct 2026: up to 300 routine runs an hour in total and 200 for one routine (changelog v0.75.5, 23 Oct 2026). The skills doc (published 22 Oct 2026) also says a bot can own 50 routines and keeps the 20 latest runs. Those pages are the source. OfficeMatrix does not raise or lower them.
