import { getKv, keys, deleteProjectFull } from '../_lib/kv.js';
import { checkAuth, setCors } from '../_lib/auth.js';

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (!checkAuth(req)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { id } = req.query;
  const kv = await getKv();

  if (req.method === 'PUT') {
    const exists = await kv.sIsMember(keys.projectSet, id);
    if (!exists) {
      return res.status(404).json({ error: 'Project not found' });
    }

    const updates = {};
    const { name, description, status, color, repoUrl, vercelUrl, environment, techStack } = req.body || {};
    if (name !== undefined) updates.name = name;
    if (description !== undefined) updates.description = description;
    if (status !== undefined) updates.status = status;
    if (color !== undefined) updates.color = color;
    if (repoUrl !== undefined) updates.repoUrl = repoUrl;
    if (vercelUrl !== undefined) updates.vercelUrl = vercelUrl;
    if (environment !== undefined) updates.environment = environment;
    if (techStack !== undefined) updates.techStack = techStack;

    if (Object.keys(updates).length > 0) {
      await kv.hSet(keys.project(id), updates);
    }

    const project = await kv.hGetAll(keys.project(id));
    return res.status(200).json({ project: { id, ...project } });
  }

  if (req.method === 'DELETE') {
    await deleteProjectFull(id);
    return res.status(200).json({ ok: true });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
