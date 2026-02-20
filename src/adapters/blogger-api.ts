/**
 * Blogger API v3 utility for fetching posts from Blogger/Blogspot sites.
 *
 * Google/Blogger blocks server-side requests from cloud provider IPs (Vercel, AWS, etc.)
 * with HTTP 403 Forbidden. The Blogger API v3 authenticates via API key and bypasses
 * this IP-based blocking. Uses the same GOOGLE_CALENDAR_API_KEY that powers
 * the Google Calendar and Google Sheets adapters.
 *
 * API docs: https://developers.google.com/blogger/docs/3.0/using
 *
 * Prerequisites:
 *   1. Enable the Blogger API in GCP Console:
 *      https://console.cloud.google.com/apis/library/blogger.googleapis.com
 *   2. Set GOOGLE_CALENDAR_API_KEY env var (same key used for Calendar/Sheets)
 */

const BLOGGER_API_BASE = "https://www.googleapis.com/blogger/v3";

/** A single blog post returned by the Blogger API */
export interface BloggerPost {
  title: string;
  content: string; // HTML body of the post
  url: string; // Canonical post URL
  published: string; // ISO 8601 date string
}

/** Result of a Blogger API fetch operation */
export interface BloggerFetchResult {
  posts: BloggerPost[];
  blogId?: string;
  error?: { message: string; status?: number };
  fetchDurationMs?: number;
}

/**
 * Fetch recent posts from a Blogger blog using the Blogger API v3.
 *
 * 1. Discovers blog ID from URL via GET /blogs/byurl
 * 2. Fetches posts via GET /blogs/{blogId}/posts
 *
 * @param sourceUrl - The blog URL (custom domain or blogspot.com)
 * @param maxResults - Maximum posts to retrieve (default 25)
 * @returns Posts array with blog ID, or error details
 */
export async function fetchBloggerPosts(
  sourceUrl: string,
  maxResults = 25,
): Promise<BloggerFetchResult> {
  const apiKey = process.env.GOOGLE_CALENDAR_API_KEY;
  if (!apiKey) {
    return {
      posts: [],
      error: { message: "Missing GOOGLE_CALENDAR_API_KEY environment variable" },
    };
  }

  const fetchStart = Date.now();

  const authHeaders = { "X-Goog-Api-Key": apiKey };

  // Step 1: Discover blog ID from URL
  const blogLookupParams = new URLSearchParams({ url: sourceUrl });
  const blogLookupUrl = `${BLOGGER_API_BASE}/blogs/byurl?${blogLookupParams.toString()}`;
  let blogId: string;

  try {
    const blogResponse = await fetch(blogLookupUrl, { headers: authHeaders });
    if (!blogResponse.ok) {
      const body = await blogResponse.text().catch(() => "");
      return {
        posts: [],
        error: {
          message: `Blogger API blog lookup failed: HTTP ${blogResponse.status} — ${body.slice(0, 200)}`,
          status: blogResponse.status,
        },
        fetchDurationMs: Date.now() - fetchStart,
      };
    }
    const blogData = await blogResponse.json() as { id?: string };
    blogId = blogData?.id ?? "";
    if (!blogId) {
      return {
        posts: [],
        error: { message: "Blogger API returned no blog ID" },
        fetchDurationMs: Date.now() - fetchStart,
      };
    }
  } catch (err) {
    return {
      posts: [],
      error: { message: `Blogger API blog lookup error: ${err}` },
      fetchDurationMs: Date.now() - fetchStart,
    };
  }

  // Step 2: Fetch posts
  const postsParams = new URLSearchParams({
    maxResults: maxResults.toString(),
    fetchBodies: "true",
  });
  const postsUrl = `${BLOGGER_API_BASE}/blogs/${blogId}/posts?${postsParams.toString()}`;

  try {
    const postsResponse = await fetch(postsUrl, { headers: authHeaders });
    if (!postsResponse.ok) {
      const body = await postsResponse.text().catch(() => "");
      return {
        posts: [],
        blogId,
        error: {
          message: `Blogger API posts fetch failed: HTTP ${postsResponse.status} — ${body.slice(0, 200)}`,
          status: postsResponse.status,
        },
        fetchDurationMs: Date.now() - fetchStart,
      };
    }
    const postsData = await postsResponse.json() as { items?: unknown[] };
    const items = postsData?.items ?? [];

    const posts: BloggerPost[] = (
      items as { title?: string; content?: string; url?: string; published?: string }[]
    ).map((item) => ({
      title: item.title ?? "",
      content: item.content ?? "",
      url: item.url ?? "",
      published: item.published ?? "",
    }));

    return {
      posts,
      blogId,
      fetchDurationMs: Date.now() - fetchStart,
    };
  } catch (err) {
    return {
      posts: [],
      blogId,
      error: { message: `Blogger API posts fetch error: ${err}` },
      fetchDurationMs: Date.now() - fetchStart,
    };
  }
}
