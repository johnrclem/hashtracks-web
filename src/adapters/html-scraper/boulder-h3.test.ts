import { describe, it, expect } from "vitest";
import * as cheerio from "cheerio";
import { parseBoulderH3Article, parseBoulderH3IndexPage } from "./boulder-h3";

const ARTICLE_FIXTURE = `<article id="post-4097" class="et_pb_post clearfix et_pb_blog_item_0_0 post-4097 post type-post status-publish format-standard has-post-thumbnail hentry category-hashes">
  <h2 class="entry-title">
    <a href="https://boulderh3.com/bh3-968-a-farewell-to-the-dark-horse/">BH3 #968: A Farewell to the Dark Horse</a>
  </h2>
  <div class="post-content"><div class="post-content-inner"><p>WHEN: 03/06/2026 at 07:00PM <br /> WHERE: Arrowwood Park  </p></div></div>
</article>`;

const PAGE_FIXTURE = `<html><body>
  <div class="et_pb_blog_grid">
    ${ARTICLE_FIXTURE}
    <article id="post-4083" class="et_pb_post post type-post category-hashes">
      <h2 class="entry-title">
        <a href="https://boulderh3.com/bh3-967-cum-back-to-boulder-hash/">BH3 #967 – Cum Back to Boulder Hash</a>
      </h2>
      <div class="post-content"><p>WHEN: 12/06/2025 at 12:00PM <br /> WHERE: Valmont Bike Park  </p></div>
    </article>
    <article id="post-4040" class="et_pb_post post type-post category-hashes">
      <h2 class="entry-title">
        <a href="https://boulderh3.com/bh3-963-untitled/">BH3 #963</a>
      </h2>
      <div class="post-content"><p>WHEN: 02/01/2025 at 01:30PM <br /> WHERE: Hangge Fields at Monarch Park  </p></div>
    </article>
  </div>
</body></html>`;

describe("parseBoulderH3Article", () => {
  it("extracts run number, title, date, time, location, sourceUrl", () => {
    const $ = cheerio.load(ARTICLE_FIXTURE);
    const article = $("article.et_pb_post").get(0)!;
    const result = parseBoulderH3Article($, article);
    expect(result).toMatchObject({
      runNumber: 968,
      title: "A Farewell to the Dark Horse",
      date: "2026-03-06",
      startTime: "19:00",
      location: "Arrowwood Park",
      sourceUrl: "https://boulderh3.com/bh3-968-a-farewell-to-the-dark-horse/",
      kennelTag: "bh3-co",
    });
  });

  it("converts 12:00PM to 12:00 (noon, not midnight)", () => {
    const html = `<article class="et_pb_post"><h2 class="entry-title"><a href="https://boulderh3.com/bh3-x/">BH3 #500: Test</a></h2><div class="post-content"><p>WHEN: 06/15/2024 at 12:00PM <br /> WHERE: Test</p></div></article>`;
    const $ = cheerio.load(html);
    const event = parseBoulderH3Article($, $("article").get(0)!);
    expect(event!.startTime).toBe("12:00");
  });

  it("handles dash-separated title (no colon)", () => {
    const html = `<article class="et_pb_post"><h2 class="entry-title"><a href="https://boulderh3.com/bh3-967/">BH3 #967 – Cum Back to Boulder Hash</a></h2><div class="post-content"><p>WHEN: 12/06/2025 at 12:00PM <br /> WHERE: Valmont Bike Park</p></div></article>`;
    const $ = cheerio.load(html);
    const event = parseBoulderH3Article($, $("article").get(0)!);
    expect(event!.title).toBe("Cum Back to Boulder Hash");
    expect(event!.runNumber).toBe(967);
  });

  it("handles a title with no extra description (run number only)", () => {
    const html = `<article class="et_pb_post"><h2 class="entry-title"><a href="https://boulderh3.com/bh3-963/">BH3 #963</a></h2><div class="post-content"><p>WHEN: 02/01/2025 at 01:30PM <br /> WHERE: Park</p></div></article>`;
    const $ = cheerio.load(html);
    const event = parseBoulderH3Article($, $("article").get(0)!);
    expect(event!.runNumber).toBe(963);
    expect(event!.title).toBeUndefined();
  });

  it("accepts free-form titles without BH3 #N prefix (older posts)", () => {
    const html = `<article class="et_pb_post"><h2 class="entry-title"><a href="https://boulderh3.com/closest-and-goosh/">Closest and GooSh Save the Day(light)</a></h2><div class="post-content"><div class="post-content-inner"><p>WHEN: 03/09/2025 at 03:30PM <br /> WHERE: CU Boulder South  </p></div><a href="https://boulderh3.com/closest-and-goosh/" class="more-link">read more</a></div></article>`;
    const $ = cheerio.load(html);
    const event = parseBoulderH3Article($, $("article").get(0)!);
    expect(event).toMatchObject({
      title: "Closest and GooSh Save the Day(light)",
      runNumber: undefined,
      date: "2025-03-09",
      location: "CU Boulder South",
    });
  });

  it("strips the trailing 'read more' link from location", () => {
    const html = `<article class="et_pb_post"><h2 class="entry-title"><a href="https://boulderh3.com/bh3-100/">BH3 #100: Test</a></h2><div class="post-content"><div class="post-content-inner"><p>WHEN: 06/15/2024 at 02:00PM <br /> WHERE: Park</p></div><a href="https://boulderh3.com/bh3-100/" class="more-link">read more</a></div></article>`;
    const $ = cheerio.load(html);
    const event = parseBoulderH3Article($, $("article").get(0)!);
    expect(event!.location).toBe("Park");
  });

  it("returns null when WHEN field is missing", () => {
    const html = `<article class="et_pb_post"><h2 class="entry-title"><a href="https://boulderh3.com/bh3-100/">BH3 #100: Trail</a></h2><div class="post-content"><p>WHERE: Somewhere</p></div></article>`;
    const $ = cheerio.load(html);
    expect(parseBoulderH3Article($, $("article").get(0)!)).toBeNull();
  });

  it("rejects invalid month/day in WHEN field", () => {
    const html = `<article class="et_pb_post"><h2 class="entry-title"><a href="https://boulderh3.com/bh3-100/">BH3 #100: Test</a></h2><div class="post-content"><p>WHEN: 13/45/2024 at 02:00PM <br /> WHERE: X</p></div></article>`;
    const $ = cheerio.load(html);
    expect(parseBoulderH3Article($, $("article").get(0)!)).toBeNull();
  });
});

