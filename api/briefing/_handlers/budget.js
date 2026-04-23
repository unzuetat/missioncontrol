// api/briefing/budget.js — consulta del gasto mensual acumulado
// GET → { month, spentUsd, generations, capUsd, remainingUsd }

import { corsHeaders } from '../../_lib/auth.js';
import { getKv } from '../../_lib/kv.js';
import { getMonthlyBudget } from '../../_lib/briefing-helpers.js';

export default async function handler(req, res) {
  Object.entries(corsHeaders()).forEach(([k, v]) => res.setHeader(k, v));
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  try {
    const budget = await getMonthlyBudget(getKv);
    return res.status(200).json(budget);
  } catch (err) {
    console.error('[briefing/budget] error:', err);
    return res.status(500).json({
      error: 'budget_failed',
      detail: err?.message || String(err),
    });
  }
}
