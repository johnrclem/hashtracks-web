import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  HarrierCentralAdapter,
  applyTitleFallback,
  composeHcLocation,
  hcGeocodeFailed,
} from "./adapter";
import type { HCEvent } from "./adapter";
import { generateAccessToken, PUBLIC_HASHER_ID } from "./token";
import type { Source } from "@/generated/prisma/client";

vi.mock("../safe-fetch", () => ({
  safeFetch: vi.fn(),
}));

import { safeFetch } from "../safe-fetch";
const mockSafeFetch = vi.mocked(safeFetch);

function makeSource(config: unknown): Source {
  return {
    id: "src-hc-1",
    config,
    url: "https://harriercentralpublicapi.azurewebsites.net/api/PortalApi/",
    type: "HARRIER_CENTRAL",
    scrapeDays: 365,
  } as unknown as Source;
}

function buildHCEvent(overrides: Partial<HCEvent> = {}): HCEvent {
  return {
    publicEventId: "5bc67750-377f-43a5-846a-a4993c6121d1",
    publicKennelId: "57f5b2c6-8d8f-41e0-8dbf-d03a0a9aa10e",
    kennelName: "Tokyo Hash House Harriers",
    kennelShortName: "TH3",
    kennelUniqueShortName: "TH3",
    eventName: "Takadanobanba",
    eventNumber: 2577,
    eventStartDatetime: "2026-04-27T19:15:00",
    syncLat: 35.71348246362192,
    syncLong: 139.70431584647287,
    locationOneLineDesc: "Yamanote, Tozai lines. Waseda exit",
    resolvableLocation: "35.713482463621920, 139.704315846472870",
    hares: "Khuming Rouge",
    eventCityAndCountry: "Tokyo, Japan",
    isVisible: 1,
    isCountedRun: 1,
    daysUntilEvent: 28,
    kennelLogo: "https://harriercentral.blob.core.windows.net/harrier/Tokyo%20H3%20Revised.png",
    ...overrides,
  };
}

function mockApiResponse(events: HCEvent[]) {
  mockSafeFetch.mockResolvedValueOnce({
    ok: true,
    status: 200,
    json: async () => [events],
  } as never);
}

