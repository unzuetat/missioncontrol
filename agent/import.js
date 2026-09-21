#!/usr/bin/env node
/**
 * Importar el contexto de Mission Control para un repo, en una sola llamada.
 *
 *   node agent/import.js --dir <repo> [--full] [--no-pull]
 *
 * Hace: detección del proyecto, git fetch + pull --ff-only si es seguro,
 * y un digest compacto (≈ 3-4 KB) con lo que hace falta para retomar:
 * metadatos, secciones vivas del CONTEXT.md, últimos crumbs, revisiones
 * pendientes, DEPLOY_STATUS, subrayados y (con --full) el último briefing.
 * Códigos de salida: 0 ok · 2 proyecto ambiguo (elige id y repite --project <id>).
 */

import "dotenv/config";
import { execSync } from "node:child_process";
import { resolve } from "node:path";

import { McClient } from "./lib/mc-client.js";
import { matchProject, gitRemoteUrl } from "./lib/project-match.js";
import { getSection } from "./lib/context-md.js";

const argv = process.argv.slice(2);
const flag = (n) => argv.includes(n);
const opt = (n, d) => { const i = argv.indexOf(n); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : d; };
const DIR = resolve(opt("--dir", process.cwd()));
const FULL = flag("--full");
const NO_PULL = flag("--no-pull");

function sh(cmd, { ok = "" } = {}) {
  try { return execSync(cmd, { cwd: DIR, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 30000 }).trim(); } catch { return ok; }
}
const cut = (s, n) => { s = String(s || "").trim(); return s.length > n ? s.slice(0, n - 1) + "…" : s; };
const head = (text, n) => String(text || "").trim().split("\n").slice(0, n).join("\n");
const tail = (text, n) => String(text || "").trim().split("\n").slice(-n).join("\n");
const d10 = (iso) => String(iso || "").slice(0, 10);

if (!process.env.MC_API_URL || !process.env.MC_API_KEY) { console.error("Faltan MC_API_URL o MC_API_KEY en agent/.env.local"); process.exit(1); }
const mc = new McClient({ baseUrl: process.env.MC_API_URL, apiKey: process.env.MC_API_KEY });

// 0) proyecto
const projects = await mc.listarProyectosBare();
let det;
const explicit = opt("--project", null);
if (explicit) {
  const p = projects.find((x) => x.id === explicit);
  if (!p) { console.error(`projectId "${explicit}" no existe en MC`); process.exit(2); }
  det = { project: p, reason: "projectId explícito" };
} else det = matchProject(DIR, projects);
if (!det.project) {
  console.log(`PROYECTO: ambiguo (${det.reason}) · cwd ${DIR} · remoto ${gitRemoteUrl(DIR) || "sin remoto"}`);
  console.log("CANDIDATOS:");
  for (const c of det.candidates) console.log(`  - ${c.id}: ${c.name} (${c.repoUrl || "sin repo"})`);
  console.log("→ pregunta al usuario qué id usar y repite con --project <id>");
  process.exit(2);
}
const p = det.project;

// 0.5) git sync
const gitLines = [];
const isRepo = sh("git rev-parse --is-inside-work-tree") === "true";
if (isRepo) {
  sh("git fetch --quiet");
  const branch = sh("git branch --show-current");
  const upstream = sh("git rev-parse --abbrev-ref @{upstream}");
  const ahead = upstream ? parseInt(sh("git rev-list --count @{upstream}..HEAD", { ok: "0" }), 10) : null;
  const behind = upstream ? parseInt(sh("git rev-list --count HEAD..@{upstream}", { ok: "0" }), 10) : null;
  const dirty = sh("git status --porcelain").split("\n").filter(Boolean);
  let line = `rama ${branch || "(detached)"}${upstream ? "" : " (sin upstream)"}`;
  if (!upstream) line += " · no se puede sincronizar";
  else if (behind > 0 && ahead === 0 && dirty.length === 0 && !NO_PULL) {
    const before = sh("git rev-parse HEAD");
    const ok = sh("git pull --ff-only --quiet 2>&1 && echo ok");
    if (ok.endsWith("ok")) {
      const titles = sh(`git log ${before}..HEAD --oneline`).split("\n").filter(Boolean);
      line += ` · ✅ pulleados ${titles.length} commits: ${titles.slice(0, 3).join(" | ")}`;
    } else line += ` · ⚠️ pull --ff-only falló (divergencia): resolver a mano`;
  } else if (behind > 0 && ahead > 0) line += ` · 🔴 divergencia: ${ahead} sin push y ${behind} sin pull → decidir merge/rebase antes de tocar nada`;
  else if (behind > 0) line += ` · ⚠️ ${behind} commits remotos sin pull (no pulleo: hay ${dirty.length} archivos sin commit) → git stash && git pull --ff-only && git stash pop, o commit primero`;
  else if (ahead > 0) line += ` · ⚠️ la máquina anterior dejó ${ahead} commits sin push: el CONTEXT.md puede ir por delante del remoto`;
  else line += " · al día";
  if (dirty.length) line += ` · sin commit: ${dirty.slice(0, 6).join(" | ")}${dirty.length > 6 ? ` (+${dirty.length - 6})` : ""}`;
  if (branch && !["main", "master"].includes(branch)) line += " · (no es main)";
  gitLines.push(line);
}

