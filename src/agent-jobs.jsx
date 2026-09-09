// src/agent-jobs.jsx — puente entre el dashboard y el agente residente del Mac.
//
// El dashboard no puede ejecutar nada en la máquina de Telmo, así que los
// botones encolan trabajos en /api/briefing/jobs y el agente (npm run agent)
// los recoge. Aquí: un hook para lanzar un trabajo y seguirlo hasta que acaba,
// otro para saber qué agentes están en línea, y un chip de estado reutilizable.

import { useCallback, useEffect, useRef, useState } from 'react';

const POLL_MS = 4000;
const MONO = "'JetBrains Mono', monospace";

// Tiers que corren en el Mac con la suscripción de Claude Code (coste 0 en API).
export const SUB_TIERS = [
  { id: 'sub-normal',   model: 'sonnet', modelShort: 'Sonnet · Claude Code', label: 'Suscripción',            price: '$0', hint: 'Se genera en tu Mac con tu suscripción de Claude (agente residente). Sin coste de API.' },
  { id: 'sub-profundo', model: 'opus',   modelShort: 'Opus · Claude Code',   label: 'Suscripción · Profundo', price: '$0', hint: 'Igual, con Opus: análisis más denso, tarda más. Sin coste de API.' },
];

// Textos por defecto (los componentes de briefing no usan i18n; la pestaña Git pasa t()).
export const agentLabels = {
  agentNone: 'Sin agente: ejecuta `npm run agent` en tu Mac para poder lanzar trabajos desde aquí.',
  agentOnline: 'en línea',
  agentOffline: 'desconectado',
  agentOfflineHint: 'El agente de esa máquina no ha dado señales en los últimos minutos. Enciéndela o ejecuta `npm run agent`.',
};

