import type { Prisma } from "@/generated/prisma/client";

/**
 * Shared where-clause fragment for "rows that should be displayed to users."
 * Display paths (Hareline list, Travel search, kennel page, map) all
 * exclude archived / non-canonical / hidden-kennel rows. Collapsing into one
 * helper keeps the filters from drifting when a new display path lands.
 *
 * `parentEventId: null` (#1560) excludes multi-day series CHILDREN from
 * top-level listings — they render only inside their parent's expanded
 * "Weekend at a glance" timeline. Children showing up as standalone cards
 * is exactly the "3 trails for one weekend = 3 hareline rows" bug this PR
 * is meant to fix. The detail-page lookup intentionally drops this filter
 * (see `getEventDetail`) so a deep-link to a child page still resolves.
 */
export const DISPLAY_EVENT_WHERE = {
  status: { not: "CANCELLED" },
  isManualEntry: { not: true },
  isCanonical: true,
  kennel: { isHidden: false },
  parentEventId: null,
} as const satisfies Prisma.EventWhereInput;

/**
 * `DISPLAY_EVENT_WHERE` without the `parentEventId: null` predicate — for
 * surfaces that address an event (or one of its series children) directly by
 * id but must still honor the rest of the public-visibility contract:
 *   - the detail page's child-timeline query (`childEvents.where`)
 *   - the per-event OG image route (a crawlable, unfurlable public URL)
 * Children carry a `parentEventId`, so only that predicate is dropped; the
 * status / manual-entry / canonical / hidden-kennel guards stay, keeping
 * cancelled, private manual-entry, and non-canonical rows out of public cards.
 */
const { parentEventId: _omitParentFilter, ...DISPLAYABLE_EVENT_NO_PARENT } =
  DISPLAY_EVENT_WHERE;
export const DISPLAYABLE_EVENT_NO_PARENT_WHERE =
  DISPLAYABLE_EVENT_NO_PARENT satisfies Prisma.EventWhereInput;

/**
 * Narrower filter for server flows that already constrain `kennelId` (or
 * skip the manual-entry exclusion — Travel's confirmed-events query trusts
 * the kennel filter and doesn't need the manual-entry guard).
 */
export const CANONICAL_EVENT_WHERE = {
  isCanonical: true,
} as const satisfies Prisma.EventWhereInput;
