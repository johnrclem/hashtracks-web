import { POST, maxDuration } from "./route";
import { prisma } from "@/lib/db";
import { verifyCronAuth } from "@/lib/cron-auth";
import { scrapeSource } from "@/pipeline/scrape";
import { buildSource } from "@/test/factories";

vi.mock("@/lib/db", () => ({
  prisma: {
    source: { findUnique: vi.fn() },
  },
}));
vi.mock("@/lib/cron-auth");
vi.mock("@/pipeline/scrape");

function makeRequest(body?: Record<string, unknown>): Request {
  return new Request("https://example.com/api/cron/scrape/src-1", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
}

const mockParams = Promise.resolve({ sourceId: "src-1" });

const mockSource = buildSource();

describe("POST /api/cron/scrape/[sourceId]", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(verifyCronAuth).mockResolvedValue({ authenticated: true, method: "bearer" });
  });

  it("returns 401 when not authenticated", async () => {
    vi.mocked(verifyCronAuth).mockResolvedValue({ authenticated: false, method: "none" });

    const res = await POST(makeRequest(), { params: mockParams });
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body).toEqual({ data: null, error: "Unauthorized" });
  });

  it("returns 404 for unknown source", async () => {
    vi.mocked(prisma.source.findUnique).mockResolvedValue(null as never);

    const res = await POST(makeRequest(), { params: mockParams });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).toEqual({ data: null, error: "Source not found" });
  });

  it("returns 200 skip for disabled source", async () => {
    vi.mocked(prisma.source.findUnique).mockResolvedValue({
      ...mockSource,
      enabled: false,
    } as never);

    const res = await POST(makeRequest(), { params: mockParams });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.data.skipped).toBe(true);
    expect(scrapeSource).not.toHaveBeenCalled();
  });

  it("returns 200 on successful scrape", async () => {
    vi.mocked(prisma.source.findUnique).mockResolvedValue(mockSource as never);
    vi.mocked(scrapeSource).mockResolvedValue({
      success: true,
      scrapeLogId: "log-1",
      forced: false,
      eventsFound: 5,
      created: 3,
      updated: 1,
      skipped: 1,
      blocked: 0,
      cancelled: 0,
      unmatched: [],
      blockedTags: [],
      errors: [],
    } as never);

    const res = await POST(makeRequest(), { params: mockParams });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.data.success).toBe(true);
    expect(data.data.eventsFound).toBe(5);
    expect(scrapeSource).toHaveBeenCalledWith("src-1", { days: 90 });
  });

  it("returns 500 on failed scrape (triggers QStash retry)", async () => {
    vi.mocked(prisma.source.findUnique).mockResolvedValue(mockSource as never);
    vi.mocked(scrapeSource).mockResolvedValue({
      success: false,
      scrapeLogId: "log-2",
      forced: false,
      eventsFound: 0,
      created: 0,
      updated: 0,
      skipped: 0,
      blocked: 0,
      cancelled: 0,
      unmatched: [],
      blockedTags: [],
      errors: ["Connection timeout"],
    } as never);

    const res = await POST(makeRequest(), { params: mockParams });
    expect(res.status).toBe(500);
    const data = await res.json();
    expect(data.data.success).toBe(false);
    expect(data.data.errors).toContain("Connection timeout");
  });

  it("exports maxDuration of 120 for Vercel function timeout", () => {
    expect(maxDuration).toBe(120);
  });

  it("returns 500 when scrapeSource throws an unhandled error", async () => {
    vi.mocked(prisma.source.findUnique).mockResolvedValue(mockSource as never);
    vi.mocked(scrapeSource).mockRejectedValue(new Error("Unexpected crash"));

    const res = await POST(makeRequest(), { params: mockParams });
    expect(res.status).toBe(500);
    const data = await res.json();
    expect(data.error).toBe("Scrape crashed");
    expect(data.data.error).toContain("Unexpected crash");
  });

  it("uses days override from request body", async () => {
    vi.mocked(prisma.source.findUnique).mockResolvedValue(mockSource as never);
    vi.mocked(scrapeSource).mockResolvedValue({
      success: true,
      scrapeLogId: "log-3",
      forced: false,
      eventsFound: 2,
      created: 2,
      updated: 0,
      skipped: 0,
      blocked: 0,
      cancelled: 0,
      unmatched: [],
      blockedTags: [],
      errors: [],
    } as never);

    const res = await POST(makeRequest({ days: 30 }), { params: mockParams });
    expect(res.status).toBe(200);
    expect(scrapeSource).toHaveBeenCalledWith("src-1", { days: 30 });
  });
});
