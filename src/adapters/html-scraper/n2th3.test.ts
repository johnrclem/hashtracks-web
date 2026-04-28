import { describe, it, expect } from "vitest";
import { parseN2th3Post } from "./n2th3";
import type { WordPressComPage } from "../wordpress-api";

function buildPost(overrides: Partial<WordPressComPage> = {}): WordPressComPage {
  return {
    ID: 1234,
    title: "Run announcement 2226 &#8211; 9 April &#8211; Cornwall Street Park",
    content: `
      <p><strong>Hare:</strong> Imbiblio</p>
      <p><strong>Time: </strong>7:00pm</p>
      <p><strong>Date:</strong> Wednesday 9th April</p>
      <p><strong>Location:</strong> Pagoda in Cornwall Street Park</p>
      <p><strong>Map:</strong> <a href="https://maps.app.goo.gl/abc123">https://maps.app.goo.gl/abc123</a></p>
      <p><strong>Hare says:</strong> Rambos and Wimps, with three splits!</p>
    `,
    URL: "https://n2th3.org/2026/04/08/run-announcement-2226/",
    date: "2026-04-08T10:00:00+08:00",
    modified: "2026-04-08T10:00:00+08:00",
    type: "post",
    slug: "run-announcement-2226",
    ...overrides,
  };
}

describe("parseN2th3Post", () => {
  it("parses a fully-populated run announcement", () => {
    const result = parseN2th3Post(buildPost());
    expect(result).not.toBeNull();
    expect(result!.date).toBe("2026-04-09");
    expect(result!.kennelTags[0]).toBe("n2th3");
    expect(result!.runNumber).toBe(2226);
    expect(result!.hares).toBe("Imbiblio");
    expect(result!.startTime).toBe("19:00");
    expect(result!.location).toBe("Pagoda in Cornwall Street Park");
    expect(result!.locationUrl).toBe("https://maps.app.goo.gl/abc123");
    expect(result!.description).toBe("Rambos and Wimps, with three splits!");
    expect(result!.sourceUrl).toBe("https://n2th3.org/2026/04/08/run-announcement-2226/");
  });

  it("falls back to title date when body date is missing", () => {
    const post = buildPost({
      content: "<p>No structured fields here.</p>",
    });
    const result = parseN2th3Post(post);
    expect(result).not.toBeNull();
    expect(result!.date).toBe("2026-04-09");
    expect(result!.runNumber).toBe(2226);
  });

  it("skips non-trail posts", () => {
    const post = buildPost({
      title: "AGM 2026 Notice",
      content: "<p>Annual general meeting details.</p>",
    });
    const result = parseN2th3Post(post);
    expect(result).toBeNull();
  });

  it("handles birthday run announcements", () => {
    const post = buildPost({
      title: "Birthday run announcement 2220 &#8211; 26 February &#8211; Kowloon Tong",
      content: `
        <p><strong>Date:</strong> Wednesday 26th February</p>
        <p><strong>Time:</strong> 7pm</p>
        <p><strong>Hare:</strong> Birthday Boy</p>
        <p><strong>Location:</strong> Kowloon Tong</p>
      `,
      date: "2026-02-25T10:00:00+08:00",
    });
    const result = parseN2th3Post(post);
    expect(result).not.toBeNull();
    expect(result!.date).toBe("2026-02-26");
    expect(result!.runNumber).toBe(2220);
    expect(result!.hares).toBe("Birthday Boy");
  });

  it("handles missing hare field", () => {
    const post = buildPost({
      content: `
        <p><strong>Date:</strong> Wednesday 9th April</p>
        <p><strong>Time:</strong> 7pm</p>
        <p><strong>Location:</strong> Some Park</p>
      `,
    });
    const result = parseN2th3Post(post);
    expect(result).not.toBeNull();
    expect(result!.hares).toBeUndefined();
  });

  it("#723: falls back to title en-dash segment when body has no Location field", () => {
    const post = buildPost({
      title: "Run announcement 2276 &#8211; 15th April 2026 &#8211; Fanling",
      content: `
        <p><img src="https://example.com/flyer.jpg" alt="flyer"></p>
      `,
      date: "2026-04-14T10:00:00+08:00",
    });
    const result = parseN2th3Post(post);
    expect(result).not.toBeNull();
    expect(result!.location).toBe("Fanling");
    expect(result!.locationUrl).toContain("google.com/maps");
  });

  it("#723: multi-word title location survives", () => {
    const post = buildPost({
      title: "Run announcement 2274 &#8211; 1st April 2026 &#8211; Tseung Kwan O waterfront",
      content: "<p><img src='x.jpg'></p>",
      date: "2026-03-31T10:00:00+08:00",
    });
    const result = parseN2th3Post(post);
    expect(result?.location).toBe("Tseung Kwan O waterfront");
  });

  it("#723: trailing noise segment does not pollute location", () => {
    const post = buildPost({
      title: "Run announcement 2280 &#8211; 15th May 2026 &#8211; Fanling &#8211; bring torch",
      content: "<p><img src='x.jpg'></p>",
      date: "2026-05-14T10:00:00+08:00",
    });
    const result = parseN2th3Post(post);
    expect(result?.location).toBe("Fanling");
  });

  it("#723: splits multiple labels sharing one <p> block", () => {
    // Live N2TH3 posts often collapse Hares + Location into one paragraph
    // separated only by <br>. The fix must pick each label's own value and
    // not leak the next label's text into the prior field.
    const post = buildPost({
      title: "Run announcement 2276 &#8211; 15th April 2026 &#8211; Fanling",
      content: `
        <p><strong>Hares:</strong> <br>Golden Balls   <br><br><strong>Location: </strong><br>Fanling Recreation Ground</p>
        <p><strong>Map:</strong> <a href="https://maps.app.goo.gl/Ub3s32Scit81gjnM8">link</a></p>
        <p><strong>Hare says:</strong> Come along!</p>
      `,
      date: "2026-04-14T10:00:00+08:00",
    });
    const result = parseN2th3Post(post);
    expect(result).not.toBeNull();
    expect(result!.hares).toBe("Golden Balls");
    expect(result!.location).toBe("Fanling Recreation Ground");
    expect(result!.locationUrl).toBe(
      "https://maps.app.goo.gl/Ub3s32Scit81gjnM8",
    );
    expect(result!.description).toBe("Come along!");
  });

  it("handles map URL as plain text (no anchor tag)", () => {
    const post = buildPost({
      content: `
        <p><strong>Date:</strong> Wednesday 9th April</p>
        <p><strong>Map:</strong> https://maps.app.goo.gl/xyz789</p>
      `,
    });
    const result = parseN2th3Post(post);
    expect(result).not.toBeNull();
    expect(result!.locationUrl).toBe("https://maps.app.goo.gl/xyz789");
  });
});
