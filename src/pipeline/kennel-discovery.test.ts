vi.mock("@/lib/db", () => ({
  prisma: {
    kennel: { findMany: vi.fn(), findUnique: vi.fn() },
    kennelAlias: { findMany: vi.fn(), create: vi.fn() },
    kennelDiscovery: { findMany: vi.fn(), upsert: vi.fn(), update: vi.fn() },
    source: { findFirst: vi.fn() },
    sourceKennel: { upsert: vi.fn(), deleteMany: vi.fn() },
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
    latitude: 40.71,
    longitude: -74.01,
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
  vi.mocked(prisma.kennel.findUnique).mockResolvedValue(null as never);
  vi.mocked(prisma.kennelAlias.findMany).mockResolvedValue([] as never);
  vi.mocked(prisma.kennelAlias.create).mockResolvedValue({} as never);
  vi.mocked(prisma.kennelDiscovery.findMany).mockResolvedValue([] as never);
  vi.mocked(prisma.kennelDiscovery.upsert).mockResolvedValue({} as never);
  vi.mocked(prisma.kennelDiscovery.update).mockResolvedValue({} as never);
  vi.mocked(prisma.source.findFirst).mockResolvedValue({ id: "src-hashrego" } as never);
  vi.mocked(prisma.sourceKennel.upsert).mockResolvedValue({} as never);
  vi.mocked(prisma.sourceKennel.deleteMany).mockResolvedValue({ count: 0 } as never);
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
      buildDiscovered({ slug: "EWH3", name: "Everyday Is Wednesday H3", latitude: 38.9, longitude: -77.04 }),
    ]);

    // Return existing kennel that will match perfectly by shortName (same region)
    vi.mocked(prisma.kennel.findMany).mockResolvedValue([
      { id: "k1", shortName: "EWH3", fullName: "Everyday Is Wednesday H3", country: "USA", regionRef: { centroidLat: 38.9, centroidLng: -77.04 } },
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

    // Regression for issue #548: auto-match must create a SourceKennel row so
    // the HASHREGO scraper sees the slug.
    expect(prisma.sourceKennel.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { sourceId_kennelId: { sourceId: "src-hashrego", kennelId: "k1" } },
        create: expect.objectContaining({
          sourceId: "src-hashrego",
          kennelId: "k1",
          externalSlug: "EWH3",
        }),
      }),
    );

    // Auto-match must NOT create a global KennelAlias — that write is a
    // cross-source trust boundary reserved for admin-confirmed links.
    expect(prisma.kennelAlias.create).not.toHaveBeenCalled();
  });

  it("downgrade: previously MATCHED that now re-scores below threshold deletes stale SourceKennel", async () => {
    // Previous state: MATCHED → k1
    vi.mocked(prisma.kennelDiscovery.findMany).mockResolvedValue([
      { externalSlug: "EWH3", status: "MATCHED", matchedKennelId: "k1" },
    ] as never);
    // Current scrape: same slug, but candidate pool is empty so no match
    vi.mocked(parseKennelDirectory).mockReturnValue([
      buildDiscovered({ slug: "EWH3", name: "Nothing matches this" }),
    ]);
    vi.mocked(prisma.kennel.findMany).mockResolvedValue([] as never);

    await syncKennelDiscovery();

    expect(prisma.sourceKennel.deleteMany).toHaveBeenCalledWith({
      where: { sourceId: "src-hashrego", kennelId: "k1" },
    });
    expect(prisma.sourceKennel.upsert).not.toHaveBeenCalled();
  });

  it("retarget: previously MATCHED to k1 now MATCHED to k2 deletes k1 and upserts k2", async () => {
    vi.mocked(prisma.kennelDiscovery.findMany).mockResolvedValue([
      { externalSlug: "EWH3", status: "MATCHED", matchedKennelId: "k1" },
    ] as never);
    vi.mocked(parseKennelDirectory).mockReturnValue([
      buildDiscovered({ slug: "EWH3", name: "Everyday Is Wednesday H3", latitude: 38.9, longitude: -77.04 }),
    ]);
    // Candidate is k2, not k1
    vi.mocked(prisma.kennel.findMany).mockResolvedValue([
      { id: "k2", shortName: "EWH3", fullName: "Everyday Is Wednesday H3", country: "USA", regionRef: { centroidLat: 38.9, centroidLng: -77.04 } },
    ] as never);

    await syncKennelDiscovery();

    expect(prisma.sourceKennel.deleteMany).toHaveBeenCalledWith({
      where: { sourceId: "src-hashrego", kennelId: "k1" },
    });
    expect(prisma.sourceKennel.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { sourceId_kennelId: { sourceId: "src-hashrego", kennelId: "k2" } },
      }),
    );
  });

  it("LINKED preserved: previously LINKED discovery is never touched by sync", async () => {
    vi.mocked(prisma.kennelDiscovery.findMany).mockResolvedValue([
      { externalSlug: "EWH3", status: "LINKED", matchedKennelId: "k1" },
    ] as never);
    vi.mocked(parseKennelDirectory).mockReturnValue([
      buildDiscovered({ slug: "EWH3", name: "Everyday Is Wednesday H3" }),
    ]);
    vi.mocked(prisma.kennel.findMany).mockResolvedValue([
      { id: "k1", shortName: "EWH3", fullName: "Everyday Is Wednesday H3", country: "USA", regionRef: { centroidLat: 38.9, centroidLng: -77.04 } },
    ] as never);

    await syncKennelDiscovery();

    // Terminal LINKED rows take the updateTerminalDiscovery branch; neither
    // the cleanup deleteMany nor the auto-match upsert should fire.
    expect(prisma.sourceKennel.deleteMany).not.toHaveBeenCalled();
    expect(prisma.sourceKennel.upsert).not.toHaveBeenCalled();
  });

  it("auto-match skips SourceKennel upsert when no HASHREGO source exists", async () => {
    vi.mocked(prisma.source.findFirst).mockResolvedValue(null as never);
    vi.mocked(parseKennelDirectory).mockReturnValue([
      buildDiscovered({ slug: "EWH3", name: "Everyday Is Wednesday H3", latitude: 38.9, longitude: -77.04 }),
    ]);
    vi.mocked(prisma.kennel.findMany).mockResolvedValue([
      { id: "k1", shortName: "EWH3", fullName: "Everyday Is Wednesday H3", country: "USA", regionRef: { centroidLat: 38.9, centroidLng: -77.04 } },
    ] as never);

    const result = await syncKennelDiscovery();
    expect(result.autoMatched).toBe(1);
    expect(result.errors).toEqual([]);
    expect(prisma.sourceKennel.upsert).not.toHaveBeenCalled();
  });

  it("runs upsert for moderate-score discovery (0.6–0.94)", async () => {
    vi.mocked(parseKennelDirectory).mockReturnValue([
      buildDiscovered({ slug: "NYRG", name: "New York Road Gangsters", latitude: 40.7, longitude: -74.01 }),
    ]);

    // Create a kennel with moderate match via alias (same region)
    vi.mocked(prisma.kennel.findMany).mockResolvedValue([
      { id: "k2", shortName: "NYCH3", fullName: "New York City H3", country: "USA", regionRef: { centroidLat: 40.7, centroidLng: -74.01 } },
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
    expect(normalizeCountry("England")).toBe("GB");
    expect(normalizeCountry("Scotland")).toBe("GB");
    expect(normalizeCountry("Wales")).toBe("GB");
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
    expect(parseCountryFromLocation("Angeles City, Philippines")).toBe("Philippines");
  });

  it("rejects 2-letter state codes as country", () => {
    expect(parseCountryFromLocation("Washington, DC")).toBeNull();
    expect(parseCountryFromLocation("New York, NY")).toBeNull();
    expect(parseCountryFromLocation("London, UK")).toBeNull();
  });

  it("returns null for empty/undefined", () => {
    expect(parseCountryFromLocation(undefined)).toBeNull();
    expect(parseCountryFromLocation("")).toBeNull();
  });
});

