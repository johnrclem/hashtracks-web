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

import { buildUrlVariantCandidates } from "@/adapters/url-variants";

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
/** Discover blog ID from a URL using the Blogger API. Tries both http and https schemes. */
async function discoverBlogId(
  sourceUrl: string,
  authHeaders: Record<string, string>,
): Promise<{ blogId: string } | { error: { message: string; status?: number } }> {
  const urlsToTry = buildUrlVariantCandidates(sourceUrl);

  let lastLookupError: { message: string; status?: number } | undefined;

  for (const tryUrl of urlsToTry) {
    const blogLookupParams = new URLSearchParams({ url: tryUrl });
    const blogLookupUrl = `${BLOGGER_API_BASE}/blogs/byurl?${blogLookupParams.toString()}`;

    try {
      const blogResponse = await fetch(blogLookupUrl, { headers: authHeaders });
      if (blogResponse.ok) {
        const blogData = await blogResponse.json() as { id?: string };
        if (blogData?.id) return { blogId: blogData.id };
        lastLookupError = { message: "Blogger API returned no blog ID" };
        break;
      }
      const body = await blogResponse.text().catch(() => "");
      lastLookupError = {
        message: `Blogger API blog lookup failed: HTTP ${blogResponse.status} — ${body.slice(0, 200)}`,
        status: blogResponse.status,
      };
      if (blogResponse.status !== 404) break;
    } catch (err) {
      lastLookupError = { message: `Blogger API blog lookup error: ${err}` };
      break;
    }
  }

  return { error: lastLookupError ?? { message: "Blogger API blog lookup failed" } };
}

/** Fetch blog posts from a known blog ID. */
async function fetchBlogItems(
  blogId: string,
  authHeaders: Record<string, string>,
  maxResults: number,
): Promise<{ posts: BloggerPost[] } | { error: { message: string; status?: number } }> {
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
        error: {
          message: `Blogger API posts fetch failed: HTTP ${postsResponse.status} — ${body.slice(0, 200)}`,
          status: postsResponse.status,
        },
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

    return { posts };
  } catch (err) {
    return { error: { message: `Blogger API posts fetch error: ${err}` } };
  }
}

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
  const idResult = await discoverBlogId(sourceUrl, authHeaders);
  if ("error" in idResult) {
    return {
      posts: [],
      error: idResult.error,
      fetchDurationMs: Date.now() - fetchStart,
    };
  }

  const { blogId } = idResult;

  // Step 2: Fetch posts
  const postsResult = await fetchBlogItems(blogId, authHeaders, maxResults);
  if ("error" in postsResult) {
    return {
      posts: [],
      blogId,
      error: postsResult.error,
      fetchDurationMs: Date.now() - fetchStart,
    };
  }

  return {
    posts: postsResult.posts,
    blogId,
    fetchDurationMs: Date.now() - fetchStart,
  };
}
