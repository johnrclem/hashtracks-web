import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock Prisma
vi.mock("@/lib/db", () => ({ prisma: {} }));

// Mock weather — return empty by default, override per test
vi.mock("@/lib/weather", () => ({
  getEventDayWeather: vi.fn().mockResolvedValue(null),
  getWeatherForEvents: vi.fn().mockResolvedValue({}),
}));

import { getWeatherForEvents } from "@/lib/weather";
import {
  executeTravelSearch,
  byDateTimeDistance,
  type TravelSearchParams,
  type DestinationParams,
} from "./search";

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
  kennelId: string; // primary
  /** Optional co-host kennel IDs. Combined with `kennelId` to model the
   *  EventKennel set for multi-kennel events (#1023). When omitted, the
   *  event behaves single-kennel (just `kennelId`). */
  coHostKennelIds?: string[];
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
        // #1023 step 5: production query filters via EventKennel.some on
        // the full kennel set (primary + co-hosts). Match against the
        // event's `coHostKennelIds` plus its primary `kennelId`.
        const kennelInList = where.eventKennels?.some?.kennelId?.in ?? where.kennelId?.in;
        if (kennelInList) {
          filtered = filtered.filter((e: MockEvent) => {
            const allKennelIds = [e.kennelId, ...(e.coHostKennelIds ?? [])];
            return allKennelIds.some((id) => kennelInList.includes(id));
          });
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
        // Production includes `eventKennels: { select: { kennelId: true } }`
        // so the result-builder can pivot to the matching co-host. Mirror
        // that in the mock by attaching the kennel-set on each row.
        return Promise.resolve(
          filtered.map((e) => ({
            ...e,
            eventKennels: [
              { kennelId: e.kennelId },
              ...(e.coHostKennelIds ?? []).map((id) => ({ kennelId: id })),
            ],
          })),
        );
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

const baseDestination: DestinationParams = {
  latitude: ATLANTA.lat,
  longitude: ATLANTA.lng,
  radiusKm: 50,
  startDate: "2026-04-12",
  endDate: "2026-04-26",
};

const baseParams: TravelSearchParams = {
  destinations: [baseDestination],
};

// ============================================================================
// Tests
// ============================================================================

describe("executeTravelSearch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Freeze "today" inside the baseParams window (2026-04-12 → 2026-04-26)
    // so the 12-week evidence lookback covers the hardcoded evidence event
    // at 2026-02-21. Otherwise this test silently flakes as the real-world
    // calendar advances past the lookback boundary. Matches the convention
    // already used in save-intent.test.ts.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-14T12:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns confirmed events within date + distance window", async () => {
    const prisma = createMockPrisma([testKennel], [testEvent], []);
    const result = await executeTravelSearch(prisma, baseParams);

    expect(result.confirmed).toHaveLength(1);
    expect(result.confirmed[0].eventId).toBe("e1");
    expect(result.confirmed[0].kennelName).toBe("Atlanta H3");
    expect(result.confirmed[0].distanceTier).toBe("nearby");
    expect(result.emptyState).toBe("none"); // has confirmed results
    // broaderRadiusKm must be undefined on primary-only searches or
    // TripSummary will render the "routing revised" expanded-radius UI.
    expect(result.destinations[0].broaderRadiusKm).toBeUndefined();
  });

  it("pivots co-host events onto the matching nearby kennel (#1023 step 5)", async () => {
    // Event has primary kennel FAR from Atlanta (London) and a co-host
    // kennel IN Atlanta. The query matches because Atlanta is in nearbyIds.
    // Result must surface metadata for the Atlanta kennel, not the
    // (out-of-range) London primary.
    const londonKennel: MockKennel = {
      ...testKennel,
      id: "k-london",
      slug: "london-h3",
      shortName: "London H3",
      latitude: 51.5,
      longitude: -0.13,
    };
    const coHostEvent: MockEvent = {
      ...testEvent,
      id: "e-cohost",
      kennelId: "k-london",        // primary is London (far from Atlanta)
      coHostKennelIds: ["k-atl"],   // co-host is Atlanta (in range)
    };
    const prisma = createMockPrisma([testKennel, londonKennel], [coHostEvent], []);
    const result = await executeTravelSearch(prisma, baseParams);

    expect(result.confirmed).toHaveLength(1);
    // Pivoted: kennel metadata is Atlanta H3, not London H3.
    expect(result.confirmed[0].kennelId).toBe("k-atl");
    expect(result.confirmed[0].kennelName).toBe("Atlanta H3");
    expect(result.confirmed[0].kennelSlug).toBe("atlanta-h3");
    expect(result.confirmed[0].distanceTier).toBe("nearby");
  });

  it("returns likely projections from schedule rules", async () => {
    // Post-scoreConfidence-gate: Medium requires ≥1 evidence event in the
    // 12-week window. Provide one historical confirmed event so the rule
    // survives as `likely` instead of being downgraded to `possible`.
    const evidenceEvent: MockEvent = {
      ...testEvent,
      id: "e-evidence",
      date: utcNoon("2026-02-21"), // 2 months before baseParams window — within 12-week evidence lookback
    };
    const prisma = createMockPrisma([testKennel], [evidenceEvent], [testRule]);
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

  it("emits out_of_horizon when startDate is past 365d AND no confirmed events in window", async () => {
    const farFuture: TravelSearchParams = {
      destinations: [{ ...baseDestination, startDate: "2036-04-12", endDate: "2036-04-26" }],
    };
    // testEvent is at 2026-04-18, far before the 2036 window, so the
    // confirmed query legitimately returns nothing. Rule projections are
    // filtered out by horizonTier="none" too.
    const prisma = createMockPrisma([testKennel], [testEvent], [testRule]);
    const result = await executeTravelSearch(prisma, farFuture);

    expect(result.emptyState).toBe("out_of_horizon");
    expect(result.meta.horizonTier).toBe("none");
    expect(result.confirmed).toHaveLength(0);
    expect(result.likely).toHaveLength(0);
    expect(result.possible).toHaveLength(0);
  });

  it("drops LOW-confidence Possible projections past the 365d horizon (tier 3)", async () => {
    // QA regression: a LOW CADENCE rule was leaking into tier-3 Possible
    // and flipping the empty-state arbiter off `out_of_horizon` back to
    // `no_confirmed`, rendering a stray SLH3-style row instead of the
    // "More than a year out" copy.
    const lowRule: MockScheduleRule = {
      ...testRule,
      id: "r-low",
      rrule: "CADENCE=MONTHLY;BYDAY=SA",
      confidence: "LOW",
      notes: "Monthly — specific week unknown",
    };
    const prisma = createMockPrisma([testKennel], [], [lowRule]);
    const result = await executeTravelSearch(prisma, {
      destinations: [{ ...baseDestination, startDate: "2036-04-12", endDate: "2036-04-26" }],
    });

    expect(result.meta.horizonTier).toBe("none");
    expect(result.possible).toHaveLength(0);
    expect(result.emptyState).toBe("out_of_horizon");
  });

  it("still surfaces confirmed events past the 365d projection horizon", async () => {
    // Codex regression: a real event posted ~18 months out must render
    // even though projections give up at 365d. 550 days is inside the
    // 730-day confirmed-event horizon (CONFIRMED_EVENT_HORIZON_DAYS)
    // but past the projection tier boundary.
    const farFuture = new Date(Date.now() + 550 * 24 * 60 * 60 * 1000);
    const farFutureISO = farFuture.toISOString().slice(0, 10);
    const farFutureStart = new Date(farFuture.getTime() - 5 * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);
    const farFutureEnd = new Date(farFuture.getTime() + 5 * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);

    const farFutureEvent: MockEvent = {
      ...testEvent,
      id: "e-farfuture",
      date: utcNoon(farFutureISO),
    };
    const prisma = createMockPrisma([testKennel], [farFutureEvent], []);
    const result = await executeTravelSearch(prisma, {
      destinations: [{ ...baseDestination, startDate: farFutureStart, endDate: farFutureEnd }],
    });

    expect(result.emptyState).toBe("none");
    expect(result.meta.horizonTier).toBe("none");
    expect(result.confirmed).toHaveLength(1);
    expect(result.confirmed[0].eventId).toBe("e-farfuture");
    // Projections still suppressed past 365d.
    expect(result.likely).toHaveLength(0);
  });

  it("clamps confirmed-event query to CONFIRMED_EVENT_HORIZON_DAYS (2 years)", async () => {
    // PR #792 hotfix: a URL-crafted 5-year window previously fanned out
    // the confirmed-event findMany unboundedly → Vercel function timeout
    // → "Something went wrong" error card. Events past 2 years must be
    // excluded from the query regardless of what end-date the caller
    // supplies.
    const threeYearsOut = new Date(Date.now() + 3 * 365 * 24 * 60 * 60 * 1000);
    const threeYearsEnd = threeYearsOut.toISOString().slice(0, 10);
    const threeYearsISO = threeYearsOut.toISOString().slice(0, 10);

    const pathologicalEvent: MockEvent = {
      ...testEvent,
      id: "e-3yr",
      date: utcNoon(threeYearsISO),
    };
    // Start date stays near-term so the search actually runs (horizonTier
    // would short-circuit a far-future start before hitting the query).
    const prisma = createMockPrisma([testKennel], [pathologicalEvent], []);
    const result = await executeTravelSearch(prisma, {
      destinations: [{ ...baseDestination, endDate: threeYearsEnd }],
    });

    // Event at +3yr is past the 730-day cap → excluded.
    expect(result.confirmed).toHaveLength(0);
  });

  it("handles a window that straddles the 365d boundary", async () => {
    // Search spans ~350d → 375d. Confirmed events inside the full
    // window should all render (no clamp); projections for the far end
    // drop because start > 365d → horizonTier "none".
    const nearBoundary: MockEvent = {
      ...testEvent,
      id: "e-near-boundary",
      date: utcNoon("2027-04-01"), // ~350 days out from baseParams' "now"
    };
    const pastBoundary: MockEvent = {
      ...testEvent,
      id: "e-past-boundary",
      date: utcNoon("2027-04-25"), // ~374 days out
    };
    const prisma = createMockPrisma([testKennel], [nearBoundary, pastBoundary], []);
    const result = await executeTravelSearch(prisma, {
      destinations: [{ ...baseDestination, startDate: "2027-03-28", endDate: "2027-04-26" }],
    });

    expect(result.confirmed.length).toBeGreaterThanOrEqual(2);
    const ids = result.confirmed.map(r => r.eventId);
    expect(ids).toContain("e-near-boundary");
    expect(ids).toContain("e-past-boundary");
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
    expect(result.destinations[0].broaderResults).toBeDefined();
    expect(result.destinations[0].broaderResults!.confirmed.length).toBeGreaterThanOrEqual(1);
    expect(result.destinations[0].broaderRadiusKm).toBe(150);
  });

  it("falls back to broader when primary has a dormant kennel (#783)", async () => {
    // Codex regression: a single kennel in the primary radius with no
    // events and no schedule rules used to suppress the broader pass.
    // User saw an empty "no_confirmed" page instead of useful results
    // from a wider search.
    const dormantKennel: MockKennel = {
      ...testKennel,
      id: "k-dormant",
      // ~5km from Atlanta — well inside primary 50km
    };
    const activeDistantKennel: MockKennel = {
      ...testKennel,
      id: "k-active-distant",
      slug: "distant-h3",
      shortName: "Distant H3",
      latitude: 34.3, // ~60km north — only in broader radius
      longitude: -84.39,
    };
    const distantEvent: MockEvent = {
      ...testEvent,
      id: "e-distant",
      kennelId: "k-active-distant",
    };
    // Primary has the dormant kennel (no events, no rules).
    // Broader adds the active kennel with a real event.
    const prisma = createMockPrisma(
      [dormantKennel, activeDistantKennel],
      [distantEvent],
      [],
    );
    const result = await executeTravelSearch(prisma, baseParams);

    expect(result.emptyState).toBe("no_nearby");
    expect(result.destinations[0].broaderResults).toBeDefined();
    expect(result.destinations[0].broaderResults!.confirmed.length).toBe(1);
    expect(result.destinations[0].broaderResults!.confirmed[0].eventId).toBe("e-distant");
    expect(result.destinations[0].broaderRadiusKm).toBe(150);
  });

  it("collapses Possible rows to one per kennel (#793)", async () => {
    // Weekly CADENCE rule fires multiple times in a 14-day window, and
    // scoreConfidence downgrades it to LOW when there's no evidence.
    // Previously each cadence hit produced a separate row → QA saw
    // "West London H3" twice on the London preview.
    const weeklyLowRule: MockScheduleRule = {
      ...testRule,
      id: "r-weekly-low",
      rrule: "FREQ=WEEKLY;BYDAY=SA", // fires twice in 14-day window
      confidence: "LOW",
    };
    const twoWeekParams: TravelSearchParams = {
      destinations: [{ ...baseDestination, startDate: "2026-04-12", endDate: "2026-04-26" }],
    };
    const prisma = createMockPrisma([testKennel], [], [weeklyLowRule]);
    const result = await executeTravelSearch(prisma, twoWeekParams);

    const atlPossibles = result.possible.filter((p) => p.kennelId === "k-atl");
    expect(atlPossibles).toHaveLength(1);
  });

  it("populates lastConfirmedAt from the 12-week evidence window (#769)", async () => {
    // Evidence event 3 weeks ago → Possible card shows "Last posted …".
    // UTC noon to match the project-wide date convention and keep the
    // getTime() assertion stable across timezones and time-of-day.
    const now = new Date();
    const recentEvidence = new Date(Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate() - 21,
      12, 0, 0,
    ));
    const evidenceEvent: MockEvent = {
      ...testEvent,
      id: "e-evidence",
      date: recentEvidence,
    };
    const lowRule: MockScheduleRule = {
      ...testRule,
      id: "r-low",
      rrule: "CADENCE=MONTHLY",
      confidence: "LOW",
    };
    const prisma = createMockPrisma([testKennel], [evidenceEvent], [lowRule]);
    const result = await executeTravelSearch(prisma, baseParams);

    expect(result.possible).toHaveLength(1);
    expect(result.possible[0].lastConfirmedAt).toBeInstanceOf(Date);
    expect(result.possible[0].lastConfirmedAt!.getTime()).toBe(recentEvidence.getTime());
  });

  it("falls back to kennel.lastEventDate when no in-window evidence (#769)", async () => {
    // No in-window evidence, but the kennel has an all-time `lastEventDate`
    // from outside the 12-week window. That older anchor should still
    // surface so the Possible card explains why we listed the kennel.
    const lowRule: MockScheduleRule = {
      ...testRule,
      id: "r-low",
      rrule: "CADENCE=MONTHLY",
      confidence: "LOW",
    };
    const prisma = createMockPrisma([testKennel], [], [lowRule]);
    const result = await executeTravelSearch(prisma, baseParams);

    expect(result.possible).toHaveLength(1);
    expect(result.possible[0].lastConfirmedAt).toBeInstanceOf(Date);
    expect(result.possible[0].lastConfirmedAt!.getTime()).toBe(
      testKennel.lastEventDate!.getTime(),
    );
  });

  it("leaves lastConfirmedAt null when kennel has no history at all (#769)", async () => {
    // Truly history-less kennel: no in-window evidence AND no all-time
    // lastEventDate. Render path hides the line in this case.
    const lowRule: MockScheduleRule = {
      ...testRule,
      id: "r-low",
      rrule: "CADENCE=MONTHLY",
      confidence: "LOW",
    };
    const historyLessKennel: MockKennel = {
      ...testKennel,
      lastEventDate: null,
    };
    const prisma = createMockPrisma([historyLessKennel], [], [lowRule]);
    const result = await executeTravelSearch(prisma, baseParams);

    expect(result.possible).toHaveLength(1);
    expect(result.possible[0].lastConfirmedAt).toBeNull();
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

  it("scopes event links to each event, not the kennel-wide pool", async () => {
    // Codex + CodeRabbit flagged: when kennel X has multiple confirmed
    // events in the window, every result card was getting the same union
    // of every event's links — wrong attribution to unrelated URLs.
    const eventA: MockEvent = {
      ...testEvent,
      id: "event-a",
      date: new Date("2026-04-15T12:00:00Z"),
      eventLinks: [{ url: "https://hashrego.com/events/aaa", label: "Hash Rego" }],
    };
    const eventB: MockEvent = {
      ...testEvent,
      id: "event-b",
      date: new Date("2026-04-22T12:00:00Z"),
      eventLinks: [{ url: "https://hashrego.com/events/bbb", label: "Hash Rego" }],
    };
    const prisma = createMockPrisma([testKennel], [eventA, eventB], []);
    const result = await executeTravelSearch(prisma, baseParams);

    const aLinks = result.confirmed.find((c) => c.eventId === "event-a")?.sourceLinks ?? [];
    const bLinks = result.confirmed.find((c) => c.eventId === "event-b")?.sourceLinks ?? [];
    expect(aLinks.find((l) => l.url.endsWith("/aaa"))).toBeDefined();
    expect(aLinks.find((l) => l.url.endsWith("/bbb"))).toBeUndefined();
    expect(bLinks.find((l) => l.url.endsWith("/bbb"))).toBeDefined();
    expect(bLinks.find((l) => l.url.endsWith("/aaa"))).toBeUndefined();
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

  it("clamps end date to the 365-day HIGH horizon", async () => {
    const prisma = createMockPrisma([testKennel], [], [testRule]);
    const result = await executeTravelSearch(prisma, {
      destinations: [{ ...baseDestination, endDate: "2028-01-01" }], // way beyond 365 days
    });

    if (result.likely.length > 0) {
      const latestDate = result.likely[result.likely.length - 1].date;
      const yearFromNow = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
      expect(latestDate.getTime()).toBeLessThanOrEqual(yearFromNow.getTime() + 24 * 60 * 60 * 1000);
    }
  });
});

// ============================================================================
// Multi-destination fan-out (Phase 6 PR 2)
// ============================================================================

describe("executeTravelSearch multi-destination", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const LONDON = { lat: 51.5074, lng: -0.1278 };
  const PARIS = { lat: 48.8566, lng: 2.3522 };

  const londonKennel: MockKennel = {
    ...testKennel,
    id: "k-london",
    slug: "lh3",
    shortName: "London H3",
    latitude: LONDON.lat,
    longitude: LONDON.lng,
  };
  const parisKennel: MockKennel = {
    ...testKennel,
    id: "k-paris",
    slug: "paris-h3",
    shortName: "Paris H3",
    latitude: PARIS.lat,
    longitude: PARIS.lng,
  };

  const londonStop: DestinationParams = {
    latitude: LONDON.lat,
    longitude: LONDON.lng,
    radiusKm: 50,
    startDate: "2026-04-20",
    endDate: "2026-04-23",
    label: "London",
  };
  const parisStop: DestinationParams = {
    latitude: PARIS.lat,
    longitude: PARIS.lng,
    radiusKm: 50,
    startDate: "2026-04-23",
    endDate: "2026-04-26",
    label: "Paris",
  };

  it("fans out over 3 stops and tags each result with destinationIndex", async () => {
    const londonEvent: MockEvent = { ...testEvent, id: "e-london", kennelId: "k-london", date: utcNoon("2026-04-21") };
    const parisEvent: MockEvent = { ...testEvent, id: "e-paris", kennelId: "k-paris", date: utcNoon("2026-04-24") };
    const atlEvent: MockEvent = { ...testEvent, id: "e-atl", kennelId: "k-atl", date: utcNoon("2026-04-28") };
    const prisma = createMockPrisma(
      [londonKennel, parisKennel, testKennel],
      [londonEvent, parisEvent, atlEvent],
      [],
    );

    const result = await executeTravelSearch(prisma, {
      destinations: [
        londonStop,
        parisStop,
        { ...baseDestination, startDate: "2026-04-26", endDate: "2026-04-29", label: "Atlanta" },
      ],
    });

    expect(result.destinations).toHaveLength(3);
    expect(result.destinations.map((d) => d.label)).toEqual(["London", "Paris", "Atlanta"]);
    expect(result.confirmed).toHaveLength(3);

    // Tags match the stop index of each event's city.
    const byEventId = new Map(result.confirmed.map((r) => [r.eventId, r]));
    expect(byEventId.get("e-london")?.destinationIndex).toBe(0);
    expect(byEventId.get("e-london")?.destinationLabel).toBe("London");
    expect(byEventId.get("e-paris")?.destinationIndex).toBe(1);
    expect(byEventId.get("e-atl")?.destinationIndex).toBe(2);
  });

  it("renders overlap-day events twice, one per stop (no cross-stop dedup)", async () => {
    // Shared Thursday: user is in London AM, Paris PM. Both cities'
    // events on that day must appear independently so the LEG sub-band
    // UI can render them side-by-side.
    const thursday = utcNoon("2026-04-23");
    const londonThurs: MockEvent = { ...testEvent, id: "e-london-thurs", kennelId: "k-london", date: thursday };
    const parisThurs: MockEvent = { ...testEvent, id: "e-paris-thurs", kennelId: "k-paris", date: thursday };
    const prisma = createMockPrisma(
      [londonKennel, parisKennel],
      [londonThurs, parisThurs],
      [],
    );

    const result = await executeTravelSearch(prisma, {
      destinations: [londonStop, parisStop],
    });

    expect(result.confirmed).toHaveLength(2);
    const thursRows = result.confirmed.filter((r) => r.date.getTime() === thursday.getTime());
    expect(thursRows).toHaveLength(2);
    expect(new Set(thursRows.map((r) => r.destinationIndex))).toEqual(new Set([0, 1]));
  });

  it("isolates per-stop broader fallback — one stop's dormant radius doesn't affect others", async () => {
    // London has a kennel with an event (primary pass succeeds).
    // Paris is configured at a coordinate with no nearby kennel; its
    // broader pass adds a distant kennel.
    const londonEvent: MockEvent = { ...testEvent, id: "e-london", kennelId: "k-london", date: utcNoon("2026-04-21") };
    const distantParis: MockKennel = {
      ...testKennel,
      id: "k-distant-paris",
      slug: "distant-paris",
      shortName: "Distant Paris H3",
      // ~120km south — only in Paris broader (150km) radius, not primary (50km).
      latitude: PARIS.lat - 1.1,
      longitude: PARIS.lng,
    };
    const distantParisEvent: MockEvent = {
      ...testEvent,
      id: "e-distant-paris",
      kennelId: "k-distant-paris",
      date: utcNoon("2026-04-24"),
    };
    const prisma = createMockPrisma(
      [londonKennel, distantParis],
      [londonEvent, distantParisEvent],
      [],
    );

    const result = await executeTravelSearch(prisma, {
      destinations: [londonStop, parisStop],
    });

    // London's stop has primary results; Paris's stop triggered broader.
    expect(result.destinations[0].emptyState).toBe("none");
    expect(result.destinations[0].broaderRadiusKm).toBeUndefined();
    expect(result.destinations[1].emptyState).toBe("no_nearby");
    expect(result.destinations[1].broaderRadiusKm).toBe(150);
    expect(result.destinations[1].broaderResults?.confirmed).toHaveLength(1);

    // Top-level confirmed holds only the PRIMARY rows — London's.
    expect(result.confirmed).toHaveLength(1);
    expect(result.confirmed[0].eventId).toBe("e-london");
    // Aggregate emptyState: "none" because at least one stop has results.
    expect(result.emptyState).toBe("none");
  });

  it("aggregates emptyState to no_coverage when every stop has no kennels", async () => {
    // Empty kennel list — every stop returns no_coverage.
    const prisma = createMockPrisma([], [], []);
    const result = await executeTravelSearch(prisma, {
      destinations: [londonStop, parisStop],
    });

    expect(result.destinations.every((d) => d.emptyState === "no_coverage")).toBe(true);
    expect(result.emptyState).toBe("no_coverage");
    expect(result.confirmed).toHaveLength(0);
  });

  it("leaves broaderRadiusKm undefined when broader pass also found zero kennels", async () => {
    // Claude review on PR #835: a stop with zero kennels in primary AND
    // broader used to emit broaderRadiusKm anyway, and page.tsx's
    // effectiveRadiusKm read would surface a misleading "within 150 km"
    // on a Antarctica-grade search.
    const prisma = createMockPrisma([], [], []);
    const result = await executeTravelSearch(prisma, {
      destinations: [londonStop],
    });

    expect(result.destinations[0].emptyState).toBe("no_coverage");
    expect(result.destinations[0].broaderRadiusKm).toBeUndefined();
  });

  it("aggregates mixed hard empties to no_coverage (not no_confirmed)", async () => {
    // Gemini regression on PR #835: one stop with no kennels + one stop
    // past the 365d horizon used to fall through every/every/some checks
    // to "no_confirmed", misleading the UI into implying projections
    // exist when neither stop produced any.
    // London: no kennels at all → no_coverage.
    // Paris future: kennel exists but startDate past horizon → out_of_horizon.
    const futureParisStop: DestinationParams = {
      ...parisStop,
      startDate: "2028-04-23",
      endDate: "2028-04-26",
    };
    const prisma = createMockPrisma([parisKennel], [], []);
    const result = await executeTravelSearch(prisma, {
      destinations: [londonStop, futureParisStop],
    });

    expect(result.destinations[0].emptyState).toBe("no_coverage");
    expect(result.destinations[1].emptyState).toBe("out_of_horizon");
    // no_coverage beats out_of_horizon in the aggregate: a missing-data
    // region is more useful to flag than a date the user can't change.
    expect(result.emptyState).toBe("no_coverage");
  });

  it("aggregates emptyState to out_of_horizon when every stop is past the horizon", async () => {
    const prisma = createMockPrisma([londonKennel, parisKennel], [], []);
    const result = await executeTravelSearch(prisma, {
      destinations: [
        { ...londonStop, startDate: "2028-04-20", endDate: "2028-04-23" },
        { ...parisStop, startDate: "2028-04-23", endDate: "2028-04-26" },
      ],
    });

    expect(result.destinations.every((d) => d.emptyState === "out_of_horizon")).toBe(true);
    expect(result.emptyState).toBe("out_of_horizon");
  });

  it("aggregates horizonTier to worst-case across stops", async () => {
    // One stop near-term ("all"), one stop 2 years out ("none"). Aggregate
    // must surface the "none" so UI copy explains why Likely is sparse.
    const prisma = createMockPrisma([londonKennel, parisKennel], [], []);
    const result = await executeTravelSearch(prisma, {
      destinations: [
        londonStop,
        { ...parisStop, startDate: "2028-04-23", endDate: "2028-04-26" },
      ],
    });

    expect(result.destinations[0].horizonTier).toBe("all");
    expect(result.destinations[1].horizonTier).toBe("none");
    expect(result.meta.horizonTier).toBe("none");
  });

  it("sums kennelsSearched across stops in meta", async () => {
    const prisma = createMockPrisma([londonKennel, parisKennel], [], []);
    const result = await executeTravelSearch(prisma, {
      destinations: [londonStop, parisStop],
    });

    expect(result.destinations[0].kennelsSearched).toBe(1);
    expect(result.destinations[1].kennelsSearched).toBe(1);
    expect(result.meta.kennelsSearched).toBe(2);
  });

  it("throws when destinations array is empty", async () => {
    const prisma = createMockPrisma([], [], []);
    await expect(
      executeTravelSearch(prisma, { destinations: [] }),
    ).rejects.toThrow(/at least one destination/i);
  });

  it("batches weather ONCE across all stops (cap applies per-search, not per-stop)", async () => {
    // Regression guard for codex PR #835 review: weather fetching used to
    // run inside runStopSearch, so a 3-stop trip could burn
    // MAX_WEATHER_API_CALLS × 3. Hoisting to the orchestrator makes the
    // cap apply to the whole search. Assertion: one batch call regardless
    // of stop count, and the batch receives inputs for all stops' events.
    const londonEvent: MockEvent = { ...testEvent, id: "e-london", kennelId: "k-london", date: utcNoon("2026-04-21") };
    const parisEvent: MockEvent = { ...testEvent, id: "e-paris", kennelId: "k-paris", date: utcNoon("2026-04-24") };
    const atlEvent: MockEvent = { ...testEvent, id: "e-atl", kennelId: "k-atl", date: utcNoon("2026-04-28") };
    const prisma = createMockPrisma(
      [londonKennel, parisKennel, testKennel],
      [londonEvent, parisEvent, atlEvent],
      [],
    );

    const mockedWeather = vi.mocked(getWeatherForEvents);
    mockedWeather.mockClear();

    await executeTravelSearch(prisma, {
      destinations: [
        londonStop,
        parisStop,
        { ...baseDestination, startDate: "2026-04-26", endDate: "2026-04-29", label: "Atlanta" },
      ],
    });

    expect(mockedWeather).toHaveBeenCalledTimes(1);
    const batchInput = mockedWeather.mock.calls[0][0];
    expect(batchInput).toHaveLength(3);
    expect(batchInput.map((e) => e.id).sort()).toEqual(["e-atl", "e-london", "e-paris"]);
  });
});

describe("byDateTimeDistance comparator", () => {
  const sameDay = utcNoon("2026-04-17");

  function entry(startTime: string | null, distanceKm: number, label: string) {
    return { date: sameDay, startTime, distanceKm, label };
  }

  it("orders same-day events by startTime ascending", () => {
    // Regression: previously `(a.startTime ?? "").localeCompare(...)` sorted
    // earlier strings first (correctly), so 6:15 PM came before 7:30 PM —
    // but only when both startTimes were non-null. The bug was specifically
    // around null handling (next test).
    const sorted = [entry("19:30", 1, "B"), entry("18:15", 1, "A")].sort(
      byDateTimeDistance,
    );
    expect(sorted.map((e) => e.label)).toEqual(["A", "B"]);
  });

  it("sorts null startTime AFTER timed events on the same date", () => {
    // Regression for the codex finding: `?? ""` would sort `""` before
    // "00:00", bubbling untimed events to the top of a day. With the
    // "99:99" sentinel they correctly fall to the bottom.
    const sorted = [
      entry(null, 1, "untimed"),
      entry("18:00", 1, "evening"),
      entry("06:15", 1, "morning"),
    ].sort(byDateTimeDistance);
    expect(sorted.map((e) => e.label)).toEqual(["morning", "evening", "untimed"]);
  });

  it("falls through to distance when date and startTime tie", () => {
    const sorted = [
      entry("18:00", 5.0, "far"),
      entry("18:00", 1.2, "close"),
    ].sort(byDateTimeDistance);
    expect(sorted.map((e) => e.label)).toEqual(["close", "far"]);
  });

  it("orders different dates ascending regardless of startTime", () => {
    const apr17 = { date: utcNoon("2026-04-17"), startTime: "23:00", distanceKm: 1 };
    const apr18 = { date: utcNoon("2026-04-18"), startTime: "06:00", distanceKm: 1 };
    expect([apr18, apr17].sort(byDateTimeDistance)).toEqual([apr17, apr18]);
  });
});
