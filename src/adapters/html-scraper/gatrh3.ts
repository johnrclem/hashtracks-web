import type { Source } from "@/generated/prisma/client";
import type {
  SourceAdapter,
  RawEventData,
  ScrapeResult,
  ErrorDetails,
} from "../types";
import { hasAnyErrors } from "../types";
import {
  chronoParseDate,
  stripHtmlTags,
  parse12HourTime,
  googleMapsSearchUrl,
  isPlaceholder,
  decodeEntities,
  extractHashRunNumber,
} from "../utils";
import { safeFetch } from "../safe-fetch";

/**
 * GATR H3 (Gainesville Area Trailmasters H3) WordPress.com adapter.
 *
 * Fetches per-trail announcement posts from gatrh3.wordpress.com via the
 * WordPress.com public REST API (`public-api.wordpress.com/wp/v2/sites/...`).
 * Onboarded above the STATIC_SCHEDULE fallback (trust 3) as the higher-trust
 * source (#static-only-audit): each post carries the real run number, date,
 * start time, location, cost, and trail length — so the placeholder static
 * events get replaced with real data on any date the blog covers.
 *
 * Post shape (verified live 2026-07):
 *   Title: "Gainesville Hash Trail (GATRH3 #343 AD) <theme>"
 *   Body:  When: <date>, at <time> ET
 *          Location: / Meet at: <place>[; pin: <maps url>]
 *          Length: <text>  Hash Cash: $N  Theme: <prose>
 * Field labels and layout drift between posts (fields on one <br>-joined line,
 * bare "$5 hash cash", "pin:" anchor), so parsing is label-based and tolerant.
 */

const WPCOM_API =
  "https://public-api.wordpress.com/wp/v2/sites/gatrh3.wordpress.com";

/** WordPress.com REST API post shape (subset of fields we request) */
interface WPComPost {
  id: number;
  date: string; // ISO 8601 publish date
  link: string;
  title: { rendered: string };
  content: { rendered: string };
}

/**
 * Strip the "Gainesville Hash Trail (GATRH3 #NNN AD)" prefix off a post title,
 * leaving the theme. The run-number group can itself be followed by a nested
 * parenthetical theme ("Friday the 13th (on Saturday)"), so we anchor the strip
 * to the GATRH3 group specifically rather than the first ")".
 */
export function parseGatrTitle(title: string): {
  runNumber?: number;
  theme?: string;
} {
  const runNumber = extractHashRunNumber(title);
  const theme = title
    .replace(/^.*?\(\s*GATRH3[^)]*\)\s*/i, "")
    .trim();
  return { runNumber, theme: theme || undefined };
}

/** Pull the first mile figure(s) out of a free-form length string. */
function parseTrailLength(text: string): {
  min: number | null;
  max: number | null;
} {
  const nums = text.match(/\d+(?:\.\d+)?/g);
  if (!nums || nums.length === 0) return { min: null, max: null };
  const isRange = /\d\s*(?:-|–|to)\s*\d/.test(text) && nums.length >= 2;
  if (isRange) {
    return { min: Number(nums[0]), max: Number(nums[1]) };
  }
  const v = Number(nums[0]);
  return { min: v, max: v };
}

/**
 * Extract the first http(s) URL following a "pin:" marker, minus tracking query.
 * Tolerates a `&nbsp;`/whitespace gap before the anchor ("pin:&nbsp;<a href…>").
 */
