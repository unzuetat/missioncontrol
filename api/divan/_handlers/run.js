// api/divan/_handlers/run.js — ejecuta una llamada del Diván.
//
// Dos modos de uso:
//
//   A) One-shot: body = { modeId, projectIds: [], includeTransversal?, depth?, userMessage }
//      - Construye el contexto desde cero, llama al LLM, devuelve la respuesta.
//      - NO persiste nada (ni sesión, ni turn).
//
//   B) Continuar sesión: body = { sessionId, userMessage, depth? }
//      - Carga la sesión, reusa su config (modeId, projectIds, includeTransversal).
//      - El bloque de contexto vive solo en el turn 1 — los siguientes user turns
//        van crudos. Esto es coherente con sesiones cerradas como punto de control.
//      - Si se pasa `depth`, se aplica al output máximo del nuevo turn.
//      - Persiste user + assistant turn al final.
//
// Comparte cap mensual con briefings ($5/mes) vía recordCost(kind='divan').

import Anthropic from '@anthropic-ai/sdk';
import { checkAuth, corsHeaders } from '../../_lib/auth.js';
import { getKv } from '../../_lib/kv.js';
import {
  computeCost,
  extractMarkdown,
  isMonthlyCapReached,
  recordCost,
  getMonthlyBudget,
  pushBriefing,
} from '../../_lib/briefing-helpers.js';
import {
  divanKeys,
  buildDivanContext,
  resolveModel,
  resolveDepth,
  DEPTH_PRESETS,
  DEFAULT_DEPTH,
} from '../../_lib/divan-helpers.js';

const META_DRAFT_MARKER = '__divan_mode_draft';

// Lista persistente de respuestas del Diván — sirve dos propósitos:
//   1. Hacer la respuesta subrayable vía AnnotatedMarkdown (cada respuesta
//      tiene un briefingId = generatedAt).
//   2. Que aparezca en la pestaña Subrayados como grupo "Diván" agrupado.
const DIVAN_BRIEFING_LIST_KEY = 'briefing:divan:list';
// Más histórico que briefings normales (10) porque cada Pensar genera uno y
// el coste por entrada es bajo. Highlights asociados sobreviven aun cuando
// el briefing salga de la lista (annotations indexan por briefingId).
const DIVAN_BRIEFING_HISTORY_LIMIT = 50;

export default async function handler(req, res) {
  Object.entries(corsHeaders()).forEach(([k, v]) => res.setHeader(k, v));
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

  if (!checkAuth(req)) return res.status(401).json({ error: 'unauthorized' });
  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: 'missing_anthropic_api_key' });
  }

  try {
    if (await isMonthlyCapReached(getKv)) {
      const budget = await getMonthlyBudget(getKv);
      return res.status(429).json({
        error: 'monthly_cap_reached',
        detail: `Cap mensual de $${budget.capUsd} alcanzado (gastado $${budget.spentUsd} en ${budget.generations} generaciones, compartido con briefings).`,
        budget,
      });
    }

    const body = req.body || {};
    const { sessionId } = body;
    const userMessage = String(body.userMessage || '').trim();
    if (!userMessage) return res.status(400).json({ error: 'missing_userMessage' });

    const kv = await getKv();

    if (sessionId) {
      return await runInSession({ kv, sessionId, userMessage, body, res });
    }
    return await runOneShot({ kv, body, userMessage, res });
  } catch (err) {
    console.error('[divan/run] error:', err);
    return res.status(500).json({ error: 'divan_run_failed', detail: err?.message || String(err) });
  }
}

// ---------------------------------------------------------------------------
// One-shot

