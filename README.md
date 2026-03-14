# filePort — Local-First Shadow File System

A hybrid between **git**, **Syncthing**, and a **Headless CMS**.  
You interact with a synced database representation of your files, enabling offline editing and lazy syncing — all through your mobile device or browser.

---

## 📐 Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│  Your PC / Laptop                                                │
│  ┌──────────────┐    ┌──────────────────────────────────────┐   │
│  │  File System │───▶│  filePort Agent (Node.js + Chokidar) │   │
│  └──────────────┘    │  • Scans watched folders on startup  │   │
│                      │  • Pushes changes in real time        │   │
│                      │  • Reconciler pulls mobile edits back │   │
│                      └──────────────────┬───────────────────┘   │
└─────────────────────────────────────────┼────────────────────────┘
                                          │ HTTP / REST
                              ┌───────────▼──────────────┐
                              │  PocketBase (SQLite)      │
                              │  files collection         │
                              │  • path, name, content    │
                              │  • last_modified_local    │
                              │  • last_modified_mobile   │
                              │  • needs_sync flag        │
                              └───────────┬──────────────┘
                                          │ HTTP / REST
                         ┌────────────────▼──────────────────┐
                         │  filePort Web UI (Xterm.js)        │
                         │  • ls / cd / cat / edit commands   │
                         │  • In-browser text editor          │
                         │  • Save → sets needs_sync = true   │
                         └───────────────────────────────────┘
                                 (open on phone via Tailscale)
```

### Sync Flow

| Direction | Trigger | Mechanism |
|-----------|---------|-----------|
| PC → DB | File created/changed/deleted | Chokidar event → upsert record |
| DB → PC | `needs_sync = true` in DB | Reconciler loop (every 10 s) |
| Mobile → DB | User saves in Web UI | `POST /api/save` sets content + flag |

---

## 🛠 Tech Stack

| Layer | Technology |
|-------|-----------|
| Agent / file watcher | Node.js + [Chokidar](https://github.com/paulmillr/chokidar) |
| Database / sync layer | [PocketBase](https://pocketbase.io) (single-file SQLite backend) |
| Mobile / web UI | [Xterm.js](https://xtermjs.org) + Express.js |
| React Native mobile | React Native + [@supabase/supabase-js](https://supabase.com/docs/reference/javascript) |
| Remote connectivity | [Tailscale](https://tailscale.com) (zero-config VPN) |

---

## 🗂 Project Structure

```
filePort/
├── agent/                     # Node.js desktop agent
│   ├── src/
│   │   ├── index.js           # Entry point (CLI flags: --reconcile-only, --index-only)
│   │   ├── indexer.js         # Scans watched folders; builds + upserts file records
│   │   ├── watcher.js         # Chokidar real-time watcher
│   │   ├── reconciler.js      # Applies mobile edits back to the local filesystem
│   │   └── pocketbase.js      # PocketBase REST API client
│   ├── __tests__/             # Jest unit tests
│   │   ├── indexer.test.js
│   │   └── reconciler.test.js
│   ├── config.example.json    # Copy to config.json and edit
│   └── package.json
│
├── mobile/                    # React Native CLI component (Supabase)
│   ├── src/
│   │   ├── components/
│   │   │   └── TerminalCLI.jsx     # Terminal UI: ls, cd, pwd, help
│   │   ├── hooks/
│   │   │   └── useRemoteFiles.js   # Supabase query hook
│   │   ├── lib/
│   │   │   └── supabase.js         # Supabase client factory
│   │   └── utils/
│   │       └── pathUtils.js        # Path resolution utilities
│   ├── __tests__/             # Jest + @testing-library/react-native tests
│   │   ├── pathUtils.test.js
│   │   ├── useRemoteFiles.test.jsx
│   │   └── TerminalCLI.test.jsx
│   ├── .env.example           # SUPABASE_URL + SUPABASE_ANON_KEY
│   ├── babel.config.js
│   └── package.json
│
├── ui/                        # Web terminal UI
│   ├── server.js              # Express server (proxies PocketBase calls)
│   ├── public/
│   │   └── index.html         # Xterm.js terminal SPA
│   └── package.json
│
├── pocketbase/
│   └── pb_schema.json         # PocketBase collection schema
│
└── README.md
```

---

## 🚀 Getting Started

### Prerequisites

- **Node.js** ≥ 18
- **PocketBase** binary — [download](https://pocketbase.io/docs/) and place in `pocketbase/`
- (Optional) **Tailscale** for remote access

---

### 1. Start PocketBase

```bash
cd pocketbase
./pocketbase serve
```

Open [http://127.0.0.1:8090/_/](http://127.0.0.1:8090/_/) and create an admin account.

Import the schema:

```bash
# Use PocketBase's import endpoint or paste pb_schema.json into the admin UI
./pocketbase import pb_schema.json
```

---

### 2. Configure the Agent

```bash
cd agent
cp config.example.json config.json
# Edit config.json:
#   • watchedFolders  – absolute paths you want to sync
#   • pocketbaseUrl   – where PocketBase is running
#   • pocketbaseEmail / pocketbasePassword – admin credentials
```

```json
{
  "watchedFolders": ["/home/alice/Documents", "/home/alice/Notes"],
  "pocketbaseUrl": "http://127.0.0.1:8090",
  "pocketbaseEmail": "admin@example.com",
  "pocketbasePassword": "supersecret",
  "textExtensions": [".txt", ".md", ".py", ".js", "..."],
  "reconcileIntervalMs": 10000,
  "maxFileSizeBytes": 1048576
}
```

Install dependencies and start the agent:

```bash
npm install
npm start
```

On first run the agent:

1. Authenticates with PocketBase.
2. Performs a **full index scan** of all watched folders.
3. Starts the **real-time file watcher** (Chokidar).
4. Runs a **reconcile loop** every `reconcileIntervalMs` milliseconds.

---

### 3. Start the Web UI

```bash
cd ui
npm install
POCKETBASE_URL=http://127.0.0.1:8090 \
POCKETBASE_EMAIL=admin@example.com   \
POCKETBASE_PASSWORD=supersecret       \
npm start
```

Open [http://localhost:3000](http://localhost:3000) in your browser (or via Tailscale on your phone).

---

### 4. Remote Access via Tailscale

Install Tailscale on both your PC and phone, then log in:

```bash
# PC
sudo tailscale up

