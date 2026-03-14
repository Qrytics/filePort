/**
 * Indexer — scans the configured watched folders and upserts every discovered
 * file into PocketBase.  Text-file content is stored inline; binary files are
 * recorded as metadata-only entries.
 */

const fs = require('fs');
const path = require('path');
const mime = require('mime-types');

/**
 * Recursively walk a directory and call `callback` for every entry.
 *
 * @param {string}   dir
 * @param {Function} callback  – (absolutePath, stat) => void
 * @param {string[]} textExtensions
 * @param {number}   maxFileSizeBytes
 */
function walkDir(dir, callback, textExtensions, maxFileSizeBytes) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (err) {
    console.warn(`[indexer] Cannot read directory "${dir}": ${err.message}`);
    return;
  }

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    // Skip hidden files/folders (e.g. .git)
    if (entry.name.startsWith('.')) continue;

    if (entry.isDirectory()) {
      callback(fullPath, null, true);
      walkDir(fullPath, callback, textExtensions, maxFileSizeBytes);
    } else if (entry.isFile()) {
      let stat;
      try {
        stat = fs.statSync(fullPath);
      } catch (err) {
        console.warn(`[indexer] Cannot stat "${fullPath}": ${err.message}`);
        continue;
      }
      callback(fullPath, stat, false);
    }
  }
}

/**
 * Build a PocketBase file record from a local file path.
 *
 * @param {string}   filePath  – absolute path
 * @param {object|null} stat   – fs.Stats (null for directories)
 * @param {boolean}  isDirectory
 * @param {string[]} textExtensions
 * @param {number}   maxFileSizeBytes
 * @returns {object}  record ready for upsert
 */
function buildFileRecord(filePath, stat, isDirectory, textExtensions, maxFileSizeBytes) {
  const ext = path.extname(filePath).toLowerCase();
  const isText = !isDirectory && textExtensions.includes(ext);
  const mimeType = isDirectory ? 'inode/directory' : (mime.lookup(filePath) || 'application/octet-stream');

  let content = null;
  if (isText && stat && stat.size <= maxFileSizeBytes) {
    try {
      content = fs.readFileSync(filePath, 'utf8');
    } catch (err) {
      console.warn(`[indexer] Cannot read content of "${filePath}": ${err.message}`);
    }
  }

  return {
    path: filePath,
    name: path.basename(filePath),
    content: content || '',
    is_directory: isDirectory,
    last_modified_local: isDirectory ? new Date().toISOString() : stat.mtime.toISOString(),
    last_modified_mobile: null,
    needs_sync: false,
    file_size: isDirectory ? 0 : stat.size,
    mime_type: mimeType,
  };
}

/**
 * Scan all watched folders and upsert every discovered entry into PocketBase.
 *
 * @param {string[]}          watchedFolders   – from config
 * @param {PocketBaseClient}  pbClient
 * @param {string[]}          textExtensions   – from config
 * @param {number}            maxFileSizeBytes – from config
 */
async function indexFolders(watchedFolders, pbClient, textExtensions, maxFileSizeBytes) {
  console.log('[indexer] Starting full index scan…');
  let indexed = 0;
  let errors = 0;

  for (const folder of watchedFolders) {
    const resolved = folder.replace(/^~/, process.env.HOME || '');
    if (!fs.existsSync(resolved)) {
      console.warn(`[indexer] Watched folder does not exist: "${resolved}"`);
      continue;
    }

    // Upsert the root folder itself
    const rootRecord = buildFileRecord(resolved, null, true, textExtensions, maxFileSizeBytes);
    try {
      await pbClient.upsertFile(rootRecord);
      indexed++;
    } catch (err) {
      console.error(`[indexer] Failed to upsert root "${resolved}": ${err.message}`);
      errors++;
    }

    walkDir(
      resolved,
      async (fullPath, stat, isDirectory) => {
        const record = buildFileRecord(fullPath, stat, isDirectory, textExtensions, maxFileSizeBytes);
        try {
          await pbClient.upsertFile(record);
          indexed++;
        } catch (err) {
          console.error(`[indexer] Failed to upsert "${fullPath}": ${err.message}`);
          errors++;
        }
      },
      textExtensions,
      maxFileSizeBytes
    );
  }

  console.log(`[indexer] Scan complete. Indexed: ${indexed}, Errors: ${errors}`);
}

module.exports = { walkDir, buildFileRecord, indexFolders };
