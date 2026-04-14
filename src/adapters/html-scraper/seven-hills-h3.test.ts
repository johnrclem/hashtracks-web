import { describe, it, expect, vi, afterEach } from "vitest";
import { parseSevenHillsPage, SevenHillsH3Adapter } from "./seven-hills-h3";

// Live Google Sites body text (post-HTML-strip, collapsed to single line)
// captured from sites.google.com/view/7h4/home on 2026-04-07. Field labels
// are glued together with no whitespace separators — the adapter's label
// splitter has to handle that.
const SAMPLE_BODY = "Stuff before TRAIL #2005🍻 ~🌷 🐰 Peter CottonTrail 🐰Saturday April 4, 2026 @ 2pmStart: 442 S Five Forks Road Monroe, VAHares: Frodo & SnatchBeer Meister: NoCost: $5Shiggy Level: TBDSpecial Instructions: Bring empty six pack carrier & Snack to share after!ON-ON ---/-/-/--> Trail called by Pussy Cornrows and Who stole my foreskin for April 29!!!";

const SAMPLE_HTML = `<html><body>${SAMPLE_BODY}</body></html>`;

describe("parseSevenHillsPage", () => {
  it("extracts all fields from the live page shape", () => {
    const result = parseSevenHillsPage(SAMPLE_HTML);
    expect(result).toEqual({
      runNumber: 2005,
      title: "Peter CottonTrail",
      date: expect.stringMatching(/^\d{4}-04-04$/),
      startTime: "14:00",
      hares: "Frodo & Snatch",
      location: "442 S Five Forks Road Monroe, VA",
    });
  });

  it("returns null when no TRAIL #N block is present", () => {
    const html = `<html><body>Welcome to the 7H4 home page. No trail announcement yet.</body></html>`;
    expect(parseSevenHillsPage(html)).toBeNull();
  });

  it("returns null when no date phrase follows the trail number", () => {
    const html = `<html><body>TRAIL #2006 - TBD - coming soon!</body></html>`;
    expect(parseSevenHillsPage(html)).toBeNull();
  });

  it("handles a time with explicit minutes", () => {
    const body = "TRAIL #2010 Test TrailWednesday April 8, 2026 @ 6:30 PMStart: Somewhere, VAHares: Test Hare";
    const result = parseSevenHillsPage(`<html><body>${body}</body></html>`);
    expect(result?.startTime).toBe("18:30");
  });

  it("handles missing optional fields gracefully", () => {
    const body = "TRAIL #2011 Another TrailThursday April 9, 2026 @ 6pm";
    const result = parseSevenHillsPage(`<html><body>${body}</body></html>`);
    expect(result).toMatchObject({
      runNumber: 2011,
      title: "Another Trail",
      startTime: "18:00",
      hares: undefined,
      location: undefined,
    });
  });

  it("strips emoji and decorative punctuation from the trail name", () => {
    const body = "TRAIL #2012 🎃 ~🌽~ Fall Classic 🎃Saturday October 31, 2026 @ 2pmStart: X, VA";
    const result = parseSevenHillsPage(`<html><body>${body}</body></html>`);
    expect(result?.title).toBe("Fall Classic");
  });

  it("does not bleed When: label into title (#713)", () => {
    // Source page glues fields: "TRAIL #2006 *~* Cuddle Shuttle Trail*~*When: Wednesday April 15..."
    const body = "TRAIL #2006 *~* Cuddle Shuttle Trail*~*When: Wednesday April 15, 2026 @ 6pmStart: 123 Main St, Lynchburg, VA";
    const result = parseSevenHillsPage(`<html><body>${body}</body></html>`);
    expect(result?.title).toBeDefined();
    expect(result?.title).not.toContain("When:");
    expect(result?.date).toMatch(/^\d{4}-04-15$/);
  });

  it("accepts dotted `p.m.` / `a.m.` ampm forms", () => {
    // `parse12HourTime` rejects dotted ampm, so without the dot-strip the
    // synthesized "2:00 p.m." would silently yield undefined.
    const bodyPm = "TRAIL #2013 Dotted PMFriday May 1, 2026 @ 2 p.m.Start: X, VA";
    expect(parseSevenHillsPage(`<html><body>${bodyPm}</body></html>`)?.startTime).toBe("14:00");
    const bodyAm = "TRAIL #2014 Dotted AMSaturday May 2, 2026 @ 7:30 a.m.Start: X, VA";
    expect(parseSevenHillsPage(`<html><body>${bodyAm}</body></html>`)?.startTime).toBe("07:30");
  });
});

describe("SevenHillsH3Adapter.fetch", () => {
  afterEach(() => vi.restoreAllMocks());

  const adapter = new SevenHillsH3Adapter();
  const source = {
    id: "test",
    url: "https://sites.google.com/view/7h4/home",
    config: null,
  } as unknown as Parameters<typeof adapter.fetch>[0];

  it("emits one event when the page has a parseable trail block", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(SAMPLE_HTML, { status: 200 }),
    );

    const result = await adapter.fetch(source);
    expect(result.events).toHaveLength(1);
    expect(result.events[0]).toMatchObject({
      kennelTag: "7h4",
      runNumber: 2005,
      title: "Peter CottonTrail",
      hares: "Frodo & Snatch",
      location: "442 S Five Forks Road Monroe, VA",
      startTime: "14:00",
    });
    expect(result.errors).toHaveLength(0);
  });

  it("records a parse error when the page has no trail block", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("<html><body>Nothing here</body></html>", { status: 200 }),
    );

    const result = await adapter.fetch(source);
    expect(result.events).toHaveLength(0);
    expect(result.errorDetails?.parse).toHaveLength(1);
    expect(result.errorDetails!.parse![0].error).toContain("No TRAIL");
  });

  it("surfaces fetch errors on network failure", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new Error("Network"));
    const result = await adapter.fetch(source);
    expect(result.events).toHaveLength(0);
    expect(result.errorDetails?.fetch).toHaveLength(1);
  });
});