// 1) datos de MC en paralelo
const [meta, files, crumbs, pulseRes, highlights, briefings] = await Promise.all([
  mc.proyecto(p.id).catch(() => p),
  mc.ficherosDeProyecto(p.id),
  mc.crumbsDeProyecto(p.id, FULL ? 8 : 5),
  mc.pulso().catch(() => ({ due: [], machines: {} })),
  mc.subrayados(p.id),
  FULL ? mc.historialBriefings("project", p.id) : Promise.resolve([]),
]);
const ctx = files.find((f) => f.name === "CONTEXT.md")?.content || "";
const dep = files.find((f) => f.name === "DEPLOY_STATUS.md")?.content || "";
const due = (pulseRes.due || []).filter((c) => c.projectId === p.id);
const pulses = Object.entries(pulseRes.machines || {}).map(([m, pl]) => [m, (pl.projects || []).find((x) => x.id === p.id)]).filter(([, x]) => x);

// 2) digest
const L = [];
L.push(`📍 ${meta.name} (${meta.id}) · ${meta.status || "?"} · ${meta.repoUrl || "sin repo"}`);
L.push(`   prod: ${meta.prodUrl || "—"} (${meta.prodBranch || "—"}) · test: ${meta.testUrl || "—"} (${meta.testBranch || "—"}) · stack: ${cut(meta.techStack, 80) || "—"}`);
if (gitLines.length) L.push(`🔧 Git: ${gitLines.join(" ")}`);
for (const [m, x] of pulses) {
  const bits = [];
  if (x.ahead > 0) bits.push(`${x.ahead} sin push`);
  if (x.uncommitted > 0) bits.push(`${x.uncommitted} sin commit`);
  if ((x.branchesWithoutRemote || []).length) bits.push(`ramas solo local: ${x.branchesWithoutRemote.join(", ")}`);
  if ((x.divergingBranches || []).length) bits.push(`sin fusionar: ${x.divergingBranches.slice(0, 4).map((b) => `${b.name} (+${b.aheadOfBase})`).join(", ")}`);
  if ((x.prs || []).length) bits.push(`PRs: ${x.prs.map((pr) => `#${pr.number} ${cut(pr.title, 40)}`).join("; ")}`);
  if (bits.length) L.push(`   pulso ${m} (${d10(pulseRes.machines[m].generatedAt)}): rama ${x.branch} · ${bits.join(" · ")}`);
}
if (ctx) {
  const snap = ctx.split("\n").find((l) => l.startsWith("> Snapshot:"));
  if (snap) L.push(`🧭 ${snap.replace(/^>\s*/, "")}`);
  const que = getSection(ctx, "Qué es"); if (que) L.push(`   ${cut(que.replace(/\n+/g, " "), FULL ? 600 : 320)}`);
  const func = getSection(ctx, "Estado actual — funciona"); if (func) L.push(`✅ Funciona (últimas líneas):\n${tail(func, FULL ? 12 : 6)}`);
  const pend = getSection(ctx, "Estado actual — pendiente"); if (pend) L.push(`⏳ Pendiente:\n${FULL ? pend : head(pend, 10)}`);
  const dec = getSection(ctx, "Decisiones importantes"); if (dec) L.push(`📐 Decisiones${FULL ? "" : " (primeras)"}:\n${FULL ? dec : head(dec, 6)}`);
  if (FULL) { const arch = getSection(ctx, "Arquitectura"); if (arch) L.push(`🏗 Arquitectura:\n${arch}`); }
} else L.push("🧭 Sin CONTEXT.md en MC (primer /export-mc lo creará)");
if (crumbs.length) L.push(`📝 Últimos crumbs:\n` + crumbs.slice(0, FULL ? 8 : 5).map((c) => `   · ${d10(c.timestamp)} — ${c.title}${c.body ? ` — ${cut(c.body.replace(/\n+/g, " "), 160)}` : ""}${c.isDone === "true" ? " ✓" : ""}`).join("\n"));
if (due.length) L.push(`⏰ Revisiones pendientes:\n` + due.map((c) => `   · ${d10(c.dueAt)} — ${c.title}`).join("\n"));
if (dep) L.push(`🚀 Deploy: ${cut(head(dep.replace(/^# .*\n/, "").replace(/\n{2,}/g, " · ").replace(/\n/g, " "), 3), 320)}`);
if (highlights.length) L.push(`📌 Subrayados (${highlights.length}): ` + highlights.slice(0, 3).map((h) => `"${cut(h.text || h.quote || h.content || "", 90)}"`).join(" · "));
if (FULL && briefings.length) { const b = briefings[0]; L.push(`🧠 Último briefing ${b.flavor} ${d10(b.generatedAt)}:\n${head(b.markdown, 12)}`); }
console.log(L.join("\n"));
