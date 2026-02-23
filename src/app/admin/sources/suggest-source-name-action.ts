"use server";

import { getAdminUser } from "@/lib/auth";

export type SuggestNameResult =
  | { suggestedName: string; source: "api" | "page-meta" | "heuristic" }
  | { error: string };

/**
 * SSRF guard for external fetches.
 * Returns the validated URL object (breaking the taint chain) or an error string.
 */
function validateFetchUrl(
  url: string,
): { ok: true; url: URL } | { ok: false; error: string } {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, error: "Invalid URL" };
  }
  if (!["http:", "https:"].includes(parsed.protocol)) {
    return { ok: false, error: "Only http/https allowed" };
  }
  const h = parsed.hostname;
  if (h === "localhost" || h === "127.0.0.1" || h === "::1") {
    return { ok: false, error: "Localhost not allowed" };
  }
  const ipv4 = h.match(/^(\d+)\.(\d+)\./);
  if (ipv4) {
    const [, a, b] = ipv4.map(Number);
    if (a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)) {
      return { ok: false, error: "Private IP not allowed" };
    }
  }
  return { ok: true, url: parsed };
}

/**
 * Suggest a human-readable name for a source based on its URL and type.
 * Uses type-specific APIs (Calendar, Sheets), page metadata, or heuristics.
 * Never throws — always returns a result or { error }.
 */
export async function suggestSourceName(
  url: string,
  type: string,
  config: Record<string, unknown> | null = null,
): Promise<SuggestNameResult> {
  const admin = await getAdminUser();
  if (!admin) return { error: "Not authorized" };

  if (!url.trim()) return { error: "URL required" };

  try {
    switch (type) {
      case "GOOGLE_CALENDAR":
        return await suggestFromCalendarApi(url);
      case "GOOGLE_SHEETS":
        return await suggestFromSheetsApi(url, config);
      case "MEETUP":
        return suggestFromMeetupSlug(config, url);
      case "ICAL_FEED":
        return await suggestFromIcalHeader(url);
      case "HTML_SCRAPER":
        return await suggestFromPageMeta(url);
      default:
        return suggestFromDomain(url, type);
    }
  } catch {
    return { error: "Name suggestion failed" };
  }
}

/** Google Calendar API — fetches calendar.summary */
async function suggestFromCalendarApi(calendarId: string): Promise<SuggestNameResult> {
  const apiKey = process.env.GOOGLE_CALENDAR_API_KEY;
  if (!apiKey) return { error: "GOOGLE_CALENDAR_API_KEY not configured" };

  const endpoint = new URL(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}`,
  );
  endpoint.searchParams.set("key", apiKey);
  // Hostname assertion: encodeURIComponent cannot inject a different host
  if (endpoint.hostname !== "www.googleapis.com") return { error: "SSRF guard" };

  const res = await fetch(endpoint, { signal: AbortSignal.timeout(5000) });
  if (!res.ok) return { error: `Calendar API error: ${res.status}` };
  const data = (await res.json()) as { summary?: string };
  if (!data.summary) return { error: "No calendar name found" };
  return { suggestedName: data.summary.trim(), source: "api" };
}

/** Google Sheets API — fetches spreadsheet.properties.title */
async function suggestFromSheetsApi(
  url: string,
  config: Record<string, unknown> | null,
): Promise<SuggestNameResult> {
  const apiKey = process.env.GOOGLE_CALENDAR_API_KEY; // same key works for Sheets
  if (!apiKey) return { error: "GOOGLE_CALENDAR_API_KEY not configured" };

  // Prefer sheetId from config, fall back to extracting from URL
  let sheetId = config?.sheetId as string | undefined;
  if (!sheetId) {
    const match = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
    sheetId = match?.[1];
  }
  if (!sheetId) return { error: "No sheet ID found" };

  const endpoint = new URL(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(sheetId)}`,
  );
  endpoint.searchParams.set("fields", "properties.title");
  endpoint.searchParams.set("key", apiKey);
  // Hostname assertion: encodeURIComponent cannot inject a different host
  if (endpoint.hostname !== "sheets.googleapis.com") return { error: "SSRF guard" };

  const res = await fetch(endpoint, { signal: AbortSignal.timeout(5000) });
  if (!res.ok) return { error: `Sheets API error: ${res.status}` };
  const data = (await res.json()) as { properties?: { title?: string } };
  const title = data.properties?.title;
  if (!title) return { error: "No spreadsheet title found" };
  return { suggestedName: title.trim(), source: "api" };
}

