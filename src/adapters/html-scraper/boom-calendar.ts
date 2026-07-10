import type { Source } from "@/generated/prisma/client";
import type { SourceAdapter, RawEventData, ScrapeResult, ErrorDetails } from "../types";
import { safeFetch } from "../safe-fetch";
import { stripHtmlTags, decodeEntities, extractHashRunNumber, buildDateWindow } from "../utils";

/**
 * Boom Calendar adapter — for Wix sites whose "calendar" widget is the
 * third-party **Boom Calendar** app (calendar.boomte.ch, appDefId
 * `13b4a028-00fa-7133-242f-4628106b8c91`), NOT the native Wix Events app.
 *
 * Boom's widget loads its events from Boom's own backend inside a cross-origin
 * iframe, so the data is invisible to the parent page's SSR/network. The events
 * are reachable directly via a single authenticated GET:
 *
 *   GET https://calendar.apiboomtech.com/api/calendar?comp_id=<compId>&instance=<jwt>
 *
 * The `instance` is a short-lived JWT minted per-site by Wix; fetch a fresh one
 * each scrape from the site's own token endpoint (keyed on the Boom appDefId):
 *
 *   GET https://<siteHost>/_api/v1/access-tokens
 *     → apps["13b4a028-00fa-7133-242f-4628106b8c91"].instance
 *
 * Config (source.config): { boomCompId, kennelTag, upcomingOnly?, boomAppDefId? }.
 * First used by Taoyuan Metro H3 (tymh3.com). Reference: the cross-origin Boom
 * fetch was mapped via Claude-in-Chrome (2026-07-09).
 */

const BOOM_APP_DEF_ID = "13b4a028-00fa-7133-242f-4628106b8c91";
const BOOM_API_URL = "https://calendar.apiboomtech.com/api/calendar";
const ACCESS_TOKENS_PATH = "/_api/v1/access-tokens";

const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36";

export interface BoomCalendarConfig {
  /** Wix component id of the Boom widget (e.g. "comp-mcofr70d"). Stable per placement. */
  boomCompId: string;
  /** kennelCode the events route to. */
  kennelTag: string;
  /** Boom app definition id — defaults to the known Boom Calendar app. */
  boomAppDefId?: string;
  /** Protects aged-out past events from reconcile (Boom shows a recent-past + upcoming window). */
  upcomingOnly?: boolean;
}

interface AccessTokensResponse {
  apps?: Record<string, { instance?: string } | undefined>;
}

interface BoomVenue {
  name?: string;
  address?: string;
  lat?: number | string;
  lng?: number | string;
}

interface BoomEvent {
  id?: number | string;
  title?: string;
  start?: string; // "2026-07-03T19:15" (local, no offset)
  end?: string;
  time_zone?: string;
  all_day?: number;
  desc?: string; // HTML
  venue?: BoomVenue | string;
}

interface BoomCalendarResponse {
  name?: string;
  time_zone?: string;
  country?: string;
  events?: BoomEvent[];
}

