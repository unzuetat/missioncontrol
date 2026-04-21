// api/briefing/highlights.js — agrega los bloques subrayados de un proyecto.
// GET /api/briefing/highlights?projectId=X → { highlights, projectId, count }
//
// Recorre los briefings del proyecto (listas `briefing:project:{id}:list`),
// carga el record de annotations de cada uno (`briefing:annotations:{id}`)
// y extrae los bloques con highlight=true usando el snapshot de texto.

import { corsHeaders } from '../_lib/auth.js';
import { getKv } from '../_lib/kv.js';
import { getBriefingHistory, HISTORY_LIMIT } from '../_lib/briefing-helpers.js';

export default async function handler(req, res) {
  Object.entries(corsHeaders()).forEach(([k, v]) => res.setHeader(k, v));
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  try {
    const url = new URL(req.url, 'http://x');
    const projectId = req.query?.projectId || url.searchParams.get('projectId');
    if (!projectId) return res.status(400).json({ error: 'missing_projectId' });

    const listKey = `briefing:project:${projectId}:list`;
    const briefings = await getBriefingHistory(getKv, listKey, HISTORY_LIMIT);
    if (!briefings.length) {
      return res.status(200).json({ highlights: [], projectId, count: 0 });
    }

    const client = await getKv();
    const annKeys = briefings.map((b) => `briefing:annotations:${b.generatedAt}`);
    const annRaw = await client.mGet(annKeys);

    const highlights = [];
    briefings.forEach((b, i) => {
      const raw = annRaw[i];
      if (!raw) return;
      let ann;
      try { ann = JSON.parse(raw); } catch { return; }
      const blocks = ann.blocks || {};
      for (const [idxStr, a] of Object.entries(blocks)) {
        if (!a || !a.highlight) continue;
        if (!a.text) continue; // sin snapshot (anotación anterior al upgrade)
        highlights.push({
          briefingId: b.generatedAt,
          briefingGeneratedAt: b.generatedAt,
          flavor: b.flavor || 'technical',
          model: b.model,
          blockIdx: Number(idxStr),
          blockType: a.type || 'p',
          text: a.text,
          comment: a.comment || null,
          updatedAt: ann.updatedAt || b.generatedAt,
        });
      }
    });

    // Orden: briefing desc (más reciente primero), blockIdx asc (orden de lectura)
    highlights.sort((x, y) => {
      if (x.briefingGeneratedAt !== y.briefingGeneratedAt) {
        return y.briefingGeneratedAt.localeCompare(x.briefingGeneratedAt);
      }
      return x.blockIdx - y.blockIdx;
    });

    return res.status(200).json({ highlights, projectId, count: highlights.length });
  } catch (err) {
    console.error('[briefing/highlights] error:', err);
    return res.status(500).json({
      error: 'highlights_failed',
      detail: err?.message || String(err),
    });
  }
}
