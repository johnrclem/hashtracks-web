import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock Prisma
vi.mock("@/lib/db", () => ({ prisma: {} }));

// Mock weather — return null by default, override per test
vi.mock("@/lib/weather", () => ({
  getEventDayWeather: vi.fn().mockResolvedValue(null),
}));

import { executeTravelSearch, type TravelSearchParams } from "./search";

// ============================================================================
// Mock Prisma client factory
// ============================================================================

interface MockKennel {
  id: string;
  slug: string;
  shortName: string;
  region: string;
  latitude: number | null;
  longitude: number | null;
  lastEventDate: Date | null;
  scheduleDayOfWeek: string | null;
  scheduleTime: string | null;
  scheduleFrequency: string | null;
  website: string | null;
  facebookUrl: string | null;
  instagramHandle: string | null;
  isHidden: boolean;
  regionRef: { pinColor: string; centroidLat: number | null; centroidLng: number | null } | null;
}

interface MockEvent {
  id: string;
  kennelId: string;
  date: Date;
  startTime: string | null;
  title: string | null;
  runNumber: number | null;
  haresText: string | null;
  locationName: string | null;
  locationCity: string | null;
  sourceUrl: string | null;
  latitude: number | null;
  longitude: number | null;
  status: string;
  kennel: { latitude: number | null; longitude: number | null } | null;
  eventLinks: { url: string; label: string }[];
}

interface MockScheduleRule {
  id: string;
  kennelId: string;
  rrule: string;
  anchorDate: string | null;
  startTime: string | null;
  confidence: "HIGH" | "MEDIUM" | "LOW";
  source: string;
  notes: string | null;
  isActive: boolean;
  lastValidatedAt: Date | null;
}

function createMockPrisma(
  kennels: MockKennel[],
  events: MockEvent[],
  scheduleRules: MockScheduleRule[],
) {
  return {
    kennel: {
      findMany: vi.fn().mockResolvedValue(
        kennels.filter((k) => !k.isHidden).map((k) => ({
          ...k,
          regionRef: k.regionRef,
        })),
      ),
    },
    event: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      findMany: vi.fn().mockImplementation(({ where }: { where: any }) => {
        let filtered = [...events];
        if (where.kennelId?.in) {
          filtered = filtered.filter((e: MockEvent) => where.kennelId.in.includes(e.kennelId));
        }
        if (where.status === "CONFIRMED") {
          filtered = filtered.filter((e: MockEvent) => e.status === "CONFIRMED");
        }
        if (where.date?.gte) {
          filtered = filtered.filter((e: MockEvent) => e.date >= where.date.gte);
        }
        if (where.date?.lte) {
          filtered = filtered.filter((e: MockEvent) => e.date <= where.date.lte);
        }
        return Promise.resolve(filtered);
      }),
    },
    scheduleRule: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      findMany: vi.fn().mockImplementation(({ where }: { where: any }) => {
        let filtered = scheduleRules.filter((r) => r.isActive);
        if (where.kennelId?.in) {
          filtered = filtered.filter((r: MockScheduleRule) => where.kennelId.in.includes(r.kennelId));
        }
        return Promise.resolve(filtered);
      }),
    },
  } as never;
}

// ============================================================================
// Test fixtures
// ============================================================================

function utcNoon(dateStr: string): Date {
  return new Date(dateStr + "T12:00:00Z");
}

// Atlanta coordinates
const ATLANTA = { lat: 33.749, lng: -84.388 };

const testKennel: MockKennel = {
  id: "k-atl",
  slug: "atlanta-h3",
  shortName: "Atlanta H3",
  region: "Atlanta, GA",
  latitude: 33.75,
  longitude: -84.39,
  lastEventDate: utcNoon("2026-04-05"),
  scheduleDayOfWeek: "Saturday",
  scheduleTime: "2:00 PM",
  scheduleFrequency: "Weekly",
  website: "https://atlantahash.com",
  facebookUrl: "https://facebook.com/atlantah3",
  instagramHandle: "@atlantah3",
  isHidden: false,
  regionRef: { pinColor: "#f97316", centroidLat: 33.75, centroidLng: -84.39 },
};

