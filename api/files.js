import { getKv, keys, getProjectFiles, createFile, updateFile, deleteFile } from './_lib/kv.js';
import { checkAuth, setCors } from './_lib/auth.js';

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (!checkAuth(req)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  if (req.method === 'GET') {
    const { projectId } = req.query;
    if (!projectId) return res.status(400).json({ error: 'projectId required' });
    const files = await getProjectFiles(projectId);
    return res.status(200).json({ files });
  }

  if (req.method === 'POST') {
    const { projectId, name, content } = req.body || {};
    if (!projectId || !name) {
      return res.status(400).json({ error: 'projectId and name are required' });
    }
    const file = await createFile(projectId, name, content || '');
    return res.status(201).json({ file });
  }

  if (req.method === 'PUT') {
    const { fileId, content } = req.body || {};
    if (!fileId) return res.status(400).json({ error: 'fileId required' });
    const file = await updateFile(fileId, content || '');
    return res.status(200).json({ file: { id: fileId, ...file } });
  }

  if (req.method === 'DELETE') {
    const { fileId, projectId } = req.body || {};
    if (!fileId || !projectId) return res.status(400).json({ error: 'fileId and projectId required' });
    await deleteFile(fileId, projectId);
    return res.status(200).json({ ok: true });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
