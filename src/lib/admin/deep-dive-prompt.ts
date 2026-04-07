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

1. **Kennel page completeness** — visit ${HASHTRACKS_KENNEL_BASE}/${kennel.slug} and review the kennel profile itself. Is anything missing or out of date that the source pages would tell us? Common gaps to flag:
   - **Founded year** — most kennel websites mention "established 19xx" or "since 20xx"
   - **Social links** — Facebook page/group, Instagram, X/Twitter, Discord, mailing list
   - **Schedule details** — recurring day/time, frequency (weekly/monthly/full-moon)
   - **Hash Cash / payment info** — typical run fee, payment methods, cash-only flag
   - **Contact info** — kennel email, hare-line contact
   - **Logo / branding** — does the kennel have a logo we could embed?
   - **Description / "about us"** — short paragraph capturing the kennel's vibe
2. **Source accuracy** — visit each source URL and compare what it shows to the HashTracks kennel page. Are all visible events also on HashTracks? Are dates/times/locations correct?
3. **Missing event fields** — does the source provide hares, location, description, or start time that HashTracks isn't capturing?
4. **Historical events available for one-shot import** — does the source list past events that aren't in HashTracks? **Specifically: count them, summarize what fields are available (date/title/hares/location/description/cost), and note whether they could be backfilled via a one-shot DB insert without modifying the existing adapter.** This is the preferred backfill path — historical data is immutable and adapter complexity isn't worth the maintenance tax.
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
* **Current Extracted Value:** "[exact text]"
* **Expected Value:** "[what it should be]"
* **Fix Hypothesis:** [brief guess on root cause]

## When done

Return to https://hashtracks.xyz/admin/audit and click **Mark deep dive complete** with a count of findings filed and a one-line summary.
`;
}
