// api/divan/_handlers/modes.js — CRUD de modos del Diván.
//
// GET                    → { modes: [...] }    todos los modos
// GET ?id=X              → modo individual
// POST   body=mode       → crea modo (id = slug del name si no viene)
// PUT  ?id=X body=mode   → actualiza
// DELETE ?id=X           → elimina

import { checkAuth, corsHeaders } from '../../_lib/auth.js';
import { getKv } from '../../_lib/kv.js';
import { divanKeys, normalizeMode } from '../../_lib/divan-helpers.js';

export default async function handler(req, res) {
  Object.entries(corsHeaders()).forEach(([k, v]) => res.setHeader(k, v));
  if (req.method === 'OPTIONS') return res.status(204).end();

  try {
    const kv = await getKv();
    const id = req.query?.id;

    if (req.method === 'GET') {
      if (id) {
        const raw = await kv.get(divanKeys.mode(id));
        if (!raw) return res.status(404).json({ error: 'mode_not_found' });
        return res.status(200).json(JSON.parse(raw));
      }
      const ids = await kv.lRange(divanKeys.modesList, 0, -1);
      const uniqueIds = [...new Set(ids || [])];
      const modes = [];
      for (const mid of uniqueIds) {
        const raw = await kv.get(divanKeys.mode(mid));
        if (raw) modes.push(JSON.parse(raw));
      }
      return res.status(200).json({ modes });
    }

    if (!checkAuth(req)) return res.status(401).json({ error: 'unauthorized' });

    if (req.method === 'POST') {
      const mode = normalizeMode(req.body || {});
      const exists = await kv.get(divanKeys.mode(mode.id));
      if (exists) {
        return res.status(409).json({ error: 'mode_already_exists', id: mode.id });
      }
      await kv.set(divanKeys.mode(mode.id), JSON.stringify(mode));
      // Push al final de la lista para mantener orden de creación.
      await kv.lRem(divanKeys.modesList, 0, mode.id);
      await kv.rPush(divanKeys.modesList, mode.id);
      return res.status(201).json(mode);
    }

    if (req.method === 'PUT') {
      if (!id) return res.status(400).json({ error: 'missing_id' });
      const existing = await kv.get(divanKeys.mode(id));
      if (!existing) return res.status(404).json({ error: 'mode_not_found' });
      const merged = { ...JSON.parse(existing), ...(req.body || {}), id };
      const normalized = normalizeMode(merged, { id });
      await kv.set(divanKeys.mode(id), JSON.stringify(normalized));
      return res.status(200).json(normalized);
    }

    if (req.method === 'DELETE') {
      if (!id) return res.status(400).json({ error: 'missing_id' });
      const existing = await kv.get(divanKeys.mode(id));
      if (!existing) return res.status(404).json({ error: 'mode_not_found' });
      await kv.del(divanKeys.mode(id));
      await kv.lRem(divanKeys.modesList, 0, id);
      return res.status(200).json({ deleted: true, id });
    }

    return res.status(405).json({ error: 'method_not_allowed' });
  } catch (err) {
    console.error('[divan/modes] error:', err);
    return res.status(500).json({ error: 'modes_failed', detail: err?.message || String(err) });
  }
}
