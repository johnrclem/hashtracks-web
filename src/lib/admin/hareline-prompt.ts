/**
 * Server-rendered Daily Hareline Audit prompt for Claude in Chrome.
 *
 * Replaces the static `docs/audit-chrome-prompt.md` so the curated sections
 * ("Recently fixed", "Focus areas this week") rotate from live data instead of
 * decaying into stale references. The static doc remains as a README pointer.
 *
 * Pure function: takes already-fetched data and returns the prompt string.
 * Data fetching lives in the server action that calls this.
 */

import { HASHTRACKS_REPO } from "@/lib/github-repo";
import {
  AUDIT_SUPPRESSIONS_URL,
  SCHEMA_GAP_FIELDS_MD,
  renderFilingInstructions,
} from "./audit-prompt-shared";

export interface RecentlyFixedItem {
  /** GitHub issue number that was closed (used for cross-reference) */
  issueNumber: number;
  /** Issue title verbatim. */
  title: string;
  /** ISO date string of closure (yyyy-mm-dd). */
  closedDate: string;
}

export interface FocusAreaItem {
  /** Source name from prisma/seed-data/sources.ts */
  sourceName: string;
  /** Source type (HTML_SCRAPER, GOOGLE_CALENDAR, etc.) */
  sourceType: string;
  /** ISO date string of source creation (yyyy-mm-dd). */
  addedDate: string;
}

export interface HarelinePromptInputs {
  /** Closed `audit`-labeled issues from the last 14 days, newest first. */
  recentlyFixed: RecentlyFixedItem[];
  /** Sources added in the last 14 days, newest first. */
  focusAreas: FocusAreaItem[];
}

function renderRecentlyFixed(items: RecentlyFixedItem[]): string {
  if (items.length === 0) {
    return "_(no audit issues closed in the last 14 days)_";
  }
  return items
    .map(
      (i) =>
        `- [#${i.issueNumber}](https://github.com/${HASHTRACKS_REPO}/issues/${i.issueNumber}) — ${i.title} (closed ${i.closedDate})`,
    )
    .join("\n");
}

function renderFocusAreas(items: FocusAreaItem[]): string {
  if (items.length === 0) {
    return "_(no new sources onboarded in the last 14 days — broaden the audit to sources flagged as recently failing)_";
  }
  return items
    .map((i) => `- **${i.sourceName}** (${i.sourceType}) — added ${i.addedDate}`)
    .join("\n");
}

/**
 * Build the chrome-event hareline audit prompt.
 *
 * Sections that change over time (recently-fixed, focus areas) are injected
 * from the inputs. Active suppressions stay served from `/api/audit/suppressions`
 * (the prompt links to it) so the agent always reads the live list.
 */
