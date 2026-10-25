# Roadmap

Codex, ciclo 2, ronda 2: revisi?n sin cambios funcionales. Suite local 124/125 en 15,9 s; corte S1F CORTE_NO_CONFIRMADO y taskkill contra hijo propio con Access denied. ui-probe 4400 a 360 y 1440: DevTools 1006 sin capturas. Revalidar en destino (#D17), sin debilitar pruebas ni activar S1F.

Grok, mejora integral · ciclo 2, ronda 1 (D59): la gráfica de convergencia usa la misma media que `roundMean` (ronda completa, sin síntesis ni turno caído; el retroceso no se disfraza de meta). En 4400, a 360 px la página no se desplaza de lado y la gráfica cabe. Suite **125/125 en 21,0 s**. D56 y D57 se conservan. S1F sigue desconectada.

Gemini, mejora integral · ciclo 2, ronda 1 (D58): gráfica de convergencia por ronda en centro de mando (`roundMean`) y resolución de #D16. Suite completa **125/125 en 13,7 s** (0 fallos; corte S1F en 1,8 s). Verificación visual en 4400 a 1440 y 360 px completada con ui-probe y capturas sin excepciones: compositor compacto en ciclo (110 px) y expandible a 237 px, escena con 6 empleados y pestaña Gráficas con 4 tarjetas.

Codex, mejora integral · ciclo 2, ronda 1 (D57): retirado el generador obsoleto de contexto; pruebas sobre el brief real y sus copias. Compositor compacto durante el ciclo, expandible con foco o borrador. Comprobación funcional en VM; UI 4400 a 1440 y 360 intentada sin captura (DevTools 1006). Revalidar interfaz y corte S1F en destino; pendiente gráfica de convergencia. Suite inicial 123/124, único fallo previo `CORTE_NO_CONFIRMADO`.

Claude, mejora integral · ciclo 2, ronda 1 (D56): continuidad entre misiones de una oficina en el brief. Suite **124/124 en 13,3 s**. Sin cambios de UI. Pendiente para el ciclo: gráfica de convergencia (media de revisores por ronda) y compositor compacto durante el ciclo.

Revalidación Codex, mejora integral ronda 3: sin cambios de código; **122/123 en 29,9 s**, único fallo de corte S1F `CORTE_NO_CONFIRMADO`. Sonda independiente: taskkill contra hijo propio devuelve Access denied (salida 1). UI intentada en 4400 con seis empleados: DevTools 1006 a 360 y 1440; no acredita revisión visual nueva. Demo cerrada y puerto libre. Conservar pruebas y revalidar en destino antes de aprobar.

Revisión Codex, mejora integral ronda 2 (D55): paquete limitado a 16 000 bytes UTF-8, preservando prefijo y puntos de código. Suite local 122/123: único fallo previo de corte S1F (`CORTE_NO_CONFIRMADO`), sin omitir ni rebajar. Demo 4400 con seis empleados arrancada; ui-probe a 360 y 1440 cierra DevTools 1006. Revalidar suite y UI en destino antes de aprobar. S1F sigue desconectada; S2 queda para otro ciclo.

Revisión Grok, mejora integral ronda 1 (D54): aceptar un entregable detenido guarda `aceptado`, no `consenso`; el detalle trae el motivo para que el botón exista; la llave no puede aceptarlo. El brief que lee la CLI (`.office/turno.md`) es el paquete corto con prefijo estable; el mapa no sigue junctions. Suite 122/122 en verde (33,3 s). Demo en 4400: oficina de 6 a 1440 y 360 px, y el botón de meseta cierra como ACEPTADA. S2 y rutinas siguen para el ciclo que viene.

Estado de cada pedido del usuario (docs/BRIEF.md) y las ideas priorizadas para los próximos ciclos.

## Hecho

| # | Pedido | Estado | Dónde |
|---|---|---|---|
| 1 | Burbuja en vivo | ✅ Streaming de las 4 CLIs traducido a frases cortas; cronómetro por turno; respaldo en texto | `lib/streams.js`, estaciones en `public/` |
| 2 | Log en tiempo real filtrable | ✅ Por agente, tipo y texto; detalle desplegable; separadores por turno; persistido en `.office/actividad.jsonl` | panel Log |
| 3 | Cómo actúa cada uno | ✅ Expedientes por misión y globales: KPIs, evolución de la nota, herramientas, objeciones, handoffs, rasgos | `lib/stats.js`, pestaña Expedientes |
| 4 | Configurar ciclos al crear la tarea + modo automático | ✅ Modo, rondas/tope, nota mínima, equipo con orden y roles | `lib/cycle.js`, compositor |
| 5 | Que discutan | ✅ Objeciones con estados, respuestas con argumentos, bloquean el cierre, visibles en la UI y en el brief | `lib/debate.js`, pestaña Discusión |
| 6 | Shared brain | ✅ Fusión de tres vías por turno, historial con restauración, búsqueda (oficina + proyectos), relevancia en el brief, edición y temas nuevos en la UI | `lib/memory.js`, panel Cerebro |
| 7 | Handoff de primera clase | ✅ Bloque de estado automático + traspaso del agente con 4 secciones verificadas; pestaña Handoff con historial por turno | `lib/handoff.js` |
| 8 | Estética de centro de mando | ✅ Rediseño completo, sin fuentes externas | `public/style.css` |
| 9 | Intervención del usuario en vivo y control de la discusión | ✅ Directiva/objeción a mitad de ciclo sin detener el turno; resolver/retirar/reabrir objeciones desde la UI | `server.js`, `lib/brief.js`, `lib/debate.js`, `public/app.js` |
| 10 | Tokens y coste por turno y agente | ✅ Normalizado para las 4 CLIs (`claude`, `agy`, `codex`, `grok`); visible en cada reporte y en Expedientes | `lib/streams.js`, `lib/stats.js`, `public/app.js` |
| 11 | Detectar y reanudar ciclo interrumpido + exportar misión | ✅ Estado `INTERRUMPIDA`. Reanudar relanza el ciclo **sobre el mismo pedido** (no lo sustituye por "Otra pasada") | `server.js`, `public/app.js` |
| 12 | Diff por turno | ✅ Diff de texto de los archivos de trabajo en el reporte y en el expediente Markdown | `lib/snapshot.js`, `public/app.js` |
| 13 | Plantillas de misión | ✅ 6 tipos: pedido guiado, ciclo y equipo sugeridos, criterios de calidad en cada brief | `lib/templates.js`, `lib/brief.js`, compositor |
| 14 | Avisos de escritorio al terminar un ciclo | ✅ API `Notification` con interruptor 🔔, contador en el título de la pestaña, toasts apilados | `server.js` (`cycle-ended`), `public/app.js` |
| 15 | Prueba real con las 4 CLIs | ✅ Misión pequeña por la API del servidor, con los flags de `agents.json`: 4 turnos, burbuja y log en vivo, notas y tokens. Destapó 3 fallos de traducción, ya corregidos (D19) | `lib/streams.js` |
| 16 | Robustez ante CLIs caídas | ✅ Sin saldo, límite de uso, sin sesión, colgada (vigilante `idleTimeoutMinutes`), tiempo agotado: causa y qué hacer en la estación, la barra, el reporte, un aviso y el resumen; el resto del equipo sigue (D22) | `lib/failure.js`, `server.js`, `public/` |
| 17 | Plantillas propias desde la UI | ✅ Guardar, actualizar y borrar; con criterios de calidad y entregable en el brief (D23) | `lib/templates.js`, `plantillas.json` |
| 18 | Aviso de objeción del usuario respondida | ✅ Evento `objection-answered`, toast y aviso de escritorio con el interruptor 🔔 (D24) | `server.js`, `public/app.js` |
| 19 | Guía para promover la copia | ✅ README § 2.7: qué se copia, qué datos se conservan y cómo comprobarlo | `README.md` |
| 20 | Visor de entregables (ronda visual, 23-oct) | ✅ HTML renderizado con su CSS, imágenes y JS en un iframe aislado; Markdown con imágenes; imágenes con galería; PDF; audio/vídeo; código resaltado; VISTA/CÓDIGO; pestaña nueva; en vivo y SEGUIR (D27) | `lib/preview.js`, `/raw`, `public/app.js` |
| 21 | Seguridad del visor | ✅ Nada fuera del proyecto (`..`, absolutas, `.office`, enlaces); sandbox sin `allow-same-origin` + CSP `sandbox` con `connect-src 'none'`; la API rechaza escrituras de otro origen (D27) | `lib/preview.js`, `server.js`, `tests/visor.test.js` |
| 22 | Qué se entregó y dónde | ✅ Entregable principal (final/ > último ciclo > tipo), tarjeta 📦 ENTREGA con miniatura, ruta en disco, VER, pestaña nueva y mostrar en carpeta (D28) | `lib/preview.js`, Reportes, Archivos |
| 23 | Entender qué pasa | ✅ Franja de situación, ayuda de lo que hace el chat antes y después de enviar, tooltips propios con lo que hace, piensa y cuánto lleva cada uno, transiciones y estados de carga (D29) | `public/app.js`, `public/nave.js`, `public/style.css` |
| 24 | Directivas en vivo en Delphi y Consejo | ✅ Antes no llegaban a nadie en los modos paralelos (D30) | `lib/brief.js`, `server.js` |

Calidad: 62 pruebas (`npm test`), incluidas capturas reales de las 4 CLIs, un ciclo completo con agentes falsos, el diff, la reanudación, CLIs sin saldo y colgadas, plantillas propias, la ruta `/raw` (MIME, cabeceras, path traversal, enlaces) y el control de origen de la API.
Verificación visual (Claude, 23-oct): demo en 4400 en Relevo y Consejo; HTML con CSS e imagen y su script sin acceso a la API («bloqueada»), Markdown con imagen y enlace, CSS resaltado, PDF real, recarga en vivo y SEGUIR, tarjeta de entrega, tooltips de estación, tripulante y archivo, y una directiva enviada desde el navegador en Consejo. Cero excepciones.
Herramientas: `tests/helpers/demo-server.js` (demo sin gastar suscripciones) y `tests/helpers/ui-probe.js` (verificación de la UI).

La comparación de texto detecta también ediciones que conservan tamaño y fecha (D17); binarios, textos mayores de 64 KB o fuera del presupuesto de captura siguen usando metadatos.
Un comando de shell con varios archivos produce un evento por archivo (D18). El expediente cuenta archivos de trabajo, no la contabilidad del turno.

Corrección D20: tests y una sola escritura conservan ambos eventos; las rutas entre comillas admiten comas sin fragmentarse.

Corrección D21: un tipo .NET no cuenta como archivo; `git` y una búsqueda al final del comando se conservan; `>` y `>>` fuera de comillas son una escritura. `2>&1` no lo es.

## Simulaciones (ronda de construcción del 23-oct-2026; brief `docs/BRIEF-SIMULACIONES.md`)

| Fase | Estado | Qué hay / qué falta |
|---|---|---|
| **S1 · empleados en nivel `contexto`** | **Hecho en lo esencial** (Claude, ronda 1; cierre D43) | `lib/empleados.js` (validación, agentes virtuales, flags de modelo y aislamiento, entorno con lista blanca, `INSTRUCCION_PADRE`, plantilla), `lib/traspaso.js` (entrantes fuera del árbol, sin pisarse), reserva y «diversidad reducida», instantánea por misión (P-MANIFIESTO), bitácora, `turno-<empleado>.md`, expedientes por empleado. UI: asistente de 3 pasos, ficha, ↗ traspasar, entrantes y tablero Hoy. Una respuesta tardía no reabre la ficha ni el traspaso en otra oficina (D43). **Falta, y no es de esta ronda:** rutinas, presupuesto y conexiones (S2+), P-POLÍTICA, y las reales R-INSPECCIÓN y R-CANARIO-CONTEXTO (gastan un turno). |
| **V1: oficina isométrica** | **Revisada en 4400** (Grok, ronda 1) | Seis escritorios, oclusión, rutas al café, a la sala y al ascensor, 132 sprites. Sonda con captura a ~500, 768 y 1440 px y con zoom 200 %. Todos los pares de destinos tienen camino sin cruzar muebles (D40). Queda un pasillo que roza la boca del ascensor. |
| **S1F: frontera por cuenta** | **Preparada con falsos, NO activada** (Grok, ronda 1, D39) | Cookie de panel apagada por defecto, canarios en archivos, plan de ProgramData/token/DPAPI y muerte real de hijo y nieto. Adaptador `/w/v1` en puerto propio (D35). El worker rechaza `APPDATA`/`TEMP` fuera del perfil de la cuenta. Sin puente al motor y sin `-Aplicar`. docs/simulaciones/S1F-PREPARACION.md. |
| **«Hoy en la oficina» (§4.5, lo barato)** | **Hecho** (Claude, ciclo 2, ronda 1, D36) | `lib/hoy.js` + `GET /api/oficinas/:id/hoy`: esperan tu decisión, hecho, equipo, aprendido y atención, con gasto medido o desconocido y día en la zona de la marca. Solo cuenta lo que confirmó el servidor. Revisado en 4400. **Falta (S2+):** diario de rutinas, bandeja y presupuesto como fuentes. |
| S2–S7 | No empezadas | Ver `docs/simulaciones/SIMULACIONES.md` §7. |

## Mejora integral (brief `docs/BRIEF-MEJORA-INTEGRAL.md`, 23-oct-2026)

Análisis por agente en `docs/ANALISIS.md`.

| # | Problema conocido | Estado | Dónde |
|---|---|---|---|
| 1 | El ciclo no sabe cerrar | ✅ Meseta y retroceso detienen **sin aprobar** en Relevo, Delphi y Consejo; sin autonota; la UI y el resumen dicen por qué (D46) | `lib/cycle.js`, `server.js` |
| 2 | Turnos cortados = trabajo tirado | ✅ PARCIAL: sigue en el ciclo y el brief del siguiente lista lo que cambió (D47) | `lib/failure.js`, `lib/brief.js`, `server.js` |
| 3 | Escena de oficina ilegible | ✅ Tarjetas en franja bajo la escena; estado por lugar (escritorio ⌨/⏳, café 💤, ⛔) y leyenda viva; etiqueta = nombre de pila (D48). Revisado en 4400 a 1440 y ~500 px | `public/nave.js`, `public/style.css` |
| 4 | Tripulación de oficina por defecto + personaje elegible | ✅ `Escenas.reparto`: lo elegido primero, luego la tripulación; sin duplicados con el personal fijo. Selector con miniatura en la ficha; `avatar.base` desconocido → 400 (D49) | `public/escenas.js`, `lib/empleados.js`, `public/app.js` |
| 5 | Paquete de contexto corto | ✅ El archivo que lee la CLI (`.office/turno.md`) es el paquete: prefijo estable, marca `<!-- dinámico -->`, tope 16 KB. `contexto.md` es la misma copia. Los briefs paralelos no cambian (anonimato). El mapa no sigue junctions (D54, aclara D51) | `lib/brief.js`, `lib/contexto.js`, `server.js` |
| 6 | Aceptación explícita de misiones sin aprobar | ✅ Solo meseta, retroceso o tope. `outcome: aceptado`, badge ACEPTADA; no es aprobación del equipo. 409 si sigue en curso, si no está detenida o si se repite. La llave recibe 403 (D54; D53 quedó a medias) | `server.js`, `public/app.js`, `lib/hoy.js` |
| 7 | Escena legible en móvil (360 px) y cabecera | ✅ Maquetación 1 columna en <= 760 px, tarjetas 2x3, cabecera suave a 1440 px (D52) | `public/style.css` |
| 8 | Continuidad entre misiones de una oficina | ✅ El brief trae las 3 últimas misiones cerradas de la oficina: cierre, media y el siguiente paso de su HANDOFF. Sin rutas, no llega al edificio y va debajo del prefijo estable (D56, ciclo 2) | `lib/hoy.js`, `lib/brief.js`, `server.js` |
| 9 | Gráfica de convergencia y compositor compacto en ciclo | ✅ Compositor compacto en ciclo (D57). La gráfica usa la misma media que el motor: ronda completa, sin autonota ni turno caído (D58, alineada en D59). En 4400, a 360 px cabe en 332 px y la página no se desplaza de lado. Suite 125/125 | `public/charts.js`, `public/app.js`, `public/style.css` |

## En curso / siguiente (por prioridad)

1. **Misión real de varias rondas mirada en el navegador** por el usuario, al promover esta versión. La del 22-oct-2026 se lanzó por la API y se leyó en los eventos SSE, no en pantalla; la UI se verificó con la sonda y agentes falsos (incluida una CLI sin saldo).
2. **Ronda visual (pedido del 23-oct):** que Gemini, Codex y Grok la revisen en el navegador (4400) con ojos de usuario nuevo: ¿se entiende sin leer el README? Posibles mejoras: miniaturas en el árbol de archivos, comparar dos versiones de un entregable, recordar la posición de desplazamiento al recargar un HTML en vivo (el iframe aislado no deja leerla).
3. **Reintento opcional en la misma ronda** para causas pasajeras (*sin conexión*, *límite de uso* corto) antes de sacar al agente del ciclo. Hoy sale y vuelve en el siguiente ciclo.

## Ideas (sin priorizar)

- Votación final explícita en modo automático con justificación de cada agente.
- Reparto de roles automático según el tipo de tarea y el histórico de rasgos ("exigente" → revisor final).
- Vista de línea de tiempo (Gantt) de los turnos.
- Recuperar el pixel-art como "vista oficina" opcional (ver DISCUSION.md #D1).


## Revisión de Codex (22-oct-2026, nueva pasada, turno 3)
- D25: una CLI con error o timeout solo se considera válida por reporte completo si tiene nota válida y veredicto reconocido. Un solo campo o uno inválido ya no oculta el fallo.
- La sonda `ui-probe.js` se intentó en 4400 con demo aislada y Grok sin saldo, pero salió con código 0 sin imprimir evaluaciones ni diagnóstico. No constituye una validación visual nueva; repetir en el siguiente entorno.

- Suite final tras D25: 45/45 pasando. Atención: el escenario colgado tarda 120,9 s en este entorno; falta confirmar que la terminación del árbol Windows sea puntual, además de clasificar correctamente el fallo.
- **Resuelto en D26 (Claude, ronda 2):** la prueba exige ahora que el ciclo con el colgado termine en menos de 30 s. Si `taskkill` no corta el árbol, la prueba falla en rojo (comprobado por mutación: 121 s). Ya no depende de que alguien mire la duración.

## Revalidar antes de promover

- Codex, ronda 2, turno 7, en un ejecutor restringido: `node --test` 44/45; D26 a los 121 s porque `taskkill /T /F` devolvió «Access denied».
- Grok, ronda 2, turno 8: no se reprodujo. Un árbol propio (shell, hijo y nieto) terminó con `taskkill /T /F`. `node --test` 45/45 en 9,1 s; la prueba del colgado, 4,0 s. Sonda en 4400 con Grok sin saldo: evaluaciones impresas y cero excepciones. Sin cambios de código.
- Al promover, pasar `node --test` en la máquina de destino. Si D26 supera 30 s, allí el corte no está funcionando. La misión real de varias rondas se mira en el navegador (punto 1 de «En curso»).

- Codex, ronda 3, turno 11: sintaxis correcta en los 20 JS; `node --test` 44/45 en 124,4 s. D26 falla: el colgado tardó 120,7 s. `taskkill /T /F` devuelve «Access denied» contra un Node propio en este ejecutor. Demo aislada en 4400 con Grok sin saldo: sonda con salida 0 sin diagnósticos; no acredita una validación nueva. Demo terminada y puerto libre. Sin cambios del programa ni de las pruebas; verificar D26 en destino antes de promover.
- Grok, ronda 3, turno 12: el «Access denied» no se reproduce. Un árbol propio (shell, hijo y nieto) murió con `taskkill /T /F` y el nieto dejó de escribir. `node --test` 45/45 en 6,5 s; D26 en 3,7 s. Sonda en 4400 con Grok sin saldo: evaluaciones impresas y cero excepciones; plantilla `u-prueba-ui` guardada y borrada. Sin cambios del programa.

Revisión Codex (D37): Hoy usa la fecha de cada turno. npm test 104/105 en 11 s; CORTE_NO_CONFIRMADO en la prueba de corte S1F. Revalidar en destino.

Revisión Grok (D39): el corte de hijo y nieto confirma en este ejecutor. npm test 105/105 en 8,8 s. S1F sigue desconectada.
Revisión Claude (D40): 138 caminos de la oficina cruzaban muebles (sala de juntas y pizarra sin vértices); tres vértices nuevos y prueba de todos los pares. npm test 106/106.

Revisión Codex, ronda 2 (D41): traspasos con igual título y segundo ya no se sobrescriben; prueba de conservación y aceptación de ambos, validada por mutación. Suite 106/107 en 8,7 s. El único fallo es el corte S1F: sonda aislada confirma `taskkill` con `Access denied` contra un hijo propio en este ejecutor. Revalidar 107/107 en destino; prueba conservada, frontera desconectada.

Revisión Gemini, ronda 2 (D42): revalidación en destino acreditó 107/107 pruebas pasando en verde en 9,9 s con corte real de árbol S1F (hijo y nieto) en 1,8 s mediante taskkill. Cierre limpio de todos los diálogos (`officeDialog`, `empDialog`, `xferDialog`, `simWizard`, `tplDialog`, `editor`, `viewer`) al cambiar de oficina en `public/app.js`; prueba en `tests/ui-scope.test.js`. Objeción #4 resuelta.

Revisión Grok, ronda 2 (D43): cerrar el diálogo no cancela el `await` que lo vuelve a abrir. Ficha, traspaso, asistente, bitácora, llaves y compositor comprueban la época después de la espera. Suite 108/108 en 9,4 s; corte de hijo y nieto en 1,6 s. S1F sigue desconectada.

Revisión Codex, ronda 3 (D44): listas mal tipadas en ficha reciben 400 sin crear oficina; regresión HTTP, S1 12/12. Suite 108/109 en 9,4 s: CORTE_NO_CONFIRMADO en corte real S1F. Revalidar 109/109 en destino sin omitir prueba. Frontera desconectada.

Revisión Grok, ronda 3 (D45): 110/110 en 11,2 s; el corte de hijo y nieto confirma en este ejecutor (2,0 s). La ficha y el asistente pintan `no_hace` y `poderes` mal tipados sin lanzar. S1F sigue desconectada.
