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

export function AnnotatedMarkdown({ text, briefingId, apiBase = '', apiKey = '' }) {
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

  const save = useCallback(async (next) => {
    if (!briefingId) return;
    try {
      const headers = { 'Content-Type': 'application/json' };
      if (apiKey) headers['x-api-key'] = apiKey;
      await fetch(
        `${apiBase}/api/briefing/annotations?briefingId=${encodeURIComponent(briefingId)}`,
        { method: 'PUT', headers, body: JSON.stringify({ blocks: next }) }
      );
    } catch { /* silent */ }
  }, [briefingId, apiBase, apiKey]);

  function updateBlock(idx, patch) {
    let nextState;
    setAnnotations((prev) => {
      const current = prev[idx] || {};
      const merged = { ...current, ...patch };
      const hasAny = !!merged.highlight || !!merged.strike || (merged.comment && merged.comment.length > 0);
      const next = { ...prev };
      if (hasAny) next[idx] = merged;
      else delete next[idx];
      nextState = next;
      return next;
    });
    // Save fuera del updater (updaters pueden dispararse 2x en StrictMode).
    queueMicrotask(() => { if (nextState) save(nextState); });
  }

  const blocks = parseMarkdownBlocks(text);
  return (
    <div className="annotated-md">
      {blocks.map((b, idx) => (
        <AnnotatedBlock
          key={idx}
          ann={annotations[idx]}
          onChange={(patch) => updateBlock(idx, patch)}
          disabled={!loaded || !briefingId}
        >
          <BlockContent block={b} />
        </AnnotatedBlock>
      ))}
    </div>
  );
}

function AnnotatedBlock({ ann, onChange, disabled, children }) {
  const highlight = !!ann?.highlight;
  const strike = !!ann?.strike;
  const comment = ann?.comment || '';
  const hasAny = highlight || strike || !!comment;

  const cls = ['ann-block'];
  if (highlight) cls.push('ann-block-highlight');
  if (strike) cls.push('ann-block-strike');

  function editComment() {
    const value = window.prompt('Comentario', comment);
    if (value === null) return;
    onChange({ comment: value.trim() });
  }

  return (
    <div className={cls.join(' ')}>
      <div className="ann-block-body">{children}</div>
      {comment && <div className="ann-comment">💬 {comment}</div>}
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
          {hasAny && (
            <button
              type="button"
              className="ann-btn ann-btn-clear"
              onClick={() => onChange({ highlight: false, strike: false, comment: '' })}
              title="Limpiar"
            >✕</button>
          )}
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
