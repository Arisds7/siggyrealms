import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { getAddress } from "viem";
import { randomBytes } from "crypto";

/**
 * GET /api/auth/nonce?walletAddress=0x...
 *
 * Issues a one-time nonce for SIWE authentication.
 * Steps:
 *  1. Validate and checksum-normalise the wallet address (viem getAddress).
 *  2. Generate a 32-byte cryptographically random nonce (hex string).
 *  3. Insert the nonce into auth_nonces table (expires in 10 minutes).
 *  4. Return { nonce }.
 *
 * The nonce is later used in /api/auth/verify where the user's signature
 * is verified. Once verified the nonce is marked as used (used_at = now()).
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const rawWallet = searchParams.get("walletAddress");

  if (!rawWallet) {
    return NextResponse.json(
      { error: "Missing walletAddress query parameter." },
      { status: 400 }
    );
  }

  // Normalise to EIP-55 checksum address — throws if invalid format
  let walletAddress: string;
  try {
    walletAddress = getAddress(rawWallet);
  } catch {
    return NextResponse.json(
      { error: "Invalid wallet address format." },
      { status: 400 }
    );
  }

  // Generate a 32-byte random nonce (64 hex chars)
  const nonce = randomBytes(32).toString("hex");

  const supabase = createServiceClient();

  const { error } = await supabase.from("auth_nonces").insert({
    wallet_address: walletAddress,
    nonce,
    // expires_at defaults to now() + 10 minutes (see migration SQL)
  });

  if (error) {
    console.error("[nonce] Insert error:", error);
    return NextResponse.json(
      { error: "Failed to generate authentication nonce. Please try again." },
      { status: 500 }
    );
  }

  return NextResponse.json({ nonce });
}
