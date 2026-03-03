/**
 * Hash Rego REST API client for kennel profile data.
 *
 * GET /api/kennels/{slug} returns rich profile JSON (Django REST Framework).
 * Used by the discovery sync pipeline to enrich discovered kennels with
 * profile fields: website, email, year_started, trail info, payment info, etc.
 *
 * Rate limiting: 10 concurrent requests per batch, 500ms delay between batches.
 */

export interface HashRegoKennelProfile {
  name: string;
  slug: string;
  email: string | null;
  website: string | null;
  year_started: number | null;
  trail_frequency: string | null;
  trail_day: string | null;
  trail_price: number | null;
  city: string;
  state: string;
  country: string;
  logo_image_url: string | null;
  member_count: number;
  has_paypal: boolean;
  opt_paypal_email: string;
  has_venmo: boolean;
  opt_venmo_account: string;
  has_square_cash: boolean;
  opt_square_cashtag: string;
  is_active: boolean;
}

const BASE_URL = "https://hashrego.com";
const USER_AGENT = "Mozilla/5.0 (compatible; HashTracks-Scraper)";
const BATCH_SIZE = 10;
const BATCH_DELAY_MS = 500;

/** Fetch a single kennel profile from the Hash Rego API. Returns null on 404/error. */
export async function fetchKennelProfile(
  slug: string,
): Promise<HashRegoKennelProfile | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5_000);
  try {
    const res = await fetch(`${BASE_URL}/api/kennels/${encodeURIComponent(slug)}`, {
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "application/json",
      },
      signal: controller.signal,
    });
    if (!res.ok) return null;
    return (await res.json()) as HashRegoKennelProfile;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Fetch profiles for a batch of slugs with rate limiting (~20/sec). */
export async function fetchKennelProfiles(
  slugs: string[],
): Promise<Map<string, HashRegoKennelProfile>> {
  const results = new Map<string, HashRegoKennelProfile>();

  for (let i = 0; i < slugs.length; i += BATCH_SIZE) {
    if (i > 0) {
      await new Promise((resolve) => setTimeout(resolve, BATCH_DELAY_MS));
    }

    const batch = slugs.slice(i, i + BATCH_SIZE);
    const profiles = await Promise.all(
      batch.map((slug) => fetchKennelProfile(slug)),
    );

    for (let j = 0; j < batch.length; j++) {
      const profile = profiles[j];
      if (profile) {
        results.set(batch[j], profile);
      }
    }
  }

  return results;
}

/**
 * Build a schedule string from Hash Rego frequency + day fields.
 * e.g. "Weekly" + "Thursdays" → "Weekly, Thursdays"
 */
export function buildScheduleString(
  frequency: string | null,
  day: string | null,
): string | undefined {
  const parts = [frequency, day].filter(Boolean);
  return parts.length > 0 ? parts.join(", ") : undefined;
}

/**
 * Build a payment info JSON object from Hash Rego profile payment fields.
 * Returns null if no payment info is available.
 */
export function buildPaymentInfo(
  profile: HashRegoKennelProfile,
): Record<string, string> | null {
  const info: Record<string, string> = {};
  if (profile.has_paypal && profile.opt_paypal_email) {
    info.paypal = profile.opt_paypal_email;
  }
  if (profile.has_venmo && profile.opt_venmo_account) {
    info.venmo = profile.opt_venmo_account;
  }
  if (profile.has_square_cash && profile.opt_square_cashtag) {
    info.squareCash = profile.opt_square_cashtag;
  }
  return Object.keys(info).length > 0 ? info : null;
}

/**
 * Normalize a Hash Rego trail_day value to match Kennel.scheduleDayOfWeek format.
 * "Thursdays" → "Thursday", "Saturdays" → "Saturday"
 */
export function normalizeTrailDay(day: string | null): string | undefined {
  if (!day) return undefined;
  const trimmed = day.trim();
  // Remove trailing 's' for plural day names
  if (trimmed.endsWith("s") && trimmed.length > 3) {
    return trimmed.slice(0, -1);
  }
  return trimmed;
}
