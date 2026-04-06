# Automated Data Quality Audit — Design Spec

## Problem

Daily manual audit of hareline data quality works well but requires a human in the loop: Claude in Chrome browses hashtracks.xyz, generates findings, the user copy-pastes into Claude Code CLI, which plans and implements fixes. This catches real issues (bad hare extractions, duplicated locations, wrong titles, historical event leaks) but the handoff is manual and the Chrome-based audit can't run unattended.

## Solution

A daily **RemoteTrigger** runs a Claude Code agent that:
1. Queries the database for known bad data patterns
2. Re-scrapes a rotating sample of sources and diffs against stored data
3. Files a batched GitHub issue with findings
4. The existing self-healing loop (claude-issue-triage → claude-autofix) picks up the issue and creates a PR

## Architecture

```
RemoteTrigger (daily, ~7am)
  → Claude Code agent
    → runs: npx tsx scripts/audit-data-quality.ts
    → output: JSON array of findings
  → if findings:
    → gh issue create with structured test cases
    → labels: [audit, claude-fix]
  → existing workflow:
    → claude-issue-triage.yml → confidence score
    → claude-autofix.yml → PR
    → user reviews PR
```

## Audit Script: `scripts/audit-data-quality.ts`

### Layer 1: DB Pattern Checks (fast, ~10 seconds)

Run SQL/Prisma queries against upcoming events to catch known bad patterns.

#### Hare Checks
- Single-character `haresText` values
- `haresText` matching CTA patterns: "Sign Up!", "Volunteer", "Needed", "TBD"
- `haresText` containing URLs (`https://`)
- `haresText` > 200 characters (description leak)
- `haresText` containing phone number patterns
- `haresText` containing boilerplate markers (WHAT TIME, WHERE, HASH CASH, etc.)

#### Title Checks
- `title` where the prefix matches `kennel.kennelCode` instead of `kennel.shortName` (raw adapter tag used)
- `title` matching CTA patterns ("Wanna Hare?", "Check out our", "available dates")
- `title` matching schedule descriptions ("runs on the first", "meets every")
- `title` containing HTML entities (`&amp;`, `&lt;`, etc.)
- `title` that is just a time string ("12:30pm", "18:00")

#### Location Checks
- `locationName` containing duplicate comma-separated segments (after abbreviation normalization)
- `locationName` ending with a US state abbreviation followed by a different city+state (region appending)
- `locationName` containing URLs
- `locationName` = "Online event" for kennels with a physical `scheduleDayOfWeek`
- Events with `locationName` null but source `RawEvent.rawData` has a location field

#### Event Checks
- Events with `date` more than `source.scrapeDays` in the future
- Events with no title, no location, no hares, and no run number
- More than 3 events per kennel on the same date (likely duplicates)
- Events with `startTime` between 23:00–04:00 (improbable for a hash run)

#### Description Checks
- Events with null `description` where the linked `RawEvent.rawData.description` is non-empty (description was dropped)
- Events where the source RawEvent has hash cash / trail type info but it didn't make it to the canonical event

### Layer 2: Source Re-Scrape Comparison (slower, ~2-3 minutes)

Re-fetch and re-parse a rotating sample of 10-20 sources per day, comparing fresh extraction against stored canonical events.

#### Rotation Strategy
- Order sources by `lastScrapeAt` ascending (least recently checked first)
- Each day, pick the next 15 sources in rotation
- Track last-audited position in a lightweight state file or DB field
- All 150 sources covered within ~10 days

