// api/briefing/_handlers/estimate.js — Estimación pre-flight de coste de un project briefing.
// GET ?projectId=X&flavor=technical|executive → tokens de input estimados y coste por modelo.
// Reutiliza prompts y constantes de project.js, NO llama a Anthropic.

import { corsHeaders } from '../../_lib/auth.js';
import {
  getProjectById,
  getProjectCrumbs,
  getProjectFiles,
} from '../../_lib/kv.js';
import {
  TECHNICAL_SYSTEM_PROMPT,
  EXECUTIVE_SYSTEM_PROMPT,
  buildUserPrompt,
  CRUMBS_LIMIT,
  MAX_CONTEXT_CHARS,
} from './project.js';

const CHARS_PER_TOKEN = 3.5; // heurística castellano/markdown

// Output esperado por flavor (basado en plantillas: executive es más estructurado/largo)
const OUTPUT_BY_FLAVOR = {
  technical: 2000,
  executive: 3500,
};

const RATES = {
  'claude-haiku-4-5':  { in: 1, out: 5 },
  'claude-sonnet-4-6': { in: 3, out: 15 },
  'claude-opus-4-7':   { in: 5, out: 25 },
};

export default async function handler(req, res) {
  Object.entries(corsHeaders()).forEach(([k, v]) => res.setHeader(k, v));
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' });

  try {
    const projectId = req.query?.projectId;
    const rawFlavor = req.query?.flavor;
    const flavor = rawFlavor === 'executive' ? 'executive' : 'technical';
    if (!projectId) return res.status(400).json({ error: 'missing_projectId' });

    const [project, crumbs, files] = await Promise.all([
      getProjectById(projectId),
      getProjectCrumbs(projectId, CRUMBS_LIMIT),
      getProjectFiles(projectId),
    ]);
    if (!project) return res.status(404).json({ error: 'project_not_found' });

    const contextFile = files.find((f) => f.name === 'CONTEXT.md');
    const systemPrompt = flavor === 'executive' ? EXECUTIVE_SYSTEM_PROMPT : TECHNICAL_SYSTEM_PROMPT;
    const userPrompt = buildUserPrompt(project, crumbs, contextFile, flavor);

    const inputChars = systemPrompt.length + userPrompt.length;
    const inputTokens = Math.ceil(inputChars / CHARS_PER_TOKEN);
    const estimatedOutputTokens = OUTPUT_BY_FLAVOR[flavor];

    const costs = {};
    for (const [model, rate] of Object.entries(RATES)) {
      const usd = (inputTokens * rate.in + estimatedOutputTokens * rate.out) / 1_000_000;
      costs[model] = Number(usd.toFixed(4));
    }

    return res.status(200).json({
      projectId,
      flavor,
      inputTokens,
      estimatedOutputTokens,
      costs,
      breakdown: {
        systemChars: systemPrompt.length,
        userChars: userPrompt.length,
        contextChars: contextFile ? Math.min(contextFile.content.length, MAX_CONTEXT_CHARS) : 0,
        crumbsCount: crumbs.length,
      },
    });
  } catch (err) {
    console.error('[briefing/estimate] error:', err);
    return res.status(500).json({ error: 'estimate_failed', detail: err?.message || String(err) });
  }
}
