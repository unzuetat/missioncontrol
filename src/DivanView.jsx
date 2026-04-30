// src/DivanView.jsx — pestaña Diván: think tank que bebe del contexto cross-proyecto.
//
// Flujo:
//   1. Usuario elige modo, proyectos (opcional), profundidad, escribe pregunta.
//   2. POST /api/divan/run → respuesta markdown.
//   3. Acciones sobre la última respuesta:
//        · Guardar como crumb (a un proyecto destino).
//        · Promover a proyecto idea (crea proyecto status='idea' + crumb dentro).
//        · Guardar para iterar (POST /api/divan/sessions; persiste hilo en Redis).
//   4. Si la respuesta del modo "ajustes" trae __divan_mode_draft, en lugar de
//      texto se renderiza un formulario pre-rellenado para crear el modo nuevo.
//
// Sesiones guardadas (sidebar / retomar) llegarán en PR C.

import { useState, useEffect, useMemo, useRef } from 'react';
import { api } from './api.js';
import { AnnotatedMarkdown } from './briefing-utils.jsx';

const DEPTHS = [
  { id: 'rapido', label: 'Rápido', estimateUsd: 0.005 },
  { id: 'normal', label: 'Normal', estimateUsd: 0.04 },
  { id: 'toston', label: 'Tostón', estimateUsd: 0.18 },
];

const DEPTH_BY_ID = Object.fromEntries(DEPTHS.map((d) => [d.id, d]));

