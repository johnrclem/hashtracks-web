import history from "./data/newcastle-h3-sheet-history.json";

type Row = { date: string; kennelTags: string[]; runNumber?: number; hares?: string; location?: string; locationStreet?: string; description?: string };
const rows = history as Row[];

describe("newcastle-h3 sheet archive (frozen)", () => {
  it("has the expected volume and range", () => {
    expect(rows.length).toBe(666);
    expect(rows[0].date).toBe("2014-01-01");
    expect(rows.at(-1)!.date < "2026-01-04").toBe(true);
  });

  it("every row is numbered, single-kennel and uniquely dated", () => {
    const dates = new Set<string>();
    for (const r of rows) {
      expect(r.kennelTags).toEqual(["newcastle-h3"]);
      expect(Number.isInteger(r.runNumber)).toBe(true);
      expect(r.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(dates.has(r.date)).toBe(false);
      dates.add(r.date);
    }
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

  it("contains no emails, phone numbers or HTML", () => {
    const blob = rows.flatMap((r) => [r.hares, r.location, r.locationStreet, r.description]).filter(Boolean) as string[];
    for (const s of blob) {
      expect(s).not.toMatch(/[\w.+-]+@[\w-]+\.[\w.-]+/);
      expect(s).not.toMatch(/\d{3}[\s.-]\d{3}[\s.-]\d{4}|\(\d{3}\)\s*\d{3}|\b\d{10,}\b|\b\d{3}[\s-]\d{4}\b/);
      expect(s).not.toMatch(/<[^>]+>/);
    }
  });
});
