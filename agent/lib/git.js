import { execSync } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { join } from "node:path";

function run(cmd, cwd, { timeout = 20000 } = {}) {
  try {
    return execSync(cmd, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout }).trim();
  } catch {
    return "";
  }
}

function toInt(v) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : 0;
}

const DAY_MS = 24 * 60 * 60 * 1000;
function daysSince(iso) {
  const ms = Date.parse(iso);
  if (!ms) return null;
  return Math.max(0, Math.round((Date.now() - ms) / DAY_MS));
}

export function isGitRepo(dir) {
  return run("git rev-parse --is-inside-work-tree", dir) === "true";
}

export function gitSnapshot(dir) {
  if (!isGitRepo(dir)) return null;

  const branch = run("git rev-parse --abbrev-ref HEAD", dir);
  const remoteUrl = run("git config --get remote.origin.url", dir);
  const lastCommit = run('git log -1 --pretty=format:"%h|%ad|%an|%s" --date=iso', dir);
  const [hash, date, author, subject] = lastCommit ? lastCommit.split("|") : ["", "", "", ""];

  // Cambios locales sin commitear.
  const statusOut = run("git status --porcelain", dir);
  const ficherosModificados = statusOut ? statusOut.split("\n").length : 0;

  // Commits locales no pusheados al remoto.
  let commitsNoPusheados = 0;
  const upstream = run(`git rev-parse --abbrev-ref --symbolic-full-name @{u}`, dir);
  if (upstream) {
    const ahead = run("git rev-list --count @{u}..HEAD", dir);
    commitsNoPusheados = parseInt(ahead, 10) || 0;
  }

  // Últimos 5 commits como timeline.
  const log = run('git log -5 --pretty=format:"%h · %ad · %s" --date=short', dir);

  return {
    branch,
    remoteUrl,
    lastCommit: { hash, date, author, subject },
    ficherosModificados,
    commitsNoPusheados,
    logReciente: log,
    diffPorcelain: statusOut,
  };
}

// ---------------------------------------------------------------------------
// Pulso git: foto exacta y exhaustiva de un repo para Mission Control.
// Todo datos, cero interpretación. No toca la red salvo `gh pr list`
// (opcional, con timeout) — no hace fetch: informa de cuándo fue el último.

function refExists(ref, dir) {
  return run(`git rev-parse --verify --quiet ${ref}`, dir) !== "";
}

