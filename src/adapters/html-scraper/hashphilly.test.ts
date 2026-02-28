import { parsePhillyDate, HashPhillyAdapter } from "./hashphilly";

describe("parsePhillyDate", () => {
  it("parses full month name: 'February 14, 2026'", () => {
    expect(parsePhillyDate("February 14, 2026")).toBe("2026-02-14");
  });

  it("parses abbreviated month: 'Feb 14, 2026'", () => {
    expect(parsePhillyDate("Feb 14, 2026")).toBe("2026-02-14");
  });

  it("parses with day prefix: 'Sat, Feb 14, 2026'", () => {
    expect(parsePhillyDate("Sat, Feb 14, 2026")).toBe("2026-02-14");
  });

  it("returns null for invalid month name", () => {
    expect(parsePhillyDate("Flob 14, 2026")).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(parsePhillyDate("")).toBeNull();
  });

  it("handles single-digit day", () => {
    expect(parsePhillyDate("March 5, 2026")).toBe("2026-03-05");
  });
});

const SAMPLE_HTML = `
<html><body>
<div>
<p>Trail Number: 1234</p>
<p>Date: Sat, Feb 14, 2026</p>
<p>Time: 3:00 PM Hash Standard Time</p>
<p>Location: Love Park, Philadelphia PA</p>
</div>
</body></html>
`;

const SAMPLE_HTML_NO_DATE = `
<html><body>
<div>
<p>Trail Number: 1234</p>
<p>Location: Love Park, Philadelphia PA</p>
</div>
</body></html>
`;

describe("HashPhillyAdapter.fetch", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("parses sample HTML with all fields", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(SAMPLE_HTML, { status: 200 }),
    );

    const adapter = new HashPhillyAdapter();
    const result = await adapter.fetch({
      id: "test",
      url: "https://hashphilly.com/nexthash/",
    } as never);

    expect(result.events).toHaveLength(1);
    expect(result.errors).toHaveLength(0);

    const event = result.events[0];
    expect(event.kennelTag).toBe("Philly H3");
    expect(event.date).toBe("2026-02-14");
    expect(event.runNumber).toBe(1234);
    expect(event.startTime).toBe("15:00");
    expect(event.location).toBe("Love Park, Philadelphia PA");
    expect(event.locationUrl).toBeDefined();
    expect(result.structureHash).toBeDefined();
  });

  it("returns error when no date field found", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(SAMPLE_HTML_NO_DATE, { status: 200 }),
    );

    const adapter = new HashPhillyAdapter();
    const result = await adapter.fetch({
      id: "test",
      url: "https://hashphilly.com/nexthash/",
    } as never);

    expect(result.events).toHaveLength(0);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]).toContain("date");
  });

  it("returns error on network failure", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(
      new Error("Network error"),
    );

    const adapter = new HashPhillyAdapter();
    const result = await adapter.fetch({
      id: "test",
      url: "https://hashphilly.com/nexthash/",
    } as never);

    expect(result.events).toHaveLength(0);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errorDetails?.fetch).toHaveLength(1);
  });
});
