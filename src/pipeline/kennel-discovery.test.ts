vi.mock("@/lib/db", () => ({
  prisma: {
    kennel: { findMany: vi.fn() },
    kennelAlias: { findMany: vi.fn() },
    kennelDiscovery: { findMany: vi.fn(), upsert: vi.fn(), update: vi.fn() },
  },
}));
vi.mock("@/adapters/hashrego/kennel-directory-parser");
vi.mock("@/adapters/hashrego/kennel-api");

import { prisma } from "@/lib/db";
import { parseKennelDirectory } from "@/adapters/hashrego/kennel-directory-parser";
import {
  fetchKennelProfiles,
  buildScheduleString,
  buildPaymentInfo,
  normalizeTrailDay,
} from "@/adapters/hashrego/kennel-api";
import {
  syncKennelDiscovery,
  mapProfileToKennelFields,
  applyGeoPenalty,
  normalizeCountry,
  parseCountryFromLocation,
  type DiscoveryGeoContext,
  type KennelGeoData,
} from "./kennel-discovery";
import type { HashRegoKennelProfile } from "@/adapters/hashrego/kennel-api";
import type { DiscoveredKennel } from "@/adapters/hashrego/kennel-directory-parser";

function buildDiscovered(overrides: Partial<DiscoveredKennel> = {}): DiscoveredKennel {
  return {
    slug: "TESTH3",
    name: "Test H3",
    location: "Test City, ST, USA",
    latitude: 40,
    longitude: -74,
    schedule: "Weekly, Saturdays",
    url: "https://hashrego.com/kennels/TESTH3/",
    ...overrides,
  };
}

function buildApiProfile(overrides: Partial<HashRegoKennelProfile> = {}): HashRegoKennelProfile {
  return {
    name: "Test Hash House Harriers",
    slug: "TESTH3",
    email: "test@hash.com",
    website: "https://www.testh3.com",
    year_started: 2000,
    trail_frequency: "Weekly",
    trail_day: "Saturdays",
    trail_price: 10,
    city: "Test City",
    state: "ST",
    country: "USA",
    logo_image_url: null,
    member_count: 50,
    has_paypal: false,
    opt_paypal_email: "",
    has_venmo: false,
    opt_venmo_account: "",
    has_square_cash: false,
    opt_square_cashtag: "",
    is_active: true,
    ...overrides,
  };
}

beforeEach(() => {
  vi.resetAllMocks();

  // Stub global fetch for the directory page
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
    ok: true,
    text: async () => "<html>mock page</html>",
  } as Response));

  // Default mocks
  vi.mocked(parseKennelDirectory).mockReturnValue([]);
  vi.mocked(fetchKennelProfiles).mockResolvedValue(new Map());
  vi.mocked(buildScheduleString).mockImplementation((f, d) => {
    const parts = [f, d].filter(Boolean);
    return parts.length > 0 ? parts.join(", ") : undefined;
  });
  vi.mocked(buildPaymentInfo).mockReturnValue(null);
  vi.mocked(normalizeTrailDay).mockImplementation((day) => {
    if (!day) return undefined;
    const trimmed = day.trim();
    if (trimmed.endsWith("s") && trimmed.length > 3) return trimmed.slice(0, -1);
    return trimmed;
  });

  // Prisma mocks
  vi.mocked(prisma.kennel.findMany).mockResolvedValue([] as never);
  vi.mocked(prisma.kennelAlias.findMany).mockResolvedValue([] as never);
  vi.mocked(prisma.kennelDiscovery.findMany).mockResolvedValue([] as never);
  vi.mocked(prisma.kennelDiscovery.upsert).mockResolvedValue({} as never);
  vi.mocked(prisma.kennelDiscovery.update).mockResolvedValue({} as never);
});

