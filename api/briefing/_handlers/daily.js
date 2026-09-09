// api/briefing/daily.js — Pulso diario del portfolio
// POST body { model?, flavor? } → genera nuevo pulso
//   model: claude-haiku-4-5 | claude-sonnet-4-6 (default) | claude-opus-4-7
//   flavor: technical (default — pulso matinal) | executive (PM de portfolio)
// GET  → devuelve el último pulso cacheado

import Anthropic from '@anthropic-ai/sdk';
import { checkAuth, corsHeaders } from '../../_lib/auth.js';
import {
  getAllProjects,
  getProjectCrumbs,
  getKv,
  getAllPulses,
  getDueCrumbs,
} from '../../_lib/kv.js';
import {
  CTX,
  DEFAULT_FLAVOR,
  ALLOWED_FLAVORS,
  systemPromptFor,
  aggregateProject,
  isArchived,
  buildUserPrompt,
} from '../../_lib/briefing-prompts.js';
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
} from '../../_lib/briefing-helpers.js';

const DEFAULT_MODEL = 'claude-sonnet-4-6';
const ALLOWED_MODELS = new Set([
  'claude-haiku-4-5',
  'claude-sonnet-4-6',
  'claude-opus-4-7',
]);

const LIST_KEY = 'briefing:daily:list';
const LEGACY_KEY = 'briefing:daily:latest';


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

      const { model: requestedModel, flavor: requestedFlavor } = req.body || {};
      const model = requestedModel && ALLOWED_MODELS.has(requestedModel)
        ? requestedModel
        : DEFAULT_MODEL;
      const flavor = requestedFlavor && ALLOWED_FLAVORS.has(requestedFlavor)
        ? requestedFlavor
        : DEFAULT_FLAVOR;
      const systemPrompt = systemPromptFor(flavor);
      const ctx = CTX[flavor];

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
      const allProjects = await getAllProjects();
      // Excluir archivados: no se envían al LLM ni cuentan en el contexto.
      const projects = allProjects.filter((p) => !isArchived(p));
      const aggregated = await buildContext(projects, ctx);
      const [pulses, due] = await Promise.all([getAllPulses(), getDueCrumbs()]);

      const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
      const response = await client.messages.create({
        model,
        max_tokens: ctx.maxTokens,
        system: systemPrompt,
        messages: [{ role: 'user', content: buildUserPrompt(aggregated, flavor, { pulses, due }) }],
      });

      const markdown = extractMarkdown(response);
      const usage = computeCost(response.usage, model);

      const briefing = {
        kind: 'daily',
        flavor,
        markdown,
        generatedAt: new Date().toISOString(),
        durationMs: Date.now() - startedAt,
        projectCount: projects.length,
        usage,
        model,
      };
      await Promise.all([
        pushBriefing(getKv, LIST_KEY, briefing),
        markCooldown(getKv, 'daily', null, LIMITS.dailyCooldownSeconds),
        recordCost(getKv, {
          kind: 'daily',
          costUsd: usage.costUsd,
          generatedAt: briefing.generatedAt,
          model,
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
// Construcción de contexto. Los prompts y la forma agregada viven en
// api/_lib/briefing-prompts.js, compartidos con agent/briefing.js (que genera
// el mismo briefing en local con la suscripción de Claude Code).

async function buildContext(projects, ctx) {
  const out = [];
  for (const p of projects) {
    const crumbs = await getProjectCrumbs(p.id, ctx.crumbsPerProject);
    out.push(aggregateProject(p, crumbs, ctx));
  }
  return out;
}
