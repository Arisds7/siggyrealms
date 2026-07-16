import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { verifyMessage, getAddress } from "viem";
import { getSession } from "@/lib/auth/session";

/**
 * POST /api/auth/verify
 * Body: { walletAddress: string, nonce: string, signature: string }
 *
 * Verifies a SIWE (Sign-In With Ethereum) signature:
 *  1. Validate inputs.
 *  2. Look up the nonce in auth_nonces — must exist, not expired, not used.
 *  3. Re-construct the exact message that was signed on the frontend.
 *  4. Verify the signature using viem verifyMessage.
 *  5. Mark the nonce as used (replay protection).
 *  6. Write walletAddress into an encrypted iron-session cookie.
 *  7. Return { success: true }.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { walletAddress: rawWallet, nonce, signature } = body;

    // ── 1. Validate inputs ───────────────────────────────────────────────────
    if (!rawWallet || !nonce || !signature) {
      return NextResponse.json(
        { error: "Missing walletAddress, nonce, or signature." },
        { status: 400 }
      );
    }

    // Normalise to EIP-55 checksum address
    let walletAddress: string;
    try {
      walletAddress = getAddress(rawWallet);
    } catch {
      return NextResponse.json(
        { error: "Invalid wallet address format." },
        { status: 400 }
      );
    }

    const supabase = createServiceClient();

    // ── 2. Look up the nonce ─────────────────────────────────────────────────
    const { data: nonceRow, error: nonceError } = await supabase
      .from("auth_nonces")
      .select("id, expires_at, used_at")
      .eq("wallet_address", walletAddress)
      .eq("nonce", nonce)
      .maybeSingle();

    if (nonceError) {
      console.error("[verify] Nonce lookup error:", nonceError);
      return NextResponse.json(
        { error: "Authentication failed. Please try again." },
        { status: 500 }
      );
    }

    if (!nonceRow) {
      return NextResponse.json(
        { error: "Invalid or unknown nonce. Please reconnect your wallet." },
        { status: 401 }
      );
    }

    if (nonceRow.used_at) {
      return NextResponse.json(
        { error: "This nonce has already been used. Please reconnect your wallet." },
        { status: 401 }
      );
    }

    if (new Date(nonceRow.expires_at) < new Date()) {
      return NextResponse.json(
        { error: "The authentication nonce has expired. Please reconnect your wallet." },
        { status: 401 }
      );
    }

    // ── 3. Re-construct the signed message ───────────────────────────────────
    // MUST match exactly what the frontend passes to walletClient.signMessage()
    const message = `Sign this message to authenticate with Siggy Realms.\n\nNonce: ${nonce}`;

    // ── 4. Verify the signature ──────────────────────────────────────────────
    let isValid = false;
    try {
      isValid = await verifyMessage({
        address: walletAddress as `0x${string}`,
        message,
        signature: signature as `0x${string}`,
      });
    } catch (sigErr) {
      console.error("[verify] Signature verification threw:", sigErr);
      return NextResponse.json(
        { error: "Signature verification failed. Please try again." },
        { status: 401 }
      );
    }

    if (!isValid) {
      return NextResponse.json(
        { error: "Signature does not match the wallet address. Verification failed." },
        { status: 401 }
      );
    }

    // ── 5. Mark nonce as used ────────────────────────────────────────────────
    await supabase
      .from("auth_nonces")
      .update({ used_at: new Date().toISOString() })
      .eq("id", nonceRow.id);

    // ── 6. Create iron-session cookie ────────────────────────────────────────
    const session = await getSession();
    session.walletAddress = walletAddress;
    await session.save();

    // ── 7. Return success ────────────────────────────────────────────────────
    return NextResponse.json({ success: true, walletAddress });
  } catch (err) {
    console.error("[verify] Unexpected error:", err);
    return NextResponse.json(
      { error: "An unexpected error occurred during authentication." },
      { status: 500 }
    );
  }
}
