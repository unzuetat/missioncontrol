// Pestaña "Git": foto exacta del estado git de cada máquina (pulso enviado por
// agent/pulse.js) + revisiones pendientes con fecha (crumbs con dueAt).
// Solo lectura salvo "marcar hecha" en las revisiones. Estilos inline con los
// tokens del dashboard (--bg-card, --text-primary...) para respetar dark mode.

import { useEffect, useMemo, useState } from 'react';
import { api } from './api.js';

const MONO = "'JetBrains Mono', monospace";
const COLORS = {
  red: '#EF4444',
  amber: '#F59E0B',
  blue: '#3B82F6',
  purple: '#8B5CF6',
  green: '#2D8A4E',
  teal: '#14B8A6',
};
const DAY_MS = 24 * 60 * 60 * 1000;

function daysBetween(iso, now = Date.now()) {
  const ms = Date.parse(iso);
  if (!ms) return null;
  return Math.round((ms - now) / DAY_MS);
}

function ageLabel(iso, t) {
  const d = daysBetween(iso);
  if (d === null) return '?';
  if (d === 0) return t('gitToday');
  if (d === -1) return t('gitYesterday');
  return `${-d} ${t('gitDaysAgo')}`;
}

function fmtDate(iso, lang) {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleDateString(lang === 'en' ? 'en-GB' : 'es-ES', { day: '2-digit', month: 'short' });
  } catch {
    return String(iso).slice(0, 10);
  }
}

// Severidad de una fila: 2 = rojo (trabajo en riesgo), 1 = ámbar, 0 = limpio.
function severity(p) {
  if (p.ahead > 0 || (p.branchesWithoutRemote || []).length > 0 || !p.hasRemote) return 2;
  if (p.uncommitted > 0 || (p.divergingBranches || []).length > 0 || p.behind > 0 ||
      (p.testVsProd && (p.testVsProd.ahead > 0 || p.testVsProd.behind > 0)) || (p.prs || []).length > 0) return 1;
  return 0;
}

function Pill({ children, color, title }) {
  return (
    <span
      title={title}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 4,
        fontSize: 10, fontFamily: MONO, fontWeight: 600, letterSpacing: '0.03em',
        padding: '2px 7px', borderRadius: 999,
        background: `${color}18`, border: `1px solid ${color}40`, color,
        whiteSpace: 'nowrap',
      }}
    >
      {children}
    </span>
  );
}

function SectionTitle({ children, right }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', margin: '18px 0 10px' }}>
      <div style={{ fontSize: 11, color: 'var(--text-tertiary)', fontFamily: MONO, textTransform: 'uppercase', letterSpacing: '0.15em' }}>
        {children}
      </div>
      {right}
    </div>
  );
}

function ToggleButton({ active, onClick, children, color = COLORS.teal }) {
  return (
    <button
      onClick={onClick}
      style={{
        all: 'unset', cursor: 'pointer', fontSize: 11, padding: '4px 10px', borderRadius: 6, fontFamily: MONO,
        background: active ? `${color}22` : 'transparent',
        border: `1px solid ${active ? color : 'var(--border-primary)'}`,
        color: active ? color : 'var(--text-tertiary)', transition: 'all 0.2s',
      }}
    >
      {children}
    </button>
  );
}

// ---------------------------------------------------------------------------

