/**
 * WordPress REST API utility for fetching posts from WordPress sites.
 *
 * Many WordPress sites block direct HTML scraping from cloud provider IPs
 * (Vercel, AWS, etc.) via security plugins or CDN rules. The WordPress REST API
 * (/wp-json/wp/v2/posts) is a built-in, unauthenticated JSON endpoint that is
 * sometimes allowed through even when HTML page requests are blocked.
 *
 * This utility tries two endpoint patterns:
 *   1. Pretty permalink: /wp-json/wp/v2/posts (requires mod_rewrite)
 *   2. Query-string fallback: /?rest_route=/wp/v2/posts (always available)
 *
 * API docs: https://developer.wordpress.org/rest-api/reference/posts/
 */

import he from "he";
import { buildUrlVariantCandidates } from "@/adapters/url-variants";
import { safeFetch } from "./safe-fetch";

const WP_USER_AGENT = "HashTracks/1.0 (event aggregator; +https://hashtracks.com)";

// ── WordPress.com Public REST API ──────────────────────────────────────────
//
// WordPress.com hosted blogs (NOT self-hosted) don't expose `/wp-json/` on
// the free tier. Their public REST API at `public-api.wordpress.com/rest/v1.1`
// has a different shape — title/content are already plain strings (no
// {rendered} wrapper), URL is `URL` (capitalized), and posts/pages share the
// `/posts/` endpoint with a `type` filter.

/** A page or post returned by the WordPress.com Public REST API. */
export interface WordPressComPage {
  ID: number;
  title: string;
  content: string;
  URL: string;
  date: string;
  modified: string;
  type: string;
  slug: string;
}

interface WordPressComPostsRaw {
  found?: number;
  posts?: Array<{
    ID?: number;
    title?: string;
    content?: string;
    URL?: string;
    date?: string;
    modified?: string;
    type?: string;
    slug?: string;
  }>;
}

interface WordPressComPageRaw {
  ID?: number;
  title?: string;
  content?: string;
  URL?: string;
  date?: string;
  modified?: string;
  type?: string;
  slug?: string;
  error?: string;
  message?: string;
}

function normalizeWpComPage(raw: WordPressComPageRaw | NonNullable<WordPressComPostsRaw["posts"]>[number]): WordPressComPage {
  return {
    ID: raw.ID ?? 0,
    title: he.decode(raw.title ?? ""),
    content: raw.content ?? "",
    URL: raw.URL ?? "",
    date: raw.date ?? "",
    modified: raw.modified ?? "",
    type: raw.type ?? "post",
    slug: raw.slug ?? "",
  };
}

/**
 * Fetch a single WordPress.com page or post by its slug.
 *
 * @param siteDomain - Bare domain (e.g. "hashhousehorrors.com"), no protocol
 * @param slug - Page or post slug (e.g. "hareline")
 */
export async function fetchWordPressComPage(
  siteDomain: string,
  slug: string,
): Promise<{
  page?: WordPressComPage;
  error?: { message: string; status?: number };
  fetchDurationMs: number;
}> {
  const fetchStart = Date.now();
  const url = `https://public-api.wordpress.com/rest/v1.1/sites/${encodeURIComponent(siteDomain)}/posts/slug:${encodeURIComponent(slug)}`;

  try {
    const res = await safeFetch(url, {
      headers: { "User-Agent": WP_USER_AGENT, Accept: "application/json" },
    });
    if (!res.ok) {
      return {
        error: { message: `WordPress.com API HTTP ${res.status}`, status: res.status },
        fetchDurationMs: Date.now() - fetchStart,
      };
    }
    const raw = (await res.json()) as WordPressComPageRaw;
    if (raw.error) {
      return {
        error: { message: raw.message ?? raw.error },
        fetchDurationMs: Date.now() - fetchStart,
      };
    }
    return { page: normalizeWpComPage(raw), fetchDurationMs: Date.now() - fetchStart };
  } catch (err) {
    return {
      error: { message: `WordPress.com API fetch error: ${err instanceof Error ? err.message : String(err)}` },
      fetchDurationMs: Date.now() - fetchStart,
    };
  }
}

export interface FetchWordPressComPostsOptions {
  /** Maximum number of items to return (default 20). */
  number?: number;
  /** "post" (default) or "page". */
  type?: "post" | "page";
  /** Free-text search filter. */
  search?: string;
}

