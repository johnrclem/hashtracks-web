import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Source } from "@/generated/prisma/client";
import {
  parseBaliDate,
  parseListingCards,
  parseDetailFields,
  dedupeByRunNumber,
  BaliHash2Adapter,
} from "./bali-hash-2";
import * as safeFetchModule from "../safe-fetch";

vi.mock("../safe-fetch");

// Typed factory so tests can pass a partial Source without per-call `as never`
// (Source has many required fields the adapter never reads).
function fakeSource(overrides: Partial<Source> & Pick<Source, "url">): Source {
  return overrides as unknown as Source;
}

/** Faithful capture of two run cards + the #1739 corrected-repost pair from the
 *  live home page (balihash2.com, 2026-05-29). DOM order is reverse-chrono, so
 *  the `…-2` (3:00 PM correction) precedes the base 4:00 PM post. */
const HOME_FIXTURE = `<!doctype html><html><body><div class="gh-postfeed">
<article class="gh-card post no-image"><a class="gh-card-link" href="/bali-hash-2-next-run-map-1747-pura-pekemitan-prajapati-kediri-tabanan-30-may-26/"><div class="gh-card-wrapper">
<h3 class="gh-card-title is-title">Bali Hash 2 Next Run Map - #1747 - Pura Pekemitan / Prajapati, Kediri, Tabanan - 30-May-26</h3>
<p class="gh-card-excerpt is-body">Download or print the PDF Map HERE

Run: 1747
Date: 30-May-26
Our runs start promptly at: 4:00 PM so please try to arrive by 30 minutes earlier so you can pay your run fee and be prepared to go by 4:00 PM.

 * Location: Pura Pekemitan / Prajapati, Kediri, Tabanan</p>
<footer class="gh-card-meta"><time class="gh-card-date" datetime="2026-05-26">26 May 2026</time></footer>
</div></a></article>
<article class="gh-card post no-image"><a class="gh-card-link" href="/bali-hash-2-next-run-map-1746-lapangan-sepak-bola-perean-baturiti-23-may-26/"><div class="gh-card-wrapper">
<h3 class="gh-card-title is-title">Bali Hash 2 Next Run Map - #1746 - Lapangan Sepak Bola Perean, Baturiti - 23-May-26</h3>
<p class="gh-card-excerpt is-body">Download or print the PDF Map HERE

Run: 1746
Date: 23-May-26
Our runs start promptly at: 4:00 PM so please try to arrive by 30 minutes earlier so you can pay your run fee and be prepared to go by 4:00 PM.

 * Location: Lapangan Sepak Bola Perean, Baturiti</p>
<footer class="gh-card-meta"><time class="gh-card-date" datetime="2026-05-19">19 May 2026</time></footer>
</div></a></article>
<article class="gh-card post no-image"><a class="gh-card-link" href="/bali-hash-2-next-run-map-1739-lapangan-mamed-sindu-wati-sidemen-4-apr-26-2/"><div class="gh-card-wrapper">
<h3 class="gh-card-title is-title">Bali Hash 2 Next Run Map - #1739 - Lapangan Mamed, Sindu Wati, Sidemen - 4-Apr-26</h3>
<p class="gh-card-excerpt is-body">Download or print the PDF Map HERE

Run: 1739
Date: 4-Apr-26
Our runs start promptly at: 3:00 PM so please try to arrive by 30 minutes earlier so you can pay your run fee and be prepared to go by 3:00 PM.

 * Location: Lapangan Mamed, Sindu Wati, Sidemen</p>
<footer class="gh-card-meta"><time class="gh-card-date" datetime="2026-04-01">01 Apr 2026</time></footer>
</div></a></article>
<article class="gh-card post no-image"><a class="gh-card-link" href="/bali-hash-2-next-run-map-1739-lapangan-mamed-sindu-wati-sidemen-4-apr-26/"><div class="gh-card-wrapper">
<h3 class="gh-card-title is-title">Bali Hash 2 Next Run Map - #1739 - Lapangan Mamed, Sindu Wati, Sidemen - 4-Apr-26</h3>
<p class="gh-card-excerpt is-body">Download or print the PDF Map HERE

Run: 1739
Date: 4-Apr-26
Our runs start promptly at: 4:00 PM so please try to arrive by 30 minutes earlier so you can pay your run fee and be prepared to go by 4:00 PM.

 * Location: Lapangan Mamed, Sindu Wati, Sidemen</p>
<footer class="gh-card-meta"><time class="gh-card-date" datetime="2026-04-01">01 Apr 2026</time></footer>
</div></a></article>
</div></body></html>`;

/** Faithful capture of run #1747's `section.gh-content` — note Run/Date/start
 *  live in one <p> (<br>-separated) while Location/GPS/Occasion/Hares are <li>
 *  items, and the RUN FEES heading follows the <ul>. */
const DETAIL_FIXTURE = `<!doctype html><html><body><article><section class="gh-content">
<hr><p>Download or print the PDF Map <a href="https://map.balihash2.com/?print=true">HERE</a></p>
<figure class="kg-card kg-image-card"><img src="https://balihash2.com/content/images/2026/05/image.jpg" alt=""></figure>
<hr><p>Run: 1747<br>Date: 30-May-26<br>Our runs start promptly at: 4:00 PM so please try to arrive by 30 minutes earlier so you can pay your run fee and be prepared to go by 4:00 PM.</p>
<ul><li>Location: Pura Pekemitan / Prajapati, Kediri, Tabanan</li><li>GPS: <a href="https://www.google.com/maps/search/?api=1&amp;query=-8.58350, 115.1270571">-8.58350, 115.1270571</a></li><li>Occasion: WE START TOGETHER - WE DRINK TOGETHER</li><li>Hares: Exit/Re Entry &amp; Popoff Monster</li></ul>
<hr><h1 id="run-fees">RUN FEES</h1><h2 id="visitors">VISITORS</h2><p><em>Run with us 5 times and you automatically become a member of Bali Hash 2</em></p>
</section></article></body></html>`;

