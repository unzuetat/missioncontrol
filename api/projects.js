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
    const { name, description, status, color } = req.body || {};
    if (!name) {
      return res.status(400).json({ error: 'name is required' });
    }

    const kv = getKv();
    const id = name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '');

    const project = {
      name,
      description: description || '',
      status: status || 'idea',
      color: color || '#888888',
    };

    await kv.sadd(keys.projectSet, id);
    await kv.hset(keys.project(id), project);

    return res.status(201).json({ project: { id, ...project } });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
