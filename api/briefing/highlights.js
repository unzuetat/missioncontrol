// api/briefing/highlights.js — agrega bloques subrayados de briefings.
// GET /api/briefing/highlights?projectId=X → { highlights, projectId, count }
// GET /api/briefing/highlights              → { projects: [{projectId, projectName, highlights}], totalCount }
//
// En ambos modos recorre las listas `briefing:project:{id}:list`, carga el
// record de annotations (`briefing:annotations:{id}`) de cada briefing y
// extrae los bloques con highlight=true usando el snapshot de texto.

import { corsHeaders } from '../_lib/auth.js';
import { getKv, getAllProjects } from '../_lib/kv.js';
import { getBriefingHistory, HISTORY_LIMIT } from '../_lib/briefing-helpers.js';

async function extractHighlightsForProject(client, projectId) {
  const listKey = `briefing:project:${projectId}:list`;
  const briefings = await getBriefingHistory(getKv, listKey, HISTORY_LIMIT);
  if (!briefings.length) return [];

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
      if (!a.text) continue;
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

  highlights.sort((x, y) => {
    if (x.briefingGeneratedAt !== y.briefingGeneratedAt) {
      return y.briefingGeneratedAt.localeCompare(x.briefingGeneratedAt);
    }
    return x.blockIdx - y.blockIdx;
  });
  return highlights;
}

export default async function handler(req, res) {
  Object.entries(corsHeaders()).forEach(([k, v]) => res.setHeader(k, v));
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  try {
    const url = new URL(req.url, 'http://x');
    const projectId = req.query?.projectId || url.searchParams.get('projectId');

    const client = await getKv();

    if (projectId) {
      const highlights = await extractHighlightsForProject(client, projectId);
      return res.status(200).json({ highlights, projectId, count: highlights.length });
    }

    // Modo global: agregado por proyecto.
    const projects = await getAllProjects();
    const groups = [];
    let total = 0;
    for (const p of projects) {
      const hs = await extractHighlightsForProject(client, p.id);
      if (!hs.length) continue;
      groups.push({ projectId: p.id, projectName: p.name, highlights: hs });
      total += hs.length;
    }

    // Orden: grupos por el timestamp del subrayado más reciente, desc.
    groups.sort((a, b) => {
      const ta = a.highlights[0]?.briefingGeneratedAt || '';
      const tb = b.highlights[0]?.briefingGeneratedAt || '';
      return tb.localeCompare(ta);
    });

    return res.status(200).json({ projects: groups, totalCount: total });
  } catch (err) {
    console.error('[briefing/highlights] error:', err);
    return res.status(500).json({
      error: 'highlights_failed',
      detail: err?.message || String(err),
    });
  }
}