export function buildHarelinePrompt(inputs: HarelinePromptInputs): string {
  return `# HashTracks Daily Hareline Audit — Chrome Prompt

> **How to use:** Copy this entire prompt and paste it into Claude in Chrome. The "Copy daily prompt" button on \`/admin/audit\` does this for you.
>
> **For kennel deep dives**, use the **Kennel Deep Dive** section on \`/admin/audit\` instead — that prompt is built per-kennel with the source URLs baked in.

## Instructions

You are an automated QA bot auditing the HashTracks "hareline" (event list) at **https://www.hashtracks.xyz/hareline?scope=all**. The \`scope=all\` query string is important — without it the page is filtered to the signed-in user's preferred kennels and you'd miss everything else. Your goal is to find data extraction errors and file them as GitHub issues.

Scroll through the hareline page and audit event cards for data quality issues.

**IMPORTANT:** For every issue found, you MUST click into the event details and the source URL to verify the issue. Do not flag issues based solely on the event card — always check the source.

## Before filing: dedupe against existing audit issues

Open these two GitHub queries in tabs and check them **before** you file anything. If the same kennel + finding was already filed, **skip it** — re-filing creates noise and triggers no-op autofix runs.

- **Currently open:** https://github.com/${HASHTRACKS_REPO}/issues?q=label%3Aaudit+is%3Aopen
- **Recently closed, newest first:** https://github.com/${HASHTRACKS_REPO}/issues?q=label%3Aaudit+is%3Aclosed+sort%3Aupdated-desc — stop scrolling after results get older than ~30 days

To match against an existing issue, look for either:

1. The **same rule ID** in the title/body (e.g. \`hare-cta-text\`, \`title-raw-kennel-code\` — see \`audit-checks.ts\` for the full set), or
2. The **same kennel + same field** affected (e.g. "Tokyo H3 location" or "EWH3 hares")

If either matches in the open list or in the last ~30 days of closed issues, treat it as covered and move on.

## Inferring the suspect adapter

When you file an issue, the "Suspected Adapter" field is more useful when it names a specific source type rather than a generic guess. The canonical list of every active source (with kennel mappings, source types, and URLs) lives in:

**https://github.com/${HASHTRACKS_REPO}/blob/main/prisma/seed-data/sources.ts**

Open that file in a tab and search by kennel short-name or source URL. Each entry has a \`type\` field — use that exact string in the issue. Quick gloss on what each adapter type means:

- \`HTML_SCRAPER\` — custom Cheerio scraper for a specific kennel website
- \`GOOGLE_CALENDAR\` — Google Calendar API v3 (the kennel maintains a public calendar)
- \`GOOGLE_SHEETS\` — CSV export from a public Google Sheet
- \`ICAL_FEED\` — standard \`.ics\` feed (fetched via \`node-ical\`)
- \`HASHREGO\` — events on hashrego.com (multi-kennel aggregator)
- \`MEETUP\` — Meetup public REST API
- \`HARRIER_CENTRAL\` — hashruns.org public API (multi-kennel aggregator)
- \`STATIC_SCHEDULE\` — RRULE-based generated events, no external source page

## What NOT to Flag

1. Events with generic titles (e.g., just the kennel name) IF they appear to be placeholder events, repeating weekly events, or "STATIC SCHEDULE" events.
2. Missing hares, "TBD", or missing start times for events that are several days/weeks in the future — these often haven't been announced yet.
3. Venue-name-only locations getting city context appended (e.g., "Marina Green, San Francisco, CA") — this is intentional and helpful.

## What the Automated Script Already Catches

The daily cron audit catches a fixed set of structural issues — there's no point re-flagging these unless the cron is missing them somehow. The canonical, always-current list of rules lives in:

**https://github.com/${HASHTRACKS_REPO}/blob/main/src/pipeline/audit-checks.ts**

Search the file for \`rule:\` to see every check the script runs, with a regex showing exactly what triggers each one. **Prioritize issues the script CANNOT catch** — those are listed in the next section.

## What to Focus On (Chrome-Only Value)

These require visual/semantic judgment that the script cannot do:

1. **Source comparison:** Click through to the source URL. Does the extracted data match what the source shows? Pay attention to hares, location, and description.
2. **Semantic title issues:** Title looks wrong even if technically valid (e.g., description text as title, wrong kennel's name).
3. **Map pin accuracy:** Does the map pin match the stated location?
4. **Cross-kennel duplicates:** Same physical event appearing under two different kennels.
5. **Missing data:** Source has hares/location/description but HashTracks doesn't — the adapter is not extracting available fields.
6. **Duplicate values across fields (source data entry, not adapter bug):** If the same text appears in both \`hares\` and \`location\` (or in any two semantically-distinct fields), that's almost always a kennel data-entry mistake — the user pasted the same value into two form slots on the source. **Check the source event/page directly** before hypothesizing adapter fallback logic (if the source is form-backed, verify which raw fields were populated). File the issue, but frame it as "source data entry" rather than "adapter extraction" so it isn't routed to an adapter fix.
7. **Schema gap vs extraction gap:** Only flag fields that have a visible home on a HashTracks event card. Look at an event page to see what's displayed — title, date, start time, hares, location, description, run number are user-visible today. The fields below do **not** have a column on the Event model yet — tag those as **schema gap** findings, not extraction bugs:
${SCHEMA_GAP_FIELDS_MD}

## Active Suppressions

Some kennel+rule combos have been explicitly accepted as correct behavior and should never be flagged. The live list is exposed as markdown at:

**${AUDIT_SUPPRESSIONS_URL}**

Open that URL (it's a small markdown document, not a set of instructions) and treat any kennel+rule combo listed there as out-of-scope for the audit.

## Recently Fixed (auto-rotated from closed audit issues, last 14 days)

${renderRecentlyFixed(inputs.recentlyFixed)}

## Focus Areas (sources onboarded in the last 14 days)

${renderFocusAreas(inputs.focusAreas)}

## Output: Filing Issues

**Finding the kennelCode:** it is the last URL segment on the kennel's HashTracks page — e.g. \`agnews\` for \`https://www.hashtracks.xyz/kennels/agnews\`, \`ah3-hi\` for \`https://www.hashtracks.xyz/kennels/ah3-hi\`. If the URL is ambiguous (e.g. two kennels share the "AH3" shortName), open the kennel page and verify the slug in the address bar before filing — do not guess. Substitute the resolved value for \`{KENNEL_CODE}\` in the URL below.

${renderFilingInstructions({ stream: "chrome-event", kennelLabel: "{KENNEL_CODE}" })}
`;
}
