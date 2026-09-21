#!/usr/bin/env node
/**
 * Exportar una sesión a Mission Control en dos pasos rápidos.
 *
 *   node agent/export.js --check --dir <repo>
 *     Detecta el proyecto, hace el pre-flight git, y resume lo que el modelo
 *     necesita para escribir el delta (secciones actuales del CONTEXT.md,
 *     últimos crumbs, revisiones pendientes). Salida ≈ 2 KB. Códigos de salida:
 *       0 ok · 2 proyecto ambiguo (elige id) · 3 git divergido (abortar)
 *
 *   node agent/export.js --apply <delta.json> --dir <repo> [--dry]
 *     Aplica el delta: metadatos, crumbs (+ revisiones con fecha), CONTEXT.md
 *     fusionado por secciones (snapshot y sección "Git a <fecha>" automáticas),
 *     copia local docs/CONTEXT.md, DEPLOY_STATUS.md automático y pulso git de
 *     este repo. Todo en ≈ 5 s.
 *
 * Formato del delta (todo opcional salvo lo que quieras cambiar):
 * {
 *   "projectId": "…",                       // si --check devolvió ambigüedad
 *   "meta": { "testBranch": "…", "prodUrl": "…" },
 *   "crumbs": [ { "title": "…", "body": "…", "timestamp": "ISO?" , "isIdea": false } ],
 *   "reviews": [ { "title": "Leer GSC del lote 3", "body": "…", "dueAt": "2026-10-01" } ],
 *   "context": { "Estado actual — pendiente": "texto", "Estado actual — funciona": { "append": "- …" } },
 *   "snapshotNote": "qué hubo en la sesión (una frase)",
 *   "deployNotes": "texto libre que se antepone al DEPLOY_STATUS automático"
 * }
 */

import "dotenv/config";
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";

import { McClient } from "./lib/mc-client.js";
import { matchProject, gitRemoteUrl } from "./lib/project-match.js";
import { applyPatch, getSection, listSections } from "./lib/context-md.js";
import { gitPulse } from "./lib/git.js";
import { pulseOne, uploadPulseOne } from "./pulse.js";

const MC_URL = process.env.MC_API_URL || "https://missioncontrol-coral.vercel.app";
const MACHINE_ID = process.env.MACHINE_ID || "desconocida";
const HEADER = `<!-- mission-control: copia local de CONTEXT.md · fuente: ${MC_URL} · no editar aquí, usa /export-mc -->\n\n`;

const argv = process.argv.slice(2);
const flag = (n) => argv.includes(n);
const opt = (n, d) => { const i = argv.indexOf(n); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : d; };
const DIR = resolve(opt("--dir", process.cwd()));
const DRY = flag("--dry");
const today = () => new Date().toISOString().slice(0, 10);

function sh(cmd, { ok = "" } = {}) {
  try { return execSync(cmd, { cwd: DIR, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 30000 }).trim(); } catch { return ok; }
}

function mc() {
  if (!process.env.MC_API_URL || !process.env.MC_API_KEY) { console.error("Faltan MC_API_URL o MC_API_KEY en agent/.env.local"); process.exit(1); }
  return new McClient({ baseUrl: process.env.MC_API_URL, apiKey: process.env.MC_API_KEY });
}

// ---------------------------------------------------------------------------

function gitState() {
  const isRepo = sh("git rev-parse --is-inside-work-tree") === "true";
  if (!isRepo) return { isRepo: false };
  sh("git fetch --quiet");
  const branch = sh("git branch --show-current");
  const upstream = sh("git rev-parse --abbrev-ref @{upstream}");
  const ahead = upstream ? parseInt(sh("git rev-list --count @{upstream}..HEAD", { ok: "0" }), 10) : null;
  const behind = upstream ? parseInt(sh("git rev-list --count HEAD..@{upstream}", { ok: "0" }), 10) : null;
  const status = sh("git status --porcelain").split("\n").filter(Boolean);
  const unpushed = ahead > 0 ? sh("git log @{upstream}..HEAD --oneline -10").split("\n").filter(Boolean) : [];
  let verdict = "✅ limpio";
  if (behind > 0) verdict = "🔴 DIVERGENCIA: hay commits remotos sin pull → aborta y haz git pull antes";
  else if (ahead > 0) verdict = "🟡 commits locales sin push";
  else if (status.length) verdict = "⚠️ solo archivos sin commit";
  return { isRepo: true, branch, upstream, ahead, behind, status, unpushed, verdict, notMain: branch && !["main", "master"].includes(branch) };
}

async function detect(client, explicitId) {
  const projects = await client.listarProyectosBare();
  if (explicitId) {
    const p = projects.find((x) => x.id === explicitId);
    if (!p) { console.error(`projectId "${explicitId}" no existe en MC`); process.exit(2); }
    return { project: p, reason: "projectId explícito", candidates: [] };
  }
  return matchProject(DIR, projects);
}

