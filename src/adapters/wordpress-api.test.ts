import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  fetchAllWordPressPosts,
  fetchWordPressComPosts,
  fetchWordPressPosts,
} from "./wordpress-api";

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

describe("fetchWordPressComPosts", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("fetches posts from the WordPress.com Public API and normalizes them", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          found: 2,
          posts: [
            {
              ID: 1,
              title: "Hash 1016 &#8211; May 17",
              content: "<p>body</p>",
              URL: "https://hashhousehorrors.com/hash-1016/",
              date: "2026-05-17T00:00:00",
              modified: "2026-05-17T00:00:00",
              type: "post",
              slug: "hash-1016",
            },
          ],
        }),
        { status: 200 },
      ) as never,
    );

    const result = await fetchWordPressComPosts("hashhousehorrors.com", {
      number: 5,
      type: "post",
      search: "hash",
    });

    expect(result.error).toBeUndefined();
    expect(result.found).toBe(2);
    expect(result.posts).toHaveLength(1);
    expect(result.posts[0].title).toBe("Hash 1016 – May 17"); // entity decoded
    expect(result.posts[0].slug).toBe("hash-1016");

    const calledUrl = vi.mocked(fetch).mock.calls[0][0] as string;
    expect(calledUrl).toContain("public-api.wordpress.com/rest/v1.1/sites/hashhousehorrors.com/posts/");
    expect(calledUrl).toContain("number=5");
    expect(calledUrl).toContain("type=post");
    expect(calledUrl).toContain("search=hash");
  });

  it("returns an error shape on non-200 responses", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response("", { status: 404 }) as never,
    );

    const result = await fetchWordPressComPosts("missing.example.com");

    expect(result.posts).toEqual([]);
    expect(result.found).toBe(0);
    expect(result.error?.status).toBe(404);
  });
});

describe("fetchAllWordPressPosts", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const makePost = (n: number) => ({
    title: { rendered: `Post ${n}` },
    content: { rendered: "<p>body</p>" },
    link: `https://example.com/post-${n}/`,
    date: `2026-01-${String(n).padStart(2, "0")}T00:00:00`,
  });

  it("walks pages until a short final batch", async () => {
    const page1 = Array.from({ length: 100 }, (_, i) => makePost(i + 1));
    const page2 = Array.from({ length: 35 }, (_, i) => makePost(i + 101));

    vi.mocked(fetch)
      .mockResolvedValueOnce(new Response(JSON.stringify(page1), { status: 200 }) as never)
      .mockResolvedValueOnce(new Response(JSON.stringify(page2), { status: 200 }) as never);

    const posts = await fetchAllWordPressPosts("https://example.com");

    expect(posts).toHaveLength(135);
    expect(fetch).toHaveBeenCalledTimes(2);
  });


  // Bodies the WP REST API (or a misconfigured WAF in front of it) might
  // return alongside HTTP 400.
  const EXHAUSTED_BODY = JSON.stringify({
    code: "rest_post_invalid_page_number",
    message: "The page number requested is larger than the number of pages available.",
    data: { status: 400 },
  });
  const WAF_BODY = JSON.stringify({
    code: "rest_forbidden",
    message: "Sorry, you are not allowed to do that.",
    data: { status: 400 },
  });
  const HTML_BODY = "<html><body>Bad Request</body></html>";

  it.each([
    {
      name: "stops on legitimate rest_post_invalid_page_number 400",
      priorFullPages: 2,
      finalBody: EXHAUSTED_BODY,
      expectPosts: 200,
    },
    {
      // WAF / rate-limit / auth-plugin failure mid-walk: old code silently
      // returned the posts so far and pretended the archive ended.
      name: "throws on non-end-of-archive 400 mid-walk (does NOT silently truncate)",
      priorFullPages: 2,
      finalBody: WAF_BODY,
      expectError: /HTTP 400.*code=rest_forbidden/,
    },
    {
      // Documents intentional fail-loud behavior: if a CDN/WAF rewrites
      // the terminal 400 body on an exact-multiple-of-perPage archive,
      // the walk throws even though all posts were already fetched.
      // We deliberately prefer this over any silent-truncation hazard
      // from being permissive about non-canonical 400 bodies.
      name: "throws on 400 with non-JSON body (e.g. HTML error page from CDN)",
      priorFullPages: 1,
      finalBody: HTML_BODY,
      expectError: /HTTP 400.*body:/,
    },
    {
      // First-page rest_post_invalid_page_number is almost certainly a
      // misconfigured perPage or wrong base URL, not an empty archive.
      name: "throws on first-page 400 even with rest_post_invalid_page_number",
      priorFullPages: 0,
      finalBody: EXHAUSTED_BODY,
      expectError: /page 1.*HTTP 400/,
    },
  ])("$name", async ({ priorFullPages, finalBody, expectPosts, expectError }) => {
    for (let i = 0; i < priorFullPages; i++) {
      const page = Array.from({ length: 100 }, (_, j) => makePost(j + i * 100 + 1));
      vi.mocked(fetch).mockResolvedValueOnce(
        new Response(JSON.stringify(page), { status: 200 }) as never,
      );
    }
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(finalBody, { status: 400 }) as never,
    );

    if (expectPosts !== undefined) {
      const posts = await fetchAllWordPressPosts("https://example.com");
      expect(posts).toHaveLength(expectPosts);
      expect(fetch).toHaveBeenCalledTimes(priorFullPages + 1);
    } else {
      await expect(fetchAllWordPressPosts("https://example.com")).rejects.toThrow(
        expectError,
      );
    }
  });

  it("throws when maxPages is hit with a full final batch", async () => {
    const fullBatch = JSON.stringify(
      Array.from({ length: 100 }, (_, i) => makePost(i + 1)),
    );

    // mockImplementation so each page gets a fresh Response (body is single-use).
    vi.mocked(fetch).mockImplementation(
      async () => new Response(fullBatch, { status: 200 }) as never,
    );

    await expect(
      fetchAllWordPressPosts("https://example.com", { maxPages: 2 }),
    ).rejects.toThrow(/exhausted maxPages=2/);
  });
});
