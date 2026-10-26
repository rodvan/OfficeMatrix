# Informe de cierre: contrato

Decisiones: RF1–RF18 en `docs/DECISIONES.md`. Código: `lib/cierre.js`, `public/cierre.js` y `public/cierre-textos.js`
(los textos viven en `public/i18n/<idioma>.json`, claves `cierre.*`). Capturas en inglés: `node scripts/capturar-cierre.js`
→ `docs/img/cierre-1440.png` y `cierre-390.png`.
Pruebas: `tests/cierre.test.js`.

## Qué existe ya (ronda 1, Claude)

- **`lib/cierre.js`** arma el informe completo sin ninguna CLI: veredicto y semáforo, logros, brief punto por punto,
  qué no se logró, números de git, qué se ejecutó, pendientes (otra ronda / tú), riesgos y opciones con su petición.
- **`server.js`**:
  - lo genera en el `finally` de los dos motores (relevo y Delphi/Consejo), al terminar por cualquier causa;
  - lo rehace al aceptar;
  - guarda `chat.base` (HEAD) al empezar la primera vez.
  - Rutas: `GET /api/chats/:id/cierre` (JSON; `?format=md` lo descarga) y `POST /api/chats/:id/cierre` (generar o
    rehacer; 409 con el ciclo en marcha).
  - `GET /api/chats` trae `cierre: { semaforo, frase, causa, generado }` o `null`.
  - SSE: `cierre-updated` y `cycle-ended` llevan `cierre` (el mismo resumen).
- **Archivos:** `.office/cierre.json` y `.office/CIERRE.md` en la carpeta de la misión.

## Qué falta (para las rondas siguientes)

| Pieza | Quién propongo | Notas |
|---|---|---|
| Tarjeta grande al final del hilo + botones | Gemini (diseño), Codex (código) | Diseño abajo. Sin dependencias. |
| Botón «Generar informe de cierre» y semáforo en la lista de misiones | Codex | `POST …/cierre`; `lista[i].cierre`. |
| Relator (turno corto) | Claude | RF2 y RF15: hecho en la ronda 2. Se lanza al cerrar; contrato abajo. |
| Cierre de Editorial (tanda) | Codex | RF8: propuestas, temas, cuántas listas en la bandeja. |
| Delphi / Consejo: qué borrador quedó en `final/` | Codex | RF8. |
| Demo en 44xx y capturas 1440/390 en `docs/img/` (`scripts/capturar-cierre.js`) | Codex o Gemini | Con agentes falsos. Nunca 4321–4323. |
| Auditoría del lenguaje («que se entienda sin ser programador») | Grok | Hecha en ronda 1 (RF14): frases de la tarjeta, de las opciones, del Markdown y de la lista. |

## `cierre.json` (versión 1)

