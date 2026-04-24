import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Source } from "@/generated/prisma/client";
import { parseCalendarLink, BurlingtonHashAdapter } from "./burlington-hash";

// Mock browserRender
vi.mock("@/lib/browser-render", () => ({
  browserRender: vi.fn(),
}));

// Mock structure-hash
vi.mock("@/pipeline/structure-hash", () => ({
  generateStructureHash: vi.fn(() => "mock-hash-burly123"),
}));

const { browserRender } = await import("@/lib/browser-render");
const mockedBrowserRender = vi.mocked(browserRender);

const SOURCE_URL = "https://www.burlingtonh3.com/hareline";

function makeSource(overrides?: Partial<Source>): Source {
  return {
    id: "src-burlington",
    name: "Burlington H3 Website Hareline",
    url: "https://www.burlingtonh3.com/hareline",
    type: "HTML_SCRAPER",
    trustLevel: 6,
    scrapeFreq: "weekly",
    scrapeDays: 365,
    config: null,
    isActive: true,
    lastScrapeAt: null,
    lastScrapeStatus: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    lastStructureHash: null,
    ...overrides,
  } as Source;
}

describe("parseCalendarLink", () => {
  it("parses standard event with title, run number, time, and location", () => {
    const href =
      "https://calendar.google.com/calendar/render?action=TEMPLATE" +
      "&text=BTVH3+%23846%3A+Season+Premier" +
      "&dates=20260401T223000Z/20260401T233000Z" +
      "&details=Hares%3A+Trailblazer+%26+MapQuest" +
      "&location=City+Hall+Park%2C+Burlington+VT";

    const result = parseCalendarLink(href, SOURCE_URL);

    expect(result).toMatchObject({
      date: "2026-04-01",
      kennelTag: "burlyh3",
      runNumber: 846,
      title: "Season Premier",
      hares: "Trailblazer & MapQuest",
      location: "City Hall Park, Burlington VT",
      sourceUrl: SOURCE_URL,
    });
    expect(result?.startTime).toBeDefined();
  });

  it("parses event with missing location", () => {
    const href =
      "https://calendar.google.com/calendar/render?action=TEMPLATE" +
      "&text=BTVH3+%23847%3A+Mud+Season+Hash" +
      "&dates=20260415T223000Z/20260415T233000Z" +
      "&details=Hares%3A+Muddy+Buddy";

    const result = parseCalendarLink(href, SOURCE_URL);

    expect(result).toMatchObject({
      kennelTag: "burlyh3",
      runNumber: 847,
      title: "Mud Season Hash",
      hares: "Muddy Buddy",
    });
    expect(result?.location).toBeUndefined();
  });

  it("parses special event without run number", () => {
    const href =
      "https://calendar.google.com/calendar/render?action=TEMPLATE" +
      "&text=Annual+Invihash+2026" +
      "&dates=20260704T160000Z/20260704T200000Z" +
      "&details=Come+join+us!" +
      "&location=Waterfront+Park";

    const result = parseCalendarLink(href, SOURCE_URL);

    expect(result).toMatchObject({
      kennelTag: "burlyh3",
      title: "Annual Invihash 2026",
      location: "Waterfront Park",
    });
    expect(result?.runNumber).toBeUndefined();
    expect(result?.hares).toBeUndefined();
  });

  it("handles URL-encoded special characters in details", () => {
    const href =
      "https://calendar.google.com/calendar/render?action=TEMPLATE" +
      "&text=BTVH3+%23848%3A+Pi+Day+Hash" +
      "&dates=20260314T223000Z/20260314T233000Z" +
      "&details=Hares%3A+%C3%89clair+%26+Cr%C3%A8me+Br%C3%BBl%C3%A9e%0ACost%3A+%246.90" +
      "&location=Church+Street";

    const result = parseCalendarLink(href, SOURCE_URL);

    expect(result).toMatchObject({
      runNumber: 848,
      title: "Pi Day Hash",
      hares: "Éclair & Crème Brûlée",
      location: "Church Street",
    });
  });

  it("returns null for non-calendar URLs", () => {
    expect(parseCalendarLink("https://example.com", SOURCE_URL)).toBeNull();
  });

  it("returns null for missing text param", () => {
    const href = "https://calendar.google.com/calendar/render?dates=20260401T220000Z/20260401T230000Z";
    expect(parseCalendarLink(href, SOURCE_URL)).toBeNull();
  });

  it("returns null for missing dates param", () => {
    const href = "https://calendar.google.com/calendar/render?text=Test+Event";
    expect(parseCalendarLink(href, SOURCE_URL)).toBeNull();
  });

  it("returns null for invalid URL", () => {
    expect(parseCalendarLink("not a url", SOURCE_URL)).toBeNull();
  });

  it("strips 'Location:' from hares field", () => {
    const href =
      "https://calendar.google.com/calendar/render?action=TEMPLATE" +
      "&text=BTVH3+%23849%3A+Spring+Hash" +
      "&dates=20260501T223000Z/20260501T233000Z" +
      "&details=Hares%3A+Penis+ColadaLocation%3A+Probably+Bolton";

    const result = parseCalendarLink(href, SOURCE_URL);

    expect(result?.hares).toBe("Penis Colada");
  });

  it("extracts run number when title uses 'ft.' instead of ':' (#889)", () => {
    // Source-observed title: "BTVH3 #851 ft. Not Just the Tip and Skidmark"
    const href =
      "https://calendar.google.com/calendar/render?action=TEMPLATE" +
      "&text=BTVH3+%23851+ft.+Not+Just+the+Tip+and+Skidmark" +
      "&dates=20260429T223000Z/20260429T233000Z" +
      "&details=Hares%3A+Skidmark";

    const result = parseCalendarLink(href, SOURCE_URL);
    expect(result?.runNumber).toBe(851);
    // Preserve the "ft." prefix verbatim — reporter prefers this over
    // stripping since it's a meaningful crediting convention.
    expect(result?.title).toBe("ft. Not Just the Tip and Skidmark");
  });

  it("extracts run number when title uses 'feat.' instead of ':' (#889)", () => {
    const href =
      "https://calendar.google.com/calendar/render?action=TEMPLATE" +
      "&text=BTVH3+%23852+feat.+Mystery+Guest" +
      "&dates=20260506T223000Z/20260506T233000Z" +
      "&details=Hares%3A+Mystery";

    const result = parseCalendarLink(href, SOURCE_URL);
    expect(result?.runNumber).toBe(852);
    expect(result?.title).toBe("feat. Mystery Guest");
  });

  it("extracts run number from bare '#NNN' title with no subtitle (#889)", () => {
    const href =
      "https://calendar.google.com/calendar/render?action=TEMPLATE" +
      "&text=BTVH3+%23853" +
      "&dates=20260513T223000Z/20260513T233000Z" +
      "&details=Hares%3A+TBD";

    const result = parseCalendarLink(href, SOURCE_URL);
    expect(result?.runNumber).toBe(853);
    expect(result?.title).toBe("BurlyH3 #853");
  });

  it("extracts cost and description from Wix <br>-separated details payload (#887)", () => {
    // Live Girth Day #850 payload (Wix uses <br> between labeled fields and
    // before the free-form prose). URL-encoded: "<br>" → %3Cbr%3E, "$" → %24.
    const details =
      "%3Cb%3EHares%3A%3C%2Fb%3E+20+Gallons+of+Piss+%26+Redtail+Swallows" +
      "%3Cbr%3E%3Cb%3ELength%3A+%3C%2Fb%3E2.69" +
      "%3Cbr%3E%3Cb%3EShiggy+Scale%3A+%3C%2Fb%3E4" +
      "%3Cbr%3E%3Cb%3ECost%3A%3C%2Fb%3E+%246.90" +
      "%3Cbr%3E%3Cbr%3ESince+it%27s+Earth+day%2C+we%27re+honoring+the+planet+by+stuffing+as+many+hashers+as+we+can+into+Mother+Nature%27s+sweet+Sunny+Hollow.";
    const href =
      "https://calendar.google.com/calendar/render?action=TEMPLATE" +
      "&text=BTVH3+%23850%3A+Girth+Day" +
      "&dates=20260422T223000Z/20260422T233000Z" +
      `&details=${details}`;

    const result = parseCalendarLink(href, SOURCE_URL);
    expect(result?.runNumber).toBe(850);
    expect(result?.hares).toBe("20 Gallons of Piss & Redtail Swallows");
    expect(result?.cost).toBe("$6.90");
    expect(result?.description).toContain("Earth day");
    expect(result?.description).toContain("Sunny Hollow");
  });

  it("leaves cost undefined when the details payload has no 'Cost:' marker (#887)", () => {
    const href =
      "https://calendar.google.com/calendar/render?action=TEMPLATE" +
      "&text=BTVH3+%23860%3A+No+Cost+Listed" +
      "&dates=20260701T223000Z/20260701T233000Z" +
      "&details=Hares%3A+Mystery";
    const result = parseCalendarLink(href, SOURCE_URL);
    expect(result?.cost).toBeUndefined();
  });

  it("leaves description undefined when details payload has only labeled fields (#887)", () => {
    const href =
      "https://calendar.google.com/calendar/render?action=TEMPLATE" +
      "&text=BTVH3+%23861%3A+Labels+Only" +
      "&dates=20260708T223000Z/20260708T233000Z" +
      "&details=%3Cb%3EHares%3A%3C%2Fb%3E+X%3Cbr%3E%3Cb%3ECost%3A%3C%2Fb%3E+%246.90";
    const result = parseCalendarLink(href, SOURCE_URL);
    expect(result?.cost).toBe("$6.90");
    expect(result?.description).toBeUndefined();
  });

  it("preserves hares value containing internal <br> breaks (no field-marker truncation)", () => {
    // Defensive: if a Wix author injects a <br> inside the Hares value (e.g.
    // multi-line co-hare list), the parser must not truncate at the break.
    // Hares should keep going until the next labeled-field marker.
    const details =
      "%3Cb%3EHares%3A%3C%2Fb%3E+Alice%3Cbr%3E%26+Bob%3Cbr%3E%26+Carol" +
      "%3Cbr%3E%3Cb%3ECost%3A%3C%2Fb%3E+%245.00";
    const href =
      "https://calendar.google.com/calendar/render?action=TEMPLATE" +
      "&text=BTVH3+%23862%3A+Multi-line+Hares" +
      "&dates=20260715T223000Z/20260715T233000Z" +
      `&details=${details}`;

    const result = parseCalendarLink(href, SOURCE_URL);

    expect(result?.hares).toContain("Alice");
    expect(result?.hares).toContain("Bob");
    expect(result?.hares).toContain("Carol");
    expect(result?.cost).toBe("$5.00");
    // The continuation lines must NOT leak into description.
    expect(result?.description).toBeUndefined();
  });

  it("strips 'Length:' and 'Shiggy Scale:' trail metadata from hares field (#825)", () => {
    // BurlyH3 concatenates trail metadata inline with hares. Source-of-truth
    // content: "Hares: 20 Gallons of Piss & Redtail SwallowsLength: TBDShiggy Scale: 4"
    const href =
      "https://calendar.google.com/calendar/render?action=TEMPLATE" +
      "&text=BTVH3+%23850%3A+Shiggy+Fest" +
      "&dates=20260508T223000Z/20260508T233000Z" +
      "&details=Hares%3A+20+Gallons+of+Piss+%26+Redtail+SwallowsLength%3A+TBDShiggy+Scale%3A+4";

    const result = parseCalendarLink(href, SOURCE_URL);

    expect(result?.hares).toBe("20 Gallons of Piss & Redtail Swallows");
  });
});

