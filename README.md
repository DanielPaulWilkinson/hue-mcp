# hue-mcp

Talk to your Philips Hue lights through an AI assistant. This is a small [Model Context Protocol](https://modelcontextprotocol.io) server: an assistant such as Claude, Cursor or Grok Bot can list your lights and change them when you ask in plain English ("dim the lounge to 30%", "turn on the evening scene").

It uses the official Hue Remote API (CLIP v2), so it works from anywhere without opening your home network.

## Tools

| Tool | What it does |
| --- | --- |
| `list_lights` | Lights with on/off, brightness and colour |
| `list_rooms` | Rooms and their lights |
| `list_zones` | Zones and their lights |
| `list_scenes` | Scenes, with the room or zone each belongs to |
| `set_light` | Change one light: on/off, brightness, colour temperature |
| `set_room` | Change every light in a room |
| `set_zone` | Change every light in a zone |
| `recall_scene` | Turn a scene on |
| `list_routines` | Automations and smart scenes, with schedules |
| `set_routine_enabled` | Turn an automation or smart scene on or off |

Colour temperature takes `mirek` (153 to 500) or `kelvin` (2000 to 6500, converted and clamped).

## Setup

1. Register a Remote API app at [developers.meethue.com](https://developers.meethue.com) with the callback URL `http://localhost:8765/callback`.
2. `npm install`
3. Copy `.env.example` to `.env` and fill in your own values:

       HUE_CLIENT_ID=your-client-id
       HUE_CLIENT_SECRET=your-client-secret
       HUE_APP_ID=your-app-id

4. Sign in once: `npm run auth`, open the printed link and approve. This links your bridge and saves tokens to `.tokens.json`.
5. Add it to your assistant as a stdio MCP server: command `node`, args `["/path/to/hue-mcp/server.js"]`.

## Security

- No keys, tokens, bridge addresses or home details are in this repo. `.env` and `.tokens.json` are gitignored, and the token file is written with owner-only permissions (600).
- Only talks to `api.meethue.com` over HTTPS using your own OAuth sign-in; nothing is sent anywhere else.
- Runs on your own machine over stdio. It does not open a port, apart from the one-off sign-in callback on localhost.
- Anyone who can run it can control your lights, so keep the token file private.
