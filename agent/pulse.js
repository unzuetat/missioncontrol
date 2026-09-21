#!/usr/bin/env node
/**
 * Pulso git de Mission Control.
 *
 * Recorre los repos de ~/Projects (o PROJECTS_DIR), saca la foto git exacta de
 * cada uno (ahead/behind, commits sin push, cambios sin commit, ramas que
 * bifurcan, ramas solo en local o solo en remoto, PRs abiertas, test vs prod)
 * y la sube a Mission Control etiquetada con MACHINE_ID. Sin IA: solo datos.
 *
 *   npm run pulse                    → recolecta (en paralelo) y sube
 *   npm run pulse -- --only <dir>    → solo ese repo: lo fusiona en el pulso ya subido (≈2 s)
 *   npm run pulse -- --json          → además imprime el JSON
 *   npm run pulse -- --dry           → no sube, solo imprime resumen (y JSON con --json)
 *
 * Requiere en agent/.env.local: MC_API_URL, MC_API_KEY, MACHINE_ID
 * (PROJECTS_DIR opcional). Lo lanza launchd a diario y /export-mc al cerrar
 * una sesión; también puedes ejecutarlo a mano.
 */

import "dotenv/config";
import { homedir } from "node:os";
import { join } from "node:path";
import { readdirSync } from "node:fs";
import { pathToFileURL, fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";
import { dirname, resolve } from "node:path";

import { gitPulse, isGitRepo } from "./lib/git.js";
import { McClient } from "./lib/mc-client.js";
import { slugify, normalizeRepoUrl, gitRemoteUrl } from "./lib/project-match.js";

const MC_API_URL = process.env.MC_API_URL;
const MC_API_KEY = process.env.MC_API_KEY;
const MACHINE_ID = process.env.MACHINE_ID || "desconocida";
const PROJECTS_DIR = process.env.PROJECTS_DIR || join(homedir(), "Projects");

const args = new Set(process.argv.slice(2));
const DRY = args.has("--dry");
const PRINT_JSON = args.has("--json");
const ONLY = (() => { const i = process.argv.indexOf("--only"); return i >= 0 ? resolve(process.argv[i + 1] || ".") : null; })();
const CONCURRENCY = Math.max(1, parseInt(process.env.PULSE_CONCURRENCY || "6", 10) || 6);
const WORKER = resolve(dirname(fileURLToPath(import.meta.url)), "lib/pulse-worker.js");


const IGNORAR = new Set(["node_modules", "venv", ".git", "dist", "build", ".next", ".vercel"]);

function matchProject(folder, remoteUrl, projects) {
  const norm = normalizeRepoUrl(remoteUrl);
  if (norm) {
    const byUrl = projects.filter((p) => normalizeRepoUrl(p.repoUrl) === norm);
    if (byUrl.length === 1) return byUrl[0];
  }
  const slug = slugify(folder);
  return projects.find((p) => p.id === slug) || null;
}

function resumen(p) {
  const bits = [];
  if (p.ahead > 0) bits.push(`${p.ahead}↑`);
  if (p.behind > 0) bits.push(`${p.behind}↓`);
  if (p.uncommitted > 0) bits.push(`${p.uncommitted} sin commit`);
  if (p.branchesWithoutRemote.length) bits.push(`${p.branchesWithoutRemote.length} rama(s) solo local`);
  if (p.divergingBranches.length) bits.push(`${p.divergingBranches.length} sin fusionar`);
  if (p.prs.length) bits.push(`${p.prs.length} PR`);
  if (p.testVsProd && p.testVsProd.ahead > 0) bits.push(`test +${p.testVsProd.ahead}`);
  return bits.length ? bits.join(" · ") : "limpio";
}

function runWorker(dir, meta) {
  return new Promise((resolvePulse) => {
    const w = new Worker(WORKER, { workerData: { dir, meta } });
    w.once("message", (m) => resolvePulse(m.ok ? m.pulse : null));
    w.once("error", () => resolvePulse(null));
  });
}

function toEntry(folder, dir, project, pulse) {
  return {
    id: project?.id || null,
    name: project?.name || folder,
    folder,
    dir,
    status: project?.status || "",
    ...pulse,
  };
}

export function listRepoFolders(projectsDir = PROJECTS_DIR) {
  return readdirSync(projectsDir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !IGNORAR.has(e.name) && !e.name.startsWith("."))
    .map((e) => e.name)
    .sort((a, b) => a.localeCompare(b))
    .filter((f) => isGitRepo(join(projectsDir, f)));
}

// Pulso de UN repo (síncrono, ~1-2 s). Lo usan --only y agent/export.js.
export function pulseOne(dir, projects = [], machine = MACHINE_ID) {
  const folder = dir.replace(/\/$/, "").split("/").pop();
  const project = matchProject(folder, gitRemoteUrl(dir), projects);
  const pulse = gitPulse(dir, { prodBranch: project?.prodBranch, testBranch: project?.testBranch });
  return pulse ? toEntry(folder, dir, project, pulse) : null;
}

// Recolecta el pulso de todos los repos en paralelo (worker_threads).
// `projects` = lista de MC (para ramas prod/test e ids); `log` = progreso (o null).
export async function collectPulse({ projects = [], projectsDir = PROJECTS_DIR, machine = MACHINE_ID, log = null, concurrency = CONCURRENCY } = {}) {
  const startedAt = Date.now();
  const folders = listRepoFolders(projectsDir);
  const out = new Array(folders.length);
  let next = 0;
  async function lane() {
    while (next < folders.length) {
      const i = next++;
      const folder = folders[i];
      const dir = join(projectsDir, folder);
      const project = matchProject(folder, gitRemoteUrl(dir), projects);
      const pulse = await runWorker(dir, { prodBranch: project?.prodBranch, testBranch: project?.testBranch });
      if (!pulse) continue;
      out[i] = toEntry(folder, dir, project, pulse);
      if (log) log(`  · ${out[i].name.padEnd(28)} ${out[i].branch.padEnd(28)} ${resumen(out[i])}`);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, folders.length) }, lane));
  return {
    machine,
    generatedAt: new Date().toISOString(),
    projectsDir,
    durationMs: Date.now() - startedAt,
    projects: out.filter(Boolean),
  };
}