async function request(apiBase, path, options = {}) {
  const res = await fetch(`${apiBase}/api/briefing/jobs${path}`, {
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.detail || body.error || `HTTP ${res.status}`);
  return body;
}

export function fetchAgents(apiBase, { wake = false } = {}) {
  return request(apiBase, wake ? '?limit=1&wake=1' : '?limit=1').then((d) => d.agents || {});
}

/** Agentes conocidos y si están en línea. Avisa al agente al montar (sondeo rápido). */
export function useAgents(apiBase, { refreshMs = 60000 } = {}) {
  const [agents, setAgents] = useState({});
  const load = useCallback((wake = false) => fetchAgents(apiBase, { wake }).then(setAgents).catch(() => {}), [apiBase]);
  useEffect(() => {
    load(true);
    const id = setInterval(() => load(false), refreshMs);
    return () => clearInterval(id);
  }, [load, refreshMs]);
  const online = Object.entries(agents).filter(([, a]) => a.online).map(([m]) => m);
  return { agents, online, anyOnline: online.length > 0, reload: load };
}

/**
 * Lanza un trabajo y lo sigue hasta done/failed.
 *   const { run, job, busy, error } = useAgentJob(apiBase, { onDone });
 *   run('briefing', { kind: 'daily', flavor }, machine?)
 */
export function useAgentJob(apiBase, { onDone, onFail } = {}) {
  const [job, setJob] = useState(null);
  const [error, setError] = useState(null);
  const timer = useRef(null);
  const cbs = useRef({ onDone, onFail });
  cbs.current = { onDone, onFail };

  const stop = () => { if (timer.current) { clearTimeout(timer.current); timer.current = null; } };
  useEffect(() => stop, []);

  const poll = useCallback(async (id) => {
    try {
      const d = await request(apiBase, '?limit=30');
      const j = (d.jobs || []).find((x) => x.id === id);
      if (!j) { setJob(null); return; }
      setJob(j);
      if (j.status === 'done') { cbs.current.onDone && cbs.current.onDone(j); return; }
      if (j.status === 'failed' || j.status === 'cancelled') {
        if (j.status === 'failed') { setError(j.error || 'falló'); cbs.current.onFail && cbs.current.onFail(j); }
        return;
      }
      timer.current = setTimeout(() => poll(id), POLL_MS);
    } catch (e) {
      timer.current = setTimeout(() => poll(id), POLL_MS * 2);
    }
  }, [apiBase]);

  const run = useCallback(async (type, params = {}, machine = '') => {
    stop();
    setError(null);
    try {
      const d = await request(apiBase, '', { method: 'POST', body: JSON.stringify({ type, params, machine }) });
      setJob(d.job);
      timer.current = setTimeout(() => poll(d.job.id), 1500);
      return d.job;
    } catch (e) {
      setError(e.message);
      setJob(null);
      return null;
    }
  }, [apiBase, poll]);

  const cancel = useCallback(async () => {
    if (!job || job.status !== 'queued') return;
    stop();
    try {
      const d = await request(apiBase, '?op=cancel', { method: 'POST', body: JSON.stringify({ id: job.id }) });
      setJob(d.job);
    } catch (e) { setError(e.message); }
  }, [apiBase, job]);

  const busy = !!job && (job.status === 'queued' || job.status === 'running');
  return { run, cancel, job, busy, error, reset: () => { stop(); setJob(null); setError(null); } };
}

export function jobStatusLabel(job) {
  if (!job) return '';
  if (job.status === 'queued') return job.machine ? `en cola para ${job.machine}…` : 'en cola: lo cogerá el primer agente libre…';
  if (job.status === 'running') return `ejecutando en ${job.claimedBy || 'agente'}…`;
  if (job.status === 'done') return `listo (${job.claimedBy || 'agente'})`;
  if (job.status === 'failed') return `falló: ${job.error || ''}`;
  if (job.status === 'cancelled') return 'cancelado';
  return job.status;
}

/** Texto de estado del trabajo + cancelar si aún está en cola. */
export function JobStatus({ job, onCancel, style = {} }) {
  if (!job) return null;
  const color = job.status === 'failed' ? '#EF4444' : job.status === 'done' ? '#2D8A4E' : 'var(--text-tertiary)';
  return (
    <span style={{ fontSize: 11, fontFamily: MONO, color, display: 'inline-flex', alignItems: 'center', gap: 8, ...style }}>
      {(job.status === 'queued' || job.status === 'running') && <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: '#14B8A6', animation: 'mc-blink 1s infinite' }} />}
      {jobStatusLabel(job)}
      {job.status === 'queued' && onCancel && (
        <button onClick={onCancel} style={{ all: 'unset', cursor: 'pointer', color: 'var(--text-muted)', textDecoration: 'underline' }}>cancelar</button>
      )}
    </span>
  );
}

/** Chip "◎ casa · en línea" por máquina. */
export function AgentChips({ agents, t, style = {} }) {
  const entries = Object.entries(agents || {});
  const label = (k) => (t ? t(k) : agentLabels[k] || k);
  if (entries.length === 0) {
    return <span style={{ fontSize: 11, fontFamily: MONO, color: 'var(--text-muted)', ...style }}>{label('agentNone')}</span>;
  }
  return (
    <span style={{ display: 'inline-flex', gap: 6, flexWrap: 'wrap', ...style }}>
      {entries.map(([m, a]) => {
        const color = a.online ? '#2D8A4E' : 'var(--text-muted)';
        const seen = a.lastSeen ? new Date(a.lastSeen).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' }) : '';
        return (
          <span key={m} title={a.online ? `${label('agentOnline')} · ${seen}` : label('agentOfflineHint')} style={{ fontSize: 10, fontFamily: MONO, fontWeight: 600, padding: '2px 8px', borderRadius: 999, border: `1px solid ${color}55`, color, background: a.online ? '#2D8A4E14' : 'transparent' }}>
            ◎ {m} · {a.online ? label('agentOnline') : label('agentOffline')}
          </span>
        );
      })}
    </span>
  );
}
