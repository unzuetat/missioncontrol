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

  if (req.method === 'GET') {
    const exists = await kv.sIsMember(keys.projectSet, id);
    if (!exists) {
      return res.status(404).json({ error: 'Project not found' });
    }
    const project = await kv.hGetAll(keys.project(id));
    return res.status(200).json({ project: { id, ...project } });
  }

  if (req.method === 'PUT') {
    const exists = await kv.sIsMember(keys.projectSet, id);
    if (!exists) {
      return res.status(404).json({ error: 'Project not found' });
    }

    const updates = {};
    const { name, description, status, color, repoUrl, testUrl, testBranch, prodUrl, prodBranch, techStack,
      // backward compat
      vercelUrl, environment } = req.body || {};
    if (name !== undefined) updates.name = name;
    if (description !== undefined) updates.description = description;
    if (status !== undefined) updates.status = status;
    if (color !== undefined) updates.color = color;
    if (repoUrl !== undefined) updates.repoUrl = repoUrl;
    if (testUrl !== undefined) updates.testUrl = testUrl;
    if (testBranch !== undefined) updates.testBranch = testBranch;
    if (prodUrl !== undefined) updates.prodUrl = prodUrl;
    if (prodBranch !== undefined) updates.prodBranch = prodBranch;
    if (techStack !== undefined) updates.techStack = techStack;
    // Migrate old fields
    if (vercelUrl !== undefined && testUrl === undefined && prodUrl === undefined) {
      if (environment === 'production') updates.prodUrl = vercelUrl;
      else updates.testUrl = vercelUrl;
    }

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
