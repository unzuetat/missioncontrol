// src/HighlightsView.jsx — pestaña transversal con subrayados de todos los proyectos.

import { useState, useEffect } from 'react';
import { formatAbsolute, tierFromModel } from './briefing-utils.jsx';

export default function HighlightsView({ apiBase = '', t, onOpenProject }) {
  const [groups, setGroups] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [openProjects, setOpenProjects] = useState(() => new Set());

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${apiBase}/api/briefing/highlights`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const g = Array.isArray(data.projects) ? data.projects : [];
      setGroups(g);
      setTotal(data.totalCount || 0);
      // Expandir todos los grupos por defecto (suelen ser pocos y el usuario quiere verlos todos).
      setOpenProjects(new Set(g.map((x) => x.projectId)));
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  function toggle(projectId) {
    setOpenProjects((prev) => {
      const next = new Set(prev);
      if (next.has(projectId)) next.delete(projectId);
      else next.add(projectId);
      return next;
    });
  }

  return (
    <div>
      <section className="highlights-summary">
        <p>
          <strong>{total}</strong> {total === 1 ? 'subrayado' : 'subrayados'} en <strong>{groups.length}</strong> {groups.length === 1 ? 'proyecto' : 'proyectos'}.
        </p>
      </section>

      {loading && <p className="briefings-loading">Cargando…</p>}
      {error && <div className="briefings-error">Error: {error}</div>}

      {!loading && !groups.length && !error && (
        <p className="briefings-empty">
          Aún no hay subrayados. Entra a un proyecto, genera un briefing y pulsa <strong>H</strong> sobre el texto que quieras conservar.
        </p>
      )}

      <div className="highlights-groups">
        {groups.map((g) => {
          const isOpen = openProjects.has(g.projectId);
          return (
            <section key={g.projectId} className="highlights-group">
              <header
                className="highlights-group-header"
                onClick={() => toggle(g.projectId)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') toggle(g.projectId); }}
              >
                <span className="highlights-group-chevron">{isOpen ? '▾' : '▸'}</span>
                <h4>{g.projectName}</h4>
                <span className="highlights-group-count">{g.highlights.length}</span>
                {onOpenProject && (
                  <button
                    type="button"
                    className="highlights-group-open"
                    onClick={(e) => { e.stopPropagation(); onOpenProject(g.projectId); }}
                    title="Abrir proyecto"
                  >
                    ver →
                  </button>
                )}
              </header>
              {isOpen && (
                <ul className="project-highlights-list">
                  {g.highlights.map((h, idx) => (
                    <li key={`${h.briefingId}-${h.blockIdx}-${idx}`} className="project-highlight">
                      <div className="project-highlight-text">{h.text}</div>
                      {h.comment && <div className="project-highlight-comment">💬 {h.comment}</div>}
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
          );
        })}
      </div>
    </div>
  );
}
