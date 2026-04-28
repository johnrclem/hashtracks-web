import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  parseListingTitle,
  extractStartTime,
  extractDate,
  buildDescription,
  buildEventFromDetail,
  buildEventFromListing,
  SHITH3Adapter,
  type ListingItem,
} from "./shith3";

// ---------- Pure function unit tests ----------

describe("parseListingTitle", () => {
  it("parses 'Trail NNN: Name' format", () => {
    expect(parseListingTitle("Trail 1196: Peek a Boob")).toEqual({
      runNumber: 1196,
      trailName: "Peek a Boob",
    });
  });

  it("parses with dash separator", () => {
    expect(parseListingTitle("Trail 1200 - Some Trail Name")).toEqual({
      runNumber: 1200,
      trailName: "Some Trail Name",
    });
  });

  it("returns title only when no trail number", () => {
    expect(parseListingTitle("Special Event")).toEqual({
      trailName: "Special Event",
    });
  });

  it("handles case-insensitive 'trail' prefix", () => {
    expect(parseListingTitle("trail 1100: Name")).toEqual({
      runNumber: 1100,
      trailName: "Name",
    });
  });
});

describe("extractStartTime", () => {
  it("extracts HH:MM from ISO-like string", () => {
    expect(extractStartTime("2026-03-03T19:00:00")).toBe("19:00");
  });

  it("handles midnight", () => {
    expect(extractStartTime("2026-01-01T00:00:00")).toBe("00:00");
  });

  it("returns undefined for non-matching input", () => {
    expect(extractStartTime("2026-03-03")).toBeUndefined();
  });
});

describe("extractDate", () => {
  it("extracts YYYY-MM-DD from ISO-like string", () => {
    expect(extractDate("2026-03-03T19:00:00")).toBe("2026-03-03");
  });

  it("extracts from date-only string", () => {
    expect(extractDate("2026-12-25")).toBe("2026-12-25");
  });

  it("returns undefined for non-matching input", () => {
    expect(extractDate("March 3, 2026")).toBeUndefined();
  });
});

describe("buildDescription", () => {
  it("combines TIDBIT, NOTES distances, and ONONON", () => {
    const desc = buildDescription({
      TIDBIT: "Hide n Seek trail!",
      NOTES: "R = 4.5 mi\nW = 2.7 mi",
      ONONON: "ChuckEcheese's",
    });
    expect(desc).toBe(
      "Hide n Seek trail!\n\nRunners: 4.5 mi, Walkers: 2.7 mi\n\nOn-After: ChuckEcheese's",
    );
  });

  it("handles TIDBIT only", () => {
    expect(buildDescription({ TIDBIT: "Just a description" })).toBe("Just a description");
  });

  it("handles NOTES without distances", () => {
    expect(buildDescription({ NOTES: "Bring headlamps" })).toBeUndefined();
  });

  it("handles NOTES with only runners distance", () => {
    const desc = buildDescription({ NOTES: "R = 5 mi" });
    expect(desc).toBe("Runners: 5 mi");
  });

  it("returns undefined when all fields empty", () => {
    expect(buildDescription({})).toBeUndefined();
  });

  it("handles ONONON only", () => {
    expect(buildDescription({ ONONON: "Some Bar" })).toBe("On-After: Some Bar");
  });

  it("strips HTML tags and decodes entities from TIDBIT", () => {
    const desc = buildDescription({
      TIDBIT:
        '<div>mystery hare!<br>Start behind "LEE GIMBAP"</div><div>Pre-lube walkable, same stripmall. CHUY&apos;S<br>11219 Lee Hwy, Fairfax, VA 22030</div><div>Shiggy level HIGH. Wet. Long. Lost. No strollers or weak sauce.</div>',
    });
    expect(desc).not.toContain("<div>");
    expect(desc).not.toContain("<br>");
    expect(desc).not.toContain("&apos;");
    expect(desc).toContain("mystery hare!");
    expect(desc).toContain("CHUY'S");
  });

  it("strips HTML tags from ONONON", () => {
    const desc = buildDescription({ ONONON: "<b>Some Bar &amp; Grill</b>" });
    expect(desc).toBe("On-After: Some Bar & Grill");
  });
});

