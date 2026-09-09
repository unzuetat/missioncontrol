---
description: Exportar la sesión actual a Mission Control (proyecto, crumbs, CONTEXT.md, DEPLOY_STATUS.md). Verifica el estado git antes de generar nada — `/export-mc` significa "termino aquí, sigo en otra máquina"; no se permiten malentendidos entre máquinas.
---

# Exportar sesión a Mission Control

Usa las herramientas nativas `mc_*` del MCP server de Mission Control. NO uses `curl` ni edites listas hardcodeadas de proyectos — la fuente de verdad es siempre `mc_list_projects`.

Siete pasos en este orden: **detectar proyecto** (paso 0) → **pre-flight git check** (paso 0.5, aborta si hay desincronización grave) → actualizar metadatos si aplica → crumbs (incluidas **revisiones con fecha**, paso 2b) → CONTEXT.md → DEPLOY_STATUS.md → **pulso git** (paso 5, bash puro).

> **Por qué importa el check git:** Mission Control captura el estado conceptual (crumbs, CONTEXT.md), no el del filesystem. Si quedan cambios sin commit o commits sin push, la siguiente máquina hace `import-mc + git pull` y NO ve esos cambios — pero CONTEXT.md ya cuenta como si estuvieran. Resultado: dos máquinas con el mismo "estado conceptual" pero filesystems distintos. Ese tipo de bug silencioso es exactamente lo que `/export-mc` debe prevenir.

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

## 0.5 · Pre-flight git check (cero LLM, bash puro)

**Por qué va antes de generar crumbs y CONTEXT.md:** si hay desincronización grave entre local y remoto, abortar AHORA evita gastar tokens en un export que va a ser inconsistente. Y `/export-mc` significa "termino aquí, sigo en otra máquina" — si la otra máquina no va a ver los cambios actuales, mejor enterarte antes de cerrar la sesión.

Si el cwd no es repo git (`git remote get-url origin` falló en el paso 0 con `remoteUrl = null`), omite este paso completo.

### Comandos a ejecutar (en paralelo cuando sea posible)

```bash
git status --porcelain                            # archivos modificados / untracked
git fetch --quiet 2>&1                            # sincroniza refs con remoto (1-3 s por red)
git rev-list --count @{upstream}..HEAD 2>/dev/null # commits locales sin push
git rev-list --count HEAD..@{upstream} 2>/dev/null # commits remotos sin pull
git branch --show-current                          # rama actual
git rev-parse --abbrev-ref @{upstream} 2>/dev/null # upstream tracking
```

Si `git rev-parse @{upstream}` falla (rama sin upstream), trata el ahead/behind como `?` y avisa explícitamente.

### Veredicto

Clasifica el estado en una de estas categorías:

| Categoría | Condición | Acción |
|-----------|-----------|--------|
| ✅ **Limpio** | Sin archivos pendientes, ahead=0, behind=0 | Continúa al paso 1. Una línea: `✅ Git sincronizado — OK para retomar en otra máquina` |
| ⚠️ **Solo archivos sin commit** | `git status --porcelain` no vacío, pero ahead=0 y behind=0 | Avisa, pregunta si commit+push, NO abortes salvo que el usuario diga "para" |
| 🟡 **Commits locales sin push** | ahead > 0 | Avisa, pregunta si push, NO abortes salvo que el usuario diga "para" |
| 🔴 **Divergencia con remoto** | behind > 0 | **ABORTA el export.** La otra máquina ya hizo cambios — necesitas pull/merge antes de exportar |
| 🟠 **Rama no es main/master** | branch actual ≠ `main` y ≠ `master` | Continúa pero **incluye en el resumen final**: "estás en `<branch>`, en la otra máquina retoma con `git checkout <branch>` después del pull" |

### Formato del aviso al usuario

Cuando haya algo pendiente, lista en formato compacto:

```
⚠️ Estado git antes de exportar:

  Rama actual: <branch> (upstream: <upstream>)
  Sin commit:  <N> modificados, <M> sin tracking
  Sin push:    <N> commits locales no están en <upstream>
  Sin pull:    <N> commits remotos no están aquí ← (esto es bloqueante)

Archivos sin commit:
  M  CLAUDE.md
  M  server.py
  ?? metrics.py
  ?? prompts/

Commits sin push:
  abc1234 mensaje del commit
  def5678 otro mensaje

¿Qué hago?
  1. Commit + push de todo lo pendiente (yo lo hago)
  2. Solo commit, sin push (revisas tú y empujas luego)
  3. Continuar sin tocar git (asumo que sabes lo que haces, lo registro en el crumb final)
  4. Parar el export (déjame arreglar git primero)
```

