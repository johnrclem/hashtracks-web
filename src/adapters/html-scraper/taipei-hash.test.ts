import { describe, it, expect, vi, beforeEach } from "vitest";
import * as cheerio from "cheerio";
import type { Source } from "@/generated/prisma/client";
import { parseTaipeiHash, TaipeiHashAdapter } from "./taipei-hash";

vi.mock("@/adapters/safe-fetch", () => ({ safeFetch: vi.fn() }));
vi.mock("@/pipeline/structure-hash", () => ({
  generateStructureHash: vi.fn(() => "mock-hash"),
}));

import { safeFetch } from "@/adapters/safe-fetch";

// Verbatim markup captured from https://www.taipeihash.com.tw/run_site.php
// (2026-06-12): a current table (1 row), a future table (3 rows), and a
// history table (3 representative rows incl. a tagged 生日 row and the deep
// January row). A single mobile-event-card duplicate is included to prove the
// adapter does NOT double-count it.
const FIXTURE = `<!DOCTYPE html><html lang="zh-TW"><body>
<section class="events-section">
  <table class="events-table">
    <thead><tr><th>跑次<br>(Run No.)</th><th>日期<br>(Date)</th><th>兔子<br>(Hare)</th><th>地點<br>(Run Site)</th><th>記號起點<br>(Marks Start)</th></tr></thead>
    <tbody>
      <tr class="current-event">
        <td class="run-number"><strong>2779</strong><span class="new-badge">NEW</span></td>
        <td class="event-date"><strong>06/13</strong></td>
        <td class="hare-info"><strong>Engels Adolf Medina Ruiz<br>2nd Man In</strong><br><span class="phone">0983963115</span></td>
        <td class="location-info"><strong>猴硐<br>Houtong</strong></td>
        <td class="marks-info"><strong>麵粉：猴硐車站<br><span class="english">Flour：Houtong Station</span><br>集合地點：<a href="https://maps.app.goo.gl/VtWk5MTYusyPA2P48" target="_blank">📍猴硐里活動中心</a><br><span class="english">Place：Houtong Village Activity Center</span></strong></td>
      </tr>
    </tbody>
  </table>
  <div class="mobile-events-container">
    <div class="mobile-event-card">
      <div class="mobile-run-info"><strong>2779</strong></div>
      <div class="mobile-event-date"><strong>06/13</strong></div>
      <div class="mobile-info-value">2nd Man In</div>
      <div class="mobile-phone">0983963115</div>
    </div>
  </div>
</section>
<section class="events-section">
  <table class="events-table">
    <thead><tr><th>跑次</th><th>日期</th><th>兔子</th><th>地點</th><th>記號起點</th></tr></thead>
    <tbody>
      <tr class="upcoming-event">
        <td class="run-number"><strong>2780</strong><span class="confirmed-badge">預告</span></td>
        <td class="event-date"><strong>06/20</strong></td>
        <td class="hare-info"><strong>王崑穗<br>Rhino</strong><br><span class="phone">0932-045374</span></td>
        <td class="location-info"><strong>平溪<br>Pingxi</strong></td>
        <td class="marks-info"><strong>集合地點：<a href="https://maps.app.goo.gl/4KaAHzHATAE4sQVK9" target="_blank">📍大華農路六分福德宮</a></strong></td>
      </tr>
      <tr class="upcoming-event">
        <td class="run-number"><strong>2781</strong><span class="confirmed-badge">預告</span></td>
        <td class="event-date"><strong>06/27</strong></td>
        <td class="hare-info"><strong>陳註復<br>Pig Blood Cake</strong></td>
        <td class="location-info"><strong>木柵<br>Muzha</strong></td>
        <td class="marks-info"><strong>集合地點：<a href="https://maps.app.goo.gl/uSSVbVz2vmskbfVp7" target="_blank">📍木柵</a></strong></td>
      </tr>
      <tr class="upcoming-event">
        <td class="run-number"><strong>2782</strong><span class="confirmed-badge">預告</span></td>
        <td class="event-date"><strong>07/04</strong></td>
        <td class="hare-info"><strong>蕭世璞<br>Dog Leather</strong></td>
        <td class="location-info"><strong>坪林<br>Pinglin</strong></td>
        <td class="marks-info"><strong>集合地點：<a href="https://maps.app.goo.gl/jgiLnLgRZjBohLEu5" target="_blank">📍坪林</a></strong></td>
      </tr>
    </tbody>
  </table>
</section>
<section class="events-section">
  <table class="events-table">
    <thead><tr><th>跑次</th><th>日期</th><th>兔子</th><th>地點</th><th>記號起點</th></tr></thead>
    <tbody>
      <tr class="past-event">
        <td class="run-number"><strong>2778</strong></td>
        <td class="event-date"><strong>06/06</strong></td>
        <td class="hare-info"><strong>Holy Piss</strong><br><span class="phone">0912-345678</span></td>
        <td class="location-info"><strong>五股<br>Wugu</strong></td>
        <td class="marks-info"><strong>集合地點：<a href="https://maps.app.goo.gl/FsRqbhq3qPe1JppF6" target="_blank">📍五股</a></strong></td>
      </tr>
      <tr class="past-event">
        <td class="run-number"><strong>2762</strong></td>
        <td class="event-date"><strong>02/14</strong><span class="new-badge">生日</span></td>
        <td class="hare-info"><strong>林天財<br>White Horse</strong><br><span class="phone">0932-232896</span></td>
        <td class="location-info"><strong>新店<br>Xindian</strong></td>
        <td class="marks-info"><strong>集合地點：<a href="https://maps.app.goo.gl/boogMCoHe1Pgf5439" target="_blank">📍新店陽光運動園區第一停車場</a></strong></td>
      </tr>
      <tr class="past-event">
        <td class="run-number"><strong>2756</strong></td>
        <td class="event-date"><strong>01/03</strong></td>
        <td class="hare-info"><strong>李志勇<br>R.P.M</strong><br><span class="phone">0933-060373</span></td>
        <td class="location-info"><strong>內湖<br>Neihu</strong></td>
        <td class="marks-info"><strong>集合地點：<a href="https://maps.app.goo.gl/HtadnAFTj4tbhG35A" target="_blank">📍內溝山后福德宮</a></strong></td>
      </tr>
    </tbody>
  </table>
</section>
</body></html>`;

