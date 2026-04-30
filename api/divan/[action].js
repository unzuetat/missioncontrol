// api/divan/[action].js — Router único de los endpoints del Diván.
// Vercel captura /api/divan/{run,modes,sessions} via el segmento dinámico [action]
// y delega al handler correspondiente en _handlers/. _handlers/ está prefijado por _
// para que Vercel lo ignore como endpoint.
//
// 1 serverless function (no se rocen los 12 del plan Hobby).

import run from './_handlers/run.js';
import modes from './_handlers/modes.js';
import sessions from './_handlers/sessions.js';

const HANDLERS = { run, modes, sessions };

export default async function handler(req, res) {
  const action = req.query?.action;
  const fn = HANDLERS[action];
  if (!fn) {
    return res.status(404).json({
      error: 'unknown_divan_action',
      detail: `action="${action}" no existe. Válidos: ${Object.keys(HANDLERS).join(', ')}`,
    });
  }
  return fn(req, res);
}