/**
 * List posts (or pages) from a WordPress.com hosted site via the v1.1 API.
 */
export async function fetchWordPressComPosts(
  siteDomain: string,
  options: FetchWordPressComPostsOptions = {},
): Promise<{
  posts: WordPressComPage[];
  found: number;
  error?: { message: string; status?: number };
  fetchDurationMs: number;
}> {
  const fetchStart = Date.now();
  const params = new URLSearchParams({
    number: String(options.number ?? 20),
  });
  if (options.type) params.set("type", options.type);
  if (options.search) params.set("search", options.search);
  const url = `https://public-api.wordpress.com/rest/v1.1/sites/${encodeURIComponent(siteDomain)}/posts/?${params.toString()}`;

  try {
    const res = await safeFetch(url, {
      headers: { "User-Agent": WP_USER_AGENT, Accept: "application/json" },
    });
    if (!res.ok) {
      return {
        posts: [],
        found: 0,
        error: { message: `WordPress.com API HTTP ${res.status}`, status: res.status },
        fetchDurationMs: Date.now() - fetchStart,
      };
    }
    const raw = (await res.json()) as WordPressComPostsRaw;
    return {
      posts: (raw.posts ?? []).map(normalizeWpComPage),
      found: raw.found ?? 0,
      fetchDurationMs: Date.now() - fetchStart,
    };
  } catch (err) {
    return {
      posts: [],
      found: 0,
      error: { message: `WordPress.com API fetch error: ${err instanceof Error ? err.message : String(err)}` },
      fetchDurationMs: Date.now() - fetchStart,
    };
  }
}

// ── Self-hosted WordPress REST API ─────────────────────────────────────────

/** A single post returned by the WordPress REST API */
export interface WordPressPost {
  title: string; // Plain text (decoded from title.rendered)
  content: string; // HTML body (from content.rendered)
  url: string; // Canonical post URL (from link)
  date: string; // ISO 8601 date string (from date)
}

/** Result of a WordPress API fetch operation */
export interface WordPressFetchResult {
  posts: WordPressPost[];
  error?: { message: string; status?: number };
  fetchDurationMs?: number;
}

/**
 * Fetch recent posts from a WordPress site using the REST API.
 *
 * @param siteUrl - The WordPress site URL (e.g., "https://www.ewh3.com/")
 * @param perPage - Maximum posts to retrieve (default 10)
 * @returns Posts array, or error details
 */
export async function fetchWordPressPosts(
  siteUrl: string,
  perPage = 10,
): Promise<WordPressFetchResult> {
  const fetchStart = Date.now();
  const base = siteUrl.replace(/\/+$/, "");

  const params = new URLSearchParams({
    per_page: perPage.toString(),
    _fields: "title,content,link,date",
  });

  // Try canonical host/protocol first, then optional www/non-www and
  // https/http variants. Some WordPress sites vary by edge rules.
  const candidateBases = buildUrlVariantCandidates(base);
  const endpoints = candidateBases.flatMap((candidateBase) => [
    `${candidateBase}/wp-json/wp/v2/posts?${params.toString()}`,
    `${candidateBase}/?rest_route=/wp/v2/posts&${params.toString()}`,
  ]);

  let lastError: { message: string; status?: number } | undefined;

  for (const url of endpoints) {
    try {
      const response = await fetch(url, {
        headers: {
          "Accept": "application/json",
          "User-Agent": "HashTracks/1.0 (event aggregator; +https://hashtracks.com)",
        },
      });

      if (response.ok) {
        // Some WordPress sites embed literal control characters inside JSON
        // string values (e.g., Voodoo H3 has literal newlines in content).
        // Strip non-whitespace control chars, then escape whitespace chars
        // only inside string literals (not structural JSON whitespace).
        const raw = await response.text();
        const sanitized = raw
          .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, "")
          .replace(/"(?:[^"\\]|\\.)*"/g, (match) =>
            match.replace(/\t/g, "\\t").replace(/\n/g, "\\n").replace(/\r/g, "\\r"),
          );
        const data = JSON.parse(sanitized) as {
          title?: { rendered?: string };
          content?: { rendered?: string };
          link?: string;
          date?: string;
        }[];

        if (!Array.isArray(data)) {
          lastError = { message: "WordPress API returned non-array response" };
          continue;
        }

        const posts: WordPressPost[] = data.map((item) => ({
          title: he.decode(item.title?.rendered ?? ""),
          content: item.content?.rendered ?? "",
          url: item.link ?? "",
          date: item.date ?? "",
        }));

        return {
          posts,
          fetchDurationMs: Date.now() - fetchStart,
        };
      }

      lastError = {
        message: `WordPress API HTTP ${response.status}: ${response.statusText}`,
        status: response.status,
      };

      // Only try the endpoint fallback chain on 403/404 — other status errors
      // usually indicate a server-side issue and are unlikely to improve.
      if (response.status !== 403 && response.status !== 404) break;
    } catch (err) {
      lastError = { message: `WordPress API fetch error: ${err}` };
      // Keep trying alternate endpoint/hostname combinations.
      continue;
    }
  }

  return {
    posts: [],
    error: lastError ?? { message: "WordPress API fetch failed" },
    fetchDurationMs: Date.now() - fetchStart,
  };
}

