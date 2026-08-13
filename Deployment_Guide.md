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

## Federation System Configuration

### Central World
```env
IS_CENTRAL_WORLD=true
AUTO_CONNECT_CENTRAL=false
```

### Child World
```env
IS_CENTRAL_WORLD=false
CENTRAL_WORLD_URL=https://<central-world-address>
AUTO_CONNECT_CENTRAL=true
```

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
