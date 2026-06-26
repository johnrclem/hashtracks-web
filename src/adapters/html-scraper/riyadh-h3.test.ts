import { RiyadhH3Adapter, mapHikeRow, type HikeRow } from "./riyadh-h3";
import { safeFetch } from "../safe-fetch";
import type { Source } from "@/generated/prisma/client";

vi.mock("../safe-fetch", () => ({ safeFetch: vi.fn() }));

const SOURCE = {
  id: "src-riyadh",
  name: "Riyadh H3 Supabase API",
  url: "https://uleyjftvdnpniabomdpi.supabase.co/rest/v1/hikes",
  type: "HTML_SCRAPER",
  scrapeDays: 90,
  config: {
    upcomingOnly: true,
    supabaseProjectRef: "uleyjftvdnpniabomdpi",
    supabaseTable: "hikes",
    supabaseAnonKey: "test-anon-key", // override so fetch() doesn't depend on the env var
  },
} as unknown as Source;

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: async () => body,
  } as unknown as Response;
}

const futureDate = () => {
  const d = new Date();
  d.setDate(d.getDate() + 3);
  return d.toISOString().slice(0, 10);
};

// Representative rows captured from the live `hikes` PostgREST table
// (uleyjftvdnpniabomdpi.supabase.co) on 2026-06-25.
const REAL_ROW: HikeRow = {
  id: "e5cbae32-e32e-4b1b-bdbf-592cc4afe3e7",
  run_number: "2493",
  date: "2026-06-26",
  title: "Dead Camel Rage ", // note trailing space in source
  location: "Ammairyah ",
  difficulty: "moderate",
  gathering_time: "16:30:00",
  circle_time: "17:30:00",
  location_gps: "24°43'17.4\"N 46°24'46.2\"E",
  map_link: "https://maps.app.goo.gl/AB5kegSHKUbGnVAY9",
  description: "  Camel Rage - Ammaiyah  ", // leading/trailing whitespace to exercise trim

  registration_status: "active",
  deleted_at: null,
};

describe("mapHikeRow", () => {
  it("maps a full row with all fields", () => {
    const e = mapHikeRow(REAL_ROW);
    expect(e).not.toBeNull();
    expect(e!.date).toBe("2026-06-26");
    expect(e!.kennelTags).toEqual(["riyadh-h3"]);
    expect(e!.runNumber).toBe(2493);
    expect(e!.startTime).toBe("16:30"); // seconds stripped
    expect(e!.title).toBe("Dead Camel Rage"); // trimmed
    expect(e!.location).toBe("Ammairyah"); // trimmed
    expect(e!.locationUrl).toBe("https://maps.app.goo.gl/AB5kegSHKUbGnVAY9");
    expect(e!.description).toBe("Camel Rage - Ammaiyah"); // trimmed
  });

  it("parses DMS location_gps into latitude/longitude", () => {
    const e = mapHikeRow(REAL_ROW)!;
    expect(e.latitude).toBeCloseTo(24.7215, 3);
    expect(e.longitude).toBeCloseTo(46.4128, 3);
  });

  it("never maps circle_time to endTime", () => {
    const e = mapHikeRow(REAL_ROW)!;
    expect(e.endTime).toBeUndefined();
  });

  it("keeps a place-name title verbatim (does not drop it)", () => {
    // Some titles are place-name dups of location; they are still real,
    // human-entered titles and are kept rather than dropped.
    const e = mapHikeRow({ ...REAL_ROW, title: "Near Falcon Valley" })!;
    expect(e.title).toBe("Near Falcon Valley");
  });

  it("leaves title undefined when blank so merge can synthesize", () => {
    const e = mapHikeRow({ ...REAL_ROW, title: "   " })!;
    expect(e.title).toBeUndefined();
  });

  it("omits coords when location_gps is absent", () => {
    const e = mapHikeRow({ ...REAL_ROW, location_gps: null })!;
    expect(e.latitude).toBeUndefined();
    expect(e.longitude).toBeUndefined();
  });

  it("returns undefined runNumber for an unparseable run_number", () => {
    const e = mapHikeRow({ ...REAL_ROW, run_number: null })!;
    expect(e.runNumber).toBeUndefined();
  });

  it("returns null for a row missing a date (unusable)", () => {
    expect(mapHikeRow({ ...REAL_ROW, date: null })).toBeNull();
    expect(mapHikeRow({ ...REAL_ROW, date: "  " })).toBeNull();
  });

  it("omits optional fields that are absent", () => {
    const e = mapHikeRow({
      run_number: "2400",
      date: "2025-03-07",
      title: null,
      location: null,
      gathering_time: null,
      map_link: null,
      description: null,
      location_gps: null,
    })!;
    expect(e.title).toBeUndefined();
    expect(e.location).toBeUndefined();
    expect(e.locationUrl).toBeUndefined();
    expect(e.description).toBeUndefined();
    expect(e.startTime).toBeUndefined();
    expect(e.latitude).toBeUndefined();
  });
});