/**
 * Paginated walk of the WordPress REST API. Used by one-shot historical
 * backfill scripts that need every post on a self-hosted WP site, not just
 * the latest N. Stops when the API returns 400 (past totalPages) or when
 * fewer than `perPage` items come back (final page).
 *
 * Decodes title entities so callers can match against the live adapter's
 * post.title shape without re-decoding.
 */
export async function fetchAllWordPressPosts(
  siteUrl: string,
  options: { perPage?: number; maxPages?: number } = {},
): Promise<WordPressPost[]> {
  const perPage = options.perPage ?? 100;
  const maxPages = options.maxPages ?? 100;
  // Procedural trim avoids the Sonar S5852 ReDoS hotspot that `/\/+$/` trips.
  let base = siteUrl;
  while (base.endsWith("/")) base = base.slice(0, -1);
  const posts: WordPressPost[] = [];
  let lastBatchSize = 0;

  for (let page = 1; page <= maxPages; page++) {
    const params = new URLSearchParams({
      per_page: String(perPage),
      page: String(page),
      _fields: "title,content,link,date",
    });
    const url = `${base}/wp-json/wp/v2/posts?${params.toString()}`;
    const response = await fetch(url, {
      headers: { Accept: "application/json", "User-Agent": WP_USER_AGENT },
    });
    if (response.status === 400) {
      if (page === 1) {
        // First-page 400 means bad URL / bad perPage, not "past last page".
        // Returning [] would silently mask that as an empty archive.
        throw new Error(
          `WordPress paginator failed on first page: HTTP 400 from ${url}. Check siteUrl or perPage.`,
        );
      }
      return posts;
    }
    if (!response.ok) {
      throw new Error(`WordPress paginator page ${page}: HTTP ${response.status}`);
    }
    // Some WordPress sites embed literal control characters in JSON string
    // values (e.g. Voodoo H3 has raw newlines inside post bodies). Use the
    // same sanitization as `fetchWordPressPosts` so the paginator survives.
    const raw = await response.text();
    const sanitized = raw
      .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, "")
      .replace(/"(?:[^"\\]|\\.)*"/g, (match) =>
        match.replace(/\t/g, "\\t").replace(/\n/g, "\\n").replace(/\r/g, "\\r"),
      );
    const batch: unknown = JSON.parse(sanitized);
    if (!Array.isArray(batch)) {
      throw new Error(
        `WordPress paginator page ${page}: expected JSON array, got ${typeof batch}`,
      );
    }
    lastBatchSize = batch.length;
    if (batch.length === 0) return posts;
    for (const item of batch as Array<{
      title?: { rendered?: string };
      content?: { rendered?: string };
      link?: string;
      date?: string;
    }>) {
      posts.push({
        title: he.decode(item.title?.rendered ?? ""),
        content: item.content?.rendered ?? "",
        url: item.link ?? "",
        date: item.date ?? "",
      });
    }
    if (batch.length < perPage) return posts;
  }

  // Hit maxPages with a full final batch — more pages exist. Fail loud
  // rather than silently truncate (would corrupt one-shot backfills).
  if (lastBatchSize === perPage) {
    throw new Error(
      `WordPress paginator exhausted maxPages=${maxPages} with a full ` +
        `final batch of ${perPage}. Archive may have more posts. ` +
        `Raise maxPages and re-run.`,
    );
  }
  return posts;
}
