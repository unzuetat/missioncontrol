<style>
a, a:link, a:visited, a:hover, a:active {
  color: inherit !important;
  text-decoration: none !important;
  border-bottom: 1px dotted #999 !important;
}
</style>

# SETUP — Tu propia Mission Control

Guía paso a paso para que tengas **tu propia instancia** de Mission Control en
una hora, sin experiencia previa con Claude Code ni con nada de lo que hay aquí
dentro. Tus datos vivirán solo en tu infraestructura — nadie más los ve.

> **¿Qué es Mission Control?** Un panel en el navegador donde cada proyecto en
> el que trabajas tiene su ficha viva: contexto, decisiones, qué hiciste la
> última vez, qué te queda pendiente. Lo importante: se conecta a **Claude Code**
> (el asistente que vive en tu terminal/IDE) con dos comandos, `/import-mc` y
> `/export-mc`. Al empezar a trabajar, `/import-mc` le carga a Claude todo el
> contexto del proyecto — no tienes que volver a explicarle nada. Al terminar,
> `/export-mc` guarda lo que habéis hecho hoy para mañana.

## Lo que tendrás al terminar

- Un dashboard web propio en una URL tipo `https://tu-mc.vercel.app`, accesible
  desde el ordenador y el móvil.
- Claude Code conectado a tu dashboard: cualquier sesión empieza con
  `/import-mc` y termina con `/export-mc`.
- Una pestaña 🚀 Lanzador con accesos directos a todos tus proyectos.
- **Cero mezcla con datos de nadie más.** Solo tú.

## Tiempo y coste

- **Tiempo:** 45–60 min seguidos, sin prisa.
- **Coste recurrente:** 0 € si no usas briefings con IA. Si los usas: tope de
  5 $/mes ya configurado en el código (Anthropic API).
- Tus únicas dependencias gratis: GitHub, Vercel (Hobby) y Upstash Redis (free
  256 MB, se crea desde el propio panel de Vercel).

## Lo que necesitas antes de empezar

- Un ordenador (Mac, Linux o Windows con WSL).
- Una cuenta de correo.
- 60 minutos sin que te interrumpan.

---

## 0. Instala lo básico en tu ordenador (10 min)

Necesitas tres cosas instaladas: **Node.js**, **git** y **Claude Code**.

### Node.js (versión 20 o superior)

- **Mac:** abre la app **Terminal** (Cmd+Espacio, escribe "Terminal"). Pega
  esto y pulsa Enter:
  ```bash
  node --version
  ```
  Si responde algo como `v20.x` o superior, sigue. Si dice "command not
  found" o tienes una versión menor, instala Node desde https://nodejs.org/
  (el botón verde grande "LTS").
- **Windows:** instala Node desde https://nodejs.org/ y reinicia la terminal.

### git

- **Mac:** probablemente ya lo tienes. En Terminal:
  ```bash
  git --version
  ```
  Si no, ejecuta `xcode-select --install` (te lo pedirá macOS).
- **Windows:** instala desde https://git-scm.com/.

### Claude Code

Claude Code es **el asistente que se conecta a Mission Control**. Sin él,
`/import-mc` y `/export-mc` no existen. Instálalo:

```bash
npm install -g @anthropic-ai/claude-code
```

Después comprueba:

```bash
claude --version
```

Si responde con un número, perfecto. Si dice algo de permisos, prueba con:

```bash
sudo npm install -g @anthropic-ai/claude-code
```

### VS Code como interfaz (recomendado si no estás cómodo en la terminal)

Claude Code se puede usar de dos formas, y eliges la que prefieras:

- **En la terminal**, lanzando el comando `claude`.
- **Dentro de Visual Studio Code**, con su extensión oficial.

VS Code es un editor visual gratis con asistencia integrada — para alguien
que no se siente cómodo en la terminal, esta es la forma más fácil. Lo
instalas en minutos:

1. Descarga e instala **Visual Studio Code** desde
   https://code.visualstudio.com/.
2. Abre VS Code. En la barra lateral izquierda pulsa el icono de
   **Extensions** (los 4 cuadraditos), busca **"Claude Code"** (autor:
   Anthropic) y pulsa **Install**.