function tail(text, n) { const l = String(text || "").trim().split("\n"); return l.slice(-n).join("\n"); }

// ---------------------------------------------------------------------------

async function check() {
  const client = mc();
  const det = await detect(client, opt("--project", null));
  if (!det.project) {
    console.log(`PROYECTO: ambiguo (${det.reason}) · cwd ${DIR} · remoto ${gitRemoteUrl(DIR) || "sin remoto"}`);
    console.log("CANDIDATOS:");
    for (const c of det.candidates) console.log(`  - ${c.id}: ${c.name} (${c.repoUrl || "sin repo"})`);
    console.log("→ pregunta al usuario qué id usar (o 'nuevo') y repite --check --project <id>");
    process.exit(2);
  }
  // git fetch y las lecturas de MC en paralelo (ambas son red).
  const [p, g, files, crumbs, pulseRes] = await Promise.all([
    client.proyecto(det.project.id).catch(() => det.project),
    Promise.resolve().then(gitState),
    client.ficherosDeProyecto(det.project.id),
    client.crumbsDeProyecto(det.project.id, 6),
    client.pulso().catch(() => ({ due: [] })),
  ]);
  const ctx = files.find((f) => f.name === "CONTEXT.md");
  const due = (pulseRes.due || []).filter((c) => c.projectId === p.id);

  console.log(`PROYECTO: ${p.id} · ${p.name} · ${p.status} · match por ${det.reason}`);
  console.log(`META: prod=${p.prodUrl || "—"} (${p.prodBranch || "—"}) · test=${p.testUrl || "—"} (${p.testBranch || "—"}) · stack=${p.techStack || "—"}`);
  if (!g.isRepo) console.log("GIT: no es un repo git (se omiten pre-flight, docs/CONTEXT.md y pulso)");
  else {
    console.log(`GIT: rama ${g.branch || "(detached)"}${g.upstream ? ` → ${g.upstream}` : " (sin upstream)"} · ahead ${g.ahead ?? "?"} · behind ${g.behind ?? "?"} · sin commit ${g.status.length}${g.notMain ? " · NO es main" : ""}`);
    if (g.status.length) console.log("  sin commit: " + g.status.slice(0, 12).join(" | ") + (g.status.length > 12 ? ` … (+${g.status.length - 12})` : ""));
    if (g.unpushed.length) console.log("  sin push:   " + g.unpushed.join(" | "));
    console.log(`  VEREDICTO: ${g.verdict}`);
  }
  if (ctx) {
    console.log(`CONTEXT.md (MC ${ctx.content.length} chars, ${String(ctx.updatedAt).slice(0, 10)}): ${listSections(ctx.content).map((s) => `${s.title} (${s.chars})`).join(" · ")}`);
    const pend = getSection(ctx.content, "Estado actual — pendiente");
    const func = getSection(ctx.content, "Estado actual — funciona");
    if (pend) console.log(`--- pendiente actual ---\n${pend}`);
    if (func) console.log(`--- funciona (últimas 5 líneas) ---\n${tail(func, 5)}`);
  } else {
    console.log("CONTEXT.md: no existe en MC → el delta debe traer al menos: Qué es, Tech stack, Estado actual — funciona, Estado actual — pendiente, Decisiones importantes, URLs");
  }
  console.log(`ÚLTIMOS CRUMBS: ` + (crumbs.slice(0, 4).map((c) => `${String(c.timestamp).slice(0, 10)} ${c.title}`).join(" · ") || "ninguno"));
  console.log(`REVISIONES PENDIENTES: ` + (due.map((c) => `${String(c.dueAt).slice(0, 10)} ${c.title}`).join(" · ") || "ninguna"));
  console.log(`DEPLOY: ${p.prodBranch && p.testBranch && p.prodBranch !== p.testBranch ? `test ${p.testBranch} vs prod ${p.prodBranch} → DEPLOY_STATUS.md automático desde git log` : "sin par test/prod distinto → DEPLOY_STATUS.md automático 'sincronizadas' (o se omite si no hay ramas)"}`);
  console.log(`DELTA: escribe /tmp/mc-export-${p.id}.json y ejecuta --apply (ver formato en la cabecera de agent/export.js)`);
  if (g.isRepo && g.behind > 0) process.exit(3);
}

// ---------------------------------------------------------------------------

