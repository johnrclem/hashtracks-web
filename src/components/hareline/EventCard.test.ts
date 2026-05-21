import { describe, it, expect } from "vitest";
import { computeChipDate } from "./EventCard";
import { computeHeadingDate } from "./EventDetailPanel";
import { formatDateInZone } from "@/lib/timezone";

/**
 * Pre-cycle bundle 1: regression guard for the NZ kennel listing-page date
 * chip bug (#1510 Geriatrix H3, #1517 Auckland Hussies, #1522 Capital H3).
 *
 * Root cause: when an event lacks a `startTime`, `src/pipeline/merge.ts:1261`
 * sets `Event.dateUtc = Event.date` (UTC noon of the local day). The pre-fix
 * EventCard formatted that UTC-noon timestamp in the kennel's IANA zone via
 * `formatDateInZone`, which for Pacific/Auckland (UTC+12/13) rolls the day
 * forward — the visible chip read "Wed, May 20" for an event whose
 * aria-label correctly said "Tue, May 19".
 *
 * The fix: extract the chip/heading formatter into `computeChipDate` /
 * `computeHeadingDate` (single source of truth) that always formats
 * `event.date` (UTC noon) as UTC. This matches `buildAriaLabel`'s date
 * emission and yields the correct local day for every kennel TZ.
 *
 * These tests import the same helpers the components call. A future
 * refactor that swaps either helper back to `formatDateInZone(dateUtc, tz)`
 * will fail the assertions below — the bug cannot resurface silently.
 */

const NZ_TZ = "Pacific/Auckland";

// Capital H3 Run #2328 — Mon, Jun 1 2026. Monday cadence independently
// rules out any weekday-specific heuristic; this is the case issue #1522
// explicitly asked the regression test to cover.
const CAPITAL_H3_MON_JUN_1 = { date: "2026-06-01T12:00:00.000Z" };

// Geriatrix H3 — Tue May 19. Tuesday case from #1510.
const GERIATRIX_TUE_MAY_19 = { date: "2026-05-19T12:00:00.000Z" };

// Auckland Hussies Mangawhai special — Fri Apr 24. The Friday case from
// #1517 that independently rules out a Tuesday-specific hypothesis.
const HUSSIES_FRI_APR_24 = { date: "2026-04-24T12:00:00.000Z" };

describe("EventCard chip + EventDetailPanel heading — NZ TZ regression (#1510/#1517/#1522)", () => {
  it("Capital H3 Mon Jun 1: chip reads 'Mon, Jun 1' (matches aria-label)", () => {
    expect(computeChipDate(CAPITAL_H3_MON_JUN_1)).toBe("Mon, Jun 1");
  });

  it("Geriatrix H3 Tue May 19: chip reads 'Tue, May 19'", () => {
    expect(computeChipDate(GERIATRIX_TUE_MAY_19)).toBe("Tue, May 19");
  });

  it("Auckland Hussies Fri Apr 24 (Mangawhai special): chip reads 'Fri, Apr 24'", () => {
    expect(computeChipDate(HUSSIES_FRI_APR_24)).toBe("Fri, Apr 24");
  });

  it("EventDetailPanel heading Capital H3 Mon Jun 1: reads 'Monday, June 1, 2026'", () => {
    expect(computeHeadingDate(CAPITAL_H3_MON_JUN_1)).toBe("Monday, June 1, 2026");
  });

  it("regression guard: a refactor that revives `formatDateInZone(UTC-noon, Pacific/Auckland)` would roll Mon Jun 1 forward to Tue Jun 2", () => {
    // Captures the exact trap the fix avoids. If a future refactor pipes
    // `event.dateUtc` (the UTC-noon fallback) through `formatDateInZone` for
    // the chip, the assertions above will start failing because chip text
    // will diverge from aria-label. This assertion documents the trap.
    const trapOutput = formatDateInZone(new Date(CAPITAL_H3_MON_JUN_1.date), NZ_TZ);
    expect(trapOutput).toBe("Tue, Jun 2");
  });
});
