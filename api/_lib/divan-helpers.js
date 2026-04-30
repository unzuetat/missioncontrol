// api/_lib/divan-helpers.js — utilidades del Diván (think tank de MC).
//
// Centraliza:
//   - Claves Redis (modes, sessions).
//   - Presets de profundidad (Rápido / Normal / Tostón) → {ctxBudgetTokens, maxOutputTokens}.
//   - Context builder: combina contextScope + includeTransversal + projectIds[]
//     en un bloque de texto para inyectar en el user message.
//
// El gasto se contabiliza vía briefing-helpers (mismo cap mensual de $5).

import {
  keys as kvKeys,
  getProjectById,
  getProjectCrumbs,
  getProjectFiles,
  getAllProjects,
} from './kv.js';

// ---------------------------------------------------------------------------
// Claves Redis

export const divanKeys = {
  mode: (id) => `divan:mode:${id}`,
  modesList: 'divan:modes:list',
  session: (id) => `divan:session:${id}`,
  sessionsList: 'divan:sessions:list',
};

export const SESSIONS_LIMIT = 20;
export const SOFT_TURN_CAP = 20;

// ---------------------------------------------------------------------------
// Modelos LLM permitidos y mapping desde alias cortos del modo

export const ALLOWED_MODELS = new Set([
  'claude-haiku-4-5',
  'claude-sonnet-4-6',
  'claude-opus-4-7',
]);

export const MODEL_ALIAS = {
  haiku: 'claude-haiku-4-5',
  sonnet: 'claude-sonnet-4-6',
  opus: 'claude-opus-4-7',
};

export function resolveModel(value) {
  if (!value) return 'claude-sonnet-4-6';
  if (ALLOWED_MODELS.has(value)) return value;
  if (MODEL_ALIAS[value]) return MODEL_ALIAS[value];
  return 'claude-sonnet-4-6';
}

// ---------------------------------------------------------------------------
// Presets de profundidad. Cada nivel mapea a:
//   - ctxBudgetTokens: tope BLANDO del contexto inyectado. Si lo superamos,
//     el builder primero intenta resumir (CONTEXT.md por proyecto a sus
//     primeros ~2k chars, dropea la sección "actividad reciente cross") en
//     vez de hacer un slice bruto. Solo si tras la degradación seguimos por
//     encima de MAX_INPUT_TOKENS hacemos un recorte final de seguridad.
//   - maxOutputTokens: tope de la respuesta del modelo. Se respeta tal cual.
//     El límite de contexto del modelo (200k) aplica solo al input; output
//     se cobra y limita por separado, así que no se reduce dinámicamente.

// targetWords: rango orientativo que se pasa al modelo para que adapte longitud.
// maxOutputTokens: tope DURO con margen, para que el modelo casi nunca lo toque.
//   Si el cap es muy ajustado, el modelo se corta a media frase (mala UX).
//   Damos margen ~3x sobre el target medio en tokens (1 palabra ≈ 1.3 tokens ES).
export const DEPTH_PRESETS = {
  rapido: { ctxBudgetTokens: 25000, maxOutputTokens: 1500,  targetWords: '300-500' },
  normal: { ctxBudgetTokens: 80000, maxOutputTokens: 4500,  targetWords: '1000-1800' },
  toston: { ctxBudgetTokens: 160000, maxOutputTokens: 10000, targetWords: '2500-3500' },
};

export const DEPTH_LABELS = {
  rapido: 'Rápido',
  normal: 'Normal',
  toston: 'Tostón',
};

// Techo absoluto de input. Por encima de este número se hace recorte final
// de seguridad para no rebasar el contexto del modelo (200k).
export const MAX_INPUT_TOKENS = 180000;

export const DEFAULT_DEPTH = 'normal';

export function resolveDepth(value) {
  if (value && DEPTH_PRESETS[value]) return value;
  return DEFAULT_DEPTH;
}

