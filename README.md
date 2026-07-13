# Siggy Realms V1 — Setup dari Nol

Panduan ini asumsi kamu belum pernah setup project ini sama sekali di komputer/environment kamu (Windsurf/Cursor/Antigravity, terserah editor mana yang kamu pakai).

---

## 1. Prasyarat

- Node.js versi 18+ terpasang (`node -v` untuk cek)
- Akun [Supabase](https://supabase.com) (free tier cukup, lihat pembahasan sebelumnya)
- Wallet extension yang kompatibel dengan Ritual Testnet terpasang di browser

---

## 2. Install Dependency

Masuk ke folder project ini di terminal, lalu:

```bash
npm install
```

---

## 3. Setup Supabase Project

1. Buka [supabase.com](https://supabase.com) → New Project.
2. Setelah project dibuat, buka **Project Settings → API**.
3. Salin 3 nilai ini:
   - `Project URL` → jadi `NEXT_PUBLIC_SUPABASE_URL`
   - `anon public` key → jadi `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `service_role` key → jadi `SUPABASE_SERVICE_ROLE_KEY` (⚠️ JANGAN pernah expose ini ke client/browser, hanya dipakai di server)

---

## 4. Jalankan Migration Database

Ada 2 cara, pilih salah satu:

### Cara A — Manual lewat Dashboard (paling gampang buat pemula)
1. Buka project Supabase → **SQL Editor**.
2. Copy seluruh isi file `supabase/migrations/0001_init.sql`.
3. Paste ke SQL Editor → klik **Run**.
4. Cek di **Table Editor**, harusnya sudah muncul 9 tabel: `users`, `species`, `monsters`, `monster_stats`, `monster_food_bonus`, `foods`, `inventory`, `daily_quests`, `arena_battles`.

### Cara B — Lewat Supabase CLI (kalau mau lebih rapi versioning-nya ke depan)
```bash
npm install -g supabase
supabase login
supabase link --project-ref <project-ref-kamu>
supabase db push
```

---

## 5. Setup Environment Variable

```bash
cp .env.example .env.local
```

Lalu isi `.env.local` dengan nilai dari Step 3 (Supabase) dan detail RPC Ritual Testnet (cek dokumentasi resmi Ritual untuk RPC URL & chain ID yang berlaku saat ini — nilai di `.env.example` cuma placeholder).

---

## 6. Jalankan Development Server

```bash
npm run dev
```

Buka `http://localhost:3000` — harusnya muncul landing page "Siggy Realms".

---

## 7. Test Alur Login

1. Klik "Mulai" di landing page → masuk ke `/login`.
2. Isi twitter handle.
3. Klik "Connect Wallet" → wallet extension browser kamu harusnya muncul minta approval.
4. Klik "Masuk & Klaim Egg" → cek di Supabase Table Editor, tabel `users` harusnya bertambah 1 baris baru.

Kalau langkah 4 berhasil, berarti fondasi auth + database sudah nyambung dengan benar. Ini basis buat semua fitur berikutnya (tap, feed, evolve, dst).

---

## 8. Struktur Project Ini

```
app/
  (auth)/login/          → halaman login
  api/auth/register/     → endpoint simpan user baru ke Supabase
lib/
  supabase/               → client Supabase (browser & server)
  contracts/              → koneksi ke Ritual Testnet via viem
  constants/               → data referensi dari GDD (base stats, evolution, food)
  game-logic/              → pure function (battle formula, dll) — belum diisi semua di step ini
supabase/migrations/      → SQL schema database
```

---

## 9. Yang BELUM Ada di Step Ini (menyusul di step berikutnya)

- Smart contract Genesis Egg (mint NFT) — saat ini login cuma bikin row `users`, belum ada monster/egg beneran.
- Dashboard monster, tap system, energy regen cron.
- Battle formula & arena.
- Shop & food system UI.

Step ini sengaja dibatasi ke: **project scaffold + database schema + alur login/auth dasar**, sesuai urutan Week 1 di roadmap. Kalau ini sudah jalan lancar di environment kamu, kabari aku buat lanjut ke bagian berikutnya (mint Genesis Egg / smart contract).

---

## 10. Troubleshooting Umum

| Masalah | Kemungkinan Penyebab |
|---|---|
| `Wallet extension tidak terdeteksi` | Extension wallet belum terpasang, atau browser bukan yang default extension-nya aktif |
| Error saat `npm install` | Cek versi Node.js, harus 18+ |
| Row tidak muncul di tabel `users` setelah submit | Cek `.env.local` — kemungkinan `SUPABASE_SERVICE_ROLE_KEY` salah atau belum diisi. Cek juga tab Network di browser DevTools buat lihat response error dari `/api/auth/register` |
| RLS error / permission denied | Wajar — RLS sudah diaktifkan tanpa policy publik di migration ini. API route pakai `service_role` key yang bypass RLS, jadi seharusnya tetap jalan. Kalau error, pastikan API route benar-benar pakai `createServiceClient()`, bukan `createClient()` dari `lib/supabase/client.ts` |