describe("composeHcLocation", () => {
  it("returns undefined when both fields are missing or TBA", () => {
    expect(composeHcLocation(undefined, undefined)).toBeUndefined();
    expect(composeHcLocation("TBA", "TBA")).toBeUndefined();
    expect(composeHcLocation("", "")).toBeUndefined();
  });

  it("treats padded/case-variant TBA as missing (prevents merge UPDATE from clearing good location)", () => {
    // Without trimming-before-sentinel, " TBA " survives as a defined string
    // and the merge path would overwrite existing canonical locationName with
    // sanitizeLocation("TBA") = null on an equal-trust re-scrape.
    expect(composeHcLocation(" TBA ", " TBA ")).toBeUndefined();
    expect(composeHcLocation("tba", "TBA\n")).toBeUndefined();
  });

  it("returns place alone when resolvable is bare coordinates", () => {
    expect(composeHcLocation("Waseda exit", "35.713, 139.704")).toBe("Waseda exit");
  });

  it("returns address alone when it already contains the place name", () => {
    expect(
      composeHcLocation("Morgantown", "227 Spruce Street, Morgantown, WV"),
    ).toBe("227 Spruce Street, Morgantown, WV");
  });

  it("composes 'place, address' when both are distinct", () => {
    expect(
      composeHcLocation("Apothecary Ale House", "227 Spruce Street, Morgantown, WV"),
    ).toBe("Apothecary Ale House, 227 Spruce Street, Morgantown, WV");
  });

  it("preserves venue when its name is a substring of an address token (not a full segment)", () => {
    // "Iron Horse" appears inside "Iron Horse Tavern Road" but is NOT a complete
    // comma segment — venue should be preserved, not silently dropped.
    expect(
      composeHcLocation("Iron Horse", "Iron Horse Tavern Road, Morgantown, WV"),
    ).toBe("Iron Horse, Iron Horse Tavern Road, Morgantown, WV");
  });

  it("appends cityCountry when HC's geocoder failed (#1167)", () => {
    // place === resolvable means HC couldn't resolve a real address; the
    // downstream geocoder needs city context to avoid landing on a region
    // default pin (e.g. Imperial Palace ~10km from Akabane).
    expect(
      composeHcLocation(
        "JR Keihintohoku line, Akabane station, North Exit",
        "JR Keihintohoku line, Akabane station, North Exit",
        "Tokyo, Japan",
      ),
    ).toBe("JR Keihintohoku line, Akabane station, North Exit, Tokyo, Japan");
  });

  it("does not double-append when cityCountry already appears in the place text", () => {
    // Some HC kennels include the city name in their place description; avoid
    // "...Tokyo, Tokyo, Japan".
    expect(
      composeHcLocation("Shibuya, Tokyo", "Shibuya, Tokyo", "Tokyo, Japan"),
    ).toBe("Shibuya, Tokyo");
  });

  it("does not double-append for multi-word cities (Hong Kong, Kuala Lumpur, New York)", () => {
    // Token-only checks would miss multi-word cities — the contiguous-
    // subsequence walk catches "Hong Kong" inside "Wan Chai, Hong Kong".
    expect(
      composeHcLocation(
        "Wan Chai, Hong Kong",
        "Wan Chai, Hong Kong",
        "Hong Kong, China",
      ),
    ).toBe("Wan Chai, Hong Kong");
    expect(
      composeHcLocation(
        "Mid Valley, Kuala Lumpur",
        "Mid Valley, Kuala Lumpur",
        "Kuala Lumpur, Malaysia",
      ),
    ).toBe("Mid Valley, Kuala Lumpur");
    expect(
      composeHcLocation("Brooklyn, New York", "Brooklyn, New York", "New York, USA"),
    ).toBe("Brooklyn, New York");
  });

  it("appends multi-word city when not already present in place text", () => {
    expect(
      composeHcLocation("Mong Kok MTR exit B2", "Mong Kok MTR exit B2", "Hong Kong, China"),
    ).toBe("Mong Kok MTR exit B2, Hong Kong, China");
  });

  it("does not append cityCountry when geocoder succeeded (different fields)", () => {
    // The compose path with a real address never invokes the city-append
    // branch — the address itself already disambiguates the location.
    expect(
      composeHcLocation(
        "Apothecary Ale House",
        "227 Spruce Street, Morgantown, WV",
        "Morgantown, United States",
      ),
    ).toBe("Apothecary Ale House, 227 Spruce Street, Morgantown, WV");
  });

  it("does not append cityCountry when resolvable is bare coordinates (HC partial geocode)", () => {
    // Real coords + descriptive place — coords already pin the meeting point,
    // no need to enrich the user-facing string with city context.
    expect(
      composeHcLocation("Waseda exit", "35.713, 139.704", "Tokyo, Japan"),
    ).toBe("Waseda exit");
  });

  // Placeholder sentinels must not leak into event.location — without this the
  // merge path stores "No location provided" / "TBD, Lisbon, Portugal" and the
  // geocoder treats them as meaningless text (Codex review, PR #2031).
  it.each([
    ["empty place + 'No location provided' resolvable", undefined, "No location provided", undefined],
    ["'TBD' on both (no city append)", "TBD", "TBD", undefined],
    ["'TBD' both + cityCountry (must not become 'TBD, Lisbon, Portugal')", "TBD", "TBD", "Lisbon, Portugal"],
    ["'ANNOUNCED LATER via Hares'", "ANNOUNCED LATER via Hares", "ANNOUNCED LATER via Hares", undefined],
    ["'TBC' resolvable, empty place", "", "TBC", undefined],
    ["'To Be Announced'", "To Be Announced", "To Be Announced", "Lisbon, Portugal"],
  ])("drops placeholder sentinel from location: %s", (_label, place, resolvable, cityCountry) => {
    expect(composeHcLocation(place, resolvable, cityCountry)).toBeUndefined();
  });
});

