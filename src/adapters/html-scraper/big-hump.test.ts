import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  parseEventHeader,
  parseEventTitle,
  BigHumpAdapter,
} from "./big-hump";
import * as utils from "../utils";

vi.mock("../utils", async () => {
  const actual = await vi.importActual<typeof import("../utils")>("../utils");
  return {
    ...actual,
    fetchHTMLPage: vi.fn(),
  };
});

describe("parseEventHeader", () => {
  it("parses date and run number", () => {
    const result = parseEventHeader("Wednesday 04/01/2026 #1991");
    expect(result.date).toBe("2026-04-01");
    expect(result.runNumber).toBe(1991);
  });

  it("parses Saturday date", () => {
    const result = parseEventHeader("Saturday 04/11/2026 #1993");
    expect(result.date).toBe("2026-04-11");
    expect(result.runNumber).toBe(1993);
  });

  it("returns null date for no date pattern", () => {
    const result = parseEventHeader("Hareline");
    expect(result.date).toBeNull();
    expect(result.runNumber).toBeUndefined();
  });

  it("handles date without run number", () => {
    const result = parseEventHeader("Wednesday 04/01/2026");
    expect(result.date).toBe("2026-04-01");
    expect(result.runNumber).toBeUndefined();
  });
});

describe("parseEventTitle", () => {
  it("splits on @ separator", () => {
    const result = parseEventTitle("Locknut Monster's April Fools' Trail @ Lemay");
    expect(result.title).toBe("Locknut Monster's April Fools' Trail @ Lemay");
    expect(result.hares).toBe("Locknut Monster");
    expect(result.location).toBe("Lemay");
  });

  it("handles title without @ separator", () => {
    const result = parseEventTitle("2FC");
    expect(result.title).toBe("2FC");
    expect(result.hares).toBeUndefined();
    expect(result.location).toBeUndefined();
  });

  it("handles ??? location as undefined", () => {
    const result = parseEventTitle("Whiney @ ???");
    expect(result.hares).toBe("Whiney");
    expect(result.location).toBeUndefined();
  });

  it("handles multiple @ signs — splits on last one", () => {
    const result = parseEventTitle(
      "Disco's Hashers Not Trashers Mini-TrashBash & Hash @ South City",
    );
    expect(result.location).toBe("South City");
    expect(result.hares).toBe("Disco");
  });

  it("handles Headlights and Mr. Headlights @ ???", () => {
    const result = parseEventTitle("Headlights and Mr. Headlights @ ???");
    expect(result.hares).toBe("Headlights and Mr. Headlights");
    expect(result.location).toBeUndefined();
  });

  it("handles Bungle in the Jungle @ location", () => {
    const result = parseEventTitle(
      "Bungle in the Jungle  @ Steelville-the Cancun of Missouri",
    );
    expect(result.location).toBe("Steelville-the Cancun of Missouri");
  });
});

describe("BigHumpAdapter", () => {
  const adapter = new BigHumpAdapter();
  const mockSource = {
    id: "test-bh4",
    url: "http://www.big-hump.com/hareline.php",
  } as never;

  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("parses events from hareline page", async () => {
    const html = `
      <html><body>
        <div class="w3-card">
          <header class="w3-container w3-green">
            <h3>Wednesday 04/01/2026 <span class="w3-text-amber">#1991</span></h3>
          </header>
          <div class="w3-row">
            <div class="w3-col w3-container m9 l10">
              <h4>Locknut Monster's April Fools' Trail @ Lemay</h4>
              <span class="w3-small">Circle up: 6:45 p.m., 3661 Reavis Barracks Rd, St Louis, MO 63125</span>
            </div>
          </div>
        </div>
        <div class="w3-card">
          <header class="w3-container w3-green">
            <h3>Wednesday 04/08/2026 <span class="w3-text-amber">#1992</span></h3>
          </header>
          <div class="w3-row">
            <div class="w3-col w3-container m9 l10">
              <h4>2FC @ ???</h4>
              <span class="w3-small"></span>
            </div>
          </div>
        </div>
      </body></html>
    `;

    vi.mocked(utils.fetchHTMLPage).mockResolvedValue({
      ok: true as const,
      html,
      $: (await import("cheerio")).load(html),
      structureHash: "abc123",
      fetchDurationMs: 100,
    });

    const result = await adapter.fetch(mockSource);

    expect(result.events).toHaveLength(2);

    // First event — fully detailed
    expect(result.events[0].date).toBe("2026-04-01");
    expect(result.events[0].runNumber).toBe(1991);
    expect(result.events[0].kennelTag).toBe("bh4");
    expect(result.events[0].title).toBe(
      "Locknut Monster's April Fools' Trail @ Lemay",
    );
    expect(result.events[0].startTime).toBe("18:45");
    expect(result.events[0].location).toBe(
      "3661 Reavis Barracks Rd, St Louis, MO 63125",
    );

    // Second event — minimal info
    expect(result.events[1].date).toBe("2026-04-08");
    expect(result.events[1].runNumber).toBe(1992);
    expect(result.events[1].hares).toBe("2FC");
    expect(result.events[1].location).toBeUndefined();
  });

  it("returns error on fetch failure", async () => {
    vi.mocked(utils.fetchHTMLPage).mockResolvedValue({
      ok: false as const,
      result: {
        events: [],
        errors: ["HTTP 500"],
        errorDetails: { fetch: [{ url: "http://www.big-hump.com/hareline.php", message: "HTTP 500" }] },
      },
    });

    const result = await adapter.fetch(mockSource);
    expect(result.events).toHaveLength(0);
    expect(result.errors).toContain("HTTP 500");
  });
});
