import { describe, it, expect } from "vitest";
import { regionNameToSlug } from "@/lib/region";
import {
  OTHER_KENNELS_LIMIT,
  selectOtherKennels,
  shouldShowOtherKennels,
  otherKennelsHeading,
  otherKennelsBrowseLink,
  type OtherKennelCandidate,
} from "./other-kennels";

const NOW = new Date("2026-11-17T12:00:00Z");
const QUIET = new Date("2026-06-02T12:00:00Z");

function candidate(over: Partial<OtherKennelCandidate> & { id: string }): OtherKennelCandidate {
  return {
    slug: over.id,
    shortName: over.id,
    fullName: `${over.id} Hash House Harriers`,
    region: "Savannah, GA",
    website: null,
    facebookUrl: null,
    distanceKm: 5,
    listingOnly: false,
    lastRunSeenAt: QUIET,
    nextRunPostedAt: null,
    lastConfirmedAt: null,
    stoppedAt: null,
    ...over,
  };
}

describe("shouldShowOtherKennels", () => {
  it.each([
    [0, 0, true],
    [1, 1, true],
    [2, 1, false],
    [0, 3, false],
  ])("(%i confirmed, %i likely) -> %s", (confirmed, likely, expected) => {
    expect(shouldShowOtherKennels(confirmed, likely)).toBe(expected);
  });
});

describe("selectOtherKennels", () => {
  it("keeps quiet kennels, closest first", () => {
    const out = selectOtherKennels(
      [candidate({ id: "a", distanceKm: 12 }), candidate({ id: "b", distanceKm: 3 }), candidate({ id: "c", distanceKm: 7 })],
      new Set(),
      NOW,
    );
    expect(out.map((k) => k.kennelId)).toEqual(["b", "c", "a"]);
    expect(out[0]).toMatchObject({ slug: "b", shortName: "b", distanceKm: 3, listingOnly: false });
    expect(out[0].evidence.lastRunSeenAt).toEqual(QUIET);
  });

  it("drops running, not-seen and stopped kennels", () => {
    const out = selectOtherKennels(
      [
        candidate({ id: "running", lastRunSeenAt: new Date("2026-11-07T12:00:00Z") }),
        candidate({ id: "not-seen", lastRunSeenAt: null }),
        candidate({ id: "stopped", stoppedAt: new Date("2026-01-01T12:00:00Z") }),
        candidate({ id: "quiet" }),
      ],
      new Set(),
      NOW,
    );
    expect(out.map((k) => k.kennelId)).toEqual(["quiet"]);
  });

  it("drops a running kennel that is not already shown", () => {
    const out = selectOtherKennels(
      [candidate({ id: "running", lastRunSeenAt: new Date("2026-11-07T12:00:00Z") })],
      new Set(),
      NOW,
    );
    expect(out).toEqual([]);
  });

  it("drops a quiet kennel that is already shown", () => {
    const out = selectOtherKennels([candidate({ id: "shown" })], new Set(["shown"]), NOW);
    expect(out).toEqual([]);
  });

  it("caps at the limit", () => {
    const many = Array.from({ length: 7 }, (_, i) => candidate({ id: `k${i}`, distanceKm: i + 1 }));
    expect(selectOtherKennels(many, new Set(), NOW)).toHaveLength(OTHER_KENNELS_LIMIT);
    expect(selectOtherKennels(many, new Set(), NOW, 2)).toHaveLength(2);
  });

  it("keeps running listing-only kennels, drops not-seen ones", () => {
    const out = selectOtherKennels(
      [
        candidate({ id: "kept", listingOnly: true, lastRunSeenAt: null, lastConfirmedAt: new Date("2026-10-28T12:00:00Z") }),
        candidate({ id: "dropped", listingOnly: true, lastRunSeenAt: null, lastConfirmedAt: new Date("2025-01-10T12:00:00Z") }),
      ],
      new Set(),
      NOW,
    );
    expect(out.map((k) => k.kennelId)).toEqual(["kept"]);
    expect(out[0].listingOnly).toBe(true);
  });

  it("sets ownPageUrl from website, then Facebook", () => {
    const out = selectOtherKennels(
      [
        candidate({ id: "web", distanceKm: 1, website: "https://web.example.org", facebookUrl: "https://facebook.com/x" }),
        candidate({ id: "fb", distanceKm: 2, facebookUrl: "https://facebook.com/fb" }),
        candidate({ id: "none", distanceKm: 3 }),
      ],
      new Set(),
      NOW,
    );
    expect(out[1].ownPageUrl).toBe("https://facebook.com/fb");
    expect(out[0].ownPageUrl).toContain("web.example.org");
    expect(out[2].ownPageUrl).toBeNull();
  });
});

describe("otherKennelsHeading", () => {
  it("names the place", () => {
    expect(otherKennelsHeading("Savannah")).toBe("Other kennels near Savannah");
  });
});

describe("otherKennelsBrowseLink", () => {
  it("links to the closest kennel's region", () => {
    expect(otherKennelsBrowseLink([{ region: "Savannah, GA" }, { region: "Atlanta, GA" }])).toEqual({
      label: "Browse kennels in Savannah, GA",
      href: "/kennels/region/" + regionNameToSlug("Savannah, GA"),
    });
  });

  it("falls back to the directory when the region has no slug", () => {
    expect(otherKennelsBrowseLink([{ region: "Nowhere" }])).toEqual({
      label: "Browse the kennel directory",
      href: "/kennels",
    });
  });

  it("returns null for no kennels", () => {
    expect(otherKennelsBrowseLink([])).toBeNull();
  });
});
