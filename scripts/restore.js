// Restaura un backup JSON (de scripts/backup.js o del cron de Vercel) en la BD
// apuntada por REDIS_URL de .env.local.
//
//   npm run restore -- backups/mc-2026-09-08T1730.json --yes
//   npm run restore -- latest.json --wipe --yes     (borra TODO antes de restaurar)
//
// Sin --yes solo muestra qué haría. Cada clave del dump se sobrescribe; las que
// no están en el dump se conservan salvo con --wipe.

import { createClient } from 'redis';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { restoreAll, summarizeDump } from '../api/_lib/backup.js';

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--'));
const yes = args.includes('--yes');
const wipe = args.includes('--wipe');

if (!file) {
  console.error('Uso: npm run restore -- <fichero.json> [--wipe] --yes');
  process.exit(1);
}
const url = process.env.REDIS_URL || process.env.KV_URL;
if (!url) {
  console.error('Falta REDIS_URL (o KV_URL) en .env.local');
  process.exit(1);
}

const dump = JSON.parse(readFileSync(resolve(file), 'utf8'));
const { keyCount, byPrefix } = summarizeDump(dump);
const host = url.replace(/^.*@/, '');

console.log(`Dump: ${file}`);
console.log(`  creado: ${dump.createdAt} (${dump.source})`);
console.log(`  claves: ${keyCount}`);
for (const [prefix, n] of Object.entries(byPrefix).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${prefix.padEnd(12)} ${n}`);
}
console.log(`Destino: ${host}${wipe ? '  (con --wipe: se borra todo antes)' : ''}`);

if (!yes) {
  console.log('\nSimulación. Añade --yes para restaurar de verdad.');
  process.exit(0);
}

const kv = createClient({ url, socket: { connectTimeout: 8000, reconnectStrategy: false } });
kv.on('error', (err) => console.error('Redis error:', err.message));
await kv.connect();
const result = await restoreAll(kv, dump, { wipe });
await kv.quit();
console.log(`\nRestauradas ${result.written} claves (${result.skipped} omitidas por vacías) de ${result.total}.`);
