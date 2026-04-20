import { useState, useEffect, useRef, useCallback } from "react";
import { api } from "./src/api.js";
import { createT } from "./src/i18n.js";
import DailyPulseBanner from "./src/DailyPulseBanner.jsx";
import ProjectBriefingSection from "./src/ProjectBriefingSection.jsx";
import BriefingsView from "./src/BriefingsView.jsx";

const SOURCE_META = {
  github: { label: "GitHub", icon: "⬡", color: "#8B949E" },
  vercel: { label: "Vercel", icon: "▲", color: "#888888" },
  "claude-code": { label: "Claude Code", icon: "⌘", color: "#D4A574" },
  "claude-web": { label: "Claude Web", icon: "◉", color: "#7EB8DA" },
};

const STATUS_OPTIONS = ["desarrollo", "pausado", "idea"];
const COLOR_PALETTE = ["#FF6B35", "#4ECDC4", "#A78BFA", "#F7DC6F", "#95A5A6", "#E67E22", "#3B82F6", "#EF4444", "#10B981", "#EC4899"];
const ENV_OPTIONS = ["", "local", "test", "branch", "staging", "production"];
const DEPLOY_COLORS = { test: "#F59E0B", prod: "#10B981", none: "#555" };
const TECH_ICONS = {
  vercel: { icon: "▲", label: "Vercel", color: "#000" },
  firebase: { icon: "🔥", label: "Firebase", color: "#FFCA28" },
  supabase: { icon: "⚡", label: "Supabase", color: "#3ECF8E" },
  redis: { icon: "◆", label: "Redis", color: "#DC382D" },
  nextjs: { icon: "N", label: "Next.js", color: "#888" },
  react: { icon: "⚛", label: "React", color: "#61DAFB" },
  node: { icon: "⬢", label: "Node", color: "#68A063" },
  tailwind: { icon: "🌊", label: "Tailwind", color: "#38BDF8" },
  vite: { icon: "⚡", label: "Vite", color: "#646CFF" },
};
const ENV_COLORS = {
  local: "#95A5A6",
  test: "#F59E0B",
  branch: "#A78BFA",
  staging: "#3B82F6",
  production: "#10B981",
};

function timeAgo(dateStr, lang) {
  const now = new Date();
  const then = new Date(dateStr);
  const diffMs = now - then;
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);
  const ago = lang === "en" ? "ago" : "hace";
  const yesterday = lang === "en" ? "yesterday" : "ayer";
  if (diffMins < 60) return lang === "en" ? `${diffMins}m ago` : `hace ${diffMins}m`;
  if (diffHours < 24) return lang === "en" ? `${diffHours}h ago` : `hace ${diffHours}h`;
  if (diffDays === 1) return yesterday;
  return lang === "en" ? `${diffDays}d ago` : `hace ${diffDays}d`;
}

function formatDate(dateStr, lang) {
  const d = new Date(dateStr);
  return d.toLocaleDateString(lang === "en" ? "en-US" : "es-ES", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

// --- COMPONENTS ---

function SourceBadge({ source, compact = false }) {
  const meta = SOURCE_META[source];
  if (!meta) return null;
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: compact ? 4 : 6,
        padding: compact ? "2px 6px" : "3px 10px",
        borderRadius: 4,
        background: meta.color + "15",
        border: `1px solid ${meta.color}30`,
        fontSize: compact ? 10 : 11,
        fontFamily: "'JetBrains Mono', monospace",
        color: meta.color,
        letterSpacing: "0.05em",
        textTransform: "uppercase",
        whiteSpace: "nowrap",
      }}
    >
      <span style={{ fontSize: compact ? 10 : 12 }}>{meta.icon}</span>
      {meta.label}
    </span>
  );
}

function StatusDot({ status, color, t }) {
  const isPaused = status === "pausado";
  const isIdea = status === "idea";
  const label = status === "desarrollo" ? t("development") : status === "pausado" ? t("paused") : t("idea");
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        fontSize: 10,
        fontFamily: "'JetBrains Mono', monospace",
        color: isPaused ? "#666" : isIdea ? "#888" : color,
        textTransform: "uppercase",
        letterSpacing: "0.1em",
      }}
    >
      <span
        style={{
          width: 7,
          height: 7,
          borderRadius: "50%",
          background: isPaused ? "#555" : isIdea ? "#666" : color,
          boxShadow: isPaused || isIdea ? "none" : `0 0 8px ${color}80`,
          animation: !isPaused && !isIdea ? "pulse 2s ease-in-out infinite" : "none",
        }}
      />
      {label}
    </span>
  );
}

function EnvBadge({ environment, t }) {
  if (!environment) return null;
  const color = ENV_COLORS[environment] || "#888";
  const label = t(`env${environment.charAt(0).toUpperCase() + environment.slice(1)}`);
  return (
    <span
      style={{
        display: "inline-flex", alignItems: "center", gap: 4,
        padding: "2px 7px", borderRadius: 4,
        background: color + "18", border: `1px solid ${color}35`,
        fontSize: 9, fontFamily: "'JetBrains Mono', monospace",
        color, letterSpacing: "0.08em", textTransform: "uppercase", fontWeight: 600,
      }}
    >
      <span style={{ width: 5, height: 5, borderRadius: "50%", background: color, boxShadow: `0 0 6px ${color}60` }} />
      {label}
    </span>
  );
}

function DeployBadge({ label, url, color }) {
  const active = !!url;
  const c = active ? color : DEPLOY_COLORS.none;
  return (
    <span
      style={{
        display: "inline-flex", alignItems: "center", gap: 4,
        padding: "2px 7px", borderRadius: 4,
        background: c + "18", border: `1px solid ${c}35`,
        fontSize: 9, fontFamily: "'JetBrains Mono', monospace",
        color: c, letterSpacing: "0.08em", textTransform: "uppercase", fontWeight: 600,
        opacity: active ? 1 : 0.5,
      }}
    >
      <span style={{
        width: 5, height: 5, borderRadius: "50%",
        background: c,
        boxShadow: active ? `0 0 6px ${c}60` : "none",
        animation: active ? "pulse 2s ease-in-out infinite" : "none",
      }} />
      {label}
    </span>
  );
}

function DeploymentBadges({ project, t }) {
  const hasTest = !!project.testUrl;
  const hasProd = !!project.prodUrl;
  // Fallback to old environment/vercelUrl field
  if (!hasTest && !hasProd && project.environment) {
    return <EnvBadge environment={project.environment} t={t} />;
  }
  if (!hasTest && !hasProd) return null;
  return (
    <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
      <DeployBadge label={t("testEnv")} url={project.testUrl} color={DEPLOY_COLORS.test} />
      <DeployBadge label={t("prodEnv")} url={project.prodUrl} color={DEPLOY_COLORS.prod} />
    </div>
  );
}

function ProjectLinks({ project }) {
  const links = [];
  if (project.repoUrl) {
    links.push(
      <a key="gh" href={project.repoUrl} target="_blank" rel="noopener noreferrer"
        style={{ fontSize: 16, textDecoration: "none", opacity: 0.7, transition: "opacity 0.2s" }}
        onMouseEnter={(e) => e.target.style.opacity = 1}
        onMouseLeave={(e) => e.target.style.opacity = 0.7}
        title="GitHub"
      >⬡</a>
    );
  }
  const deployUrl = project.prodUrl || project.testUrl || project.vercelUrl;
  if (deployUrl) {
    links.push(
      <a key="vc" href={deployUrl} target="_blank" rel="noopener noreferrer"
        style={{ fontSize: 14, textDecoration: "none", opacity: 0.7, transition: "opacity 0.2s", color: "var(--text-secondary)" }}
        onMouseEnter={(e) => e.target.style.opacity = 1}
        onMouseLeave={(e) => e.target.style.opacity = 0.7}
        title={project.prodUrl ? "Production" : "Test"}
      >▲</a>
    );
  }
  if (links.length === 0) return null;
  return <div style={{ display: "flex", gap: 8, alignItems: "center" }}>{links}</div>;
}

function TechStackBadges({ techStack }) {
  if (!techStack) return null;
  const techs = techStack.split(",").map((s) => s.trim()).filter(Boolean);
  if (techs.length === 0) return null;
  return (
    <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
      {techs.map((tech) => {
        const meta = TECH_ICONS[tech];
        return (
          <span key={tech} style={{
            display: "inline-flex", alignItems: "center", gap: 3,
            padding: "1px 5px", borderRadius: 3,
            background: (meta?.color || "#888") + "12",
            border: `1px solid ${(meta?.color || "#888")}25`,
            fontSize: 9, fontFamily: "'JetBrains Mono', monospace",
            color: meta?.color || "var(--text-muted)",
          }}>
            <span style={{ fontSize: 9 }}>{meta?.icon || "·"}</span>
            {meta?.label || tech}
          </span>
        );
      })}
    </div>
  );
}

