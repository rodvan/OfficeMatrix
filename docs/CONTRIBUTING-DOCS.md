# Updating the docs

[![English](https://img.shields.io/badge/Language-English-blue.svg)](CONTRIBUTING-DOCS.md)
[![Español](https://img.shields.io/badge/Idioma-Español-orange.svg)](es/CONTRIBUTING-DOCS.md)

The rules the team already follows when it changes OfficeMatrix's documentation. Short on purpose: if you change how something behaves, this page says which files move with it.

## 1. Every guide exists twice, with the same name

- English in `docs/<NAME>.md`, Spanish in `docs/es/<NAME>.md`. Same file name, same sections in the same order.
- Both start with the title and these two badges, so a reader can switch language from the top:

  ```markdown
  # Connect a Grok Bot

  [![English](https://img.shields.io/badge/Language-English-blue.svg)](GROK-BOTS.md)
  [![Español](https://img.shields.io/badge/Idioma-Español-orange.svg)](es/GROK-BOTS.md)
  ```

  In the Spanish file the links point the other way: `../GROK-BOTS.md` and `GROK-BOTS.md`.
- Change one, change the other in the same edit. A guide that exists in only one language is unfinished.
- A new guide also gets a row in both indexes: [docs/README.md](README.md) and [docs/es/README.md](es/README.md).
- Older guides have a translated name in `docs/` (`INSTALL.md` / `INSTALAR.md`, `AGENTS.md` / `AGENTES.md`, `MODES.md` / `MODOS-DE-TRABAJO.md`, `FOR-AGENTS.md` / `PARA-AGENTES.md`, `PUBLISH.md` / `PUBLICAR.md`). Leave them where they are; new guides use `docs/es/` with the same name.

## 2. Every design decision gets a number

Decisions are recorded in [docs/DECISIONES.md](DECISIONES.md), in Spanish (it is the team's working log). Each entry takes the next number (`D85`, `D86`, …; look at the last heading in the file) and has this shape:

```markdown
## D86 · What was decided, in one line (who, date)
- **Qué:** what changed: files, endpoints, functions, the test that covers it.
- **Por qué:** the reason, and what happened that made it necessary.
- **Reglas:** what must stay true from now on.
```

Do not renumber or rewrite old entries. If a decision replaces an older one, say so in the new entry ("replaces D46").

## 3. A behavior change moves four things together

When OfficeMatrix starts doing something differently, the same change touches:

1. **The topic guide**, in both languages (for example `docs/GROK-BOTS.md` and `docs/es/GROK-BOTS.md`).
2. **The decision log**, with a new `Dn` entry.
3. **The tests** in `tests/*.test.js`: one that would fail without the change.
4. **The interface text**, if a screen changes: `public/i18n/en.json` and `public/i18n/es.json` get the same keys with the same `{placeholders}` (a test checks this), and the English text in the HTML matches `en.json`.

If a number in the README goes stale (the test count, for example), fix it in the same change.

## 4. Run the tests

```bash
npm test
```

Zero dependencies: it runs `node --test "tests/*.test.js"`. Everything must be green before you call the change done. Before publishing, also run:

```bash
node scripts/revisar-publicacion.js
```

It checks that no private file, key or personal data would be published.

## 5. What never goes in the docs

- Keys, tokens, webhook secrets, passwords, OAuth codes, or anything from a `*.secreto.json` file.
- Real tunnel URLs. Use `https://<random-words>.trycloudflare.com` or `https://bots.yourdomain.com`.
- Real email addresses, account IDs, Discord IDs or payment addresses. Use obvious placeholders.
- Screenshots that show any of the above. Crop or blur before adding them to `docs/img/`.

## 6. How to write

- Short sentences and numbered steps. Name buttons and fields exactly as the screen shows them, in **bold**.
- Say what the reader sees when it worked (the green line, the word `pong`), not only what to press.
- Say what OfficeMatrix will **not** do on its own (download software, start a tunnel, publish a post) when a reader might expect it.
- When something goes wrong often, add it to a "What can go wrong" table: what you see, why, fix.
