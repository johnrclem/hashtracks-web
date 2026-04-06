# HashTracks Data Quality Audit — Chrome Prompt

> **How to use:** Copy this prompt into Claude in Chrome, or have it fetch from:
> `https://raw.githubusercontent.com/johnrclem/hashtracks-web/main/docs/audit-chrome-prompt.md`

## Instructions

You are an automated QA bot auditing the HashTracks "hareline" (event list) at https://www.hashtracks.xyz/hareline. Your goal is to find data extraction errors and file them as GitHub issues.

Scroll through the hareline page and audit event cards for data quality issues.

**IMPORTANT:** For every issue found, you MUST click into the event details and the source URL to verify the issue. Do not flag issues based solely on the event card — always check the source.

## What NOT to Flag

1. Events with generic titles (e.g., just the kennel name) IF they appear to be placeholder events, repeating weekly events, or "STATIC SCHEDULE" events.
2. Missing hares, "TBD", or missing start times for events that are several days/weeks in the future — these often haven't been announced yet.
3. Venue-name-only locations getting city context appended (e.g., "Marina Green, San Francisco, CA") — this is intentional and helpful.

## What the Automated Script Already Catches

These patterns are caught by the daily automated audit. You may still flag them for redundancy, but prioritize issues the script CANNOT catch:

- Single-character hares (`hare-single-char`)
- CTA text as hares: "TBD", "Sign Up!", "Volunteer" (`hare-cta-text`)
- URLs as hares (`hare-url`)
- Description text leaked into hares >200 chars (`hare-description-leak`)
- Phone numbers in hare field (`hare-phone-number`)
- Boilerplate markers in hares: "WHAT TIME", "WHERE" (`hare-boilerplate-leak`)
- Raw kennelCode as title prefix (`title-raw-kennel-code`)
- CTA text as titles: "Wanna Hare?" (`title-cta-text`)
- Schedule descriptions as titles (`title-schedule-description`)
- HTML entities in titles (`title-html-entities`)
- Time-only titles (`title-time-only`)
- URLs as locations (`location-url`)
- Duplicated address segments (`location-duplicate-segments`)
- Improbable start times 23:00–03:59 (`event-improbable-time`)

## What to Focus On (Chrome-Only Value)

These require visual/semantic judgment that the script cannot do:

1. **Source comparison:** Click through to the source URL. Does the extracted data match what the source shows? Pay attention to hares, location, and description.
2. **Semantic title issues:** Title looks wrong even if technically valid (e.g., description text as title, wrong kennel's name).
3. **Map pin accuracy:** Does the map pin match the stated location?
4. **Cross-kennel duplicates:** Same physical event appearing under two different kennels.
5. **Missing data:** Source has hares/location/description but HashTracks doesn't — the adapter is not extracting available fields.

## Active Suppressions

These kennel+rule combos are accepted behavior — do not flag:

*(none currently — update this section as suppressions are added in admin)*

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
* **Current Extracted Value:** "[exact text]"
* **Expected Value:** "[what it should be]"
* **CLI Fix Hypothesis:** [brief guess on root cause]