// Estimación rough: ~3.5 chars por token en castellano / inglés mezclado.
const CHARS_PER_TOKEN = 3.5;
export const estimateTokens = (str) => Math.ceil(String(str || '').length / CHARS_PER_TOKEN);

// ---------------------------------------------------------------------------
// Validación de modos

export const ALLOWED_CONTEXT_SCOPES = new Set(['minimal', 'standard', 'full']);

export function normalizeMode(input, { id } = {}) {
  if (!input || typeof input !== 'object') {
    throw new Error('mode must be an object');
  }
  const name = String(input.name || '').trim();
  if (!name) throw new Error('mode.name required');
  const systemPrompt = String(input.systemPrompt || '').trim();
  if (!systemPrompt) throw new Error('mode.systemPrompt required');

  const contextScope = ALLOWED_CONTEXT_SCOPES.has(input.contextScope)
    ? input.contextScope
    : 'standard';
  const includeTransversal = !!input.includeTransversal;
  const model = resolveModel(input.model);
  const defaultDepth = resolveDepth(input.defaultDepth);
  const color = typeof input.color === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(input.color)
    ? input.color
    : '#888888';

  return {
    id: id || input.id || slugify(name),
    name,
    color,
    systemPrompt,
    contextScope,
    includeTransversal,
    model,
    defaultDepth,
    description: typeof input.description === 'string' ? input.description.trim() : '',
    isMeta: !!input.isMeta,
  };
}

function slugify(s) {
  return String(s)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'mode';
}

// ---------------------------------------------------------------------------
// Context builder
//
// buildDivanContext({
//   modeConfig: { contextScope, includeTransversal, ... },
//   projectIds: string[],          // proyectos seleccionados explícitamente
//   includeTransversal: boolean,   // override per-request (si no, usa el del modo)
//   depth: 'rapido'|'normal'|'toston',
// }) → { contextBlock: string, includedProjectIds: string[], truncated: bool, estimatedTokens: number }

const RECENT_CRUMBS_PER_PROJECT_FULL = 8;
const HIGHLIGHTS_PER_PROJECT = 5;
const TRANSVERSAL_RECENT_CRUMBS = 25;

