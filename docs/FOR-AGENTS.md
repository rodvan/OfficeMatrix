# 🧭 OfficeMatrix for agents

[![English](https://img.shields.io/badge/Language-English-blue.svg)](FOR-AGENTS.md)
[![Español](https://img.shields.io/badge/Idioma-Español-orange.svg)](PARA-AGENTES.md)

A guide for an external agent (for example, your own assistant) that works with OfficeMatrix through an **office key**.

## What OfficeMatrix is

An office of AIs running on the user's PC. Several AIs (Claude, Codex/ChatGPT, Gemini and Grok, through their CLIs and on
the user's subscriptions) work together on the same folder:
- they write;
- they review each other and give scores;
- they argue over objections;
- they don't close until everyone approves or the rounds run out.

Each **office** is an isolated simulation, with its own missions, its own brain (memory) and its own team.
**Your key only opens your office.** You see nothing from other offices or from the "building", and they see nothing of yours.

## When to use it (and when not to)

Use it when you need **solid, deep research** or a deliverable that benefits from several independent views. For example:
- comparing suppliers or quotes;
- analyzing a contract or a long PDF;
- a report with sources;
- a plan;
- checking facts before deciding.

**Don't** use it for quick questions: a mission takes from 30 minutes to several hours and uses quota from several
subscriptions. If you can answer yourself in a few minutes, do it yourself.

## Modes (pick one with `--mode`)

| Mode | How they work | Good for |
| --- | --- | --- |
| `delphi` (default) | Each AI writes its own version without seeing the others, then they rotate reviewing the others' versions. | Research, fact-checking, analysis: avoids one AI's bias. |
| `council` | Everyone proposes, they score each other and a chair merges the best into a final version the rest vote on. | Strategy, plans, open decisions. Leaves a single result in `final/`. |
| `relay` | One after another on the same work. | Code, documents polished step by step. |

The Spanish names (`delphi`, `consejo`, `relevo`, and `paralelo` for Delphi) work too. More in [MODES.md](MODES.md).

## How to use it

Copy `om.js` to your machine (a single file, Node 18 or later) and set:

```
OM_URL=http://<officematrix-pc-ip>:4322     (network access; on the same PC: http://localhost:4321)
OM_LLAVE=om_<office>_…                       (the user gives it to you; treat it like a password)
OM_LANG=en                                   (optional: es for Spanish output)
```

Commands:

```
node om.js office                                    # your office and which AIs can work in it
node om.js new "detailed request" --mode delphi --attach quote.pdf --attach requirements.xlsx
node om.js status <id>                               # phase, who is working and what they are thinking about
node om.js wait <id>                                 # waits for the end (checks every 30 s)
node om.js result <id> --download ./result           # what they delivered, where, and downloads the files
node om.js intervene <id> "prioritize the 3-year total cost"
node om.js help                                      # every command and option
```

The Spanish commands (`oficina`, `nueva`, `estado`, `esperar`, `resultado`, `intervenir`) and options (`--modo`,
`--adjunto`, `--bajar`) still work.

## How to write a good request

- **Which decision or deliverable** you need, **for whom** and **in what format**, for example:
  "HTML report in `final/` with a comparison table and a recommendation".
- **Context only you have**: company, constraints, criteria and deadlines. The AIs can't see your folders: whatever they
  need to read goes as an **attachment** (PDF, Word, Excel, images). Text is extracted from every PDF for everyone.
- **What to avoid** and how to check it: "every figure with its source", "don't make up prices".
- Write the request in the language you want the work in: the team's briefs follow the request's language.

## Rules

- **Confidentiality.** Whatever you attach is read by the AIs on the office team; the user chose which ones. Don't attach
  more than needed, and never passwords, keys or personal data that aren't necessary.
- **Not professional advice.** A legal, tax or financial analysis from the office is working material for a licensed
  person, not a decision.
- **One mission at a time per topic.** Don't send the same question twice. If one is running, use `intervene`.
- **Accepting a stopped deliverable** (plateau, regression or round limit) is done by the user in the panel. The key can't.
- **Tell the user** the id of the mission you launched and where the result ended up.
