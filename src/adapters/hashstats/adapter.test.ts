import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  HashStatsAdapter,
  parseHashStatsDateTime,
  mapHashStatsRow,
  type HashStatsRow,
} from "./adapter";
import type { Source } from "@/generated/prisma/client";

vi.mock("../safe-fetch", () => ({
  safeFetch: vi.fn(),
}));

import { safeFetch } from "../safe-fetch";
const mockSafeFetch = vi.mocked(safeFetch);

/** Build a Response-like object whose .json() yields `{ aaData: rows }`. */
function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: async () => body,
  } as unknown as Response;
}

function makeSource(config: unknown, scrapeDays = 20000): Source {
  return {
    id: "src-hashstats-1",
    name: "SCH4 HashStats",
    config,
    url: "https://hashingstats.com/SCH4",
    type: "HTML_SCRAPER",
    scrapeDays,
  } as unknown as Source;
}

// Real captured rows from POST https://hashingstats.com/SCH4/listhashes2
const SCH4_ROWS: HashStatsRow[] = [
  {
    KENNEL_EVENT_NUMBER: "1455",
    EVENT_LOCATION: "Smokin the Oak",
    SPECIAL_EVENT_DESCRIPTION: "Monthly Hyper",
    EVENT_DATE: "2026-05-21 19:00:00",
    EVENT_CITY: "Cincinnati",
    EVENT_STATE: "OH",
    FORMATTED_ADDRESS: "3882 Paxton Ave, Cincinnati, OH 45209, USA",
    HASY_KY: "2114",
  },
  {
    KENNEL_EVENT_NUMBER: "1454",
    EVENT_LOCATION: "Eclectic Northside",
    SPECIAL_EVENT_DESCRIPTION: "HTS BDay Fun",
    EVENT_DATE: "2026-05-09 16:00:00",
    EVENT_CITY: "Cincinnati",
    EVENT_STATE: "OH",
    FORMATTED_ADDRESS: "4109 Hamilton Ave, Cincinnati, OH 45223, USA",
    HASY_KY: "2113",
  },
];

// Real captured rows from POST https://hashingstats.com/QCH4/listhashes2 —
// note the "None" placeholder description on the oldest row.
const QCH4_ROWS: HashStatsRow[] = [
  {
    KENNEL_EVENT_NUMBER: "2",
    EVENT_LOCATION: "Fries Cafe",
    SPECIAL_EVENT_DESCRIPTION: "None",
    EVENT_DATE: "2017-06-27 19:00:00",
    EVENT_CITY: "Cincinnati",
    EVENT_STATE: "OH",
    FORMATTED_ADDRESS: "3247 Jefferson Ave, Cincinnati, OH 45220, USA",
    HASY_KY: "1389",
  },
  {
    KENNEL_EVENT_NUMBER: "1",
    EVENT_LOCATION: "Queen City Radio",
    SPECIAL_EVENT_DESCRIPTION: "First QCH4 Hash",
    EVENT_DATE: "2017-06-13 19:00:00",
    EVENT_CITY: "Cincinnati",
    EVENT_STATE: "OH",
    FORMATTED_ADDRESS: "222 W 12th St, Cincinnati, OH 45202, USA",
    HASY_KY: "1388",
  },
];

beforeEach(() => {
  mockSafeFetch.mockReset();
});

describe("parseHashStatsDateTime", () => {
  it.each([
    ["2026-05-21 19:00:00", { date: "2026-05-21", startTime: "19:00" }],
    ["2017-06-13 19:00:00", { date: "2017-06-13", startTime: "19:00" }],
    // midnight sentinel → no startTime
    ["2020-01-01 00:00:00", { date: "2020-01-01" }],
    // date-only string → no startTime
    ["1999-12-31", { date: "1999-12-31" }],
  ])("parses %s", (input, expected) => {
    expect(parseHashStatsDateTime(input)).toEqual(expected);
  });

  it.each([
    ["", "empty"],
    [undefined, "undefined"],
    ["not-a-date", "garbage"],
    ["2026-02-30 12:00:00", "impossible day (Feb 30)"],
    ["2026-13-01 12:00:00", "impossible month"],
  ])("rejects %s (%s)", (input, _label) => {
    expect(parseHashStatsDateTime(input as string | undefined)).toBeNull();
  });
});

