# 💬 Discord: one bot per office

[![English](https://img.shields.io/badge/Language-English-blue.svg)](DISCORD.md)
[![Español](https://img.shields.io/badge/Idioma-Español-orange.svg)](es/DISCORD.md)

Every office can have **its own Discord bot**. You talk to your office's AIs from your phone, get alerts when a mission
ends, and approve editorial proposals with a button. The bot connects **out** to Discord, so there is no tunnel and no
open port. It needs no extra libraries either: OfficeMatrix uses the WebSocket built into Node.

```
Your Discord server
 ├─ #ship        → Ship bot        → status of every office, asks the office you name
 ├─ #brainhub    → Brain Hub bot   → only the Brain Hub office
 └─ #acme        → Acme bot        → only the Acme office
        ▲
   OfficeMatrix (your PC): each bot connects out to Discord
```

## 🔒 Isolation, the rules

- **A bot only talks to its own office.** It is bound to that office when it starts. Its messages go to that office's
  chat, its proposals are that office's, and its alerts are that office's missions. Asking it «show me Acme» does nothing,
  because it has no way to reach another office.
- **The Ship bot** (configure it in the Ship's ⚙) can give the status of every office and pass a question to the office
  you name. It only does that for offices with **Share with the Ship's bot** turned on. From the others it only says that
  they do not share. Ship alerts are one line per mission, with no details.
- **Only authorized users are obeyed.** These are the Discord IDs you list. With the list empty, the bot obeys nobody: it
  answers whoever mentions it with their ID, at most once an hour per person, so you can copy it.
- **Read-only.** A Discord message never edits files. Office chat turns are already read-only. From Discord, Claude also
  loses its tools to read files and fetch pages, so nobody in a channel can ask it to read a path on your disk. Other CLIs
  have no such switch, which is one more reason only authorized users can talk to the bot.
- **The token stays on your PC.** It lives in `discord.secreto.json` inside the office folder, outside git. The panel never
  shows it again, and the chat masks it if someone pastes it. **Never paste it in a chat.**
- **Sensitive data.** If an office handles data that must only reach the AIs you chose, do not connect it to Discord, and
  turn off **Share with the Ship's bot**. Discord is an outside service.

## 🚀 Step by step (5 minutes)

1. Open <https://discord.com/developers/applications>, click **New Application** and name it after the office (e.g.
   *Brain Hub*).
2. Go to **Bot**, then **Reset Token**, and copy the token.
3. In OfficeMatrix, open the office ⚙ and go to **Discord**. Paste the token and press **Save**. The status shows
   🟢 Connected and the name of your bot.
4. Click **Invite the bot to your server**. The link already asks only for what the bot needs: view channels, send
   messages, embed links, attach files and read the history.
5. In Discord, turn on **Developer Mode** (User Settings → Advanced). Right-click a channel or a person and choose **Copy
   ID**.
6. Mention the bot once (`@bot hi`). It answers with **your ID**. Paste it in **Authorized users** and save.
7. Optional: an **Alerts channel**, the **Channels it listens to**, and which alerts you want.
8. Press **Send a test**.

Repeat it for each office, with one Discord application each. For the Ship, select the Ship (🛸) and open its ⚙: it only shows the Discord section.

## 🗣️ Using it

| You write in Discord | What happens |
| --- | --- |
| `@bot @grok find trends about Artemis` | That AI of the office answers, signed with its name |
| `@bot what do you think?` (no `@name`) | The office's **chat host** answers. Set it in ⚙ → Chat host |
| `@bot proposals` | The pending editorial proposals, as cards with buttons |
| `@bot help` | A short reminder |
| Ship: `@ship status` | Per office: missions running, pending proposals and its bot's state |
| Ship: `@ship acme: how is the landing going?` | It asks the Acme office (if it shares) and replies with 🏢 Acme |
| Ship: `@ship @claude summarize the week` | One of the Ship's AIs answers. Without an office or an `@name`, the Ship shows its help |

Discord messages also land in the office chat in the panel, as «Discord · your name», so the conversation is one.

## 🔔 Alerts

| Alert | Where | Content |
| --- | --- | --- |
| 🏁 Mission finished | the office's alerts channel | title, outcome and summary |
| ⚠️ An AI failed | the office's alerts channel | who, why and who is still working |
| 📰 New editorial proposal | the office's alerts channel | topic, hook, copy, traffic light, sources, image and buttons |
| 🏢 Headline | the Ship's alerts channel | one line, only from offices that share with the Ship |

**Buttons on a proposal:**
- **Approve** sends it to ViralHunt, the same as in the dashboard.
- 🔴 **Red** proposals cannot be approved; the button is disabled.
- 🟡 **Yellow** asks for a second click, *Confirm yellow and approve*.
- **Reject** records «Rejected from Discord by …».
- Only authorized users can press them. Anyone else gets a private «not authorized» message.

Asking for changes stays in the dashboard, because it needs a note and the parts to change.

## 🔌 API (panel only)

| Method and path | Body | Answer |
| --- | --- | --- |
| `GET /api/oficinas/<id>/discord` | | `{ configurado, activo, estado, bot, invitacion, usuarios, canales, canalAvisos, avisos, permitirNave, nave }` (never the token) |
| `PUT /api/oficinas/<id>/discord` | `{ token?, usuarios, canales, canalAvisos, avisos: { misiones, fallos, propuestas }, permitirNave, activo }` | the same view; without `token` the saved one is kept |
| `DELETE /api/oficinas/<id>/discord` | | stops the bot and deletes `discord.secreto.json` |
| `POST /api/oficinas/<id>/discord/probar` | | sends a test message |

Use `edificio` as the id for the Ship. An office agent key (`om_…`) cannot use these routes.

Code: [`lib/discord.js`](../lib/discord.js) (Gateway and REST client) and [`lib/discord-oficinas.js`](../lib/discord-oficinas.js)
(bots per office). Tests: [`tests/discord.test.js`](../tests/discord.test.js), with fake Discord and no network.

## 🩺 Troubleshooting

| You see | Fix |
| --- | --- |
| 🔴 Error · Discord rejected the token | Copy it again from **Bot → Reset Token** (resetting invalidates the old one) |
| The bot is online but does not answer | Mention it (`@bot …`). Check that your ID is in Authorized users and the channel is in the list (or the list is empty) |
| «Nobody was mentioned and this office has no chat host» | Write `@name` of an AI or pick a Chat host in ⚙ |
| No alerts | Set an Alerts channel and give the bot permission to write there |
| «The office is answering another message» | One reply at a time per office; try again in a moment |
