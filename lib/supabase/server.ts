import { createClient as createSupabaseClient } from "@supabase/supabase-js";

// PENTING: hanya dipakai di file server-side (app/api/**/route.ts, cron job).
// Service role key bypass Row Level Security — jangan pernah import file ini
// dari komponen yang render di client ("use client").
export function createServiceClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
      global: {
        fetch: (url, init) => fetch(url, { ...init, cache: "no-store" }),
      },
    }
  );
}