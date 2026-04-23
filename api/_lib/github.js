const API = 'https://api.github.com';

export function parseGithubUrl(url) {
  if (!url) return null;
  const m = url.match(/github\.com[/:]([^/]+)\/([^/.\s]+)/);
  if (!m) return null;
  return { owner: m[1], repo: m[2].replace(/\.git$/, '') };
}

function authHeaders() {
  const token = process.env.GITHUB_TOKEN;
  const h = { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

async function ghFetch(path) {
  const r = await fetch(`${API}${path}`, { headers: authHeaders() });
  if (!r.ok) {
    return { ok: false, status: r.status };
  }
  return { ok: true, data: await r.json() };
}

export async function compareBranches(owner, repo, base, head) {
  if (!base || !head) return null;
  const r = await ghFetch(`/repos/${owner}/${repo}/compare/${encodeURIComponent(base)}...${encodeURIComponent(head)}`);
  if (!r.ok) return null;
  return { ahead: r.data.ahead_by || 0, behind: r.data.behind_by || 0 };
}

export async function openPullRequests(owner, repo) {
  const r = await ghFetch(`/repos/${owner}/${repo}/pulls?state=open&per_page=100`);
  if (!r.ok) return null;
  return { count: r.data.length, items: r.data.map(p => ({ number: p.number, title: p.title, url: p.html_url, base: p.base?.ref, head: p.head?.ref })) };
}
