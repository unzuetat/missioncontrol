# Mission Control MCP server

Expone Mission Control como **herramientas nativas** para cualquier sesión de Claude Code o Claude Web con soporte MCP. Sustituye el ritual de `curl`s al final de cada sesión por llamadas directas a tools, y permite **consultar** MC desde cualquier proyecto (no solo exportar hacia él).

## Tools expuestas

**Lectura — pull desde cualquier proyecto:**
- `mc_list_projects` — catálogo completo con URLs y ramas
- `mc_get_project` — detalle + crumbs + archivos
- `mc_get_crumbs` — actividad reciente (global o por proyecto)
- `mc_get_files` / `mc_get_file` — archivos del proyecto (CONTEXT.md, DEPLOY_STATUS.md)
- `mc_get_briefing_history` — últimos briefings (daily o por proyecto)
- `mc_get_highlights` — subrayados pendientes

**Escritura — export de sesión:**
- `mc_create_project` — crea proyecto nuevo
- `mc_update_project` — actualiza URLs, ramas, metadatos
- `mc_add_crumbs` — registra actividades de la sesión
- `mc_upsert_file` — crea o actualiza archivo por nombre (atajo para CONTEXT.md / DEPLOY_STATUS.md)
- `mc_delete_file` — borra archivo

## Instalación en una máquina nueva

Tres comandos desde la raíz del repo:

```bash
git pull                          # traer mcp-server/, commands/, scripts/
cd mcp-server && npm install      # deps del MCP server
cd .. && npm run setup-claude     # copia commands + registra MCP en ~/.claude.json
```

Tras esto, **reinicia Claude Code** y comprueba que en una sesión nueva:
- `/mcp` muestra `missioncontrol` conectado.
- `/export-mc` y `/import-mc` aparecen entre los slash commands.

### Qué hace `npm run setup-claude`

El script [`scripts/setup-claude.mjs`](../scripts/setup-claude.mjs):

1. Copia `commands/*.md` → `~/.claude/commands/` (crea la carpeta si falta).
2. Lee `MC_API_KEY` y `MC_API_URL` de `agent/.env.local` (el mismo fichero que usa `agent/sync.js`).
3. Registra o actualiza la entrada `mcpServers.missioncontrol` en `~/.claude.json`, apuntando al `index.js` de este clone concreto del repo — así la ruta es correcta automáticamente en Mac, Windows, o cualquier máquina futura.

Si todavía no tienes `agent/.env.local`, copia `agent/.env.example` a `agent/.env.local` y pega la `MC_API_KEY` antes de ejecutar `setup-claude`.

### Re-ejecutar `setup-claude`

Cuando edites los slash commands en `commands/` o toques algo en `mcp-server/`, vuelve a correr `npm run setup-claude` en esa máquina para refrescar la copia en `~/.claude/`. Es idempotente — sobreescribe sin miedo.

## Slash commands

- **`/export-mc`** — al cerrar sesión, empuja crumbs + CONTEXT.md + DEPLOY_STATUS.md al proyecto correcto de MC. Detecta proyecto por `git remote` con regla estricta (pregunta ante cualquier duda para evitar elegir mal entre duplicados).
- **`/import-mc`** — al abrir una sesión, tira CONTEXT.md, crumbs recientes, subrayados pendientes y último briefing del proyecto del cwd. Misma regla de detección.

Viven versionados en [`commands/`](../commands/) del repo. `setup-claude` los copia a `~/.claude/commands/` para que Claude Code los descubra globalmente.

## Relación con `agent/sync.js`

Son mecanismos complementarios, no se pisan:

- **`agent/sync.js`** — barrido mecánico programado. Escanea `~/Projects/` o `Desktop/`, extrae estado git, empuja crumbs "satélite". Se ejecuta con `npm run sync` (manual o cron).
- **MCP server** — interactivo y bidireccional. Lo usa Claude cuando tú se lo pides (exportar una sesión, consultar contexto de otro proyecto).

Ambos escriben en el mismo backend. El sync reporta estado; el MCP captura intención.