# Point your phone browser at your PC's Tailscale IP:
# http://100.x.x.x:3000
```

The Web UI will feel like an SSH session to your file system.

### 5. React Native Mobile Component (Supabase)

The `mobile/` package provides a self-contained **TerminalCLI** React Native component that connects directly to **Supabase** (instead of PocketBase) to power an alternative mobile experience.

#### Supabase Setup

Create a Supabase project at [supabase.com](https://supabase.com) and run the following SQL to create the `remote_files` table:

```sql
CREATE TABLE remote_files (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  path                 TEXT UNIQUE NOT NULL,
  name                 TEXT NOT NULL,
  content              TEXT,
  is_directory         BOOLEAN DEFAULT FALSE,
  last_modified_local  TIMESTAMPTZ,
  last_modified_mobile TIMESTAMPTZ,
  needs_sync           BOOLEAN DEFAULT FALSE, -- agent → mobile: local file changed
  pending_sync         BOOLEAN DEFAULT FALSE, -- mobile → agent: mobile edit ready to push
  file_size            INTEGER DEFAULT 0,
  mime_type            TEXT
);
CREATE INDEX ON remote_files (path);
CREATE INDEX ON remote_files (needs_sync);
CREATE INDEX ON remote_files (pending_sync);
```

> **Sync flags:** `needs_sync` is set by the desktop agent when a local file changes (signalling to mobile that fresh content is available). `pending_sync` is set by the mobile app when the user saves an edit (signalling to the agent that mobile changes are ready to pull).

#### Using the Component

```bash
cd mobile
cp .env.example .env   # fill in SUPABASE_URL and SUPABASE_ANON_KEY
npm install
```

```jsx
import { createSupabaseClient } from './src/lib/supabase';
import { TerminalCLI } from './src/components/TerminalCLI';

const supabase = createSupabaseClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

export default function App() {
  return <TerminalCLI supabase={supabase} initialPath="/" />;
}
```

#### Mobile Terminal Commands

| Command | Description |
|---------|-------------|
| `ls [path]` | List files/directories (from `remote_files` table) |
| `cd <path>` | Navigate the virtual directory (supports `..`, absolute paths) |
| `edit <file>` | Open a file in the full-screen editor; Save sets `pending_sync = true` |
| `pwd` | Print current directory |
| `help` | Show available commands |

---



| Command | Description |
|---------|-------------|
| `ls [path]` | List files and directories at the given path (defaults to cwd) |
| `cd <path>` | Change virtual directory (supports `..`) |
| `cat <file>` | Print file content |
| `edit <file>` | Open the in-browser editor; click **Save** to sync back to PC |
| `pwd` | Print current directory |
| `clear` | Clear the terminal |
| `help` | Show available commands |

---

## 🔄 Sync Logic (Reconciler)

Every `reconcileIntervalMs` milliseconds the agent:

1. Queries PocketBase for records where `needs_sync = true`.
2. For each record, compares `last_modified_mobile` vs `last_modified_local`.
3. If **mobile is newer**, the agent overwrites the local file with DB content and clears the `needs_sync` flag.
4. If local is already up-to-date, it just clears the flag.

---

## 🧪 Running Tests

```bash
# Agent (Node.js)
cd agent
npm test

# Mobile React Native component
cd mobile
npm test
```

Agent tests cover the **indexer** (file scanning, record building) and **reconciler** (conflict resolution, file writing).

Mobile tests cover **pathUtils** (pure path logic), **useRemoteFiles** (Supabase hook with mocked client), and **TerminalCLI** (component rendering and command handling via `@testing-library/react-native`).

---

## ⚙️ Agent CLI Flags

| Flag | Behaviour |
|------|-----------|
| _(none)_ | Full mode: index scan + watcher + reconcile loop |
| `--index-only` | Run one full index scan then exit |
| `--reconcile-only` | Run one reconcile pass then exit |

---

## 📁 PocketBase `files` Collection Fields

| Field | Type | Description |
|-------|------|-------------|
| `path` | text (unique) | Absolute path on the PC |
| `name` | text | Filename or directory name |
| `content` | text | File content (text files only; empty for binaries/dirs) |
| `is_directory` | bool | `true` for directories |
| `last_modified_local` | date | Last time the agent wrote this record |
| `last_modified_mobile` | date | Set when the user saves from the Web UI |
| `needs_sync` | bool | `true` → reconciler should apply mobile edits to PC |
| `file_size` | number | Size in bytes (0 for directories) |
| `mime_type` | text | MIME type (e.g. `text/plain`, `image/png`) |

---

## 🔒 Security Considerations

- **Never expose PocketBase directly** to the internet; keep it behind Tailscale.
- The Web UI server proxies all PocketBase requests — credentials stay server-side.
- Use strong admin credentials and rotate them regularly.
- The `listRule` / `viewRule` / etc. on the `files` collection require authentication — anonymous access is disabled.

---

## 🗺 Roadmap

- [ ] Binary file upload (PocketBase file storage)
- [ ] Conflict detection (both sides changed simultaneously)
- [ ] Push notifications (PocketBase real-time subscriptions)
- [ ] React Native mobile app
- [ ] Multi-user / multi-device support
