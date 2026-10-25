# Modos de trabajo — especificación

Estado: **implementado** (22/23-oct-2026), sobre la versión promovida desde
`proyectos/2026-10-22-officematrix-se-mejora-a-si-misma`. Código: `lib/workflows.js` (lógica pura), `runParallelCycle` en
`server.js`, `buildParallelBrief` en `lib/brief.js`, gráficas en `public/charts.js`. Pruebas: `tests/workflows.test.js`.

Diferencias con el plan original:
- Delphi copia a `final/` el borrador con mejor media de la última ronda (así siempre hay un único resultado).
- En Consejo la aprobación del final es en paralelo y **sin editar**: quien pide cambios lo dice como objeción y el presidente
  los aplica en la ronda siguiente (dos IAs editando `final/` a la vez se pisarían).
- Los colores de Claude y Grok se ajustaron (`#d0704f`, `#c062d6`) para pasar el validador de paleta en las gráficas
  (el gris de Grok no se distinguía).

## Pedido del usuario

> Cuando se cree la tarea, dar la opción de escoger qué tipo de trabajo se hace,
> con una explicación para que quien no sabe entienda qué es cada una.

Hoy la oficina solo trabaja en relevo con orden fijo. Hay tareas (investigación,
contenido, blogs de ciencia y tecnología, noticias, hooks, guiones) donde conviene que
las IAs empiecen a la vez y luego se revisen entre todas.

## Lo que ve el usuario al crear una tarea

Un selector de tarjetas (una por modo) con icono, nombre, explicación sencilla,
"ideal para" y "cuidado con". Debajo, las opciones propias del modo elegido.
La oficina puede **sugerir** un modo según el texto de la tarea (palabras como
"código", "app", "bug" → Relevo; "investiga", "artículo", "post", "noticia", "hooks"
→ Delphi o Consejo), pero el usuario decide.

### 🔁 Relevo — "una cadena de revisión"

**Explicación para el usuario:**
Las IAs trabajan una detrás de otra, como en una carrera de relevos. La primera hace
el trabajo, se lo pasa a la segunda, que lo revisa y mejora, y así sucesivamente.
Dan vueltas hasta que todas dicen "aprobado".

- **Ideal para:** programación y todo lo que sea un solo proyecto que todas tocan
  (una app, un documento grande, una web).
- **Cuidado con:** la primera IA marca el rumbo; las demás tienden a seguirla.
- **Opciones:** quién empieza y en qué orden (arrastrar para ordenar), rondas.

### ⚡ Paralelo + rotación (método Delphi) — "todos opinan, luego se corrigen entre sí"

**Explicación para el usuario:**
Las 4 IAs empiezan **al mismo tiempo**, cada una por su cuenta y sin ver a las demás,
así ninguna influye en otra. Luego se intercambian los trabajos en rotación: cada una
revisa y mejora el de otra **sin saber de quién es**, y le pone nota. En 3 rondas cada
trabajo pasó por las 4 IAs. Se repite hasta que todos los trabajos sacan buena nota.
Es como un grupo de expertos que primero piensan solos y luego se corrigen.

- **Ideal para:** investigación, verificar datos, noticias, artículos de ciencia,
  comparar ideas distintas.
- **Cuidado con:** termina con varias versiones buenas (no una sola), y gasta más
  cupo de las suscripciones porque trabajan todas a la vez.
- **Opciones:** rondas de rotación, máximo de IAs trabajando a la vez.

### 🏛️ Consejo — "cada uno propone, se califican, un presidente redacta el final"

**Explicación para el usuario:**
Las 4 IAs hacen su propuesta **al mismo tiempo**. Después cada una lee las propuestas
de las otras (sin saber de quién son) y las califica. Al final, una IA que tú eliges
como **presidente** junta lo mejor de todas en una versión final, y las demás la
aprueban o piden cambios.

- **Ideal para:** posts, guiones, hooks virales, títulos, artículos de blog: cuando
  quieres **un solo resultado** con lo mejor de cada IA.
- **Cuidado con:** el presidente tiene la última palabra; elige al que mejor escriba
  para ese tipo de tarea.
- **Opciones:** presidente, rondas de aprobación del final, máximo a la vez.

## Pedidos extra del usuario (mismo día)

- Ver en la terminal **en qué está trabajando** cada agente (resumen claro y actual, no solo el log crudo).
- **Gráficas más bonitas** (notas por ronda, tiempos, quién revisó a quién).
- **Hora actual** y **cuánto tiempo lleva** la tarea (y el turno actual), visibles siempre.
- **Mejorar el diseño** general junto con los modos nuevos.
- Orquestar todo en cuanto termine el ciclo actual, sin esperar al usuario.

## Diseño técnico

- `chat.json` guarda `mode: "relay" | "delphi" | "council"` y sus opciones
  (`order`, `chair`, `maxParallel`, `rounds`). Tareas viejas sin `mode` = `relay`.
- **Carpetas:** en Delphi y Consejo cada IA escribe solo en `borradores/<agente>/`;
  el final va en `final/`. Así no se pisan los archivos.
- **Anonimato:** en las revisiones los borradores se presentan como "Borrador A/B/C/D"
  (mapa guardado en `.office/`, no visible para los agentes).
- **Rotación:** en la ronda k el agente i revisa el borrador del agente (i + k) mod n,
  con k = 1..n-1. Con 4 agentes: 3 rondas y cada borrador pasa por todos.
- **Convergencia:** Delphi termina cuando todos los borradores tienen nota ≥ minScore;
  Consejo cuando todos aprueban el final con nota ≥ minScore; ambos con tope de rondas.
- **Paralelo:** `Promise.all` limitado por `maxParallel` (por defecto 2: la PC del
  usuario se quedó sin memoria con varias CLIs). Un agente que falla (sin saldo, 402,
  cuelgue) queda marcado y el resto sigue.
- **UI:** los escritorios activos trabajan a la vez, cada uno con su burbuja; la
  terminal en vivo tiene pestañas por agente; un tablero "quién revisó a quién" con
  notas (matriz 4×4) para Delphi y Consejo.
- **Reportes:** `.office/reportes/ronda-R-<agente>-<fase>.md` igual que ahora.
- Sin dependencias nuevas; pruebas en `node --test` para la rotación, el anonimato
  y la convergencia.
