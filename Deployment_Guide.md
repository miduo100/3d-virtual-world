# virtual-world Deployment Guide

## System Requirements
- Node.js: Recommended 20.x, minimum 18.x
- Package Manager: NPM
- Database: PostgreSQL 18.1, minimum PostgreSQL 17
- Port: 3002

## Quick Deployment

### 1. Install Dependencies

> **Note**: The project already includes the `node_modules` directory and can be used directly without reinstalling.

If you need to reinstall dependencies:
```bash
npm install
```

**For Linux users**: The `linux_node_modules.gz` file in the project root is a pre-compiled dependency package for Linux environments. Extract and use:
```bash
tar -xzf linux_node_modules.gz
```

### 2. Configure Environment Variables

> **Complete the database import first**: Follow the steps in `Database_Import.md` to create the database and import data before configuring `.env` below.

The project root already contains a `.env` file. Simply open and edit it with a text editor (such as Notepad or VS Code) — no command-line editing required.

You must modify the following configuration items:
- `DB_PASSWORD` — Database password (enter your local PostgreSQL password)
- `DB_NAME` — Database name (default: `virtual_world`)
- `DB_USER` — Database username (default: `postgres`)
- `DB_HOST` — Database address (`localhost` for local)
- `DB_PORT` — Database port (default: `5432`)
- `JWT_SECRET` — JWT secret key (generate with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`)
- `ADMIN_JWT_SECRET` — Admin JWT secret key (generate the same way as above)
- `WORLD_NAME` — World name
- `WORLD_URL` — World access URL

### 3. Database Import

The database has been fully exported via `db_export.sql` and can be imported directly. Please refer to `Database_Import.md` for detailed steps.

### 4. Start the Service
```bash
# Development mode
npm start

# Production mode (PM2 recommended)
npm install -g pm2
pm2 start src/server.js --name virtual-world
pm2 save
pm2 startup
```

### 5. Access

**Direct access**：
- User Portal: http://<your-server-ip>:3002/
- Admin Panel: http://<your-server-ip>:3002/admin.html
- Default admin account: admin / admin123456 (change immediately)

**Via Nginx reverse proxy with domain**：
- Point your domain to the server IP via DNS
- Configure Nginx reverse proxy to forward port 80/443 requests to local port 3002
- Access via `https://your-domain` without specifying a port number

## AI Agent Access: Deployment Checklist & Troubleshooting

> **Why a dedicated section**: the AI Agent discovery document
> (`/.well-known/virtual-world-agent.json`) is the **only entry point** for external AI to
> discover and enter this world. If any link in this chain is broken, AI fails at the very first
> step — and in most cases **it fails silently, with nothing in the logs** — so verify every item
> below after deployment.

### 1. Nginx Reverse Proxy: two required headers

```nginx
proxy_set_header X-Forwarded-Proto $scheme;                      # (1) tell backend "outer is https"
proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;   # (2) pass the real client IP
```

**BT Panel (宝塔) note**: the proxy config is **not** in the site config file. It lives in
`/www/server/panel/vhost/nginx/proxy/<domain>/<hash>_<domain>.conf` (included by the site config).
Locate it with:

```bash
grep -rn "3002" /www/server/panel/vhost/nginx/
```

#### (1) Missing `X-Forwarded-Proto` → AI clients are blocked on the very first hop

Without it, `deriveBaseUrl()` (`src/routes/agent/meta.js`) can only guess `http://`, so the
discovery document advertises:

```json
"world":     { "url": "https://your-domain/" },                 ← correct
"endpoints": { "apiBase": "http://your-domain/api/agent/v1" }  ← wrong (plain http)
```

Two sources in one response disagree on the protocol. AI clients running on an https page are
then blocked by the browser's **Mixed Content** policy — with no server-side error at all.

Verify:

```bash
curl -s "https://your-domain/.well-known/virtual-world-agent.json?t=$RANDOM" | grep -o '"apiBase": "[^"]*"'
# Expect https://...  — if it's http://..., the header is missing (or nginx was not reloaded)
```

#### (2) Missing `X-Forwarded-For` → the whole world is treated as ONE IP (subtler)

`resolveClientIp()` (`src/middleware/clientIp.js`) cannot obtain the real IP, so **every visitor
shares the same IP** behind the proxy. AI Agent access has two per-IP limits — **1 guest
connection per IP** and **10 guest tickets per hour per IP** → **only one guest AI can be online
worldwide**; the second is rejected with `GUEST_IP_CONCURRENCY`.

This failure is **completely silent**; it merely makes AI access look "unpopular".
Mandatory to check for multi-world deployments and hand-written Nginx configs.

Verify:

```bash
grep -c "X-Forwarded-For" /www/server/panel/vhost/nginx/proxy/<domain>/*.conf   # expect >= 1
```

### 2. BT Panel: three gotchas

| Gotcha | What to do |
|---|---|
| `#PROXY-START` / `#PROXY-END` is **managed by the panel** | Manually added lines are overwritten on the next "Reverse Proxy → Save". Don't click Save after editing by hand |
| The `location ~ \.well-known` rule in the site config | **No action needed.** The proxy's `location ^~ /` carries `^~`, which stops regex matching; and that rule's blacklist (`php\|jsp\|py\|js\|css…`) does **not** include `json` |
| `curl https://your-own-domain` returns nothing, on the server itself | Not a misconfiguration — it is **Alibaba Cloud ECS hairpin NAT**. Use `curl -H "Host: your-domain" http://127.0.0.1:3002/...`, or verify from **outside** |

Always finish with: `nginx -t && nginx -s reload`

### 3. Homepage SEO must be **server-injected**, not JS-only

**The trap**: if the homepage `<title>` / `<meta>` tags are updated by browser-side JavaScript
(e.g. `fetch('/api/config/seo')` and then rewriting `document.title`), then — **AI crawlers and
search engines do not execute JavaScript**. They only ever see the hard-coded markup in the HTML
file, so the admin panel's "SEO TDK" settings are **invisible to them**.

What makes it vicious: when the admin value and the hard-coded value happen to be identical,
**you cannot see the problem at all** — you only notice after changing the value in the panel and
observing that nothing happens on the crawler side.

**How this project solves it**: `src/services/seoHtmlInjector.js` injects the SEO config from
`system_config` into the homepage HTML **on the server side**, so browsers and crawlers receive
one and the same document:

```
Admin panel "SEO TDK" (single source of truth)
        ↓ server-side injection (10s cache)
    one single HTML ──┬─> browsers ✅
                      └─> AI crawlers / search engines / share cards ✅
```

**Three things not to break when editing code:**

1. In `src/server.js`, `app.get(['/', '/index.html'], seoHtmlInjector.handler)` **must be
   registered BEFORE `express.static`** — otherwise requests are served from disk and injection
   never runs.
2. On error the injector calls `next()` and falls back to the static file → **the homepage can
   never 500**. Don't turn that into a throw.
3. After editing `server.js` you **must restart Node** (`pm2 restart <name>`), otherwise the
   injection route does not exist.

**How to tell whether injection is really active** (checking the homepage alone is misleading —
the static fallback text may happen to be the new copy too):

| Symptom | Meaning |
|---|---|
| `Content-Type: text/html; charset=utf-8` (**lowercase**) | ✅ injection is active |
| `Content-Type: text/html; charset=UTF-8` (**uppercase**) | ❌ served by `express.static`; injection is NOT active |

More reliable — compare the two sources byte-for-byte:

```bash
curl -s "https://your-domain/api/config/seo"                               # expected value
curl -s "https://your-domain/?t=$RANDOM" | grep -o "<title>[^<]*</title>"   # actual value
# They must match exactly. Mismatch = injection inactive (usually server.js not deployed, or Node not restarted)
```

### 4. Post-deployment self-check (5 checks)

```bash
D="your-domain"
curl -s "https://$D/.well-known/virtual-world-agent.json?t=$RANDOM" | grep -o '"apiBase": "[^"]*"'  # (1) must be https://
curl -s -o /dev/null -w "agents=%{http_code}\n"  "https://$D/agents/"       # (2) expect 200
curl -s -o /dev/null -w "llms=%{http_code}\n"    "https://$D/llms.txt"      # (3) expect 200
curl -s -o /dev/null -w "robots=%{http_code}\n"  "https://$D/robots.txt"    # (4) expect 200
curl -s -o /dev/null -w "sitemap=%{http_code}\n" "https://$D/sitemap.xml"   # (5) expect 200
```

Once all five pass, any AI that knows your domain can: **discover the world → obtain an identity
with zero credentials → walk and talk inside it**.

Optional deeper check (**consumes 1 guest ticket**):

```bash
cd <project-dir> && AGENT_HOST=https://$D node examples/agent-client/node-agent.mjs
```

### 5. Agent master switch (disabled by default)

| Config | Default | Notes |
|---|---|---|
| `agent_enabled` | **false** | **Master switch.** Set to `true` in the admin panel ("🤖 AI Agent") to open access |
| `max_agents` | 50 | Max concurrent agents |
| `agent_push_default` | eco | Default push tier (eco / standard / realtime) |

> While `agent_enabled=false`, the discovery document, `/capabilities` and `/openapi.json`
> **remain readable** (by design — even "is the switch on?" must be discoverable first), but
> `POST /api/agent/v1/session` and `/guest/session` return `503 AGENT_DISABLED_GLOBALLY`.

### 6. Troubleshooting quick reference

| Symptom | Most likely cause | Fix |
|---|---|---|
| `apiBase` is `http://` in the discovery doc | Nginx missing `X-Forwarded-Proto` | Add the header + `nginx -s reload` |
| Second AI rejected (`GUEST_IP_CONCURRENCY`) | Nginx missing `X-Forwarded-For`, or repeated tickets from one IP | Add the header; check per-IP limits (10 tickets/hour) |
| Changed SEO in the panel, crawlers still see the old text | Injection inactive (`server.js` not deployed / Node not restarted) | Compare `Content-Type` case + homepage title vs `/api/config/seo` |
| `/agents/`, `llms.txt` return 404 | Facade files not deployed | Upload `public/robots.txt`, `sitemap.xml`, `llms.txt`, `agents/index.html` |
| AI connects but sees no descriptions | World objects have no AI descriptions yet | Fill 🤖AI description in the admin panel, then run `scripts/sync_agent_descriptions.js` |
| WebSocket `/ws/agent` cannot connect | Nginx not passing `Upgrade` / `Connection` headers | See the Nginx section in `README.md` |

## Federation System Configuration

### Central World (hosting the federation)
```env
WORLD_URL=https://your-public-domain     # must be publicly reachable
AUTO_CONNECT_CENTRAL=false               # a central world never auto-connects
```

### Child World (default: joins the federation on startup)
```env
WORLD_URL=https://your-public-domain        # publicly reachable; the central world calls back to verify
CENTRAL_WORLD_URL=https://miduo100.com      # defaults to this when unset
AUTO_CONNECT_CENTRAL=true                   # set to false to opt out
```

> - `localhost` / `192.168.x.x` / `10.x.x.x` addresses are skipped automatically (use `FEDERATION_ALLOW_PRIVATE=1` for local testing only).
> - Watch the startup log: `✅ 成功连接到中心世界！` (connected) / `ℹ️  自动连接已禁用，跳过` (opt-out) / `⚠️  [联邦] 本世界 worldUrl 为内网/本机地址…` (private URL).
> - Check `GET /api/federation/central-status`; the central world lists you under its trusted worlds.

## Docker Deployment
```bash
docker compose up -d --build
```

## Directory Structure
```
├── src/              # Backend source code
│   ├── server.js     # Main entry point
│   ├── routes/       # API routes
│   ├── services/     # Business services
│   ├── middleware/   # Middleware
│   ├── database/     # Database modules
│   ├── websocket/    # WebSocket
│   └── utils/        # Utilities
├── public/           # Frontend resources
│   ├── js/           # Frontend JavaScript
│   ├── models/       # 3D models
│   ├── uploads/      # Uploaded files
│   └── *.html        # Pages
├── database/         # Database SQL (init.sql + migrations)
├── uploads/          # Root upload directory (character templates / building images)
├── .env.example      # Environment variable template
├── package.json      # Dependency configuration
└── Dockerfile        # Docker configuration
```

## Technical Support
Jining Miduo Information Technology Co., Ltd.
Contact: 888@miduo100.com / 15660440944
