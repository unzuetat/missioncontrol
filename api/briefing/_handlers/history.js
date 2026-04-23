// api/briefing/history.js — últimos N briefings (default 3)
// GET /api/briefing/history?kind=daily
// GET /api/briefing/history?kind=project&projectId=X

import { corsHeaders } from '../../_lib/auth.js';
import { getKv } from '../../_lib/kv.js';
import { getBriefingHistory, HISTORY_LIMIT } from '../../_lib/briefing-helpers.js';

export default async function handler(req, res) {
  Object.entries(corsHeaders()).forEach(([k, v]) => res.setHeader(k, v));
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  try {
    const url = new URL(req.url, 'http://x');
    const kind = req.query?.kind || url.searchParams.get('kind');
    const projectId = req.query?.projectId || url.searchParams.get('projectId');

    let listKey;
    if (kind === 'daily') {
      listKey = 'briefing:daily:list';
    } else if (kind === 'project') {
      if (!projectId) return res.status(400).json({ error: 'missing_projectId' });
      listKey = `briefing:project:${projectId}:list`;
    } else {
      return res.status(400).json({ error: 'invalid_kind', detail: 'kind debe ser "daily" o "project"' });
    }

    const items = await getBriefingHistory(getKv, listKey, HISTORY_LIMIT);
    return res.status(200).json({ items, count: items.length, limit: HISTORY_LIMIT });
  } catch (err) {
    console.error('[briefing/history] error:', err);
    return res.status(500).json({
      error: 'history_failed',
      detail: err?.message || String(err),
    });
  }
}
