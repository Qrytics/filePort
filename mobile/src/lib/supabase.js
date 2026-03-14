/**
 * Supabase client factory for filePort mobile.
 *
 * Usage:
 *   import { createSupabaseClient } from './lib/supabase';
 *   const supabase = createSupabaseClient(SUPABASE_URL, SUPABASE_ANON_KEY);
 *
 * Or use the pre-built singleton that reads from environment variables:
 *   import { supabase } from './lib/supabase';
 */

import { createClient } from '@supabase/supabase-js';

/**
 * Create and return a configured Supabase client.
 *
 * @param {string} url      – Your Supabase project URL
 * @param {string} anonKey  – Your Supabase anon/public key
 * @returns {import('@supabase/supabase-js').SupabaseClient}
 */
export function createSupabaseClient(url, anonKey) {
  if (!url || !anonKey) {
    throw new Error(
      'SUPABASE_URL and SUPABASE_ANON_KEY are required to create a Supabase client.'
    );
  }
  return createClient(url, anonKey);
}

/**
 * Singleton client built from environment variables.
 * Returns `null` when the env vars are not set (e.g. in tests).
 */
export const supabase = (() => {
  const url = process.env.SUPABASE_URL || '';
  const key = process.env.SUPABASE_ANON_KEY || '';
  if (!url || !key) return null;
  return createSupabaseClient(url, key);
})();
