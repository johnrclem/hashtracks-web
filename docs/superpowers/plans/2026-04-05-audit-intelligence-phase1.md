# Audit Intelligence Phase 1 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the daily audit memory (persisted history + suppressions) and create the living Chrome prompt file. Remove the noisy location-region-appended rule.

**Architecture:** Two new Prisma models (AuditLog, AuditSuppression) store audit history and suppressions. The audit runner persists results after each run and filters findings against suppressions before filing issues. A markdown file in the repo serves as the evolving Chrome audit prompt.

**Tech Stack:** Prisma (schema + migrations), TypeScript, Next.js API route, Markdown

---

## File Structure

| File | Responsibility |
|------|---------------|
| `prisma/schema.prisma` | Add AuditLog + AuditSuppression models, AuditType enum |
| `src/pipeline/audit-runner.ts` | Persist AuditLog after each run, filter suppressions |
| `src/pipeline/audit-checks.ts` | Remove location-region-appended rule |
| `src/pipeline/audit-checks.test.ts` | Remove location-region-appended tests |
| `docs/audit-chrome-prompt.md` | Living Chrome prompt file |

---

### Task 1: Add AuditLog + AuditSuppression to Prisma Schema

**Files:**
- Modify: `prisma/schema.prisma`

- [ ] **Step 1: Add the AuditType enum after existing enums (around line 460)**

```prisma
enum AuditType {
  HARELINE
  KENNEL_DEEP_DIVE
}
```

- [ ] **Step 2: Add the AuditLog model (after Alert model, around line 460)**

```prisma
model AuditLog {
  id            String    @id @default(cuid())
  date          DateTime  @default(now())
  type          AuditType
  eventsScanned Int
  findingsCount Int
  groupsCount   Int
  issuesFiled   Int
  findings      Json      // Full AuditFinding[] array
  summary       Json      // { [category]: count }
  kennelCode    String?   // Set for deep dives, null for hareline
  kennel        Kennel?   @relation("AuditLogKennel", fields: [kennelCode], references: [kennelCode])
  createdAt     DateTime  @default(now())
}
```

- [ ] **Step 3: Add the AuditSuppression model**

```prisma
model AuditSuppression {
  id         String   @id @default(cuid())
  kennelCode String?  // null = global suppression for all kennels
  kennel     Kennel?  @relation("AuditSuppressionKennel", fields: [kennelCode], references: [kennelCode])
  rule       String   // e.g., "location-region-appended"
  reason     String   // Why it's suppressed
  createdAt  DateTime @default(now())
  createdBy  String?  // User who created it

  @@unique([kennelCode, rule])
}
```

- [ ] **Step 4: Add relations to Kennel model (around line 160)**

Add after the `sourceProposals` line in the Kennel model:

```prisma
  auditLogs         AuditLog[]         @relation("AuditLogKennel")
  auditSuppressions AuditSuppression[] @relation("AuditSuppressionKennel")
```

- [ ] **Step 5: Push schema to database**

Run: `npx prisma db push`
Expected: Schema synced, new tables created

- [ ] **Step 6: Generate Prisma client**

Run: `npx prisma generate`
Expected: Client regenerated with new models

- [ ] **Step 7: Commit**

```bash
git add prisma/schema.prisma
git commit -m "feat: add AuditLog and AuditSuppression models"
```

---

### Task 2: Persist Audit Results to AuditLog

**Files:**
- Modify: `src/pipeline/audit-runner.ts`

- [ ] **Step 1: Add persistAuditLog function to audit-runner.ts**

Add after the `runAudit` function:

```typescript
/** Persist audit results to the AuditLog table for trend tracking. */
export async function persistAuditLog(
  result: AuditResult,
  issuesFiled: number,
  type: "HARELINE" | "KENNEL_DEEP_DIVE" = "HARELINE",
  kennelCode?: string,
): Promise<string> {
  const log = await prisma.auditLog.create({
    data: {
      type,
      eventsScanned: result.eventsScanned,
      findingsCount: result.findings.length,
      groupsCount: result.groups.length,
      issuesFiled,
      findings: result.findings as unknown as Prisma.InputJsonValue,
      summary: result.summary as unknown as Prisma.InputJsonValue,
      kennelCode: kennelCode ?? null,
    },
  });
  return log.id;
}
```