```jsonc
{
  "version": 1, "generado": "ISO", "autor": "plantilla" | "plantilla+relator", "idioma": "es" | "en",
  "mision": { "id", "titulo", "modo": "relevo|delphi|consejo", "ciclo": "auto|rondas", "minScore", "ciclosPrevios" },
  "causa": "aprobado|aceptado|meseta|retroceso|agotado|detenido|interrumpido|error|sin-agentes|en-curso|sin-ciclo",
  "semaforo": "verde|ambar|rojo|gris",
  "veredicto": { "frase", "aprueban", "total", "faltan": ["Codex (nota 8,5)"] },
  "resumenServidor": "la línea de sistema de siempre",
  "logros": [{ "texto", "de", "ronda", "evidencia": ["ruta existente"], "fuente": "traspaso|relator" }],
  "brief": { "ruta": "docs/BRIEF-….md" | null, "puntos": [{ "n", "texto", "estado": "hecho|parcial|falta|sin-confirmar", "evidencia": [] }] },
  "noLogrado": { "objeciones": [{ "id", "texto", "de", "estado" }], "caidas": [{ "agente", "ronda", "tipo": "cayo|cortado", "motivo", "detalle", "siguio" }], "brief": [/* puntos falta|parcial */] },
  "numeros": {
    "fuente": "git|instantaneas", "base", "baseCorta", "baseComo",
    "nuevos", "modificados", "borrados", "renombrados", "sacados", "lineasMas", "lineasMenos", "binarios",
    "archivos": [{ "ruta", "estado": "nuevo|modificado|borrado|sacado|renombrado|tocado", "mas", "menos", "binario", "tipo": "codigo|pruebas|docs|imagen|bitacora" }],
    "pruebasDefinidas": { "antes", "despues" },
    "minutos", "turnos", "rondas", "tokens", "costeUsd",
    "agentes": [{ "id", "nombre", "rol", "turnos", "minutos", "notas": { "1": 8, "2": 9 }, "tokens", "costeUsd", "modelo", "fuera", "aprueba", "ultimo": { … } }],
    "porRonda": [{ "ronda", "turnos", "media", "mediaParcial", "cortes" }]
  },
  "ejecutado": { "pruebas": [{ "de", "ronda", "pasan", "total", "segundos", "declarado": true }], "puertos": [4400], "capturas": ["docs/evidencia/…png"], "herramientas": {} },
  "pendientes": { "otraRonda": [{ "texto", "de", "tipo": "objecion|traspaso|opcional|brief" }], "tu": [{ "texto", "de", "tipo": "caida|traspaso|objecion" }] },
  "riesgos": [{ "texto", "de": "servidor|relator" }],
  "opciones": [{ "id", "etiqueta", "explica", "coste", "metodo", "ruta", "cuerpo", "editable": "text", "disponible": false, "guia": { "pasos", "comandos" } }],
  "relato": null | { "autor", "frase" },
  "relatoFallo": "Se queda el informe automático: Codex cambió archivos…" // solo si el relator lo intentó y no valió
}
```

Reglas de verdad que ya cumple el código (y que la UI no debe deshacer):

- **«sacado»:** git lo da por borrado, pero sigue en disco. Sus líneas no cuentan como quitadas. En el instalador, los 61
  «borrados» eran todos de este tipo.
- **«cortado» (PARCIAL) siguió en el ciclo; «cayó» (ERROR) salió.** La línea de sistema de hoy dice «Fuera del ciclo:
  Gemini (colgada)» de un agente que luego aprobó.
- **Pruebas que corrieron:** las dice el agente y van marcadas `declarado`. Lo objetivo es `pruebasDefinidas`, que
  cuenta los `test('…')` ahora y en la base.
- **Repositorio:** solo cuenta el de la propia misión. Sin repositorio propio se usan las instantáneas de cada turno, y
  sin conteo de líneas.
- **Secretos:** todo el informe pasa por `limpiar`. Un `*.secreto.json` nunca aparece en la lista de archivos.

## Opciones: lo que manda cada botón

La UI no arma peticiones: manda `metodo` + `ruta` + `cuerpo` tal cual, después de editar el campo `editable`.
Debajo de la etiqueta muestra `explica` y `coste`. Una opción con `disponible: false` se pinta deshabilitada, con
`explica` como motivo.

| id | Petición | Nota |
|---|---|---|
| `seguir` | `POST /api/chats/:id/messages` `{ text, config: { mode: 'auto', maxRounds } }` | `text` = pendientes; editable antes de enviar. |
| `reanudar` | `POST …/messages` `{ resume: true }` | Sustituye a `seguir` si se cortó. |
| `cambios` | `POST …/messages` `{ text: '', config: { maxRounds: 1 } }` | El usuario escribe `text`; vacío no se envía. |
| `aceptar` | `POST …/accept` | Solo con meseta, retroceso o tope; si no, `disponible: false`. |
| `promover` | — | Muestra `guia.pasos` y `guia.comandos` (copiar). Nada se ejecuta. |
| `diff` | `POST …/open` | Abre la carpeta. La lista de archivos ya está en la tarjeta. |
| `exportar` | `GET …/cierre?format=md` | Descarga `<id>-cierre.md`. |

