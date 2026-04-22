#!/usr/bin/env node
// Mission Control MCP server.
//
// Expone el backend de MC (en Vercel) como herramientas nativas para
// cualquier sesión de Claude. Tools de ESCRITURA (export) y LECTURA (pull
// desde cualquier proyecto) para que MC funcione como piedra angular.
//
// Arranque: node index.js  (stdio transport)
// Variables requeridas: MC_API_URL, MC_API_KEY

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

const MC_API_URL = process.env.MC_API_URL;
const MC_API_KEY = process.env.MC_API_KEY;

if (!MC_API_URL || !MC_API_KEY) {
  console.error('[mc-mcp] Faltan MC_API_URL o MC_API_KEY en el entorno.');
  process.exit(1);
}

async function mcFetch(path, { method = 'GET', body, query } = {}) {
  const url = new URL(path, MC_API_URL);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null) url.searchParams.set(k, v);
    }
  }
  const res = await fetch(url, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': MC_API_KEY,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) {
    const detail = typeof data === 'object' ? JSON.stringify(data) : data;
    throw new Error(`MC API ${method} ${url.pathname} → ${res.status}: ${detail}`);
  }
  return data;
}

function ok(data) {
  return {
    content: [{ type: 'text', text: typeof data === 'string' ? data : JSON.stringify(data, null, 2) }],
  };
}

function fail(err) {
  return {
    isError: true,
    content: [{ type: 'text', text: err?.message || String(err) }],
  };
}

