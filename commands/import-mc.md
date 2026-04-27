---
description: Importar contexto de Mission Control para el proyecto del cwd (CONTEXT.md, crumbs recientes, subrayados, último briefing).
---

# Importar contexto desde Mission Control

Usa las tools nativas `mc_*` del MCP server para cargar el estado guardado del proyecto de MC que corresponde a este cwd. Cero `curl`s. Cero suposiciones sobre qué proyecto es.

---

## 0 · Detectar el proyecto (regla estricta — preguntar ante cualquier duda)

1. Ejecuta `git remote get-url origin` en el cwd. Si falla (no es repo git), `remoteUrl = null`.
2. Llama a `mc_list_projects` con `{ minimal: true }` (omite `lastCrumb` de cada proyecto — ~10× menos payload, suficiente para detectar y para sacar URLs/ramas del proyecto matcheado).
3. Normaliza `remoteUrl` y cada `repoUrl` de MC: minúsculas, sin `.git`, sin `http(s)://`, sin `www.`. Ej.: `https://github.com/unzuetat/missioncontrol.git` → `github.com/unzuetat/missioncontrol`.

**Auto-usar un proyecto SIN preguntar — solo si se cumplen LAS DOS condiciones:**
- Exactamente 1 proyecto en MC tiene `repoUrl` que normaliza igual a `remoteUrl`.
- Ningún otro proyecto en MC tiene `name` o `id` parecido al del match — entiende "parecido" como: substring del otro, o distancia Levenshtein ≤ 2 respecto al `name` del match o al basename del cwd.

**En cualquier otro caso, PREGUNTAR al usuario.** Casos que siempre requieren pregunta:
- 0 matches por repoUrl.
- >1 match por repoUrl (duplicado real en MC).
- 1 match por repoUrl pero hay otro proyecto con nombre/id parecido (duplicado latente).
- No hay remoto git.

**Formato de la pregunta cuando hay duda:**

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

Los metadatos del proyecto (URLs, ramas, color, stack, descripción) ya están en la respuesta de `mc_list_projects({ minimal: true })` del paso 0 — reutilízalos.

Llama en paralelo a:

- `mc_get_crumbs` con `{ projectId, limit: 3, summary: true }` — los últimos 3 títulos sin body, para el bloque "Últimos 3 crumbs" del resumen.
- `mc_get_file` con `name="CONTEXT.md"` — si existe.
- `mc_get_file` con `name="DEPLOY_STATUS.md"` — si existe (ignora el error si no hay).
- `mc_get_highlights` con ese `projectId` — subrayados pendientes.
- `mc_get_briefing_history` con `kind="project"` y ese `projectId` — el último briefing disponible.

NO uses `mc_get_project` — su payload incluye crumbs completos + files completos y satura el contexto. Las llamadas granulares anteriores son ~10× más ligeras juntas.

Si alguno no existe, ignora silenciosamente — no todos los proyectos tienen todos los archivos.

---

## 2 · Presentar el resumen de arranque

Devuelve al usuario un resumen estructurado y **corto** (máximo 15-20 líneas). Formato:

```
📍 Proyecto: <name> (<id>)
   Repo: <repoUrl>
   Test: <testUrl> (<testBranch>)  ·  Prod: <prodUrl> (<prodBranch>)

🧭 Estado (de CONTEXT.md)
   <resumen en 2-3 frases de "qué es" + "estado actual — funciona" + "pendiente">

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
