---
description: Exportar la sesión actual a Mission Control en ~1 minuto — dos comandos y un delta pequeño. El script hace la mecánica (detección, git, crumbs, CONTEXT.md por secciones, docs/CONTEXT.md, DEPLOY_STATUS, pulso); tú solo escribes lo que cambió.
---

# Exportar sesión a Mission Control

`/export-mc` significa "termino aquí, sigo en otra máquina". Toda la mecánica la hace `agent/export.js`; tu trabajo es **escribir un delta pequeño** con lo que ha pasado en la sesión. No leas ni reescribas el CONTEXT.md entero: solo las secciones que cambian. No uses `curl` ni las tools `mc_*` para esto.

```bash
MC_DIR="${MC_DIR:-$HOME/Projects/Missioncontrol}"
MC="node --env-file=$MC_DIR/agent/.env.local $MC_DIR/agent/export.js"
```

## 1 · Comprobar (un comando, ~3 s)

```bash
$MC --check --dir "$PWD"
```

Imprime: proyecto detectado, estado git con veredicto, secciones actuales del CONTEXT.md (con el "pendiente" completo y el final de "funciona"), últimos crumbs y revisiones pendientes.

- **Exit 2** (proyecto ambiguo): muestra los candidatos al usuario y pregunta qué id usar (o `nuevo` → `mc_create_project` y luego `--check --project <id>`).
- **Exit 3** (🔴 behind > 0): **aborta**. La otra máquina ya hizo cambios: `git pull` primero y repite.
- ⚠️/🟡 (sin commit / sin push): **una sola pregunta** al usuario, combinada con el punto 2b si aplica: `1) commit + push (lo hago yo, confirmando el push)` · `2) solo commit` · `3) seguir sin tocar git` · `4) parar`. Regla global: nunca push sin confirmación explícita, y nunca a main/master directo. Si elige 3, añade un crumb `Export con git pendiente` con lo que queda colgado.
- ✅ limpio: sigue sin preguntar.

## 2 · Escribir el delta (tú, 1-2 KB)

Escribe `/tmp/mc-export-<projectId>.json`:

```json
{
  "crumbs": [
    { "title": "≤10 palabras, qué se hizo", "body": "qué se hizo, qué se decidió, qué queda pendiente; contexto para retomar en un mes", "timestamp": "ISO opcional" }
  ],
  "reviews": [
    { "title": "Verbo + qué revisar", "body": "qué mirar exactamente y qué decisión depende", "dueAt": "YYYY-MM-DD" }
  ],
  "context": {
    "Estado actual — funciona": { "append": "- **<fecha>:** lo nuevo que funciona" },
    "Estado actual — pendiente": "lista completa reescrita (parte del 'pendiente actual' que imprimió --check: quita lo hecho, añade lo nuevo)",
    "Decisiones importantes": { "append": "- decisión nueva, si la hay" }
  },
  "snapshotNote": "una frase con lo que hubo en la sesión",
  "meta": { "testBranch": "solo si cambió algo de URLs/ramas" },
  "deployNotes": "opcional: texto que antepone al DEPLOY_STATUS automático"
}
```

Reglas del delta:
- **Crumbs**: uno por bloque de trabajo o decisión (no uno por commit). Si no hubo nada significativo, `crumbs: []` y dilo.
- **2b · Revisiones con fecha**: si en la sesión quedó algo que **hay que volver a mirar en X días** (métricas a leer a D+21, un cron que comprobar, una respuesta que esperas), propón cada una con fecha en la misma pregunta del punto 1 (o en una sola pregunta si git estaba limpio). Si no detectas ninguna, **no preguntes**: pon `reviews: []`.
- **Context**: solo secciones tocadas. `"texto"` = sustituir; `{ "append" }` / `{ "prepend" }` = añadir. El snapshot y la sección `Git a <fecha>` los rellena el script. Si `--check` dijo que no hay CONTEXT.md, el delta debe traer las secciones base: Qué es, Tech stack, Arquitectura, Estado actual — funciona, Estado actual — pendiente, Decisiones importantes, Despliegues, URLs.
- **Meta**: solo campos que cambian (`name, description, status, color, repoUrl, testUrl, testBranch, prodUrl, prodBranch, techStack`).

## 3 · Aplicar (un comando, ~5 s)

```bash
$MC --apply /tmp/mc-export-<projectId>.json --dir "$PWD"
```

Hace, en este orden: metadatos → crumbs y revisiones (un batch) → CONTEXT.md fusionado por secciones y subido → `docs/CONTEXT.md` local (con cabecera de MC; si el repo tiene un doc propio sin cabecera, escribe `docs/CONTEXT.mc.md` y lo avisa) → `DEPLOY_STATUS.md` automático desde `git log prod..test` → pulso git de **este** repo fusionado en el de la máquina. Imprime un resumen por línea.

## Tras terminar

Devuelve el resumen del script tal cual (una línea por punto) y, si estás en una rama que no es main/master, recuérdalo: "retoma con `git checkout <rama>` tras el pull". Nada más.
