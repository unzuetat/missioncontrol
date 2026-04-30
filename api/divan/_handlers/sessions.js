// api/divan/_handlers/sessions.js — CRUD de sesiones guardadas del Diván.
//
// GET                       → { sessions: [...] }  resumen (sin turns)
// GET ?id=X                 → sesión completa con turns
// POST  body=session-draft  → guarda una sesión nueva (proviene de "Guardar para iterar")
// PUT ?id=X body={title?}   → renombra
// DELETE ?id=X              → elimina (incluida de la lista global)

import { checkAuth, corsHeaders } from '../../_lib/auth.js';
import { getKv } from '../../_lib/kv.js';
import { divanKeys, SESSIONS_LIMIT, resolveDepth, resolveModel } from '../../_lib/divan-helpers.js';

const TITLE_MAX = 60;

export default async function handler(req, res) {
  Object.entries(corsHeaders()).forEach(([k, v]) => res.setHeader(k, v));
  if (req.method === 'OPTIONS') return res.status(204).end();

  try {
    const kv = await getKv();
    const id = req.query?.id;

    if (req.method === 'GET') {
      if (id) {
        const raw = await kv.get(divanKeys.session(id));
        if (!raw) return res.status(404).json({ error: 'session_not_found' });
        return res.status(200).json(JSON.parse(raw));
      }
      const ids = await kv.lRange(divanKeys.sessionsList, 0, SESSIONS_LIMIT - 1);
      const sessions = [];
      for (const sid of ids || []) {
        const raw = await kv.get(divanKeys.session(sid));
        if (!raw) continue;
        const s = JSON.parse(raw);
        sessions.push({
          id: s.id,
          title: s.title,
          modeId: s.modeId,
          projectIds: s.projectIds || [],
          includeTransversal: !!s.includeTransversal,
          depth: s.depth,
          model: s.model,
          turnCount: Array.isArray(s.turns) ? Math.floor(s.turns.length / 2) : 0,
          createdAt: s.createdAt,
          updatedAt: s.updatedAt,
        });
      }
      return res.status(200).json({ sessions });
    }

    if (!checkAuth(req)) return res.status(401).json({ error: 'unauthorized' });

    if (req.method === 'POST') {
      const body = req.body || {};
      if (!body.modeId) return res.status(400).json({ error: 'missing_modeId' });
      if (!Array.isArray(body.turns) || body.turns.length === 0) {
        return res.status(400).json({ error: 'missing_turns' });
      }

      const sid = body.id || crypto.randomUUID();
      const now = new Date().toISOString();
      const firstUser = body.turns.find((t) => t?.role === 'user');
      const fallbackTitle = firstUser?.content
        ? String(firstUser.content).replace(/\s+/g, ' ').trim().slice(0, TITLE_MAX)
        : 'Sesión sin título';
      const title = body.title ? String(body.title).slice(0, TITLE_MAX) : fallbackTitle;

      const session = {
        id: sid,
        title,
        modeId: body.modeId,
        projectIds: Array.isArray(body.projectIds) ? body.projectIds.filter(Boolean) : [],
        includeTransversal: !!body.includeTransversal,
        depth: resolveDepth(body.depth),
        model: resolveModel(body.model),
        turns: body.turns.map((t) => ({
          role: t.role === 'assistant' ? 'assistant' : 'user',
          content: String(t.content || ''),
          ts: t.ts || now,
          ...(t.role === 'assistant' && t.model ? { model: t.model } : {}),
          ...(t.role === 'assistant' && t.depth ? { depth: t.depth } : {}),
        })),
        createdAt: now,
        updatedAt: now,
      };

      await kv.set(divanKeys.session(sid), JSON.stringify(session));
      // Insertar al frente y truncar la lista.
      await kv.lRem(divanKeys.sessionsList, 0, sid);
      await kv.lPush(divanKeys.sessionsList, sid);
      const evicted = await kv.lRange(divanKeys.sessionsList, SESSIONS_LIMIT, -1);
      if (evicted && evicted.length) {
        await kv.lTrim(divanKeys.sessionsList, 0, SESSIONS_LIMIT - 1);
        // Borrar los records evictados para no dejar basura.
        for (const oldId of evicted) {
          if (oldId !== sid) await kv.del(divanKeys.session(oldId));
        }
      }
      return res.status(201).json(session);
    }

    if (req.method === 'PUT') {
      if (!id) return res.status(400).json({ error: 'missing_id' });
      const raw = await kv.get(divanKeys.session(id));
      if (!raw) return res.status(404).json({ error: 'session_not_found' });
      const session = JSON.parse(raw);
      const updates = req.body || {};
      if (typeof updates.title === 'string') {
        session.title = updates.title.slice(0, TITLE_MAX);
      }
      session.updatedAt = new Date().toISOString();
      await kv.set(divanKeys.session(id), JSON.stringify(session));
      return res.status(200).json(session);
    }

    if (req.method === 'DELETE') {
      if (!id) return res.status(400).json({ error: 'missing_id' });
      const raw = await kv.get(divanKeys.session(id));
      if (!raw) return res.status(404).json({ error: 'session_not_found' });
      await kv.del(divanKeys.session(id));
      await kv.lRem(divanKeys.sessionsList, 0, id);
      return res.status(200).json({ deleted: true, id });
    }

    return res.status(405).json({ error: 'method_not_allowed' });
  } catch (err) {
    console.error('[divan/sessions] error:', err);
    return res.status(500).json({ error: 'sessions_failed', detail: err?.message || String(err) });
  }
}
