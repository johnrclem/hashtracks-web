import { describe, it, expect } from "vitest";
import { serializeTravelResults } from "./serialize";
import type { executeTravelSearch } from "./search";
import type { OtherKennel } from "./other-kennels";

type SearchResults = Awaited<ReturnType<typeof executeTravelSearch>>;

const quiet: OtherKennel = {
  kennelId: "k1",
  slug: "quiet-h3",
  shortName: "Quiet H3",
  fullName: "Quiet Hash House Harriers",
  region: "Savannah, GA",
  distanceKm: 4.2,
  evidence: {
    lastRunSeenAt: new Date("2026-06-02T12:00:00Z"),
    nextRunPostedAt: null,
    lastConfirmedAt: null,
    lastConfirmedVia: null,
    stoppedAt: null,
  },
  ownPageUrl: "https://quiet.example.org/",
  listingOnly: false,
};

function results(otherKennels?: OtherKennel[]): SearchResults {
  return {
    emptyState: "none",
    meta: {},
    destinations: [
      {
        index: 0,
        label: null,
        startDate: new Date("2026-11-20T12:00:00Z"),
        endDate: new Date("2026-11-22T12:00:00Z"),
        radiusKm: 50,
        otherKennels,
      },
    ],
    confirmed: [],
    likely: [],
    possible: [],
  } as unknown as SearchResults;
}

describe("serializeTravelResults otherKennels", () => {
  it("hoists destinations[0].otherKennels with serialized evidence", () => {
    const out = serializeTravelResults(results([quiet]), {}, { mergeBroader: false });
    expect(out.otherKennels).toEqual([
      {
        ...quiet,
        evidence: {
          lastRunSeenAt: "2026-06-02T12:00:00.000Z",
          nextRunPostedAt: null,
          lastConfirmedAt: null,
          lastConfirmedVia: null,
          stoppedAt: null,
        },
      },
    ]);
  });

  it("leaves it absent when unset", () => {
    const out = serializeTravelResults(results(undefined), {}, { mergeBroader: false });
    expect(out.otherKennels).toBeUndefined();
  });
});
