import { getKv, keys, createCrumb } from './_lib/kv.js';
import { checkAuth, setCors } from './_lib/auth.js';

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (!checkAuth(req)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { projectId, crumbs } = req.body || {};

  if (!projectId || !Array.isArray(crumbs) || crumbs.length === 0) {
    return res.status(400).json({ error: 'projectId and crumbs array are required' });
  }

  const kv = await getKv();
  const exists = await kv.sIsMember(keys.projectSet, projectId);
  if (!exists) {
    return res.status(404).json({ error: 'Project not found' });
  }

  const imported = [];
  for (const c of crumbs) {
    if (!c.title) continue;
    const crumb = await createCrumb({
      projectId,
      title: c.title,
      source: c.source || 'claude-web',
      body: c.body || '',
      timestamp: c.timestamp,
      isIdea: c.isIdea,
    });
    imported.push(crumb);
  }

  return res.status(201).json({ imported: imported.length, crumbs: imported });
}
