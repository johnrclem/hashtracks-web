import { POST } from "./route";
import { prisma } from "@/lib/db";
import { verifyCronAuth } from "@/lib/cron-auth";
import { getQStashClient } from "@/lib/qstash";
import { shouldScrape } from "@/pipeline/schedule";

vi.mock("@/lib/db", () => ({
  prisma: {
    source: { findMany: vi.fn() },
  },
}));
vi.mock("@/lib/cron-auth");
vi.mock("@/lib/qstash");
vi.mock("@/pipeline/schedule");

const APP_URL = "https://hashtracks.com";

function makeRequest(): Request {
  return new Request("https://example.com/api/cron/dispatch", {
    method: "POST",
  });
}

const mockSources = [
  { id: "src-1", name: "Source One", scrapeDays: 90, scrapeFreq: "daily", lastScrapeAt: null },
  { id: "src-2", name: "Source Two", scrapeDays: 60, scrapeFreq: "daily", lastScrapeAt: new Date() },
  { id: "src-3", name: "Source Three", scrapeDays: 30, scrapeFreq: "hourly", lastScrapeAt: null },
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
  });

  it("returns 401 when not authenticated", async () => {
    vi.mocked(verifyCronAuth).mockResolvedValue({ authenticated: false, method: "none" });

    const res = await POST(makeRequest());
    expect(res.status).toBe(401);
  });

  it("returns 500 when neither NEXT_PUBLIC_APP_URL nor VERCEL_URL is set", async () => {
    delete process.env.NEXT_PUBLIC_APP_URL;
    delete process.env.VERCEL_URL;

    const res = await POST(makeRequest());
    expect(res.status).toBe(500);
    const data = await res.json();
    expect(data.error).toContain("NEXT_PUBLIC_APP_URL");
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

    delete process.env.VERCEL_URL;
  });

  it("dispatches only due sources", async () => {
    vi.mocked(prisma.source.findMany).mockResolvedValue(mockSources as never);
    // src-1 and src-3 are due, src-2 is not
    vi.mocked(shouldScrape).mockImplementation((_freq, lastScrapeAt) => lastScrapeAt === null);

    const res = await POST(makeRequest());
    expect(res.status).toBe(200);
    const data = await res.json();

    expect(data.dispatched).toBe(2);
    expect(data.skipped).toBe(1);
    expect(data.total).toBe(3);
    expect(mockPublishJSON).toHaveBeenCalledTimes(2);

    expect(mockPublishJSON).toHaveBeenCalledWith({
      url: `${APP_URL}/api/cron/scrape/src-1`,
      body: { days: 90 },
      retries: 2,
    });
    expect(mockPublishJSON).toHaveBeenCalledWith({
      url: `${APP_URL}/api/cron/scrape/src-3`,
      body: { days: 30 },
      retries: 2,
    });
  });

  it("handles zero due sources gracefully", async () => {
    vi.mocked(prisma.source.findMany).mockResolvedValue(mockSources as never);
    vi.mocked(shouldScrape).mockReturnValue(false);

    const res = await POST(makeRequest());
    expect(res.status).toBe(200);
    const data = await res.json();

    expect(data.dispatched).toBe(0);
    expect(data.skipped).toBe(3);
    expect(mockPublishJSON).not.toHaveBeenCalled();
  });

  it("reports publish failures without crashing", async () => {
    vi.mocked(prisma.source.findMany).mockResolvedValue([mockSources[0]] as never);
    vi.mocked(shouldScrape).mockReturnValue(true);
    mockPublishJSON.mockRejectedValue(new Error("QStash unavailable"));

    const res = await POST(makeRequest());
    expect(res.status).toBe(200);
    const data = await res.json();

    expect(data.success).toBe(false);
    expect(data.dispatched).toBe(0);
    expect(data.failed).toBe(1);
    expect(data.results[0].error).toBe("QStash unavailable");
  });

  it("dispatches all sources when all are due", async () => {
    vi.mocked(prisma.source.findMany).mockResolvedValue(mockSources as never);
    vi.mocked(shouldScrape).mockReturnValue(true);

    const res = await POST(makeRequest());
    expect(res.status).toBe(200);
    const data = await res.json();

    expect(data.dispatched).toBe(3);
    expect(data.skipped).toBe(0);
    expect(data.success).toBe(true);
    expect(mockPublishJSON).toHaveBeenCalledTimes(3);
  });
});