async function runOneShot({ kv, body, userMessage, res }) {
  const modeId = body.modeId;
  if (!modeId) return res.status(400).json({ error: 'missing_modeId' });

  const modeRaw = await kv.get(divanKeys.mode(modeId));
  if (!modeRaw) return res.status(404).json({ error: 'mode_not_found', modeId });
  const mode = JSON.parse(modeRaw);

  const projectIds = Array.isArray(body.projectIds) ? body.projectIds.filter(Boolean) : [];
  const includeTransversal = typeof body.includeTransversal === 'boolean'
    ? body.includeTransversal
    : !!mode.includeTransversal;
  const depth = resolveDepth(body.depth || mode.defaultDepth);
  const model = resolveModel(body.model || mode.model);

  const ctx = await buildDivanContext({
    modeConfig: mode,
    projectIds,
    includeTransversal,
    depth,
    kvClient: kv,
  });

  const userContent = composeUserContent(ctx.contextBlock, userMessage);
  const llmResult = await callLLM({
    model,
    systemPrompt: mode.systemPrompt,
    maxOutputTokens: DEPTH_PRESETS[depth].maxOutputTokens,
    messages: [{ role: 'user', content: userContent }],
  });

  const generatedAt = new Date().toISOString();
  const draftDetected = detectModeDraft(llmResult.markdown);
  const briefing = buildDivanBriefing({
    generatedAt,
    markdown: llmResult.markdown,
    userQuestion: userMessage,
    mode,
    projectIds: ctx.includedProjectIds,
    includeTransversal,
    depth,
    model,
    usage: llmResult.usage,
    durationMs: llmResult.durationMs,
    contextDegraded: ctx.degraded,
    contextTruncated: ctx.truncated,
    estimatedContextTokens: ctx.estimatedTokens,
    draftDetected,
  });

  // No persistimos los borradores del modo "Ajustes" — son schemas, no contenido.
  const persisted = !draftDetected;
  if (persisted) {
    await pushBriefing(getKv, DIVAN_BRIEFING_LIST_KEY, briefing, DIVAN_BRIEFING_HISTORY_LIMIT);
  }

  await recordCost(getKv, {
    kind: 'divan',
    costUsd: llmResult.usage.costUsd,
    generatedAt,
    model,
    durationMs: llmResult.durationMs,
  });

  return res.status(200).json({
    markdown: llmResult.markdown,
    modelDraftDetected: draftDetected,
    briefingId: persisted ? generatedAt : null,
    persisted,
    sessionId: null,
    turnCount: 1,
    includedProjectIds: ctx.includedProjectIds,
    truncated: ctx.truncated,
    degraded: ctx.degraded,
    estimatedContextTokens: ctx.estimatedTokens,
    usage: llmResult.usage,
    model,
    depth,
    durationMs: llmResult.durationMs,
    budget: await getMonthlyBudget(getKv),
  });
}

// ---------------------------------------------------------------------------
// Continuar sesión