describe("buildEventFromDetail", () => {
  const baseListing = {
    title: "Trail 1196: Peek a Boob",
    start: "2026-03-03T19:00:00",
    type: "t",
    lookup_id: "10055",
  };

  const baseDetail = {
    TRAIL: "1196",
    TITLE: "Peek a Boob. Hide n Seek!",
    LOCATION: "11213k Lee Hwy, Fairfax, VA 22030",
    hashdate: "2026-03-03",
    hares: ["Fingrrrrrrrrrr"],
    TIDBIT: "A fun trail",
    ONONON: "ChuckEcheese's",
    NOTES: "R = 4.5 mi\nW = 2.7 mi",
    ADDRESS: "11213k Lee Hwy, Fairfax, VA 22030",
    MAPLINK: "",
  };

  it("maps all fields correctly", () => {
    const event = buildEventFromDetail(baseDetail, baseListing);
    expect(event.date).toBe("2026-03-03");
    expect(event.kennelTags[0]).toBe("shith3");
    expect(event.runNumber).toBe(1196);
    expect(event.title).toBe("Peek a Boob. Hide n Seek!");
    expect(event.hares).toBe("Fingrrrrrrrrrr");
    expect(event.location).toBe("11213k Lee Hwy, Fairfax, VA 22030");
    expect(event.startTime).toBe("19:00");
    expect(event.sourceUrl).toBe("https://shith3.com/events.php");
  });

  it("uses TRAIL from detail (not listing title)", () => {
    const detail = { ...baseDetail, TRAIL: "1197" };
    const listing = { ...baseListing, title: "Trail 11921: Typo Name" };
    const event = buildEventFromDetail(detail, listing);
    expect(event.runNumber).toBe(1197);
  });

  it("generates Google Maps URL when MAPLINK is empty", () => {
    const event = buildEventFromDetail(baseDetail, baseListing);
    expect(event.locationUrl).toContain("google.com/maps/search");
    expect(event.locationUrl).toContain(encodeURIComponent("11213k Lee Hwy, Fairfax, VA 22030"));
  });

  it("uses MAPLINK when provided", () => {
    const detail = { ...baseDetail, MAPLINK: "https://maps.google.com/some-link" };
    const event = buildEventFromDetail(detail, baseListing);
    expect(event.locationUrl).toBe("https://maps.google.com/some-link");
  });

  it("joins multiple hares with comma", () => {
    const detail = { ...baseDetail, hares: ["Fingrrrrrrrrrr", "Beer Me"] };
    const event = buildEventFromDetail(detail, baseListing);
    expect(event.hares).toBe("Fingrrrrrrrrrr, Beer Me");
  });

  it("handles empty hares array", () => {
    const detail = { ...baseDetail, hares: [] };
    const event = buildEventFromDetail(detail, baseListing);
    expect(event.hares).toBeUndefined();
  });

  it("falls back to ADDRESS when LOCATION is missing", () => {
    const detail = { ...baseDetail, LOCATION: undefined, ADDRESS: "123 Main St" };
    const event = buildEventFromDetail(detail, baseListing);
    expect(event.location).toBe("123 Main St");
  });

  it("falls back to listing date when hashdate is missing", () => {
    const detail = { ...baseDetail, hashdate: undefined };
    const event = buildEventFromDetail(detail, baseListing);
    expect(event.date).toBe("2026-03-03");
  });

  it("falls back to listing title when TITLE is missing", () => {
    const detail = { ...baseDetail, TITLE: undefined };
    const event = buildEventFromDetail(detail, baseListing);
    expect(event.title).toBe("Peek a Boob");
  });

  it("handles undefined runNumber when TRAIL is missing", () => {
    const detail = { ...baseDetail, TRAIL: undefined };
    const event = buildEventFromDetail(detail, baseListing);
    expect(event.runNumber).toBeUndefined();
  });
});

describe("buildEventFromListing", () => {
  it("builds basic event from listing", () => {
    const event = buildEventFromListing({
      title: "Trail 1196: Peek a Boob",
      start: "2026-03-03T19:00:00",
      type: "t",
      lookup_id: "10055",
    });
    expect(event).not.toBeNull();
    expect(event!.date).toBe("2026-03-03");
    expect(event!.kennelTags[0]).toBe("shith3");
    expect(event!.runNumber).toBe(1196);
    expect(event!.title).toBe("Peek a Boob");
    expect(event!.startTime).toBe("19:00");
  });

  it("returns null when date cannot be extracted", () => {
    const event = buildEventFromListing({
      title: "Trail 1196: Peek a Boob",
      start: "invalid",
      type: "t",
      lookup_id: "10055",
    });
    expect(event).toBeNull();
  });
});

// ---------- Adapter integration tests ----------

vi.mock("../safe-fetch", () => ({
  safeFetch: vi.fn(),
}));

import { safeFetch } from "../safe-fetch";
const mockSafeFetch = vi.mocked(safeFetch);

function makeJsonResponse(data: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: () => Promise.resolve(data),
    text: () => Promise.resolve(JSON.stringify(data)),
    headers: new Headers(),
  } as unknown as Response;
}

