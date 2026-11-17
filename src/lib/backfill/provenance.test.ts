import { readFileSync, readdirSync } from "node:fs";
import { describe, it, expect } from "vitest";
import { calendarIdFromEventUrl, checkRowProvenance, sheetId, websiteHosts } from "./provenance";

/** Real archives committed under scripts/data (design section 13, Phase 0 exit). */
function archiveUrls(file: string, field = "sourceUrl"): Array<string | undefined> {
  const rows = JSON.parse(readFileSync(`scripts/data/${file}`, "utf8")) as Array<Record<string, string | undefined>>;
  return rows.map((r) => r[field]);
}

const NONE = new Set<string>();

describe("provenance against real archives", () => {
  it("Google Sheets: Zagreb H4's 716 rows all name the origin sheet", () => {
    const origin = { type: "GOOGLE_SHEETS" as const, url: "https://docs.google.com/spreadsheets/d/1lYHbq66X4aPfirLQR0jBtVsYIX3qLTwgEpOQo1FgM-M", config: null };
    const urls = archiveUrls("zh4-history.json");
    expect(urls).toHaveLength(716);
    expect(checkRowProvenance(origin, urls, NONE)).toEqual({ ok: true });
    const other = { ...origin, url: "https://docs.google.com/spreadsheets/d/OTHER_SHEET_ID_1234567890" };
    expect(checkRowProvenance(other, urls, NONE)).toMatchObject({ ok: false, supervised: false });
  });

  it("Google Calendar: Hill Country H3's event links decode to the origin calendar", () => {
    const origin = { type: "GOOGLE_CALENDAR" as const, url: "i98lot5sfibirmdp9kjp8jn604@group.calendar.google.com", config: null };
    const urls = archiveUrls("hch3-history.json");
    expect(urls.length).toBeGreaterThan(1000);
    expect(checkRowProvenance(origin, urls, NONE)).toEqual({ ok: true });
    const other = { ...origin, url: "someone-else@group.calendar.google.com" };
    const result = checkRowProvenance(other, urls, NONE);
    expect(result.ok).toBe(false);
    expect(!result.ok && !result.supervised && result.failures.every((f) => f.reason === "other-calendar")).toBe(true);
  });

  it("Meetup: Asheville H3's event URLs sit under the origin group", () => {
    const origin = { type: "MEETUP" as const, url: "https://www.meetup.com/AVLH3-On-On/", config: { groupUrlname: "AVLH3-On-On" } };
    const files = readdirSync("scripts/data").filter((f) => f.startsWith("avlh3-meetup-history-batch-"));
    const urls = files.flatMap((f) => archiveUrls(f, "url"));
    expect(urls.length).toBeGreaterThan(500);
    // Every row with a link is the group's; the one row captured without a link fails, as it must.
    const result = checkRowProvenance(origin, urls, NONE);
    expect(result).toMatchObject({ ok: false, supervised: false, failures: [{ reason: "no-url" }] });
    expect(checkRowProvenance(origin, urls.filter(Boolean), NONE)).toEqual({ ok: true });
    expect(checkRowProvenance({ ...origin, config: { groupUrlname: "other-group" } }, urls, NONE).ok).toBe(false);
  });

  it("Website: Music City H3's run pages sit on the origin host, unless that host serves another kennel", () => {
    const origin = { type: "HTML_SCRAPER" as const, url: "https://musiccityhash.com", config: null };
    const urls = archiveUrls("mch3-tn-history.json");
    expect(checkRowProvenance(origin, urls, NONE)).toEqual({ ok: true });
    expect(checkRowProvenance(origin, urls, new Set(["musiccityhash.com"]))).toEqual({ ok: false, supervised: true, reason: "shared-host" });
  });
});

describe("provenance rules", () => {
  it("extracts sheet ids from URLs and bare ids", () => {
    expect(sheetId("https://docs.google.com/spreadsheets/d/abcDEF_123-xyz/edit#gid=0")).toBe("abcDEF_123-xyz");
    expect(sheetId("not a sheet")).toBeNull();
  });

  it("expands every short calendar domain", () => {
    const link = (s: string) => `https://www.google.com/calendar/event?eid=${Buffer.from(s).toString("base64url")}`;
    expect(calendarIdFromEventUrl(link("evt1 abc@g"))).toBe("abc@group.calendar.google.com");
    expect(calendarIdFromEventUrl(link("evt1 someone@m"))).toBe("someone@gmail.com");
    expect(calendarIdFromEventUrl(link("evt1 x@v"))).toBe("x@group.v.calendar.google.com");
    expect(calendarIdFromEventUrl(link("evt1 y@i"))).toBe("y@import.calendar.google.com");
    expect(calendarIdFromEventUrl("https://example.org/no-eid")).toBeNull();
  });

  it("website: requires the origin's path prefix and query parameters", () => {
    const origin = { type: "HTML_SCRAPER" as const, url: "https://ex.org/kennel/runs.php?k=9", config: null };
    const result = checkRowProvenance(origin, [
      "https://www.ex.org/kennel/run-1?k=9",
      "https://ex.org/other/run-2?k=9",
      "https://ex.org/kennel/run-3?k=8",
      "https://evil.org/kennel/run-4?k=9",
      undefined,
    ], NONE);
    expect(result).toEqual({
      ok: false,
      supervised: false,
      failures: [
        { row: 1, reason: "outside-path" },
        { row: 2, reason: "query-mismatch" },
        { row: 3, reason: "other-host" },
        { row: 4, reason: "no-url" },
      ],
    });
  });

  it("supervises types with no rule", () => {
    for (const type of ["FACEBOOK_HOSTED_EVENTS", "HARRIER_CENTRAL", "HASHREGO", "ICAL_FEED", "STATIC_SCHEDULE"] as const) {
      expect(checkRowProvenance({ type, url: "https://x", config: null }, ["https://x/1"], NONE)).toEqual({
        ok: false, supervised: true, reason: "unsupported-type",
      });
    }
  });

  it("websiteHosts ignores calendar and sheet ids", () => {
    expect([...websiteHosts(["https://www.sfh3.com/x", "abc@group.calendar.google.com", "1lYHbq66X4aPfirLQR0jBtVsYIX3qLTwgEpOQo1FgM-M"])]).toEqual(["sfh3.com"]);
  });
});
