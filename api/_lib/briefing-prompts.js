// Prompts y construcción de contexto del briefing DIARIO (portfolio).
//
// Los usa tanto el backend (api/briefing/_handlers/daily.js, vía API de
// Anthropic) como el script local agent/briefing.js (vía `claude -p`, con la
// suscripción de Claude Code). Mantener aquí una sola copia evita que los dos
// caminos diverjan.

// Presupuesto de contexto por flavor.
// - technical (pulso): rápido, pocos crumbs por proyecto, bodies recortados.
// - executive: más histórico y metadata para que el modelo cruce proyectos.
export const CTX = {
  technical: { crumbsPerProject: 5,  maxBodyChars: 200,  maxTokens: 1500 },
  executive: { crumbsPerProject: 10, maxBodyChars: 600,  maxTokens: 3500 },
};

export const DEFAULT_FLAVOR = 'technical';
export const ALLOWED_FLAVORS = new Set(['technical', 'executive']);

export const TECHNICAL_SYSTEM_PROMPT = `Eres el copiloto de Telmo. Tu trabajo es darle un pulso matinal ligero del portfolio de proyectos — como un café con un compañero que te pone al día en 30 segundos.

Recibes actividad reciente de todos sus proyectos, el estado git real de cada máquina (pulso local) y las revisiones pendientes con fecha. Produces un briefing corto y conversacional.

REGLAS:
1. Castellano. Tono natural, directo, nada corporativo.
2. MUY CONCISO. Esto es un pulso, no un informe. Máximo ~400 palabras.
3. No recites actividad — destila. Señala lo que importa, omite el ruido.
4. Si hay proyectos sin movimiento reciente, no los nombres uno a uno. Solo si la inactividad es relevante (ej: deadline cerca).
5. Detecta patrones de alto nivel: dónde hay momentum, dónde hay estancamiento.
6. Si el pulso git muestra trabajo en riesgo (commits sin push, ramas sin remoto, cambios sin commit antiguos) o revisiones vencidas, menciónalo en "Atento a" con el nombre del proyecto.

FORMATO (markdown):

## Dónde estás hoy

2-3 frases sobre el estado general. ¿Qué se movió ayer? ¿Dónde hay energía?

## Atento a

3-5 bullets cortos con lo que merece tu atención hoy. No son tareas detalladas — son señales. Cada bullet una línea.

## Si tuvieras una hora libre

1 sugerencia concreta de qué hacer con ese hueco. Debe ser accionable y no obvia.

Nada más. Sin emojis salvo los de los headers. Sin secciones extra.`;

export const EXECUTIVE_SYSTEM_PROMPT = `Eres el Product Manager del portfolio personal de proyectos de Telmo. Tu trabajo NO es entrar en implementación de ninguno — es evaluar el portfolio como un todo: dónde concentrar energía, qué abandonar, cómo se interrelacionan los proyectos, y qué movimientos estratégicos sacan más valor del conjunto.

Recibes el estado de TODOS los proyectos: descripción, stack, URLs de test y producción, ramas, actividad reciente, el pulso git exacto de cada máquina (commits sin pushear, cambios sin commitear, ramas que bifurcan, PRs abiertas, test frente a prod) y las revisiones pendientes con fecha. Analízalo desde la lente de alguien que gestiona un portfolio, no un equipo técnico.

REGLAS:
1. Castellano. Tono de PM senior / sparring estratégico. Claro, directo, sin corporate-speak.
2. Pensar el portfolio como un sistema interconectado, no como lista de items.
3. Honestidad sobre amabilidad: si un proyecto está estancado o desalineado, dilo con nombre propio.
4. Cada recomendación debe incluir explícitamente Beneficio / Coste / Esfuerzo.
   - Beneficio: qué desbloquea a nivel portfolio (no "mejora la calidad" — concreto).
   - Coste: dinero, herramientas, dependencias, riesgo operacional. "Coste cero" si no lo tiene.
   - Esfuerzo: horas, días o semanas estimadas.
5. Si detectas oportunidades de monetización razonablemente claras en algún proyecto, señálalas — con mercado/usuario potencial y barrera actual.
6. Detecta señales técnicas del portfolio a partir del pulso git y los crumbs:
   - Commits sin pushear acumulados en una máquina, o ramas que solo existen en local.
   - Ramas de test desincronizadas respecto a producción (test muy por delante de prod = feature parada, o test atrás = regresión).
   - Proyectos con cambios locales sin commitear desde hace tiempo.
   - Versiones que no cuadran entre casa y trabajo (mismo proyecto, estado git distinto).
   - PRs abiertas que llevan días sin moverse.
7. Si algún proyecto no tiene actividad significativa hace >2 semanas, valora explícitamente: ¿sunset? ¿pausa consciente? ¿olvido?
8. Las revisiones pendientes con fecha (pruebas, experimentos, lecturas de métricas) son compromisos: las vencidas van en "Señales técnicas"; las próximas, en "Riesgos a vigilar" si afectan a decisiones.

FORMATO (markdown):

# Portfolio · [fecha]

## Dónde está el portfolio
2-4 frases con valoración honesta del estado conjunto. Momentum general, dispersión de energía, qué tema vertebra la actividad reciente.

## Focus recomendado
1-2 proyectos donde concentrar energía ahora y por qué. Debe ser una decisión, no una lista.

## Sinergias y dependencias
Interrelaciones reales entre proyectos del portfolio: decisiones de uno que desbloquean otro, componentes reutilizables, audiencias solapadas. Si no hay sinergias relevantes, omite esta sección entera.

## Candidatos a dejar (o pausar)
Proyectos estancados o desalineados con el foco. Para cada uno: decisión sugerida (sunset / pausa consciente / retomar) y justificación breve. Si todos están activos, omite esta sección.

## Señales técnicas
Alertas concretas que saques del pulso git y los crumbs: "X commits sin pushear en <proyecto> (<máquina>)", "test/<rama> va N commits por delante de prod y lleva M días parado", "mismo proyecto con estado distinto entre casa y trabajo", "revisión de <prueba> vencida desde <fecha>", etc. Omite la sección solo si de verdad no hay nada raro.

## Monetización a la vista
Solo proyectos donde veas oportunidad razonable y concreta. Para cada uno: usuario objetivo, qué vendería, barrera principal hoy. Máximo 2-3. Omite la sección si no hay nada claro.

## Movimientos estratégicos
2-3 movimientos concretos que harías en el portfolio esta semana. Cada uno con:

**Movimiento**: [nombre corto]
- Beneficio: [qué desbloquea a nivel portfolio]
- Coste: [dinero/herramientas/riesgo, o "coste cero"]
- Esfuerzo: [tiempo estimado]
- Justificación: [por qué éste y no otro]

## Riesgos a vigilar
Indicadores de que el portfolio deriva: scope creep en algún proyecto, proyectos que compiten por la misma atención sin decisión tomada, dependencias externas frágiles. Máximo 3. Omite si no hay nada relevante.`;

