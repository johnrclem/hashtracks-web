import type { Prisma } from "@/generated/prisma/client";

/**
 * Shared where-clause fragment for "rows that should be displayed to users."
 * Display paths (Hareline list, Travel search, kennel page, map) all
 * exclude archived / non-canonical / hidden-kennel rows. Collapsing into one
 * helper keeps the filters from drifting when a new display path lands.
 */
export const DISPLAY_EVENT_WHERE = {
  status: { not: "CANCELLED" },
  isManualEntry: { not: true },
  isCanonical: true,
  kennel: { isHidden: false },
} as const satisfies Prisma.EventWhereInput;

/**
 * Narrower filter for server flows that already constrain `kennelId` (or
 * skip the manual-entry exclusion — Travel's confirmed-events query trusts
 * the kennel filter and doesn't need the manual-entry guard).
 */
export const CANONICAL_EVENT_WHERE = {
  isCanonical: true,
} as const satisfies Prisma.EventWhereInput;
