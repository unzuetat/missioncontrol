// Seed script: migrates mock data into Vercel KV
// Usage: node scripts/seed.js
// Requires .env.local with KV_REST_API_URL and KV_REST_API_TOKEN

import { createClient } from 'redis';
import { config } from 'dotenv';
config({ path: '.env.local' });

const kv = createClient({ url: process.env.REDIS_URL });
kv.on('error', (err) => console.error('Redis error:', err));
await kv.connect();

const keys = {
  projectSet: 'projects',
  project: (id) => `project:${id}`,
  projectCrumbs: (id) => `project:${id}:crumbs`,
  crumb: (id) => `crumb:${id}`,
  recentCrumbs: 'crumbs:recent',
};

const PROJECTS = [
  {
    id: "sonora-xi",
    name: "Sonora XI",
    description: "Evento privado mayo 2026",
    status: "desarrollo",
    color: "#FF6B35",
    crumbs: [
      { title: "Diseñado flujo completo de carpool", source: "claude-web", timestamp: "2026-03-31T18:42:00", body: "Definido formulario de oferta → lista de viajes → matching." },
      { title: "Deploy sección lineup v2", source: "vercel", timestamp: "2026-03-30T14:20:00", body: "Preview: sonora-xi-git-test-lineup-v2.vercel.app" },
      { title: "Merge PR #12 lineup responsive", source: "github", timestamp: "2026-03-30T14:15:00", body: "Rama test/lineup-v2 → main. 4 archivos, +180 −22." },
      { title: "Implementada sección carpool v1", source: "claude-code", timestamp: "2026-03-29T22:10:00", body: "Creado componente con formulario y listado. Rama: test/carpool-section." },
      { title: "Configurado Firestore rules", source: "claude-code", timestamp: "2026-03-28T16:30:00", body: "Rules para colecciones events, rides, users." },
      { title: "Diseño inicial del mapa del venue", source: "claude-web", timestamp: "2026-03-27T11:00:00", body: "Boceto SVG del recinto con zonas marcadas." },
    ],
  },
  {
    id: "tercio-map",
    name: "TercioMap",
    description: "Mapa interactivo de tercios",
    status: "desarrollo",
    color: "#4ECDC4",
    crumbs: [
      { title: "Añadido filtro por época histórica", source: "claude-code", timestamp: "2026-03-30T20:15:00", body: "Filtro funcional con slider temporal." },
      { title: "Deploy filtro de batallas", source: "vercel", timestamp: "2026-03-29T10:00:00", body: "Preview activo." },
      { title: "Push datos de Flandes", source: "github", timestamp: "2026-03-28T09:00:00", body: "42 batallas, 18 rutas de marcha." },
    ],
  },
  {
    id: "pmo-toolkit",
    name: "PMO Toolkit",
    description: "Herramienta PM con theming",
    status: "desarrollo",
    color: "#A78BFA",
    crumbs: [
      { title: "Theming con tokens semánticos", source: "claude-web", timestamp: "2026-03-29T15:00:00", body: "Definidos tokens semánticos." },
      { title: "Componente Gantt básico", source: "claude-code", timestamp: "2026-03-27T20:00:00", body: "Chart con drag & drop." },
    ],
  },
  {
    id: "mission-control",
    name: "Mission Control",
    description: "Este meta-proyecto",
    status: "desarrollo",
    color: "#F7DC6F",
    crumbs: [
      { title: "Backend Vercel KV + API REST", source: "claude-code", timestamp: "2026-04-01T16:00:00", body: "CRUD completo de proyectos y crumbs. Deploy a producción." },
      { title: "Prototipo visual validado", source: "claude-web", timestamp: "2026-04-01T10:00:00", body: "Grid + timeline + bitácora aprobados." },
      { title: "Arquitectura de fuentes definida", source: "claude-web", timestamp: "2026-03-31T12:00:00", body: "Webhooks + hook Stop + nota manual." },
    ],
  },
  {
    id: "portfolio",
    name: "Portfolio Personal",
    description: "Web personal",
    status: "pausado",
    color: "#95A5A6",
    crumbs: [
      { title: "Sección de proyectos con grid", source: "claude-code", timestamp: "2026-03-15T18:00:00", body: "Layout responsive con cards animadas." },
    ],
  },
  {
    id: "api-tercios",
    name: "API Tercios",
    description: "API REST datos históricos",
    status: "idea",
    color: "#E67E22",
    crumbs: [
      { title: "Definido schema inicial", source: "claude-web", timestamp: "2026-03-20T09:30:00", body: "Endpoints definidos." },
    ],
  },
];

async function seed() {
  console.log("Seeding KV...");

  for (const project of PROJECTS) {
    const { id, crumbs, ...projectData } = project;

    // Add project
    await kv.sAdd(keys.projectSet, id);
    await kv.hSet(keys.project(id), projectData);
    console.log(`  Project: ${projectData.name}`);

    // Add crumbs
    for (const crumb of crumbs) {
      const crumbId = crypto.randomUUID();
      const score = new Date(crumb.timestamp).getTime();

      await kv.hSet(keys.crumb(crumbId), {
        projectId: id,
        title: crumb.title,
        source: crumb.source,
        timestamp: crumb.timestamp,
        body: crumb.body,
      });
      await kv.zAdd(keys.projectCrumbs(id), [{ score, value: crumbId }]);
      await kv.zAdd(keys.recentCrumbs, [{ score, value: crumbId }]);
    }
    console.log(`    ${crumbs.length} crumbs`);
  }

  // Trim recent to 50
  const count = await kv.zCard(keys.recentCrumbs);
  if (count > 50) {
    await kv.zRemRangeByRank(keys.recentCrumbs, 0, count - 51);
  }

  console.log("Done!");
  await kv.quit();
}

seed().catch(console.error);
