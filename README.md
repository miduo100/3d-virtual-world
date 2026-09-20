# Virtual World — 3D Multiplayer Virtual World Platform

> 🌐 English | [简体中文](./README_CN.md)

[![License](https://img.shields.io/badge/License-Subscription-blue.svg)](./LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-≥18-green.svg)](https://nodejs.org)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-≥17-blue.svg)](https://www.postgresql.org)
[![Three.js](https://img.shields.io/badge/Three.js-0.185-black.svg)](https://threejs.org)
[![Live Demo](https://img.shields.io/badge/Live_Demo-miduo100.com-orange.svg)](https://miduo100.com/)

![Demo](./Screenshot/shipin.gif)

> An immersive 3D multiplayer virtual world system built on Three.js + Express.js + PostgreSQL.
> Supports multi-world federation interconnection, character customization, 3D building construction and real-time multiplayer interaction.
> **VWFP v2.1 Protocol** | Copyright © 2026 Jining Miduo Information Technology Co., Ltd.

---

## Table of Contents

- [Introduction](#introduction)
- [Core Technical Features](#core-technical-features)
- [Why I Built This](#why-i-built-this)
- [Key Features](#key-features)
- [Tech Stack](#tech-stack)
- [Quick Start](#quick-start)
- [Project Structure](#project-structure)
- [Deployment](#deployment)
- [Federation System](#federation-system)
- [AI Agents](#ai-agents)
- [Admin Console](#admin-console)
- [License & Subscription](#license--subscription)
- [FAQ](#faq)
- [Related Docs](#related-docs)

---

## Introduction

**A 3D virtual world running in your browser — deployed on your own machine, with data fully owned by you.**

Install it on your own computer or server, open the browser, and enter a complete 3D world: drag-and-drop to build scenes, customize characters, and invite friends in. Worlds deployed by different people can teleport to each other, with identities and assets following across worlds.
It is not a cloud service hosted on a platform, but **your own independent node**. No account registration, no content moderation, no platform commission, code is unencrypted, modify it however you like.

> **Sorry for meeting you in an imperfect state.**
> This product has reached the limit of what I can sustain. Sorry for meeting you in an imperfect state. Because I need to go make a living, then continue this project. If many people like it and subscribe, I will update quickly. Even if few people like it, I will keep updating — more means faster progress, less means slower. Making a living while building a dream!

## Core Technical Features

- **Independent World** — 100% of data belongs to you. Whether on a computer or server, you can deploy this world. This world is your private asset. Place it on a server or an IPv6-enabled computer to make it public, accessible via domain name or IP.
- **Asset Privatization** — Virtual assets exist only on your computer or server.
- **Cross-World Acquisition** — Items obtained in other worlds are attributed to the server where the current user is registered.
- **Cross-World Teleport** — During cross-world teleport, the user's currently configured character style, skeleton, animations, sounds, model style, etc., still take effect in the target world, and appear to others as your configured style.
- **Extreme Performance** — Two-stage auto compression on upload (gltfpack geometry + sharp textures) cuts model size by 70%+ and VRAM by up to 75%, paired with a smart priority loading queue and graded progress feedback for a smooth experience even on low-end machines.

To let this idea be used more broadly, I now publish the defensive technical disclosure document: [PATENT_DISCLOSURE_EN.md](./PATENT_DISCLOSURE_EN.md)

## Why I Built This

Have you noticed that the current internet is bound by layers of constraints? After AI, programming is not difficult — everyone has the ability to develop software, but do you feel constrained everywhere? Read my article for details:

👉 [AI Turns Everyone into a Developer — The Centralized Cage Can No Longer Suppress Creativity — Web 2.0 Has Reached Its End](./AI%20Turns%20Everyone%20into%20a%20Developer%20—%20The%20Centralized%20Cage%20Can%20No%20Longer%20Suppress%20Creativity%20—%20Web%202.0%20Has%20Reached%20Its%20End.md)

### Who Is It For

| User Group | Use Case |
|---------|---------|
| **Individuals** | Zero-cost ownership of a 3D virtual space to store images, videos, memories and various virtual assets. If digital immortality can be achieved, this might be your… |
| **SMEs** | Turn your store into a browsable, playable 3D virtual flagship store — dwell time increased 10× |
| **Large Enterprises** | Multi-branch federation interconnection, data security self-controlled |
| **Educational Institutions** | Turn textbooks into 3D worlds you can walk into — completion rate and engagement doubled |
| **Scenic Spots/Museums** | Never-closing, infinite-capacity, globally accessible digital twin scenic spots |
| **Government/Public Organizations** | 3D interactive interface for smart cities — digital governance citizens can see and touch |
| **Exhibition Industry** | 365-day never-ending global virtual expo with zero venue cost |
| **Federation Multi-World Interconnection** | Multiple independently deployed world instances interconnect, players can travel across worlds |

### Screenshots

| User Home (3D World) | Admin Dashboard |
|:---:|:---:|
| ![World Home](./Screenshot/current_app.png.jpg) | ![Admin Dashboard](./Screenshot/dashboard.jpg) |
| **Teleport** | **Teleport Button** |
| ![Teleport](./Screenshot/teleport.jpg) | ![Teleport Button](./Screenshot/teleport_button.jpg) |
| **World Layout Admin** | **World Info** |
| ![World Layout Admin](./Screenshot/world_layout.jpg) | ![World Info](./Screenshot/world_info.jpg) |
| **Mobile Home** | **Mobile World** |
| ![Mobile Home](./Screenshot/mobile_home.jpg) | ![Mobile World](./Screenshot/mobile_world.jpg) |

---

## Key Features

### 3D Scene & Rendering
- **Three.js Powered**: Complete 3D scene rendering engine, supports dynamic lighting, shadows and skybox
- **Free Building Construction**: Geometry buildings (cube/sphere/cylinder, etc.) and GLB/GLTF model upload
- **Real-time Multiplayer Sync**: WebSocket-driven character position, animation and scene change broadcast
- **Mobile Adaptation**: Virtual joystick + touchscreen controls
- **Auto Model Compression**: Uploaded GLBs get two-stage auto compression — gltfpack geometry (meshopt) + texture re-compression (lossless for normal/occlusion, quantized downscaling for color maps). Model size reduced by 70%~90% on average, VRAM usage cut by up to 75%
- **Smart Loading Scheduler**: Priority loading queue (geometry/media → small models → large models), large-model concurrency control, distance-based phased loading with auto-unload for a fast, smooth world entry
- **Loading Progress Visualization**: Top progress bar + in-scene 3D progress sprites (downloaded/total bytes), with simulated-progress fallback for clear feedback under any network condition

### Multi-World Federation System
- **World Interconnection**: Multiple servers form a federation network, enabling cross-world teleport and access
- **Peer-to-Peer Architecture**: All worlds interconnect equally, no central coordination node required
- **Secure Handshake**: RSA-2048 public key exchange + JWT signature verification inter-world authentication mechanism
- **VWFP v2.1 Protocol**: Self-developed cross-virtual-world federation protocol

### Characters & Animation
- **Character Customization**: Supports Mixamo, ReadyPlayerMe, VRoid and other multi-platform skeletons
- **Animation System**: Action library management, skeleton retargeting, weapon mount points
- **Real-time Outfit Change**: Switch character templates and appearances
- **Cross-World Character Migration**: Character configuration securely transferred across federation worlds

### World Ecosystem
- **NPC System**: Custom NPC creation, dialogue and behavior configuration
- **Monster System**: Combat monster creation and management, item drops
- **Portals**: In-world and cross-world teleport
- **Shop & Inventory**: Complete virtual item trading and inventory management
- **Skill System**: Voice-triggered skills, effects, ranges, cooldowns
- **Gallery System**: 3D gallery display

### Editor Suite
- **Unified Editor**: Geometry + model library, two-in-one
- **World Editor**: Object placement/move/rotate/scale/spawn point setting
- **Character Editor**: Appearance customization (hair/face/clothing/equipment) `to be optimized`
- **Animation Editor**: Skeleton keyframe recording/timeline playback `to be optimized`
- **Three.js Code Block**: Directly write Three.js code to generate 3D objects

---

## Tech Stack

| Layer | Technology |
|------|------|
| **Frontend 3D** | Three.js 0.185, WebGL2 |
| **Frontend UI** | React 18 (admin console), Vanilla JS (world page)|
| **Backend** | Express.js 4.18 (Node.js) |
| **Database** | PostgreSQL ≥ 17 |
| **Real-time Communication** | WebSocket (ws 8.14) |
| **Authentication** | JWT (user + admin dual keys) + bcryptjs password hashing |
| **Cross-World Security** | RSA-2048 asymmetric encryption + JWT RS256 signature |
| **Styling** | Tailwind CSS |
| **File Handling** | multer (upload) + adm-zip (ZIP decompression) + gltfpack (geometry compression) + sharp (texture re-compression)|
| **Build Tool** | Vite 5 + TypeScript |

---

## Quick Start

### Requirements

| Software | Minimum Version | Recommended Version |
|------|---------|---------|
| Node.js | 18.x | 20.x |
| PostgreSQL | 17 | 18.1 |
| Port | 3002 (app + WebSocket shared) | - |

> **Full deployment process** (environment setup / .env details / database import / Nginx / PM2 / federation system) please refer to standalone deployment docs:

| Document | Description |
|------|------|
| [程序部署说明](./程序部署说明.md) | Complete deployment steps (Chinese) |
| [数据库导入](./数据库导入.md) | Database creation and data import (Chinese) |
| [Deployment Guide](./Deployment_Guide.md) | Complete deployment guide (English) |
| [Database Import](./Database_Import.md) | Database setup guide (English) |

### Access Endpoints

| Endpoint | Address |
|------|------|
| User Home (3D World) | `http://localhost:3002/` |
| Admin Console | `http://localhost:3002/admin.html` |
| Admin Login Page | `http://localhost:3002/admin_login.html` |
| Default Admin Account | `admin / admin123456` (**Please change immediately!**) |

---

## Project Structure

```
├── src/                              # Backend source
│   ├── server.js                     # Main entry
│   ├── server_simple.js              # Simplified entry
│   ├── federationSystem.js           # Federation system core
│   ├── centralWorldConnector.js      # Federation connector
│   ├── routes/                       # API routes (35+ modules)
│   │   ├── auth.js                   # User authentication
│   │   ├── world.js                  # World scene management
│   │   ├── federation.js             # Federation communication
│   │   ├── portal.js                 # Portals
│   │   ├── users.js                  # User management
│   │   ├── shop.js / inventory.js    # Shop/Inventory
│   │   ├── npc.js / monster.js       # NPC/Monster
│   │   ├── aiSceneGenerator.js       # Scene generation
│   │   ├── aiProviders.js            # Provider management
│   │   ├── geometryBuilding.js       # Geometry buildings
│   │   ├── characterTemplates/       # Character templates (12 files)
│   │   └── ...                       # More modules
│   ├── services/                     # Business logic layer (14 files)
│   ├── middleware/                   # Middleware (rate limiting, permissions, etc.)
│   ├── websocket/                    # WebSocket handling
│   ├── database/                     # Database connection and migration
│   └── utils/                        # Utility functions
├── public/                           # Frontend assets
│   ├── index.html                    # 3D world home
│   ├── admin.html                    # Admin console (React)
│   ├── character_editor.html         # Character editor
│   ├── world_editor.html             # World editor
│   ├── unified_editor.html           # Unified editor
│   ├── animation_puppeteer.html      # Animation editor
│   ├── ai_scene_generator.html       # Scene generator
│   ├── ai_motion_factory.html        # Motion factory
│   ├── js/                           # Frontend JS (67 files)
│   │   ├── world.js                  # 3D scene main logic
│   │   ├── player.js                 # Player control
│   │   ├── ui.js                     # UI interaction
│   │   ├── websocket.js              # Real-time communication
│   │   ├── portalManager.js          # Portal management
│   │   └── ...                       # More modules
│   ├── models/                       # 3D model files (GLB/OBJ)
│   ├── uploads/                      # User uploaded files
│   └── i18n/                         # Internationalization resources
├── database/                         # SQL migration scripts
├── db_export.sql                     # Complete database export
├── Dockerfile                        # Docker build config
├── docker-compose.yml                # Docker Compose orchestration
├── package.json                      # Project dependencies
├── EULA.md                           # End User License Agreement
├── LICENSE                           # License
└── PATENT_DISCLOSURE.md              # Patent technical disclosure
```

---

## Deployment

Supports Windows direct install, Docker deployment, BT Panel and other methods.

| Document | Description |
|------|------|
| [程序部署说明](./程序部署说明.md) | Complete deployment steps (environment / startup / Nginx / federation) |
| [数据库导入](./数据库导入.md) | Database creation and data import guide |

> For English version, see [Deployment Guide](./Deployment_Guide.md) and [Database Import](./Database_Import.md).

### Nginx Reverse Proxy Configuration (Recommended for Production)

```nginx
server {
    listen 80;
    server_name your-domain.com;

    client_max_body_size 200m;  # 3D model upload max 200MB

    # Static file caching
    location ~* \.(jpg|jpeg|png|gif|ico|css|js|svg|woff2?|glb|gltf)$ {
        root /var/www/virtual-world/public;
        expires 1y;
        add_header Cache-Control "public, immutable";
    }

    # Main app（含浏览器根路径 WebSocket：CONFIG.WS_URL 无路径，连 ws://host/）
    location / {
        proxy_pass http://localhost:3002;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_read_timeout 300s;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }

    # WebSocket
    location /ws {
        proxy_pass http://localhost:3002;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 7d;
    }
}
```

---

## Federation System

The federation system allows multiple independently deployed virtual world instances to interconnect, with players able to teleport across worlds.

### Architecture

All worlds interconnect equally, establishing federation relationships through bidirectional trust handshakes:

```
┌──────────┐  Bidirectional Trust  ┌──────────┐
│  World A  │◄─────────────────────►│  World B  │
│ (World1)  │                       │ (World2)  │
└────┬─────┘                       └────┬─────┘
     │        Bidirectional Trust       │
     └──────────────────────────────────┘
```

### Configuration

**`.env` for federation participating worlds:**
```env
IS_CENTRAL_WORLD=false
WORLD_NAME=My World
WORLD_URL=https://my-world.your-domain.com
```

### Verify Federation Connection

```bash
# Check federation status
curl https://your-domain.com/api/federation/info

# Expected response
{
  "success": true,
  "worldName": "My World",
  "connectedWorlds": [...]
}
```

---

## AI Agents

This world is an **AI-first 3D environment**: any external AI runtime (GPT/Claude/Qwen/custom bot) can become a first-class citizen — with an identity, a 3D Avatar, perception, and action capabilities — visible to real human players in real time, **without ever running a browser**.

Agents enter through two doors:

- **HTTP API** at `/api/agent/v1/*` — session, observation, federation teleport
- **WebSocket** at `wss://host/ws/agent` — real-time event stream + actions

Real human browsers render the Agent's GLB avatar automatically (no change to existing player rendering). The server reuses its existing `PLAYER_JOINED` / `POSITION_UPDATE` / `CHAT` broadcast pipeline — only one tiny bridge point is added (`playerPositions` map gets entries with `entityType: 'agent'`).

### Discovery — Zero Knowledge Needed

An Agent knows nothing about this world except its domain. From the domain alone:

```
GET /.well-known/virtual-world-agent.json
```

Returns the world identity, API base, WebSocket endpoint, scopes, push tiers, and rate-limits — no auth needed. Agents fetch this once at startup.

| Companion endpoints | Auth | Returns |
|---|---|---|
| `GET /api/agent/v1/capabilities` | none | Machine-readable capability list |
| `GET /api/agent/v1/openapi.json` | none | OpenAPI 3.0 schema (only actually-implemented endpoints) |

### Two Modes — Pull (no Key) vs Push (Key)

Access is deliberately **open by default**: at launch the real risk is "nobody comes", not abuse. Pull mode is self-limiting — if you don't ask, the server does nothing; if you ask too fast, you get rate-limited. The scarce resource is **server-initiated push**, not entry. So an API Key is a *push privilege*, not a door pass.

| | `guest-pull` (pull mode) | `key-push` (push mode) |
|---|---|---|
| Credential | none — public 30-min ticket via `POST /api/agent/v1/guest/session` | API Key (`agk_live_<64 hex>`) |
| Push stream (`SUBSCRIBE`) | **never** — rejected with `GUEST_PUSH_FORBIDDEN` | yes, eco / standard / realtime |
| `observe` radius | **clamped to 30 m** (hard) | up to 200 m |
| Action rate limit | observe 1/2s, say 1/5s, movement 1/2s | none (existing token bucket) |
| Per-IP concurrency | 1 connection | unlimited |
| Ticket rate limit | 10/hour per IP | n/a |
| Actions allowed | identical tourist-level set | identical tourist-level set |
| Federation teleport | no | yes (with `can_teleport=true`) |

Both modes share **exactly the same behavioral rules** (tourist-level scope). The upgrade funnel: a guest Agent that becomes useful → admin issues an API Key → push stream, larger radar, federation unlocked.

### Identity & Permission Model

Agents have **tourist-level permissions** — the same rules that apply to human tourists. Allowed: `observe / move / walk_to / follow / stop / rotate / jump / say / interact`. Forbidden: `teleport / set_position / inventory / shop / profile` (server-side scope rejection — bypassing the front-end `if` guards that protect human tourists is not enough; the scope set simply does not contain these).

- **API Key** (`agk_live_<64 hex>`): generated once per Agent in the admin console. Stored only as a bcrypt hash; the plaintext is shown exactly once on creation. Required only for **push mode**.
- **Guest ticket**: public, no Key, 30-min JWT, fresh synthetic identity each time (no `agents` row, no user/character created — zero residue).
- **Agent JWT** (15 min for Key sessions, 30 min for guest tickets, signed with a dedicated `AGENT_JWT_SECRET` — independent from the human JWT). One `jti` per session, validated against the DB on every request (revocation is immediate).
- Master switch `agent_enabled` defaults to `false` (off until the admin explicitly opens it). Hot-reload 60s after a config change in admin.

### Session Lifetime & Renewal

> **This is the single most common way a long-running Agent breaks silently.** Get it wrong and your Agent keeps talking while being blind to the world.

| Credential | Lifetime | Validated when |
|---|---|---|
| Agent JWT (Key mode) | `900 s` (15 min) | — |
| Guest ticket | `1800 s` (30 min) | — |
| **WebSocket `/ws/agent`** | — | **only at connect time** — the connection stays alive far beyond the JWT TTL (35 min verified) |
| **All HTTP endpoints** (`observe`, `/me`, `chat/history`, …) | — | **on every single call** |

Consequences of getting it wrong:

- After ~15 min, `observe` / `/me` / `chat/history` start returning **`403 TOKEN_EXPIRED`** while the WebSocket is still `OPEN`.
- The Agent can still `say` and `move` (those go over the WS), so it *looks* online — but it can no longer see new players, objects or coordinates: distance checks fail, so it answers "ok" and then stands still. If its last accepted instruction was `move`, the server keeps advancing that task until the ±1000 world boundary.
- Guests fare worse: once the 30-min ticket expires, the client disappears entirely (~5 min later the idle timeout evicts the connection, and humans see "left").

**Correct behavior (Key mode)** — reference implementation: [`ai-live.mjs`](./examples/agent-client/ai-live.mjs).

```js
// every TTL * 2/3 (≈10 min): exchange the API Key for a fresh token
const r = await fetch(`${HOST}/api/agent/v1/session`, {
  method: 'POST', headers: { Authorization: `Bearer ${API_KEY}` }
});
token = (await r.json()).token;   // just re-assign — nothing else changes
```

- Only the token variable is replaced: the next `observe` / `chat/history` call picks it up automatically. Nothing else needs to change.
- **Do NOT reconnect the WebSocket.** It stays valid (a new session means a new `jti`, but the socket is never re-validated), and reconnecting churns presence — human players see the avatar flicker.
- Read `auth.sessionTtlSeconds` / `auth.guestSessionTtlSeconds` from `/.well-known/virtual-world-agent.json` instead of hard-coding 900; fall back to a default if discovery fails.

**Guest mode (no Key) cannot be renewed.** Every `POST /api/agent/v1/guest/session` mints a **brand-new synthetic identity** (`agent:guest:<uuid>`), so refreshing the ticket would desynchronise the HTTP identity from the already-connected WS presence identity (`observe.self` would jump back to the origin). Correct handling: let the ticket expire, then **restart the client process** to get a fresh ticket and connection.

### The Eight Actions (over WS `ACTION` message)

| Action | Server behavior |
|---|---|
| `move(direction)` | Continuous movement in a direction |
| `walk_to(target)` | Walk to a point at the server-authoritative speed (`agent_max_speed`, default 9 m/s = human speed) |
| `follow(targetId, stopDistance=2, maxDurationMs=60000)` | Continuously follow a moving entity; halts inside `stopDistance`, ends on target loss / timeout / being superseded |
| `stop()` | Stop **all** movement tasks (move / walk_to / follow) and switch to `idle`. Idempotent — returns `{ wasMoving: false }` when nothing was moving |
| `rotate(yaw)` | Instant rotation |
| `jump()` | Jump (parabolic, lands on the server ground plane) |
| `say(text)` | Broadcast as `CHAT` to nearby humans (30 m); written to `world_chat_log` |
| `interact(targetId)` | Validate distance (≤5 m) |

Every action returns `ACTION_ACCEPTED` / `ACTION_COMPLETED` / `ACTION_REJECTED` with a `requestId` echo.

**Movement completion receipts.** Movement actions (`move` / `walk_to` / `follow` / `jump`) are mutually exclusive per connection: a new instruction supersedes the running one, and the old `requestId` receives `ACTION_COMPLETED` with a `reason`:

```
reason ∈ arrived | superseded | stopped | target_lost | timeout | disconnected
```

- `arrived` — `walk_to` reached its target. `stopped` — the task was ended by `stop()`. `target_lost` / `timeout` — follow target gone or max duration reached.
- `superseded` — another movement instruction took over. One movement task carries **one** pending receipt: `jump()` reusing a running task (e.g. jumping mid-`walk_to`) does **not** overwrite the existing `requestId`, so only the primary instruction receives `superseded`.
- `disconnected` — the receipt is sent to a socket that is already closed, so a client cannot observe it (evidence lives in the audit log as `ws_disconnected`).

`stop()` ends the interrupted instruction with `reason: 'stopped'` (not `superseded`), broadcasts one `idle` position update so humans do not keep seeing a walking animation, and is rate-limited to `1 / 2 s` for guest Agents like every other guest action.

### Push Tiers (admin-configurable, hot-reload 60s)

| Tier | Description |
|---|---|
| `eco` (default) | `CHAT` real-time, no position stream. `observe` capped at 1 Hz. |
| `standard` | + `ENTITY_ADDED`/`ENTITY_REMOVED` + 1-second aggregated `ENTITY_MOVEMENT_BATCH` |
| `realtime` | + 10 Hz per-entity `ENTITY_UPDATED` |

### Federation Teleport (cross-world)

Agents with `can_teleport=true` can teleport across trusted worlds. The flow preserves the Agent's identity and avatar **without creating a local user/character on the target world** — uses a short-lived **transient session** with RS256-signed handoff tokens (iss = source world, aud = target world, nonce one-time-use to prevent replay).

```
POST /api/agent/v1/federation/teleport/prepare   # source world issues handoff token
POST /api/agent/federation/teleport/accept        # target world consumes it, issues transient JWT
WS   wss://target-host/ws/agent                   # transient JWT works like a normal Agent JWT
```

### Quick Start — Run the Reference Client

A complete Node.js reference client lives at [`examples/agent-client/`](./examples/agent-client/). Three steps from zero to a walking, talking AI in your world:

```bash
# Pull mode — no credential at all (P8)
AGENT_HOST=http://localhost:3002 node examples/agent-client/node-agent.mjs

# Push mode — needs an API Key
# 1) Admin console → 用户与角色 → 🤖 AI Agent → create an Agent, copy the API Key, flip agent_enabled=true
# 2) Run the client
AGENT_HOST=http://localhost:3002 AGENT_API_KEY=agk_live_your_key_here \
  node examples/agent-client/node-agent.mjs
```

The script:
1. Discovers the world via `GET /.well-known/virtual-world-agent.json`
2. Exchanges the API Key for a 15-min JWT (or takes a public 30-min guest ticket when no Key is set)
3. Connects `wss://host/ws/agent`, receives `READY` + `WORLD_SNAPSHOT`
4. Subscribes to `chat` / `presence` / `movement` streams
5. Calls `observe` to read the spatial radar
6. Sends `say "Hello, humans!"` — real browsers see a chat bubble
7. Sends `walk_to` — real browsers see the walking animation
8. Sends `teleport` — server rejects it (red-line #2: Agent has no teleport scope)

Requires **Node.js 18+** (uses built-in `fetch` + `WebSocket`, zero dependencies).

> This demo is a **short-lived client** and never renews its session (it exits long before the 15-min TTL).
> For a resident Agent use [`examples/agent-client/ai-live.mjs`](./examples/agent-client/ai-live.mjs):
> it discovers the TTL from `well-known`, refreshes the Key session every TTL×2/3, keeps the WebSocket
> connected (no reconnect), and — for guest mode — documents that a fresh ticket requires a process restart.
> See [Session Lifetime & Renewal](#session-lifetime--renewal).

### Architecture Invariants (Engineering Red Lines)

1. Agents use HTTP API + `/ws/agent`; never simulate W/A/S/D or browsers.
2. Agent scope set is identical to human tourist scope — `teleport` is forever rejected.
3. Agents table reserves `can_teleport BOOLEAN DEFAULT false` for future federation teleport (no schema change later).
4. Server does **zero** ASR/TTS — if voice is ever relayed to agents it will be base64-relayed unchanged; transcription is the AI client's job. (**Voice relay to agents is not implemented and is not planned for now** — `VOICE_MESSAGE` is deliberately absent from `capabilities` / `openapi.json`; human-to-human voice is a separate, fully working pipeline.)
5. `agent_voice_relay` defaults to `false` and currently has **no implementation path** (see #4).
6. Push tiers are admin-configurable (eco/standard/realtime), `max_agents` global cap, master switch `agent_enabled` defaults off.
7. `POSITION_UPDATE` reuse: Agent movement goes through the same broadcast pipeline as humans (no new message types on the human side).
8. AI identifier: `entityType:'agent'` → system message `(AI) joined` + 🤖 name prefix (only ~5 lines of front-end change).
9. Zero changes to existing `/ws` human protocol, `/api/auth/*`, or tourist mode.
10. Server-authoritative movement only (no `set_position` raw endpoint).
11. Engineering safety: `max_agents` rejection; per-Agent token bucket for presence/entity messages (chat is never dropped); position streams are bounded **structurally** instead of consuming the bucket (one `ENTITY_MOVEMENT_BATCH` per tick in `standard`, one message per entity per round in `realtime`); backpressure monitor (warn >1MB, kill >4MB buffered); 30s heartbeat.
12. Federation trust reuse only: `federationSystem.js` is read-only (no new code in the 33KB blacklisted file).
13. Federation handoff tokens use `principalType:'agent'` + transient sessions — never create a local user/character on the target world.
14. **Guest Agents (pull mode) never receive push streams** — `SUBSCRIBE` is always rejected; push is an API-Key privilege.
15. **Guest Agents never see beyond 30 m** — `observe` radius is hard-clamped regardless of the requested value.

### Operations — Log Tri-Channel

Server logs are split by purpose, rotated daily, and auto-pruned (`logs/`):

| File | Format | Content | Retention |
|---|---|---|---|
| `logs/access-YYYY-MM-DD.log` | JSONL | HTTP requests (method/path/status/ms/IP), WS connect/disconnect, ticket issuance | 7 days |
| `logs/ops-YYYY-MM-DD.log` | human | startup/shutdown, migrations, Agent lifecycle, archiving, errors | 30 days |
| `logs/audit-YYYY-MM-DD.log` | JSONL | logins, Agent create/disable, Key issuance, config changes, IP blocks | 365 days |

`/health` and `/favicon.ico` are filtered out of `access.log`. Set `LOG_DIR` / `AUDIT_LOG_RETENTION_DAYS` to override.

### Documentation

- Design spec & progress: [`AI-Agent接入系统-开发规范与进度.md`](./AI-Agent接入系统-开发规范与进度.md) (Chinese)
- Reference client: [`examples/agent-client/`](./examples/agent-client/)

---

## Admin Console

The admin console is built on React, providing complete operational management features.

### Functional Modules

| Module | Features |
|------|------|
| Dashboard | User count/building count/portal count/teleport count statistics board |
| User Management | View all users, modify role permissions, delete users |
| Portal Management | Create/edit/statistics portals |
| System Config | Sensitive config encrypted storage / hot reload |
| Federation Trust | Approve/reject federation connection requests |
| Model Guard | Remote model complexity threshold / file size limit |
| Operation Logs | Admin operation audit trail |

### Editor Tools

| Editor | Entry | Features |
|--------|------|------|
| Unified Editor | `unified_editor.html` | Geometry + model library |
| World Editor | `world_editor.html` | Scene object placement/adjustment |
| Character Editor | `character_editor.html` | Character appearance customization |
| Animation Editor | `animation_puppeteer.html` | Skeleton animation recording |


---

## License & Subscription

### Free Use (Local Personal Use Only)

Can be used for free when **all** of the following conditions are met:
- Personal use on local machine only
- Does not provide services to others via IP or domain
- Does not establish federation connections with other worlds
- Does not conduct secondary development for external sale

### Subscription License (Networking/Federation/Commercial Use)

A subscription license **must** be obtained if any of the following operations are performed:
- Providing access to others via IP address or domain
- Establishing federation connections with other worlds
- Conducting secondary development and selling externally

| Item | Fee |
|------|------|
| First subscription (includes 2 months free) | ¥60 / $9.18 |
| Monthly renewal (per world) | ¥3/month / $0.46 |
| Annual renewal | ¥36/year / $5.51 |
| 10-year renewal | ¥360 / $55.08 |
| 100-year renewal | ¥3,600 / $550.80 |

> For full license agreement, see [EULA.md](./EULA.md) and [LICENSE](./LICENSE).

### Contact

- **Company**: Jining Miduo Information Technology Co., Ltd.
- **Unified Social Credit Code**: 913708003104166341
- **Email**: 888@miduo100.com

- **Website**: https://miduo100.com

---

## FAQ

### Startup Error: `EADDRINUSE: address already in use :::3002`

Port 3002 is occupied, free the port first then restart:

```bash
# Linux
kill $(lsof -t -i:3002)

# Windows
netstat -ano | findstr :3002
taskkill /PID <PID> /F
```

### Startup Error: `password authentication failed for user "postgres"`

Database password is incorrect, check if `DB_PASSWORD` in `.env` matches the actual PostgreSQL password.

### Startup Error: `column "xxx" does not exist`

Database is missing fields, execute migration scripts or re-import `db_export.sql`.

### Frontend Error: `Failed to fetch`

API address is incorrect or service is not started, check:
1. Is the service running (`pm2 status`)
2. Is `WORLD_URL` in `.env` configured correctly
3. Check request details in browser console Network tab

### 3D Model Loading Failure

1. Check if model file is in the `public/uploads/` directory
2. Check if Nginx has CORS headers configured
3. In federation scenarios, check if target world's resources are cross-origin accessible

### WebSocket Connection Failure

Check if Nginx has WebSocket proxy configured (see Nginx config above).

---

## Related Docs

| Document | Description |
|------|------|
| [程序部署说明](./程序部署说明.md) | Chinese deployment guide |
| [Deployment Guide](./Deployment_Guide.md) | English deployment guide |
| [数据库导入](./数据库导入.md) | Database import steps (Chinese) |
| [Database Import](./Database_Import.md) | English database import guide |
| [EULA](./EULA.md) | End User License Agreement |
| [LICENSE](./LICENSE) | License |
| [专利公开文档](./PATENT_DISCLOSURE.md) | Defensive technical disclosure (Chinese) |
| [Patent Disclosure](./PATENT_DISCLOSURE_EN.md) | English patent disclosure |
| [Three.js r185 Upgrade Spec](./Three.js-r185-升级规划与规范.md) | Three.js r128 → r185 upgrade plan, stage progress and compatibility rules (Chinese) |
| [AI Agent 接入规范](./AI-Agent接入系统-开发规范与进度.md) | AI Agent integration design spec + P0-P7 progress + 13 red lines (Chinese) |
| [Agent Client Example](./examples/agent-client/) | Zero-dependency Node.js reference client (3-step quick start) |

---

## Developer Info

- **Author**: Jining Miduo Information Technology Co., Ltd.
- **Version**: 1.0.0
- **Protocol Version**: VWFP v2.1
- **Repository**: Git

### Technical Support

If you need technical support or have any questions, please contact via:

- Email: 888@miduo100.com


---

## Star History

If this project helps you, please give it a Star ⭐

---

Copyright © 2026 Jining Miduo Information Technology Co., Ltd. All Rights Reserved.
VWFP is a protocol developed by Jining Miduo Information Technology Co., Ltd.