const START_RE = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/;
// "Hares/兔子:" or "Hares:" up to the end of the line.
const HARES_RE = /Hares(?:\/[^:]*)?:\s*([^\n]+)/i;
// "Place/地點:" or "Place:" up to the end of the line.
const PLACE_RE = /Place(?:\/[^:]*)?:\s*([^\n]+)/i;
const MAPS_URL_RE = /https?:\/\/(?:maps\.app\.goo\.gl|goo\.gl\/maps|(?:www\.)?google\.[a-z.]+\/maps)[^\s"'<)]+/i;

function toNumber(v: number | string | undefined): number | undefined {
  if (typeof v === "number") return Number.isFinite(v) ? v : undefined;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

function parseVenue(v: BoomEvent["venue"]): BoomVenue {
  if (!v) return {};
  if (typeof v === "string") {
    try {
      return JSON.parse(v) as BoomVenue;
    } catch {
      return {};
    }
  }
  return v;
}

function clean(s: string | undefined | null): string | undefined {
  const t = (s ?? "").replace(/\s+/g, " ").trim();
  return t || undefined;
}

/** Pull a labelled value ("Hares:", "Place:") out of the HTML description body. */
function extractDescField(descText: string, re: RegExp): string | undefined {
  const m = re.exec(descText);
  return m ? clean(m[1]) : undefined;
}

/** Convert Boom's HTML desc into newline-preserving plain text for label parsing. */
function descToText(html: string | undefined): string {
  if (!html) return "";
  const withBreaks = html
    .replace(/<\/(?:p|div|li|h[1-6])>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n");
  return decodeEntities(stripHtmlTags(withBreaks));
}

/** A network/validation step that either yields a value or a terminal ScrapeResult error. */
interface StepResult<T> {
  value?: T;
  error?: ScrapeResult;
}

function fail(msg: string, details: ErrorDetails): ScrapeResult {
  return { events: [], errors: [msg], errorDetails: details };
}

/** Step 1 — mint a fresh short-lived Boom instance from the site's Wix token endpoint. */
async function mintBoomInstance(siteOrigin: string, appDefId: string): Promise<StepResult<string>> {
  const tokensUrl = `${siteOrigin}${ACCESS_TOKENS_PATH}`;
  try {
    const res = await safeFetch(tokensUrl, { headers: { "User-Agent": BROWSER_UA } });
    if (!res.ok) {
      const msg = `access-tokens fetch failed: HTTP ${res.status}`;
      return { error: fail(msg, { fetch: [{ url: tokensUrl, status: res.status, message: msg }] }) };
    }
    const json = (await res.json()) as AccessTokensResponse;
    const instance = json.apps?.[appDefId]?.instance;
    if (!instance) {
      const msg = `Boom instance not found for appDefId ${appDefId} at ${tokensUrl} (app not installed / rotated?)`;
      return { error: fail(msg, { parse: [{ row: 0, error: msg }] }) };
    }
    return { value: instance };
  } catch (err) {
    const msg = `access-tokens fetch error: ${err}`;
    return { error: fail(msg, { fetch: [{ url: tokensUrl, message: msg }] }) };
  }
}

/** Step 2 — one GET returns the calendar config + all events. */
async function fetchBoomEvents(boomCompId: string, instance: string): Promise<StepResult<BoomEvent[]>> {
  const calUrl = `${BOOM_API_URL}?comp_id=${encodeURIComponent(boomCompId)}&instance=${encodeURIComponent(instance)}`;
  try {
    const res = await safeFetch(calUrl, { headers: { "User-Agent": BROWSER_UA } });
    if (!res.ok) {
      const msg = `Boom calendar fetch failed: HTTP ${res.status}`;
      return { error: fail(msg, { fetch: [{ url: BOOM_API_URL, status: res.status, message: msg }] }) };
    }
    const data = (await res.json()) as BoomCalendarResponse;
    if (!Array.isArray(data.events)) {
      const msg = "Boom calendar response missing events[] (shape change?)";
      return { error: fail(msg, { parse: [{ row: 0, error: msg }] }) };
    }
    return { value: data.events };
  } catch (err) {
    const msg = `Boom calendar fetch error: ${err}`;
    return { error: fail(msg, { fetch: [{ url: BOOM_API_URL, message: msg }] }) };
  }
}

/** Map one Boom event to RawEventData. Returns `{}` when windowed-out, `{ error }` on a bad row. */
function mapBoomEvent(
  ev: BoomEvent,
  kennelTag: string,
  minStr: string,
  maxStr: string,
): { event?: RawEventData; error?: string } {
  const m = ev.start ? START_RE.exec(ev.start) : null;
  if (!m) return { error: `Skipped Boom event id=${ev.id ?? "?"}: unparseable start "${ev.start ?? ""}"` };
  const date = m[1];
  if (date < minStr || date > maxStr) return {};

  const isAllDay = ev.all_day === 1;
  const title = clean(ev.title);
  const venue = parseVenue(ev.venue);
  const descText = descToText(ev.desc);

  return {
    event: {
      date,
      kennelTags: [kennelTag],
      title,
      runNumber: extractHashRunNumber(title),
      startTime: isAllDay ? undefined : m[2],
      endTime: isAllDay ? undefined : (ev.end ? START_RE.exec(ev.end)?.[2] : undefined),
      hares: extractDescField(descText, HARES_RE),
      // Boom's structured venue.name is often blank; the readable place name
      // lives in the desc "Place/地點:" line. Prefer it, fall back to venue.name.
      location: extractDescField(descText, PLACE_RE) ?? clean(venue.name),
      locationStreet: clean(venue.address),
      locationUrl: MAPS_URL_RE.exec(ev.desc ?? "")?.[0],
      latitude: toNumber(venue.lat),
      longitude: toNumber(venue.lng),
    },
  };
}

export class BoomCalendarAdapter implements SourceAdapter {
  type = "HTML_SCRAPER" as const;

  async fetch(source: Source, options?: { days?: number }): Promise<ScrapeResult> {
    const config = (source.config ?? {}) as Partial<BoomCalendarConfig>;
    const { boomCompId, kennelTag } = config;
    const appDefId = config.boomAppDefId ?? BOOM_APP_DEF_ID;

    if (!boomCompId || !kennelTag) {
      const msg = "BoomCalendar config missing boomCompId or kennelTag";
      return fail(msg, { parse: [{ row: 0, error: msg }] });
    }

    let siteOrigin: string;
    try {
      siteOrigin = new URL(source.url).origin;
    } catch {
      const msg = `BoomCalendar: invalid source.url "${source.url}"`;
      return fail(msg, { parse: [{ row: 0, error: msg }] });
    }

    const minted = await mintBoomInstance(siteOrigin, appDefId);
    if (minted.error) return minted.error;

    const fetched = await fetchBoomEvents(boomCompId, minted.value as string);
    if (fetched.error) return fetched.error;
    const rawEvents = fetched.value as BoomEvent[];

    const days = options?.days ?? 90;
    const { minDate, maxDate } = buildDateWindow(days);
    const minStr = minDate.toISOString().slice(0, 10);
    const maxStr = maxDate.toISOString().slice(0, 10);

    const events: RawEventData[] = [];
    const errors: string[] = [];
    for (const ev of rawEvents) {
      const { event, error } = mapBoomEvent(ev, kennelTag, minStr, maxStr);
      if (error) errors.push(error);
      else if (event) events.push(event);
    }

    // Fail loud on a parse break (raw events present but none survived parsing)
    // so reconcile is suppressed; a genuinely-empty upcoming feed (0 raw events)
    // returns cleanly and lets reconcile handle aged-out events.
    if (rawEvents.length > 0 && events.length === 0 && errors.length === 0) {
      const msg = `Boom calendar returned ${rawEvents.length} raw event(s) but none parsed into the ${days}-day window`;
      return fail(msg, { parse: [{ row: 0, error: msg }] });
    }

    return { events, errors, errorDetails: undefined };
  }
}
