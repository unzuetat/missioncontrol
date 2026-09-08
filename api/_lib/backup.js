// Volcado y restauración completos de la base de datos Redis de Mission Control.
//
// Formato del dump (JSON):
// {
//   version: 1,
//   createdAt: ISO,
//   source: 'vercel-cron' | 'local' | ...,
//   keyCount: N,
//   keys: [{ key, type, ttl, value }]
// }
//   type  : 'string' | 'hash' | 'set' | 'zset' | 'list'
//   ttl   : segundos restantes, o -1 si no expira
//   value : string | object (hash) | string[] (set/list) | [{score,value}] (zset)
//
// Lo usan api/ops/[action].js (cron diario en Vercel) y scripts/backup.js /
// scripts/restore.js (local). Redis Cloud borró la BD por inactividad el
// 2026-09-08 y no había copia: este módulo existe para que no vuelva a pasar.

const CHUNK = 50;

async function scanAllKeys(kv) {
  const keys = [];
  let cursor = '0';
  do {
    const res = await kv.scan(cursor, { MATCH: '*', COUNT: 500 });
    cursor = String(res.cursor);
    keys.push(...res.keys);
  } while (cursor !== '0');
  return keys;
}

async function readKey(kv, key) {
  const type = await kv.type(key);
  const ttl = await kv.ttl(key);
  let value;
  switch (type) {
    case 'string': value = await kv.get(key); break;
    case 'hash': value = await kv.hGetAll(key); break;
    case 'set': value = await kv.sMembers(key); break;
    case 'zset': value = await kv.zRangeWithScores(key, 0, -1); break;
    case 'list': value = await kv.lRange(key, 0, -1); break;
    default:
      return { key, type, ttl, value: null, skipped: `tipo no soportado: ${type}` };
  }
  return { key, type, ttl, value };
}

export async function dumpAll(kv, { source = 'unknown' } = {}) {
  const keys = await scanAllKeys(kv);
  const entries = [];
  for (let i = 0; i < keys.length; i += CHUNK) {
    const chunk = keys.slice(i, i + CHUNK);
    const read = await Promise.all(chunk.map((k) => readKey(kv, k)));
    entries.push(...read);
  }
  entries.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  return {
    version: 1,
    createdAt: new Date().toISOString(),
    source,
    keyCount: entries.length,
    keys: entries,
  };
}

async function writeKey(kv, entry) {
  const { key, type, ttl, value } = entry;
  if (value === null || value === undefined) return false;
  await kv.del(key);
  switch (type) {
    case 'string':
      await kv.set(key, value);
      break;
    case 'hash':
      if (Object.keys(value).length === 0) return false;
      await kv.hSet(key, value);
      break;
    case 'set':
      if (value.length === 0) return false;
      await kv.sAdd(key, value);
      break;
    case 'zset':
      if (value.length === 0) return false;
      await kv.zAdd(key, value.map((m) => ({ score: Number(m.score), value: String(m.value) })));
      break;
    case 'list':
      if (value.length === 0) return false;
      await kv.rPush(key, value);
      break;
    default:
      return false;
  }
  if (typeof ttl === 'number' && ttl > 0) await kv.expire(key, ttl);
  return true;
}

export async function restoreAll(kv, dump, { wipe = false } = {}) {
  if (!dump || dump.version !== 1 || !Array.isArray(dump.keys)) {
    throw new Error('Dump inválido: se esperaba { version: 1, keys: [...] }');
  }
  if (wipe) await kv.flushDb();
  let written = 0;
  let skipped = 0;
  for (let i = 0; i < dump.keys.length; i += CHUNK) {
    const chunk = dump.keys.slice(i, i + CHUNK);
    const results = await Promise.all(chunk.map((e) => writeKey(kv, e)));
    for (const ok of results) ok ? written++ : skipped++;
  }
  return { written, skipped, total: dump.keys.length };
}

// Resumen legible de un dump, para logs y para el crumb/estado de ops.
export function summarizeDump(dump) {
  const byPrefix = {};
  for (const e of dump.keys) {
    const prefix = e.key.split(':')[0];
    byPrefix[prefix] = (byPrefix[prefix] || 0) + 1;
  }
  return { keyCount: dump.keyCount, byPrefix };
}
