// Fusión por secciones del CONTEXT.md.
//
// El modelo NO reescribe el fichero entero: envía un patch con solo las
// secciones que cambian, y aquí se fusiona con el CONTEXT.md actual de MC.
//
//   patch = {
//     "Estado actual — pendiente": "texto completo nuevo",            // replace
//     "Estado actual — funciona": { "append": "- nueva línea" },      // añade al final
//     "Decisiones importantes":   { "prepend": "- ..." },             // añade al principio
//     "Sección nueva": "…"                                             // se crea al final
//   }
//
// Las secciones son bloques `## Título`. El match de títulos es
// case-insensitive y normaliza guiones (—, –, -) y espacios.

const H2 = /^## +(.+?)\s*$/;

export function normalizeTitle(t) {
  return String(t || "")
    .toLowerCase()
    .replace(/[—–]/g, "-")
    .replace(/\s+/g, " ")
    .replace(/\s*-\s*/g, " - ")
    .trim();
}

export function parseSections(md) {
  const lines = String(md || "").replace(/\r\n/g, "\n").split("\n");
  const out = { preamble: [], sections: [] };
  let cur = null;
  for (const line of lines) {
    const m = H2.exec(line);
    if (m) { cur = { title: m[1].trim(), lines: [] }; out.sections.push(cur); continue; }
    (cur ? cur.lines : out.preamble).push(line);
  }
  return out;
}

export function renderSections(doc) {
  const parts = [];
  const pre = doc.preamble.join("\n").replace(/\s+$/, "");
  if (pre) parts.push(pre);
  for (const s of doc.sections) {
    const body = s.lines.join("\n").replace(/^\n+/, "").replace(/\s+$/, "");
    parts.push(`## ${s.title}\n\n${body}`);
  }
  return parts.join("\n\n") + "\n";
}

export function getSection(md, title) {
  const doc = parseSections(md);
  const key = normalizeTitle(title);
  const s = doc.sections.find((x) => normalizeTitle(x.title) === key);
  return s ? s.lines.join("\n").trim() : null;
}

export function listSections(md) {
  return parseSections(md).sections.map((s) => ({ title: s.title, chars: s.lines.join("\n").trim().length }));
}

/**
 * Aplica el patch. Devuelve { md, applied: [titles], created: [titles] }.
 * `options.snapshot`: texto para la línea "> Snapshot: …" del preámbulo (se sustituye o se crea).
 * `options.gitSection`: { title, body } → sustituye cualquier "## Git a …" (o lo crea al final).
 */
export function applyPatch(md, patch = {}, options = {}) {
  const doc = parseSections(md);
  const applied = [];
  const created = [];

  for (const [title, op] of Object.entries(patch || {})) {
    const key = normalizeTitle(title);
    let s = doc.sections.find((x) => normalizeTitle(x.title) === key);
    const spec = typeof op === "string" ? { replace: op } : (op || {});
    if (!s) {
      s = { title: title.trim(), lines: [] };
      doc.sections.push(s);
      created.push(s.title);
    } else {
      applied.push(s.title);
    }
    if (spec.replace !== undefined) s.lines = String(spec.replace).trim().split("\n");
    if (spec.append) s.lines = [...s.lines.join("\n").trimEnd().split("\n"), ...String(spec.append).trim().split("\n")];
    if (spec.prepend) s.lines = [...String(spec.prepend).trim().split("\n"), ...s.lines.join("\n").replace(/^\n+/, "").split("\n")];
  }

  if (options.snapshot) {
    const idx = doc.preamble.findIndex((l) => /^>\s*Snapshot:/i.test(l));
    const line = `> Snapshot: ${options.snapshot}`;
    if (idx >= 0) doc.preamble[idx] = line;
    else {
      // tras el título H1 si existe, si no al principio
      const h1 = doc.preamble.findIndex((l) => /^# /.test(l));
      doc.preamble.splice(h1 >= 0 ? h1 + 1 : 0, 0, "", line);
    }
  }

  if (options.gitSection) {
    const { title, body } = options.gitSection;
    const idx = doc.sections.findIndex((x) => /^git a /i.test(x.title.trim()));
    const sec = { title, lines: String(body).trim().split("\n") };
    if (idx >= 0) doc.sections[idx] = sec; else doc.sections.push(sec);
  }

  return { md: renderSections(doc), applied, created };
}
