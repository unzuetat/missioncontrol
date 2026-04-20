export function checkAuth(req) {
  // GET requests are always public (read-only)
  if (req.method === 'GET') return true;

  // Browser requests from same origin don't need API key
  const origin = req.headers['origin'] || '';
  const referer = req.headers['referer'] || '';
  const appUrl = process.env.VERCEL_URL || '';
  const prodUrl = process.env.VERCEL_PROJECT_PRODUCTION_URL || '';

  if (appUrl && (origin.includes(appUrl) || referer.includes(appUrl))) return true;
  if (prodUrl && (origin.includes(prodUrl) || referer.includes(prodUrl))) return true;
  if (origin.includes('localhost') || referer.includes('localhost')) return true;

  // Allow all Vercel preview deployments for this project
  if (origin.includes('missioncontrol') && origin.includes('.vercel.app')) return true;
  if (referer.includes('missioncontrol') && referer.includes('.vercel.app')) return true;

  // External requests require API key
  const key = req.headers['x-api-key'];
  return key && key === process.env.MC_API_KEY;
}

export function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-api-key');
}

export function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, x-api-key',
  };
}
