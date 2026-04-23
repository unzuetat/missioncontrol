// api/briefing/spending.js — gastos agregados de briefings
// GET /api/briefing/spending           → todo el portfolio
// GET /api/briefing/spending?projectId=X → solo project-briefings de ese proyecto

import { corsHeaders } from '../../_lib/auth.js';
import { getKv } from '../../_lib/kv.js';
import { getSpending } from '../../_lib/briefing-helpers.js';

export default async function handler(req, res) {
  Object.entries(corsHeaders()).forEach(([k, v]) => res.setHeader(k, v));
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  try {
    const url = new URL(req.url, 'http://x');
    const projectId = req.query?.projectId || url.searchParams.get('projectId') || null;
    const data = await getSpending(getKv, { projectId });
    return res.status(200).json(data);
  } catch (err) {
    console.error('[briefing/spending] error:', err);
    return res.status(500).json({
      error: 'spending_failed',
      detail: err?.message || String(err),
    });
  }
}
