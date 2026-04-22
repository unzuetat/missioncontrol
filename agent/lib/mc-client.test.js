import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { McClient, normalizarRepoUrl } from "./mc-client.js";

describe("normalizarRepoUrl", () => {
  it("iguala variantes del mismo repo", () => {
    const refs = [
      "https://github.com/unzuetat/missioncontrol.git",
      "https://github.com/unzuetat/missioncontrol",
      "http://github.com/unzuetat/missioncontrol.git",
      "https://www.github.com/unzuetat/missioncontrol.git",
      "https://github.com/unzuetat/missioncontrol.git/",
      "  https://github.com/UnZuetaT/Missioncontrol.git  ",
    ].map(normalizarRepoUrl);
    const esperado = "github.com/unzuetat/missioncontrol";
    for (const r of refs) assert.equal(r, esperado);
  });

  it("devuelve vacío para strings vacíos/nulos", () => {
    assert.equal(normalizarRepoUrl(""), "");
    assert.equal(normalizarRepoUrl(null), "");
    assert.equal(normalizarRepoUrl(undefined), "");
  });
});

function conMockProyectos(proyectosMock) {
  const creados = [];
  const mc = new McClient({ baseUrl: "https://x", apiKey: "k" });
  mc.listarProyectos = async () => proyectosMock;
  mc.crearProyecto = async (data) => {
    creados.push(data);
    return { id: data.name.toLowerCase().replace(/[^a-z0-9]+/g, "-"), ...data };
  };
  return { mc, creados };
}

describe("asegurarProyecto", () => {
  const existentes = [
    {
      id: "mission-control",
      name: "Mission Control",
      repoUrl: "https://github.com/unzuetat/missioncontrol",
    },
    {
      id: "sonora-xi",
      name: "Sonora XI",
      repoUrl: "https://github.com/unzuetat/sonora-xi.git",
    },
    { id: "portfolio", name: "Portfolio", repoUrl: "" },
  ];

  it("el caso del bug: carpeta Missioncontrol matchea mission-control por repoUrl", async () => {
    const { mc, creados } = conMockProyectos(existentes);
    const id = await mc.asegurarProyecto({
      nombre: "Missioncontrol",
      repoUrl: "https://github.com/unzuetat/missioncontrol.git",
    });
    assert.equal(id, "mission-control");
    assert.equal(creados.length, 0, "no debería crear nada");
  });

  it("cae al match por slug si no hay repoUrl", async () => {
    const { mc, creados } = conMockProyectos(existentes);
    const id = await mc.asegurarProyecto({ nombre: "Portfolio", repoUrl: "" });
    assert.equal(id, "portfolio");
    assert.equal(creados.length, 0);
  });

  it("crea nuevo si no matchea ni por repoUrl ni por slug", async () => {
    const { mc, creados } = conMockProyectos(existentes);
    const id = await mc.asegurarProyecto({
      nombre: "Proyecto Nuevo",
      repoUrl: "https://github.com/unzuetat/proyecto-nuevo.git",
    });
    assert.equal(id, "proyecto-nuevo");
    assert.equal(creados.length, 1);
    assert.equal(creados[0].name, "Proyecto Nuevo");
  });

  it("no confunde proyectos distintos con repoUrl vacío", async () => {
    const { mc, creados } = conMockProyectos(existentes);
    const id = await mc.asegurarProyecto({ nombre: "Sin Repo", repoUrl: "" });
    assert.equal(creados.length, 1, "debe crear, no matchear contra Portfolio vacío");
    assert.equal(id, "sin-repo");
  });
});