const REF = new Date("2026-06-12T00:00:00Z");

describe("parseTaipeiHash", () => {
  it("parses all table rows once (mobile card duplicate ignored)", () => {
    const $ = cheerio.load(FIXTURE);
    const { events } = parseTaipeiHash($, "https://www.taipeihash.com.tw/run_site.php", REF);
    // 1 current + 3 future + 3 history = 7 (the mobile card #2779 is NOT counted)
    expect(events).toHaveLength(7);
    expect(events.filter((e) => e.runNumber === 2779)).toHaveLength(1);
  });

  it("anchors year on run number and dates the deep history correctly", () => {
    const $ = cheerio.load(FIXTURE);
    const { events } = parseTaipeiHash($, "https://www.taipeihash.com.tw/run_site.php", REF);
    const byRun = new Map(events.map((e) => [e.runNumber, e]));
    expect(byRun.get(2779)?.date).toBe("2026-06-13"); // current
    expect(byRun.get(2782)?.date).toBe("2026-07-04"); // future
    // The key assertion: a naive today-anchored rollover would push these
    // ~5-month-old rows to 2027. Run-number anchoring keeps them in 2026.
    expect(byRun.get(2762)?.date).toBe("2026-02-14"); // tagged 生日 row
    expect(byRun.get(2756)?.date).toBe("2026-01-03"); // deepest history
  });

  it("emits constant fields and strips the PII phone from hares", () => {
    const $ = cheerio.load(FIXTURE);
    const { events } = parseTaipeiHash($, "https://www.taipeihash.com.tw/run_site.php", REF);
    const current = events.find((e) => e.runNumber === 2779)!;
    expect(current.startTime).toBe("15:00");
    expect(current.kennelTags).toEqual(["taipei-h3"]);
    expect(current.title).toBeUndefined(); // merge.ts synthesizes "Taipei H3 Trail #N"
    expect(current.hares).toBe("Engels Adolf Medina Ruiz 2nd Man In");
    expect(current.location).toBe("猴硐 Houtong");
    expect(current.locationUrl).toBe("https://maps.app.goo.gl/VtWk5MTYusyPA2P48");
    // No phone digits leak into any hare field.
    for (const e of events) {
      expect(e.hares ?? "").not.toMatch(/\d{6,}/);
    }
  });

  it("rejects a non-Maps / non-https locationUrl", () => {
    const hostile = `<table class="events-table"><tbody>
      <tr><td class="run-number"><strong>2779</strong></td><td class="event-date"><strong>06/13</strong></td><td class="hare-info"><strong>A</strong></td><td class="location-info"><strong>X</strong></td><td class="marks-info"><a href="https://evil.example.com/?ref=maps.app.goo.gl/x">📍</a></td></tr>
      <tr><td class="run-number"><strong>2778</strong></td><td class="event-date"><strong>06/06</strong></td><td class="hare-info"><strong>B</strong></td><td class="location-info"><strong>Y</strong></td><td class="marks-info"><a href="https://maps.app.goo.gl/Good123">📍</a></td></tr>
    </tbody></table>`;
    const $ = cheerio.load(hostile);
    const { events } = parseTaipeiHash($, "url", REF);
    const byRun = new Map(events.map((e) => [e.runNumber, e]));
    expect(byRun.get(2779)?.locationUrl).toBeUndefined(); // evil.example.com rejected
    expect(byRun.get(2778)?.locationUrl).toBe("https://maps.app.goo.gl/Good123");
  });

  it("resolves the Dec→Jan boundary by run number, not by today's year", () => {
    // Current run on 01/03; the prior week's run on 12/27 belongs to the
    // PREVIOUS calendar year. refDate early January.
    const boundary = `<table class="events-table"><tbody>
      <tr><td class="run-number"><strong>2756</strong></td><td class="event-date"><strong>01/03</strong></td><td class="hare-info"><strong>A</strong></td><td class="location-info"><strong>X</strong></td><td class="marks-info"></td></tr>
      <tr><td class="run-number"><strong>2755</strong></td><td class="event-date"><strong>12/27</strong></td><td class="hare-info"><strong>B</strong></td><td class="location-info"><strong>Y</strong></td><td class="marks-info"></td></tr>
    </tbody></table>`;
    const $ = cheerio.load(boundary);
    const { events } = parseTaipeiHash($, "url", new Date("2025-01-05T00:00:00Z"));
    const byRun = new Map(events.map((e) => [e.runNumber, e]));
    expect(byRun.get(2756)?.date).toBe("2025-01-03");
    expect(byRun.get(2755)?.date).toBe("2024-12-27");
  });
});

