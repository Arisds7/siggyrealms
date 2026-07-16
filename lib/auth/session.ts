import { cookies } from "next/headers";
import { getIronSession } from "iron-session";

// ─── Session Configuration ─────────────────────────────────────────────────────
// iron-session encrypts the cookie payload using this password.
// The cookie itself is HttpOnly + Secure in production, so JS cannot read it.
const SESSION_OPTIONS = {
  password: process.env.IRON_SESSION_PASSWORD || "dev-password-change-in-production-32chars",
  cookieName: "siggy-session",
  cookieOptions: {
    secure: process.env.NODE_ENV === "production",
    httpOnly: true,
    sameSite: "lax" as const,
    path: "/",
    maxAge: 60 * 60 * 24 * 7, // 7 days
  },
};

// ─── Session Shape ─────────────────────────────────────────────────────────────
export interface SessionData {
  /** EIP-55 checksum wallet address of the authenticated user, or undefined if not logged in. */
  walletAddress?: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Read the current session from the incoming request cookies.
 * Use this in GET API routes that just need to inspect session state.
 */
export async function getSession() {
  const cookieStore = await cookies();
  return getIronSession<SessionData>(cookieStore, SESSION_OPTIONS);
}

/**
 * Returns the authenticated wallet address from the session cookie,
 * or null if the session is missing / not yet authenticated.
 *
 * Use this in any API route that needs to know WHO is calling.
 */
export async function getAuthenticatedWallet(): Promise<string | null> {
  const session = await getSession();
  return session.walletAddress ?? null;
}

/**
 * Convenience guard: returns the authenticated wallet address,
 * or throws an error (to be caught by the route handler) if not authenticated.
 *
 * Usage in a route:
 *   const wallet = await requireAuth();
 */
export async function requireAuth(): Promise<string> {
  const wallet = await getAuthenticatedWallet();
  if (!wallet) {
    throw new Error("UNAUTHORIZED");
  }
  return wallet;
}

/**
 * Destroys the current session (logout).
 */
export async function destroySession(): Promise<void> {
  const session = await getSession();
  session.destroy();
  await session.save();
}
