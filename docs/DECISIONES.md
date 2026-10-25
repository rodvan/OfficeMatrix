# Decisiones de arquitectura y diseño

## D59 · La gráfica de convergencia usa la media del motor (Grok, ciclo 2, ronda 1)
- **Problema:** D58 decía que `Charts.convergence` usaba `roundMean`. No era así. Promediaba quien tuviera nota y solo apartaba los `ERROR`, así que una ronda con un caído pintaba 8,5 cuando el motor no tiene media. Un `PARCIAL` entraba en la cuenta. En Consejo la síntesis entraba: el mensaje no trae `self`, y el motor ni la mira (filtra la fase `aprobacion`). Una ronda a medias se comparaba con la anterior. Si la media seguía sobre la nota mínima, el rótulo decía «meta alcanzada» aunque la bajada fuera un retroceso: el motor se detiene igual. Dos ciclos de la misma misión se mezclaban en el mismo número de ronda.
- **Regla:** la misma fórmula que `roundMean`. Hacen falta los turnos del equipo (`expected`; en Consejo, uno menos: el presidente no vota). `ERROR`, `PARCIAL`, una nota ausente o una ronda a medias: sin punto, y la línea no salta ese hueco. Quien salió con `ERROR` deja de contar en el `expected` de la ronda siguiente. Consejo: solo `aprobacion`. Delphi: solo `revision`. Solo el último ciclo. Retroceso y meseta se dicen aunque la media siga ≥ `minScore`.
- **Prueba:** `tests/ui-scope.test.js` compara el sello `data-round-mean` con `roundMean`. Si se vuelve a promediar a los que quedan de un `ERROR`, o se cuela la síntesis, la prueba se pone en rojo. `public/app.js` pasa el último ciclo, el modo y el tamaño del equipo.
- **Ancho:** la gráfica mide el hueco visible, no el de una ruta larga. En 360 px la línea del entregable (`nowrap`) y la cabecera dejaban la página cerca de 950 px y el SVG salía a ese tamaño. `min-width: 0` en el tablero, la situación y las gráficas, y el ancho pedido no pasa del viewport. En 4400 el scroll de la página queda en 360 y la gráfica en 332; a 1440 hay dos columnas y no hay scroll horizontal.

## D58 · Gráfica de convergencia por ronda en centro de mando (Gemini, ciclo 2, ronda 1)
- **Problema:** la pestaña Gráficas tenía evolución de notas por turno (`scoreLine`), pero no respondía a la pregunta clave del ciclo automático: «¿el equipo está convergiendo hacia la aprobación o se va a detener por meseta o retroceso?». La media de revisores por ronda (`roundMean`, D46) ya gobernaba la detención del motor pero el usuario no podía verla visualmente.
- **Implementación:** `Charts.convergence(turns, minScore, width)` en `public/charts.js` calcula la media de los revisores por ronda (excluyendo la autonota del presidente y turnos con error), grafica la curva de evolución ronda a ronda, marca la meta (`minScore`), y detecta y etiqueta el estado: progreso, meseta (variación < 0,5 entre rondas completas), retroceso (caída ≥ 0,5) o convergencia lograda (media ≥ minScore).
- **Integración:** `public/app.js` la coloca en la cuadrícula de Gráficas en columna paralela a «Tiempo por agente», apilándose a 1 columna en pantallas estrechas.
- **Pruebas y verificación:** unitarias en `tests/ui-scope.test.js` (vacío, ronda 1, meseta, retroceso y meta alcanzada). Sonda `ui-probe.js` en puerto 4400 confirma renderizado de las 4 tarjetas de gráficas sin excepciones. Suite completa pasa con **125/125 en 13,7 s**.

## D57 · Un solo generador de contexto y compositor compacto en ciclo (Codex, ciclo 2, ronda 1)
- Retirados `stablePrefix`, `buildContextPackage` y `writeContextPackage` de `lib/contexto.js`: solo los invocaban las pruebas y pedían empezar por `contexto.md`, contrario a D54. `buildTurnBrief` sigue siendo el generador real; se conservan mapa, diffs, presupuesto UTF-8 y escritura de copias. La prueba usa ahora ese brief y comprueba igualdad de bytes en ambas copias.
- `setRunning` en `public/app.js` permite el compositor compacto durante el ciclo: el foco o un borrador lo expanden. Detener, intervenir y marcar objeción siguen disponibles. La configuración del ciclo queda oculta hasta expandir, como en las misiones paradas.
- Comprobación funcional de estados y controles en VM y 15/15 unitarias del contexto. La sonda en 4400 con seis empleados falla por cierre DevTools 1006 (Chrome 1440 y Edge 360); no acredita revisión visual. Revalidar en el siguiente ejecutor.

## D56 · Continuidad entre misiones de una oficina (Claude, mejora integral · ciclo 2, ronda 1)
- **Problema:** cada misión nueva de una oficina arrancaba de cero. Lo que cerró la anterior, y el siguiente paso que dejó su equipo, solo llegaba si alguien lo había copiado a la memoria. Es lo que más falta para trabajar en proyectos recurrentes y no cuesta un turno.
- **Regla** (`ultimasEntregas` y `siguientePaso` en `lib/hoy.js`, `previasDeOficina` en `server.js`): el brief de una misión de una oficina propia trae «Lo último que cerró esta oficina». Son las 3 últimas misiones con cierre del servidor: fecha, título, cómo se cerró (aprobada, meseta, aceptada por ti…), media de notas del ciclo y el «Siguiente paso recomendado» de su HANDOFF (300 caracteres como máximo). Una misión interrumpida o en curso no entra.
- **Límites:** el edificio no lo recibe, porque mezcla encargos sin relación. No hay rutas: los agentes no salen de su carpeta. El bloque va debajo de `<!-- dinámico -->` y antes del mapa, así que el prefijo estable no cambia y, si hay que recortar, se va antes el mapa. Solo usa lo que escribió el servidor (cierre) y el traspaso; ningún dato de otra oficina.
- **Pruebas:** unitaria en `tests/hoy.test.js` (orden, exclusiones, aceptada, recorte, prefijo idéntico con y sin bloque) y de extremo a extremo en `tests/simulaciones.test.js` (la segunda misión de Redacción A lo trae; el edificio no). Mutación: con `previas: []` en `server.js`, S1-SNAPSHOT se pone en rojo.

## D55 · Presupuesto de contexto en bytes UTF-8 (Codex, mejora integral, ronda 2)
- `assembleContext` contaba unidades UTF-16 (`length`), aunque D54 anuncia 16 KB. Un cuerpo de 15 000 tildes cabía y ocupaba 30 043 bytes con su prefijo. Ahora ese caso ocupa 16 000 bytes como máximo.
- Se descuenta el tamaño UTF-8 del prefijo y del aviso y se añade el cuerpo por puntos de código completos, sin partir emojis. El prefijo conserva prioridad: si él solo excede el máximo, se devuelve entero sin cuerpo (excepción previa).
- Regresión en `tests/lib.test.js`: ASCII, tildes, ideogramas y emojis; tamaño real, prefijo idéntico, UTF-8 íntegro y presupuesto sin espacio para cuerpo. Limitar bytes no garantiza 4 000 tokens ni una tasa de caché del proveedor.
- Verificación: 15/15 unitarias; suite local 122/123, único fallo previo `CORTE_NO_CONFIRMADO` de S1F. Sonda en 4400 a 360 y 1440: DevTools cierra 1006, sin evidencia visual nueva. S1F sigue desconectada.

## D54 · Aceptar no es aprobar, y el brief que lee la CLI es el paquete corto (Grok, mejora integral, ronda 1)
Auditoría de D46–D53. D46 y D47 se quedan: la autonota no entra en la media, una ronda con intervención del usuario no se compara, PARCIAL es solo un corte por tiempo o por silencio con archivos de trabajo, y un fallo de cuenta sigue siendo ERROR. D48, D49, D50 y D52 no salieron rotos. Lo que sí fallaba:

- **Aceptar (reemplaza la parte mentirosa de D53).** El botón no podía salir: `stopReason` iba solo en la lista y la franja lee el detalle. Aceptar guardaba `outcome: consenso`, que es el cierre del equipo, y el badge decía APROBADA. Una llave podía hacer `POST …/accept` sobre cualquier misión parada. Ahora solo se acepta si el motivo es `meseta`, `retroceso` o `agotado`. El mensaje lleva `userAccepted: true` y `outcome: aceptado`. `chatOutcome` queda en `ok`, `stopReason` pasa a null y la lista añade `accepted` para que el badge diga ACEPTADA. En curso, ya cerrada o repetida: 409. La llave recibe 403 (`accept` salió de su lista). El detalle incluye `stopReason` y `accepted`. El panel pide confirmación y el texto dice que el equipo no aprobó. El aviso en vivo es `cycle-ended`, no un `progress`: el panel trata cualquier `progress` como ciclo en marcha y, si no, el clic pinta «preparando el siguiente turno». Hoy no vuelve a pedir decisión si el último cierre de sistema es `aceptado`. `om.js` no gana un comando.
- **El paquete corto es `turno.md` (aclara D51).** La CLI recibe «lee `.office/turno.md`». Un segundo archivo no ahorra tokens, y pedirle que lo abra los gasta otra vez. `buildTurnBrief` arma el paquete: prefijo estable por misión (equipo, ficha, reglas del modo sin números de ronda, protocolo y criterios de la plantilla), marca `<!-- dinámico -->`, y debajo el pedido, los diffs, las objeciones y la cola (traspaso, mapa, memoria). El tope de 16 KB recorta el cuerpo, nunca el prefijo. `contexto.md` (y `contexto-<id>.md` si el id es seguro) es la misma copia de bytes; el brief dice que no se vuelva a abrir. Los briefs paralelos (`turno-<id>.md`, `buildParallelBrief`) no cambian: en Delphi y Consejo un diff con nombres rompería el anonimato.
- **El mapa no sigue enlaces.** `projectFileMap` se salta enlaces simbólicos y junctions. Si `realpath` sale de la raíz del proyecto, el archivo no entra en el prompt. Un id que no cumple `SAFE_ID` solo escribe `contexto.md`, nunca `contexto-../`.

Dejado a propósito: contexto corto en paralelo, contratos entre oficinas (S2), rutinas, y la diferencia `selfScore` / `self` en `scripts/medir.js`. La instantánea de `lib/snapshot.js` sigue sin confinar `realpath`; es anterior y no se tocó.

## D53 · Aceptación explícita de entregables sin aprobar (Gemini, mejora integral, ronda 1)
**Reemplazada en parte por D54.** El botón no llegaba a la pantalla (el detalle no traía `stopReason`), el cierre se guardaba como `consenso` y una llave podía aceptarlo.
- Al detenerse un ciclo por meseta, retroceso o tope sin aprobar (D46/D50), el usuario puede aceptar la entrega tal cual con el botón «✓ LO ACEPTO ASÍ» en la barra de situación (§2.1 a).
- Endpoint `POST /api/chats/:id/accept` añade un mensaje de sistema con `userAccepted: true` y `outcome: consenso`. `chatOutcome` pasa a `ok`, el motivo `stopReason` se limpia, el badge pasa a APROBADA y el tablero Hoy lo registra como aceptado por el usuario. Regresión en `tests/ciclo.test.js`.

## D52 · Maquetación móvil a 360 px y cabecera suave a 1440 px (Gemini, mejora integral, ronda 1)
- En `<= 760px` la vista de dos columnas aplastaba `.ops` a 170 px porque `.missions` tomaba 190 px fijos. Ahora en pantallas estrechas `body` usa una sola columna (`minmax(0, 1fr)`), `.missions` se limita a 200 px de alto arriba y `.ops` aprovecha todo el ancho del móvil (360 px).
- Las tarjetas de estación se organizan en 2 filas de 3 columnas limpias (`minmax(100px, 1fr)`), la escena isométrica no se recorta y los botones de modo de trabajo se adaptan en columna.
- En 1440 px, la lista de empleados `.top-status` recibe `max-width` y desvanecimiento suave con `mask-image` para no montarse sobre los botones de la derecha. Verificado con `ui-probe.js` en 4400 generando capturas a 1440 y 360 px con cero errores.

## D51 · Paquete de contexto corto con prefijo estable y auditoría de tokens (Gemini, mejora integral, ronda 1)
**Aclarada por D54.** El archivo que la CLI abre es `.office/turno.md`; ese es el paquete. `contexto.md` queda como copia de los mismos bytes.
- Implementación de `lib/contexto.js` y generación atómica de `.office/contexto.md` (y `.office/contexto-<id>.md` para empleados virtuales) antes de cada turno según §2.1 d de la propuesta.
- **Prefijo estable:** Identidad, reglas y protocolo invariables por agente para aprovechar al 100 % la caché de prefijo de los proveedores de LLM.
- **Sección dinámica:** Pedido actual y directivas, resumen de cambios ocurridos únicamente desde el último turno de ese agente, objeciones abiertas, mapa del proyecto (1 línea por archivo con tamaño) y hasta 6 entradas de memoria relevante. Techo estricto de 16 KB (~4 000 tokens).
- Herramienta `scripts/medir.js` para auditar tokens totales, % de caché releída, % de salida, turnos cortados y notas en misiones reales a partir de los `chat.json`.

## D50 · Motivo de detención en la lista conservando el contrato de estado (Codex, mejora integral, ronda 1)
- Antes todos los cierres sin aprobación decían ABIERTA. Ahora meseta, retroceso y tope se distinguen con SIN APROBAR.
- `GET /api/chats` conserva `outcome` y añade `stopReason`, derivado del último evento de ciclo. En marcha o tras otro inicio no arrastra el motivo previo. Sin cambios en llaves, om.js ni persistencia.
- Regresión HTTP en meseta y retroceso y ejecución de renderChats con los tres motivos, una misión antigua y otra en curso. La sonda fija viewport mediante Emulation.setDeviceMetricsOverride; falta validación visual porque ambos navegadores cierran DevTools (1006).

Cada decisión con su porqué. Si alguien la cambia, que deje aquí la nueva y el motivo (no borres la anterior: márcala como reemplazada).

