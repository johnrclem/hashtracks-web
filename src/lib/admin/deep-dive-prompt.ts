import type { DeepDiveCandidate } from "@/app/admin/audit/actions";

const HASHTRACKS_KENNEL_BASE = "https://www.hashtracks.xyz/kennels";

/**
 * Build a self-contained Claude in Chrome prompt for a kennel deep dive.
 * Pure function — safe to call from a server component or copied to clipboard verbatim.
 */
export function buildDeepDivePrompt(kennel: DeepDiveCandidate): string {
  const sourceLines = kennel.sources
    .map(s => `- **${s.name}** (${s.type}): ${s.url}`)
    .join("\n");

  // Date may arrive as a Date instance (server) or an ISO string (after props serialization
  // through a server→client component boundary). Normalize before formatting.
  const lastDived =
    kennel.lastDeepDiveAt === null
      ? "never"
      : (kennel.lastDeepDiveAt instanceof Date
          ? kennel.lastDeepDiveAt
          : new Date(kennel.lastDeepDiveAt)
        )
          .toISOString()
          .split("T")[0];

  return `# HashTracks Kennel Deep Dive — ${kennel.shortName}

You are auditing a single kennel end-to-end. Compare what HashTracks has stored against the live source pages and file findings as GitHub issues.

**Kennel:** ${kennel.shortName} (${kennel.kennelCode})
**Region:** ${kennel.region}
**HashTracks page:** ${HASHTRACKS_KENNEL_BASE}/${kennel.slug}
**Last deep dive:** ${lastDived}
**Active events (last 90d):** ${kennel.eventCount90d}

## Sources to verify

${sourceLines || "_(no enabled sources — flag this as a finding)_"}

## What to check

0. **Verify current state before flagging.** Load ${HASHTRACKS_KENNEL_BASE}/${kennel.slug} AND spot-check 2-3 of the highest run-numbered events. Confirm the fields you think are missing are actually absent from HashTracks — recent audit rounds filed several false positives against events that were already captured on our side. If the data is already there, it isn't a finding.

1. **Kennel page completeness** — visit ${HASHTRACKS_KENNEL_BASE}/${kennel.slug} and review the kennel profile itself. Is anything missing or out of date that the source pages would tell us? Common gaps to flag:
   - **Founded year** — most kennel websites mention "established 19xx" or "since 20xx"
   - **Social links** — Facebook page/group, Instagram, X/Twitter, Discord, mailing list
   - **Schedule details** — recurring day/time, frequency (weekly/monthly/full-moon)
   - **Hash Cash / payment info** — typical run fee, payment methods, cash-only flag
   - **Contact info** — kennel email, hare-line contact
   - **Logo / branding** — does the source page expose a direct logo URL we can embed? Look for a \`<meta property="og:image">\` tag, the favicon in \`<link rel="icon">\`, or any \`<img>\` in the site header. Paste the **full URL** (not a description of what the logo looks like) so we can set \`Kennel.logoUrl\` without a round-trip. Prefer stable, publicly fetchable URLs. **Avoid Facebook CDN links** (\`fbcdn.net\`) and other URLs that contain expiring session tokens — they'll 404 within hours.
   - **Description / "about us"** — short paragraph capturing the kennel's vibe
2. **Source accuracy** — visit each source URL and compare what it shows to the HashTracks kennel page. Are all visible events also on HashTracks? Are dates/times/locations correct?
3. **Missing event fields** — does the source provide event details that HashTracks isn't capturing? **Important:** only flag fields that have a visible home on a HashTracks event card. Look at an existing event page for a similar kennel to see which fields are displayed (date, start time, hares, location, description, run number, cost are all user-visible today). Fields like \`trail type\`, \`shiggy level\`, \`beer meister\`, \`on-after venue\`, \`what to bring\` are real data but have **no visible home on HashTracks event cards today** — tag those as **schema gap** findings, not extraction bugs, so they route to a PRD decision instead of an adapter PR.
4. **Historical events** — does the source list past events that aren't in HashTracks? The right path depends on the source type:
   - **For Google Calendar, iCal, and Meetup sources** (APIs that enumerate a complete window): note the event count and date range, and an admin can trigger a wide-window scrape via the per-source cron endpoint to pull them through the normal merge pipeline. Don't try to run the cron yourself — it's auth-protected.
   - **For HTML scrapers, Google Sheets, and other partial-enumeration sources** (where the adapter paginates, tops out at a row limit, or only shows an upcoming window): a wider scrape window is **unsafe** because the reconcile step cancels events the adapter didn't return. For those, propose a **one-shot DB insert** that adds the historical rows without touching the adapter. Count the events and summarize the available fields (date/title/hares/location/description/cost).
5. **Stale defaults** — does the HashTracks page show default placeholder titles like "${kennel.shortName} Trail" instead of event-specific titles from the source?
6. **Cross-reference** — does this kennel appear on aggregator sites (Harrier Central, Hash Rego, hashruns.org) with extra data we don't have?
7. **Source coverage gap** — are there other source pages for this kennel (e.g. Facebook events, additional calendars, blog) that we don't already track?

## Filing findings

For each issue you find, file a GitHub issue:

**Option 1 (preferred):** Open this URL in a new tab with title and body URL-encoded:
\`\`\`text
https://github.com/johnrclem/hashtracks-web/issues/new?labels=audit,alert&title={URL-ENCODED TITLE}&body={URL-ENCODED BODY}
\`\`\`

**Option 2 (fallback):** Output the finding in this format and the admin will file it:

### [Kennel] — [Issue Category]
* **HashTracks Event URL:** [link]
* **Source URL:** [link]
* **Suspected Adapter:** [source type]
* **Field(s) Affected:** [field name]
* **Current Extracted Value:** "[exact text from the HashTracks page, verbatim]"
* **Expected Value:** "[verbatim text from the source — **not** a synthesized cleanup or inference. If the source says \"2FC Takes Fenton\", that's the expected value; don't 'clean it up' to \"2FC\" unless the source literally shows that string somewhere.]"
* **Fix Hypothesis:** [brief guess on root cause]

## When done

Return to https://hashtracks.xyz/admin/audit and click **Mark deep dive complete** with a count of findings filed and a one-line summary.
`;
}
