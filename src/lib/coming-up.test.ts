import { composeUtcStart } from "@/lib/timezone";
import { isStillAhead, pickNearby, pickWorld, type ComingUpCandidate } from "./coming-up";

const noon = (ymd: string) => new Date(`${ymd}T12:00:00Z`);

interface Row extends ComingUpCandidate {
  id: string;
}

const NOLA = { latitude: 29.9511, longitude: -90.0715 };

// dateUtc mirrors the merge pipeline: the composed start, or UTC noon when there's no start time.
function run(id: string, ymd: string, startTime: string | null, tz: string, lat: number | null, lng: number | null): Row {
  const date = noon(ymd);
  return { id, date, dateUtc: composeUtcStart(date, startTime, tz) ?? date, startTime, timezone: tz, latitude: lat, longitude: lng };
}

// 2026-11-10 13:40 UTC = 21:40 in Kuching, 07:40 in New Orleans, 03:40 in Honolulu.
const now = new Date("2026-11-10T13:40:00Z");

describe("isStillAhead", () => {
  it("drops a run that already started in its own time zone", () => {
    expect(isStillAhead(run("kuching", "2026-11-10", "17:30", "Asia/Kuching", 1.55, 110.34), now)).toBe(false);
  });

  it("keeps a later run on the same date elsewhere", () => {
    expect(isStillAhead(run("h5", "2026-11-10", "17:45", "Pacific/Honolulu", 21.3, -157.8), now)).toBe(true);
  });

  it("keeps a run with no start time until its local day ends", () => {
    expect(isStillAhead(run("tba", "2026-11-10", null, "America/Chicago", 29.95, -90.07), now)).toBe(true);
    expect(isStillAhead(run("old", "2026-11-09", null, "America/Chicago", 29.95, -90.07), now)).toBe(false);
  });

  it("falls back to the local-date check when a start time has no composed instant", () => {
    const row = { ...run("x", "2026-11-10", "18:00", "America/Chicago", 29.95, -90.07), dateUtc: null };
    expect(isStillAhead(row, now)).toBe(true);
  });

  it("keeps yesterday's UTC date when it is still that day locally", () => {
    // 01:00 UTC Nov 11 is 15:00 Nov 10 in Honolulu; an 18:00 run there hasn't started.
    const early = new Date("2026-11-11T01:00:00Z");
    expect(isStillAhead(run("h5", "2026-11-10", "18:00", "Pacific/Honolulu", 21.3, -157.8), early)).toBe(true);
  });
});

describe("pickNearby", () => {
  const rows: Row[] = [
    run("voodoo-1068", "2026-11-12", "18:30", "America/Chicago", 29.97, -90.09),
    run("noh3-social", "2026-11-13", null, "America/Chicago", 29.95, -90.07),
    run("noh3-1984", "2026-11-16", "18:30", "America/Chicago", 29.95, -90.07),
    run("gulf-coast", "2026-11-14", "13:00", "America/Chicago", 30.69, -88.04), // Mobile, ~210 km
    run("no-coords", "2026-11-11", "19:00", "America/Chicago", null, null),
  ];

  it("returns runs within 50 km, soonest first", () => {
    const pick = pickNearby(rows, NOLA, now, 6);
    expect(pick?.radiusKm).toBe(50);
    expect(pick?.events.map((r) => r.id)).toEqual(["voodoo-1068", "noh3-social", "noh3-1984"]);
  });

  it("widens to 150 km when fewer than three runs are close", () => {
    const BILOXI = { latitude: 30.396, longitude: -88.885 };
    const pick = pickNearby(rows, BILOXI, now, 6);
    // New Orleans is ~125 km from Biloxi; Mobile ~90 km.
    expect(pick?.radiusKm).toBe(150);
    expect(pick?.events.map((r) => r.id)).toEqual(["voodoo-1068", "noh3-social", "gulf-coast", "noh3-1984"]);
  });

  it("returns null when nothing is within the widest radius", () => {
    expect(pickNearby(rows, { latitude: 51.5, longitude: -0.12 }, now, 6)).toBeNull();
  });

  it("respects the limit", () => {
    expect(pickNearby(rows, NOLA, now, 2)?.events).toHaveLength(2);
  });
});

describe("pickWorld", () => {
  it("drops started runs and orders by real start time across time zones", () => {
    const rows: Row[] = [
      run("kuching", "2026-11-10", "17:30", "Asia/Kuching", 1.55, 110.34), // started
      run("h5", "2026-11-10", "17:45", "Pacific/Honolulu", 21.3, -157.8), // 03:45 UTC Nov 11
      run("london", "2026-11-10", "19:00", "Europe/London", 51.5, -0.12), // 19:00 UTC
      run("nyc", "2026-11-10", "19:00", "America/New_York", 40.7, -74), // 00:00 UTC Nov 11
    ];
    expect(pickWorld(rows, now, 6).map((r) => r.id)).toEqual(["london", "nyc", "h5"]);
  });
});
