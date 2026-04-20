#!/usr/bin/env node
/**
 * Agente local de Mission Control.
 *
 * Escanea los proyectos de ~/Projects/ (o el directorio configurado),
 * extrae su estado git y ficheros clave (CLAUDE.md, README, ROADMAP),
 * y los empuja al backend de Mission Control en Vercel.
 *
 * Ejecutar con: npm run sync
 *
 * Requiere en .env.local:
 *   MC_API_URL   - URL del backend (p.ej. https://missioncontrol-xxx.vercel.app)
 *   MC_API_KEY   - secreto compartido con el backend (var de entorno en Vercel)
 *   MACHINE_ID   - identificador de esta máquina (p.ej. "casa", "trabajo")
 *   PROJECTS_DIR - carpeta a escanear (opcional; por defecto ~/Projects)
 */

import "dotenv/config";
import { homedir } from "node:os";
import { join } from "node:path";

import { escanearProyectos } from "./lib/scanner.js";
import { McClient } from "./lib/mc-client.js";

const MC_API_URL = process.env.MC_API_URL;
const MC_API_KEY = process.env.MC_API_KEY;
const MACHINE_ID = process.env.MACHINE_ID || "desconocida";
const PROJECTS_DIR = process.env.PROJECTS_DIR || join(homedir(), "Projects");

if (!MC_API_URL || !MC_API_KEY) {
  console.error("Faltan MC_API_URL o MC_API_KEY en .env.local. Copia agent/.env.example a .env.local y rellénalo.");
  process.exit(1);
}

const mc = new McClient({ baseUrl: MC_API_URL, apiKey: MC_API_KEY });

function sintetizarTitulo(p) {
  const g = p.git;
  if (!g) return `${p.nombre}: sin git`;
  const partes = [];
  partes.push(`rama ${g.branch}`);
  if (g.ficherosModificados > 0) partes.push(`${g.ficherosModificados} cambios locales`);
  if (g.commitsNoPusheados > 0) partes.push(`${g.commitsNoPusheados} commits sin pushear`);
  if (partes.length === 1 && g.lastCommit.hash) partes.push(`último ${g.lastCommit.hash}`);
  return partes.join(" · ");
}

function sintetizarBody(p) {
  const g = p.git;
  if (!g) return "";
  const bloques = [];
  if (g.lastCommit.hash) {
    bloques.push(
      `Último commit:\n  ${g.lastCommit.hash} · ${g.lastCommit.date}\n  ${g.lastCommit.subject}\n  por ${g.lastCommit.author}`
    );
  }
  if (g.logReciente) {
    bloques.push(`Últimos 5 commits:\n${g.logReciente.split("\n").map((l) => "  " + l).join("\n")}`);
  }
  if (g.diffPorcelain) {
    bloques.push(`Cambios locales sin commitear:\n${g.diffPorcelain.split("\n").map((l) => "  " + l).join("\n")}`);
  }
  if (g.remoteUrl) {
    bloques.push(`Remoto: ${g.remoteUrl}`);
  }
  bloques.push(`Máquina: ${MACHINE_ID} · ${p.dir}`);
  return bloques.join("\n\n");
}

async function sincronizarProyecto(p) {
  // 1. Asegurar que el proyecto existe en MC.
  const id = await mc.asegurarProyecto({
    nombre: p.nombre,
    repoUrl: p.git?.remoteUrl || "",
  });

  // 2. Crear un crumb con el snapshot actual.
  await mc.crearCrumb({
    projectId: id,
    title: sintetizarTitulo(p),
    source: `agent:${MACHINE_ID}`,
    body: sintetizarBody(p),
    timestamp: new Date().toISOString(),
  });

  // 3. Subir ficheros clave (CLAUDE.md, README, ROADMAP, etc.) como files
  // con nombre prefijado por máquina para no pisar entre casa y trabajo.
  const existentes = await mc.ficherosDeProyecto(id);
  for (const [nombreBase, contenido] of Object.entries(p.ficheros)) {
    const nombreConMaquina = `[${MACHINE_ID}] ${nombreBase}`;
    const existente = existentes.find((f) => f.name === nombreConMaquina);
    if (existente) {
      if (existente.content !== contenido) {
        await mc.actualizarFile({ fileId: existente.id, content: contenido });
      }
    } else {
      await mc.crearFile({ projectId: id, name: nombreConMaquina, content: contenido });
    }
  }

  return id;
}

async function main() {
  console.log(`[${new Date().toISOString()}] Sync desde ${MACHINE_ID}`);
  console.log(`  Escaneando ${PROJECTS_DIR}`);
  console.log(`  Backend: ${MC_API_URL}\n`);

  const proyectos = escanearProyectos(PROJECTS_DIR);
  console.log(`Encontrados ${proyectos.length} proyecto(s) git:\n`);

  let ok = 0, fallos = 0;
  for (const p of proyectos) {
    process.stdout.write(`  · ${p.nombre} ... `);
    try {
      await sincronizarProyecto(p);
      console.log("ok");
      ok++;
    } catch (err) {
      console.log(`FALLO: ${err.message}`);
      fallos++;
    }
  }

  console.log(`\n${ok} sincronizados · ${fallos} fallos`);
  process.exit(fallos > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("Error fatal:", err);
  process.exit(1);
});
