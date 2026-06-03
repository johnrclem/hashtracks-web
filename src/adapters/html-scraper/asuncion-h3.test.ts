import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Source } from "@/generated/prisma/client";
import {
  parseRunDate,
  parseStartTime,
  extractStartCoords,
  postToEvent,
  AsuncionH3Adapter,
} from "./asuncion-h3";
import * as safeFetchModule from "../safe-fetch";

vi.mock("../safe-fetch");

type Post = Parameters<typeof postToEvent>[0];

function post(title: string, contentHtml: string, id = 1, publishDate = "2026-05-31T12:01:33"): Post {
  return {
    id,
    date: publishDate,
    link: `https://asuncionh3.wordpress.com/post/${id}/`,
    title: { rendered: title },
    content: { rendered: contentHtml },
    categories: [1],
  };
}

// A faithful (trimmed) Run #120 body: bilingual two-column, date fragmented
// across inline <strong> tags, labeled fields separated by <br>, and the start
// coords inside a Google Maps embed iframe with URL-encoded `!` (%21).
const RUN_120_HTML = `
<div class="wp-block-columns">
  <div class="wp-block-column">
    <h4 class="wp-block-heading">Run &amp; Walk #120</h4>
    <p><strong>Saturday, 30 </strong><strong>May 2</strong><strong>026</strong><br><strong>15:30 (meet), 16:00 start of trail</strong></p>
    <p><strong>Hare(s):</strong> Ban the Cock<br><strong>Start</strong>: ASU H3 foundation stone in <a href="#Location">Plaza Celsa Speratti</a>, close to corner of Celsa Speratti &amp; Solar Guarani.<br><strong>Cost:</strong>&nbsp;Buy your own drinks at circle location (restaurant).<br><strong>Bag drop:</strong> NO.</p>
  </div>
  <div class="wp-block-column">
    <h4 class="wp-block-heading">Carrera &amp; Caminata #120</h4>
    <p><strong>Sábado, </strong>30 <strong>de mayo </strong>2026<br>15<strong>:30 (encuentro), 16:00 inicio del sendero</strong></p>
    <p><strong>Liebre(s):</strong> Ban the Cock<br><strong>Inicio:</strong> Primera piedra de la ASU H3 en la Plaza Celsa Speratti.<br><strong>Coste:</strong>&nbsp;Compra tus propias bebidas.</p>
  </div>
</div>
<div class="googlemaps"><iframe src="https://www.google.com/maps/embed?pb=%211m18%211m12%211m3%211d758.29%212d-57.60430085161278%213d-25.3020863951137%212m3%211f0%212f0%213f0"></iframe></div>
`;

describe("parseRunDate", () => {
  it.each([
    ["plain D Month YYYY", "Saturday, 30 May 2026", "2026-05-30"],
    ["ordinal + 'of'", "Sunday, 5th of December 2021, 16:00 hrs", "2021-12-05"],
    ["ordinal + 'of' (28th)", "Saturday, 28th of May 2022,", "2022-05-28"],
    ["plain with no 'of'", "Saturday, 17 January 2026", "2026-01-17"],
    ["English weekday + Spanish month", "Saturday, 14 marzo 2026", "2026-03-14"],
    ["full Spanish 'de' form", "Sábado, 30 de mayo 2026", "2026-05-30"],
    ["recurring 'Arpil' source typo", "Friday, 21st of Arpil 2023", "2023-04-21"],
    ["impossible date", "31 February 2026", undefined],
    ["non-month word", "20 Maybeish 2026", undefined],
    ["no date present", "join the WhatsApp group", undefined],
  ])("handles %s", (_label, input, expected) => {
    expect(parseRunDate(input)).toBe(expected);
  });

  it("takes the first (English-column) match when both languages are present", () => {
    // English column precedes Spanish in document order.
    expect(parseRunDate("Saturday, 30 May 2026 … Sábado, 30 de mayo 2026")).toBe("2026-05-30");
  });
});

describe("parseStartTime", () => {
  it.each([
    ["meet + start", "15:30 (meet), 16:00 start of trail", "16:00"],
    ["start with single-digit hour pad", "8:30 (meet), 9:00 start", "09:00"],
    ["bus departure then hash start", "13:30 (meet), 14:00 bus leaves Asunción\n15:30 Start Hash", "15:30"],
    ["single 'hrs' time, no start keyword", "Sunday, 5 December 2021, 16:00 hrs", "16:00"],
    ["meet only, no start keyword (falls back to first)", "17:00 meet at Palo Santo", "17:00"],
  ])("handles %s", (_label, input, expected) => {
    expect(parseStartTime(input)).toBe(expected);
  });
});

