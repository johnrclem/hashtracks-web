import {
  LAST_VISIT_STORAGE_KEY,
  classifyVisit,
  daysBetween,
  localDateKey,
  readAndRecordVisit,
} from "./visit-recency";

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
    data,
  };
}

describe("localDateKey", () => {
  it("formats the local calendar date with zero padding", () => {
    expect(localDateKey(new Date(2026, 0, 5, 23, 59))).toBe("2026-01-05");
  });
});

describe("daysBetween", () => {
  it("counts whole days across month and year boundaries", () => {
    expect(daysBetween("2026-11-09", "2026-11-10")).toBe(1);
    expect(daysBetween("2026-12-31", "2027-01-01")).toBe(1);
    expect(daysBetween("2026-10-10", "2026-11-10")).toBe(31);
  });

  it("is unaffected by daylight-saving changes", () => {
    expect(daysBetween("2026-03-07", "2026-03-09")).toBe(2);
    expect(daysBetween("2026-10-31", "2026-11-02")).toBe(2);
  });

  it("returns null for malformed input", () => {
    expect(daysBetween("yesterday", "2026-11-10")).toBeNull();
    expect(daysBetween("2026-11-10", "")).toBeNull();
  });
});

describe("classifyVisit", () => {
  const today = "2026-11-10";

  it("treats a missing or malformed date as a new visitor", () => {
    expect(classifyVisit(null, today)).toEqual({ recency: "new", firstVisitToday: true });
    expect(classifyVisit("garbage", today)).toEqual({ recency: "new", firstVisitToday: true });
  });

  it("does not count a second load on the same day as a new daily visit", () => {
    expect(classifyVisit(today, today)).toEqual({ recency: "same_day", firstVisitToday: false });
  });

  it.each([
    ["2026-11-09", "returning_1_7d"],
    ["2026-11-03", "returning_1_7d"],
    ["2026-11-02", "returning_8_30d"],
    ["2026-10-11", "returning_8_30d"],
    ["2026-10-10", "returning_31d_plus"],
  ] as const)("classifies a last visit on %s as %s", (last, recency) => {
    expect(classifyVisit(last, today)).toEqual({ recency, firstVisitToday: true });
  });

  it("counts a future stored date (clock change) as a recent return", () => {
    expect(classifyVisit("2026-11-12", today)).toEqual({ recency: "returning_1_7d", firstVisitToday: true });
  });
});

describe("readAndRecordVisit", () => {
  const now = new Date(2026, 10, 10, 9, 30);

  it("records today's date and reports a new visitor on first load", () => {
    const storage = memoryStorage();
    expect(readAndRecordVisit(storage, now)).toEqual({ recency: "new", firstVisitToday: true });
    expect(storage.data.get(LAST_VISIT_STORAGE_KEY)).toBe("2026-11-10");
  });

  it("reports a return and moves the stored date forward", () => {
    const storage = memoryStorage({ [LAST_VISIT_STORAGE_KEY]: "2026-11-04" });
    expect(readAndRecordVisit(storage, now)).toEqual({ recency: "returning_1_7d", firstVisitToday: true });
    expect(storage.data.get(LAST_VISIT_STORAGE_KEY)).toBe("2026-11-10");
  });

  it("stores only a date, never an identifier", () => {
    const storage = memoryStorage();
    readAndRecordVisit(storage, now);
    expect([...storage.data.keys()]).toEqual([LAST_VISIT_STORAGE_KEY]);
    expect(storage.data.get(LAST_VISIT_STORAGE_KEY)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("reports unknown when storage is missing or throws", () => {
    expect(readAndRecordVisit(null, now)).toEqual({ recency: "unknown", firstVisitToday: undefined });
    const throwing = {
      getItem: () => {
        throw new Error("SecurityError");
      },
      setItem: () => {},
    };
    expect(readAndRecordVisit(throwing, now)).toEqual({ recency: "unknown", firstVisitToday: undefined });
  });
});