function ProjectCard({ project, onClick, isSelected, t, lang }) {
  const [hovered, setHovered] = useState(false);
  const lc = project.lastCrumb;

  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        all: "unset",
        cursor: "pointer",
        display: "flex",
        flexDirection: "column",
        gap: 12,
        padding: "18px 20px",
        borderRadius: 10,
        background: isSelected
          ? `linear-gradient(135deg, ${project.color}12, ${project.color}08)`
          : hovered
          ? "var(--bg-card-hover)"
          : "var(--bg-card)",
        border: isSelected ? `1px solid ${project.color}50` : "1px solid var(--border-primary)",
        transition: "all 0.25s ease",
        position: "relative",
        overflow: "hidden",
        boxSizing: "border-box",
      }}
    >
      <div
        style={{
          position: "absolute",
          top: 0, left: 0, right: 0, height: 2,
          background: `linear-gradient(90deg, ${project.color}, transparent)`,
          opacity: isSelected ? 1 : hovered ? 0.6 : 0.2,
          transition: "opacity 0.3s",
        }}
      />
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
          <span style={{ fontSize: 15, fontWeight: 600, color: "var(--text-primary)", fontFamily: "'Space Grotesk', sans-serif", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {project.name}
          </span>
          <ProjectLinks project={project} />
        </div>
        <DeploymentBadges project={project} t={t} />
      </div>

      {lc && (
        <div
          style={{
            padding: "8px 12px",
            borderRadius: 6,
            background: "var(--bg-inset)",
            borderLeft: `2px solid ${project.color}60`,
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 12,
          }}
        >
          <div style={{ fontSize: 12, color: "var(--text-secondary)", lineHeight: 1.4, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {lc.title}
          </div>
          <span style={{ fontSize: 11, color: "var(--text-tertiary)", fontFamily: "'JetBrains Mono', monospace", flexShrink: 0 }}>
            {timeAgo(lc.timestamp, lang)}
          </span>
        </div>
      )}
    </button>
  );
}

function Timeline({ crumbs, projectColor, lang, onToggleDone, onEditCrumb, t }) {
  const [editingId, setEditingId] = useState(null);
  const [editTitle, setEditTitle] = useState("");
  const [editBody, setEditBody] = useState("");
  const [saving, setSaving] = useState(false);

  const startEdit = (crumb) => {
    setEditingId(crumb.id);
    setEditTitle(crumb.title);
    setEditBody(crumb.body || "");
  };

  const handleSaveEdit = async () => {
    if (!editTitle.trim() || saving) return;
    setSaving(true);
    await onEditCrumb(editingId, { title: editTitle, body: editBody });
    setEditingId(null);
    setSaving(false);
  };

  const inputStyle = {
    width: "100%", padding: "6px 10px", borderRadius: 4,
    border: "1px solid var(--border-primary)", background: "var(--bg-input)",
    color: "var(--text-secondary)", fontSize: 12,
    fontFamily: "'JetBrains Mono', monospace", outline: "none", boxSizing: "border-box",
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 0, position: "relative" }}>
      {crumbs.map((crumb, i) => {
        const isIdea = crumb.isIdea === "true";
        const isTest = crumb.isTest === "true";
        const isDone = crumb.isDone === "true";
        const isSpecial = isIdea || isTest;
        const accentColor = isIdea ? "#F59E0B" : isTest ? "#8B5CF6" : null;
        const isEditing = editingId === crumb.id;
        return (
          <div
            key={crumb.id || i}
            style={{
              display: "flex",
              gap: 16,
              padding: "14px 0",
              position: "relative",
              animation: `fadeSlideIn 0.3s ease ${i * 0.06}s both`,
            }}
          >
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", width: 20, flexShrink: 0 }}>
              <div
                style={{
                  width: 9, height: 9,
                  borderRadius: isIdea ? 2 : isTest ? 1 : "50%",
                  background: accentColor || (i === 0 ? projectColor : "transparent"),
                  border: isSpecial ? "none" : (i === 0 ? "none" : `1.5px solid ${(SOURCE_META[crumb.source]?.color || "#888")}60`),
                  boxShadow: isSpecial ? `0 0 10px ${accentColor}60` : (i === 0 ? `0 0 10px ${projectColor}60` : "none"),
                  flexShrink: 0, marginTop: 4,
                }}
              />
              {i < crumbs.length - 1 && (
                <div style={{ width: 1, flex: 1, background: "var(--border-primary)", marginTop: 4 }} />
              )}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              {isEditing ? (
                <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 4 }}>
                  <input type="text" value={editTitle} onChange={(e) => setEditTitle(e.target.value)} style={inputStyle} />
                  <textarea value={editBody} onChange={(e) => setEditBody(e.target.value)} rows={2} style={{ ...inputStyle, resize: "vertical" }} />
                  <div style={{ display: "flex", gap: 6 }}>
                    <button onClick={handleSaveEdit} disabled={saving} style={{
                      all: "unset", cursor: "pointer", fontSize: 10, padding: "3px 10px", borderRadius: 3,
                      background: accentColor || "var(--bg-btn)", color: isIdea ? "#000" : "#fff",
                      fontFamily: "'JetBrains Mono', monospace", textTransform: "uppercase",
                    }}>{saving ? "..." : t("saveEdit")}</button>
                    <button onClick={() => setEditingId(null)} style={{
                      all: "unset", cursor: "pointer", fontSize: 10, padding: "3px 10px", borderRadius: 3,
                      border: "1px solid var(--border-primary)", color: "var(--text-muted)",
                      fontFamily: "'JetBrains Mono', monospace", textTransform: "uppercase",
                    }}>{t("cancelEdit")}</button>
                  </div>
                </div>
              ) : (
                <>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4, flexWrap: "wrap" }}>
                    {isIdea && (
                      <span style={{
                        fontSize: 9, padding: "1px 6px", borderRadius: 3,
                        background: "#F59E0B20", color: "#F59E0B",
                        fontFamily: "'JetBrains Mono', monospace",
                        fontWeight: 600, letterSpacing: "0.1em",
                        border: "1px solid #F59E0B40",
                      }}>
                        💡 {t("ideaLabel")}
                      </span>
                    )}
                    {isTest && (
                      <span style={{
                        fontSize: 9, padding: "1px 6px", borderRadius: 3,
                        background: "#8B5CF620", color: "#8B5CF6",
                        fontFamily: "'JetBrains Mono', monospace",
                        fontWeight: 600, letterSpacing: "0.1em",
                        border: "1px solid #8B5CF640",
                      }}>
                        🧪 {t("testLabel")}
                      </span>
                    )}
                    <span style={{
                      fontSize: 13,
                      color: isDone ? accentColor + "90" : (accentColor || (i === 0 ? "var(--text-primary)" : "var(--text-secondary)")),
                      fontWeight: isSpecial ? 600 : (i === 0 ? 600 : 400),
                      textDecoration: isDone ? "line-through" : "none",
                      borderBottom: isSpecial && !isDone ? `1px dashed ${accentColor}40` : "none",
                      paddingBottom: isSpecial && !isDone ? 1 : 0,
                    }}>
                      {crumb.title}
                    </span>
                    <SourceBadge source={crumb.source} compact />
                    {isSpecial && onToggleDone && (
                      <button
                        onClick={() => onToggleDone(crumb.id, !isDone)}
                        title={isDone ? t("markUndone") : t("markDone")}
                        style={{
                          all: "unset", cursor: "pointer", fontSize: 10,
                          padding: "2px 6px", borderRadius: 3,
                          border: "1px solid var(--border-primary)",
                          color: isDone ? "#2D8A4E" : "var(--text-muted)",
                          fontFamily: "'JetBrains Mono', monospace",
                          transition: "all 0.2s",
                        }}
                        onMouseEnter={(e) => { e.target.style.borderColor = accentColor; e.target.style.color = accentColor; }}
                        onMouseLeave={(e) => { e.target.style.borderColor = "var(--border-primary)"; e.target.style.color = isDone ? "#2D8A4E" : "var(--text-muted)"; }}
                      >
                        {isDone ? "✓" : "○"}
                      </button>
                    )}
                    {isSpecial && onEditCrumb && (
                      <button
                        onClick={() => startEdit(crumb)}
                        title={t("editIdea")}
                        style={{
                          all: "unset", cursor: "pointer", fontSize: 10,
                          padding: "2px 6px", borderRadius: 3,
                          border: "1px solid var(--border-primary)",
                          color: "var(--text-muted)",
                          fontFamily: "'JetBrains Mono', monospace",
                          transition: "all 0.2s",
                        }}
                        onMouseEnter={(e) => { e.target.style.borderColor = accentColor; e.target.style.color = accentColor; }}
                        onMouseLeave={(e) => { e.target.style.borderColor = "var(--border-primary)"; e.target.style.color = "var(--text-muted)"; }}
                      >
                        ✎
                      </button>
                    )}
                  </div>
                  <div style={{
                    fontSize: 12, color: "var(--text-tertiary)", lineHeight: 1.5, marginBottom: 4,
                    textDecoration: isDone ? "line-through" : "none",
                    opacity: isDone ? 0.7 : 1,
                  }}>
                    {crumb.body}
                  </div>
                </>
              )}
              <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 10, color: "var(--text-muted)", fontFamily: "'JetBrains Mono', monospace" }}>
                {crumb.projectName && (
                  <span style={{ color: crumb.projectColor || "var(--text-muted)", opacity: 0.8 }}>{crumb.projectName}</span>
                )}
                {formatDate(crumb.timestamp, lang)}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function CrumbForm({ projects, onSubmit, t, defaultProjectId }) {
  const [projectId, setProjectId] = useState(defaultProjectId || projects[0]?.id || "");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [isIdea, setIsIdea] = useState(false);
  const [isTest, setIsTest] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (defaultProjectId) setProjectId(defaultProjectId);
  }, [defaultProjectId]);

  const handleSubmit = async () => {
    if (!title.trim() || saving) return;
    setSaving(true);
    await onSubmit({ projectId, title, body, source: "claude-web", timestamp: new Date().toISOString(), isIdea, isTest });
    setTitle("");
    setBody("");
    setIsIdea(false);
    setIsTest(false);
    setSaving(false);
    setSubmitted(true);
    setTimeout(() => setSubmitted(false), 2000);
  };

  const inputStyle = {
    width: "100%",
    padding: "10px 12px",
    borderRadius: 6,
    border: "1px solid var(--border-primary)",
    background: "var(--bg-input)",
    color: "var(--text-secondary)",
    fontSize: 13,
    fontFamily: "'JetBrains Mono', monospace",
    outline: "none",
    boxSizing: "border-box",
    transition: "border-color 0.2s",
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ fontSize: 11, color: "var(--text-tertiary)", fontFamily: "'JetBrains Mono', monospace", textTransform: "uppercase", letterSpacing: "0.15em" }}>
        {t("quickCrumb")}
      </div>
      <select
        value={projectId}
        onChange={(e) => setProjectId(e.target.value)}
        style={{
          ...inputStyle,
          cursor: "pointer",
          appearance: "none",
          backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6'%3E%3Cpath d='M0 0l5 6 5-6z' fill='%23666'/%3E%3C/svg%3E")`,
          backgroundRepeat: "no-repeat",
          backgroundPosition: "right 12px center",
          paddingRight: 32,
        }}
      >
        {projects.map((p) => (
          <option key={p.id} value={p.id}>{p.name}</option>
        ))}
      </select>
      <input
        type="text"
        placeholder={t("titlePlaceholder")}
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        maxLength={80}
        style={inputStyle}
        onFocus={(e) => (e.target.style.borderColor = "var(--border-hover)")}
        onBlur={(e) => (e.target.style.borderColor = "var(--border-primary)")}
      />
      <textarea
        placeholder={t("bodyPlaceholder")}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={3}
        style={{ ...inputStyle, resize: "vertical", lineHeight: 1.5 }}
        onFocus={(e) => (e.target.style.borderColor = "var(--border-hover)")}
        onBlur={(e) => (e.target.style.borderColor = "var(--border-primary)")}
      />
      <div style={{ display: "flex", gap: 16 }}>
        <label
          style={{
            display: "flex", alignItems: "center", gap: 8, cursor: "pointer",
            fontSize: 12, fontFamily: "'JetBrains Mono', monospace",
            color: isIdea ? "#F59E0B" : "var(--text-tertiary)", transition: "color 0.2s",
          }}
        >
          <input type="checkbox" checked={isIdea} onChange={(e) => { setIsIdea(e.target.checked); if (e.target.checked) setIsTest(false); }} style={{ display: "none" }} />
          <span style={{
            width: 18, height: 18, borderRadius: 4,
            border: isIdea ? "2px solid #F59E0B" : "2px solid var(--border-primary)",
            background: isIdea ? "#F59E0B20" : "transparent",
            display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, transition: "all 0.2s",
          }}>{isIdea ? "💡" : ""}</span>
          {t("markAsIdea")}
        </label>
        <label
          style={{
            display: "flex", alignItems: "center", gap: 8, cursor: "pointer",
            fontSize: 12, fontFamily: "'JetBrains Mono', monospace",
            color: isTest ? "#8B5CF6" : "var(--text-tertiary)", transition: "color 0.2s",
          }}
        >
          <input type="checkbox" checked={isTest} onChange={(e) => { setIsTest(e.target.checked); if (e.target.checked) setIsIdea(false); }} style={{ display: "none" }} />
          <span style={{
            width: 18, height: 18, borderRadius: 4,
            border: isTest ? "2px solid #8B5CF6" : "2px solid var(--border-primary)",
            background: isTest ? "#8B5CF620" : "transparent",
            display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, transition: "all 0.2s",
          }}>{isTest ? "🧪" : ""}</span>
          {t("markAsTest")}
        </label>
      </div>
      <button
        onClick={handleSubmit}
        disabled={!title.trim() || saving}
        style={{
          padding: "10px 20px",
          borderRadius: 6,
          border: "none",
          background: submitted ? "#2D8A4E" : title.trim() ? (isIdea ? "#F59E0B" : isTest ? "#8B5CF6" : "var(--bg-btn)") : "var(--bg-btn-disabled)",
          color: submitted ? "#fff" : title.trim() ? (isIdea ? "#000" : isTest ? "#fff" : "var(--text-secondary)") : "var(--text-tertiary)",
          fontSize: 12,
          fontFamily: "'JetBrains Mono', monospace",
          textTransform: "uppercase",
          letterSpacing: "0.1em",
          cursor: title.trim() ? "pointer" : "default",
          transition: "all 0.3s",
        }}
      >
        {submitted ? t("crumbSaved") : saving ? "..." : t("saveCrumb")}
      </button>
    </div>
  );
}

