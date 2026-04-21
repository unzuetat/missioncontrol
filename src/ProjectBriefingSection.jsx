// src/ProjectBriefingSection.jsx — sección dentro de la ficha de cada proyecto
// Uso: <ProjectBriefingSection projectId={project.id} apiBase={API_BASE} />

import { useState, useEffect } from 'react';
import { AnnotatedMarkdown, formatRelative } from './briefing-utils.jsx';

export default function ProjectBriefingSection({ projectId, apiBase = '', apiKey = '' }) {
  const [items, setItems] = useState([]);
  const [spent30d, setSpent30d] = useState(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState(null);
  const [showHistory, setShowHistory] = useState(false);
  const [expandedIdx, setExpandedIdx] = useState(() => new Set());

  const briefing = items[0] || null;
  const olderItems = items.slice(1);

  useEffect(() => {
    if (!projectId) return;
    loadHistory();
    loadSpending();
  }, [projectId]);

  async function loadHistory() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `${apiBase}/api/briefing/history?kind=project&projectId=${encodeURIComponent(projectId)}`
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setItems(Array.isArray(data.items) ? data.items : []);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  async function loadSpending() {
    try {
      const res = await fetch(
        `${apiBase}/api/briefing/spending?projectId=${encodeURIComponent(projectId)}`
      );
      if (!res.ok) return;
      const data = await res.json();
      setSpent30d({
        total: data.last30d?.totalUsd ?? 0,
        count: data.last30d?.count ?? 0,
      });
    } catch {
      // silent: el badge es decorativo
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
      const fresh = await res.json();
      setItems((prev) => [fresh, ...prev].slice(0, 3));
      loadSpending(); // refresca badge
    } catch (e) {
      setError(e.message);
    } finally {
      setGenerating(false);
    }
  }

  function toggleOlder(idx) {
    setExpandedIdx((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  }

  return (
    <section className="project-briefing">
      <header className="project-briefing-header">
        <div>
          <h3>
            Chief of Staff
            {spent30d && spent30d.count > 0 && (
              <span className="project-briefing-badge" title="Gasto en este proyecto en los últimos 30 días">
                ${spent30d.total} · {spent30d.count} en 30d
              </span>
            )}
          </h3>
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
          <AnnotatedMarkdown
            text={briefing.markdown}
            briefingId={briefing.generatedAt}
            apiBase={apiBase}
            apiKey={apiKey}
          />
        </article>
      )}

      {olderItems.length > 0 && (
        <div className="project-briefing-history">
          <button
            className="project-briefing-history-toggle"
            onClick={() => setShowHistory((v) => !v)}
          >
            {showHistory ? 'Ocultar histórico' : `Ver histórico (${olderItems.length})`}
          </button>
          {showHistory && (
            <div className="briefings-list">
              {olderItems.map((b, idx) => (
                <article key={b.generatedAt || idx} className="briefing-card">
                  <header
                    className="briefing-card-header"
                    onClick={() => toggleOlder(idx)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') toggleOlder(idx); }}
                  >
                    <div className="briefing-card-title">
                      <span className="briefing-card-chevron">{expandedIdx.has(idx) ? '▾' : '▸'}</span>
                      <strong>{formatRelative(b.generatedAt)}</strong>
                    </div>
                    <div className="briefing-card-meta">
                      <span>{b.model}</span>
                      <span>·</span>
                      <span>${b.usage?.costUsd ?? '?'}</span>
                    </div>
                  </header>
                  {expandedIdx.has(idx) && (
                    <div className="briefing-card-body">
                      <AnnotatedMarkdown
                        text={b.markdown}
                        briefingId={b.generatedAt}
                        apiBase={apiBase}
                        apiKey={apiKey}
                      />
                    </div>
                  )}
                </article>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
