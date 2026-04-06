/**
 * IndexNow client — pings Bing/Yandex/Naver/Seznam/DuckDuckGo to notify them of
 * new or updated URLs for near-instant indexing.
 *
 * Docs: https://www.indexnow.org/documentation
 *
 * Never throws; safe to fire-and-forget. No-op when INDEXNOW_KEY is unset or
 * VERCEL_ENV is set to anything other than "production".
 */

import { getCanonicalSiteUrl } from "./site-url";

const INDEXNOW_ENDPOINT = "https://api.indexnow.org/IndexNow";
const MAX_URLS_PER_REQUEST = 10_000;

interface IndexNowPayload {
  host: string;
  key: string;
  keyLocation: string;
  urlList: string[];
}

export async function pingIndexNow(urls: string[]): Promise<void> {
  if (urls.length === 0) return;

  const key = process.env.INDEXNOW_KEY;
  if (!key) return;
  if (process.env.VERCEL_ENV !== "production") return;

  const baseUrl = getCanonicalSiteUrl();
  const host = new URL(baseUrl).host;
  const keyLocation = `${baseUrl}/${key}.txt`;
  const uniqueUrls = [...new Set(urls)];

  for (let i = 0; i < uniqueUrls.length; i += MAX_URLS_PER_REQUEST) {
    const batch = uniqueUrls.slice(i, i + MAX_URLS_PER_REQUEST);
    const payload: IndexNowPayload = { host, key, keyLocation, urlList: batch };

    try {
      const res = await fetch(INDEXNOW_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json; charset=utf-8" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        console.warn(
          `[indexnow] non-OK response (${res.status}) for batch of ${batch.length} urls`,
        );
      } else {
        console.log(`[indexnow] submitted ${batch.length} urls`);
      }
    } catch (err) {
      console.warn("[indexnow] ping failed:", err);
    }
  }
}
