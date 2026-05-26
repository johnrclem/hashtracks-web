import * as cheerio from "cheerio";
import type { RawEventData } from "../types";

const BASE_URL = "https://hashrego.com";

/** Entry from the events index table */
export interface IndexEntry {
  slug: string; // URL slug: "ewh3-1506-huaynaputinas-revenge-february-19-2026-"
  kennelSlug: string; // "EWH3", "BFMH3", etc.
  title: string;
  startDate: string; // "MM/DD/YY"
  startTime: string; // "HH:MM AM/PM" or empty
  type: string; // "Trail", "Hash Weekend", "Hash Campout"
  cost: string; // "$10", "$85", etc.
}

/** Parsed event detail from a single event page */
export interface ParsedEvent {
  title: string;
  dates: string[]; // YYYY-MM-DD format — 1 for single-day, 2+ for multi-day
  startTimes: string[]; // HH:MM per date (or empty array)
  location?: string;
  locationAddress?: string;
  locationUrl?: string;
  hares?: string;
  description?: string;
  cost?: string;
  kennelSlug: string;
  /** Display name of the host kennel from the detail page (e.g. "Tidewater H3").
   * Preferred over `kennelSlug` for resolver matching: hashrego slugs like
   * "TH3" collide across regions (Chicago Thirstday kennelCode=th3 vs
   * Tidewater H3 — hashrego #806). The display name is unambiguous. */
  hostKennelName?: string;
  isMultiDay: boolean;
  /**
   * Inclusive last day of a single-registration venue weekend (#1560 PR C).
   * Populated by `detectVenueWeekendEndDate` when the description mentions
   * a weekend / campout / retreat trigger word plus ≥2 weekday labels but
   * no explicit per-day dates. MadisonH3 Token Run Campout is the
   * motivating case. Single-day events leave this undefined.
   */
  endDate?: string;
  /**
   * Per-day kennel-code override (PR D.5). Populated only when the source
   * declares `kennelPatterns` AND the multi-day section parser matched one
   * of them against a day's section text (e.g. NYC 5-Boro's Friday section
   * names "GGFM Strawberry Moon Trail" → `ggfm`). Aligned with `dates` by
   * index. Entries are `undefined` for days that didn't match any pattern;
   * `splitToRawEvents` falls back to the host kennel for those days.
   */
  perDayKennelCodes?: ReadonlyArray<string | undefined>;
  /**
   * Per-day section-header title (PR E.1). Pulled from the text AFTER the
   * `WEEKDAY/Day N M/D` delimiter on the same line (`**FRIDAY 6/26 — GGFM
   * Strawberry Moon Trail**` → "GGFM Strawberry Moon Trail"). Aligned with
   * `dates` by index. Entries are `undefined` when the slice has no title
   * after the delimiter; `splitToRawEvents` falls back to
   * `"${title} (Day N)"` for those days (the pre-E.1 behavior).
   */
  perDayTitles?: ReadonlyArray<string | undefined>;
}

/**
 * Parse the events index table from hashrego.com/events.
 * Table structure: #eventListTable > tbody > tr > td
 * Columns: Event Name | Type | Host Kennel | Start Date | Cost | Rego'd Hashers
 */
export function parseEventsIndex(html: string): IndexEntry[] {
  const $ = cheerio.load(html);
  const entries: IndexEntry[] = [];

  $("#eventListTable tbody tr").each((_i, row) => {
    const cells = $(row).find("td");
    if (cells.length < 6) return;

    // Col 0: Event name with link to /events/{slug}
    const eventLink = $(cells[0]).find("a");
    const href = eventLink.attr("href") || "";
    const slugMatch = href.match(/^\/events\/([^/]+)/);
    if (!slugMatch) return;
    const slug = slugMatch[1];
    const title = eventLink.text().trim();

    // Col 1: Type (Trail, Hash Weekend, etc.)
    const type = $(cells[1]).text().trim();

    // Col 2: Host Kennel with link to /kennels/{slug}/
    const kennelLink = $(cells[2]).find("a");
    const kennelHref = kennelLink.attr("href") || "";
    const kennelMatch = kennelHref.match(/^\/kennels\/([^/]+)/);
    if (!kennelMatch) return;
    const kennelSlug = kennelMatch[1];

    // Col 3: Start Date "MM/DD/YY\nHH:MM AM/PM"
    const dateCell = $(cells[3]).html() || "";
    // Date and time are separated by <br>
    const dateParts = dateCell.split(/<br\s*\/?>/i).map((s) => s.replace(/<[^>]+>/g, "").trim());
    const startDate = dateParts[0] || "";
    const startTime = dateParts[1] || "";

    // Col 4: Cost
    const cost = $(cells[4]).text().trim();

    entries.push({ slug, kennelSlug, title, startDate, startTime, type, cost });
  });

  return entries;
}

/**
 * Parse Hash Rego date "MM/DD/YY" or "MM/DD" into "YYYY-MM-DD".
 * Uses referenceYear when only MM/DD is provided.
 */