function buildSource(): Source {
  return {
    id: "src-taipei",
    url: "https://www.taipeihash.com.tw/run_site.php",
  } as Source;
}

function mockFetchHtml(html: string): void {
  // A real Response (ok/status/text() all satisfied) — avoids a partial-shape
  // type assertion that tsc requires but Sonar flags as redundant (S4325).
  vi.mocked(safeFetch).mockResolvedValue(new Response(html, { status: 200 }));
}

describe("TaipeiHashAdapter.fetch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns events from the live-shaped page", async () => {
    mockFetchHtml(FIXTURE);

    const result = await new TaipeiHashAdapter().fetch(buildSource(), { days: 365 });
    expect(result.errors).toHaveLength(0);
    expect(result.events.length).toBeGreaterThanOrEqual(4);
    expect(result.events.every((e) => e.kennelTags[0] === "taipei-h3")).toBe(true);
    expect(result.structureHash).toBe("mock-hash");
  });

  it("fails loud when a clean fetch yields zero events (markup drift)", async () => {
    mockFetchHtml("<html><body><p>redesigned, no tables</p></body></html>");

    const result = await new TaipeiHashAdapter().fetch(buildSource());
    expect(result.events).toHaveLength(0);
    expect(result.errors.some((e) => e.includes("parsed 0 events"))).toBe(true);
    expect(result.errorDetails?.parse?.length).toBeGreaterThan(0);
  });
});
