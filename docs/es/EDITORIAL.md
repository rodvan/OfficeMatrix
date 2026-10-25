# Editorial continua: diseño y contrato (ronda de construcción, 24-oct-2026)

Las decisiones son D66-ED a D72-ED en [`DECISIONES.md`](../DECISIONES.md). Aquí está lo que existe, la API que usa la
bandeja y lo que queda.

## Piezas
| Pieza | Archivo | Qué hace |
|---|---|---|
| Regla, horario, propuestas, gusto | `lib/editorial.js` | `normalizarRegla`, `tandaDebida` (pura, reloj inyectado), `cosechar`, `decidir`, `resumenGusto`, `briefTanda`, `briefCambios` |
| Conector ViralHunt | `lib/viralhunt.js` | Token por oficina (`viralhunt.secreto.json`), `investigar` (trending + best-time), `subir`, `publicar` (borrador o agendado, diciendo dónde quedó) |
| Servidor | `server.js` (bloque «Editorial continua») | `lanzarTanda`, `relojEditorial` (cada 60 s), `editorialAlCerrar` (cosecha al cerrar la misión), `pedirCambios`, `aprobarPropuesta`, `rechazarPropuesta`, rutas |
| ViralHunt simulado | `tests/helpers/viralhunt-falso.js` | API v1 mínima en el primer puerto libre de 4410-4499; apunta cada petición |
| Agente falso | `tests/helpers/agente-editorial.js` | Deja `propuestas/1..N/` (json, imagen, investigación) o aplica cambios (`hook … (v2)`) |
| Pruebas | `tests/editorial.test.js` | Horario, regla, copia literal, gusto, base del conector, punta a punta y búsqueda del token |

## Flujo
1. **Tanda.** El reloj (o el botón) llama a `lanzarTanda`. Si hay token, el servidor pide tendencias y mejor hora a
   ViralHunt y deja los **resultados** en `<misión>/investigacion/viralhunt.json`. La misión es normal: modo `auto`,
   tope 2 rondas, modo de trabajo de la regla (Consejo o Relevo) y el equipo con sus roles. Su pedido es `briefTanda`:
   marca, equipo, forma del entregable, reglas de contenido y el **gusto** actual.
2. **Entrega.** Los agentes dejan `propuestas/<n>/propuesta.json`, `imagen*.png|jpg|webp` e `investigacion.md`.
3. **Cosecha.** Al cerrar la misión, `editorialAlCerrar` copia cada carpeta a
   `oficinas/<id>/editorial/propuestas/<fecha>-<n>/`. Si falta tema, hook, copy o la URL de la fuente (cuando la regla
   la exige), o si el copy copia la fuente (igual, o 12 palabras seguidas), queda `descartada` con su motivo.
4. **Bandeja.** El usuario aprueba, pide cambios o rechaza. Cada decisión reescribe `memoria/gusto-editorial.md`.
5. **Cambios.** Un mini ciclo (Relevo, 1 ronda, los 2 primeros del equipo: de 1 a 2 turnos) recibe la propuesta en
   `propuestas/1/` y la nota como directiva. Al cerrar, la nueva versión reemplaza a la anterior (mismo id, `version+1`).
6. **Aprobar.** El servidor lee `targets`, sube la imagen (`schedule.php?action=upload`) y crea el post
   (`schedule.php?action=create`): `draft: true` si el destino es `borrador`, `scheduled_at` si es `agendar`. La fuente
   va en `author_notes`, nunca en el cuerpo. Guarda `viralhunt.{id, url, donde}`. `donde` es `borrador`, `revision`
   (un token de escritor que agenda cae en Review) o `agendado`.

## API para la bandeja (solo desde el panel; una llave de agente recibe 403)
| Método y ruta | Cuerpo | Respuesta |
|---|---|---|
| `GET /api/oficinas/:id/editorial` | | `{ configurada, regla, estado, abierta, proxima, viralhunt: { configurado }, opciones }` |
| `PUT /api/oficinas/:id/editorial` | campos de la regla (parciales) | igual que el GET; 400 con `errores[]` |
| `POST /api/oficinas/:id/editorial/tanda` | `{}` | 201 `{ id, titulo }`; 409 si hay una abierta o falta la regla |
| `GET /api/oficinas/:id/editorial/propuestas` | | lista, la más nueva primero |
| `GET /api/oficinas/:id/editorial/propuestas/:pid` | | una propuesta |
| `GET /api/oficinas/:id/editorial/propuestas/:pid/archivo/:nombre` | | la imagen o `investigacion.md` |
| `POST …/propuestas/:pid/aprobar` | `{ nota?, imagen?: índice }` | la propuesta `aprobada` con `viralhunt`; 409 sin token o si no está pendiente; 502 con el motivo de ViralHunt |
| `POST …/propuestas/:pid/cambios` | `{ nota?, casillas?: ['imagen','texto','hook','tema','hora'] }` | 202 `{ propuesta, mision }` |
| `POST …/propuestas/:pid/rechazar` | `{ nota }` (obligatoria) | la propuesta `rechazada` |
| `GET /api/oficinas/:id/editorial/gusto` | | `{ contenido }` |
| `GET` · `PUT` · `DELETE /api/oficinas/:id/viralhunt` | `{ token }` en el PUT | `{ configurado }`. El token nunca vuelve |
| `POST /api/oficinas/:id/viralhunt/probar` | `{}` | plan, permisos, proyectos y cuentas |

Evento SSE: `editorial-updated` con `oficina`.

Estados de una propuesta: `pendiente` → `aprobada` | `rechazada` | `en-cambios` (→ `pendiente`) ; `descartada` la pone el servidor.

## Bandeja y demo (Codex, ronda 1)
- `public/editorial.js`: tarjetas, estados, confirmación de aprobación, nota y casillas de cambios, rechazo con motivo.
  Escapa contenido y admite solo enlaces HTTP(S). Tras aprobar informa borrador, Review o agendado.
- Configuración desde la bandeja o ⚙ de oficina: todos los campos de la regla, dos horas, roles y destino.
  Campo password vacío, Guardar token, Probar conexión y Desconectar. Las respuestas tardías se descartan por época.
- `tests/helpers/editorial-demo.js` arranca en 4400 con datos en `.demo-editorial/`, agentes falsos y API simulada.
  `tests/helpers/editorial-images.ps1` reproduce tres PNG tipográficos con el hook, sin dependencias nuevas.
- Validada a 1440 y 390 px con la bandeja llena de tarjetas (Grok, ronda 1; ver D72-ED).
- Opcional del brief: leer `edit_log` y `stats` de ViralHunt para el gusto. No está hecho.