function gitSectionBody(entry) {
  const lines = [];
  lines.push(`- Rama actual: \`${entry.branch}\`${entry.upstream ? ` → \`${entry.upstream}\`` : " (sin upstream)"} · HEAD \`${entry.lastCommit?.hash}\` ${String(entry.lastCommit?.date || "").slice(0, 10)} — ${entry.lastCommit?.subject || ""}`);
  lines.push(`- Sin push: ${entry.ahead ?? "?"} · por detrás del remoto: ${entry.behind ?? "?"} · sin commit: ${entry.uncommitted} (${entry.untracked} sin seguimiento)`);
  if (entry.unpushedCommits?.length) lines.push(`- Commits sin push: ${entry.unpushedCommits.map((c) => `${c.hash} ${c.subject}`).join("; ")}`);
  if (entry.branchesWithoutRemote?.length) lines.push(`- Ramas solo en local: ${entry.branchesWithoutRemote.join(", ")}`);
  if (entry.divergingBranches?.length) lines.push(`- Ramas sin fusionar en ${entry.prodBranch || entry.defaultBranch}: ${entry.divergingBranches.slice(0, 8).map((b) => `${b.name} (+${b.aheadOfBase}, ${b.daysSinceCommit ?? "?"} d)`).join(", ")}${entry.divergingBranches.length > 8 ? " …" : ""}`);
  if (entry.prs?.length) lines.push(`- PRs abiertas: ${entry.prs.map((pr) => `#${pr.number} ${pr.title} (${pr.head}→${pr.base})`).join("; ")}`);
  if (entry.testVsProd) lines.push(`- test \`${entry.testBranch}\` vs prod \`${entry.prodBranch}\`: +${entry.testVsProd.ahead} / −${entry.testVsProd.behind}`);
  return lines.join("\n");
}

