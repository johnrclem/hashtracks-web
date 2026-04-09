import { describe, it, expect, vi, beforeEach } from "vitest";
import { fetchKennelEvents, HashRegoApiError, type HashRegoKennelEvent } from "./api";

vi.mock("@/adapters/safe-fetch", () => ({
  safeFetch: vi.fn(),
}));

const { safeFetch } = await import("@/adapters/safe-fetch");
const mockedSafeFetch = vi.mocked(safeFetch);

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function errorResponse(status: number): Response {
  return new Response("", { status });
}

function buildRow(overrides: Partial<HashRegoKennelEvent> = {}): HashRegoKennelEvent {
  return {
    slug: "ewh3-1355-unicorn-day",
    event_name: "#1355: Unicorn Day",
    host_kennel_slug: "EWH3",
    start_time: "2026-04-09T23:45:00-04:00",
    current_price: 10,
    has_hares: true,
    opt_hares: "Captain Jack",
    is_over: false,
    rego_count: 5,
    open_spots: 1,
    creator: "Close Encounters",
    created: "2026-04-06T22:54:35-04:00",
    modified: "2026-04-06T23:02:37-04:00",
    ...overrides,
  };
}

describe("fetchKennelEvents", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("200 + valid JSON array → returns rows", async () => {
    const rows = [buildRow()];
    mockedSafeFetch.mockResolvedValue(jsonResponse(rows));

    const result = await fetchKennelEvents("EWH3");
    expect(result).toEqual(rows);
    expect(mockedSafeFetch).toHaveBeenCalledWith(
      "https://hashrego.com/api/kennels/EWH3/events/",
      expect.objectContaining({
        headers: expect.objectContaining({ Accept: "application/json" }),
      }),
    );
  });

  it("200 + empty array → returns empty array (legitimate no events)", async () => {
    mockedSafeFetch.mockResolvedValue(jsonResponse([]));
    const result = await fetchKennelEvents("EWH3");
    expect(result).toEqual([]);
  });

  it("200 + non-array JSON → throws parse error", async () => {
    mockedSafeFetch.mockResolvedValue(jsonResponse({ error: "nope" }));
    await expect(fetchKennelEvents("EWH3")).rejects.toThrow(HashRegoApiError);

    mockedSafeFetch.mockResolvedValue(jsonResponse({ error: "nope" }));
    await expect(fetchKennelEvents("EWH3")).rejects.toMatchObject({
      kind: "parse",
      slug: "EWH3",
    });
  });

  it("200 + malformed JSON body → throws parse error", async () => {
    // Real Response with a non-JSON body — res.json() will throw SyntaxError.
    mockedSafeFetch.mockResolvedValue(
      new Response("this is not json", {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    await expect(fetchKennelEvents("EWH3")).rejects.toMatchObject({ kind: "parse" });
  });

  it("401 → throws auth", async () => {
    mockedSafeFetch.mockResolvedValue(errorResponse(401));
    await expect(fetchKennelEvents("EWH3")).rejects.toMatchObject({
      kind: "auth",
      status: 401,
    });
  });

  it("403 → throws auth", async () => {
    mockedSafeFetch.mockResolvedValue(errorResponse(403));
    await expect(fetchKennelEvents("EWH3")).rejects.toMatchObject({ kind: "auth" });
  });

  it("404 → throws not_found (configured slug must exist)", async () => {
    mockedSafeFetch.mockResolvedValue(errorResponse(404));
    await expect(fetchKennelEvents("GHOST")).rejects.toMatchObject({
      kind: "not_found",
      status: 404,
      slug: "GHOST",
    });
  });

  it("429 → throws rate_limit", async () => {
    mockedSafeFetch.mockResolvedValue(errorResponse(429));
    await expect(fetchKennelEvents("EWH3")).rejects.toMatchObject({
      kind: "rate_limit",
      status: 429,
    });
  });

  it("500 → throws server", async () => {
    mockedSafeFetch.mockResolvedValue(errorResponse(500));
    await expect(fetchKennelEvents("EWH3")).rejects.toMatchObject({
      kind: "server",
      status: 500,
    });
  });

  it("502 → throws server", async () => {
    mockedSafeFetch.mockResolvedValue(errorResponse(502));
    await expect(fetchKennelEvents("EWH3")).rejects.toMatchObject({ kind: "server" });
  });

  it("Network error → throws network (preserves cause)", async () => {
    const cause = new Error("ECONNREFUSED");
    mockedSafeFetch.mockRejectedValue(cause);
    try {
      await fetchKennelEvents("EWH3");
      expect.fail("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(HashRegoApiError);
      expect((err as HashRegoApiError).kind).toBe("network");
      expect((err as HashRegoApiError).slug).toBe("EWH3");
      expect((err as Error & { cause?: unknown }).cause).toBe(cause);
    }
  });

  it("AbortSignal timeout → throws network without leaking controller", async () => {
    mockedSafeFetch.mockRejectedValue(
      new DOMException("The operation was aborted due to timeout", "TimeoutError"),
    );
    await expect(fetchKennelEvents("EWH3")).rejects.toMatchObject({
      kind: "network",
    });
  });

  it("encodeURIComponent applied to slug", async () => {
    mockedSafeFetch.mockResolvedValue(jsonResponse([]));
    await fetchKennelEvents("slug/with+special");
    expect(mockedSafeFetch).toHaveBeenCalledWith(
      "https://hashrego.com/api/kennels/slug%2Fwith%2Bspecial/events/",
      expect.any(Object),
    );
  });

  it("custom timeoutMs fires AbortSignal.timeout at the requested ms", async () => {
    // Capture the signal that safeFetch is called with, then wait for it to
    // abort. If the timeout is wired correctly, signal.aborted flips from
    // false → true within ~timeoutMs.
    mockedSafeFetch.mockResolvedValue(jsonResponse([]));
    await fetchKennelEvents("EWH3", { timeoutMs: 50 });
    const [, opts] = mockedSafeFetch.mock.calls[0];
    const signal = opts?.signal as AbortSignal | undefined;
    expect(signal).toBeDefined();
    expect(signal!.aborted).toBe(false);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(signal!.aborted).toBe(true);
    // The abort reason should be a TimeoutError DOMException, not a manual abort.
    expect((signal!.reason as DOMException).name).toBe("TimeoutError");
  });
});
