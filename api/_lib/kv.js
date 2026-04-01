import { createClient } from 'redis';

let client;

async function getClient() {
  if (!client) {
    client = createClient({ url: process.env.REDIS_URL });
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
  crumb: (id) => `crumb:${id}`,
  recentCrumbs: 'crumbs:recent',
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

export async function getProjectCrumbs(projectId) {
  const kv = await getClient();
  const crumbIds = await kv.zRange(keys.projectCrumbs(projectId), 0, -1, { REV: true });
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
  };

  await kv.hSet(keys.crumb(id), crumb);
  await kv.zAdd(keys.projectCrumbs(crumb.projectId), [{ score, value: id }]);
  await kv.zAdd(keys.recentCrumbs, [{ score, value: id }]);

  // Trim recent crumbs
  const count = await kv.zCard(keys.recentCrumbs);
  if (count > RECENT_CRUMBS_MAX) {
    await kv.zRemRangeByRank(keys.recentCrumbs, 0, count - RECENT_CRUMBS_MAX - 1);
  }

  return { id, ...crumb };
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

export { getClient as getKv };
