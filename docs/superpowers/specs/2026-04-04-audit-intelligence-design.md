# Audit Intelligence System — Design Spec

## Problem

The daily data quality audit has no memory. It re-discovers the same patterns daily, produces false positives for accepted behavior, and can't track whether data quality is improving over time. The Chrome visual audit uses a static prompt that doesn't learn from past findings. There's no systematic way to deep-dive on individual kennels to verify data accuracy against sources.

## Solution

Four subsystems sharing a persistent knowledge base:

1. **Audit Memory** — DB tables for audit history and suppressions
2. **Kennel Deep Dive** — daily one-kennel deep investigation via Claude in Chrome
3. **Living Chrome Prompt** — evolving prompt file that gets smarter each iteration
4. **Admin Dashboard** — trend visualization and suppression management

## 1. Data Model

### AuditLog

One row per audit run. Enables trend queries and tracks deep dive rotation.

```prisma
model AuditLog {
  id              String   @id @default(cuid())
  date            DateTime @default(now())
  type            AuditType // HARELINE or KENNEL_DEEP_DIVE
  eventsScanned   Int
  findingsCount   Int
  groupsCount     Int
  issuesFiled     Int
  findings        Json     // Full AuditFinding[] for trend queries
  summary         Json     // { [category]: count }
  kennelCode      String?  // Set for deep dives, null for hareline
  kennel          Kennel?  @relation(fields: [kennelCode], references: [kennelCode])
  createdAt       DateTime @default(now())
}

enum AuditType {
  HARELINE
  KENNEL_DEEP_DIVE
}
```

### AuditSuppression

Kennel+rule combos to skip. Managed via admin UI.

```prisma
model AuditSuppression {
  id          String   @id @default(cuid())
  kennelCode  String?  // null = global suppression (all kennels)
  kennel      Kennel?  @relation(fields: [kennelCode], references: [kennelCode])
  rule        String   // e.g., "location-region-appended"
  reason      String   // Why it's suppressed
  createdAt   DateTime @default(now())
  createdBy   String?  // User who created the suppression

  @@unique([kennelCode, rule])
}
```

### Changes to Audit Script

After running checks:
1. Query `AuditSuppression` table — filter out suppressed kennel+rule combos before filing issues
2. Write `AuditLog` row with full findings, summary, and metadata
3. Deep dive: also record `kennelCode` and `type: KENNEL_DEEP_DIVE`

## 2. Kennel Deep Dive

### What It Does

A daily scheduled Claude in Chrome task that picks one kennel and performs a thorough investigation:

- **Source verification**: Visit the actual source website, compare displayed events against what HashTracks has stored
- **Data completeness**: Check if the source provides fields (hares, location, description, start time) that we're not capturing
- **Historical data**: Identify past events on the source that could be imported
- **Adapter accuracy**: Verify the adapter is extracting all available fields correctly
- **Cross-reference**: Check if events from this kennel appear on other aggregator sites

### Rotation Strategy

- Query `AuditLog` for `type = KENNEL_DEEP_DIVE`, order by `date DESC`
- Pick the kennel with the oldest (or no) deep dive date
- New kennels (never audited) get priority
- ~328 kennels ÷ 1/day = full cycle in ~11 months
- Track coverage: `audited / total` shown on dashboard

### Execution

Scheduled as a Claude in Chrome daily task. The prompt reads from the living Chrome prompt file and includes the specific kennel to audit.

### Output

- GitHub issue per finding (same format as hareline audit)
- AuditLog row with `type: KENNEL_DEEP_DIVE`, `kennelCode` set
- If historical data import is possible, finding includes details about what's available and how to import

## 3. Living Chrome Prompt

### File: `docs/audit-chrome-prompt.md`

A markdown file in the repo that serves as the system prompt for both Chrome audit modes. Claude in Chrome reads it from the raw GitHub URL before each run.

### Structure

