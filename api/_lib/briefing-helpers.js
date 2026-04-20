// api/_lib/briefing-helpers.js — utilidades compartidas entre los endpoints de briefing

/**
 * Calcula el coste aproximado de una llamada a Claude API.
 * Pricing actual (abril 2026):
 *   - Sonnet 4.6: $3 input / $15 output por 1M
 *   - Opus 4.7:   $5 input / $25 output por 1M
 */
export function computeCost(usage, model) {
  const rates = {
    'claude-sonnet-4-6': { in: 3, out: 15 },
    'claude-opus-4-7':   { in: 5, out: 25 },
  };
  const r = rates[model] || rates['claude-sonnet-4-6'];
  const inputTokens = usage?.input_tokens || 0;
  const outputTokens = usage?.output_tokens || 0;
  const costUsd = (inputTokens * r.in + outputTokens * r.out) / 1_000_000;
  return {
    inputTokens,
    outputTokens,
    costUsd: Number(costUsd.toFixed(4)),
  };
}

/** Extrae el markdown de la respuesta de la API (concatena bloques de texto). */
export function extractMarkdown(response) {
  return response.content
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('\n\n');
}

/** Formatea una fecha ISO como string corto para prompts. */
export function fmtDate(iso) {
  return new Date(iso).toLocaleString('es-ES', {
    dateStyle: 'short',
    timeStyle: 'short',
  });
}

// ---------------------------------------------------------------------------
// Rate limit: cooldown por tipo de briefing + cost cap mensual

const COOLDOWN_PREFIX = 'briefing:cooldown:';
const COST_PREFIX = 'briefing:cost:';
const COUNT_PREFIX = 'briefing:count:';

/** Defaults en segundos / USD. Sobreescribibles con env vars. */
export const LIMITS = {
  dailyCooldownSeconds: Number(process.env.BRIEFING_DAILY_COOLDOWN_SECONDS) || 300,
  projectCooldownSeconds: Number(process.env.BRIEFING_PROJECT_COOLDOWN_SECONDS) || 600,
  monthlyCapUsd: Number(process.env.BRIEFING_MONTHLY_CAP_USD) || 5,
};

function cooldownKey(kind, id) {
  return id ? `${COOLDOWN_PREFIX}${kind}:${id}` : `${COOLDOWN_PREFIX}${kind}`;
}

function monthKey(now = new Date()) {
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, '0');
  return `${y}${m}`;
}

/** Formatea segundos en "3 min 42 s" / "45 s" / "2 min". */
export function formatRetry(seconds) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m === 0) return `${s} s`;
  if (s === 0) return `${m} min`;
  return `${m} min ${s} s`;
}

/** Devuelve {active, retryAfter} en segundos. retryAfter 0 si no activo. */
export async function checkCooldown(getKv, kind, id) {
  const client = await getKv();
  const key = cooldownKey(kind, id);
  const ttlMs = await client.pTTL(key);
  if (ttlMs && ttlMs > 0) {
    return { active: true, retryAfter: Math.ceil(ttlMs / 1000) };
  }
  return { active: false, retryAfter: 0 };
}

export async function markCooldown(getKv, kind, id, seconds) {
  const client = await getKv();
  const key = cooldownKey(kind, id);
  await client.set(key, '1', { PX: seconds * 1000 });
}

export async function getMonthlyBudget(getKv, now = new Date()) {
  const client = await getKv();
  const mKey = monthKey(now);
  const [rawSpent, rawCount] = await Promise.all([
    client.get(COST_PREFIX + mKey),
    client.get(COUNT_PREFIX + mKey),
  ]);
  const spent = rawSpent ? Number(rawSpent) || 0 : 0;
  const count = rawCount ? Number(rawCount) || 0 : 0;
  return {
    month: mKey,
    spentUsd: Number(spent.toFixed(4)),
    generations: count,
    capUsd: LIMITS.monthlyCapUsd,
    remainingUsd: Number(Math.max(0, LIMITS.monthlyCapUsd - spent).toFixed(4)),
  };
}

/** true si el gasto acumulado supera o iguala el cap. */
export async function isMonthlyCapReached(getKv) {
  const budget = await getMonthlyBudget(getKv);
  return budget.spentUsd >= budget.capUsd;
}

export async function recordCost(getKv, costUsd) {
  const client = await getKv();
  const mKey = monthKey();
  const cKey = COST_PREFIX + mKey;
  const nKey = COUNT_PREFIX + mKey;
  const [spent] = await Promise.all([
    client.incrByFloat(cKey, costUsd),
    client.incr(nKey),
  ]);
  // TTL 90 días (2 meses de margen tras el mes corriente)
  const TTL_SECONDS = 90 * 24 * 60 * 60;
  await Promise.all([
    client.expire(cKey, TTL_SECONDS),
    client.expire(nKey, TTL_SECONDS),
  ]);
  return Number(spent);
}
