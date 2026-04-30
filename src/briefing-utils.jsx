// src/briefing-utils.jsx — helpers compartidos entre componentes de briefing.

import { useState, useEffect, useCallback } from 'react';

// ---------------------------------------------------------------------------
// Parser markdown minimalista → lista plana de bloques
// Cada bloque representa una unidad anotable (un heading, un párrafo, un bullet).

export function parseMarkdownBlocks(text) {
  const lines = String(text || '').split('\n');
  const blocks = [];
  for (const line of lines) {
    if (line.startsWith('# ')) blocks.push({ type: 'h1', content: line.slice(2) });
    else if (line.startsWith('## ')) blocks.push({ type: 'h2', content: line.slice(3) });
    else if (line.startsWith('### ')) blocks.push({ type: 'h3', content: line.slice(4) });
    else if (line.startsWith('- ') || line.startsWith('* ')) blocks.push({ type: 'li', content: line.slice(2) });
    else if (line.trim()) blocks.push({ type: 'p', content: line });
  }
  return blocks;
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

function BlockContent({ block }) {
  if (block.type === 'h1') return <h1>{block.content}</h1>;
  if (block.type === 'h2') return <h2>{block.content}</h2>;
  if (block.type === 'h3') return <h3>{block.content}</h3>;
  if (block.type === 'li') return <div className="ann-li">{renderInline(block.content)}</div>;
  return <p>{renderInline(block.content)}</p>;
}

// ---------------------------------------------------------------------------
// AnnotatedMarkdown — markdown interactivo con capa de anotaciones por bloque.
// Carga annotations del backend al montar y persiste cambios con debounce-by-action.

export function AnnotatedMarkdown({ text, briefingId, apiBase = '', apiKey = '', onChange, projects = null, sourceLabel = null }) {
  const [annotations, setAnnotations] = useState({});
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!briefingId) { setLoaded(true); return; }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `${apiBase}/api/briefing/annotations?briefingId=${encodeURIComponent(briefingId)}`
        );
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled) setAnnotations(data.blocks || {});
      } catch { /* silent */ }
      finally { if (!cancelled) setLoaded(true); }
    })();
    return () => { cancelled = true; };
  }, [briefingId, apiBase]);

  const blocks = parseMarkdownBlocks(text);

  const save = useCallback(async (next) => {
    if (!briefingId) return;
    try {
      const headers = { 'Content-Type': 'application/json' };
      if (apiKey) headers['x-api-key'] = apiKey;
      await fetch(
        `${apiBase}/api/briefing/annotations?briefingId=${encodeURIComponent(briefingId)}`,
        { method: 'PUT', headers, body: JSON.stringify({ blocks: next }) }
      );
      if (onChange) onChange();
    } catch { /* silent */ }
  }, [briefingId, apiBase, apiKey, onChange]);

  function updateBlock(idx, patch) {
    const block = blocks[idx];
    let nextState;
    setAnnotations((prev) => {
      const current = prev[idx] || {};
      const merged = { ...current, ...patch };
      const hasAny = !!merged.highlight || !!merged.strike || (merged.comment && merged.comment.length > 0);
      const next = { ...prev };
      if (hasAny) {
        // Snapshot del bloque para que los subrayados sobrevivan cuando el
        // briefing se trunque del histórico (o como referencia agregada).
        if (block && !merged.text) {
          merged.text = block.content;
          merged.type = block.type;
        }
        next[idx] = merged;
      } else {
        delete next[idx];
      }
      nextState = next;
      return next;
    });
    // Save fuera del updater (updaters pueden dispararse 2x en StrictMode).
    queueMicrotask(() => { if (nextState) save(nextState); });
  }
  async function sendBlockToProjects(idx, projectIds) {
    const block = blocks[idx];
    if (!block || !Array.isArray(projectIds) || projectIds.length === 0) return;
    const headers = { 'Content-Type': 'application/json' };
    if (apiKey) headers['x-api-key'] = apiKey;
    const footer = sourceLabel ? `\n\n— ${sourceLabel}` : '';
    const body = `${block.content}${footer}`;
    const ts = new Date().toISOString();
    const newDestinations = [];
    const errors = [];
    for (const projectId of projectIds) {
      const project = projects?.find((p) => p.id === projectId);
      try {
        const res = await fetch(`${apiBase}/api/crumbs`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            projectId,
            title: titleFromText(block.content),
            body,
            source: 'divan',
            timestamp: ts,
          }),
        });
        if (!res.ok) {
          let detail = `HTTP ${res.status}`;
          try {
            const j = await res.json();
            detail = j?.detail || j?.error || detail;
          } catch { /* ignore parse */ }
          throw new Error(detail);
        }
        newDestinations.push({ projectId, projectName: project?.name || projectId, ts });
      } catch (e) {
        errors.push({ projectId, message: e?.message || String(e) });
      }
    }
    if (newDestinations.length > 0) {
      // Acumula con destinos anteriores. Migra el formato viejo (objeto único) a array.
      const prev = normalizeSentTo(annotations[idx]?.sentTo);
      const merged = [...prev];
      for (const d of newDestinations) {
        if (!merged.find((x) => x.projectId === d.projectId)) merged.push(d);
      }
      updateBlock(idx, { sentTo: merged });
    }
    if (errors.length > 0) {
      window.alert(
        `Algunos envíos fallaron:\n` +
        errors.map((e) => ` - ${e.projectId}: ${e.message}`).join('\n')
      );
    }
  }

  return (
    <div className="annotated-md">
      {blocks.map((b, idx) => (
        <AnnotatedBlock
          key={idx}
          ann={annotations[idx]}
          onChange={(patch) => updateBlock(idx, patch)}
          disabled={!loaded || !briefingId}
          projects={projects}
          onSendToProjects={(pids) => sendBlockToProjects(idx, pids)}
        >
          <BlockContent block={b} />
        </AnnotatedBlock>
      ))}
    </div>
  );
}

