import { execSync } from "node:child_process";

function run(cmd, cwd) {
  try {
    return execSync(cmd, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  } catch {
    return "";
  }
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
