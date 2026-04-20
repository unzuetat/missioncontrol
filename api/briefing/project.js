// api/briefing/project.js — Briefing profundo de un proyecto concreto
// POST body { projectId } → genera análisis profundo con Claude Opus 4.7 (~$0.07)
// GET ?projectId=X        → devuelve el último briefing profundo de ese proyecto

import Anthropic from '@anthropic-ai/sdk';
import { checkAuth, corsHeaders } from '../_lib/auth.js';
import {
  getProjectById,
  getProjectCrumbs,
  getProjectFiles,
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

const MODEL = 'claude-opus-4-7';
const CRUMBS_LIMIT = 30;         // histórico amplio para el profundo
const MAX_CONTEXT_CHARS = 8000;  // CONTEXT.md casi entero

const listKeyFor = (id) => `briefing:project:${id}:list`;
const legacyKeyFor = (id) => `briefing:project:${id}:latest`;

export default async function handler(req, res) {
  Object.entries(corsHeaders()).forEach(([k, v]) => res.setHeader(k, v));
  if (req.method === 'OPTIONS') return res.status(204).end();

  try {
    if (req.method === 'GET') {
      const projectId = req.query?.projectId || new URL(req.url, 'http://x').searchParams.get('projectId');
      if (!projectId) return res.status(400).json({ error: 'missing_projectId' });
      const cached = await getLatestBriefing(getKv, listKeyFor(projectId), legacyKeyFor(projectId));
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

      const { projectId } = req.body || {};
      if (!projectId) return res.status(400).json({ error: 'missing_projectId' });

      const project = await getProjectById(projectId);
      if (!project) return res.status(404).json({ error: 'project_not_found' });

      if (await isMonthlyCapReached(getKv)) {
        const budget = await getMonthlyBudget(getKv);
        return res.status(429).json({
          error: 'monthly_cap_reached',
          detail: `Límite mensual de $${budget.capUsd} alcanzado (gastado $${budget.spentUsd} en ${budget.generations} generaciones). Espera al mes ${budget.month} siguiente o sube BRIEFING_MONTHLY_CAP_USD.`,
          budget,
        });
      }

      const cd = await checkCooldown(getKv, 'project', projectId);
      if (cd.active) {
        return res.status(429).json({
          error: 'cooldown_active',
          detail: `Briefing del proyecto "${project.name}" en cooldown. Reintenta en ${formatRetry(cd.retryAfter)}.`,
          retryAfter: cd.retryAfter,
        });
      }

      const startedAt = Date.now();
      const crumbs = await getProjectCrumbs(projectId, CRUMBS_LIMIT);
      const files = await getProjectFiles(projectId);
      const contextFile = files.find((f) => f.name === 'CONTEXT.md');

      // IMPORTANTE: Opus 4.7 no acepta temperature/top_p/top_k non-default
      const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
      const response = await client.messages.create({
        model: MODEL,
        max_tokens: 4000,
        system: SYSTEM_PROMPT,
        messages: [{
          role: 'user',
          content: buildUserPrompt(project, crumbs, contextFile),
        }],
      });

      const markdown = extractMarkdown(response);
      const usage = computeCost(response.usage, MODEL);

      const briefing = {
        kind: 'project',
        projectId,
        projectName: project.name,
        markdown,
        generatedAt: new Date().toISOString(),
        durationMs: Date.now() - startedAt,
        usage,
        model: MODEL,
      };
      await Promise.all([
        pushBriefing(getKv, listKeyFor(projectId), briefing),
        markCooldown(getKv, 'project', projectId, LIMITS.projectCooldownSeconds),
        recordCost(getKv, {
          kind: 'project',
          projectId,
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
    console.error('[briefing/project] error:', err);
    return res.status(500).json({
      error: 'briefing_failed',
      detail: err?.message || String(err),
    });
  }
}

// ---------------------------------------------------------------------------
// Prompts

const SYSTEM_PROMPT = `Eres el Chief of Staff de Telmo, especializado en prepararle para meterse a fondo en un proyecto.

Recibes el estado completo de UN proyecto: su CONTEXT.md, su histórico de actividad, decisiones tomadas. Tu trabajo es que cuando Telmo abra ese proyecto, tenga todo lo que necesita en la cabeza en 2 minutos de lectura.

No resumas — analiza. No describas lo que hay — recomienda qué hacer.

REGLAS:
1. Castellano. Tono de compañero técnico senior que conoce el proyecto.
2. Sé específico. Referencia nombres de ficheros, ramas, decisiones concretas del CONTEXT.md.
3. Prioriza: ¿qué es lo siguiente más impactante que hacer? Justifícalo.
4. Detecta riesgos reales: deuda técnica acumulada, decisiones postergadas, dependencias frágiles.
5. Si hay ambigüedad no resuelta en el CONTEXT.md o los crumbs, señálala como decisión pendiente.

FORMATO (markdown):

# Briefing · [nombre del proyecto]

## Donde lo dejaste
2-3 frases concretas del último estado. Última rama activa, último cambio relevante.

## Lo siguiente
La acción más impactante que hacer ahora, con 2-3 frases de justificación técnica. Si hay 2-3 caminos razonables, lístalos y recomienda uno.

## Decisiones pendientes
Cosas que bloquean progreso y necesitan tu input. Cada una con contexto suficiente para decidir sin volver a leer todo.

## Riesgos y deuda
Lo que se ha ido acumulando y conviene atajar pronto. Solo si hay algo real — si no, omite.

## Contexto rápido
Para volver al hilo: stack principal, decisiones arquitectónicas clave, convenciones del proyecto. Máximo 4-5 líneas.`;

function buildUserPrompt(project, crumbs, contextFile) {
  const crumbsTxt = crumbs.length
    ? crumbs.map((c) => {
        const flags = [c.isDone && '✓', c.isIdea && '💡', c.isTest && '🧪'].filter(Boolean).join(' ');
        return `- [${c.timestamp}] (${c.source}) ${c.title}${c.body ? `\n  ${c.body}` : ''}${flags ? ` ${flags}` : ''}`;
      }).join('\n')
    : '_(sin crumbs)_';

  const ctxTxt = contextFile
    ? `\n\n### CONTEXT.md\n\n${String(contextFile.content).slice(0, MAX_CONTEXT_CHARS)}`
    : '\n\n_(sin CONTEXT.md)_';

  return `# Proyecto: ${project.name}

**Id:** ${project.id}
**Estado:** ${project.status || '?'}
**Stack:** ${project.techStack || '?'}
**Descripción:** ${project.description || '?'}
${project.repoUrl ? `**Repo:** ${project.repoUrl}` : ''}
${project.prodUrl ? `**Prod:** ${project.prodUrl}` : ''}

## Actividad reciente (últimas ${crumbs.length})
${crumbsTxt}
${ctxTxt}

---

Genera el briefing profundo.`;
}
