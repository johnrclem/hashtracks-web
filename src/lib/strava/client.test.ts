import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  getStravaAuthUrl,
  parseStravaActivity,
  buildStravaUrl,
  extractStravaActivityId,
  exchangeStravaCode,
  refreshStravaToken,
  deauthorizeStrava,
  fetchStravaActivities,
} from "./client";
import type { StravaApiActivity } from "./types";

// Mock prisma (needed for getValidAccessToken, not used in these tests)
vi.mock("@/lib/db", () => ({
  prisma: {
    stravaConnection: { update: vi.fn() },
  },
}));

beforeEach(() => {
  vi.stubEnv("STRAVA_CLIENT_ID", "test-client-id");
  vi.stubEnv("STRAVA_CLIENT_SECRET", "test-client-secret");
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://hashtracks.com");
});

// ── getStravaAuthUrl ──

describe("getStravaAuthUrl", () => {
  it("generates a valid Strava authorization URL with all required params", () => {
    const url = getStravaAuthUrl("csrf-state-123");
    const parsed = new URL(url);

    expect(parsed.origin).toBe("https://www.strava.com");
    expect(parsed.pathname).toBe("/oauth/authorize");
    expect(parsed.searchParams.get("client_id")).toBe("test-client-id");
    expect(parsed.searchParams.get("redirect_uri")).toBe(
      "https://hashtracks.com/api/auth/strava/callback",
    );
    expect(parsed.searchParams.get("response_type")).toBe("code");
    expect(parsed.searchParams.get("scope")).toBe("activity:read_all");
    expect(parsed.searchParams.get("state")).toBe("csrf-state-123");
  });

  it("uses localhost redirect URI when NEXT_PUBLIC_APP_URL is not set", () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "");
    const url = getStravaAuthUrl("state");
    expect(url).toContain("http%3A%2F%2Flocalhost%3A3000");
  });
});

// ── parseStravaActivity ──

describe("parseStravaActivity", () => {
  const baseActivity: StravaApiActivity = {
    id: 12345678901,
    name: "Saturday Morning Hash",
    sport_type: "Run",
    start_date_local: "2026-02-14T10:30:00Z", // Fake Z suffix!
    distance: 8200.5,
    moving_time: 3600,
    start_latlng: [40.748, -73.985],
    timezone: "(GMT-05:00) America/New_York",
    map: { summary_polyline: "abc123" },
  };

  it("extracts dateLocal as string (not Date), preserving local time", () => {
    const result = parseStravaActivity(baseActivity);
    expect(result.dateLocal).toBe("2026-02-14");
    expect(typeof result.dateLocal).toBe("string");
  });

  it("extracts timeLocal as HH:MM string", () => {
    const result = parseStravaActivity(baseActivity);
    expect(result.timeLocal).toBe("10:30");
  });

  it("converts activity ID to string", () => {
    const result = parseStravaActivity(baseActivity);
    expect(result.stravaActivityId).toBe("12345678901");
    expect(typeof result.stravaActivityId).toBe("string");
  });

  it("uses sport_type field", () => {
    const result = parseStravaActivity(baseActivity);
    expect(result.sportType).toBe("Run");
  });

  it("preserves valid start_latlng coordinates", () => {
    const result = parseStravaActivity(baseActivity);
    expect(result.startLat).toBe(40.748);
    expect(result.startLng).toBe(-73.985);
  });

  it("handles null start_latlng (privacy zone)", () => {
    const activity = { ...baseActivity, start_latlng: null };
    const result = parseStravaActivity(activity);
    expect(result.startLat).toBeNull();
    expect(result.startLng).toBeNull();
  });

  it("treats [0, 0] as null (privacy zone fallback)", () => {
    const activity = {
      ...baseActivity,
      start_latlng: [0, 0] as [number, number],
    };
    const result = parseStravaActivity(activity);
    expect(result.startLat).toBeNull();
    expect(result.startLng).toBeNull();
  });

  it("preserves distance and moving time", () => {
    const result = parseStravaActivity(baseActivity);
    expect(result.distanceMeters).toBe(8200.5);
    expect(result.movingTimeSecs).toBe(3600);
  });

  it("handles empty timezone", () => {
    const activity = { ...baseActivity, timezone: "" };
    const result = parseStravaActivity(activity);
    expect(result.timezone).toBeNull();
  });

  it("handles midnight time correctly", () => {
    const activity = {
      ...baseActivity,
      start_date_local: "2026-12-31T00:00:00Z",
    };
    const result = parseStravaActivity(activity);
    expect(result.dateLocal).toBe("2026-12-31");
    expect(result.timeLocal).toBe("00:00");
  });
});

// ── URL utilities ──

describe("buildStravaUrl", () => {
  it("builds canonical Strava activity URL", () => {
    expect(buildStravaUrl("12345678")).toBe(
      "https://www.strava.com/activities/12345678",
    );
  });
});