function GlobalTimeline({ crumbs, t, lang, onToggleDone }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
      {crumbs.map((crumb, i) => {
        const isIdea = crumb.isIdea === "true";
        const isTest = crumb.isTest === "true";
        const isDone = crumb.isDone === "true";
        const isSpecial = isIdea || isTest;
        const accentColor = isIdea ? "#F59E0B" : isTest ? "#8B5CF6" : null;
        return (
          <div
            key={crumb.id || i}
            style={{
              display: "flex",
              gap: 12,
              padding: "10px 0",
              borderBottom: i < crumbs.length - 1 ? "1px solid var(--border-subtle)" : "none",
              animation: `fadeSlideIn 0.3s ease ${i * 0.04}s both`,
            }}
          >
            <div
              style={{
                width: 3, borderRadius: 2,
                background: accentColor || (crumb.projectColor || "var(--text-muted)"),
                flexShrink: 0, opacity: isSpecial ? 1 : 0.6,
              }}
            />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 3, flexWrap: "wrap" }}>
                {isIdea && (
                  <span style={{
                    fontSize: 8, padding: "1px 4px", borderRadius: 2,
                    background: "#F59E0B20", color: "#F59E0B",
                    fontFamily: "'JetBrains Mono', monospace", fontWeight: 600,
                    border: "1px solid #F59E0B40",
                  }}>💡</span>
                )}
                {isTest && (
                  <span style={{
                    fontSize: 8, padding: "1px 4px", borderRadius: 2,
                    background: "#8B5CF620", color: "#8B5CF6",
                    fontFamily: "'JetBrains Mono', monospace", fontWeight: 600,
                    border: "1px solid #8B5CF640",
                  }}>🧪</span>
                )}
                <span style={{
                  fontSize: 12,
                  color: isDone ? (accentColor ? accentColor + "90" : "var(--text-muted)") : (accentColor || "var(--text-secondary)"),
                  fontWeight: isSpecial ? 600 : 400,
                  textDecoration: isDone ? "line-through" : "none",
                }}>
                  {crumb.title}
                </span>
                <SourceBadge source={crumb.source} compact />
                {isSpecial && onToggleDone && (
                  <button
                    onClick={() => onToggleDone(crumb.id, !isDone)}
                    style={{
                      all: "unset", cursor: "pointer", fontSize: 9,
                      color: isDone ? "#2D8A4E" : "var(--text-muted)",
                      fontFamily: "'JetBrains Mono', monospace",
                    }}
                  >
                    {isDone ? "✓" : "○"}
                  </button>
                )}
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 10, color: crumb.projectColor || "var(--text-muted)", fontFamily: "'JetBrains Mono', monospace", opacity: 0.8 }}>
                  {crumb.projectName || ""}
                </span>
                <span style={{ fontSize: 10, color: "var(--text-muted)", fontFamily: "'JetBrains Mono', monospace" }}>
                  {timeAgo(crumb.timestamp, lang)}
                </span>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ProjectForm({ project, onSave, onCancel, t }) {
  const [name, setName] = useState(project?.name || "");
  const [description, setDescription] = useState(project?.description || "");
  const [status, setStatus] = useState(project?.status || "idea");
  const [color, setColor] = useState(project?.color || COLOR_PALETTE[0]);
  const [repoUrl, setRepoUrl] = useState(project?.repoUrl || "");
  const [testUrl, setTestUrl] = useState(project?.testUrl || "");
  const [testBranch, setTestBranch] = useState(project?.testBranch || "");
  const [prodUrl, setProdUrl] = useState(project?.prodUrl || "");
  const [prodBranch, setProdBranch] = useState(project?.prodBranch || "");
  const [techStack, setTechStack] = useState(project?.techStack || "");
  const [saving, setSaving] = useState(false);

  const inputStyle = {
    width: "100%",
    padding: "10px 12px",
    borderRadius: 6,
    border: "1px solid var(--border-primary)",
    background: "var(--bg-input)",
    color: "var(--text-secondary)",
    fontSize: 13,
    fontFamily: "'JetBrains Mono', monospace",
    outline: "none",
    boxSizing: "border-box",
  };

  const handleSave = async () => {
    if (!name.trim() || saving) return;
    setSaving(true);
    await onSave({ name, description, status, color, repoUrl, testUrl, testBranch, prodUrl, prodBranch, techStack });
    setSaving(false);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, animation: "fadeSlideIn 0.2s ease" }}>
      <input type="text" placeholder={t("name")} value={name} onChange={(e) => setName(e.target.value)} style={inputStyle} />
      <input type="text" placeholder={t("description")} value={description} onChange={(e) => setDescription(e.target.value)} style={inputStyle} />
      <input type="text" placeholder={t("repoUrl") + " (https://github.com/...)"} value={repoUrl} onChange={(e) => setRepoUrl(e.target.value)} style={inputStyle} />
      <select value={status} onChange={(e) => setStatus(e.target.value)} style={{ ...inputStyle, cursor: "pointer" }}>
        {STATUS_OPTIONS.map((s) => (
          <option key={s} value={s}>{s === "desarrollo" ? t("development") : s === "pausado" ? t("paused") : t("idea")}</option>
        ))}
      </select>
      {/* Test environment */}
      <div style={{
        padding: "10px 12px", borderRadius: 6,
        border: `1px solid ${DEPLOY_COLORS.test}30`,
        background: `${DEPLOY_COLORS.test}08`,
      }}>
        <div style={{
          fontSize: 9, fontFamily: "'JetBrains Mono', monospace", color: DEPLOY_COLORS.test,
          textTransform: "uppercase", letterSpacing: "0.12em", marginBottom: 8, fontWeight: 700,
        }}>
          ● {t("testEnv")}
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <input type="text" placeholder={t("testUrl") + " (https://...)"} value={testUrl} onChange={(e) => setTestUrl(e.target.value)} style={{ ...inputStyle, flex: 2 }} />
          <input type="text" placeholder={t("testBranch") + " (test/...)"} value={testBranch} onChange={(e) => setTestBranch(e.target.value)} style={{ ...inputStyle, flex: 1 }} />
        </div>
      </div>
      {/* Prod environment */}
      <div style={{
        padding: "10px 12px", borderRadius: 6,
        border: `1px solid ${DEPLOY_COLORS.prod}30`,
        background: `${DEPLOY_COLORS.prod}08`,
      }}>
        <div style={{
          fontSize: 9, fontFamily: "'JetBrains Mono', monospace", color: DEPLOY_COLORS.prod,
          textTransform: "uppercase", letterSpacing: "0.12em", marginBottom: 8, fontWeight: 700,
        }}>
          ● {t("prodEnv")}
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <input type="text" placeholder={t("prodUrl") + " (https://...)"} value={prodUrl} onChange={(e) => setProdUrl(e.target.value)} style={{ ...inputStyle, flex: 2 }} />
          <input type="text" placeholder={t("prodBranch") + " (main)"} value={prodBranch} onChange={(e) => setProdBranch(e.target.value)} style={{ ...inputStyle, flex: 1 }} />
        </div>
      </div>
      <div>
        <div style={{ fontSize: 10, color: "var(--text-muted)", fontFamily: "'JetBrains Mono', monospace", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.1em" }}>
          {t("techStack")}
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
          {Object.entries(TECH_ICONS).map(([key, meta]) => {
            const selected = techStack.split(",").map(s => s.trim()).includes(key);
            return (
              <button
                key={key}
                onClick={() => {
                  const current = techStack.split(",").map(s => s.trim()).filter(Boolean);
                  const next = selected ? current.filter(k => k !== key) : [...current, key];
                  setTechStack(next.join(","));
                }}
                style={{
                  all: "unset", cursor: "pointer",
                  display: "inline-flex", alignItems: "center", gap: 4,
                  padding: "3px 8px", borderRadius: 4,
                  background: selected ? meta.color + "20" : "transparent",
                  border: selected ? `1px solid ${meta.color}50` : "1px solid var(--border-primary)",
                  fontSize: 10, fontFamily: "'JetBrains Mono', monospace",
                  color: selected ? meta.color : "var(--text-muted)",
                  transition: "all 0.2s",
                }}
              >
                <span style={{ fontSize: 10 }}>{meta.icon}</span> {meta.label}
              </button>
            );
          })}
        </div>
      </div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
        {COLOR_PALETTE.map((c) => (
          <button
            key={c}
            onClick={() => setColor(c)}
            style={{
              all: "unset", cursor: "pointer",
              width: 24, height: 24, borderRadius: 6,
              background: c,
              border: color === c ? "2px solid var(--text-primary)" : "2px solid transparent",
              transition: "border-color 0.2s",
            }}
          />
        ))}
        <label
          title={t("customColor") || "Color personalizado"}
          style={{
            position: "relative", cursor: "pointer",
            width: 24, height: 24, borderRadius: 6,
            background: COLOR_PALETTE.includes(color) ? "var(--bg-inset)" : color,
            border: !COLOR_PALETTE.includes(color) ? "2px solid var(--text-primary)" : "1px dashed var(--border-primary)",
            display: "inline-flex", alignItems: "center", justifyContent: "center",
            fontSize: 12, color: "var(--text-muted)", overflow: "hidden",
          }}
        >
          {COLOR_PALETTE.includes(color) && "+"}
          <input
            type="color"
            value={color}
            onChange={(e) => setColor(e.target.value)}
            style={{ position: "absolute", inset: 0, opacity: 0, cursor: "pointer" }}
          />
        </label>
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <button
          onClick={handleSave}
          disabled={!name.trim() || saving}
          style={{
            flex: 1, padding: "10px", borderRadius: 6, border: "none",
            background: name.trim() ? "var(--bg-btn)" : "var(--bg-btn-disabled)",
            color: name.trim() ? "var(--text-secondary)" : "var(--text-tertiary)",
            fontSize: 12, fontFamily: "'JetBrains Mono', monospace",
            textTransform: "uppercase", letterSpacing: "0.1em",
            cursor: name.trim() ? "pointer" : "default",
          }}
        >
          {saving ? "..." : t("save")}
        </button>
        <button
          onClick={onCancel}
          style={{
            padding: "10px 16px", borderRadius: 6, border: "1px solid var(--border-primary)",
            background: "transparent", color: "var(--text-tertiary)",
            fontSize: 12, fontFamily: "'JetBrains Mono', monospace",
            textTransform: "uppercase", letterSpacing: "0.1em", cursor: "pointer",
          }}
        >
          {t("cancel")}
        </button>
      </div>
    </div>
  );
}

function ImportPanel({ projects, onImport, t }) {
  const [projectId, setProjectId] = useState(projects[0]?.id || "");
  const [raw, setRaw] = useState("");
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState(null);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState(null);

  const inputStyle = {
    width: "100%",
    padding: "10px 12px",
    borderRadius: 6,
    border: "1px solid var(--border-primary)",
    background: "var(--bg-input)",
    color: "var(--text-secondary)",
    fontSize: 13,
    fontFamily: "'JetBrains Mono', monospace",
    outline: "none",
    boxSizing: "border-box",
  };

  const handleParse = () => {
    setError(null);
    setResult(null);
    try {
      const parsed = JSON.parse(raw);
      const arr = Array.isArray(parsed) ? parsed : [parsed];
      if (arr.length === 0 || !arr[0].title) throw new Error("invalid");
      setPreview(arr);
    } catch {
      setError(t("parseError"));
      setPreview(null);
    }
  };

  const handleImport = async () => {
    if (!preview || importing) return;
    setImporting(true);
    const res = await onImport({ projectId, crumbs: preview });
    setImporting(false);
    setResult(res.imported);
    setPreview(null);
    setRaw("");
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, animation: "fadeSlideIn 0.2s ease" }}>
      <div style={{ fontSize: 11, color: "var(--text-tertiary)", fontFamily: "'JetBrains Mono', monospace", textTransform: "uppercase", letterSpacing: "0.15em" }}>
        {t("importCrumbs")}
      </div>
      <select value={projectId} onChange={(e) => setProjectId(e.target.value)} style={{ ...inputStyle, cursor: "pointer" }}>
        {projects.map((p) => (
          <option key={p.id} value={p.id}>{p.name}</option>
        ))}
      </select>
      <textarea
        placeholder={t("importPlaceholder")}
        value={raw}
        onChange={(e) => { setRaw(e.target.value); setPreview(null); setError(null); setResult(null); }}
        rows={6}
        style={{ ...inputStyle, resize: "vertical", lineHeight: 1.5 }}
      />
      {error && <div style={{ fontSize: 12, color: "#EF4444" }}>{error}</div>}
      {result != null && <div style={{ fontSize: 12, color: "#2D8A4E" }}>{result} {t("importSuccess")}</div>}

      {!preview && raw.trim() && (
        <button onClick={handleParse} style={{
          padding: "10px 20px", borderRadius: 6, border: "none",
          background: "var(--bg-btn)", color: "var(--text-secondary)",
          fontSize: 12, fontFamily: "'JetBrains Mono', monospace",
          textTransform: "uppercase", letterSpacing: "0.1em", cursor: "pointer",
        }}>
          {t("importPreview")}
        </button>
      )}

      {preview && (
        <div>
          <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 8, fontFamily: "'JetBrains Mono', monospace" }}>
            {preview.length} crumbs:
          </div>
          {preview.map((c, i) => (
            <div key={i} style={{ fontSize: 12, color: "var(--text-secondary)", padding: "6px 0", borderBottom: "1px solid var(--border-subtle)" }}>
              {c.title}
            </div>
          ))}
          <button onClick={handleImport} disabled={importing} style={{
            marginTop: 10, padding: "10px 20px", borderRadius: 6, border: "none",
            background: "#2D8A4E", color: "#fff",
            fontSize: 12, fontFamily: "'JetBrains Mono', monospace",
            textTransform: "uppercase", letterSpacing: "0.1em", cursor: "pointer",
          }}>
            {importing ? "..." : `${t("importConfirm")} ${preview.length}`}
          </button>
        </div>
      )}
    </div>
  );
}

