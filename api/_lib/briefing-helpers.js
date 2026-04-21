// api/_lib/briefing-helpers.js — utilidades compartidas entre los endpoints de briefing

/**
 * Calcula el coste aproximado de una llamada a Claude API.
 * Pricing actual (abril 2026):
 *   - Haiku 4.5:  $1 input / $5 output por 1M
 *   - Sonnet 4.6: $3 input / $15 output por 1M
 *   - Opus 4.7:   $5 input / $25 output por 1M
 */
export function computeCost(usage, model) {
  const rates = {
    'claude-haiku-4-5':  { in: 1, out: 5 },
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

// ---------------------------------------------------------------------------
// Historial de briefings (lista Redis con los últimos N)

export const HISTORY_LIMIT = 10;

/**
 * Inserta un briefing en el head de la lista y trunca a maxItems.
 * Devuelve la longitud resultante.
 */
export async function pushBriefing(getKv, listKey, briefing, maxItems = HISTORY_LIMIT) {
  const client = await getKv();
  const json = JSON.stringify(briefing);
  await client.lPush(listKey, json);
  await client.lTrim(listKey, 0, maxItems - 1);
  return client.lLen(listKey);
}

/**
 * Devuelve el briefing más reciente (o null si lista vacía).
 * Si la lista está vacía pero existe legacy key (latest), la migra a lista.
 */
export async function getLatestBriefing(getKv, listKey, legacyKey) {
  const client = await getKv();
  const raw = await client.lIndex(listKey, 0);
  if (raw) return safeParse(raw);

  if (legacyKey) {
    const legacy = await client.get(legacyKey);
    if (legacy) {
      const parsed = safeParse(legacy);
      if (parsed) {
        await client.lPush(listKey, legacy);
        await client.lTrim(listKey, 0, HISTORY_LIMIT - 1);
        await client.del(legacyKey);
        return parsed;
      }
    }
  }
  return null;
}

/** Devuelve array de hasta `limit` briefings (más reciente primero). */
export async function getBriefingHistory(getKv, listKey, limit = HISTORY_LIMIT) {
  const client = await getKv();
  const items = await client.lRange(listKey, 0, limit - 1);
  return items.map(safeParse).filter(Boolean);
}

function safeParse(raw) {
  try { return JSON.parse(raw); } catch { return null; }
}

// ---------------------------------------------------------------------------

/**
 * Registra el coste de una generación.
 * entry = { kind, projectId?, costUsd, generatedAt, model, durationMs? }
 *
 * Actualiza:
 * - Contadores mensuales (YYYYMM): costo total + número de generaciones.
 * - Sorted set global de entries, scored por timestamp ms, para queries
 *   por ventana de tiempo (7d / 30d) con filtro opcional por proyecto.
 *
 * Purga automáticamente entries > 90 días del sorted set.
 */
export async function recordCost(getKv, entry) {
  const client = await getKv();
  const mKey = monthKey();
  const cKey = COST_PREFIX + mKey;
  const nKey = COUNT_PREFIX + mKey;
  const ts = entry.generatedAt ? new Date(entry.generatedAt).getTime() : Date.now();
  const entryValue = JSON.stringify({
    kind: entry.kind,
    projectId: entry.projectId || null,
    costUsd: Number(entry.costUsd) || 0,
    generatedAt: entry.generatedAt || new Date(ts).toISOString(),
    model: entry.model || null,
    durationMs: entry.durationMs || null,
  });

  const TTL_SECONDS = 90 * 24 * 60 * 60;
  const cutoff = Date.now() - TTL_SECONDS * 1000;

  const [spent] = await Promise.all([
    client.incrByFloat(cKey, entry.costUsd),
    client.incr(nKey),
    client.zAdd(COST_ENTRIES_KEY, { score: ts, value: entryValue }),
    client.zRemRangeByScore(COST_ENTRIES_KEY, '-inf', cutoff),
  ]);

  await Promise.all([
    client.expire(cKey, TTL_SECONDS),
    client.expire(nKey, TTL_SECONDS),
  ]);
  return Number(spent);
}

// ---------------------------------------------------------------------------
// Consulta de spending: ventanas de 7d y 30d + breakdowns

const COST_ENTRIES_KEY = 'briefing:costs:entries';

/**
 * Devuelve spending agregado. Si projectId viene, todo se restringe a ese
 * proyecto (daily pulses siguen siendo "todo el portfolio", así que para
 * filtrado estricto por proyecto solo se cuentan project-briefings).
 */
export async function getSpending(getKv, { projectId = null, maxEntries = 100 } = {}) {
  const client = await getKv();
  const now = Date.now();
  const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;
  const thirtyDaysAgo = now - 30 * 24 * 60 * 60 * 1000;

  const raw = await client.zRangeByScore(COST_ENTRIES_KEY, thirtyDaysAgo, now, { REV: true });
  const entries30d = raw.map(safeParse).filter(Boolean);

  const filtered = projectId
    ? entries30d.filter((e) => e.kind === 'project' && e.projectId === projectId)
    : entries30d;

  const aggregate = (items, since) => {
    const scoped = items.filter((e) => new Date(e.generatedAt).getTime() >= since);
    let total = 0;
    const byKind = {};
    const byProject = {};
    for (const e of scoped) {
      total += e.costUsd;
      byKind[e.kind] = (byKind[e.kind] || 0) + e.costUsd;
      if (e.projectId) {
        byProject[e.projectId] = (byProject[e.projectId] || 0) + e.costUsd;
      }
    }
    return {
      totalUsd: Number(total.toFixed(4)),
      count: scoped.length,
      byKind: Object.fromEntries(
        Object.entries(byKind).map(([k, v]) => [k, Number(v.toFixed(4))])
      ),
      byProject: Object.fromEntries(
        Object.entries(byProject).map(([k, v]) => [k, Number(v.toFixed(4))])
      ),
    };
  };

  return {
    last7d: aggregate(filtered, sevenDaysAgo),
    last30d: aggregate(filtered, thirtyDaysAgo),
    monthly: await getMonthlyBudget(getKv),
    entries: filtered.slice(0, maxEntries),
    projectId: projectId || null,
  };
}