3. Tras instalar la extensión, abre la **paleta de comandos** (Cmd+Shift+P
   en Mac, Ctrl+Shift+P en Windows) y escribe `Claude: Start`. Se abre un
   panel lateral con Claude Code dentro de VS Code — el mismo asistente que
   en la terminal, pero con interfaz gráfica, editor delante, y los archivos
   del proyecto a un clic.

En lo que sigue de esta guía verás instrucciones del tipo "lanza `claude` en
la terminal". Si usas VS Code, **el equivalente es abrir el panel de Claude
Code dentro del editor** (Cmd+Shift+P → `Claude: Start`). Los comandos
`/import-mc`, `/export-mc` y `/mcp` funcionan idénticos en ambos sitios.

### Primer login en Claude Code

Lanza Claude Code una vez (en la terminal con `claude`, o desde VS Code con
`Claude: Start`) para terminar de configurarlo y meter tu cuenta de
Anthropic (la misma con la que pagas Claude Pro/Max, o crea una nueva).

Sigue el flujo de login que te pide. Cuando estés dentro, escribe `/exit`
(o cierra el panel en VS Code). **A partir de aquí, lo que escribas en
Claude Code se cobra/usa de TU suscripción, no de la de nadie más.**

---

## 1. Crea las 3 cuentas que vas a necesitar (10 min)

Hazlas en este orden, tendrás los datos a mano para los pasos siguientes.

### GitHub (si no la tienes)

https://github.com/signup — necesaria para "forkar" (copiar a tu cuenta) el
repositorio de Mission Control.

### Vercel

https://vercel.com/signup — pulsa **"Continue with GitHub"** para que use tu
cuenta de GitHub. Es donde vivirá tu dashboard en internet. Plan **Hobby**
(gratis) sobra.

### Base de datos: Upstash Redis (desde Vercel)

Donde vivirán tus datos (proyectos, notas, contextos). **No hace falta crear
cuenta en ningún sitio nuevo**: se crea desde el panel de Vercel en el paso 4,
y Vercel mete sola la variable `REDIS_URL` en tu proyecto.

> **Por qué Upstash y no Redis Cloud.** El plan gratuito de Redis Cloud
> **borra la base de datos, sin copia, tras 14 días sin uso**. Así se perdió
> la instancia original de Mission Control el 2026-09-08. Upstash, si pasas 30
> días sin usarla, la archiva con copia y la restauras con un clic. Además el
> cron diario de la sección "Copias de seguridad" evita que llegue a pasar.

### (Opcional) Anthropic API

Solo si quieres que Mission Control te genere **briefings con IA** (pulsos
diarios resumidos del estado de tus proyectos). Sin esto el dashboard
funciona igual, simplemente esa pestaña queda vacía.

https://console.anthropic.com → crea cuenta, mete método de pago, ve a **API
Keys** → **Create Key** → cópialo. Es tu **`ANTHROPIC_API_KEY`**.
**Costes:** los briefings cuestan entre 1 y 5 céntimos cada uno; el código
tiene un tope de 5 $/mes que NO se puede pasar.

---

## 2. Copia el repositorio a tu cuenta y a tu ordenador (5 min)

### Fork (copia a tu GitHub)

Abre en el navegador: https://github.com/unzuetat/missioncontrol

Arriba a la derecha pulsa **"Fork"** → selecciona tu cuenta. Espera unos
segundos. Ahora tienes el repo en `https://github.com/TU-USUARIO/missioncontrol`.

### Clónalo en tu ordenador

En la terminal, elige una carpeta donde guardas tus proyectos (ejemplo: el
escritorio) y clona:

```bash
cd ~/Desktop
git clone https://github.com/TU-USUARIO/missioncontrol.git
cd missioncontrol
npm install
cd mcp-server && npm install && cd ..
```

Esto descarga el código y prepara las dos partes que necesitan instalarse
(la app y el "MCP server" que conecta Claude Code con tu Mission Control).

---

## 3. Inventa tu MC_API_KEY (1 min)

