// Detección del proyecto de Mission Control que corresponde a una carpeta.
// Regla (la misma de /import-mc y /export-mc): match único por repoUrl
// normalizada; si no, por slug de la carpeta; si hay ambigüedad, devolver
// candidatos y que el comando pregunte.

import { execSync } from "node:child_process";
import { basename } from "node:path";

export function slugify(nombre) {
  return String(nombre || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

export function normalizeRepoUrl(url) {
  return String(url || "")
    .trim()
    .toLowerCase()
    .replace(/^git@github\.com:/, "github.com/")
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/+$/, "")
    .replace(/\.git$/, "")
    .replace(/\/+$/, "");
}

export function gitRemoteUrl(dir) {
  try {
    return execSync("git config --get remote.origin.url", { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return "";
  }
}

function levenshtein(a, b) {
  const m = a.length, n = b.length;
  const d = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 1; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++) {
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  }
  return d[m][n];
}

function similar(a, b) {
  a = String(a || "").toLowerCase(); b = String(b || "").toLowerCase();
  if (!a || !b) return false;
  if (a === b) return true;
  if (a.length >= 4 && b.length >= 4 && (a.includes(b) || b.includes(a))) return true;
  return levenshtein(a, b) <= 2;
}

/**
 * @returns {{ project: object|null, reason: string, candidates: object[] }}
 *   project != null → match seguro (auto-usar).
 *   project == null → preguntar; `candidates` lista qué proponer.
 */
export function matchProject(dir, projects, remoteUrl = gitRemoteUrl(dir)) {
  const folder = basename(dir);
  const norm = normalizeRepoUrl(remoteUrl);
  const byUrl = norm ? projects.filter((p) => normalizeRepoUrl(p.repoUrl) === norm) : [];
  const slug = slugify(folder);
  const bySlug = projects.filter((p) => p.id === slug);

  if (byUrl.length === 1) {
    const hit = byUrl[0];
    const lookalikes = projects.filter((p) => p.id !== hit.id && (similar(p.name, hit.name) || similar(p.id, hit.id) || similar(p.name, folder) || similar(p.id, slug)));
    if (lookalikes.length === 0) return { project: hit, reason: "repoUrl", candidates: [] };
    return { project: null, reason: "duplicado latente", candidates: [hit, ...lookalikes] };
  }
  if (byUrl.length > 1) return { project: null, reason: "varios proyectos con la misma repoUrl", candidates: byUrl };
  if (!norm && bySlug.length === 1) return { project: bySlug[0], reason: "slug (sin remoto)", candidates: [] };
  const fuzzy = projects.filter((p) => similar(p.name, folder) || similar(p.id, slug));
  return { project: null, reason: norm ? "sin match por repoUrl" : "sin remoto git", candidates: fuzzy.length ? fuzzy : bySlug };
}
