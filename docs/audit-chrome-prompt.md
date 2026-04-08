# HashTracks Daily Hareline Audit — Chrome Prompt

> **How to use:** Copy this entire file's contents and paste it into Claude in Chrome. The prompt is self-contained — Claude in Chrome refuses to fetch external instructions, so paste it directly. The "Copy daily prompt" button on `/admin/audit` does this for you.
>
> **For kennel deep dives**, use the **Kennel Deep Dive** section on `/admin/audit` instead — that prompt is built per-kennel with the source URLs baked in.

## Instructions

You are an automated QA bot auditing the HashTracks "hareline" (event list) at **https://www.hashtracks.xyz/hareline?scope=all**. The `scope=all` query string is important — without it the page is filtered to the signed-in user's preferred kennels and you'd miss everything else. Your goal is to find data extraction errors and file them as GitHub issues.

Scroll through the hareline page and audit event cards for data quality issues.

**IMPORTANT:** For every issue found, you MUST click into the event details and the source URL to verify the issue. Do not flag issues based solely on the event card — always check the source.

## Before filing: dedupe against existing audit issues

Open these two GitHub queries in tabs and check them **before** you file anything. If the same kennel + finding was already filed, **skip it** — re-filing creates noise and triggers no-op autofix runs.

- **Currently open:** https://github.com/johnrclem/hashtracks-web/issues?q=label%3Aaudit+is%3Aopen
- **Recently closed, newest first:** https://github.com/johnrclem/hashtracks-web/issues?q=label%3Aaudit+is%3Aclosed+sort%3Aupdated-desc — stop scrolling after results get older than ~30 days

To match against an existing issue, look for either:

1. The **same rule ID** in the title/body (e.g. `hare-cta-text`, `title-raw-kennel-code` — see `audit-checks.ts` for the full set), or
2. The **same kennel + same field** affected (e.g. "Tokyo H3 location" or "EWH3 hares")

If either matches in the open list or in the last ~30 days of closed issues, treat it as covered and move on.

## Inferring the suspect adapter

When you file an issue, the "Suspected Adapter" field is more useful when it names a specific source type rather than a generic guess. The canonical list of every active source (with kennel mappings, source types, and URLs) lives in:

**https://github.com/johnrclem/hashtracks-web/blob/main/prisma/seed-data/sources.ts**

Open that file in a tab and search by kennel short-name or source URL. Each entry has a `type` field — use that exact string in the issue. Quick gloss on what each adapter type means:

- `HTML_SCRAPER` — custom Cheerio scraper for a specific kennel website
- `GOOGLE_CALENDAR` — Google Calendar API v3 (the kennel maintains a public calendar)
- `GOOGLE_SHEETS` — CSV export from a public Google Sheet
- `ICAL_FEED` — standard `.ics` feed (fetched via `node-ical`)
- `HASHREGO` — events on hashrego.com (multi-kennel aggregator)
- `MEETUP` — Meetup public REST API
- `HARRIER_CENTRAL` — hashruns.org public API (multi-kennel aggregator)
- `STATIC_SCHEDULE` — RRULE-based generated events, no external source page

## What NOT to Flag

1. Events with generic titles (e.g., just the kennel name) IF they appear to be placeholder events, repeating weekly events, or "STATIC SCHEDULE" events.
2. Missing hares, "TBD", or missing start times for events that are several days/weeks in the future — these often haven't been announced yet.
3. Venue-name-only locations getting city context appended (e.g., "Marina Green, San Francisco, CA") — this is intentional and helpful.

## What the Automated Script Already Catches

The daily cron audit catches a fixed set of structural issues — there's no point re-flagging these unless the cron is missing them somehow. The canonical, always-current list of rules lives in:

**https://github.com/johnrclem/hashtracks-web/blob/main/src/pipeline/audit-checks.ts**

Search the file for `rule:` to see every check the script runs, with a regex showing exactly what triggers each one. **Prioritize issues the script CANNOT catch** — those are listed in the next section.

## What to Focus On (Chrome-Only Value)

These require visual/semantic judgment that the script cannot do:

1. **Source comparison:** Click through to the source URL. Does the extracted data match what the source shows? Pay attention to hares, location, and description.
2. **Semantic title issues:** Title looks wrong even if technically valid (e.g., description text as title, wrong kennel's name).
3. **Map pin accuracy:** Does the map pin match the stated location?
4. **Cross-kennel duplicates:** Same physical event appearing under two different kennels.
5. **Missing data:** Source has hares/location/description but HashTracks doesn't — the adapter is not extracting available fields.
6. **Duplicate values across fields (source data entry, not adapter bug):** If the same text appears in both `hares` and `location` (or in any two semantically-distinct fields), that's almost always a kennel data-entry mistake — the user pasted the same value into two form slots on the source. **Check the source event/page directly** before hypothesizing adapter fallback logic (if the source is form-backed, verify which raw fields were populated). File the issue, but frame it as "source data entry" rather than "adapter extraction" so it isn't routed to an adapter fix.
7. **Schema gap vs extraction gap:** Only flag fields that have a visible home on a HashTracks event card. Look at an event page to see what's displayed — title, date, start time, hares, location, description, run number, cost are all user-visible today. If the source has structured fields that don't map to any user-visible slot (`trail type`, `shiggy level`, `beer meister`, `on-after venue`, `what to bring`, etc.), flag them as **schema gap** findings so they route to a PRD decision instead of an adapter fix.

## Active Suppressions

Some kennel+rule combos have been explicitly accepted as correct behavior and should never be flagged. The live list is exposed as markdown at:

**https://hashtracks.xyz/api/audit/suppressions**

Open that URL (it's a small markdown document, not a set of instructions) and treat any kennel+rule combo listed there as out-of-scope for the audit.

## Recently Fixed (Last 2 Weeks)

- Key West H3, Fort Eustis H3, Spring Brooks H3: stale default titles fixed (PR #423)
- Dayton H4: calendar ID corrected (PR #434)
- Palm Beach H3: default location updated to Wellington, FL (PR #434)
- TBD placeholder hares cleared from 34 events (PR #434)
- location-region-appended rule removed — too many false positives

## Focus Areas This Week

- Check new Harrier Central sources — recently onboarded, verify data accuracy
- Verify international sources (Dublin, Glasgow, Munich, Tokyo) — location handling may differ

## Output: Filing Issues

For each issue found, try to file it as a GitHub issue:

**Option 1 (preferred):** Navigate to this URL with the title and body filled in. Both `title` and `body` MUST be URL-encoded (use `encodeURIComponent`) — raw newlines, `&`, or `#` will break the query string.
```text
https://github.com/johnrclem/hashtracks-web/issues/new?labels=audit,alert&title={URL-ENCODED TITLE}&body={URL-ENCODED BODY}
```

**Option 2 (fallback):** Output the finding in this format for manual filing:

### [Kennel Short Name] — [Issue Category]
* **Impacted HashTracks Event URL:** [exact URL]
* **Source URL:** [original source URL]
* **Suspected Adapter:** [source type]
* **Field(s) Affected:** [field name]
* **Current Extracted Value:** "[exact text from the HashTracks page, verbatim]"
* **Expected Value:** "[verbatim text from the source — **not** a synthesized cleanup or inference. Paste exactly what the source shows.]"
* **CLI Fix Hypothesis:** [brief guess on root cause]
