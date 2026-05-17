import { describe, it, expect, vi } from "vitest";
import type { Source } from "@/generated/prisma/client";
import { GeriatrixH3Adapter, parseGeriatrixParagraphs } from "./geriatrix-h3";

vi.mock("@/lib/browser-render", () => ({ browserRender: vi.fn() }));
vi.mock("@/pipeline/structure-hash", () => ({
  generateStructureHash: vi.fn(() => "mock-hash-geriatrix"),
}));

const { browserRender } = await import("@/lib/browser-render");
const mockedBrowserRender = vi.mocked(browserRender);

function makeSource(overrides: Partial<Source> = {}): Source {
  return {
    id: "src-geriatrix",
    name: "Geriatrix H3 Receding Hareline",
    url: "https://www.sporty.co.nz/geriatrixhhh/Receding-Hareline/NewTab1",
    type: "HTML_SCRAPER",
    trustLevel: 7,
    scrapeFreq: "daily",
    scrapeDays: 180,
    config: { kennelTag: "geriatrix-h3" },
    isActive: true,
    lastScrapedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as Source;
}

describe("parseGeriatrixParagraphs", () => {
  it("groups DD/MM/YYYY + Venue + Hare + Map into one row each", () => {
    const rows = parseGeriatrixParagraphs([
      { text: "05/05/2026" },
      { text: "Venue: Chapman Taylor Cafe, Molesworth St., Thorndon." },
      { text: "Hare: GATECRASHER" },
      { text: "Map: https://maps.app.goo.gl/gAyPedAcE4ibedU49", firstHref: "https://maps.app.goo.gl/gAyPedAcE4ibedU49" },
      { text: "" }, // <br> separator
      { text: "12/05/2026" },
      { text: "Venue: The Cutting Sports Cafe, 32 Miramar Avenue, Miramar" },
      { text: "Hare: Hey Baby" },
      { text: "Map:", firstHref: "https://maps.app.goo.gl/fFAQ9tVgaTAj97qm6" },
    ]);
    expect(rows.length).toBe(2);
    expect(rows[0]).toEqual({
      date: "2026-05-05",
      venue: "Chapman Taylor Cafe, Molesworth St., Thorndon.",
      hare: "GATECRASHER",
      mapUrl: "https://maps.app.goo.gl/gAyPedAcE4ibedU49",
    });
    expect(rows[1].date).toBe("2026-05-12");
    expect(rows[1].mapUrl).toBe("https://maps.app.goo.gl/fFAQ9tVgaTAj97qm6");
  });

  it("normalises TBA/Hare Required placeholders to undefined", () => {
    const rows = parseGeriatrixParagraphs([
      { text: "19/05/2026" },
      { text: "Venue: TBA" },
      { text: "Hare: Hare Required" },
      { text: "Map:" },
    ]);
    expect(rows.length).toBe(1);
    expect(rows[0].date).toBe("2026-05-19");
    expect(rows[0].venue).toBeUndefined();
    expect(rows[0].hare).toBeUndefined();
    expect(rows[0].mapUrl).toBeUndefined();
  });

  it("ignores label-shaped paragraphs that arrive before any date anchor", () => {
    const rows = parseGeriatrixParagraphs([
      { text: "Venue: orphan" },
      { text: "Hare: orphan" },
      { text: "05/05/2026" },
      { text: "Venue: real" },
    ]);
    expect(rows.length).toBe(1);
    expect(rows[0].venue).toBe("real");
  });

  it("returns empty when no date paragraphs are present", () => {
    expect(parseGeriatrixParagraphs([{ text: "Just newsletter prose, no dates." }])).toEqual([]);
  });
});

describe("GeriatrixH3Adapter.fetch", () => {
  const FIXTURE = `<!DOCTYPE html><html><body>
    <div class="richtext-editor">
      <p><span>05/05/2026</span></p>
      <p>Venue: Chapman Taylor Cafe, Molesworth St., Thorndon.</p>
      <p>Hare: GATECRASHER</p>
      <p>Map:&nbsp;<a href="https://maps.app.goo.gl/gAyPedAcE4ibedU49">https://maps.app.goo.gl/gAyPedAcE4ibedU49</a></p>
      <p><br></p>
      <p><span>12/05/2026</span></p>
      <p>Venue: The Cutting Sports Cafe, 32 Miramar Avenue, Miramar</p>
      <p>Hare: Hey Baby</p>
      <p>Map:&nbsp;<a href="https://maps.app.goo.gl/fFAQ9tVgaTAj97qm6">https://maps.app.goo.gl/fFAQ9tVgaTAj97qm6</a></p>
    </div>
  </body></html>`;

  it("parses two future runs from the richtext editor", async () => {
    mockedBrowserRender.mockResolvedValue(FIXTURE);
    const adapter = new GeriatrixH3Adapter();
    const result = await adapter.fetch(makeSource(), { days: 365 });
    expect(result.errors).toEqual([]);
    expect(result.events.length).toBe(2);
    expect(result.events[0].date).toBe("2026-05-05");
    expect(result.events[0].location).toBe("Chapman Taylor Cafe, Molesworth St., Thorndon.");
    expect(result.events[0].hares).toBe("GATECRASHER");
    expect(result.events[0].locationUrl).toBe("https://maps.app.goo.gl/gAyPedAcE4ibedU49");
    expect(result.events[1].hares).toBe("Hey Baby");
  });

  it("returns the fetch failure when browserRender errors", async () => {
    mockedBrowserRender.mockRejectedValueOnce(new Error("502 challenge"));
    const adapter = new GeriatrixH3Adapter();
    const result = await adapter.fetch(makeSource(), { days: 180 });
    expect(result.events).toEqual([]);
    expect(result.errors[0]).toMatch(/Browser render failed/);
  });

  it("fails closed when the richtext-editor container is absent", async () => {
    // Render succeeded but the CKEditor block is missing. Surface as error
    // so reconcile doesn't cancel live events on a clean-but-empty scrape.
    mockedBrowserRender.mockResolvedValue('<!DOCTYPE html><html><body><div class="cms-nav-link"></div><p>Maintenance window</p></body></html>');
    const adapter = new GeriatrixH3Adapter();
    const result = await adapter.fetch(makeSource(), { days: 180 });
    expect(result.events).toEqual([]);
    expect(result.errors[0]).toMatch(/\.richtext-editor container not found/);
  });
});
