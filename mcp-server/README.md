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

## Instalación

### 1. Instalar dependencias

```bash
cd mcp-server
npm install
```

### 2. Registrar el server en Claude Code

Editar `~/.claude.json` (global, afecta a todas las sesiones en todas las carpetas) y añadir:

```json
{
  "mcpServers": {
    "missioncontrol": {
      "command": "node",
      "args": ["C:\\Users\\tgomez\\Desktop\\Missioncontrol\\mcp-server\\index.js"],
      "env": {
        "MC_API_URL": "https://missioncontrol-coral.vercel.app",
        "MC_API_KEY": "<la misma key que en agent/.env.local>"
      }
    }
  }
}
```

En Mac (casa) la ruta será `/Users/telmo/Projects/Missioncontrol/mcp-server/index.js`.

### 3. Verificar

Arranca una nueva sesión de Claude Code y comprueba que las tools `mc_*` aparecen disponibles. Pide, por ejemplo: `list MC projects`. Debería llamar a `mc_list_projects` sin pedir permiso de red.

## Slash command `/export-mc`

El ritual de "exportar sesión a Mission Control" vive ahora en `~/.claude/commands/export-mc.md`. Invocar con `/export-mc` orquesta las tools anteriores en orden:

1. `mc_list_projects` → detectar projectId
2. `mc_update_project` → URLs/ramas si han cambiado
3. `mc_add_crumbs` → registrar la sesión
4. `mc_upsert_file` → CONTEXT.md
5. `mc_upsert_file` → DEPLOY_STATUS.md (si aplica)

Sin `curl`s, sin permisos de Bash, sin lista hardcodeada de proyectos.

## Relación con `agent/sync.js`

Son mecanismos complementarios, no se pisan:

- **`agent/sync.js`** — barrido mecánico programado. Escanea `~/Projects/` o `Desktop/`, extrae estado git, empuja crumbs "satélite". Se ejecuta con `npm run sync` (manual o cron).
- **MCP server** — interactivo y bidireccional. Lo usa Claude cuando tú se lo pides (exportar una sesión, consultar contexto de otro proyecto).

Ambos escriben en el mismo backend. El sync reporta estado; el MCP captura intención.
