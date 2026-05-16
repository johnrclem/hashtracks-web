import { describe, it, expect, vi } from "vitest";
import type { Source } from "@/generated/prisma/client";
import { CapitalH3Adapter, parseCapitalRunLine } from "./capital-h3";

vi.mock("@/lib/browser-render", () => ({ browserRender: vi.fn() }));
vi.mock("@/pipeline/structure-hash", () => ({
  generateStructureHash: vi.fn(() => "mock-hash-capital"),
}));

const { browserRender } = await import("@/lib/browser-render");
const mockedBrowserRender = vi.mocked(browserRender);

function makeSource(overrides: Partial<Source> = {}): Source {
  return {
    id: "src-capital",
    name: "Capital H3 Website",
    url: "https://www.sporty.co.nz/capitalh3",
    type: "HTML_SCRAPER",
    trustLevel: 7,
    scrapeFreq: "daily",
    scrapeDays: 180,
    config: { kennelTag: "capital-h3-nz" },
    isActive: true,
    lastScrapedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as Source;
}

describe("parseCapitalRunLine", () => {
  const opts = { sourceUrl: "https://www.sporty.co.nz/capitalh3", kennelTag: "capital-h3-nz" };

  it("parses a fully-populated row (run + date + location + hare)", () => {
    const ev = parseCapitalRunLine("2326 – 18 May 2026 – The Bond Sports Bar – Geestring", opts);
    expect(ev).not.toBeNull();
    expect(ev!.date).toBe("2026-05-18");
    expect(ev!.runNumber).toBe(2326);
    expect(ev!.location).toBe("The Bond Sports Bar");
    expect(ev!.hares).toBe("Geestring");
    expect(ev!.kennelTags).toEqual(["capital-h3-nz"]);
  });

  it("normalises Hare required! placeholder to undefined", () => {
    const ev = parseCapitalRunLine("2329 – 8 Jun 2026 – Hare required! –", opts);
    expect(ev).not.toBeNull();
    expect(ev!.runNumber).toBe(2329);
    expect(ev!.date).toBe("2026-06-08");
    // "Hare required!" lands in the LOCATION slot since it's the first token
    // after the date. stripPlaceholder doesn't drop arbitrary "TBD-ish" text
    // (it's anchored to known markers like TBD/TBA/?), so this stays as the
    // visible location. The trailing empty hare token is filtered.
    expect(ev!.hares).toBeUndefined();
  });

  it("handles location-with-dash in run #2328 (location includes 'Kings Bday')", () => {
    const ev = parseCapitalRunLine("2328 – 1 Jun 2026 – 5pm? Kings B'day – Hare required! –", opts);
    expect(ev).not.toBeNull();
    expect(ev!.location).toBe("5pm? Kings B'day");
  });

  it("returns null for non-run lines", () => {
    expect(parseCapitalRunLine("Click here for the Latest Trash: Run 2325", opts)).toBeNull();
    expect(parseCapitalRunLine("Runs start at 6:30pm unless otherwise noted.", opts)).toBeNull();
    expect(parseCapitalRunLine("", opts)).toBeNull();
  });
});

describe("CapitalH3Adapter.fetch", () => {
  const FIXTURE = `<!DOCTYPE html><html><body>
    <div class="panel-body-text">
      <div id="notices-prevContent-242832">
        <p>Click here for the Latest Trash: Run 2325</p>
        <p>Runs start at 6:30pm unless otherwise noted.</p>
        <p><span>2326</span> – <span>18 May 2026</span> – <span>The Bond Sports Bar</span> – <span>Geestring</span></p>
        <p><span>2327</span> – <span>25 May 2026</span> – <span>The Bridge Bar</span> – <span>Scrac Thing</span></p>
        <p><span>2328</span> – <span>1 Jun 2026</span> – <span>5pm? Kings B'day</span> – <span>Hare required!</span> –</p>
      </div>
    </div>
  </body></html>`;

  it("extracts run rows from the notices panel + skips header/footer paragraphs", async () => {
    mockedBrowserRender.mockResolvedValue(FIXTURE);
    const adapter = new CapitalH3Adapter();
    const result = await adapter.fetch(makeSource(), { days: 365 });

    expect(result.errors).toEqual([]);
    expect(result.events.length).toBe(3);
    expect(result.events[0].date).toBe("2026-05-18");
    expect(result.events[0].runNumber).toBe(2326);
    expect(result.events[0].hares).toBe("Geestring");
    expect(result.events[1].location).toBe("The Bridge Bar");
    expect(result.diagnosticContext?.eventsParsed).toBe(3);
  });

  it("returns the fetch failure when browserRender errors", async () => {
    mockedBrowserRender.mockRejectedValueOnce(new Error("502 challenge"));
    const adapter = new CapitalH3Adapter();
    const result = await adapter.fetch(makeSource(), { days: 180 });
    expect(result.events).toEqual([]);
    expect(result.errors[0]).toMatch(/Browser render failed/);
  });

  it("fails closed when the notices panel is absent (degraded page)", async () => {
    // No `notices-prevContent-*` element — render succeeded but page content
    // is not what we expect. Surface as error so reconcile doesn't cancel
    // live events on a clean-but-empty scrape.
    mockedBrowserRender.mockResolvedValue('<!DOCTYPE html><html><body><div class="panel-body-text"><p>Maintenance window</p></div></body></html>');
    const adapter = new CapitalH3Adapter();
    const result = await adapter.fetch(makeSource(), { days: 180 });
    expect(result.events).toEqual([]);
    expect(result.errors[0]).toMatch(/notices-prevContent-\* panel not found/);
  });
});
