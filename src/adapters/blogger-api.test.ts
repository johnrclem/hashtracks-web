import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fetchBloggerPosts } from "./blogger-api";

describe("fetchBloggerPosts", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
    vi.stubEnv("GOOGLE_CALENDAR_API_KEY", "test-api-key");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("returns error when API key is missing", async () => {
    vi.stubEnv("GOOGLE_CALENDAR_API_KEY", "");
    // Also need to clear it since stubEnv sets empty string, not undefined
    delete process.env.GOOGLE_CALENDAR_API_KEY;

    const result = await fetchBloggerPosts("http://www.example.com/");

    expect(result.posts).toHaveLength(0);
    expect(result.error?.message).toContain("GOOGLE_CALENDAR_API_KEY");
  });

  it("discovers blog ID and fetches posts", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: "12345" }), { status: 200 }) as never,
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            items: [
              {
                title: "Run #266",
                content: "<p>Date: 18th March 2026</p>",
                url: "http://example.com/2026/03/run-266.html",
                published: "2026-03-10T12:00:00Z",
              },
              {
                title: "Run #265",
                content: "<p>Date: 18th February 2026</p>",
                url: "http://example.com/2026/02/run-265.html",
                published: "2026-02-10T12:00:00Z",
              },
            ],
          }),
          { status: 200 },
        ) as never,
      );

    const result = await fetchBloggerPosts("http://www.example.com/");

    expect(result.error).toBeUndefined();
    expect(result.blogId).toBe("12345");
    expect(result.posts).toHaveLength(2);
    expect(result.posts[0].title).toBe("Run #266");
    expect(result.posts[0].content).toBe("<p>Date: 18th March 2026</p>");
    expect(result.posts[1].title).toBe("Run #265");
    expect(result.fetchDurationMs).toBeDefined();

    // Verify correct API URLs were called (API key in header, not URL)
    const calls = vi.mocked(fetch).mock.calls;
    expect(calls[0][0]).toContain("/blogs/byurl");
    expect(calls[0][0]).toContain("url=http%3A%2F%2Fwww.example.com");
    expect(calls[0][0]).not.toContain("key=");
    expect(calls[1][0]).toContain("/blogs/12345/posts");
    expect(calls[1][0]).toContain("maxResults=25");
    expect(calls[1][0]).toContain("fetchBodies=true");
    expect(calls[1][0]).not.toContain("key=");

    // Verify API key is sent via header
    const blogLookupInit = calls[0][1] as RequestInit;
    expect(blogLookupInit.headers).toEqual({ "X-Goog-Api-Key": "test-api-key" });
    const postsInit = calls[1][1] as RequestInit;
    expect(postsInit.headers).toEqual({ "X-Goog-Api-Key": "test-api-key" });
  });

  it("passes custom maxResults", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: "12345" }), { status: 200 }) as never,
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ items: [] }), { status: 200 }) as never,
      );

    await fetchBloggerPosts("http://www.example.com/", 10);

    const postsCall = vi.mocked(fetch).mock.calls[1][0] as string;
    expect(postsCall).toContain("maxResults=10");
  });

  it("returns error when blog lookup fails with 404 on all URL variants", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        new Response("Not Found", { status: 404 }) as never,
      )
      .mockResolvedValueOnce(
        new Response("Not Found", { status: 404 }) as never,
      )
      .mockResolvedValueOnce(
        new Response("Not Found", { status: 404 }) as never,
      )
      .mockResolvedValueOnce(
        new Response("Not Found", { status: 404 }) as never,
      );

    const result = await fetchBloggerPosts("http://www.nonexistent.com/");

    expect(result.posts).toHaveLength(0);
    expect(result.error?.status).toBe(404);
    expect(result.error?.message).toContain("blog lookup failed");
    // Should have tried all 4 variants (original, www-toggle, protocol-toggle, both-toggle)
    expect(vi.mocked(fetch).mock.calls).toHaveLength(4);
  });

  it("retries with www-toggled variant when HTTP blog lookup returns 404", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        new Response("Not Found", { status: 404 }) as never,
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: "99999" }), { status: 200 }) as never,
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            items: [{ title: "Run #1", content: "<p>Content</p>", url: "http://example.com/run-1.html", published: "2026-01-01T12:00:00Z" }],
          }),
          { status: 200 },
        ) as never,
      );

    const result = await fetchBloggerPosts("http://www.example.com/");

    expect(result.error).toBeUndefined();
    expect(result.blogId).toBe("99999");
    expect(result.posts).toHaveLength(1);

    const calls = vi.mocked(fetch).mock.calls;
    // First: original (www, http)
    expect(calls[0][0]).toContain("url=http%3A%2F%2Fwww.example.com");
    // Second: www-toggled (non-www, http)
    expect(calls[1][0]).toContain("url=http%3A%2F%2Fexample.com");
  });

  it("retries with www-toggled variant when HTTPS blog lookup returns 404", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        new Response("Not Found", { status: 404 }) as never,
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: "88888" }), { status: 200 }) as never,
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ items: [] }), { status: 200 }) as never,
      );

    const result = await fetchBloggerPosts("https://www.example.com/");

    expect(result.error).toBeUndefined();
    expect(result.blogId).toBe("88888");

    const calls = vi.mocked(fetch).mock.calls;
    // First: original (www, https)
    expect(calls[0][0]).toContain("url=https%3A%2F%2Fwww.example.com");
    // Second: www-toggled (non-www, https)
    expect(calls[1][0]).toContain("url=https%3A%2F%2Fexample.com");
  });

  it("discovers blog via non-www variant when www returns 404 (Enfield Hash scenario)", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        new Response("Not Found", { status: 404 }) as never,
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: "77777" }), { status: 200 }) as never,
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            items: [{ title: "Run #266", content: "<p>Date: 18th March 2026</p>", url: "https://enfieldhash.org/run-266.html", published: "2026-03-10T12:00:00Z" }],
          }),
          { status: 200 },
        ) as never,
      );

    const result = await fetchBloggerPosts("https://www.enfieldhash.org/");

    expect(result.error).toBeUndefined();
    expect(result.blogId).toBe("77777");
    expect(result.posts).toHaveLength(1);

    const calls = vi.mocked(fetch).mock.calls;
    // First: original (www, https)
    expect(calls[0][0]).toContain("url=https%3A%2F%2Fwww.enfieldhash.org");
    // Second: www-toggled (non-www, https) — this is the one that succeeds
    expect(calls[1][0]).toContain("url=https%3A%2F%2Fenfieldhash.org");
    // Third: posts fetch
    expect(calls[2][0]).toContain("/blogs/77777/posts");
  });

  it("returns error when blog lookup fails with 403 (API not enabled)", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response("Blogger API has not been used in project", { status: 403 }) as never,
    );

    const result = await fetchBloggerPosts("http://www.example.com/");

    expect(result.posts).toHaveLength(0);
    expect(result.error?.status).toBe(403);
    expect(result.error?.message).toContain("blog lookup failed");
  });

  it("returns error when blog lookup returns no ID", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ name: "Blog Name" }), { status: 200 }) as never,
    );

    const result = await fetchBloggerPosts("http://www.example.com/");

    expect(result.posts).toHaveLength(0);
    expect(result.error?.message).toContain("no blog ID");
  });

  it("returns error when blog lookup throws network error", async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new Error("DNS resolution failed"));

    const result = await fetchBloggerPosts("http://www.example.com/");

    expect(result.posts).toHaveLength(0);
    expect(result.error?.message).toContain("DNS resolution failed");
  });

  it("returns error when posts fetch fails", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: "12345" }), { status: 200 }) as never,
      )
      .mockResolvedValueOnce(
        new Response("Internal Server Error", { status: 500 }) as never,
      );

    const result = await fetchBloggerPosts("http://www.example.com/");

    expect(result.posts).toHaveLength(0);
    expect(result.blogId).toBe("12345");
    expect(result.error?.status).toBe(500);
    expect(result.error?.message).toContain("posts fetch failed");
  });

  it("returns error when posts fetch throws network error", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: "12345" }), { status: 200 }) as never,
      )
      .mockRejectedValueOnce(new Error("Connection reset"));

    const result = await fetchBloggerPosts("http://www.example.com/");

    expect(result.posts).toHaveLength(0);
    expect(result.blogId).toBe("12345");
    expect(result.error?.message).toContain("Connection reset");
  });

  it("handles empty items array", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: "12345" }), { status: 200 }) as never,
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({}), { status: 200 }) as never,
      );

    const result = await fetchBloggerPosts("http://www.example.com/");

    expect(result.error).toBeUndefined();
    expect(result.posts).toHaveLength(0);
    expect(result.blogId).toBe("12345");
  });

  it("handles posts with missing optional fields", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: "12345" }), { status: 200 }) as never,
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            items: [{ title: "Just a title" }],
          }),
          { status: 200 },
        ) as never,
      );

    const result = await fetchBloggerPosts("http://www.example.com/");

    expect(result.posts).toHaveLength(1);
    expect(result.posts[0].title).toBe("Just a title");
    expect(result.posts[0].content).toBe("");
    expect(result.posts[0].url).toBe("");
    expect(result.posts[0].published).toBe("");
  });
});
