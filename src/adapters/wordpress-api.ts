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
import { buildUrlVariantCandidates } from "./utils";

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
        const data = (await response.json()) as {
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
