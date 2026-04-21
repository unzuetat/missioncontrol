// src/ProjectBriefingSection.jsx — sección dentro de la ficha de cada proyecto
// Uso: <ProjectBriefingSection projectId={project.id} apiBase={API_BASE} />

import { useState, useEffect } from 'react';
import { AnnotatedMarkdown, formatRelative, formatAbsolute, briefingTag, tierFromModel } from './briefing-utils.jsx';

const TIERS = [
  { id: 'flash',    model: 'claude-haiku-4-5',  label: 'Flash',    price: '~$0.01', hint: 'Recap rápido' },
  { id: 'normal',   model: 'claude-sonnet-4-6', label: 'Normal',   price: '~$0.03', hint: 'Briefing normal' },
  { id: 'profundo', model: 'claude-opus-4-7',   label: 'Profundo', price: '~$0.07', hint: 'Análisis denso' },
];

const FLAVORS = [
  { id: 'technical', label: 'Técnico',   hint: 'Dónde lo dejaste, qué hacer siguiente, riesgos. Orientado a código.' },
  { id: 'executive', label: 'Ejecutivo', hint: 'Estado, dirección, recomendaciones con coste/beneficio/esfuerzo, roadmap.' },
];

export default function ProjectBriefingSection({ projectId, apiBase = '', apiKey = '' }) {
  const [items, setItems] = useState([]);
  const [spent30d, setSpent30d] = useState(null);
  const [highlights, setHighlights] = useState([]);
  const [highlightsOpen, setHighlightsOpen] = useState(true);
  const [loading, setLoading] = useState(true);
  const [generatingTier, setGeneratingTier] = useState(null);
  const [flavor, setFlavor] = useState('technical');
  const [error, setError] = useState(null);
  const [showHistory, setShowHistory] = useState(false);
  const [expandedIdx, setExpandedIdx] = useState(() => new Set());

  const briefing = items[0] || null;
  const olderItems = items.slice(1);

  useEffect(() => {
    if (!projectId) return;
    loadHistory();
    loadSpending();
    loadHighlights();
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

  async function loadHighlights() {
    try {
      const res = await fetch(
        `${apiBase}/api/briefing/highlights?projectId=${encodeURIComponent(projectId)}`
      );
      if (!res.ok) return;
      const data = await res.json();
      setHighlights(Array.isArray(data.highlights) ? data.highlights : []);
    } catch {
      // silent: seccion opcional
    }
  }

  async function generate(tier) {
    setGeneratingTier(tier.id);
    setError(null);
    try {
      const headers = { 'Content-Type': 'application/json' };
      if (apiKey) headers['x-api-key'] = apiKey;
      const res = await fetch(`${apiBase}/api/briefing/project`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ projectId, model: tier.model, flavor }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.detail || body.error || `HTTP ${res.status}`);
      }
      const fresh = await res.json();
      setItems((prev) => [fresh, ...prev].slice(0, 10));
      loadSpending(); // refresca badge
    } catch (e) {
      setError(e.message);
    } finally {
      setGeneratingTier(null);
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
              {formatAbsolute(briefing.generatedAt)} · {formatRelative(briefing.generatedAt)} · {briefingTag(briefing)} · {briefing.usage.inputTokens.toLocaleString()} in / {briefing.usage.outputTokens.toLocaleString()} out · ${briefing.usage.costUsd}
            </p>
          )}
        </div>
        <div className="project-briefing-actions">
          <div className="project-briefing-flavors" role="tablist" aria-label="Tipo de briefing">
            {FLAVORS.map((f) => (
              <button
                key={f.id}
                type="button"
                role="tab"
                aria-selected={flavor === f.id}
                className={`project-briefing-flavor ${flavor === f.id ? 'is-active' : ''}`}
                onClick={() => setFlavor(f.id)}
                disabled={!!generatingTier}
                title={f.hint}
              >
                {f.label}
              </button>
            ))}
          </div>
          <div className="project-briefing-tiers">
            {TIERS.map((tier) => {
              const isGenerating = generatingTier === tier.id;
              const anyGenerating = !!generatingTier;
              return (
                <button
                  key={tier.id}
                  type="button"
                  className={`project-briefing-tier ${tier.id === 'normal' ? 'is-primary' : 'is-secondary'}`}
                  onClick={() => generate(tier)}
                  disabled={anyGenerating}
                  title={tier.hint}
                >
                  <span className="project-briefing-tier-label">
                    {isGenerating ? 'Analizando…' : tier.label}
                  </span>
                  <span className="project-briefing-tier-price">{tier.price}</span>
                </button>
              );
            })}
          </div>
        </div>
      </header>

      {error && <div className="project-briefing-error">Error: {error}</div>}
      {loading && <p className="project-briefing-loading">Cargando…</p>}

      {!loading && !briefing && !generatingTier && (
        <div className="project-briefing-empty">
          <p>
            Elige <strong>flavor</strong> y <strong>tier</strong> y genera briefing.
          </p>
          <p className="project-briefing-hint">
            <strong>Técnico</strong> — dónde lo dejaste, qué hacer siguiente, riesgos (código).
            {' '}<strong>Ejecutivo</strong> — dirección, recomendaciones con coste/beneficio/esfuerzo, roadmap.
            {' '}Tiers: Flash (recap), Normal (default), Profundo (denso).
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
            onChange={loadHighlights}
          />
        </article>
      )}

      {highlights.length > 0 && (
        <section className="project-highlights">
          <header
            className="project-highlights-header"
            onClick={() => setHighlightsOpen((v) => !v)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setHighlightsOpen((v) => !v); }}
          >
            <span className="project-highlights-chevron">{highlightsOpen ? '▾' : '▸'}</span>
            <h4>📌 Subrayados</h4>
            <span className="project-highlights-count">{highlights.length}</span>
          </header>
          {highlightsOpen && (
            <ul className="project-highlights-list">
              {highlights.map((h, idx) => (
                <li key={`${h.briefingId}-${h.blockIdx}-${idx}`} className="project-highlight">
                  <div className="project-highlight-text">{h.text}</div>
                  {h.comment && (
                    <div className="project-highlight-comment">💬 {h.comment}</div>
                  )}
                  <div className="project-highlight-source">
                    {formatAbsolute(h.briefingGeneratedAt)}
                    {' · '}{h.flavor === 'executive' ? 'ejecutivo' : 'técnico'}
                    {' · '}{tierFromModel(h.model)}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
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
                      <strong>{formatAbsolute(b.generatedAt)}</strong>
                      <span className="briefing-card-rel">· {formatRelative(b.generatedAt)}</span>
                    </div>
                    <div className="briefing-card-meta">
                      <span>{briefingTag(b)}</span>
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
                        onChange={loadHighlights}
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