export async function buildDivanContext({ modeConfig, projectIds = [], includeTransversal, depth = DEFAULT_DEPTH, kvClient }) {
  const scope = modeConfig?.contextScope || 'standard';
  const wantTransversal = typeof includeTransversal === 'boolean'
    ? includeTransversal
    : !!modeConfig?.includeTransversal;
  const preset = DEPTH_PRESETS[depth] || DEPTH_PRESETS[DEFAULT_DEPTH];

  // 1. Construir secciones a tamaño "full" del scope.
  const projectSections = [];
  const includedProjectIds = [];
  for (const pid of projectIds) {
    const project = await getProjectById(pid);
    if (!project) continue;
    includedProjectIds.push(pid);
    projectSections.push({
      project,
      block: await buildProjectBlock(project, scope, kvClient),
    });
  }

  let transversalBlock = '';
  if (wantTransversal) {
    transversalBlock = await buildTransversalBlock(kvClient);
  }

  let assembled = assemble(projectSections, transversalBlock);
  let estimated = estimateTokens(assembled);
  const degraded = [];

  // 2. Degradación progresiva si pasamos del budget blando.
  if (estimated > preset.ctxBudgetTokens && scope !== 'minimal') {
    // Paso 1: re-construir cada bloque de proyecto con scope='standard' (sin
    // crumbs ni highlights) y CONTEXT.md recortado a 4000 chars.
    for (let i = 0; i < projectSections.length; i++) {
      projectSections[i].block = await buildProjectBlock(projectSections[i].project, 'standard', kvClient, { maxContextChars: 4000 });
    }
    degraded.push('per-project: scope reducido a standard, CONTEXT.md a 4k chars');
    assembled = assemble(projectSections, transversalBlock);
    estimated = estimateTokens(assembled);
  }

  if (estimated > preset.ctxBudgetTokens) {
    // Paso 2: en lugar del CONTEXT.md, solo metadata del proyecto.
    for (let i = 0; i < projectSections.length; i++) {
      projectSections[i].block = await buildProjectBlock(projectSections[i].project, 'minimal', kvClient);
    }
    degraded.push('per-project: scope reducido a minimal (sin CONTEXT.md)');
    assembled = assemble(projectSections, transversalBlock);
    estimated = estimateTokens(assembled);
  }

  if (estimated > preset.ctxBudgetTokens && transversalBlock) {
    // Paso 3: dropear sección de actividad reciente del transversal.
    transversalBlock = stripTransversalActivity(transversalBlock);
    degraded.push('transversal: actividad reciente cross-proyecto eliminada');
    assembled = assemble(projectSections, transversalBlock);
    estimated = estimateTokens(assembled);
  }

  // 3. Recorte final de seguridad solo si seguimos por encima del techo absoluto.
  let truncated = false;
  if (estimated > MAX_INPUT_TOKENS) {
    const targetChars = Math.floor(MAX_INPUT_TOKENS * CHARS_PER_TOKEN * 0.95);
    assembled = assembled.slice(0, targetChars) + '\n\n_[contexto recortado por exceso absoluto sobre 180k tokens]_';
    estimated = estimateTokens(assembled);
    truncated = true;
    degraded.push(`recorte final a ${MAX_INPUT_TOKENS} tokens`);
  }

  let contextBlock = assembled.trim();
  if (!contextBlock) {
    contextBlock = '_(El usuario no seleccionó proyectos ni perfil transversal — responde sin contexto del portfolio, solo desde tu rol como modo.)_';
  }

  return {
    contextBlock,
    includedProjectIds,
    truncated,
    degraded,
    estimatedTokens: estimated,
  };
}

function assemble(projectSections, transversalBlock) {
  const sections = [];
  for (const ps of projectSections) {
    if (ps?.block) sections.push(ps.block);
  }
  if (transversalBlock) sections.push(transversalBlock);
  return sections.join('\n\n---\n\n').trim();
}

function stripTransversalActivity(block) {
  // Elimina la sección "## Actividad reciente cross-proyecto" y todo lo que
  // venga detrás (la sección suele ser la última del bloque transversal).
  const idx = block.indexOf('## Actividad reciente cross-proyecto');
  if (idx === -1) return block;
  return block.slice(0, idx).trim();
}

async function buildProjectBlock(project, scope, _kvClient, opts = {}) {
  const lines = [
    `# ${project.name} (${project.id})`,
    `Estado: ${project.status || '?'}`,
  ];
  if (project.description) lines.push(`Descripción: ${project.description}`);
  if (scope !== 'minimal' && project.techStack) lines.push(`Stack: ${project.techStack}`);
  if (scope !== 'minimal' && project.repoUrl) lines.push(`Repo: ${project.repoUrl}`);

  if (scope === 'minimal') {
    return lines.join('\n');
  }

  // standard y full: añadir CONTEXT.md
  const files = await getProjectFiles(project.id);
  const contextFile = files.find((f) => f.name === 'CONTEXT.md');
  if (contextFile?.content) {
    const maxChars = opts.maxContextChars ?? (scope === 'full' ? 12000 : 6000);
    const ctx = String(contextFile.content).slice(0, maxChars);
    lines.push('', '## CONTEXT.md', ctx);
  }

  if (scope === 'full') {
    const crumbs = await getProjectCrumbs(project.id, RECENT_CRUMBS_PER_PROJECT_FULL);
    if (crumbs.length) {
      lines.push('', '## Crumbs recientes');
      for (const c of crumbs) {
        const body = c.body ? ` · ${String(c.body).slice(0, 240)}` : '';
        lines.push(`- [${c.timestamp}] ${c.title}${body}`);
      }
    }

    // Highlights de ese proyecto (si los hubiera).
    const projectHighlights = await loadProjectHighlights(project.id, HIGHLIGHTS_PER_PROJECT, _kvClient);
    if (projectHighlights.length) {
      lines.push('', '## Subrayados del proyecto');
      for (const h of projectHighlights) {
        lines.push(`- "${h.text.slice(0, 240)}"${h.comment ? ` (nota: ${h.comment.slice(0, 120)})` : ''}`);
      }
    }
  }

  return lines.join('\n');
}

