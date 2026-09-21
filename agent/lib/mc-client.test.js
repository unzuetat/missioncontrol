// node --test agent/lib/   (o `npm test`)
// Portado de la PR #13 (abril 2026): asegurarProyecto no debe crear duplicados
// cuando la carpeta local se llama distinto que el proyecto en MC.

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { McClient, normalizeRepoUrl } from "./mc-client.js";

describe("normalizeRepoUrl", () => {
  it("iguala variantes del mismo repo", () => {
    const esperado = "github.com/unzuetat/missioncontrol";
    for (const u of [
      "https://github.com/unzuetat/missioncontrol.git",
      "https://github.com/unzuetat/missioncontrol",
      "http://github.com/unzuetat/missioncontrol.git",
      "https://www.github.com/unzuetat/missioncontrol.git",
      "https://github.com/unzuetat/missioncontrol.git/",
      "  https://github.com/UnZuetaT/Missioncontrol.git  ",
      "git@github.com:unzuetat/missioncontrol.git",
    ]) assert.equal(normalizeRepoUrl(u), esperado, u);
  });

  it("devuelve vacío para strings vacíos o nulos", () => {
    assert.equal(normalizeRepoUrl(""), "");
    assert.equal(normalizeRepoUrl(null), "");
    assert.equal(normalizeRepoUrl(undefined), "");
  });
});

function conMock(proyectos) {
  const creados = [];
  const mc = new McClient({ baseUrl: "https://x", apiKey: "k" });
  mc.listarProyectosBare = async () => proyectos;
  mc.crearProyecto = async (data) => {
    creados.push(data);
    return { id: data.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, ""), ...data };
  };
  return { mc, creados };
}

describe("asegurarProyecto", () => {
  const existentes = [
    { id: "delirantes", name: "Delirantes", repoUrl: "https://github.com/unzuetat/dlirium", status: "produccion" },
    { id: "pirlo", name: "Pirlo", repoUrl: "https://github.com/unzuetat/pirlo", status: "archived" },
    { id: "perfil-profesional", name: "Perfil profesional", repoUrl: "", status: "active" },
  ];

  it("encuentra por repoUrl aunque la carpeta se llame distinto (dlirium → delirantes)", async () => {
    const { mc, creados } = conMock(existentes);
    const id = await mc.asegurarProyecto({ nombre: "dlirium", repoUrl: "https://github.com/unzuetat/dlirium.git" });
    assert.equal(id, "delirantes");
    assert.equal(creados.length, 0);
  });

  it("no duplica un proyecto archivado", async () => {
    const { mc, creados } = conMock(existentes);
    assert.equal(await mc.asegurarProyecto({ nombre: "pirlo", repoUrl: "git@github.com:unzuetat/pirlo.git" }), "pirlo");
    assert.equal(creados.length, 0);
  });

  it("sin remoto, cae al slug del nombre", async () => {
    const { mc, creados } = conMock(existentes);
    assert.equal(await mc.asegurarProyecto({ nombre: "Perfil profesional", repoUrl: "" }), "perfil-profesional");
    assert.equal(creados.length, 0);
  });

  it("crea el proyecto cuando no hay match por repoUrl ni por slug", async () => {
    const { mc, creados } = conMock(existentes);
    const id = await mc.asegurarProyecto({ nombre: "storycloud", repoUrl: "https://github.com/unzuetat/storycloud", techStack: "Next.js" });
    assert.equal(id, "storycloud");
    assert.equal(creados.length, 1);
    assert.equal(creados[0].repoUrl, "https://github.com/unzuetat/storycloud");
    assert.equal(creados[0].status, "desarrollo");
  });

  it("si la repoUrl no coincide pero el slug sí, reutiliza el existente", async () => {
    const { mc, creados } = conMock([{ id: "pirlo", name: "Pirlo", repoUrl: "https://github.com/otro/pirlo", status: "active" }]);
    assert.equal(await mc.asegurarProyecto({ nombre: "Pirlo", repoUrl: "https://github.com/unzuetat/pirlo" }), "pirlo");
    assert.equal(creados.length, 0);
  });
});
