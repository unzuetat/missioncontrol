#!/usr/bin/env node
/**
 * Briefing de Mission Control generado con la SUSCRIPCIÓN de Claude Code
 * (modo headless `claude -p`), sin gastar API. El resultado se sube a MC y el
 * dashboard lo muestra igual que los briefings generados por API.
 *
 *   npm run briefing                              → pulso diario (technical)
 *   npm run briefing -- --flavor executive        → briefing ejecutivo del portfolio
 *   npm run briefing -- --project salariojusto    → briefing de un proyecto (technical)
 *   npm run briefing -- --project X --flavor executive
 *   opciones: --model sonnet|opus|haiku (default sonnet)
 *             --dry       imprime el prompt y no llama a Claude
 *             --no-upload genera pero no sube a MC
 *
 * Requiere: `claude` en el PATH con sesión iniciada (suscripción), y en
 * agent/.env.local MC_API_URL, MC_API_KEY, MACHINE_ID.
 * Si hay ANTHROPIC_API_KEY en el entorno se ignora a propósito: queremos
 * que la generación vaya contra la suscripción.
 */

import "dotenv/config";
import { spawn } from "node:child_process";

import { McClient } from "./lib/mc-client.js";
import {
  CTX, systemPromptFor, aggregateProject, isArchived, buildUserPrompt,
} from "../api/_lib/briefing-prompts.js";
import {
  TECHNICAL_SYSTEM_PROMPT as PROJECT_TECHNICAL,
  EXECUTIVE_SYSTEM_PROMPT as PROJECT_EXECUTIVE,
  buildUserPrompt as buildProjectPrompt,
  CRUMBS_LIMIT,
} from "../api/briefing/_handlers/project.js";

const MC_API_URL = process.env.MC_API_URL;
const MC_API_KEY = process.env.MC_API_KEY;
const MACHINE_ID = process.env.MACHINE_ID || "desconocida";

function arg(name, def) {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith("--") ? process.argv[i + 1] : def;
}
const flags = new Set(process.argv.slice(2).filter((a) => a.startsWith("--")));
const FLAVOR = arg("--flavor", "technical") === "executive" ? "executive" : "technical";
const PROJECT_ID = arg("--project", null);
const MODEL = arg("--model", "sonnet");
const DRY = flags.has("--dry");
const NO_UPLOAD = flags.has("--no-upload");

if (!MC_API_URL || !MC_API_KEY) {
  console.error("Faltan MC_API_URL o MC_API_KEY en agent/.env.local.");
  process.exit(1);
}

const mc = new McClient({ baseUrl: MC_API_URL, apiKey: MC_API_KEY });

// ---------------------------------------------------------------------------

async function buildDaily() {
  const ctx = CTX[FLAVOR];
  const [projects, pulseRes] = await Promise.all([mc.listarProyectos(), mc.pulso().catch(() => ({ machines: {}, due: [] }))]);
  const active = projects.filter((p) => !isArchived(p));
  const aggregated = [];
  for (const p of active) {
    const crumbs = await mc.crumbsDeProyecto(p.id);
    aggregated.push(aggregateProject(p, crumbs, ctx));
  }
  return {
    kind: "daily",
    system: systemPromptFor(FLAVOR),
    user: buildUserPrompt(aggregated, FLAVOR, { pulses: pulseRes.machines, due: pulseRes.due }),
    projectCount: active.length,
  };
}

async function buildProject(projectId) {
  const [project, crumbs, files] = await Promise.all([
    mc.proyecto(projectId),
    mc.crumbsDeProyecto(projectId),
    mc.ficherosDeProyecto(projectId),
  ]);
  if (!project) throw new Error(`Proyecto "${projectId}" no existe en MC`);
  const contextFile = files.find((f) => f.name === "CONTEXT.md") || null;
  return {
    kind: "project",
    projectId,
    projectName: project.name,
    system: FLAVOR === "executive" ? PROJECT_EXECUTIVE : PROJECT_TECHNICAL,
    user: buildProjectPrompt(project, crumbs.slice(0, CRUMBS_LIMIT), contextFile, FLAVOR),
  };
}

// Ejecuta `claude -p` con el prompt por stdin y devuelve { markdown, usage, model, durationMs }.
function runClaude(system, user) {
  return new Promise((resolve, reject) => {
    const env = { ...process.env };
    delete env.ANTHROPIC_API_KEY; // forzar suscripción
    const args = [
      "-p",
      "--output-format", "json",
      "--model", MODEL,
      "--system-prompt", system,
      "--tools", "",
      "--no-session-persistence",
    ];
    const startedAt = Date.now();
    const child = spawn("claude", args, { env, stdio: ["pipe", "pipe", "pipe"] });
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => { out += d; });
    child.stderr.on("data", (d) => { err += d; });
    child.on("error", (e) => reject(new Error(`No se pudo ejecutar \`claude\`: ${e.message}. ¿Está instalado y en el PATH?`)));
    child.on("close", (code) => {
      if (code !== 0) return reject(new Error(`claude -p terminó con código ${code}: ${err.trim().slice(0, 500)}`));
      let json;
      try { json = JSON.parse(out); } catch { return reject(new Error(`Salida no JSON de claude -p: ${out.slice(0, 300)}`)); }
      if (json.is_error) return reject(new Error(`claude -p devolvió error: ${json.result || ""}`));
      const usage = json.usage || {};
      const models = Object.entries(json.modelUsage || {});
      models.sort((a, b) => ((b[1].outputTokens || 0) - (a[1].outputTokens || 0)));
      resolve({
        markdown: String(json.result || "").trim(),
        usage: {
          inputTokens: (usage.input_tokens || 0) + (usage.cache_read_input_tokens || 0) + (usage.cache_creation_input_tokens || 0),
          outputTokens: usage.output_tokens || 0,
        },
        model: models[0]?.[0] || `claude-code:${MODEL}`,
        durationMs: Date.now() - startedAt,
      });
    });
    child.stdin.end(user);
  });
}

async function main() {
  const spec = PROJECT_ID ? await buildProject(PROJECT_ID) : await buildDaily();
  const label = spec.kind === "project" ? `proyecto ${spec.projectName} (${FLAVOR})` : `portfolio (${FLAVOR})`;
  console.error(`Briefing ${label} · modelo ${MODEL} · prompt ${spec.user.length} chars · vía suscripción`);

  if (DRY) {
    console.log("=== SYSTEM ===\n" + spec.system + "\n\n=== USER ===\n" + spec.user);
    return;
  }

  const gen = await runClaude(spec.system, spec.user);
  if (!gen.markdown) throw new Error("Claude devolvió un briefing vacío");
  console.log(gen.markdown);
  console.error(`\n(${gen.model} · ${gen.usage.inputTokens} in / ${gen.usage.outputTokens} out · ${Math.round(gen.durationMs / 1000)} s)`);

  if (NO_UPLOAD) { console.error("(--no-upload: no se sube a MC)"); return; }
  const saved = await mc.ingestarBriefing({
    kind: spec.kind,
    projectId: spec.projectId,
    flavor: FLAVOR,
    markdown: gen.markdown,
    model: gen.model,
    generatedAt: new Date().toISOString(),
    durationMs: gen.durationMs,
    projectCount: spec.projectCount,
    machine: MACHINE_ID,
    usage: gen.usage,
  });
  console.error(`Subido a MC como briefing ${saved.kind} (${saved.generatedAt}).`);
}

main().catch((err) => {
  console.error("Error:", err.message || err);
  process.exit(1);
});