describe("RiyadhH3Adapter.fetch", () => {
  beforeEach(() => vi.mocked(safeFetch).mockReset());

  it("returns mapped events for an array body", async () => {
    vi.mocked(safeFetch).mockResolvedValue(
      jsonResponse([{ ...REAL_ROW, date: futureDate() }]),
    );
    const result = await new RiyadhH3Adapter().fetch(SOURCE);
    expect(result.errors).toEqual([]);
    expect(result.events).toHaveLength(1);
    expect(result.events[0].kennelTags).toEqual(["riyadh-h3"]);
  });

  it("fails loud (no events, error pushed) on a non-array body", async () => {
    vi.mocked(safeFetch).mockResolvedValue(
      jsonResponse({ message: "permission denied", hint: null }),
    );
    const result = await new RiyadhH3Adapter().fetch(SOURCE);
    expect(result.events).toEqual([]);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errorDetails?.fetch?.length).toBeGreaterThan(0);
  });

  it("fails loud on an empty array (suppresses reconcile)", async () => {
    vi.mocked(safeFetch).mockResolvedValue(jsonResponse([]));
    const result = await new RiyadhH3Adapter().fetch(SOURCE);
    expect(result.events).toEqual([]);
    expect(result.errors.some((e) => e.includes("0 upcoming"))).toBe(true);
  });

  it("fails loud on a non-OK HTTP status", async () => {
    vi.mocked(safeFetch).mockResolvedValue(jsonResponse(null, false, 401));
    const result = await new RiyadhH3Adapter().fetch(SOURCE);
    expect(result.events).toEqual([]);
    expect(result.errors.some((e) => e.includes("401"))).toBe(true);
  });

  it("fails loud (without fetching) when no anon key is configured", async () => {
    const noKeySource = {
      ...SOURCE,
      config: { supabaseProjectRef: "uleyjftvdnpniabomdpi", supabaseTable: "hikes" },
    } as unknown as Source;
    const prev = process.env.RIYADH_H3_SUPABASE_ANON_KEY;
    delete process.env.RIYADH_H3_SUPABASE_ANON_KEY;
    try {
      const result = await new RiyadhH3Adapter().fetch(noKeySource);
      expect(result.events).toEqual([]);
      expect(result.errors.some((e) => e.includes("anon key"))).toBe(true);
      expect(safeFetch).not.toHaveBeenCalled();
    } finally {
      if (prev !== undefined) process.env.RIYADH_H3_SUPABASE_ANON_KEY = prev;
    }
  });

  it("fails loud when the fetch throws", async () => {
    vi.mocked(safeFetch).mockImplementationOnce(async () => {
      throw new Error("network down");
    });
    const result = await new RiyadhH3Adapter().fetch(SOURCE);
    expect(result.events).toEqual([]);
    expect(result.errors.length).toBeGreaterThan(0);
  });
});
