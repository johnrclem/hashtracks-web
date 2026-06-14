import type { User } from "@/generated/prisma/client";
import { getAdminUser } from "@/lib/auth";

/**
 * Admin guard for server-only code paths (`getAdminUser` reads Clerk's
 * server-side session, so this is never importable from a client component).
 * Server actions are POST endpoints anyone can hit, so page-level `/admin`
 * gating does NOT protect them — call this first in any exported action that
 * returns or mutates non-public data. Throws "Unauthorized" when the caller is
 * not an admin; returns the admin User.
 */
export async function requireAdmin(): Promise<User> {
  const admin = await getAdminUser();
  if (!admin) throw new Error("Unauthorized");
  return admin;
}