describe("mapHashStatsRow", () => {
  it("maps a full SCH4 row", () => {
    const ev = mapHashStatsRow(SCH4_ROWS[0], "sch4", "https://hashingstats.com", "SCH4");
    expect(ev).toEqual({
      date: "2026-05-21",
      kennelTags: ["sch4"],
      runNumber: 1455,
      startTime: "19:00",
      description: "Monthly Hyper",
      location: "Smokin the Oak",
      locationStreet: "3882 Paxton Ave, Cincinnati, OH 45209, USA",
      sourceUrl: "https://hashingstats.com/SCH4/hashes/2114",
    });
  });

  it("leaves title undefined so merge synthesizes the canonical title", () => {
    const ev = mapHashStatsRow(SCH4_ROWS[0], "sch4", "https://hashingstats.com", "SCH4");
    expect(ev?.title).toBeUndefined();
  });

  it('treats "None" description as no theme', () => {
    const ev = mapHashStatsRow(QCH4_ROWS[0], "qch4", "https://hashingstats.com", "QCH4");
    expect(ev?.description).toBeUndefined();
  });

  it("omits sourceUrl when HASY_KY is absent", () => {
    const row: HashStatsRow = { ...SCH4_ROWS[0], HASY_KY: undefined };
    const ev = mapHashStatsRow(row, "sch4", "https://hashingstats.com", "SCH4");
    expect(ev?.sourceUrl).toBeUndefined();
  });

  it("returns null for an unparseable EVENT_DATE", () => {
    const row: HashStatsRow = { ...SCH4_ROWS[0], EVENT_DATE: "garbage" };
    expect(mapHashStatsRow(row, "sch4", "https://hashingstats.com", "SCH4")).toBeNull();
  });

  it("drops startTime for the midnight sentinel", () => {
    const row: HashStatsRow = { ...SCH4_ROWS[0], EVENT_DATE: "2026-05-21 00:00:00" };
    const ev = mapHashStatsRow(row, "sch4", "https://hashingstats.com", "SCH4");
    expect(ev?.startTime).toBeUndefined();
  });
});

