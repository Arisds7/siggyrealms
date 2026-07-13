import { createBrowserClient } from "@supabase/ssr";

// Dipakai di Client Component. Hanya boleh pakai ANON key di sini,
// karena kode ini jalan di browser dan bisa dilihat siapa saja.
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}
