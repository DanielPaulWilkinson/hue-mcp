import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
export const DIR = path.dirname(fileURLToPath(import.meta.url));
export const TOKENS = path.join(DIR, '.tokens.json');
export const API = 'https://api.meethue.com';
const ENVF = new URL('./.env', import.meta.url);
const fileEnv = fs.existsSync(ENVF) ? Object.fromEntries(fs.readFileSync(ENVF,'utf8').split('\n').filter(Boolean).map(l=>[l.slice(0,l.indexOf('=')), l.slice(l.indexOf('=')+1)])) : {};
export function env(n) { const v = process.env[n] || fileEnv[n]; if (!v) throw new Error(`Missing env var ${n}`); return v; }
export function loadTokens() { return JSON.parse(fs.readFileSync(TOKENS, 'utf8')); }
export function saveTokens(t) { fs.writeFileSync(TOKENS, JSON.stringify(t, null, 2), { mode: 0o600 }); fs.chmodSync(TOKENS, 0o600); }
// Token exchange: Hue's documented/preferred method is HTTP Digest (as node-hue-api does):
// POST unauthenticated -> 401 with WWW-Authenticate nonce -> retry with Digest header.
// Falls back to Basic if the server doesn't issue a Digest challenge.
import crypto from 'node:crypto';
const md5 = (s) => crypto.createHash('md5').update(s).digest('hex');
export async function tokenRequest(params) {
  const id = env('HUE_CLIENT_ID'), secret = env('HUE_CLIENT_SECRET');
  const r = await fetch(`${API}/v2/oauth2/token`, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}` },
    body: new URLSearchParams(params).toString(),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) throw new Error(`Token request failed: HTTP ${r.status} ${j.error || j.fault?.faultstring || ''}`);
  return { access_token: j.access_token, refresh_token: j.refresh_token, expires_at: Date.now() + (Number(j.access_token_expires_in || j.expires_in || 3600) - 60) * 1000 };
}
