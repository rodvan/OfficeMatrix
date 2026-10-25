# OfficeMatrix para agentes

Guía para un agente externo (por ejemplo, tu propio asistente) que trabaja con OfficeMatrix usando una **llave de oficina**.

## Qué es OfficeMatrix
Es una oficina de IAs que corre en el PC del usuario. Varias IAs (Claude, Codex/ChatGPT, Gemini y Grok, por su CLI y con
la suscripción del usuario) trabajan juntas sobre una misma carpeta:
- redactan;
- se revisan entre ellas y se ponen nota;
- discuten objeciones;
- no cierran hasta que todas aprueban o se agotan las rondas.

Cada **oficina** es una simulación aislada, con sus propias misiones, su propio cerebro (memoria) y su propio equipo.
**Tu llave solo abre tu oficina.** No ves nada de otras oficinas ni del "edificio", y ellas no ven nada tuyo.

## Cuándo usarla (y cuándo no)
Úsala cuando haga falta **investigación sólida y profunda** o un entregable que se beneficie de varias miradas
independientes. Por ejemplo:
- comparar proveedores o cotizaciones;
- analizar un contrato o un PDF largo;
- un informe con fuentes;
- un plan;
- verificar datos antes de decidir.

**No** la uses para preguntas rápidas: una misión tarda de 30 minutos a varias horas y consume cupo de varias suscripciones.
Si puedes responder tú en pocos minutos, hazlo tú.

## Modos (elige con `--modo`)
| Modo | Cómo trabajan | Para |
|---|---|---|
| `delphi` (por defecto) | Cada IA hace su propia versión sin ver las demás y luego rotan revisando las de los otros. | Investigación, verificación, análisis: evita el sesgo de una sola IA. |
| `consejo` | Todas proponen, se evalúan y un presidente une lo mejor en una versión final que las demás votan. | Estrategia, planes, decisiones abiertas. Deja un resultado único en `final/`. |
| `relevo` | Una tras otra sobre el mismo trabajo. | Código, documentos que se van puliendo por pasos. |

## Cómo se usa
Copia `om.js` a tu máquina (un solo archivo, Node 18 o superior) y define:
```
OM_URL=http://<ip-del-pc-de-officematrix>:4322     (acceso por red; en el mismo PC: http://localhost:4321)
OM_LLAVE=om_<oficina>_…                              (la te da el usuario; trátala como una contraseña)
```

Comandos:
```
node om.js oficina                                    # tu oficina y qué IAs pueden trabajar en ella
node om.js nueva "pedido detallado" --modo delphi --adjunto cotizacion.pdf --adjunto requisitos.xlsx
node om.js estado <id>                                # fase, quién trabaja y en qué está pensando
node om.js esperar <id>                               # espera al final (consulta cada 30 s)
node om.js resultado <id> --bajar ./resultado         # qué entregaron, dónde, y descarga los archivos
node om.js intervenir <id> "prioriza el costo total a 3 años"
```

## Cómo escribir un buen pedido
- **Qué decisión o entregable** necesitas, **para quién** y **en qué formato**, por ejemplo:
  "informe HTML en `final/` con tabla comparativa y recomendación".
- **Contexto que solo tú tienes**: empresa, restricciones, criterios y plazos. Las IAs no ven tus carpetas: lo que
  necesiten leer va como **adjunto** (PDF, Word, Excel, imágenes). De cada PDF se extrae el texto para todas.
- **Qué evitar** y cómo se verifica: "cada cifra con su fuente", "no inventes precios".

## Reglas
- **Confidencialidad.** Lo que adjuntas lo leen las IAs del equipo de la oficina; el usuario decidió cuáles son. No adjuntes
  más de lo necesario, y nunca contraseñas, llaves ni datos personales que no hagan falta.
- **No es asesoría profesional.** Un análisis legal, fiscal o financiero de la oficina es material de trabajo para una persona
  con cédula, no una decisión.
- **Una misión a la vez por tema.** No lances la misma pregunta dos veces. Si ya hay una en curso, usa `intervenir`.
- **Aceptar un entregable detenido** (meseta, retroceso o tope) lo hace el usuario en el panel. La llave no puede.
- **Informa al usuario** del id de la misión que lanzaste y de dónde quedó el resultado.
