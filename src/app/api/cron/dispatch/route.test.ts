import { POST } from "./route";
import { prisma } from "@/lib/db";
import { verifyCronAuth } from "@/lib/cron-auth";
import { getQStashClient } from "@/lib/qstash";
import { shouldScrape } from "@/pipeline/schedule";
import { buildSource } from "@/test/factories";

vi.mock("@/lib/db", () => ({
  prisma: {
    source: { findMany: vi.fn() },
  },
}));
vi.mock("@/lib/cron-auth");
vi.mock("@/lib/qstash");
vi.mock("@/pipeline/schedule", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/pipeline/schedule")>()),
  shouldScrape: vi.fn(),
}));

const APP_URL = "https://hashtracks.com";

function makeRequest(queryString = ""): Request {
  return new Request(`https://example.com/api/cron/dispatch${queryString}`, {
    method: "POST",
  });
}

const mockSources = [
  buildSource({ id: "src-1", name: "Source One", scrapeDays: 90, lastScrapeAt: null }),
  buildSource({ id: "src-2", name: "Source Two", scrapeDays: 60, lastScrapeAt: new Date() }),
  buildSource({ id: "src-3", name: "Source Three", scrapeDays: 30, scrapeFreq: "hourly", lastScrapeAt: null }),
];

describe("POST /api/cron/dispatch", () => {
  let mockPublishJSON: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.resetAllMocks();
    process.env.NEXT_PUBLIC_APP_URL = APP_URL;
    vi.mocked(verifyCronAuth).mockResolvedValue({ authenticated: true, method: "bearer" });
    mockPublishJSON = vi.fn().mockResolvedValue({ messageId: "msg-1" });
    vi.mocked(getQStashClient).mockReturnValue({ publishJSON: mockPublishJSON } as never);
  });

  afterEach(() => {
    delete process.env.NEXT_PUBLIC_APP_URL;
    delete process.env.VERCEL_URL;
  });

  it("returns 401 when not authenticated", async () => {
    vi.mocked(verifyCronAuth).mockResolvedValue({ authenticated: false, method: "none" });

    const res = await POST(makeRequest());
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body).toEqual({ data: null, error: "Unauthorized" });
  });

  it("returns 500 when neither NEXT_PUBLIC_APP_URL nor VERCEL_URL is set", async () => {
    delete process.env.NEXT_PUBLIC_APP_URL;
    delete process.env.VERCEL_URL;

    const res = await POST(makeRequest());
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.data).toBeNull();
    expect(body.error).toContain("NEXT_PUBLIC_APP_URL");
  });

  it("falls back to VERCEL_URL when NEXT_PUBLIC_APP_URL is not set", async () => {
    delete process.env.NEXT_PUBLIC_APP_URL;
    process.env.VERCEL_URL = "my-app.vercel.app";

    vi.mocked(prisma.source.findMany).mockResolvedValue([mockSources[0]] as never);
    vi.mocked(shouldScrape).mockReturnValue(true);

    const res = await POST(makeRequest());
    expect(res.status).toBe(200);
    expect(mockPublishJSON).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "https://my-app.vercel.app/api/cron/scrape/src-1",
      }),
    );
  });

  it("dispatches only due sources", async () => {
    vi.mocked(prisma.source.findMany).mockResolvedValue(mockSources as never);
    // src-1 and src-3 are due, src-2 is not
    vi.mocked(shouldScrape).mockImplementation((_freq, lastScrapeAt) => lastScrapeAt === null);

    const res = await POST(makeRequest());
    expect(res.status).toBe(200);
    const data = await res.json();

    expect(data.data.dispatched).toBe(2);
    expect(data.data.skipped).toBe(1);
    expect(data.data.total).toBe(3);
    expect(mockPublishJSON).toHaveBeenCalledTimes(2);

    expect(mockPublishJSON).toHaveBeenCalledWith({
      url: `${APP_URL}/api/cron/scrape/src-1`,
      body: { days: 90 },
      retries: 2,
      delay: 0,
    });
    expect(mockPublishJSON).toHaveBeenCalledWith({
      url: `${APP_URL}/api/cron/scrape/src-3`,
      body: { days: 30 },
      retries: 2,
      delay: 240,
    });
  });

  it("handles zero due sources gracefully", async () => {
    vi.mocked(prisma.source.findMany).mockResolvedValue(mockSources as never);
    vi.mocked(shouldScrape).mockReturnValue(false);

    const res = await POST(makeRequest());
    expect(res.status).toBe(200);
    const data = await res.json();

    expect(data.data.dispatched).toBe(0);
    expect(data.data.skipped).toBe(3);
    expect(mockPublishJSON).not.toHaveBeenCalled();
  });

  it("reports publish failures without crashing", async () => {
    vi.mocked(prisma.source.findMany).mockResolvedValue([mockSources[0]] as never);
    vi.mocked(shouldScrape).mockReturnValue(true);
    mockPublishJSON.mockRejectedValue(new Error("QStash unavailable"));

    const res = await POST(makeRequest());
    expect(res.status).toBe(200);
    const data = await res.json();

    expect(data.data.success).toBe(false);
    expect(data.data.dispatched).toBe(0);
    expect(data.data.failed).toBe(1);
    expect(data.data.results[0].error).toBe("QStash unavailable");
  });

  it("dispatches all sources when all are due", async () => {
    vi.mocked(prisma.source.findMany).mockResolvedValue(mockSources as never);
    vi.mocked(shouldScrape).mockReturnValue(true);

    const res = await POST(makeRequest());
    expect(res.status).toBe(200);
    const data = await res.json();

    expect(data.data.dispatched).toBe(3);
    expect(data.data.skipped).toBe(0);
    expect(data.data.success).toBe(true);
    expect(data.data.force).toBe(false);
    expect(mockPublishJSON).toHaveBeenCalledTimes(3);
  });

  it("dispatches all sources when force=true, bypassing shouldScrape", async () => {
    vi.mocked(prisma.source.findMany).mockResolvedValue(mockSources as never);
    vi.mocked(shouldScrape).mockReturnValue(false);

    const res = await POST(makeRequest("?force=true"));
    expect(res.status).toBe(200);
    const data = await res.json();

    expect(data.data.force).toBe(true);
    expect(data.data.dispatched).toBe(3);
    expect(data.data.skipped).toBe(0);
    expect(data.data.total).toBe(3);
    expect(shouldScrape).not.toHaveBeenCalled();
    expect(mockPublishJSON).toHaveBeenCalledTimes(3);
  });

  it("includes force=false in response when force param is absent", async () => {
    vi.mocked(prisma.source.findMany).mockResolvedValue(mockSources as never);
    vi.mocked(shouldScrape).mockReturnValue(false);

    const res = await POST(makeRequest());
    const data = await res.json();

    expect(data.data.force).toBe(false);
    expect(data.data.dispatched).toBe(0);
    expect(shouldScrape).toHaveBeenCalledTimes(3);
  });

  describe("stagger delays", () => {
    it("sets delay=0 for a single due source", async () => {
      vi.mocked(prisma.source.findMany).mockResolvedValue([mockSources[0]] as never);
      vi.mocked(shouldScrape).mockReturnValue(true);

      await POST(makeRequest());

      expect(mockPublishJSON).toHaveBeenCalledTimes(1);
      expect(mockPublishJSON.mock.calls[0][0].delay).toBe(0);
    });

    it("dispatches forced runs with delay=0 (no stagger)", async () => {
      vi.mocked(prisma.source.findMany).mockResolvedValue(mockSources as never);
      vi.mocked(shouldScrape).mockReturnValue(false);

      await POST(makeRequest("?force=true"));

      expect(mockPublishJSON).toHaveBeenCalledTimes(3);
      for (const call of mockPublishJSON.mock.calls) {
        expect(call[0].delay).toBe(0);
      }
    });

    it("emits non-decreasing delays bounded by 240s even when N > 241 (duplicates allowed)", async () => {
      const many = Array.from({ length: 500 }, (_, i) =>
        buildSource({ id: `src-${String(i).padStart(3, "0")}`, name: `Source ${i}`, scrapeDays: 30, lastScrapeAt: null }),
      );
      vi.mocked(prisma.source.findMany).mockResolvedValue(many as never);
      vi.mocked(shouldScrape).mockReturnValue(true);

      await POST(makeRequest());

      const delays = mockPublishJSON.mock.calls.map((c) => c[0].delay as number);
      expect(delays[0]).toBe(0);
      expect(delays[delays.length - 1]).toBe(240);
      for (let i = 1; i < delays.length; i++) {
        expect(delays[i]).toBeGreaterThanOrEqual(delays[i - 1]);
        expect(delays[i]).toBeLessThanOrEqual(240);
      }
    });

    it("emits strictly increasing delays bounded by 240s for N > 1", async () => {
      const many = Array.from({ length: 25 }, (_, i) =>
        buildSource({ id: `src-${i}`, name: `Source ${i}`, scrapeDays: 30, lastScrapeAt: null }),
      );
      vi.mocked(prisma.source.findMany).mockResolvedValue(many as never);
      vi.mocked(shouldScrape).mockReturnValue(true);

      await POST(makeRequest());

      expect(mockPublishJSON).toHaveBeenCalledTimes(25);
      const delays = mockPublishJSON.mock.calls.map((c) => c[0].delay as number);

      expect(delays[0]).toBe(0);
      expect(delays[delays.length - 1]).toBe(240);
      for (let i = 1; i < delays.length; i++) {
        expect(delays[i]).toBeGreaterThan(delays[i - 1]);
      }
    });
  });
});
