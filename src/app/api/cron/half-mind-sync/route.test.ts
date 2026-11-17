import { GET, POST } from "./route";
import { verifyCronAuth } from "@/lib/cron-auth";
import { syncHalfMindDiscovery, type HalfMindSyncResult } from "@/pipeline/half-mind-discovery";
import * as Sentry from "@sentry/nextjs";

vi.mock("@/lib/cron-auth");
vi.mock("@/pipeline/half-mind-discovery", () => ({ syncHalfMindDiscovery: vi.fn() }));
vi.mock("@sentry/nextjs", () => ({ captureMessage: vi.fn(), captureException: vi.fn() }));

function req(method = "GET"): Request {
  return new Request("https://example.com/api/cron/half-mind-sync", { method });
}

function result(over: Partial<HalfMindSyncResult> = {}): HalfMindSyncResult {
  return {
    scopes: 1,
    fetched: 10,
    passedBar: 4,
    created: 2,
    updated: 1,
    refreshedChecks: 1,
    skippedStopped: 0,
    flaggedDeadOrMissing: 0,
    errors: [],
    ...over,
  };
}

describe("half-mind-sync cron", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(verifyCronAuth).mockResolvedValue({ authenticated: true, method: "bearer" });
    vi.stubEnv("HALF_MIND_SYNC_ENABLED", "true");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("returns 401 when unauthorized", async () => {
    vi.mocked(verifyCronAuth).mockResolvedValue({ authenticated: false, method: "none" });
    const res = await GET(req());
    expect(res.status).toBe(401);
    expect(syncHalfMindDiscovery).not.toHaveBeenCalled();
  });

  it.each([undefined, "", "TRUE", "1", "yes"])("skips when flag is %j", async (v) => {
    if (v === undefined) vi.stubEnv("HALF_MIND_SYNC_ENABLED", undefined as never);
    else vi.stubEnv("HALF_MIND_SYNC_ENABLED", v);
    const res = await GET(req());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: { skipped: "disabled" } });
    expect(syncHalfMindDiscovery).not.toHaveBeenCalled();
  });

  it("runs the sync once when enabled", async () => {
    const r = result();
    vi.mocked(syncHalfMindDiscovery).mockResolvedValue(r);
    const res = await GET(req());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: r });
    expect(syncHalfMindDiscovery).toHaveBeenCalledTimes(1);
    expect(Sentry.captureMessage).not.toHaveBeenCalled();
  });

  it("supports POST", async () => {
    vi.mocked(syncHalfMindDiscovery).mockResolvedValue(result());
    const res = await POST(req("POST"));
    expect(res.status).toBe(200);
  });

  it("does not report skippedStopped alone", async () => {
    vi.mocked(syncHalfMindDiscovery).mockResolvedValue(result({ skippedStopped: 3 }));
    await GET(req());
    expect(Sentry.captureMessage).not.toHaveBeenCalled();
  });

  it("returns 200 and reports once with counts only when the result has errors", async () => {
    vi.mocked(syncHalfMindDiscovery).mockResolvedValue(
      result({ errors: ["USA/GA: secret row text", "other"] }),
    );
    const res = await GET(req());
    expect(res.status).toBe(200);
    expect(Sentry.captureMessage).toHaveBeenCalledTimes(1);
    const [msg, ctx] = vi.mocked(Sentry.captureMessage).mock.calls[0];
    expect(JSON.stringify([msg, ctx])).not.toContain("secret row text");
    expect(JSON.stringify(ctx)).toContain("2");
  });

  it("returns 500 and captures the exception when the sync throws", async () => {
    vi.mocked(syncHalfMindDiscovery).mockRejectedValue(new Error("boom"));
    const res = await GET(req());
    expect(res.status).toBe(500);
    expect(Sentry.captureException).toHaveBeenCalledTimes(1);
  });
});
