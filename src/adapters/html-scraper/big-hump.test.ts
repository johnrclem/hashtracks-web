import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Source } from "@/generated/prisma/client";
import {
  BigHumpAdapter,
  BIG_HUMP_RUN_QUERY_URL,
  buildRunQuery,
  decodeHashDocument,
  extractRunQueryDocuments,
  hashToRawEvent,
  toClubDateTime,
  type BigHumpHash,
} from "./big-hump";
import { BIG_HUMP_RUN_QUERY_FIXTURE } from "./big-hump.fixture";
import { safeFetch } from "../safe-fetch";

vi.mock("../safe-fetch", () => ({ safeFetch: vi.fn() }));
const mockSafeFetch = vi.mocked(safeFetch);

function hash(overrides: Partial<BigHumpHash> = {}): BigHumpHash {
  return {
    id: "abc123",
    number: 2100,
    startsAt: new Date("2027-06-03T23:30:00Z"),
    title: "Summer Trail",
    hares: "Whiney Bitch",
    location: "Tower Grove Park",
    locationUrl: "",
    onAfter: "",
    kennel: "",
    status: "scheduled",
    hashCashCents: 800,
    directions: "",
    ...overrides,
  };
}

function fixtureEvents() {
  const docs = extractRunQueryDocuments(BIG_HUMP_RUN_QUERY_FIXTURE);
  return docs.map((d) => hashToRawEvent(decodeHashDocument(d)));
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("extractRunQueryDocuments", () => {
  it("returns every document in the stream", () => {
    expect(extractRunQueryDocuments(BIG_HUMP_RUN_QUERY_FIXTURE)).toHaveLength(8);
  });

  it("treats a readTime-only element as an empty result", () => {
    expect(extractRunQueryDocuments([{ readTime: "2026-11-25T00:00:00Z" }])).toEqual([]);
  });

  it("throws on a non-array body", () => {
    expect(() => extractRunQueryDocuments({ documents: [] })).toThrow(/expected an array/);
    expect(() => extractRunQueryDocuments(null)).toThrow(/expected an array/);
    expect(() => extractRunQueryDocuments("<html>")).toThrow(/expected an array/);
  });

  it("throws on an error element", () => {
    expect(() =>
      extractRunQueryDocuments([{ error: { code: 403, message: "Missing or insufficient permissions." } }]),
    ).toThrow(/insufficient permissions/);
  });

  it("throws on a document without a name", () => {
    expect(() => extractRunQueryDocuments([{ document: { fields: {} } }])).toThrow(/without a name/);
  });
});

describe("decodeHashDocument", () => {
  it("decodes typed Firestore values", () => {
    const h = decodeHashDocument({
      name: "projects/bighump/databases/(default)/documents/hashes/XYZ",
      fields: {
        number: { integerValue: "2040" },
        startsAt: { timestampValue: "2026-11-26T00:30:00Z" },
        title: { stringValue: "  Skanksgiving  " },
        hashCashCents: { nullValue: null },
        status: { stringValue: "scheduled" },
      },
    });
    expect(h.id).toBe("XYZ");
    expect(h.number).toBe(2040);
    expect(h.startsAt?.toISOString()).toBe("2026-11-26T00:30:00.000Z");
    expect(h.title).toBe("Skanksgiving");
    expect(h.hashCashCents).toBeNull();
    expect(h.hares).toBe("");
  });

  it("defaults missing status to scheduled and missing values to empty", () => {
    const h = decodeHashDocument({ name: "x/hashes/Q", fields: {} });
    expect(h.status).toBe("scheduled");
    expect(h.number).toBeNull();
    expect(h.startsAt).toBeNull();
  });
});

describe("toClubDateTime", () => {
  it("converts a CST evening instant to the local date and time", () => {
    // 00:30 UTC on the 26th is 18:30 on the 25th in St. Louis (CST).
    expect(toClubDateTime(new Date("2026-11-26T00:30:00Z"))).toEqual({
      date: "2026-11-25",
      startTime: "18:30",
    });
  });

  it("converts a CDT instant", () => {
    expect(toClubDateTime(new Date("2026-09-16T23:30:00Z"))).toEqual({
      date: "2026-09-16",
      startTime: "18:30",
    });
  });

  it("drops the time for legacy local-midnight (date-only) rows", () => {
    expect(toClubDateTime(new Date("1999-10-09T05:00:00Z"))).toEqual({ date: "1999-10-09" });
    expect(toClubDateTime(new Date("1999-12-11T06:00:00Z"))).toEqual({ date: "1999-12-11" });
  });
});

describe("hashToRawEvent — live fixture", () => {
  const byRun = new Map(
    fixtureEvents()
      .filter((e): e is NonNullable<typeof e> => e !== null)
      .map((e) => [e.runNumber ?? e.title ?? "?", e]),
  );

  it("skips the cancelled undated run, the other kennel's event and the blank slot", () => {
    const events = fixtureEvents();
    expect(events.filter((e) => e === null)).toHaveLength(3);
    expect(byRun.has(2051)).toBe(false);
    expect(byRun.has("Fe-Fe")).toBe(false);
    expect([...byRun.keys()].sort()).toEqual([2, 2039, 2040, 2042, 30].sort());
  });

  it("maps a filled upcoming run with every field", () => {
    const e = byRun.get(2040)!;
    expect(e).toMatchObject({
      date: "2026-11-25",
      kennelTags: ["bh4"],
      runNumber: 2040,
      title: "Skanksgiving w/Dos & Headlights 🦃🍁",
      hares: "Dos HiXXies & How Do You Like My Headlights NOW",
      location: "Rear parking lot of Woerner Elementary School",
      locationUrl: "https://maps.app.goo.gl/r9WnzdVDv3QrtCj3A?g_st=ic",
      startTime: "18:30",
    });
    expect(e.sourceUrl).toMatch(/^https:\/\/big-hump\.com\/hareline\.html\?h=bh-r2040$/);
    // hashCashCents 0 → no cost; onAfter "TBD" → not appended
    expect(e.cost).toBeUndefined();
    expect(e.description).toContain("PUB CRAWL");
    expect(e.description).not.toContain("<p>");
    expect(e.description).not.toContain("On-after");
  });

  it("maps a done run with hash cash", () => {
    const e = byRun.get(2039)!;
    expect(e).toMatchObject({
      date: "2026-11-18",
      runNumber: 2039,
      title: "Roadkill & DDD",
      cost: "$8",
      startTime: "18:30",
    });
  });

  it("drops a title that only repeats the hares", () => {
    const e = byRun.get(2042)!;
    expect(e.hares).toBe("How Do You Like My Headlights NOW");
    expect(e.title).toBeUndefined();
    expect(e.date).toBe("2026-12-02");
  });

  it("keeps a legacy 'Open' run but with no placeholder title and no time", () => {
    const e = byRun.get(30)!;
    expect(e.date).toBe("1999-10-09");
    expect(e.title).toBeUndefined();
    expect(e.startTime).toBeUndefined();
  });

  it("maps the second-ever run from 1999", () => {
    const e = byRun.get(2)!;
    expect(e).toMatchObject({ date: "1999-03-24", runNumber: 2, hares: "KFC", location: "Belleville" });
  });
});

describe("hashToRawEvent — rules", () => {
  it("skips cancelled runs", () => {
    expect(hashToRawEvent(hash({ status: "cancelled" }))).toBeNull();
  });

  it("keeps a numbered run even when another kennel is named as host", () => {
    expect(hashToRawEvent(hash({ kennel: "BFH3" }))?.runNumber).toBe(2100);
  });

  it("keeps an unnumbered Big-Hump social", () => {
    const e = hashToRawEvent(hash({ number: null, kennel: "Big-Hump", title: "Pig Roast" }));
    expect(e?.runNumber).toBeUndefined();
    expect(e?.title).toBe("Pig Roast");
  });

  it("skips an unfilled scheduled 'Open' slot but keeps a filled one", () => {
    expect(hashToRawEvent(hash({ title: "Open", hares: "", location: "TBA" }))).toBeNull();
    expect(hashToRawEvent(hash({ title: "", hares: "Locknut Monster", location: "" }))?.hares).toBe(
      "Locknut Monster",
    );
  });

  it("formats fractional hash cash", () => {
    expect(hashToRawEvent(hash({ hashCashCents: 550 }))?.cost).toBe("$5.50");
  });

  it("appends a real on-after and caps long write-ups", () => {
    const e = hashToRawEvent(hash({ directions: `<p>${"x".repeat(5000)}</p>`, onAfter: "Schlafly Tap Room" }));
    expect(e?.description?.endsWith("On-after: Schlafly Tap Room")).toBe(true);
    expect(e?.description?.length).toBeLessThan(4100);
  });

  it("ignores a non-http location URL", () => {
    expect(hashToRawEvent(hash({ locationUrl: "javascript:alert(1)" }))?.locationUrl).toBeUndefined();
  });
});

describe("BigHumpAdapter.fetch", () => {
  const adapter = new BigHumpAdapter();
  const source = (config: unknown) =>
    ({ id: "src", url: "https://big-hump.com/hareline.html", config }) as unknown as Source;

  beforeEach(() => {
    mockSafeFetch.mockReset();
  });

  function postedQuery() {
    const init = mockSafeFetch.mock.calls[0][1] as RequestInit;
    return JSON.parse(init.body as string);
  }

  it("POSTs a windowed runQuery and returns sorted events", async () => {
    mockSafeFetch.mockResolvedValue(jsonResponse(BIG_HUMP_RUN_QUERY_FIXTURE));
    const result = await adapter.fetch(source({ includeHistory: true }), { days: 365 * 30 });

    expect(mockSafeFetch).toHaveBeenCalledWith(BIG_HUMP_RUN_QUERY_URL, expect.objectContaining({ method: "POST" }));
    const q = postedQuery().structuredQuery;
    expect(q.from).toEqual([{ collectionId: "hashes" }]);
    expect(q.select.fields.map((f: { fieldPath: string }) => f.fieldPath)).not.toContain("attendeeNames");

    expect(result.errors).toEqual([]);
    expect(result.events.map((e) => e.runNumber)).toEqual([2, 30, 2039, 2040, 2042]);
    expect(result.diagnosticContext).toMatchObject({ documentsRead: 8, eventsEmitted: 5, documentsSkipped: 3 });
  });

  it("starts the window at the days bound with history, and near today without", async () => {
    mockSafeFetch.mockResolvedValue(jsonResponse([{ readTime: "x" }]));
    const now = Date.now();
    await adapter.fetch(source({ includeHistory: true }), { days: 100 });
    const withHistory = new Date(
      postedQuery().structuredQuery.where.compositeFilter.filters[0].fieldFilter.value.timestampValue,
    ).getTime();
    expect(Math.abs(withHistory - (now - 100 * 86_400_000))).toBeLessThan(60_000);

    mockSafeFetch.mockClear();
    mockSafeFetch.mockResolvedValue(jsonResponse([{ readTime: "x" }]));
    await adapter.fetch(source({}), { days: 100 });
    const noHistory = new Date(
      postedQuery().structuredQuery.where.compositeFilter.filters[0].fieldFilter.value.timestampValue,
    ).getTime();
    expect(Math.abs(noHistory - (now - 86_400_000))).toBeLessThan(60_000);
  });

  it("fails loudly on an HTTP error", async () => {
    mockSafeFetch.mockResolvedValue(jsonResponse({ error: { message: "nope" } }, 403));
    const result = await adapter.fetch(source({ includeHistory: true }), { days: 30 });
    expect(result.events).toEqual([]);
    expect(result.errors[0]).toMatch(/HTTP 403/);
    expect(result.errorDetails?.fetch?.[0].status).toBe(403);
  });

  it("fails loudly on a malformed body", async () => {
    mockSafeFetch.mockResolvedValue(jsonResponse({ documents: [] }));
    const result = await adapter.fetch(source({ includeHistory: true }), { days: 30 });
    expect(result.events).toEqual([]);
    expect(result.errors[0]).toMatch(/expected an array/);
  });

  it("fails loudly on a network error", async () => {
    mockSafeFetch.mockRejectedValue(new Error("ECONNRESET"));
    const result = await adapter.fetch(source({ includeHistory: true }), { days: 30 });
    expect(result.errors[0]).toMatch(/ECONNRESET/);
  });
});

describe("buildRunQuery", () => {
  it("orders by startsAt ascending with a closed range", () => {
    const q = buildRunQuery(new Date("2020-01-01T00:00:00Z"), new Date("2030-01-01T00:00:00Z")) as {
      structuredQuery: { orderBy: unknown; where: { compositeFilter: { filters: unknown[] } } };
    };
    expect(q.structuredQuery.orderBy).toEqual([{ field: { fieldPath: "startsAt" }, direction: "ASCENDING" }]);
    expect(q.structuredQuery.where.compositeFilter.filters).toHaveLength(2);
  });
});