function DueList({ due, t, lang, onToggleDone }) {
  const now = Date.now();
  const groups = useMemo(() => {
    const overdue = [], soon = [], later = [];
    for (const c of due) {
      const d = daysBetween(c.dueAt, now);
      if (d === null) continue;
      if (d < 0) overdue.push({ ...c, d });
      else if (d <= 14) soon.push({ ...c, d });
      else later.push({ ...c, d });
    }
    return { overdue, soon, later };
  }, [due, now]);

  if (due.length === 0) {
    return (
      <div style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: MONO, padding: '10px 0' }}>
        {t('gitDueNone')}
      </div>
    );
  }

  const block = (items, label, color) => items.length > 0 && (
    <div style={{ marginBottom: 10 }}>
      <div style={{ fontSize: 10, color, fontFamily: MONO, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 6 }}>
        {label} · {items.length}
      </div>
      {items.map((c) => (
        <div
          key={c.id}
          style={{
            display: 'flex', alignItems: 'flex-start', gap: 10, padding: '8px 12px', marginBottom: 6,
            borderRadius: 8, background: 'var(--bg-card)', border: `1px solid ${color}30`, borderLeft: `3px solid ${color}`,
          }}
        >
          <button
            onClick={() => onToggleDone && onToggleDone(c.id, true)}
            title={t('markDone')}
            style={{
              all: 'unset', cursor: 'pointer', fontSize: 11, width: 18, height: 18, borderRadius: 4, textAlign: 'center',
              border: '1px solid var(--border-primary)', color: 'var(--text-muted)', fontFamily: MONO, flexShrink: 0,
            }}
          >
            ○
          </button>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 11, color: c.projectColor || 'var(--text-tertiary)', fontFamily: MONO, fontWeight: 600 }}>{c.projectName}</span>
              <span style={{ fontSize: 13, color: 'var(--text-primary)' }}>{c.title}</span>
              {c.isTest === 'true' && <span title={t('markAsTest')}>🧪</span>}
            </div>
            {c.body && (
              <div style={{ fontSize: 12, color: 'var(--text-tertiary)', lineHeight: 1.5, marginTop: 2, whiteSpace: 'pre-wrap' }}>{c.body}</div>
            )}
          </div>
          <div style={{ fontSize: 11, color, fontFamily: MONO, whiteSpace: 'nowrap', flexShrink: 0 }}>
            {c.d < 0 ? `${t('overdue')} ${-c.d} d` : c.d === 0 ? t('gitToday') : `${t('gitIn')} ${c.d} d`}
            <div style={{ fontSize: 10, color: 'var(--text-muted)', textAlign: 'right' }}>{fmtDate(c.dueAt, lang)}</div>
          </div>
        </div>
      ))}
    </div>
  );

  return (
    <div>
      {block(groups.overdue, t('gitOverdue'), COLORS.red)}
      {block(groups.soon, t('gitDueSoon'), COLORS.amber)}
      {block(groups.later, t('gitDueLater'), 'var(--text-muted)')}
    </div>
  );
}

// ---------------------------------------------------------------------------

