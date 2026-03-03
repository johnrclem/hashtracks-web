import {
  fetchKennelProfile,
  fetchKennelProfiles,
  buildScheduleString,
  buildPaymentInfo,
  normalizeTrailDay,
  type HashRegoKennelProfile,
} from "./kennel-api";

function buildProfile(overrides: Partial<HashRegoKennelProfile> = {}): HashRegoKennelProfile {
  return {
    name: "Everyday Is Wednesday H3",
    slug: "EWH3",
    email: "EWH3GMs@gmail.com",
    website: "https://www.ewh3.com/",
    year_started: 1999,
    trail_frequency: "Weekly",
    trail_day: "Wednesdays",
    trail_price: 10,
    city: "Washington",
    state: "DC",
    country: "USA",
    logo_image_url: "https://s3.amazonaws.com/hashrego/logos/ewh3.png",
    member_count: 283,
    has_paypal: true,
    opt_paypal_email: "ewh3@paypal.com",
    has_venmo: true,
    opt_venmo_account: "@EWH3",
    has_square_cash: false,
    opt_square_cashtag: "",
    is_active: true,
    ...overrides,
  };
}

describe("fetchKennelProfile", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns profile data on success", async () => {
    const profile = buildProfile();
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => profile,
    } as Response);

    const result = await fetchKennelProfile("EWH3");
    expect(result).toEqual(profile);
    expect(fetch).toHaveBeenCalledWith(
      "https://hashrego.com/api/kennels/EWH3",
      expect.objectContaining({
        headers: expect.objectContaining({ Accept: "application/json" }),
      }),
    );
  });

  it("returns null on 404", async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: false, status: 404 } as Response);
    expect(await fetchKennelProfile("NONEXISTENT")).toBeNull();
  });

  it("returns null on network error", async () => {
    vi.mocked(fetch).mockRejectedValue(new Error("Network error"));
    expect(await fetchKennelProfile("EWH3")).toBeNull();
  });
});

describe("fetchKennelProfiles", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("fetches multiple profiles in batches", async () => {
    const slugs = ["A", "B", "C", "D", "E", "F", "G"];
    const profileA = buildProfile({ slug: "A", name: "A H3" });
    const profileF = buildProfile({ slug: "F", name: "F H3" });

    vi.mocked(fetch).mockImplementation(async (url) => {
      const slug = String(url).split("/").pop();
      if (slug === "A" || slug === "F") {
        return { ok: true, json: async () => (slug === "A" ? profileA : profileF) } as Response;
      }
      return { ok: false, status: 404 } as Response;
    });

    const promise = fetchKennelProfiles(slugs);
    // Advance timers for the inter-batch delay
    await vi.advanceTimersByTimeAsync(2000);
    const results = await promise;

    expect(results.size).toBe(2);
    expect(results.get("A")?.name).toBe("A H3");
    expect(results.get("F")?.name).toBe("F H3");
    // 7 slugs = 2 batches of 5 and 2 (all 7 individual calls)
    expect(fetch).toHaveBeenCalledTimes(7);
  });
});

describe("buildScheduleString", () => {
  it("combines frequency and day", () => {
    expect(buildScheduleString("Weekly", "Wednesdays")).toBe("Weekly, Wednesdays");
  });

  it("handles frequency only", () => {
    expect(buildScheduleString("Monthly", null)).toBe("Monthly");
  });

  it("handles day only", () => {
    expect(buildScheduleString(null, "Saturdays")).toBe("Saturdays");
  });

  it("returns undefined when both are null", () => {
    expect(buildScheduleString(null, null)).toBeUndefined();
  });
});

describe("buildPaymentInfo", () => {
  it("builds payment info with all methods", () => {
    const profile = buildProfile();
    const info = buildPaymentInfo(profile);
    expect(info).toEqual({
      paypal: "ewh3@paypal.com",
      venmo: "@EWH3",
    });
  });

  it("returns null when no payment methods", () => {
    const profile = buildProfile({
      has_paypal: false,
      has_venmo: false,
      has_square_cash: false,
    });
    expect(buildPaymentInfo(profile)).toBeNull();
  });

  it("includes square cash when available", () => {
    const profile = buildProfile({
      has_paypal: false,
      has_venmo: false,
      has_square_cash: true,
      opt_square_cashtag: "$EWH3",
    });
    expect(buildPaymentInfo(profile)).toEqual({ squareCash: "$EWH3" });
  });
});

describe("normalizeTrailDay", () => {
  it("removes trailing s from plural day names", () => {
    expect(normalizeTrailDay("Thursdays")).toBe("Thursday");
    expect(normalizeTrailDay("Saturdays")).toBe("Saturday");
    expect(normalizeTrailDay("Wednesdays")).toBe("Wednesday");
  });

  it("returns undefined for null", () => {
    expect(normalizeTrailDay(null)).toBeUndefined();
  });

  it("handles already-singular day names", () => {
    expect(normalizeTrailDay("Monday")).toBe("Monday");
  });

  it("trims whitespace", () => {
    expect(normalizeTrailDay("  Fridays  ")).toBe("Friday");
  });
});