Tu **`MC_API_KEY`** es la "llave maestra" de tu Mission Control. Tiene que
ser una cadena larga y aleatoria. Genera una con:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Te devuelve algo como `7a3b9c2d...` (64 caracteres). **Guárdala** como
guardaste el REDIS_URL.

> ⚠️ Esta clave es **solo tuya**. No la pongas en GitHub, no la enseñes a
> nadie. Si alguien la tiene, puede escribir en tu Mission Control.

---

## 4. Despliega tu Mission Control en Vercel (10 min)

### Crea el proyecto Vercel

1. Entra a https://vercel.com/new
2. Verás tu lista de repos de GitHub. Busca **missioncontrol** y pulsa
   **"Import"**.
3. En "Configure Project" déjalo todo por defecto, **pero ANTES de pulsar
   Deploy**, baja a **"Environment Variables"** y mete estas 2 o 4:

| Nombre | Valor | Sensitive |
|---|---|---|
| `MC_API_KEY` | la que generaste en el paso 3 | ✅ Sí |
| `REDIS_URL` | **no la metas a mano**: la crea la base de datos del paso 4b | — |
| `CRON_SECRET` | una cadena aleatoria larga (`openssl rand -hex 32`) — protege el cron diario | ✅ Sí |
| `BACKUP_REPO` | `tu-usuario/mc-backups` — repo **privado** donde irán los backups | No |
| `BACKUP_GITHUB_TOKEN` | PAT fine-grained con **Contents: Read and write** SOLO sobre `mc-backups` | ✅ Sí |
| `ANTHROPIC_API_KEY` (opcional) | la de Anthropic, si la pediste | ✅ Sí |
| `GITHUB_TOKEN` (opcional) | un PAT de GitHub fine-grained read-only — para badges de tus repos | ✅ Sí |

Para crear un `GITHUB_TOKEN` (opcional, solo si quieres ver iconos de estado
de commits/PRs en cada proyecto): https://github.com/settings/personal-access-tokens/new
— acceso read-only a "Contents", "Pull requests" y "Metadata" de tus repos.

4. Pulsa **Deploy**. Espera 1–2 min. Cuando termine, Vercel te da una URL
   tipo `https://missioncontrol-XXXX.vercel.app`. **Apúntala**, es tu
   **`MC_API_URL`**.

4b. **Crea la base de datos.** En el proyecto de Vercel, pestaña **Storage** →
   **Create Database** → **Upstash for Redis** → plan **Free** → región
   europea (Frankfurt o Ireland) → conéctala al proyecto en los tres entornos.
   Vercel añade `REDIS_URL` (y unas `KV_*` que no usamos) automáticamente.
   Después ve a **Deployments** → menú `⋯` del último → **Redeploy**, para
   que las funciones arranquen con la variable nueva.

4c. **Crea el repo privado de backups** en https://github.com/new — nombre
   `mc-backups`, **Private**, vacío. Y el token: https://github.com/settings/personal-access-tokens/new
   → "Only select repositories" → `mc-backups` → Repository permissions →
   **Contents: Read and write**. Ese es tu `BACKUP_GITHUB_TOKEN`.

### Smoke test (verifica que el backend vive)

En el navegador abre:

```
https://TU-URL-VERCEL.vercel.app/api/projects?bare=true
```

Debes ver `{"projects":[]}`. Eso significa: backend OK, Redis conectada, sin
datos (como debe ser, está vacía esperándote).

Si en su lugar ves un error 500, abre Vercel → tu proyecto → pestaña
**"Logs"** y mira qué falla. Lo más común: el REDIS_URL mal copiado.

---

## 5. Conecta Claude Code a TU Mission Control (5 min)

En la terminal, en la carpeta `missioncontrol` que clonaste:

```bash
cp agent/.env.example agent/.env.local
```

Abre `agent/.env.local` con tu editor (TextEdit, VS Code, lo que sea) y
rellénalo así:

```
MC_API_URL=https://TU-URL-VERCEL.vercel.app
MC_API_KEY=TU_LLAVE_DEL_PASO_3
MACHINE_ID=tu-mac-casa
```