describe("parseBoulderH3Article — edge cases", () => {
  it("parses date-only WHEN (no time), leaving startTime undefined", () => {
    const html = `<article class="et_pb_post"><h2 class="entry-title"><a href="https://boulderh3.com/bh3-100/">BH3 #100: Test</a></h2><div class="post-content"><p>WHEN: 06/15/2024 <br /> WHERE: Park</p></div></article>`;
    const $ = cheerio.load(html);
    const event = parseBoulderH3Article($, $("article").get(0)!);
    expect(event).toMatchObject({ date: "2024-06-15", location: "Park" });
    expect(event!.startTime).toBeUndefined();
  });

  it("returns event with undefined location when WHERE is missing", () => {
    const html = `<article class="et_pb_post"><h2 class="entry-title"><a href="https://boulderh3.com/bh3-100/">BH3 #100: Test</a></h2><div class="post-content"><p>WHEN: 06/15/2024 at 02:00PM</p></div></article>`;
    const $ = cheerio.load(html);
    const event = parseBoulderH3Article($, $("article").get(0)!);
    expect(event).not.toBeNull();
    expect(event!.location).toBeUndefined();
  });
});

describe("parseBoulderH3IndexPage", () => {
  it("parses every <article class=\"et_pb_post\"> on the page", () => {
    const $ = cheerio.load(PAGE_FIXTURE);
    const events = parseBoulderH3IndexPage($);
    expect(events).toHaveLength(3);
    expect(events.map((e) => e.runNumber)).toEqual([968, 967, 963]);
  });

  it("populates kennelTag bh3-co on every event", () => {
    const $ = cheerio.load(PAGE_FIXTURE);
    const events = parseBoulderH3IndexPage($);
    expect(events.every((e) => e.kennelTag === "bh3-co")).toBe(true);
  });

  it("skips unparseable articles without throwing", () => {
    const mixed = `<html><body>
      ${ARTICLE_FIXTURE}
      <article class="et_pb_post"><h2 class="entry-title"></h2><div class="post-content"><p>No content</p></div></article>
      <article class="et_pb_post"><h2 class="entry-title"><a href="https://boulderh3.com/bh3-200/">BH3 #200</a></h2><div class="post-content"><p>WHEN: 13/45/2024 <br /> WHERE: X</p></div></article>
    </body></html>`;
    const $ = cheerio.load(mixed);
    const events = parseBoulderH3IndexPage($);
    expect(events).toHaveLength(1);
    expect(events[0].runNumber).toBe(968);
  });
});
