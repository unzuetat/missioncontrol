import { readdirSync, statSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { gitSnapshot, isGitRepo } from "./git.js";

const IGNORAR = new Set([
  "node_modules", "venv", ".git", "dist", "build", ".next",
  ".vercel", ".DS_Store", "__pycache__", ".idea", ".vscode",
]);

const FICHEROS_CLAVE = [
  "CLAUDE.md", "README.md", "README", "ROADMAP.md", "ROADMAP",
  "package.json", "requirements.txt",
];

export function escanearProyectos(rootDir) {
  const entradas = readdirSync(rootDir, { withFileTypes: true });
  const proyectos = [];
  for (const entry of entradas) {
    if (!entry.isDirectory()) continue;
    if (IGNORAR.has(entry.name) || entry.name.startsWith(".")) continue;
    const abs = join(rootDir, entry.name);
    if (!isGitRepo(abs)) continue;
    proyectos.push(analizarProyecto(entry.name, abs));
  }
  return proyectos;
}

function analizarProyecto(nombre, dir) {
  const git = gitSnapshot(dir);
  const ficheros = {};
  for (const f of FICHEROS_CLAVE) {
    const ruta = join(dir, f);
    if (existsSync(ruta) && statSync(ruta).isFile()) {
      try {
        ficheros[f] = readFileSync(ruta, "utf8");
      } catch {
        // ignorar ficheros ilegibles
      }
    }
  }
  return {
    nombre,
    dir,
    git,
    ficheros,
  };
}
