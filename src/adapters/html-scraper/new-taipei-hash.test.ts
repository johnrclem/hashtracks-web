import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Source } from "@/generated/prisma/client";
import { NewTaipeiHashAdapter, mapNth3Run, mergeDetail, type Nth3ApiRun } from "./new-taipei-hash";

vi.mock("@/adapters/safe-fetch", () => ({ safeFetch: vi.fn() }));
const { safeFetch } = await import("@/adapters/safe-fetch");
const mockedSafeFetch = vi.mocked(safeFetch);

const SOURCE_URL = "https://nth3.taipeihash.com.tw/";

// Trimmed from live GET https://nth3.taipeihash.com.tw/api/runs?page=1&limit=50 (2026-11-05).
const RUN_711: Nth3ApiRun = {
  run_number: 711,
  run_date: "2026-11-08",
  start_time: "14:30:00",
  loc_name: "三峽區",
  loc_name_en: "Sanxia District",
  loc_place: "插角里6鄰插角 141 號(109縣道約11.5公里處的農舍)",
  loc_place_en: "No. 141, Chajiao, Sanxia Dist., New Taipei City 237128, Taiwan (R.O.C.)",
  special_note: null,
  status: "upcoming",
  hare_name: "Mijo Slut",
  hare_name_zh: null,
  cohare_name: null,
  cohare_name_zh: null,
};
const RUN_712: Nth3ApiRun = {
  run_number: 712,
  run_date: "2026-11-15",
  start_time: "14:30:00",
  loc_name: "新店區",
  loc_name_en: "Xindian District",
  loc_place: "碧潭馬公友誼公園",
  loc_place_en: "Magong Friendship Park",
  status: "upcoming",
  hare_name: "MDFK LAaaaa",
  cohare_name: "Fast Gunner",
};
const RUN_714: Nth3ApiRun = {
  run_number: 714,
  run_date: "2026-11-29",
  start_time: "14:30:00",
  loc_name: "土城區",
  loc_name_en: "Tucheng District",
  loc_place: "土城線型公園",
  loc_place_en: "Tucheng Linear Park",
  special_note: "年會",
  status: "upcoming",
  hare_name: "Kiss my ass",
  cohare_name: "Longsanity",
};
const RUN_717: Nth3ApiRun = {
  run_number: 717,
  run_date: "2026-12-20",
  start_time: "14:30:00",
  loc_name: "九份",
  loc_name_en: "",
  loc_place: "",
  loc_place_en: "",
  status: "upcoming",
  hare_name: null,
  cohare_name: null,
};
const RUN_670_ZH: Nth3ApiRun = {
  run_number: 670,
  run_date: "2026-01-25",
  start_time: "15:00:00",
  loc_name: "林口",
  status: "completed",
  hare_name: null,
  hare_name_zh: "陳文旭",
  cohare_name: null,
  cohare_name_zh: "許哲瑋",
};
// Live /api/runs/this-week detail fields (description shortened).
const THIS_WEEK_711: Nth3ApiRun = {
  ...RUN_711,
  loc_map_url: "https://maps.app.goo.gl/1QKDA1A5TzoXFt18A?utm_source=chatgpt.com",
  bash_place: "綠竹鄉土雞城",
  bash_place_en: null,
  event_link: null,
  description: "point這個區域是全新的路線，之前沒有使用過。",
};

describe("mapNth3Run", () => {
  it("maps an upcoming run (EN fields preferred, district qualifies a bare venue)", () => {
    expect(mapNth3Run(RUN_712, SOURCE_URL)).toEqual({
      date: "2026-11-15",
      kennelTags: ["nth3-tw"],
      runNumber: 712,
      title: undefined,
      hares: "Fast Gunner, MDFK LAaaaa",
      location: "Magong Friendship Park, Xindian District",
      countryOverride: undefined,
      locationUrl: undefined,
      startTime: "14:30",
      description: undefined,
      externalLinks: undefined,
      sourceUrl: SOURCE_URL,
    });
  });

  it("does not re-append the district when the address already names it", () => {
    expect(mapNth3Run(RUN_711, SOURCE_URL)?.location).toBe(
      "No. 141, Chajiao, Sanxia Dist., New Taipei City 237128, Taiwan (R.O.C.)",
    );
    expect(mapNth3Run(RUN_714, SOURCE_URL)?.location).toBe("Tucheng Linear Park");
  });

  it("sets countryOverride for overseas specials", () => {
    const run = { ...RUN_714, loc_name: "泰國 清邁", loc_name_en: "", loc_place: "", loc_place_en: "" };
    expect(mapNth3Run(run, SOURCE_URL)?.countryOverride).toBe("");
    expect(mapNth3Run(RUN_714, SOURCE_URL)?.countryOverride).toBeUndefined();
  });

  it("uses special_note as the title", () => {
    expect(mapNth3Run(RUN_714, SOURCE_URL)?.title).toBe("年會");
  });

  it("falls back to Chinese names and area-only location", () => {
    const zh = mapNth3Run(RUN_670_ZH, SOURCE_URL);
    expect(zh).toMatchObject({ hares: "許哲瑋, 陳文旭", location: "林口", startTime: "15:00" });
    const bare = mapNth3Run(RUN_717, SOURCE_URL);
    expect(bare).toMatchObject({ runNumber: 717, location: "九份" });
    expect(bare?.hares).toBeUndefined();
  });

  it("strips utm params from the maps link and adds the on-after to the description", () => {
    const event = mapNth3Run(THIS_WEEK_711, SOURCE_URL);
    expect(event?.locationUrl).toBe("https://maps.app.goo.gl/1QKDA1A5TzoXFt18A");
    expect(event?.description).toBe("point這個區域是全新的路線，之前沒有使用過。\n\nOn-after: 綠竹鄉土雞城");
  });

  it("rejects rows with a bad date or a non-run status", () => {
    expect(mapNth3Run({ ...RUN_712, run_date: "2026/11/15" }, SOURCE_URL)).toBeNull();
    expect(mapNth3Run({ ...RUN_712, status: "cancelled" }, SOURCE_URL)).toBeNull();
  });
});