Also add the Prisma import at the top:

```typescript
import { Prisma } from "@/generated/prisma/client";
```

- [ ] **Step 2: Call persistAuditLog from the audit route**

Modify `src/app/api/cron/audit/route.ts`. After `fileAuditIssues`, add:

```typescript
import { runAudit, persistAuditLog } from "@/pipeline/audit-runner";
```

And after the `fileAuditIssues` call:

```typescript
    const issueUrls = await fileAuditIssues(result.groups);

    // Persist audit results for trend tracking
    await persistAuditLog(result, issueUrls.length);
```

Also persist when there are zero findings (in the early return block):

```typescript
    if (result.findings.length === 0) {
      await persistAuditLog(result, 0);
      return NextResponse.json({
```

- [ ] **Step 3: Commit**

```bash
git add src/pipeline/audit-runner.ts src/app/api/cron/audit/route.ts
git commit -m "feat: persist audit results to AuditLog table"
```

---

### Task 3: Filter Findings Against Suppressions

**Files:**
- Modify: `src/pipeline/audit-runner.ts`

- [ ] **Step 1: Add loadSuppressions function**

Add before the `runChecks` function:

```typescript
/** Load active suppressions from the database. */
async function loadSuppressions(): Promise<Set<string>> {
  const rows = await prisma.auditSuppression.findMany({
    select: { kennelCode: true, rule: true },
  });
  const keys = new Set<string>();
  for (const r of rows) {
    // "kennelCode::rule" for kennel-specific, "::rule" for global
    keys.add(`${r.kennelCode ?? ""}::${r.rule}`);
  }
  return keys;
}

/** Check if a finding is suppressed. */
function isSuppressed(finding: AuditFinding, suppressions: Set<string>): boolean {
  // Check kennel-specific suppression
  if (suppressions.has(`${finding.kennelShortName}::${finding.rule}`)) return true;
  // Check global suppression (null kennelCode = all kennels)
  if (suppressions.has(`::${finding.rule}`)) return true;
  return false;
}
```

- [ ] **Step 2: Update runAudit to filter suppressions**

Modify the `runAudit` function. After `runChecks(rows)`, filter:

```typescript
export async function runAudit(): Promise<AuditResult> {
  // ... existing query code ...

  const checksResult = runChecks(rows);

  // Filter out suppressed findings
  const suppressions = await loadSuppressions();
  const filtered = checksResult.findings.filter(f => !isSuppressed(f, suppressions));

  // Re-group after filtering
  const summary: Record<string, number> = {};
  for (const f of filtered) {
    summary[f.category] = (summary[f.category] ?? 0) + 1;
  }
  const { groups, topGroups } = groupAndRank(filtered);

  return { eventsScanned: events.length, findings: filtered, groups, topGroups, summary };
}
```

Note: this replaces the current last line `return { eventsScanned: events.length, ...runChecks(rows) };`

- [ ] **Step 3: Commit**

```bash
git add src/pipeline/audit-runner.ts
git commit -m "feat: filter audit findings against AuditSuppression table"
```

---

### Task 4: Remove location-region-appended Rule

**Files:**
- Modify: `src/pipeline/audit-checks.ts`
- Modify: `src/pipeline/audit-checks.test.ts`

- [ ] **Step 1: Remove the rule from audit-checks.ts**

Remove the `STATE_GUARD_RE` constant, the `checkRegionAppended` function, and the call to it in `checkLocationQuality`. In `checkLocationQuality`, remove the block:

```typescript
    // 3. location-region-appended
    const regionFinding = checkRegionAppended(event, locationName, locationCity);
    if (regionFinding) {
      findings.push(regionFinding);
      continue;
    }
```

Also remove `STATE_GUARD_RE` and `checkRegionAppended` function definitions.

- [ ] **Step 2: Remove the tests**