## La tarjeta (propuesta para Gemini)

De arriba abajo. Cada bloque se pliega si está vacío.

1. **Cabecera:**
   - el semáforo (círculo de color con el texto «verde», «ámbar»… al lado: no solo color);
   - `relato.frase || veredicto.frase` en grande;
   - debajo, en gris, `resumenServidor`.
2. **Cuatro cifras:**
   - archivos (`nuevos/modificados/borrados`);
   - líneas `+/−`;
   - pruebas definidas `antes → después`;
   - tiempo y coste (`minutos`, `costeUsd` o tokens).
   - Con `fuente: 'instantaneas'`, la cifra de líneas dice «sin git».
3. **Mini gráfica:** notas por agente y por ronda (`agentes[].notas`) y la media (`porRonda.media ?? mediaParcial`, con
   un asterisco si es parcial). Reutilizar `public/charts.js`.
4. **Qué se logró:** cada logro con chips de evidencia que abren el archivo (visor existente) o `/raw/<misión>/<ruta>`.
5. **El brief punto por punto:** ✔ ◐ ✖ ○ con la leyenda. Por defecto se pliega si hay más de 8.
6. **Qué no se logró:** objeciones, caídas (con «siguió» o «salió») y puntos ✖.
7. **Pendientes en dos columnas:** «Lo puede hacer otra ronda» y «Lo tienes que hacer tú».
8. **Qué podría pasar:** los riesgos.
9. **Qué se ejecutó:**
   - las pruebas, marcadas «dicho por el agente»;
   - los puertos;
   - las miniaturas de `capturas` vía `/raw/<misión>/<ruta>`.
10. **Tus opciones:**
    - una fila de botones; cada uno con su línea `explica · coste`;
    - «Seguir» y «Pedir cambios» abren el texto editable antes de enviar.
11. **Archivos:** lista plegada con estado y `+/−`.

A 390 px, todo va en una columna, los botones van a todo el ancho y a 44 px, y no hay scroll horizontal. El informe va
el primero en Reportes, antes de los turnos: el dueño no tiene que bajar el hilo para saber en qué terminó. Se repinta
con `cierre-updated`. Las etiquetas que ve son palabras llanas (RF14): «Ámbar · La nota no mejoraba», no la clave
`ambar` ni «CASI LISTO / DETENIDO».

## Relator (RF2)

Hay un turno corto al terminar, ya con el ciclo cerrado (`relatarCierre` en `server.js`, RF15):

- Lo hace el agente que no cayó, con la mejor nota final. En Consejo, el presidente (`elegirRelator`). Nunca un bot por
  webhook. En Editorial no hay relator, ni cuando lo detuvo el usuario.
- Tope de `relatorMinutes` (3 por defecto; con 0 no se lanza) y sin reserva de modelos.
- Lee `.office/relator.md` (`briefRelator`): lo que ya sabe el servidor (logros, puntos del brief con su `n`, objeciones,
  archivos) sin los números.
- Responde **solo** con un bloque ```json, con esta forma:
  ```json
  { "frase": "…", "logros": [{ "texto": "en palabras del dueño", "evidencia": ["ruta"] }],
    "brief": [{ "n": 3, "estado": "hecho|parcial|falta", "evidencia": ["ruta"], "nota": "…" }],
    "riesgos": ["…"], "tu": ["…"], "otraRonda": ["…"] }
  ```
- El servidor guarda el JSON en `chat.relato` (con el id del ciclo), regenera el informe —`conRelato` aplica
  `fusionarRelato`— y emite `cierre-updated`. Así el relato sobrevive a «Aceptar así» y a Exportar.
- Si el relator falla, tarda, no devuelve JSON o cambia archivos de trabajo, se descarta y queda la plantilla, con
  `relatoFallo` diciendo por qué. Si empieza otro ciclo, se corta. Nunca toca los números ni escribe en el chat.
- Un ✔ sin evidencia en disco baja a ◐.
