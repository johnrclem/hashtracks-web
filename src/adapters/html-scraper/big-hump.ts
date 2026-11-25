/**
 * Big Hump Hash House Harriers (BH4) Scraper — St. Louis, MO
 *
 * In Nov 2026 big-hump.com was rebuilt as a static single-page site backed by
 * Firebase. The old PHP pages (`hareline.php`, `hashresults.php?year=YYYY`)
 * now 404. Every trail — the legacy archive back to run #1 (March 1999) plus
 * the upcoming hareline — lives in one Firestore collection, `hashes`, in the
 * `bighump` project, and the collection is publicly readable (the site's own
 * hareline page reads it with the web SDK, no sign-in).
 *
 * We read it through the public Firestore REST API with a `runQuery`
 * structured query: a `startsAt` range filter honors `options.days` at the
 * source, and a field `select` keeps the payload to the fields we map — the
 * documents also carry admin bookkeeping (`createdBy`/`updatedBy` e-mails,
 * `attendeeNames`) that must never reach logs or RawEvents.
 *
 * Document shape (see `normalizeHash` in big-hump.com/assets/hareline.js):
 *   number         integer run number (null for socials / other kennels' events)
 *   startsAt       timestamp (UTC instant; the club is in America/Chicago)
 *   title, hares, location, locationUrl, onAfter   plain strings
 *   kennel         "" or "Big-Hump" for BH4; "Bell-Scott", "STL", … when
 *                  another kennel hosted (legacy rows only, all unnumbered)
 *   status         "scheduled" | "done" | "cancelled"
 *   hashCashCents  integer | null
 *   directions     trail write-up, real HTML (up to 80 KB)
 */

import type { Source } from "@/generated/prisma/client";
import type { SourceAdapter, RawEventData, ScrapeResult, ErrorDetails } from "../types";
import { hasAnyErrors } from "../types";
import { safeFetch } from "../safe-fetch";
import { buildDateWindow, isPlaceholder, stripHtmlTags } from "../utils";
import { formatTimeInZone, formatYmdInTimezone } from "@/lib/timezone";

const KENNEL_TAG = "bh4";
const CLUB_TZ = "America/Chicago";
const SITE_ORIGIN = "https://big-hump.com";
const FIRESTORE_PROJECT = "bighump";
const FIRESTORE_COLLECTION = "hashes";
export const BIG_HUMP_RUN_QUERY_URL =
  `https://firestore.googleapis.com/v1/projects/${FIRESTORE_PROJECT}/databases/(default)/documents:runQuery`;

/** Fields requested from Firestore. Anything else on the document stays server-side. */
const SELECT_FIELDS = [
  "number",
  "startsAt",
  "title",
  "hares",
  "location",
  "locationUrl",
  "onAfter",
  "kennel",
  "status",
  "hashCashCents",
  "directions",
] as const;

/** Long write-ups (some run to 70,000 chars) are capped for the description. */
const MAX_DESCRIPTION_CHARS = 4000;

/** `kennel` values that mean "Big Hump hosted it", after normalisation. */
const OWN_KENNEL_KEYS = new Set(["", "bighump", "bighumph3", "bh4"]);

/** Config stored in source.config JSON */
interface BigHumpConfig {
  /** When false, only runs from today on are read (the old hareline-only mode). */
  includeHistory?: boolean;
}

function parseBigHumpConfig(raw: unknown): BigHumpConfig {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  return { includeHistory: (raw as Record<string, unknown>).includeHistory === true };
}

// ─── Firestore REST value decoding ──────────────────────────────────────────

type FirestoreValue = Record<string, unknown>;
type FirestoreFields = Record<string, FirestoreValue | undefined>;

/** The plain fields we read off one `hashes` document. */
export interface BigHumpHash {
  id: string;
  number: number | null;
  startsAt: Date | null;
  title: string;
  hares: string;
  location: string;
  locationUrl: string;
  onAfter: string;
  kennel: string;
  status: string;
  hashCashCents: number | null;
  directions: string;
}

function stringField(fields: FirestoreFields, key: string): string {
  const v = fields[key]?.stringValue;
  return typeof v === "string" ? v.trim() : "";
}

