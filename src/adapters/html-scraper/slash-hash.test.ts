import { describe, it, expect, vi } from "vitest";
import {
  parseSlashDate,
  parseSlashTime,
  parseSlashRow,
} from "./slash-hash";
import { SlashHashAdapter } from "./slash-hash";

describe("parseSlashDate", () => {
  it("parses ordinal date with full month", () => {
    expect(parseSlashDate("14th March 2026")).toBe("2026-03-14");
  });

  it("parses date without ordinal", () => {
    expect(parseSlashDate("14 March 2026")).toBe("2026-03-14");
  });

  it("parses DD/MM/YYYY", () => {
    expect(parseSlashDate("14/03/2026")).toBe("2026-03-14");
  });

  it("parses date with day name", () => {
    expect(parseSlashDate("Saturday 14th March 2026")).toBe("2026-03-14");
  });

  it("returns null for invalid month", () => {
    expect(parseSlashDate("14th Floop 2026")).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(parseSlashDate("")).toBeNull();
  });
});

describe("parseSlashTime", () => {
  it("parses noon", () => {
    expect(parseSlashTime("12 Noon")).toBe("12:00");
  });

  it("parses just noon", () => {
    expect(parseSlashTime("Noon")).toBe("12:00");
  });

  it("parses PM time", () => {
    expect(parseSlashTime("1pm")).toBe("13:00");
  });

  it("parses time with minutes", () => {
    expect(parseSlashTime("2:30 PM")).toBe("14:30");
  });

  it("returns null for no time", () => {
    expect(parseSlashTime("no time here")).toBeNull();
  });
});

describe("parseSlashRow", () => {
  it("parses 6-column row", () => {
    const cells = ["320", "Sat", "14th March 2026", "12 Noon", "The Pub, Brixton", "Speedy"];
    const event = parseSlashRow(cells);
    expect(event).not.toBeNull();
    expect(event!.date).toBe("2026-03-14");
    expect(event!.kennelTag).toBe("SLH3");
    expect(event!.runNumber).toBe(320);
    expect(event!.startTime).toBe("12:00");
    expect(event!.location).toBe("The Pub, Brixton");
    expect(event!.hares).toBe("Speedy");
  });

  it("parses 5-column row", () => {
    const cells = ["321", "11th April 2026", "12 Noon", "Clapham Common", "Trail Blazer"];
    const event = parseSlashRow(cells);
    expect(event).not.toBeNull();
    expect(event!.date).toBe("2026-04-11");
    expect(event!.runNumber).toBe(321);
    expect(event!.location).toBe("Clapham Common");
    expect(event!.hares).toBe("Trail Blazer");
  });

  it("handles TBC hare", () => {
    const cells = ["322", "Sat", "9th May 2026", "12 Noon", "TBA", "TBC"];
    const event = parseSlashRow(cells);
    expect(event).not.toBeNull();
    expect(event!.hares).toBeUndefined();
    expect(event!.location).toBeUndefined();
  });

  it("returns null for too few cells", () => {
    expect(parseSlashRow(["320", "Sat"])).toBeNull();
  });

  it("returns null for row without valid date", () => {
    expect(parseSlashRow(["320", "Sat", "No date", "Noon", "Pub", "Hare"])).toBeNull();
  });

  it("always uses SLH3 kennel tag", () => {
    const cells = ["323", "Sat", "13th June 2026", "12 Noon", "Venue", "Hare"];
    const event = parseSlashRow(cells);
    expect(event!.kennelTag).toBe("SLH3");
  });
});

const SAMPLE_HTML = `
<html><body>
<h1>SLASH Run List 2026</h1>
<table border="1">
  <tr><th>No.</th><th>Day</th><th>Date</th><th>Time</th><th>Location</th><th>Hare</th></tr>
  <tr><td>320</td><td>Sat</td><td>14th March 2026</td><td>12 Noon</td><td>The Duke, Brixton</td><td>Speedy</td></tr>
  <tr><td>321</td><td>Sat</td><td>11th April 2026</td><td>12 Noon</td><td>Clapham Common</td><td>Flash</td></tr>
  <tr><td>322</td><td>Sat</td><td>9th May 2026</td><td>12 Noon</td><td>TBC</td><td>TBC</td></tr>
</table>
</body></html>
`;

describe("SlashHashAdapter.fetch", () => {
  it("parses sample HTML and returns events", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(SAMPLE_HTML, { status: 200 }),
    );

    const adapter = new SlashHashAdapter();
    const result = await adapter.fetch({
      id: "test",
      url: "https://www.londonhash.org/slah3/runlist/slash3list.html",
    } as never);

    expect(result.events).toHaveLength(3);
    expect(result.errors).toHaveLength(0);
    expect(result.structureHash).toBeDefined();

    const first = result.events[0];
    expect(first.date).toBe("2026-03-14");
    expect(first.kennelTag).toBe("SLH3");
    expect(first.runNumber).toBe(320);
    expect(first.startTime).toBe("12:00");
    expect(first.location).toBe("The Duke, Brixton");
    expect(first.hares).toBe("Speedy");

    // TBC event should still parse but with undefined hares/location
    const tbc = result.events[2];
    expect(tbc.date).toBe("2026-05-09");
    expect(tbc.hares).toBeUndefined();
    expect(tbc.location).toBeUndefined();

    vi.restoreAllMocks();
  });

  it("returns fetch error on network failure", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(
      new Error("Network error"),
    );

    const adapter = new SlashHashAdapter();
    const result = await adapter.fetch({
      id: "test",
      url: "https://www.londonhash.org/slah3/runlist/slash3list.html",
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

    const adapter = new SlashHashAdapter();
    const result = await adapter.fetch({
      id: "test",
      url: "https://www.londonhash.org/slah3/runlist/slash3list.html",
    } as never);

    expect(result.events).toHaveLength(0);
    expect(result.errorDetails?.fetch?.[0].status).toBe(404);

    vi.restoreAllMocks();
  });
});