Remove these test blocks from `audit-checks.test.ts`:
- `"skips location-region-appended when location ends with state abbreviation"`
- `"skips location-region-appended for venue-name-only locations"`
- `"flags location-region-appended for structured address with mismatched city"`
- `"does not flag location-region-appended when locationCity city name appears in locationName"`
- `"does not flag location-region-appended when locationCity is null"`

- [ ] **Step 3: Also remove from DATA_REMEDIATION_RULES in audit-issue.ts**

Remove `"location-region-appended"` from the `DATA_REMEDIATION_RULES` set in `src/pipeline/audit-issue.ts`.

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/pipeline/audit-checks.test.ts`
Expected: All remaining tests pass

- [ ] **Step 5: Commit**

```bash
git add src/pipeline/audit-checks.ts src/pipeline/audit-checks.test.ts src/pipeline/audit-issue.ts
git commit -m "feat: remove location-region-appended audit rule (too many false positives)"
```

---

### Task 5: Create Living Chrome Prompt File

**Files:**
- Create: `docs/audit-chrome-prompt.md`

- [ ] **Step 1: Create the prompt file**

```markdown
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
- Improbable start times 23:00–04:00 (`event-improbable-time`)

## What to Focus On (Chrome-Only Value)

These require visual/semantic judgment that the script cannot do:

1. **Source comparison:** Click through to the source URL. Does the extracted data match what the source shows? Pay attention to hares, location, and description.
2. **Semantic title issues:** Title looks wrong even if technically valid (e.g., description text as title, wrong kennel's name).
3. **Map pin accuracy:** Does the map pin match the stated location?
4. **Cross-kennel duplicates:** Same physical event appearing under two different kennels.
5. **Missing data:** Source has hares/location/description but HashTracks doesn't — the adapter is not extracting available fields.

## Active Suppressions

These kennel+rule combos are accepted behavior — do not flag:

*(none currently — update this section as suppressions are added)*

## Recently Fixed (Last 2 Weeks)

- Key West H3, Fort Eustis H3, Spring Brooks H3: stale default titles fixed (PR #423)
- Dayton H4: calendar ID corrected (PR #434)
- Palm Beach H3: default location updated to Wellington, FL (PR #434)
- TBD placeholder hares cleared from 34 events (PR #434)

## Focus Areas This Week

- Check new Harrier Central sources — recently onboarded, verify data accuracy
- Verify international sources (Dublin, Glasgow, Munich, Tokyo) — location handling may differ

## Output: Filing Issues

For each issue found, try to file it as a GitHub issue:

**Option 1 (preferred):** Navigate to this URL with the title and body filled in:
```
https://github.com/johnrclem/hashtracks-web/issues/new?labels=audit,alert&title=[Chrome Audit] {Kennel} — {Issue Category}&body={formatted body}
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
```

- [ ] **Step 2: Commit**

```bash
git add docs/audit-chrome-prompt.md
git commit -m "feat: create living Chrome audit prompt file"
```

---

### Task 6: Verification

- [ ] **Step 1: Push schema to production database**

Run: `npx prisma db push`
Expected: AuditLog and AuditSuppression tables created

- [ ] **Step 2: Run tests**

Run: `npm test`
Expected: All tests pass (audit-checks tests updated, no regressions)

- [ ] **Step 3: Trigger audit manually to verify persistence**

After deploying, run:
```bash
curl -s -X GET "https://www.hashtracks.xyz/api/cron/audit" -H "Authorization: Bearer $CRON_SECRET"
```
Expected: Response includes findings, and a new AuditLog row is created in the database.

- [ ] **Step 4: Verify suppression works**

Insert a test suppression:
```sql
INSERT INTO "AuditSuppression" (id, "kennelCode", rule, reason, "createdAt")
VALUES ('test-supp', NULL, 'location-duplicate-segments', 'Testing suppression', NOW());
```
Re-run audit — `location-duplicate-segments` findings should be filtered out.
Delete the test row after verifying.

- [ ] **Step 5: Commit and push**

```bash
git push -u origin feat/audit-intelligence-phase1
```