```markdown
# HashTracks Data Quality Audit — Chrome Prompt

## Instructions
[Base audit instructions — what to check, how to format findings]

## Mode: Hareline Scan
[Hareline-specific instructions — scroll through events, check cards]
[Overlap with automated script for redundancy — belt and suspenders]

## Mode: Kennel Deep Dive
[Deep dive instructions — visit source, compare all fields, check history]
[Current kennel to audit: {read from rotation or specified manually}]

## What the Automated Script Already Catches
- Single-character hares (hare-single-char)
- CTA text as hares (hare-cta-text) — except future events >14 days
- Raw kennelCode as title prefix (title-raw-kennel-code)
- Duplicated address segments (location-duplicate-segments)
- Improbable start times 23:00-04:00 (event-improbable-time)
[Updated as new rules are added to audit-checks.ts]

## Active Suppressions
[List of kennel+rule combos that are accepted behavior]
- Dublin H3 / location-region-appended: city context is helpful
- Glasgow H3 / location-region-appended: same as Dublin
[Updated when suppressions are added/removed in admin]

## Recently Fixed (Last 2 Weeks)
[Rules/patterns that were fixed — don't flag these anymore]
- Key West H3 titles: fixed in PR #423 (rewriteStaleDefaultTitle)
- Fort Eustis H3 titles: same fix
[Updated after each audit fix PR merges]

## Focus Areas This Week
[Manual notes about what to pay attention to]
- Check new Harrier Central sources — recently onboarded
- Verify SDH3 historical events imported correctly
[Updated by the user as priorities shift]

## Output: Filing Issues (No Copy-Paste)

Chrome files findings directly as GitHub issues instead of outputting text. Three-tier approach:

**Tier 1 (preferred):** POST to `/api/audit/submit` endpoint — server-side issue creation using existing `GITHUB_TOKEN`. Chrome sends findings JSON, endpoint creates issues with proper labels.

**Tier 2 (fallback):** Open `github.com/johnrclem/hashtracks-web/issues/new?title=...&body=...&labels=audit,alert` in a new tab with pre-filled title/body. User clicks Submit.

**Tier 3 (last resort):** Output findings as formatted text in the chat (current behavior).

The Chrome prompt instructs Claude to try Tier 1, fall back to Tier 2 if the API call fails, and Tier 3 only if browser navigation fails.
```

### Update Workflow

- After each audit fix PR merges, update "Recently Fixed"
- After each suppression is added in admin, update "Active Suppressions"
- Periodically review "Focus Areas" and adjust
- "What the Script Catches" section auto-maintained by checking audit-checks.ts

## 4. Admin Audit Dashboard

### Page: `/admin/audit`

#### Findings Over Time (Line Chart)
- X-axis: date (last 30 days)
- Y-axis: finding count
- Lines by category (hares, title, location, event, description)
- Shows the trend: are we improving?

#### Top Offending Kennels (Table)
- Kennels with the most findings in the last 30 days
- Columns: kennel, rule, count, last occurrence, status (suppressed?)
- Click through to see the specific findings

#### Suppression Management
- View all active suppressions with reason and date
- Add new suppression: select kennel (or global) + rule + reason
- Remove suppression (re-enables flagging)
- Shows impact: "This suppression skips ~6 findings per day"

#### Deep Dive Rotation Status
- Last audited kennel and date
- Next kennel in queue
- Coverage: N/328 kennels audited (X%)
- Timeline: "At current rate, full cycle completes by {date}"
- List of recently audited kennels with finding counts

#### Recent Audit Runs (Table)
- Last 14 days of audit runs
- Columns: date, type, events scanned, findings, issues filed
- Click through to see full findings

### Data Sources
- `AuditLog` table for trend data and run history
- `AuditSuppression` table for suppression management
- `Kennel` table for rotation (count, lastDeepDiveAt)

### Tech Stack
- Next.js server actions for CRUD (same pattern as existing admin pages)
- Recharts for line chart (already used in analytics dashboard)
- shadcn/ui table components (already in use)

## Implementation Phases

### Phase 1: Data Model + Script Integration + Living Prompt
- Add `AuditLog` and `AuditSuppression` to Prisma schema
- Update audit script to persist results and check suppressions
- Create `docs/audit-chrome-prompt.md` with initial content
- Remove `location-region-appended` rule (too many false positives)
- **Deliverable**: Audit has memory, suppressions work, Chrome prompt lives in repo

### Phase 2: Admin Dashboard + Suppression UI
- Create `/admin/audit` page
- Trend chart, top offenders, suppression CRUD, recent runs table
- **Deliverable**: Visual trend tracking, one-click suppression management

### Phase 3: Kennel Deep Dive
- Build rotation logic (query AuditLog for least-recently-audited kennel)
- Add deep dive section to Chrome prompt
- Schedule daily Claude in Chrome deep dive task
- Add deep dive rotation status to admin dashboard
- **Deliverable**: Systematic kennel-by-kennel verification

## Success Criteria

- Daily audit findings trend downward over 30 days
- False positives eliminated via suppressions (not code changes)
- Chrome prompt evolves weekly based on learnings
- Deep dive covers all kennels within 12 months
- Admin dashboard shows data quality improving over time
