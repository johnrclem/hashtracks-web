import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it, expect, vi } from "vitest";
import * as cheerio from "cheerio";
import type { Source } from "@/generated/prisma/client";
import {
  NewTaipeiHashAdapter,
  parseNewTaipeiHash,
  decodeBig5,
  resolvePageUrl,
} from "./new-taipei-hash";

vi.mock("@/adapters/safe-fetch", () => ({ safeFetch: vi.fn() }));
vi.mock("@/pipeline/structure-hash", () => ({
  generateStructureHash: vi.fn(() => "mock-hash-nth3"),
}));

const { safeFetch } = await import("@/adapters/safe-fetch");
const mockedSafeFetch = vi.mocked(safeFetch);

const SOURCE_URL = "http://www.newtaipeihash.com/run_site_2026.htm";

function makeSource(overrides: Partial<Source> = {}): Source {
  return {
    id: "src-nth3",
    name: "New Taipei Hash Run List",
    url: SOURCE_URL,
    type: "HTML_SCRAPER",
    trustLevel: 6,
    scrapeFreq: "daily",
    scrapeDays: 365,
    config: { upcomingOnly: true },
    isActive: true,
    lastScrapedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as Source;
}

function mockFetchBytes(bytes: Uint8Array, init: ResponseInit = { status: 200 }) {
  const buffer = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
  mockedSafeFetch.mockResolvedValue(new Response(buffer, init));
}

// A hand-crafted fixture modelled verbatim on the live run_site_2026.htm DOM:
// a single <table> with 1-cell section bands, repeated 5-cell column headers,
// a "This Week" current row, an "Important Events" dupe block, season markers,
// plus archive-style rows (phone PII, Word <style> leak, MM/DD~DD range, blank
// venue, goo.gl/maps link). Kept small but structurally faithful.
const FIXTURE_HTML = `
<table>
  <tr><td>如何參加捷兔路跑活動</td></tr>
  <tr><td>↓↓↓↓↓ 本 週 活 動 This week Event ↓↓↓↓↓</td></tr>
  <tr><td>跑次 (Run No.)</td><td>日期 (Date)</td><td>兔子 (Hare)</td><td>地點 (Run Site)</td><td>記號起點 &amp; 詳細資訊</td></tr>
  <tr><td>690 ((( 本周)))</td><td>06/14</td><td>爛死了/高小高</td><td>萬芳醫院站</td><td>詳細資訊請參閱 Facebook活動專頁</td></tr>
  <tr><td>↓↓↓↓↓ 重 要 活 動 預 告 Important Events ↓↓↓↓↓</td></tr>
  <tr><td>跑次 (Run No.)</td><td>日期 (Date)</td><td>兔子 (Hare)</td><td>地點 (Run Site)</td><td>記號起點 &amp; 詳細資訊</td></tr>
  <tr><td>714</td><td>11/29</td><td></td><td>年會&amp;會長改選</td><td>詳細資訊請參閱 Facebook活動專頁</td></tr>
  <tr><td>↓↓↓↓↓ 2026年 活 動 預 告 Every week Events ↓↓↓↓↓</td></tr>
  <tr><td>跑次 (Run No.)</td><td>日期 (Date)</td><td>兔子 (Hare)</td><td>地點 (Run Site)</td><td>記號起點 &amp; 詳細資訊</td></tr>
  <tr><td>714</td><td>11/29</td><td>忠原/馬龍</td><td>年會&amp;會長改選</td><td>詳細資訊請參閱 Facebook活動專頁</td></tr>
  <tr><td>706</td><td>10/04</td><td>文旭(煙腸)</td><td></td><td>詳細資訊請參閱 Facebook活動專頁</td></tr>
  <tr><td>↑↑↑↑↑ 開始冬令時間，下午14：30起跑 ↑↑↑↑↑</td></tr>
  <tr><td>700</td><td>08/23</td><td>Fire Bird/火鳥 &amp; Man Juice/Fisher</td><td>700次1日特跑 桃園復興</td><td>報名網址：https://reurl.cc/bdpqO3</td></tr>
  <tr><td>690 ((( 本周)))</td><td>06/14</td><td>爛死了/高小高</td><td>萬芳醫院站</td><td>詳細資訊請參閱 Facebook活動專頁</td></tr>
  <tr><td>689</td><td>06/07</td><td>蝦米/what's happen &amp; 小鈴/planking</td><td>桃園大溪</td><td>詳細資訊 <a href="https://fb.me/e/6V6ahVIES">FB</a></td></tr>
  <tr><td>↑↑↑↑↑ 開始夏令時間，下午14：30起跑 ↑↑↑↑↑</td></tr>
  <tr><td>667</td><td>01/04</td><td>強森、Tim</td><td>文山 景美運動公園</td><td>地圖 <a href="https://goo.gl/maps/abc123">map</a></td></tr>
</table>
`;

// An archive-style fixture exercising phone PII (mobile + parenthesised
// landline), the Word "Save as HTML" <style> leak inside a cell, and a
// multi-day MM/DD~DD date range. Years differ from 2026 (caller supplies year).
const ARCHIVE_FIXTURE_HTML = `
<table>
  <tr><td>跑次 (Run No.)</td><td>日期 (Date)</td><td>兔子 (Hare)</td><td>地點 (Run Site)</td><td>詳細</td></tr>
  <tr><td>52</td><td>12/29</td><td>徐壹豐 (Softy) 0920-946-035</td><td>蘆竹 坑口彩繪村</td><td>詳細資訊</td></tr>
  <tr><td>46</td><td>11/15~17</td><td></td><td>三天兩夜特跑</td><td>詳細資訊</td></tr>
  <tr><td>3</td><td>01/20</td><td><style><!--td {border: 1px solid #cccccc;}br {}--></style>劉智燻 (Unchained) (02)2883-2383</td><td>士林 神秘禁區</td><td>詳細資訊</td></tr>
  <tr><td>1</td><td>01/06</td><td>李芳中 (Big Tree) 0910-198-702 &amp; 蕭緯騰 (Fire Bird)</td><td>汐止 拱北殿</td><td>詳細資訊</td></tr>
</table>
`;

describe("decodeBig5", () => {
  it("decodes Big5 bytes for 新北捷兔 (the kennel title)", () => {
    // Big5 byte sequence for 新北捷兔 (verified via iconv).
    const bytes = new Uint8Array(Buffer.from("b773a55fb1b6a8df", "hex"));
    expect(decodeBig5(bytes)).toBe("新北捷兔");
  });
});

describe("resolvePageUrl", () => {
  it("derives the current year's page from the source URL directory", () => {
    expect(resolvePageUrl(SOURCE_URL, 2027)).toBe(
      "http://www.newtaipeihash.com/run_site_2027.htm",
    );
  });
  it("falls back to the default base when source URL is missing/invalid", () => {
    expect(resolvePageUrl(null, 2026)).toBe(
      "http://www.newtaipeihash.com/run_site_2026.htm",
    );
    expect(resolvePageUrl("not a url", 2026)).toBe(
      "http://www.newtaipeihash.com/run_site_2026.htm",
    );
  });
});

describe("parseNewTaipeiHash", () => {
  const $ = cheerio.load(FIXTURE_HTML);
  const { events, errors } = parseNewTaipeiHash($, SOURCE_URL, 2026);
  const byRun = new Map(events.map((e) => [e.runNumber, e]));

  it("parses without errors and dedupes by run number", () => {
    expect(errors).toEqual([]);
    // Distinct runs: 714, 706, 700, 690, 689, 667 — #714 and #690 each appear
    // twice in the fixture (Important Events / This Week dupes) but emit once.
    const runs = events.map((e) => e.runNumber).sort((a, b) => Number(a) - Number(b));
    expect(runs).toEqual([667, 689, 690, 700, 706, 714]);
  });

  it("resolves the year from the caller (URL filename), UTC-noon date string", () => {
    expect(byRun.get(690)?.date).toBe("2026-06-14");
    expect(byRun.get(667)?.date).toBe("2026-01-04");
  });

  it("keeps the richer weekly-list row over the Important Events stub", () => {
    // Important Events #714 has empty hares; the weekly list has 忠原/馬龍.
    expect(byRun.get(714)?.hares).toBe("忠原/馬龍");
  });

  it("derives seasonal startTime by month (summer 15:00 / winter 14:30)", () => {
    expect(byRun.get(690)?.startTime).toBe("15:00"); // June → summer
    expect(byRun.get(700)?.startTime).toBe("15:00"); // August → summer
    expect(byRun.get(706)?.startTime).toBe("14:30"); // October → winter
    expect(byRun.get(667)?.startTime).toBe("14:30"); // January → winter
    expect(byRun.get(714)?.startTime).toBe("14:30"); // November → winter
  });

  it("splits paired hares on & / 、 (sorted), keeps a single hare's / intact", () => {
    expect(byRun.get(700)?.hares).toBe("Fire Bird/火鳥, Man Juice/Fisher");
    expect(byRun.get(689)?.hares).toBe("小鈴/planking, 蝦米/what's happen");
    expect(byRun.get(667)?.hares).toBe("Tim, 強森"); // 、 separator
  });

  it("captures Facebook event links as externalLinks, not locationUrl", () => {
    expect(byRun.get(689)?.externalLinks).toEqual([
      { url: "https://fb.me/e/6V6ahVIES", label: "Facebook Event" },
    ]);
    expect(byRun.get(689)?.locationUrl).toBeUndefined();
  });

  it("captures genuine Google Maps links as locationUrl", () => {
    expect(byRun.get(667)?.locationUrl).toBe("https://goo.gl/maps/abc123");
  });

  it("leaves a blank 地點 venue undefined", () => {
    expect(byRun.get(706)?.location).toBeUndefined();
  });

  it("tags every event with the single kennelCode and no title", () => {
    for (const e of events) {
      expect(e.kennelTags).toEqual(["nth3-tw"]);
      expect(e.title).toBeUndefined();
    }
  });
});

describe("parseNewTaipeiHash — archive quirks", () => {
  const $ = cheerio.load(ARCHIVE_FIXTURE_HTML);
  const { events, errors } = parseNewTaipeiHash($, SOURCE_URL, 2013);
  const byRun = new Map(events.map((e) => [e.runNumber, e]));

  it("parses archive rows without errors", () => {
    expect(errors).toEqual([]);
    expect(events.map((e) => e.runNumber).sort((a, b) => Number(a) - Number(b))).toEqual([
      1, 3, 46, 52,
    ]);
  });

  it("strips mobile + parenthesised-landline phone PII from hares", () => {
    expect(byRun.get(52)?.hares).toBe("徐壹豐 (Softy)");
    expect(byRun.get(3)?.hares).toBe("劉智燻 (Unchained)");
    for (const e of events) {
      if (e.hares) expect(e.hares).not.toMatch(/\d{3}-\d{3}/);
    }
  });

  it("strips Word <style> leakage from cell text", () => {
    expect(byRun.get(3)?.hares).not.toContain("border");
  });

  it("takes the first day of a MM/DD~DD multi-day range", () => {
    expect(byRun.get(46)?.date).toBe("2013-11-15");
  });

  it("splits paired hares where one carries a stripped phone", () => {
    // 李芳中 (Big Tree) [phone] & 蕭緯騰 (Fire Bird) → two hares, sorted.
    expect(byRun.get(1)?.hares).toBe("李芳中 (Big Tree), 蕭緯騰 (Fire Bird)");
  });
});

// Structural quirks: stacked-<p> multi-value cells (2-day overseas special) and
// COVID-cancellation rows whose run cell is "X".
const STRUCTURAL_FIXTURE_HTML = `
<table>
  <tr><td>跑次 (Run No.)</td><td>日期 (Date)</td><td>兔子 (Hare)</td><td>地點 (Run Site)</td><td>詳細</td></tr>
  <tr><td><p>649</p></td><td><p>08/31</p></td><td>Royal Flak</td><td>坪林</td><td>詳細</td></tr>
  <tr><td><p>647</p><p>648</p></td><td><p>08/23</p><p>08/24</p></td><td>清邁特跑</td><td>泰國 清邁</td><td>詳細</td></tr>
  <tr><td>X</td><td>7/25</td><td>謝悟鋒 (Permature)</td><td>COVID 19 三級疫情取消</td><td>詳細</td></tr>
  <tr><td>646</td><td>08/17</td><td>愷媽</td><td>麟光站</td><td>詳細</td></tr>
</table>
`;

describe("parseNewTaipeiHash — structural quirks", () => {
  const $ = cheerio.load(STRUCTURAL_FIXTURE_HTML);
  const { events, errors } = parseNewTaipeiHash($, SOURCE_URL, 2025);
  const byRun = new Map(events.map((e) => [e.runNumber, e]));

  it("takes the first run number + first date of a stacked-<p> multi-day special", () => {
    expect(byRun.has(647648)).toBe(false); // not mashed together
    expect(byRun.get(647)?.date).toBe("2025-08-23");
    expect(byRun.has(648)).toBe(false); // second day folds into #647
  });

  it("skips COVID-cancellation rows (run cell 'X') silently — no event, no error", () => {
    expect(errors).toEqual([]);
    expect(events.map((e) => e.runNumber).sort((a, b) => Number(a) - Number(b))).toEqual([
      646, 647, 649,
    ]);
  });
});

// Overseas-special venues prefix the country in Chinese.
const OVERSEAS_FIXTURE_HTML = `
<table>
  <tr><td>跑次 (Run No.)</td><td>日期 (Date)</td><td>兔子 (Hare)</td><td>地點 (Run Site)</td><td>詳細</td></tr>
  <tr><td>647</td><td>08/23</td><td>清邁特跑</td><td>泰國 清邁</td><td>詳細</td></tr>
  <tr><td>543</td><td>09/03</td><td>沖繩特跑</td><td>日本 沖繩</td><td>詳細</td></tr>
  <tr><td>690</td><td>06/14</td><td>爛死了</td><td>萬芳醫院站</td><td>詳細</td></tr>
</table>
`;

describe("parseNewTaipeiHash — overseas specials", () => {
  const $ = cheerio.load(OVERSEAS_FIXTURE_HTML);
  const { events } = parseNewTaipeiHash($, SOURCE_URL, 2025);
  const byRun = new Map(events.map((e) => [e.runNumber, e]));

  it("sets countryOverride on foreign-country venues (bypasses merge's 200km guard)", () => {
    expect(byRun.get(647)?.countryOverride).toBe(""); // 泰國 (Thailand)
    expect(byRun.get(543)?.countryOverride).toBe(""); // 日本 (Japan)
  });

  it("leaves countryOverride undefined for domestic Taiwan venues", () => {
    expect(byRun.get(690)?.countryOverride).toBeUndefined();
    expect("countryOverride" in (byRun.get(690) ?? {})).toBe(false);
  });
});

describe("NewTaipeiHashAdapter.fetch (Big5 end-to-end)", () => {
  it("decodes the live Big5 fixture and parses without errors", () => {
    // Read the real committed Big5 page bytes, decode + parse with a fixed year
    // (deterministic — independent of the 365-day window in fetch()).
    const fixturePath = path.join(
      __dirname,
      "fixtures/new-taipei-hash-2026.big5.html.fixture",
    );
    const bytes = new Uint8Array(readFileSync(fixturePath));
    const html = decodeBig5(bytes);
    expect(html).toContain("新北捷兔"); // Big5 decoded correctly
    const $ = cheerio.load(html);
    const { events, errors } = parseNewTaipeiHash($, SOURCE_URL, 2026);
    expect(errors).toEqual([]);
    expect(events.length).toBe(52);
    expect(events.map((e) => e.runNumber)).toContain(690);
    // run numbers are unique (specials + This Week deduped)
    const runs = events.map((e) => e.runNumber);
    expect(new Set(runs).size).toBe(runs.length);
  });

  it("wires fetch → Big5 decode → parse (no errors, rows found)", async () => {
    const fixturePath = path.join(
      __dirname,
      "fixtures/new-taipei-hash-2026.big5.html.fixture",
    );
    mockFetchBytes(new Uint8Array(readFileSync(fixturePath)));
    const result = await new NewTaipeiHashAdapter().fetch(makeSource(), { days: 365 });
    expect(result.errors).toEqual([]);
    expect(result.structureHash).toBe("mock-hash-nth3");
    // rowsFound is pre-window-filter, so this is deterministic across years.
    expect((result.diagnosticContext?.rowsFound as number) ?? 0).toBeGreaterThan(0);
  });

  it("fails loud on an HTTP error", async () => {
    mockedSafeFetch.mockResolvedValue(
      new Response("err", { status: 500, statusText: "Internal Server Error" }),
    );
    const result = await new NewTaipeiHashAdapter().fetch(makeSource(), { days: 365 });
    expect(result.events).toEqual([]);
    expect(result.errors[0]).toContain("HTTP 500");
  });

  it("fails loud (zero-event guard) when the table has no data rows", async () => {
    const emptyHtml = "<table><tr><td>Run No.</td><td>Date</td><td>Hare</td><td>Site</td><td>Info</td></tr></table>";
    mockFetchBytes(new TextEncoder().encode(emptyHtml));
    const result = await new NewTaipeiHashAdapter().fetch(makeSource(), { days: 365 });
    expect(result.events).toEqual([]);
    expect(result.errors.some((e) => e.includes("parsed 0 events"))).toBe(true);
  });
});
