// src/ProjectBriefingSection.jsx — sección dentro de la ficha de cada proyecto
// Uso: <ProjectBriefingSection projectId={project.id} apiBase={API_BASE} apiKey={API_KEY} />

import { useState, useEffect } from 'react';

export default function ProjectBriefingSection({ projectId, apiBase = '', apiKey = '' }) {
  const [briefing, setBriefing] = useState(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!projectId) return;
    loadLatest();
  }, [projectId]);

  async function loadLatest() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `${apiBase}/api/briefing/project?projectId=${encodeURIComponent(projectId)}`
      );
      if (res.status === 404) setBriefing(null);
      else if (!res.ok) throw new Error(`HTTP ${res.status}`);
      else setBriefing(await res.json());
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
      const res = await fetch(`${apiBase}/api/briefing/project`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ projectId }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.detail || body.error || `HTTP ${res.status}`);
      }
      setBriefing(await res.json());
    } catch (e) {
      setError(e.message);
    } finally {
      setGenerating(false);
    }
  }

  return (
    <section className="project-briefing">
      <header className="project-briefing-header">
        <div>
          <h3>Chief of Staff</h3>
          {briefing && (
            <p className="project-briefing-meta">
              {formatRelative(briefing.generatedAt)} · {briefing.usage.inputTokens.toLocaleString()} in / {briefing.usage.outputTokens.toLocaleString()} out · ${briefing.usage.costUsd} · {briefing.model}
            </p>
          )}
        </div>
        <button
          className="project-briefing-btn"
          onClick={generate}
          disabled={generating}
        >
          {generating ? 'Analizando proyecto…' : briefing ? 'Regenerar' : 'Preparar sesión'}
        </button>
      </header>

      {error && <div className="project-briefing-error">Error: {error}</div>}
      {loading && <p className="project-briefing-loading">Cargando…</p>}

      {!loading && !briefing && !generating && (
        <div className="project-briefing-empty">
          <p>Antes de meterte a trabajar en este proyecto, pulsa <strong>Preparar sesión</strong>.</p>
          <p className="project-briefing-hint">
            Genera un análisis profundo con Opus 4.7: dónde lo dejaste, qué hacer siguiente,
            decisiones pendientes, riesgos. ~$0.07 por generación.
          </p>
        </div>
      )}

      {briefing && (
        <article className="project-briefing-content">
          <Markdown text={briefing.markdown} />
        </article>
      )}
    </section>
  );
}

// Mismo Markdown minimalista que DailyPulseBanner
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
