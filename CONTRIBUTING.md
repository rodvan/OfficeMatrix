# Contributing to OfficeMatrix / Guía de Contribución

Thank you for contributing to **OfficeMatrix** (by Cerebro Digital)! Whether you are adding a new AI CLI adapter, designing a mission template, or fixing an edge case in stream parsing, this guide covers everything you need to know.

*(Versión en español en la segunda mitad de este documento).*

---

## 🇬🇧 English Guide

### 1. Core Architectural Principles

1. **Zero External Dependencies:**
   - The application runs on pure Node.js (`>= 18`, tested on `22` and `24`) and vanilla HTML/CSS/JS.
   - Do **not** add packages to `package.json`.
2. **Pure Testable Logic in `lib/`:**
   - `server.js` only orchestrates HTTP routes, Server-Sent Events (SSE), and child processes.
   - All core logic (stream parsing, snapshot verification, 3-way memory merging, Delphi/Council rotation, failure classification) lives in `lib/*.js` and has unit tests in `tests/*.test.js`.
3. **File-Based Agent Contracts (`.office/turno.md`):**
   - Never pass long prompts or project context directly as command-line arguments. On Windows PowerShell, long strings and special characters break shell quoting. Always write the turn instructions to `.office/turno.md` and pass a short pointer prompt to the CLI.
4. **Strict UTF-8 Everywhere:**
   - Always read and write files with explicit `'utf8'` encoding.
5. **Offline-First Command Center UI:**
   - No external CDNs, no external fonts, no remote analytics in `public/`. The UI works 100% offline.

### 2. Development Setup & Running Tests

```bash
# 1. Clone the repository
git clone https://github.com/rodvan/OfficeMatrix.git
cd OfficeMatrix

# 2. Verify syntax across server and UI
node --check server.js
node --check public/app.js

# 3. Run the automated test suite (212 tests, zero subscription cost)
npm test

# 4. Check repository publication hygiene (no secrets, no private data)
node scripts/revisar-publicacion.js
```

### 3. Testing the UI Without Spending AI Subscriptions

We include a mock demo server (`tests/helpers/demo-server.js`):

```powershell
# Start demo server on port 4400 (auto-exits after 120 seconds)
node tests/helpers/demo-server.js 4400 120

# Simulate a specific CLI running out of credits (HTTP 402)
$env:DEMO_SIN_SALDO="grok"; node tests/helpers/demo-server.js 4400 120

# Simulate Council or Delphi mode
$env:DEMO_MODO="consejo"; node tests/helpers/demo-server.js 4400 180
```

### 4. How to Add a New CLI Adapter

1. **Capture a real fixture:** Run the CLI on a minimal task and save its raw JSONL or stdout output in `tests/fixtures/<cli>-escribir.jsonl`.
2. **Add the stream handler in `lib/streams.js`:**
   - Emit `{ kind, label, detail?, file?, tool? }` events for live bubbles.
   - Normalize token usage in `normalizeUsage()` if the CLI reports it.
3. **Add failure rules in `lib/failure.js`:** Map provider-specific quota, auth, or connection errors to actionable causes (`sin_saldo`, `limite`, `sin_sesion`, `sin_conexion`).
4. **Document the agent in `docs/AGENTES.md`** and provide an example profile in `agents.example.json`.

---

## 🇪🇸 Guía en Español

### 1. Principios de Arquitectura

1. **Cero Dependencias Externas:**
   - La aplicación corre en Node.js puro (`>= 18`) con HTML/CSS/JS estándar.
   - No añadas dependencias a `package.json`.
2. **Lógica Pura en `lib/`:**
   - `server.js` solo maneja rutas HTTP, Server-Sent Events (SSE) y procesos hijo.
   - Toda la lógica analítica vive en `lib/*.js` y está respaldada por pruebas en `tests/*.test.js`.
3. **Contrato de Turno por Archivo (`.office/turno.md`):**
   - No pases instrucciones largas en argumentos de terminal. Se escribe el contexto en `.office/turno.md` y a la CLI solo se le pasa un apuntador breve.
4. **UTF-8 Estricto:**
   - Lectura y escritura siempre con codificación `'utf8'` explícita.
5. **Interfaz Offline-First:**
   - Sin llamadas a CDNs externas ni fuentes remotas en `public/`. Funciona 100% en local.

### 2. Pruebas y Verificación

```bash
# Ejecutar la suite completa de pruebas (212 pruebas en verde)
npm test

# Escaneo de seguridad y privacidad antes de publicar
node scripts/revisar-publicacion.js
```

### 3. Licencia de Contribuciones

Al enviar una contribución (Pull Request), aceptas que tu código quede sujeto a la licencia **Apache 2.0** del proyecto.