async function loadProjectHighlights(projectId, limit, kvClient) {
  if (!kvClient) return [];
  try {
    const listKey = `briefing:project:${projectId}:list`;
    const items = await kvClient.lRange(listKey, 0, 9);
    if (!items.length) return [];
    const briefings = items.map(safeParse).filter(Boolean);
    const annKeys = briefings.map((b) => `briefing:annotations:${b.generatedAt}`);
    const annRaw = await kvClient.mGet(annKeys);
    const out = [];
    briefings.forEach((b, i) => {
      const raw = annRaw[i];
      if (!raw) return;
      const ann = safeParse(raw);
      if (!ann) return;
      for (const a of Object.values(ann.blocks || {})) {
        if (a?.highlight && a?.text) {
          out.push({ text: a.text, comment: a.comment || null });
          if (out.length >= limit) return;
        }
      }
    });
    return out.slice(0, limit);
  } catch {
    return [];
  }
}

async function buildTransversalBlock(kvClient) {
  const lines = ['# Perfil transversal del portfolio'];

  const projects = await getAllProjects();
  const active = projects.filter((p) => p.status !== 'archivado' && p.status !== 'archived');

  lines.push('', '## Proyectos activos');
  for (const p of active) {
    const desc = p.description ? `: ${p.description}` : '';
    lines.push(`- **${p.name}** [${p.status || '?'}]${desc}`);
  }

  // Subrayados del daily (cross-portfolio) — los más recientes.
  if (kvClient) {
    try {
      const items = await kvClient.lRange('briefing:daily:list', 0, 9);
      if (items.length) {
        const briefings = items.map(safeParse).filter(Boolean);
        const annKeys = briefings.map((b) => `briefing:annotations:${b.generatedAt}`);
        const annRaw = await kvClient.mGet(annKeys);
        const portfolioHighlights = [];
        briefings.forEach((b, i) => {
          const raw = annRaw[i];
          if (!raw) return;
          const ann = safeParse(raw);
          if (!ann) return;
          for (const a of Object.values(ann.blocks || {})) {
            if (a?.highlight && a?.text) {
              portfolioHighlights.push(a.text);
              if (portfolioHighlights.length >= 12) return;
            }
          }
        });
        if (portfolioHighlights.length) {
          lines.push('', '## Subrayados recientes del portfolio');
          for (const h of portfolioHighlights) {
            lines.push(`- "${String(h).slice(0, 240)}"`);
          }
        }
      }
    } catch { /* noop */ }

    // Crumbs recientes cross.
    try {
      const crumbIds = await kvClient.zRange(kvKeys.recentCrumbs, 0, TRANSVERSAL_RECENT_CRUMBS - 1, { REV: true });
      const crumbs = [];
      for (const id of crumbIds || []) {
        const data = await kvClient.hGetAll(kvKeys.crumb(id));
        if (data && Object.keys(data).length) crumbs.push({ id, ...data });
      }
      if (crumbs.length) {
        lines.push('', '## Actividad reciente cross-proyecto');
        for (const c of crumbs) {
          lines.push(`- [${c.timestamp}] (${c.projectId}) ${c.title}`);
        }
      }
    } catch { /* noop */ }
  }

  return lines.join('\n');
}

function safeParse(raw) {
  try { return JSON.parse(raw); } catch { return null; }
}
