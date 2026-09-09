#!/usr/bin/env node
/**
 * Pulso git de Mission Control.
 *
 * Recorre los repos de ~/Projects (o PROJECTS_DIR), saca la foto git exacta de
 * cada uno (ahead/behind, commits sin push, cambios sin commit, ramas que
 * bifurcan, ramas solo en local o solo en remoto, PRs abiertas, test vs prod)
 * y la sube a Mission Control etiquetada con MACHINE_ID. Sin IA: solo datos.
 *
 *   npm run pulse              → recolecta y sube
 *   npm run pulse -- --json    → además imprime el JSON
 *   npm run pulse -- --dry     → no sube, solo imprime resumen (y JSON con --json)
 *
 * Requiere en agent/.env.local: MC_API_URL, MC_API_KEY, MACHINE_ID
 * (PROJECTS_DIR opcional). Lo lanza launchd a diario y /export-mc al cerrar
 * una sesión; también puedes ejecutarlo a mano.
 */

import "dotenv/config";
import { homedir } from "node:os";
import { join } from "node:path";
import { readdirSync } from "node:fs";
import { pathToFileURL } from "node:url";

import { gitPulse, isGitRepo } from "./lib/git.js";
import { McClient, slugify } from "./lib/mc-client.js";

const MC_API_URL = process.env.MC_API_URL;
const MC_API_KEY = process.env.MC_API_KEY;
const MACHINE_ID = process.env.MACHINE_ID || "desconocida";
const PROJECTS_DIR = process.env.PROJECTS_DIR || join(homedir(), "Projects");

const args = new Set(process.argv.slice(2));
const DRY = args.has("--dry");
const PRINT_JSON = args.has("--json");


const IGNORAR = new Set(["node_modules", "venv", ".git", "dist", "build", ".next", ".vercel"]);

function normalizeRepoUrl(url) {
  return String(url || "")
    .trim()
    .toLowerCase()
    .replace(/^git@github\.com:/, "github.com/")
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\.git$/, "")
    .replace(/\/$/, "");
}

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

// Recolecta el pulso de todos los repos. `projects` = lista de MC (para ramas
// prod/test e ids); `log` = función para imprimir progreso (o null).
export function collectPulse({ projects = [], projectsDir = PROJECTS_DIR, machine = MACHINE_ID, log = null } = {}) {
  const startedAt = Date.now();
  const folders = readdirSync(projectsDir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !IGNORAR.has(e.name) && !e.name.startsWith("."))
    .map((e) => e.name)
    .sort((a, b) => a.localeCompare(b));

  const out = [];
  for (const folder of folders) {
    const dir = join(projectsDir, folder);
    if (!isGitRepo(dir)) continue;
    const remoteUrl = gitPulseRemote(dir);
    const project = matchProject(folder, remoteUrl, projects);
    const pulse = gitPulse(dir, { prodBranch: project?.prodBranch, testBranch: project?.testBranch });
    if (!pulse) continue;
    const entry = {
      id: project?.id || null,
      name: project?.name || folder,
      folder,
      dir,
      status: project?.status || "",
      ...pulse,
    };
    out.push(entry);
    if (log) log(`  · ${entry.name.padEnd(28)} ${entry.branch.padEnd(28)} ${resumen(entry)}`);
  }

  return {
    machine,
    generatedAt: new Date().toISOString(),
    projectsDir,
    durationMs: Date.now() - startedAt,
    projects: out,
  };
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

  const payload = collectPulse({ projects, log: (l) => console.log(l) });
  const out = payload.projects;

  if (PRINT_JSON) console.log(JSON.stringify(payload, null, 2));

  const alertas = out.filter((p) => resumen(p) !== "limpio").length;
  console.log(`\n${out.length} repos · ${alertas} con algo pendiente · ${payload.durationMs} ms`);

  if (DRY) { console.log("(--dry: no se sube)"); return; }
  const res = await mc.enviarPulso(payload);
  console.log(`Subido a MC: ${res.projects} proyectos (${res.generatedAt})`);
}

// Pequeño helper para no recalcular todo el pulso solo para el remoto.
import { execSync } from "node:child_process";
function gitPulseRemote(dir) {
  try {
    return execSync("git config --get remote.origin.url", { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return "";
  }
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
