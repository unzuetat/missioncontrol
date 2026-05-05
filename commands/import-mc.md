---
description: Importar contexto de Mission Control para el proyecto del cwd (CONTEXT.md, crumbs recientes, subrayados, último briefing).
---

# Importar contexto desde Mission Control

Usa las tools nativas `mc_*` del MCP server para cargar el estado guardado del proyecto de MC que corresponde a este cwd. Cero `curl`s. Cero suposiciones sobre qué proyecto es.

**Diseño de tokens:** carga ligera por defecto. Solo trae al contexto las secciones de CONTEXT.md que tienen impacto en runtime (Estado actual, Pendiente, URLs y Decisiones importantes — esta última como red de seguridad para no proponer cosas que contradicen tradeoffs ya tomados). Tech stack, arquitectura, despliegues y última actualización quedan disponibles a un `mc_get_file` de distancia si la sesión las necesita.

---

## 0 · Detectar el proyecto (regla estricta — preguntar ante cualquier duda)

1. Ejecuta `git remote get-url origin` en el cwd. Si falla (no es repo git), `remoteUrl = null`.
2. Llama a `mc_list_projects` con `{ bare: true, includeArchived: false }`. Devuelve solo `{id, name, repoUrl, status}` por proyecto y excluye archivados — ~80 tokens/proyecto.
3. Normaliza `remoteUrl` y cada `repoUrl` de MC: minúsculas, sin `.git`, sin `http(s)://`, sin `www.`. Ej.: `https://github.com/unzuetat/missioncontrol.git` → `github.com/unzuetat/missioncontrol`.

**Auto-usar un proyecto SIN preguntar — solo si se cumplen LAS DOS condiciones:**
- Exactamente 1 proyecto (entre los activos) tiene `repoUrl` que normaliza igual a `remoteUrl`.
- Ningún otro proyecto activo tiene `name` o `id` parecido al del match — entiende "parecido" como: substring del otro, o distancia Levenshtein ≤ 2 respecto al `name` del match o al basename del cwd.

### Fallback automático en archivados

Si **0 matches** en la lista activa, vuelve a llamar `mc_list_projects` con `{ bare: true, includeArchived: true }` y busca match por `repoUrl` solo entre los archivados. Si encuentra exactamente uno:

```
Este repo coincide con un proyecto archivado en MC:
  - <id>: <name> (status: <status>)

¿Lo desarchivo y sigo, o abortamos?
  - 'sí' / 'desarchivar' → llamo mc_update_project({projectId, status: 'desarrollo'}) y sigo con ese projectId.
  - 'no' / 'abortar'     → no hago nada y termino aquí.
```

Si tras incluir archivados sigue habiendo 0 matches o >1 → trata como duda normal y pregunta al usuario.

### Pregunta normal cuando hay duda (>1 match, no remoto, etc.)

```
No tengo claro qué proyecto de MC corresponde a esta carpeta.
  cwd: <path>
  git remote: <url o 'sin remoto'>

Candidatos:
  - <id>: <name> (repoUrl: <url>)
  - <id>: <name> (repoUrl: <url>)

¿Cuál uso? Responde con el id, o 'nuevo' si no existe y quieres crearlo.
```

Si responde un id → sigue al paso 1 con ese `projectId`.
Si responde `'nuevo'` → pregunta nombre, descripción breve, color hex, stack, y llama `mc_create_project`. Luego sigue con el `projectId` devuelto.
Si responde `'ninguno'` o equivalente → aborta el import, no sigas.

---

## 1 · Cargar contexto

Tras el match, llama en paralelo a:

- `mc_get_project_meta` con `{ projectId }` — URLs, ramas, color, stack, descripción, status. Lo necesitas para el bloque de cabecera del resumen.
- `mc_get_crumbs` con `{ projectId, limit: 3, summary: true }` — los últimos 3 títulos sin body.
- `mc_get_file` con `{ projectId, name: "CONTEXT.md", sections: ["Estado actual — funciona", "Estado actual — pendiente", "URLs", "Decisiones importantes"] }` — secciones vivas + decisiones (red de seguridad arquitectónica). La respuesta incluye `availableSections` con todos los headers presentes; consérvalo mentalmente por si la sesión necesita pedir otra sección luego.
- `mc_get_file` con `{ projectId, name: "DEPLOY_STATUS.md" }` — completo (es corto). Ignora el error si no existe.
- `mc_get_highlights` con `{ projectId }` — subrayados pendientes.
- `mc_get_briefing_history` con `{ kind: "project", projectId }` — el último briefing disponible.

NO uses `mc_get_project` — su payload incluye crumbs completos + files completos y satura el contexto.

NO pidas el CONTEXT.md sin `sections` salvo que el usuario lo pida explícitamente (arquitectura, tech stack, historia completa). Si más adelante en la sesión hace falta una de esas secciones, llama a `mc_get_file` con la sección concreta — están en `availableSections`.

Si alguno no existe, ignora silenciosamente — no todos los proyectos tienen todos los archivos.

---

## 2 · Presentar el resumen de arranque

Devuelve al usuario un resumen estructurado y **corto** (máximo 15-20 líneas). Formato:

```
📍 Proyecto: <name> (<id>)
   Repo: <repoUrl>
   Test: <testUrl> (<testBranch>)  ·  Prod: <prodUrl> (<prodBranch>)

🧭 Estado (de CONTEXT.md)
   <resumen en 2-3 frases mezclando "Estado actual — funciona" y "Estado actual — pendiente">

📝 Últimos 3 crumbs
   · <fecha> — <title> [<source>]
   · <fecha> — <title> [<source>]
   · <fecha> — <title> [<source>]

📌 Subrayados pendientes (<N>)
   · <texto del subrayado más reciente>
   · <segundo>
   · ... (N-2 más, di cuántos hay en total si son muchos)

🚀 Despliegue (de DEPLOY_STATUS.md, si existe)
   <1-2 frases sobre qué hay en test sin llegar a prod>

🧠 Último briefing: <kind>/<flavor> del <fecha>
   <1 frase con la conclusión/dirección principal>
```

Omite bloques que no apliquen (si no hay DEPLOY_STATUS.md, omite ese bloque; si no hay briefings aún, omite ese).

---

## 3 · Cerrar con siguiente paso sugerido

Tras el resumen, una línea final del tipo:

> Listo. ¿Seguimos con <lo más urgente del pendiente> o prefieres otra cosa?

Propón el siguiente paso basándote en lo que leíste — no inventes tareas. Si no hay nada claro pendiente, di "¿qué quieres hacer esta sesión?".
