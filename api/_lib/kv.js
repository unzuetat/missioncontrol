import { createClient } from 'redis';

let client;

async function getClient() {
  if (!client) {
    client = createClient({
      url: process.env.REDIS_URL || process.env.KV_URL,
      socket: {
        // Fallar rápido en vez de colgar la función: si Redis no responde en 5 s
        // devolvemos 500 y el dashboard puede mostrar un error claro.
        connectTimeout: 5000,
        reconnectStrategy: (retries) => (retries > 2 ? new Error('Redis inalcanzable') : 200),
      },
    });
    client.on('error', (err) => console.error('Redis error:', err));
    await client.connect();
  }
  if (!client.isOpen) {
    await client.connect();
  }
  return client;
}

export const keys = {
  projectSet: 'projects',
  project: (id) => `project:${id}`,
  projectCrumbs: (id) => `project:${id}:crumbs`,
  projectFiles: (id) => `project:${id}:files`,
  crumb: (id) => `crumb:${id}`,
  file: (id) => `file:${id}`,
  recentCrumbs: 'crumbs:recent',
  dueCrumbs: 'crumbs:due',                 // zset: score = dueAt ms, value = crumbId (solo pendientes)
  pulseMachines: 'pulse:machines',         // set de MACHINE_IDs que han enviado pulso git
  pulse: (machine) => `pulse:${machine}`,  // string JSON con el último pulso de esa máquina
};

const RECENT_CRUMBS_MAX = 50;

export async function getAllProjects() {
  const kv = await getClient();
  const ids = await kv.sMembers(keys.projectSet);
  if (!ids || ids.length === 0) return [];

  const projects = [];
  for (const id of ids) {
    const data = await kv.hGetAll(keys.project(id));
    if (data && Object.keys(data).length > 0) {
      projects.push({ id, ...data });
    }
  }

  // Fetch lastCrumb for each project
  for (const p of projects) {
    const topCrumbs = await kv.zRange(keys.projectCrumbs(p.id), 0, 0, { REV: true });
    if (topCrumbs && topCrumbs.length > 0) {
      const crumbData = await kv.hGetAll(keys.crumb(topCrumbs[0]));
      if (crumbData && Object.keys(crumbData).length > 0) {
        p.lastCrumb = crumbData;
      }
    }
  }

  return projects;
}

// Lista ligera para detección en slash commands: solo id, name, repoUrl, status.
// No carga lastCrumb (un fetch extra por proyecto). ~80 tokens/proyecto vs ~250 del minimal.
export async function getAllProjectsBare() {
  const kv = await getClient();
  const ids = await kv.sMembers(keys.projectSet);
  if (!ids || ids.length === 0) return [];

  const projects = [];
  for (const id of ids) {
    const data = await kv.hmGet(keys.project(id), ['name', 'repoUrl', 'status']);
    if (data && data[0]) {
      projects.push({ id, name: data[0], repoUrl: data[1] || '', status: data[2] || '' });
    }
  }
  return projects;
}

export async function getProjectCrumbs(projectId, limit) {
  const kv = await getClient();
  const stop = typeof limit === 'number' && limit > 0 ? limit - 1 : -1;
  const crumbIds = await kv.zRange(keys.projectCrumbs(projectId), 0, stop, { REV: true });
  if (!crumbIds || crumbIds.length === 0) return [];

  const crumbs = [];
  for (const id of crumbIds) {
    const data = await kv.hGetAll(keys.crumb(id));
    if (data && Object.keys(data).length > 0) {
      crumbs.push({ id, ...data });
    }
  }
  return crumbs;
}

export async function getProjectById(projectId) {
  const kv = await getClient();
  const data = await kv.hGetAll(keys.project(projectId));
  if (!data || Object.keys(data).length === 0) return null;
  return { id: projectId, ...data };
}

export async function getKV(key) {
  const kv = await getClient();
  const raw = await kv.get(key);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return raw; }
}

export async function setKV(key, value) {
  const kv = await getClient();
  const serialized = typeof value === 'string' ? value : JSON.stringify(value);
  await kv.set(key, serialized);
}

export async function getRecentCrumbs(limit = 20) {
  const kv = await getClient();
  const crumbIds = await kv.zRange(keys.recentCrumbs, 0, limit - 1, { REV: true });
  if (!crumbIds || crumbIds.length === 0) return [];

  const crumbs = [];
  for (const id of crumbIds) {
    const data = await kv.hGetAll(keys.crumb(id));
    if (data && Object.keys(data).length > 0) {
      crumbs.push({ id, ...data });
    }
  }
  return crumbs;
}