describe("BurlingtonHashAdapter", () => {
  const adapter = new BurlingtonHashAdapter();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("has correct type", () => {
    expect(adapter.type).toBe("HTML_SCRAPER");
  });

  it("parses events from Google Calendar links in rendered HTML", async () => {
    const html = `
      <html><body>
        <div>
          <a href="https://calendar.google.com/calendar/render?action=TEMPLATE&text=BTVH3+%23846%3A+Season+Premier&dates=20260401T223000Z/20260401T233000Z&details=Hares%3A+Trailblazer&location=City+Hall+Park">
            Add to Calendar
          </a>
          <a href="https://calendar.google.com/calendar/render?action=TEMPLATE&text=BTVH3+%23847%3A+Mud+Run&dates=20260415T223000Z/20260415T233000Z&details=Hares%3A+Muddy&location=Waterfront">
            Add to Calendar
          </a>
        </div>
      </body></html>
    `;
    mockedBrowserRender.mockResolvedValue(html);

    const result = await adapter.fetch(makeSource());

    expect(result.events).toHaveLength(2);
    expect(result.events[0]).toMatchObject({
      kennelTag: "burlyh3",
      runNumber: 846,
      title: "Season Premier",
    });
    expect(result.events[1]).toMatchObject({
      kennelTag: "burlyh3",
      runNumber: 847,
      title: "Mud Run",
    });
  });

  it("deduplicates events by run number", async () => {
    const link =
      "https://calendar.google.com/calendar/render?action=TEMPLATE" +
      "&text=BTVH3+%23846%3A+Season+Premier" +
      "&dates=20260401T223000Z/20260401T233000Z&details=test";
    const html = `
      <html><body>
        <a href="${link}">Add to Calendar</a>
        <a href="${link}">Add to Calendar (duplicate)</a>
      </body></html>
    `;
    mockedBrowserRender.mockResolvedValue(html);

    const result = await adapter.fetch(makeSource());

    expect(result.events).toHaveLength(1);
  });

  it("returns fetch error when browserRender fails", async () => {
    mockedBrowserRender.mockRejectedValue(
      new Error("Browser render error (502): Navigation timeout"),
    );

    const result = await adapter.fetch(makeSource());

    expect(result.events).toHaveLength(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain("Browser render failed");
  });

  it("handles page with no calendar links", async () => {
    const html = `<html><body><p>Coming soon!</p></body></html>`;
    mockedBrowserRender.mockResolvedValue(html);

    const result = await adapter.fetch(makeSource());

    expect(result.events).toHaveLength(0);
    expect(result.errors).toHaveLength(0);
  });

  it("includes structureHash and diagnosticContext", async () => {
    const html = `
      <html><body>
        <a href="https://calendar.google.com/calendar/render?action=TEMPLATE&text=BTVH3+%23846%3A+Test&dates=20260401T223000Z/20260401T233000Z&details=test">
          Add to Calendar
        </a>
      </body></html>
    `;
    mockedBrowserRender.mockResolvedValue(html);

    const result = await adapter.fetch(makeSource());

    expect(result.structureHash).toBe("mock-hash-burly123");
    expect(result.diagnosticContext).toHaveProperty("calendarLinksFound");
    expect(result.diagnosticContext).toHaveProperty("eventsParsed", 1);
    expect(result.diagnosticContext).toHaveProperty("fetchDurationMs");
  });
});
