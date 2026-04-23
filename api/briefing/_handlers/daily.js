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
} from '../../_lib/kv.js';
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

const DEFAULT_FLAVOR = 'technical';
const ALLOWED_FLAVORS = new Set(['technical', 'executive']);

const LIST_KEY = 'briefing:daily:list';
const LEGACY_KEY = 'briefing:daily:latest';

// Contextos distintos según flavor:
// - technical (pulso): rápido, pocos crumbs por proyecto, bodies recortados.
// - executive (PM):    histórico más amplio, metadata completa, bodies largos
//                      para que detecte "commits sin pushear", deriva de ramas,
//                      etc. desde los crumbs del agente.
const CTX = {
  technical: { crumbsPerProject: 5,  maxBodyChars: 200,  maxTokens: 1500 },
  executive: { crumbsPerProject: 10, maxBodyChars: 600,  maxTokens: 3500 },
};

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
      const systemPrompt = flavor === 'executive' ? EXECUTIVE_SYSTEM_PROMPT : TECHNICAL_SYSTEM_PROMPT;
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
      const projects = await getAllProjects();
      const aggregated = await buildContext(projects, ctx);

      const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
      const response = await client.messages.create({
        model,
        max_tokens: ctx.maxTokens,
        system: systemPrompt,
        messages: [{ role: 'user', content: buildUserPrompt(aggregated, flavor) }],
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
// Construcción de contexto. Technical mantiene el formato ligero original;
// executive añade metadata del proyecto (ramas, URLs, descripción) para que
// el modelo pueda detectar versiones no desplegadas y dependencias entre
// proyectos.

async function buildContext(projects, ctx) {
  const out = [];
  for (const p of projects) {
    const crumbs = await getProjectCrumbs(p.id, ctx.crumbsPerProject);
    out.push({
      id: p.id,
      name: p.name,
      status: p.status,
      description: p.description || '',
      techStack: p.techStack || '',
      repoUrl: p.repoUrl || '',
      testUrl: p.testUrl || '',
      testBranch: p.testBranch || '',
      prodUrl: p.prodUrl || '',
      prodBranch: p.prodBranch || '',
      recentCrumbs: crumbs.map((c) => ({
        title: c.title,
        body: c.body ? String(c.body).slice(0, ctx.maxBodyChars) : '',
        source: c.source,
        timestamp: c.timestamp,
        isDone: !!c.isDone,
        isIdea: !!c.isIdea,
      })),
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Prompts

const TECHNICAL_SYSTEM_PROMPT = `Eres el copiloto de Telmo. Tu trabajo es darle un pulso matinal ligero del portfolio de proyectos — como un café con un compañero que te pone al día en 30 segundos.

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

const EXECUTIVE_SYSTEM_PROMPT = `Eres el Product Manager del portfolio personal de proyectos de Telmo. Tu trabajo NO es entrar en implementación de ninguno — es evaluar el portfolio como un todo: dónde concentrar energía, qué abandonar, cómo se interrelacionan los proyectos, y qué movimientos estratégicos sacan más valor del conjunto.

Recibes el estado de TODOS los proyectos: descripción, stack, URLs de test y producción, ramas, actividad reciente (incluidos crumbs del agente local con estado git — commits sin pushear, cambios sin commitear, derivas de ramas). Analízalo desde la lente de alguien que gestiona un portfolio, no un equipo técnico.

REGLAS:
1. Castellano. Tono de PM senior / sparring estratégico. Claro, directo, sin corporate-speak.
2. Pensar el portfolio como un sistema interconectado, no como lista de items.
3. Honestidad sobre amabilidad: si un proyecto está estancado o desalineado, dilo con nombre propio.
4. Cada recomendación debe incluir explícitamente Beneficio / Coste / Esfuerzo.
   - Beneficio: qué desbloquea a nivel portfolio (no "mejora la calidad" — concreto).
   - Coste: dinero, herramientas, dependencias, riesgo operacional. "Coste cero" si no lo tiene.
   - Esfuerzo: horas, días o semanas estimadas.
5. Si detectas oportunidades de monetización razonablemente claras en algún proyecto, señálalas — con mercado/usuario potencial y barrera actual.
6. Detecta señales técnicas del portfolio a partir de los crumbs del agente:
   - Commits sin pushear acumulados en una máquina.
   - Ramas de test desincronizadas respecto a producción (test muy por delante de prod = feature parada, o test atrás = regresión).
   - Proyectos con cambios locales sin commitear desde hace tiempo.
   - Versiones que no cuadran entre casa y trabajo (mismo proyecto, estado git distinto).
7. Si algún proyecto no tiene actividad significativa hace >2 semanas, valora explícitamente: ¿sunset? ¿pausa consciente? ¿olvido?

FORMATO (markdown):

# Portfolio · [fecha]

## Dónde está el portfolio
2-4 frases con valoración honesta del estado conjunto. Momentum general, dispersión de energía, qué tema vertebra la actividad reciente.

## Focus recomendado
1-2 proyectos donde concentrar energía ahora y por qué. Debe ser una decisión, no una lista.

## Sinergias y dependencias
Interrelaciones reales entre proyectos del portfolio: decisiones de uno que desbloquean otro, componentes reutilizables, audiencias solapadas. Si no hay sinergias relevantes, omite esta sección entera.

## Candidatos a dejar (o pausar)
Proyectos estancados o desalineados con el foco. Para cada uno: decisión sugerida (sunset / pausa consciente / retomar) y justificación breve. Si todos están activos, omite esta sección.

## Señales técnicas
Alertas concretas que saques de los crumbs: "X commits sin pushear en <proyecto>", "test/<rama> va N commits por delante de prod y lleva M días parado", "mismo proyecto con estado distinto entre casa y trabajo", etc. Omite la sección solo si de verdad no hay nada raro.

## Monetización a la vista
Solo proyectos donde veas oportunidad razonable y concreta. Para cada uno: usuario objetivo, qué vendería, barrera principal hoy. Máximo 2-3. Omite la sección si no hay nada claro.

## Movimientos estratégicos
2-3 movimientos concretos que harías en el portfolio esta semana. Cada uno con:

**Movimiento**: [nombre corto]
- Beneficio: [qué desbloquea a nivel portfolio]
- Coste: [dinero/herramientas/riesgo, o "coste cero"]
- Esfuerzo: [tiempo estimado]
- Justificación: [por qué éste y no otro]

## Riesgos a vigilar
Indicadores de que el portfolio deriva: scope creep en algún proyecto, proyectos que compiten por la misma atención sin decisión tomada, dependencias externas frágiles. Máximo 3. Omite si no hay nada relevante.`;

function buildUserPrompt(aggregated, flavor) {
  if (flavor === 'executive') {
    return buildExecutivePrompt(aggregated);
  }
  return buildTechnicalPrompt(aggregated);
}

function buildTechnicalPrompt(aggregated) {
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

function buildExecutivePrompt(aggregated) {
  const blocks = aggregated.map((p) => {
    const meta = [
      `**Id:** ${p.id}`,
      `**Estado:** ${p.status || '?'}`,
      p.description ? `**Descripción:** ${p.description}` : null,
      p.techStack ? `**Stack:** ${p.techStack}` : null,
      p.repoUrl ? `**Repo:** ${p.repoUrl}` : null,
      (p.testUrl || p.testBranch) ? `**Test:** ${p.testUrl || '—'} (rama: ${p.testBranch || '—'})` : null,
      (p.prodUrl || p.prodBranch) ? `**Prod:** ${p.prodUrl || '—'} (rama: ${p.prodBranch || '—'})` : null,
    ].filter(Boolean).join('\n');

    const crumbs = p.recentCrumbs.length
      ? p.recentCrumbs.map((c) => {
          const flags = [c.isDone && '✓', c.isIdea && '💡'].filter(Boolean).join(' ');
          return `- [${c.timestamp}] (${c.source}) ${c.title}${c.body ? `\n  ${c.body}` : ''}${flags ? ` ${flags}` : ''}`;
        }).join('\n')
      : '_sin crumbs recientes_';

    return `## ${p.name}\n\n${meta}\n\n### Actividad reciente\n${crumbs}`;
  }).join('\n\n---\n\n');

  return `Fecha: ${new Date().toISOString()}
Portfolio: ${aggregated.length} proyectos

${blocks}

---

Genera el briefing ejecutivo del portfolio siguiendo el formato indicado. Sé específico con nombres de proyecto.`;
}
