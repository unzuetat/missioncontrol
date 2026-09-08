// Operaciones de mantenimiento de Mission Control.
//
//   GET /api/ops/status     → última señal de vida y último backup (público, solo lectura)
//   POST/GET /api/ops/keepalive → escribe una clave en Redis (actividad real: evita el
//                             borrado/archivado por inactividad de los planes gratuitos)
//   POST/GET /api/ops/backup    → vuelca toda la BD a JSON y lo sube al repo privado
//                             BACKUP_REPO (GitHub) con BACKUP_GITHUB_TOKEN
//   POST/GET /api/ops/daily     → keepalive + backup. Es lo que llama el cron de
//                             vercel.json cada día.
//
// Autorización (keepalive/backup/daily): cabecera `Authorization: Bearer <CRON_SECRET>`
// (Vercel la añade sola a las invocaciones del cron) o `x-api-key: <MC_API_KEY>`
// para lanzarlo a mano.

import { getKv } from '../_lib/kv.js';
import { dumpAll, summarizeDump } from '../_lib/backup.js';
import { setCors } from '../_lib/auth.js';

export const config = { maxDuration: 60 };

const KEY_KEEPALIVE = 'ops:keepalive';
const KEY_BACKUP_LAST = 'ops:backup:last';

function authorized(req) {
  const auth = req.headers['authorization'] || '';
  const secret = process.env.CRON_SECRET;
  if (secret && auth === `Bearer ${secret}`) return true;
  const key = req.headers['x-api-key'];
  return Boolean(key && process.env.MC_API_KEY && key === process.env.MC_API_KEY);
}

async function keepalive(kv) {
  const at = new Date().toISOString();
  await kv.hSet(KEY_KEEPALIVE, { at, region: process.env.VERCEL_REGION || 'unknown' });
  await kv.hIncrBy(KEY_KEEPALIVE, 'count', 1);
  return { ok: true, at };
}

async function githubRequest(method, path, token, body) {
  const res = await fetch(`https://api.github.com${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'missioncontrol-backup',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* respuesta no JSON */ }
  return { status: res.status, json, text };
}

async function putFile(repo, token, path, contentBase64, message) {
  const existing = await githubRequest('GET', `/repos/${repo}/contents/${path}`, token);
  const sha = existing.status === 200 && existing.json?.sha ? existing.json.sha : undefined;
  const res = await githubRequest('PUT', `/repos/${repo}/contents/${path}`, token, {
    message,
    content: contentBase64,
    ...(sha ? { sha } : {}),
  });
  if (res.status !== 200 && res.status !== 201) {
    throw new Error(`GitHub ${res.status} al escribir ${path}: ${res.json?.message || res.text.slice(0, 200)}`);
  }
  return res.json?.content?.html_url || path;
}

async function backup(kv) {
  const token = process.env.BACKUP_GITHUB_TOKEN;
  const repo = process.env.BACKUP_REPO;
  if (!token || !repo) {
    throw new Error('Faltan BACKUP_GITHUB_TOKEN y/o BACKUP_REPO en las variables de entorno');
  }

  const dump = await dumpAll(kv, { source: 'vercel-cron' });
  const summary = summarizeDump(dump);
  const json = JSON.stringify(dump);
  const bytes = Buffer.byteLength(json);
  const contentBase64 = Buffer.from(json).toString('base64');

  const day = dump.createdAt.slice(0, 10);
  const year = day.slice(0, 4);
  const message = `backup ${dump.createdAt} · ${dump.keyCount} claves`;
  const datedPath = `backups/${year}/${day}.json`;
  const url = await putFile(repo, token, datedPath, contentBase64, message);
  await putFile(repo, token, 'latest.json', contentBase64, message);

  const record = { at: dump.createdAt, keyCount: dump.keyCount, bytes, path: datedPath, byPrefix: summary.byPrefix };
  await kv.set(KEY_BACKUP_LAST, JSON.stringify(record));
  return { ok: true, ...record, url };
}

async function status(kv) {
  const [ka, last] = await Promise.all([kv.hGetAll(KEY_KEEPALIVE), kv.get(KEY_BACKUP_LAST)]);
  return {
    keepalive: ka && Object.keys(ka).length ? ka : null,
    lastBackup: last ? JSON.parse(last) : null,
    backupConfigured: Boolean(process.env.BACKUP_GITHUB_TOKEN && process.env.BACKUP_REPO),
  };
}

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { action } = req.query;
  const kv = await getKv();

  if (action === 'status') {
    return res.status(200).json(await status(kv));
  }

  if (!authorized(req)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    if (action === 'keepalive') return res.status(200).json(await keepalive(kv));
    if (action === 'backup') return res.status(200).json(await backup(kv));
    if (action === 'daily') {
      const ka = await keepalive(kv);
      try {
        const bk = await backup(kv);
        return res.status(200).json({ keepalive: ka, backup: bk });
      } catch (err) {
        // El keepalive ya está hecho; devolvemos 500 para que el cron lo marque como fallo.
        console.error('ops/daily backup error:', err);
        return res.status(500).json({ keepalive: ka, backup: { ok: false, error: err.message } });
      }
    }
    return res.status(404).json({ error: `Acción desconocida: ${action}` });
  } catch (err) {
    console.error(`ops/${action} error:`, err);
    return res.status(500).json({ error: err.message });
  }
}
