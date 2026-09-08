// Volcado local de la BD de Mission Control a un fichero JSON.
//
//   npm run backup                  → backups/mc-<fecha>.json
//   npm run backup -- ruta/a.json   → ruta indicada
//
// Requiere REDIS_URL (o KV_URL) en .env.local. La carpeta backups/ está en
// .gitignore: el repo de MC es público y los datos no deben subirse ahí.

import { createClient } from 'redis';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { dumpAll, summarizeDump } from '../api/_lib/backup.js';

const url = process.env.REDIS_URL || process.env.KV_URL;
if (!url) {
  console.error('Falta REDIS_URL (o KV_URL). Ejecuta con: npm run backup');
  process.exit(1);
}

const stamp = new Date().toISOString().replace(/[:]/g, '').slice(0, 15); // 2026-09-08T1730
const target = resolve(process.argv[2] || `backups/mc-${stamp}.json`);

const kv = createClient({ url, socket: { connectTimeout: 8000, reconnectStrategy: false } });
kv.on('error', (err) => console.error('Redis error:', err.message));
await kv.connect();

const dump = await dumpAll(kv, { source: 'local' });
await kv.quit();

mkdirSync(dirname(target), { recursive: true });
writeFileSync(target, JSON.stringify(dump, null, 1));

const { keyCount, byPrefix } = summarizeDump(dump);
console.log(`Backup escrito en ${target}`);
console.log(`  claves: ${keyCount}`);
for (const [prefix, n] of Object.entries(byPrefix).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${prefix.padEnd(12)} ${n}`);
}
