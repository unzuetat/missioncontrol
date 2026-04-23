// api/briefing/annotations.js — anotaciones por bloque sobre un briefing
// GET    /api/briefing/annotations?briefingId=X → { briefingId, blocks, updatedAt }
// PUT    /api/briefing/annotations?briefingId=X body { blocks } → upsert (auth)
// DELETE /api/briefing/annotations?briefingId=X → borra (auth)
//
// blocks es un mapa { [blockIdx: string]: { highlight?, strike?, comment? } }

import { checkAuth, corsHeaders } from '../../_lib/auth.js';
import { getKv } from '../../_lib/kv.js';

const KEY_PREFIX = 'briefing:annotations:';

export default async function handler(req, res) {
  Object.entries(corsHeaders()).forEach(([k, v]) => res.setHeader(k, v));
  if (req.method === 'OPTIONS') return res.status(204).end();

  try {
    const url = new URL(req.url, 'http://x');
    const briefingId = req.query?.briefingId || url.searchParams.get('briefingId');
    if (!briefingId) {
      return res.status(400).json({ error: 'missing_briefingId' });
    }

    const client = await getKv();
    const key = KEY_PREFIX + briefingId;

    if (req.method === 'GET') {
      const raw = await client.get(key);
      if (!raw) {
        return res.status(200).json({ briefingId, blocks: {}, updatedAt: null });
      }
      try {
        return res.status(200).json(JSON.parse(raw));
      } catch {
        return res.status(200).json({ briefingId, blocks: {}, updatedAt: null });
      }
    }

    if (!checkAuth(req)) {
      return res.status(401).json({ error: 'unauthorized' });
    }

    if (req.method === 'PUT') {
      const body = req.body || {};
      const blocks = (body.blocks && typeof body.blocks === 'object') ? body.blocks : {};
      const record = { briefingId, blocks, updatedAt: new Date().toISOString() };
      await client.set(key, JSON.stringify(record));
      return res.status(200).json(record);
    }

    if (req.method === 'DELETE') {
      await client.del(key);
      return res.status(200).json({ deleted: true });
    }

    return res.status(405).json({ error: 'method_not_allowed' });
  } catch (err) {
    console.error('[briefing/annotations] error:', err);
    return res.status(500).json({
      error: 'annotations_failed',
      detail: err?.message || String(err),
    });
  }
}
