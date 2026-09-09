#!/usr/bin/env node
/**
 * Agente residente de Mission Control.
 *
 * Sondea la cola de trabajos de MC y ejecuta en este Mac lo que el dashboard
 * no puede hacer desde Vercel:
 *   - pulse    → foto git de todos los repos (agent/pulse.js) y subida
 *   - briefing → briefing con la suscripción de Claude Code (agent/briefing.js)
 *
 *   npm run agent            → bucle infinito (lo mantiene vivo launchd)
 *   npm run agent -- --once  → una pasada y salir (para probar)
 *
 * Cadencia: cada AGENT_POLL_SECONDS (90 s) normalmente; cada 10 s durante
 * unos minutos después de que alguien abra el dashboard o encole un trabajo
 * (la API devuelve `fast: true`). Tras terminar un trabajo vuelve a sondear
 * enseguida por si hay más.
 *
 * Requiere en agent/.env.local: MC_API_URL, MC_API_KEY, MACHINE_ID.
 */

import "dotenv/config";
import { setTimeout as sleep } from "node:timers/promises";

import { McClient } from "./lib/mc-client.js";
import { collectPulse } from "./pulse.js";
import { generateBriefing } from "./briefing.js";

const MC_API_URL = process.env.MC_API_URL;
const MC_API_KEY = process.env.MC_API_KEY;
const MACHINE_ID = process.env.MACHINE_ID || "desconocida";
const POLL_MS = (parseInt(process.env.AGENT_POLL_SECONDS || "90", 10) || 90) * 1000;
const FAST_MS = 10 * 1000;
const VERSION = "1";
const ONCE = process.argv.includes("--once");

if (!MC_API_URL || !MC_API_KEY) {
  console.error("Faltan MC_API_URL o MC_API_KEY en agent/.env.local.");
  process.exit(1);
}

const mc = new McClient({ baseUrl: MC_API_URL, apiKey: MC_API_KEY });
let stopping = false;
process.on("SIGTERM", () => { stopping = true; });
process.on("SIGINT", () => { stopping = true; });

const ts = () => new Date().toISOString().slice(11, 19);
const log = (...a) => console.log(`[${ts()}]`, ...a);

async function runJob(job) {
  if (job.type === "pulse") {
    const projects = await mc.listarProyectos();
    const payload = collectPulse({ projects, machine: MACHINE_ID });
    const res = await mc.enviarPulso(payload);
    const alerts = payload.projects.filter((p) => p.ahead > 0 || p.uncommitted > 0 || (p.branchesWithoutRemote || []).length || (p.divergingBranches || []).length || (p.prs || []).length).length;
    return { projects: res.projects, alerts, generatedAt: res.generatedAt, durationMs: payload.durationMs };
  }
  if (job.type === "briefing") {
    const { kind, flavor, projectId, model } = job.params || {};
    const out = await generateBriefing({
      flavor: flavor || "technical",
      projectId: kind === "project" ? projectId : null,
      model: model || "sonnet",
      upload: true,
      log: (m) => log("  ", m),
    });
    return {
      kind: out.kind, projectId: out.projectId || null, flavor: out.flavor, model: out.model,
      generatedAt: out.saved?.generatedAt || null, durationMs: out.durationMs,
      inputTokens: out.usage?.inputTokens, outputTokens: out.usage?.outputTokens,
      preview: out.markdown.slice(0, 160),
    };
  }
  throw new Error(`Tipo de trabajo desconocido: ${job.type}`);
}

async function tick() {
  const { job, fast } = await mc.reclamarTrabajo({ machine: MACHINE_ID, version: VERSION, pid: String(process.pid) });
  if (!job) return { fast, worked: false };
  log(`▶ ${job.type} ${JSON.stringify(job.params)} (${job.id.slice(0, 8)})`);
  try {
    const result = await runJob(job);
    await mc.terminarTrabajo({ id: job.id, status: "done", result });
    log(`✓ ${job.type} listo`, JSON.stringify(result).slice(0, 200));
  } catch (err) {
    const msg = err?.message || String(err);
    log(`✗ ${job.type} falló: ${msg}`);
    await mc.terminarTrabajo({ id: job.id, status: "failed", error: msg }).catch((e) => log("  (no se pudo notificar el fallo:", e.message, ")"));
  }
  return { fast: true, worked: true };
}

async function main() {
  log(`Agente MC "${MACHINE_ID}" · ${MC_API_URL} · sondeo cada ${POLL_MS / 1000}s (rápido: ${FAST_MS / 1000}s)`);
  let backoff = 0;
  while (!stopping) {
    let wait = POLL_MS;
    try {
      const { fast, worked } = await tick();
      backoff = 0;
      if (worked) wait = 500; // por si hay más en cola
      else if (fast) wait = FAST_MS;
    } catch (err) {
      backoff = Math.min(backoff + 1, 5);
      wait = Math.min(POLL_MS * backoff, 10 * 60 * 1000);
      log(`error de sondeo (${err.message}); reintento en ${Math.round(wait / 1000)}s`);
    }
    if (ONCE) break;
    await sleep(wait);
  }
  log("agente detenido");
}

main().catch((err) => {
  console.error("Error fatal:", err.message || err);
  process.exit(1);
});
