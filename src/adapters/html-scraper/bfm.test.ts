import { parseBfmDate, BFMAdapter } from "./bfm";

describe("parseBfmDate", () => {
  it("parses M/D format with reference year", () => {
    expect(parseBfmDate("2/12", 2026)).toBe("2026-02-12");
  });

  it("parses day prefix: 'Thursday, 2/12'", () => {
    expect(parseBfmDate("Thursday, 2/12", 2026)).toBe("2026-02-12");
  });

  it("parses full M/D/YYYY format: '8/8/2026'", () => {
    // M/D/YYYY is checked first, so the explicit year is used (not referenceYear)
    expect(parseBfmDate("8/8/2026", 2025)).toBe("2026-08-08");
  });

  it("parses month name with ordinal: 'Feb 19th'", () => {
    expect(parseBfmDate("Feb 19th", 2026)).toBe("2026-02-19");
  });

  it("parses month name without ordinal: 'March 5'", () => {
    expect(parseBfmDate("March 5", 2026)).toBe("2026-03-05");
  });

  it("returns null for invalid input", () => {
    expect(parseBfmDate("no date here", 2026)).toBeNull();
    expect(parseBfmDate("", 2026)).toBeNull();
  });

  it("validates month range (1-12) and day range (1-31)", () => {
    // chrono interprets "13/1" as Jan 13 (swaps when month > 12)
    expect(parseBfmDate("13/1", 2026)).toBe("2026-01-13");
    expect(parseBfmDate("0/1", 2026)).toBeNull();
  });
});

const SAMPLE_HTML = `
<html><body>
<h2>Trail #1500: Valentine's Day Hash</h2>
<p>When: Thursday, 2/14 at 7:00 PM gather</p>
<p>Where: Central Bar, 123 Main St</p>
<p>Hares: Mudflap and Shiggy Pop</p>
<h3>Upcoming Hares</h3>
<p>Feb 21st – Speed Demon</p>
<p>March 7 – could be you</p>
</body></html>
`;

describe("BFMAdapter.fetch", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("parses sample HTML with current trail and upcoming hares", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(SAMPLE_HTML, { status: 200 }))
      .mockResolvedValueOnce(new Response("<html><body></body></html>", { status: 200 }));

    const adapter = new BFMAdapter();
    const result = await adapter.fetch({
      id: "test",
      url: "https://benfranklinmob.com",
    } as never);

    expect(result.events.length).toBeGreaterThanOrEqual(1);

    const current = result.events.find((e) => e.runNumber === 1500);
    expect(current).toBeDefined();
    expect(current!.kennelTag).toBe("BFM");
    expect(current!.hares).toBe("Mudflap and Shiggy Pop");
    expect(current!.location).toBe("Central Bar, 123 Main St");
    expect(current!.startTime).toBe("19:00");

    // Upcoming hares: Speed Demon included, "could be you" filtered
    const upcoming = result.events.filter((e) => !e.runNumber);
    expect(upcoming.some((e) => e.hares === "Speed Demon")).toBe(true);
    expect(upcoming.every((e) => !/could be you/i.test(e.hares ?? ""))).toBe(true);
  });

  it("returns error on network failure", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new Error("Network error"));

    const adapter = new BFMAdapter();
    const result = await adapter.fetch({
      id: "test",
      url: "https://benfranklinmob.com",
    } as never);

    expect(result.events).toHaveLength(0);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errorDetails?.fetch).toHaveLength(1);
  });

  it("returns error on HTTP error status", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("Forbidden", { status: 403, statusText: "Forbidden" }),
    );

    const adapter = new BFMAdapter();
    const result = await adapter.fetch({
      id: "test",
      url: "https://benfranklinmob.com",
    } as never);

    expect(result.events).toHaveLength(0);
    expect(result.errors[0]).toContain("403");
    expect(result.errorDetails?.fetch?.[0].status).toBe(403);
  });
});
