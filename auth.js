import http from 'node:http';
import crypto from 'node:crypto';
import { API, env, saveTokens, tokenRequest } from './common.js';
const clientId = env('HUE_CLIENT_ID'); env('HUE_CLIENT_SECRET');
const appId = process.env.HUE_APP_ID; // optional for v2 authorize; included if set
const state = crypto.randomBytes(16).toString('hex');
const q = new URLSearchParams({ client_id: clientId, response_type: 'code', state });
// node-hue-api sends appid + deviceid on the v2 authorize URL; include both (deviceid is a stable label).
if (appId) q.set('appid', appId);
q.set('deviceid', 'forge-hue-mcp'); q.set('devicename', 'forge-hue-mcp');
const url = `${API}/v2/oauth2/authorize?${q}`;
const srv = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://localhost:8765');
  if (u.pathname !== '/callback') { res.writeHead(404).end(); return; }
  try {
    if (u.searchParams.get('state') !== state) throw new Error('State mismatch');
    const code = u.searchParams.get('code'); if (!code) throw new Error('No code in callback');
    const t = await tokenRequest({ grant_type: 'authorization_code', code });
    const h = { Authorization: `Bearer ${t.access_token}`, 'Content-Type': 'application/json' };
    // Current docs use /route/api; node-hue-api uses the older /bridge alias. Try /route first.
    let base = `${API}/route/api`;
    let r = await fetch(`${base}/0/config`, { method: 'PUT', headers: h, body: JSON.stringify({ linkbutton: true }) });
    if (!r.ok) { base = `${API}/bridge`; r = await fetch(`${base}/0/config`, { method: 'PUT', headers: h, body: JSON.stringify({ linkbutton: true }) }); }
    if (!r.ok) throw new Error(`linkbutton failed: HTTP ${r.status}`);
    r = await fetch(base, { method: 'POST', headers: h, body: JSON.stringify({ devicetype: 'forge-hue-mcp' }) });
    const j = await r.json();
    const key = j?.[0]?.success?.username;
    if (!key) throw new Error(`Link failed: ${JSON.stringify(j?.[0]?.error || r.status)}`);
    saveTokens({ ...t, application_key: key });
    res.end('Hue linked. You can close this tab.');
    console.log('SUCCESS: tokens and application key saved to .tokens.json');
    srv.close(); process.exit(0);
  } catch (e) { res.writeHead(500).end('Error: ' + e.message); console.error('ERROR:', e.message); srv.close(); process.exit(1); }
});
srv.listen(8765, 'localhost', () => console.log(`Open this URL to sign in:\n${url}\nWaiting on http://localhost:8765/callback ...`));
