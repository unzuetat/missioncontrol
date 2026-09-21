// node --test agent/lib/   (o `npm test`)
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { applyPatch, getSection, listSections, normalizeTitle } from "./context-md.js";

const MD = `# Demo — CONTEXT.md

> Snapshot: 2026-01-01 · máquina x

## Qué es

Una app.

## Estado actual — funciona

- a
- b

## Estado actual — pendiente

1. uno
2. dos

## Git a 2026-01-01

- rama main
`;

describe("context-md", () => {
  it("normaliza títulos con guiones y espacios", () => {
    assert.equal(normalizeTitle("Estado actual — pendiente"), normalizeTitle("estado actual - pendiente"));
    assert.equal(normalizeTitle("Estado actual – pendiente"), normalizeTitle("Estado  actual — pendiente"));
  });

  it("lista secciones y lee una", () => {
    assert.deepEqual(listSections(MD).map((s) => s.title), ["Qué es", "Estado actual — funciona", "Estado actual — pendiente", "Git a 2026-01-01"]);
    assert.equal(getSection(MD, "estado actual - pendiente"), "1. uno\n2. dos");
  });

  it("es idempotente sin patch", () => {
    assert.equal(applyPatch(MD, {}).md, MD);
  });

  it("replace, append, prepend y creación de sección", () => {
    const { md, applied, created } = applyPatch(MD, {
      "Estado actual — pendiente": "1. solo uno",
      "Estado actual - funciona": { append: "- c" },
      "Qué es": { prepend: "Nota previa." },
      "Nueva": "contenido",
    });
    assert.deepEqual(applied.sort(), ["Estado actual — funciona", "Estado actual — pendiente", "Qué es"].sort());
    assert.deepEqual(created, ["Nueva"]);
    assert.equal(getSection(md, "Estado actual — pendiente"), "1. solo uno");
    assert.equal(getSection(md, "Estado actual — funciona"), "- a\n- b\n- c");
    assert.equal(getSection(md, "Qué es"), "Nota previa.\nUna app.");
    assert.equal(getSection(md, "Nueva"), "contenido");
  });

  it("actualiza el snapshot y sustituye la sección Git a <fecha>", () => {
    const { md } = applyPatch(MD, {}, { snapshot: "2026-09-21 · máquina casa", gitSection: { title: "Git a 2026-09-21", body: "- rama dev" } });
    assert.match(md, /^> Snapshot: 2026-09-21 · máquina casa$/m);
    assert.equal(listSections(md).filter((s) => /^Git a/.test(s.title)).length, 1);
    assert.equal(getSection(md, "Git a 2026-09-21"), "- rama dev");
    assert.equal(getSection(md, "Git a 2026-01-01"), null);
  });

  it("crea el snapshot si no existía", () => {
    const { md } = applyPatch("# X\n\n## Qué es\n\nhola\n", {}, { snapshot: "hoy" });
    assert.match(md, /^# X\n\n> Snapshot: hoy/);
  });
});
