/**
 * filePort Web Terminal UI — Express server
 *
 * Serves the single-page terminal interface and proxies API calls to
 * PocketBase so that auth credentials are never exposed to the browser.
 */

const express = require('express');
const path = require('path');
const fetch = require('node-fetch');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── Config from environment (or sensible defaults) ─────────────────────────

const PB_URL      = (process.env.POCKETBASE_URL      || 'http://127.0.0.1:8090').replace(/\/$/, '');
const PB_EMAIL    = process.env.POCKETBASE_EMAIL    || 'admin@fileport.local';
const PB_PASSWORD = process.env.POCKETBASE_PASSWORD || 'changeme';
const PORT        = parseInt(process.env.PORT || '3000', 10);

// ── PocketBase auth token cache ────────────────────────────────────────────

let pbToken = null;

async function getPbToken() {
  if (pbToken) return pbToken;

  const res = await fetch(`${PB_URL}/api/admins/auth-with-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identity: PB_EMAIL, password: PB_PASSWORD }),
  });

  if (!res.ok) {
    throw new Error(`PocketBase auth failed: ${res.status}`);
  }

  const data = await res.json();
  pbToken = data.token;
  return pbToken;
}

function pbHeaders(token) {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  };
}

// Middleware to attach a fresh PB token to every request.
app.use(async (req, res, next) => {
  try {
    req.pbToken = await getPbToken();
    next();
  } catch (err) {
    res.status(503).json({ error: `Cannot reach PocketBase: ${err.message}` });
  }
});

// ── API routes ─────────────────────────────────────────────────────────────

/**
 * GET /api/ls?path=/some/dir
 * List all direct children of the given path.
 */
app.get('/api/ls', async (req, res) => {
  const dirPath = req.query.path || '/';
  // Escape backslashes first, then double quotes to prevent filter injection.
  const safePath = dirPath.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  const filter = encodeURIComponent(`path~"${safePath}/" && path!="${safePath}/"`);
  const url = `${PB_URL}/api/collections/files/records?filter=${filter}&perPage=500&sort=is_directory,name`;

  try {
    const pbRes = await fetch(url, { headers: pbHeaders(req.pbToken) });
    const data = await pbRes.json();

    // Return only direct children (no deeper nesting).
    const children = (data.items || []).filter((item) => {
      const rel = item.path.slice(dirPath.length).replace(/^\//, '');
      return rel.length > 0 && !rel.includes('/');
    });

    res.json(children);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/cat?path=/some/file.txt
 * Return the content of a single file.
 */
app.get('/api/cat', async (req, res) => {
  const filePath = req.query.path;
  if (!filePath) return res.status(400).json({ error: 'path is required' });

  // Escape backslashes first, then double quotes to prevent filter injection.
  const safePath = filePath.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  const filter = encodeURIComponent(`path="${safePath}"`);
  const url = `${PB_URL}/api/collections/files/records?filter=${filter}&perPage=1`;

  try {
    const pbRes = await fetch(url, { headers: pbHeaders(req.pbToken) });
    const data = await pbRes.json();
    if (!data.items || data.items.length === 0) {
      return res.status(404).json({ error: 'File not found' });
    }
    res.json(data.items[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/save
 * Body: { path, content }
 * Marks the file with needs_sync=true and updates last_modified_mobile.
 */
app.post('/api/save', async (req, res) => {
  const { path: filePath, content } = req.body;
  if (!filePath) return res.status(400).json({ error: 'path is required' });

  // 1. Find the record.
  // Escape backslashes first, then double quotes to prevent filter injection.
  const safePath = filePath.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  const filter = encodeURIComponent(`path="${safePath}"`);
  const listUrl = `${PB_URL}/api/collections/files/records?filter=${filter}&perPage=1`;

  try {
    const listRes = await fetch(listUrl, { headers: pbHeaders(req.pbToken) });
    const listData = await listRes.json();
    if (!listData.items || listData.items.length === 0) {
      return res.status(404).json({ error: 'File not found in DB' });
    }

    const record = listData.items[0];

    // 2. Patch with new content and sync flags.
    const patchUrl = `${PB_URL}/api/collections/files/records/${record.id}`;
    const patchRes = await fetch(patchUrl, {
      method: 'PATCH',
      headers: pbHeaders(req.pbToken),
      body: JSON.stringify({
        content: content || '',
        needs_sync: true,
        last_modified_mobile: new Date().toISOString(),
      }),
    });

    if (!patchRes.ok) {
      const errBody = await patchRes.text();
      return res.status(patchRes.status).json({ error: errBody });
    }

    res.json(await patchRes.json());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Start ──────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`[ui] filePort terminal UI running at http://localhost:${PORT}`);
  console.log(`[ui] PocketBase: ${PB_URL}`);
});

module.exports = app; // for testing