> 🛡️ **No puedes equivocarte aquí.** El script de instalación se niega a
> arrancar si `MC_API_URL` está vacío y te dice exactamente qué falta.
> Antes había un fallback al backend del autor; se quitó precisamente para
> que ningún regalo de Mission Control acabe conectado a una instancia que
> no es la del nuevo dueño.

`MACHINE_ID` es un nombre cualquiera para identificar este ordenador
(ejemplo: "mac-casa", "portatil-curro"). Sirve para que Mission Control sepa
qué máquina dejó qué nota.

Ahora ejecuta:

```bash
npm run setup-claude
```

Esto hace 3 cosas:
1. Copia los slash commands `/import-mc` y `/export-mc` a
   `~/.claude/commands/` para que Claude Code los reconozca.
2. Registra el MCP server "missioncontrol" en `~/.claude.json` apuntando a
   TU backend.
3. Te dice "✅ Setup Claude completado".

Si te falla, el propio mensaje de error te indica qué falta (típicamente
`MC_API_URL` o `MC_API_KEY` sin rellenar en `agent/.env.local`). Corrige y
vuelve a ejecutar.

---

## 6. Reinicia Claude Code y verifica

Cierra cualquier sesión abierta de Claude Code (`/exit` en terminal, o
cierra el panel en VS Code) y vuelve a abrirla:

- **Terminal:** `claude`
- **VS Code:** Cmd/Ctrl+Shift+P → `Claude: Start`

Una vez dentro, escribe:

```
/mcp
```

Debes ver `missioncontrol ✓ connected`. Si dice "failed", revisa que el
`MC_API_URL` y el `MC_API_KEY` en `agent/.env.local` son correctos y vuelve a
correr `npm run setup-claude`.

Si está conectado, prueba:

```
/import-mc
```

Te dirá algo como "No tengo claro qué proyecto de MC corresponde a esta
carpeta" — normal, Mission Control está vacía. Responde `ninguno` para
cancelar.

**A partir de aquí, ya eres autónomo.**

---

## 7. Abre el dashboard y crea tu primer proyecto

En el navegador, abre tu URL de Vercel (`https://TU-URL.vercel.app`). Verás
el dashboard vacío. Pulsa el **+** junto a "Proyectos" y rellena uno (nombre,
descripción, color, URLs si las tiene). Es tu primer proyecto.

A partir de ahora, cuando trabajes en ese proyecto:

1. Abre la carpeta del proyecto:
   - **VS Code:** File → Open Folder → la carpeta del proyecto. Lanza
     Claude desde la paleta (Cmd/Ctrl+Shift+P → `Claude: Start`).
   - **Terminal:** `cd` a la carpeta y lanza `claude`.
2. Primer comando de la sesión: `/import-mc` (te carga el contexto).
3. Trabajas con Claude normalmente.
4. Antes de cerrar: `/export-mc` (guarda lo que habéis hecho).
5. La próxima vez que abras Claude ahí — incluso en otro ordenador —
   `/import-mc` recupera todo el contexto.

---

## 8. (Opcional) Activa el Diván

El "Diván" es un think tank cross-proyecto con 8 modos (utilidad, creativo,
monetizar, conectar puntos…). Si quieres usarlo necesitas haber metido tu
`ANTHROPIC_API_KEY` y rellenar los modos seed. En tu carpeta del repo, crea
`.env.local` (en la raíz, NO en `agent/`). La forma más fácil es dejar que
Vercel lo genere con las variables reales del proyecto (incluida `REDIS_URL`):

```bash
vercel env pull .env.local
```

Y ejecuta:

```bash
npm run seed-divan-modes
```

Aparecerán los 8 modos en la pestaña Diván del dashboard.

---

## 9. Móvil

Para usar Mission Control desde el móvil simplemente abre tu URL de Vercel.
Funciona como una web normal en el navegador. Si quieres icono en la
pantalla de inicio: en Safari/Chrome del móvil pulsa "Compartir → Añadir a
pantalla de inicio".

(La parte de PWA instalable con manifiesto está pendiente en el roadmap.)

---

## Problemas frecuentes