/** Meetup — title-case the groupUrlname slug */
function suggestFromMeetupSlug(
  config: Record<string, unknown> | null,
  url: string,
): SuggestNameResult {
  let slug = config?.groupUrlname as string | undefined;
  if (!slug) {
    // Try to extract from URL
    try {
      const parts = new URL(url).pathname.split("/").filter(Boolean);
      slug = parts[0];
    } catch {
      // ignore
    }
  }
  if (!slug) return { error: "No Meetup group slug found" };

  const name = slug
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
  return { suggestedName: name, source: "heuristic" };
}

/** iCal feed — fetch first 2 KB, scan for X-WR-CALNAME: */
async function suggestFromIcalHeader(url: string): Promise<SuggestNameResult> {
  const guard = validateFetchUrl(url);
  if (!guard.ok) return { error: guard.error };

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 5000);
  try {
    const res = await fetch(guard.url, {
      signal: controller.signal,
      headers: { "Range": "bytes=0-2048" },
    });
    if (!res.ok) return { error: `Fetch failed: ${res.status}` };
    const text = await res.text();
    const lines = text.split(/\r?\n/).slice(0, 100);
    for (const line of lines) {
      if (line.startsWith("X-WR-CALNAME:")) {
        const name = line.replace("X-WR-CALNAME:", "").trim();
        if (name) return { suggestedName: name, source: "api" };
      }
    }
    return suggestFromDomain(url, "ICAL_FEED");
  } finally {
    clearTimeout(timeoutId);
  }
}

/** HTML page — extract og:title or <title> */
async function suggestFromPageMeta(url: string): Promise<SuggestNameResult> {
  const guard = validateFetchUrl(url);
  if (!guard.ok) return { error: guard.error };

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 5000);
  try {
    const res = await fetch(guard.url, {
      signal: controller.signal,
      headers: { "User-Agent": "HashTracks-Bot/1.0" },
    });
    if (!res.ok) return { error: `Fetch failed: ${res.status}` };

    // Read at most 50 KB
    const reader = res.body?.getReader();
    if (!reader) return { error: "No response body" };
    const chunks: Uint8Array[] = [];
    let totalBytes = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      totalBytes += value.length;
      if (totalBytes > 50_000) { reader.cancel(); break; }
    }
    const text = new TextDecoder().decode(
      chunks.reduce((acc, c) => {
        const merged = new Uint8Array(acc.length + c.length);
        merged.set(acc); merged.set(c, acc.length);
        return merged;
      }, new Uint8Array(0)),
    );

    // og:title
    const ogMatch = text.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i)
      ?? text.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/i);
    if (ogMatch?.[1]) return { suggestedName: ogMatch[1].trim(), source: "page-meta" };

    // <title>
    const titleMatch = text.match(/<title[^>]*>([^<]+)<\/title>/i);
    if (titleMatch?.[1]) return { suggestedName: titleMatch[1].trim(), source: "page-meta" };

    return suggestFromDomain(url, "HTML_SCRAPER");
  } finally {
    clearTimeout(timeoutId);
  }
}

/** Domain + type heuristic fallback */
function suggestFromDomain(url: string, type?: string): SuggestNameResult {
  try {
    const hostname = new URL(url).hostname.replace(/^www\./, "");
    const domainName = hostname.split(".")[0];
    const suffix = type ? ` (${type.replace(/_/g, " ").toLowerCase()})` : "";
    const name = domainName.charAt(0).toUpperCase() + domainName.slice(1) + suffix;
    return { suggestedName: name, source: "heuristic" };
  } catch {
    return { error: "Could not derive name from URL" };
  }
}
