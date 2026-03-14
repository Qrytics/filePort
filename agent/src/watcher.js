/**
 * Watcher — uses Chokidar to watch selected folders in real time and push
 * incremental updates to PocketBase whenever a file is added, changed, or
 * removed.
 */

const chokidar = require('chokidar');
const fs = require('fs');
const path = require('path');
const { buildFileRecord } = require('./indexer');

/**
 * Start watching the given folders.
 *
 * @param {string[]}          watchedFolders
 * @param {PocketBaseClient}  pbClient
 * @param {string[]}          textExtensions
 * @param {number}            maxFileSizeBytes
 * @returns {chokidar.FSWatcher}
 */
function startWatcher(watchedFolders, pbClient, textExtensions, maxFileSizeBytes) {
  const resolvedFolders = watchedFolders.map((f) =>
    f.replace(/^~/, process.env.HOME || '')
  );

  const watcher = chokidar.watch(resolvedFolders, {
    persistent: true,
    ignoreInitial: true,      // We already do a full scan at startup
    ignored: /(^|[/\\])\../, // Ignore hidden files/folders
    awaitWriteFinish: {
      stabilityThreshold: 500,
      pollInterval: 100,
    },
  });

  watcher.on('add', async (filePath) => {
    console.log(`[watcher] File added: ${filePath}`);
    await handleFileEvent(filePath, false, pbClient, textExtensions, maxFileSizeBytes);
  });

  watcher.on('change', async (filePath) => {
    console.log(`[watcher] File changed: ${filePath}`);
    await handleFileEvent(filePath, false, pbClient, textExtensions, maxFileSizeBytes);
  });

  watcher.on('addDir', async (dirPath) => {
    console.log(`[watcher] Directory added: ${dirPath}`);
    await handleFileEvent(dirPath, true, pbClient, textExtensions, maxFileSizeBytes);
  });

  watcher.on('unlink', async (filePath) => {
    console.log(`[watcher] File removed: ${filePath}`);
    try {
      await pbClient.deleteFile(filePath);
    } catch (err) {
      console.error(`[watcher] Failed to delete "${filePath}" from DB: ${err.message}`);
    }
  });

  watcher.on('unlinkDir', async (dirPath) => {
    console.log(`[watcher] Directory removed: ${dirPath}`);
    try {
      await pbClient.deleteFile(dirPath);
    } catch (err) {
      console.error(`[watcher] Failed to delete dir "${dirPath}" from DB: ${err.message}`);
    }
  });

  watcher.on('error', (err) => {
    console.error(`[watcher] Error: ${err.message}`);
  });

  console.log('[watcher] Watching folders:', resolvedFolders);
  return watcher;
}

async function handleFileEvent(filePath, isDirectory, pbClient, textExtensions, maxFileSizeBytes) {
  let stat = null;
  if (!isDirectory) {
    try {
      stat = fs.statSync(filePath);
    } catch (err) {
      console.warn(`[watcher] Cannot stat "${filePath}": ${err.message}`);
      return;
    }
  }

  const record = buildFileRecord(filePath, stat, isDirectory, textExtensions, maxFileSizeBytes);
  try {
    await pbClient.upsertFile(record);
  } catch (err) {
    console.error(`[watcher] Failed to upsert "${filePath}": ${err.message}`);
  }
}

module.exports = { startWatcher };