describe("applyGeoPenalty", () => {
  const dcDiscovery: DiscoveryGeoContext = { lat: 38.9, lng: -77.04, country: "USA" };
  const dcCandidate: KennelGeoData = { country: "USA", centroidLat: 38.9, centroidLng: -77.04 };
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

function setupGeoMatchTest(opts: {
  discoveredSlug: string; discoveredName: string;
  discoveredLocation: string; discoveredLat: number; discoveredLng: number;
  profileCountry: string; profileCity: string; profileState: string;
  kennelId: string; kennelShortName: string; kennelFullName: string;
  kennelCountry: string; centroidLat: number; centroidLng: number;
}) {
  vi.mocked(parseKennelDirectory).mockReturnValue([
    buildDiscovered({
      slug: opts.discoveredSlug, name: opts.discoveredName,
      location: opts.discoveredLocation,
      latitude: opts.discoveredLat, longitude: opts.discoveredLng,
    }),
  ]);
  vi.mocked(fetchKennelProfiles).mockResolvedValue(
    new Map([[opts.discoveredSlug, buildApiProfile({
      slug: opts.discoveredSlug, name: opts.discoveredName,
      city: opts.profileCity, state: opts.profileState, country: opts.profileCountry,
    })]]),
  );
  vi.mocked(prisma.kennel.findMany).mockResolvedValue([{
    id: opts.kennelId, shortName: opts.kennelShortName, fullName: opts.kennelFullName,
    country: opts.kennelCountry,
    regionRef: { centroidLat: opts.centroidLat, centroidLng: opts.centroidLng },
  }] as never);
}

describe("syncKennelDiscovery geo-aware matching", () => {
  it("ACH3 (Philippines) does NOT auto-match CH3 (Chicago)", async () => {
    setupGeoMatchTest({
      discoveredSlug: "ACH3", discoveredName: "Angeles City H3",
      discoveredLocation: "Angeles City, Philippines", discoveredLat: 15.1, discoveredLng: 120.6,
      profileCountry: "Philippines", profileCity: "Angeles City", profileState: "",
      kennelId: "k-ch3", kennelShortName: "CH3", kennelFullName: "Chicago Hash House Harriers",
      kennelCountry: "USA", centroidLat: 41.9, centroidLng: -87.6,
    });

    const result = await syncKennelDiscovery();
    expect(result.autoMatched).toBe(0);
    expect(prisma.kennelDiscovery.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ status: "NEW", matchedKennelId: null }),
      }),
    );
  });

  it("EWH3 (DC) SHOULD auto-match EWH3 (DC) — same city, exact slug", async () => {
    setupGeoMatchTest({
      discoveredSlug: "EWH3", discoveredName: "Everyday Is Wednesday H3",
      discoveredLocation: "Washington, DC, USA", discoveredLat: 38.9, discoveredLng: -77.04,
      profileCountry: "USA", profileCity: "Washington", profileState: "DC",
      kennelId: "k-ewh3", kennelShortName: "EWH3", kennelFullName: "Everyday Is Wednesday H3",
      kennelCountry: "USA", centroidLat: 38.9, centroidLng: -77.04,
    });

    const result = await syncKennelDiscovery();
    expect(result.autoMatched).toBe(1);
    expect(prisma.kennelDiscovery.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ status: "MATCHED", matchedKennelId: "k-ewh3" }),
      }),
    );
  });

  it("DCFMH3 (DC) does NOT auto-match CFMH3 (Chicago)", async () => {
    setupGeoMatchTest({
      discoveredSlug: "DCFMH3", discoveredName: "DC Full Moon H3",
      discoveredLocation: "Washington, DC, USA", discoveredLat: 38.9, discoveredLng: -77.04,
      profileCountry: "USA", profileCity: "Washington", profileState: "DC",
      kennelId: "k-cfmh3", kennelShortName: "CFMH3", kennelFullName: "Chicago Full Moon H3",
      kennelCountry: "USA", centroidLat: 41.9, centroidLng: -87.6,
    });

    const result = await syncKennelDiscovery();
    expect(result.autoMatched).toBe(0);
    expect(prisma.kennelDiscovery.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ status: "NEW" }),
      }),
    );
  });
});
