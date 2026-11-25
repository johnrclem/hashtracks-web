import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as cheerio from "cheerio";
import type { Source } from "@/generated/prisma/client";
import { parseTaipeiHash, parseTaipeiDate, resolveRunsUrl, TaipeiHashAdapter } from "./taipei-hash";

vi.mock("@/adapters/safe-fetch", () => ({ safeFetch: vi.fn() }));
vi.mock("@/pipeline/structure-hash", () => ({
  generateStructureHash: vi.fn(() => "mock-hash"),
}));

import { safeFetch } from "@/adapters/safe-fetch";

// Markup captured from https://www.taipeihash.com.tw/runs (2026-11-25), after
// the Nov 2026 rebuild that 301s run_site.php → /runs. Trimmed to: the JSON-LD
// @graph (2 Events), the 本週活動 card (#2803), two 未來預告 cards (#2804, and
// #2805 with a 年會 badge), and three 歷史足跡 rows (#2802, #2801 with a badge,
// #2756). Phone numbers replaced with dummies.
const FIXTURE = `<!DOCTYPE html><html lang="zh-Hant-TW"><head>
<script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"SportsOrganization","name":"台北捷兔 Taipei Hash House Harriers"},{"@type":"Event","name":"台北捷兔第 2803 次跑山 Taipei Hash Run #2803","startDate":"2026-11-28T14:30:00+08:00"},{"@type":"Event","name":"台北捷兔第 2805 次跑山 Taipei Hash Run #2805（年會）","startDate":"2026-12-12T13:00:00+08:00"}]}</script>
</head><body class="site site-runs"><main class="site-main">
<section class="hm-block">
  <h2 class="hm-title">本週活動 <small>This Week</small></h2>
<article class="hm-run hm-run-big"><header class="hm-run-head"><span class="hm-run-no">#2803</span><span class="hm-run-date">2026/11/28（六） Sat</span></header><dl class="hm-run-body hm-ph hm-h2"><div class="hm-site-row"><dt>地點 <small>Run Site</small></dt><dd class="hm-site"><span>龜山</span><span class="hm-en">Guishan</span></dd><div class="hm-hares"><div class="cm-photo hm-hare-photo" data-initial="林" title="兔子：林益全 Agon"><img src="photos/m_3750.jpg" alt="兔子：林益全 Agon"></div></div></div><dt>兔子 <small>Hare</small></dt><dd><span class="hm-person"><b>林益全</b> <span class="hm-en">Agon</span> <a class="hm-tel" href="tel:0900000001">0900-000-001</a></span><span class="hm-person"><b>劉進鎊</b> <span class="hm-en">Black Donut</span> <a class="hm-tel" href="tel:0900000002">0900-000-002</a></span></dd><dt>麵粉起點 <small>Flour</small></dt><dd><span>龜山區忠義路二段311巷口</span><span class="hm-en">Intersection of Lane 311, Section 2, Zhongyi Road, Guishan District</span></dd><dt>集合地點 <small>Meeting Place</small></dt><dd><span>龜山區頂湖福德宮</span><span class="hm-en">Dinghu Fude Temple</span><a class="hm-map" href="https://maps.app.goo.gl/p1MsHx7y3wUQotR37" target="_blank" rel="noopener">📍 地圖 Map</a></dd></dl></article></section>
<section class="hm-block">
  <h2 class="hm-title">未來預告 <small>Upcoming Runs</small></h2>
  <div class="hm-grid">
<article class="hm-run"><header class="hm-run-head"><span class="hm-run-no">#2804</span><span class="hm-run-date">2026/12/05（六） Sat</span></header><dl class="hm-run-body hm-ph hm-h2"><div class="hm-site-row"><dt>地點 <small>Run Site</small></dt><dd class="hm-site"><span>石門</span><span class="hm-en">Shimen</span></dd></div><dt>兔子 <small>Hare</small></dt><dd><span class="hm-person"><b>王立君</b> <span class="hm-en">School Sucker</span> <a class="hm-tel" href="tel:0900000003">0900-000-003</a></span></dd><dt>集合地點 <small>Meeting Place</small></dt><dd><span>北17&amp;北19約6K處</span><span class="hm-en">Approximately 6 kilometers from North 17 &amp; North 19</span><a class="hm-map" href="https://maps.app.goo.gl/qwPcTDR4DFejtBSt6" target="_blank" rel="noopener">📍 地圖 Map</a></dd></dl></article><article class="hm-run"><header class="hm-run-head"><span class="hm-run-no">#2805</span><span class="hm-run-date">2026/12/12（六） Sat</span><span class="hm-badge">年會</span></header><dl class="hm-run-body hm-ph hm-h2"><div class="hm-site-row"><dt>地點 <small>Run Site</small></dt><dd class="hm-site"><span>土城</span><span class="hm-en">Tucheng</span></dd></div><dt>兔子 <small>Hare</small></dt><dd><span class="hm-person"><b>薛進成</b> <span class="hm-en">e-Life</span> <a class="hm-tel" href="tel:0900000004">0900-000-004</a></span></dd><dt>集合地點 <small>Meeting Place</small></dt><dd><span>土城龍山ㄧ街/學士路口</span><span class="hm-en">Intersection of Longshan 1st Street and Xueshi Road, Tucheng</span><a class="hm-map" href="https://evil.example.com/?u=maps.app.goo.gl/x" target="_blank" rel="noopener">📍 地圖 Map</a></dd></dl></article>  </div>
</section>
<section class="hm-block">
  <h2 class="hm-title">本年度歷史足跡 <small>Past Runs</small></h2>
  <div class="hm-recent">
    <div class="hm-recent-row"><span class="hm-run-no">#2802</span>
      <span class="hm-recent-date">2026/11/21</span>
      <span class="hm-recent-site"><span>新店</span><span class="hm-en">Xindian</span></span>
            <a class="hm-map" href="https://maps.app.goo.gl/EpCKRFGh8BVp6Fa1A" target="_blank" rel="noopener">📍 地圖 Map</a></div>
    <div class="hm-recent-row"><span class="hm-run-no">#2801</span>
      <span class="hm-recent-date">2026/11/14</span>
      <span class="hm-recent-site"><span>萬里</span><span class="hm-en">Wanli</span></span>
      <span class="hm-badge">迷你馬拉松</span>      <a class="hm-map" href="https://maps.app.goo.gl/X2WMAXjVZRK69ujq9" target="_blank" rel="noopener">📍 地圖 Map</a></div>
    <div class="hm-recent-row"><span class="hm-run-no">#2756</span>
      <span class="hm-recent-date">2026/01/03</span>
      <span class="hm-recent-site"><span>內湖</span><span class="hm-en">Neihu</span></span>
            <a class="hm-map" href="https://maps.app.goo.gl/HtadnAFTj4tbhG35A" target="_blank" rel="noopener">📍 地圖 Map</a></div>
  </div>
</section>
</main></body></html>`;

