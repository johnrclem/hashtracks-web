import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// SSRF/DNS validation is exercised elsewhere — stub it so these tests focus on
// the timeout-signal wiring of the direct-fetch path.
vi.mock("./ssrf-dns", () => ({
  validateSourceUrlWithDns: vi.fn().mockResolvedValue(undefined),
}));

import { safeFetch } from "./safe-fetch";

describe("safeFetch direct-fetch timeout", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("ok", { status: 200 }));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function initOf(callIndex: number): RequestInit | undefined {
    return fetchSpy.mock.calls[callIndex]?.[1] as RequestInit | undefined;
  }

  it("applies a default AbortSignal when the caller provides none", async () => {
    await safeFetch("https://example.com");

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(initOf(0)?.signal).toBeInstanceOf(AbortSignal);
  });

  it("uses the caller-supplied signal verbatim when provided", async () => {
    const controller = new AbortController();
    await safeFetch("https://example.com", { signal: controller.signal });

    expect(initOf(0)?.signal).toBe(controller.signal);
  });

  it("shares one signal across redirect hops (bounds total time, not per-hop)", async () => {
    fetchSpy
      .mockResolvedValueOnce(
        new Response("redirecting", {
          status: 302,
          headers: { location: "https://example.com/next" },
        }),
      )
      .mockResolvedValueOnce(new Response("ok", { status: 200 }));

    await safeFetch("https://example.com");

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    const first = initOf(0)?.signal;
    const second = initOf(1)?.signal;
    expect(first).toBeInstanceOf(AbortSignal);
    expect(second).toBe(first); // same object reused across the chain
  });
});
