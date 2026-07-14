import { createPublicClient, createWalletClient, custom, http, defineChain, getContract } from "viem";
import GenesisEggABI from "./abi/GenesisEgg.json";

// ─── Chain definition ──────────────────────────────────────────────────────────
// Ganti nilai ini sesuai spesifikasi resmi Ritual Testnet terbaru
// (cek dokumentasi Ritual untuk RPC URL, chain ID, dan explorer yang valid).
export const ritualTestnet = defineChain({
  id: Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? 0),
  name: "Ritual Testnet",
  nativeCurrency: { name: "Ritual", symbol: "RITUAL", decimals: 18 },
  rpcUrls: {
    default: { http: [process.env.NEXT_PUBLIC_RITUAL_RPC_URL ?? ""] },
  },
});

// ─── Public client (read-only) ─────────────────────────────────────────────────
// Buat baca data onchain tanpa butuh wallet user.
export const publicClient = createPublicClient({
  chain: ritualTestnet,
  transport: http(),
});

// ─── Wallet client ─────────────────────────────────────────────────────────────
// Buat kirim transaksi (mint, dll). Butuh provider dari wallet extension user.
// Dipanggil dari Client Component saat user klik tombol aksi.
// Menerima custom provider untuk EIP-6963 multi-wallet support.
export function getWalletClient(provider?: any) {
  if (typeof window === "undefined") {
    throw new Error("Wallet extension tidak terdeteksi di browser ini.");
  }

  const targetProvider = provider || (window as any).ethereum;
  if (!targetProvider) {
    throw new Error("Wallet extension tidak terdeteksi di browser ini.");
  }

  return createWalletClient({
    chain: ritualTestnet,
    transport: custom(targetProvider),
  });
}

// ─── Contract address ──────────────────────────────────────────────────────────
// Dibaca dari env var agar mudah diganti antar environment tanpa ubah kode.
export const GENESIS_EGG_ADDRESS = process.env
  .NEXT_PUBLIC_GENESIS_EGG_ADDRESS as `0x${string}`;

// ─── Contract instance helpers ─────────────────────────────────────────────────

/**
 * Kembalikan contract instance GenesisEgg yang terhubung ke publicClient
 * (read-only). Gunakan untuk baca data: totalSupply, hasMinted, ownerOf, dst.
 */
export function getGenesisEggReadContract() {
  return getContract({
    address: GENESIS_EGG_ADDRESS,
    abi: GenesisEggABI,
    client: publicClient,
  });
}

/**
 * Kembalikan contract instance GenesisEgg yang terhubung ke walletClient
 * (write). Gunakan untuk kirim transaksi: mint(), approve(), dst.
 *
 * Hanya bisa dipanggil dari Client Component di browser (butuh provider).
 * Menerima custom provider untuk EIP-6963 multi-wallet support.
 */
export function getGenesisEggWriteContract(provider?: any) {
  const walletClient = getWalletClient(provider);
  return getContract({
    address: GENESIS_EGG_ADDRESS,
    abi: GenesisEggABI,
    client: { public: publicClient, wallet: walletClient },
  });
}
