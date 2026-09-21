---
description: Importar el contexto de Mission Control para el proyecto del cwd en ~5 s — un comando que sincroniza git (pull --ff-only si es seguro) e imprime un digest compacto (CONTEXT.md vivo, crumbs, revisiones, deploy, pulso git).
---

# Importar contexto desde Mission Control

`/import-mc` significa "ponme al día en esta máquina". Toda la mecánica la hace `agent/import.js` en una llamada; tú presentas el digest y propones el siguiente paso. No uses `curl` ni las tools `mc_*` salvo que el usuario pida algo que el digest no trae.

```bash
MC_DIR="${MC_DIR:-$HOME/Projects/Missioncontrol}"
node --env-file="$MC_DIR/agent/.env.local" "$MC_DIR/agent/import.js" --dir "$PWD"
```

Opciones: `--full` (secciones enteras, arquitectura, más crumbs y el último briefing) cuando el usuario quiera todo el detalle; `--no-pull` para no tocar git; `--project <id>` si la detección fue ambigua.

Qué hace el script:
- **Detecta el proyecto** por repoUrl (o slug de la carpeta). **Exit 2** = ambiguo: enseña los candidatos, pregunta el id y repite con `--project <id>`. Si responde `nuevo`, crea el proyecto con `mc_create_project` (nombre, descripción, color, stack, URLs/ramas conocidas) y repite.
- **Git**: `fetch`; si está limpio, sin commits locales y por detrás del remoto, hace `pull --ff-only` y dice qué trajo. En cualquier otro caso **no toca nada** y lo avisa en la línea `🔧 Git` (divergencia, archivos sin commit, commits sin push de la máquina anterior, rama que no es main).
- **Digest** (≈3 KB): metadatos, pulso git de este repo por máquina, snapshot y secciones vivas del CONTEXT.md (qué es, últimas líneas de "funciona", "pendiente", decisiones), últimos 5 crumbs con resumen, revisiones pendientes con fecha, deploy y subrayados.

## Presentar

Reproduce el digest **tal cual** (ya viene compacto; no lo reescribas ni lo alargues). Si la línea `🔧 Git` lleva ⚠️ o 🔴, explícala en una frase y, si requiere acción (stash+pull, merge, push), pregunta antes de hacer nada. Si el repo tiene `docs/CONTEXT.md` local y el usuario quiere leer la arquitectura completa, léelo de ahí (es la copia de MC) en vez de pedirlo a la API.

Cierra con una línea: "¿Seguimos con <lo más urgente del pendiente o la revisión vencida más antigua> o prefieres otra cosa?". Sin tareas inventadas: si no hay nada claro, "¿qué quieres hacer esta sesión?".