describe("mergeDetail", () => {
  it("overlays defined detail fields onto the same-date list row", () => {
    const list = [mapNth3Run(RUN_711, SOURCE_URL)!, mapNth3Run(RUN_712, SOURCE_URL)!];
    const merged = mergeDetail(list, mapNth3Run(THIS_WEEK_711, SOURCE_URL)!);
    expect(merged).toHaveLength(2);
    expect(merged[0].locationUrl).toBe("https://maps.app.goo.gl/1QKDA1A5TzoXFt18A");
    expect(merged[0].hares).toBe("Mijo Slut");
    expect(merged[1]).toEqual(list[1]);
  });
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function daysFromNow(n: number): string {
  return new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
}

describe("NewTaipeiHashAdapter.fetch", () => {
  const source = { id: "s1", url: SOURCE_URL, scrapeDays: 365, config: { upcomingOnly: true } } as unknown as Source;

  beforeEach(() => {
    mockedSafeFetch.mockReset();
  });

  it("pages the list until it passes the window start, then merges this-week detail", async () => {
    const page1 = [
      { ...RUN_712, run_date: daysFromNow(10) },
      { ...RUN_711, run_date: daysFromNow(3) },
      { ...RUN_670_ZH, run_date: daysFromNow(-100) },
    ];
    const page2 = [{ ...RUN_670_ZH, run_number: 300, run_date: daysFromNow(-400) }];
    mockedSafeFetch.mockImplementation(async (url) => {
      const u = String(url);
      if (u.includes("this-week")) return jsonResponse({ data: { run: { ...THIS_WEEK_711, run_date: daysFromNow(3) } } });
      if (u.includes("page=1")) return jsonResponse({ data: { runs: page1, pagination: { total_pages: 15 } } });
      if (u.includes("page=2")) return jsonResponse({ data: { runs: page2, pagination: { total_pages: 15 } } });
      throw new Error(`unexpected ${u}`);
    });

    const result = await new NewTaipeiHashAdapter().fetch(source, { days: 365 });
    expect(result.errors).toEqual([]);
    // page 2's oldest row (−400d) is past the window start → stop; it is windowed out.
    expect(mockedSafeFetch.mock.calls.filter(([u]) => String(u).includes("page=")).length).toBe(2);
    expect(result.events.map((e) => e.runNumber)).toEqual([712, 711, 670]);
    expect(result.events.find((e) => e.runNumber === 711)?.locationUrl).toBe(
      "https://maps.app.goo.gl/1QKDA1A5TzoXFt18A",
    );
  });

  it("fails loud on an unexpected payload shape", async () => {
    mockedSafeFetch.mockImplementation(async (url) =>
      String(url).includes("this-week") ? jsonResponse({ data: { run: null } }) : jsonResponse({ ok: true }),
    );
    const result = await new NewTaipeiHashAdapter().fetch(source, { days: 365 });
    expect(result.events).toEqual([]);
    expect(result.errors[0]).toMatch(/unexpected payload shape/);
  });

  it("surfaces an HTTP error from the list endpoint", async () => {
    mockedSafeFetch.mockImplementation(async () => jsonResponse({}, 500));
    const result = await new NewTaipeiHashAdapter().fetch(source, { days: 365 });
    expect(result.events).toEqual([]);
    expect(result.errors[0]).toMatch(/Run list page 1 failed: Error: HTTP 500/);
  });
});