describe("extractStartCoords", () => {
  it("parses the URL-encoded embed (!2d=lng, !3d=lat) into the southern/western hemisphere", () => {
    const coords = extractStartCoords(RUN_120_HTML);
    expect(coords).not.toBeUndefined();
    expect(coords!.lat).toBeCloseTo(-25.3020863951137, 6);
    expect(coords!.lng).toBeCloseTo(-57.60430085161278, 6);
  });

  it("returns undefined when there is no embed iframe", () => {
    expect(extractStartCoords("<p>Start: somewhere</p>")).toBeUndefined();
  });

  it("rejects null-island and out-of-range coordinates", () => {
    expect(extractStartCoords('src="maps/embed?pb=!2d0!3d0"')).toBeUndefined();
    expect(extractStartCoords('src="maps/embed?pb=!2d-57.6!3d-200.0"')).toBeUndefined();
  });
});

describe("postToEvent", () => {
  it("parses a full Run #120 post: date, run #, hares, location, cost, time, coords", () => {
    const ev = postToEvent(post("Run #120", RUN_120_HTML, 6313));
    expect(ev).not.toBeNull();
    expect(ev!.date).toBe("2026-05-30");
    expect(ev!.runNumber).toBe(120);
    expect(ev!.kennelTags).toEqual(["asu-h3"]);
    expect(ev!.hares).toBe("Ban the Cock");
    expect(ev!.location).toContain("Plaza Celsa Speratti");
    expect(ev!.cost).toContain("Buy your own drinks");
    expect(ev!.startTime).toBe("16:00");
    expect(ev!.latitude).toBeCloseTo(-25.302086, 5);
    expect(ev!.longitude).toBeCloseTo(-57.604301, 5);
    expect(ev!.sourceUrl).toContain("asuncionh3.wordpress.com");
  });

  it("never sets a title (merge.ts synthesizes 'Asunción H3 Trail #N')", () => {
    const ev = postToEvent(post("Run #120", RUN_120_HTML, 6313));
    expect(ev!.title).toBeUndefined();
  });

  it("uses the in-body run date, not the post publish date (batch-posted runs)", () => {
    // Run #62 was published 2024-01-08 but its in-body date is 15 March 2024.
    const html = `<h4>Run &amp; Walk #62</h4><p><strong>Friday, 15th of March 2024,</strong><br>19:00 (meet), 19:30 start of trail</p>`;
    const ev = postToEvent(post("Run #62", html, 6062, "2024-01-08T09:43:12"));
    expect(ev!.date).toBe("2024-03-15");
  });

  it("returns null for a post with no parseable in-body date", () => {
    expect(postToEvent(post("Run #999", "<p>See you soon!</p>"))).toBeNull();
  });

  it("still emits an event when the post has no embed map (coords undefined)", () => {
    const html = `<h4>Run &amp; Walk #73</h4><p><strong>Saturday, 13th of July 2024</strong><br>14:30 (meet), 15:00 start of trail</p><p><strong>Hare(s):</strong> Uncut</p>`;
    const ev = postToEvent(post("Run #73", html, 6073));
    expect(ev).not.toBeNull();
    expect(ev!.date).toBe("2024-07-13");
    expect(ev!.latitude).toBeUndefined();
    expect(ev!.longitude).toBeUndefined();
  });
});

describe("AsuncionH3Adapter.fetch", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  const source = { id: "s1", url: "https://asuncionh3.wordpress.com/" } as Source;

  function jsonResponse(body: unknown, status = 200): Response {
    return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
  }

  it("emits only future runs (the archive is handled by the one-shot backfill)", async () => {
    const future = "2999-01-04"; // far future so the test is date-stable
    const futureHtml = `<h4>Run &amp; Walk #500</h4><p><strong>Saturday, 4 January ${future.slice(0, 4)}</strong><br>16:00 start of trail</p>`;
    const pastHtml = `<h4>Run &amp; Walk #120</h4><p><strong>Saturday, 30 May 2020</strong><br>16:00 start of trail</p>`;
    vi.mocked(safeFetchModule.safeFetch).mockResolvedValueOnce(
      jsonResponse([
        post("Run #500", futureHtml, 9500),
        post("Run #120", pastHtml, 9120),
      ]),
    );

    const result = await new AsuncionH3Adapter().fetch(source);
    expect(result.errors).toEqual([]);
    expect(result.events).toHaveLength(1);
    expect(result.events[0].runNumber).toBe(500);
    expect(result.events[0].date).toBe(future);
  });

  it("treats an empty 200 page as a clean end (no truncation flag)", async () => {
    vi.mocked(safeFetchModule.safeFetch).mockResolvedValueOnce(jsonResponse([])); // empty first page
    const result = await new AsuncionH3Adapter().fetch(source);
    expect(result.events).toEqual([]);
    expect(result.errors).toEqual([]);
    expect(result.diagnosticContext?.kennelPagesStopReason).toBeNull();
  });

  it("flags a page-1 HTTP 400 as truncation so reconcile can't false-cancel", async () => {
    // 400 on page 1 means the site/API is gone — NOT end-of-pagination. Must
    // surface as an error + stopReason, not a silent empty (authoritative) scrape.
    vi.mocked(safeFetchModule.safeFetch).mockResolvedValueOnce(jsonResponse(null, 400));
    const result = await new AsuncionH3Adapter().fetch(source);
    expect(result.events).toEqual([]);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.diagnosticContext?.kennelPagesStopReason).toBe("first-page-unavailable");
  });
});
