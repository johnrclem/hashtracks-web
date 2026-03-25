"use server";

import crypto from "crypto";
import { headers } from "next/headers";
import { prisma } from "@/lib/db";
import { getOrCreateUser } from "@/lib/auth";
import { REGION_SEED_DATA } from "@/lib/region";

export type SuggestionState = {
  success?: boolean;
  error?: string;
} | null;

const ANON_RATE_LIMIT = 5;
const AUTH_RATE_LIMIT = 10;
const RATE_WINDOW_MS = 24 * 60 * 60 * 1000; // 24 hours

const VALID_RELATIONSHIPS = ["HASH_WITH", "ON_MISMAN", "FOUND_ONLINE"] as const;

/**
 * Submit a kennel suggestion from the public suggest-a-kennel form.
 * Works for both authenticated and anonymous users.
 * Uses useActionState signature: (prevState, formData) => newState.
 */
export async function submitKennelSuggestion(
  _prevState: SuggestionState,
  formData: FormData,
): Promise<SuggestionState> {
  // ── Honeypot check (bots fill hidden fields) ──
  const honeypot = formData.get("website_url_confirm") as string;
  if (honeypot) {
    // Return fake success so bots think it worked
    return { success: true };
  }

  // ── Extract & validate fields ──
  const kennelName = (formData.get("kennelName") as string)?.trim();
  if (!kennelName) return { error: "Kennel name is required" };

  const region = (formData.get("region") as string)?.trim();
  if (!region) return { error: "Region is required" };

  const relationship = (formData.get("relationship") as string)?.trim();
  if (
    !relationship ||
    !VALID_RELATIONSHIPS.includes(
      relationship as (typeof VALID_RELATIONSHIPS)[number],
    )
  ) {
    return { error: "Please select how you know this kennel" };
  }

  const sourceUrl = (formData.get("sourceUrl") as string)?.trim() || null;
  const email = (formData.get("email") as string)?.trim() || null;
  const notes = (formData.get("notes") as string)?.trim() || null;

  // ── Optional auth (don't require login) ──
  let userId: string | null = null;
  try {
    const user = await getOrCreateUser();
    userId = user?.id ?? null;
  } catch {
    // Auth not available — continue as anonymous
  }

  // ── Compute IP hash for anonymous rate limiting ──
  const headersList = await headers();
  const ip =
    headersList.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    headersList.get("x-real-ip") ||
    "unknown";
  const ipHash = crypto.createHash("sha256").update(ip).digest("hex");

  // ── Rate limiting (DB-based) ──
  const windowStart = new Date(Date.now() - RATE_WINDOW_MS);

  if (userId) {
    const recentCount = await prisma.kennelRequest.count({
      where: {
        userId,
        createdAt: { gte: windowStart },
      },
    });
    if (recentCount >= AUTH_RATE_LIMIT) {
      return { error: "You've submitted too many suggestions recently. Please try again later." };
    }
  } else {
    const recentCount = await prisma.kennelRequest.count({
      where: {
        ipHash,
        createdAt: { gte: windowStart },
      },
    });
    if (recentCount >= ANON_RATE_LIMIT) {
      return { error: "Too many suggestions from this location. Please try again later." };
    }
  }

  // ── Auto-link regionId ──
  let regionId: string | null = null;

  // Try direct DB lookup (case-insensitive)
  const dbRegion = await prisma.region.findFirst({
    where: { name: { equals: region, mode: "insensitive" } },
    select: { id: true },
  });

  if (dbRegion) {
    regionId = dbRegion.id;
  } else {
    // Fallback: check REGION_SEED_DATA aliases for a canonical name match
    const canonical = findCanonicalRegionName(region);
    if (canonical) {
      const aliasRegion = await prisma.region.findFirst({
        where: { name: { equals: canonical, mode: "insensitive" } },
        select: { id: true },
      });
      regionId = aliasRegion?.id ?? null;
    }
  }

  // ── Create the request ──
  await prisma.kennelRequest.create({
    data: {
      userId,
      kennelName,
      region,
      sourceUrl,
      notes,
      relationship: relationship as (typeof VALID_RELATIONSHIPS)[number],
      email,
      ipHash,
      regionId,
      source: "PUBLIC",
    },
  });

  return { success: true };
}

/**
 * Look up a region name against REGION_SEED_DATA aliases.
 * Returns the canonical region name if the input matches an alias, otherwise null.
 */
function findCanonicalRegionName(name: string): string | null {
  const lower = name.toLowerCase();
  for (const r of REGION_SEED_DATA) {
    if (r.name.toLowerCase() === lower) return r.name;
    if (r.aliases) {
      for (const alias of r.aliases) {
        if (alias.toLowerCase() === lower) return r.name;
      }
    }
  }
  return null;
}
