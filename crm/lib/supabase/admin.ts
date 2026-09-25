import { createClient as createSupabaseClient, SupabaseClient } from '@supabase/supabase-js';

let cached: SupabaseClient | null = null;

/** Server-only client with full access. Used by the website intake API, webhooks and admin tasks. */
export function adminClient(): SupabaseClient {
  if (cached) return cached;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Supabase service key is not configured');
  cached = createSupabaseClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return cached;
}