#### Comparison Logic
For each sampled source:
1. Call `scrapeSource()` in dry-run mode (fetch + parse, don't merge)
2. For each extracted RawEventData, find the matching canonical Event by `kennelId + date`
3. Compare fields: title, hares, location, startTime, runNumber
4. Flag significant discrepancies:
   - Canonical event has a field value that doesn't match fresh extraction AND fresh extraction looks better (non-empty, longer, more specific)
   - Fresh extraction found events that don't exist in DB (missing events)
   - DB has events that fresh extraction didn't find (possibly stale/removed from source)

#### What "looks better" means
- Non-empty > empty
- Longer > shorter (for hares, location)
- Contains proper nouns > contains slugs/codes (for titles)
- Has structured data > has raw/garbled data

### Output Format

The script outputs a JSON array of findings:

```typescript
interface AuditFinding {
  kennelShortName: string;
  eventId: string;
  eventUrl: string;         // hashtracks URL
  sourceUrl?: string;       // original source URL
  adapterType: string;      // HTML_SCRAPER, GOOGLE_CALENDAR, etc.
  category: "hares" | "title" | "location" | "event" | "description";
  field: string;            // specific field name
  currentValue: string;
  expectedValue?: string;   // from re-scrape, if available
  rule: string;             // which check flagged it
  severity: "error" | "warning";
}
```

### GitHub Issue Format

The agent formats findings into the same test-case-report structure used today:

```markdown
# [Audit] 7 data quality issues — 2026-03-29

Automated daily audit found 7 issues across 5 kennels.

### DeMon H3 — Hare Extraction Failure
* **Impacted HashTracks Event URL:** https://www.hashtracks.xyz/hareline/cmn3dgfv3...
* **Source URL:** Google Calendar (demonhashhouseharriers@gmail.com)
* **Suspected Adapter:** GOOGLE_CALENDAR
* **Field(s) Affected:** Hares
* **Current Extracted Value:** "drop another for the prince of this"
* **Expected Value:** "A Girl Named Steve" (from re-scrape)
* **Audit Rule:** `hare-description-leak` — hare text appears to be song lyrics/description

### LBH3 — Location Duplication
...
```

Labels: `audit`, `claude-fix`

## RemoteTrigger Configuration

```typescript
RemoteTrigger.create({
  name: "daily-data-quality-audit",
  schedule: "7 7 * * *",    // 7:07am daily (off-minute to avoid fleet congestion)
  prompt: `Run the automated data quality audit:
    1. Execute: npx tsx scripts/audit-data-quality.ts
    2. If findings exist, create a GitHub issue using gh CLI with the formatted output
    3. If no findings, log "No issues found" and exit
    Use the existing audit script — do not modify it.`,
})
```

## What This Doesn't Replace

The Chrome visual audit remains valuable for:
- **Novel issue types** not yet codified as rules (each manual finding becomes a new rule)
- **Visual layout problems** (event cards rendering wrong, map pins in wrong location)
- **Cross-source comparison** requiring human judgment (co-hosted events, kennel renames)
- **UX-level quality** (is this title confusing even if technically correct?)

Over time, the ratio shifts: more issues caught automatically, fewer need manual discovery.

## Files

| File | Purpose |
|------|---------|
| `scripts/audit-data-quality.ts` | Main audit script — DB queries + source re-scrape comparison |
| `src/pipeline/audit.ts` | Shared audit check functions (reusable by script + potential post-scrape hook) |
| `.claude/triggers/daily-audit.json` | RemoteTrigger configuration |

## Implementation Phases

### Phase 1: DB Pattern Checks + GitHub Issue Filing
- Implement the ~15 DB query checks
- Format output as GitHub issue
- Set up RemoteTrigger
- Test with `--dry-run` flag

### Phase 2: Source Re-Scrape Comparison
- Add dry-run scrape mode to pipeline
- Implement rotation + comparison logic
- Integrate into audit script

### Phase 3: Feedback Loop
- Each manually-discovered issue type becomes a new audit rule
- Track audit hit rate (issues found vs. false positives)
- Tune severity thresholds based on autofix success rate

## Verification
1. Run audit script locally with `--dry-run` to verify checks
2. Run against production DB to see real findings
3. Verify GitHub issue format matches what claude-autofix expects
4. Test end-to-end: audit → issue → triage → autofix → PR
