/**
 * useRemoteFiles — React hook for querying the Supabase `remote_files` table.
 *
 * The `remote_files` table mirrors the PocketBase `files` collection schema:
 *
 *   path             TEXT UNIQUE NOT NULL  – absolute path string
 *   name             TEXT NOT NULL         – filename / directory name
 *   is_directory     BOOLEAN               – true for directories
 *   content          TEXT                  – text content (files only)
 *   last_modified_local   TIMESTAMPTZ
 *   last_modified_mobile  TIMESTAMPTZ
 *   needs_sync       BOOLEAN  – set by the desktop agent when a local file changes
 *                               (signals mobile that new content is available)
 *   pending_sync     BOOLEAN  – set by the mobile app when saving an edit
 *                               (signals the desktop agent that mobile changes
 *                               are ready to pull back to the local filesystem)
 *   file_size        INTEGER
 *   mime_type        TEXT
 *
 * Sync-flag semantics:
 *   agent → mobile:  agent sets `needs_sync = true` after indexing a local change.
 *   mobile → agent:  mobile sets `pending_sync = true` via saveFile() after an edit.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 */

import { useCallback } from 'react';
import { getDirectChildren } from '../utils/pathUtils';

/**
 * Returns helper functions that query the `remote_files` Supabase table.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @returns {{ listDirectory: Function, checkDirectory: Function, fetchFile: Function, saveFile: Function }}
 */
export function useRemoteFiles(supabase) {
  /**
   * Fetch all records whose path sits inside `dirPath`, then filter to only
   * the *direct* children (one level deep).
   *
   * @param {string} dirPath
   * @returns {Promise<Array>}  – array of direct-child records, sorted dirs-first
   */
  const listDirectory = useCallback(
    async (dirPath) => {
      // Fetch every record whose path starts with the directory prefix.
      // We use a `like` filter on the server to limit the result set, then
      // apply `getDirectChildren` client-side to strip out nested entries.
      const likePattern = dirPath === '/' ? '/%' : `${dirPath}/%`;

      const { data, error } = await supabase
        .from('remote_files')
        .select('path, name, is_directory, file_size, mime_type')
        .like('path', likePattern)
        .order('is_directory', { ascending: false })
        .order('name', { ascending: true });

      if (error) throw new Error(error.message);

      return getDirectChildren(data || [], dirPath);
    },
    [supabase]
  );

  /**
   * Verify that `dirPath` exists in the database and is a directory.
   *
   * @param {string} dirPath
   * @returns {Promise<boolean>}  – true if the path is an existing directory
   */
  const checkDirectory = useCallback(
    async (dirPath) => {
      const { data, error } = await supabase
        .from('remote_files')
        .select('is_directory')
        .eq('path', dirPath)
        .single();

      if (error) {
        // PostgREST error code for "no rows returned"
        if (error.code === 'PGRST116') return false;
        throw new Error(error.message);
      }

      return data?.is_directory === true;
    },
    [supabase]
  );

  /**
   * Fetch a single file record from `remote_files`, including its `content`.
   * Throws if the path does not exist or Supabase returns an error.
   *
   * @param {string} filePath  – absolute path to the file
   * @returns {Promise<{path:string, name:string, content:string|null, is_directory:boolean}>}
   */
  const fetchFile = useCallback(
    async (filePath) => {
      const { data, error } = await supabase
        .from('remote_files')
        .select('path, name, content, is_directory')
        .eq('path', filePath)
        .single();

      if (error) {
        if (error.code === 'PGRST116') {
          throw new Error(`${filePath}: No such file or directory`);
        }
        throw new Error(error.message);
      }

      return data;
    },
    [supabase]
  );

  /**
   * Persist edited content back to Supabase and mark the row as pending sync.
   *
   * Updates:
   *   content              – the new text
   *   pending_sync         – set to true so the desktop agent picks it up
   *   last_modified_mobile – ISO-8601 timestamp of the save
   *
   * @param {string} filePath – absolute path to the file
   * @param {string} content  – the new file content
   * @returns {Promise<void>}
   */
  const saveFile = useCallback(
    async (filePath, content) => {
      const { error } = await supabase
        .from('remote_files')
        .update({
          content,
          pending_sync: true,
          last_modified_mobile: new Date().toISOString(),
        })
        .eq('path', filePath);

      if (error) throw new Error(error.message);
    },
    [supabase]
  );

  return { listDirectory, checkDirectory, fetchFile, saveFile };
}
