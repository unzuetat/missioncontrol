#!/usr/bin/env node
// scripts/setup-claude.mjs
//
// One-shot onboarding para que Claude Code vea Mission Control en esta máquina:
// 1. Copia commands/*.md → ~/.claude/commands/
// 2. Lee MC_API_KEY de agent/.env.local
// 3. Registra (o actualiza) el MCP server "missioncontrol" en ~/.claude.json
//    apuntando al index.js de este clone del repo
//
// Uso: npm run setup-claude
// Requiere: Node >= 20, agent/.env.local con MC_API_KEY, mcp-server/ instalado.

import { readFileSync, writeFileSync, mkdirSync, copyFileSync, readdirSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
const COMMANDS_SRC = join(REPO_ROOT, 'commands');
const MCP_SERVER_ENTRY = join(REPO_ROOT, 'mcp-server', 'index.js');
const ENV_FILE = join(REPO_ROOT, 'agent', '.env.local');

const CLAUDE_DIR = join(homedir(), '.claude');
const COMMANDS_DEST = join(CLAUDE_DIR, 'commands');
const CLAUDE_JSON = join(homedir(), '.claude.json');

function log(msg) { console.log(msg); }
function fail(msg) { console.error(`\n❌ ${msg}\n`); process.exit(1); }

function parseEnvFile(path) {
  if (!existsSync(path)) return null;
  const out = {};
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    out[key] = val;
  }
  return out;
}

// ─── Paso 1: copiar slash commands ──────────────────────────────────────────

if (!existsSync(COMMANDS_SRC)) {
  fail(`No encuentro ${COMMANDS_SRC}. ¿Estás en el repo correcto?`);
}

mkdirSync(COMMANDS_DEST, { recursive: true });

const mdFiles = readdirSync(COMMANDS_SRC).filter((f) => f.endsWith('.md'));
if (mdFiles.length === 0) {
  log(`⚠  No hay archivos .md en ${COMMANDS_SRC} — nada que copiar.`);
} else {
  for (const name of mdFiles) {
    copyFileSync(join(COMMANDS_SRC, name), join(COMMANDS_DEST, name));
    log(`✓ command: ${name} → ${COMMANDS_DEST}`);
  }
}

// ─── Paso 2: leer MC_API_KEY ────────────────────────────────────────────────

const env = parseEnvFile(ENV_FILE);
if (!env) {
  fail(`Falta ${ENV_FILE}.\nCopia agent/.env.example a agent/.env.local y rellena MC_API_KEY antes de seguir.`);
}
const MC_API_KEY = env.MC_API_KEY;
const MC_API_URL = env.MC_API_URL || 'https://missioncontrol-coral.vercel.app';
if (!MC_API_KEY) {
  fail(`${ENV_FILE} no tiene MC_API_KEY.`);
}

// ─── Paso 3: registrar MCP en ~/.claude.json ────────────────────────────────

if (!existsSync(MCP_SERVER_ENTRY)) {
  fail(`No encuentro ${MCP_SERVER_ENTRY}. Ejecuta \`cd mcp-server && npm install\` primero.`);
}

let cfg = {};
if (existsSync(CLAUDE_JSON)) {
  try {
    cfg = JSON.parse(readFileSync(CLAUDE_JSON, 'utf8'));
  } catch (err) {
    fail(`${CLAUDE_JSON} no es JSON válido: ${err.message}`);
  }
}

cfg.mcpServers = cfg.mcpServers || {};
const prev = cfg.mcpServers.missioncontrol;
cfg.mcpServers.missioncontrol = {
  command: 'node',
  args: [MCP_SERVER_ENTRY],
  env: { MC_API_URL, MC_API_KEY },
};

writeFileSync(CLAUDE_JSON, JSON.stringify(cfg, null, 2) + '\n');
log(`✓ mcp: missioncontrol ${prev ? 'actualizado' : 'registrado'} en ${CLAUDE_JSON}`);
log(`     → node ${MCP_SERVER_ENTRY}`);

// ─── Resumen ────────────────────────────────────────────────────────────────

log(`\n✅ Setup Claude completado.`);
log(`\nSiguiente paso:  reinicia Claude Code. En la nueva sesión:`);
log(`  · /mcp               → missioncontrol debe aparecer "connected"`);
log(`  · /import-mc         → carga contexto del proyecto del cwd`);
log(`  · /export-mc         → exporta sesión al cerrar`);
