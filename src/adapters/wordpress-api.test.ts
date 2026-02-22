import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fetchWordPressPosts } from "./wordpress-api";

describe("fetchWordPressPosts", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns posts from pretty-permalink endpoint", async () => {
    const apiResponse = [
      {
        title: { rendered: "DCH4 Trail# 2299 &#8211; 2/14 @ 2pm" },
        content: { rendered: "<p>Hare: Someone</p>" },
        link: "https://dch4.org/trail-2299/",
        date: "2026-02-10T12:00:00",
      },
      {
        title: { rendered: "DCH4 Trail# 2298 &#8211; 2/7/26 @ 2pm" },
        content: { rendered: "<p>Hare: Another</p>" },
        link: "https://dch4.org/trail-2298/",
        date: "2026-02-03T12:00:00",
      },
    ];

    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify(apiResponse), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }) as never,
    );

    const result = await fetchWordPressPosts("https://dch4.org/");

    expect(result.error).toBeUndefined();
    expect(result.posts).toHaveLength(2);
    expect(result.posts[0]).toEqual({
      title: "DCH4 Trail# 2299 \u2013 2/14 @ 2pm", // &#8211; decoded to en-dash
      content: "<p>Hare: Someone</p>",
      url: "https://dch4.org/trail-2299/",
      date: "2026-02-10T12:00:00",
    });
    expect(result.fetchDurationMs).toBeDefined();
  });

  it("falls back to query-string endpoint on 403", async () => {
    // First call (pretty-permalink) returns 403
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response("Forbidden", { status: 403, statusText: "Forbidden" }) as never,
    );
    // Second call (query-string) returns success
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(
        JSON.stringify([
          {
            title: { rendered: "Test Post" },
            content: { rendered: "<p>Body</p>" },
            link: "https://example.com/test/",
            date: "2026-01-01T00:00:00",
          },
        ]),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ) as never,
    );

    const result = await fetchWordPressPosts("https://example.com");

    expect(result.error).toBeUndefined();
    expect(result.posts).toHaveLength(1);
    expect(result.posts[0].title).toBe("Test Post");

    // Verify both endpoints were tried
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(vi.mocked(fetch).mock.calls[0][0]).toContain("/wp-json/wp/v2/posts");
    expect(vi.mocked(fetch).mock.calls[1][0]).toContain("rest_route=/wp/v2/posts");
  });

  it("falls back to query-string endpoint on 404", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response("Not Found", { status: 404, statusText: "Not Found" }) as never,
    );
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify([]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }) as never,
    );

    const result = await fetchWordPressPosts("https://example.com/");

    expect(result.error).toBeUndefined();
    expect(result.posts).toHaveLength(0);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("returns error when all endpoints fail", async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response("Forbidden", { status: 403, statusText: "Forbidden" }) as never,
    );

    const result = await fetchWordPressPosts("https://example.com/");

    expect(result.posts).toHaveLength(0);
    expect(result.error).toBeDefined();
    expect(result.error?.status).toBe(403);
    expect(fetch).toHaveBeenCalledTimes(8);
  });

  it("does not retry on 500 error", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response("Server Error", { status: 500, statusText: "Internal Server Error" }) as never,
    );

    const result = await fetchWordPressPosts("https://example.com/");

    expect(result.posts).toHaveLength(0);
    expect(result.error?.status).toBe(500);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("returns error on network failure", async () => {
    vi.mocked(fetch).mockRejectedValue(new Error("Network timeout"));

    const result = await fetchWordPressPosts("https://example.com/");

    expect(result.posts).toHaveLength(0);
    expect(result.error?.message).toContain("Network timeout");
    expect(fetch).toHaveBeenCalledTimes(8);
  });


  it("tries protocol variant after hostname variants fail", async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response("Forbidden", { status: 403, statusText: "Forbidden" }) as never,
    );

    await fetchWordPressPosts("https://example.com/");

    const calledUrls = vi.mocked(fetch).mock.calls.map((c) => String(c[0]));
    expect(calledUrls.some((u) => u.startsWith("http://example.com/wp-json/wp/v2/posts"))).toBe(true);
    expect(calledUrls.some((u) => u.startsWith("http://www.example.com/wp-json/wp/v2/posts"))).toBe(true);
  });

  it("tries www host when base host endpoints are forbidden", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response("Forbidden", { status: 403, statusText: "Forbidden" }) as never,
    );
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response("Forbidden", { status: 403, statusText: "Forbidden" }) as never,
    );
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify([]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }) as never,
    );

    const result = await fetchWordPressPosts("https://example.com/");

    expect(result.error).toBeUndefined();
    expect(result.posts).toHaveLength(0);
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(vi.mocked(fetch).mock.calls[2][0]).toContain("https://www.example.com/wp-json/wp/v2/posts");
  });

  it("decodes HTML entities in titles", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(
        JSON.stringify([
          {
            title: { rendered: "EWH3 #1506: Huaynaputina&#8217;s Revenge" },
            content: { rendered: "" },
            link: "https://example.com/post/",
            date: "2026-02-16T00:00:00",
          },
        ]),
        { status: 200 },
      ) as never,
    );

    const result = await fetchWordPressPosts("https://example.com/");

    expect(result.posts[0].title).toBe("EWH3 #1506: Huaynaputina\u2019s Revenge");
  });

  it("handles non-array API response", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ code: "rest_no_route" }), { status: 200 }) as never,
    );
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response("Forbidden", { status: 403, statusText: "Forbidden" }) as never,
    );

    const result = await fetchWordPressPosts("https://example.com/");

    expect(result.posts).toHaveLength(0);
    expect(result.error).toBeDefined();
  });

  it("strips trailing slash from base URL", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify([]), { status: 200 }) as never,
    );

    await fetchWordPressPosts("https://example.com///");

    const calledUrl = vi.mocked(fetch).mock.calls[0][0] as string;
    expect(calledUrl).toMatch(/^https:\/\/example\.com\/wp-json/);
  });

  it("uses correct headers", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify([]), { status: 200 }) as never,
    );

    await fetchWordPressPosts("https://example.com/");

    const calledOptions = vi.mocked(fetch).mock.calls[0][1] as RequestInit;
    expect(calledOptions.headers).toEqual(
      expect.objectContaining({
        Accept: "application/json",
      }),
    );
  });

  it("respects perPage parameter", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify([]), { status: 200 }) as never,
    );

    await fetchWordPressPosts("https://example.com/", 5);

    const calledUrl = vi.mocked(fetch).mock.calls[0][0] as string;
    expect(calledUrl).toContain("per_page=5");
  });
});
