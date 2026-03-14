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
 *   needs_sync       BOOLEAN
 *   file_size        INTEGER
 *   mime_type        TEXT
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 */

import { useCallback } from 'react';
import { getDirectChildren } from '../utils/pathUtils';

/**
 * Returns helper functions that query the `remote_files` Supabase table.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @returns {{ listDirectory: Function, checkDirectory: Function }}
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

  return { listDirectory, checkDirectory };
}
