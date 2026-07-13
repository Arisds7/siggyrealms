import Link from "next/link";

// Landing sederhana. Nanti redirect ke /dashboard kalau session sudah ada.
export default function HomePage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 p-8 text-center">
      <h1 className="text-4xl font-bold">Siggy Realms</h1>
      <p className="text-neutral-400">Raise. Evolve. Battle. Repeat.</p>
      <Link
        href="/login"
        className="rounded-lg bg-element-fire px-6 py-3 font-semibold text-white hover:opacity-90"
      >
        Mulai
      </Link>
    </main>
  );
}