function FilePanel({ files, onCreate, onUpdate, onDelete, t }) {
  const [showNew, setShowNew] = useState(false);
  const [newName, setNewName] = useState("");
  const [newContent, setNewContent] = useState("");
  const [editingId, setEditingId] = useState(null);
  const [editContent, setEditContent] = useState("");
  const [saving, setSaving] = useState(false);

  const inputStyle = {
    width: "100%",
    padding: "10px 12px",
    borderRadius: 6,
    border: "1px solid var(--border-primary)",
    background: "var(--bg-input)",
    color: "var(--text-secondary)",
    fontSize: 13,
    fontFamily: "'JetBrains Mono', monospace",
    outline: "none",
    boxSizing: "border-box",
  };

  const handleCreate = async () => {
    if (!newName.trim() || saving) return;
    setSaving(true);
    await onCreate(newName, newContent);
    setNewName("");
    setNewContent("");
    setShowNew(false);
    setSaving(false);
  };

  const handleSaveEdit = async (fileId) => {
    setSaving(true);
    await onUpdate(fileId, editContent);
    setEditingId(null);
    setSaving(false);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ fontSize: 10, color: "var(--text-muted)", fontFamily: "'JetBrains Mono', monospace", textTransform: "uppercase", letterSpacing: "0.15em" }}>
          {t("files")}
        </div>
        <button
          onClick={() => setShowNew(!showNew)}
          style={{
            all: "unset", cursor: "pointer", fontSize: 14, lineHeight: 1,
            width: 22, height: 22, display: "flex", alignItems: "center", justifyContent: "center",
            borderRadius: 4, border: "1px solid var(--border-primary)", color: "var(--text-tertiary)",
          }}
        >+</button>
      </div>

      {showNew && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8, animation: "fadeSlideIn 0.2s ease" }}>
          <input type="text" placeholder={t("fileName")} value={newName} onChange={(e) => setNewName(e.target.value)} style={inputStyle} />
          <textarea placeholder={t("fileContent")} value={newContent} onChange={(e) => setNewContent(e.target.value)} rows={6} style={{ ...inputStyle, resize: "vertical", lineHeight: 1.5 }} />
          <div style={{ display: "flex", gap: 6 }}>
            <button onClick={handleCreate} disabled={!newName.trim() || saving} style={{
              flex: 1, padding: "8px", borderRadius: 6, border: "none",
              background: newName.trim() ? "var(--bg-btn)" : "var(--bg-btn-disabled)",
              color: newName.trim() ? "var(--text-secondary)" : "var(--text-tertiary)",
              fontSize: 11, fontFamily: "'JetBrains Mono', monospace", textTransform: "uppercase", cursor: newName.trim() ? "pointer" : "default",
            }}>{saving ? "..." : t("save")}</button>
            <button onClick={() => setShowNew(false)} style={{
              padding: "8px 12px", borderRadius: 6, border: "1px solid var(--border-primary)",
              background: "transparent", color: "var(--text-tertiary)",
              fontSize: 11, fontFamily: "'JetBrains Mono', monospace", textTransform: "uppercase", cursor: "pointer",
            }}>{t("cancel")}</button>
          </div>
        </div>
      )}

      {files.length === 0 && !showNew && (
        <div style={{ fontSize: 12, color: "var(--text-muted)", fontFamily: "'JetBrains Mono', monospace" }}>{t("noFiles")}</div>
      )}

      {files.map((file) => (
        <div key={file.id} style={{ borderRadius: 6, border: "1px solid var(--border-subtle)", overflow: "hidden" }}>
          <div style={{
            display: "flex", justifyContent: "space-between", alignItems: "center",
            padding: "8px 12px", background: "var(--bg-inset)",
          }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text-secondary)", fontFamily: "'JetBrains Mono', monospace" }}>
              {file.name}
            </span>
            <div style={{ display: "flex", gap: 6 }}>
              <button
                onClick={() => { setEditingId(editingId === file.id ? null : file.id); setEditContent(file.content || ""); }}
                style={{ all: "unset", cursor: "pointer", fontSize: 10, color: "var(--text-tertiary)", fontFamily: "'JetBrains Mono', monospace", textTransform: "uppercase" }}
              >{editingId === file.id ? t("cancel") : t("editProject")}</button>
              <button
                onClick={() => onDelete(file.id)}
                style={{ all: "unset", cursor: "pointer", fontSize: 10, color: "#EF4444", fontFamily: "'JetBrains Mono', monospace", textTransform: "uppercase" }}
              >{t("deleteFile")}</button>
            </div>
          </div>
          {editingId === file.id ? (
            <div style={{ padding: "8px 12px", display: "flex", flexDirection: "column", gap: 6 }}>
              <textarea value={editContent} onChange={(e) => setEditContent(e.target.value)} rows={8} style={{ ...inputStyle, resize: "vertical", lineHeight: 1.5 }} />
              <button onClick={() => handleSaveEdit(file.id)} disabled={saving} style={{
                padding: "8px", borderRadius: 6, border: "none", background: "var(--bg-btn)",
                color: "var(--text-secondary)", fontSize: 11, fontFamily: "'JetBrains Mono', monospace",
                textTransform: "uppercase", cursor: "pointer",
              }}>{saving ? "..." : t("save")}</button>
            </div>
          ) : (
            <pre style={{
              margin: 0, padding: "10px 12px", fontSize: 11, lineHeight: 1.5,
              color: "var(--text-tertiary)", fontFamily: "'JetBrains Mono', monospace",
              whiteSpace: "pre-wrap", wordBreak: "break-word", maxHeight: 200, overflow: "auto",
            }}>{file.content || ""}</pre>
          )}
        </div>
      ))}
    </div>
  );
}