### Reglas operativas

- **Respeta la regla global de Telmo:** "preguntar antes de push a GitHub". Nunca pushees sin confirmación explícita. El check informa, no actúa por sí solo.
- **Si la rama actual es `main` o `master`** y la regla del usuario es "nunca pushear a main sin pedir", confirma doblemente antes de push directo a main.
- **Si abortas por behind > 0**, devuelve un mensaje claro al usuario explicando qué hacer (`git pull`, resolver conflictos, volver a ejecutar `/export-mc`).
- **Si el usuario elige "continuar sin tocar git"**, registra el estado en uno de los crumbs del paso 2 con título `Export con git pendiente` y un body listando qué quedó colgado, para que tú-mismo-en-la-siguiente-máquina lo sepas.

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

### 2b · Revisiones con fecha (pruebas, experimentos, métricas a leer más tarde)

Antes de llamar a `mc_add_crumbs`, repasa la sesión buscando cosas que **hay que volver a mirar en X días**: un experimento SEO que se lee a D+21, una prueba A/B, un cron que hay que comprobar que corrió, una métrica que tarda en asentarse, una respuesta que esperas de alguien. Si has visto alguna, **pregunta al usuario una sola vez**:

```
He detectado cosas que habría que revisar más adelante:
  1. <qué> — propongo revisar el <YYYY-MM-DD> (D+N)
  2. ...
¿Las registro con esa fecha? (sí / ajusta fechas / no)
```

Si no has detectado ninguna, pregunta igualmente, en una línea: **"¿Hay algo de esta sesión que haya que revisar o analizar dentro de unos días? (fecha o 'no')"**.

Cada revisión confirmada va como crumb propio en el mismo batch, con `isTest: true` y `dueAt: "YYYY-MM-DD"`. Título con verbo ("Leer GSC del lote 3", "Comprobar que el cron de backup corrió"), body con qué mirar exactamente y qué decisión depende de ello. Estas revisiones aparecen en la pestaña **Git** del dashboard y en los briefings como "Revisiones pendientes"; al hacerlas, se marcan hechas desde el dashboard.

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

### 3b · Copia local en el repo (`docs/CONTEXT.md`)

Mission Control es la fuente de verdad, pero cada repo lleva una copia para leerla en GitHub o desde Claude Code sin abrir MC. Justo después de subirlo, escribe el MISMO contenido en `docs/CONTEXT.md` del cwd (crea `docs/` si no existe), anteponiendo esta cabecera (dos líneas exactas, para reconocer la copia):

```
<!-- mission-control: copia local de CONTEXT.md · fuente: https://missioncontrol-coral.vercel.app · no editar aquí, usa /export-mc -->
```

Reglas:
- Solo si el cwd es un repo git (si `remoteUrl = null` en el paso 0, omite este paso).
- Si ya existe `docs/CONTEXT.md` **sin** esa cabecera, es un documento propio del proyecto: NO lo pises. Pregunta al usuario si quiere sustituirlo o guardar la copia como `docs/CONTEXT.mc.md`.
- No hagas commit por tu cuenta: el fichero se commitea con el resto de cambios de la sesión (el pre-flight del siguiente `/export-mc` lo verá como cambio local si se olvida).

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

## 5 · Pulso git (bash puro, sin LLM)

Sube la foto git exacta de TODAS las carpetas de proyectos de esta máquina a Mission Control (ahead/behind, commits sin push, ramas que bifurcan, PRs abiertas, test vs prod). Es lo que alimenta la pestaña **Git** y los briefings. Ejecuta:

```bash
MC_DIR="${MC_DIR:-$HOME/Projects/Missioncontrol}"
[ -f "$MC_DIR/agent/pulse.js" ] && (cd "$MC_DIR" && npm run pulse --silent 2>&1 | tail -3) || echo "pulso omitido: no encuentro $MC_DIR/agent/pulse.js"
```

Tarda ~30 s. Si falla, no abortes el export: menciónalo en el resumen final.

---

## Tras terminar

Devuelve un resumen corto: qué crumbs añadiste (y cuántas revisiones con fecha), qué archivos se crearon vs actualizaron (y si `docs/CONTEXT.md` se escribió), qué cambió en el proyecto (si actualizaste URLs/ramas), y si el pulso git se subió. Una frase por punto.