describe("extractStravaActivityId", () => {
  it("extracts ID from standard URL", () => {
    expect(
      extractStravaActivityId(
        "https://www.strava.com/activities/12345678",
      ),
    ).toBe("12345678");
  });

  it("extracts ID from URL without www", () => {
    expect(
      extractStravaActivityId("https://strava.com/activities/12345678"),
    ).toBe("12345678");
  });

  it("returns null for non-Strava URLs", () => {
    expect(
      extractStravaActivityId("https://garmin.com/activity/123"),
    ).toBeNull();
  });

  it("returns null for malformed URLs", () => {
    expect(extractStravaActivityId("not-a-url")).toBeNull();
  });
});

// ── API calls (with mocked fetch) ──

describe("exchangeStravaCode", () => {
  it("sends correct payload and returns token response", async () => {
    const mockResponse = {
      access_token: "at_123",
      refresh_token: "rt_456",
      expires_at: 1700000000,
      athlete: { id: 999, firstname: "Test", lastname: "User", profile: "" },
    };

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      }),
    );

    const result = await exchangeStravaCode("auth-code-123");
    expect(result).toEqual(mockResponse);

    const fetchCall = vi.mocked(fetch).mock.calls[0];
    expect(fetchCall[0]).toBe("https://www.strava.com/oauth/token");
    const body = JSON.parse(fetchCall[1]!.body as string);
    expect(body.grant_type).toBe("authorization_code");
    expect(body.code).toBe("auth-code-123");
    expect(body.client_id).toBe("test-client-id");
    expect(body.client_secret).toBe("test-client-secret");
  });

  it("throws on non-OK response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        text: () => Promise.resolve("bad request"),
      }),
    );

    await expect(exchangeStravaCode("bad")).rejects.toThrow(
      "Strava token exchange failed (400)",
    );
  });
});

describe("refreshStravaToken", () => {
  it("sends refresh_token grant type", async () => {
    const mockResponse = {
      access_token: "new_at",
      refresh_token: "new_rt",
      expires_at: 1700000000,
      athlete: { id: 999, firstname: "Test", lastname: "User", profile: "" },
    };

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      }),
    );

    await refreshStravaToken("old-refresh-token");

    const body = JSON.parse(
      vi.mocked(fetch).mock.calls[0][1]!.body as string,
    );
    expect(body.grant_type).toBe("refresh_token");
    expect(body.refresh_token).toBe("old-refresh-token");
  });
});

describe("deauthorizeStrava", () => {
  it("sends POST to deauthorize endpoint", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true }),
    );

    await deauthorizeStrava("my-access-token");

    const [url, options] = vi.mocked(fetch).mock.calls[0];
    expect(url).toBe("https://www.strava.com/oauth/deauthorize");
    expect(options!.method).toBe("POST");
  });

  it("treats 401 as success (already revoked)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 401 }),
    );

    // Should not throw
    await deauthorizeStrava("expired-token");
  });

  it("throws on other error status codes", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        text: () => Promise.resolve("server error"),
      }),
    );

    await expect(deauthorizeStrava("token")).rejects.toThrow(
      "Strava deauthorization failed (500)",
    );
  });
});

describe("fetchStravaActivities", () => {
  it("fetches activities with correct params", async () => {
    const mockActivities: StravaApiActivity[] = [
      {
        id: 1,
        name: "Run",
        sport_type: "Run",
        start_date_local: "2026-02-14T10:00:00Z",
        distance: 5000,
        moving_time: 1800,
        start_latlng: [40.7, -74.0],
        timezone: "America/New_York",
        map: null,
      },
    ];

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve(mockActivities),
      }),
    );

    const result = await fetchStravaActivities("token", 1700000000, 1700100000);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("Run");

    const [url, options] = vi.mocked(fetch).mock.calls[0];
    expect(url).toContain("/athlete/activities");
    expect(url).toContain("after=1700000000");
    expect(url).toContain("before=1700100000");
    expect(url).toContain("per_page=200");
    expect(options!.headers).toEqual({ Authorization: "Bearer token" });
  });

  it("throws on 429 rate limit", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 429,
        text: () => Promise.resolve("rate limited"),
      }),
    );

    await expect(
      fetchStravaActivities("token", 1700000000, 1700100000),
    ).rejects.toThrow("rate limit");
  });

  it("paginates when first page is full", async () => {
    const page1 = Array.from({ length: 200 }, (_, i) => ({
      id: i,
      name: `Run ${i}`,
      sport_type: "Run",
      start_date_local: "2026-02-14T10:00:00Z",
      distance: 5000,
      moving_time: 1800,
      start_latlng: null,
      timezone: "UTC",
      map: null,
    }));
    const page2 = [
      {
        id: 200,
        name: "Run 200",
        sport_type: "Run",
        start_date_local: "2026-02-14T10:00:00Z",
        distance: 5000,
        moving_time: 1800,
        start_latlng: null,
        timezone: "UTC",
        map: null,
      },
    ];

    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: () => Promise.resolve(page1),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: () => Promise.resolve(page2),
        }),
    );

    const result = await fetchStravaActivities("token", 1700000000, 1700100000);
    expect(result).toHaveLength(201);
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(2);
  });
});