function Details({ p, t, lang }) {
  const cell = { fontSize: 11, color: 'var(--text-tertiary)', fontFamily: MONO, lineHeight: 1.7 };
  return (
    <div style={{ padding: '10px 14px 14px 38px', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 14 }}>
      {p.unpushedCommits?.length > 0 && (
        <div>
          <div style={{ ...cell, color: COLORS.red, fontWeight: 700 }}>{t('gitUnpushedCommits')} ({p.ahead})</div>
          {p.unpushedCommits.map((c) => (
            <div key={c.hash} style={cell}><span style={{ color: 'var(--text-muted)' }}>{c.hash}</span> · {fmtDate(c.date, lang)} · {c.subject}</div>
          ))}
        </div>
      )}
      {(p.branchesWithoutRemote?.length > 0 || p.divergingBranches?.length > 0 || p.remoteOnlyBranches?.length > 0) && (
        <div>
          <div style={{ ...cell, color: COLORS.amber, fontWeight: 700 }}>{t('gitBranches')}</div>
          {p.divergingBranches?.map((b) => (
            <div key={b.name} style={cell}>
              ⑂ {b.name} · +{b.aheadOfBase} / −{b.behindBase ?? '?'} {t('gitVsBase')} {p.prodBranch || p.defaultBranch}
              {b.daysSinceCommit != null && ` · ${b.daysSinceCommit} d`}
              {!b.hasRemote && <span style={{ color: COLORS.red }}> · {t('gitLocalOnlyShort')}</span>}
            </div>
          ))}
          {p.branchesWithoutRemote?.filter((n) => !p.divergingBranches?.some((b) => b.name === n)).map((n) => (
            <div key={n} style={{ ...cell, color: COLORS.red }}>⌂ {n} · {t('gitLocalOnlyShort')}</div>
          ))}
          {p.remoteOnlyBranches?.length > 0 && (
            <div style={cell}>☁ {t('gitRemoteOnly')}: {p.remoteOnlyBranches.slice(0, 8).join(', ')}{p.remoteOnlyBranches.length > 8 ? '…' : ''}</div>
          )}
        </div>
      )}
      {p.prs?.length > 0 && (
        <div>
          <div style={{ ...cell, color: COLORS.blue, fontWeight: 700 }}>{t('gitPrs')}</div>
          {p.prs.map((pr) => (
            <div key={pr.number} style={cell}>
              #{pr.number} {pr.title} · {pr.head} → {pr.base}
              {pr.draft && ' · draft'}
              {pr.daysSinceUpdate != null && ` · ${pr.daysSinceUpdate} d`}
              {pr.checks && (pr.checks.failed > 0 ? <span style={{ color: COLORS.red }}> · checks ✗{pr.checks.failed}</span> : pr.checks.pending > 0 ? ` · checks …${pr.checks.pending}` : ' · checks ✓')}
            </div>
          ))}
        </div>
      )}
      <div>
        <div style={{ ...cell, color: 'var(--text-secondary)', fontWeight: 700 }}>{t('gitRepoInfo')}</div>
        <div style={cell}>{t('gitLastCommit')}: {p.lastCommit?.hash} · {fmtDate(p.lastCommit?.date, lang)} · {p.lastCommit?.subject}</div>
        {p.upstream && <div style={cell}>upstream: {p.upstream}{p.behind > 0 && <span style={{ color: COLORS.amber }}> · {p.behind} {t('gitBehindShort')}</span>}</div>}
        {p.testBranch && p.prodBranch && p.testVsProd && (
          <div style={cell}>test {p.testBranch} vs prod {p.prodBranch}: +{p.testVsProd.ahead} / −{p.testVsProd.behind}</div>
        )}
        {p.stashCount > 0 && <div style={cell}>stash: {p.stashCount}</div>}
        <div style={{ ...cell, color: 'var(--text-muted)' }}>
          {p.lastFetchAt ? `${t('gitLastFetch')}: ${fmtDate(p.lastFetchAt, lang)} (${p.daysSinceFetch} d)` : t('gitNeverFetched')} · {p.dir}
        </div>
      </div>
    </div>
  );
}