export function parseHashRegoDate(
  text: string,
  referenceYear?: number,
): string | null {
  const trimmed = text.trim();

  // MM/DD/YY or MM/DD/YYYY
  const fullMatch = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (fullMatch) {
    const month = parseInt(fullMatch[1], 10);
    const day = parseInt(fullMatch[2], 10);
    let year = parseInt(fullMatch[3], 10);
    if (year < 100) year += 2000;
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }

  // MM/DD only — needs reference year
  const shortMatch = trimmed.match(/^(\d{1,2})\/(\d{1,2})$/);
  if (shortMatch && referenceYear) {
    const month = parseInt(shortMatch[1], 10);
    const day = parseInt(shortMatch[2], 10);
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    return `${referenceYear}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }

  return null;
}

/**
 * Parse Hash Rego time "HH:MM AM/PM" into 24h "HH:MM".
 *
 * Hash Rego stores times as literal strings entered by kennel mismanagement,
 * and anything between 11:00 PM and 4:00 AM is in practice a placeholder for
 * "no start time set" — kennels pick different variants ("11:59 PM" was the
 * original, but "11:45 PM" and others show up in the wild. See issue #487
 * for the EWH3 1355 case.). Real hash runs don't start in that window on
 * this platform, so the whole band is treated as absent.
 */
export function parseHashRegoTime(text: string): string | null {
  const match = text.trim().match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
  if (!match) return null;

  let hours = parseInt(match[1], 10);
  const minutes = parseInt(match[2], 10);
  const ampm = match[3].toUpperCase();

  if (ampm === "PM" && hours !== 12) hours += 12;
  if (ampm === "AM" && hours === 12) hours = 0;

  if (hours >= 23 || hours < 4) return null;

  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

/**
 * Extract structured data from an event detail page.
 * The description is in the og:description meta tag (markdown-like).
 * Kennel slug is in sidebar links: /kennels/{slug}/
 * Date/time is in the h4 header in the content area.
 */
export function parseEventDetail(
  html: string,
  slug: string,
  indexEntry?: IndexEntry,
  kennelPatterns?: KennelPatternConfig,
): ParsedEvent {
  const $ = cheerio.load(html);

  // Title from <title> tag or og:title
  const ogTitle = $('meta[property="og:title"]').attr("content") || "";
  // og:title format: "MM/DD EventTitle"
  const titleFromOg = ogTitle.replace(/^\d{2}\/\d{2}\s+/, "").trim();
  const title = titleFromOg || $("title").text().trim();

  // Kennel slug from sidebar link
  const kennelLink = $('a[href^="/kennels/"]').first();
  const kennelHref = kennelLink.attr("href") || "";
  const kennelMatch = kennelHref.match(/\/kennels\/([^/]+)/);
  const kennelSlug = kennelMatch?.[1] || indexEntry?.kennelSlug || "";

  // Host Kennel display name (#806): hashrego slugs like "TH3" collide across
  // regions. The "Host Kennel:" heading is followed by an <a> to the kennel
  // profile whose link text is the display name ("Tidewater H3"). Preferring
  // this over the slug makes the resolver match the correct kennel.
  const hostKennelName = extractHostKennelName($);

  // Description from og:description meta tag
  const rawDescription = $('meta[property="og:description"]').attr("content") || "";

  // Parse structured fields from the description text
  const haresFromDescription = extractField(rawDescription, "Hare(s)") || extractField(rawDescription, "Hares");
  // Fallback: extract hares from DOM when og:description doesn't carry them
  // (#806). Detail page renders `<p><strong>Hare(s):</strong></p>` followed
  // by a sibling `<p>` with the comma/&-joined hare names.
  const hares = haresFromDescription || extractHaresFromDom($);
  const cost = extractField(rawDescription, "Cost") || indexEntry?.cost;

  // og:description-based location extraction (legacy path — only fires for
  // events whose host kennel writes labeled fields into the description).
  const descLocation = extractLocationFromDescription(rawDescription);
  const descAddress = extractAddressFromDescription(rawDescription);
  const mapsMatch = rawDescription.match(/maps\.google\.com\/maps\?q=([^)\s"]+)/);
  const descLocationUrl = mapsMatch
    ? `https://maps.google.com/maps?q=${mapsMatch[1]}`
    : undefined;

  // DOM fallback for the `.location` column (#1578). Many events publish only
  // the structured `<h4>Start Location Details</h4>` block in markup, with no
  // labeled fields in og:description — that path used to drop venue + address
  // entirely.
  const domLocation = extractLocationFromDom($);
  const location = descLocation || domLocation.venue;
  const locationAddress = descAddress || domLocation.address;
  const locationUrl = descLocationUrl || domLocation.mapsUrl;

  // Parse dates from the description or index entry
  const { dates, startTimes, isMultiDay, endDate, perDayKennelCodes, perDayTitles } = extractDates(
    rawDescription,
    indexEntry,
    title,
    kennelPatterns,
  );

  // Clean description: remove structured fields we already extracted
  const description = cleanDescription(rawDescription);

  return {
    title,
    dates,
    startTimes,
    location: location || locationAddress,
    locationAddress,
    locationUrl,
    hares,
    description,
    cost,
    kennelSlug,
    hostKennelName,
    isMultiDay,
    endDate,
    perDayKennelCodes,
    perDayTitles,
  };
}

/**
 * Extract the Host Kennel display name from the "Host Kennel:" block.
 *
 * Layout (profile-box):
 *   <h4>Host Kennel:</h4>
 *   <div class="half-size pull-left"><a href="/kennels/SLUG/"><img/></a></div>
 *   <div class="half-size pull-right">
 *     <p><strong><a href="/kennels/SLUG/">Display Name</a></strong></p>
 *
 * Walks forward from the heading through following siblings, returning the
 * first non-empty kennel-link text. Skips the image-wrapping `<a>` whose
 * text is empty.
 */
function extractHostKennelName($: cheerio.CheerioAPI): string | undefined {
  const heading = $("h4")
    .filter((_, el) => /host\s+kennel/i.test($(el).text()))
    .first();
  if (heading.length === 0) return undefined;
  // Scan forward until the next heading (h1–h6) so a DOM reshuffle can't
  // bind an unrelated kennel link further down the page.
  for (const sibling of heading.nextAll().toArray()) {
    if (/^h[1-6]$/i.test(sibling.tagName ?? "")) break;
    const text = $(sibling).find('a[href^="/kennels/"]').first().text().trim();
    if (text.length > 0) return text;
  }
  return undefined;
}

/**
 * Extract hares from the detail-page DOM when `Hare(s):` is missing from
 * og:description. Layout: `<strong>Hare(s):</strong>` inside a `<p>`,
 * followed by a sibling `<p>` with the comma/&-joined names. See #806.
 *
 * The page emits the Hare(s) block twice (responsive LG/XS variants); we scan
 * all matches and return the first that has a non-label sibling `<p>`, so a
 * DOM reshuffle that leaves the first block empty still finds the value.
 */
function extractHaresFromDom($: cheerio.CheerioAPI): string | undefined {
  const labels = $("strong")
    .filter((_, el) => /^\s*hare\(?s\)?:?\s*$/i.test($(el).text()))
    .toArray();
  for (const el of labels) {
    const labelP = $(el).closest("p");
    const valueP = labelP.nextAll("p").first();
    if (valueP.length === 0) continue;
    // Skip if the "value" paragraph is itself another field label —
    // `<p><strong>Shiggy:</strong></p>` directly following an empty hare
    // block, where the inner <strong> ends with ":". Narrowed from "any
    // <strong>" to "label-shaped <strong>" so kennels that format hare
    // names with inline bold (e.g., `<p><strong>Slip'n'Ride</strong>,
    // Whip It Out</p>`) still parse. (Codex PR #1626 review)
    const innerStrongs = valueP.find("strong");
    if (innerStrongs.length > 0 && innerStrongs.toArray().every(
      (s) => /:\s*$/.test($(s).text()),
    )) continue;
    const text = valueP.text().replaceAll(/\s+/g, " ").trim();
    if (text.length > 0) return text;
  }
  return undefined;
}

/**
 * Extract venue + address + maps URL from the `<h4>Start Location Details</h4>`
 * block in the `.location` column (#1578). Most hashrego events render their
 * location DOM-only — og:description carries the event blurb, not labeled
 * `Location:` fields — so without this fallback we drop venue/address entirely.
 *
 * Layout:
 *   <div class="col-sm-6 location">
 *     <h4 class="text-center"><strong>Start Location Details</strong></h4>
 *     <div class="tab-content">
 *       <div class="tab-pane active" id="location">
 *         <p>West Park</p>                              ← venue (no <a>)
 *         <p><a href="//maps.google.com/maps?q=215 Chapin St, …">…</a></p>
 *       </div>
 *     </div>
 *   </div>
 *
 * Returns the first non-empty text `<p>` without a maps link as `venue`, the
 * first `<p>` whose `<a>` points at `maps.google.com/maps?q=` as `address`
 * (the link text), and the absolute URL as `mapsUrl`. Empty/missing fields
 * are returned undefined so callers can mix with og:description-derived
 * values.
 */
function extractLocationFromDom(
  $: cheerio.CheerioAPI,
): { venue?: string; address?: string; mapsUrl?: string } {
  const heading = $("h4")
    .filter((_, el) => /Start\s+Location\s+Details/i.test($(el).text()))
    .first();
  if (heading.length === 0) return {};

  const column = heading.closest(".location, .col-sm-6").first();
  const scope = column.length > 0 ? column : heading.parent();

  let venue: string | undefined;
  let address: string | undefined;
  let mapsUrl: string | undefined;

  scope.find("p").each((_i, el) => {
    const $p = $(el);
    const text = $p.text().replaceAll(/\s+/g, " ").trim();
    if (!text) return;
    const mapsAnchor = $p
      .find("a")
      .filter((_j, a) => /maps\.google\.com\/maps\?q=/i.test($(a).attr("href") || ""))
      .first();
    if (mapsAnchor.length > 0) {
      if (!address) address = text;
      if (!mapsUrl) {
        const href = mapsAnchor.attr("href") || "";
        // Normalize protocol-relative `//maps.google.com/…` to https://.
        mapsUrl = href.startsWith("//") ? `https:${href}` : href;
      }
    } else if (!venue) {
      venue = text;
    }
  });

  return { venue, address, mapsUrl };
}

/**
 * Split a parsed event into per-day RawEventData entries.
 * For single-day events, returns one entry.
 * For multi-day events, returns one per date with seriesId set.
 */
export function splitToRawEvents(
  parsed: ParsedEvent,
  slug: string,
): RawEventData[] {
  const hashRegoUrl = `${BASE_URL}/events/${slug}`;
  const externalLinks = [{ url: hashRegoUrl, label: "Hash Rego" }];

  if (!parsed.isMultiDay || parsed.dates.length <= 1) {
    // Single-day event — or a venue-weekend campout that registers as ONE
    // row but spans multiple days (#1560 PR C — MadisonH3 Token Run). The
    // venue-weekend branch surfaces `parsed.endDate`; the merge pipeline
    // writes it onto the canonical Event so the UI renders the
    // date-range pill without the "+ N trails" expansion (no children).
    const date = parsed.dates[0];
    if (!date) return [];

    return [
      {
        date,
        kennelTags: [parsed.hostKennelName || parsed.kennelSlug],
        title: parsed.title,
        description: parsed.description,
        hares: parsed.hares,
        location: parsed.location,
        locationUrl: parsed.locationAddress || parsed.locationUrl,
        startTime: parsed.startTimes[0] || undefined,
        sourceUrl: hashRegoUrl,
        externalLinks,
        ...(parsed.endDate ? { endDate: parsed.endDate } : {}),
      },
    ];
  }

  // Multi-day event. Two emission shapes:
  //
  //   (1) No per-day kennel override on Day 1 — Day 1 IS the parent. The
  //       earliest day carries the umbrella title (no "(Day N)" suffix)
  //       and the inclusive `endDate`. Later days are children with the
  //       "(Day N)" suffix. This is the original PR B behavior, used by
  //       campouts where every day's section text resolves to the host
  //       kennel (or where the source declares no `kennelPatterns`).
  //
  //   (2) Day 1 has a per-day kennel override different from host (PR D.5
  //       — NYC 5-Boro Friday is GGFM, not the umbrella's host NYCH3).
  //       We prepend a SYNTHETIC parent row on Day 1's date, tagged with
  //       the host kennel. Day 1 then becomes a regular child with its
  //       GGFM tag, alongside the other day-children. This shape lets
  //       cross-source dedup work: HashNYC's standalone Friday GGFM row
  //       merges into the GGFM child via the same-day matcher, instead
  //       of producing a duplicate canonical Event.
  //
  // The parent always stays on the host kennel — the umbrella belongs to
  // whoever registered it on hashrego, not to a single day.
  const seriesId = slug; // Use the Hash Rego slug as series identifier
  const lastDate = parsed.dates.at(-1);
  const hostKennelTag = parsed.hostKennelName || parsed.kennelSlug;
  const day1Code = parsed.perDayKennelCodes?.[0];
  // Compare Day-1 override against the host kennel CODE (kennelSlug), not the
  // display-name `hostKennelTag` (Codex/CodeRabbit P1, PR #1667). day1Code is
  // a lowercase kennelCode from kennelPatterns ("ggfm", "nych3", …) whereas
  // hostKennelTag is often a display name like "NYC H3" or an uppercase slug
  // like "NYCH3". A direct string comparison would emit a spurious synthetic
  // parent any time the patterns match the host kennel by name.
  const hostKennelCode = parsed.kennelSlug.toLowerCase();
  const needsSyntheticParent =
    day1Code !== undefined && day1Code.toLowerCase() !== hostKennelCode;

  const buildChild = (date: string, i: number): RawEventData => {
    const dayLabel = `Day ${i + 1}`;
    const perDayCode = parsed.perDayKennelCodes?.[i];
    // PR E.1: prefer the section-header title from the source description
    // ("Strawberry Moon Trail" — already kennel-prefix-stripped by
    // `parseDayHeaderSections` when a matching kennel pattern was hit, per
    // PR E.2) over the legacy "(Day N)" suffix. The suffix remains the
    // fallback when the description had no parseable section title.
    const sectionTitle = parsed.perDayTitles?.[i];
    const childTitle = sectionTitle ?? `${parsed.title} (${dayLabel})`;
    return {
      date,
      kennelTags: [perDayCode ?? hostKennelTag],
      title: childTitle,
      description: parsed.description,
      hares: parsed.hares,
      location: parsed.location,
      locationUrl: parsed.locationAddress || parsed.locationUrl,
      startTime: parsed.startTimes[i] || parsed.startTimes[0] || undefined,
      sourceUrl: hashRegoUrl,
      externalLinks,
      seriesId,
    };
  };

  if (needsSyntheticParent) {
    // Shape (2): synthetic host-kennel parent + N children.
    // Parent carries the umbrella description but NO per-day fields (hares,
    // location, startTime) — those belong to the day's child row. Without
    // this split, the merge pipeline's same-day matcher would absorb the
    // parent into a sibling event using its hares/startTime.
    const parent: RawEventData = {
      date: parsed.dates[0],
      kennelTags: [hostKennelTag],
      title: parsed.title,
      description: parsed.description,
      sourceUrl: hashRegoUrl,
      externalLinks,
      seriesId,
      seriesParent: true,
      endDate: lastDate,
    };
    return [parent, ...parsed.dates.map((date, i) => buildChild(date, i))];
  }

  // Shape (1): Day 1 doubles as parent (original PR B behavior).
  return parsed.dates.map((date, i) => {
    if (i === 0) {
      return {
        date,
        kennelTags: [hostKennelTag],
        title: parsed.title,
        description: parsed.description,
        hares: parsed.hares,
        location: parsed.location,
        locationUrl: parsed.locationAddress || parsed.locationUrl,
        startTime: parsed.startTimes[0] || undefined,
        sourceUrl: hashRegoUrl,
        externalLinks,
        seriesId,
        seriesParent: true,
        endDate: lastDate,
      };
    }
    return buildChild(date, i);
  });
}

// ── Internal helpers ──

/** Extract a **Field:** value from markdown-like text */
function extractField(text: string, fieldName: string): string | undefined {
  // Match both **Field:** and **Field: ** patterns
  const pattern = new RegExp(
    `\\*\\*${escapeRegExp(fieldName)}:?\\*\\*:?\\s*(.+?)(?:\\n|$)`,
    "i",
  );
  const match = text.match(pattern);
  if (match) return match[1].trim();

  // Also match plain "Field: value" (no bold)
  const plainPattern = new RegExp(
    `(?:^|\\n)\\s*${escapeRegExp(fieldName)}:?\\s+(.+?)(?:\\n|$)`,
    "i",
  );
  const plainMatch = text.match(plainPattern);
  return plainMatch ? plainMatch[1].trim() : undefined;
}

/** Extract location from "Where:" field in description */
function extractLocationFromDescription(text: string): string | undefined {
  return extractField(text, "Where");
}

/** Extract address from description (Google Maps URL or address line).
 *  Two-pass: find the label heading, then apply ADDRESS_RE to the slice
 *  after it. Gated by a leading street number and a trailing `STATE ZIP`
 *  pair — the street-suffix whitelist was a loose heuristic that both
 *  SonarCloud (S5843 complexity) and Codacy (non-literal RegExp) rejected. */
const ADDRESS_RE = /(\d+\s+[\w\s.,]+?\s+[A-Z]{2}\s*\d{5})/i;
// Line-bound label so we don't match "Parking Location:" mid-prose, but
// allows the address on the same line after the colon (inline) OR on the
// next line. Strip the `[\r\n]`-required version missed `Location: 123 Main`.
const LOCATION_LABEL_RE =
  /(?:^|[\r\n])\s*(?:Location\s+of\s+event|On-?On|Location|Where|Start\s+Location)\s*:?\s*/i;

function extractAddressFromDescription(text: string): string | undefined {
  // Prefer the address under a "Location of event" / "Location" / "On-On" /
  // "Where" heading so multi-address descriptions (e.g. a Parking block +
  // the actual start location — #806) don't pick the wrong one.
  const labelMatch = LOCATION_LABEL_RE.exec(text);
  if (labelMatch) {
    const afterLabel = text.slice(labelMatch.index + labelMatch[0].length);
    const labeledAddr = ADDRESS_RE.exec(afterLabel);
    if (labeledAddr) return labeledAddr[1].trim();
  }
  const addressMatch = ADDRESS_RE.exec(text);
  return addressMatch ? addressMatch[1].trim() : undefined;
}

/** Generate all YYYY-MM-DD date strings in a range (inclusive). */
function generateDatesInRange(startDate: Date, endDate: Date): string[] {
  const dates: string[] = [];
  const current = new Date(startDate);
  while (current <= endDate) {
    const m = current.getUTCMonth() + 1;
    const d = current.getUTCDate();
    const y = current.getUTCFullYear();
    dates.push(`${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`);
    current.setUTCDate(current.getUTCDate() + 1);
  }
  return dates;
}

/** Extract per-day start times from description text. */
function extractPerDayStartTimes(description: string, dateCount: number): string[] {
  const startTimes: string[] = [];
  const timePatterns = description.matchAll(
    /(\d{1,2}):(\d{2})\s+(show|go|start)/gi,
  );
  for (const tm of timePatterns) {
    const h = parseInt(tm[1], 10);
    const min = parseInt(tm[2], 10);
    const adjustedH = h < 12 && h >= 1 && h <= 9 ? h + 12 : h;
    startTimes.push(
      `${String(adjustedH).padStart(2, "0")}:${String(min).padStart(2, "0")}`,
    );
  }
  while (startTimes.length < dateCount) {
    startTimes.push(startTimes[0] || "");
  }
  return startTimes;
}

/**
 * Match per-day section headers in two shapes (one regex each to stay
 * under Sonar S5843 complexity 20; combining both forms into a single
 * alternation pushed complexity to ~24).
 *
 * 1. `**DAY 1 1/15 —**`, `Day 2: 2/16`, `Day 3 1/17` (the original
 *    PR B pattern for events that use a `Day N` ordinal).
 * 2. `**FRIDAY 6/26 — title**`, `**Saturday 6/27 — title**` (PR D —
 *    needed for NYC H3 5-Boro Pub Crawl which numbers days by
 *    weekday name instead of `Day N`).
 *
 * Both regexes share capture-group positions for month + day so the caller
 * treats them uniformly:
 *   - DAY_NUMBER_HEADER_RE: m[1] = month, m[2] = day
 *   - WEEKDAY_HEADER_RE:    m[1] = weekday word (validated via WEEKDAY_NAMES),
 *                            m[2] = month, m[3] = day
 *
 * The separator after the leading token is `(?::|\s)` — exactly one
 * colon-or-whitespace char — then `\s*` for trailing whitespace. The
 * original `\s*:?\s*` form had overlapping `\s` quantifiers around an
 * optional `:` that Sonar S5852 flagged as ReDoS-prone (memory
 * `feedback_sonar_s5852_false_positives.md`); this form has no `\s*`
 * adjacent to another `\s` quantifier.
 *
 * **WEEKDAY_HEADER_RE is intentionally strict** (Codex review on PR D).
 * Hash Rego descriptions are user-authored prose, so an unanchored weekday
 * regex like `\bFRIDAY 6/26\b` would match free-form text such as
 * `"Friday 4/3 trail, Saturday 4/4 brunch"` and bogusly emit a multi-day
 * series for any event whose blurb happens to mention two weekday-form
 * date references. We require the weekday be preceded by a markdown bold
 * marker `**` AND followed by a delimiter (em-dash, hyphen, en-dash, or
 * colon) after the M/D — the actual section-header shape used by NYC
 * 5-Boro and other Hash Rego campouts. The Day-form is more constrained
 * by its `Day N` literal, so it stays anchored on `\b`.
 *
 * **Two-step weekday matching** (Sonar S5843, Gemini review): the prior
 * inline alternation `(?:MON(?:DAY)?|TUES?(?:DAY)?|WED(?:NESDAY)?|...)`
 * pushed regex complexity to 32 (limit 20) AND silently dropped common
 * three-letter abbreviations like `THU` and `TUE`. Capture a generic 3-9
 * letter word and validate it against `WEEKDAY_NAMES` in JS — drops
 * complexity to ~8 AND covers every common abbreviation
 * (`MON|MONDAY|TUE|TUES|TUESDAY|WED|WEDNESDAY|THU|THUR|THURS|THURSDAY|FRI|FRIDAY|SAT|SATURDAY|SUN|SUNDAY`).
 */
const DAY_NUMBER_HEADER_RE = /\bDay\s+\d{1,2}(?::|\s)\s*(\d{1,2})\/(\d{1,2})\b/gi;
// Two Sonar gotchas the obvious forms trip:
//   - `[A-Za-z]` is redundant under the `/i` flag (S5869 — `a-z` is a
//     visual duplicate of `A-Z` after case folding). Use `[A-Z]` alone.
//   - Em-dash (U+2014) + en-dash (U+2013) in the SAME class trigger
//     S5869 ("visually identical chars"). Drop en-dash — real Hash Rego
//     section headers use em-dash exclusively (verified against NYC
//     5-Boro 2026 and BAWC5 prod fixtures). Char-class form keeps S6035
//     ("alternation should be a char class") happy.
const WEEKDAY_HEADER_RE = /\*\*\s*([A-Z]{3,9})(?::|\s)\s*(\d{1,2})\/(\d{1,2})\s*[-—:]/gi;
const WEEKDAY_NAMES: ReadonlySet<string> = new Set([
  "mon", "monday",
  "tue", "tues", "tuesday",
  "wed", "weds", "wednesday",
  "thu", "thur", "thurs", "thursday",
  "fri", "friday",
  "sat", "saturday",
  "sun", "sunday",
]);

/**
 * Parse per-day section headers from a Hash Rego event description (used
 * for multi-day events like NYC H3 5-Boro Pub Crawl whose description
 * carries `**DAY 1 1/15 —** ...` / `**DAY 2 1/16 —** ...` blocks instead
 * of a `MM/DD HH:MM PM to MM/DD HH:MM PM` range — #1560 PR B).
 *
 * Returns `[]` for < 2 matches (avoids false positives where the
 * description happens to mention a single "Day 1" but doesn't describe
 * a multi-day event). Output is sorted by date ascending.
 *
 * `startDateStr` is the full YYYY-MM-DD anchor from the event index
 * (parsed via `parseHashRegoDate(indexEntry.startDate)`). It serves both
 * as the year source AND the year-rollover detector: when a parsed M/D
 * is chronologically BEFORE the anchor, that day belongs to the
 * following year (NYE campouts: `**DAY 1 12/31 —**`, `**DAY 2 1/1 —**`
 * starts in year N and finishes in N+1 — Gemini review on PR #1630).
 */
/** First `HH:MM show/go/start` pattern in a slice, normalized to a 24h
 *  string. Returns `undefined` when no time is present in the slice. Same
 *  AM-bias adjustment as `extractPerDayStartTimes` (1–9 → +12 hours;
 *  hashrego writes evening times bare like "7:00 show"). */
function extractFirstTimeFromSlice(slice: string): string | undefined {
  const tm = /(\d{1,2}):(\d{2})\s+(show|go|start)/i.exec(slice);
  if (!tm) return undefined;
  const h = Number.parseInt(tm[1], 10);
  const min = Number.parseInt(tm[2], 10);
  const adjustedH = h < 12 && h >= 1 && h <= 9 ? h + 12 : h;
  return `${String(adjustedH).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

/**
 * Extract a per-day section-header title from the slice immediately after
 * a `WEEKDAY/Day N M/D` header match (PR E.1).
 *
 * Real Hash Rego section headers look like
 *   `**FRIDAY 6/26 — GGFM Strawberry Moon Trail**`
 * Our `WEEKDAY_HEADER_RE` consumes up through the trailing dash (`—`), so
 * the slice handed to this helper starts with " GGFM Strawberry Moon Trail**\n..."
 * The title is everything up to the first closing `**` or first newline,
 * whichever comes first. Trailing punctuation (commas, periods, em-dashes)
 * is stripped so we don't render "Strawberry Moon Trail." with a dangling dot.
 *
 * Returns `undefined` when the slice has no title text on the header line —
 * e.g. `**DAY 1 12/30 —**\nblurb...` where the header carries the date only.
 * The caller then falls back to the legacy `"${title} (Day N)"` form.
 */
function extractSectionTitle(slice: string): string | undefined {
  // Strip leading whitespace + a leading delimiter (em-dash, en-dash,
  // hyphen, colon) before extracting the title text.
  //
  // The asymmetry matters: `WEEKDAY_HEADER_RE` ends with `\s*[-—:]` so the
  // delimiter is already CONSUMED by the time we see the slice. But
  // `DAY_NUMBER_HEADER_RE` ends at `\b` after the day digit, so the slice
  // for `**DAY 1 6/26 — Friday Kickoff**` starts at ` — Friday…`. Without
  // an explicit leading-delimiter strip, the title would land as
  // "— Friday Kickoff" (CodeRabbit PR #1697 review).
  const trimmed = slice
    .replace(/^\s+/, "")
    .replace(/^[-—–:]+/, "")
    .replace(/^\s+/, "");
  // Take up to the first closing `**` (markdown bold) or newline, whichever
  // comes first. We deliberately use indexOf for `**` rather than a regex
  // character class — Gemini PR #1697 caught that `/[*\n]/` would match a
  // SINGLE `*`, so a title with markdown emphasis like "GGFM *Strawberry*
  // Moon Trail**" would truncate at the first inline asterisk. indexOf
  // matches the literal closing-bold pair.
  const starsIdx = trimmed.indexOf("**");
  const newlineIdx = trimmed.indexOf("\n");
  // Pick the earliest terminator. Sonar S3358 doesn't like the chained-ternary
  // form; build a candidate list and take the min, treating "missing" as
  // `Infinity` so it loses any actual hit.
  const candidates = [starsIdx, newlineIdx].filter((i) => i !== -1);
  const endIdx = candidates.length === 0 ? -1 : Math.min(...candidates);
  const raw = endIdx === -1 ? trimmed : trimmed.slice(0, endIdx);
  // Drop trailing whitespace + trailing punctuation runs (`.`, `,`, `;`,
  // `:`, `—`, `–`, `-`). Procedural strip rather than a regex with `\s`
  // inside a char class with `+$` — Sonar S5852 false-positives that shape
  // as ReDoS-prone (memory: `feedback_sonar_s5852_procedural_over_regex`).
  // Stops short of full sentence-end stripping so titles like "Pub Crawl!"
  // keep the bang.
  let cleaned = raw.trim();
  while (cleaned.length > 0 && isTrailingPunct(cleaned.at(-1) ?? "")) {
    cleaned = cleaned.slice(0, -1);
  }
  cleaned = cleaned.trim();
  return cleaned.length > 0 ? cleaned : undefined;
}

/** Trailing-punctuation set used by `extractSectionTitle`'s procedural strip. */
const TRAILING_PUNCT_CHARS: ReadonlySet<string> = new Set([
  ".", ",", ";", ":", "—", "–", "-",
]);
function isTrailingPunct(ch: string): boolean {
  return TRAILING_PUNCT_CHARS.has(ch);
}

/** One per-day entry from `parseDayHeaderSections`. */
export interface DayHeaderSection {
  date: string;        // YYYY-MM-DD
  startTime?: string;  // HH:MM (24h) — undefined when the slice has no `show/go/start` time
  /**
   * Per-day kennel override (PR D.5). Set when the section's text matches
   * one of the source's `kennelPatterns` (e.g. NYC 5-Boro's Friday section
   * names "GGFM Strawberry Moon Trail" → `ggfm`). Undefined when no
   * pattern matched; the caller falls back to the host kennel.
   */
  kennelCode?: string;
  /**
   * Per-day section-header title (PR E.1). The text on the header line
   * AFTER the trailing dash/colon delimiter, before the closing `**` or
   * the end-of-line — e.g. `"GGFM Strawberry Moon Trail"` for
   * `**FRIDAY 6/26 — GGFM Strawberry Moon Trail**`. Undefined when the
   * header line carries no title (e.g. `**DAY 1 12/30 —**` followed by
   * a blank line); the caller falls back to `"${title} (Day N)"`.
   */
  sectionTitle?: string;
}

/**
 * Per-day kennel-attribution config (PR D.5). Hash Rego sources can
 * declare patterns that override the day's `kennelTags` when matched
 * against the section text between two day-headers.
 *
 * Stored as `[regexSource, kennelCode]` tuples on `Source.config.kennelPatterns`.
 * Compiled once per scrape via `compileKennelPatterns`. Patterns are
 * unanchored and case-insensitive. First-match wins.
 */
export type KennelPatternConfig = ReadonlyArray<readonly [string, string]>;

/**
 * Compiled form of one source-configured kennel pattern. We hold the
 * compiled regex (unanchored, case-insensitive) and the kennelCode it
 * resolves to. The strip site enforces "anchored at start" via
 * `m.index === 0` rather than building a second anchored regex — that
 * avoids a `new RegExp(<interpolated>, …)` call at the strip site, which
 * Codacy/Opengrep flags as a ReDoS surface even though our sources are
 * operator-curated (PR E #1697 review).
 *
 * The implicit precondition for the `m.index === 0` check is that the
 * caller has already left-trimmed the title — see `extractSectionTitle`,
 * which strips leading whitespace + delimiter runs before this is reached.
 */
interface CompiledKennelPattern {
  readonly re: RegExp;
  readonly code: string;
}

/**
 * Compile per-day kennel patterns. **Fail-soft**: invalid regex sources are
 * dropped with a `console.warn` rather than thrown — a single typo in source
 * config must not strip enriched multi-day behavior from an entire scrape
 * (Codex review on PR D). Returns `undefined` when nothing compiled cleanly.
 *
 * Each pattern is compiled ONCE per scrape (not once per child title) with
 * the `i` flag so casing is consistent. Consumers use the unanchored regex
 * for both body-text scanning AND leading-kennel-name stripping — the
 * latter enforces anchoring via `m.index === 0`.
 */
function compileKennelPatterns(
  patterns: KennelPatternConfig | undefined,
): ReadonlyArray<CompiledKennelPattern> | undefined {
  if (!patterns || patterns.length === 0) return undefined;
  const compiled: CompiledKennelPattern[] = [];
  for (const [src, code] of patterns) {
    try {
      compiled.push({ re: new RegExp(src, "i"), code });
    } catch (err) {
      console.warn(
        `[hashrego] invalid kennelPattern source ${JSON.stringify(src)} for code ${code}: ${err}`,
      );
    }
  }
  return compiled.length > 0 ? compiled : undefined;
}

function matchPerDayKennel(
  slice: string,
  compiled: ReadonlyArray<CompiledKennelPattern> | undefined,
): string | undefined {
  if (!compiled) return undefined;
  for (const { re, code } of compiled) {
    if (re.test(slice)) return code;
  }
  return undefined;
}

/**
 * Minimum length (in chars) the title must retain AFTER prefix stripping.
 * Prevents a too-aggressive strip from leaving a 2-char fragment like "Tr".
 */
const MIN_STRIPPED_TITLE_LENGTH = 4;

/**
 * Strip a kennel-name prefix from a section title when the kennel pill on
 * the card is going to surface that same identity right next to it (PR E.2).
 *
 * E.g. for NYC 5-Boro Friday: title `"GGFM Strawberry Moon Trail"` + kennel
 * pill GGFM → "Strawberry Moon Trail". Walks every compiled pattern that
 * maps to `matchedCode` (multiple sources can point at one code:
 * "GGFM" + "Greater Gotham" → ggfm) and takes the first hit AT THE START
 * of the title.
 *
 * Anchoring is enforced via `m.index === 0` rather than a second anchored
 * regex — Codacy/Opengrep flags `new RegExp(<interpolated>, …)` calls as
 * a ReDoS surface, even for operator-curated sources (PR E #1697 review).
 * The `m.index === 0` check is sound because `extractSectionTitle` left-
 * trims the title before this is reached (whitespace + delimiter runs).
 *
 * Safety guards (per the plan):
 * - Falls through (returns input verbatim) when no compiled patterns match
 *   the matched code (defensive — `matchedCode` should always come from
 *   `compiled`).
 * - Falls through when the prefix-removed remainder would be <
 *   MIN_STRIPPED_TITLE_LENGTH chars — we'd rather show "GGFM ✨" than "✨".
 */
function stripKennelPrefixFromTitle(
  title: string,
  matchedCode: string,
  compiled: ReadonlyArray<CompiledKennelPattern>,
): string {
  for (const { re, code } of compiled) {
    if (code !== matchedCode) continue;
    const m = re.exec(title);
    // Require an at-start match (the title is already left-trimmed by
    // `extractSectionTitle`, so a real prefix-match lands at index 0).
    // Optional-chain form: when `m` is null, `m?.index` is undefined and
    // `undefined !== 0` is true → continue (Sonar S6582).
    if (m?.index !== 0) continue;
    // Drop the matched prefix + any trailing separators (space, dash, colon,
    // em-dash, en-dash, comma) that link the kennel name to the trail name.
    const rest = title.slice(m[0].length).replace(/^[\s—–\-:,]+/, "");
    if (rest.length >= MIN_STRIPPED_TITLE_LENGTH) return rest;
    return title;
  }
  return title;
}

/** Internal normalized header match — `month`/`day` regardless of source regex. */
type HeaderMatch = { index: number; length: number; month: number; day: number };

/**
 * Normalize a regex match from either header regex into `HeaderMatch`. The
 * two source regexes capture month/day in different group positions
 * (DAY_NUMBER: m[1]/m[2]; WEEKDAY: m[2]/m[3] because m[1] is the weekday
 * word). For WEEKDAY matches the captured word is also validated against
 * `WEEKDAY_NAMES` — `\b[A-Za-z]{3,9}\b` is intentionally permissive so the
 * regex stays under Sonar S5843 complexity, but only real weekday words
 * (incl. common abbreviations like THU, TUE, THUR) should be accepted.
 * Returns `null` for matches that fail validation.
 */
function normalizeHeaderMatch(
  m: RegExpMatchArray,
  shape: "day-number" | "weekday",
): HeaderMatch | null {
  const monthGroup = shape === "day-number" ? 1 : 2;
  const dayGroup = shape === "day-number" ? 2 : 3;
  if (shape === "weekday") {
    const word = m[1]?.toLowerCase();
    if (!word || !WEEKDAY_NAMES.has(word)) return null;
  }
  return {
    index: m.index ?? 0,
    length: m[0].length,
    month: Number.parseInt(m[monthGroup], 10),
    day: Number.parseInt(m[dayGroup], 10),
  };
}

export function parseDayHeaderSections(
  description: string,
  startDateStr: string,
  kennelPatterns?: KennelPatternConfig,
): DayHeaderSection[] {
  const baseYear = Number.parseInt(startDateStr.split("-")[0], 10);
  if (!baseYear) return [];

  // Match BOTH header shapes (Day N M/D AND Weekday M/D). Normalize into a
  // shared shape, drop weekday matches whose leading word isn't a real
  // weekday name (the regex captures `[A-Za-z]{3,9}` — JS-side validation
  // keeps complexity under Sonar S5843 while still rejecting random words).
  const dayNumberMatches = [...description.matchAll(DAY_NUMBER_HEADER_RE)]
    .map((m) => normalizeHeaderMatch(m, "day-number"))
    .filter((m): m is HeaderMatch => m !== null);
  const weekdayMatches = [...description.matchAll(WEEKDAY_HEADER_RE)]
    .map((m) => normalizeHeaderMatch(m, "weekday"))
    .filter((m): m is HeaderMatch => m !== null);
  const allMatches = [...dayNumberMatches, ...weekdayMatches]
    .sort((a, b) => a.index - b.index);
  if (allMatches.length < 2) return [];

  const compiled = compileKennelPatterns(kennelPatterns);

  // Walk headers in DOCUMENT order so each section's time + kennel can
  // be extracted from the slice between THIS header and the next one.
  // Sorting by date happens AFTER pairing so a description that lists
  // headers out-of-order (admin error, "Day 3 ... Day 1 ... Day 2")
  // still maps its 7:00 show / 10:00 show / 12:00 show times to the
  // right days (Codex P1 review on PR #1630).
  const entries: DayHeaderSection[] = allMatches.map((m, i) => {
    const candidate = `${baseYear}-${String(m.month).padStart(2, "0")}-${String(m.day).padStart(2, "0")}`;
    // Year-rollover heuristic: only bump to the following year when the
    // parsed M/D is **far enough before** the anchor date that it can't
    // plausibly be earlier in the same event.
    //
    // Original rule (PR B #1630) was "any candidate < anchor → year+1",
    // assuming the anchor is the event's earliest day. That broke when
    // Hash Rego's index startDate is the MAIN event day (Saturday) instead
    // of the kickoff (Friday) — verified against prod for the NYC 5-Boro
    // Pub Crawl 2026 (index startDate 6/27, description says 6/26/6/27/6/28).
    // Friday's `6/26` was wrongly bumped to 2027, scattering the series.
    //
    // 90-day gate: NYE campouts (12/31 → 1/1) have a calendar gap of ~365
    // days when treated as same-year (1/1 minus 12/31 = -364 in same-year),
    // so the bump fires. Within-month admin off-by-one days (6/26 vs 6/27)
    // have a gap of ~1 day — stays in the same year.
    const YEAR_BUMP_GAP_DAYS = 90;
    const candidateMs = Date.parse(`${candidate}T00:00:00Z`);
    const anchorMs = Date.parse(`${startDateStr}T00:00:00Z`);
    const daysBeforeAnchor = (anchorMs - candidateMs) / (1000 * 60 * 60 * 24);
    const date = daysBeforeAnchor > YEAR_BUMP_GAP_DAYS
      ? `${baseYear + 1}-${String(m.month).padStart(2, "0")}-${String(m.day).padStart(2, "0")}`
      : candidate;
    // Slice between this header's end and the next header's start (or
    // end-of-description for the last header). Carries both the per-day
    // start time AND the per-day kennel pattern match.
    const sliceStart = m.index + m.length;
    const sliceEnd = allMatches[i + 1]?.index ?? description.length;
    const slice = description.slice(sliceStart, sliceEnd);
    const startTime = extractFirstTimeFromSlice(slice);
    const kennelCode = matchPerDayKennel(slice, compiled);
    const rawTitle = extractSectionTitle(slice);
    // PR E.2: when the title leads with the kennel name that's already
    // surfacing on the kennel pill (e.g. "GGFM Strawberry Moon Trail" +
    // GGFM pill), strip the prefix so the card reads "Strawberry Moon Trail".
    // No-op when no per-day kennel match OR no compiled patterns.
    const sectionTitle = rawTitle && kennelCode && compiled
      ? stripKennelPrefixFromTitle(rawTitle, kennelCode, compiled)
      : rawTitle;
    return { date, startTime, kennelCode, sectionTitle };
  });

  // Deduplicate by date (a description mentioning the same day twice in
  // two headers collapses; first occurrence wins for time + kennel).
  // After dedup we re-apply the < 2 guard: two "DAY 1 1/15" headers —
  // admin typo, same-day double bill, etc. — collapse to one unique
  // date, which is NOT a multi-day series. Falling back to `[]` lets
  // the caller's existing single-day path take over without spuriously
  // marking the event as multi-day.
  const byDate = new Map<string, DayHeaderSection>();
  for (const e of entries) {
    if (!byDate.has(e.date)) byDate.set(e.date, e);
  }
  const unique = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
  return unique.length >= 2 ? unique : [];
}

/**
 * Range extractor return shape. `perDayKennelCodes` carries the per-day
 * kennel override (PR D.5) and is populated only by Strategy 2 (DAY/WEEKDAY
 * section headers — Strategy 1's contiguous date range has no section text
 * to scan). The caller falls back to host kennel when undefined.
 */
type DateRangeResult = {
  dates: string[];
  startTimes: string[];
  isMultiDay: boolean;
  /** Inclusive last day of a single-registration venue weekend (#1560 PR C). */
  endDate?: string;
  perDayKennelCodes?: ReadonlyArray<string | undefined>;
  /** Per-day section-header titles (PR E.1). Aligned with `dates` by index. */
  perDayTitles?: ReadonlyArray<string | undefined>;
};

/** Try to parse a date range from the description and index entry. */
function parseDateRangeFromDescription(
  description: string,
  indexEntry: IndexEntry,
  kennelPatterns?: KennelPatternConfig,
): DateRangeResult | null {
  const startDateStr = parseHashRegoDate(indexEntry.startDate);
  if (!startDateStr) return null;
  const year = Number.parseInt(startDateStr.split("-")[0], 10);

  // Strategy 1: `MM/DD HH:MM PM to MM/DD HH:MM PM` (existing path).
  const rangeMatch = description.match(
    /(\d{1,2})\/(\d{1,2})\s+\d{1,2}:\d{2}\s*(?:AM|PM)\s+to\s+(\d{1,2})\/(\d{1,2})\s+\d{1,2}:\d{2}\s*(?:AM|PM)/i,
  );
  if (rangeMatch) {
    const startMonth = Number.parseInt(rangeMatch[1], 10);
    const startDay = Number.parseInt(rangeMatch[2], 10);
    const endMonth = Number.parseInt(rangeMatch[3], 10);
    const endDay = Number.parseInt(rangeMatch[4], 10);
    // Year-rollover guard (Gemini review on PR #1630): if the end month
    // is strictly earlier than the start month (12/31 → 1/1), the end
    // date must be in the following year. Strict inequality — same-month
    // events stay in the same year regardless of day ordering.
    const endYear = endMonth < startMonth ? year + 1 : year;
    const startDate = new Date(Date.UTC(year, startMonth - 1, startDay));
    const endDate = new Date(Date.UTC(endYear, endMonth - 1, endDay));
    const dates = generateDatesInRange(startDate, endDate);
    const startTimes = extractPerDayStartTimes(description, dates.length);
    return { dates, startTimes, isMultiDay: dates.length > 1 };
  }

  // Strategy 2 (#1560 PR B): per-day section headers — `DAY 1 M/D`, etc.
  // PR D extends this to also match `**FRIDAY 6/26 —**` and other weekday
  // names (NYC 5-Boro format). When the source declares `kennelPatterns`,
  // each section's text is also scanned for a per-day kennel override.
  const dayHeaderEntries = parseDayHeaderSections(description, startDateStr, kennelPatterns);
  if (dayHeaderEntries.length >= 2) {
    const dates = dayHeaderEntries.map((e) => e.date);
    // Per-section times pair correctly with dates after sort. Where a
    // section has no `show/go/start` time, fall back to the first
    // populated section's time so downstream display still has a value
    // (mirrors the legacy padding behavior in `extractPerDayStartTimes`).
    const firstTime = dayHeaderEntries.find((e) => e.startTime)?.startTime ?? "";
    const startTimes = dayHeaderEntries.map((e) => e.startTime ?? firstTime);
    const perDayKennelCodes = dayHeaderEntries.map((e) => e.kennelCode);
    const perDayTitles = dayHeaderEntries.map((e) => e.sectionTitle);
    return { dates, startTimes, isMultiDay: true, perDayKennelCodes, perDayTitles };
  }

  return null;
}

/**
 * Trigger words that opt-in to the venue-weekend heuristic (#1560 PR C).
 * A description has to mention at least one of these for the
 * weekday-mention scan to fire — keeps the false-positive rate low on
 * single-day trails whose descriptions happen to name a weekday.
 */
const VENUE_WEEKEND_TRIGGER_RE = /\b(?:camp\s?out|weekend|retreat|rendezvous)\b/i;

/**
 * Word-boundary matcher for any 3–9 letter token. We then filter against
 * the explicit weekday allow-list `WEEKDAY_NAMES_SET` below. This split
 * (broad regex + Set lookup) keeps the regex complexity under Sonar's
 * S5843 threshold of 20 — the previous form had 7 alternatives × nested
 * optional suffixes, which counted as ~24 complexity. The Set lookup is
 * O(1) and reads more transparently than a long alternation.
 */
const WEEKDAY_NAME_RE = /\b([A-Za-z]{3,9})\b/g;

/**
 * Allow-list of every form `detectVenueWeekendEndDate` accepts. Lowercase
 * so case-insensitive matching works without a global `i` flag. "Tues"
 * and "Thurs" are common 4–5 letter abbreviations in hashing descriptions
 * (alongside the canonical 3-letter abbrevs and full names).
 */
const WEEKDAY_NAMES_SET: ReadonlySet<string> = new Set([
  "sun", "sunday",
  "mon", "monday",
  "tue", "tues", "tuesday",
  "wed", "wednesday",
  "thu", "thurs", "thursday",
  "fri", "friday",
  "sat", "saturday",
]);

/** Indexed 0=Sun, 6=Sat — matches `Date.getUTCDay()`. */
const WEEKDAY_PREFIXES: ReadonlyArray<string> = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

/**
 * Detect a venue-weekend campout (#1560 PR C — MadisonH3 Token Run-style).
 *
 * Trigger criteria, ALL required:
 *   1. The title OR description contains `camp(out)|weekend|retreat|rendezvous`.
 *   2. The description mentions ≥ 2 DISTINCT weekday names.
 *   3. Counting forward from `startDateStr`'s weekday, the latest mentioned
 *      weekday is at least 1 day in the future (i.e. not all mentions
 *      collapse to the start day).
 *
 * Returns the inclusive last day (YYYY-MM-DD) — the offset from
 * `startDateStr` to the latest mentioned weekday, counted forward through
 * the week. Returns `null` when criteria aren't met.
 *
 * Wrapping convention: each mentioned weekday's offset = `(dow - startDow + 7) % 7`.
 * That keeps the heuristic to a single 7-day window, the longest a
 * reasonable hashing weekend would be.
 */
export function detectVenueWeekendEndDate(
  description: string,
  title: string,
  startDateStr: string,
): string | null {
  if (!VENUE_WEEKEND_TRIGGER_RE.test(title) && !VENUE_WEEKEND_TRIGGER_RE.test(description)) {
    return null;
  }
  const mentioned = new Set<number>();
  for (const m of description.matchAll(WEEKDAY_NAME_RE)) {
    const lc = m[1].toLowerCase();
    if (!WEEKDAY_NAMES_SET.has(lc)) continue;
    const prefix = lc.slice(0, 3);
    const dow = WEEKDAY_PREFIXES.indexOf(prefix);
    if (dow >= 0) mentioned.add(dow);
  }
  if (mentioned.size < 2) return null;

  // Anchor in UTC noon so the offset arithmetic doesn't slip across a
  // DST boundary (matches the project's UTC-noon date convention from
  // CLAUDE.md §F.4).
  const startDate = new Date(`${startDateStr}T12:00:00Z`);
  if (Number.isNaN(startDate.getTime())) return null;
  const startDow = startDate.getUTCDay();

  // Cap the forward-wrap on each weekday's offset. Without this, a
  // description mentioning a "Thursday prelube" on a Friday-start campout
  // (`(Thu - Fri + 7) % 7 = 6`) would inflate endDate to NEXT Thursday
  // instead of the actual Sunday (Codex P1 review). 4 days is the
  // practical ceiling for "weekend campout" lengths — Thu→Mon, Fri→Tue,
  // etc. Beyond 4 we treat the mention as a backward reference
  // (prelube/teaser), not as an end-of-range signal. 7+ day events that
  // really need a longer span should use Strategy 1's explicit
  // `MM/DD ... to MM/DD` format.
  const MAX_FORWARD_OFFSET = 4;
  let maxOffset = 0;
  for (const dow of mentioned) {
    const offset = (dow - startDow + 7) % 7;
    if (offset > MAX_FORWARD_OFFSET) continue;
    if (offset > maxOffset) maxOffset = offset;
  }
  if (maxOffset === 0) return null; // every kept mention collapsed onto the start day

  // Date math via `setUTCDate` + `toISOString` is shorter and idiomatic
  // (Gemini review). Centralizing into a shared util would also work but
  // this is a one-shot end-of-range computation, not a repeated pattern
  // anywhere else in this file.
  const end = new Date(startDate);
  end.setUTCDate(end.getUTCDate() + maxOffset);
  return end.toISOString().split("T")[0];
}

/** Extract dates and detect multi-day events */
function extractDates(
  description: string,
  indexEntry?: IndexEntry,
  title?: string,
  kennelPatterns?: KennelPatternConfig,
): DateRangeResult {
  if (indexEntry) {
    const rangeResult = parseDateRangeFromDescription(description, indexEntry, kennelPatterns);
    if (rangeResult) return rangeResult;

    const date = parseHashRegoDate(indexEntry.startDate);
    const time = parseHashRegoTime(indexEntry.startTime);
    if (date) {
      // Try the venue-weekend campout heuristic (#1560 PR C) before
      // committing to a single-day result. When it fires, the row stays
      // single (no children) but carries an `endDate` so the UI renders
      // a date-range pill — Madison-style "Jan 16 – 18" without the
      // "+ N trails" expansion.
      const endDate = detectVenueWeekendEndDate(description, title ?? "", date);
      return {
        dates: [date],
        startTimes: time ? [time] : [],
        isMultiDay: false,
        ...(endDate ? { endDate } : {}),
      };
    }
  }

  return { dates: [], startTimes: [], isMultiDay: false };
}

/** Extract year from "MM/DD/YY" format */
function parseYearFromIndex(dateStr: string): number | null {
  const match = dateStr.match(/\d{1,2}\/\d{1,2}\/(\d{2,4})/);
  if (!match) return null;
  let year = parseInt(match[1], 10);
  if (year < 100) year += 2000;
  return year;
}

/** Clean description by removing structured fields already extracted */
function cleanDescription(text: string): string | undefined {
  if (!text) return undefined;

  let cleaned = text
    // Remove **Field:** lines for fields we extract separately
    .replace(/\*\*(?:Hare\(s\)|Hares|Cost|Where|When):?\*\*:?\s*[^\n]*/gi, "")
    // Remove plain Field: lines
    .replace(/^(?:Hare\(s\)|Hares|Cost|Where|When):?\s+[^\n]*/gim, "")
    // Remove Google Maps URLs
    .replace(/\/\/maps\.google\.com\S+/g, "")
    // Collapse multiple blank lines
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  // Don't return empty or whitespace-only
  if (!cleaned || cleaned.length < 10) return undefined;

  // Truncate very long descriptions
  if (cleaned.length > 2000) {
    cleaned = cleaned.slice(0, 2000) + "...";
  }

  return cleaned;
}

/**
 * Parse a kennel-specific events page at hashrego.com/kennels/{SLUG}/events.
 * Different table structure than the global index:
 * - No #eventListTable ID — uses table.table-striped
 * - 5 columns: Start Date | Type | Event Name | Cost | Cumming
 * - Date format: "MM/DD HH:MM AM/PM" in a single cell (no year)
 */
export function parseKennelEventsPage(html: string, kennelSlug: string, referenceYear?: number): IndexEntry[] {
  const $ = cheerio.load(html);
  const entries: IndexEntry[] = [];
  const year = referenceYear ?? new Date().getUTCFullYear();
  const currentMonth = new Date().getUTCMonth() + 1;

  // Target the events table specifically — verify header contains "Start Date"
  const table = $("table.table-striped").filter((_i, el) =>
    $(el).find("thead th").first().text().trim().toLowerCase().includes("start date"),
  ).first();

  table.find("tbody tr").each((_i, row) => {
    const cells = $(row).find("td");
    if (cells.length < 5) return;

    // Col 0: Start Date — "MM/DD HH:MM AM/PM" (no year on kennel pages)
    const dateText = $(cells[0]).text().trim();
    const dateMatch = dateText.match(/^(\d{1,2}\/\d{1,2})\s*(.*)/);
    if (!dateMatch) return;

    // Infer year: if scraping in late months (Oct–Dec) and event is in early months (Jan–Mar),
    // assume next year. If scraping in early months (Jan–Mar) and event is in late months (Oct–Dec),
    // assume previous year.
    const eventMonth = parseInt(dateMatch[1].split("/")[0], 10);
    let inferredYear = year;
    if (currentMonth >= 10 && eventMonth <= 3) inferredYear = year + 1;
    else if (currentMonth <= 3 && eventMonth >= 10) inferredYear = year - 1;

    const rawDate = dateMatch[1];
    const startDate = `${rawDate}/${String(inferredYear).slice(-2)}`;
    const startTime = dateMatch[2]?.trim() || "";

    // Col 1: Type
    const type = $(cells[1]).text().trim();

    // Col 2: Event Name with link to /events/{slug} or //hashrego.com/events/{slug}
    const eventLink = $(cells[2]).find("a");
    const href = eventLink.attr("href") || "";
    const slugMatch = href.match(/(?:^\/|\/\/hashrego\.com\/)events\/([^/]+)/);
    if (!slugMatch) return;
    const slug = slugMatch[1];
    const title = eventLink.text().trim();

    // Col 3: Cost
    const cost = $(cells[3]).text().trim();

    entries.push({
      slug,
      kennelSlug: kennelSlug.toUpperCase(),
      title,
      startDate,
      startTime,
      type,
      cost,
    });
  });

  return entries;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
