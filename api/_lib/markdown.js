// api/_lib/markdown.js — utilidades de parseo de markdown compartidas entre handlers.

/** Normaliza header `##` para comparar: lowercase, trim, em-dash → guión normal. */
export function normHeader(h) {
  return h.toLowerCase().trim().replace(/—/g, '-').replace(/\s+/g, ' ');
}

/**
 * Extrae solo las secciones `## ...` cuyo título matchee `wanted` (case-insensitive,
 * normaliza guiones). Devuelve `{content, availableSections}`.
 * Si `wanted` está vacío o es null, devuelve el contenido completo intacto.
 */
export function extractSections(content, wanted) {
  if (!wanted || wanted.length === 0) {
    return { content, availableSections: listSections(content) };
  }
  const wantedSet = new Set(wanted.map(normHeader));
  const lines = content.split('\n');
  const out = [];
  const available = [];
  let include = false;

  for (const line of lines) {
    const m = line.match(/^##\s+(.+?)\s*$/);
    if (m && !line.startsWith('### ')) {
      const title = m[1];
      available.push(title);
      include = wantedSet.has(normHeader(title));
      if (include) out.push(line);
    } else if (include) {
      out.push(line);
    }
  }

  return { content: out.join('\n').trim(), availableSections: available };
}

/** Lista todos los headers `##` (no `###`) presentes en el contenido. */
export function listSections(content) {
  const out = [];
  for (const line of content.split('\n')) {
    const m = line.match(/^##\s+(.+?)\s*$/);
    if (m && !line.startsWith('### ')) out.push(m[1]);
  }
  return out;
}
