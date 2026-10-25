# Security Policy / Política de Seguridad

## Supported Versions / Versiones Soportadas

| Version | Supported | Notes |
| ------- | --------- | ----- |
| `0.1.x` | ✅ Yes | Active open-source release (Node.js >= 18, recommended 22/24) |

---

## Security Model & Local Execution Boundaries

OfficeMatrix is a **local-first orchestrator** (`127.0.0.1:4321` by default) that launches AI command-line interfaces (`claude`, `codex`, `grok`, `kimi`, `agy`, or local models) as child processes on your own machine.

### 1. Autonomous Execution & Scope
Agents run in non-interactive mode:
- **Claude (`claude`)**: Runs with `--permission-mode acceptEdits` and explicit `--allowedTools`.
- **Codex (`codex`)**: Runs inside `--sandbox workspace-write`, restricting edits to the mission directory.
- **Grok (`grok`)**: Runs with `--always-approve` in its working directory.
- **Kimi (`kimi`)**: Runs with `-p` non-interactive mode.
- **Antigravity (`agy`)**: Disabled by default in `agents.example.json` due to Section 6 of Antigravity Terms of Service.

> **IMPORTANT:** Never expose the local HTTP server (`server.js`, port `4321`) to the public internet or untrusted networks without an authenticated reverse proxy. Anyone with HTTP access can create missions that run local CLIs.

### 2. Zero Credential Storage
- OfficeMatrix **never reads, intercepts, or stores** your OAuth tokens or passwords.
- Every CLI authenticates directly via its own official vendor login flow (`claude`, `codex login`, `grok login`, `kimi login`).

---

## Reporting a Vulnerability / Reportar una Vulnerabilidad

Please do not report security vulnerabilities through public GitHub issues.

Report them privately using **GitHub Private Vulnerability Reporting** (`Security` tab → `Report a vulnerability`) on the repository `https://github.com/rodvan/OfficeMatrix`.

Please include:
1. A clear description of the vulnerability.
2. Steps to reproduce.
3. Potential impact.