// Fusiona el pulso de un repo en el último pulso subido de esta máquina
// (lectura + escritura; si no había pulso previo, sube solo ese repo).
export async function uploadPulseOne(mc, entry, machine = MACHINE_ID) {
  const current = await mc.pulso().catch(() => ({ machines: {} }));
  const prev = current.machines?.[machine];
  const projects = (prev?.projects || []).filter((p) => p.folder !== entry.folder);
  projects.push(entry);
  projects.sort((a, b) => a.folder.localeCompare(b.folder));
  const payload = { machine, generatedAt: new Date().toISOString(), projectsDir: prev?.projectsDir || PROJECTS_DIR, durationMs: 0, projects };
  return mc.enviarPulso(payload);
}

async function main() {
  console.log(`[${new Date().toISOString()}] Pulso git desde "${MACHINE_ID}" · ${PROJECTS_DIR}`);

  const mc = new McClient({ baseUrl: MC_API_URL, apiKey: MC_API_KEY });
  let projects = [];
  try {
    projects = await mc.listarProyectos();
  } catch (err) {
    console.error(`No se pudo leer la lista de proyectos de MC (${err.message}); sigo sin metadatos de ramas.`);
  }

  if (ONLY) {
    const entry = pulseOne(ONLY, projects);
    if (!entry) { console.error(`${ONLY} no es un repo git`); process.exit(1); }
    console.log(`  · ${entry.name.padEnd(28)} ${entry.branch.padEnd(28)} ${resumen(entry)}`);
    if (PRINT_JSON) console.log(JSON.stringify(entry, null, 2));
    if (DRY) { console.log("(--dry: no se sube)"); return; }
    const res = await uploadPulseOne(mc, entry);
    console.log(`Fusionado en el pulso de "${MACHINE_ID}": ${res.projects} proyectos (${res.generatedAt})`);
    return;
  }

  const payload = await collectPulse({ projects, log: (l) => console.log(l) });
  const out = payload.projects;

  if (PRINT_JSON) console.log(JSON.stringify(payload, null, 2));

  const alertas = out.filter((p) => resumen(p) !== "limpio").length;
  console.log(`\n${out.length} repos · ${alertas} con algo pendiente · ${payload.durationMs} ms`);

  if (DRY) { console.log("(--dry: no se sube)"); return; }
  const res = await mc.enviarPulso(payload);
  console.log(`Subido a MC: ${res.projects} proyectos (${res.generatedAt})`);
}

const isEntrypoint = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isEntrypoint) {
  if (!MC_API_URL || !MC_API_KEY) {
    console.error("Faltan MC_API_URL o MC_API_KEY en agent/.env.local.");
    process.exit(1);
  }
  main().catch((err) => {
    console.error("Error fatal:", err.message || err);
    process.exit(1);
  });
}