### "`npm run setup-claude` me grita que falta `MC_API_URL` / `MC_API_KEY`"
Es el comportamiento correcto: el script se niega a arrancar si esos dos
valores no están en `agent/.env.local`. Abre ese archivo, rellénalos y
vuelve a ejecutar `npm run setup-claude`.

### "/mcp dice 'missioncontrol failed'"
- El `MC_API_KEY` de `agent/.env.local` no coincide con el de Vercel. Tienen
  que ser idénticos.
- El `MC_API_URL` está mal escrito o le falta el `https://`.
- Tras editar `agent/.env.local`, hay que **volver a correr `npm run
  setup-claude`** para que Claude Code recoja los cambios.

### "El dashboard carga pero no veo proyectos al crear uno"
Mira la pestaña "Logs" de tu proyecto en Vercel. Lo más típico: REDIS_URL
mal copiado (le falta una letra, le sobra un espacio, etc.).

### "Quiero usar Mission Control desde otro ordenador mío"
Repite los pasos 0, 2 y 5 en el segundo ordenador (no hace falta volver a
crear cuentas ni a desplegar — esos pasos son únicos). Cada máquina tiene su
propio clone del repo y su propio `agent/.env.local`, todos apuntando al
mismo backend de Vercel. Pon un `MACHINE_ID` distinto en cada uno.

---

## Copias de seguridad y señal de vida

Mission Control lleva dos mecanismos para no volver a perder datos:

1. **Cron diario en Vercel** (`vercel.json` → `/api/ops/daily`, 05:00 UTC):
   escribe una clave en Redis (actividad real, así ningún plan gratuito la da
   por abandonada) y **vuelca toda la base de datos a JSON** en tu repo privado
   `mc-backups` (`backups/AAAA/AAAA-MM-DD.json` + `latest.json`). Necesita
   `CRON_SECRET`, `BACKUP_REPO` y `BACKUP_GITHUB_TOKEN` (paso 4).
2. **Scripts locales**, por si quieres una copia a mano o restaurar:
   ```bash
   npm run backup                         # → backups/mc-<fecha>.json (carpeta ignorada por git)
   npm run restore -- backups/mc-X.json   # simulación: muestra qué haría
   npm run restore -- latest.json --yes   # restaura de verdad (añade --wipe para vaciar antes)
   ```
   Usan el `REDIS_URL` de `.env.local`.

Comprueba que funciona: `https://TU-URL/api/ops/status` muestra el último
keepalive y el último backup. Si `lastBackup` sigue en `null` pasadas 24 h,
revisa los logs del cron en Vercel (pestaña **Logs**, filtra por `ops`).

## Pulso git y briefings con tu suscripción de Claude

Dos cosas corren **en tu ordenador**, no en Vercel, porque necesitan ver tus
repos y porque la suscripción de Claude (Pro/Max) solo se puede usar desde
Claude Code, no desde un servidor con API key:

1. **Pulso git** (`npm run pulse`, sin IA): recorre tus proyectos y sube a
   Mission Control la foto exacta de cada repo: commits sin push, cambios sin
   commit, ramas que solo existen en local o sin fusionar, PRs abiertas, test
   frente a prod. Se ve en la pestaña **⑂ Git** del dashboard, junto a las
   **revisiones pendientes** (crumbs con fecha "revisar el"). Cada máquina
   sube el suyo, etiquetado con su `MACHINE_ID`. Se lanza solo a diario con
   launchd (ver abajo) y al final de cada `/export-mc`.
2. **Briefing por suscripción** (`npm run briefing`): construye el mismo
   prompt que usa el backend, lo ejecuta con `claude -p` (Claude Code en modo
   headless, cuenta contra tu suscripción, coste 0 en API) y sube el
   resultado. En el dashboard aparece como cualquier otro briefing, marcado
   "suscripción".
   ```bash
   npm run briefing                                 # pulso diario del portfolio
   npm run briefing -- --flavor executive           # briefing ejecutivo del portfolio
   npm run briefing -- --project salariojusto       # briefing de un proyecto
   npm run briefing -- --project X --model opus     # más profundo
   ```
   Los botones "Generar" del dashboard siguen usando la API de Anthropic
   (con coste). Si no quieres pagar nunca, no pongas `ANTHROPIC_API_KEY` en
   Vercel y genera siempre con `npm run briefing`.

