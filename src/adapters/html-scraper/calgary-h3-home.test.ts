import { describe, it, expect, vi, beforeEach } from "vitest";
import * as cheerio from "cheerio";
import {
  parseCalgaryRunNumber,
  parseCalgaryTitle,
  parseCalgaryTime,
  CalgaryH3HomeAdapter,
} from "./calgary-h3-home";
import * as utils from "../utils";
import type { FetchHTMLSuccess } from "../utils";

vi.mock("../utils", async () => {
  const actual = await vi.importActual<typeof import("../utils")>("../utils");
  return {
    ...actual,
    fetchBrowserRenderedPage: vi.fn(),
  };
});

// ---------------------------------------------------------------------------
// parseCalgaryRunNumber
// ---------------------------------------------------------------------------

describe("parseCalgaryRunNumber", () => {
  it("extracts run number from '#2455 - 5'r Run'", () => {
    expect(parseCalgaryRunNumber("#2455 - 5'r Run")).toBe(2455);
  });

  it("returns undefined for 'Bad Thursday Hash' (no #)", () => {
    expect(parseCalgaryRunNumber("Bad Thursday Hash")).toBeUndefined();
  });

  it("handles '#1234' with no dash", () => {
    expect(parseCalgaryRunNumber("#1234")).toBe(1234);
  });
});

// ---------------------------------------------------------------------------
// parseCalgaryTitle
// ---------------------------------------------------------------------------

describe("parseCalgaryTitle", () => {
  it("strips '#2455 - ' prefix", () => {
    expect(parseCalgaryTitle("#2455 - 5'r Run")).toBe("5'r Run");
  });

  it("returns full title when no # prefix", () => {
    expect(parseCalgaryTitle("Bad Thursday Hash")).toBe("Bad Thursday Hash");
  });

  it("handles em-dash separator", () => {
    expect(parseCalgaryTitle("#2455 \u2014 Trail Name")).toBe("Trail Name");
  });
});

// ---------------------------------------------------------------------------
// parseCalgaryTime
// ---------------------------------------------------------------------------

describe("parseCalgaryTime", () => {
  it("extracts first time from range '7:00 pm - 10:00 pm'", () => {
    expect(parseCalgaryTime("7:00 pm - 10:00 pm")).toBe("19:00");
  });

  it("handles single time '5:30 pm'", () => {
    expect(parseCalgaryTime("5:30 pm")).toBe("17:30");
  });

  it("defaults to 19:00 for unparseable string", () => {
    expect(parseCalgaryTime("TBD")).toBe("19:00");
  });
});

// ---------------------------------------------------------------------------
// CalgaryH3HomeAdapter
// ---------------------------------------------------------------------------

describe("CalgaryH3HomeAdapter", () => {
  const adapter = new CalgaryH3HomeAdapter();

  const mockSource = {
    id: "test-calgary-home",
    url: "https://home.onon.org/upcumming-runs",
  } as Parameters<typeof adapter.fetch>[0];

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("parses events from Events Manager HTML", async () => {
    vi.mocked(utils.fetchBrowserRenderedPage).mockResolvedValue({
      ok: true,
      html: "",
      $: cheerio.load(`
        <div class="em-event em-item">
          <div class="em-item-title"><a href="https://home.onon.org/events/2455/">#2455 - 5'r Run</a></div>
          <div class="em-event-date">April 2, 2026</div>
          <div class="em-event-time">7:00 pm - 10:00 pm</div>
          <div class="em-event-location">Kensington Pub</div>
        </div>
        <div class="em-event em-item">
          <div class="em-item-title"><a href="https://home.onon.org/events/bad-thursday/">Bad Thursday Hash</a></div>
          <div class="em-event-date">April 9, 2026</div>
          <div class="em-event-time">6:30 pm - 9:30 pm</div>
          <div class="em-event-location">Ship & Anchor</div>
        </div>
      `),
      structureHash: "cal123",
      fetchDurationMs: 3000,
    } as FetchHTMLSuccess);

    const result = await adapter.fetch(mockSource);
    expect(result.errors).toHaveLength(0);
    expect(result.events).toHaveLength(2);

    const run2455 = result.events[0];
    expect(run2455.runNumber).toBe(2455);
    expect(run2455.title).toBe("5'r Run");
    expect(run2455.date).toBe("2026-04-02");
    expect(run2455.startTime).toBe("19:00");
    expect(run2455.location).toBe("Kensington Pub");
    expect(run2455.kennelTag).toBe("ch3-ab");
    expect(run2455.sourceUrl).toBe("https://home.onon.org/events/2455/");

    const badThursday = result.events[1];
    expect(badThursday.runNumber).toBeUndefined();
    expect(badThursday.title).toBe("Bad Thursday Hash");
    expect(badThursday.date).toBe("2026-04-09");
    expect(badThursday.startTime).toBe("18:30");
  });

  it("returns error when browser render fails", async () => {
    vi.mocked(utils.fetchBrowserRenderedPage).mockResolvedValue({
      ok: false,
      result: {
        events: [],
        errors: ["Browser render failed: timeout"],
        errorDetails: { fetch: [{ url: mockSource.url, message: "timeout" }] },
      },
    });

    const result = await adapter.fetch(mockSource);
    expect(result.events).toHaveLength(0);
    expect(result.errors).toContain("Browser render failed: timeout");
  });

  it("skips events with unparseable dates", async () => {
    vi.mocked(utils.fetchBrowserRenderedPage).mockResolvedValue({
      ok: true,
      html: "",
      $: cheerio.load(`
        <div class="em-event em-item">
          <div class="em-item-title"><a href="#">Good Event</a></div>
          <div class="em-event-date">April 2, 2026</div>
          <div class="em-event-time">7:00 pm</div>
        </div>
        <div class="em-event em-item">
          <div class="em-item-title"><a href="#">Bad Date Event</a></div>
          <div class="em-event-date">Not a real date</div>
          <div class="em-event-time">7:00 pm</div>
        </div>
      `),
      structureHash: "abc",
      fetchDurationMs: 100,
    } as FetchHTMLSuccess);

    const result = await adapter.fetch(mockSource);
    expect(result.events).toHaveLength(1);
    expect(result.events[0].title).toBe("Good Event");
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it("includes diagnostic context", async () => {
    vi.mocked(utils.fetchBrowserRenderedPage).mockResolvedValue({
      ok: true,
      html: "",
      $: cheerio.load(`<div class="em-event em-item">
        <div class="em-item-title"><a href="#">#100 - Test</a></div>
        <div class="em-event-date">April 2, 2026</div>
        <div class="em-event-time">7:00 pm</div>
      </div>`),
      structureHash: "abc",
      fetchDurationMs: 2500,
    } as FetchHTMLSuccess);

    const result = await adapter.fetch(mockSource);
    expect(result.diagnosticContext).toBeDefined();
    expect(result.diagnosticContext!.fetchMethod).toBe("browser-render");
    expect(result.diagnosticContext!.fetchDurationMs).toBe(2500);
    expect(result.diagnosticContext!.eventItemsFound).toBe(1);
  });
});