function deployStatusBody(p, notes) {
  const date = today();
  const head = [`# DEPLOY_STATUS — ${p.name}`, "", `Fecha: ${date} (máquina ${MACHINE_ID}, generado por /export-mc)`, ""];
  if (notes) head.push(String(notes).trim(), "");
  if (p.prodBranch && p.testBranch && p.prodBranch !== p.testBranch) {
    const prodRef = sh(`git rev-parse --verify --quiet origin/${p.prodBranch}`) ? `origin/${p.prodBranch}` : p.prodBranch;
    const testRef = sh(`git rev-parse --verify --quiet origin/${p.testBranch}`) ? `origin/${p.testBranch}` : p.testBranch;
    const ahead = sh(`git log ${prodRef}..${testRef} --pretty=format:"%h %ad %s" --date=short`).split("\n").filter(Boolean);
    const behind = sh(`git rev-list --count ${testRef}..${prodRef}`, { ok: "?" });
    head.push(`## Producción`, `- Rama: \`${p.prodBranch}\`${p.prodUrl ? ` · ${p.prodUrl}` : ""}`, "", `## Test`, `- Rama: \`${p.testBranch}\`${p.testUrl ? ` · ${p.testUrl}` : ""}`, "");
    if (ahead.length === 0) head.push(`## Pendiente de llevar a producción`, "", `Nada: \`${p.testBranch}\` y \`${p.prodBranch}\` están **sincronizadas**${behind !== "0" && behind !== "?" ? ` (prod va ${behind} commits por delante de test)` : ""}.`);
    else head.push(`## Pendiente de llevar a producción (${ahead.length} commits en \`${p.testBranch}\` que no están en \`${p.prodBranch}\`)`, "", ...ahead.map((l) => `- ${l}`), "", behind !== "0" && behind !== "?" ? `Prod tiene además ${behind} commits que no están en test (revisar antes de fusionar).` : "");
  } else {
    head.push(`## Estado`, "", `Sin par test/prod distinto${p.prodBranch ? ` (producción despliega desde \`${p.prodBranch}\`)` : ""}: no hay nada pendiente de promocionar entre ramas.`);
  }
  return head.join("\n").trim() + "\n";
}

async function apply() {
  const file = opt("--apply", null);
  if (!file || !existsSync(file)) { console.error("Uso: --apply <delta.json> --dir <repo>"); process.exit(1); }
  const delta = JSON.parse(readFileSync(file, "utf8"));
  const client = mc();
  const det = await detect(client, delta.projectId || opt("--project", null));
  if (!det.project) { console.error(`Proyecto ambiguo (${det.reason}); pon "projectId" en el delta`); process.exit(2); }
  const p0 = await client.proyecto(det.project.id).catch(() => det.project);
  const out = [];
  const t0 = Date.now();

  // 1) metadatos
  let p = p0;
  if (delta.meta && Object.keys(delta.meta).length && !DRY) {
    p = await client.actualizarProyecto(p0.id, delta.meta);
    out.push(`metadatos: ${Object.keys(delta.meta).join(", ")}`);
  } else if (delta.meta && Object.keys(delta.meta).length) out.push(`metadatos (dry): ${Object.keys(delta.meta).join(", ")}`);

  // 2) crumbs + revisiones
  const now = new Date().toISOString();
  const crumbs = [
    ...(delta.crumbs || []).map((c) => ({ title: c.title, body: c.body || "", source: c.source || "claude-code", timestamp: c.timestamp || now, isIdea: !!c.isIdea })),
    ...(delta.reviews || []).map((r) => ({ title: r.title, body: r.body || "", source: "claude-code", timestamp: r.timestamp || now, isTest: true, dueAt: r.dueAt })),
  ].filter((c) => c.title);
  if (crumbs.length) {
    if (!DRY) await client.crearCrumbs(p.id, crumbs);
    out.push(`crumbs: ${(delta.crumbs || []).length} + ${(delta.reviews || []).length} revisiones con fecha`);
  } else out.push("crumbs: ninguno");

  // 3) CONTEXT.md fusionado + copia local
  const isRepo = sh("git rev-parse --is-inside-work-tree") === "true";
  const files = await client.ficherosDeProyecto(p.id);
  const ctxFile = files.find((f) => f.name === "CONTEXT.md");
  const patch = delta.context || {};
  const entry = isRepo ? pulseOne(DIR, [p]) : null;
  const base = ctxFile ? ctxFile.content : `# ${p.name} — CONTEXT.md\n\n`;
  const { md, applied, created } = applyPatch(base, patch, {
    snapshot: `${today()} · máquina ${MACHINE_ID}${delta.snapshotNote ? ` · ${String(delta.snapshotNote).trim()}` : ""}`,
    gitSection: entry ? { title: `Git a ${today()}`, body: gitSectionBody(entry) } : null,
  });
  if (!DRY) {
    if (ctxFile) await client.actualizarFile({ fileId: ctxFile.id, content: md });
    else await client.crearFile({ projectId: p.id, name: "CONTEXT.md", content: md });
  }
  out.push(`CONTEXT.md: ${ctxFile ? "actualizado" : "creado"} (${md.length} chars) · secciones tocadas: ${[...applied, ...created].join(", ") || "solo snapshot y git"}`);
  if (isRepo) {
    const target = join(DIR, "docs", "CONTEXT.md");
    const existing = existsSync(target) ? readFileSync(target, "utf8") : "";
    if (existing && !existing.startsWith("<!-- mission-control:")) {
      const alt = join(DIR, "docs", "CONTEXT.mc.md");
      if (!DRY) writeFileSync(alt, HEADER + md);
      out.push(`docs/CONTEXT.md es un documento propio del repo: copia guardada como docs/CONTEXT.mc.md`);
    } else {
      if (!DRY) { mkdirSync(join(DIR, "docs"), { recursive: true }); writeFileSync(target, HEADER + md); }
      out.push(DRY ? "docs/CONTEXT.md (dry): no escrito" : "docs/CONTEXT.md: escrito (sin commit)");
    }
  }
  if (DRY && flag("--show")) console.log("\n" + md + "\n");

  // 4) DEPLOY_STATUS.md
  if (p.prodBranch || p.testBranch) {
    const body = deployStatusBody(p, delta.deployNotes);
    const dep = files.find((f) => f.name === "DEPLOY_STATUS.md");
    if (!DRY) {
      if (dep) await client.actualizarFile({ fileId: dep.id, content: body });
      else await client.crearFile({ projectId: p.id, name: "DEPLOY_STATUS.md", content: body });
    }
    out.push(`DEPLOY_STATUS.md: ${dep ? "actualizado" : "creado"} (automático${delta.deployNotes ? " + notas" : ""})`);
  } else out.push("DEPLOY_STATUS.md: omitido (sin ramas prod/test en MC)");

  // 5) pulso de este repo
  if (entry && !DRY) {
    try { const r = await uploadPulseOne(client, entry); out.push(`pulso git: fusionado (${r.projects} repos de ${MACHINE_ID})`); }
    catch (e) { out.push(`pulso git: FALLÓ (${e.message})`); }
  } else if (entry) out.push("pulso git (dry): calculado, no subido");

  console.log(`EXPORT ${DRY ? "(dry) " : ""}${p.name} (${p.id}) · ${Date.now() - t0} ms`);
  for (const l of out) console.log("  - " + l);
  const g = gitState();
  if (g.isRepo) console.log(`  - git: rama ${g.branch}${g.notMain ? " (no es main: retoma con git checkout " + g.branch + " en la otra máquina)" : ""} · ahead ${g.ahead ?? "?"} · sin commit ${g.status.length}`);
}

if (flag("--check")) await check();
else if (opt("--apply", null)) await apply();
else { console.error("Uso: export.js --check --dir <repo> | --apply <delta.json> --dir <repo> [--dry] [--show]"); process.exit(1); }