export async function createCrumb(crumbData) {
  const kv = await getClient();
  const id = crypto.randomUUID();
  const timestamp = crumbData.timestamp || new Date().toISOString();
  const score = new Date(timestamp).getTime();

  const crumb = {
    projectId: crumbData.projectId,
    title: crumbData.title,
    source: crumbData.source || 'claude-web',
    timestamp,
    body: crumbData.body || '',
    isIdea: crumbData.isIdea ? 'true' : '',
    isTest: crumbData.isTest ? 'true' : '',
    isDone: '',
    dueAt: normalizeDueAt(crumbData.dueAt),
  };

  await kv.hSet(keys.crumb(id), crumb);
  await kv.zAdd(keys.projectCrumbs(crumb.projectId), [{ score, value: id }]);
  await kv.zAdd(keys.recentCrumbs, [{ score, value: id }]);
  if (crumb.dueAt) {
    await kv.zAdd(keys.dueCrumbs, [{ score: Date.parse(crumb.dueAt), value: id }]);
  }

  // Trim recent crumbs
  const count = await kv.zCard(keys.recentCrumbs);
  if (count > RECENT_CRUMBS_MAX) {
    await kv.zRemRangeByRank(keys.recentCrumbs, 0, count - RECENT_CRUMBS_MAX - 1);
  }

  return { id, ...crumb };
}

export async function updateCrumb(crumbId, fields) {
  const kv = await getClient();
  const clean = { ...fields };
  if (clean.dueAt !== undefined) clean.dueAt = normalizeDueAt(clean.dueAt);
  if (Object.keys(clean).length > 0) await kv.hSet(keys.crumb(crumbId), clean);
  const crumb = await kv.hGetAll(keys.crumb(crumbId));
  // Mantener el índice de revisiones pendientes: solo crumbs con dueAt y no hechos.
  if (crumb.dueAt && crumb.isDone !== 'true') {
    await kv.zAdd(keys.dueCrumbs, [{ score: Date.parse(crumb.dueAt), value: crumbId }]);
  } else {
    await kv.zRem(keys.dueCrumbs, crumbId);
  }
  return crumb;
}

// Acepta 'YYYY-MM-DD' o ISO completo; devuelve ISO (o '' si vacío/inválido).
function normalizeDueAt(value) {
  if (!value) return '';
  const str = String(value).trim();
  const ms = Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(str) ? `${str}T09:00:00.000Z` : str);
  return Number.isNaN(ms) ? '' : new Date(ms).toISOString();
}

// Revisiones pendientes (crumbs con dueAt, no hechos), ordenadas por fecha.
// Devuelve también nombre y color del proyecto para pintarlas sin más fetches.
export async function getDueCrumbs() {
  const kv = await getClient();
  const ids = await kv.zRange(keys.dueCrumbs, 0, -1);
  const out = [];
  for (const id of ids) {
    const c = await kv.hGetAll(keys.crumb(id));
    if (!c || !c.title) { await kv.zRem(keys.dueCrumbs, id); continue; }
    if (c.isDone === 'true' || !c.dueAt) { await kv.zRem(keys.dueCrumbs, id); continue; }
    const [projectName, projectColor] = await kv.hmGet(keys.project(c.projectId), ['name', 'color']);
    out.push({ id, ...c, projectName: projectName || c.projectId, projectColor: projectColor || '' });
  }
  return out;
}

// Pulso git enviado por el agente local de cada máquina.
export async function savePulse(machine, payload) {
  const kv = await getClient();
  await kv.set(keys.pulse(machine), JSON.stringify(payload));
  await kv.sAdd(keys.pulseMachines, machine);
}

export async function getAllPulses() {
  const kv = await getClient();
  const machines = await kv.sMembers(keys.pulseMachines);
  const out = {};
  for (const m of machines) {
    const raw = await kv.get(keys.pulse(m));
    if (!raw) continue;
    try { out[m] = JSON.parse(raw); } catch { /* pulso corrupto: se ignora */ }
  }
  return out;
}

export async function deleteProjectFull(projectId) {
  const kv = await getClient();
  const crumbIds = await kv.zRange(keys.projectCrumbs(projectId), 0, -1);

  await kv.sRem(keys.projectSet, projectId);
  await kv.del(keys.project(projectId));
  await kv.del(keys.projectCrumbs(projectId));
  for (const cid of crumbIds || []) {
    await kv.del(keys.crumb(cid));
    await kv.zRem(keys.recentCrumbs, cid);
  }
}

export async function getProjectFiles(projectId) {
  const kv = await getClient();
  const fileIds = await kv.sMembers(keys.projectFiles(projectId));
  if (!fileIds || fileIds.length === 0) return [];

  const files = [];
  for (const id of fileIds) {
    const data = await kv.hGetAll(keys.file(id));
    if (data && Object.keys(data).length > 0) {
      files.push({ id, ...data });
    }
  }
  return files.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
}

export async function createFile(projectId, name, content) {
  const kv = await getClient();
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const file = { projectId, name, content, createdAt: now, updatedAt: now };
  await kv.hSet(keys.file(id), file);
  await kv.sAdd(keys.projectFiles(projectId), id);
  return { id, ...file };
}

export async function updateFile(fileId, content) {
  const kv = await getClient();
  await kv.hSet(keys.file(fileId), { content, updatedAt: new Date().toISOString() });
  return await kv.hGetAll(keys.file(fileId));
}

export async function deleteFile(fileId, projectId) {
  const kv = await getClient();
  await kv.sRem(keys.projectFiles(projectId), fileId);
  await kv.del(keys.file(fileId));
}

export { getClient as getKv };
