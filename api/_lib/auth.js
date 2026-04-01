export function checkAuth(req) {
  // Browser requests from same origin don't need API key
  const origin = req.headers['origin'] || '';
  const referer = req.headers['referer'] || '';
  const appUrl = process.env.VERCEL_URL || '';

  if (appUrl && (origin.includes(appUrl) || referer.includes(appUrl))) {
    return true;
  }

  // Local dev: skip auth for same-origin
  if (origin.includes('localhost') || referer.includes('localhost')) {
    return true;
  }

  // External requests require API key
  const key = req.headers['x-api-key'];
  return key && key === process.env.MC_API_KEY;
}

export function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-api-key');
}