const tools = [
  // ───── LECTURA (pull desde cualquier Claude) ─────
  {
    name: 'mc_list_projects',
    description: 'Lista todos los proyectos de Mission Control con sus URLs, ramas y último crumb. Usar para descubrir el projectId correcto al exportar una sesión o para ver qué está en marcha.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    handler: async () => ok(await mcFetch('/api/projects')),
  },
  {
    name: 'mc_get_project',
    description: 'Detalle completo de un proyecto por id: metadatos + últimos crumbs + archivos. Útil para "recuperar contexto" de un proyecto al entrar en él.',
    inputSchema: {
      type: 'object',
      properties: { projectId: { type: 'string', description: 'ID del proyecto, ej. "mission-control"' } },
      required: ['projectId'],
    },
    handler: async ({ projectId }) => {
      const [projects, crumbs, files] = await Promise.all([
        mcFetch('/api/projects'),
        mcFetch('/api/crumbs', { query: { projectId } }),
        mcFetch('/api/files', { query: { projectId } }),
      ]);
      const project = (projects.projects || []).find((p) => p.id === projectId);
      if (!project) throw new Error(`Project '${projectId}' no encontrado`);
      return ok({ project, crumbs: crumbs.crumbs || [], files: files.files || [] });
    },
  },
  {
    name: 'mc_get_crumbs',
    description: 'Crumbs (notas de actividad) recientes. Sin projectId: últimos 20 globales. Con projectId: todos los del proyecto ordenados por fecha desc.',
    inputSchema: {
      type: 'object',
      properties: { projectId: { type: 'string', description: 'Opcional. Si se omite, devuelve los 20 crumbs más recientes de todos los proyectos.' } },
    },
    handler: async ({ projectId } = {}) => ok(await mcFetch('/api/crumbs', { query: projectId ? { projectId } : {} })),
  },
  {
    name: 'mc_get_files',
    description: 'Archivos asociados a un proyecto (CONTEXT.md, DEPLOY_STATUS.md, etc.) con su contenido.',
    inputSchema: {
      type: 'object',
      properties: { projectId: { type: 'string' } },
      required: ['projectId'],
    },
    handler: async ({ projectId }) => ok(await mcFetch('/api/files', { query: { projectId } })),
  },
  {
    name: 'mc_get_file',
    description: 'Contenido de un archivo concreto por projectId + nombre. Atajo cómodo para leer CONTEXT.md o DEPLOY_STATUS.md de un proyecto sin filtrar el listado.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string' },
        name: { type: 'string', description: 'Nombre exacto del archivo, ej. "CONTEXT.md"' },
      },
      required: ['projectId', 'name'],
    },
    handler: async ({ projectId, name }) => {
      const { files = [] } = await mcFetch('/api/files', { query: { projectId } });
      const file = files.find((f) => f.name === name);
      if (!file) throw new Error(`Archivo '${name}' no encontrado en proyecto '${projectId}'`);
      return ok(file);
    },
  },
  {
    name: 'mc_get_briefing_history',
    description: 'Últimos briefings (hasta 10) de un tipo dado. kind="daily" para el pulso diario global, kind="project" + projectId para briefings de un proyecto (técnicos y ejecutivos mezclados).',
    inputSchema: {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: ['daily', 'project'] },
        projectId: { type: 'string', description: 'Requerido si kind="project".' },
      },
      required: ['kind'],
    },
    handler: async ({ kind, projectId }) => ok(await mcFetch('/api/briefing/history', { query: { kind, projectId } })),
  },
  {
    name: 'mc_get_highlights',
    description: 'Subrayados (bloques marcados como importantes en briefings). Sin projectId: agregados por proyecto. Con projectId: solo los de ese proyecto. Usar para saber qué hay pendiente de retomar.',
    inputSchema: {
      type: 'object',
      properties: { projectId: { type: 'string', description: 'Opcional. Omitir para vista global.' } },
    },
    handler: async ({ projectId } = {}) => ok(await mcFetch('/api/briefing/highlights', { query: projectId ? { projectId } : {} })),
  },

  // ───── ESCRITURA (export de sesión) ─────
  {
    name: 'mc_create_project',
    description: 'Crea un proyecto nuevo en Mission Control. Usar solo si mc_list_projects confirma que no existe ya.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        description: { type: 'string' },
        status: { type: 'string', enum: ['idea', 'desarrollo', 'produccion', 'pausado', 'archivado'], default: 'desarrollo' },
        color: { type: 'string', description: 'Color hex, ej. "#3B82F6".', default: '#3B82F6' },
        repoUrl: { type: 'string' },
        testUrl: { type: 'string' },
        testBranch: { type: 'string' },
        prodUrl: { type: 'string' },
        prodBranch: { type: 'string' },
        techStack: { type: 'string' },
      },
      required: ['name'],
    },
    handler: async (args) => ok(await mcFetch('/api/projects', { method: 'POST', body: args })),
  },
  {
    name: 'mc_update_project',
    description: 'Actualiza campos de un proyecto existente (URLs de test/prod, ramas, descripción, stack, etc.). Pasa solo los campos a modificar.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string' },
        name: { type: 'string' },
        description: { type: 'string' },
        status: { type: 'string' },
        color: { type: 'string' },
        repoUrl: { type: 'string' },
        testUrl: { type: 'string' },
        testBranch: { type: 'string' },
        prodUrl: { type: 'string' },
        prodBranch: { type: 'string' },
        techStack: { type: 'string' },
      },
      required: ['projectId'],
    },
    handler: async ({ projectId, ...updates }) => ok(await mcFetch(`/api/projects/${projectId}`, { method: 'PUT', body: updates })),
  },
  {
    name: 'mc_add_crumbs',
    description: 'Añade uno o varios crumbs (notas de actividad) a un proyecto. Cada crumb: título corto, body con contexto, source ("claude-code" o "claude-web"), timestamp ISO. Usar para registrar los bloques de trabajo significativos de una sesión.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string' },
        crumbs: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              title: { type: 'string', description: 'Máximo ~10 palabras.' },
              body: { type: 'string', description: 'Contexto suficiente para retomar: qué se hizo, decisiones, qué queda pendiente.' },
              source: { type: 'string', default: 'claude-code' },
              timestamp: { type: 'string', description: 'ISO 8601. Si no se conoce, el backend pone ahora.' },
              isIdea: { type: 'boolean' },
            },
            required: ['title'],
          },
          minItems: 1,
        },
      },
      required: ['projectId', 'crumbs'],
    },
    handler: async ({ projectId, crumbs }) => ok(await mcFetch('/api/import', { method: 'POST', body: { projectId, crumbs } })),
  },
  {
    name: 'mc_upsert_file',
    description: 'Crea o actualiza un archivo por nombre dentro de un proyecto. Hace internamente GET + match + PUT/POST — solo tienes que pasar projectId + name + content. Ideal para CONTEXT.md y DEPLOY_STATUS.md.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string' },
        name: { type: 'string', description: 'Nombre exacto del archivo, ej. "CONTEXT.md".' },
        content: { type: 'string' },
      },
      required: ['projectId', 'name', 'content'],
    },
    handler: async ({ projectId, name, content }) => {
      const { files = [] } = await mcFetch('/api/files', { query: { projectId } });
      const existing = files.find((f) => f.name === name);
      if (existing) {
        const res = await mcFetch('/api/files', { method: 'PUT', body: { fileId: existing.id, content } });
        return ok({ action: 'updated', ...res });
      }
      const res = await mcFetch('/api/files', { method: 'POST', body: { projectId, name, content } });
      return ok({ action: 'created', ...res });
    },
  },
  {
    name: 'mc_delete_file',
    description: 'Elimina un archivo de un proyecto. Usar con cuidado — no hay papelera.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string' },
        fileId: { type: 'string' },
      },
      required: ['projectId', 'fileId'],
    },
    handler: async ({ projectId, fileId }) => ok(await mcFetch('/api/files', { method: 'DELETE', body: { projectId, fileId } })),
  },
];

const server = new Server(
  { name: 'missioncontrol', version: '0.1.0' },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: tools.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })),
}));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const tool = tools.find((t) => t.name === req.params.name);
  if (!tool) return fail(new Error(`Tool desconocida: ${req.params.name}`));
  try {
    return await tool.handler(req.params.arguments || {});
  } catch (err) {
    return fail(err);
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
console.error('[mc-mcp] Mission Control MCP server listo. Backend:', MC_API_URL);
