import { describe, it, expect, vi, afterEach } from "vitest";
import { parseSWH3Title, parseSWH3Body, cleanTrailingPunct, SWH3Adapter } from "./swh3";
import { safeFetch } from "../safe-fetch";
import type { Source } from "@/generated/prisma/client";

vi.mock("../safe-fetch", () => ({ safeFetch: vi.fn() }));

describe("cleanTrailingPunct (#1647)", () => {
  it("strips trailing dash from 'SWH3 #1792-'", () => {
    expect(cleanTrailingPunct("SWH3 #1792-")).toBe("SWH3 #1792");
  });

  it("strips trailing comma + spaces", () => {
    expect(cleanTrailingPunct("SWH3 #1782, ")).toBe("SWH3 #1782");
  });

  it("strips trailing colon", () => {
    expect(cleanTrailingPunct("Trail Name:")).toBe("Trail Name");
  });

  it("returns undefined for empty string", () => {
    expect(cleanTrailingPunct("")).toBeUndefined();
  });

  it("returns undefined when input is only punctuation", () => {
    expect(cleanTrailingPunct(" - ")).toBeUndefined();
  });

  it("preserves clean titles unchanged", () => {
    expect(cleanTrailingPunct("Crispy Creamer Invasion")).toBe("Crispy Creamer Invasion");
  });
});

describe("parseSWH3Title", () => {
  it("extracts run number and date from standard format", () => {
    const result = parseSWH3Title("SWH3 #1782- Saturday, March 14", "2026-03-09T17:00:00");
    expect(result.runNumber).toBe(1782);
    expect(result.date).toBe("2026-03-14");
  });

  it("handles comma separator", () => {
    const result = parseSWH3Title("SWH3 #1781, Saturday, March 7", "2026-03-09T17:00:00");
    expect(result.runNumber).toBe(1781);
    expect(result.date).toBe("2026-03-07");
  });

  it("handles abbreviated month with period", () => {
    const result = parseSWH3Title("SWH3 #1780, Saturday, Feb. 28", "2026-03-09T17:00:00");
    expect(result.runNumber).toBe(1780);
    expect(result.date).toBe("2026-02-28");
  });

  it("handles 'Trail' in title", () => {
    const result = parseSWH3Title("SWH3 Trail #1779, Sunday, Feb. 22", "2026-03-09T17:00:00");
    expect(result.runNumber).toBe(1779);
    expect(result.date).toBe("2026-02-22");
  });

  it("handles uppercase day name", () => {
    const result = parseSWH3Title("SWH3 #1774, SUNDAY Jan. 18", "2026-03-09T17:00:00");
    expect(result.runNumber).toBe(1774);
    expect(result.date).toBe("2026-01-18");
  });

  it("returns undefined date when no date in title", () => {
    const result = parseSWH3Title("SWH3 #1782 Special Event", "2026-03-09T17:00:00");
    expect(result.runNumber).toBe(1782);
    expect(result.date).toBeUndefined();
  });

  it("returns undefined runNumber when no # in title", () => {
    const result = parseSWH3Title("SWH3 Saturday, March 14", "2026-03-09T17:00:00");
    expect(result.runNumber).toBeUndefined();
  });
});