function detectDefaultBranch(dir) {
  const head = run("git symbolic-ref --quiet --short refs/remotes/origin/HEAD", dir); // origin/main
  if (head) return head.replace(/^origin\//, "");
  for (const b of ["main", "master"]) {
    if (refExists(`origin/${b}`, dir) || refExists(b, dir)) return b;
  }
  return "";
}

function baseRef(branchName, dir) {
  if (!branchName) return "";
  if (refExists(`origin/${branchName}`, dir)) return `origin/${branchName}`;
  if (refExists(branchName, dir)) return branchName;
  return "";
}

function countRange(from, to, dir) {
  if (!from || !to) return null;
  const out = run(`git rev-list --count ${from}..${to}`, dir);
  return out === "" ? null : toInt(out);
}

function listPullRequests(dir, remoteUrl) {
  if (!/github\.com/i.test(remoteUrl || "")) return [];
  const raw = run(
    "gh pr list --state open --limit 20 --json number,title,headRefName,baseRefName,isDraft,updatedAt,statusCheckRollup,reviewDecision",
    dir,
    { timeout: 15000 },
  );
  if (!raw) return [];
  try {
    return JSON.parse(raw).map((pr) => {
      const checks = Array.isArray(pr.statusCheckRollup) ? pr.statusCheckRollup : [];
      const failed = checks.filter((c) => /FAIL|ERROR/i.test(c.conclusion || c.state || "")).length;
      const pending = checks.filter((c) => /PENDING|IN_PROGRESS|QUEUED/i.test(c.status || c.state || "")).length;
      return {
        number: pr.number,
        title: pr.title,
        head: pr.headRefName,
        base: pr.baseRefName,
        draft: !!pr.isDraft,
        updatedAt: pr.updatedAt,
        daysSinceUpdate: daysSince(pr.updatedAt),
        review: pr.reviewDecision || "",
        checks: checks.length ? { total: checks.length, failed, pending } : null,
      };
    });
  } catch {
    return [];
  }
}

/**
 * @param {string} dir  ruta del repo
 * @param {object} meta { prodBranch?, testBranch? } de Mission Control (opcional)
 */
export function gitPulse(dir, meta = {}) {
  if (!isGitRepo(dir)) return null;

  const branch = run("git rev-parse --abbrev-ref HEAD", dir);
  const remoteUrl = run("git config --get remote.origin.url", dir);
  const hasRemote = remoteUrl !== "";
  const defaultBranch = detectDefaultBranch(dir);
  const prodBranch = meta.prodBranch || defaultBranch;
  const testBranch = meta.testBranch || "";

  // Último fetch conocido (sin hacer fetch: no queremos red en cada pulso).
  const fetchHead = join(dir, ".git", "FETCH_HEAD");
  const lastFetchAt = existsSync(fetchHead) ? statSync(fetchHead).mtime.toISOString() : null;

  // Último commit de HEAD.
  const lc = run('git log -1 --pretty=format:"%h|%aI|%an|%s"', dir);
  const [hash, date, author, subject] = lc ? lc.split("|") : ["", "", "", ""];

  // Working tree.
  const statusOut = run("git status --porcelain", dir);
  const statusLines = statusOut ? statusOut.split("\n") : [];
  const untracked = statusLines.filter((l) => l.startsWith("??")).length;
  const uncommitted = statusLines.length;
  let oldestUncommittedDays = null;
  if (uncommitted > 0) {
    // Aproximación: mtime más antiguo entre los ficheros modificados (máx 50).
    let oldest = Date.now();
    for (const l of statusLines.slice(0, 50)) {
      const f = l.slice(3).trim().replace(/^"|"$/g, "").split(" -> ").pop();
      try {
        const m = statSync(join(dir, f)).mtimeMs;
        if (m < oldest) oldest = m;
      } catch { /* borrado o inaccesible */ }
    }
    oldestUncommittedDays = Math.max(0, Math.round((Date.now() - oldest) / DAY_MS));
  }
  const stashes = run("git stash list", dir);
  const stashCount = stashes ? stashes.split("\n").length : 0;

  // HEAD vs upstream.
  const upstream = run("git rev-parse --abbrev-ref --symbolic-full-name @{u}", dir);
  const ahead = upstream ? countRange("@{u}", "HEAD", dir) : null;
  const behind = upstream ? countRange("HEAD", "@{u}", dir) : null;
  const unpushedCommits = upstream && ahead > 0
    ? run('git log @{u}..HEAD --pretty=format:"%h|%aI|%s" -20', dir).split("\n").filter(Boolean).map((l) => {
        const [h, d, ...rest] = l.split("|");
        return { hash: h, date: d, subject: rest.join("|") };
      })
    : [];

  // Ramas locales: upstream, ahead/behind, distancia a la base (prod o default).
  const base = baseRef(prodBranch, dir);
  const branchesRaw = run(
    'git for-each-ref --format="%(refname:short)|%(upstream:short)|%(upstream:track)|%(committerdate:iso-strict)" refs/heads',
    dir,
  );
  const localBranches = [];
  const branchesWithoutRemote = [];
  const divergingBranches = [];
  for (const line of branchesRaw ? branchesRaw.split("\n") : []) {
    const [name, up, track, committerDate] = line.split("|");
    if (!name) continue;
    const gone = /gone/.test(track || "");
    const entry = {
      name,
      upstream: up || "",
      gone,
      lastCommitAt: committerDate || "",
      daysSinceCommit: daysSince(committerDate),
      ahead: up && !gone ? countRange(up, name, dir) : null,
      behind: up && !gone ? countRange(name, up, dir) : null,
      aheadOfBase: base && name !== prodBranch ? countRange(base, name, dir) : null,
      behindBase: base && name !== prodBranch ? countRange(name, base, dir) : null,
    };
    localBranches.push(entry);
    if (hasRemote && (!up || gone)) branchesWithoutRemote.push(name);
    if (entry.aheadOfBase > 0 && name !== prodBranch && name !== defaultBranch) {
      divergingBranches.push({ name, aheadOfBase: entry.aheadOfBase, behindBase: entry.behindBase, daysSinceCommit: entry.daysSinceCommit, hasRemote: !!up && !gone });
    }
  }
  divergingBranches.sort((a, b) => (b.aheadOfBase || 0) - (a.aheadOfBase || 0));

  // Test vs prod (con refs locales de origin/*; frescura = lastFetchAt).
  let testVsProd = null;
  if (testBranch && prodBranch && testBranch !== prodBranch) {
    const t = baseRef(testBranch, dir);
    const p = baseRef(prodBranch, dir);
    if (t && p) testVsProd = { ahead: countRange(p, t, dir), behind: countRange(t, p, dir) };
  }

  // Ramas remotas que no existen en local (trabajo hecho en otra máquina).
  const remoteOnly = [];
  const remoteRaw = run('git for-each-ref --format="%(refname:short)" refs/remotes/origin', dir);
  const localNames = new Set(localBranches.map((b) => b.name));
  for (const r of remoteRaw ? remoteRaw.split("\n") : []) {
    const name = r.replace(/^origin\//, "");
    if (!name || name === "HEAD") continue;
    if (!localNames.has(name)) remoteOnly.push(name);
  }

  const prs = listPullRequests(dir, remoteUrl);

  // Log reciente (para el crumb / briefing).
  const recentLog = run('git log -10 --pretty=format:"%h|%aI|%s"', dir)
    .split("\n").filter(Boolean).map((l) => { const [h, d, ...rest] = l.split("|"); return { hash: h, date: d, subject: rest.join("|") }; });

  return {
    branch,
    remoteUrl,
    hasRemote,
    defaultBranch,
    prodBranch,
    testBranch,
    lastFetchAt,
    daysSinceFetch: lastFetchAt ? daysSince(lastFetchAt) : null,
    lastCommit: { hash, date, author, subject, daysAgo: daysSince(date) },
    upstream,
    ahead,
    behind,
    unpushedCommits,
    uncommitted,
    untracked,
    oldestUncommittedDays,
    stashCount,
    localBranches,
    branchesWithoutRemote,
    divergingBranches,
    remoteOnlyBranches: remoteOnly,
    testVsProd,
    prs,
    recentLog,
  };
}