describe("applyTitleFallback (#1166)", () => {
  it("passes through real eventName when no aliases configured", () => {
    expect(applyTitleFallback("Takadanobanba", 2577, {})).toBe("Takadanobanba");
    expect(applyTitleFallback("50th Anniversary Run", 2585, {})).toBe(
      "50th Anniversary Run",
    );
  });

  it("substitutes synthesized title when eventName matches stale alias and defaultTitle is set", () => {
    const config = {
      defaultTitle: "Tokyo H3 Trail",
      staleTitleAliases: ["Ikebukuro", "Akabane"],
    };
    expect(applyTitleFallback("Ikebukuro", 2580, config)).toBe(
      "Tokyo H3 Trail #2580",
    );
    expect(applyTitleFallback("akabane", 2581, config)).toBe(
      "Tokyo H3 Trail #2581",
    );
    // Whitespace-trimmed match.
    expect(applyTitleFallback(" Ikebukuro ", 2582, config)).toBe(
      "Tokyo H3 Trail #2582",
    );
  });

  it("substitutes synthesized title when eventName is empty/missing and defaultTitle is set", () => {
    const config = {
      defaultTitle: "Tokyo H3 Trail",
      staleTitleAliases: ["Ikebukuro"],
    };
    expect(applyTitleFallback(undefined, 2583, config)).toBe("Tokyo H3 Trail #2583");
    expect(applyTitleFallback("", 2584, config)).toBe("Tokyo H3 Trail #2584");
    expect(applyTitleFallback("   ", 2585, config)).toBe("Tokyo H3 Trail #2585");
  });

  it("returns undefined when alias matches but no defaultTitle is configured", () => {
    // Lets sources opt into stale-name detection (clearing the bad title)
    // without committing to a specific brand string yet.
    expect(
      applyTitleFallback("Ikebukuro", 2580, {
        staleTitleAliases: ["Ikebukuro"],
      }),
    ).toBeUndefined();
  });

  it("returns undefined when eventNumber is missing/zero and alias matches", () => {
    // Synthesizing "Tokyo H3 Trail #0" or "Tokyo H3 Trail #undefined" is
    // worse than an empty title — fall through to undefined.
    const config = { defaultTitle: "Tokyo H3 Trail", staleTitleAliases: ["Ikebukuro"] };
    expect(applyTitleFallback("Ikebukuro", 0, config)).toBeUndefined();
    expect(applyTitleFallback("Ikebukuro", undefined, config)).toBeUndefined();
    expect(applyTitleFallback("Ikebukuro", null, config)).toBeUndefined();
  });

  it("does not substitute a real trail name even when defaultTitle is configured", () => {
    const config = {
      defaultTitle: "Tokyo H3 Trail",
      staleTitleAliases: ["Ikebukuro", "Akabane"],
    };
    expect(applyTitleFallback("50th Anniversary Run", 2585, config)).toBe(
      "50th Anniversary Run",
    );
    expect(applyTitleFallback("Hashmas Eve", 2590, config)).toBe("Hashmas Eve");
  });

  // #2194 — Shanghai H3's eventName carries a dangling " |" when a title
  // subfield is blank. Strip trailing |/-/: separators (the #756/#1060 family).
  it("strips a dangling trailing pipe separator (#2194 Shanghai H3)", () => {
    expect(
      applyTitleFallback(
        "26th All China Nash Hash + 40th Shanghai Hash House Harriers Anniversary |",
        0,
        { defaultTitle: "Shanghai H3" },
      ),
    ).toBe("26th All China Nash Hash + 40th Shanghai Hash House Harriers Anniversary");
  });

  it("strips trailing dash/colon and surrounding whitespace too (#756/#1060)", () => {
    expect(applyTitleFallback("Trail Name -", 100, {})).toBe("Trail Name");
    expect(applyTitleFallback("Trail Name : ", 100, {})).toBe("Trail Name");
    expect(applyTitleFallback("Trail Name  |  ", 100, {})).toBe("Trail Name");
  });

  it("preserves terminal !/? — they are not separators", () => {
    expect(applyTitleFallback("Saturday Trail!", 100, {})).toBe("Saturday Trail!");
    expect(applyTitleFallback("Why?", 100, {})).toBe("Why?");
  });

  it("only strips TRAILING separators — a mid-title comma/colon survives", () => {
    // Guards the comma in the separator class: a meaningful mid-title comma
    // (not the trailing char) must not be truncated.
    expect(applyTitleFallback("Trail Name, Special Edition", 100, {})).toBe(
      "Trail Name, Special Edition",
    );
    expect(applyTitleFallback("Run #5: The Sequel", 100, {})).toBe("Run #5: The Sequel");
  });

  it("treats a separators-only eventName as stale (synthesizes when possible)", () => {
    const config = { defaultTitle: "Shanghai H3" };
    expect(applyTitleFallback(" | ", 42, config)).toBe("Shanghai H3 #42");
    // eventNumber 0 (social) can't synthesize → undefined (UI run-number fallback)
    expect(applyTitleFallback(" | ", 0, config)).toBeUndefined();
  });
});

describe("hcGeocodeFailed", () => {
  it("returns true when both fields are non-empty and equal (case-insensitive)", () => {
    expect(hcGeocodeFailed("Ikebukuro exit", "Ikebukuro exit")).toBe(true);
    expect(hcGeocodeFailed("JR Keihintohoku line", "jr keihintohoku line")).toBe(true);
  });

  it("returns false when either field is missing or TBA", () => {
    expect(hcGeocodeFailed(undefined, "Anything")).toBe(false);
    expect(hcGeocodeFailed("Anything", undefined)).toBe(false);
    expect(hcGeocodeFailed("TBA", "TBA")).toBe(false);
    expect(hcGeocodeFailed("", "")).toBe(false);
  });

  it("returns false when fields differ (real geocoded address)", () => {
    expect(
      hcGeocodeFailed("YR Event Hall", "1 Chome−10−15, Toshima City, 171-0021, Japan"),
    ).toBe(false);
  });

  it("returns false when resolvable is bare coordinates (HC partial geocode)", () => {
    // Coords-only resolvable means HC has the meeting point's coords even
    // though it couldn't reverse-geocode a street name. Keep them.
    expect(hcGeocodeFailed("Waseda exit", "35.713, 139.704")).toBe(false);
  });

  // Placeholder-venue sentinels: kennels that announce venues day-of (Lisbon
  // H3) leave a placeholder in one or both location fields. HC pairs them with
  // its region-default pin, so these must be treated as geocode failures even
  // when the place field is empty (the equality check alone misses them).
  it.each([
    ["empty place + 'No location provided' resolvable", undefined, "No location provided"],
    ["empty place + 'TBD' resolvable", "", "TBD"],
    ["'ANNOUNCED LATER via Hares' (case/space-insensitive)", "  announced later via hares ", "ANNOUNCED LATER via Hares"],
    ["matching 'TBD' on both", "TBD", "TBD"],
    ["place 'To Be Determined' + bare coords resolvable", "To Be Determined", "38.722, -9.144"],
    ["'TBC' resolvable (UK/Ireland variant)", undefined, "TBC"],
    ["'To Be Confirmed'", "To Be Confirmed", "To Be Confirmed"],
    ["'To Be Announced' resolvable", "", "To Be Announced"],
  ])("returns true for placeholder sentinel: %s", (_label, place, resolvable) => {
    expect(hcGeocodeFailed(place, resolvable)).toBe(true);
  });

  it("returns false for a real venue that is not a placeholder sentinel", () => {
    // Regression guard: a genuine venue name distinct from the resolved
    // address must keep its coords.
    expect(
      hcGeocodeFailed("Iron Horse Tavern", "140 High Street, Morgantown, 26505, WV, United States"),
    ).toBe(false);
  });
});