## D36 · «Hoy en la oficina» en S1: lo que confirmó el servidor, sin bandeja ni presupuesto (Claude, ciclo 2, ronda 1)
- La §4.5 lee `diario/`, `bandeja.jsonl` y `presupuesto.jsonl`, que no existen hasta S2–S3. Inventarlos ahora sería escribir datos que nadie usa. El tablero se deriva de lo que el servidor YA escribe en cada misión de la oficina: turnos (`agentId`, `modelo`, `usage`, `failure`, `reserva`), cierres de ciclo (`outcome`), «🧠 Cerebro actualizado por X» y los entrantes. Un texto de agente («publicado en WordPress») nunca es un hecho. Función pura en `lib/hoy.js`, ruta `GET /api/oficinas/:id/hoy[?dia=AAAA-MM-DD]`.
- **Bloques:** ESPERAN TU DECISIÓN (en S1 no hay bandeja: entrantes, misiones interrumpidas y objeciones sin cerrar), HECHO, EQUIPO, APRENDIDO y ATENCIÓN (fallos y reservas), más PRÓXIMO. PRÓXIMO dice «sin rutinas (S2)» en vez de inventar una hora.
- **Gasto con etiqueta:** tokens *medidos* en N turnos, minutos, turnos y turnos con uso *desconocido* (nunca 0 tokens, §4.4). La cabecera nombra el nivel: «contexto · corren con tu usuario».
- **Día** en `marca.zona` (`Intl.DateTimeFormat`). Si la zona no es válida, se usa la del sistema. Un turno de las 05:30 UTC cuenta para el día anterior en Ciudad de México. ◀ ▶ recorren días.
- **Dónde se ve:** en una oficina, al no tener misión abierta (al entrar o con «＋ NUEVA MISIÓN»). El compositor queda compacto hasta que escribes, porque si no se come la altura del tablero (lo vio la sonda en 4400). El edificio sigue como antes. Las llaves de agente reciben 403, porque el tablero es del panel.
- **Pruebas:** `tests/hoy.test.js` (zona, límite de día, medido frente a desconocido, «lo que dice un agente no es un hecho», esperan), `HOY` en `tests/simulaciones.test.js` (oficina real con la CLI falsa: equipo, reserva de Lucía, cierre con nota, cerebro, entrante, otro día vacío, solo misiones de A, 403 y 404) y `HOY-UI` en `tests/ui-scope.test.js`. Esta última comprueba que la respuesta tardía de A no pinta B y que escapa el HTML de un título. Validada por mutación: sin la guarda de época, se pone en rojo.

## D35 · El worker habla con su propio puerto, no con el del panel (Claude, ronda 2)
- `lib/frontera-http.js` es el adaptador `/w/v1` del controlador: un `http.Server` aparte que solo escucha en `127.0.0.1` (`escuchar`). Si compartiera puerto con el panel, una sola regla mal puesta dejaría que el token de un worker abriera `/api`, o que la cookie del panel abriera `/w/v1`. Con dos puertos cada lado solo entiende su credencial. Una ruta del panel en el puerto del worker da 404.
- Rechazo con 403 de cualquier petición con `Origin` o `Cookie`, o con un `Host` distinto de `127.0.0.1:<puerto>`. El worker no manda esas cabeceras y un navegador sí, así que una página no puede llegar ni por DNS rebinding. Un token desconocido da el mismo 404 que una ruta inexistente. Hay 405 por método y 413 por tamaño (4,5 MB).
- `Frontera` acepta `onTurno({oficina,id,events,result})`. Se llama solo cuando llega `fin` con `treeDead:true`: es el punto donde el motor recibirá el turno. Los eventos se vacían en cada turno. Antes se acumulaban entre turnos.
- `OFFICEMATRIX_CONTROL` permite sacar manifiestos y entrantes de la raíz de datos (`controlDir`). Se niega si cae dentro de `oficinas/`, `proyectos/` o `memoria/`. Sin la variable no cambia nada: `DATA/.control`, igual que en D31. Con S1F irá a ProgramData con ACL de solo lectura para las cuentas de oficina.
- **Sigue sin montarse:** `server.js` no arranca el adaptador. Falta el puente `onTurno` → `runAgent` y el provisionado real con `-Aplicar`, que este turno no puede ejecutar.

## D34 · Seis escritorios, oclusión y sonda que sí captura (Grok, ronda 1)
- Los puestos 5 y 6 se estamparon clonando el escritorio delantero (`anadir-escritorios.py`, vecino más cercano) en `public/oficina/escena.png`. El PNG de `docs/simulaciones/arte/` sigue con los cuatro originales. Pies medidos: `(1123,624)` → 63,3 % / 70,3 % y `(1214,709)` → 68,4 % / 79,9 %. Completa el hueco de mobiliario que D32 dejó anotado.
- La oclusión no es otro dibujo: ocho `clip-path` de la misma placa. La silla queda fuera del recorte. El camino es Dijkstra sobre waypoints; si no hay salida, el motor usa la recta para no congelar al actor, y la prueba exige segmentos libres hasta el café, la puerta y el ascensor.
- La cookie de panel (`lib/acceso-local.js`) solo vive con `OFFICEMATRIX_COOKIE=1`. Apagada, el panel de `contexto` y la suite no cambian. S1F no se monta en `server.js`.
- Por debajo de 760 px la escena usa el ancho del hueco (la placa es 2:1; centrada y alta se come las filas). La sonda admite 30 s por comando para poder esperar un Consejo.

## D32 · Una escena por oficina sobre el mismo motor (Codex, ronda 1)
- `public/escenas.js` contiene geometría y destinos; `public/nave.js` conserva un solo bucle, actores, guiones, burbujas y estados reales. Nave en edificio, interior en oficinas, puestos declarados y Consejo en la sala. Ascensores HTML con nombre por oficina, teclado y foco conservado entre actualizaciones.
- Tres hojas generadas con imagegen integrado de Codex, sin keys; 132 sprites RGBA, prompts y medición reproducible en docs/simulaciones/arte/generacion. La placa de arte queda sin modificar. Los escritorios 5/6 y la oclusión los añade D34 sobre la copia pública. Una prueba del motor con DOM mínimo no equivale a validación visual; la sonda de D34 sí capturó.
- Épocas de oficina/misión evitan pintar respuestas anteriores tras A → B → A. Misiones/equipo/memoria/entrantes tienen prueba con respuestas invertidas. Contexto/manual queda visible. Se retira el sprite de traje al fallar una CLI.

## D33 · Frontera preparada y autoridad de misión, sin activación (Codex, ronda 1)
- `worker/worker.js` y `lib/frontera.js` son componentes separados con falsos. No se montan rutas /w ni se ofrece cuenta en producción: faltan cookie local, instalador completo y bases/política fuera del árbol. Detalle: docs/simulaciones/S1F-PREPARACION.md. No se ejecutó admin.
- El worker compara perfil y cuenta con os.userInfo(), que consulta la cuenta efectiva; os.homedir() volvería a confiar en USERPROFILE. Token desde archivo, Authorization a loopback. El controlador conserva la reserva cuando el corte no se confirmó.
- Corrección de D31: chat.plantilla_equipo vive en .office y es escribible. Ahora manda `.control/oficinas/<id>/misiones/<id>/manifiesto.json`; misiones anteriores adoptan su snapshot una vez. P-MANIFIESTO prueba reanudar tras falsificar chat/contexto. Faltan bases de memoria en disco y política completa; contexto comparte usuario y no impide lectura deliberada de control.
- D26 falló inicialmente (121 s). Se evitan shells para node/.exe y se corta el ejecutable por su handle si taskkill falla. La aserción <30 s queda intacta y pasa en 3,6 s. El log reconoce que ese fallback no confirma descendientes.
- La sonda UI podía salir 0 sin diagnósticos al cerrar DevTools. Ahora temporiza comandos y falla al cerrar. En este turno dio cierre 1006; no existe evidencia visual nueva.

## D1 · Sin dependencias, lógica pura en `lib/`
- **Qué:** `server.js` solo orquesta (HTTP, SSE, procesos). Todo lo que se puede probar sin procesos vive en `lib/` y tiene pruebas.
- **Por qué:** el brief pide cero dependencias; separar la lógica permite probarla con `node --test` sin lanzar las CLIs ni gastar suscripciones.

## D2 · Streaming por CLI, con respaldo en texto plano (`lib/streams.js`)
- **Qué:** un parser por formato (`claude`, `agy`, `codex`, `grok`) que convierte cada línea JSONL en un evento
  `{ kind, label, detail?, file?, tool? }` con una etiqueta corta en español para la burbuja. Lo que no es JSON se trata como texto (`raw`).
- **Flags** (verificados con `--help` el 22-oct-2026): `claude -p --output-format stream-json --verbose`, `agy -p --output-format stream-json`,
  `codex exec --json`, `grok -p --output-format streaming-json`.
- **Por qué:** cada CLI tiene un formato distinto y puede cambiar. Si el parser no reconoce nada, la app sigue funcionando: el reporte final
  sale del texto plano y la burbuja muestra la última línea. `agents.json` → `"stream": "text"` desactiva el parser.
- **Pruebas:** `tests/fixtures/` guarda capturas reales (leer un archivo + ejecutar `echo`; crear y editar archivos) de las 4 CLIs.
- **Detalle:** Codex lee y escribe con PowerShell (no con herramientas de archivo), así que `classifyCommand` reconoce
  `Get-Content`/`Set-Content`/`node --test`… para que su burbuja también diga algo útil.

## D3 · "Archivos tocados" por foto del disco, no por el streaming (`lib/snapshot.js`)
- **Qué:** antes y después de cada turno se toma una foto (tamaño + fecha) de los archivos del proyecto.
- **Por qué:** funciona igual con todas las CLIs (aunque escriban con comandos de shell) y no depende del streaming.
  Permite **verificar los APROBADO**: si un agente aprueba pero cambió trabajo, el servidor lo baja a CAMBIOS (campo `downgraded`).
  `MEMORIA.md`, `HANDOFF.md`, `memoria-oficina/` y `docs/DISCUSION.md` son "contabilidad" y no cuentan como cambio.

## D4 · Protocolo del reporte (`lib/protocol.js`, `lib/brief.js`)
- **Qué:** el reporte termina con `OBJECIONES:`, `RESPUESTAS:` (`#N RESUELTA|RECHAZADA|DE ACUERDO|RETIRADA|MANTENIDA: argumento`),
  `NOTA: X/10`, `VEREDICTO:` y, en modo automático, `TERMINADO: SÍ|NO`. Se lee siempre la **última** aparición.
- **Por qué:** un formato de texto simple funciona con cualquier modelo; leer la última evita confundirse con citas del brief.
- **Ojo (bug corregido en el turno 1 del ciclo 2):** `\b` no funciona detrás de "Í" en una regex de JS sin `u`, y `TERMINADO: SÍ` nunca se leía
  (el modo automático no podía cerrar por consenso). Ahora se usa un lookahead Unicode y hay prueba de regresión.

## D5 · Discusión con estados (`lib/debate.js`)
- **Qué:** abierta → (otro) resuelta | disputada → (autor) retirada | mantenida(=abierta). "De acuerdo" apoya sin cambiar el estado.
  Solo el autor puede retirar o mantener; solo otro puede resolver o rechazar. Las objeciones abiertas o disputadas cuyo autor sigue
  activo **bloquean el cierre** del ciclo.
- **Por qué:** el usuario pidió que los desacuerdos se resuelvan con argumentos y no sobrescribiendo. El estado explícito evita
  objeciones zombis y deja el debate visible en la UI y en el brief del siguiente agente.

## D6 · Dos modos de ciclo (`lib/cycle.js`)
- **Rondas fijas:** cierra cuando todos los activos aprueban seguidos.
- **Automático:** además cierra si todos dicen seguidos `TERMINADO: SÍ` con nota ≥ mínima y sin objeciones nuevas; tope `autoMaxRounds`.
- **Por qué:** en tareas abiertas (escritura, estrategia) siempre hay "algo mejorable" y la unanimidad sin cambios puede no llegar nunca;
  el modo automático deja que las IAs decidan que lo que queda no justifica otro turno, con un tope que protege la suscripción.
- La configuración (modo, rondas, nota, equipo con orden y roles) se elige **al crear la misión** y se guarda en `chat.config`.

## D7 · HANDOFF.md con bloque automático + traspaso del agente (`lib/handoff.js`)
- **Qué:** OfficeMatrix mantiene un bloque entre `<!-- officematrix:estado -->` y `<!-- /officematrix:estado -->` (tabla de turnos,
  objeciones abiertas). El agente reescribe "## Último traspaso" con 4 secciones obligatorias. El servidor comprueba que estén y con contenido.
- **Por qué:** el estado debe estar al día aunque un agente se olvide; el porqué de las decisiones solo lo puede escribir el agente.
- **Bug corregido (ciclo 2, turno 1):** `handoffQuality` daba por completa una sección vacía porque `\s*` se comía el salto de línea.

## D8 · Cerebro: fusión de tres vías + historial + relevancia (`lib/memory.js`)
- **Qué:** después de **cada turno** (no solo al final del ciclo) se fusiona `base` (lo copiado al empezar) / `ours` (lo que dejó el ciclo) /
  `theirs` (lo que hay ahora en `memoria/`). Las líneas añadidas por cualquiera de los dos lados se conservan; los borrados se respetan.
  Cada escritura guarda la versión anterior en `memoria/.historial/<tema>/` (30 por tema). La edición desde la UI usa la misma fusión.
- **Relevancia:** el brief incluye las 6 entradas del cerebro más relacionadas con el pedido (TF-IDF simple sobre entradas `###`/viñetas).
- **Por qué:** antes "ganaba el último" y se perdían anotaciones con dos ciclos a la vez. La fusión por líneas encaja con el formato
  de la memoria (entradas cortas en viñetas) y no necesita dependencias. El historial permite deshacer cualquier error.

## D9 · Interfaz "centro de mando" sin frameworks ni fuentes externas (`public/`)
- **Qué:** HTML + CSS + JS planos. Rejilla de 3 columnas (misiones · operaciones · inteligencia), estaciones por agente con burbuja en vivo,
  telemetría, pestañas (Reportes, Discusión, Handoff, Expedientes) y panel derecho (Log, Archivos, Cerebro). Tipografía monoespaciada
  del sistema (`Cascadia`/`Consolas`), sin Google Fonts.
