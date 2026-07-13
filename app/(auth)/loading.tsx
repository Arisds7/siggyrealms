"use client";

import LoadingScreen from "@/components/ui/LoadingScreen";

// Konvensi Next.js App Router: file ini otomatis ditampilkan saat
// halaman-halaman dalam grup (auth) sedang di-render server-side.
// Karena tidak ada data progress asli di sini, pakai mode indeterminate.
export default function AuthLoading() {
  return <LoadingScreen />;
}
