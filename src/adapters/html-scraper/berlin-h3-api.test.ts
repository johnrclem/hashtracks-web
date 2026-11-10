import { readFileSync } from "node:fs";
import path from "node:path";
import type { Source } from "@/generated/prisma/client";
import { BerlinH3ApiAdapter, formatHashCash, parseBerlinRun, type BerlinApiRun } from "./berlin-h3-api";

vi.mock("../safe-fetch", () => ({ safeFetch: vi.fn() }));
import { safeFetch } from "../safe-fetch";

/**
 * Rows from the live https://www.berlin-h3.eu/api/v1/runs/all, captured
 * 2026-11-10 (long descriptions trimmed):
 * [0] Run #2362 and [1] Full Moon #156 — bulk-created upcoming placeholders
 * [2] Run #2359 — a full past run; [3] "Run #2320" whose run_number is 2317
 * [4] Halloween 2024 (run_number = the year); [5] Neuglobsow (3-day weekend)
 * [6] a deleted 2022 run; [7] a hidden 2024 run; [8] a drinking practice.
 */
const RUNS: BerlinApiRun[] = JSON.parse(
  readFileSync(path.join(__dirname, "fixtures/berlin-h3-api-2026-11-10.json.fixture"), "utf8"),
);
const byName = (name: string) => {
  const run = RUNS.find((r) => r.event_name === name);
  if (!run) throw new Error(`fixture row ${name} missing`);
  return run;
};
const eventOf = (name: string) => {
  const outcome = parseBerlinRun(byName(name));
  if (!("event" in outcome)) throw new Error(`expected an event for ${name}`);
  return outcome.event;
};

describe("parseBerlinRun", () => {
  it("maps an upcoming placeholder run without inventing details", () => {
    expect(eventOf("Run #2362")).toEqual({
      date: "2026-11-15",
      kennelTags: ["berlinh3"],
      runNumber: 2362,
      title: "Run #2362",
      description: undefined,
      hares: undefined,
      location: undefined,
      locationStreet: undefined,
      locationUrl: undefined,
      startTime: "13:45",
      endTime: "18:00",
      endDate: undefined,
      cost: "5€",
      sourceUrl: "https://www.berlin-h3.eu/?post_type=event_listing&p=1267",
    });
  });

  it("routes Full Moon runs to bh3fm by kennel_name", () => {
    expect(eventOf("Full Moon Run #156")).toMatchObject({
      date: "2026-11-24", kennelTags: ["bh3fm"], runNumber: 156, startTime: "19:00", description: undefined,
    });
  });

  it("maps a full past run: hares, venue, street, pin and meeting point", () => {
    const event = eventOf("Run #2359");
    expect(event).toMatchObject({
      date: "2026-10-25",
      runNumber: 2359,
      hares: "Hot Climax",
      location: "S Pichelsberg",
      locationStreet: "Pichelsberg, 13595 Berlin, Germany",
      latitude: 52.509713,
      longitude: 13.228858,
      startTime: "13:45",
    });
    expect(event.locationUrl).toMatch(/^https:\/\/www\.openstreetmap\.org\//);
    expect(event.description).toMatch(/^Is it up the hill or down to the valley\?/);
    expect(event.description).toMatch(/Meeting point: Exit to Schirwindter Allee$/);
    expect(event.description).not.toContain("<");
  });

  it("falls back to a 'Who: Trail laid by' line when the hares field is empty", () => {
    const run = { ...byName("Run #2359"), hares: null, event_description: "<p>Who: Trail laid by Limp Wrist, with beer</p>" };
    const outcome = parseBerlinRun(run);
    expect("event" in outcome && outcome.event.hares).toBe("Limp Wrist");
  });

  it("takes the run number from the title, not the drifting run_number field", () => {
    expect(eventOf("Run #2320").runNumber).toBe(2320);
    expect(eventOf("BH3 Halloween Run 2024").runNumber).toBeUndefined();
  });

  it("carries a multi-day weekend's last day as endDate", () => {
    expect(eventOf("Neuglobsow 2026")).toMatchObject({
      date: "2026-09-18", endDate: "2026-09-20", endTime: undefined, cost: "150€", runNumber: undefined,
    });
  });

  it("drops deleted, hidden and drinking-practice rows", () => {
    expect(parseBerlinRun(byName("BH3 Run #2110"))).toEqual({ skipped: "deleted" });
    expect(parseBerlinRun(byName("Berlin H3 Run #2232 - Whit Monday!"))).toEqual({ skipped: "hidden" });
    expect(parseBerlinRun(byName("BH3 drinking practice"))).toEqual({ skipped: "event-type" });
  });

  it("fails loud on an unknown kennel or an unparseable date", () => {
    const run = byName("Run #2362");
    expect(parseBerlinRun({ ...run, kennel_name: "Potsdam H3" })).toEqual({
      error: 'run 1267: unknown kennel_name "Potsdam H3"',
    });
    expect(parseBerlinRun({ ...run, start_date: "TBA" })).toHaveProperty("error");
  });
});

describe("formatHashCash", () => {
  it("formats one price, or both when they differ", () => {
    expect(formatHashCash({ hash_cash_members: 5, hash_cash_non_members: 5, event_currency: "€" })).toBe("5€");
    expect(formatHashCash({ hash_cash_members: 4, hash_cash_non_members: 5, event_currency: "€" })).toBe(
      "4€ members / 5€ non-members",
    );
    expect(formatHashCash({ hash_cash_members: null, hash_cash_non_members: null, event_currency: "€" })).toBeUndefined();
  });
});

describe("BerlinH3ApiAdapter.fetch", () => {
  const source = { id: "src", url: "https://www.berlin-h3.eu/api/v1/runs/all", scrapeDays: 365 } as Source;
  const respond = (body: unknown, status = 200) =>
    vi.mocked(safeFetch).mockResolvedValueOnce(new Response(JSON.stringify(body), { status }) as never);

  it("emits every live run and counts the skipped ones", async () => {
    respond(RUNS);
    const result = await new BerlinH3ApiAdapter().fetch(source, { days: 365 * 30 });
    expect(result.errors).toEqual([]);
    expect(result.events.map((e) => e.title)).toEqual([
      "Run #2362", "Full Moon Run #156", "Run #2359", "Run #2320", "BH3 Halloween Run 2024", "Neuglobsow 2026",
    ]);
    expect(result.diagnosticContext).toMatchObject({
      runsFetched: 9, eventsParsed: 6, skipped: { deleted: 1, hidden: 1, "event-type": 1 },
    });
  });

  it("reports a malformed row without dropping the others", async () => {
    respond([RUNS[0], { id: 9, event_name: null }]);
    const result = await new BerlinH3ApiAdapter().fetch(source, { days: 365 * 30 });
    expect(result.events).toHaveLength(1);
    expect(result.errors).toEqual(["Berlin H3 API: row 1 is missing id, event_name or start_date"]);
  });

  it("fails loud on an empty or non-array payload so reconcile stays off", async () => {
    respond([]);
    expect((await new BerlinH3ApiAdapter().fetch(source)).errors[0]).toMatch(/unexpected payload/);
    respond({ detail: "Not Found" });
    expect((await new BerlinH3ApiAdapter().fetch(source)).errors[0]).toMatch(/unexpected payload/);
    respond("oops", 500);
    expect((await new BerlinH3ApiAdapter().fetch(source)).errors[0]).toMatch(/HTTP 500/);
  });
});