function IdeasTestingView({ type, projects, onToggleDone, onEditCrumb, t, lang }) {
  const [allCrumbs, setAllCrumbs] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadAll = async () => {
      setLoading(true);
      const promises = projects.map((p) => api.getCrumbs(p.id).then((d) => (d.crumbs || []).map((c) => ({ ...c, projectName: p.name, projectColor: p.color }))));
      const results = await Promise.all(promises);
      const flat = results.flat().sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
      setAllCrumbs(flat);
      setLoading(false);
    };
    loadAll();
  }, [projects]);

  const isIdea = type === "idea";
  const filtered = allCrumbs.filter((c) => isIdea ? c.isIdea === "true" : c.isTest === "true");
  const pending = filtered.filter((c) => c.isDone !== "true");
  const done = filtered.filter((c) => c.isDone === "true");
  const accentColor = isIdea ? "#F59E0B" : "#8B5CF6";
  const emptyMsg = isIdea ? t("noIdeas") : t("noTests");

  const handleToggle = async (crumbId, isDone) => {
    await onToggleDone(crumbId, isDone);
    // Reload
    const promises = projects.map((p) => api.getCrumbs(p.id).then((d) => (d.crumbs || []).map((c) => ({ ...c, projectName: p.name, projectColor: p.color }))));
    const results = await Promise.all(promises);
    setAllCrumbs(results.flat().sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp)));
  };

  const handleEdit = async (crumbId, fields) => {
    await onEditCrumb(crumbId, fields);
    const promises = projects.map((p) => api.getCrumbs(p.id).then((d) => (d.crumbs || []).map((c) => ({ ...c, projectName: p.name, projectColor: p.color }))));
    const results = await Promise.all(promises);
    setAllCrumbs(results.flat().sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp)));
  };

  if (loading) {
    return <div style={{ textAlign: "center", padding: 60, color: "var(--text-muted)", fontFamily: "'JetBrains Mono', monospace" }}>{t("loading")}</div>;
  }

  if (filtered.length === 0) {
    return <div style={{ textAlign: "center", padding: 60, color: "var(--text-muted)", fontFamily: "'JetBrains Mono', monospace" }}>{emptyMsg}</div>;
  }

  return (
    <div style={{ maxWidth: 800, animation: "fadeSlideIn 0.3s ease" }}>
      {/* Stats bar */}
      <div style={{ display: "flex", gap: 16, marginBottom: 24, alignItems: "center" }}>
        <span style={{
          fontSize: 24, fontWeight: 700, color: accentColor,
          fontFamily: "'Space Grotesk', sans-serif",
        }}>{pending.length}</span>
        <span style={{ fontSize: 12, color: "var(--text-tertiary)", fontFamily: "'JetBrains Mono', monospace" }}>{t("pending")}</span>
        <div style={{ width: 1, height: 20, background: "var(--border-primary)" }} />
        <span style={{
          fontSize: 24, fontWeight: 700, color: "var(--text-muted)",
          fontFamily: "'Space Grotesk', sans-serif",
        }}>{done.length}</span>
        <span style={{ fontSize: 12, color: "var(--text-muted)", fontFamily: "'JetBrains Mono', monospace" }}>{t("done")}</span>
      </div>

      {/* Pending items */}
      <Timeline
        crumbs={pending}
        projectColor={accentColor}
        lang={lang}
        onToggleDone={handleToggle}
        onEditCrumb={handleEdit}
        t={t}
      />

      {/* Done items */}
      {done.length > 0 && (
        <div style={{ marginTop: 24, paddingTop: 16, borderTop: "1px solid var(--border-primary)" }}>
          <div style={{
            fontSize: 10, color: "var(--text-muted)", fontFamily: "'JetBrains Mono', monospace",
            textTransform: "uppercase", letterSpacing: "0.15em", marginBottom: 12,
          }}>
            ✓ {t("done")} ({done.length})
          </div>
          <Timeline
            crumbs={done}
            projectColor={accentColor}
            lang={lang}
            onToggleDone={handleToggle}
            onEditCrumb={handleEdit}
            t={t}
          />
        </div>
      )}
    </div>
  );
}

