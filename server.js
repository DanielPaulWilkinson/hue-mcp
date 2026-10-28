import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { API, loadTokens, saveTokens, tokenRequest } from './common.js';

let tok = null;
async function refresh() {
  const n = await tokenRequest({ grant_type: 'refresh_token', refresh_token: tok.refresh_token });
  tok = { ...tok, ...n, refresh_token: n.refresh_token || tok.refresh_token }; saveTokens(tok);
}
async function hue(method, path, body, retried = false) {
  if (!tok) { try { tok = loadTokens(); } catch { throw new Error('Not signed in: run `node auth.js` first'); } }
  if (Date.now() >= tok.expires_at) await refresh();
  const r = await fetch(`${API}/route/clip/v2/resource/${path}`, { method, headers: { Authorization: `Bearer ${tok.access_token}`, 'hue-application-key': tok.application_key, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  if (r.status === 401 && !retried) { await refresh(); return hue(method, path, body, true); }
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.errors?.length) throw new Error(`Hue ${method} ${path}: HTTP ${r.status} ${(j.errors || []).map(e => e.description).join('; ')}`);
  return j.data;
}
const out = (x) => ({ content: [{ type: 'text', text: JSON.stringify(x) }] });
const s = new McpServer({ name: 'hue', version: '0.1.0' });

s.tool('list_lights', 'List lights', {}, async () => out((await hue('GET', 'light')).map(l => ({ id: l.id, name: l.metadata?.name, on: l.on?.on, brightness: l.dimming?.brightness, mirek: l.color_temperature?.mirek ?? null }))));
async function groups(type) {
  const [gs, gl] = await Promise.all([hue('GET', type), hue('GET', 'grouped_light')]);
  const m = Object.fromEntries(gl.map(g => [g.id, g]));
  return gs.map(g => { const gid = g.services?.find(x => x.rtype === 'grouped_light')?.rid; const st = m[gid]; return { id: g.id, name: g.metadata?.name, on: st?.on?.on, brightness: st?.dimming?.brightness }; });
}
s.tool('list_rooms', 'List rooms', {}, async () => out(await groups('room')));
s.tool('list_zones', 'List zones', {}, async () => out(await groups('zone')));
s.tool('list_scenes', 'List scenes', {}, async () => out((await hue('GET', 'scene')).map(x => ({ id: x.id, name: x.metadata?.name, group: x.group?.rid, active: x.status?.active }))));

const params = { on: z.boolean().optional(), brightness: z.number().min(0).max(100).optional().describe('0-100 %'), mirek: z.number().int().min(153).max(500).optional(), kelvin: z.number().int().min(2000).max(6500).optional() };
function body({ on, brightness, mirek, kelvin }) {
  const b = {};
  if (on !== undefined) b.on = { on };
  if (brightness !== undefined) b.dimming = { brightness };
  const m = mirek ?? (kelvin ? Math.round(1e6 / kelvin) : undefined);
  if (m !== undefined) b.color_temperature = { mirek: Math.min(500, Math.max(153, m)) };
  if (!Object.keys(b).length) throw new Error('Nothing to set');
  return b;
}
s.tool('set_light', 'Set a light: on/off, brightness 0-100, colour temperature (mirek or kelvin)', { id: z.string(), ...params }, async (a) => out(await hue('PUT', `light/${a.id}`, body(a))));
for (const type of ['room', 'zone']) {
  s.tool(`set_${type}`, `Set all lights in a ${type} (via its grouped_light)`, { id: z.string(), ...params }, async (a) => {
    const g = (await hue('GET', `${type}/${a.id}`))[0];
    const gid = g?.services?.find(x => x.rtype === 'grouped_light')?.rid;
    if (!gid) throw new Error(`No grouped_light for ${type} ${a.id}`);
    return out(await hue('PUT', `grouped_light/${gid}`, body(a)));
  });
}
s.tool('recall_scene', 'Activate a scene', { id: z.string() }, async ({ id }) => out(await hue('PUT', `scene/${id}`, { recall: { action: 'active' } })));
const tp = (t) => { if (!t) return null; const x = t.time_point || t; const h = x.time || x; if (h?.hour === undefined) return x.type || x.kind || null; const hm = `${String(h.hour).padStart(2, '0')}:${String(h.minute ?? 0).padStart(2, '0')}`; return (x.type || x.kind) && (x.type || x.kind) !== 'time' ? `${x.type || x.kind} ${hm}` : hm; };
function targets(o) { const r = new Set(); (function walk(v) { if (!v || typeof v !== 'object') return; if (v.rid && ['room', 'zone'].includes(v.rtype)) r.add(`${v.rtype}:${v.rid}`); Object.values(v).forEach(walk); })(o); return [...r]; }
function sched(c = {}) {
  const w = c.when_extended || c.when || {};
  const s = { days: w.recurrence_days ?? c.when?.recurrence_days ?? null };
  if (w.start_at || w.end_at) { s.start = tp(w.start_at); s.end = tp(w.end_at); } else if (w.time_point) s.time_point = tp(w.time_point);
  return s;
}
s.tool('list_routines', 'List Hue automations (behavior_instance) and smart scenes', {}, async () => {
  const [bi, ss] = await Promise.all([hue('GET', 'behavior_instance'), hue('GET', 'smart_scene')]);
  return out([
    ...bi.map(b => ({ id: b.id, type: 'automation', name: b.metadata?.name, enabled: b.enabled, status: b.status, schedule: sched(b.configuration), targets: targets(b.configuration?.where ?? b.configuration) })),
    ...ss.map(x => ({ id: x.id, type: 'smart_scene', name: x.metadata?.name, state: x.state, schedule: (x.week_timeslots || []).map(w => ({ days: w.recurrence, slots: (w.timeslots || []).map(t => tp(t.start_time)) })), targets: x.group ? [`${x.group.rtype}:${x.group.rid}`] : [] })),
  ]);
});
s.tool('set_routine_enabled', 'Enable/disable an automation, or activate/deactivate a smart scene', { id: z.string(), type: z.enum(['automation', 'smart_scene']), enabled: z.boolean() }, async ({ id, type, enabled }) =>
  out(type === 'automation' ? await hue('PUT', `behavior_instance/${id}`, { enabled }) : await hue('PUT', `smart_scene/${id}`, { recall: { action: enabled ? 'activate' : 'deactivate' } })));
await s.connect(new StdioServerTransport());