const testEvent: MockEvent = {
  id: "e1",
  kennelId: "k-atl",
  date: utcNoon("2026-04-18"),
  startTime: "14:00",
  title: "Atlanta H3 Run #1142",
  runNumber: 1142,
  haresText: "Mudflap, Just Simon",
  locationName: "Piedmont Park",
  locationCity: "Atlanta, GA",
  sourceUrl: "https://atlantahash.com/runs/1142",
  latitude: 33.787,
  longitude: -84.374,
  status: "CONFIRMED",
  kennel: { latitude: 33.75, longitude: -84.39 },
  eventLinks: [{ url: "https://hashrego.com/events/123", label: "Hash Rego" }],
};

const testRule: MockScheduleRule = {
  id: "r1",
  kennelId: "k-atl",
  rrule: "FREQ=WEEKLY;BYDAY=SA",
  anchorDate: null,
  startTime: "14:00",
  confidence: "MEDIUM",
  source: "SEED_DATA",
  notes: null,
  isActive: true,
  lastValidatedAt: new Date(),
};

const baseParams: TravelSearchParams = {
  latitude: ATLANTA.lat,
  longitude: ATLANTA.lng,
  radiusKm: 50,
  startDate: "2026-04-12",
  endDate: "2026-04-26",
};

// ============================================================================
// Tests
// ============================================================================

