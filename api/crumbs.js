import { getKv, keys, getProjectCrumbs, getRecentCrumbs, createCrumb, updateCrumb } from './_lib/kv.js';
import { checkAuth, setCors } from './_lib/auth.js';

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (!checkAuth(req)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  if (req.method === 'GET') {
    const { projectId } = req.query;
    const crumbs = projectId
      ? await getProjectCrumbs(projectId)
      : await getRecentCrumbs(20);
    return res.status(200).json({ crumbs });
  }

  if (req.method === 'POST') {
    const { projectId, title, source, body, timestamp, isIdea } = req.body || {};
    if (!projectId || !title) {
      return res.status(400).json({ error: 'projectId and title are required' });
    }

    const kv = await getKv();
    const exists = await kv.sIsMember(keys.projectSet, projectId);
    if (!exists) {
      return res.status(404).json({ error: 'Project not found' });
    }

    const crumb = await createCrumb({ projectId, title, source, body, timestamp, isIdea });
    return res.status(201).json({ crumb });
  }

  if (req.method === 'PATCH') {
    const { crumbId, isDone, title, body } = req.body || {};
    if (!crumbId) {
      return res.status(400).json({ error: 'crumbId is required' });
    }
    const fields = {};
    if (isDone !== undefined) fields.isDone = isDone ? 'true' : '';
    if (title !== undefined) fields.title = title;
    if (body !== undefined) fields.body = body;
    const crumb = await updateCrumb(crumbId, fields);
    return res.status(200).json({ crumb });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
