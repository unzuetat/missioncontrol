// src/BriefingsView.jsx — pestaña Briefings: gastos + últimos pulsos.

import { useState, useEffect, useMemo } from 'react';
import { AnnotatedMarkdown, formatRelative, formatAbsolute, briefingTag } from './briefing-utils.jsx';

export default function BriefingsView({ apiBase = '', apiKey = '', t, projects = [] }) {
  const [items, setItems] = useState([]);
  const [spending, setSpending] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [expanded, setExpanded] = useState(() => new Set([0]));
  const [filter, setFilter] = useState({ kind: 'all', projectId: '' });

  useEffect(() => { loadAll(); }, [filter.kind, filter.projectId]);

  async function loadAll() {
    setLoading(true);
    setError(null);
    try {
      const isProject = filter.kind === 'project' && filter.projectId;
      const spendingUrl = isProject
        ? `${apiBase}/api/briefing/spending?projectId=${encodeURIComponent(filter.projectId)}`
        : `${apiBase}/api/briefing/spending`;
      const historyUrl = isProject
        ? `${apiBase}/api/briefing/history?kind=project&projectId=${encodeURIComponent(filter.projectId)}`
        : `${apiBase}/api/briefing/history?kind=daily`;
      const [historyRes, spendingRes] = await Promise.all([
        fetch(historyUrl),
        fetch(spendingUrl),
      ]);
      if (!historyRes.ok) throw new Error(`history HTTP ${historyRes.status}`);
      if (!spendingRes.ok) throw new Error(`spending HTTP ${spendingRes.status}`);
      const historyData = await historyRes.json();
      const spendingData = await spendingRes.json();
      setItems(Array.isArray(historyData.items) ? historyData.items : []);
      setSpending(spendingData);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  const projectIdsWithSpending = useMemo(() => {
    if (!spending) return [];
    return Object.keys(spending.last30d?.byProject || {}).sort();
  }, [spending]);

  const projectsMap = useMemo(() => {
    const m = {};
    for (const p of projects) m[p.id] = p.name || p.id;
    return m;
  }, [projects]);

  function toggle(idx) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  }

  const historyHeading = filter.kind === 'project' && filter.projectId
    ? `Últimos briefings · ${projectsMap[filter.projectId] || filter.projectId}`
    : 'Últimos pulsos diarios';

  return (
    <div>
      <section className="spending-section">
        <div className="spending-filter">
          <button
            className={`spending-tab ${filter.kind === 'all' ? 'active' : ''}`}
            onClick={() => setFilter({ kind: 'all', projectId: '' })}
            type="button"
          >
            Todo
          </button>
          <button
            className={`spending-tab ${filter.kind === 'daily' ? 'active' : ''}`}
            onClick={() => setFilter({ kind: 'daily', projectId: '' })}
            type="button"
          >
            Solo pulso diario
          </button>
          <select
            className="spending-select"
            value={filter.kind === 'project' ? filter.projectId : ''}
            onChange={(e) => {
              const v = e.target.value;
              setFilter(v ? { kind: 'project', projectId: v } : { kind: 'all', projectId: '' });
            }}
          >
            <option value="">Por proyecto…</option>
            {projectIdsWithSpending.map((id) => (
              <option key={id} value={id}>{projectsMap[id] || id}</option>
            ))}
          </select>
        </div>

        {loading && !spending && <p className="briefings-loading">Calculando gastos…</p>}
        {error && <div className="briefings-error">Error: {error}</div>}

        {spending && (
          <div className="spending-cards">
            <SpendingCard
              label="Últimos 7 días"
              total={spending.last7d.totalUsd}
              count={spending.last7d.count}
              byKind={spending.last7d.byKind}
              showBreakdown={filter.kind === 'all'}
            />
            <SpendingCard
              label="Últimos 30 días"
              total={spending.last30d.totalUsd}
              count={spending.last30d.count}
              byKind={spending.last30d.byKind}
              showBreakdown={filter.kind === 'all'}
            />
            {!spending.projectId && (
              <SpendingCard
                label={`Este mes · cap $${spending.monthly.capUsd}`}
                total={spending.monthly.spentUsd}
                count={spending.monthly.generations}
                remaining={spending.monthly.remainingUsd}
                isCap
              />
            )}
          </div>
        )}
      </section>

      <section className="briefings-history-section">
        <h4 className="briefings-heading">{historyHeading}</h4>
        {loading && !items.length && <p className="briefings-loading">Cargando…</p>}
        {!loading && !items.length && !error && (
          <p className="briefings-empty">{t('noBriefings')}</p>
        )}
        <div className="briefings-list">
          {items.map((b, idx) => (
            <BriefingCard
              key={b.generatedAt || idx}
              b={b}
              expanded={expanded.has(idx)}
              onToggle={() => toggle(idx)}
              apiBase={apiBase}
              apiKey={apiKey}
            />
          ))}
        </div>
      </section>
    </div>
  );
}

function SpendingCard({ label, total, count, byKind, remaining, isCap, showBreakdown }) {
  return (
    <div className={`spending-card ${isCap ? 'spending-card-cap' : ''}`}>
      <div className="spending-card-label">{label}</div>
      <div className="spending-card-total">${total}</div>
      <div className="spending-card-meta">
        {count} {count === 1 ? 'generación' : 'generaciones'}
        {isCap && typeof remaining === 'number' && (<> · ${remaining} restantes</>)}
      </div>
      {showBreakdown && byKind && (byKind.daily || byKind.project) && (
        <div className="spending-card-breakdown">
          {byKind.daily > 0 && <span>daily ${byKind.daily}</span>}
          {byKind.project > 0 && <span>project ${byKind.project}</span>}
        </div>
      )}
    </div>
  );
}

function BriefingCard({ b, expanded, onToggle, apiBase, apiKey }) {
  return (
    <article className="briefing-card">
      <header
        className="briefing-card-header"
        onClick={onToggle}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onToggle(); }}
      >
        <div className="briefing-card-title">
          <span className="briefing-card-chevron">{expanded ? '▾' : '▸'}</span>
          <strong>{formatAbsolute(b.generatedAt)}</strong>
          <span className="briefing-card-rel">· {formatRelative(b.generatedAt)}</span>
        </div>
        <div className="briefing-card-meta">
          <span>{b.kind === 'project' ? briefingTag(b) : `pulso · ${b.model}`}</span>
          <span>·</span>
          <span>${b.usage?.costUsd ?? '?'}</span>
          {typeof b.projectCount === 'number' && (
            <><span>·</span><span>{b.projectCount} proyectos</span></>
          )}
        </div>
      </header>
      {expanded && (
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
  );
}

