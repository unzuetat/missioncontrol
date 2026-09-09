// api/briefing/jobs — Cola de trabajos para el agente local.
//
//   GET  /api/briefing/jobs?limit=20        → { jobs, agents, now }  (público)
//        &wake=1  además avisa al agente para que sondee rápido unos minutos
//   POST /api/briefing/jobs                 → crea { type, params?, machine? }
//   POST /api/briefing/jobs?op=cancel   → { id }
//   POST /api/briefing/jobs?op=claim    → agente: { machine, version? } → { job|null, fast }
//   POST /api/briefing/jobs?op=finish   → agente: { id, status, result?, error? }
//   POST /api/briefing/jobs?op=heartbeat→ agente: { machine }
//
// Los POST del dashboard pasan por checkAuth (mismo origen); los del agente
// llevan x-api-key.

import { checkAuth, corsHeaders } from '../../_lib/auth.js';
import {
  JOB_TYPES, createJob, claimJob, finishJob, cancelJob, listJobs, getAgents, heartbeat, setWake,
} from '../../_lib/jobs.js';

const MACHINE_RE = /^[a-z0-9_-]{1,32}$/i;

export default async function handler(req, res) {
  Object.entries(corsHeaders()).forEach(([k, v]) => res.setHeader(k, v));
  if (req.method === 'OPTIONS') return res.status(204).end();

  try {
    const url = new URL(req.url, 'http://x');
    // La subacción va en `op` (no `action`: ese nombre es el segmento de ruta del router).
    const action = req.query?.op || url.searchParams.get('op') || '';

    if (req.method === 'GET') {
      const limit = Math.min(50, Math.max(1, parseInt(req.query?.limit || url.searchParams.get('limit') || '20', 10) || 20));
      if (req.query?.wake === '1' || url.searchParams.get('wake') === '1') await setWake();
      const [jobs, agents] = await Promise.all([listJobs(limit), getAgents()]);
      return res.status(200).json({ jobs, agents, now: new Date().toISOString() });
    }

    if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });
    if (!checkAuth(req)) return res.status(401).json({ error: 'unauthorized' });
    const b = req.body || {};

    if (action === 'claim') {
      if (!b.machine || !MACHINE_RE.test(b.machine)) return res.status(400).json({ error: 'invalid_machine' });
      const out = await claimJob(b.machine, { version: b.version || '', pid: b.pid || '' });
      return res.status(200).json(out);
    }
    if (action === 'heartbeat') {
      if (!b.machine || !MACHINE_RE.test(b.machine)) return res.status(400).json({ error: 'invalid_machine' });
      await heartbeat(b.machine, { version: b.version || '' });
      return res.status(200).json({ ok: true });
    }
    if (action === 'finish') {
      if (!b.id) return res.status(400).json({ error: 'missing_id' });
      const job = await finishJob(b.id, { status: b.status, result: b.result, error: b.error });
      return res.status(200).json({ job });
    }
    if (action === 'cancel') {
      if (!b.id) return res.status(400).json({ error: 'missing_id' });
      const job = await cancelJob(b.id);
      return res.status(200).json({ job });
    }
    if (action) return res.status(400).json({ error: 'unknown_action' });

    // Crear
    if (!JOB_TYPES.has(b.type)) return res.status(400).json({ error: 'invalid_type', detail: `type debe ser uno de: ${[...JOB_TYPES].join(', ')}` });
    if (b.machine && !MACHINE_RE.test(b.machine)) return res.status(400).json({ error: 'invalid_machine' });
    const params = b.params && typeof b.params === 'object' ? b.params : {};
    if (b.type === 'briefing') {
      if (params.kind !== 'daily' && params.kind !== 'project') return res.status(400).json({ error: 'invalid_kind' });
      if (params.kind === 'project' && !params.projectId) return res.status(400).json({ error: 'missing_projectId' });
      params.flavor = params.flavor === 'executive' ? 'executive' : 'technical';
      params.model = ['sonnet', 'opus', 'haiku'].includes(params.model) ? params.model : 'sonnet';
    }
    const job = await createJob({ type: b.type, params, machine: b.machine || '', requestedBy: 'dashboard' });
    return res.status(201).json({ job });
  } catch (err) {
    console.error('[briefing/jobs] error:', err);
    return res.status(500).json({ error: 'jobs_failed', detail: err?.message || String(err) });
  }
}
