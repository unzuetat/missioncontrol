import { getKv, keys, getAllProjects } from './_lib/kv.js';
import { checkAuth, setCors } from './_lib/auth.js';

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (!checkAuth(req)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  if (req.method === 'GET') {
    const projects = await getAllProjects();
    return res.status(200).json({ projects });
  }

  if (req.method === 'POST') {
    const { name, description, status, color, repoUrl, testUrl, testBranch, prodUrl, prodBranch, techStack,
      // backward compat: accept old fields and migrate
      vercelUrl, environment } = req.body || {};
    if (!name) {
      return res.status(400).json({ error: 'name is required' });
    }

    const kv = await getKv();
    const id = name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '');

    // Migrate old vercelUrl/environment to new dual fields
    let finalTestUrl = testUrl || '';
    let finalProdUrl = prodUrl || '';
    if (vercelUrl && !testUrl && !prodUrl) {
      if (environment === 'production') finalProdUrl = vercelUrl;
      else finalTestUrl = vercelUrl;
    }

    const project = {
      name,
      description: description || '',
      status: status || 'idea',
      color: color || '#888888',
      repoUrl: repoUrl || '',
      testUrl: finalTestUrl,
      testBranch: testBranch || '',
      prodUrl: finalProdUrl,
      prodBranch: prodBranch || '',
      techStack: techStack || '',
    };

    await kv.sAdd(keys.projectSet, id);
    await kv.hSet(keys.project(id), project);

    return res.status(201).json({ project: { id, ...project } });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