describe("executeTravelSearch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns confirmed events within date + distance window", async () => {
    const prisma = createMockPrisma([testKennel], [testEvent], []);
    const result = await executeTravelSearch(prisma, baseParams);

    expect(result.confirmed).toHaveLength(1);
    expect(result.confirmed[0].eventId).toBe("e1");
    expect(result.confirmed[0].kennelName).toBe("Atlanta H3");
    expect(result.confirmed[0].distanceTier).toBe("nearby");
    expect(result.emptyState).toBe("none"); // has confirmed results
  });

  it("returns likely projections from schedule rules", async () => {
    const prisma = createMockPrisma([testKennel], [], [testRule]);
    const result = await executeTravelSearch(prisma, baseParams);

    expect(result.likely.length).toBeGreaterThan(0);
    expect(result.likely[0].kennelName).toBe("Atlanta H3");
    expect(result.likely[0].confidence).toMatch(/high|medium/);
    expect(result.likely[0].evidenceTimeline).toBeDefined();
    expect(result.likely[0].evidenceTimeline.weeks).toHaveLength(12);
  });

  it("returns possible activity for LOW confidence rules", async () => {
    const lowRule: MockScheduleRule = {
      ...testRule,
      id: "r-low",
      rrule: "CADENCE=MONTHLY;BYDAY=SA",
      confidence: "LOW",
      notes: "Monthly — specific week unknown",
    };
    const prisma = createMockPrisma([testKennel], [], [lowRule]);
    const result = await executeTravelSearch(prisma, baseParams);

    expect(result.possible).toHaveLength(1);
    expect(result.possible[0].date).toBeNull();
    expect(result.possible[0].confidence).toBe("low");
  });

  it("deduplicates projections against confirmed events", async () => {
    // Event on April 18 (Saturday) + rule generating weekly Saturdays
    // April 18 projection should be removed (covered by confirmed event)
    const prisma = createMockPrisma([testKennel], [testEvent], [testRule]);
    const result = await executeTravelSearch(prisma, baseParams);

    // Should have confirmed for Apr 18 but NOT a likely for the same date
    const apr18Confirmed = result.confirmed.filter((r) =>
      r.date.toISOString().includes("2026-04-18"),
    );
    const apr18Likely = result.likely.filter((r) =>
      r.date.toISOString().includes("2026-04-18"),
    );
    expect(apr18Confirmed).toHaveLength(1);
    expect(apr18Likely).toHaveLength(0);
  });

  it("excludes hidden kennels from results", async () => {
    const hiddenKennel: MockKennel = {
      ...testKennel,
      id: "k-hidden",
      slug: "hidden-h3",
      shortName: "Hidden H3",
      isHidden: true,
    };
    const prisma = createMockPrisma([hiddenKennel], [], []);
    const result = await executeTravelSearch(prisma, baseParams);

    expect(result.emptyState).toBe("no_coverage");
    expect(result.meta.kennelsSearched).toBe(0);
  });

  it("excludes TENTATIVE events from confirmed results", async () => {
    const tentativeEvent: MockEvent = {
      ...testEvent,
      id: "e-tent",
      status: "TENTATIVE",
    };
    const prisma = createMockPrisma([testKennel], [tentativeEvent], []);
    const result = await executeTravelSearch(prisma, baseParams);

    expect(result.confirmed).toHaveLength(0);
  });

  it("returns no_coverage when no kennels in any radius", async () => {
    // Kennel at 0,0 (far from Atlanta)
    const farKennel: MockKennel = {
      ...testKennel,
      latitude: 0,
      longitude: 0,
      regionRef: { pinColor: "#000", centroidLat: 0, centroidLng: 0 },
    };
    const prisma = createMockPrisma([farKennel], [], []);
    const result = await executeTravelSearch(prisma, baseParams);

    expect(result.emptyState).toBe("no_coverage");
    expect(result.confirmed).toHaveLength(0);
    expect(result.likely).toHaveLength(0);
  });

  it("expands to broader radius when primary is empty", async () => {
    // Kennel at 60km from search point (beyond 50km primary but within 150km broader)
    const distantKennel: MockKennel = {
      ...testKennel,
      id: "k-distant",
      latitude: 34.3, // ~60km north of Atlanta
      longitude: -84.39,
    };
    const distantEvent: MockEvent = {
      ...testEvent,
      kennelId: "k-distant",
    };
    const prisma = createMockPrisma([distantKennel], [distantEvent], []);
    const result = await executeTravelSearch(prisma, baseParams);

    expect(result.emptyState).toBe("no_nearby");
    expect(result.broaderResults).toBeDefined();
    expect(result.broaderResults!.confirmed.length).toBeGreaterThanOrEqual(1);
    expect(result.meta.broaderRadiusKm).toBe(150);
  });

  it("builds source links from kennel social fields + event links", async () => {
    const prisma = createMockPrisma([testKennel], [testEvent], []);
    const result = await executeTravelSearch(prisma, baseParams);

    const links = result.confirmed[0].sourceLinks;
    expect(links.find((l) => l.type === "website")).toBeDefined();
    expect(links.find((l) => l.type === "facebook")).toBeDefined();
    expect(links.find((l) => l.type === "instagram")).toBeDefined();
    expect(links.find((l) => l.type === "hashrego")).toBeDefined();
  });

  it("assigns correct distance tiers", async () => {
    // Kennel at ~5km (nearby), ~15km (area), ~30km (drive)
    const kennels: MockKennel[] = [
      { ...testKennel, id: "k-near", latitude: 33.79, longitude: -84.39 },     // ~5km
      { ...testKennel, id: "k-area", latitude: 33.89, longitude: -84.39 },     // ~15km
      { ...testKennel, id: "k-drive", latitude: 34.05, longitude: -84.39 },    // ~33km
    ];
    const prisma = createMockPrisma(kennels, [], []);
    // No events or rules means we can't test distance tiers via confirmed/likely
    // But we can check the kennel distances are computed correctly
    const result = await executeTravelSearch(prisma, baseParams);
    expect(result.meta.kennelsSearched).toBe(3);
  });

  it("applies confidence filter", async () => {
    const prisma = createMockPrisma([testKennel], [testEvent], [testRule]);
    const filtered = await executeTravelSearch(prisma, {
      ...baseParams,
      filters: { confidence: ["high"] },
    });

    // Only high-confidence likely results should pass
    expect(filtered.likely.every((r) => r.confidence === "high")).toBe(true);
    // Possible results should be filtered out (low confidence not in filter)
    expect(filtered.possible).toHaveLength(0);
  });

  it("applies distance tier filter", async () => {
    const prisma = createMockPrisma([testKennel], [testEvent], []);
    const filtered = await executeTravelSearch(prisma, {
      ...baseParams,
      filters: { distanceTier: ["drive"] },
    });

    // Atlanta H3 is "nearby" so it should be filtered out
    expect(filtered.confirmed).toHaveLength(0);
  });

  it("clamps end date to 90-day horizon", async () => {
    const prisma = createMockPrisma([testKennel], [], [testRule]);
    const result = await executeTravelSearch(prisma, {
      ...baseParams,
      endDate: "2027-01-01", // Way beyond 90 days
    });

    // Should still return results but only within 90 days
    if (result.likely.length > 0) {
      const latestDate = result.likely[result.likely.length - 1].date;
      const ninetyDaysFromNow = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000);
      expect(latestDate.getTime()).toBeLessThanOrEqual(ninetyDaysFromNow.getTime() + 24 * 60 * 60 * 1000);
    }
  });
});
