// src/DailyPulseBanner.jsx — banner compacto arriba del dashboard.
// Muestra el último pulso diario y permite regenerarlo con flavor (técnico/ejecutivo)
// vía el agente residente del Mac (suscripción de Claude Code, coste 0). Los tiers
// por API de Anthropic se retiraron el 2026-09-09 a petición de Telmo.
// Uso: <DailyPulseBanner apiBase={API_BASE} apiKey={API_KEY} />
// apiKey se usa solo para anotaciones (PUT). GET es público.

import { useState, useEffect } from 'react';
import { AnnotatedMarkdown, formatRelative, formatAbsolute, briefingTag, costLabel } from './briefing-utils.jsx';
import { useAgents, useAgentJob, JobStatus, AgentChips, SUB_TIERS, agentLabels } from './agent-jobs.jsx';

const FLAVORS = [
  { id: 'technical', label: 'Técnico',   hint: 'Pulso matinal ligero: dónde estás hoy, atento a, una hora libre.' },
  { id: 'executive', label: 'Ejecutivo', hint: 'Visión PM de portfolio: focus, sinergias, señales técnicas, monetización.' },
];

export default function DailyPulseBanner({ apiBase = '', apiKey = '' }) {
  const [pulse, setPulse] = useState(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(false);
  const [error, setError] = useState(null);
  const [flavor, setFlavor] = useState('technical');
  const { agents, anyOnline } = useAgents(apiBase);
  const agentJob = useAgentJob(apiBase, {
    onDone: () => { loadLatest(); setExpanded(true); },
  });

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

  if (loading) return null;

  return (
    <div className="daily-pulse">
      <div className="daily-pulse-header">
        <div className="daily-pulse-title">
          <span className="daily-pulse-label">Pulso diario</span>
          {pulse && (
            <span className="daily-pulse-meta">
              · {formatAbsolute(pulse.generatedAt)} · {formatRelative(pulse.generatedAt)} · {briefingTag(pulse)} · {costLabel(pulse)}
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
              disabled={agentJob.busy}
              title={f.hint}
            >
              {f.label}
            </button>
          ))}
        </div>
        <div className="project-briefing-tiers">
          {SUB_TIERS.map((tier) => (
            <button
              key={tier.id}
              type="button"
              className="project-briefing-tier is-subscription"
              onClick={() => agentJob.run('briefing', { kind: 'daily', flavor, model: tier.model })}
              disabled={agentJob.busy || !anyOnline}
              title={anyOnline ? tier.hint : agentLabels.agentOfflineHint}
            >
              <span className="project-briefing-tier-label">{agentJob.busy ? 'En marcha…' : tier.label}</span>
              <span className="project-briefing-tier-model">{tier.modelShort}</span>
              <span className="project-briefing-tier-price">{tier.price}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="mc-agent-row">
        <AgentChips agents={agents} />
        <JobStatus job={agentJob.job} onCancel={agentJob.cancel} />
      </div>

      {error && <div className="daily-pulse-error">Error: {error}</div>}
      {agentJob.error && <div className="daily-pulse-error">Error del agente: {agentJob.error}</div>}

      {!pulse && !agentJob.busy && !error && (
        <p className="daily-pulse-empty">
          Elige <strong>tono</strong> y pulsa <strong>Suscripción</strong>: el pulso se genera en tu Mac con tu suscripción de Claude, sin coste de API.
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