const sampleListings: ListingItem[] = [
  { title: "Trail 1196: Peek a Boob", start: "2026-03-03T19:00:00", type: "t", lookup_id: "10055" },
  { title: "Board Meeting", start: "2026-03-05T20:00:00", type: "m", lookup_id: "10056" },
  { title: "Trail 1197: Second Trail", start: "2026-03-10T18:30:00", type: "t", lookup_id: "10057" },
];

const sampleDetail = {
  TRAIL: "1196",
  TITLE: "Peek a Boob. Hide n Seek!",
  LOCATION: "11213k Lee Hwy, Fairfax, VA",
  hashdate: "2026-03-03",
  hares: ["Fingrrrrrrrrrr"],
  TIDBIT: "A fun trail",
  ONONON: "ChuckEcheese's",
  NOTES: "R = 4.5 mi\nW = 2.7 mi",
  ADDRESS: "11213k Lee Hwy, Fairfax, VA",
  MAPLINK: "",
};

describe("SHITH3Adapter", () => {
  const adapter = new SHITH3Adapter();
  const source = { id: "test-source", url: "https://shith3.com" } as unknown as import("@/generated/prisma/client").Source;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("filters to trail events only (type=t)", async () => {
    mockSafeFetch
      .mockResolvedValueOnce(makeJsonResponse(sampleListings)) // listing
      .mockResolvedValueOnce(makeJsonResponse(sampleDetail)) // detail for 10055
      .mockResolvedValueOnce(makeJsonResponse({ ...sampleDetail, TRAIL: "1197", hashdate: "2026-03-10" })); // detail for 10057

    const result = await adapter.fetch(source);

    // Should have called listing + 2 detail fetches (skipping the "m" type)
    expect(mockSafeFetch).toHaveBeenCalledTimes(3);
    expect(result.events).toHaveLength(2);
    expect(result.events[0].runNumber).toBe(1196);
    expect(result.events[1].runNumber).toBe(1197);
  });

  it("falls back to listing data when detail fetch fails", async () => {
    mockSafeFetch
      .mockResolvedValueOnce(makeJsonResponse(sampleListings))
      .mockResolvedValueOnce(makeJsonResponse(null, false, 500)) // detail fails for 10055
      .mockResolvedValueOnce(makeJsonResponse({ ...sampleDetail, TRAIL: "1197", hashdate: "2026-03-10" }));

    const result = await adapter.fetch(source);

    expect(result.events).toHaveLength(2);
    // First event from listing fallback — no hares, location etc.
    expect(result.events[0].hares).toBeUndefined();
    expect(result.events[0].runNumber).toBe(1196);
    // Second event from detail — has rich data
    expect(result.events[1].runNumber).toBe(1197);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain("Detail fetch failed");
  });

  it("falls back to listing data when detail fetch throws", async () => {
    mockSafeFetch
      .mockResolvedValueOnce(makeJsonResponse([sampleListings[0]])) // only 1 trail
      .mockRejectedValueOnce(new Error("Network error")); // detail throws

    const result = await adapter.fetch(source);

    expect(result.events).toHaveLength(1);
    expect(result.events[0].hares).toBeUndefined();
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain("Network error");
  });

  it("returns error when listing endpoint fails", async () => {
    mockSafeFetch.mockResolvedValueOnce(makeJsonResponse(null, false, 503));

    const result = await adapter.fetch(source);

    expect(result.events).toHaveLength(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain("Listing fetch failed");
  });

  it("returns error when listing endpoint throws", async () => {
    mockSafeFetch.mockRejectedValueOnce(new Error("DNS failure"));

    const result = await adapter.fetch(source);

    expect(result.events).toHaveLength(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain("DNS failure");
  });

  it("handles empty listing response", async () => {
    mockSafeFetch.mockResolvedValueOnce(makeJsonResponse([]));

    const result = await adapter.fetch(source);

    expect(result.events).toHaveLength(0);
    expect(result.errors).toHaveLength(0);
  });

  it("includes diagnosticContext", async () => {
    mockSafeFetch
      .mockResolvedValueOnce(makeJsonResponse(sampleListings))
      .mockResolvedValueOnce(makeJsonResponse(sampleDetail))
      .mockResolvedValueOnce(makeJsonResponse({ ...sampleDetail, TRAIL: "1197", hashdate: "2026-03-10" }));

    const result = await adapter.fetch(source);

    expect(result.diagnosticContext).toMatchObject({
      fetchMethod: "php-api",
      listingCount: 3,
      trailCount: 2,
      detailSuccesses: 2,
      detailFailures: 0,
      eventsProduced: 2,
    });
  });
});
