// src/BriefingsView.jsx — pestaña con los últimos 3 pulsos diarios.

import { useState, useEffect } from 'react';
import { Markdown, formatRelative } from './briefing-utils.jsx';

export default function BriefingsView({ apiBase = '', t }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [expanded, setExpanded] = useState(() => new Set([0])); // primer item abierto

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${apiBase}/api/briefing/history?kind=daily`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setItems(Array.isArray(data.items) ? data.items : []);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  function toggle(idx) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  }

  if (loading) return <p className="briefings-loading">Cargando…</p>;
  if (error) return <div className="briefings-error">Error: {error}</div>;
  if (!items.length) return <p className="briefings-empty">{t('noBriefings')}</p>;

  return (
    <div className="briefings-list">
      {items.map((b, idx) => (
        <article key={b.generatedAt || idx} className="briefing-card">
          <header
            className="briefing-card-header"
            onClick={() => toggle(idx)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') toggle(idx); }}
          >
            <div className="briefing-card-title">
              <span className="briefing-card-chevron">{expanded.has(idx) ? '▾' : '▸'}</span>
              <strong>{formatAbsolute(b.generatedAt)}</strong>
              <span className="briefing-card-rel">· {formatRelative(b.generatedAt)}</span>
            </div>
            <div className="briefing-card-meta">
              <span>{b.model}</span>
              <span>·</span>
              <span>${b.usage?.costUsd ?? '?'}</span>
              {typeof b.projectCount === 'number' && (
                <>
                  <span>·</span>
                  <span>{b.projectCount} proyectos</span>
                </>
              )}
            </div>
          </header>
          {expanded.has(idx) && (
            <div className="briefing-card-body">
              <Markdown text={b.markdown} />
            </div>
          )}
        </article>
      ))}
    </div>
  );
}

function formatAbsolute(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleString('es-ES', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}
