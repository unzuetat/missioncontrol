// api/briefing/highlights.js — agrega bloques subrayados de briefings.
// GET /api/briefing/highlights?projectId=X → { highlights, projectId, count }
// GET /api/briefing/highlights              → { projects: [...], totalCount }
//   · Incluye un grupo virtual con kind="portfolio" para subrayados del
//     pulso diario (briefing:daily:list). Siempre primero si tiene items.
//   · El resto son kind="project", ordenados por el timestamp del subrayado
//     más reciente, desc.
//
// Implementación: recorre la lista de briefings, carga el record de
// annotations (`briefing:annotations:{id}`) de cada briefing y extrae los
// bloques con highlight=true usando el snapshot de texto.

import { corsHeaders } from '../../_lib/auth.js';
import { getKv, getAllProjects } from '../../_lib/kv.js';
import { getBriefingHistory, HISTORY_LIMIT } from '../../_lib/briefing-helpers.js';

const PORTFOLIO_ID = '__portfolio__';
const PORTFOLIO_NAME = 'Portfolio';

async function extractHighlightsFromList(client, listKey, { defaultFlavor = 'technical' } = {}) {
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
        flavor: b.flavor || defaultFlavor,
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
      // Modo por proyecto (o explícitamente portfolio si alguien llama con ese id).
      if (projectId === PORTFOLIO_ID) {
        const highlights = await extractHighlightsFromList(client, 'briefing:daily:list');
        return res.status(200).json({ highlights, projectId: PORTFOLIO_ID, count: highlights.length });
      }
      const highlights = await extractHighlightsFromList(client, `briefing:project:${projectId}:list`);
      return res.status(200).json({ highlights, projectId, count: highlights.length });
    }

    // Modo global: portfolio (daily) primero + un grupo por proyecto con subrayados.
    const portfolioHighlights = await extractHighlightsFromList(client, 'briefing:daily:list');

    const projects = await getAllProjects();
    const projectGroups = [];
    let total = portfolioHighlights.length;
    for (const p of projects) {
      const hs = await extractHighlightsFromList(client, `briefing:project:${p.id}:list`);
      if (!hs.length) continue;
      projectGroups.push({
        projectId: p.id,
        projectName: p.name,
        kind: 'project',
        highlights: hs,
      });
      total += hs.length;
    }

    projectGroups.sort((a, b) => {
      const ta = a.highlights[0]?.briefingGeneratedAt || '';
      const tb = b.highlights[0]?.briefingGeneratedAt || '';
      return tb.localeCompare(ta);
    });

    const groups = [];
    if (portfolioHighlights.length) {
      groups.push({
        projectId: PORTFOLIO_ID,
        projectName: PORTFOLIO_NAME,
        kind: 'portfolio',
        highlights: portfolioHighlights,
      });
    }
    groups.push(...projectGroups);

    return res.status(200).json({ projects: groups, totalCount: total });
  } catch (err) {
    console.error('[briefing/highlights] error:', err);
    return res.status(500).json({
      error: 'highlights_failed',
      detail: err?.message || String(err),
    });
  }
}
