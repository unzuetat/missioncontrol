// api/briefing/pulse — Pulso git por máquina + revisiones pendientes.
//
// POST (auth) body { machine, generatedAt, projectsDir?, projects: [...] }
//   Lo envía agent/pulse.js desde cada máquina (casa, trabajo...). Se guarda
//   entero como último pulso de esa máquina; no hay histórico (para eso están
//   los crumbs del agente y el backup diario).
// GET  → { machines: { casa: {...}, trabajo: {...} }, due: [...], now }
//   `due` son los crumbs con dueAt y no hechos, ordenados por fecha.

import { checkAuth, corsHeaders } from '../../_lib/auth.js';
import { savePulse, getAllPulses, getDueCrumbs } from '../../_lib/kv.js';

const MAX_PROJECTS = 200;

export default async function handler(req, res) {
  Object.entries(corsHeaders()).forEach(([k, v]) => res.setHeader(k, v));
  if (req.method === 'OPTIONS') return res.status(204).end();

  try {
    if (req.method === 'GET') {
      const [machines, due] = await Promise.all([getAllPulses(), getDueCrumbs()]);
      return res.status(200).json({ machines, due, now: new Date().toISOString() });
    }

    if (req.method === 'POST') {
      if (!checkAuth(req)) return res.status(401).json({ error: 'unauthorized' });
      const { machine, generatedAt, projects, projectsDir } = req.body || {};
      if (!machine || !/^[a-z0-9_-]{1,32}$/i.test(machine)) {
        return res.status(400).json({ error: 'invalid_machine', detail: 'machine debe ser un identificador corto (letras, números, - o _)' });
      }
      if (!Array.isArray(projects) || projects.length > MAX_PROJECTS) {
        return res.status(400).json({ error: 'invalid_projects' });
      }
      const payload = {
        machine,
        generatedAt: generatedAt || new Date().toISOString(),
        receivedAt: new Date().toISOString(),
        projectsDir: projectsDir || '',
        projects,
      };
      await savePulse(machine, payload);
      return res.status(200).json({ ok: true, machine, projects: projects.length, generatedAt: payload.generatedAt });
    }

    return res.status(405).json({ error: 'method_not_allowed' });
  } catch (err) {
    console.error('[briefing/pulse] error:', err);
    return res.status(500).json({ error: 'pulse_failed', detail: err?.message || String(err) });
  }
}