export default function DivanView({ apiBase = '', t, projects = [] }) {
  const [modes, setModes] = useState([]);
  const [selectedModeId, setSelectedModeId] = useState(null);
  const [selectedProjectIds, setSelectedProjectIds] = useState([]);
  const [includeTransversal, setIncludeTransversal] = useState(true);
  const [depth, setDepth] = useState('normal');
  const [userInput, setUserInput] = useState('');

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [history, setHistory] = useState([]); // {role, content, modeDraft?}
  const [budget, setBudget] = useState(null);

  const [savedFlash, setSavedFlash] = useState(null);
  const [showProjectPicker, setShowProjectPicker] = useState(false);
  const [projectSearch, setProjectSearch] = useState('');

  const [loadingModes, setLoadingModes] = useState(true);
  const [modesError, setModesError] = useState(null);

  const transversalUserOverride = useRef(false);
  const responseRef = useRef(null);

  // Cargar modos al montar.
  useEffect(() => {
    let cancel = false;
    api.divanListModes()
      .then((data) => {
        if (cancel) return;
        const list = Array.isArray(data?.modes) ? data.modes : [];
        setModes(list);
        if (list.length > 0 && !selectedModeId) {
          setSelectedModeId(list[0].id);
        }
        setLoadingModes(false);
      })
      .catch((e) => {
        if (cancel) return;
        setModesError(e?.detail || e?.error || 'No se pudieron cargar los modos.');
        setLoadingModes(false);
      });
    return () => { cancel = true; };
  }, []);

  // Cuando cambia el modo, ajustar profundidad por defecto (NO toca proyectos ni transversal).
  useEffect(() => {
    if (!selectedModeId) return;
    const m = modes.find((x) => x.id === selectedModeId);
    if (!m) return;
    if (m.defaultDepth) setDepth(m.defaultDepth);
  }, [selectedModeId]);

  // Auto-default de includeTransversal si el usuario no lo ha tocado manualmente.
  useEffect(() => {
    if (transversalUserOverride.current) return;
    setIncludeTransversal(selectedProjectIds.length === 0);
  }, [selectedProjectIds.length]);

  const selectedMode = useMemo(
    () => modes.find((m) => m.id === selectedModeId) || null,
    [modes, selectedModeId]
  );

  const projectMap = useMemo(() => {
    const m = {};
    for (const p of projects) m[p.id] = p;
    return m;
  }, [projects]);

  const groupedProjects = useMemo(() => {
    const q = projectSearch.trim().toLowerCase();
    const matches = (p) => !q || p.name?.toLowerCase().includes(q) || p.id?.toLowerCase().includes(q);
    const active = [];
    const archived = [];
    for (const p of projects) {
      if (!matches(p)) continue;
      if (p.status === 'archivado' || p.status === 'archived') archived.push(p);
      else active.push(p);
    }
    return { active, archived };
  }, [projects, projectSearch]);

  function toggleProject(id) {
    setSelectedProjectIds((curr) =>
      curr.includes(id) ? curr.filter((x) => x !== id) : [...curr, id]
    );
  }

  async function think() {
    if (!selectedModeId || !userInput.trim() || busy) return;
    setBusy(true);
    setError(null);
    const message = userInput.trim();
    try {
      const data = await api.divanRun({
        modeId: selectedModeId,
        projectIds: selectedProjectIds,
        includeTransversal,
        depth,
        userMessage: message,
      });
      setHistory((h) => [
        ...h,
        { role: 'user', content: message },
        {
          role: 'assistant',
          content: data.markdown,
          modeDraft: data.modelDraftDetected || null,
          briefingId: data.briefingId || null,
          model: data.model,
          depth: data.depth,
          usage: data.usage,
          modeName: selectedMode?.name || null,
          modeColor: selectedMode?.color || null,
          generatedAt: data.briefingId || new Date().toISOString(),
          degraded: Array.isArray(data.degraded) ? data.degraded : [],
          truncated: !!data.truncated,
          estimatedContextTokens: data.estimatedContextTokens || null,
        },
      ]);
      setUserInput('');
      if (data.budget) setBudget(data.budget);
      // scroll a la última respuesta
      requestAnimationFrame(() => {
        responseRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
      });
    } catch (e) {
      setError(e?.detail || e?.error || 'Error al pensar.');
    } finally {
      setBusy(false);
    }
  }

  async function handleSaveSession() {
    try {
      const turns = history.map((t) => ({ role: t.role, content: t.content }));
      const session = await api.divanCreateSession({
        modeId: selectedModeId,
        projectIds: selectedProjectIds,
        includeTransversal,
        depth,
        turns,
      });
      flash(`Sesión guardada (${session.id?.slice(0, 8) || ''}…)`);
    } catch (e) {
      setError(e?.detail || e?.error || 'No se pudo guardar la sesión.');
    }
  }

  async function handleCreateModeFromDraft(draft) {
    try {
      const created = await api.divanCreateMode(draft);
      const list = await api.divanListModes();
      setModes(Array.isArray(list?.modes) ? list.modes : []);
      setSelectedModeId(created.id);
      setHistory([]);
      flash(`Modo "${created.name}" creado.`);
    } catch (e) {
      setError(e?.detail || e?.error || 'No se pudo crear el modo.');
    }
  }

  function flash(msg) {
    setSavedFlash(msg);
    setTimeout(() => setSavedFlash((curr) => (curr === msg ? null : curr)), 2500);
  }

  if (loadingModes) {
    return <p className="divan-loading">Cargando modos del Diván…</p>;
  }

  if (modesError) {
    return (
      <div className="divan-error-block">
        <p>No se pudieron cargar los modos: {modesError}</p>
        <p className="divan-hint">
          Si Redis está vacío, corre desde local: <code>npm run seed-divan-modes</code>
        </p>
      </div>
    );
  }

  if (!modes.length) {
    return (
      <div className="divan-empty">
        <p>No hay modos en Redis todavía.</p>
        <p className="divan-hint">
          Pobla los 8 modos por defecto desde local: <code>npm run seed-divan-modes</code>
        </p>
      </div>
    );
  }

  const lastAssistant = [...history].reverse().find((t) => t.role === 'assistant');
  const showActionsForLast = !!lastAssistant && !lastAssistant.modeDraft;
  const estimatedCost = DEPTH_BY_ID[depth]?.estimateUsd ?? 0.04;

  return (
    <div className="divan">
      {/* MODO */}
      <Section label="Modo">
        <div className="divan-modes">
          {modes.map((m) => (
            <ModeChip
              key={m.id}
              mode={m}
              selected={m.id === selectedModeId}
              onClick={() => { setSelectedModeId(m.id); setHistory([]); }}
            />
          ))}
        </div>
        {selectedMode?.description && (
          <p className="divan-mode-desc">{selectedMode.description}</p>
        )}
      </Section>

      {/* PROYECTOS */}
      <Section
        label={`Proyectos (${selectedProjectIds.length} elegidos${selectedProjectIds.length === 0 ? ' · ninguno = análisis transversal sobre ti' : ''})`}
      >
        <div className="divan-project-picker">
          <input
            className="divan-project-search"
            placeholder="Buscar proyecto…"
            value={projectSearch}
            onChange={(e) => setProjectSearch(e.target.value)}
            onFocus={() => setShowProjectPicker(true)}
          />
          <button
            className="divan-project-toggle"
            type="button"
            onClick={() => {
              const activeIds = projects
                .filter((p) => p.status !== 'archivado' && p.status !== 'archived')
                .map((p) => p.id);
              setSelectedProjectIds(activeIds);
            }}
            title="Seleccionar todos los proyectos activos"
          >
            Todos activos
          </button>
          <button
            className="divan-project-toggle"
            type="button"
            onClick={() => setSelectedProjectIds([])}
            disabled={selectedProjectIds.length === 0}
            title="Quitar todas las selecciones"
          >
            Limpiar
          </button>
          <button
            className="divan-project-toggle"
            type="button"
            onClick={() => setShowProjectPicker((v) => !v)}
          >
            {showProjectPicker ? 'Cerrar' : 'Abrir'}
          </button>
        </div>

        {showProjectPicker && (
          <div className="divan-project-list">
            <ProjectGroup
              label="Activos"
              projects={groupedProjects.active}
              selectedIds={selectedProjectIds}
              onToggle={toggleProject}
            />
            {groupedProjects.archived.length > 0 && (
              <ProjectGroup
                label="Archivados"
                projects={groupedProjects.archived}
                selectedIds={selectedProjectIds}
                onToggle={toggleProject}
                muted
              />
            )}
            {groupedProjects.active.length === 0 && groupedProjects.archived.length === 0 && (
              <p className="divan-empty-list">Ningún proyecto coincide con "{projectSearch}".</p>
            )}
          </div>
        )}

        {selectedProjectIds.length > 0 && (
          <div className="divan-selected-chips">
            {selectedProjectIds.map((id) => (
              <button
                key={id}
                type="button"
                className="divan-selected-chip"
                onClick={() => toggleProject(id)}
                title="Quitar"
              >
                {projectMap[id]?.name || id}
                <span className="divan-chip-x">×</span>
              </button>
            ))}
          </div>
        )}
      </Section>

      {/* TRANSVERSAL */}
      <Section>
        <label className="divan-checkbox">
          <input
            type="checkbox"
            checked={includeTransversal}
            onChange={(e) => {
              transversalUserOverride.current = true;
              setIncludeTransversal(e.target.checked);
            }}
          />
          <span>Incluir perfil transversal del portfolio</span>
        </label>
      </Section>

      {/* PROFUNDIDAD */}
      <Section label="Profundidad">
        <div className="divan-depth">
          {DEPTHS.map((d) => (
            <button
              key={d.id}
              type="button"
              className={`divan-depth-btn ${depth === d.id ? 'is-active' : ''}`}
              onClick={() => setDepth(d.id)}
            >
              {d.label}
            </button>
          ))}
          <span className="divan-depth-est">≈ ${estimatedCost.toFixed(3)} / llamada</span>
        </div>
      </Section>

      {/* INPUT */}
      <Section>
        <textarea
          className="divan-input"
          rows={4}
          placeholder="¿Qué le quieres pedir al Diván?"
          value={userInput}
          onChange={(e) => setUserInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) think();
          }}
          disabled={busy}
        />
        <div className="divan-actions">
          <button
            type="button"
            className="divan-think-btn"
            onClick={think}
            disabled={busy || !selectedModeId || !userInput.trim()}
          >
            {busy ? 'Pensando…' : 'Pensar'}
          </button>
          <span className="divan-hint">
            ⌘/Ctrl + Enter
          </span>
        </div>
      </Section>

      {error && <div className="divan-error-block">{error}</div>}
      {savedFlash && <div className="divan-flash">{savedFlash}</div>}

      {/* CONVERSACIÓN */}
      {history.length > 0 && (
        <Section label="Respuesta">
          <div className="divan-thread" ref={responseRef}>
            {history.map((turn, idx) => (
              <Turn
                key={idx}
                turn={turn}
                apiBase={apiBase}
                projects={projects}
                onCreateMode={handleCreateModeFromDraft}
              />
            ))}
          </div>

          <div className="divan-thread-hint">
            Pasa el cursor sobre cualquier bloque para resaltar (H), tachar (S),
            comentar o enviarlo como crumb a un proyecto. Todo queda guardado y
            aparece en la pestaña Subrayados.
          </div>

          {showActionsForLast && (
            <div className="divan-response-actions">
              <button
                type="button"
                className="divan-action-btn"
                onClick={handleSaveSession}
                disabled={history.length < 2}
                title="Persiste el hilo conversacional para retomarlo más tarde"
              >
                Guardar para iterar
              </button>
            </div>
          )}
        </Section>
      )}

      {budget && (
        <div className="divan-budget">
          Coste última llamada: ${lastAssistant?.usage?.costUsd ?? '?'} ·
          mensual {`$${budget.spentUsd} / $${budget.capUsd}`} ({budget.generations} generaciones, compartido con briefings)
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Subcomponentes

function Section({ label, children }) {
  return (
    <section className="divan-section">
      {label && <div className="divan-section-label">{label}</div>}
      {children}
    </section>
  );
}

function ModeChip({ mode, selected, onClick }) {
  const bg = selected ? mode.color : `${mode.color}1a`;
  const fg = selected ? '#fff' : mode.color;
  const border = selected ? mode.color : `${mode.color}55`;
  return (
    <button
      type="button"
      className={`divan-mode-chip ${selected ? 'is-active' : ''}`}
      onClick={onClick}
      style={{ background: bg, color: fg, border: `1px solid ${border}` }}
      title={mode.description || ''}
    >
      {mode.name}
    </button>
  );
}

function ProjectGroup({ label, projects, selectedIds, onToggle, muted }) {
  if (!projects.length) return null;
  return (
    <div className={`divan-project-group ${muted ? 'is-muted' : ''}`}>
      <div className="divan-project-group-label">{label}</div>
      {projects.map((p) => {
        const sel = selectedIds.includes(p.id);
        return (
          <label key={p.id} className="divan-project-row">
            <input type="checkbox" checked={sel} onChange={() => onToggle(p.id)} />
            <span className="divan-project-color" style={{ background: p.color || '#888' }} />
            <span className="divan-project-name">{p.name || p.id}</span>
            <span className="divan-project-status">{p.status || ''}</span>
          </label>
        );
      })}
    </div>
  );
}

function Turn({ turn, apiBase, projects, onCreateMode }) {
  if (turn.role === 'user') {
    return (
      <div className="divan-turn divan-turn-user">
        <div className="divan-turn-role">Tú</div>
        <div className="divan-turn-content">{turn.content}</div>
      </div>
    );
  }

  // Assistant: si trae draft de modo, renderizar formulario.
  if (turn.modeDraft) {
    return <ModeDraftForm draft={turn.modeDraft} onCreate={onCreateMode} />;
  }

  const sourceLabel = turn.modeName
    ? `Diván · ${turn.modeName} · ${formatTurnDate(turn.generatedAt)}`
    : `Diván · ${formatTurnDate(turn.generatedAt)}`;

  return (
    <div className="divan-turn divan-turn-assistant">
      <div className="divan-turn-role">
        Diván{turn.modeName ? ` · ${turn.modeName}` : ''}
        {turn.degraded && turn.degraded.length > 0 && (
          <span className="divan-degraded" title={turn.degraded.join(' · ')}>
            · contexto reducido
          </span>
        )}
      </div>
      <AnnotatedMarkdown
        text={turn.content}
        briefingId={turn.briefingId}
        apiBase={apiBase}
        projects={projects}
        sourceLabel={sourceLabel}
      />
    </div>
  );
}

function formatTurnDate(iso) {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleString('es-ES', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
  } catch { return ''; }
}

function ModeDraftForm({ draft, onCreate }) {
  const [form, setForm] = useState({
    name: draft.name || '',
    color: draft.color || '#888888',
    description: draft.description || '',
    systemPrompt: draft.systemPrompt || '',
    contextScope: draft.contextScope || 'standard',
    includeTransversal: !!draft.includeTransversal,
    model: draft.model || 'claude-sonnet-4-6',
    defaultDepth: draft.defaultDepth || 'normal',
  });
  const set = (k) => (e) => {
    const v = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
    setForm((f) => ({ ...f, [k]: v }));
  };
  return (
    <div className="divan-turn divan-turn-draft">
      <div className="divan-turn-role">Diván · borrador de modo</div>
      <div className="divan-form">
        <Field label="Nombre">
          <input value={form.name} onChange={set('name')} />
        </Field>
        <Field label="Color">
          <input type="color" value={form.color} onChange={set('color')} />
          <input value={form.color} onChange={set('color')} className="divan-form-hex" />
        </Field>
        <Field label="Descripción">
          <input value={form.description} onChange={set('description')} />
        </Field>
        <Field label="Modelo">
          <select value={form.model} onChange={set('model')}>
            <option value="claude-haiku-4-5">Haiku 4.5</option>
            <option value="claude-sonnet-4-6">Sonnet 4.6</option>
            <option value="claude-opus-4-7">Opus 4.7</option>
          </select>
        </Field>
        <Field label="Profundidad por defecto">
          <select value={form.defaultDepth} onChange={set('defaultDepth')}>
            <option value="rapido">Rápido</option>
            <option value="normal">Normal</option>
            <option value="toston">Tostón</option>
          </select>
        </Field>
        <Field label="Scope de contexto">
          <select value={form.contextScope} onChange={set('contextScope')}>
            <option value="minimal">minimal (metadata)</option>
            <option value="standard">standard (+ CONTEXT.md)</option>
            <option value="full">full (+ crumbs + highlights)</option>
          </select>
        </Field>
        <Field label="Incluir perfil transversal">
          <input type="checkbox" checked={form.includeTransversal} onChange={set('includeTransversal')} />
        </Field>
        <Field label="System prompt" full>
          <textarea
            rows={10}
            value={form.systemPrompt}
            onChange={set('systemPrompt')}
          />
        </Field>
      </div>
      <button
        type="button"
        className="divan-think-btn"
        onClick={() => onCreate(form)}
        disabled={!form.name.trim() || !form.systemPrompt.trim()}
      >
        Crear modo
      </button>
    </div>
  );
}

function Field({ label, full, children }) {
  return (
    <div className={`divan-field ${full ? 'is-full' : ''}`}>
      <label>{label}</label>
      <div className="divan-field-input">{children}</div>
    </div>
  );
}

