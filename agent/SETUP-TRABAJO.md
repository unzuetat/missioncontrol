# Setup del agente — Máquina del trabajo

Guía paso a paso para dejar el agente local funcionando en el ordenador del trabajo.
Pensado para que puedas copiar/pegar cada bloque sin pensar.

---

## 1. Requisitos

- **Node.js 18+** instalado (para `fetch` nativo). Comprobar con:
  ```bash
  node --version
  ```
- **git** instalado.
- Tener acceso al repo GitHub `unzuetat/Missioncontrol` con tu cuenta.

---

## 2. Clonar el repo

Si aún no lo tienes en esta máquina:

```bash
mkdir -p ~/Projects
cd ~/Projects
git clone https://github.com/unzuetat/Missioncontrol.git
cd Missioncontrol
```

Si ya lo tenías, basta con actualizar:

```bash
cd ~/Projects/Missioncontrol
git pull origin main
```

---

## 3. Instalar dependencias

```bash
npm install
```

---

## 4. Configurar `.env.local` del agente

```bash
cp agent/.env.example agent/.env.local
```

Edita `agent/.env.local` con:

```
MC_API_URL=https://missioncontrol-coral.vercel.app
MC_API_KEY=<la misma clave que usas en casa>
MACHINE_ID=trabajo
```

Para recordar la `MC_API_KEY`: es la misma que está en Vercel en el proyecto
Missioncontrol (Settings → Environment Variables → `MC_API_KEY` del entorno
Production). Se usa **la misma clave en casa y en el trabajo**.

Si `PROJECTS_DIR` en el trabajo NO es `~/Projects`, descomenta y ajusta esa línea.

---

## 5. Probar

```bash
npm run sync
```

Tendrás algo como:

```
[2026-04-18T09:29:56.498Z] Sync desde trabajo
  Escaneando /Users/<tu-usuario>/Projects
  Backend: https://missioncontrol-coral.vercel.app

Encontrados N proyecto(s) git:

  · proyecto-1 ... ok
  · proyecto-2 ... ok
  ...

N sincronizados · 0 fallos
```

Abre [missioncontrol-coral.vercel.app](https://missioncontrol-coral.vercel.app) y
verifica que los crumbs con source `agent:trabajo` aparecen.

---

## 6. Automatizar con cron (opcional)

Para que el sync corra solo cada hora:

```bash
crontab -e
```

Añade una línea:

```cron
0 * * * * cd /Users/<tu-usuario>/Projects/Missioncontrol && /usr/local/bin/node --env-file=agent/.env.local agent/sync.js >> /tmp/mc-sync.log 2>&1
```

Ajusta la ruta de Node si no está en `/usr/local/bin/node` (averigua con `which node`).

---

## 7. Qué pasa cuando se ejecuta

El agente:

1. Recorre `~/Projects/`.
2. Por cada proyecto git, crea un **crumb** (snapshot) en Mission Control con:
   - Rama actual.
   - Últimos 5 commits.
   - Cambios locales sin commitear.
   - Commits locales sin pushear.
   - Etiquetado con `source = agent:trabajo`.
3. Sube `CLAUDE.md`, `README.md`, `ROADMAP.md`, `package.json`, `requirements.txt`
   como **files** prefijados con `[trabajo]` para no pisar los de `[casa]`.

Nada sale de tu máquina salvo por la petición HTTPS a `MC_API_URL`.
La clave `MC_API_KEY` nunca se sube a git: `.env.local` está en `.gitignore`.

---

## Problemas comunes

- **`Failed to parse URL`**: te falta `https://` delante de la URL. El agente ya
  lo maneja automáticamente, pero mejor ponerlo completo.
- **`Unauthorized`**: `MC_API_KEY` no coincide con la de Vercel Production.
- **Proyecto no aparece**: comprueba que tiene `.git` (es un repo), y que no
  está en la lista de carpetas ignoradas (`node_modules`, `venv`, etc.) que
  define `agent/lib/scanner.js`.