- **Por qué:** cero dependencias y que funcione **sin conexión** (la versión anterior cargaba fuentes de Google). El estilo oscuro y denso
  es lo que pidió el usuario ("agencia de inteligencia") y además escala a muchos datos.
- Se sustituyó la oficina pixel-art por estaciones: la burbuja necesita espacio para frases ("editando public/style.css") y la tarjeta
  muestra datos útiles (nota media, aprobaciones, cronómetro). Ver DISCUSION.md (#D1) por si alguien quiere recuperar el pixel-art.
- **Enlaces profundos:** `#m=<id>&tab=<reports|debate|handoff|agents>&side=<log|files|brain>`.
- **Errores de la UI** se muestran como aviso (toast) en vez de fallar en silencio.

## D10 · Verificación de la UI con Chrome headless por DevTools (`tests/helpers/ui-probe.js`)
- **Qué:** una sonda que abre la página, recoge excepciones/errores de consola, evalúa expresiones y hace capturas.
- **Por qué:** `chrome --screenshot`/`--dump-dom` dejan la página a medias con una conexión SSE abierta (se observó: la carga asíncrona
  no termina antes de la captura). Con el protocolo DevTools la página corre de verdad. Node 22+ trae `WebSocket`, así que sin dependencias.
- `tests/helpers/demo-server.js` levanta la oficina con 4 agentes falsos (nombres y colores reales) para probar la UI sin gastar suscripciones.

## D11 · Spawn en Windows con una sola línea de comando
- **Qué:** en Windows se lanza `spawn("<cmd> <args entrecomillados>", { shell: true })` en vez de `spawn(cmd, args, { shell: true })`.
- **Por qué:** es exactamente lo mismo que hacía Node (concatenar), pero sin el aviso DEP0190 de Node 24. Las CLIs siguen necesitando
  shell en Windows porque son `.cmd`/`.ps1`.

## D12 · Telemetría de tokens y coste normalizada desde las 4 CLIs (`lib/streams.js`, `lib/stats.js`)
- **Qué:** `normalizeUsage` extrae `{ inputTokens, outputTokens, cachedTokens, totalTokens, costUsd }` del evento final de las 4 CLIs
  (`result` en Claude y Agy, `turn.completed` en Codex, `end` en Grok) y `computeAgentStats` los suma y promedia por agente.
- **Por qué:** las 4 CLIs reportan `usage` en su salida en streaming pero con semánticas distintas: en Claude y Grok `input_tokens` es solo
  lo no cacheado (hay que sumarle `cache_read_input_tokens` + `cache_creation_input_tokens`), mientras que en Agy y Codex `input_tokens`
  ya incluye lo leído de caché (`cache_read_tokens` / `cached_input_tokens`). Normalizarlo en `lib/streams.js` permite comparar agentes en
  igualdad de condiciones en los reportes y en Expedientes.

## D13 · Intervención del usuario en mitad de ciclo, control del debate, ciclos interrumpidos y exportación (`server.js`, `lib/brief.js`, `lib/debate.js`, `public/app.js`)
- **Qué:**
  1. Mientras un ciclo corre, el compositor sigue activo en modo **Intervenir en vivo** (`POST /api/chats/:id/intervene`): añade una
     directiva (`intervention: true`), opcionalmente registra una objeción abierta de `Usuario` y reinicia la racha de aprobaciones/consenso
     (`state.intervened = true`) para que el equipo la revise antes de cerrar, sin pisar el pedido principal en `.office/turno.md`.
  2. Desde la pestaña **Discusión** (`POST /api/chats/:id/debate`), el usuario puede crear objeciones o resolver/retirar/reabrir cualquiera,
     evitando bloqueos infinitos entre agentes.
  3. `chatOutcome` detecta misiones cuyo último ciclo quedó con `outcome: 'started'` sin cierre (`interrupted`) tras un reinicio del servidor
     y ofrece **▶ Reanudar ciclo** con un clic.
  4. `GET /api/chats/:id/export` descarga un expediente completo en Markdown (metadatos, handoff, discusión, tabla de agentes y reportes).

## D14 · Objeciones del usuario y validez de las aprobaciones
- Las objeciones del usuario abiertas o disputadas bloquean el cierre; un rechazo del agente conserva la discusión pendiente para el siguiente agente.
- Crear o reabrir una objeción desde Discusión invalida la racha previa mediante el mismo mecanismo de intervención en vivo. Resolver o retirar no invalida la racha por sí solo.
- Motivo: una aprobación anterior no acredita haber revisado una nueva exigencia del usuario. Regresiones en `tests/lib.test.js` y `tests/ciclo.test.js`.

## D15 · Veredicto, reanudación, brief en vivo y diff por turno
- **APROBADO sin nota** se baja a CAMBIOS (`judgeVerdict` en `lib/cycle.js`). La regla ya decía "nota ≥ mínima"; un reporte sin `NOTA:` no la cumple y antes podía cerrar el ciclo.
- **Reanudar** un ciclo interrumpido (`resume: true`, o enviar vacío cuando el estado es `interrupted`) no añade un mensaje de usuario. El pedido principal sigue siendo el original. "Otra pasada" queda solo para una misión que sí terminó.
- **Intervenir o abrir/reabrir una objeción** pone la racha a cero en el momento y reescribe `.office/turno.md` del turno en curso (escritura atómica), para que el agente pueda releerlo. El conteo de objeciones del brief es el de `blocking`, no todas las abiertas de agentes que ya salieron.
- **Diff de texto** de los archivos de trabajo (hasta 8, 64 KB, sin binarios ni contabilidad) se guarda en el turno y se muestra en el reporte. `HANDOFF.md`, `MEMORIA.md`, `memoria-oficina/` y `docs/DISCUSION.md` siguen fuera: ya tienen su propia vista.
- **Burbuja:** el primer delta de texto de Grok y de Agy emite "redactando" sin esperar al fin del segmento. Los deltas siguientes no se duplican en el log.

## D16 · Plantillas de misión y avisos de escritorio
- **Plantillas en `lib/templates.js`** (código, post viral, guion, investigación, estrategia, documento). Cada una trae: pedido guiado, modo/rondas/nota, equipo con orden y roles, criterios de calidad y dónde va el entregable. Se sirven en `GET /api/templates`.
- **La plantilla se guarda en la misión** (`config.template`, validado en `normalizeCycleConfig`) y `buildTurnBrief` añade la sección "Tipo de misión" con sus criterios. Motivo: si los criterios solo vivieran en el texto del pedido, un "otra pasada" o un pedido nuevo los perdería, y el agente no sabría qué exige "aprobar" en un guion frente a un informe.
- **La plantilla sugiere, no impone:** no pisa el texto que el usuario ya escribió (solo sustituye un cuadro vacío o el esqueleto de otra plantilla); los agentes no instalados quedan fuera; todo se puede cambiar antes de desplegar. *Libre* vuelve a la configuración de `agents.json`.
- **Los equipos sugeridos usan siempre los 4 agentes** y cambian el orden según quién aporta más al principio (Gemini abre investigación y post viral; Claude abre código, guion, estrategia y documento). Es una heurística inicial; el roadmap prevé ajustarla con los rasgos reales de Expedientes.
- **Avisos:** `cycle-ended` lleva ahora `title`, `outcome` y `summary`. La UI usa la API `Notification` del navegador (sin dependencias, sin service worker): solo con permiso concedido y el interruptor 🔔 activado (se recuerda en `localStorage`); no avisa si estás mirando esa misión. Con la pestaña oculta, el título muestra cuántos ciclos terminaron. Los avisos en pantalla (toasts) se apilan en columna en vez de taparse.

## D17 · Detectar ediciones de texto aunque conserven tamaño y fecha
- **Hallazgo:** una copia o restauración puede mantener tamaño y mtime; comparar solo esos metadatos permitía aprobar trabajo modificado.
- **Corrección:** comparar además el texto que las fotos ya guardan, sin lecturas adicionales ni dependencias. Se conserva la detección previa de archivos tocados por metadatos.
- **Límite:** binarios, archivos mayores de 64 KB y textos fuera del presupuesto total de 8 MB siguen usando tamaño/fecha.
- **Validación:** prueba con archivo real, edición del mismo tamaño y fecha restaurada; comprueba diff y APROBADO rebajado a CAMBIOS.

## D18 · Cada archivo de un comando de shell, y expedientes sin la contabilidad
- **Hallazgo:** en la captura real `tests/fixtures/codex-escribir.jsonl`, Codex hace un solo `command_execution` de PowerShell que crea `saludo.txt`, lee `nota.txt` y lo edita. El parser se quedaba con el primer `-LiteralPath`. La burbuja decía "escribiendo saludo.txt" y el log no mencionaba `nota.txt`. La foto del disco sí veía los dos cambios: el veredicto estaba bien y el log en vivo, no.
- **Corrección:** `commandEvents` en `lib/streams.js` emite una lectura o escritura por cada `Get-Content`, `Set-Content`, `Add-Content`, `Out-File` o `New-Item` con `-LiteralPath`, `-Path` o `-FilePath`. Si ese comando también lanza tests, git o una búsqueda, ese aviso se conserva. Un comando con un solo archivo sigue el resumen de antes.
- **Expedientes:** el contador y "más tocados" usan los archivos de trabajo (`workFiles`). HANDOFF, MEMORIA, `memoria-oficina/` y `docs/DISCUSION.md` no inflan los rasgos. Los turnos antiguos, que no guardaban `workFiles`, se filtran con la misma lista.
- **Límite (parcialmente reemplazado por D21):** una redirección `>` fuera de comillas ahora sí es una escritura. Sigue sin partirse un `Get-Content archivo` sin `-Path` cuando no abre el comando. Qué cambió de verdad en disco sigue siendo el diff del turno (D15, D17).

## D19 · Primera misión real con las 4 CLIs y lo que destapó
- **Prueba:** servidor en el puerto 4400 con `OFFICEMATRIX_HOME` aislado, misión «crea saludo.txt», 1 ronda, nota mínima 7, equipo Claude → Gemini → Codex → Grok con los flags de `agents.json` sin cambios. Resultado: 4 turnos en 2,7 min. Las 4 con streaming reconocido, nota, veredicto y consumo. Claude creó el archivo (9, CAMBIOS); los otros tres aprobaron con 10. El ciclo cerró como `agotado`, que es correcto: con una ronda no hay cuatro aprobaciones seguidas. El entorno temporal se borró al terminar.
- **Fallo 1, lista de rutas:** Codex leyó `-LiteralPath HANDOFF.md,MEMORIA.md,…,saludo.txt` en un solo comando y el log mostraba una entrada «leyendo HANDOFF.md,MEMORIA.md,…». Ahora `scanFileOps` parte la lista (con o sin comillas) en un evento por archivo, como pide D18.
- **Fallo 2, E/S de .NET:** Codex y Grok leen y escriben con `[System.IO.File]::ReadAllText/WriteAllText/…`. La burbuja decía «ejecutando: $utf8 = New-Object…». Ahora se reconoce el archivo literal (`Join-Path $PWD 'x.md'`) o una variable simple (`$p = "x.md"`). Las lecturas repetidas del mismo archivo dentro de un comando cuentan una sola vez.
- **Fallo 3, tokens de Agy:** el turno real de Gemini daba más tokens de caché (23.808) que de entrada (16.614). Las capturas lo confirman: en Agy `input_tokens` NO incluye `cache_read_tokens` y su `total_tokens` tampoco. En Grok, en cambio, `total_tokens` sí la incluye. Solo Codex (`cached_input_tokens`) mete la caché en `input_tokens`. `normalizeUsage` calcula ahora el total igual para las 4 (entrada + salida); antes subestimaba la entrada de Gemini en Expedientes.
- **Sin cambiar:** flags de las CLIs y dependencias. La línea de Codex en stderr «Reading additional input from stdin...» es inofensiva y sigue apareciendo en el log como stderr.

## D20 · Conservar acciones y rutas con comas en el log
- Un comando con tests y una sola operación de archivo perdía el aviso de tests: la rama de un solo archivo devolvía únicamente la escritura. Ahora conserva ambos eventos, igual que con varios archivos.
- Las listas de rutas se tokenizan respetando las comillas: `Get-Content -LiteralPath 'notas,final.md',otra.md` lee dos archivos, no tres.
- Regresión en `tests/streams.test.js`; sin cambios de flags ni dependencias. El límite de D18 para redirecciones queda reemplazado por D21. Sigue sin partirse un `Get-Content archivo` sin `-Path` cuando el comando no empieza por ese cmdlet.

## D21 · El log no debe inventar archivos ni tragarse el resto del comando
- **Hallazgo:** tres mentiras del mismo parser, ninguna cubierta por las pruebas de D18–D20.
  1. `[System.IO.File]::WriteAllText($p, $text, [System.Text.UTF8Encoding]::new($false))` con `$p = 'HANDOFF.md'` decía «escribiendo System.Text». `[System.IO.Path]::Combine($PWD, 'nota.txt')` decía «leyendo System.IO.Path», porque el argumento se cortaba en el siguiente `::`.
  2. `Get-Content -LiteralPath a.txt; git status` decía «leyendo a.txt;» (el `\S+` se comía el punto y coma) y perdía el git. `Set-Content …; rg TODO` perdía la búsqueda. D18 prometía conservar git y búsqueda; solo ocurría si el comando empezaba por ellos.
  3. `echo hola > saludo.txt` seguía como texto crudo. `2>&1` no es un archivo.
- **Corrección:** la ruta .NET es la comilla que parece un archivo, o la variable que parece un archivo; un nombre de tipo (`System.*`, `Microsoft.*`, `Windows.*`) no cuenta. `git` y `rg`/`grep`/`Select-String`/`findstr` se buscan en cualquier sentencia. `>` y `>>` fuera de comillas son una escritura. El nombre de archivo se corta en `;` y `|`.
- **Límite:** `Get-Content archivo` sin `-LiteralPath`/`-Path`/`-FilePath`, metido detrás de otro comando, sigue sin partirse. Una redirección a `$variable` tampoco: no se sabe el archivo. El diff del turno sigue siendo la prueba de qué cambió en disco.
- Sin cambios de flags ni dependencias. Regresión en `tests/streams.test.js`.

## D22 · Una CLI caída se diagnostica, sale del ciclo y el resto sigue
- **Hallazgo:** en la ronda anterior Grok se quedó sin créditos. La app lo sacó del ciclo, pero el usuario solo vio «No pude trabajar (código 1)» y el JSON crudo; la estación seguía en verde. Además: (a) una CLI colgada sin salida bloqueaba la oficina hasta `turnTimeoutMinutes` (20 min); (b) una CLI que salía con error pero imprimía algo en stdout se trataba como turno normal sin veredicto, seguía en el equipo y volvía a fallar en cada ronda.
- **Decisión:** `lib/failure.js` (puro, con pruebas) clasifica el turno: *sin saldo* (402, *balance exhausted*…), *límite de uso* (429, *rate limit*, *quota*), *sin sesión* (401/403, *not logged in*), *CLI no encontrada*, *sin conexión*, *colgada*, *tiempo agotado* o *falló*. Cada causa trae qué hacer. El orden importa: un 402 que dice «limit» es saldo.
- **Regla:** falla si se colgó, si agotó el tiempo sin reporte, o si salió con código ≠ 0 **sin** `NOTA`/`VEREDICTO`. Un reporte completo con código ≠ 0 es un turno válido (algunas CLIs salen con 1 por avisos). Con código 0 solo cae si la salida es corta y es un error de cuenta (saldo, límite, sesión): un trabajo largo que menciona «quota» no cuenta.
- **Vigilante de inactividad:** `idleTimeoutMinutes` (10 por defecto, 0 lo desactiva) corta la CLI que no emite nada en ese tiempo. 10 min deja margen a un `npm test` largo; si no basta, se sube en `agents.json`.
- **UI:** estación en rojo con la causa (detalle y qué hacer al pasar el ratón), causa en la barra superior, recuadro en el reporte, evento `agent-failed` con aviso al momento (toast y escritorio) y el resumen del ciclo nombra a los caídos. El texto completo del turno conserva la salida de la CLI para el `.raw.log` y la exportación.
- **Validación:** `tests/robustez.test.js` (clasificación con el 402 real de Grok) y una prueba de ciclo con un agente sin saldo y otro colgado: cada uno falla una vez, no se le vuelve a llamar y el tercero cierra el ciclo. Sonda de UI con `DEMO_SIN_SALDO=grok`.

## D23 · Plantillas propias del usuario desde la UI
- **Decisión:** «★ Guardar como plantilla» guarda lo que hay en el compositor (texto guiado, modo, rondas, nota, equipo con orden y roles) más criterios de calidad y entregable. Se guardan en `plantillas.json` en la carpeta de datos (`OFFICEMATRIX_HOME` o la raíz), con escritura atómica, porque son datos del usuario como `memoria/`, no código.
- **Por qué id `u-<nombre>`:** nunca pisa una plantilla de serie y guardar con el mismo nombre actualiza en vez de duplicar. Borrar solo afecta a las propias; una misión que la usó conserva su configuración (la referencia simplemente deja de resolverse y el brief omite el bloque).
- `lib/templates.js` mantiene el registro (`setCustomTemplates`, `allTemplates`) para que `templateById`, el brief y `normalizeCycleConfig` traten igual las de serie y las propias. Sin criterios o sin entregable, el brief omite esa línea en vez de dejarla vacía.

## D24 · Aviso cuando un agente responde a una objeción del usuario
- Tras aplicar las respuestas de un turno, el servidor emite `objection-answered` por cada objeción cuyo autor es `user` (id, texto, postura, argumento y nuevo estado). La UI muestra un toast y, con 🔔 activado, un aviso de escritorio que abre la misión.
- Los tres avisos (fin de ciclo, objeción respondida, CLI caída) comparten `notify()`: no molesta si el usuario ya mira esa misión con la pestaña visible, y con la pestaña oculta el título cuenta los avisos pendientes.

## D25 · Un reporte parcial no neutraliza un fallo de la CLI
- Hallazgo de Codex (22-oct-2026): `hasReport` aceptaba una sola mención de NOTA o VEREDICTO. Reproducido: código 1 + error 402 + `NOTA: 9/10` devolvía turno válido; un timeout con `VEREDICTO:` también.
- Decisión: reutilizar `parseScore` y `parseVerdict`; la excepción para códigos de salida no cero exige ambas piezas válidas. Se conserva el soporte Markdown y la tolerancia a avisos tras un reporte completo.
- Regresión: reportes parciales, nota fuera de rango y veredicto inválido no ocultan saldo ni timeout (`tests/robustez.test.js`). Sin dependencias ni cambios de flags.

## D26 · La prueba del colgado mide el tiempo del corte
- Hallazgo (Codex y Grok, ronda 1 de la nueva pasada): la prueba de ciclo solo comprobaba la causa `colgada`. Si `killTree` no mata el árbol, el agente falso se apaga solo a los 120 s, el vigilante ya marcó `idle` y la prueba sigue en verde. Así se explican los 120,9 s que midió Codex.
- Decisión: la prueba mide el tiempo desde el `POST` hasta el fin del ciclo y exige menos de 30 s (con el vigilante a 0,05 min tarda unos 4,5 s).
- Validación por mutación (Claude, ronda 2): con `killTree` desactivado la prueba falla con «el corte del colgado tardó 121 s». Restaurado, la batería da 45/45 en 8,6 s. Sin cambios en `server.js`.
- Revalidación (Grok, ronda 2, turno 8): aquí `taskkill /pid <shell> /T /F` mata el shell, el hijo y el nieto. D26 pasa en 4,0 s (suite 45/45 en 9,1 s). El «Access denied» del turno 7 de Codex no se reprodujo y no justifica otro corte. Sigue sin cambios en `server.js`.

## D27 · Visor de entregables: cada archivo por su ruta y aislado
- **Pedido (23-oct-2026):** ver lo que producen como lo verá el lector (HTML con imágenes y CSS, Markdown con imágenes, imágenes, PDF), en vivo mientras escriben y al terminar.
- **Ruta propia `GET /raw/<misión>/<ruta>`** (y `HEAD`): streaming, MIME correcto, hasta 100 MB. La ruta del archivo va en la URL para que las rutas relativas de un HTML (`img/portada.png`, `estilo.css`) se resuelvan solas, sin reescribir el HTML.
- **Seguridad, en tres capas** (lógica pura en `lib/preview.js`, pruebas en `tests/visor.test.js`):
  1. *Ruta:* `resolveInside` rechaza `..`, rutas absolutas o con unidad, bytes nulos, `.office/`, `.git/`, `node_modules/` y enlaces o uniones que salgan del proyecto (compara la ruta real con `realpath`). `/api/chats/:id/file` usa la misma función.
  2. *Documento:* el iframe lleva `sandbox="allow-scripts allow-popups allow-modals"` **sin** `allow-same-origin`, y el servidor manda `Content-Security-Policy: sandbox allow-scripts …; connect-src 'none'; form-action 'none'` también para abrirlo en pestaña nueva. Los scripts del proyecto corren, pero en un origen opaco: no leen cookies ni almacenamiento ni pueden hacer `fetch`/XHR/EventSource ni enviar formularios. Además `nosniff` y `no-referrer`.
  3. *API:* `sameOriginWrite` rechaza con 403 cualquier POST/PUT/DELETE a `/api` con `Origin` distinto del de la app (incluido `null`, el del iframe) o con `Sec-Fetch-Site` que no sea `same-origin`. Cubre lo que la CSP no puede (otra web abierta en el navegador o una imagen/enlace). Las pruebas y `curl` (sin `Origin`) siguen funcionando.
- **PDF sin `sandbox`:** Chrome no abre su visor en un documento aislado. Va con `default-src 'none'; object-src 'self'` (comprobado con un PDF real en la sonda).
- **Markdown** se renderiza en la app (no en el iframe) con el `md()` de siempre, que escapa todo; solo se añaden imágenes y enlaces relativos al proyecto (apuntan a `/raw`) y enlaces `https:`. `javascript:`, `file:` y rutas absolutas se dejan como texto.
- **`.md` se sirve como `text/plain`:** con `text/markdown` el navegador lo descarga en vez de mostrarlo en la pestaña nueva.
- **En vivo:** los eventos `write` del log ya traen `file`. Si el visor muestra ese archivo (o un HTML de esa carpeta, porque depende de su CSS e imágenes) se recarga con 1,5 s de espera (la escritura llega antes de que termine). **SEGUIR** salta al archivo que esté escribiendo un agente. Al terminar un turno también se refresca.

## D28 · Entregable principal: final/ manda, luego lo del último ciclo
- `deliverables(files, messages)` en `lib/preview.js`: descarta la contabilidad de la oficina (HANDOFF, MEMORIA, `memoria-oficina/`, `docs/DISCUSION.md`, `borradores/*/LEEME.md`), y ordena: `final/` (Delphi y Consejo) → lo que tocó el último ciclo → el resto; dentro de cada grupo HTML > Markdown > PDF > imagen > código, y nombres como `index`, `articulo`, `informe` primero. Un `README.md` solo es principal si no hay nada mejor (describe el proyecto, no lo entrega).
- El detalle de la misión lo trae ya calculado (`deliverables.main` e `items`), y cada archivo del árbol trae su `kind`: la UI no duplica las reglas.
- **Al terminar**, la pestaña Reportes abre con la tarjeta **📦 ENTREGA**: el principal con miniatura (la propia página en un iframe aislado a escala, o la imagen), su ruta completa en disco, **VER**, **PESTAÑA NUEVA** y **MOSTRAR EN CARPETA** (Explorador con el archivo seleccionado: `POST /open` admite `path`, validado igual). Debajo, la galería de imágenes y el resto de entregables.

## D29 · Que se entienda qué pasa: situación, intención del chat y tooltips propios
- **Franja de situación** bajo la telemetría, en frases: modo y ronda (o fase y qué significa), quién trabaja y qué hace, quién sigue y por qué espera, qué falta para cerrar (aprobaciones, «TERMINADO», objeciones que lo impiden) y el archivo que se está escribiendo ahora con enlace al visor. Sin ciclo: el resumen del último y el entregable principal.
- **Intención junto al cuadro de texto:** dice qué hará la app con lo que escribes antes de enviarlo (misión nueva, pedido nuevo, otra pasada, reanudar o directiva en vivo y a quién llega). Al enviar, el aviso confirma quién la tiene ya y quién la leerá después, y si quedó como objeción #N.
- **Tooltips propios (`data-hover`)** en estaciones, tripulantes de la Nave (también el Operador y la Sabia), barra superior, panel AHORA, iconos del log, celdas de la telemetría, archivos y botones. No se usa `title`: tarda, no admite formato y no se actualiza; el nuestro se rehace cada segundo (cronómetro y «en qué piensa», el `said` de `agent-status`, cambian con el ratón encima). Lo que dice de un tripulante: quién es, estado, qué hace, qué piensa, cuánto lleva, por qué espera (relevo: cuántos turnos faltan y quién va antes; paralelo: cola por «máx. a la vez»), causa y qué hacer si cayó, y qué significa su icono (💭 ⌨ ☕ 💬 ✔ ⛔ ⏳).
- **Interacción:** botones con estado «esperando al servidor» (no se pulsan dos veces), confirmación antes de **■ Detener**, transiciones suaves en pestañas, diálogos, tooltips y estaciones, y un destello corto cuando cambia la actividad de una estación.

## D30 · Las directivas en vivo también llegan en Delphi y Consejo
- Hallazgo al escribir la ayuda del chat: `buildParallelBrief` no incluía las directivas del usuario y `markIntervened` solo reescribía el brief del relevo. En los modos paralelos, «⚡ Intervenir en vivo» no llegaba a nadie.
- Corrección: el bloque «Directivas del usuario durante este ciclo» es común a los dos briefs, y cada turno paralelo guarda cómo reescribir su `turno-<id>.md`, así una directiva llega ya a las IAs que están trabajando. En los modos paralelos no hay hilo de objeciones, así que la casilla «+ objeción» se oculta y la ayuda lo dice. Regresión en `tests/workflows.test.js`; comprobado en la demo de Consejo (la directiva aparece en los tres `turno-<id>.md` en curso).

## D31 · Simulaciones S1: los empleados son agentes virtuales de las oficinas que ya existen
- **Evolucionar, no duplicar.** La especificación (`docs/simulaciones/SIMULACIONES.md`, escrita sin ver el código) pedía `simulaciones/<id>/`, `lib/simulations.js`, `lib/scope.js` y rutas `/api/s/:sim/…`. El código que funciona ya tenía `oficinas/<id>/` con API, llaves de agente, `om.js` y pruebas, y un agente externo lo usa. Manda el código: **una simulación es una oficina**, la carpeta sigue siendo `oficinas/<id>/`, la API sigue siendo `/api/oficinas` y `?oficina=`, y las llaves no cambian. En la UI se llama «simulación» en el asistente y «oficina» en el selector. Si un día se renombra, se añaden alias.
- **Empleados = agentes virtuales.** `lib/empleados.js` convierte cada empleado activo en un agente con la forma de `agents.json` (`id` del empleado, `cmd`/`stream` de su CLI, args + modelo + aislamiento, `empleado.ficha`, `oficina.marca`, `reserva`). `configFor(oficina)` los devuelve como «los agentes» de esa oficina, así el ciclo (relevo, Delphi, Consejo), la discusión, Expedientes, las estaciones y la nave funcionan sin una línea de motor nueva. Una oficina sin empleados sigue con su «equipo» de IAs, como antes.
- **Flags verificados con `--help` (23-oct-2026), no inventados:** `claude --model`, `codex exec -m`, `grok -m`, `agy --model`, `gemini -m`; aislamiento `--strict-mcp-config --disable-slash-commands --no-session-persistence` (Claude), `--ephemeral --ignore-user-config --ignore-rules` (Codex), `--no-subagents` (Grok), `--disable-slash-commands` (agy). En Codex van detrás de `exec`. `--continue`, `--resume`, `-r`, `resume`, `--add-dir` (y `-c` salvo en Codex, donde es `--config`) dan `FLAG_PROHIBIDO`. `"kind"` en `agents.json` permite un envoltorio con los flags de la CLI real (lo usan las pruebas y la demo).
- **Entorno con lista blanca para empleados** (P-ENTORNO), pero **sin hogares de CLI propios**: `CLAUDE_CONFIG_DIR`/`CODEX_HOME`/`GROK_HOME` obligarían a iniciar sesión otra vez y el brief prohíbe tocar las sesiones. Se añade `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1` y `GROK_MEMORY=0`. El edificio conserva su entorno de siempre.
- **`INSTRUCCION_PADRE` adaptada a esta PC:** la especificación incluía `.grok/` en cualquier padre, pero `~/.grok` es el hogar global de Grok (config y sesión) y existe en tu perfil: habría bloqueado todas las misiones. Se ignora solo en tu perfil; en cualquier otro padre sí bloquea. El `POST` de la misión devuelve `409` antes de crearla y `runAgent` lo comprueba otra vez sin crear el proceso.
- **Traspaso fuera del árbol:** los entrantes viven en `.control/oficinas/<destino>/entrantes/` (raíz de datos), no en `%LOCALAPPDATA%\OfficeMatrix\control\` como dice la especificación: en nivel `contexto` los agentes corren con tu usuario y podrían leer ambos sitios igual, y así los datos siguen bajo `OFFICEMATRIX_HOME` (pruebas con carpeta temporal, copias y promoción sin rutas fuera). Con S1F, `control/` se mueve a `%LOCALAPPDATA%` y la ACL hace el resto.
- **Instantánea:** `chat.plantilla_equipo` guarda empleados y marca al crear la misión (no `.office/contexto.json`, que es escribible por los agentes). Cambiar de modelo deja línea en `oficinas/<id>/bitacora.md`.
- **Reserva una vez** (`runAgentWithReserve`) ante `SIN SALDO`, `LÍMITE` o `SIN SESIÓN`; el turno guarda `modelo` y `reserva {motivo, de, a, diversidadReducida}`.
- **Nombres de la película fuera de la UI:** la nave usa arquetipos (Líder, Elegido, Piloto, Capitana, Operador, Sabia). Queda pendiente para V1: el sprite `agente-*` que aparece junto a un tripulante caído recuerda al «agente» de traje negro que la §6.3 pide evitar; sustituirlo en la tanda de arte.

## D37 · Fecha del evento y limpieza de pruebas
- Hoy elige último turno, reserva y fallo por timestamp, no por orden de creación de misiones. Regresión con ambas permutaciones.
- La prueba del árbol S1F espera evidencia del nieto hasta 5 s y limpia sus PID aun en fallo. Conserva todas las exigencias de corte. Aquí devuelve CORTE_NO_CONFIRMADO; revalidar en destino.

## D38 · Hoy visible en ancho estrecho, scroll de operaciones y revalidación de corte S1F (Gemini, ronda 1)
- **Hallazgo:** al revisar «Hoy en la oficina» en el puerto 4400 a ancho estrecho (≤760 px, móvil/zoom) con la sonda de interfaz, el tablero `.board` resultaba con altura 0 px. Al apilarse la escena de la oficina (613 px) y el compositor (hasta 458 px), la cuadrícula `.ops` (`grid-template-rows: auto auto auto minmax(0, 1fr) auto`) colapsaba la fila 4 a cero en viewports de 600–740 px y no permitía scroll por `body { overflow: hidden }`. Además, el compositor en modo `.compact` conservaba `display: block` en `.cycle-config` (89 px) y mantenía el foco del input al cambiar de oficina desde el edificio.
- **Corrección:**
  1. En `@media (max-width: 760px)` de `public/style.css`, `.ops` adquiere `overflow-y: auto;` y `.board` fija `min-height: 380px;`, garantizando visibilidad completa y desplazamiento natural entre nave, tablero y compositor.
  2. `.composer.compact` oculta `.cycle-config` con `display: none !important;` evitando ocupar altura innecesaria mientras no se edite.
  3. `public/app.js` desenfoca el input (`blur()`) al ingresar a una oficina para priorizar la visualización del tablero Hoy sin activar `:focus-within`.
- **Revalidación S1F:** la suite completa de 105 pruebas pasa en verde (105/105 en ~9 s) en este entorno destino; `tests/escenas-worker.test.js` confirma corte de árbol hijo/nieto sin demoras ni errores (12/12 en 2,3 s). Con esto la objeción #3 queda resuelta.

## D39 · El worker no hereda el perfil de quien lo lanza (Grok, ronda 1)
- **Hallazgo:** `validateEnvironment` solo exigía que `USERPROFILE` fuera el hogar de la cuenta y que no hubiera claves `CLAUDE_CODE_*`, `API_KEY`, `TOKEN`, `SECRET` o `PASSWORD`. La lista blanca copiaba igual `APPDATA`, `LOCALAPPDATA`, `TEMP`, `TMP` y `HOMEDRIVE`+`HOMEPATH`. Si el lanzamiento reescribe `USERPROFILE` y deja el resto del padre, la CLI de la oficina abre el perfil de quien la lanzó. Un `onTurno` que fallaba se tragaba el error, vaciaba el turno y el worker recibía 204. Un `POST` sin token a `/w/v1/trabajo` respondía 405 y delataba la ruta.
- **Corrección:** esas rutas tienen que quedar dentro del perfil (`realpath`: una junction que sale no cuenta). Si no, `ENTORNO_AJENO` y no se copian. Si el motor rechaza el fin, la respuesta es 500 y el turno sigue activo. Sin token, 404 también cuando el método no es el de la ruta. Si `-Aplicar` falla a medias, el script borra la cuenta que acababa de crear. No se ejecutó: `server.js` sigue sin escuchar `/w/v1`.
- **Prueba:** `npm test` 105/105 en 8,8 s. El hijo imprime `sin-appdata` cuando el padre le pasa un `APPDATA` ajeno; una junction en el árbol de la comprobación deja el resultado en rojo sin seguirla; el 500 retiene el turno.

## D40 · Rutas de la oficina: todo destino alcanzable, sin recta de reserva que cruce muebles (Claude, ronda 2)
- **Hallazgo:** la prueba de rutas solo salía del escritorio 1 hacia el café, la sala y el ascensor. Recorriendo todos los pares de destinos de la escena (asientos, café, sala, charla, pizarra, puerta, ascensor, cocina, consola), 138 caminos cruzaban un mueble. El grafo no tenía vértice dentro de la sala de juntas, así que el asiento `[72,40]` del Consejo no tenía camino. Tampoco había vértice detrás de la fila de escritorios, así que la pizarra y la charla quedaban sin camino. `route()` devuelve entonces la recta «para que el actor no se quede parado»: el personaje atravesaba el cristal o los escritorios sin que ninguna prueba lo notara.
- **Corrección:** tres vértices en `public/escenas.js`: `[64,44]` dentro de la sala, tras la puerta, y `[47,54]` y `[44,46]` rodeando el final de la fila hacia la pizarra. Comprobados en la captura de 4400: caen en suelo libre. La recta de reserva se queda como red de seguridad, pero ya no se usa en esta escena.
- **Prueba:** `V1: entre cualquier par de destinos hay camino…` recorre todos los pares y exige que cada tramo esté libre. Validada por mutación: sin los tres vértices se pone en rojo (`14,46 → 72,40`). `npm test` 106/106.

## D41 · Un traspaso nunca sobrescribe otro entrante (Codex, ronda 2)
- Dos entradas con el mismo título enviadas en el mismo segundo producían el mismo nombre; `writeFileSync` sustituía la primera sin aviso.
- Creación exclusiva (`wx`) y reintento con sufijo incremental ante `EEXIST`. El título se acorta para que el sufijo siga dentro del límite del lector; los nombres anteriores siguen siendo válidos.
- `tests/traspaso.test.js`: mismo instante y título de 50 caracteres, cuerpos distintos, listado de ambos y aceptación independiente. Mutación sin `wx`: falla al detectar nombres iguales.
- Suite: 106/107 en 8,7 s. Único fallo: corte S1F con `CORTE_NO_CONFIRMADO`, también presente antes de D41. Sonda propia: `taskkill /T /F` devuelve `Access denied` (código 1) contra un Node hijo. Se conserva la exigencia del corte completo y se deja revalidación en destino; sin admin.

## D42 · Cierre limpio de diálogos al cambiar de oficina y revalidación 107/107 en destino (Gemini, ronda 2)
- **Hallazgo:** al auditar el cambio de oficina (`setOffice`), la lista de diálogos a cerrar incluía `['editor', 'viewer', 'officeDlg']`. El elemento con ID `officeDlg` no existe (el ID real en `index.html` es `officeDialog`), por lo que nunca se cerraba. Además, los diálogos modales creados en S1 (`empDialog` para la ficha del empleado, `xferDialog` para traspasos de memoria, `simWizard` para el asistente de creación y `tplDialog` para plantillas) se mantenían abiertos al cambiar de oficina (por ejemplo, navegando por hash o pulsando el ascensor en la escena viva), reteniendo datos y contexto de la oficina previa.
- **Corrección:** `setOffice` en `public/app.js` cierra explícitamente todos los diálogos (`['editor', 'viewer', 'officeDialog', 'empDialog', 'xferDialog', 'simWizard', 'tplDialog']`), impidiendo fugas de contexto o ediciones involuntarias sobre una oficina distinta a la activa.
- **Prueba:** actualizada y ampliada la aserción en `tests/ui-scope.test.js`.
- **Revalidación en destino:** la suite completa de 107 pruebas pasa en verde (107/107 en ~10 s) en este entorno destino, con el corte de árbol de procesos hijo/nieto de S1F verificado (`tests/escenas-worker.test.js` en 1.8 s con `taskkill` real) y los traspasos concurrentes con `wx` (D41). Objeción #4 de Codex resuelta.

## D43 · Una respuesta tardía no reabre un diálogo en otra oficina (Grok, ronda 2)
- **Hallazgo:** D42 cierra los diálogos al empezar `setOffice`, pero la ficha, el traspaso y el asistente llaman a `showModal()` después de un `await`. Si el usuario cambia de oficina mientras llega el catálogo o las entradas, el diálogo se abre otra vez con los datos de la oficina anterior. Guardar esa ficha hace `PATCH` de la oficina que está en pantalla: la plantilla repite `irene` y `sara`, así que pisa al empleado de la oficina nueva. El traspaso pintaría índices de otro cerebro. La bitácora, la lista de llaves y el `then` de `oficinas-updated` tenían el mismo hueco (rehacían el compositor de la oficina a la que acababas de entrar). En el visor, dos misiones con el mismo nombre de archivo se pisaban la vista.
- **Corrección:** después de cada espera se compara `officeEpoch` y la oficina capturada al abrir. Si cambió, no se abre, no se pinta y no se rehace el compositor. El `PATCH` de la ficha usa el id de la oficina que la abrió. Si la llave se crea a mitad del cambio, el aviso la muestra igual: no se vuelve a enseñar. El visor descarta la respuesta si ya es otra misión. Crear la simulación no te arrastra de vuelta si ya te fuiste; el aviso dice que quedó creada.
- **Prueba:** `tests/ui-scope.test.js` simula el catálogo y las entradas que llegan después del cambio. Sin la guarda de la ficha, la prueba se pone en rojo. `npm test` 108/108 en 9,4 s; el corte de hijo y nieto, 1,6 s.

## D44 · Validar listas antes de formatear la ficha
- no_hace o poderes como texto lanzaban en join(), aunque ya tenían diagnóstico; poderes como objeto con includes:true lanzaba al comprobar veto. Comprobar Array.isArray antes de esas operaciones conserva el 400 con errores.
- Regresión HTTP: tres cuerpos inválidos, 400 y ninguna oficina creada. S1 12/12; suite 108/109: único fallo previo de corte real S1F, CORTE_NO_CONFIRMADO. Sin admin.

## D45 · El asistente pinta el JSON antes de que el servidor lo rechace
- D44 evita el 500 al crear la oficina. El paso 2 del asistente (y la ficha, si el JSON ya está en memoria) llamaba a `join` e `includes` sobre `no_hace` y `poderes` tal como venían. Un texto o un objeto con `includes: true` tumbaba el formulario y el 400 no llegaba a verse.
- Un texto se muestra y, al guardar, vuelve a ser lista. Un objeto no marca ningún poder y no lanza. Lo mismo para `marca.evitar` al pegar JSON. Prueba en `tests/ui-scope.test.js`. Suite 110/110 en 11,2 s; corte de hijo y nieto en 2,0 s. S1F sigue desconectada.

## D46 · Detener sin aprobar: meseta y retroceso (Claude, mejora integral, ronda 1)
- **Problema:** el ciclo solo cerraba por unanimidad, consenso o tope. Con notas de 8 a 9, cada retoque menor reiniciaba la racha y se gastaban todas las rondas (la ronda anterior agotó sus 3).
- **Regla** (`plateauOutcome` en `lib/cycle.js`, propuesta §2.1 a): al cerrar una ronda se compara la media de los revisores con la de la ronda anterior. Las dos tienen que estar **completas**: todos los turnos esperados, ninguno ERROR ni PARCIAL y todos con nota. Si la media cambió menos de 0,5, se detiene por **meseta**. Si bajó 0,5 o más, por **retroceso**. El resumen dice «sin aprobar», las dos medias y las objeciones abiertas; en el retroceso, además, qué ronda era mejor.
- **Autonota:** en Consejo, el presidente no vota su síntesis; solo cuentan los votos de los demás. En Delphi cada uno califica un borrador ajeno. En Relevo no hay un autor único: cada turno califica el proyecto que dejaron los demás, así que cuentan todas las notas. `roundMean` excluye cualquier turno marcado `self`.
- **Lo que no cambia:** aprobar sigue exigiendo que todos aprueben sin objeciones bloqueantes. Detener no aprueba: `chatOutcome` no da la misión por cerrada (`ok`). Una ronda en la que el usuario intervino (`markIntervened`) no se compara, porque cambió el pedido. La meseta no espera a que se resuelvan las objeciones: las deja a la vista y la decisión pasa al usuario.
- **Brief:** una línea avisa de la regla. Así los agentes saben que un retoque cosmético no salva la ronda.
- **Pruebas:** unitarias en `tests/lib.test.js` (límites de 0,5, autonota, rondas incompletas, intervención) y de extremo a extremo en `tests/ciclo.test.js`, con los guiones `meseta` y `baja` del agente falso y las frases del protocolo. Mutación: si se desactiva la regla en `server.js`, las tres pruebas nuevas se ponen en rojo.

## D47 · Turno PARCIAL en vez de ERROR (Claude, mejora integral, ronda 1)
- **Problema:** un turno cortado por tiempo o por silencio quedaba como ERROR y el agente salía del ciclo, aunque ya hubiera editado archivos. El siguiente agente no sabía que en disco había cambios a medias.
- **Regla** (`isPartial` en `lib/failure.js`): si la causa es `tiempo` o `colgada` y el turno cambió archivos de trabajo, el veredicto es `PARCIAL`. El agente sigue en el ciclo. Las caídas de cuenta (saldo, sesión, límite) siguen siendo ERROR aunque hayan tocado algo: volver a llamar no las arregla.
- **El trabajo no se da por bueno:** la racha vuelve a cero, la ronda queda incompleta para D46 y Expedientes lo cuenta como fallo. El brief del siguiente agente que aún no lo vio trae «⚠ Turno cortado a medias: verifícalo antes de seguir», con quién se cortó, por qué y qué archivos cambió (`partialBlock` en `lib/brief.js`). En los modos paralelos, un borrador PARCIAL sigue siendo un borrador; una revisión PARCIAL no cuenta como voto.
- **UI:** etiqueta ámbar `PARCIAL`; la estación no lo pinta como caído (`failureOf`). El evento `agent-failed` lleva `partial: true`.
- **Prueba:** guion `cortado` del agente falso (escribe y se queda callado) en `tests/ciclo.test.js`. Mutación: sin la regla, la prueba se pone en rojo.

## D48 · Escena de oficina: se lee por el sitio que ocupa cada uno (Claude, mejora integral, ronda 1)
- **Visto en 4400 (1440 px, Redacción con 6 empleados):** las tarjetas tapaban unos 100 px por lado de una escena de 578×289. La 5.ª y la 6.ª quedaban cortadas. Las etiquetas eran largas («nombre · CLI · modelo»), había 5 globos «en cola» a la vez y dos empleados en el mismo píxel.
- **Decisión:** las tarjetas pasan a una franja compacta bajo la escena (nombre y estado; caben 6 en una fila a 1440). Durante un ciclo, el estado se lee por el lugar. Escritorio con brillo y globo: trabaja. Escritorio con ⏳ y sin globo: espera. Café con 💤: fuera de la misión. ⛔: caído. Una leyenda arriba da los totales («⌨ 1 trabaja · ⏳ 5 esperan turno»). La etiqueta es el nombre de pila (el completo si dos coinciden); modelo y puesto van al tooltip. Fuera de un ciclo siguen paseando.
- **Pruebas:** `tests/nave-motor.test.js` y `tests/ui-scope.test.js` (franja en el móvil). Sonda en 4400 sin excepciones; Chrome headless abre a ~500 px aunque pidas 360.

## D49 · La tripulación de oficina es el reparto por defecto y el personaje se elige en la ficha (Claude, mejora integral, ronda 1)
- `public/escenas.js` define `TRIPULACION`, `PERSONAJES` (los 6 de la nave más los 6 de la redacción) y `reparto(list)`. Primero se respeta `avatar.base`; a los demás se les da el primer personaje libre: lider, elegido, piloto, capitana, después los de la redacción y al final operador y sabia. Si un empleado lleva el operador o la sabia, ese personal fijo sale de la escena: nadie aparece dos veces.
- La ficha tiene un selector con miniatura: «AUTO» más los 12 personajes; los que ya lleva otro salen atenuados. Elegir AUTO quita `avatar.base` y conserva el resto de `avatar`.
- `lib/empleados.js` toma la lista de `escenas.js`, que queda como única fuente. Un `avatar` que no es objeto o un `base` desconocido es **error** (400); dos activos con el mismo personaje, aviso. No hay claves nuevas: compatible con `oficinas/`, las llaves y `om.js`.
- **Pruebas:** `tests/simulaciones.test.js` (12 PNG presentes, 400 sin crear oficina, aviso por repetido, plantilla) y `tests/nave-motor.test.js`. Suite completa 119/119.

## DB1 · Grok Bots externos por webhook, con una puerta propia (24-oct-2026)
- **Qué hay detrás:** el usuario tiene Grok Bots. No tienen API pública de lectura, pero sí rutinas con disparador webhook (la
  entrada) y acciones salientes a una URL (la salida). Con eso cada bot es un agente más de su oficina (`lib/bots.js`):
  - el turno sale firmado: Standard Webhooks con `whsec_…`, si no Bearer;
  - la respuesta vuelve a una URL de un solo uso.
- **Puerta aparte:** `puerta-bots.js` en 4323, para que el túnel de Cloudflare NUNCA exponga el panel. Solo `/bots/r/<token>` y
  `/bots/o/<oficina>/<llave>`; todo lo demás, 404.
- **El bot no ve el disco:** recibe el brief y el texto de los archivos citados. Su aporte se guarda en `aportes/`, que cuenta como
  contabilidad y no como «cambiar el trabajo» (un bot puede APROBAR); su borrador o síntesis va en su carpeta.
- **Fallos propios:** «SIN RESPUESTA DEL BOT» y «WEBHOOK DEL BOT FALLÓ» se diagnostican antes que la red o la sesión de una CLI y no
  se reintentan solos: cada intento ejecutaría la rutina del bot.
- **Secretos:** URL y llave en `bots.secreto.json`, fuera de la API y de git. Los tokens se guardan por hash.
- **Rechazado:** exponer la app entera por el túnel con la cookie de `lan.js`. Un fallo en cualquier ruta del panel sería público.

## D60 · Escena de oficina calibrada contra la imagen y navegación por rejilla (24-oct-2026)
- **Problema** (evidencia en `docs/evidencia/ESCENA-OFICINA.md`): los personajes cruzaban el ascensor y los escritorios en
  línea recta, salían del suelo, tomaban café dentro de la barra y el suelo no coincidía con la imagen.
- **Calibración:** se midió `public/oficina/escena.png` (1774×887) con una rejilla al 1 % sobre recortes ampliados.
  - La fila larga de escritorios es una banda diagonal: borde delantero `y = x + 30,9` (cajones y ruedas de las sillas) y
    trasero `y = x + 16,7` (pie de la mampara). Tiene 4 sillas reales (ruedas en 14,7·46,5 / 21,3·52,6 / 28·60 / 35,2·66,4),
    más los dos escritorios añadidos (63,2·69,1 y 68,2·79).
  - Asiento = ruedas + (0,9, 1,1): las caderas del sprite sentado, que mira a la derecha hacia su monitor, quedan en el cojín.
    Cada silla tiene un punto de acceso desde el pasillo.
  - **Obstáculos reales:** bloque del ascensor, macetas, columna, aparador, pizarra, barra en L (los taburetes quedan fuera),
    banco, mesa de juntas y cristal de la sala con el hueco de la puerta (x 58,5–63,4).
  - El suelo sigue el ventanal, la sala de juntas y la barandilla del borde.
  - Hay **6 sillas de escritorio**; del 7.º empleado en adelante trabajan en sillas de la sala de juntas. Nadie comparte silla.
- **Navegación:** rejilla de 0,5 % sobre el suelo menos los obstáculos.
  - La celda es libre si su centro y la holgura de los pies (±0,6/±0,45) son transitables. Solo cuenta la zona conectada más
    grande (detrás de la barra queda cerrado por la barandilla y no es destino).
  - A* con 8 vecinos, sin cortar esquinas en diagonal, y suavizado solo si la línea de vista cae entera en celdas libres.
  - Se sale de una silla y se llega a otra por su acceso. Entrar o salir de la sala pasa por la puerta.
  - Los puntos al azar (pasear, apartarse de otro) salen de celdas libres, y apartarse también va por el camino.
- **Oclusores:** un tramo por escritorio con su `y` justo encima de su silla: quien se sienta se ve delante de su mesa y quien
  pasa por detrás queda tapado. El cristal es transparente: solo el marco bajo de las paredes delanteras tapa los pies de quien
  está dentro (antes tapaba la sala entera y los reunidos no se veían).
- **Pruebas** (`tests/escena-oficina.test.js`, con el motor real):
  - todos los puntos de la escena son libres;
  - las rutas entre todos los destinos y puntos al azar se muestrean cada 0,2 % y nunca entran en un mueble ni salen del suelo;
  - una simulación de más de 6 minutos (más de 7.000 cuadros) con 6 empleados, el operador y la sabia pasa por trabajar,
    esperar turno, paseo libre, Consejo y otra vez trabajar, y comprueba en cada cuadro que nadie pisa un mueble;
  - al final, cada uno está sentado en SU silla.
- **Verificación visual:** `docs/evidencia/oficina-corregida.png`, en la demo con la superposición de suelo, muebles, sillas y
  rastros; 0 posiciones fuera.
- **Límites de la imagen:**
  - solo hay 4 sillas en la fila larga y 1 en cada escritorio añadido;
  - el sprite sentado es lateral, así que en la sala de juntas se ve «sentado de lado»;
  - el fondo de la sala de juntas está tras la mesa y no se usa como asiento.

## IN1 · Qué entra en el repositorio público (Claude, instalador, ronda 1, 24-oct-2026)
- **Fuera del índice** (`git rm --cached`; siguen en disco porque el ciclo los usa) y en `.gitignore` para que no vuelvan:
  `MEMORIA.md`, `HANDOFF.md`, `docs/BRIEF*.md`, `docs/ANALISIS*.md`, `docs/DISCUSION.md`, `docs/evidencia/`,
  `docs/evidencia-instalacion.md`, `docs/arte/`, `docs/simulaciones/arte/`, `PROPUESTA-mejoras.md`, `S1F-PREPARACION.md` y
  `docs/simulaciones/index.html`. Son proceso de las misiones, no le sirven a un usuario nuevo, y las hojas de arte y sus
  prompts describen a los personajes demasiado cerca de la película. Los sprites finales viven en `public/`.
- **Se quedan:** `docs/DECISIONES.md` (historial técnico), `ROADMAP.md`, `MODOS-DE-TRABAJO.md`, `PARA-AGENTES.md`,
  `GROK-BOTS.md`, `simulaciones/SIMULACIONES.md` (la especificación que citan el código y las pruebas) y
  `simulaciones/simulacion.ejemplo.json` (la plantilla «Redacción de contenido» la carga en tiempo de ejecución).
- `recorte-oficina.json` pasó a `tests/fixtures/`: la prueba V1 lo necesitaba y vivía en una carpeta que ya no se publica.
- **Datos del usuario:** el agente y la empresa reales pasan a «tu agente externo» y «Acme»; la marca de la simulación de
  ejemplo, a «Acme Ciencia» (ficticia). Las rutas de los fixtures pasan a `C:\Users\demo\…` y se vaciaron las listas de
  skills, plugins y conectores MCP del usuario que traían las capturas de Claude y Grok.
- **Sin nombres de la película en la UI:** `tank`, `oraculo` y `smith` pasan a `operador`, `sabia` y `aviso`; la etiqueta
  «ORÁCULO» pasa a «SABIA».
- **La historia de git no está limpia:** el commit base contiene todo lo anterior. `node scripts/revisar-publicacion.js
  --historial` lo muestra (107 hallazgos el 24-oct). Se publica desde una rama huérfana con un solo commit (`docs/PUBLICAR.md`).

## IN2 · `agents.example.json` versionado y `agents.json` del usuario ignorado (Claude, instalador, ronda 1)
- **Por qué:** con `agents.json` versionado, activar a Kimi o cambiar un modelo choca con el siguiente `git pull`. La
  detección automática sola no basta: los flags y roles son configuración, no algo que se pueda adivinar.
- **Cómo:** si falta `agents.json`, `loadConfig()` lo copia de `agents.example.json` (salvo con `OFFICEMATRIX_CONFIG`). Una
  CLI que falta no rompe nada: `isInstalled()` ya la marca ❌ y el ciclo sigue con las demás.
- **Gemini (`agy`) viene con `enabled: false`:** los términos de Antigravity (sección 6) prohíben usar software de terceros
  con su acceso (`memoria-oficina/lecciones.md`, 23-oct-2026). Quien lo acepte lo enciende en su `agents.json`.
- La demo (`tests/helpers/demo-server.js`) enciende a los cuatro de siempre (son falsos y no gastan), acepta perfiles nuevos
  sin guion propio y arranca aunque no exista `memoria/` (en un clon nuevo no existe).
- **Cerebro inicial vacío:** `memoria/` no se publica. La semilla que había era la memoria real del usuario.

## IN3 · Escáner de publicación sin dependencias (Claude, instalador, ronda 1)
- `scripts/revisar-publicacion.js` revisa lo que git subiría (`git ls-files`): correos que no son de ejemplo, rutas
  `C:\Users\<alguien>` y `/home/<alguien>` reales, llaves `om_…` con forma real, `whsec_`/`vhk_`/`crsr_` con contenido,
  tokens con pinta de secreto (`sk-`, `ghp_`, `xai-`, `AIza`, `AKIA`, llaves privadas), IPs de red local y los dos nombres
  privados. También falla si un archivo ignorado sigue en el índice. `--historial` revisa cada versión en todas las ramas
  con un solo `git cat-file --batch` (un `git` por objeto tardaba minutos).
- Los nombres privados se arman por partes en el escáner y en su prueba, para que no se denuncien a sí mismos.
- `tests/publicacion.test.js`: cada regla con un caso que falla y otro de ejemplo que pasa, un repositorio temporal con un
  ignorado en el índice, y **este** repositorio limpio. Sin git (descarga en zip), las dos últimas se saltan.

## IN4 · Kimi Code CLI: perfil apagado y lector `kimi` propio (Claude, instalador, ronda 1)
- **Qué CLI:** Kimi Code CLI (`kimi`, Node), no la `kimi-cli` de Python, archivada el 23-sep-2026. Funciona con la
  membresía Kimi (Plus o más) vía `kimi login`, sin API key. Fuentes y fecha en `docs/AGENTES.md` §3.
- **Args:** `-p {prompt} --output-format stream-json`. Sin `--yolo`: la referencia oficial lo prohíbe junto con `-p`, que
  ya aprueba solo. El prompt va por argumento, así que `server.js` puede seguir cerrando stdin: no hizo falta una opción.
- **Lector propio:** el JSONL de Kimi tiene forma de chat (`role`/`content`/`tool_calls`) y no encaja en los otros cuatro.
  Con `text` habría funcionado, pero la burbuja se llenaría de JSON crudo. `kimiHandler` es corto. Kimi no informa de
  tokens, así que su tarjeta no los muestra.
- **Apagado por defecto:** no está instalado en el equipo de pruebas y no hay captura real. `tests/kimi.test.js` usa una
  CLI falsa construida a partir de la referencia y de una captura publicada (kimi 0.27.0). Cuando alguien lo ejecute
  de verdad, hay que grabar `tests/fixtures/kimi-*.jsonl` y cambiar la falsa por esa captura.
- Las plantillas de misión siguen con el equipo base de cuatro: un opcional no entra en un equipo sugerido.
- **Riesgo documentado:** con `-p` no hay un flag que limite la escritura a la carpeta de la misión.

## IN5 · Instaladores y Primeros pasos (Codex, ronda 1)
- Instaladores sin dependencias, administrador, cambios de PATH ni instalaciones automáticas. Validan Node 18+ y git;
  scripts/comprobar-clis.js muestra detección, instalación y login, y generan un lanzador relativo a su propia carpeta.
- public/primeros-pasos.js comparte el catálogo de instrucciones entre instaladores y UI; no ejecuta esos comandos.
- Asistente automático por navegador (localStorage con tolerancia al bloqueo) y botón permanente para reabrirlo.
  Consulta /api/agents del edificio, incluso desde una oficina con empleados. Instalación y autenticación se distinguen.
- Probar usa la API existente de misiones: equipo explícito de un solo agente, Relevo, una ronda. No habilita perfiles
  desactivados; avisa del consumo y abre el expediente para observar respuesta o fallo, sin declarar login correcto por crear la misión.
- Regresión de UI con CLI ausente, opcional desactivada, nombre escapado y payload de equipo único. Prueba real de HTTP
  con la demo falsa en 4408 y arranque normal aislado en 4407. No se gastaron suscripciones.

## IN6 · Documentación pública bilingüe, gobernanza y verificación de Kimi (Gemini, ronda 1)
- **README público bilingüe:** `README.md` (inglés) y `README.es.md` (español) enlazados entre sí. Presentan la portada oficial (`docs/img/portada.png`), el lema unificado («Your own AI creative team powered by your subscriptions» / «Tu propio equipo creativo de IAs con tus suscripciones»), espacio reservado para la escena en vivo (`docs/img/escena.gif`), badges de proyecto, y diagramas Mermaid estándar para los tres modos de trabajo (Relevo, Delphi y Consejo).
- **Instalación y conexión:** resumen en 3 pasos que enlaza a `docs/INSTALAR.md`, destacando los instaladores automáticos sin administrador (`instalar.ps1` e `instalar.sh`) y el asistente «Primeros pasos» en la aplicación web. Se detalla la integración con la aplicación hermana **ViralHunt** (redacción editorial continua, aprobación humana y despacho directo).
- **Archivos de gobernanza abierta:** añadidos en la raíz `LICENSE` (Apache License 2.0 con crédito a Cerebro Digital), `CONTRIBUTING.md`, `SECURITY.md` (modelo de aislamiento local y reporte privado) y `CODE_OF_CONDUCT.md` adaptados desde los borradores sin términos obsoletos ni datos sensibles. Marcadores de donación oficiales `<<PAYPAL_DEL_USUARIO>>` y `<<BITCOIN_DEL_USUARIO>>`.
- **Verificación de Kimi Code CLI:** contraste en fuentes oficiales (Moonshot AI) confirmando autenticación OAuth por código de dispositivo (`kimi login`) con membresías Plus/Pro sin API keys, modo no interactivo `-p`, formato `stream-json` y advertencia de permisos.
- **Validación:** `scripts/revisar-publicacion.js` en verde (cero datos personales ni secretos) y suite completa en verde (144/144 pruebas pasan).

## IN7 · Auditoría de usuario nuevo (Grok, instalador, ronda 1, 24-oct-2026)
- **Licencia:** `package.json` decía `MIT` mientras `LICENSE`, los README y `CONTRIBUTING.md` dicen Apache 2.0. Queda `Apache-2.0` para que GitHub y npm no anuncien otra licencia.
- **Arranque:** `docs/INSTALAR.md` mandaba hacer doble clic en `iniciar.bat`, que no existe. El instalador crea `iniciar-officematrix.cmd` / `iniciar-officematrix.sh`.
- **Retratos:** los README apuntaban a `public/sprites/`, carpeta que no existe. Los archivos están en `public/nave/iso/`.
- **Una CLI basta:** el README pedía dos o más para empezar. La app y `docs/INSTALAR.md` arrancan con una; dos o más son la revisión cruzada.
- **Escáner:** `git ls-files` no ve un archivo nuevo todavía sin añadir. `git add -A` (el paso de `docs/PUBLICAR.md`) sí lo sube. Ahora revisa índice + archivos nuevos no ignorados. Un ignorado que siga en el índice se sigue denunciando. La prueba del repositorio temporal cubre el archivo suelto.
- **Instalador de Windows:** con `FORCE_COLOR`, `node -p` escribe la versión como `ESC[33m24ESC[39m`. En pantalla se lee 24 y `[int]` revienta (*Input string was not in a correct format*): el instalador no creaba el acceso directo. Ahora ambos instaladores leen la versión con `process.stdout.write`, sin color. La prueba lanza `instalar.ps1` con `FORCE_COLOR` y `NO_COLOR` a la vez.
- **Comprobado en esta máquina:** clon de lo que subiría `git add -A` (549 archivos) con historia de un solo commit y 0 hallazgos. `instalar.ps1` y `instalar.sh` (Git Bash) crean el lanzador. En el puerto 4411, con el PATH sin CLIs, las cinco salen no instaladas, Gemini y Kimi siguen desactivados y el asistente abre solo con Probar deshabilitado. La demo falsa en 4412 deja Probar activo en los cuatro falsos y apagado en Kimi. `npm test`: 145/145. macOS y Linux nativos no se ejecutaron.

## IN8 · Corrección sobre `iniciar.bat` (Claude, instalador, ronda 2, 24-oct-2026)
- IN7 dice que `iniciar.bat` no existe, pero está versionado en la raíz (`git ls-files iniciar.bat`). Arranca `node server.js` y abre `http://localhost:4321` sin respetar `PORT`. Se queda: es el atajo de quien ya usaba la app. `docs/INSTALAR.md` lo cita como alternativa fija en 4321, y `iniciar-officematrix.cmd`/`.sh` siguen siendo el camino recomendado porque respetan `PORT`.

## D61 · GUI responsive con cajones y objetivos táctiles de 44 px (24-oct-2026)
- **Problema** (medido a 360, 390, 768, 1024 y 1440 px en la ronda de GUI):
  - por debajo de 1000 px desaparecían el log, los archivos y el cerebro (`display: none`), justo en el teléfono;
  - a 768 px el tablero de reportes medía 139 px y el selector de oficina, 68;
  - en el teléfono había 21 objetivos táctiles de menos de 44 px.
- **Decisión:** CSS primero, con dos puntos de corte y cajones.
  - **1001–1180 px:** el log es un cajón a la derecha («📜 LOG»).
  - **≤ 1000 px:** una columna que se desplaza entera; las misiones son un cajón a la izquierda (☰).
  - Uno abierto a la vez. Se cierran con el velo, con Escape o al elegir una misión (`drawer()` en `app.js`, 12 líneas).
  - Los cajones usan `visibility: hidden` al cerrarse, así el tabulador no entra en un panel que no se ve.
- **44 px** con `max-width: 1000px` o `pointer: coarse`. Con ratón se conserva la densidad: es un centro de mando.
- **Escena aislada** (`.deck { isolation: isolate }`): su `z-index` por profundidad (miles) no sale por encima de cajones
  ni diálogos.
- **Escritorio:** la escena mide `clamp(260px, 40vh, 370px)`; a 1440×900 el tablero pasa de 265 a 366 px. La
  contrapartida: la escena baja de 624 a 604 px de ancho.
- **Pruebas:** `ui-scope.test.js` sigue exigiendo `.ops { overflow-y: auto; }` y `.board { min-height: 380px; }`, que
  ahora viven en el bloque «Responsive». No se cambió ninguna prueba existente.
- **Herramientas:**
  - `tests/helpers/medir-anchos.js` repite la medida a los cinco anchos;
  - `ui-probe.js` acepta `--frames=N,ms` para una serie de capturas.

## D62 · Escena viva: caminar con inercia, rutas curvas, ceder el paso, sentarse sin bucles y la nave con muebles (24-oct-2026)
- **Caminar:**
  - velocidad de crucero (3,5 en espera, 5 trabajando), aceleración de 6/s² y frenado de 7/s² que se anticipa a la distancia
    que queda de ruta (llega parado, sin saltos de velocidad);
  - el cuadro del ciclo de pasos sale de la **distancia recorrida** (8 cuadros por zancada de 7 unidades de suelo), no del
    reloj: aunque frene o espere, los pies no patinan;
  - parado detrás de otro se ve de pie, no congelado a mitad de zancada;
  - la orientación (frente o espalda, y el espejo) tiene un margen: en un tramo casi horizontal conserva la que traía.
- **Rutas curvas:** `Escenas.route` cambia cada esquina por una Bézier cuadrática que empieza y acaba a ≤ 1,6 del vértice.
  Solo se acepta si todo el arco pisa suelo con holgura; si no, se prueba con la mitad y al final se deja la esquina.
- **Nadie atraviesa a nadie:**
  - **Planificar:** quien está sentado es un obstáculo de radio 1,6 (sus piernas asoman al pasillo y no se va a mover).
  - **Al andar:** mira LOOK = 3,6 por delante. Si su camino pasaría a menos de 1,5 de otro (1,25 si está sentado), frena;
    se para a 2,2 de frente o a 1,6 de lado. Se calcula con el punto de máximo acercamiento, no con un cono: un cono dejaba
    atascado a quien pasaba rozando a un sentado.
  - **Tope duro:** ningún paso lo deja a menos de 1,25 de nadie si eso lo acerca más.
  - **Atascos:**
    - a los 0,9 s parado busca otra ruta que rodee a los demás;
    - si no la hay y los dos se bloquean, cede el de menos prioridad (trabaja > espera turno > libre) apartándose 3–5 pasos;
    - a quien está de pie y quieto se le pide que se aparte;
    - a los 9 s, último recurso: puede pasar, pero el tope duro sigue.
  - **El primer tramo de una ruta también se valida:** la «celda libre más cercana» de la que sale una ruta tiene que verse
    en línea recta sin pisar un mueble. Si no, al rodear a otro podía elegir una celda al otro lado de la esquina de un
    escritorio (lo encontró la prueba de estrés: el operador cruzó la esquina del escritorio 6).
- **Sentarse:**
  - quien trabaja o piensa va a SU silla y se queda sentado todo el turno. Si piensa, su globo lleva 💭. Se quitó el
    «levantarse a pensar a la pizarra» (era el bucle que veía el usuario: las CLIs alternan «pensando» y herramientas);
  - recién sentado no se levanta hasta 8 s (`SIT_MIN`), aunque el estado vaya y vuelva. También al celebrar;
  - en el Consejo todos se sientan en la sala: quien ya trabaja en una silla de la sala la conserva; el resto toma las
    libres por orden; si no quedan, se queda de pie junto a la mesa (`standRoom`). Nadie comparte silla (antes, con 7 u 8
    empleados, dos iban a la misma);
  - el Consejo ya no para a todos en la puerta (se atascaban); la ruta pasa por ella;
  - caído o fuera de la misión: de pie en el pasillo junto a su puesto, nunca encima de la silla.
- **La nave también tiene muebles:**
  - calibrada contra `public/nave/escena-iso.jpg` (1672×941) igual que la oficina (D60), con una rejilla al 1 % sobre
    recortes ampliados;
  - suelo sin el reborde; obstáculos: fila de sillones con sus consolas, armarios del rincón, consola del operador,
    tabique y cocina;
  - asiento = los pies del sprite sentado delante del cojín de su sillón (antes quedaban 3,7 % a la derecha, sobre la
    consola lateral);
  - el 6.º tripulante en adelante trabaja de pie (`standing`): solo hay 5 sillones;
  - los puntos de café y de la sabia salieron de dentro de la cocina.
- **Personal fijo:** nace ya en su puesto. Antes nacía al azar y saltaba al puesto en el primer cuadro: un teletransporte
  real que la prueba nueva detectó.
- **Azar sembrado:** el motor pide los puntos al azar con su propio `Math.random` (`Escenas.randomFree(SCENE, Math.random)`).
  Antes usaba el del módulo `escenas.js`, así que una simulación con la misma semilla no se repetía igual.
- **Pruebas** (`tests/escena-viva.test.js`, motor real con `tests/helpers/motor-escena.js`):
  - oficina con 4 y con 8 empleados y nave con 5: relevo, libres, Consejo, un caído y uno fuera, y otra vez a trabajar;
  - entre 5.000 y 8.000 cuadros cada una;
  - fallan si alguien pisa un mueble, se sienta fuera de una silla, se sienta y levanta en menos de 5 s (o vuelve a
    sentarse a los 2 s de levantarse), avanza más que su velocidad máxima en un cuadro o queda a menos de 1,2 de otro;
  - al final, cada uno sentado en SU silla;
  - otras dos pruebas: la calibración de la nave, y que las rutas curvan (menos del 10 % de giros de más de 50°) sin salir
    del suelo;
  - `ESCENA_SEMILLAS=1-40` repite cada simulación con 40 semillas (estrés; en la suite normal va una semilla fija).
- **Evidencia (capturas internas, no se publican):** capturas de la oficina con 8, del Consejo y de la nave, la superposición
  de suelo, muebles, sillas y rastros, y las medidas tomadas en la propia página.
- **Límites:**
  - la pose sentada de la oficina es lateral (D60);
  - con 8 en el Consejo la sala se llena y las etiquetas se pisan;
  - el ciclo de caminata tiene dos direcciones (frente y espalda) más el espejo.

## D63 · Reportes y gráficas: resumen en lenguaje llano, tokens y objeciones; un solo eje y colores sin reciclar (24-oct-2026)
- **Resumen de la misión** (`Charts.summary`), arriba de GRÁFICAS y de REPORTES cuando la misión terminó:
  - **por qué terminó**, con el vocabulario del motor: aprobada por todos o por consenso, aceptada por ti, tope de rondas,
    meseta, retroceso, detenida, interrumpida o error;
  - **cifras:** rondas (de las previstas), turnos, tiempo de trabajo, tokens (avisa si hay turnos sin medir), objeciones
    abiertas y cerradas, archivos de trabajo;
  - **qué se hizo:** el cierre del motor, los archivos y el entregable con su ruta;
  - **qué falta:** las objeciones abiertas con su autor y el siguiente paso de cada final, p. ej. «nadie lo aprobó: revisa la
    entrega y acéptala así o pide otra pasada».
- **Gráficas nuevas:**
  - **Tokens por turno:** una barra por turno, del color de su agente, sobre un eje; entrada, salida y caché en el tooltip;
  - **Objeciones por ronda:** planteadas (barra llena), cerradas (contorno) y abiertas al cerrar cada ronda (línea
    discontinua). Tinta neutra: no son de ningún agente.
- **Reglas aplicadas a las que ya había:**
  - convergencia: la media del equipo va en tinta neutra (antes en el cian del acento) y **solo la última ronda lleva
    número**; antes, uno por punto;
  - matriz de revisiones: tinta neutra en lugar de `#4f8df5`, que **es el color de Gemini**;
  - `Charts.distinct`: si dos agentes traen el mismo color, el segundo se aclara y el tercero se oscurece. Una serie, un
    agente;
  - la tabla de datos suma tokens y archivos por turno;
  - el eje de la línea de tiempo pone tantas horas como caben (a 390 px se pisaban).
- **Tooltip al tocar:** `pointerdown` con dedo o lápiz lo abre sobre la marca, tocar fuera lo cierra y hacer scroll también.
- **Pruebas:** `tests/graficas.test.js` (resumen por final y escape de HTML, barras de tokens sin número, conteo de
  objeciones por ronda, colores que no se reciclan y un solo número en la convergencia). La prueba existente de
  convergencia (`ui-scope`) sigue igual.
- **Pendiente:** no hay tema claro en la app. Las gráficas ya usan las variables del tema.
  (Resuelto en D65.)

## D64 · No repetir las variantes de color en equipos de una misma CLI (24-oct-2026)
- distinct limitaba el índice a 3: los empleados cuarto y sexto del mismo color recibían exactamente la misma variante. Se conserva alternar mezcla clara/oscura, cambiando su proporción por pareja sin saturar el índice.
- Se amplía la prueba de identidad existente con doce empleados de igual color; 4/4 pruebas de gráficas pasan. No se cambia ninguna aserción previa.
- Validación completa local: 144/145; único fallo de corte real S1F con CORTE_NO_CONFIRMADO. No se rebaja. El tema claro de gráficas sigue pendiente del brief, no se da por validado por usar variables.

## D65 · Tema claro para paneles, reportes y gráficas; la escena sigue oscura (24-oct-2026)
- **Por qué:** el brief pide gráficas «legibles en claro y oscuro» y la app solo tenía oscuro. Usar variables CSS no
  bastaba: faltaba el tema y demostrarlo (objeción #2 de Codex).
- **Cómo:** `:root[data-tema="claro"]` redefine las variables (`--bg`, `--panel`, `--text`, `--dim`, acentos) y pisa los
  ~25 fondos oscuros escritos a mano en paneles, diálogos, log, visor y tooltips. Botón ☀/☾ en la barra; se recuerda en
  `localStorage` (`om-tema`) y, sin elección, sigue `prefers-color-scheme`. Un `<script>` de una línea en `<head>` lo fija
  antes del primer pintado (sin destello oscuro).
- **La escena no cambia:** oficina y nave son pixel art con su luz; aclararlas sería otro arte, no un tema.
- **Gráficas:** la celda de la matriz usaba `fill="#d5dde8"` fijo; ahora usa la clase `cell` (tinta del tema) y el número
  fuerte, `var(--bg)`. `Charts.distinct` en claro oscurece todas las variantes de un color repetido (aclarar hacia el
  blanco borraba la línea); al cambiar de tema se repintan reportes y gráficas.
- **Contraste medido:** texto, `--dim` y acentos ≥ 4,5:1 sobre panel y fondo; los cuatro colores de CLI ≥ 3:1 sobre blanco
  (marca gráfica, WCAG 1.4.11). Lo comprueba `tests/graficas.test.js` leyendo `style.css` y `agents.json`.
- **Evidencia (capturas internas, no se publican):** tema claro a 1440 y 390 px (demo en
  4410, sin errores de consola, scroll horizontal 0).
- **Suite:** 146/146 en este ejecutor, incluido el corte real de hijo y nieto (S1F) que en el de Codex daba
  `CORTE_NO_CONFIRMADO`: era la restricción de su entorno, no una regresión.

## D66-ED · La tanda es una misión normal de la oficina, sin motor de rutinas aparte (Claude, editorial, ronda 1)
- **Por qué:** el brief pide solo lo mínimo de S2. Una tanda reutiliza ciclo, equipo, modos, reserva, Hoy y bitácora.
- **Cómo:** `lanzarTanda` crea la misión con `chat.editorial = { tipo: 'tanda', franja }`. Usa modo `auto`, tope de 2
  rondas (fijo en `normalizarRegla`) y el modo de la regla (Consejo o Relevo). `editorialAlCerrar` se llama en el
  `finally` de los dos motores (Relevo y paralelo) y cosecha `propuestas/<n>/`.
- **Archivos del servidor en la misión:** `createMission(office, body, extra)` acepta `extra.archivos` y
  `extra.copiar`. Solo los usa el servidor: el cuerpo HTTP no llega a `extra`.

## D67-ED · Horario: la última franja que pasó, una vez; la franja con tanda abierta se salta (Claude, editorial, ronda 1)
- `tandaDebida` es pura (reloj inyectado). Mira las franjas de ayer, hoy y mañana en la zona de la marca (`Intl`, sin
  dependencias; cubre el cambio de hora) y solo la más reciente que ya pasó. Si el PC durmió varias franjas, se lanza la
  última, una sola vez.
- `estado.ultimaFranja` se apunta **antes** de esperar a ViralHunt, y `lanzando` bloquea la oficina mientras tanto. Así
  un minuto lento no lanza dos tandas.
- Al activar se guarda `activadaEn`: una franja anterior no se lanza al encender.
- Si la franja llega con la tanda anterior abierta, **se salta** y queda en la bitácora. No se encola: encolar haría
  que dos tandas seguidas compitieran por los mismos temas. El botón «nueva tanda» responde 409 en ese caso.

## D68-ED · El token de ViralHunt no sale del servidor, ni siquiera sus últimos caracteres (Claude, editorial, ronda 1)
- Vive en `oficinas/<id>/viralhunt.secreto.json` (`*.secreto.json` ya está en `.gitignore`). La API devuelve solo
  `{ configurado }`. Los Bots muestran una pista de cuatro caracteres; aquí no hace falta y el brief dice «ni en la UI».
- Los agentes reciben **resultados** (`investigacion/viralhunt.json`), nunca el token. La prueba recorre todo el disco de
  datos (briefs, `turno.md`, `chat.json`, `actividad.jsonl`, bitácora, propuestas, gusto) y todas las respuestas de la
  API, más `index.html` y `app.js`, buscando el token.
- **Base fija:** `https://viralhunt.io/tool/api/v1/`. `OFFICEMATRIX_VIRALHUNT_URL` solo admite
  `http://127.0.0.1:4400-4499`. Una prueba mal configurada no puede llamar a la API real ni a 4321-4323.
- Los errores de ViralHunt llegan al panel como 502 con el motivo en palabras (`explain`). Un 401 de ViralHunt no es
  un 401 de OfficeMatrix.

## D69-ED · Aprobar dice la verdad sobre dónde quedó el post (Claude, editorial, ronda 1)
- `borrador` → `draft: true`. `agendar` → `scheduled_at` (la hora sugerida, ≥ 15 min en el futuro; si no, 409 y pedir
  cambios en «hora»).
- Antes de crear se lee `targets`. Con `must_draft` (token de escritor) o `stage: review` en la respuesta, la bandeja
  dice `revision` («en Review, falta que un owner o admin lo autorice»), no «agendado».
- La imagen se sube con `schedule.php?action=upload` (multipart con `FormData` de Node, cero dependencias). La fuente
  va en `author_notes`: un enlace en el cuerpo corta el alcance (skill §5c). El copy de cada red distinto del principal
  va en `overrides`.
- Un doble clic no crea dos posts: `aprobando` bloquea la propuesta mientras se envía, y después ya no está pendiente.

## D70-ED · El gusto: decisiones acotadas y un resumen que se reescribe (Claude, editorial, ronda 1)
- Cada decisión se apunta en `editorial/decisiones.jsonl`, con un tope de 200. `resumenGusto` reescribe
  `memoria/gusto-editorial.md` por completo (con historial de versiones), con un tope de unos 4 KB: hooks aprobados,
  aspectos pedidos con su conteo, notas recientes, rechazos con motivo y temas a evitar.
- Entra en el brief de la tanda (sección «Gusto del usuario») y, por estar en la memoria de la oficina, también en la
  copia `memoria-oficina/` de cada misión.
- Rechazar exige motivo. Pedir cambios exige una nota o una casilla: sin eso, el equipo no tiene qué aprender.
- Copia literal: si el copy es igual a `fuente.texto` o comparte 12 palabras seguidas con él, la propuesta queda
  `descartada` y no se puede aprobar. Los agentes deben dejar el texto original en `fuente.texto` para que se pueda
  comparar.

## D71-ED · Bandeja por oficina con decisiones explícitas y token de entrada solamente (Codex, ronda 1)
- `public/editorial.js` concentra la bandeja y los diálogos sin añadir frameworks. La pestaña Propuestas es independiente
  de la misión abierta: las propuestas pertenecen a la oficina. SSE `editorial-updated` recarga la lista.
- Aprobar abre una confirmación con el destino; cambios permite nota y casillas; rechazo exige motivo. Estados no pendientes
  no ofrecen decisiones. El resultado diferencia borrador, Review pendiente de owner/admin y agendado.
- Configuración desde Propuestas o desde el engranaje de oficina. El token solo se envía al guardarlo y se vacía al enviar
  o cerrar; nunca se rellena. Probar distingue conexión parcial cuando fallan los destinos.
- Oficina, época y secuencia impiden pintar respuestas anteriores (también A → B → A). Los diálogos se cierran al cambiar
  de oficina y una carga tardía no los vuelve a abrir. Pruebas VM ejercitan estas carreras y el escape de contenido.
- Demo repetible con agentes falsos en 4400 y ViralHunt falso 44xx, imágenes PNG tipográficas reproducibles, datos aislados
  dentro de `.demo-editorial/`. Sin servicios reales ni dependencias nuevas.
- Evidencia de Codex: focalizadas 19/19; suite 158/159 por CORTE_NO_CONFIRMADO de S1F en su ejecutor. Sus capturas
  no llegaron (DevTools 1006). La revalidación está en D72-ED.

## D72-ED · La bandeja se fotografía cuando ya hay tarjetas; el corte S1F pasa en este ejecutor (Grok, ronda 1)
- Las capturas de la bandeja (internas, no se publican) enseñaban la pestaña Propuestas vacía: el botón ya estaba activo y el fetch
  de la lista aún no había pintado. No había fallo de maquetación. La sonda espera a `.ed-card` y entonces captura.
- A 1440×1000 se ven las tarjetas con imagen y hook, sin scroll horizontal. A 390×1000 una tarjeta muestra copy, fuente,
  hora y los tres botones a 44 px, sin que el compositor los tape. Aprobar, cambios, rechazo y configurar caben; el
  token sigue siendo un password que llega vacío.
- `npm test`: 159/159 en 118 s. S1F mata al hijo y al nieto en 3,4 s. No se relaja la prueba ni se llama a ViralHunt real.
- `edit_log` y `stats` para el gusto siguen opcionales y sin hacer.

## D73-I18N · Inglés por defecto con un diccionario propio por idioma (Claude, ronda 1)
- Un archivo por idioma, `public/i18n/en.json` y `public/i18n/es.json`, con claves planas (`ui.tab.reports`) y huecos
  `{nombre}`. La interfaz los carga con `public/i18n.js` y el servidor los lee con `lib/i18n.js`: hay una sola fuente
  por idioma y no se añaden dependencias. Sin traducción se usa el inglés y, si falta la clave, la clave; la prueba de
  paridad impide que eso se publique.
- El idioma se elige así: primero `localStorage['om-lang']`, después `preferencias.json` (`GET/PUT /api/preferencias`)
  y, si no hay ninguno, `en`. `OFFICEMATRIX_LANG` manda en el servidor. Cambiar de idioma no recarga: `I18N.apply`
  traduce el HTML (`data-i18n`, `-html`, `-title`, `-placeholder`, `-aria-label`, `-hover`) y el evento `om-lang`
  vuelve a pintar lo que pinta el código.
- El selector EN | ES está en la barra superior y en «Primeros pasos → ⚙ Configuración». A ≤480 px, «Primeros pasos»
  queda en «?», AVISOS y la vista quedan en su icono y el logo se oculta. Así cabe a 390 px con objetivos de 44 px de
  alto. El texto sigue disponible para lectores de pantalla y en el tooltip.
- El protocolo de los agentes es bilingüe: SCORE/VERDICT: APPROVED|CHANGES/DONE: YES|NO/OBJECTIONS/REPLIES (con
  RESOLVED, REJECTED, MAINTAINED, WITHDRAWN y AGREED) o el bloque en español de siempre. Por dentro se guardan los
  valores de siempre (`APROBADO`, `resuelta`…), así que las misiones antiguas siguen leyéndose.
- Los diagnósticos de `lib/failure.js` salen en el idioma elegido. Su `kind` no cambia y es lo que debe comparar el
  código, no la etiqueta. `lib/i18n.detectLang` decide en qué idioma van los briefs: inglés salvo que el pedido venga
  en otro idioma.
- `tests/i18n.test.js` comprueba que las claves y los huecos coinciden en los dos idiomas, que el valor por defecto es
  `en` (cliente, servidor y `<html lang>`) y que la preferencia persiste. También que toda clave usada en el código
  existe y que `index.html` no tiene textos ni atributos sin clave (`translate="no"` para marcas y endónimos). En
  `npm test` sin `OFFICEMATRIX_HOME` se ignora el idioma guardado en la carpeta del usuario.
