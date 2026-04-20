// src/DailyPulseBanner.jsx — banner compacto arriba del dashboard
// Uso: <DailyPulseBanner apiBase={API_BASE} apiKey={API_KEY} />
// apiKey se usa solo para POST (generar). GET es público.

import { useState, useEffect } from 'react';
import { Markdown, formatRelative } from './briefing-utils.jsx';

export default function DailyPulseBanner({ apiBase = '', apiKey = '' }) {
  const [pulse, setPulse] = useState(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => { loadLatest(); }, []);

  async function loadLatest() {
    setLoading(true);
    try {
      const res = await fetch(`${apiBase}/api/briefing/daily`);
      if (res.status === 404) setPulse(null);
      else if (!res.ok) throw new Error(`HTTP ${res.status}`);
      else setPulse(await res.json());
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  async function generate() {
    setGenerating(true);
    setError(null);
    try {
      const headers = { 'Content-Type': 'application/json' };
      if (apiKey) headers['x-api-key'] = apiKey;
      const res = await fetch(`${apiBase}/api/briefing/daily`, {
        method: 'POST',
        headers,
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.detail || body.error || `HTTP ${res.status}`);
      }
      setPulse(await res.json());
      setExpanded(true);
    } catch (e) {
      setError(e.message);
    } finally {
      setGenerating(false);
    }
  }

  if (loading) return null;

  return (
    <div className="daily-pulse">
      <div className="daily-pulse-header">
        <div className="daily-pulse-title">
          <span className="daily-pulse-label">Pulso diario</span>
          {pulse && (
            <span className="daily-pulse-meta">
              · {formatRelative(pulse.generatedAt)} · ${pulse.usage.costUsd}
            </span>
          )}
        </div>
        <div className="daily-pulse-actions">
          {pulse && (
            <button
              className="daily-pulse-btn-ghost"
              onClick={() => setExpanded((e) => !e)}
            >
              {expanded ? 'Ocultar' : 'Ver'}
            </button>
          )}
          <button
            className="daily-pulse-btn"
            onClick={generate}
            disabled={generating}
          >
            {generating ? 'Generando…' : pulse ? 'Regenerar' : 'Generar pulso'}
          </button>
        </div>
      </div>

      {error && <div className="daily-pulse-error">Error: {error}</div>}

      {!pulse && !generating && !error && (
        <p className="daily-pulse-empty">
          Pulsa <strong>Generar pulso</strong> para un resumen ligero del estado del portfolio.
        </p>
      )}

      {pulse && expanded && (
        <article className="daily-pulse-content">
          <Markdown text={pulse.markdown} />
        </article>
      )}
    </div>
  );
}