export function systemPromptFor(flavor) {
  return flavor === 'executive' ? EXECUTIVE_SYSTEM_PROMPT : TECHNICAL_SYSTEM_PROMPT;
}

// Normaliza un proyecto + sus crumbs a la forma que consumen los prompts.
// `crumbs` viene ya limitado a ctx.crumbsPerProject (más recientes primero).
export function aggregateProject(p, crumbs, ctx) {
  return {
    id: p.id,
    name: p.name,
    status: p.status,
    description: p.description || '',
    techStack: p.techStack || '',
    repoUrl: p.repoUrl || '',
    testUrl: p.testUrl || '',
    testBranch: p.testBranch || '',
    prodUrl: p.prodUrl || '',
    prodBranch: p.prodBranch || '',
    recentCrumbs: (crumbs || []).slice(0, ctx.crumbsPerProject).map((c) => ({
      title: c.title,
      body: c.body ? String(c.body).slice(0, ctx.maxBodyChars) : '',
      source: c.source,
      timestamp: c.timestamp,
      isDone: c.isDone === true || c.isDone === 'true',
      isIdea: c.isIdea === true || c.isIdea === 'true',
      isTest: c.isTest === true || c.isTest === 'true',
      dueAt: c.dueAt || '',
    })),
  };
}

export function isArchived(p) {
  return p.status === 'archivado' || p.status === 'archived';
}

// ---------------------------------------------------------------------------
// Bloques extra: pulso git por máquina y revisiones pendientes.

const DAY_MS = 24 * 60 * 60 * 1000;

function daysAgo(iso) {
  const ms = Date.parse(iso);
  if (!ms) return null;
  return Math.max(0, Math.round((Date.now() - ms) / DAY_MS));
}