function integerField(fields: FirestoreFields, key: string): number | null {
  const f = fields[key];
  if (!f) return null;
  const raw = f.integerValue ?? f.doubleValue;
  if (raw === undefined || raw === null) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

function timestampField(fields: FirestoreFields, key: string): Date | null {
  const v = fields[key]?.timestampValue;
  if (typeof v !== "string") return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Decode one Firestore REST document into a {@link BigHumpHash}. */
export function decodeHashDocument(doc: { name?: unknown; fields?: unknown }): BigHumpHash {
  const fields = (doc.fields && typeof doc.fields === "object" ? doc.fields : {}) as FirestoreFields;
  const name = typeof doc.name === "string" ? doc.name : "";
  return {
    id: name.slice(name.lastIndexOf("/") + 1),
    number: integerField(fields, "number"),
    startsAt: timestampField(fields, "startsAt"),
    title: stringField(fields, "title"),
    hares: stringField(fields, "hares"),
    location: stringField(fields, "location"),
    locationUrl: stringField(fields, "locationUrl"),
    onAfter: stringField(fields, "onAfter"),
    kennel: stringField(fields, "kennel"),
    status: stringField(fields, "status") || "scheduled",
    hashCashCents: integerField(fields, "hashCashCents"),
    directions: typeof fields.directions?.stringValue === "string" ? fields.directions.stringValue : "",
  };
}

/**
 * Validate a `runQuery` response body and pull out its documents.
 *
 * The REST stream is a JSON array of `{ document?, readTime?, error? }`.
 * An empty result is `[{ readTime }]`. Anything else — an object, an HTML
 * error page parsed as text, an element carrying `error` — throws so the
 * scrape fails loudly instead of reconciling against a silent empty list.
 */
export function extractRunQueryDocuments(
  body: unknown,
): Array<{ name?: unknown; fields?: unknown }> {
  if (!Array.isArray(body)) {
    throw new TypeError(`Firestore runQuery returned ${body === null ? "null" : typeof body}, expected an array`);
  }
  const docs: Array<{ name?: unknown; fields?: unknown }> = [];
  for (const item of body) {
    if (!item || typeof item !== "object") {
      throw new TypeError("Firestore runQuery returned a non-object element");
    }
    const rec = item as Record<string, unknown>;
    if (rec.error) {
      const msg = (rec.error as { message?: unknown }).message;
      throw new Error(`Firestore runQuery error: ${typeof msg === "string" ? msg : "unknown"}`);
    }
    if (rec.document === undefined) continue;
    const doc = rec.document;
    if (!doc || typeof doc !== "object" || typeof (doc as { name?: unknown }).name !== "string") {
      throw new TypeError("Firestore runQuery returned a document without a name");
    }
    docs.push(doc as { name?: unknown; fields?: unknown });
  }
  return docs;
}

/** Structured query: `hashes` whose `startsAt` falls in [from, to], oldest first. */
export function buildRunQuery(from: Date, to: Date): unknown {
  return {
    structuredQuery: {
      from: [{ collectionId: FIRESTORE_COLLECTION }],
      select: { fields: SELECT_FIELDS.map((fieldPath) => ({ fieldPath })) },
      where: {
        compositeFilter: {
          op: "AND",
          filters: [
            {
              fieldFilter: {
                field: { fieldPath: "startsAt" },
                op: "GREATER_THAN_OR_EQUAL",
                value: { timestampValue: from.toISOString() },
              },
            },
            {
              fieldFilter: {
                field: { fieldPath: "startsAt" },
                op: "LESS_THAN_OR_EQUAL",
                value: { timestampValue: to.toISOString() },
              },
            },
          ],
        },
      },
      orderBy: [{ field: { fieldPath: "startsAt" }, direction: "ASCENDING" }],
    },
  };
}

// ─── Mapping ────────────────────────────────────────────────────────────────

export function toClubDateTime(d: Date): { date: string; startTime?: string } {
  const date = formatYmdInTimezone(d, CLUB_TZ);
  const time = formatTimeInZone(d, CLUB_TZ, "HH:mm");
  return time === "00:00" ? { date } : { date, startTime: time };
}

function isOpenPlaceholder(value: string): boolean {
  return value === "" || value.toLowerCase() === "open" || isPlaceholder(value);
}

function isOwnKennel(kennel: string): boolean {
  return OWN_KENNEL_KEYS.has(kennel.toLowerCase().replaceAll(/[^a-z0-9]/g, ""));
}

function buildDescription(h: BigHumpHash): string | undefined {
  const parts: string[] = [];
  if (h.directions) {
    const text = stripHtmlTags(h.directions, "\n").replaceAll(/\n{3,}/g, "\n\n").trim();
    if (text) {
      parts.push(
        text.length > MAX_DESCRIPTION_CHARS ? `${text.slice(0, MAX_DESCRIPTION_CHARS).trimEnd()}…` : text,
      );
    }
  }
  if (h.onAfter && !isPlaceholder(h.onAfter)) parts.push(`On-after: ${h.onAfter}`);
  return parts.length ? parts.join("\n\n") : undefined;
}

/**
 * Map one decoded hash to a RawEvent, or null when it should be skipped:
 *  - no date, or cancelled
 *  - another kennel's event listed on the BH4 calendar (unnumbered, kennel set)
 *  - a pre-generated future slot with nothing filled in (no title, hares or
 *    start) — the new site's equivalent of the old "Open @ ???" cards (#828)
 */
export function hashToRawEvent(h: BigHumpHash): RawEventData | null {
  if (!h.startsAt || h.status === "cancelled") return null;
  if (h.number === null && !isOwnKennel(h.kennel)) return null;

  const title = isOpenPlaceholder(h.title) ? "" : h.title;
  const hares = isOpenPlaceholder(h.hares) ? "" : h.hares;
  const location = h.location && !isPlaceholder(h.location) ? h.location : "";
  if (h.status === "scheduled" && !title && !hares && !location) return null;

  const { date, startTime } = toClubDateTime(h.startsAt);
  const event: RawEventData = {
    date,
    kennelTags: [KENNEL_TAG],
    sourceUrl: `${SITE_ORIGIN}/hareline.html?h=${encodeURIComponent(h.id)}`,
  };
  if (h.number !== null && h.number > 0) event.runNumber = h.number;
  // A title that is only the hare name is not a title (it would show the
  // hares twice); let merge synthesize "<Kennel> Trail #N" instead.
  if (title && title.toLowerCase() !== hares.toLowerCase()) event.title = title;
  if (hares) event.hares = hares;
  if (location) event.location = location;
  if (/^https?:\/\//i.test(h.locationUrl)) event.locationUrl = h.locationUrl;
  if (startTime) event.startTime = startTime;
  if (h.hashCashCents !== null && h.hashCashCents > 0) {
    const dollars = h.hashCashCents / 100;
    event.cost = `$${Number.isInteger(dollars) ? dollars : dollars.toFixed(2)}`;
  }
  const description = buildDescription(h);
  if (description) event.description = description;
  return event;
}

// ─── Adapter ────────────────────────────────────────────────────────────────

/**
 * Big Hump H3 Scraper — reads the `hashes` Firestore collection behind
 * big-hump.com. Works for any `source.url` on big-hump.com; the data location
 * is fixed by the site's Firebase project, not by the page URL.
 */
export class BigHumpAdapter implements SourceAdapter {
  type = "HTML_SCRAPER" as const;

  async fetch(source: Source, options?: { days?: number }): Promise<ScrapeResult> {
    const config = parseBigHumpConfig(source.config);
    const { minDate, maxDate } = buildDateWindow(options?.days);
    // Without history, read from a day back (the old hareline-only mode), so
    // tonight's run is still in the window after it starts.
    const from = config.includeHistory
      ? minDate
      : new Date(Math.max(minDate.getTime(), Date.now() - 24 * 60 * 60 * 1000));

    const errorDetails: ErrorDetails = {};
    const url = BIG_HUMP_RUN_QUERY_URL;
    const fail = (message: string, status?: number): ScrapeResult => {
      errorDetails.fetch = [{ url, status, message }];
      return { events: [], errors: [message], errorDetails };
    };

    const started = Date.now();
    let body: unknown;
    try {
      const res = await safeFetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(buildRunQuery(from, maxDate)),
      });
      if (!res.ok) return fail(`Firestore runQuery HTTP ${res.status}`, res.status);
      body = await res.json();
    } catch (err) {
      return fail(`Firestore runQuery failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    const fetchDurationMs = Date.now() - started;

    let docs: Array<{ name?: unknown; fields?: unknown }>;
    try {
      docs = extractRunQueryDocuments(body);
    } catch (err) {
      return fail(err instanceof Error ? err.message : String(err));
    }

    const events: RawEventData[] = [];
    const errors: string[] = [];
    let skipped = 0;
    docs.forEach((doc, i) => {
      try {
        const event = hashToRawEvent(decodeHashDocument(doc));
        if (event) events.push(event);
        else skipped++;
      } catch (err) {
        const msg = `Error mapping hash ${i}: ${err instanceof Error ? err.message : String(err)}`;
        errors.push(msg);
        (errorDetails.parse ??= []).push({ row: i, error: msg });
      }
    });

    // Firestore already orders by startsAt; re-sort on (date, run#) so the
    // output is stable even when two docs share an instant.
    events.sort((a, b) => a.date.localeCompare(b.date) || (a.runNumber ?? 0) - (b.runNumber ?? 0));

    // Big Hump runs weekly, so a window with no runs means the collection or its
    // `startsAt` field moved, not that the kennel stopped. Fail loud rather than
    // log a SUCCESS with 0 events.
    if (events.length === 0 && errors.length === 0) {
      const msg = `Big Hump: Firestore returned ${docs.length} document(s) and no runs between ${from.toISOString().slice(0, 10)} and ${maxDate.toISOString().slice(0, 10)} (collection or field drift?)`;
      errors.push(msg);
      (errorDetails.parse ??= []).push({ row: -1, error: msg });
    }

    return {
      events,
      errors,
      ...(hasAnyErrors(errorDetails) ? { errorDetails } : {}),
      diagnosticContext: {
        documentsRead: docs.length,
        eventsEmitted: events.length,
        documentsSkipped: skipped,
        includeHistory: !!config.includeHistory,
        windowFrom: from.toISOString(),
        windowTo: maxDate.toISOString(),
        fetchDurationMs,
      },
    };
  }
}
