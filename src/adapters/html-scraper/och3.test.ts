import { describe, it, expect, vi } from "vitest";
import {
  parseOCH3Date,
  extractDayOfWeek,
  getStartTimeForDay,
  parseOCH3Entry,
} from "./och3";
import { OCH3Adapter } from "./och3";

describe("parseOCH3Date", () => {
  it("parses ordinal date with day name", () => {
    expect(parseOCH3Date("Sunday 22nd February 2026")).toBe("2026-02-22");
  });

  it("parses ordinal date without day name", () => {
    expect(parseOCH3Date("22nd February 2026")).toBe("2026-02-22");
  });

  it("parses date without ordinal suffix", () => {
    expect(parseOCH3Date("22 February 2026")).toBe("2026-02-22");
  });

  it("parses DD/MM/YYYY format", () => {
    expect(parseOCH3Date("22/02/2026")).toBe("2026-02-22");
  });

  it("parses 1st, 2nd, 3rd ordinals", () => {
    expect(parseOCH3Date("1st March 2026")).toBe("2026-03-01");
    expect(parseOCH3Date("Monday 2nd March 2026")).toBe("2026-03-02");
    expect(parseOCH3Date("3rd March 2026")).toBe("2026-03-03");
  });

  it("returns null for invalid month", () => {
    expect(parseOCH3Date("22nd Flob 2026")).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(parseOCH3Date("")).toBeNull();
  });
});

describe("extractDayOfWeek", () => {
  it("extracts Sunday", () => {
    expect(extractDayOfWeek("Sunday 22nd February 2026")).toBe("sunday");
  });

  it("extracts Monday", () => {
    expect(extractDayOfWeek("Monday 23rd February 2026")).toBe("monday");
  });

  it("returns null for no day name", () => {
    expect(extractDayOfWeek("22nd February 2026")).toBeNull();
  });
});

describe("getStartTimeForDay", () => {
  it("returns 11:00 for Sunday", () => {
    expect(getStartTimeForDay("sunday")).toBe("11:00");
  });

  it("returns 19:30 for Monday", () => {
    expect(getStartTimeForDay("monday")).toBe("19:30");
  });

  it("defaults to 11:00 for unknown day", () => {
    expect(getStartTimeForDay(null)).toBe("11:00");
    expect(getStartTimeForDay("wednesday")).toBe("11:00");
  });
});

describe("parseOCH3Entry", () => {
  it("parses Sunday run with location and hares", () => {
    const text = "Sunday 22nd February 2026\nLocation: The Fox, Coulsdon\nHare: Speedy";
    const event = parseOCH3Entry(text);
    expect(event).not.toBeNull();
    expect(event!.date).toBe("2026-02-22");
    expect(event!.kennelTag).toBe("OCH3");
    expect(event!.startTime).toBe("11:00");
    expect(event!.location).toBe("The Fox, Coulsdon");
    expect(event!.hares).toBe("Speedy");
  });

  it("parses Monday run with correct start time", () => {
    const text = "Monday 23rd February 2026\nLocation: The Red Lion\nHare: Muddy";
    const event = parseOCH3Entry(text);
    expect(event).not.toBeNull();
    expect(event!.date).toBe("2026-02-23");
    expect(event!.startTime).toBe("19:30");
  });

  it("handles TBA hares", () => {
    const text = "Sunday 1st March 2026\nHare: TBA\nLocation: TBD";
    const event = parseOCH3Entry(text);
    expect(event).not.toBeNull();
    expect(event!.hares).toBeUndefined();
    expect(event!.location).toBeUndefined();
  });

  it("returns null for text without date", () => {
    expect(parseOCH3Entry("No date here")).toBeNull();
  });

  it("parses entry with multiple hares", () => {
    const text = "Sunday 8th March 2026\nHares: Flash & Muddy\nLocation: The Crown";
    const event = parseOCH3Entry(text);
    expect(event).not.toBeNull();
    expect(event!.hares).toBe("Flash & Muddy");
  });
});

const SAMPLE_TABLE_HTML = `
<html><body>
<table>
  <tr><th>Date</th><th>Location</th><th>Hare</th></tr>
  <tr><td>Sunday 22nd February 2026 Location: The Fox, Coulsdon Hare: Speedy</td></tr>
  <tr><td>Monday 23rd February 2026 Location: The Red Lion Hare: Muddy</td></tr>
  <tr><td>Sunday 1st March 2026 Location: The Crown Hare: Flash</td></tr>
</table>
</body></html>
`;

const SAMPLE_PARAGRAPH_HTML = `
<html><body>
<div class="main-content">
  <p>Sunday 22nd February 2026
  Location: The Fox, Coulsdon
  Hare: Speedy</p>
  <p>Monday 23rd February 2026
  Location: The Red Lion
  Hare: Muddy</p>
</div>
</body></html>
`;

describe("OCH3Adapter.fetch", () => {
  it("parses table-based HTML", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(SAMPLE_TABLE_HTML, { status: 200 }),
    );

    const adapter = new OCH3Adapter();
    const result = await adapter.fetch({
      id: "test",
      url: "http://www.och3.org.uk/upcoming-run-list.html",
    } as never);

    expect(result.events.length).toBeGreaterThanOrEqual(3);
    expect(result.structureHash).toBeDefined();

    const sundayRun = result.events.find((e) => e.date === "2026-02-22");
    expect(sundayRun).toBeDefined();
    expect(sundayRun!.startTime).toBe("11:00");

    const mondayRun = result.events.find((e) => e.date === "2026-02-23");
    expect(mondayRun).toBeDefined();
    expect(mondayRun!.startTime).toBe("19:30");

    vi.restoreAllMocks();
  });

  it("parses paragraph-based HTML", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(SAMPLE_PARAGRAPH_HTML, { status: 200 }),
    );

    const adapter = new OCH3Adapter();
    const result = await adapter.fetch({
      id: "test",
      url: "http://www.och3.org.uk/upcoming-run-list.html",
    } as never);

    expect(result.events.length).toBeGreaterThanOrEqual(2);

    vi.restoreAllMocks();
  });

  it("returns fetch error on network failure", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(
      new Error("Network error"),
    );

    const adapter = new OCH3Adapter();
    const result = await adapter.fetch({
      id: "test",
      url: "http://www.och3.org.uk/upcoming-run-list.html",
    } as never);

    expect(result.events).toHaveLength(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errorDetails?.fetch).toHaveLength(1);

    vi.restoreAllMocks();
  });

  it("returns fetch error on HTTP error", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("Not found", { status: 404, statusText: "Not Found" }),
    );

    const adapter = new OCH3Adapter();
    const result = await adapter.fetch({
      id: "test",
      url: "http://www.och3.org.uk/upcoming-run-list.html",
    } as never);

    expect(result.events).toHaveLength(0);
    expect(result.errorDetails?.fetch?.[0].status).toBe(404);

    vi.restoreAllMocks();
  });
});
