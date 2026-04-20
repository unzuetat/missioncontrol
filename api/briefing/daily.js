// api/briefing/daily.js — Pulso diario del portfolio
// POST → genera nuevo pulso diario con Claude Sonnet 4.6 (ligero, ~$0.04)
// GET  → devuelve el último pulso cacheado

import Anthropic from '@anthropic-ai/sdk';
import { checkAuth, corsHeaders } from '../_lib/auth.js';
import {
  getAllProjects,
  getProjectCrumbs,
  getKv,
} from '../_lib/kv.js';
import {
  computeCost,
  extractMarkdown,
  checkCooldown,
  markCooldown,
  isMonthlyCapReached,
  recordCost,
  getMonthlyBudget,
  formatRetry,
  pushBriefing,
  getLatestBriefing,
  LIMITS,
} from '../_lib/briefing-helpers.js';

const MODEL = 'claude-sonnet-4-6';
const LIST_KEY = 'briefing:daily:list';
const LEGACY_KEY = 'briefing:daily:latest';
const CRUMBS_PER_PROJECT = 5;   // solo lo más reciente
const MAX_BODY_CHARS = 200;     // recortar bodies largos para mantenerlo ligero

export default async function handler(req, res) {
  Object.entries(corsHeaders()).forEach(([k, v]) => res.setHeader(k, v));
  if (req.method === 'OPTIONS') return res.status(204).end();

  try {
    if (req.method === 'GET') {
      const cached = await getLatestBriefing(getKv, LIST_KEY, LEGACY_KEY);
      if (!cached) return res.status(404).json({ error: 'no_briefing_yet' });
      return res.status(200).json(cached);
    }

    if (req.method === 'POST') {
      if (!checkAuth(req)) {
        return res.status(401).json({ error: 'unauthorized' });
      }
      if (!process.env.ANTHROPIC_API_KEY) {
        return res.status(500).json({ error: 'missing_anthropic_api_key' });
      }

      if (await isMonthlyCapReached(getKv)) {
        const budget = await getMonthlyBudget(getKv);
        return res.status(429).json({
          error: 'monthly_cap_reached',
          detail: `Límite mensual de $${budget.capUsd} alcanzado (gastado $${budget.spentUsd} en ${budget.generations} generaciones). Espera al mes ${budget.month} siguiente o sube BRIEFING_MONTHLY_CAP_USD.`,
          budget,
        });
      }

      const cd = await checkCooldown(getKv, 'daily');
      if (cd.active) {
        return res.status(429).json({
          error: 'cooldown_active',
          detail: `Pulso diario en cooldown. Reintenta en ${formatRetry(cd.retryAfter)}.`,
          retryAfter: cd.retryAfter,
        });
      }

      const startedAt = Date.now();
      const projects = await getAllProjects();
      const aggregated = await buildLightContext(projects);

      const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
      const response = await client.messages.create({
        model: MODEL,
        max_tokens: 1500,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: buildUserPrompt(aggregated) }],
      });

      const markdown = extractMarkdown(response);
      const usage = computeCost(response.usage, MODEL);

      const briefing = {
        kind: 'daily',
        markdown,
        generatedAt: new Date().toISOString(),
        durationMs: Date.now() - startedAt,
        projectCount: projects.length,
        usage,
        model: MODEL,
      };
      await Promise.all([
        pushBriefing(getKv, LIST_KEY, briefing),
        markCooldown(getKv, 'daily', null, LIMITS.dailyCooldownSeconds),
        recordCost(getKv, {
          kind: 'daily',
          costUsd: usage.costUsd,
          generatedAt: briefing.generatedAt,
          model: MODEL,
          durationMs: briefing.durationMs,
        }),
      ]);

      return res.status(200).json(briefing);
    }

    return res.status(405).json({ error: 'method_not_allowed' });
  } catch (err) {
    console.error('[briefing/daily] error:', err);
    return res.status(500).json({
      error: 'briefing_failed',
      detail: err?.message || String(err),
    });
  }
}

// ---------------------------------------------------------------------------
// Contexto ligero: solo crumbs recientes, sin CONTEXT.md completo

async function buildLightContext(projects) {
  const out = [];
  for (const p of projects) {
    const crumbs = await getProjectCrumbs(p.id, CRUMBS_PER_PROJECT);
    out.push({
      name: p.name,
      status: p.status,
      recentCrumbs: crumbs.map((c) => ({
        title: c.title,
        body: c.body ? String(c.body).slice(0, MAX_BODY_CHARS) : '',
        source: c.source,
        timestamp: c.timestamp,
        isDone: !!c.isDone,
      })),
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Prompts

const SYSTEM_PROMPT = `Eres el copiloto de Telmo. Tu trabajo es darle un pulso matinal ligero del portfolio de proyectos — como un café con un compañero que te pone al día en 30 segundos.

Recibes actividad reciente de todos sus proyectos. Produces un briefing corto y conversacional.

REGLAS:
1. Castellano. Tono natural, directo, nada corporativo.
2. MUY CONCISO. Esto es un pulso, no un informe. Máximo ~400 palabras.
3. No recites actividad — destila. Señala lo que importa, omite el ruido.
4. Si hay proyectos sin movimiento reciente, no los nombres uno a uno. Solo si la inactividad es relevante (ej: deadline cerca).
5. Detecta patrones de alto nivel: dónde hay momentum, dónde hay estancamiento.

FORMATO (markdown):

## Dónde estás hoy

2-3 frases sobre el estado general. ¿Qué se movió ayer? ¿Dónde hay energía?

## Atento a

3-5 bullets cortos con lo que merece tu atención hoy. No son tareas detalladas — son señales. Cada bullet una línea.

## Si tuvieras una hora libre

1 sugerencia concreta de qué hacer con ese hueco. Debe ser accionable y no obvia.

Nada más. Sin emojis salvo los de los headers. Sin secciones extra.`;

function buildUserPrompt(aggregated) {
  const lines = aggregated.map((p) => {
    if (!p.recentCrumbs.length) {
      return `## ${p.name} [${p.status || '?'}]\n_sin actividad reciente_`;
    }
    const crumbs = p.recentCrumbs
      .map((c) => `- [${c.timestamp}] ${c.title}${c.body ? ` · ${c.body}` : ''}${c.isDone ? ' ✓' : ''}`)
      .join('\n');
    return `## ${p.name} [${p.status || '?'}]\n${crumbs}`;
  }).join('\n\n');

  return `Fecha: ${new Date().toISOString()}\nPortfolio: ${aggregated.length} proyectos\n\n${lines}\n\n---\n\nGenera el pulso diario.`;
}
