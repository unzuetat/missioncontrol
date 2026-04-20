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
