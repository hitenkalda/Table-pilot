/**
 * Lazy Supabase client. The pilot ships without Supabase configured; when the
 * env vars are present we use the real client (anon key = guest-scoped RLS),
 * otherwise the app silently falls back to the bundled demo restaurant.
 *
 * No secret ever reaches the browser bundle: the anon key is safe to expose,
 * and the AI waiter talks to the dev-server /api/chat proxy (which reads the
 * real Groq key from the server environment only).
 */

import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";

const URL = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim();
const ANON = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined)?.trim();

let _client: SupabaseClient | null = null;

export function isSupabaseConfigured(): boolean {
  return Boolean(URL && ANON);
}

export function getSupabase(): SupabaseClient | null {
  if (!isSupabaseConfigured()) return null;
  if (_client) return _client;
  _client = createClient(URL!, ANON!, {
    realtime: { params: { events: { threshold: 0 } } },
  });
  return _client;
}