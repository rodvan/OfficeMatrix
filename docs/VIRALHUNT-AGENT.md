# This office as a ViralHunt agent

[![English](https://img.shields.io/badge/Language-English-blue.svg)](VIRALHUNT-AGENT.md)
[![Español](https://img.shields.io/badge/Idioma-Español-orange.svg)](es/VIRALHUNT-AGENT.md)

ViralHunt's composer has an **Ask an agent** box: a person picks an agent, writes "shorten this for X and Bluesky" or "check it before publishing", and the agent gets the post exactly as it is on the screen. An OfficeMatrix office can be that agent. Nothing to install: ViralHunt calls the office through the same gate and tunnel the Grok Bots use, and the office's chat host answers.

This is the reverse direction of the editorial connector (`docs/EDITORIAL.md`): there the office calls ViralHunt with a token; here **ViralHunt calls the office** with a shared key. The two are independent. An office can have one, the other, or both.

## Set it up, four steps

1. **Gate and tunnel.** The office ⚙ dialog, *Connect a Grok Bot*: the gate on 4323 must be up and the **public tunnel URL** saved (**Start the tunnel** does both the starting and the saving; see [The tunnel](#the-tunnel)). ViralHunt reaches the office at `<tunnel>/bots/vh/<office id>`. Without a tunnel URL the agent card shows no URL.
2. **The key.** Open `/editorial`, pick the office, tab *ViralHunt Connection*, card **This office as a ViralHunt agent**. Press **Generate and save a key**. The key is shown once; copy it. (Or generate the key in ViralHunt's Agents page and paste it here with **Save this key**.) It is stored in `oficinas/<id>/viralhunt.secreto.json`, next to the editorial token when there is one, and it never travels to the chat, the logs or any API answer again.
3. **Paste both in ViralHunt.** ViralHunt → Account → **Agents** → Connect an agent: the URL from the card and the same key. Tick what the office can do (text, review; images only if its CLI can make pictures).
4. **Test.** ViralHunt's **Test** sends a ping. The office answers `pong` in the same HTTP response and the ViralHunt page shows the latency. The office's log says "ViralHunt pinged this office as an agent".

## The tunnel

ViralHunt lives on the internet, so they cannot call your computer by name. A Cloudflare tunnel gives the gate (`http://localhost:4323`, and only the gate) a public `https://` address. OfficeMatrix never downloads or installs `cloudflared` and never needs an admin prompt: you put the program on your computer, and OfficeMatrix starts it only when you press the button.

### 1. Install cloudflared

- **Windows, with winget:** `winget install --id Cloudflare.cloudflared`.
- **Windows, without winget (direct download):** open [github.com/cloudflare/cloudflared/releases](https://github.com/cloudflare/cloudflared/releases), download `cloudflared-windows-amd64.exe` (`-arm64` on an ARM PC), make the folder `%USERPROFILE%\cloudflared` and save the file there **renamed to `cloudflared.exe`**. No installer runs and no admin rights are needed.
- **macOS:** `brew install cloudflared`, or the `cloudflared-darwin-*.tgz` from the same releases page, unpacked into `/usr/local/bin`.
- **Linux:** the `cloudflared-linux-amd64` (or `-arm64`) file from the releases page, saved as `~/.cloudflared/cloudflared` and made executable (`chmod +x`), or your distribution's package.

OfficeMatrix looks for it in this order: the path you pasted in the dialog (**cloudflared path**, saved in `bots-ajustes.json` as `cloudflaredPath`), the `PATH`, then `%USERPROFILE%\cloudflared\`, `%ProgramFiles%\cloudflared\`, `~/.cloudflared/`, `/usr/local/bin` and `/opt/homebrew/bin`. If it finds nothing, the dialog says which file to download and where to put it.

### 2. Quick tunnel (to try it)

In the office ⚙ → *Connect a Grok Bot*, press **Start the tunnel**. OfficeMatrix runs

```
cloudflared tunnel --url http://localhost:4323
```

writes its output to `logs/cloudflared.log`, reads the `https://<random-words>.trycloudflare.com` address from that log and saves it as the **Public tunnel URL** for you. If a tunnel is already running (the one it started, or one you started by hand that already answers), it does not start another. Nothing starts on its own.

You can still do it by hand: run the same command in a terminal and paste the address it prints into **Public tunnel URL**.

### 3. Named tunnel (to keep the address)

A quick tunnel has no uptime guarantee and Cloudflare says to use a named tunnel for anything that has to stay up. With a Cloudflare account and a domain on Cloudflare:

```
cloudflared tunnel login
cloudflared tunnel create officematrix-bots
cloudflared tunnel route dns officematrix-bots bots.yourdomain.com
```

Then a `config.yml` next to the tunnel's credentials file (`~/.cloudflared/` or `%USERPROFILE%\.cloudflared\`):

```yaml
tunnel: officematrix-bots
credentials-file: <the .json path that "tunnel create" printed>
ingress:
  - hostname: bots.yourdomain.com
    service: http://localhost:4323
  - service: http_status:404
```

Run it with `cloudflared tunnel run officematrix-bots` (or install it as a service) and paste `https://bots.yourdomain.com` into **Public tunnel URL**. The Zero Trust dashboard (Networks → Tunnels) does the same with clicks.

The service must be exactly `http://localhost:4323`, the bots' gate. Never point the tunnel at port 4321, 4322 or the panel. `BOTS_PORT` changes the gate port; the tunnel then points at that port, and only at the gate.

### The quick tunnel's address changes

> ⚠️ A `*.trycloudflare.com` address is new **every time the tunnel starts** (after a reboot, after closing its window, after pressing the button again once it died). The dialog and the ViralHunt agent card show a warning while the public URL is one of these. After each restart, copy the new URL into ViralHunt → Account → Agents and into your Grok Bot routines. For an address that never changes, use a named tunnel.

The same tunnel serves the Grok Bots of every office ([GROK-BOTS.md](GROK-BOTS.md#the-tunnel)).

## What happens on a task

ViralHunt POSTs a signed `type: "task"`: the person's request, the post (text, first comment, notes, media, thread), the project's accounts with their text limits, the project's brand voice and language, the limits per network, a `reply_schema` and a one-use `reply_to`. The office:

1. Verifies the signature (Standard Webhooks for a `whsec_` key, the same check a Grok Bot turn gets; `Authorization: Bearer` for any other key). A wrong signature is a 401 and nothing runs.
2. Answers `202 {ok: true, status: "working"}` at once.
3. Writes the request into the **office chat** as a message from "<person> · ViralHunt", and hands it to the chat **host** (⚙ of the chat; else Claude; else the first CLI) in a read-only turn with a prompt built for this: the request, the brand voice first, the post as data, the accounts with their limits, and the order to answer with one JSON object.
4. Reads the JSON the CLI wrote (a ```json fence, or the first object; plain prose becomes `text`) and POSTs it to `reply_to`. The CLI's line also lands in the office chat.

ViralHunt applies the `fields` on the person's screen with an Undo button. **Nothing is published or saved by the agent**: the person saves.

What the CLI may send back (ViralHunt's contract): `text` for the person; `fields` with only what changes (`body`, `first_comment`, `author_notes`, `kind`, `overrides` per account id with `body`, `first_comment`, `thread`; `thread`; `media_add` / `media_replace` as https URLs); `warnings` as `[{code, text, network}]`. The prompt says so; a CLI that answers prose only still reaches the person as `text`.

## Limits and safety

- One task runs one read-only CLI turn in a temporary folder, like a chat message: no file of the office is touched.
- The post content is data. The prompt says it; the CLIs' read-only flags enforce the rest.
- `reply_to` must be a ViralHunt reply URL (`https://…/api/hooks/r/<token>`). Anything else is refused before any work.
- The chat turn timeout applies (`OFFICEMATRIX_CHAT_CLI_MS`, 3 minutes by default). ViralHunt waits 15 minutes for the answer.
- The gate forwards only the signature headers and the body; the server's answer goes back as is (a `pong` must arrive inline).

## What can go wrong

These all happened during the first live test (28 Oct 2026).

| What you see | Why | Fix |
| --- | --- | --- |
| The dialog says cloudflared is not on this computer, but you downloaded it. | `cloudflared.exe` is not on the `PATH` and not in a known folder (a browser download lands in *Downloads*). | Move it to `%USERPROFILE%\cloudflared\cloudflared.exe`, or paste its full path in **cloudflared path** and save. |
| The agent card in `/editorial` shows no URL. | The tunnel runs but its address was never saved as the public URL (a tunnel started by hand prints the address; nothing copies it). | Press **Start the tunnel** (it saves the address itself) or paste the address into **Public tunnel URL** and save. The card then shows `<tunnel>/bots/vh/<office>`. |
| ViralHunt's **Test** gets a 404 `Not found` (generic), not `Office not found`. | `server.js` or `puerta-bots.js` is still running the old code, from before `/bots/vh` existed. | Close both windows and start them again (or restart OfficeMatrix). With the new code an unknown office answers 404 `Office not found`, and a known office without a valid signature answers 401. |
| ViralHunt's **Test** gets a 530 or a 404 from Cloudflare, after it worked before. | A quick tunnel restarted and its `trycloudflare.com` address changed; ViralHunt still calls the old one. | Copy the new URL from the agent card into ViralHunt → Account → Agents. For good: a [named tunnel](#the-tunnel). |
| ViralHunt's **Test** gets a 401. | The key in ViralHunt is not the one saved in the office. | Generate a key again on the card and paste the same one in ViralHunt. |

## Remove it

**Remove** on the card deletes the key; ViralHunt's calls get a 401 from then on. Delete the connection in ViralHunt's Agents page too, so it stops offering the office in its menus.