async function runInSession({ kv, sessionId, userMessage, body, res }) {
  const sessionRaw = await kv.get(divanKeys.session(sessionId));
  if (!sessionRaw) return res.status(404).json({ error: 'session_not_found', sessionId });
  const session = JSON.parse(sessionRaw);

  const modeRaw = await kv.get(divanKeys.mode(session.modeId));
  if (!modeRaw) {
    return res.status(409).json({
      error: 'mode_deleted',
      detail: `El modo "${session.modeId}" ya no existe. La sesión está huérfana.`,
    });
  }
  const mode = JSON.parse(modeRaw);

  const depth = resolveDepth(body.depth || session.depth || mode.defaultDepth);
  const model = resolveModel(body.model || session.model || mode.model);

  // El bloque de contexto vive en el primer turn ya almacenado — no se reinyecta.
  const messages = [...(session.turns || []), { role: 'user', content: userMessage }];

  const llmResult = await callLLM({
    model,
    systemPrompt: mode.systemPrompt,
    maxOutputTokens: DEPTH_PRESETS[depth].maxOutputTokens,
    messages,
  });

  const now = new Date().toISOString();
  const draftDetected = detectModeDraft(llmResult.markdown);

  const updatedSession = {
    ...session,
    turns: [
      ...(session.turns || []),
      { role: 'user', content: userMessage, ts: now },
      { role: 'assistant', content: llmResult.markdown, ts: now, model, depth },
    ],
    updatedAt: now,
    depth,
    model,
  };

  await kv.set(divanKeys.session(sessionId), JSON.stringify(updatedSession));
  await kv.lRem(divanKeys.sessionsList, 0, sessionId);
  await kv.lPush(divanKeys.sessionsList, sessionId);

  // Persistir cada turno como briefing del Diván (mismo briefingId = ts del turn)
  // para que sea subrayable / recuperable desde Briefings y Subrayados.
  const briefing = buildDivanBriefing({
    generatedAt: now,
    markdown: llmResult.markdown,
    userQuestion: userMessage,
    mode,
    projectIds: session.projectIds || [],
    includeTransversal: !!session.includeTransversal,
    depth,
    model,
    usage: llmResult.usage,
    durationMs: llmResult.durationMs,
    sessionId,
    draftDetected,
  });
  const persisted = !draftDetected;
  if (persisted) {
    await pushBriefing(getKv, DIVAN_BRIEFING_LIST_KEY, briefing, DIVAN_BRIEFING_HISTORY_LIMIT);
  }

  await recordCost(getKv, {
    kind: 'divan',
    costUsd: llmResult.usage.costUsd,
    generatedAt: now,
    model,
    durationMs: llmResult.durationMs,
  });

  const turnCount = updatedSession.turns.length / 2;

  return res.status(200).json({
    markdown: llmResult.markdown,
    modelDraftDetected: draftDetected,
    briefingId: persisted ? now : null,
    persisted,
    sessionId,
    turnCount,
    softCapReached: turnCount >= 20,
    usage: llmResult.usage,
    model,
    depth,
    durationMs: llmResult.durationMs,
    budget: await getMonthlyBudget(getKv),
  });
}

// ---------------------------------------------------------------------------
// Helpers

function composeUserContent(contextBlock, userMessage) {
  return `${contextBlock}\n\n---\n\nPETICIÓN DEL USUARIO:\n${userMessage}`;
}

function buildDivanBriefing({
  generatedAt, markdown, userQuestion, mode, projectIds, includeTransversal,
  depth, model, usage, durationMs, sessionId = null,
  contextDegraded = [], contextTruncated = false, estimatedContextTokens = null,
  draftDetected = null,
}) {
  return {
    kind: 'divan',
    generatedAt,
    markdown,
    userQuestion,
    modeId: mode?.id || null,
    modeName: mode?.name || null,
    modeColor: mode?.color || null,
    projectIds: Array.isArray(projectIds) ? projectIds : [],
    includeTransversal: !!includeTransversal,
    depth,
    model,
    usage,
    durationMs,
    sessionId,
    contextTruncated,
    contextDegraded,
    estimatedContextTokens,
    draftDetected: draftDetected ? true : false,
  };
}

async function callLLM({ model, systemPrompt, maxOutputTokens, messages }) {
  const startedAt = Date.now();
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const response = await client.messages.create({
    model,
    max_tokens: maxOutputTokens,
    system: systemPrompt,
    messages,
  });
  const markdown = extractMarkdown(response);
  const usage = computeCost(response.usage, model);
  return { markdown, usage, durationMs: Date.now() - startedAt };
}

function detectModeDraft(markdown) {
  // El modo "ajustes" devuelve un JSON con clave __divan_mode_draft.
  // Aceptamos tanto el JSON pelado como envuelto en un fence ```json.
  if (!markdown || !markdown.includes(META_DRAFT_MARKER)) return null;
  const jsonMatch = markdown.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return null;
  try {
    const parsed = JSON.parse(jsonMatch[0]);
    if (parsed && parsed[META_DRAFT_MARKER]) {
      return parsed[META_DRAFT_MARKER];
    }
  } catch { /* fall through */ }
  return null;
}
