// Cola de trabajos para el agente local (agent/worker.js).
//
// El dashboard (Vercel) no puede ejecutar nada en el Mac de Telmo, así que los
// botones "actualizar pulso" y "briefing por suscripción" encolan aquí un
// trabajo, y el agente residente de cada máquina lo reclama, lo ejecuta y
// devuelve el resultado. Claves:
//
//   jobs:queue:<machine>   lista FIFO de ids para una máquina concreta
//   jobs:queue:any         lista FIFO de ids que puede ejecutar cualquiera
//   job:<id>               hash { type, params(JSON), machine, status, ... }
//   jobs:recent            zset por createdAt (últimos RECENT_MAX)
//   agent:seen:<machine>   ISO del último contacto (TTL AGENT_TTL_S)
//   agent:machines         set de máquinas que han contactado alguna vez
//   jobs:wake              existe mientras el agente debe sondear rápido
//
// Tipos de trabajo: 'pulse' (params {}), 'briefing' (params {kind, flavor,
// projectId?, model?}).

import { getKv } from './kv.js';

export const JOB_TYPES = new Set(['pulse', 'briefing']);
export const JOB_STATUSES = new Set(['queued', 'running', 'done', 'failed', 'cancelled']);

const RECENT_MAX = 50;
const AGENT_TTL_S = 240;   // sin contacto en 4 min → agente desconectado
const WAKE_TTL_S = 180;    // tras actividad del dashboard, el agente sondea rápido 3 min
const RUNNING_TIMEOUT_MS = 15 * 60 * 1000; // trabajo en running > 15 min → failed

const K = {
  queue: (machine) => `jobs:queue:${machine || 'any'}`,
  job: (id) => `job:${id}`,
  recent: 'jobs:recent',
  seen: (machine) => `agent:seen:${machine}`,
  machines: 'agent:machines',
  wake: 'jobs:wake',
};

function parseJob(h) {
  if (!h || !h.type) return null;
  let params = {};
  let result = null;
  try { params = h.params ? JSON.parse(h.params) : {}; } catch { /* params corruptos */ }
  try { result = h.result ? JSON.parse(h.result) : null; } catch { /* result corrupto */ }
  return { ...h, params, result };
}

export async function setWake() {
  const kv = await getKv();
  await kv.set(K.wake, new Date().toISOString(), { EX: WAKE_TTL_S });
}

export async function heartbeat(machine, extra = {}) {
  const kv = await getKv();
  await kv.set(K.seen(machine), JSON.stringify({ at: new Date().toISOString(), ...extra }), { EX: AGENT_TTL_S });
  await kv.sAdd(K.machines, machine);
}

export async function getAgents() {
  const kv = await getKv();
  const machines = await kv.sMembers(K.machines);
  const out = {};
  for (const m of machines) {
    const raw = await kv.get(K.seen(m));
    let info = null;
    try { info = raw ? JSON.parse(raw) : null; } catch { info = { at: raw }; }
    out[m] = { online: Boolean(info), lastSeen: info?.at || null, ...(info || {}) };
  }
  return out;
}

// Crea un trabajo. Si ya hay uno igual en cola (mismo tipo, máquina y params)
// devuelve ese en vez de duplicarlo.
export async function createJob({ type, params = {}, machine = '', requestedBy = '' }) {
  if (!JOB_TYPES.has(type)) throw new Error(`Tipo de trabajo desconocido: ${type}`);
  const kv = await getKv();
  const paramsJson = JSON.stringify(params || {});
  const queueKey = K.queue(machine || 'any');

  const queuedIds = await kv.lRange(queueKey, 0, -1);
  for (const id of queuedIds) {
    const h = await kv.hGetAll(K.job(id));
    if (h && h.status === 'queued' && h.type === type && (h.params || '{}') === paramsJson) {
      return parseJob({ id, ...h });
    }
  }

  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  const job = {
    id, type, params: paramsJson, machine: machine || '', status: 'queued',
    createdAt, startedAt: '', finishedAt: '', claimedBy: '', error: '', result: '', requestedBy,
  };
  await kv.hSet(K.job(id), job);
  await kv.rPush(queueKey, id);
  await kv.zAdd(K.recent, [{ score: Date.parse(createdAt), value: id }]);
  const n = await kv.zCard(K.recent);
  if (n > RECENT_MAX) {
    const old = await kv.zRange(K.recent, 0, n - RECENT_MAX - 1);
    for (const oid of old) await kv.del(K.job(oid));
    await kv.zRemRangeByRank(K.recent, 0, n - RECENT_MAX - 1);
  }
  await kv.set(K.wake, createdAt, { EX: WAKE_TTL_S });
  return parseJob(job);
}

