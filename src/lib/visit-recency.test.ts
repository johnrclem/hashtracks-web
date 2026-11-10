import {
  LAST_VISIT_STORAGE_KEY,
  classifyVisit,
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

describe("classifyVisit", () => {
  const today = "2026-11-10";

  it("treats a missing or malformed date as a new visitor", () => {
    expect(classifyVisit(null, today)).toBe("new");
    expect(classifyVisit("garbage", today)).toBe("new");
  });

  it("recognizes a second load on the same day", () => {
    expect(classifyVisit(today, today)).toBe("same_day");
  });

  it.each([
    ["2026-11-09", "returning_1_7d"],
    ["2026-11-03", "returning_1_7d"],
    ["2026-11-02", "returning_8_30d"],
    ["2026-10-11", "returning_8_30d"],
    ["2026-10-10", "returning_31d_plus"],
    ["2025-12-31", "returning_31d_plus"],
  ] as const)("classifies a last visit on %s as %s", (last, recency) => {
    expect(classifyVisit(last, today)).toBe(recency);
  });

  it("is unaffected by daylight-saving changes", () => {
    expect(classifyVisit("2026-03-01", "2026-03-09")).toBe("returning_8_30d");
    expect(classifyVisit("2026-10-26", "2026-11-02")).toBe("returning_1_7d");
  });

  it("counts a future stored date (clock change) as a recent return", () => {
    expect(classifyVisit("2026-11-12", today)).toBe("returning_1_7d");
  });
});

describe("readAndRecordVisit", () => {
  const now = new Date(2026, 10, 10, 9, 30);

  it("records today's local date and reports a new visitor on first load", () => {
    const storage = memoryStorage();
    expect(readAndRecordVisit(storage, now)).toBe("new");
    expect(storage.data.get(LAST_VISIT_STORAGE_KEY)).toBe("2026-11-10");
  });

  it("reports a return and moves the stored date forward", () => {
    const storage = memoryStorage({ [LAST_VISIT_STORAGE_KEY]: "2026-11-04" });
    expect(readAndRecordVisit(storage, now)).toBe("returning_1_7d");
    expect(storage.data.get(LAST_VISIT_STORAGE_KEY)).toBe("2026-11-10");
  });

  it("stores only a date, never an identifier", () => {
    const storage = memoryStorage();
    readAndRecordVisit(storage, now);
    expect([...storage.data.keys()]).toEqual([LAST_VISIT_STORAGE_KEY]);
    expect(storage.data.get(LAST_VISIT_STORAGE_KEY)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("reports unknown when storage is missing or throws", () => {
    expect(readAndRecordVisit(null, now)).toBe("unknown");
    const throwing = {
      getItem: () => {
        throw new Error("SecurityError");
      },
      setItem: () => {},
    };
    expect(readAndRecordVisit(throwing, now)).toBe("unknown");
  });
});

describe("nextPageviewVisitProperties", () => {
  // Module state is per page load; load a fresh copy per test with a fake localStorage.
  let storage: ReturnType<typeof memoryStorage>;
  let mod: typeof import("./visit-recency");

  beforeEach(async () => {
    storage = memoryStorage();
    vi.stubGlobal("window", { localStorage: storage });
    vi.resetModules();
    mod = await import("./visit-recency");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const nov10 = new Date(2026, 10, 10, 9, 0);
  const nov10Later = new Date(2026, 10, 10, 21, 0);
  const nov11 = new Date(2026, 10, 11, 8, 0);

  it("marks only the first pageview of the day as the first visit", () => {
    expect(mod.nextPageviewVisitProperties(nov10)).toEqual({ first_visit_today: true });
    expect(mod.nextPageviewVisitProperties(nov10Later)).toEqual({ first_visit_today: false });
  });

  it("does not count a reload when an earlier page load already counted today", () => {
    storage.data.set(LAST_VISIT_STORAGE_KEY, "2026-11-10");
    expect(mod.getVisitRecency(nov10)).toBe("same_day");
    expect(mod.nextPageviewVisitProperties(nov10)).toEqual({ first_visit_today: false });
  });

  it("counts a new day in a tab left open overnight", () => {
    expect(mod.nextPageviewVisitProperties(nov10)).toEqual({ first_visit_today: true });
    expect(mod.getVisitRecency(nov11)).toBe("returning_1_7d");
    expect(mod.nextPageviewVisitProperties(nov11)).toEqual({ first_visit_today: true });
    expect(storage.data.get(LAST_VISIT_STORAGE_KEY)).toBe("2026-11-11");
  });

  it("omits the property when storage is unavailable", async () => {
    vi.stubGlobal("window", {});
    vi.resetModules();
    const fresh = await import("./visit-recency");
    expect(fresh.nextPageviewVisitProperties(nov10)).toEqual({});
  });
});