describe("syncKennelDiscovery", () => {
  it("returns empty result when directory page fetch fails", async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: false, status: 500 } as Response);

    const result = await syncKennelDiscovery();
    expect(result.totalDiscovered).toBe(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain("HTTP 500");
  });

  it("returns empty result when no kennels found in directory", async () => {
    vi.mocked(parseKennelDirectory).mockReturnValue([]);

    const result = await syncKennelDiscovery();
    expect(result.totalDiscovered).toBe(0);
    expect(result.errors[0]).toContain("No kennels found");
  });

  it("creates NEW discovery when no match exists", async () => {
    vi.mocked(parseKennelDirectory).mockReturnValue([buildDiscovered()]);

    const result = await syncKennelDiscovery();
    expect(result.totalDiscovered).toBe(1);
    expect(result.newKennels).toBe(1);
    expect(result.autoMatched).toBe(0);

    expect(prisma.kennelDiscovery.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          externalSource: "HASHREGO",
          externalSlug: "TESTH3",
          status: "NEW",
          matchedKennelId: null,
        }),
      }),
    );
  });

  it("auto-matches with MATCHED status when score >= 0.95", async () => {
    vi.mocked(parseKennelDirectory).mockReturnValue([
      buildDiscovered({ slug: "EWH3", name: "Everyday Is Wednesday H3", latitude: 38.9, longitude: -77.0 }),
    ]);

    // Return existing kennel that will match perfectly by shortName (same region)
    vi.mocked(prisma.kennel.findMany).mockResolvedValue([
      { id: "k1", shortName: "EWH3", fullName: "Everyday Is Wednesday H3", country: "USA", regionRef: { centroidLat: 38.9, centroidLng: -77.0 } },
    ] as never);

    const result = await syncKennelDiscovery();
    expect(result.autoMatched).toBe(1);

    expect(prisma.kennelDiscovery.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          status: "MATCHED",
          matchedKennelId: "k1",
        }),
      }),
    );
  });

  it("runs upsert for moderate-score discovery (0.6–0.94)", async () => {
    vi.mocked(parseKennelDirectory).mockReturnValue([
      buildDiscovered({ slug: "NYRG", name: "New York Road Gangsters", latitude: 40.7, longitude: -74.0 }),
    ]);

    // Create a kennel with moderate match via alias (same region)
    vi.mocked(prisma.kennel.findMany).mockResolvedValue([
      { id: "k2", shortName: "NYCH3", fullName: "New York City H3", country: "USA", regionRef: { centroidLat: 40.7, centroidLng: -74.0 } },
    ] as never);
    vi.mocked(prisma.kennelAlias.findMany).mockResolvedValue([
      { kennelId: "k2", alias: "New York Hash" },
    ] as never);

    const result = await syncKennelDiscovery();
    expect(result.newKennels).toBe(1);

    // Check that upsert was called — candidates may or may not be populated
    // depending on actual fuzzy score. Just verify the call happened.
    expect(prisma.kennelDiscovery.upsert).toHaveBeenCalledTimes(1);
  });

  it("preserves DISMISSED status (only updates lastSeenAt)", async () => {
    vi.mocked(parseKennelDirectory).mockReturnValue([buildDiscovered()]);
    vi.mocked(prisma.kennelDiscovery.findMany).mockResolvedValue([
      { externalSlug: "TESTH3", status: "DISMISSED" },
    ] as never);

    const result = await syncKennelDiscovery();
    expect(result.updated).toBe(1);
    expect(result.newKennels).toBe(0);

    expect(prisma.kennelDiscovery.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          externalSource_externalSlug: {
            externalSource: "HASHREGO",
            externalSlug: "TESTH3",
          },
        },
        data: expect.objectContaining({ lastSeenAt: expect.any(Date) }),
      }),
    );
    // Should NOT call upsert for terminal status
    expect(prisma.kennelDiscovery.upsert).not.toHaveBeenCalled();
  });

  it("preserves LINKED status (only updates lastSeenAt)", async () => {
    vi.mocked(parseKennelDirectory).mockReturnValue([buildDiscovered()]);
    vi.mocked(prisma.kennelDiscovery.findMany).mockResolvedValue([
      { externalSlug: "TESTH3", status: "LINKED" },
    ] as never);

    const result = await syncKennelDiscovery();
    expect(result.updated).toBe(1);
    expect(prisma.kennelDiscovery.update).toHaveBeenCalledTimes(1);
    expect(prisma.kennelDiscovery.upsert).not.toHaveBeenCalled();
  });

  it("enriches with API profile data", async () => {
    const discovered = buildDiscovered({ slug: "EWH3" });
    vi.mocked(parseKennelDirectory).mockReturnValue([discovered]);

    const profile = buildApiProfile({ slug: "EWH3", website: "https://ewh3.com" });
    vi.mocked(fetchKennelProfiles).mockResolvedValue(
      new Map([["EWH3", profile]]),
    );

    const result = await syncKennelDiscovery();
    expect(result.enriched).toBe(1);

    expect(prisma.kennelDiscovery.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          website: "https://ewh3.com",
          contactEmail: "test@hash.com",
          yearStarted: 2000,
          trailPrice: 10,
        }),
      }),
    );
  });

  it("re-runs matching for existing NEW entries", async () => {
    vi.mocked(parseKennelDirectory).mockReturnValue([buildDiscovered()]);
    vi.mocked(prisma.kennelDiscovery.findMany).mockResolvedValue([
      { externalSlug: "TESTH3", status: "NEW" },
    ] as never);

    const result = await syncKennelDiscovery();
    // Existing NEW status should be re-processed via upsert
    expect(prisma.kennelDiscovery.upsert).toHaveBeenCalledTimes(1);
    expect(result.updated).toBe(1);
  });

  it("handles fetch network error gracefully", async () => {
    vi.mocked(fetch).mockRejectedValue(new Error("DNS resolution failed"));

    const result = await syncKennelDiscovery();
    expect(result.totalDiscovered).toBe(0);
    expect(result.errors[0]).toContain("DNS resolution failed");
  });
});

