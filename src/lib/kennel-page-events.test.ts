import { describe, it, expect } from "vitest";
import { kennelPageEventWhere, countKennelPageEvents } from "./kennel-page-events";
import { HIDE_STOPPED_SCHEDULE_RUNS } from "./event-filters";

describe("kennelPageEventWhere", () => {
  it("is the page's filter: hosted or co-hosted, canonical, not cancelled or manual, stop-aware", () => {
    expect(kennelPageEventWhere("k1")).toEqual({
      eventKennels: { some: { kennelId: "k1" } },
      status: { not: "CANCELLED" },
      isManualEntry: { not: true },
      isCanonical: true,
      ...HIDE_STOPPED_SCHEDULE_RUNS,
    });
  });

  it("drops only the stopped-kennel clause when asked (backfill verification V1)", () => {
    const where = kennelPageEventWhere("k1", { ignoreStop: true });
    expect(where).not.toHaveProperty("NOT");
    expect(where.isCanonical).toBe(true);
  });
});

describe("countKennelPageEvents", () => {
  it("counts unique dates, so two runs on one date count once", () => {
    const d = (iso: string) => ({ date: new Date(`${iso}T12:00:00Z`) });
    expect(countKennelPageEvents([d("2014-10-04"), d("2014-10-04"), d("2014-10-11")])).toBe(2);
  });
});
