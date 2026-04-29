/**
 * Curated registry of known historical multi-kennel co-host events
 * (#1023 step 6). Single source of truth shared between the backfill
 * mutator (`scripts/backfill-historical-co-hosts.ts`) and the read-only
 * verifier (`scripts/verify-historical-cohost-visibility.ts`) — keeping
 * the list here prevents the two scripts from drifting out of sync.
 *
 * Each entry says "for events on `eventDate` whose title matches
 * `titlePattern` (case-insensitive substring) and whose primary kennel is
 * `primaryKennelCode`, add EventKennel rows for the listed
 * `coHostKennelCodes` as `isPrimary=false`".
 *
 * `eventDate` (YYYY-MM-DD) is REQUIRED so re-runs months from now don't
 * accidentally over-match similarly-titled future events.
 *
 * `kennelCode` lookups are exact (Kennel.kennelCode is immutable).
 *
 * Adding a new entry: append below; both scripts pick it up automatically
 * on next run. Verify the kennelCodes resolve in production before applying.
 */
export interface CoHostBackfillEntry {
  eventDate: string;             // YYYY-MM-DD — date-scopes the title match
  titlePattern: string;
  primaryKennelCode: string;
  coHostKennelCodes: string[];
  /** Free-form note for the dry-run log — explains why this entry exists. */
  note: string;
}

export const HISTORICAL_CO_HOST_ENTRIES: CoHostBackfillEntry[] = [
  // ── Cherry City H3 × OH3 inaugural (#991) ──
  // The canonical case. Both kennels' calendars surfaced the trail, so prod
  // has TWO Event rows (one per primary). Each is missing the other as a
  // co-host EventKennel row; this backfill adds both. (Cross-kennel dedup
  // — collapsing the two Events into one canonical — is intentionally out
  // of scope; tracked separately in docs/roadmap.md.)
  {
    eventDate: "2025-07-12",
    titlePattern: "Cherry City H3 #1 / OH3",
    primaryKennelCode: "cch3-or",
    coHostKennelCodes: ["oh3"],
    note: "#991 Cherry City × OH3 inaugural (cch3-or primary row)",
  },
  {
    eventDate: "2025-07-12",
    titlePattern: "Cherry City H3 #1 / OH3",
    primaryKennelCode: "oh3",
    coHostKennelCodes: ["cch3-or"],
    note: "#991 Cherry City × OH3 inaugural (oh3 primary row)",
  },

  // ── Space City × Galveston H3 (recurring joint hashes) ──
  {
    eventDate: "2025-10-28",
    titlePattern: "Space City H3 #313 - Joint Trail with Galveston H3",
    primaryKennelCode: "galh3",
    coHostKennelCodes: ["space-city-h3"],
    note: "Space City × Galveston joint trail (2025-10-28)",
  },
  {
    eventDate: "2025-12-30",
    titlePattern: "Galveston H3 #297 - Joint Hash with Space City H3",
    primaryKennelCode: "galh3",
    coHostKennelCodes: ["space-city-h3"],
    note: "Galveston × Space City joint hash (2025-12-30)",
  },

  // ── Cleveland H4 × Rubber City H3 (5th-Saturday recurring tradition) ──
  // Rubber City primary, Cleveland H4 co-host
  {
    eventDate: "2026-05-30",
    titlePattern: "5th Saturday with Cleveland H4",
    primaryKennelCode: "rch3",
    coHostKennelCodes: ["cleh4"],
    note: "RCH3 × CH4 5th-Saturday joint trail (2026-05-30)",
  },
  {
    eventDate: "2023-07-29",
    titlePattern: "5th Saturday of July Trail with Cleveland H4",
    primaryKennelCode: "rch3",
    coHostKennelCodes: ["cleh4"],
    note: "RCH3 × CH4 5th-Saturday joint trail (2023-07-29)",
  },
  {
    eventDate: "2019-03-30",
    titlePattern: "Joint Cleveland Hash",
    primaryKennelCode: "rch3",
    coHostKennelCodes: ["cleh4"],
    note: "RCH3 × CH4 joint Cleveland hash (2019-03-30)",
  },
  // Cleveland H4 primary, Rubber City co-host
  {
    eventDate: "2025-12-13",
    titlePattern: "CH4 and Rubber City Christmas Trail",
    primaryKennelCode: "cleh4",
    coHostKennelCodes: ["rch3"],
    note: "CH4 × RCH3 Christmas trail (2025-12-13)",
  },
  {
    eventDate: "2024-06-29",
    titlePattern: "CH4 5th Saturday with Rubber City",
    primaryKennelCode: "cleh4",
    coHostKennelCodes: ["rch3"],
    note: "CH4 × RCH3 5th-Saturday (2024-06-29)",
  },
  {
    eventDate: "2023-07-29",
    titlePattern: "CH4's 5th Saturday with Rubber City",
    primaryKennelCode: "cleh4",
    coHostKennelCodes: ["rch3"],
    note: "CH4 × RCH3 5th-Saturday (2023-07-29)",
  },
  {
    eventDate: "2022-07-30",
    titlePattern: "Joint Trail with Rubber City H3",
    primaryKennelCode: "cleh4",
    coHostKennelCodes: ["rch3"],
    note: "CH4 × RCH3 joint trail (2022-07-30)",
  },
  {
    eventDate: "2018-09-29",
    titlePattern: "CH4 Trail #790/ Rubber City",
    primaryKennelCode: "cleh4",
    coHostKennelCodes: ["rch3"],
    note: "CH4 × RCH3 trail #790 5th-Saturday (2018-09-29)",
  },

  // ── SSH3 × SWH3 (joint trail) ──
  // SSH3 (Seattle) — kennelCode is `ssh3-wa` in the DB.
  {
    eventDate: "2026-05-16",
    titlePattern: "SSH3 #236 with SWH3",
    primaryKennelCode: "ssh3-wa",
    coHostKennelCodes: ["swh3"],
    note: "SSH3 × SWH3 joint trail (2026-05-16)",
  },
];