const URL_RUNS = "https://www.taipeihash.com.tw/runs";

describe("parseTaipeiHash (/runs, Nov 2026 rebuild)", () => {
  it("parses cards and history rows once each, sorted by date", () => {
    const { events, errors } = parseTaipeiHash(cheerio.load(FIXTURE), URL_RUNS);
    expect(errors).toHaveLength(0);
    expect(events.map((e) => e.runNumber)).toEqual([2756, 2801, 2802, 2803, 2804, 2805]);
    expect(events.map((e) => e.date)).toEqual([
      "2026-01-03", "2026-11-14", "2026-11-21", "2026-11-28", "2026-12-05", "2026-12-12",
    ]);
  });

  it("maps a card's fields: hares without phones, meeting point + district, maps link", () => {
    const { events } = parseTaipeiHash(cheerio.load(FIXTURE), URL_RUNS);
    const current = events.find((e) => e.runNumber === 2803)!;
    expect(current.kennelTags).toEqual(["taipei-h3"]);
    expect(current.title).toBeUndefined(); // merge.ts synthesizes "Taipei H3 Trail #N"
    expect(current.startTime).toBe("14:30"); // from JSON-LD startDate
    expect(current.hares).toBe("劉進鎊 Black Donut, 林益全 Agon"); // normalizeHaresField sorts
    expect(current.location).toBe("龜山區頂湖福德宮 Dinghu Fude Temple (龜山 Guishan)");
    expect(current.locationUrl).toBe("https://maps.app.goo.gl/p1MsHx7y3wUQotR37");
    expect(current.sourceUrl).toBe(URL_RUNS);
    for (const e of events) expect(e.hares ?? "").not.toMatch(/\d{3}/);
  });

  it("reads per-run start time from JSON-LD, defaults cards to 14:30, leaves history unset", () => {
    const { events } = parseTaipeiHash(cheerio.load(FIXTURE), URL_RUNS);
    const byRun = new Map(events.map((e) => [e.runNumber, e]));
    expect(byRun.get(2805)?.startTime).toBe("13:00");
    expect(byRun.get(2804)?.startTime).toBe("14:30");
    // History rows carry no time; leave it unset so older 15:00 runs aren't rewritten.
    expect(byRun.get(2802)?.startTime).toBeUndefined();
  });

  it("keeps badges as description and rejects a non-Maps href", () => {
    const { events } = parseTaipeiHash(cheerio.load(FIXTURE), URL_RUNS);
    const byRun = new Map(events.map((e) => [e.runNumber, e]));
    expect(byRun.get(2805)?.description).toBe("年會");
    expect(byRun.get(2805)?.locationUrl).toBeUndefined(); // evil.example.com
    expect(byRun.get(2801)?.description).toBe("迷你馬拉松");
    expect(byRun.get(2804)?.description).toBeUndefined();
  });

  it("history rows carry site + maps link but no hares", () => {
    const { events } = parseTaipeiHash(cheerio.load(FIXTURE), URL_RUNS);
    const past = events.find((e) => e.runNumber === 2802)!;
    expect(past.location).toBe("新店 Xindian");
    expect(past.locationUrl).toBe("https://maps.app.goo.gl/EpCKRFGh8BVp6Fa1A");
    expect(past.hares).toBeUndefined();
  });

  it("surfaces a card whose date can't be parsed instead of dropping it silently", () => {
    const bad = `<article class="hm-run"><header><span class="hm-run-no">#2810</span><span class="hm-run-date">TBD</span></header></article>`;
    const { events, errors, parseErrors } = parseTaipeiHash(cheerio.load(bad), URL_RUNS);
    expect(events).toHaveLength(0);
    expect(errors[0]).toMatch(/Unparseable runs-card row 0/);
    expect(parseErrors).toHaveLength(1);
  });
});

