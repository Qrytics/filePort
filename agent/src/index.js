/**
 * filePort Agent — entry point.
 *
 * Usage:
 *   node src/index.js                  # Full mode: index + watch + reconcile loop
 *   node src/index.js --reconcile-only # Run one reconcile pass then exit
 *   node src/index.js --index-only     # Run full index scan then exit
 */

const fs = require('fs');
const path = require('path');

const PocketBaseClient = require('./pocketbase');
const { indexFolders } = require('./indexer');
const { startWatcher } = require('./watcher');
const { reconcile } = require('./reconciler');

// ── Load config ──────────────────────────────────────────────────────────────

const CONFIG_PATH = path.resolve(__dirname, '..', 'config.json');
const EXAMPLE_PATH = path.resolve(__dirname, '..', 'config.example.json');

if (!fs.existsSync(CONFIG_PATH)) {
  if (fs.existsSync(EXAMPLE_PATH)) {
    fs.copyFileSync(EXAMPLE_PATH, CONFIG_PATH);
    console.log('[agent] Created config.json from example. Edit it before running.');
  } else {
    console.error('[agent] Missing config.json. Copy config.example.json and edit it.');
    process.exit(1);
  }
}

const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));

const {
  watchedFolders,
  pocketbaseUrl,
  pocketbaseEmail,
  pocketbasePassword,
  textExtensions,
  reconcileIntervalMs = 10000,
  maxFileSizeBytes = 1_048_576,
} = config;

// ── Parse CLI flags ───────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const reconcileOnly = args.includes('--reconcile-only');
const indexOnly = args.includes('--index-only');

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const pb = new PocketBaseClient(pocketbaseUrl, pocketbaseEmail, pocketbasePassword);

  console.log('[agent] Authenticating with PocketBase…');
  try {
    await pb.authenticate();
    console.log('[agent] Authenticated successfully.');
  } catch (err) {
    console.error(`[agent] Authentication failed: ${err.message}`);
    process.exit(1);
  }

  if (reconcileOnly) {
    await reconcile(pb);
    process.exit(0);
  }

  // Full index scan on startup.
  await indexFolders(watchedFolders, pb, textExtensions, maxFileSizeBytes);

  if (indexOnly) {
    process.exit(0);
  }

  // Real-time watcher.
  startWatcher(watchedFolders, pb, textExtensions, maxFileSizeBytes);

  // Periodic reconcile loop.
  console.log(`[agent] Starting reconcile loop every ${reconcileIntervalMs}ms…`);
  setInterval(() => reconcile(pb), reconcileIntervalMs);

  // Keep the process alive.
  process.on('SIGINT', () => {
    console.log('\n[agent] Shutting down.');
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    console.log('[agent] Received SIGTERM. Shutting down.');
    process.exit(0);
  });
}

main();
