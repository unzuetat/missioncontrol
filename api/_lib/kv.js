import { createClient } from '@vercel/kv';

let kvClient;

export function getKv() {
  if (!kvClient) {
    kvClient = createClient({
      url: process.env.KV_REST_API_URL,
      token: process.env.KV_REST_API_TOKEN,
    });
  }
  return kvClient;
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
  const kv = getKv();
  const ids = await kv.smembers(keys.projectSet);
  if (!ids || ids.length === 0) return [];

  const pipeline = kv.pipeline();
  for (const id of ids) {
    pipeline.hgetall(keys.project(id));
  }
  const results = await pipeline.exec();

  const projects = [];
  for (let i = 0; i < ids.length; i++) {
    if (results[i]) {
      projects.push({ id: ids[i], ...results[i] });
    }
  }

  // Fetch lastCrumb for each project
  const crumbPipeline = kv.pipeline();
  for (const p of projects) {
    crumbPipeline.zrange(keys.projectCrumbs(p.id), 0, 0, { rev: true });
  }
  const crumbIdResults = await crumbPipeline.exec();

  const crumbDetailPipeline = kv.pipeline();
  const crumbMap = [];
  for (let i = 0; i < projects.length; i++) {
    const crumbIds = crumbIdResults[i];
    if (crumbIds && crumbIds.length > 0) {
      crumbDetailPipeline.hgetall(keys.crumb(crumbIds[0]));
      crumbMap.push(i);
    }
  }

  if (crumbMap.length > 0) {
    const crumbDetails = await crumbDetailPipeline.exec();
    for (let j = 0; j < crumbMap.length; j++) {
      const projectIdx = crumbMap[j];
      if (crumbDetails[j]) {
        projects[projectIdx].lastCrumb = crumbDetails[j];
      }
    }
  }

  return projects;
}

export async function getProjectCrumbs(projectId) {
  const kv = getKv();
  const crumbIds = await kv.zrange(keys.projectCrumbs(projectId), 0, -1, { rev: true });
  if (!crumbIds || crumbIds.length === 0) return [];

  const pipeline = kv.pipeline();
  for (const id of crumbIds) {
    pipeline.hgetall(keys.crumb(id));
  }
  const results = await pipeline.exec();
  return results.filter(Boolean).map((c, i) => ({ id: crumbIds[i], ...c }));
}

export async function getRecentCrumbs(limit = 20) {
  const kv = getKv();
  const crumbIds = await kv.zrange(keys.recentCrumbs, 0, limit - 1, { rev: true });
  if (!crumbIds || crumbIds.length === 0) return [];

  const pipeline = kv.pipeline();
  for (const id of crumbIds) {
    pipeline.hgetall(keys.crumb(id));
  }
  const results = await pipeline.exec();
  return results.filter(Boolean).map((c, i) => ({ id: crumbIds[i], ...c }));
}

export async function createCrumb(crumbData) {
  const kv = getKv();
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

  const pipeline = kv.pipeline();
  pipeline.hset(keys.crumb(id), crumb);
  pipeline.zadd(keys.projectCrumbs(crumb.projectId), { score, member: id });
  pipeline.zadd(keys.recentCrumbs, { score, member: id });
  await pipeline.exec();

  // Trim recent crumbs
  const count = await kv.zcard(keys.recentCrumbs);
  if (count > RECENT_CRUMBS_MAX) {
    await kv.zremrangebyrank(keys.recentCrumbs, 0, count - RECENT_CRUMBS_MAX - 1);
  }

  return { id, ...crumb };
}

export async function deleteProjectFull(projectId) {
  const kv = getKv();
  const crumbIds = await kv.zrange(keys.projectCrumbs(projectId), 0, -1);

  const pipeline = kv.pipeline();
  pipeline.srem(keys.projectSet, projectId);
  pipeline.del(keys.project(projectId));
  pipeline.del(keys.projectCrumbs(projectId));
  for (const cid of crumbIds || []) {
    pipeline.del(keys.crumb(cid));
    pipeline.zrem(keys.recentCrumbs, cid);
  }
  await pipeline.exec();
}