describe("parseBaliDate", () => {
  it.each([
    ["30-May-26", "2026-05-30"],
    ["23-May-26", "2026-05-23"],
    ["09-May-26", "2026-05-09"],
    // Single-digit day — must NOT mis-parse the year fragment as the day.
    ["4-Apr-26", "2026-04-04"],
  ])("parses hyphenated %s → %s", (input, expected) => {
    expect(parseBaliDate(input)).toBe(expected);
  });

  it("returns undefined when no date token present", () => {
    expect(parseBaliDate("Our runs start promptly at: 4:00 PM")).toBeUndefined();
  });
});

describe("parseListingCards", () => {
  const entries = parseListingCards(HOME_FIXTURE);

  it("extracts every run post card in DOM order", () => {
    expect(entries.map((e) => e.runNumber)).toEqual([1747, 1746, 1739, 1739]);
    expect(entries[0].domIndex).toBe(0);
  });

  it("parses run number, date, 24h start time and location from the excerpt", () => {
    const e = entries[0];
    expect(e.runNumber).toBe(1747);
    expect(e.date).toBe("2026-05-30");
    expect(e.startTime).toBe("16:00");
    expect(e.location).toBe("Pura Pekemitan / Prajapati, Kediri, Tabanan");
    expect(e.url).toBe(
      "https://balihash2.com/bali-hash-2-next-run-map-1747-pura-pekemitan-prajapati-kediri-tabanan-30-may-26/",
    );
  });

  it("reads the per-post start time (3:00 PM correction vs 4:00 PM original)", () => {
    expect(entries[2].startTime).toBe("15:00"); // …-2 corrected repost
    expect(entries[3].startTime).toBe("16:00"); // original
  });
});

describe("dedupeByRunNumber", () => {
  it("collapses the #1739 double-post to the first DOM occurrence (most recent)", () => {
    const deduped = dedupeByRunNumber(parseListingCards(HOME_FIXTURE));
    expect(deduped.map((e) => e.runNumber)).toEqual([1747, 1746, 1739]);
    const r1739 = deduped.find((e) => e.runNumber === 1739)!;
    expect(r1739.startTime).toBe("15:00"); // the corrected `…-2` post won
  });
});

describe("parseDetailFields", () => {
  const fields = parseDetailFields(DETAIL_FIXTURE);

  it("parses GPS coordinates as a finite lat/lng pair", () => {
    expect(fields.latitude).toBeCloseTo(-8.5835, 4);
    expect(fields.longitude).toBeCloseTo(115.1270571, 4);
  });

  it("parses hares without bleeding into the following section", () => {
    expect(fields.hares).toBe("Exit/Re Entry & Popoff Monster");
  });

  it("parses location from its <li> without swallowing the GPS line", () => {
    expect(fields.location).toBe("Pura Pekemitan / Prajapati, Kediri, Tabanan");
  });

  it("parses the detail-page date", () => {
    expect(fields.date).toBe("2026-05-30");
  });
});

describe("BaliHash2Adapter.fetch", () => {
  const source = fakeSource({ url: "https://balihash2.com", scrapeDays: 90 });

  beforeEach(() => {
    // Freeze "today" so the ±90-day window deterministically includes the
    // April–May 2026 fixtures regardless of when the suite runs.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-05-29T00:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  function mockFetch() {
    vi.mocked(safeFetchModule.safeFetch).mockImplementation(async (url: string) => {
      const body = url.endsWith("balihash2.com") || url.endsWith("balihash2.com/")
        ? HOME_FIXTURE
        : DETAIL_FIXTURE;
      return new Response(body, { status: 200 }) as never;
    });
  }

  it("emits deduped events with detail-enriched coords and synthesized-able titles", async () => {
    mockFetch();
    const result = await new BaliHash2Adapter().fetch(source);

    // #1739 double-post collapsed → 3 unique runs.
    expect(result.events.map((e) => e.runNumber).sort((a, b) => (b ?? 0) - (a ?? 0))).toEqual([
      1747, 1746, 1739,
    ]);

    const run1747 = result.events.find((e) => e.runNumber === 1747)!;
    expect(run1747.kennelTags).toEqual(["bali-hash-2"]);
    expect(run1747.date).toBe("2026-05-30");
    expect(run1747.startTime).toBe("16:00");
    expect(run1747.latitude).toBeCloseTo(-8.5835, 4);
    expect(run1747.longitude).toBeCloseTo(115.1270571, 4);
    expect(run1747.hares).toBe("Exit/Re Entry & Popoff Monster");
    // Title left undefined → merge.ts synthesizes "Bali Hash 2 Trail #N".
    expect(run1747.title).toBeUndefined();
    expect(run1747.locationUrl).toContain("google.com/maps");
  });

  it("fails loud (error, no events) when the listing has no run posts", async () => {
    vi.mocked(safeFetchModule.safeFetch).mockResolvedValue(
      new Response("<html><body>No posts here</body></html>", { status: 200 }) as never,
    );
    const result = await new BaliHash2Adapter().fetch(source);
    expect(result.events).toHaveLength(0);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it("surfaces an HTTP error without throwing", async () => {
    vi.mocked(safeFetchModule.safeFetch).mockResolvedValue(
      new Response("Server Error", { status: 500, statusText: "Internal Server Error" }) as never,
    );
    const result = await new BaliHash2Adapter().fetch(source);
    expect(result.events).toHaveLength(0);
    expect(result.errors[0]).toContain("500");
  });
});