// --- MAIN APP ---
export default function MissionControl() {
  const [projects, setProjects] = useState([]);
  const [recentCrumbs, setRecentCrumbs] = useState([]);
  const [selectedProject, setSelectedProject] = useState(null);
  const [projectCrumbs, setProjectCrumbs] = useState([]);
  const [projectFiles, setProjectFiles] = useState([]);
  const [view, setView] = useState("grid");
  const [isDark, setIsDark] = useState(false);
  const [lang, setLang] = useState(() => localStorage.getItem("mc-lang") || "es");
  const [loading, setLoading] = useState(true);
  const [showNewProject, setShowNewProject] = useState(false);
  const [editingProject, setEditingProject] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [copied, setCopied] = useState(false);
  const [contextCopied, setContextCopied] = useState(false);
  const detailRef = useRef(null);

  const API_BASE = "https://missioncontrol-coral.vercel.app";

  const buildExportPrompt = () => {
    const projectList = projects.map(p => {
      const envs = [];
      if (p.testUrl) envs.push(`test: ${p.testUrl}${p.testBranch ? ` (${p.testBranch})` : ""}`);
      if (p.prodUrl) envs.push(`prod: ${p.prodUrl}${p.prodBranch ? ` (${p.prodBranch})` : ""}`);
      const envStr = envs.length ? ` — ${envs.join(" | ")}` : "";
      return `${p.id} (${p.name})${envStr}`;
    }).join("\n");
    return `Exportar sesión a Mission Control

Identifica el projectId correcto de la lista de abajo según el proyecto en el que hemos trabajado. Si no estás seguro de cuál es, pregúntame antes de continuar.

Haz CUATRO cosas, en este orden:

---
1. PROYECTO — Asegura que el proyecto tiene URLs actualizadas

Comprueba si las URLs de test/prod del proyecto coinciden con las actuales de esta sesión. Si no coinciden o faltan, actualízalas:

curl -X PUT ${API_BASE}/api/projects/PROJECT_ID \\
  -H "Content-Type: application/json" \\
  -H "x-api-key: $MC_API_KEY" \\
  -d '{"testUrl": "...", "testBranch": "...", "prodUrl": "...", "prodBranch": "..."}'

Si el proyecto no existe en la lista, pregúntame nombre, descripción y color antes de crearlo:

curl -X POST ${API_BASE}/api/projects \\
  -H "Content-Type: application/json" \\
  -H "x-api-key: $MC_API_KEY" \\
  -d '{"name": "Nombre", "description": "Descripción", "status": "desarrollo", "color": "#3B82F6", "testUrl": "...", "testBranch": "...", "prodUrl": "...", "prodBranch": "..."}'

Esto es obligatorio en cada export. No saltar este paso.

---
2. CRUMBS — Registra las actividades de la sesión

Genera JSON con las actividades significativas:

[
  {
    "title": "Descripción corta (max 10 palabras)",
    "body": "Qué se hizo, decisiones tomadas, qué queda pendiente.",
    "source": "claude-code",
    "timestamp": "YYYY-MM-DDTHH:MM:SS"
  }
]

Reglas:
- source: "claude-code" si estamos en Claude Code, "claude-web" si en Claude Web
- timestamp: fecha/hora real de cuando se hizo. Si no conoces la hora exacta, usa mediodía (12:00:00) de la fecha actual
- Un objeto por bloque de trabajo significativo, no uno por commit
- El body debe dar contexto suficiente para retomar

curl -X POST ${API_BASE}/api/import \\
  -H "Content-Type: application/json" \\
  -H "x-api-key: $MC_API_KEY" \\
  -d '{"projectId": "PROJECT_ID", "crumbs": [...]}'

---
3. CONTEXT.md — Foto completa del estado del proyecto

Genera un documento con todas estas secciones:
- Qué es (1-2 frases)
- Tech stack
- Arquitectura (estructura de archivos clave)
- Estado actual — funciona
- Estado actual — pendiente (próximos pasos concretos)
- Decisiones importantes
- Despliegues (tabla con entorno, URL y rama para test y prod)
- URLs (repo, recursos externos)

Primero comprueba si ya existe:

curl -s "${API_BASE}/api/files?projectId=PROJECT_ID" \\
  -H "x-api-key: $MC_API_KEY"

Si existe, actualízalo (PUT con fileId):

curl -X PUT ${API_BASE}/api/files \\
  -H "Content-Type: application/json" \\
  -H "x-api-key: $MC_API_KEY" \\
  -d '{"fileId": "FILE_ID", "content": "..."}'

Si no existe, créalo:

curl -X POST ${API_BASE}/api/files \\
  -H "Content-Type: application/json" \\
  -H "x-api-key: $MC_API_KEY" \\
  -d '{"projectId": "PROJECT_ID", "name": "CONTEXT.md", "content": "..."}'

---
4. DEPLOY_STATUS.md — Diferencias entre test y prod

Si el proyecto tiene ramas test y prod distintas, analiza qué hay en test que no está en prod:

\`\`\`bash
git log <prodBranch>..<testBranch> --oneline
\`\`\`

Genera un documento DEPLOY_STATUS.md con:
- Fecha del análisis
- Funcionalidades en test pendientes de desplegar a prod (resumen legible, no commits raw)
- Riesgos o dependencias si las hay
- Si test y prod están sincronizadas, indicarlo

Guárdalo como archivo del proyecto (mismo flujo que CONTEXT.md: comprobar si existe, PUT o POST).
El nombre del archivo DEBE ser exactamente "DEPLOY_STATUS.md".

Si no hay rama test o test=prod, omite este paso.

---
Project IDs disponibles (con sus entornos actuales):

${projectList}

Si un proyecto no tiene URLs listadas, rellena las que conozcas de esta sesión.`;
  };

  const handleCopyPrompt = () => {
    navigator.clipboard.writeText(buildExportPrompt());
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const t = createT(lang);

  const loadProjects = useCallback(async () => {
    try {
      const data = await api.getProjects();
      const sorted = (data.projects || []).sort((a, b) => {
        const dateA = a.lastCrumb ? new Date(a.lastCrumb.timestamp) : new Date(0);
        const dateB = b.lastCrumb ? new Date(b.lastCrumb.timestamp) : new Date(0);
        return dateB - dateA;
      });
      setProjects(sorted);
    } catch (e) {
      console.error("Failed to load projects:", e);
    }
  }, []);

  const loadRecentCrumbs = useCallback(async () => {
    try {
      const data = await api.getCrumbs();
      setRecentCrumbs(data.crumbs || []);
    } catch (e) {
      console.error("Failed to load recent crumbs:", e);
    }
  }, []);

  useEffect(() => {
    Promise.all([loadProjects(), loadRecentCrumbs()]).finally(() => setLoading(false));
  }, [loadProjects, loadRecentCrumbs]);

  useEffect(() => {
    localStorage.setItem("mc-lang", lang);
  }, [lang]);

  const handleSelectProject = async (project) => {
    setSelectedProject(project);
    setView("detail");
    setEditingProject(false);
    try {
      const [crumbsData, filesData] = await Promise.all([
        api.getCrumbs(project.id),
        api.getFiles(project.id),
      ]);
      setProjectCrumbs(crumbsData.crumbs || []);
      setProjectFiles(filesData.files || []);
    } catch (e) {
      console.error("Failed to load project data:", e);
    }
  };

  const handleBack = () => {
    setView("grid");
    setSelectedProject(null);
    setProjectCrumbs([]);
    setProjectFiles([]);
    setEditingProject(false);
  };

  const handleCreateCrumb = async (data) => {
    await api.createCrumb(data);
    await loadProjects();
    await loadRecentCrumbs();
    if (selectedProject && data.projectId === selectedProject.id) {
      const fresh = await api.getCrumbs(selectedProject.id);
      setProjectCrumbs(fresh.crumbs || []);
    }
  };

  const handleToggleDone = async (crumbId, isDone) => {
    await api.updateCrumb({ crumbId, isDone });
    await loadRecentCrumbs();
    if (selectedProject) {
      const fresh = await api.getCrumbs(selectedProject.id);
      setProjectCrumbs(fresh.crumbs || []);
    }
  };

  const handleEditCrumb = async (crumbId, fields) => {
    await api.updateCrumb({ crumbId, ...fields });
    await loadRecentCrumbs();
    if (selectedProject) {
      const fresh = await api.getCrumbs(selectedProject.id);
      setProjectCrumbs(fresh.crumbs || []);
    }
  };

  const handleCopyContext = () => {
    const contextFile = projectFiles.find((f) => f.name === "CONTEXT.md");
    if (!contextFile) {
      alert(t("noContext"));
      return;
    }
    const repo = selectedProject?.repoUrl || "";
    const projectName = selectedProject?.name || "proyecto";
    let gitBlock = "";
    if (repo) {
      const repoName = repo.split("/").pop()?.replace(/\.git$/, "") || projectName;
      gitBlock = `\n\n---\n## Setup: clone o pull\n\nAntes de empezar, asegura que tienes el código actualizado. Ejecuta esto:\n\n\`\`\`bash\nif [ -d "${repoName}" ]; then\n  cd ${repoName} && git pull origin main\nelse\n  git clone ${repo}.git && cd ${repoName}\nfi\n\`\`\`\n\nSi el directorio ya existe, hace pull. Si no, hace clone.\n---\n`;
    }
    navigator.clipboard.writeText(contextFile.content + gitBlock);
    setContextCopied(true);
    setTimeout(() => setContextCopied(false), 2000);
  };

  const handleCreateProject = async (data) => {
    await api.createProject(data);
    await loadProjects();
    setShowNewProject(false);
  };

  const handleUpdateProject = async (data) => {
    await api.updateProject(selectedProject.id, data);
    await loadProjects();
    const updated = { ...selectedProject, ...data };
    setSelectedProject(updated);
    setEditingProject(false);
  };

  const handleDeleteProject = async () => {
    if (!confirm(t("deleteConfirm"))) return;
    await api.deleteProject(selectedProject.id);
    await loadProjects();
    handleBack();
  };

  const handleImport = async (data) => {
    const res = await api.importCrumbs(data);
    await loadProjects();
    await loadRecentCrumbs();
    if (selectedProject && data.projectId === selectedProject.id) {
      const fresh = await api.getCrumbs(selectedProject.id);
      setProjectCrumbs(fresh.crumbs || []);
    }
    return res;
  };

  const handleCreateFile = async (name, content) => {
    await api.createFile({ projectId: selectedProject.id, name, content });
    const fresh = await api.getFiles(selectedProject.id);
    setProjectFiles(fresh.files || []);
  };

  const handleUpdateFile = async (fileId, content) => {
    await api.updateFile({ fileId, content });
    const fresh = await api.getFiles(selectedProject.id);
    setProjectFiles(fresh.files || []);
  };

  const handleDeleteFile = async (fileId) => {
    await api.deleteFile({ fileId, projectId: selectedProject.id });
    const fresh = await api.getFiles(selectedProject.id);
    setProjectFiles(fresh.files || []);
  };

  // Enrich recent crumbs with project info
  const enrichedRecent = recentCrumbs.map((c) => {
    const p = projects.find((pr) => pr.id === c.projectId);
    return { ...c, projectName: p?.name || "", projectColor: p?.color || "#888" };
  });

  return (
    <div
      data-theme={isDark ? "dark" : "light"}
      style={{
        minHeight: "100vh",
        background: "var(--bg-primary)",
        color: "var(--text-primary)",
        fontFamily: "'Space Grotesk', 'Segoe UI', sans-serif",
        position: "relative",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          position: "fixed", inset: 0,
          backgroundImage: `linear-gradient(var(--grid-line) 1px, transparent 1px), linear-gradient(90deg, var(--grid-line) 1px, transparent 1px)`,
          backgroundSize: "60px 60px",
          pointerEvents: "none", zIndex: 0,
        }}
      />
      <div
        style={{
          position: "fixed", top: "-20%", left: "30%", width: "60%", height: "60%",
          background: "radial-gradient(ellipse, var(--glow-color), transparent 70%)",
          pointerEvents: "none", zIndex: 0,
        }}
      />

      <div style={{ position: "relative", zIndex: 1, maxWidth: 1200, margin: "0 auto", padding: "32px 24px" }}>
        {/* Header */}
        <header style={{ marginBottom: 40 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 6 }}>
            {view === "detail" && (
              <button
                onClick={handleBack}
                style={{
                  all: "unset", cursor: "pointer", fontSize: 13,
                  color: "var(--text-tertiary)", fontFamily: "'JetBrains Mono', monospace",
                  padding: "4px 10px", borderRadius: 4,
                  border: "1px solid var(--border-primary)", transition: "all 0.2s",
                }}
                onMouseEnter={(e) => { e.target.style.color = "var(--text-secondary)"; e.target.style.borderColor = "var(--border-hover)"; }}
                onMouseLeave={(e) => { e.target.style.color = "var(--text-tertiary)"; e.target.style.borderColor = "var(--border-primary)"; }}
              >
                {t("backToProjects")}
              </button>
            )}
            <h1
              style={{
                fontSize: view === "grid" ? 24 : 18,
                fontWeight: 700, margin: 0, letterSpacing: "-0.02em",
                color: "var(--text-primary)", transition: "font-size 0.3s",
              }}
            >
              {view === "detail" ? selectedProject?.name : view === "ideas" ? `💡 ${t("allIdeas")}` : view === "testing" ? `🧪 ${t("allTests")}` : view === "briefings" ? `📋 ${t("allBriefings")}` : "Mission Control"}
            </h1>
            {view === "detail" && selectedProject && (
              <>
                <StatusDot status={selectedProject.status} color={selectedProject.color} t={t} />
                <DeploymentBadges project={selectedProject} t={t} />
                <ProjectLinks project={selectedProject} />
              </>
            )}
            {(view === "ideas" || view === "testing" || view === "briefings") && (
              <button
                onClick={() => setView("grid")}
                style={{
                  all: "unset", cursor: "pointer", fontSize: 13,
                  color: "var(--text-tertiary)", fontFamily: "'JetBrains Mono', monospace",
                  padding: "4px 10px", borderRadius: 4,
                  border: "1px solid var(--border-primary)", transition: "all 0.2s",
                }}
              >
                {t("backToProjects")}
              </button>
            )}

            <div style={{ marginLeft: "auto", display: "flex", gap: 6, alignItems: "center" }}>
              {view === "detail" && (
                <button
                  onClick={handleCopyContext}
                  style={{
                    all: "unset", cursor: "pointer", fontSize: 11,
                    padding: "4px 8px", borderRadius: 6,
                    border: "1px solid #2D8A4E",
                    background: contextCopied ? "#2D8A4E" : "var(--bg-card)",
                    color: contextCopied ? "#fff" : "#2D8A4E",
                    fontFamily: "'JetBrains Mono', monospace",
                    letterSpacing: "0.05em", transition: "all 0.3s",
                    whiteSpace: "nowrap",
                  }}
                  title={t("copyContext")}
                >
                  {contextCopied ? t("contextCopied") : t("copyContext")}
                </button>
              )}
              <button
                onClick={() => handleCopyPrompt()}
                style={{
                  all: "unset", cursor: "pointer", fontSize: 11,
                  padding: "4px 8px", borderRadius: 6,
                  border: "1px solid #2D8A4E",
                  background: copied ? "#2D8A4E" : "var(--bg-card)",
                  color: copied ? "#fff" : "#2D8A4E",
                  fontFamily: "'JetBrains Mono', monospace",
                  letterSpacing: "0.05em", transition: "all 0.3s",
                  whiteSpace: "nowrap",
                }}
                title={lang === "es" ? "Exportar sesión de Claude a Mission Control" : "Export Claude session to Mission Control"}
              >
                {copied ? "✓" : "Claude → MissionControl"}
              </button>
              <button
                onClick={() => { const next = lang === "es" ? "en" : "es"; setLang(next); }}
                style={{
                  all: "unset", cursor: "pointer", fontSize: 11,
                  padding: "4px 8px", borderRadius: 6,
                  border: "1px solid var(--border-primary)", background: "var(--bg-card)",
                  color: "var(--text-tertiary)", fontFamily: "'JetBrains Mono', monospace",
                  textTransform: "uppercase", letterSpacing: "0.05em",
                }}
              >
                {lang === "es" ? "EN" : "ES"}
              </button>
              <button
                onClick={() => setIsDark(!isDark)}
                style={{
                  all: "unset", cursor: "pointer", fontSize: 16,
                  width: 32, height: 32, display: "flex", alignItems: "center", justifyContent: "center",
                  borderRadius: 6, border: "1px solid var(--border-primary)",
                  background: "var(--bg-card)", transition: "all 0.2s",
                }}
                title={isDark ? "Light mode" : "Dark mode"}
              >
                {isDark ? "☀️" : "🌙"}
              </button>
            </div>
          </div>
          <p
            style={{
              margin: 0, fontSize: 12,
              color: "var(--text-muted)", fontFamily: "'JetBrains Mono', monospace",
              letterSpacing: "0.05em",
            }}
          >
            {view === "detail"
              ? selectedProject?.description
              : `${projects.length} ${t("projects").toLowerCase()} · 4 ${t("subtitle")}`}
          </p>
        </header>

        {/* Loading */}
        {loading && (
          <div style={{ textAlign: "center", padding: 60, color: "var(--text-muted)", fontFamily: "'JetBrains Mono', monospace" }}>
            {t("loading")}
          </div>
        )}

        {/* GRID VIEW */}
        {!loading && view === "grid" && (
          <>
          <DailyPulseBanner apiBase={API_BASE} />
          <div style={{ display: "grid", gridTemplateColumns: "1fr 340px", gap: 32, alignItems: "start" }}>
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
                <div style={{
                  fontSize: 10, color: "var(--text-muted)", fontFamily: "'JetBrains Mono', monospace",
                  textTransform: "uppercase", letterSpacing: "0.15em",
                }}>
                  {t("projects")}
                </div>
                <button
                  onClick={() => setShowNewProject(!showNewProject)}
                  style={{
                    all: "unset", cursor: "pointer", fontSize: 16, lineHeight: 1,
                    width: 24, height: 24, display: "flex", alignItems: "center", justifyContent: "center",
                    borderRadius: 6, border: "1px solid var(--border-primary)",
                    color: "var(--text-tertiary)", transition: "all 0.2s",
                  }}
                  title={t("newProject")}
                >
                  +
                </button>
                <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
                  <button
                    onClick={() => setView("ideas")}
                    style={{
                      all: "unset", cursor: "pointer", fontSize: 11,
                      padding: "5px 12px", borderRadius: 6,
                      background: "#F59E0B18", border: "1px solid #F59E0B35",
                      color: "#F59E0B", fontFamily: "'JetBrains Mono', monospace",
                      fontWeight: 600, letterSpacing: "0.05em", transition: "all 0.2s",
                    }}
                    onMouseEnter={(e) => { e.target.style.background = "#F59E0B28"; }}
                    onMouseLeave={(e) => { e.target.style.background = "#F59E0B18"; }}
                  >
                    💡 {t("allIdeas")}
                  </button>
                  <button
                    onClick={() => setView("testing")}
                    style={{
                      all: "unset", cursor: "pointer", fontSize: 11,
                      padding: "5px 12px", borderRadius: 6,
                      background: "#8B5CF618", border: "1px solid #8B5CF635",
                      color: "#8B5CF6", fontFamily: "'JetBrains Mono', monospace",
                      fontWeight: 600, letterSpacing: "0.05em", transition: "all 0.2s",
                    }}
                    onMouseEnter={(e) => { e.target.style.background = "#8B5CF628"; }}
                    onMouseLeave={(e) => { e.target.style.background = "#8B5CF618"; }}
                  >
                    🧪 {t("allTests")}
                  </button>
                  <button
                    onClick={() => setView("briefings")}
                    style={{
                      all: "unset", cursor: "pointer", fontSize: 11,
                      padding: "5px 12px", borderRadius: 6,
                      background: "#14B8A618", border: "1px solid #14B8A635",
                      color: "#14B8A6", fontFamily: "'JetBrains Mono', monospace",
                      fontWeight: 600, letterSpacing: "0.05em", transition: "all 0.2s",
                    }}
                    onMouseEnter={(e) => { e.target.style.background = "#14B8A628"; }}
                    onMouseLeave={(e) => { e.target.style.background = "#14B8A618"; }}
                  >
                    📋 {t("allBriefings")}
                  </button>
                </div>
              </div>

              {showNewProject && (
                <div style={{
                  padding: "18px 20px", borderRadius: 10, marginBottom: 12,
                  background: "var(--bg-card)", border: "1px solid var(--border-primary)",
                }}>
                  <ProjectForm t={t} onSave={handleCreateProject} onCancel={() => setShowNewProject(false)} />
                </div>
              )}

              {projects.length === 0 && !showNewProject && (
                <div style={{ padding: 40, textAlign: "center", color: "var(--text-muted)", fontFamily: "'JetBrains Mono', monospace" }}>
                  {t("noProjects")}
                </div>
              )}

              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: 12 }}>
                {projects.map((project) => (
                  <ProjectCard
                    key={project.id}
                    project={project}
                    onClick={() => handleSelectProject(project)}
                    isSelected={selectedProject?.id === project.id}
                    t={t}
                    lang={lang}
                  />
                ))}
              </div>
            </div>

            {/* Right sidebar */}
            <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
              <div style={{ padding: "18px 20px", borderRadius: 10, background: "var(--bg-card)", border: "1px solid var(--border-primary)" }}>
                <CrumbForm projects={projects} onSubmit={handleCreateCrumb} t={t} />
              </div>

              <div style={{ padding: "18px 20px", borderRadius: 10, background: "var(--bg-card)", border: "1px solid var(--border-primary)" }}>
                <ImportPanel projects={projects} onImport={handleImport} t={t} />
              </div>

              <div style={{ padding: "18px 20px", borderRadius: 10, background: "var(--bg-card)", border: "1px solid var(--border-primary)" }}>
                <div style={{
                  fontSize: 10, color: "var(--text-muted)", fontFamily: "'JetBrains Mono', monospace",
                  textTransform: "uppercase", letterSpacing: "0.15em", marginBottom: 14,
                }}>
                  {t("recentActivity")}
                </div>
                <GlobalTimeline crumbs={enrichedRecent} t={t} lang={lang} onToggleDone={handleToggleDone} />
              </div>
            </div>
          </div>
          </>
        )}

        {/* IDEAS VIEW */}
        {!loading && view === "ideas" && (
          <IdeasTestingView
            type="idea"
            crumbs={recentCrumbs}
            allCrumbs={recentCrumbs}
            projects={projects}
            onToggleDone={handleToggleDone}
            onEditCrumb={handleEditCrumb}
            t={t}
            lang={lang}
          />
        )}

        {/* TESTING VIEW */}
        {!loading && view === "testing" && (
          <IdeasTestingView
            type="test"
            crumbs={recentCrumbs}
            allCrumbs={recentCrumbs}
            projects={projects}
            onToggleDone={handleToggleDone}
            onEditCrumb={handleEditCrumb}
            t={t}
            lang={lang}
          />
        )}

        {/* BRIEFINGS VIEW */}
        {!loading && view === "briefings" && (
          <BriefingsView apiBase={API_BASE} t={t} />
        )}

        {/* DETAIL VIEW */}
        {!loading && view === "detail" && selectedProject && (
          <div
            ref={detailRef}
            style={{
              display: "grid", gridTemplateColumns: "1fr 340px", gap: 32,
              alignItems: "start", animation: "fadeSlideIn 0.3s ease",
            }}
          >
            <div>
              <ProjectBriefingSection
                projectId={selectedProject.id}
                apiBase={API_BASE}
              />

              {/* Tech stack */}
              {selectedProject.techStack && (
                <div style={{ marginBottom: 16 }}>
                  <TechStackBadges techStack={selectedProject.techStack} />
                </div>
              )}

              {/* Deployments section */}
              {(selectedProject.testUrl || selectedProject.prodUrl) && (
                <div style={{
                  display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12,
                  marginBottom: 20,
                }}>
                  {/* TEST block */}
                  <div style={{
                    padding: "14px 16px", borderRadius: 8,
                    border: `1px solid ${selectedProject.testUrl ? DEPLOY_COLORS.test + "40" : "var(--border-primary)"}`,
                    background: selectedProject.testUrl ? DEPLOY_COLORS.test + "08" : "var(--bg-inset)",
                  }}>
                    <div style={{
                      display: "flex", alignItems: "center", gap: 6, marginBottom: 10,
                    }}>
                      <span style={{
                        width: 7, height: 7, borderRadius: "50%",
                        background: selectedProject.testUrl ? DEPLOY_COLORS.test : DEPLOY_COLORS.none,
                        boxShadow: selectedProject.testUrl ? `0 0 8px ${DEPLOY_COLORS.test}60` : "none",
                        animation: selectedProject.testUrl ? "pulse 2s ease-in-out infinite" : "none",
                      }} />
                      <span style={{
                        fontSize: 10, fontFamily: "'JetBrains Mono', monospace",
                        fontWeight: 700, letterSpacing: "0.1em",
                        color: selectedProject.testUrl ? DEPLOY_COLORS.test : "var(--text-muted)",
                        textTransform: "uppercase",
                      }}>
                        {t("testEnv")}
                      </span>
                    </div>
                    {selectedProject.testUrl ? (
                      <>
                        <a href={selectedProject.testUrl} target="_blank" rel="noopener noreferrer"
                          style={{
                            display: "block", fontSize: 11, fontFamily: "'JetBrains Mono', monospace",
                            color: DEPLOY_COLORS.test, textDecoration: "none", wordBreak: "break-all",
                            marginBottom: 6, opacity: 0.9,
                          }}
                        >
                          {selectedProject.testUrl.replace(/^https?:\/\//, "")}
                        </a>
                        {selectedProject.testBranch && (
                          <span style={{
                            fontSize: 10, fontFamily: "'JetBrains Mono', monospace",
                            color: "var(--text-muted)", background: "var(--bg-inset)",
                            padding: "2px 6px", borderRadius: 3,
                          }}>
                            ⎇ {selectedProject.testBranch}
                          </span>
                        )}
                      </>
                    ) : (
                      <span style={{ fontSize: 11, color: "var(--text-muted)", fontFamily: "'JetBrains Mono', monospace" }}>
                        {t("notDeployed")}
                      </span>
                    )}
                  </div>

                  {/* PROD block */}
                  <div style={{
                    padding: "14px 16px", borderRadius: 8,
                    border: `1px solid ${selectedProject.prodUrl ? DEPLOY_COLORS.prod + "40" : "var(--border-primary)"}`,
                    background: selectedProject.prodUrl ? DEPLOY_COLORS.prod + "08" : "var(--bg-inset)",
                  }}>
                    <div style={{
                      display: "flex", alignItems: "center", gap: 6, marginBottom: 10,
                    }}>
                      <span style={{
                        width: 7, height: 7, borderRadius: "50%",
                        background: selectedProject.prodUrl ? DEPLOY_COLORS.prod : DEPLOY_COLORS.none,
                        boxShadow: selectedProject.prodUrl ? `0 0 8px ${DEPLOY_COLORS.prod}60` : "none",
                        animation: selectedProject.prodUrl ? "pulse 2s ease-in-out infinite" : "none",
                      }} />
                      <span style={{
                        fontSize: 10, fontFamily: "'JetBrains Mono', monospace",
                        fontWeight: 700, letterSpacing: "0.1em",
                        color: selectedProject.prodUrl ? DEPLOY_COLORS.prod : "var(--text-muted)",
                        textTransform: "uppercase",
                      }}>
                        {t("prodEnv")}
                      </span>
                    </div>
                    {selectedProject.prodUrl ? (
                      <>
                        <a href={selectedProject.prodUrl} target="_blank" rel="noopener noreferrer"
                          style={{
                            display: "block", fontSize: 11, fontFamily: "'JetBrains Mono', monospace",
                            color: DEPLOY_COLORS.prod, textDecoration: "none", wordBreak: "break-all",
                            marginBottom: 6, opacity: 0.9,
                          }}
                        >
                          {selectedProject.prodUrl.replace(/^https?:\/\//, "")}
                        </a>
                        {selectedProject.prodBranch && (
                          <span style={{
                            fontSize: 10, fontFamily: "'JetBrains Mono', monospace",
                            color: "var(--text-muted)", background: "var(--bg-inset)",
                            padding: "2px 6px", borderRadius: 3,
                          }}>
                            ⎇ {selectedProject.prodBranch}
                          </span>
                        )}
                      </>
                    ) : (
                      <span style={{ fontSize: 11, color: "var(--text-muted)", fontFamily: "'JetBrains Mono', monospace" }}>
                        {t("notDeployed")}
                      </span>
                    )}
                  </div>
                </div>
              )}

              {/* Deploy status (test vs prod) */}
              {(() => {
                const deployFile = projectFiles.find((f) => f.name === "DEPLOY_STATUS.md");
                if (!deployFile) return null;
                const content = deployFile.content || "";
                const isSynced = content.toLowerCase().includes("sincronizada") || content.toLowerCase().includes("synced") || content.toLowerCase().includes("no hay diferencias");
                return (
                  <div style={{
                    padding: "14px 16px", borderRadius: 8, marginBottom: 16,
                    border: `1px solid ${isSynced ? "#2D8A4E40" : "#F59E0B40"}`,
                    background: isSynced ? "#2D8A4E08" : "#F59E0B08",
                  }}>
                    <div style={{
                      display: "flex", alignItems: "center", gap: 6, marginBottom: 8,
                    }}>
                      <span style={{
                        width: 7, height: 7, borderRadius: "50%",
                        background: isSynced ? "#2D8A4E" : "#F59E0B",
                        boxShadow: `0 0 8px ${isSynced ? "#2D8A4E60" : "#F59E0B60"}`,
                      }} />
                      <span style={{
                        fontSize: 10, fontFamily: "'JetBrains Mono', monospace",
                        fontWeight: 700, letterSpacing: "0.1em",
                        color: isSynced ? "#2D8A4E" : "#F59E0B",
                        textTransform: "uppercase",
                      }}>
                        {isSynced ? "Test = Prod" : "Test ≠ Prod — pendiente de deploy"}
                      </span>
                    </div>
                    <pre style={{
                      fontSize: 11, fontFamily: "'JetBrains Mono', monospace",
                      color: "var(--text-secondary)", lineHeight: 1.6,
                      whiteSpace: "pre-wrap", margin: 0, maxHeight: 200, overflow: "auto",
                    }}>
                      {content}
                    </pre>
                  </div>
                );
              })()}

              {/* Edit/Delete buttons */}
              <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
                <button
                  onClick={() => setEditingProject(!editingProject)}
                  style={{
                    all: "unset", cursor: "pointer", fontSize: 11,
                    padding: "4px 10px", borderRadius: 4,
                    border: "1px solid var(--border-primary)",
                    color: "var(--text-tertiary)", fontFamily: "'JetBrains Mono', monospace",
                    textTransform: "uppercase", letterSpacing: "0.05em",
                  }}
                >
                  {t("editProject")}
                </button>
                <button
                  onClick={handleDeleteProject}
                  style={{
                    all: "unset", cursor: "pointer", fontSize: 11,
                    padding: "4px 10px", borderRadius: 4,
                    border: "1px solid rgba(239,68,68,0.3)",
                    color: "#EF4444", fontFamily: "'JetBrains Mono', monospace",
                    textTransform: "uppercase", letterSpacing: "0.05em",
                  }}
                >
                  {t("deleteProject")}
                </button>
              </div>

              {editingProject && (
                <div style={{
                  padding: "18px 20px", borderRadius: 10, marginBottom: 20,
                  background: "var(--bg-card)", border: "1px solid var(--border-primary)",
                }}>
                  <ProjectForm project={selectedProject} t={t} onSave={handleUpdateProject} onCancel={() => setEditingProject(false)} />
                </div>
              )}

              {/* "Donde lo dejaste" hero */}
              {selectedProject.lastCrumb && (
                <div
                  style={{
                    padding: "20px 24px", borderRadius: 10,
                    background: `linear-gradient(135deg, ${selectedProject.color}10, var(--bg-inset))`,
                    border: `1px solid ${selectedProject.color}30`,
                    marginBottom: 28,
                  }}
                >
                  <div style={{
                    fontSize: 10, color: selectedProject.color, fontFamily: "'JetBrains Mono', monospace",
                    textTransform: "uppercase", letterSpacing: "0.15em", marginBottom: 10, opacity: 0.8,
                  }}>
                    ◉ {t("whereYouLeft")}
                  </div>
                  <div style={{ fontSize: 16, fontWeight: 600, color: "var(--text-primary)", marginBottom: 8 }}>
                    {selectedProject.lastCrumb.title}
                  </div>
                  <div style={{ fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.6, marginBottom: 12 }}>
                    {selectedProject.lastCrumb.body}
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    <SourceBadge source={selectedProject.lastCrumb.source} />
                    <span style={{ fontSize: 11, color: "var(--text-tertiary)", fontFamily: "'JetBrains Mono', monospace" }}>
                      {formatDate(selectedProject.lastCrumb.timestamp, lang)} · {timeAgo(selectedProject.lastCrumb.timestamp, lang)}
                    </span>
                  </div>
                </div>
              )}

              <div style={{
                fontSize: 10, color: "var(--text-muted)", fontFamily: "'JetBrains Mono', monospace",
                textTransform: "uppercase", letterSpacing: "0.15em", marginBottom: 16,
              }}>
                {t("fullTimeline")} · {projectCrumbs.length} {t("crumbsInTimeline")}
              </div>
              <Timeline crumbs={projectCrumbs} projectColor={selectedProject.color} lang={lang} onToggleDone={handleToggleDone} onEditCrumb={handleEditCrumb} t={t} />
            </div>

            {/* Right: Crumb form + stats */}
            <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
              <div style={{ padding: "18px 20px", borderRadius: 10, background: "var(--bg-card)", border: "1px solid var(--border-primary)" }}>
                <CrumbForm
                  projects={projects}
                  onSubmit={handleCreateCrumb}
                  t={t}
                  defaultProjectId={selectedProject.id}
                />
              </div>

              <div style={{ padding: "18px 20px", borderRadius: 10, background: "var(--bg-card)", border: "1px solid var(--border-primary)" }}>
                <div style={{
                  fontSize: 10, color: "var(--text-muted)", fontFamily: "'JetBrains Mono', monospace",
                  textTransform: "uppercase", letterSpacing: "0.15em", marginBottom: 14,
                }}>
                  {t("sources")}
                </div>
                {Object.entries(SOURCE_META).map(([key, meta]) => {
                  const count = projectCrumbs.filter((c) => c.source === key).length;
                  return (
                    <div
                      key={key}
                      style={{
                        display: "flex", justifyContent: "space-between", alignItems: "center",
                        padding: "8px 0", borderBottom: "1px solid var(--border-subtle)",
                      }}
                    >
                      <SourceBadge source={key} compact />
                      <span
                        style={{
                          fontSize: 14, fontFamily: "'JetBrains Mono', monospace",
                          color: count > 0 ? "var(--text-secondary)" : "var(--text-muted)",
                          fontWeight: count > 0 ? 600 : 400,
                        }}
                      >
                        {count}
                      </span>
                    </div>
                  );
                })}
              </div>

              <div style={{ padding: "18px 20px", borderRadius: 10, background: "var(--bg-card)", border: "1px solid var(--border-primary)" }}>
                <FilePanel
                  files={projectFiles}
                  onCreate={handleCreateFile}
                  onUpdate={handleUpdateFile}
                  onDelete={handleDeleteFile}
                  t={t}
                />
              </div>
            </div>
          </div>
        )}
      </div>

      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap');

        [data-theme="light"] {
          --bg-primary: #F5F5F7;
          --bg-card: rgba(255,255,255,0.8);
          --bg-card-hover: rgba(255,255,255,0.95);
          --bg-inset: rgba(0,0,0,0.03);
          --bg-input: rgba(0,0,0,0.04);
          --bg-btn: rgba(0,0,0,0.08);
          --bg-btn-disabled: rgba(0,0,0,0.03);
          --text-primary: #1A1A1C;
          --text-secondary: #555;
          --text-tertiary: #777;
          --text-muted: #999;
          --border-primary: rgba(0,0,0,0.10);
          --border-hover: rgba(0,0,0,0.25);
          --border-subtle: rgba(0,0,0,0.06);
          --grid-line: rgba(0,0,0,0.04);
          --glow-color: rgba(120,184,218,0.06);
          --scrollbar-thumb: rgba(0,0,0,0.12);
          --select-bg: #fff;
          --select-color: #333;
          --placeholder-color: #aaa;
        }

        [data-theme="dark"] {
          --bg-primary: #0A0A0C;
          --bg-card: rgba(255,255,255,0.02);
          --bg-card-hover: rgba(255,255,255,0.04);
          --bg-inset: rgba(0,0,0,0.25);
          --bg-input: rgba(0,0,0,0.3);
          --bg-btn: rgba(255,255,255,0.1);
          --bg-btn-disabled: rgba(255,255,255,0.04);
          --text-primary: #E8E8E8;
          --text-secondary: #999;
          --text-tertiary: #555;
          --text-muted: #444;
          --border-primary: rgba(255,255,255,0.06);
          --border-hover: rgba(255,255,255,0.2);
          --border-subtle: rgba(255,255,255,0.04);
          --grid-line: rgba(255,255,255,0.015);
          --glow-color: rgba(120,184,218,0.04);
          --scrollbar-thumb: rgba(255,255,255,0.1);
          --select-bg: #1a1a1e;
          --select-color: #ccc;
          --placeholder-color: #444;
        }

        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }

        @keyframes fadeSlideIn {
          from { opacity: 0; transform: translateY(8px); }
          to { opacity: 1; transform: translateY(0); }
        }

        * { box-sizing: border-box; }

        select option {
          background: var(--select-bg);
          color: var(--select-color);
        }

        input::placeholder,
        textarea::placeholder {
          color: var(--placeholder-color);
        }

        ::-webkit-scrollbar { width: 5px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: var(--scrollbar-thumb); border-radius: 3px; }

        @media (max-width: 900px) {
          header h1 { font-size: 18px !important; }
        }
      `}</style>
    </div>
  );
}
