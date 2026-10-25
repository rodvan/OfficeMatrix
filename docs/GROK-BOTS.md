# 🤖 Grok Bots as office employees

[![English](https://img.shields.io/badge/Language-English-blue.svg)](GROK-BOTS.md)
[![Español](https://img.shields.io/badge/Idioma-Español-orange.svg)](es/GROK-BOTS.md)

Grok Bots (xAI's agents product) have no public API to read their answers. What they do have:
- **routines with a webhook trigger**: that's the way in;
- **outgoing actions to a URL**: that's the way out.

OfficeMatrix uses both. No paid API keys needed: the bot runs on your own Grok account.

```
OfficeMatrix ──signed POST (turn + responder_a)──▶ Grok Bot routine webhook
     ▲                                                       │
     │  /api/bots/respuesta/<token>                          │ the bot works (its memory, its chats, its tools)
     │                                                       ▼
puerta-bots.js :4323 ◀── Cloudflare tunnel (https) ◀── POST {texto} to responder_a
```

## ⚙️ Setup

1. **Gate:** `node puerta-bots.js`. It listens on `127.0.0.1:4323` (change it with `BOTS_PORT`) and forwards to the app
   (`PORT`, 4321).
2. **Tunnel:** in Cloudflare Zero Trust, create a tunnel with a *public hostname* (e.g. `bots.yourdomain.com`) whose service
   is `http://localhost:4323`. **Never** point it at 4321: the panel must not be on the internet.
3. **Public URL:** in the app, office ⚙ → *Grok Bots* → *Public tunnel URL* (`https://bots.yourdomain.com`). It is saved in
   `bots-ajustes.json`. The `OFFICEMATRIX_BOTS_URL` variable overrides it (the tests use it).
4. **Each bot:** in Grok Bot, create a routine with a **webhook trigger** and copy its URL and key. In the app, *＋ ADD BOT*
   with a name, a character (the office crew), a color, the URL and the key.
5. **Routine instruction**, ready to paste:
   > When you receive a webhook from OfficeMatrix, read `brief` and `archivos` and do your turn's work as `formato` asks.
   > When you are done, send ONE POST to the `responder_a` URL with JSON `{"texto": "your answer"}`. Your text ends with
   > `OBJECTIONS:`, `REPLIES:`, `SCORE: X/10` and `VERDICT: APPROVED or CHANGES`. If `tipo` is `ping`, reply `{"texto": "pong"}`.

   If Grok Bot asks you to approve the outgoing action (Auto-review), approve it the first time or declare it in the routine.
6. **TEST:** sends `{"tipo": "ping", "responder_a": …}`. The bot should answer `{"texto": "pong"}`.

## 📨 What the bot receives (POST to its webhook)

```json
{
  "tipo": "turno",
  "oficina": "grokeros",
  "mision": { "id": "2026-10-24-…", "titulo": "…" },
  "turno": { "ronda": 1, "fase": "relevo | borrador | revision | evaluacion | sintesis | aprobacion" },
  "bot": { "id": "radar", "nombre": "Radar", "puesto": "Grok Bot" },
  "brief": "the same brief a CLI gets on its turn (.office/turno*.md)",
  "archivos": [{ "ruta": "HANDOFF.md", "texto": "…" }],
  "responder_a": "https://bots.yourdomain.com/bots/r/<token>",
  "caduca": "2026-10-24T07:00:00.000Z",
  "formato": "how to reply"
}
```

The field names are part of the contract, so they stay as they are in every language. `brief` and `formato` come in the
mission's language (English unless the request was written in another language).

- **Signature:**
  - a `whsec_…` key: Standard Webhooks, with the headers `webhook-id`, `webhook-timestamp` and
    `webhook-signature: v1,<base64 HMAC-SHA256 of "{id}.{timestamp}.{body}">`;
  - any other key: `Authorization: Bearer <key>`.
- **Body and acceptance:** the body is 1 MiB at most. `archivos` carries the files the brief mentions, plus `HANDOFF.md` and
  `MEMORIA.md`, trimmed. 200 or 202 = accepted; any other code = failed turn with **BOT WEBHOOK FAILED**.

## 📬 What the bot sends back

- **Format:** `POST responder_a` with `{"texto": "…"}` (`text`, `respuesta` or plain text also work).
- **Codes:** 200 = recorded; 404 = unknown token; 410 = already used or expired.
- **Where the text ends up:** in `aportes/<bot>-<phase>-<round>.md`. If it is its draft (Delphi or Council), in its folder
  `borradores/<letter>/aporte-<bot>.md`, and if it is the synthesis, in `final/`. The other agents read it there. `aportes/`
  does not count as "changing the work", so a bot can APPROVE.
- **No answer in time:** the turn is marked **NO REPLY FROM THE BOT** and the cycle keeps going.

## 🚀 A bot that starts something

With an office agent key (⚙ → *Agent keys*), the bot can `POST <tunnel>/bots/o/<office>/<key>` with:
- `{"texto": "…", "config": {…}}`: a new mission in that office;
- `{"mision": "<id>", "texto": "…"}`: a directive in a running mission of that office;
- `"objecion": true`: also opens it as an objection.

## 🔒 Security

- **The gate has only two routes.** Everything else is 404: it does not serve the panel, `/api` or `/raw`. It only accepts
  JSON or text, up to 1 MiB, limited to 60 requests per minute per IP (`CF-Connecting-IP` behind Cloudflare). It does not
  forward cookies or `Origin`.
- **Turn tokens:** 32 random bytes, single use, expiring with the turn limit. Stored as a hash.
- **Each bot's URL and key:** only in `bots.secreto.json`, ignored by git. They never leave through the API and are never
  written to logs or the chat. An agent key gives no access to the bots' settings.
- **A bot's webhook key is a password:** whoever has it can launch work on your Grok account. If it leaks, rotate it in
  Grok Bot and add the bot again.
