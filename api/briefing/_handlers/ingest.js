// api/briefing/ingest — Guarda un briefing generado FUERA del backend.
//
// Lo usa agent/briefing.js: genera el texto en la máquina de Telmo con
// `claude -p` (suscripción de Claude Code, coste 0 en API) y lo sube aquí.
// Se guarda con la misma forma que los briefings generados por API, así el
// dashboard lo muestra sin cambios (BriefingsView, DailyPulseBanner,
// ProjectBriefingSection). No aplica cooldown ni presupuesto: no gasta API.
//
// POST (auth) body {
//   kind: 'daily' | 'project', projectId? (si project), flavor?, markdown,
//   model?, generatedAt?, durationMs?, projectCount?, machine?,
//   usage?: { inputTokens?, outputTokens? }
// }

import { checkAuth, corsHeaders } from '../../_lib/auth.js';
import { getKv, getProjectById } from '../../_lib/kv.js';
import { pushBriefing } from '../../_lib/briefing-helpers.js';

const MAX_MARKDOWN_CHARS = 60000;

export default async function handler(req, res) {
  Object.entries(corsHeaders()).forEach(([k, v]) => res.setHeader(k, v));
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });
  if (!checkAuth(req)) return res.status(401).json({ error: 'unauthorized' });

  try {
    const b = req.body || {};
    const kind = b.kind === 'project' ? 'project' : b.kind === 'daily' ? 'daily' : null;
    if (!kind) return res.status(400).json({ error: 'invalid_kind', detail: 'kind debe ser "daily" o "project"' });
    const markdown = typeof b.markdown === 'string' ? b.markdown.trim() : '';
    if (!markdown) return res.status(400).json({ error: 'missing_markdown' });
    if (markdown.length > MAX_MARKDOWN_CHARS) return res.status(413).json({ error: 'markdown_too_long' });

    let listKey = 'briefing:daily:list';
    let projectName;
    if (kind === 'project') {
      if (!b.projectId) return res.status(400).json({ error: 'missing_projectId' });
      const project = await getProjectById(b.projectId);
      if (!project) return res.status(404).json({ error: 'project_not_found' });
      projectName = project.name;
      listKey = `briefing:project:${b.projectId}:list`;
    }

    const flavor = b.flavor === 'executive' ? 'executive' : 'technical';
    const generatedAt = b.generatedAt && !Number.isNaN(Date.parse(b.generatedAt))
      ? new Date(b.generatedAt).toISOString()
      : new Date().toISOString();

    const briefing = {
      kind,
      ...(kind === 'project' ? { projectId: b.projectId, projectName } : {}),
      flavor,
      markdown,
      generatedAt,
      durationMs: Number.isFinite(b.durationMs) ? b.durationMs : null,
      ...(Number.isFinite(b.projectCount) ? { projectCount: b.projectCount } : {}),
      usage: {
        inputTokens: Number(b.usage?.inputTokens) || 0,
        outputTokens: Number(b.usage?.outputTokens) || 0,
        costUsd: 0,
        subscription: true,
        machine: typeof b.machine === 'string' ? b.machine.slice(0, 32) : '',
      },
      model: typeof b.model === 'string' && b.model ? b.model.slice(0, 64) : 'claude-code',
      source: 'claude-code',
    };

    await pushBriefing(getKv, listKey, briefing);
    return res.status(201).json(briefing);
  } catch (err) {
    console.error('[briefing/ingest] error:', err);
    return res.status(500).json({ error: 'ingest_failed', detail: err?.message || String(err) });
  }
}
