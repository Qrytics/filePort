/**
 * Reconciler — runs periodically and applies mobile-side edits back to the
 * local filesystem.
 *
 * Logic:
 *   For every record where `needs_sync === true`:
 *     1. Compare last_modified_mobile vs last_modified_local.
 *     2. If mobile is newer, overwrite the local file with DB content.
 *     3. Clear the needs_sync flag and update last_modified_local.
 *
 * Sync-flag semantics (PocketBase backend):
 *   `needs_sync` — set by the agent when a local file changes (mobile reads this).
 *                  Also cleared here after reconciliation.
 *
 * When the Supabase mobile backend is used instead of PocketBase, the mobile
 * app additionally sets `pending_sync = true` on `remote_files` rows after the
 * user saves an edit.  A future reconciler variant would query `pending_sync`
 * to pull those mobile edits.  See mobile/src/hooks/useRemoteFiles.js.
 */

const fs = require('fs');
const path = require('path');

/**
 * Compare two ISO-8601 timestamps and return true if `a` is newer than `b`.
 *
 * @param {string|null} a
 * @param {string|null} b
 * @returns {boolean}
 */
function isMobileNewer(lastModifiedMobile, lastModifiedLocal) {
  if (!lastModifiedMobile) return false;
  if (!lastModifiedLocal) return true;
  return new Date(lastModifiedMobile) > new Date(lastModifiedLocal);
}

/**
 * Apply a single pending-sync record to the local filesystem.
 *
 * @param {object}           record  – PocketBase file record
 * @param {PocketBaseClient} pbClient
 * @returns {{ path: string, status: 'applied'|'skipped'|'error', reason?: string }}
 */
async function applyRecord(record, pbClient) {
  const filePath = record.path;

  if (record.is_directory) {
    // Directory entries: just ensure the directory exists locally.
    try {
      fs.mkdirSync(filePath, { recursive: true });
      await pbClient.markSynced(record.id, new Date().toISOString());
      return { path: filePath, status: 'applied' };
    } catch (err) {
      return { path: filePath, status: 'error', reason: err.message };
    }
  }

  if (!isMobileNewer(record.last_modified_mobile, record.last_modified_local)) {
    // Local is already up-to-date; clear the flag without overwriting.
    try {
      await pbClient.markSynced(record.id, record.last_modified_local);
    } catch (_) { /* non-critical */ }
    return { path: filePath, status: 'skipped', reason: 'local is not older than mobile' };
  }

  // Ensure parent directory exists.
  const dir = path.dirname(filePath);
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch (err) {
    return { path: filePath, status: 'error', reason: `Cannot create parent dir: ${err.message}` };
  }

  // Write content.
  try {
    fs.writeFileSync(filePath, record.content || '', 'utf8');
  } catch (err) {
    return { path: filePath, status: 'error', reason: `Cannot write file: ${err.message}` };
  }

  // Mark as synced in the DB.
  const now = new Date().toISOString();
  try {
    await pbClient.markSynced(record.id, now);
  } catch (err) {
    return { path: filePath, status: 'error', reason: `File written but DB update failed: ${err.message}` };
  }

  console.log(`[reconciler] ✔ Applied mobile changes to "${filePath}"`);
  return { path: filePath, status: 'applied' };
}

/**
 * Fetch all pending-sync records and apply them.
 *
 * @param {PocketBaseClient} pbClient
 * @returns {Promise<Array>}  – array of result objects
 */
async function reconcile(pbClient) {
  console.log('[reconciler] Checking for pending mobile changes…');
  let pending;
  try {
    pending = await pbClient.getPendingSyncFiles();
  } catch (err) {
    console.error(`[reconciler] Failed to fetch pending files: ${err.message}`);
    return [];
  }

  if (pending.length === 0) {
    console.log('[reconciler] No pending changes.');
    return [];
  }

  console.log(`[reconciler] Found ${pending.length} pending record(s).`);
  const results = await Promise.all(pending.map((r) => applyRecord(r, pbClient)));

  const applied = results.filter((r) => r.status === 'applied').length;
  const skipped = results.filter((r) => r.status === 'skipped').length;
  const errors  = results.filter((r) => r.status === 'error').length;
  console.log(`[reconciler] Done. Applied: ${applied}, Skipped: ${skipped}, Errors: ${errors}`);

  return results;
}

module.exports = { isMobileNewer, applyRecord, reconcile };
