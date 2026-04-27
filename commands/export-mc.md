---
description: Exportar la sesión actual a Mission Control (proyecto, crumbs, CONTEXT.md, DEPLOY_STATUS.md).
---

# Exportar sesión a Mission Control

Usa las herramientas nativas `mc_*` del MCP server de Mission Control. NO uses `curl` ni edites listas hardcodeadas de proyectos — la fuente de verdad es siempre `mc_list_projects`.

Cinco pasos en este orden: **detectar proyecto** (paso 0, estricto) → actualizar metadatos si aplica → crumbs → CONTEXT.md → DEPLOY_STATUS.md.

---

## 0 · Detectar el proyecto (regla estricta — preguntar ante cualquier duda)

1. Ejecuta `git remote get-url origin` en el cwd. Si falla (no es repo git), `remoteUrl = null`.
2. Llama a `mc_list_projects` con `{ minimal: true }` (omite `lastCrumb` de cada proyecto y deja la respuesta ~10× más pequeña — para la detección no hace falta más).
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

Si responde un id → continúa con ese `projectId`.
Si responde `'nuevo'` → pregunta nombre, descripción breve, color hex, stack, y llama `mc_create_project` con esos datos + URLs/ramas que conozcas de la sesión. Luego continúa con el `projectId` devuelto.
Si responde `'ninguno'` o equivalente → aborta el export.

---

## 1 · Actualizar metadatos del proyecto (si aplica)

Con el `projectId` ya confirmado, si observas que sus URLs/ramas están desactualizadas respecto a lo que estás viendo en esta sesión (p.ej. nueva rama de test, dominio de prod cambiado), llama a `mc_update_project` pasando **solo los campos que cambian**. Si todo está al día, omite este paso.

---

## 2 · Registrar crumbs de la sesión

Identifica los **bloques de trabajo significativos** de esta conversación (no uno por commit — uno por unidad de decisión o resultado). Para cada uno compón:

- `title` — máximo ~10 palabras, descriptivo.
- `body` — qué se hizo, qué se decidió, qué queda pendiente. Debe dar contexto suficiente para retomar dentro de un mes sin releer la conversación.
- `source` — `"claude-code"` (aquí) o `"claude-web"`.
- `timestamp` — ISO 8601. Si no conoces la hora exacta usa mediodía (`12:00:00`) del día actual.

Llama a `mc_add_crumbs` con todos los crumbs en un solo batch.

---

## 3 · CONTEXT.md — snapshot del proyecto

Genera un CONTEXT.md con estas secciones:

- **Qué es** (1-2 frases)
- **Tech stack**
- **Arquitectura** (estructura de archivos clave)
- **Estado actual — funciona**
- **Estado actual — pendiente** (próximos pasos concretos)
- **Decisiones importantes** (tradeoffs tomados, convenciones)
- **Despliegues** (tabla: entorno / URL / rama para test y prod)
- **URLs** (repo, recursos externos)

Si ya hay un CONTEXT.md previo (mira con `mc_get_file` si la sesión actual no lo tiene en contexto — p.ej. tras un `/clear`), **actualízalo integrando lo nuevo** en vez de sobreescribir a ciegas. Si vienes de una sesión que ya lo cargó (típico tras `/import-mc` al inicio), úsalo del contexto y no vuelvas a pedirlo.

Sube con `mc_upsert_file` — projectId + `"CONTEXT.md"` + content. El tool hace create-or-update por ti.

---

## 4 · DEPLOY_STATUS.md — diferencias test vs prod

Solo si el proyecto tiene **ramas test y prod distintas**. Si coinciden u no hay test, omite este paso.

Ejecuta:
```bash
git log <prodBranch>..<testBranch> --oneline
```

Redacta DEPLOY_STATUS.md con:
- Fecha del análisis
- Funcionalidades en test pendientes de llevar a prod (resumen legible por humano, no commits raw)
- Riesgos, dependencias o bloqueos
- Si están sincronizadas, indicarlo explícitamente

Sube con `mc_upsert_file` (nombre exacto: `"DEPLOY_STATUS.md"`).

---

## Tras terminar

Devuelve un resumen corto: qué crumbs añadiste, qué archivos se crearon vs actualizaron, qué cambió en el proyecto (si actualizaste URLs/ramas). Una frase por punto.
