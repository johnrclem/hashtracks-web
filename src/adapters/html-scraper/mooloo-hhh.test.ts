import { describe, it, expect, vi } from "vitest";
import type { Source } from "@/generated/prisma/client";
import { MoolooHhhAdapter, parseMoolooRunLine } from "./mooloo-hhh";

vi.mock("@/lib/browser-render", () => ({ browserRender: vi.fn() }));
vi.mock("@/pipeline/structure-hash", () => ({
  generateStructureHash: vi.fn(() => "mock-hash-mooloo"),
}));

const { browserRender } = await import("@/lib/browser-render");
const mockedBrowserRender = vi.mocked(browserRender);

function makeSource(overrides: Partial<Source> = {}): Source {
  return {
    id: "src-mooloo",
    name: "Mooloo HHH UpCumming Runs",
    url: "https://www.sporty.co.nz/mooloohhh/UpCumming-Runs",
    type: "HTML_SCRAPER",
    trustLevel: 5,
    scrapeFreq: "daily",
    scrapeDays: 180,
    config: { kennelTag: "mooloo-h3" },
    isActive: true,
    lastScrapedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as Source;
}

describe("parseMoolooRunLine", () => {
  const opts = { sourceUrl: "https://www.sporty.co.nz/mooloohhh/UpCumming-Runs", kennelTag: "mooloo-h3" };

  it("parses the canonical 'DD Mon YYYY RUN# NNNN <body>' format", () => {
    const ev = parseMoolooRunLine(
      "25 May 2026 RUN# 1886 Tittannic's Trail from ReefUnder and Shunter's 8 Joffre St. 6PM.",
      opts,
    );
    expect(ev).not.toBeNull();
    expect(ev!.date).toBe("2026-05-25");
    expect(ev!.runNumber).toBe(1886);
    expect(ev!.startTime).toBe("18:00");
    expect(ev!.description).toContain("Tittannic's Trail");
    expect(ev!.kennelTags).toEqual(["mooloo-h3"]);
  });

  it("tolerates RUN# with no space + spelling variants", () => {
    const ev = parseMoolooRunLine("1 Jun 2026 RUN#1887 At ToeTruck's 6:30pm", opts);
    expect(ev).not.toBeNull();
    expect(ev!.runNumber).toBe(1887);
    expect(ev!.startTime).toBe("18:30");
  });

  it("returns null for non-run prose lines", () => {
    expect(parseMoolooRunLine("Next run, your place?", opts)).toBeNull();
    expect(parseMoolooRunLine("Hosted by the combined Wellington Hash clubs", opts)).toBeNull();
    expect(parseMoolooRunLine("", opts)).toBeNull();
  });
});

describe("MoolooHhhAdapter.fetch", () => {
  const FIXTURE = `<!DOCTYPE html><html><body>
    <div class="panel-body-text">
      <p>UPCUMMING RUNS for Mooloo HHH roughly every 2nd Monday or whenever you feel like setting a trail..</p>
      <p>Upcumming Runs 2026</p>
      <p><b>25 May 2026 RUN# 1886 Tittannic's Trail from ReefUnder and Shunter's 8 Joffre St. 6PM.</b></p>
      <p>...</p>
      <p>Next run , your place?</p>
      <p>NZ Nash Hash 2027 details</p>
    </div>
  </body></html>`;

  it("extracts exactly the run-line paragraphs and skips prose", async () => {
    mockedBrowserRender.mockResolvedValue(FIXTURE);
    const adapter = new MoolooHhhAdapter();
    const result = await adapter.fetch(makeSource(), { days: 365 });
    expect(result.errors).toEqual([]);
    expect(result.events.length).toBe(1);
    expect(result.events[0].date).toBe("2026-05-25");
    expect(result.events[0].runNumber).toBe(1886);
    expect(result.events[0].startTime).toBe("18:00");
  });

  it("dedupes run lines that appear in both <p> and nested <p><b>", async () => {
    // Sporty pages frequently mirror the same run line at two DOM positions
    // (`<p>...</p>` and `<p><b>...</b></p>`); $("p").toArray() yields both,
    // and the parser must collapse them by (date, runNumber).
    const dupedFixture = `<!DOCTYPE html><html><body>
      <div class="panel-body-text">
        <p>25 May 2026 RUN# 1886 Tittannic's Trail 8 Joffre St. 6PM.</p>
        <p><b>25 May 2026 RUN# 1886 Tittannic's Trail 8 Joffre St. 6PM.</b></p>
      </div>
    </body></html>`;
    mockedBrowserRender.mockResolvedValue(dupedFixture);
    const adapter = new MoolooHhhAdapter();
    const result = await adapter.fetch(makeSource(), { days: 365 });
    expect(result.events.length).toBe(1);
    expect(result.events[0].runNumber).toBe(1886);
  });

  it("returns the fetch failure when browserRender errors", async () => {
    mockedBrowserRender.mockRejectedValueOnce(new Error("502 challenge"));
    const adapter = new MoolooHhhAdapter();
    const result = await adapter.fetch(makeSource(), { days: 180 });
    expect(result.events).toEqual([]);
    expect(result.errors[0]).toMatch(/Browser render failed/);
  });

  it("fails closed when the .panel-body-text container is absent", async () => {
    // Render succeeded but the CMS panel is missing. Surface as error so
    // reconcile doesn't cancel live events on a clean-but-empty scrape.
    mockedBrowserRender.mockResolvedValue('<!DOCTYPE html><html><body><div class="cms-nav-link"></div><p>Maintenance window</p></body></html>');
    const adapter = new MoolooHhhAdapter();
    const result = await adapter.fetch(makeSource(), { days: 180 });
    expect(result.events).toEqual([]);
    expect(result.errors[0]).toMatch(/\.panel-body-text container not found/);
  });
});
