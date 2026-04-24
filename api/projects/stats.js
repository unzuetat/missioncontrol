import { getAllProjects, getProjectCrumbs, getKv } from '../_lib/kv.js';
import { checkAuth, setCors } from '../_lib/auth.js';
import { parseGithubUrl, compareBranches, openPullRequests } from '../_lib/github.js';

const CACHE_KEY = 'stats:projects:v1';
const CACHE_TTL_SECONDS = 300;

function parseAgentTitle(title) {
  const uncommittedM = /(\d+)\s*cambios locales/.exec(title || '');
  const unpushedM = /(\d+)\s*commits?\s*sin pushear/.exec(title || '');
  return {
    uncommitted: uncommittedM ? parseInt(uncommittedM[1], 10) : 0,
    ahead: unpushedM ? parseInt(unpushedM[1], 10) : 0,
  };
}

async function machinesForProject(projectId) {
  const crumbs = await getProjectCrumbs(projectId, 30);
  const byMachine = new Map();
  for (const c of crumbs) {
    const src = c.source || '';
    if (!src.startsWith('agent:')) continue;
    const id = src.slice('agent:'.length);
    if (byMachine.has(id)) continue;
    const { uncommitted, ahead } = parseAgentTitle(c.title);
    if (uncommitted === 0 && ahead === 0) continue;
    byMachine.set(id, { id, ahead, uncommitted, timestamp: c.timestamp });
  }
  return [...byMachine.values()];
}

async function buildStats() {
  const all = await getAllProjects();
  // Archivados no gastan llamadas a GitHub.
  const projects = all.filter((p) => p.status !== 'archivado' && p.status !== 'archived');
  const entries = await Promise.all(projects.map(async (p) => {
    const gh = parseGithubUrl(p.repoUrl);
    const [prodVsTest, prs, machines] = await Promise.all([
      gh && p.testBranch && p.prodBranch && p.testBranch !== p.prodBranch
        ? compareBranches(gh.owner, gh.repo, p.prodBranch, p.testBranch).catch(() => null)
        : null,
      gh ? openPullRequests(gh.owner, gh.repo).catch(() => null) : null,
      machinesForProject(p.id).catch(() => []),
    ]);
    return [p.id, {
      aheadProd: prodVsTest ? prodVsTest.ahead : null,
      openPrs: prs ? prs.count : null,
      openPrDetails: prs ? prs.items : null,
      machines,
    }];
  }));
  return Object.fromEntries(entries);
}

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  if (!checkAuth(req)) return res.status(401).json({ error: 'Unauthorized' });

  const force = req.query?.refresh === '1';
  const kv = await getKv();

  if (!force) {
    const cached = await kv.get(CACHE_KEY);
    if (cached) {
      try {
        return res.status(200).json(JSON.parse(cached));
      } catch {}
    }
  }

  try {
    const stats = await buildStats();
    const payload = { stats, fetchedAt: new Date().toISOString(), hasGithubToken: !!process.env.GITHUB_TOKEN };
    await kv.setEx(CACHE_KEY, CACHE_TTL_SECONDS, JSON.stringify(payload));
    return res.status(200).json(payload);
  } catch (err) {
    console.error('stats error:', err);
    return res.status(500).json({ error: err.message || 'Failed to build stats' });
  }
}
