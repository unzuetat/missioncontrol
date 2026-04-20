// src/DailyPulseBanner.jsx — banner compacto arriba del dashboard
// Uso: <DailyPulseBanner apiBase={API_BASE} apiKey={API_KEY} />
// apiKey se usa solo para POST (generar). GET es público.

import { useState, useEffect } from 'react';

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

// ---------------------------------------------------------------------------
// Render markdown minimalista (sin deps)

function Markdown({ text }) {
  const lines = text.split('\n');
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.startsWith('# ')) out.push(<h1 key={i}>{line.slice(2)}</h1>);
    else if (line.startsWith('## ')) out.push(<h2 key={i}>{line.slice(3)}</h2>);
    else if (line.startsWith('### ')) out.push(<h3 key={i}>{line.slice(4)}</h3>);
    else if (line.startsWith('- ') || line.startsWith('* ')) {
      const items = [];
      while (i < lines.length && (lines[i].startsWith('- ') || lines[i].startsWith('* '))) {
        items.push(lines[i].slice(2));
        i++;
      }
      out.push(
        <ul key={`ul-${i}`}>
          {items.map((it, idx) => <li key={idx}>{renderInline(it)}</li>)}
        </ul>
      );
      continue;
    } else if (line.trim()) {
      out.push(<p key={i}>{renderInline(line)}</p>);
    }
    i++;
  }
  return <>{out}</>;
}

function renderInline(text) {
  const parts = [];
  const regex = /(\*\*[^*]+\*\*|`[^`]+`)/g;
  let lastIdx = 0, key = 0, m;
  while ((m = regex.exec(text)) !== null) {
    if (m.index > lastIdx) parts.push(text.slice(lastIdx, m.index));
    const tok = m[0];
    if (tok.startsWith('**')) parts.push(<strong key={key++}>{tok.slice(2, -2)}</strong>);
    else parts.push(<code key={key++}>{tok.slice(1, -1)}</code>);
    lastIdx = m.index + tok.length;
  }
  if (lastIdx < text.length) parts.push(text.slice(lastIdx));
  return parts.length ? parts : text;
}

function formatRelative(isoDate) {
  const diff = Date.now() - new Date(isoDate).getTime();
  const mins = Math.round(diff / 60000);
  if (mins < 1) return 'ahora mismo';
  if (mins < 60) return `hace ${mins} min`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `hace ${hours}h`;
  const days = Math.round(hours / 24);
  return `hace ${days}d`;
}
