import { safeImageSrc } from "@/lib/safe-url";

/** The subset of a User row needed to pick an avatar image. */
export interface AvatarSource {
  /** User-uploaded photo (Vercel Blob URL). Overrides everything else. */
  avatarUrl?: string | null;
  /** Mirror of the Clerk/OAuth account image, synced on sign-in. */
  clerkImageUrl?: string | null;
  /** When true, suppress the account photo and fall back to the foot mark. */
  hideClerkImage?: boolean | null;
}

/**
 * Resolve which image `src` to render for a hasher's avatar.
 *
 * Precedence: uploaded `avatarUrl` → synced Clerk image (unless hidden) → null.
 * A `null` result means the caller should render the generic Hash House
 * Harriers foot mark (see `HashFootMark`). All URLs pass through `safeImageSrc`
 * so an unsafe/garbage value can never reach a public `<img src>`.
 */
export function resolveAvatarSrc(user: AvatarSource): string | null {
  const uploaded = safeImageSrc(user.avatarUrl);
  if (uploaded) return uploaded;
  if (user.hideClerkImage) return null;
  return safeImageSrc(user.clerkImageUrl);
}

/**
 * Up to two initials from a hash name, for `alt`/`aria` text (not a visible
 * fallback — the visible fallback is the foot mark). Falls back to "?".
 */
export function avatarInitials(name?: string | null): string {
  const cleaned = name?.trim();
  if (!cleaned) return "?";
  const words = cleaned.split(/\s+/).filter(Boolean);
  const letters = words
    .slice(0, 2)
    .map((w) => w[0])
    .join("");
  return (letters || cleaned[0]).toUpperCase();
}