describe("HashStatsAdapter.fetch", () => {
  it("routes each kennel slug to the correct kennelTag", async () => {
    mockSafeFetch
      .mockResolvedValueOnce(jsonResponse({ aaData: SCH4_ROWS }))
      .mockResolvedValueOnce(jsonResponse({ aaData: QCH4_ROWS }));

    const adapter = new HashStatsAdapter();
    const result = await adapter.fetch(
      makeSource({ kennelSlugMap: { sch4: "SCH4", qch4: "QCH4" } }),
    );

    expect(result.errors).toEqual([]);
    expect(result.events).toHaveLength(4);
    expect(result.events.filter((e) => e.kennelTags[0] === "sch4")).toHaveLength(2);
    expect(result.events.filter((e) => e.kennelTags[0] === "qch4")).toHaveLength(2);

    // POSTs to the per-slug listhashes2 endpoint
    expect(mockSafeFetch).toHaveBeenCalledWith(
      "https://hashingstats.com/SCH4/listhashes2",
      expect.objectContaining({ method: "POST" }),
    );
    expect(mockSafeFetch).toHaveBeenCalledWith(
      "https://hashingstats.com/QCH4/listhashes2",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("fails loud (no throw) when kennelSlugMap is missing", async () => {
    const adapter = new HashStatsAdapter();
    const result = await adapter.fetch(makeSource({}));
    expect(result.events).toEqual([]);
    expect(result.errors[0]).toMatch(/kennelSlugMap is missing/i);
    expect(mockSafeFetch).not.toHaveBeenCalled();
  });

  it("records a fetch error when aaData is not an array (auth HTML / error body)", async () => {
    mockSafeFetch.mockResolvedValueOnce(jsonResponse({ error: "nope" }));
    const adapter = new HashStatsAdapter();
    const result = await adapter.fetch(makeSource({ kennelSlugMap: { sch4: "SCH4" } }));

    expect(result.events).toEqual([]);
    expect(result.errorDetails?.fetch?.[0].message).toMatch(/missing aaData array/i);
  });

  it("fails loud on a server-capped partial archive (blocks reconcile)", async () => {
    // iTotalRecords claims 1457 but only 2 rows came back → page was capped.
    // Must error (so scrape.ts skips reconcile) and emit no partial events.
    mockSafeFetch.mockResolvedValueOnce(
      jsonResponse({ aaData: SCH4_ROWS, iTotalRecords: "1457" }),
    );
    const adapter = new HashStatsAdapter();
    const result = await adapter.fetch(makeSource({ kennelSlugMap: { sch4: "SCH4" } }));

    expect(result.events).toEqual([]);
    expect(result.errorDetails?.fetch?.[0].message).toMatch(/partial archive/i);
  });

  it("accepts a full archive when returned rows equal iTotalRecords", async () => {
    mockSafeFetch.mockResolvedValueOnce(
      jsonResponse({ aaData: SCH4_ROWS, iTotalRecords: String(SCH4_ROWS.length) }),
    );
    const adapter = new HashStatsAdapter();
    const result = await adapter.fetch(makeSource({ kennelSlugMap: { sch4: "SCH4" } }));

    expect(result.errors).toEqual([]);
    expect(result.events).toHaveLength(2);
  });

  it("records a fetch error on non-OK HTTP without throwing", async () => {
    mockSafeFetch.mockResolvedValueOnce(jsonResponse({}, false, 503));
    const adapter = new HashStatsAdapter();
    const result = await adapter.fetch(makeSource({ kennelSlugMap: { sch4: "SCH4" } }));

    expect(result.events).toEqual([]);
    expect(result.errorDetails?.fetch?.[0].status).toBe(503);
  });

  it("skips a bad-date row but still emits its siblings (fail-loud)", async () => {
    const rows: HashStatsRow[] = [
      { ...SCH4_ROWS[0], EVENT_DATE: "garbage", KENNEL_EVENT_NUMBER: "1455" },
      SCH4_ROWS[1],
    ];
    mockSafeFetch.mockResolvedValueOnce(jsonResponse({ aaData: rows }));

    const adapter = new HashStatsAdapter();
    const result = await adapter.fetch(makeSource({ kennelSlugMap: { sch4: "SCH4" } }));

    expect(result.events).toHaveLength(1);
    expect(result.events[0].runNumber).toBe(1454);
    expect(result.errorDetails?.parse?.[0].error).toMatch(/unparseable EVENT_DATE/i);
  });

  it("honors options.days — old events fall outside a narrow window", async () => {
    // QCH4 rows are from 2017; a ±30-day window around 2026-06-01 excludes them.
    mockSafeFetch.mockResolvedValueOnce(jsonResponse({ aaData: QCH4_ROWS }));
    const adapter = new HashStatsAdapter();
    const result = await adapter.fetch(
      makeSource({ kennelSlugMap: { qch4: "QCH4" } }),
      { days: 30 },
    );
    expect(result.events).toEqual([]);
    expect(result.diagnosticContext?.apiRowsReturned).toBe(2);
  });

  it("respects a configurable baseUrl override", async () => {
    mockSafeFetch.mockResolvedValueOnce(jsonResponse({ aaData: SCH4_ROWS }));
    const adapter = new HashStatsAdapter();
    await adapter.fetch(
      makeSource({ baseUrl: "https://hashingstats.com/", kennelSlugMap: { sch4: "SCH4" } }),
    );
    // Trailing slash on baseUrl is stripped before composing the URL.
    expect(mockSafeFetch).toHaveBeenCalledWith(
      "https://hashingstats.com/SCH4/listhashes2",
      expect.anything(),
    );
  });
});