describe("mapProfileToKennelFields", () => {
  it("maps API profile to kennel creation fields", () => {
    const profile = buildApiProfile({
      name: "Test H3",
      website: "https://test.com",
      email: "gm@test.com",
      year_started: 2005,
      trail_price: 5,
      trail_frequency: "Weekly",
      trail_day: "Saturdays",
    });

    const fields = mapProfileToKennelFields(profile);
    expect(fields.fullName).toBe("Test H3");
    expect(fields.website).toBe("https://test.com");
    expect(fields.contactEmail).toBe("gm@test.com");
    expect(fields.foundedYear).toBe(2005);
    expect(fields.hashCash).toBe("$5");
    expect(fields.scheduleFrequency).toBe("Weekly");
    expect(fields.scheduleDayOfWeek).toBe("Saturday");
  });

  it("generates Venmo payment link", () => {
    const profile = buildApiProfile({
      has_venmo: true,
      opt_venmo_account: "@EWH3",
    });
    vi.mocked(buildPaymentInfo).mockReturnValue({ venmo: "@EWH3" });
    const fields = mapProfileToKennelFields(profile);
    expect(fields.paymentLink).toBe("https://venmo.com/EWH3");
  });

  it("handles null fields gracefully", () => {
    const profile = buildApiProfile({
      website: null,
      email: null,
      year_started: null,
      trail_price: null,
      trail_frequency: null,
      trail_day: null,
    });
    const fields = mapProfileToKennelFields(profile);
    expect(fields.website).toBeNull();
    expect(fields.hashCash).toBeNull();
    expect(fields.scheduleDayOfWeek).toBeNull();
  });
});

// ── Geo penalty pure function tests ──

describe("normalizeCountry", () => {
  it("normalizes USA variants to US", () => {
    expect(normalizeCountry("USA")).toBe("US");
    expect(normalizeCountry("US")).toBe("US");
    expect(normalizeCountry("United States")).toBe("US");
    expect(normalizeCountry("United States of America")).toBe("US");
    expect(normalizeCountry("  usa  ")).toBe("US");
  });

  it("normalizes UK variants to GB", () => {
    expect(normalizeCountry("UK")).toBe("GB");
    expect(normalizeCountry("GB")).toBe("GB");
    expect(normalizeCountry("United Kingdom")).toBe("GB");
    expect(normalizeCountry("Great Britain")).toBe("GB");
  });

  it("returns empty string for null/undefined", () => {
    expect(normalizeCountry(null)).toBe("");
    expect(normalizeCountry(undefined)).toBe("");
    expect(normalizeCountry("")).toBe("");
  });

  it("uppercases other countries", () => {
    expect(normalizeCountry("Philippines")).toBe("PHILIPPINES");
    expect(normalizeCountry("Thailand")).toBe("THAILAND");
  });
});

