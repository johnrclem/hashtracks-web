import { GET, POST } from "./route";
import { verifyCronAuth } from "@/lib/cron-auth";
import { purgeExpiredStravaCache } from "@/lib/strava/sync";

vi.mock("@/lib/cron-auth");
vi.mock("@sentry/nextjs", () => ({ captureException: vi.fn() }));
vi.mock("@/lib/strava/sync", () => ({
  purgeExpiredStravaCache: vi.fn(),
}));

function makeRequest(method = "POST"): Request {
  return new Request("https://example.com/api/cron/strava-cache-purge", { method });
}

describe("/api/cron/strava-cache-purge", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(verifyCronAuth).mockResolvedValue({ authenticated: true, method: "bearer" });
  });

  it("returns 401 without cron auth and purges nothing", async () => {
    vi.mocked(verifyCronAuth).mockResolvedValueOnce({ authenticated: false } as never);

    const res = await POST(makeRequest());

    expect(res.status).toBe(401);
    expect(purgeExpiredStravaCache).not.toHaveBeenCalled();
  });

  it("purges expired cache rows and reports the count", async () => {
    const olderThan = new Date("2026-11-05T12:00:00Z");
    vi.mocked(purgeExpiredStravaCache).mockResolvedValueOnce({ deleted: 12, olderThan });
    vi.spyOn(console, "log").mockImplementation(() => {});

    const res = await GET(makeRequest("GET"));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      data: { deleted: 12, olderThan: olderThan.toISOString(), ttlHours: 24 },
    });
  });

  it("returns 500 when the purge fails", async () => {
    vi.mocked(purgeExpiredStravaCache).mockRejectedValueOnce(new Error("db down"));
    vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await POST(makeRequest());

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ data: null, error: "db down" });
  });
});
