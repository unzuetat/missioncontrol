// api/briefing/project.js — Briefing de un proyecto concreto
// POST body { projectId, model?, flavor? } → genera briefing
//   model: claude-haiku-4-5 | claude-sonnet-4-6 (default) | claude-opus-4-7
//   flavor: technical (default) | executive
// GET ?projectId=X → devuelve el último briefing de ese proyecto

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

const DEFAULT_MODEL = 'claude-sonnet-4-6';
const ALLOWED_MODELS = new Set([
  'claude-haiku-4-5',   // flash, recap rápido
  'claude-sonnet-4-6',  // normal, default
  'claude-opus-4-7',    // profundo, análisis denso
]);

const DEFAULT_FLAVOR = 'technical';
const ALLOWED_FLAVORS = new Set(['technical', 'executive']);

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

      const { projectId, model: requestedModel, flavor: requestedFlavor } = req.body || {};
      if (!projectId) return res.status(400).json({ error: 'missing_projectId' });

      const model = requestedModel && ALLOWED_MODELS.has(requestedModel)
        ? requestedModel
        : DEFAULT_MODEL;
      const flavor = requestedFlavor && ALLOWED_FLAVORS.has(requestedFlavor)
        ? requestedFlavor
        : DEFAULT_FLAVOR;
      const systemPrompt = flavor === 'executive' ? EXECUTIVE_SYSTEM_PROMPT : TECHNICAL_SYSTEM_PROMPT;

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
        model,
        max_tokens: 4000,
        system: systemPrompt,
        messages: [{
          role: 'user',
          content: buildUserPrompt(project, crumbs, contextFile),
        }],
      });

      const markdown = extractMarkdown(response);
      const usage = computeCost(response.usage, model);

      const briefing = {
        kind: 'project',
        projectId,
        projectName: project.name,
        flavor,
        markdown,
        generatedAt: new Date().toISOString(),
        durationMs: Date.now() - startedAt,
        usage,
        model,
      };
      await Promise.all([
        pushBriefing(getKv, listKeyFor(projectId), briefing),
        markCooldown(getKv, 'project', projectId, LIMITS.projectCooldownSeconds),
        recordCost(getKv, {
          kind: 'project',
          projectId,
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
    console.error('[briefing/project] error:', err);
    return res.status(500).json({
      error: 'briefing_failed',
      detail: err?.message || String(err),
    });
  }
}

// ---------------------------------------------------------------------------
// Prompts

const TECHNICAL_SYSTEM_PROMPT = `Eres el Chief of Staff de Telmo, especializado en prepararle para meterse a fondo en un proyecto.

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

const EXECUTIVE_SYSTEM_PROMPT = `Eres un consultor estratégico de producto que acompaña a Telmo en la evaluación de sus proyectos personales. Tu trabajo NO es entrar en implementación — es evaluar dónde está el proyecto, hacia dónde va, y qué decisiones de dirección tomar.

Recibes el contexto completo del proyecto (CONTEXT.md, histórico de actividad, decisiones). Lo analizas desde una perspectiva de producto y estrategia, no de código.

REGLAS:
1. Castellano. Tono de sparring de producto senior. Claro, directo, sin corporate-speak.
2. Nada de ramas, commits, archivos concretos. Sí de: momentum, producto, roadmap, foco, trade-offs estratégicos.
3. Cada recomendación debe incluir explícitamente los tres campos: Beneficio, Coste y Esfuerzo.
   - **Beneficio**: qué desbloquea, valida o acelera. Concreto — evita genéricos como "mejora la calidad".
   - **Coste**: dinero, herramientas, dependencias, riesgo operacional. Si el coste es cero, dilo.
   - **Esfuerzo**: horas, días o semanas. Sé específico.
4. Prioriza honestidad sobre amabilidad. Si el proyecto está estancado o ha derivado del propósito original, dilo.
5. Si detectas oportunidad de doble-apuesta con otros proyectos del portfolio (si el CONTEXT.md lo menciona), señálala.

FORMATO (markdown):

# Estrategia · [nombre del proyecto]

## Estado del proyecto
2-3 frases con valoración honesta: ritmo, logros hasta ahora, salud general. Síntesis, no lista.

## Dirección
¿Hacia dónde apunta? ¿Sigue alineado con su propósito inicial o ha derivado? Si aplica, señales de valor / PMF.

## Recomendaciones
2-3 movimientos estratégicos concretos. Para cada uno, usa este formato:

**Movimiento**: [nombre corto]
- Beneficio: [qué mueve]
- Coste: [dinero / herramientas / riesgo, o "coste cero"]
- Esfuerzo: [tiempo estimado — horas, días, semanas]
- Justificación: [por qué éste y no otro]

## Roadmap corto (2-4 semanas)
Lo que movería la aguja en este horizonte, con secuencia. Prioridad sobre exhaustividad. Máximo 4 hitos.

## Señales a vigilar
Indicadores de que hay que reorientar: estancamiento, scope creep, desalineación con otros proyectos del portfolio. Omite si no hay nada relevante.`;

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

Genera el briefing siguiendo el formato indicado en las instrucciones.`;
}