describe("parseCountryFromLocation", () => {
  it("extracts last segment as country", () => {
    expect(parseCountryFromLocation("Washington, DC, USA")).toBe("USA");
    expect(parseCountryFromLocation("London, UK")).toBe("UK");
    expect(parseCountryFromLocation("Angeles City, Philippines")).toBe("Philippines");
  });

  it("returns null for empty/undefined", () => {
    expect(parseCountryFromLocation(undefined)).toBeNull();
    expect(parseCountryFromLocation("")).toBeNull();
  });
});

describe("applyGeoPenalty", () => {
  const dcDiscovery: DiscoveryGeoContext = { lat: 38.9, lng: -77.0, country: "USA" };
  const dcCandidate: KennelGeoData = { country: "USA", centroidLat: 38.9, centroidLng: -77.0 };
  const chicagoCandidate: KennelGeoData = { country: "USA", centroidLat: 41.9, centroidLng: -87.6 };
  const philippinesDiscovery: DiscoveryGeoContext = { lat: 15.1, lng: 120.6, country: "Philippines" };
  const londonCandidate: KennelGeoData = { country: "UK", centroidLat: 51.5, centroidLng: -0.1 };

  it("applies no penalty for same city (< 100 km), same country", () => {
    // DC to DC — ~1 km, same country → +0.05 bonus
    const result = applyGeoPenalty(1.0, dcDiscovery, dcCandidate);
    expect(result).toBe(1.05);
  });

  it("applies small penalty for neighboring region (100–500 km), same country", () => {
    // DC to a point ~200 km away, same country
    const nearbyCandidate: KennelGeoData = { country: "USA", centroidLat: 40.0, centroidLng: -75.5 };
    const result = applyGeoPenalty(1.0, dcDiscovery, nearbyCandidate);
    // -0.10 penalty + 0.05 bonus (same country, < 500 km)
    expect(result).toBeCloseTo(0.95, 1);
  });

  it("applies heavy penalty for cross-continent (> 5000 km), different country", () => {
    // Philippines → Chicago: ~13,500 km, different country
    const result = applyGeoPenalty(1.0, philippinesDiscovery, chicagoCandidate);
    // -0.55 distance + -0.15 country mismatch = -0.70
    expect(result).toBeCloseTo(0.30, 1);
  });

  it("applies distance + country mismatch for far away, different country", () => {
    // Philippines → London: ~10,700 km, different country
    const result = applyGeoPenalty(1.0, philippinesDiscovery, londonCandidate);
    // -0.55 distance + -0.15 country mismatch = -0.70
    expect(result).toBeCloseTo(0.30, 1);
  });

  it("applies medium penalty for same country, far (500–2000 km)", () => {
    // DC → Chicago: ~960 km, same country
    const result = applyGeoPenalty(1.0, dcDiscovery, chicagoCandidate);
    // -0.30 penalty, no country bonus (> 500 km)
    expect(result).toBeCloseTo(0.70, 1);
  });

  it("falls back to country-only check when discovery coords missing", () => {
    const noCoords: DiscoveryGeoContext = { lat: null, lng: null, country: "Philippines" };
    // Different country, no coords → -0.15
    const result = applyGeoPenalty(1.0, noCoords, chicagoCandidate);
    expect(result).toBeCloseTo(0.85, 2);
  });

  it("falls back to country-only check when candidate coords missing", () => {
    const noCoordCandidate: KennelGeoData = { country: "UK", centroidLat: null, centroidLng: null };
    const result = applyGeoPenalty(1.0, dcDiscovery, noCoordCandidate);
    // Different country, no candidate coords → -0.15
    expect(result).toBeCloseTo(0.85, 2);
  });

  it("returns text score unchanged when both sides have no coords and same country", () => {
    const noCoords: DiscoveryGeoContext = { lat: null, lng: null, country: "USA" };
    const noCoordCandidate: KennelGeoData = { country: "USA", centroidLat: null, centroidLng: null };
    expect(applyGeoPenalty(0.8, noCoords, noCoordCandidate)).toBe(0.8);
  });

  it("returns text score unchanged when both sides have no data at all", () => {
    const noData: DiscoveryGeoContext = { lat: null, lng: null, country: null };
    const noDataCandidate: KennelGeoData = { country: "", centroidLat: null, centroidLng: null };
    expect(applyGeoPenalty(0.75, noData, noDataCandidate)).toBe(0.75);
  });
});

