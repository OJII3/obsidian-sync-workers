# Obsidian Sync Workers

A self-contained Obsidian sync system powered entirely by Cloudflare - a monorepo containing a Workers + D1 + R2 server and an Obsidian plugin.

## Overview

This is an Obsidian sync server that runs entirely on Cloudflare services. No external databases like CouchDB are required, and it can be operated within Cloudflare's free tier.

This project consists of two packages:

1. **Server (`packages/server`)** - Sync server using Cloudflare Workers and D1 database
2. **Plugin (`packages/plugin`)** - Obsidian plugin (client-side)

### Key Features

- Document CRUD operations
- Revision management and conflict detection
- Change feed (incremental sync)
- Soft delete
- Multi-vault support
- Auto sync / manual sync
- Conflict resolution UI (auto merge + manual selection)
- Attachment sync (R2)

## Architecture

```
Obsidian Plugin (Client)
    ↓
Cloudflare Workers (Elysia Framework)
    ↓
D1 Database (SQLite) + R2 (Attachments)
```

## Setup

### Prerequisites

- Bun (latest version recommended)
- Cloudflare account (for server deployment)
- Wrangler CLI (can be run via `bunx wrangler`)

### 1. Clone the Repository and Install Dependencies

```bash
git clone https://github.com/OJII3/obsidian-sync-workers.git
cd obsidian-sync-workers

bun install
```

## Server Setup

### 0. Generate and Configure API Key (Required)

```bash
openssl rand -hex 32
```

Configure the generated key as follows:

- **Local development**: Add `API_KEY=your-generated-key` to `packages/server/.dev.vars`
- **Production**: Set via `wrangler secret put API_KEY` command

Use the same API key for both the server and the plugin.

### 1. Create D1 Database

```bash
cd packages/server

bunx wrangler d1 create obsidian-sync
```

Set the output `database_id` in `wrangler.jsonc` under `d1_databases[0].database_id`.

### 2. Apply Database Schema

```bash
# Production
bun run db:init

# Local development
bun run db:local
```

### 3. Create R2 Bucket (for Attachment Sync)

```bash
bunx wrangler r2 bucket create obsidian-attachments
```

The R2 binding is already configured in `wrangler.jsonc`.

### 4. Start Local Development Server

```bash
# From packages/server directory
bun run dev

# Or from root directory
bun run dev:server
```

The server will start at `http://localhost:8787`.

### 5. Deploy

#### Method 1: GitHub Actions (Recommended)

Deploy by forking the repository and using GitHub Actions.

1. Fork this repository

2. Prepare in Cloudflare Dashboard:
   - Create D1 database (`obsidian-sync`)
   - Create R2 bucket (`obsidian-attachments`)
   - Create API token (requires Workers edit permission)

3. In your forked repository, go to Settings → Secrets and variables → Actions and set:
   - `CLOUDFLARE_API_TOKEN`: Cloudflare API token
   - `CLOUDFLARE_ACCOUNT_ID`: Cloudflare account ID

4. Update the `database_id` in `packages/server/wrangler.jsonc` with the actual value and commit

5. Go to the Actions tab and manually run the "Deploy Server" workflow (Run workflow)

6. After deployment, set the API key via Cloudflare Dashboard or CLI:
   ```bash
   bunx wrangler secret put API_KEY
   ```

#### Method 2: Manual Deploy

```bash
# Set API key for production
cd packages/server
bunx wrangler secret put API_KEY
# Enter API key at the prompt

# Deploy
bun run deploy

# Or from root directory
bun run build:server
```

## Plugin Setup

### Development Mode

```bash
# From packages/plugin directory
bun run dev

# Or from root directory
bun run dev:plugin
```

### Build

```bash
# From packages/plugin directory
bun run build

# Or from root directory
bun run build:plugin
```

### Install to Obsidian

1. Copy the entire `packages/plugin` directory to Obsidian's plugin folder:
   ```bash
   # Linux/Mac
   cp -r packages/plugin /path/to/your/vault/.obsidian/plugins/obsidian-sync-workers

   # Windows
   xcopy packages\plugin C:\path\to\your\vault\.obsidian\plugins\obsidian-sync-workers /E /I
   ```

2. Restart Obsidian
3. Go to Settings → Community plugins → Enable Obsidian Sync Workers

### Plugin Configuration

1. Open Settings → Obsidian Sync Workers
2. Set **Server URL** (e.g., `https://your-worker.workers.dev` or `http://localhost:8787`)
3. Enter the same **API key** as the server
4. Set **Vault ID** (default: `default`)
5. Enable **Auto sync** (optional)
6. Set **Sync interval** (choose from 5 seconds to 60 minutes)
7. Enable **Sync attachments** (to sync binary files like images)
8. Click **Test** to test server connection
9. Click **Sync now** to perform manual sync

## Usage

### Manual Sync

- Click the sync button in the ribbon
- Run "Sync now" from the command palette (Ctrl/Cmd+P)

### Auto Sync

Enable **Auto sync** in settings to automatically sync at the specified interval.

### Commands

- `Sync now` - Execute sync immediately
- `Toggle auto sync` - Toggle auto sync on/off

## Troubleshooting

### Cannot Connect to Server

1. Verify the server is running
2. Check if Server URL is correct
3. Verify API key is configured (saved in plugin)
4. If CORS error, check CORS settings on server side

### Sync Not Working

1. Test connection with Test button
2. Check browser console logs
3. Check server logs

### Plugin Not Showing

1. Verify plugin is correctly copied to plugin folder
2. Verify `main.js` is built
3. Restart Obsidian

## Specifications and Development Notes

For specifications and internal implementation details, see `CLAUDE.md`. For development notes on each package, refer to:

- `CLAUDE.md`
- `packages/server/CLAUDE.md`
- `packages/plugin/CLAUDE.md`

## License

MIT