function titleFromText(text) {
  const cleaned = String(text || '').replace(/^#+\s*/, '').replace(/\s+/g, ' ').trim();
  return cleaned.slice(0, 80) || 'Fragmento del Diván';
}

// `sentTo` puede ser undefined, un objeto único (formato viejo) o un array.
// Esta normalización garantiza que siempre trabajemos con array.
function normalizeSentTo(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.filter(Boolean);
  if (typeof value === 'object' && value.projectId) return [value];
  return [];
}

function AnnotatedBlock({ ann, onChange, disabled, children, projects = null, onSendToProjects }) {
  const highlight = !!ann?.highlight;
  const strike = !!ann?.strike;
  const comment = ann?.comment || '';
  const sentTo = normalizeSentTo(ann?.sentTo);
  const hasAny = highlight || strike || !!comment || sentTo.length > 0;

  const [popoverOpen, setPopoverOpen] = useState(false);
  const [picked, setPicked] = useState(() => new Set());
  const [sending, setSending] = useState(false);

  const cls = ['ann-block'];
  if (highlight) cls.push('ann-block-highlight');
  if (strike) cls.push('ann-block-strike');

  function editComment() {
    const value = window.prompt('Comentario', comment);
    if (value === null) return;
    onChange({ comment: value.trim() });
  }

  function togglePicked(id) {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function confirmSend() {
    if (picked.size === 0 || typeof onSendToProjects !== 'function') return;
    setSending(true);
    try {
      await onSendToProjects(Array.from(picked));
    } finally {
      setSending(false);
      setPicked(new Set());
      setPopoverOpen(false);
    }
  }

  const activeProjects = Array.isArray(projects)
    ? projects.filter((p) => p.status !== 'archivado' && p.status !== 'archived')
    : null;

  const sentIds = new Set(sentTo.map((s) => s.projectId));

  return (
    <div className={cls.join(' ')}>
      <div className="ann-block-body">{children}</div>
      {comment && <div className="ann-comment">💬 {comment}</div>}
      {sentTo.length > 0 && (
        <div className="ann-sent-to">
          ↗ Enviado como crumb a:
          <div className="ann-sent-to-list">
            {sentTo.map((d) => (
              <span key={d.projectId} className="ann-sent-to-chip">{d.projectName}</span>
            ))}
          </div>
        </div>
      )}
      {!disabled && (
        <div className="ann-toolbar">
          <button
            type="button"
            className={`ann-btn ${highlight ? 'active' : ''}`}
            onClick={() => onChange({ highlight: !highlight })}
            title="Resaltar"
          >H</button>
          <button
            type="button"
            className={`ann-btn ${strike ? 'active' : ''}`}
            onClick={() => onChange({ strike: !strike })}
            title="Tachar"
          >S</button>
          <button
            type="button"
            className={`ann-btn ${comment ? 'active' : ''}`}
            onClick={editComment}
            title="Comentar"
          >💬</button>
          {activeProjects && activeProjects.length > 0 && (
            <button
              type="button"
              className={`ann-btn ${sentTo.length > 0 ? 'active' : ''}`}
              onClick={() => setPopoverOpen((v) => !v)}
              title="Enviar este bloque como crumb a uno o varios proyectos"
            >→</button>
          )}
          {hasAny && (
            <button
              type="button"
              className="ann-btn ann-btn-clear"
              onClick={() => onChange({ highlight: false, strike: false, comment: '', sentTo: [] })}
              title="Limpiar"
            >✕</button>
          )}
        </div>
      )}
      {popoverOpen && activeProjects && activeProjects.length > 0 && (
        <div className="ann-send-popover" onClick={(e) => e.stopPropagation()}>
          <div className="ann-send-popover-header">
            Enviar como crumb a {picked.size > 0 ? `${picked.size} proyecto${picked.size === 1 ? '' : 's'}` : 'proyecto(s)…'}
          </div>
          <div className="ann-send-popover-list">
            {activeProjects.map((p) => {
              const already = sentIds.has(p.id);
              const checked = picked.has(p.id);
              return (
                <label key={p.id} className="ann-send-popover-row">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => togglePicked(p.id)}
                  />
                  <span
                    className="ann-send-popover-color"
                    style={{ background: p.color || '#888' }}
                  />
                  <span className="ann-send-popover-name">{p.name}</span>
                  {already && <span className="ann-send-popover-already">✓ enviado</span>}
                </label>
              );
            })}
          </div>
          <div className="ann-send-popover-footer">
            <button
              type="button"
              className="ann-send-popover-btn-ghost"
              onClick={() => { setPopoverOpen(false); setPicked(new Set()); }}
            >Cancelar</button>
            <button
              type="button"
              className="ann-send-popover-btn"
              disabled={picked.size === 0 || sending}
              onClick={confirmSend}
            >{sending ? 'Enviando…' : `Enviar a ${picked.size || ''}`.trim()}</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

export function formatRelative(isoDate) {
  const diff = Date.now() - new Date(isoDate).getTime();
  const mins = Math.round(diff / 60000);
  if (mins < 1) return 'ahora mismo';
  if (mins < 60) return `hace ${mins} min`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `hace ${hours}h`;
  const days = Math.round(hours / 24);
  return `hace ${days}d`;
}

export function formatAbsolute(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleString('es-ES', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// Mapea model → tier legible ("flash" | "normal" | "profundo" | model-as-is si desconocido)
export function tierFromModel(model) {
  if (model === 'claude-haiku-4-5') return 'flash';
  if (model === 'claude-sonnet-4-6') return 'normal';
  if (model === 'claude-opus-4-7') return 'profundo';
  return model || '?';
}

// Etiqueta compacta para mostrar junto a una briefing: "ejecutivo · normal"
export function briefingTag(briefing) {
  const flavor = briefing?.flavor === 'executive' ? 'ejecutivo' : 'técnico';
  const tier = tierFromModel(briefing?.model);
  return `${flavor} · ${tier}`;
}