describe("generateAccessToken", () => {
  it("produces a 64-char hex string", () => {
    const token = generateAccessToken("getEvents");
    expect(token).toMatch(/^[0-9A-F]{64}$/);
  });

  it("produces different tokens for different query types", () => {
    const t1 = generateAccessToken("getEvents");
    const t2 = generateAccessToken("getKennel");
    expect(t1).not.toBe(t2);
  });

  it("uses the correct public hasher ID", () => {
    expect(PUBLIC_HASHER_ID).toBe("11111111-1111-1111-1111-111111111111");
  });
});

describe("HarrierCentralAdapter", () => {
  let adapter: HarrierCentralAdapter;

  // Freeze the clock at the fixtures' era so the windowed/year-inferred assertions never age out (#2066).
  beforeEach(() => {
    vi.clearAllMocks();
    adapter = new HarrierCentralAdapter();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-04-01T12:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("has correct type", () => {
    expect(adapter.type).toBe("HARRIER_CENTRAL");
  });

  describe("fetch", () => {
    it("fetches and converts events from API response", async () => {
      const hcEvent = buildHCEvent();
      mockApiResponse([hcEvent]);

      const source = makeSource({ cityNames: "Tokyo", defaultKennelTag: "tokyo-h3" });
      const result = await adapter.fetch(source);

      expect(result.events).toHaveLength(1);
      expect(result.errors).toHaveLength(0);

      const evt = result.events[0];
      expect(evt.date).toBe("2026-04-27");
      expect(evt.startTime).toBe("19:15");
      expect(evt.kennelTags[0]).toBe("tokyo-h3");
      expect(evt.title).toBe("Takadanobanba");
      expect(evt.runNumber).toBe(2577);
      expect(evt.hares).toBe("Khuming Rouge");
      expect(evt.location).toBe("Yamanote, Tozai lines. Waseda exit");
      expect(evt.latitude).toBeCloseTo(35.713, 2);
      expect(evt.longitude).toBeCloseTo(139.704, 2);
      // sourceUrl is intentionally omitted — hashruns.org/#/event/... links
      // no longer resolve in the Flutter UI (#706, #725).
      expect(evt.sourceUrl).toBeUndefined();
    });

    it("skips invisible events", async () => {
      mockApiResponse([buildHCEvent({ isVisible: 0 })]);
      const result = await adapter.fetch(makeSource({ defaultKennelTag: "tokyo-h3" }));
      expect(result.events).toHaveLength(0);
    });

    it("skips events with TBA hares and location", async () => {
      mockApiResponse([buildHCEvent({ hares: "TBA", locationOneLineDesc: "TBA" })]);
      const result = await adapter.fetch(makeSource({ defaultKennelTag: "tokyo-h3" }));
      expect(result.events).toHaveLength(1);
      expect(result.events[0].hares).toBeUndefined();
      expect(result.events[0].location).toBeUndefined();
    });

    it("strips the HC 'Placeholder user for visitors / virgins' boilerplate hare (#2220 Lisbon)", async () => {
      // Lisbon H3 run #1017: HC appends a system placeholder entry after the
      // real hare. Only "Depth Charge" should survive.
      mockApiResponse([
        buildHCEvent({
          hares: "Depth Charge , Placeholder user for visitors / virgins for Lisbon H3",
        }),
      ]);
      const result = await adapter.fetch(makeSource({ defaultKennelTag: "lh3-pt" }));
      expect(result.events).toHaveLength(1);
      expect(result.events[0].hares).toBe("Depth Charge");
    });

    it("returns undefined hares when only the placeholder entry is present (#2220)", async () => {
      mockApiResponse([
        buildHCEvent({ hares: "Placeholder user for visitors / virgins for Lisbon H3" }),
      ]);
      const result = await adapter.fetch(makeSource({ defaultKennelTag: "lh3-pt" }));
      expect(result.events[0].hares).toBeUndefined();
    });

    it("keeps ordinary multi-hare lists intact (no placeholder)", async () => {
      mockApiResponse([buildHCEvent({ hares: "Alice, Bob" })]);
      const result = await adapter.fetch(makeSource({ defaultKennelTag: "tokyo-h3" }));
      expect(result.events[0].hares).toBe("Alice, Bob");
    });

    it("nulls hares (but keeps location) when the source pasted the same value into both slots (#521)", async () => {
      // Tokyo H3 #2578 reproduction: the kennel owner typed the train line
      // name into both the "hares" and "location" form fields. Null the
      // hare (it's almost certainly wrong); leave location alone — the
      // separate location-quality audit will catch it if it's also bad,
      // and erasing it unconditionally could drop valid data on other HC
      // kennels where the strings happen to match.
      mockApiResponse([
        buildHCEvent({
          hares: "JR Keihintohoku line",
          locationOneLineDesc: "JR Keihintohoku line",
        }),
      ]);
      const result = await adapter.fetch(makeSource({ defaultKennelTag: "tokyo-h3" }));
      expect(result.events).toHaveLength(1);
      expect(result.events[0].hares).toBeUndefined();
      expect(result.events[0].location).toBe("JR Keihintohoku line");
    });

    it("keeps distinct hares and location values unchanged", async () => {
      // Sanity check that the duplicate-field filter doesn't bite the happy path.
      mockApiResponse([
        buildHCEvent({ hares: "Blue Job", locationOneLineDesc: "Nishiogikubo" }),
      ]);
      const result = await adapter.fetch(makeSource({ defaultKennelTag: "tokyo-h3" }));
      expect(result.events[0].hares).toBe("Blue Job");
      expect(result.events[0].location).toBe("Nishiogikubo");
    });

    it("nulls hares when address-shaped haresText is a prefix of location (#1642)", async () => {
      // SG Sunday H3 #798 reproduction: hares "Swiss Club Road, dead end old
      // Turf City" is a strict prefix of location "Swiss Club Road, dead end
      // old Turf City, Singapore". The exact-match guard from #521 missed it
      // because the location has ", Singapore" appended.
      mockApiResponse([
        buildHCEvent({
          hares: "Swiss Club Road, dead end old Turf City",
          locationOneLineDesc: "Swiss Club Road, dead end old Turf City",
          eventCityAndCountry: "Singapore",
        }),
      ]);
      const result = await adapter.fetch(makeSource({ defaultKennelTag: "sh3-sg" }));
      expect(result.events).toHaveLength(1);
      expect(result.events[0].hares).toBeUndefined();
      // Location is preserved as-is; what matters is the haresText was nulled.
      expect(result.events[0].location).toContain(
        "Swiss Club Road, dead end old Turf City",
      );
    });

    it("nulls hares when multi-word haresText is an exact comma-prefix of location (#2021)", async () => {
      // SG Sunday H3 #799 reproduction: hares "CO Blk 317A Jurong East Str 31"
      // and location "CO Blk 317A Jurong East Str 31, Singapore". The hares has
      // zero road-token signals ("blk"/"str" aren't in ADDRESS_TOKENS), so the
      // two-signal substring heuristic missed it — but the location is exactly
      // the hares plus ", Singapore", which the comma-prefix path catches.
      mockApiResponse([
        buildHCEvent({
          hares: "CO Blk 317A Jurong East Str 31",
          locationOneLineDesc: "CO Blk 317A Jurong East Str 31",
          eventCityAndCountry: "Singapore",
        }),
      ]);
      const result = await adapter.fetch(makeSource({ defaultKennelTag: "sh3-sg" }));
      expect(result.events).toHaveLength(1);
      expect(result.events[0].hares).toBeUndefined();
      expect(result.events[0].location).toContain(
        "CO Blk 317A Jurong East Str 31",
      );
    });

    it("keeps a multi-word hare that is only a non-comma substring of location", async () => {
      // Defensive companion to #2021: a real two-word hash name embedded in a
      // longer venue ("George Park Bar") must survive — it is NOT an exact
      // comma-prefix of the location, so the new path does not fire.
      mockApiResponse([
        buildHCEvent({
          hares: "George Park",
          locationOneLineDesc: "George Park Bar and Grill",
        }),
      ]);
      const result = await adapter.fetch(makeSource({ defaultKennelTag: "tokyo-h3" }));
      expect(result.events[0].hares).toBe("George Park");
    });

    it("keeps hares when value is a substring of location but lacks address signals", async () => {
      // Defensive: a hare named after a street tile ("George") must NOT be
      // nulled just because the location contains the same word. The
      // address-shape signals (comma / street token / leading digit) gate
      // the substring path; "George" alone trips none of them.
      mockApiResponse([
        buildHCEvent({
          hares: "George",
          locationOneLineDesc: "George Street Plaza",
        }),
      ]);
      const result = await adapter.fetch(makeSource({ defaultKennelTag: "tokyo-h3" }));
      expect(result.events[0].hares).toBe("George");
    });

    it.each([
      // Hash-name shapes that substring-match the location text but should
      // NOT be nulled. Each fails the two-signal threshold (#1642 codex
      // round-1 review caught this — "park"/"court" were too aggressive
      // and are no longer in ADDRESS_TOKENS).
      ["Park", "Central Park"],
      ["George Park", "George Park Bar"],
      ["Court", "Food Court"],
      ["Way", "Way Out Bar"],
    ])("keeps real hare name %q against location %q", async (hares, location) => {
      mockApiResponse([
        buildHCEvent({ hares, locationOneLineDesc: location }),
      ]);
      const result = await adapter.fetch(makeSource({ defaultKennelTag: "tokyo-h3" }));
      expect(result.events[0].hares).toBe(hares);
    });

    it("nulls hares when value has BOTH a leading number AND a street-type token", async () => {
      // Two-signal threshold: leading digit AND "Street" token both
      // present → strong enough to be confident the hares slot was
      // pasted with an address by mistake.
      mockApiResponse([
        buildHCEvent({
          hares: "1234 Main Street",
          locationOneLineDesc: "1234 Main Street, Springfield",
        }),
      ]);
      const result = await adapter.fetch(makeSource({ defaultKennelTag: "tokyo-h3" }));
      expect(result.events[0].hares).toBeUndefined();
    });

    it("keeps hares when only a single address signal is present", async () => {
      // Just a leading digit ("4 Eyes" hash name) is one signal — not enough.
      mockApiResponse([
        buildHCEvent({
          hares: "4 Eyes",
          locationOneLineDesc: "4 Eyes Lounge",
        }),
      ]);
      const result = await adapter.fetch(makeSource({ defaultKennelTag: "tokyo-h3" }));
      expect(result.events[0].hares).toBe("4 Eyes");
    });

    it("uses kennelPatterns to resolve kennel tag", async () => {
      const seattleEvents = [
        buildHCEvent({ kennelName: "SeaMon H3", kennelShortName: "SeaMon", kennelUniqueShortName: "SeaMon" }),
        buildHCEvent({ kennelName: "Puget Sound H3", kennelShortName: "PSH3", kennelUniqueShortName: "PSH3" }),
      ];
      mockApiResponse(seattleEvents);

      const source = makeSource({
        cityNames: "Seattle",
        kennelPatterns: [
          ["SeaMon", "seamon-h3"],
          ["Puget Sound|PSH3", "psh3"],
        ],
        defaultKennelTag: "seattle-unknown",
      });

      const result = await adapter.fetch(source);
      expect(result.events).toHaveLength(2);
      expect(result.events[0].kennelTags[0]).toBe("seamon-h3");
      expect(result.events[1].kennelTags[0]).toBe("psh3");
    });

    it("falls back to kennelUniqueShortName when no config patterns match", async () => {
      mockApiResponse([buildHCEvent()]);
      const result = await adapter.fetch(makeSource({}));
      expect(result.events).toHaveLength(1);
      expect(result.events[0].kennelTags[0]).toBe("TH3");
    });

    it("handles API errors gracefully", async () => {
      mockSafeFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => [[{
          errorType: 3,
          errorTitle: "Invalid access token",
          errorUserMessage: "An invalid access token was passed",
        }]],
      } as never);

      const result = await adapter.fetch(makeSource({ cityNames: "Tokyo" }));
      expect(result.events).toHaveLength(0);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain("Invalid access token");
    });

    it("handles HTTP errors gracefully", async () => {
      mockSafeFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
      } as never);

      const result = await adapter.fetch(makeSource({ cityNames: "Tokyo" }));
      expect(result.events).toHaveLength(0);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain("HTTP 500");
    });

    it("handles network errors gracefully", async () => {
      mockSafeFetch.mockRejectedValueOnce(new Error("Network timeout"));

      const result = await adapter.fetch(makeSource({ cityNames: "Tokyo" }));
      expect(result.events).toHaveLength(0);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain("Network timeout");
    });

    it("sends correct API body with cityNames filter", async () => {
      mockApiResponse([]);
      await adapter.fetch(makeSource({ cityNames: "Tokyo", defaultKennelTag: "tokyo-h3" }));

      expect(mockSafeFetch).toHaveBeenCalledTimes(1);
      const callBody = JSON.parse(mockSafeFetch.mock.calls[0][1]!.body as string);
      expect(callBody.queryType).toBe("getEvents");
      expect(callBody.cityNames).toBe("Tokyo");
      expect(callBody.publicHasherId).toBe(PUBLIC_HASHER_ID);
      expect(callBody.accessToken).toMatch(/^[0-9A-F]{64}$/);
    });

    it("filters out events beyond the days cutoff", async () => {
      const farFuture = buildHCEvent({ eventStartDatetime: "2028-06-01T19:15:00" });
      const nearFuture = buildHCEvent({ eventStartDatetime: "2026-04-15T19:15:00" });
      mockApiResponse([farFuture, nearFuture]);

      const result = await adapter.fetch(makeSource({ defaultKennelTag: "tokyo-h3" }), { days: 30 });
      expect(result.events).toHaveLength(1);
      expect(result.events[0].date).toBe("2026-04-15");
    });

    it("preserves zero-value lat/lng (equator is valid) but drops runNumber=0 (#892)", async () => {
      // eventNumber=0 is how HC flags social / "drinking practice" events that
      // aren't part of the numbered run series. Storing it as runNumber=0 shows
      // "#0" on the event card (Morgantown H3's "Hillbilly Drinking Practice"
      // regression). Coordinates at 0,0 are genuinely the equator — keep them.
      // Adapter emits `null` (not undefined) so the merge UPDATE path actively
      // clears any stale runNumber stored before the fix shipped.
      mockApiResponse([buildHCEvent({ syncLat: 0, syncLong: 0, eventNumber: 0 })]);
      const result = await adapter.fetch(makeSource({ defaultKennelTag: "tokyo-h3" }));
      expect(result.events).toHaveLength(1);
      expect(result.events[0].latitude).toBe(0);
      expect(result.events[0].longitude).toBe(0);
      expect(result.events[0].runNumber).toBeNull();
    });

    it("preserves existing runNumber when eventNumber is absent/invalid (#892)", async () => {
      // Only the explicit 0 sentinel clears; a negative or missing value
      // must pass through as `undefined` so the merge UPDATE path leaves
      // any existing canonical runNumber untouched. Otherwise a partial HC
      // payload would silently wipe good data on re-scrape.
      mockApiResponse([buildHCEvent({ eventNumber: -1 })]);
      const result = await adapter.fetch(makeSource({ defaultKennelTag: "tokyo-h3" }));
      expect(result.events).toHaveLength(1);
      expect(result.events[0].runNumber).toBeUndefined();
    });

    it("composes locationName with street address when resolvableLocation is a real address (#907)", async () => {
      // Morgantown MH3-US actual payload: locationOneLineDesc is the venue
      // name, resolvableLocation is the full USPS-shaped address. Prefer the
      // composed "{venue}, {address}" form so the event card shows street-level
      // context, not just "Apothecary Ale House and Cafe".
      mockApiResponse([
        buildHCEvent({
          locationOneLineDesc: "Apothecary Ale House and Cafe",
          resolvableLocation: "227 Spruce Street, Morgantown, 26505-7511, WV, United States",
        }),
      ]);
      const result = await adapter.fetch(makeSource({ defaultKennelTag: "mh3-wv" }));
      expect(result.events[0].location).toBe(
        "Apothecary Ale House and Cafe, 227 Spruce Street, Morgantown, 26505-7511, WV, United States",
      );
    });

    it("falls back to locationOneLineDesc when resolvableLocation is bare coordinates", async () => {
      // Tokyo H3 payload: HC couldn't geocode the meeting point so
      // resolvableLocation is a lat/lng pair, which is useless as user-facing
      // text. Use the one-line description alone.
      mockApiResponse([
        buildHCEvent({
          locationOneLineDesc: "Yamanote, Tozai lines. Waseda exit",
          resolvableLocation: "35.713482463621920, 139.704315846472870",
        }),
      ]);
      const result = await adapter.fetch(makeSource({ defaultKennelTag: "tokyo-h3" }));
      expect(result.events[0].location).toBe("Yamanote, Tozai lines. Waseda exit");
    });

    it("returns full address alone when locationOneLineDesc duplicates it", async () => {
      mockApiResponse([
        buildHCEvent({
          locationOneLineDesc: "227 Spruce Street, Morgantown",
          resolvableLocation: "227 Spruce Street, Morgantown, 26505-7511, WV, United States",
        }),
      ]);
      const result = await adapter.fetch(makeSource({ defaultKennelTag: "mh3-wv" }));
      expect(result.events[0].location).toBe(
        "227 Spruce Street, Morgantown, 26505-7511, WV, United States",
      );
    });

    it("composes full address for #2585 fixture (regression for #922)", async () => {
      // Live HC API payload for Tokyo H3 run #2585 ("50th Anniversary Run")
      // captured 2026-04-25. The composed string is what the merge UPDATE
      // path will write to Event.locationName once the Tokyo source re-scrapes;
      // the bug report is for stale DB rows that landed before HC started
      // returning the full resolvableLocation. See #922.
      mockApiResponse([
        buildHCEvent({
          eventNumber: 2585,
          eventName: "50th Anniversary Run",
          locationOneLineDesc: "YR Event Hall",
          resolvableLocation: "1 Chome−10−15 養老乃瀧池袋ビル 4階, Toshima City, 171-0021, Japan",
          syncLat: 35.72932,
          syncLong: 139.70899,
        }),
      ]);
      const result = await adapter.fetch(makeSource({ defaultKennelTag: "tokyo-h3" }));
      expect(result.events[0].location).toBe(
        "YR Event Hall, 1 Chome−10−15 養老乃瀧池袋ビル 4階, Toshima City, 171-0021, Japan",
      );
      // Coords look real (Toshima City) — keep them.
      expect(result.events[0].latitude).toBe(35.72932);
      expect(result.events[0].longitude).toBe(139.70899);
    });

    it("drops API coords when HC's geocoder failed (#957 Ikebukuro Imperial Palace)", async () => {
      // When `resolvableLocation` is a verbatim copy of `locationOneLineDesc`,
      // HC's geocoder couldn't resolve a real address and `syncLat`/`syncLong`
      // are HC's region-default fallback (35.685, 139.751 — Imperial Palace
      // area for any un-geocoded Tokyo event). Drop the coords so the merge
      // pipeline geocodes from the place text + kennel country bias instead.
      mockApiResponse([
        buildHCEvent({
          eventNumber: 2579,
          eventName: "Ikebukuro",
          locationOneLineDesc: "Ikebukuro (Yamanote) Metropolitan exit(west exit)",
          resolvableLocation: "Ikebukuro (Yamanote) Metropolitan exit(west exit)",
          syncLat: 35.68501691,
          syncLong: 139.7514074,
        }),
      ]);
      const result = await adapter.fetch(makeSource({ defaultKennelTag: "tokyo-h3" }));
      expect(result.events).toHaveLength(1);
      expect(result.events[0].latitude).toBeUndefined();
      expect(result.events[0].longitude).toBeUndefined();
      // Place text still flows through so the geocoder has something to use,
      // enriched with eventCityAndCountry per #1167 so geocoding doesn't
      // fall back to a region-default pin.
      expect(result.events[0].location).toBe(
        "Ikebukuro (Yamanote) Metropolitan exit(west exit), Tokyo, Japan",
      );
      // Adapter signals the merge pipeline to bypass the existingCoords cache
      // short-circuit so previously-stored fallback pins get refreshed.
      expect(result.events[0].dropCachedCoords).toBe(true);
    });

    it("substitutes neighborhood titles + appends city to transit-prose location (#1166 + #1167)", async () => {
      // Tokyo H3 #2580 reproduction: HC returns the neighborhood as both
      // eventName and locationOneLineDesc; resolvableLocation is verbatim and
      // syncLat/Lng are HC's fallback region default. With the source seeded
      // with defaultTitle + staleTitleAliases, the adapter should substitute a
      // synthesized title AND enrich the location with city/country.
      mockApiResponse([
        buildHCEvent({
          eventNumber: 2580,
          eventName: "Akabane",
          locationOneLineDesc: "JR Keihintohoku line, Akabane station, North Exit",
          resolvableLocation: "JR Keihintohoku line, Akabane station, North Exit",
        }),
      ]);
      const result = await adapter.fetch(
        makeSource({
          cityNames: "Tokyo",
          defaultKennelTag: "tokyo-h3",
          defaultTitle: "Tokyo H3 Trail",
          staleTitleAliases: ["Ikebukuro", "Akabane", "Suidobashi"],
        }),
      );
      expect(result.events).toHaveLength(1);
      expect(result.events[0].title).toBe("Tokyo H3 Trail #2580");
      expect(result.events[0].location).toBe(
        "JR Keihintohoku line, Akabane station, North Exit, Tokyo, Japan",
      );
      expect(result.events[0].dropCachedCoords).toBe(true);
    });

    it("omits dropCachedCoords when HC's geocoder succeeded", async () => {
      // Real geocoded address — adapter must not signal cache drop, otherwise
      // every healthy HC scrape would force a redundant geocode lookup.
      mockApiResponse([
        buildHCEvent({
          locationOneLineDesc: "YR Event Hall",
          resolvableLocation: "1 Chome−10−15, Toshima City, 171-0021, Japan",
          syncLat: 35.72932,
          syncLong: 139.70899,
        }),
      ]);
      const result = await adapter.fetch(makeSource({ defaultKennelTag: "tokyo-h3" }));
      expect(result.events[0].dropCachedCoords).toBeUndefined();
    });

    it("preserves API coords when resolvableLocation is bare coords (HC geocode partial success)", async () => {
      // Tokyo H3 #2578: HC has real coords in resolvableLocation (geocoded
      // the meeting point) even though the place text is descriptive. The
      // place !== resolvable check correctly leaves these coords alone.
      mockApiResponse([
        buildHCEvent({
          locationOneLineDesc: "Yamanote, Tozai lines. Waseda exit",
          resolvableLocation: "35.713482463621920, 139.704315846472870",
          syncLat: 35.71348246362192,
          syncLong: 139.70431584647287,
        }),
      ]);
      const result = await adapter.fetch(makeSource({ defaultKennelTag: "tokyo-h3" }));
      expect(result.events[0].latitude).toBe(35.71348246362192);
      expect(result.events[0].longitude).toBe(139.70431584647287);
    });

    it("includes diagnosticContext in result", async () => {
      mockApiResponse([buildHCEvent()]);
      const result = await adapter.fetch(makeSource({ defaultKennelTag: "tokyo-h3" }));
      expect(result.diagnosticContext).toBeDefined();
      expect(result.diagnosticContext!.apiEventsReturned).toBe(1);
      expect(result.diagnosticContext!.eventsEmitted).toBe(1);
    });
  });
});