// El agente de `machine` reclama el siguiente trabajo: primero su cola, luego
// la genérica. Devuelve { job|null, fast }.
export async function claimJob(machine, extra = {}) {
  const kv = await getKv();
  await heartbeat(machine, extra);
  const fast = Boolean(await kv.get(K.wake));
  for (const queueKey of [K.queue(machine), K.queue('any')]) {
    // lPop hasta encontrar un trabajo que siga en cola (los cancelados se saltan).
    for (let i = 0; i < 20; i++) {
      const id = await kv.lPop(queueKey);
      if (!id) break;
      const h = await kv.hGetAll(K.job(id));
      if (!h || !h.type || h.status !== 'queued') continue;
      const startedAt = new Date().toISOString();
      await kv.hSet(K.job(id), { status: 'running', startedAt, claimedBy: machine });
      return { job: parseJob({ id, ...h, status: 'running', startedAt, claimedBy: machine }), fast };
    }
  }
  return { job: null, fast };
}

export async function finishJob(id, { status, result = null, error = '' }) {
  if (status !== 'done' && status !== 'failed') throw new Error('status debe ser done o failed');
  const kv = await getKv();
  const h = await kv.hGetAll(K.job(id));
  if (!h || !h.type) throw new Error('Trabajo no encontrado');
  const fields = {
    status,
    finishedAt: new Date().toISOString(),
    error: status === 'failed' ? String(error || 'error desconocido').slice(0, 2000) : '',
    result: result ? JSON.stringify(result).slice(0, 20000) : '',
  };
  await kv.hSet(K.job(id), fields);
  return parseJob({ id, ...h, ...fields });
}

export async function cancelJob(id) {
  const kv = await getKv();
  const h = await kv.hGetAll(K.job(id));
  if (!h || !h.type) throw new Error('Trabajo no encontrado');
  if (h.status !== 'queued') return parseJob({ id, ...h });
  await kv.hSet(K.job(id), { status: 'cancelled', finishedAt: new Date().toISOString() });
  await kv.lRem(K.queue(h.machine || 'any'), 0, id);
  return parseJob({ id, ...h, status: 'cancelled' });
}

export async function getJob(id) {
  const kv = await getKv();
  const h = await kv.hGetAll(K.job(id));
  return h && h.type ? parseJob({ id, ...h }) : null;
}

// Últimos trabajos (más recientes primero). Marca como failed los que llevan
// demasiado en running (agente muerto a mitad).
export async function listJobs(limit = 20) {
  const kv = await getKv();
  const ids = await kv.zRange(K.recent, -limit, -1);
  const out = [];
  for (const id of ids.reverse()) {
    const h = await kv.hGetAll(K.job(id));
    if (!h || !h.type) continue;
    if (h.status === 'running' && h.startedAt && Date.now() - Date.parse(h.startedAt) > RUNNING_TIMEOUT_MS) {
      const fields = { status: 'failed', finishedAt: new Date().toISOString(), error: 'timeout: el agente no devolvió resultado en 15 min' };
      await kv.hSet(K.job(id), fields);
      Object.assign(h, fields);
    }
    out.push(parseJob({ id, ...h }));
  }
  return out;
}