function Row({ p, machine, t, lang, expanded, onToggle }) {
  const sev = severity(p);
  const sevColor = sev === 2 ? COLORS.red : sev === 1 ? COLORS.amber : COLORS.green;
  const cell = { padding: '8px 10px', fontSize: 12, fontFamily: MONO, color: 'var(--text-secondary)', verticalAlign: 'middle', whiteSpace: 'nowrap' };
  const hasDetails = sev > 0 || (p.prs || []).length > 0;
  return (
    <>
      <tr
        onClick={hasDetails ? onToggle : undefined}
        style={{ cursor: hasDetails ? 'pointer' : 'default', borderTop: '1px solid var(--border-subtle)' }}
      >
        <td style={{ ...cell, width: 14, color: sevColor }}>{hasDetails ? (expanded ? '▾' : '▸') : '·'}</td>
        <td style={{ ...cell, color: 'var(--text-primary)', fontWeight: 600, whiteSpace: 'normal' }}>
          <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: sevColor, marginRight: 8 }} />
          {p.name}
          {!p.id && <span title={t('gitNotInMc')} style={{ color: 'var(--text-muted)', marginLeft: 6 }}>?</span>}
        </td>
        <td style={cell}><Pill color={COLORS.purple}>{machine}</Pill></td>
        <td style={{ ...cell, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis' }} title={p.branch}>
          {p.branch === 'HEAD' ? <span style={{ color: COLORS.red }}>HEAD ({t('gitDetached')})</span> : p.branch}
        </td>
        <td style={cell}>
          {p.ahead > 0 && <Pill color={COLORS.red} title={t('gitAhead')}>↑{p.ahead}</Pill>}{' '}
          {p.behind > 0 && <Pill color={COLORS.amber} title={t('gitBehind')}>↓{p.behind}</Pill>}
          {!p.hasRemote && <Pill color={COLORS.red} title={t('gitNoRemote')}>{t('gitNoRemote')}</Pill>}
        </td>
        <td style={cell}>{p.uncommitted > 0 && <Pill color={COLORS.amber} title={`${p.untracked} ${t('gitUntracked')}${p.oldestUncommittedDays != null ? ` · ${p.oldestUncommittedDays} d` : ''}`}>✎ {p.uncommitted}{p.oldestUncommittedDays > 7 ? ` · ${p.oldestUncommittedDays}d` : ''}</Pill>}</td>
        <td style={cell}>
          {(p.branchesWithoutRemote || []).length > 0 && <Pill color={COLORS.red} title={p.branchesWithoutRemote.join(', ')}>⌂ {p.branchesWithoutRemote.length}</Pill>}{' '}
          {(p.divergingBranches || []).length > 0 && <Pill color={COLORS.amber} title={p.divergingBranches.map((b) => `${b.name} +${b.aheadOfBase}`).join(', ')}>⑂ {p.divergingBranches.length}</Pill>}
        </td>
        <td style={cell}>{(p.prs || []).length > 0 && <Pill color={COLORS.blue} title={p.prs.map((pr) => `#${pr.number} ${pr.title}`).join('\n')}>⇄ {p.prs.length}</Pill>}</td>
        <td style={cell}>
          {p.testVsProd && (p.testVsProd.ahead > 0 || p.testVsProd.behind > 0) && (
            <Pill color={COLORS.purple} title={`${p.testBranch} vs ${p.prodBranch}`}>test +{p.testVsProd.ahead}{p.testVsProd.behind > 0 ? ` / −${p.testVsProd.behind}` : ''}</Pill>
          )}
        </td>
        <td style={{ ...cell, color: 'var(--text-muted)' }} title={p.lastCommit?.subject}>
          {fmtDate(p.lastCommit?.date, lang)}{p.lastCommit?.daysAgo > 30 ? ` · ${p.lastCommit.daysAgo}d` : ''}
        </td>
      </tr>
      {expanded && (
        <tr style={{ background: 'var(--bg-inset)' }}>
          <td colSpan={10} style={{ padding: 0 }}><Details p={p} t={t} lang={lang} /></td>
        </tr>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------

export default function GitPulseView({ t, lang, onToggleDone }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [onlyIssues, setOnlyIssues] = useState(true);
  const [machineFilter, setMachineFilter] = useState('all');
  const [expanded, setExpanded] = useState(() => new Set());

  const load = async () => {
    try {
      setError(null);
      const d = await api.getPulse();
      setData(d);
    } catch (e) {
      setError(e?.error || e?.message || 'error');
    }
  };
  useEffect(() => { load(); }, []);

  const machines = useMemo(() => Object.entries(data?.machines || {}), [data]);
  const rows = useMemo(() => {
    const out = [];
    for (const [m, pulse] of machines) {
      if (machineFilter !== 'all' && machineFilter !== m) continue;
      for (const p of pulse.projects || []) {
        if (onlyIssues && severity(p) === 0 && (p.prs || []).length === 0) continue;
        out.push({ machine: m, p, key: `${m}:${p.folder}` });
      }
    }
    out.sort((a, b) => severity(b.p) - severity(a.p) || (b.p.ahead || 0) - (a.p.ahead || 0) || a.p.name.localeCompare(b.p.name));
    return out;
  }, [machines, machineFilter, onlyIssues]);

  const toggle = (key) => setExpanded((prev) => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n; });

  const handleDone = async (crumbId, isDone) => {
    if (onToggleDone) await onToggleDone(crumbId, isDone);
    await load();
  };

  const th = { textAlign: 'left', padding: '6px 10px', fontSize: 10, color: 'var(--text-muted)', fontFamily: MONO, textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 600, whiteSpace: 'nowrap' };

  if (error) {
    return <div style={{ fontSize: 12, color: COLORS.red, fontFamily: MONO }}>{t('gitLoadError')}: {String(error)}</div>;
  }
  if (!data) {
    return <div style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: MONO }}>{t('loading')}</div>;
  }

  const totalIssues = machines.reduce((n, [, pulse]) => n + (pulse.projects || []).filter((p) => severity(p) > 0).length, 0);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {/* Máquinas */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        {machines.length === 0 ? (
          <div style={{ fontSize: 12, color: 'var(--text-tertiary)', fontFamily: MONO, lineHeight: 1.6 }}>
            {t('gitNoPulse')} <code style={{ color: 'var(--text-primary)' }}>npm run pulse</code>
          </div>
        ) : (
          <>
            <ToggleButton active={machineFilter === 'all'} onClick={() => setMachineFilter('all')} color={COLORS.purple}>{t('gitAllMachines')}</ToggleButton>
            {machines.map(([m, pulse]) => {
              const age = daysBetween(pulse.generatedAt);
              const stale = age !== null && age <= -3;
              return (
                <ToggleButton key={m} active={machineFilter === m} onClick={() => setMachineFilter(m)} color={COLORS.purple}>
                  ◎ {m} · {(pulse.projects || []).length} · <span style={{ color: stale ? COLORS.amber : 'inherit' }}>{ageLabel(pulse.generatedAt, t)}</span>
                </ToggleButton>
              );
            })}
            <span style={{ flex: 1 }} />
            <ToggleButton active={onlyIssues} onClick={() => setOnlyIssues((v) => !v)}>
              {onlyIssues ? `⚠ ${t('gitOnlyIssues')} (${totalIssues})` : t('gitAll')}
            </ToggleButton>
            <ToggleButton active={false} onClick={load}>↻</ToggleButton>
          </>
        )}
      </div>

      {/* Tabla */}
      {machines.length > 0 && (
        <div style={{ overflowX: 'auto', borderRadius: 10, border: '1px solid var(--border-primary)', background: 'var(--bg-card)', marginTop: 12 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={th} />
                <th style={th}>{t('project')}</th>
                <th style={th}>{t('gitMachine')}</th>
                <th style={th}>{t('gitBranch')}</th>
                <th style={th}>{t('gitPush')}</th>
                <th style={th}>{t('gitUncommitted')}</th>
                <th style={th}>{t('gitBranches')}</th>
                <th style={th}>PR</th>
                <th style={th}>test/prod</th>
                <th style={th}>{t('gitLastCommit')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr><td colSpan={10} style={{ padding: 14, fontSize: 12, color: COLORS.green, fontFamily: MONO }}>✓ {t('gitClean')}</td></tr>
              ) : rows.map(({ machine, p, key }) => (
                <Row key={key} p={p} machine={machine} t={t} lang={lang} expanded={expanded.has(key)} onToggle={() => toggle(key)} />
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', fontSize: 10, color: 'var(--text-muted)', fontFamily: MONO, marginTop: 6 }}>
        <span><span style={{ color: COLORS.red }}>●</span> {t('gitLegendRed')}</span>
        <span><span style={{ color: COLORS.amber }}>●</span> {t('gitLegendAmber')}</span>
        <span>↑ {t('gitAhead')} · ↓ {t('gitBehind')} · ✎ {t('gitUncommitted')} · ⌂ {t('gitLocalOnly')} · ⑂ {t('gitDiverging')} · ⇄ PR</span>
      </div>

      {/* Revisiones pendientes */}
      <SectionTitle>⏰ {t('gitDue')} · {(data.due || []).length}</SectionTitle>
      <DueList due={data.due || []} t={t} lang={lang} onToggleDone={handleDone} />
    </div>
  );
}
