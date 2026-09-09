# Mission Control — Agente local

Pequeño script Node que escanea los proyectos git de esta máquina
(por defecto `~/Projects/`) y empuja su estado al backend de
Mission Control (Vercel + Redis).

> **¿Configurando esto por primera vez en otra máquina?**
> Sigue la guía paso a paso: [SETUP-TRABAJO.md](./SETUP-TRABAJO.md)

## Instalación

Desde la raíz del repo `Missioncontrol`:

```bash
npm install
cp agent/.env.example agent/.env.local
# Edita agent/.env.local con los valores reales
```

Variables:

- `MC_API_URL` — URL del despliegue de Mission Control en Vercel.
- `MC_API_KEY` — secreto compartido (mismo valor que en Vercel).
- `MACHINE_ID` — `casa` o `trabajo` (u otro nombre corto sin espacios).
- `PROJECTS_DIR` — opcional, directorio a escanear.

## Uso

```bash
npm run sync
```

El agente:

1. Recorre cada subcarpeta de `PROJECTS_DIR` que sea un repo git.
2. Por cada proyecto:
   - Lo registra en Mission Control si no existe.
   - Extrae rama actual, último commit, cambios locales y commits
     sin pushear.
   - Crea un "crumb" con el snapshot (source = `agent:<MACHINE_ID>`).
   - Sube/actualiza ficheros clave: `CLAUDE.md`, `README`, `ROADMAP`,
     `package.json`, `requirements.txt` (nombre prefijado por máquina
     para que casa y trabajo no se pisen).

## Automatización

Para que corra automáticamente cada hora (ejemplo con `cron`):

```cron
0 * * * * cd /Users/telmo/Projects/Missioncontrol && /usr/local/bin/node agent/sync.js >> /tmp/mc-sync.log 2>&1
```

## Seguridad

- Los diffs se suben en texto plano al backend. Si algún proyecto
  tiene secretos sin ignorar, no los subas.
- El agente no sube `node_modules`, `venv`, `.git`, `dist`, etc.
- `agent/.env.local` está en `.gitignore` (nunca se pushea).


## Pulso git (`npm run pulse`) y briefing por suscripción (`npm run briefing`)

- `agent/pulse.js`: foto git exacta de todos los repos de `PROJECTS_DIR` (ahead/behind, sin push,
  sin commit, ramas solo en local / sin fusionar / solo en remoto, PRs vía `gh`, test vs prod con
  las ramas que Mission Control tiene de cada proyecto). Sube a `POST /api/briefing/pulse` con
  `MACHINE_ID`. Sin IA. `--dry` no sube, `--json` imprime el payload.
- `agent/briefing.js`: genera el briefing (portfolio o `--project <id>`, `--flavor technical|executive`)
  con `claude -p` usando la suscripción de Claude Code y lo sube a `POST /api/briefing/ingest`.
  Reutiliza los prompts del backend (`api/_lib/briefing-prompts.js`, `api/briefing/_handlers/project.js`).
  `--dry` imprime el prompt; `--no-upload` genera sin subir.
- Programación diaria del pulso en macOS: ver SETUP.md, sección "Pulso git y briefings con tu suscripción".