const PIN_URL_RE =
  /pin:(?:\s|&nbsp;|&#160;)*(?:<a[^>]+href=")?(https?:\/\/[^\s"<]+)/i;

function extractPinUrl(html: string): string | undefined {
  const m = PIN_URL_RE.exec(html);
  if (!m) return undefined;
  return m[1].split("?")[0];
}

interface GatrBodyFields {
  hasWhenField: boolean;
  date?: string;
  startTime?: string;
  location?: string;
  locationUrl?: string;
  cost?: string;
  trailLengthText?: string;
  trailLengthMin: number | null;
  trailLengthMax: number | null;
  themeProse?: string;
}

/**
 * Parse the labeled body of a GATR post. Field values run until the next known
 * label or a line break (mirrors the SWH3 approach).
 */
export function parseGatrBody(html: string, publishDate: string): GatrBodyFields {
  const pinUrl = extractPinUrl(html);
  const text = decodeEntities(stripHtmlTags(html, "\n"));

  // Lookahead terminating a field value: newline, end, or the next known label.
  const stop = String.raw`(?=\n|(?:When|Location|Meet at|Where|Length|Shiggy|Hash Cash|Theme|What to bring|Things to bring|Bring|On[- ]After|pin)\s*:|$)`;

  const grab = (labels: string): string | undefined => {
    const re = new RegExp(String.raw`(?:${labels})\s*:\s*(.+?)${stop}`, "i");
    const m = re.exec(text);
    const v = m?.[1]?.trim();
    return v && !isPlaceholder(v) ? v : undefined;
  };

  const whenText = grab("When");
  const hasWhenField = /\bWhen\s*:/i.test(text);
  // WordPress.com `date` is site-local without an offset ("2026-06-04T14:00:00").
  // Anchor it to UTC before constructing Date so the year-inference reference
  // can't skew across a midnight boundary (repo rule: no bare new Date()).
  const utcPublish =
    publishDate.endsWith("Z") || /[+-]\d{2}:?\d{2}$/.test(publishDate)
      ? publishDate
      : `${publishDate}Z`;
  const refDate = new Date(utcPublish);
  const date = whenText
    ? chronoParseDate(whenText, "en-US", refDate) ?? undefined
    : undefined;
  const startTime = whenText ? parse12HourTime(whenText) : undefined;

  // Location may carry a trailing "; pin: <url>" — keep only the place name.
  let location = grab("Location|Meet at|Where");
  if (location) {
    location = location.split(/;\s*pin:/i)[0].replace(/;\s*$/, "").trim();
    if (/emailed after RSVP|after RSVP|details will be/i.test(location)) {
      location = undefined;
    }
  }
  const locationUrl =
    pinUrl ?? (location ? googleMapsSearchUrl(location) : undefined);

  // Hash cash: labeled "Hash Cash: $10" or a bare "$5 hash cash".
  let cost = grab("Hash Cash");
  if (!cost) {
    const bare = /\$\s?\d+(?:\.\d+)?/.exec(text);
    if (bare && /hash cash/i.test(text)) cost = bare[0].replace(/\s/g, "");
  }

  const trailLengthText = grab("Length");
  const { min: trailLengthMin, max: trailLengthMax } = trailLengthText
    ? parseTrailLength(trailLengthText)
    : { min: null, max: null };

  const themeProse = grab("Theme");

  return {
    hasWhenField,
    date,
    startTime,
    location,
    locationUrl,
    cost,
    trailLengthText,
    trailLengthMin: trailLengthText ? trailLengthMin : null,
    trailLengthMax: trailLengthText ? trailLengthMax : null,
    themeProse,
  };
}

/** Process a single WordPress.com post into a RawEventData (null if no date). */
export function processPost(
  post: WPComPost,
  index: number,
  errors: string[],
  errorDetails: ErrorDetails,
): RawEventData | null {
  // Don't trust the API payload's shape — a malformed post (non-object, or
  // missing title/content/date) is skipped with a logged error rather than
  // throwing and failing the whole scrape.
  if (
    !post ||
    typeof post !== "object" ||
    typeof post.title?.rendered !== "string" ||
    typeof post.content?.rendered !== "string" ||
    typeof post.date !== "string"
  ) {
    const msg = `Malformed post at index ${index}: missing title, content, or date`;
    errors.push(msg);
    const parse = (errorDetails.parse ??= []);
    parse.push({ row: index, section: "post", field: "shape", error: msg });
    return null;
  }

  const titleText = decodeEntities(post.title.rendered);

  // Cancelled-trail posts ("(cancelled)" in the title) aren't real runs — skip
  // them silently so their "TRAIL CANCELLED" placeholder text can't leak into an
  // event. The static fallback still covers the date if the kennel met anyway.
  if (/cancel{1,2}ed/i.test(titleText)) return null;

  const { runNumber, theme } = parseGatrTitle(titleText);
  const body = parseGatrBody(post.content.rendered, post.date);

  if (!body.date) {
    // Non-trail posts (the pinned "UPCOMING…" index, general announcements) have
    // no "When:" field — skip silently. Only a post that HAS a "When:" we failed
    // to parse is a genuine parse error worth surfacing to the health pipeline.
    if (body.hasWhenField) {
      const msg = `Unparseable trail date in post: "${titleText}"`;
      errors.push(msg);
      const parse = (errorDetails.parse ??= []);
      parse.push({
        row: index,
        section: "post",
        field: "date",
        error: msg,
        rawText: `Title: ${titleText}`.slice(0, 2000),
      });
    }
    return null;
  }

  return {
    date: body.date,
    kennelTags: ["gatr-h3"],
    runNumber,
    title: theme,
    location: body.location,
    locationUrl: body.locationUrl,
    startTime: body.startTime,
    cost: body.cost,
    trailLengthText: body.trailLengthText ?? null,
    trailLengthMinMiles: body.trailLengthMin,
    trailLengthMaxMiles: body.trailLengthMax,
    description: body.themeProse,
    sourceUrl: post.link,
  };
}

/**
 * GATR H3 WordPress.com Adapter.
 *
 * The WordPress.com API returns the newest 20 posts (a natural ~2-year bound for
 * a monthly kennel), so we emit every parseable post — past trails are a valid
 * historical record and upcoming ones enrich the static placeholder. Posts that
 * don't carry a parseable "When:" date (rare free-prose holiday posts) are
 * skipped with a logged parse error rather than dropped silently.
 */
export class GATRH3Adapter implements SourceAdapter {
  type = "HTML_SCRAPER" as const;

  async fetch(
    _source: Source,
    _options?: { days?: number },
  ): Promise<ScrapeResult> {
    const events: RawEventData[] = [];
    const errors: string[] = [];
    const errorDetails: ErrorDetails = {};
    const fetchStart = Date.now();

    const url = `${WPCOM_API}/posts?per_page=20&orderby=date&order=desc&_fields=id,date,link,title,content`;

    let resp: Response;
    try {
      resp = await safeFetch(url, {
        headers: { "User-Agent": "HashTracks-Scraper", Accept: "application/json" },
      });
    } catch (err) {
      const msg = `Fetch failed: ${err}`;
      errors.push(msg);
      const fetchErrs = (errorDetails.fetch ??= []);
      fetchErrs.push({ url, message: msg });
      return { events, errors, errorDetails, diagnosticContext: { fetchMethod: "wpcom-api" } };
    }

    if (!resp.ok) {
      const msg = `WordPress.com API returned ${resp.status}`;
      errors.push(msg);
      const fetchErrs = (errorDetails.fetch ??= []);
      fetchErrs.push({ url, status: resp.status, message: msg });
      return { events, errors, errorDetails, diagnosticContext: { fetchMethod: "wpcom-api" } };
    }

    let posts: WPComPost[];
    try {
      posts = (await resp.json()) as WPComPost[];
    } catch (err) {
      errors.push(`Failed to parse API response: ${err}`);
      return { events, errors, errorDetails, diagnosticContext: { fetchMethod: "wpcom-api" } };
    }

    if (!Array.isArray(posts)) {
      errors.push("WordPress.com API response was not an array");
      return { events, errors, errorDetails, diagnosticContext: { fetchMethod: "wpcom-api" } };
    }

    for (let i = 0; i < posts.length; i++) {
      const event = processPost(posts[i], i, errors, errorDetails);
      if (event) events.push(event);
    }

    return {
      events,
      errors,
      errorDetails: hasAnyErrors(errorDetails) ? errorDetails : undefined,
      diagnosticContext: {
        fetchMethod: "wpcom-api",
        postsFound: posts.length,
        eventsParsed: events.length,
        fetchDurationMs: Date.now() - fetchStart,
      },
    };
  }
}