describe("parseSWH3Body", () => {
  it("extracts fields from <strong> labeled pattern", () => {
    const html = `
      <p class="wp-block-paragraph"><strong>What's da Word?</strong> Durham Trail with Creek Week Prelube!</p>
      <p class="wp-block-paragraph"><strong>Time: </strong>Meet at 2:00 for a 2:30 start for the hash</p>
      <p class="wp-block-paragraph"><strong>Where:</strong> Park at 2510 Meridian Parkway, Durham for the hash</p>
      <p class="wp-block-paragraph"><strong>Hares: </strong>Comfort and Tight Lips</p>
    `;
    const result = parseSWH3Body(html);
    expect(result.startTime).toBe("14:30");
    expect(result.location).toBe("Park at 2510 Meridian Parkway, Durham");
    expect(result.hares).toBe("Comfort and Tight Lips");
    expect(result.trailName).toBe("Durham Trail with Creek Week Prelube!");
  });

  it("extracts fields from plain text pattern", () => {
    const html = `
      <p class="wp-block-paragraph">What's da Word? Crispy Creamer Invasion: Dough or Die</p>
      <p class="wp-block-paragraph">Where: Quarry at Grant Park in Winston Salem</p>
      <p class="wp-block-paragraph">When: 1 PM</p>
    `;
    const result = parseSWH3Body(html);
    expect(result.startTime).toBe("13:00");
    expect(result.location).toBe("Quarry at Grant Park in Winston Salem");
    expect(result.trailName).toBe("Crispy Creamer Invasion: Dough or Die");
  });

  it("extracts hares with 'The Hares:' label", () => {
    const html = `
      <p class="wp-block-paragraph">When: Feb 28th, 2026 @ 2pm</p>
      <p class="wp-block-paragraph">Where: Meet @ Fred Fletcher Park, 820 Clay Street, Raleigh</p>
      <p class="wp-block-paragraph">The Hares: Bukkake and The Beast, Pukey McPuke Face</p>
    `;
    const result = parseSWH3Body(html);
    expect(result.hares).toBe("Bukkake and The Beast, Pukey McPuke Face");
    expect(result.location).toContain("Fred Fletcher Park");
  });

  it("extracts on-after", () => {
    const html = `
      <p>Where: Some Park</p>
      <p>Hares: Runner McRunface</p>
      <p>On-After: Lynwood Grill</p>
    `;
    const result = parseSWH3Body(html);
    expect(result.onAfter).toBe("Lynwood Grill");
  });

  it("handles Hare(s): variant", () => {
    const html = `
      <p>Hare(s): Dicktaphone and mystery co-hare</p>
      <p>Time: 2 pm gather, 2:30 pack off!</p>
    `;
    const result = parseSWH3Body(html);
    expect(result.hares).toBe("Dicktaphone and mystery co-hare");
    expect(result.startTime).toBe("14:30");
  });

  it("strips jp-relatedposts section", () => {
    const html = `
      <p>Hares: Good Hare</p>
      <div id="jp-relatedposts" class="jp-relatedposts">
        <p>SWH3 #1700- Saturday, January 10</p>
      </div>
    `;
    const result = parseSWH3Body(html);
    expect(result.hares).toBe("Good Hare");
  });

  it("returns undefined for missing fields", () => {
    const html = `<p>Just some random text without labels</p>`;
    const result = parseSWH3Body(html);
    expect(result.startTime).toBeUndefined();
    expect(result.location).toBeUndefined();
    expect(result.hares).toBeUndefined();
  });

  it("captures the raw When: text as whenText (#2667 title-date fallback source)", () => {
    const html = `<p>When: Saturday, April 11th</p><p>Meet: Noon, Pack off at 12:30</p>`;
    const result = parseSWH3Body(html);
    expect(result.whenText).toBe("Saturday, April 11th");
  });
});

describe("SWH3Adapter.fetch — date fallback (#2667)", () => {
  afterEach(() => vi.mocked(safeFetch).mockReset());

  it("falls back to the body's When: field when the title has no date suffix", async () => {
    // Real shape of https://swh3.wordpress.com/2026/04/07/swh3-trail-1786/ —
    // title is bare "SWH3 Trail #1786", no date; only the body's "When:"
    // field carries the trail date. Previously this failed the whole post.
    const posts = [
      {
        id: 3798,
        date: "2026-04-07T14:34:53",
        link: "https://swh3.wordpress.com/2026/04/07/swh3-trail-1786/",
        title: { rendered: "SWH3 Trail #1786" },
        content: {
          rendered:
            "<p>What's da Word: Karen Trail: Volume VII</p>" +
            "<p>Hares: Quick to Shoot and 50 Shades of Vanilla</p>" +
            "<p>When: Saturday, April 11th</p>" +
            "<p>Meet: Noon, Pack off at 12:30</p>" +
            "<p>Where: 408 Sarazen Drive, Clayton</p>",
        },
      },
    ];
    vi.mocked(safeFetch).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => posts,
    } as unknown as Response);

    const result = await new SWH3Adapter().fetch({} as Source);

    expect(result.errors).toEqual([]);
    expect(result.events).toHaveLength(1);
    expect(result.events[0].date).toBe("2026-04-11");
    expect(result.events[0].runNumber).toBe(1786);
  });

  it("still fails loud when neither the title nor the When: field has a date", async () => {
    const posts = [
      {
        id: 1,
        date: "2026-04-07T14:34:53",
        link: "https://swh3.wordpress.com/x/",
        title: { rendered: "SWH3 Trail #9999" },
        content: { rendered: "<p>Hares: Nobody</p>" },
      },
    ];
    vi.mocked(safeFetch).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => posts,
    } as unknown as Response);

    const result = await new SWH3Adapter().fetch({} as Source);

    expect(result.events).toHaveLength(0);
    expect(result.errors[0]).toContain("No date found in title");
  });
});
