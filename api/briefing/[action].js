// api/briefing/[action].js — Router único para todos los endpoints de briefing.
// Vercel captura /api/briefing/{daily,project,history,budget,spending,annotations,highlights}
// via el segmento dinámico [action] y delega al handler correspondiente en _handlers/.
//
// Motivo: el plan Hobby de Vercel limita a 12 serverless functions por deploy.
// Antes cada endpoint era un archivo en api/briefing/, sumando 7 funciones.
// Ahora es 1 función. _handlers/ empieza por _, Vercel lo ignora como endpoint.

import daily from './_handlers/daily.js';
import project from './_handlers/project.js';
import history from './_handlers/history.js';
import budget from './_handlers/budget.js';
import spending from './_handlers/spending.js';
import annotations from './_handlers/annotations.js';
import highlights from './_handlers/highlights.js';

const HANDLERS = {
  daily,
  project,
  history,
  budget,
  spending,
  annotations,
  highlights,
};

export default async function handler(req, res) {
  const action = req.query?.action;
  const fn = HANDLERS[action];
  if (!fn) {
    return res.status(404).json({
      error: 'unknown_briefing_action',
      detail: `action="${action}" no existe. Válidos: ${Object.keys(HANDLERS).join(', ')}`,
    });
  }
  return fn(req, res);
}
