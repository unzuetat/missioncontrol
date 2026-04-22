// src/DailyPulseBanner.jsx — banner compacto arriba del dashboard.
// Muestra el último pulso diario y permite regenerar con flavor (técnico/ejecutivo)
// y tier (flash/normal/profundo), mismo criterio que ProjectBriefingSection.
// Uso: <DailyPulseBanner apiBase={API_BASE} apiKey={API_KEY} />
// apiKey se usa solo para POST (generar). GET es público.

import { useState, useEffect } from 'react';
import { AnnotatedMarkdown, formatRelative, formatAbsolute, briefingTag } from './briefing-utils.jsx';

const TIERS = [
  { id: 'flash',    model: 'claude-haiku-4-5',  label: 'Flash',    price: '~$0.01', hint: 'Recap rápido' },
  { id: 'normal',   model: 'claude-sonnet-4-6', label: 'Normal',   price: '~$0.03', hint: 'Default' },
  { id: 'profundo', model: 'claude-opus-4-7',   label: 'Profundo', price: '~$0.07', hint: 'Análisis denso' },
];

const FLAVORS = [
  { id: 'technical', label: 'Técnico',   hint: 'Pulso matinal ligero: dónde estás hoy, atento a, una hora libre.' },
  { id: 'executive', label: 'Ejecutivo', hint: 'Visión PM de portfolio: focus, sinergias, señales técnicas, monetización.' },
];

export default function DailyPulseBanner({ apiBase = '', apiKey = '' }) {
  const [pulse, setPulse] = useState(null);
  const [loading, setLoading] = useState(true);
  const [generatingTier, setGeneratingTier] = useState(null);
  const [expanded, setExpanded] = useState(false);
  const [error, setError] = useState(null);
  const [flavor, setFlavor] = useState('technical');

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

  async function generate(tier) {
    setGeneratingTier(tier.id);
    setError(null);
    try {
      const headers = { 'Content-Type': 'application/json' };
      if (apiKey) headers['x-api-key'] = apiKey;
      const res = await fetch(`${apiBase}/api/briefing/daily`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ model: tier.model, flavor }),
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
      setGeneratingTier(null);
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
              · {formatAbsolute(pulse.generatedAt)} · {formatRelative(pulse.generatedAt)} · {briefingTag(pulse)} · ${pulse.usage.costUsd}
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
        </div>
      </div>

      <div className="daily-pulse-controls">
        <div className="project-briefing-flavors" role="tablist" aria-label="Tipo de pulso">
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
                  {isGenerating ? 'Generando…' : tier.label}
                </span>
                <span className="project-briefing-tier-price">{tier.price}</span>
              </button>
            );
          })}
        </div>
      </div>

      {error && <div className="daily-pulse-error">Error: {error}</div>}

      {!pulse && !generatingTier && !error && (
        <p className="daily-pulse-empty">
          Elige <strong>tono</strong> y <strong>tier</strong> y pulsa para generar el pulso del portfolio.
        </p>
      )}

      {pulse && expanded && (
        <article className="daily-pulse-content">
          <AnnotatedMarkdown
            text={pulse.markdown}
            briefingId={pulse.generatedAt}
            apiBase={apiBase}
            apiKey={apiKey}
          />
        </article>
      )}
    </div>
  );
}