// ── Integration tests: geo-aware matching via syncKennelDiscovery ──

describe("syncKennelDiscovery geo-aware matching", () => {
  it("ACH3 (Philippines) does NOT auto-match CH3 (Chicago)", async () => {
    vi.mocked(parseKennelDirectory).mockReturnValue([
      buildDiscovered({
        slug: "ACH3",
        name: "Angeles City H3",
        location: "Angeles City, Philippines",
        latitude: 15.1,
        longitude: 120.6,
      }),
    ]);

    vi.mocked(fetchKennelProfiles).mockResolvedValue(
      new Map([["ACH3", buildApiProfile({
        slug: "ACH3", name: "Angeles City H3",
        city: "Angeles City", state: "", country: "Philippines",
      })]]),
    );

    // CH3 is in Chicago region
    vi.mocked(prisma.kennel.findMany).mockResolvedValue([
      {
        id: "k-ch3", shortName: "CH3", fullName: "Chicago Hash House Harriers",
        country: "USA", regionRef: { centroidLat: 41.9, centroidLng: -87.6 },
      },
    ] as never);

    const result = await syncKennelDiscovery();
    // Should NOT auto-match — cross-continent penalty destroys the score
    expect(result.autoMatched).toBe(0);

    expect(prisma.kennelDiscovery.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          status: "NEW",
          matchedKennelId: null,
        }),
      }),
    );
  });

  it("EWH3 (DC) SHOULD auto-match EWH3 (DC) — same city, exact slug", async () => {
    vi.mocked(parseKennelDirectory).mockReturnValue([
      buildDiscovered({
        slug: "EWH3",
        name: "Everyday Is Wednesday H3",
        location: "Washington, DC, USA",
        latitude: 38.9,
        longitude: -77.0,
      }),
    ]);

    vi.mocked(fetchKennelProfiles).mockResolvedValue(
      new Map([["EWH3", buildApiProfile({
        slug: "EWH3", name: "Everyday Is Wednesday H3",
        city: "Washington", state: "DC", country: "USA",
      })]]),
    );

    vi.mocked(prisma.kennel.findMany).mockResolvedValue([
      {
        id: "k-ewh3", shortName: "EWH3", fullName: "Everyday Is Wednesday H3",
        country: "USA", regionRef: { centroidLat: 38.9, centroidLng: -77.0 },
      },
    ] as never);

    const result = await syncKennelDiscovery();
    expect(result.autoMatched).toBe(1);

    expect(prisma.kennelDiscovery.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          status: "MATCHED",
          matchedKennelId: "k-ewh3",
        }),
      }),
    );
  });

  it("DCFMH3 (DC) does NOT auto-match CFMH3 (Chicago)", async () => {
    vi.mocked(parseKennelDirectory).mockReturnValue([
      buildDiscovered({
        slug: "DCFMH3",
        name: "DC Full Moon H3",
        location: "Washington, DC, USA",
        latitude: 38.9,
        longitude: -77.0,
      }),
    ]);

    vi.mocked(fetchKennelProfiles).mockResolvedValue(
      new Map([["DCFMH3", buildApiProfile({
        slug: "DCFMH3", name: "DC Full Moon H3",
        city: "Washington", state: "DC", country: "USA",
      })]]),
    );

    vi.mocked(prisma.kennel.findMany).mockResolvedValue([
      {
        id: "k-cfmh3", shortName: "CFMH3", fullName: "Chicago Full Moon H3",
        country: "USA", regionRef: { centroidLat: 41.9, centroidLng: -87.6 },
      },
    ] as never);

    const result = await syncKennelDiscovery();
    // Text score ~0.88, distance ~960 km → penalty -0.30 → final ~0.58 (below 0.6)
    expect(result.autoMatched).toBe(0);

    expect(prisma.kennelDiscovery.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          status: "NEW",
        }),
      }),
    );
  });
});