**Botones del dashboard: el agente residente.** Los botones "Suscripción" (pulso
diario y Chief of Staff de cada proyecto) y "Actualizar pulso" (pestaña Git)
no pueden ejecutar nada en Vercel: dejan un **trabajo en cola** y lo recoge un
agente que corre en tu Mac:

```bash
npm run agent            # bucle: sondea la cola cada 90 s (10 s cuando el dashboard está activo)
npm run agent -- --once  # una pasada, para probar
```

El dashboard muestra si el agente de cada máquina está **en línea** y el
estado del trabajo (en cola → ejecutando → listo). Si el Mac está apagado, el
botón se deshabilita y lo dice. Para que arranque solo y se mantenga vivo,
crea `~/Library/LaunchAgents/com.TUNOMBRE.mc-agent.plist` como el del pulso
(abajo) cambiando `pulse.js` por `worker.js`, quitando `StartCalendarInterval`
y añadiendo `<key>RunAtLoad</key><true/>` y `<key>KeepAlive</key><true/>`.
Log en `~/Library/Logs/mc-agent.log`.

**Programar el pulso diario (macOS, launchd).** Crea
`~/Library/LaunchAgents/com.TUNOMBRE.mc-pulse.plist` con este contenido,
ajustando las rutas de `node` (`which node`) y del repo:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>com.TUNOMBRE.mc-pulse</string>
  <key>ProgramArguments</key><array>
    <string>/usr/local/bin/node</string>
    <string>--env-file=/Users/TU/Projects/Missioncontrol/agent/.env.local</string>
    <string>/Users/TU/Projects/Missioncontrol/agent/pulse.js</string>
  </array>
  <key>WorkingDirectory</key><string>/Users/TU/Projects/Missioncontrol</string>
  <key>EnvironmentVariables</key><dict>
    <key>PATH</key><string>/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin</string>
  </dict>
  <key>StartCalendarInterval</key><dict><key>Hour</key><integer>8</integer><key>Minute</key><integer>30</integer></dict>
  <key>StandardOutPath</key><string>/Users/TU/Library/Logs/mc-pulse.log</string>
  <key>StandardErrorPath</key><string>/Users/TU/Library/Logs/mc-pulse.log</string>
</dict></plist>
```

Y cárgalo: `launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.TUNOMBRE.mc-pulse.plist`.
Si el Mac está apagado a esa hora, no pasa nada: el siguiente `/export-mc`
o `npm run pulse` lo pone al día.

## Seguridad — léelo aunque sea por encima

- **Tu `MC_API_KEY`, tu `REDIS_URL`, `CRON_SECRET` y `BACKUP_GITHUB_TOKEN` son
  secretos.** No los subas a GitHub, no los pongas en pastebins, no los enseñes.
  Si crees que se han filtrado, rota la `MC_API_KEY` y `CRON_SECRET` en Vercel,
  regenera el token en GitHub y resetea la contraseña de la base en Upstash.
- **El archivo `agent/.env.local` está en `.gitignore`** — no se sube por
  accidente. No quites esa línea.
- **GETs son públicos en tu backend** (cualquiera con tu URL puede leer la
  lista de proyectos y crumbs). Si vas a meter cosas privadas, no compartas
  tu URL. (Hay roadmap para añadir auth de lectura con PIN.)

---

## ¿Y ahora qué?

Empieza a usarlo. La rutina ideal: **al abrir Claude Code en un proyecto,
`/import-mc` siempre. Al terminar la sesión, `/export-mc` siempre.** Después
de dos semanas, lo notarás: ya no le explicas nada a Claude, simplemente
retomas.

Si te atascas, en una sesión de Claude Code escribe:

```
Estoy montando mi Mission Control siguiendo SETUP.md. Estoy atascado en
[paso X], el error que veo es [pega el error].
```

Claude tiene este archivo como contexto si estás en la carpeta del repo.