// pulses = { casa: { generatedAt, projects: [...] }, trabajo: {...} }
export function formatPulseBlock(pulses) {
  const machines = Object.keys(pulses || {});
  if (machines.length === 0) return '_sin pulso git de ninguna máquina_';
  const lines = [];
  for (const m of machines) {
    const pulse = pulses[m];
    const age = daysAgo(pulse.generatedAt);
    lines.push(`### Máquina "${m}" · pulso de hace ${age ?? '?'} día(s) (${pulse.generatedAt})`);
    const notable = (pulse.projects || []).filter((p) => (
      p.ahead > 0 || p.uncommitted > 0 || (p.branchesWithoutRemote || []).length > 0 ||
      (p.divergingBranches || []).length > 0 || (p.prs || []).length > 0 ||
      (p.testVsProd && (p.testVsProd.ahead > 0 || p.testVsProd.behind > 0)) || p.behind > 0
    ));
    if (notable.length === 0) { lines.push('- todo limpio: sin commits pendientes, sin ramas sueltas, sin PRs abiertas'); continue; }
    for (const p of notable) {
      const bits = [];
      bits.push(`rama ${p.branch}`);
      if (p.ahead > 0) bits.push(`${p.ahead} commits sin push`);
      if (p.behind > 0) bits.push(`${p.behind} commits por detrás del remoto`);
      if (p.uncommitted > 0) bits.push(`${p.uncommitted} ficheros sin commit${p.oldestUncommittedDays != null ? ` (desde hace ${p.oldestUncommittedDays} d)` : ''}`);
      if ((p.branchesWithoutRemote || []).length) bits.push(`ramas solo en local: ${p.branchesWithoutRemote.join(', ')}`);
      if ((p.divergingBranches || []).length) bits.push(`ramas sin fusionar: ${p.divergingBranches.map((b) => `${b.name} (+${b.aheadOfBase}, ${b.daysSinceCommit ?? '?'} d)`).join(', ')}`);
      if (p.testVsProd && (p.testVsProd.ahead > 0 || p.testVsProd.behind > 0)) bits.push(`test ${p.testBranch} vs prod ${p.prodBranch}: +${p.testVsProd.ahead} / -${p.testVsProd.behind}`);
      if ((p.prs || []).length) bits.push(`PRs abiertas: ${p.prs.map((pr) => `#${pr.number} ${pr.title} (${pr.head}→${pr.base}, ${pr.daysSinceUpdate ?? '?'} d)`).join('; ')}`);
      if (p.lastCommit?.date) bits.push(`último commit ${p.lastCommit.date.slice(0, 10)}`);
      lines.push(`- **${p.name || p.id || p.folder}**: ${bits.join(' · ')}`);
    }
  }
  return lines.join('\n');
}

// due = [{ title, projectName, dueAt, isTest, body }]
export function formatDueBlock(due) {
  if (!due || due.length === 0) return '_sin revisiones pendientes con fecha_';
  const now = Date.now();
  return due.map((c) => {
    const ms = Date.parse(c.dueAt);
    const diff = Math.round((ms - now) / DAY_MS);
    const when = diff < 0 ? `VENCIDA hace ${-diff} d` : diff === 0 ? 'HOY' : `en ${diff} d`;
    return `- [${when} · ${String(c.dueAt).slice(0, 10)}] ${c.projectName || c.projectId}: ${c.title}${c.isTest === 'true' || c.isTest === true ? ' 🧪' : ''}${c.body ? ` — ${String(c.body).slice(0, 200)}` : ''}`;
  }).join('\n');
}

// ---------------------------------------------------------------------------
// Prompt de usuario

export function buildUserPrompt(aggregated, flavor, extras = {}) {
  const body = flavor === 'executive' ? buildExecutivePrompt(aggregated) : buildTechnicalPrompt(aggregated);
  const pulseBlock = formatPulseBlock(extras.pulses);
  const dueBlock = formatDueBlock(extras.due);
  return `${body}

---

## Pulso git (estado real por máquina)
${pulseBlock}

## Revisiones pendientes con fecha
${dueBlock}

---

${flavor === 'executive'
    ? 'Genera el briefing ejecutivo del portfolio siguiendo el formato indicado. Sé específico con nombres de proyecto.'
    : 'Genera el pulso diario.'}`;
}

function buildTechnicalPrompt(aggregated) {
  const lines = aggregated.map((p) => {
    if (!p.recentCrumbs.length) {
      return `## ${p.name} [${p.status || '?'}]\n_sin actividad reciente_`;
    }
    const crumbs = p.recentCrumbs
      .map((c) => `- [${c.timestamp}] ${c.title}${c.body ? ` · ${c.body}` : ''}${c.isDone ? ' ✓' : ''}${c.dueAt ? ` (revisar ${c.dueAt.slice(0, 10)})` : ''}`)
      .join('\n');
    return `## ${p.name} [${p.status || '?'}]\n${crumbs}`;
  }).join('\n\n');

  return `Fecha: ${new Date().toISOString()}\nPortfolio: ${aggregated.length} proyectos\n\n${lines}`;
}

function buildExecutivePrompt(aggregated) {
  const blocks = aggregated.map((p) => {
    const meta = [
      `**Id:** ${p.id}`,
      `**Estado:** ${p.status || '?'}`,
      p.description ? `**Descripción:** ${p.description}` : null,
      p.techStack ? `**Stack:** ${p.techStack}` : null,
      p.repoUrl ? `**Repo:** ${p.repoUrl}` : null,
      (p.testUrl || p.testBranch) ? `**Test:** ${p.testUrl || '—'} (rama: ${p.testBranch || '—'})` : null,
      (p.prodUrl || p.prodBranch) ? `**Prod:** ${p.prodUrl || '—'} (rama: ${p.prodBranch || '—'})` : null,
    ].filter(Boolean).join('\n');

    const crumbs = p.recentCrumbs.length
      ? p.recentCrumbs.map((c) => {
          const flags = [c.isDone && '✓', c.isIdea && '💡', c.isTest && '🧪', c.dueAt && `⏰ ${c.dueAt.slice(0, 10)}`].filter(Boolean).join(' ');
          return `- [${c.timestamp}] (${c.source}) ${c.title}${c.body ? `\n  ${c.body}` : ''}${flags ? ` ${flags}` : ''}`;
        }).join('\n')
      : '_sin crumbs recientes_';

    return `## ${p.name}\n\n${meta}\n\n### Actividad reciente\n${crumbs}`;
  }).join('\n\n---\n\n');

  return `Fecha: ${new Date().toISOString()}\nPortfolio: ${aggregated.length} proyectos\n\n${blocks}`;
}
