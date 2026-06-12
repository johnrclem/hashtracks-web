import { describe, it, expect } from "vitest";
import { computeChipDate, computeDisplayTime } from "./EventCard";
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

// US west-of-UTC sanity check (claude[bot] PR #1566 review). NY is UTC-5/-4;
// the common-case kennel that was working before this PR must still work
// after. UTC noon in NY is morning-same-day, never the previous day, so
// `formatDate(event.date)` UTC-formatting always lands on the right day.
const NYC_THU_MAY_28 = { date: "2026-05-28T12:00:00.000Z" };

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

  it("US west-of-UTC kennel Thu May 28: chip still reads 'Thu, May 28' (no regression on the common case)", () => {
    expect(computeChipDate(NYC_THU_MAY_28)).toBe("Thu, May 28");
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

/**
 * #1654 — SeaMon Trail #556 card/detail time mismatch. The merge pipeline can
 * leave `dateUtc` stale at UTC noon when a lower-trust source backfills
 * `startTime`. Pre-fix the card formatted that stale `dateUtc` directly
 * (rendering noon-UTC = 5:00 AM PDT) while the detail panel recomposed from
 * startTime+timezone (rendering 5:30 PM PDT). The fix: `computeDisplayTime`
 * mirrors EventTimeDisplay — always prefer composed UTC over stored dateUtc
 * when both startTime + timezone are available.
 */
describe("EventCard time derivation — SeaMon stale-dateUtc regression (#1654)", () => {
  const PDT = "America/Los_Angeles";
  // SeaMon Trail #556 — May 25 2026, 5:30 PM PDT. Real prod row had
  // dateUtc=2026-05-25T12:00:00Z (UTC noon = 5:00 AM PDT) while startTime
  // was correctly "17:30" from the GCal enrichment.
  const SEAMON_556 = {
    date: "2026-05-25T12:00:00.000Z",
    startTime: "17:30",
    timezone: PDT,
    dateUtc: new Date("2026-05-25T12:00:00.000Z"), // STALE noon-UTC
  };

  it("recomposes from startTime+timezone, ignoring stale noon-UTC dateUtc", () => {
    const { displayTimeStr } = computeDisplayTime(SEAMON_556, PDT);
    expect(displayTimeStr).toBe("5:30 PM");
  });

  it("emits the correct timezone abbreviation for the composed anchor", () => {
    const { tzAbbrev } = computeDisplayTime(SEAMON_556, PDT);
    expect(tzAbbrev).toBe("PDT");
  });

  it("regression guard: a refactor that reads event.dateUtc directly would render 5:00 AM (the bug)", () => {
    // Reading the stale noon-UTC value via formatTimeInZone(dateUtc, PDT) ==
    // 12:00 UTC → 5:00 AM PDT. If a future refactor undoes the recompose
    // step in computeDisplayTime, the assertions above will start failing.
    // This documents the trap.
    const trapDate = SEAMON_556.dateUtc; // intentionally NOT recomposed
    const trapOutput = new Intl.DateTimeFormat("en-US", {
      hour: "numeric", minute: "2-digit", timeZone: PDT,
    }).format(trapDate);
    expect(trapOutput).toBe("5:00 AM");
  });

  it("falls back to dateUtc + startTime when timezone is missing (pre-#1654 behavior)", () => {
    const noTz = { ...SEAMON_556, timezone: null };
    const { displayTimeStr } = computeDisplayTime(noTz, PDT);
    // Without a timezone we can't recompose; format the stored anchor.
    expect(displayTimeStr).toBe("5:00 AM");
  });

  it("falls back to raw HH:MM formatting when both timezone and dateUtc are missing", () => {
    const startOnly = { ...SEAMON_556, timezone: null, dateUtc: null };
    const { displayTimeStr, tzAbbrev } = computeDisplayTime(startOnly, PDT);
    expect(displayTimeStr).toBe("5:30 PM");
    expect(tzAbbrev).toBe("");
  });

  it("returns null displayTimeStr when no startTime at all", () => {
    const noTime = { ...SEAMON_556, startTime: null };
    const { displayTimeStr, tzAbbrev } = computeDisplayTime(noTime, PDT);
    expect(displayTimeStr).toBeNull();
    expect(tzAbbrev).toBe("");
  });
});

describe("EventCard endTime range derivation (#2135)", () => {
  const EDT = "America/New_York";
  // QCH4 Run #220 — Jun 13 2026, 3:00–7:00 PM Eastern.
  const QCH4_220 = {
    date: "2026-06-13T12:00:00.000Z",
    startTime: "15:00",
    endTime: "19:00",
    timezone: EDT,
    dateUtc: new Date("2026-06-13T19:00:00.000Z"),
  };

  it("renders a start–end range in the event's zone", () => {
    const { displayTimeStr, endTimeStr, tzAbbrev } = computeDisplayTime(QCH4_220, EDT);
    expect(displayTimeStr).toBe("3:00 PM");
    expect(endTimeStr).toBe("7:00 PM");
    expect(tzAbbrev).toBe("EDT");
  });

  it("leaves endTimeStr null when there is no endTime (negative case)", () => {
    const startOnly = { ...QCH4_220, endTime: null };
    const { displayTimeStr, endTimeStr } = computeDisplayTime(startOnly, EDT);
    expect(displayTimeStr).toBe("3:00 PM");
    expect(endTimeStr).toBeNull();
  });

  it("does not render an endTime when the start time is absent", () => {
    const endNoStart = { ...QCH4_220, startTime: null };
    const { displayTimeStr, endTimeStr } = computeDisplayTime(endNoStart, EDT);
    expect(displayTimeStr).toBeNull();
    expect(endTimeStr).toBeNull();
  });

  it("formats endTime via plain HH:MM fallback when timezone is missing", () => {
    const noTz = { ...QCH4_220, timezone: null, dateUtc: null };
    const { displayTimeStr, endTimeStr } = computeDisplayTime(noTz, EDT);
    expect(displayTimeStr).toBe("3:00 PM");
    expect(endTimeStr).toBe("7:00 PM");
  });
});
