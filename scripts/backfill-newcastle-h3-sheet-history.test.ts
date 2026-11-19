import type { RawEventData } from "@/adapters/types";
import { redactPersonalData } from "@/lib/audit-redact";
import { checkRowDates, checkRowRouting, checkRowShape, checkRunOrder } from "@/lib/backfill/guards";
import { scanArchiveForPii } from "@/lib/backfill/pii";
import history from "./data/newcastle-h3-sheet-history.json";

const rows = history as RawEventData[];
const LIVE_ADAPTER_START = "2026-01-04"; // the live source reads the 2026 tab from here on

/** Indexes of rows with any public text field matching `bad`. */
function rowsWhere(bad: (text: string) => boolean): number[] {
  return rows.flatMap((r, i) =>
    [r.hares, r.location, r.locationStreet, r.description].some((s) => s && bad(s)) ? [i] : [],
  );
}

describe("newcastle-h3 sheet archive (frozen)", () => {
  it("has the expected volume and start", () => {
    expect(rows.length).toBe(666);
    expect(rows[0].date).toBe("2014-01-01");
  });

  it("passes the shared backfill row guards", () => {
    expect(checkRowDates(rows, LIVE_ADAPTER_START, LIVE_ADAPTER_START)).toEqual([]);
    expect(checkRowRouting(rows, "newcastle-h3")).toEqual([]);
    expect(checkRowShape(rows)).toEqual([]);
    expect(checkRunOrder(rows)).toEqual([]);
  });

  it("every row is numbered and uniquely dated", () => {
    expect(rows.filter((r) => !Number.isInteger(r.runNumber)).map((r) => r.date)).toEqual([]);
    expect(new Set(rows.map((r) => r.date)).size).toBe(rows.length);
  });

  it("only runs on plausible days (Wed/Sun plus known weekend events)", () => {
    const wedSun = rows.filter((r) => [0, 3].includes(new Date(`${r.date}T12:00:00Z`).getUTCDay()));
    expect(wedSun.length / rows.length).toBeGreaterThan(0.9);
  });

  it("applies the confirmed date fixes", () => {
    const byRun = new Map(rows.map((r) => [r.runNumber, r.date]));
    expect(byRun.get(1328)).toBe("2016-02-17");
    expect(byRun.get(1640)).toBe("2021-10-20");
    expect(byRun.get(1628)).toBe("2021-08-11");
    expect(byRun.get(1469)).toBe("2018-03-04");
  });

  it("contains no personal data, HTML or scrub placeholders", () => {
    expect(scanArchiveForPii(rows)).toEqual([]);
    // The site scrubber also knows UK national formats ("0191 2345678", "07700 900123") that G8 misses.
    expect(rowsWhere((s) => redactPersonalData(s).redactions > 0)).toEqual([]);
    expect(rowsWhere((s) => /<[^>]+>|\[(?:email|phone)[^\]]*\]/i.test(s))).toEqual([]);
  });
});