describe("parseTaipeiDate", () => {
  it("parses YYYY/MM/DD with a weekday tail and rejects impossible dates", () => {
    expect(parseTaipeiDate("2026/11/28（六） Sat")).toBe("2026-11-28");
    expect(parseTaipeiDate("2026/1/3")).toBe("2026-01-03");
    expect(parseTaipeiDate("2026/02/30")).toBeNull();
    expect(parseTaipeiDate("11/28")).toBeNull();
  });
});

describe("resolveRunsUrl", () => {
  it("rewrites the legacy run_site.php to /runs and keeps other URLs", () => {
    expect(resolveRunsUrl("https://www.taipeihash.com.tw/run_site.php")).toBe(URL_RUNS);
    expect(resolveRunsUrl(URL_RUNS)).toBe(URL_RUNS);
    expect(resolveRunsUrl(null)).toBe(URL_RUNS);
  });
});

function buildSource(url = "https://www.taipeihash.com.tw/run_site.php"): Source {
  return { id: "src-taipei", url } as Source;
}

function mockFetchHtml(html: string): void {
  vi.mocked(safeFetch).mockResolvedValue(new Response(html, { status: 200 }));
}

describe("TaipeiHashAdapter.fetch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-25T00:00:00Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("regression: the legacy run_site.php source fetches /runs and parses the rebuilt page", async () => {
    mockFetchHtml(FIXTURE);
    const result = await new TaipeiHashAdapter().fetch(buildSource(), { days: 365 });
    expect(vi.mocked(safeFetch).mock.calls[0][0]).toBe(URL_RUNS);
    expect(result.errors).toHaveLength(0);
    expect(result.events).toHaveLength(6);
    expect(result.events.every((e) => e.kennelTags[0] === "taipei-h3")).toBe(true);
    expect(result.structureHash).toBe("mock-hash");
  });

  it("honors options.days", async () => {
    mockFetchHtml(FIXTURE);
    const result = await new TaipeiHashAdapter().fetch(buildSource(URL_RUNS), { days: 30 });
    // 2026-01-03 falls outside a ±30-day window around 2026-11-25.
    expect(result.events.map((e) => e.runNumber)).not.toContain(2756);
    expect(result.events.map((e) => e.runNumber)).toContain(2805);
  });

  it("fails loud when a clean fetch yields zero events (markup drift)", async () => {
    mockFetchHtml("<html><body><p>redesigned again</p></body></html>");
    const result = await new TaipeiHashAdapter().fetch(buildSource());
    expect(result.events).toHaveLength(0);
    expect(result.errors.some((e) => e.includes("parsed 0 events"))).toBe(true);
    expect(result.errorDetails?.parse?.length).toBeGreaterThan(0);
  });
});
