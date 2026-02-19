import { describe, it, expect, vi, beforeEach } from "vitest";
import { parseOfh3Date, parseOfh3Body } from "./ofh3";
import { OFH3Adapter } from "./ofh3";

describe("parseOfh3Date", () => {
  it("parses 'Saturday, March 14, 2026'", () => {
    expect(parseOfh3Date("Saturday, March 14, 2026")).toBe("2026-03-14");
  });

  it("parses 'February 8, 2026'", () => {
    expect(parseOfh3Date("February 8, 2026")).toBe("2026-02-08");
  });

  it("parses date with ordinal suffix", () => {
    expect(parseOfh3Date("Saturday, January 11th, 2026")).toBe("2026-01-11");
  });

  it("parses abbreviated month", () => {
    expect(parseOfh3Date("Sat, Dec 13, 2025")).toBe("2025-12-13");
  });

  it("returns null for invalid input", () => {
    expect(parseOfh3Date("TBA")).toBeNull();
    expect(parseOfh3Date("no date here")).toBeNull();
  });
});

describe("parseOfh3Body", () => {
  it("extracts all labeled fields", () => {
    const text = [
      "Hares: Herpicles",
      "When: Saturday, March 14, 2026",
      "Cost: $5, virgins free",
      "Where: Blue Heron Elementary School",
      "Trail Type: A-A",
      "Distances: 3ish",
      "Shiggy rating (1-10): 5",
      "On-After: Brewer's Alley",
    ].join("\n");

    const result = parseOfh3Body(text);
    expect(result.date).toBe("2026-03-14");
    expect(result.hares).toBe("Herpicles");
    expect(result.cost).toBe("$5, virgins free");
    expect(result.location).toBe("Blue Heron Elementary School");
    expect(result.trailType).toBe("A-A");
    expect(result.distances).toBe("3ish");
    expect(result.shiggyRating).toBe("5");
    expect(result.onAfter).toBe("Brewer's Alley");
  });

  it("extracts hares with ampersand", () => {
    const text = "Hares: Livin' Lolita Loca & Special Ed Forces\nWhen: Saturday, February 8, 2026";
    const result = parseOfh3Body(text);
    expect(result.hares).toBe("Livin' Lolita Loca & Special Ed Forces");
  });

  it("handles TBA fields gracefully", () => {
    const text = "When: Saturday, April 11, 2026\nWhere: TBA\nTrail Type: TBA";
    const result = parseOfh3Body(text);
    expect(result.date).toBe("2026-04-11");
    expect(result.location).toBe("TBA");
    expect(result.trailType).toBe("TBA");
  });

  it("returns undefined for missing fields", () => {
    const text = "When: Saturday, March 14, 2026";
    const result = parseOfh3Body(text);
    expect(result.date).toBe("2026-03-14");
    expect(result.hares).toBeUndefined();
    expect(result.location).toBeUndefined();
  });
});

describe("OFH3Adapter integration", () => {
  const SAMPLE_HTML = `
<!DOCTYPE html>
<html>
<body>
  <div class="post-outer">
    <h3 class="post-title">
      <a href="https://www.ofh3.com/2026/03/are-you-feelin-lucky.html">Are you feelin' lucky?</a>
    </h3>
    <div class="post-body">
      <p><b>Hares:</b> Herpicles</p>
      <p><b>When:</b> Saturday, March 14, 2026</p>
      <p><b>Cost:</b> $5, virgins free</p>
      <p><b>Where:</b> Blue Heron Elementary School</p>
      <p><b>Trail Type:</b> A-A</p>
      <p><b>Distances:</b> 3ish</p>
      <p><b>Shiggy rating (1-10):</b> 5</p>
      <p><b>On-After:</b> Brewer's Alley</p>
    </div>
  </div>
  <div class="post-outer">
    <h3 class="post-title">
      <a href="https://www.ofh3.com/2026/02/ready-to-shake-off-snow.html">Ready to shake off the snow?</a>
    </h3>
    <div class="post-body">
      <p><b>Hares:</b> Livin' Lolita Loca &amp; Special Ed Forces</p>
      <p><b>When:</b> Saturday, February 8, 2026</p>
      <p><b>Cost:</b> $5, virgins free</p>
      <p><b>Where:</b> TBA</p>
      <p><b>Trail Type:</b> TBA</p>
      <p><b>Distances:</b> TBA</p>
      <p><b>Shiggy rating (1-10):</b> hmmm depends on snow</p>
      <p><b>On-After:</b> TBA</p>
    </div>
  </div>
</body>
</html>`;

  let adapter: OFH3Adapter;

  beforeEach(() => {
    adapter = new OFH3Adapter();
    vi.stubGlobal("fetch", vi.fn());
  });

  it("parses multiple trail posts from Blogger page", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(SAMPLE_HTML, { status: 200 }) as never
    );

    const result = await adapter.fetch({
      id: "test-ofh3",
      url: "https://www.ofh3.com/",
    } as never);

    expect(result.errors).toHaveLength(0);
    expect(result.events).toHaveLength(2);

    // First event (March)
    expect(result.events[0]).toMatchObject({
      date: "2026-03-14",
      kennelTag: "OFH3",
      title: "Are you feelin' lucky?",
      hares: "Herpicles",
      location: "Blue Heron Elementary School",
      startTime: "11:00",
      sourceUrl: "https://www.ofh3.com/2026/03/are-you-feelin-lucky.html",
    });
    expect(result.events[0].description).toContain("Trail Type: A-A");
    expect(result.events[0].description).toContain("Cost: $5, virgins free");

    // Second event (February) — TBA location should be excluded
    expect(result.events[1]).toMatchObject({
      date: "2026-02-08",
      kennelTag: "OFH3",
      title: "Ready to shake off the snow?",
      hares: "Livin' Lolita Loca & Special Ed Forces",
      startTime: "11:00",
    });
    expect(result.events[1].location).toBeUndefined();
    expect(result.events[1].locationUrl).toBeUndefined();
  });

  it("returns fetch error on HTTP failure", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response("Forbidden", { status: 403 }) as never
    );

    const result = await adapter.fetch({
      id: "test-ofh3",
      url: "https://www.ofh3.com/",
    } as never);

    expect(result.events).toHaveLength(0);
    expect(result.errors).toHaveLength(1);
  });
});
