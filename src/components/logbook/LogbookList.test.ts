import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock transitive dependencies that LogbookList.tsx pulls in via EditAttendanceDialog → actions.ts
vi.mock("@/app/logbook/actions", () => ({
  confirmAttendance: vi.fn(),
  deleteAttendance: vi.fn(),
  updateAttendance: vi.fn(),
}));
vi.mock("@/app/strava/actions", () => ({
  getStravaActivitiesForDate: vi.fn(),
  attachStravaActivity: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import type { LogbookEntry } from "./LogbookList";
import { formatLogbookDate, filterLogbookEntries } from "./LogbookList";

function buildEntry(overrides: {
  regionName?: string;
  kennelId?: string;
  participationLevel?: string;
  date?: string;
} = {}): LogbookEntry {
  const regionName = overrides.regionName ?? "NYC";
  return {
    attendance: {
      id: "att_1",
      participationLevel: overrides.participationLevel ?? "RUN",
      status: "CONFIRMED",
      stravaUrl: null,
      notes: null,
    },
    event: {
      id: "evt_1",
      date: overrides.date ?? "2026-02-14T12:00:00.000Z",
      runNumber: 100,
      title: "Test Trail",
      startTime: "14:00",
      status: "CONFIRMED",
      kennel: {
        id: overrides.kennelId ?? "k_1",
        shortName: "NYCH3",
        fullName: "New York City H3",
        slug: "nych3",
        regionData: {
          slug: regionName.toLowerCase().replace(/\s+/g, "-"),
          name: regionName,
          abbrev: regionName.slice(0, 3).toUpperCase(),
          colorClasses: "bg-blue-100 text-blue-800",
          pinColor: "#3B82F6",
          centroidLat: 40.7,
          centroidLng: -74.0,
        },
      },
    },
  };
}

// ── formatLogbookDate ──

describe("formatLogbookDate", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-06-15T15:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("formats an ISO date to short weekday + month display", () => {
    const result = formatLogbookDate("2026-02-14T12:00:00.000Z");
    expect(result).toBe("Sat, Feb 14, 2026");
  });

  it("uses UTC to avoid timezone shifts near midnight", () => {
    // Jan 1 at UTC noon — should show Jan 1 regardless of local tz
    const result = formatLogbookDate("2026-01-01T12:00:00.000Z");
    expect(result).toContain("Jan");
    expect(result).toContain("1");
    expect(result).toContain("2026");
  });

  it("formats a date near year boundary correctly", () => {
    const result = formatLogbookDate("2025-12-31T12:00:00.000Z");
    expect(result).toBe("Wed, Dec 31, 2025");
  });
});

// ── filterLogbookEntries ──

describe("filterLogbookEntries", () => {
  const entries: LogbookEntry[] = [
    buildEntry({ regionName: "NYC", kennelId: "k_1", participationLevel: "RUN" }),
    buildEntry({ regionName: "Boston", kennelId: "k_2", participationLevel: "HARE" }),
    buildEntry({ regionName: "NYC", kennelId: "k_3", participationLevel: "WALK" }),
  ];

  it("returns all entries when no filters active", () => {
    const result = filterLogbookEntries(entries, [], [], []);
    expect(result).toHaveLength(3);
  });

  it("filters by region slug", () => {
    const result = filterLogbookEntries(entries, ["nyc"], [], []);
    expect(result).toHaveLength(2);
    expect(result.every((e) => e.event.kennel.regionData.slug === "nyc")).toBe(true);
  });

  it("filters by kennel id", () => {
    const result = filterLogbookEntries(entries, [], ["k_2"], []);
    expect(result).toHaveLength(1);
    expect(result[0].event.kennel.id).toBe("k_2");
  });

  it("filters by participation level", () => {
    const result = filterLogbookEntries(entries, [], [], ["HARE"]);
    expect(result).toHaveLength(1);
    expect(result[0].attendance.participationLevel).toBe("HARE");
  });

  it("combines multiple filters with AND logic", () => {
    const result = filterLogbookEntries(entries, ["nyc"], [], ["WALK"]);
    expect(result).toHaveLength(1);
    expect(result[0].attendance.participationLevel).toBe("WALK");
    expect(result[0].event.kennel.regionData.slug).toBe("nyc");
  });

  it("supports multiple values per filter dimension (OR within dimension)", () => {
    const result = filterLogbookEntries(entries, ["nyc", "boston"], [], []);
    expect(result).toHaveLength(3);
  });

  it("returns empty when filters match nothing", () => {
    const result = filterLogbookEntries(entries, ["london"], [], []);
    expect(result).toHaveLength(0);
  });

  it("handles empty entries array", () => {
    const result = filterLogbookEntries([], ["nyc"], ["k_1"], ["RUN"]);
    expect(result).toHaveLength(0);
  });
});
