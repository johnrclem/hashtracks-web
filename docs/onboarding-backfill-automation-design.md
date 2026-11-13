# Onboarding backfill automation: design

**Status:** Draft v3, revised after adversarial review rounds 1 and 2. Pending re-review, then owner review. 2026-11-12.
**Scope:** design only. Nothing here is built yet. No code, migration or prod write was made to produce it.
**Related:** [`kennel-onboarding/implement-handoff-prompt.md`](kennel-onboarding/implement-handoff-prompt.md) (the implementer),
[`kennel-onboarding/daily-onboarding-prompt.md`](kennel-onboarding/daily-onboarding-prompt.md) (research),
[`self-healing-v2-plan.md`](self-healing-v2-plan.md) (same shape: scheduled task + owner gate + server endpoints),
[`ops/audit-fixer-task.md`](ops/audit-fixer-task.md), [`ops/daily-digest-task.md`](ops/daily-digest-task.md),
[`../.claude/rules/prod-data-ops.md`](../.claude/rules/prod-data-ops.md).

## 1. Summary

Kennel onboarding is automated up to the merge. The research task writes a handoff, the implementer
builds it into a PR, the owner adds `owner-approved`, and the implementer merges, waits for the
deploy and runs one prod scrape. The history backfill is the one step a human still does by hand:
the implementer only reports `BACKFILL_APPLY=1 npx tsx scripts/backfill-<code>-history.ts`, and the
owner (or a session the owner starts) runs it from a laptop.

This design moves the backfill into the app. The owner's single `owner-approved` label approves the
backfill too, but only the exact PR content that was there when the label went on. The server
re-checks everything against prod, writes each archive row as one all-or-nothing unit through the
merge pipeline, records every row so the run can be undone, and verifies row by row that the kennel
page shows every archive run.

Seven decisions carry most of the safety:

1. **Approval is bound to the PR's content at label time.** When the owner adds the label, a workflow
   on `main` stamps the PR's head commit. The server applies only if what merged is identical to what
   was stamped: the archive and manifest byte for byte, and every other file's change line for line.
   The implementer's code-merge check moves to the same stamp.
2. **The archive gets its own source.** Rows bind to a disabled archive source that is never scraped,
   as six existing archive sources already do. Forced re-scrapes can't delete them and reconcile can't
   cancel them.
3. **History written by an archive is locked against other sources.** A later live row that matches an
   archive event is recorded but can't change the event's fields or move its date. Wide re-scrapes
   (up to 1,825 days) therefore can't undo curated dates or bring back redacted text.
4. **The backfill only creates, and the merge enforces it before writing.** In backfill mode any match
   onto an existing event throws before any write for that row. Archive rows the live source already
   has, with the same run number on the same date, are skipped as covered; any other overlap blocks
   the run.
5. **Each row is written atomically.** The RawEvent, the Event and its kennel link are one nested
   create, so a crash leaves each row fully written or not at all.
6. **The server decides, the agent only nudges.** The scheduled task can ask the server to plan or
   take the next step of an approved run. Resume and undo need the owner with a second factor.
7. **Verification checks rows, not totals.** Every archive (date, run number) must appear on the
   public kennel page. The Zagreb "716 created, 715 shown" case is the page counting unique dates;
   all 716 runs are there (section 9.4).

Phase 2 scope is deliberately narrow: one kennel, rows provably from that kennel's own feed, run
numbers strictly increasing, at most 2,000 rows. Rollout is shadow first, then apply behind the label,
then loosening only on evidence and only after agents and the server stop holding the owner's GitHub
identity.

## 2. Today, and why the backfill stops at a human

### 2.1 The current flow

| Step | Who | Where |
|---|---|---|
| Research writes a handoff (archive source noted) | `hashtracks-kennel-onboarding` task | Mac mini, docs-only PR |
| Implementer freezes `scripts/data/<code>-history.json`, writes the loader, dry-runs it, scrubs phones and emails, opens the PR | `hashtracks-kennel-implement` task | Mac mini, own clone |
| Owner reviews, adds `owner-approved` | Owner | GitHub |
| Implementer merges, waits for the deploy, checks the migration, runs one prod scrape | implementer Phase A | GitHub + `POST /api/cron/scrape/<id>` |
| Backfill apply | **Owner, by hand** | laptop, `BACKFILL_APPLY=1` |

`runBackfillScript` (`scripts/lib/backfill-runner.ts`) in dry-run mode never touches the database: it
parses the archive, drops rows dated today or later, and prints three samples. The apply mode looks
up the source by name, checks that at least one `SourceKennel` link exists, and calls
`processRawEvents` once with every row. It throws if any row was blocked by the source-kennel guard.

### 2.2 Why it isn't automated yet

| Reason | Evidence |
|---|---|
| Unattended tasks can't reach prod's database | Auto mode refused an unattended task's read-only prod queries on 2026-11-09 (`self-healing-v2-plan.md` §4.2). This session's own read-only query was refused the same way on 2026-11-12. |
| Misroutes are silent and large | A wide GCal backfill filed about 1,100 sibling kennels' runs under OH3 because unmatched rows fell into `defaultKennelTag` (`prod-data-ops.md`). |
| Archives carry personal data | The first implementer run's scrub caught only dashed numbers and left 5 (`implement-handoff-prompt.md` Build step 6). The repo is public. |
| Bulk writes are hard to reverse | Nothing records which rows a backfill created. A 1,112-row delete hit Prisma's 5 s interactive-transaction default (P2028) at 76 s and rolled back. |
| Reconcile can cancel backfilled runs | A backfill bound to a wide-window live source is cancelled by that source's next reconcile (the Summit Full Moon near-miss, PR #2606), which is why archive sources exist. |
| The merge isn't transactional per batch | A RawEvent's `processed` flag and `eventId` are written only by the flush after the loop (`src/pipeline/merge.ts` ~3226). A crash in between leaves new events whose RawEvents look orphaned, and the orphan path re-processes them. |
| Live scrapes reach far back | The scrape route accepts `days` up to 1,825 (`src/app/api/cron/scrape/[sourceId]/route.ts` ~57), as do alert re-scrapes (`rescrapeFromAlert`). A live row can land on any archive date. |
| Counts don't obviously match the page | Zagreb H4: 716 created, kennel page shows 715 (section 9.4). |

### 2.3 What already works and is reused

| Pattern | Where |
|---|---|
| Bearer-token agent API that fails closed | `src/lib/audit-agent-auth.ts`, `src/app/api/audit/agent/*` |
| Server-side backfill through the merge pipeline | `src/app/api/admin/atlanta-deep-backfill/route.ts` (dry run, then `apply: true`) |
| Disabled archive sources that shield history from reconcile | "Summit Full Moon H3 Archive" and five others in `prisma/seed-data/sources.ts`; `protectedByOtherSources` in `src/pipeline/reconcile.ts` |
| A merge rule that other sources can't override | admin-cancelled events (`isAdminLocked` in `src/pipeline/merge.ts`) |
| Event + primary kennel link in one nested create | `createEventWithKennel` in `src/lib/event-write.ts` |
| Race-safe event delete that refuses user data | `scripts/lib/delete-leaked-event.ts` (`RequireZeroCount`, `FOR UPDATE`, `ForeignRawSourceError`) |
| Read-only ops snapshot for the digest | `GET /api/audit/agent/ops-digest`, `buildOpsDigest` |

## 3. Goals and non-goals

**Goals**
- From the owner's `owner-approved` label to a verified backfill with no human step, for the Phase 2
  scope below.
- Every write is preceded by a dry run whose counts the owner approved, and any drift blocks it.
- Every applied run can be undone exactly.
- The owner learns of every apply, block and failure from the PR and the daily digest, without
  reading logs.

**Phase 2 scope (what automation accepts at first)**
- One kennel per archive, frozen from a seeded **origin source linked to that kennel only**, with no
  `kennelPatterns` or `defaultKennelTag` routing to anyone else.
- **Every row's `sourceUrl` is the origin's**: equal to it for a sheet or calendar id, same host and
  path prefix for a website. This ties the rows to the origin, not just the manifest's claim.
- One kennel tag per row, no `seriesId`, no `externalLinks`.
- Run numbers **strictly increase** in (date, run) order, with at most 5 rows and at most 1% of rows
  listed as exceptions. At most 5% of rows may lack a run number.
- Bound to a dedicated archive source (section 6.5). The PR's migrations only insert reference rows
  (G17).
- At most 2,000 rows.

Zagreb H4 (716 rows, all numbered, one sheet URL) fits. Music City H3 (320 rows) has 16 without a run
number, which is exactly 5%, and all its URLs are on `musiccityhash.com`; it fits at the limit. Both
are already applied by hand and enter the record through adoption (section 6.6), which writes
nothing and doesn't need the Phase 2 scope.

**Non-goals**
- Enriching or correcting existing events from an archive. An archive row that disagrees with an
  existing event blocks the run.
- Multi-kennel archives and archives frozen from multi-kennel feeds, until per-row routing provenance
  exists (section 13, Phase 3). This is the OH3 class.
- Wide live-source backfills (`scrapeSource(days: 9999)`), which route by patterns at run time.
- Archives above the cap (SDH3's 7,649 runs would be one).
- Restores of cancelled runs, phantom cleanups and other one-shot data fixes.
- Running the backfill before the onboarding PR is merged and deployed.
- Changing what the owner does to approve. The label stays the one action; only the checks behind it
  get stronger.

## 4. Trust model

### 4.1 What is actually enforced, and by what

The honest boundary is the owner's Mac mini. Every scheduled task there runs as the owner's OS user,
can read the owner's `.env` (`DATABASE_URL`, `CRON_SECRET`, the repo-scope `GITHUB_TOKEN` PAT, and
any new token), and runs `gh` as the owner's GitHub account. So "agents don't write prod's database"
and "agents never add `owner-approved`" are **prompt rules, not capabilities**. A misbehaving or
hijacked agent can already do far more damage with `DATABASE_URL` than with anything this design
adds.

The design therefore aims at two different things:

| Threat | Protection |
|---|---|
| **Mistakes**: a bad archive, a misroute, PII, overlap with live data, drift after approval, a race, a crash halfway, a wrong count | Machine guards on the server, independent of who calls them. This is the main purpose |
| **A misbehaving agent on the Mac** | Not solved here. The design removes the *need* for agents to touch the database or run backfill scripts, and makes every automated write recorded, visible and undoable. H1 and H2 (4.3) would turn the prompt rules into real limits; they are entry conditions for Phase 3 |
| **Someone outside the Mac** (internet, fork PRs, a leaked server credential) | Real limits, listed in 4.2, once H3 is done (a Phase 2 entry condition) |

### 4.2 Actors and credentials

| Actor / credential | Through the app it can | Through the app it can't |
|---|---|---|
| Owner | Add or remove `owner-approved`; resume, halt or undo from `/admin/backfills` after step-up with a second factor; change env flags | |
| Scheduled agents | Open PRs, merge approved PRs, call the backfill agent API | Resume, halt or undo (step-up needs a passkey or TOTP code). Outside the app they hold owner-level secrets (4.1) |
| `BACKFILL_AGENT_TOKEN` | Plan, preview, advance a run the owner approved, check a PR's approval, read status | Approve, choose an archive, resume, undo, read user data |
| `GITHUB_APPROVAL_READ_TOKEN` (server, new, fine-grained, read-only) | Read PRs, labels, statuses, Actions runs and file contents | Add labels or statuses, merge, push |
| The server's issue-filing credential | Today: the owner's repo-scope PAT, which can label, push and merge as the owner. **H3 replaces it** with a GitHub App limited to issues, whose actions show as the App, so A2 rejects any label it adds | |
| `approval-stamp` workflow (`pull_request_target` on `main`) | Record the head SHA when `owner-approved` is added | Run PR code (it never checks it out) |
| CI | Recompute and check manifests and migrations; render the manifest in its check summary | Write anything outside GitHub |
| Anyone on the internet | Open a PR from a fork; read the public repo and pages | Get a PR merged or labelled |

### 4.3 Assumptions and hardening

- **T1. Anything acting as the owner's GitHub account can approve.** Agents run `gh` as the owner. An
  agent could add the label (and the stamp workflow would record it), or push a workflow of its own
  that writes a status as `github-actions[bot]`. A3's Actions-run check (6.4) stops the second for
  anything not on `main`, but the first is the same assumption that already guards every code merge.
  Phase 2 needs the owner's written acceptance of T1; Phase 3 needs H1.
- **T2. GitHub's records are honest; git's are not.** Label events, workflow runs and statuses come
  from GitHub. Commit dates are set by whoever commits and are never used.
- **T3. Deployed code on `main` is trusted.** A PR that changes guard code is refused for automated
  apply (G15), so an onboarding PR can't weaken the checks that judge it.
- **H1. Agents get their own GitHub identity** (a GitHub App or machine user). PRs are then authored
  by the bot, the owner can submit a GitHub "Approve" review bound to a commit, and the server can
  require the approval to come from the owner's account and nothing else. Phase 3 entry.
- **H2. Scheduled tasks lose the owner-level secrets** (`DATABASE_URL`, `CRON_SECRET`, the owner PAT).
  Once backfills, the digest and audits all run through narrow APIs, the tasks only need narrow
  tokens. Phase 3 entry.
- **H3. The server stops holding the owner's identity.** Issue filing moves to a GitHub App limited to
  issues, and approval checks use the read-only token. A leak from Vercel then can't forge an
  approval. Phase 2 entry.

## 5. Design overview

```
 implementer (PR)                     CI                        owner
 ─────────────────                    ──                        ─────
 freeze archive, scrub PII            recompute manifest;  ──►  reads CI's manifest summary,
 write manifest (hashes, counts)      check scope rules,        samples, preview plan
 migration adds archive source        PII, migration shape;     adds `owner-approved`
 POST /preview → plan in PR body      summary in check run          │
                                                          approval-stamp workflow records
                                                          the head SHA at that moment
         implementer Phase A: approval check (stamp), merge, wait for deploy, first prod scrape
                                                │
 app server (prod) ─────────────────────────────▼──────────────────────────────────────
 POST /plan     approval: stamp genuine; merged content == stamped content; recompute manifest;
                every guard; each row CREATE or COVERED → PLANNED, WAITING or BLOCKED
 POST /advance  re-check approval + guards; merge one batch in backfill mode (any match throws,
                one atomic write per row); record items; slot + snapshot checks → APPLIED / HALTED
 POST /verify   every item visible; archive (date, run) ⊆ page; nothing pre-existing changed
                → VERIFIED / VERIFY_FAILED
 daily cron     resume expired leases, retry WAITING, plan unplanned approvals, 7-day re-verify,
                liveness errors
 admin UI       owner + second factor: resume, halt, undo (with its own dry run)
 every scrape   history lock: rows from other sources can't change archive-written events
                                                │
                     implementer comments on the PR · digest reports every run
```

## 6. The approval model

### 6.1 The manifest

Each archive `scripts/data/<code>-history.json` gets a sibling
`scripts/data/<code>-history.manifest.json`, generated by one shared library function:

| Field | Meaning |
|---|---|
| `version` | Manifest format version |
| `archivePath`, `archiveSha256` | The archive file and the SHA-256 of its exact bytes |
| `sourceName` | The source the rows bind to: the archive source, or for `adopt-only` the source they were applied to |
| `originSourceName` | The seeded live source the archive was frozen from |
| `binding` | `archive-source` (Phase 2 applies) or `adopt-only` (section 6.6) |
| `kennelTimezone`, `frozenAt` | For the "past rows only" rule |
| `expectedKennelCodes` | Exactly one kennel in Phase 2 |
| `perKennel[code]` | `rows`, `uniqueDates`, `firstDate`, `lastDate`, rows without a run number, field fill counts, three sample titles |
| `sameDateGroups` | Every (kennel, date) with more than one row, with run numbers |
| `runNumberExceptions` | Rows that break the strict run-number order (capped, 6.2) |
| `piiScan` | Scanner version and residual count (must be 0) |
| `approvalHash` | SHA-256 over the canonical JSON of every field above except the sample titles, which depend on display names |

### 6.2 CI makes the manifest honest and shows it to the owner

A required CI job, `backfill-manifest`, runs on every PR that touches `scripts/data/*-history*` or
`prisma/migrations/`. Its script lives under a guard path (G15), so a PR can't change the numbers it
shows.

**Every manifest:**
- The manifest recomputed from the archive equals the committed one in every `approvalHash` field.
- Every row has a `YYYY-MM-DD` date before `frozenAt` in `kennelTimezone`, and one kennel tag in
  `expectedKennelCodes`.
- PII residual is 0 (8.2).
- The per-kennel table, samples, same-date groups, run-number exceptions and approval hash go into the
  job's **check-run summary**. The owner reads the numbers there, derived by CI from the committed
  file, not from a PR body the agent wrote.

**`archive-source` manifests also need:**
- The PR adds **exactly one** archive and **one** manifest, both new files, and changes nothing else
  under `scripts/data/*-history*`.
- The Phase 2 scope rules in section 3: single-kennel origin in the seed data, every row's
  `sourceUrl` on the origin's URL, no `seriesId` or `externalLinks`, strict run-number order with the
  exception and missing-number caps.
- The archive source in the seed data is disabled, `archiveOnly`, linked to the kennel only.
- Every migration the PR adds passes G17.

**`adopt-only` manifests** need only the checks for every manifest, plus: the PR adds just the
manifest, for an existing archive it doesn't change.

### 6.3 Stamping the approval

A workflow on `main`, `approval-stamp.yml`, runs on `pull_request_target` with `types: [labeled]`.
When the label is `owner-approved`, it sets a commit status `backfill/approved` on
`github.event.pull_request.head.sha` (the head GitHub reports at that moment), with the PR number in
its description and its own run URL as `target_url`. It never checks out or runs PR code.
`pull_request_target` always runs the workflow file from `main`, so a PR can't change what it does.

The repository's default workflow token is set to read-only; only this workflow asks for
`statuses: write`. Another workflow can't write a status unless it is on `main` and asks for that
permission, and changing `main`'s workflows goes through the owner's merge gate.

### 6.4 What the server checks before it treats a PR as approved

At plan time and before every batch, using `GITHUB_APPROVAL_READ_TOKEN`:

| # | Check | Why |
|---|---|---|
| A1 | The PR is merged into `main`; its merge commit `S` is an ancestor of the deployed commit (`VERCEL_GIT_COMMIT_SHA`) | The onboarding migration is live, and the code judging the archive includes the PR |
| A2 | The PR carries `owner-approved` now, and the newest `labeled owner-approved` event was made by `OWNER_GITHUB_LOGIN` | Removing the label stops the run at the next batch. After H3 no server credential can make this event |
| A3 | A `backfill/approved` status on a SHA `H` names this PR, was created by `github-actions[bot]` after that label event, and its `target_url` is an Actions run whose workflow path is `.github/workflows/approval-stamp.yml`, event `pull_request_target`, run on `main` | The label was added while `H` was the head, and the stamp came from the real workflow, not one an agent pushed to a branch |
| A4 | **Merged content equals stamped content.** For every file the PR adds: blob SHA at `S` equals blob SHA at `H`. For every file it modifies: the lines it adds and removes (a diff without context lines) are the same in `H` against its merge base and in `S` against its first parent. And the manifest's `archiveSha256` matches the archive | Covers the migration, the seed data and the archive together. An update-branch merge of `main` passes, because it doesn't change the PR's own lines. A force-push, a post-label commit or a web-editor conflict fix that changes them fails |
| A5 | The manifest is the PR's only manifest, and no other non-preview run exists for its `manifestSha256` | One approval, one apply |
| A6 | The PR changes no guard path (G15), and its migrations pass G17 | The PR can't edit the checks that judge it, or change existing data to make a guard pass |

A missing stamp, or a GitHub API error, is **retryable** (`WAITING`): Actions may simply be slow. A
stamp that exists but fails A3 or A4 is terminal.

The manifest and archive are fetched with GitHub's contents API at `S` and `H`, for this repository
only, with the path matching `^scripts/data/[a-z0-9-]+-history[a-z0-9-]*\.(manifest\.)?json$` and a
10 MB cap. The server never fetches a URL supplied by a caller.

**The code merge uses the same check.** The implementer's Phase A merge step today compares the label
time with the head commit's date, which T2 says to distrust. It changes to calling
`GET /api/agent/backfill/approval/:pr` (read-only), which runs A2–A4 against the PR's current head
and returns approved or not, with reasons. The implementer merges only on "approved". This is still
the agent following its manual, but it is the same check the server will apply after the merge.

### 6.5 The archive source and the history lock

Phase 2 binds every row to a dedicated source, like the six archive sources already seeded:
`enabled: false`, a new `Source.archiveOnly = true` column, `config.upcomingOnly: true` as a backstop,
`replacedById` null, linked to the one kennel, `trustLevel` no higher than the origin's. The
onboarding migration creates it next to the live source.

**What the binding fixes:**

| Risk with the live source as the binding | Why the archive source removes it |
|---|---|
| A forced re-scrape (`scrapeSource(force)`, used by several admin actions) hard-deletes every RawEvent of the source (`src/pipeline/scrape.ts` ~460) | `scrapeSource` refuses to scrape, or force-scrape, an `archiveOnly` source |
| The live source's reconcile cancels past rows it no longer returns | A disabled source's RawEvent shields its event from any other source's reconcile (`protectedByOtherSources`), provided that source has no RawEvent on it, which the history lock keeps true |
| Proving a RawEvent is the backfill's | Nothing but backfills writes to an archive source |

**What the history lock adds.** A live scrape can still reach archive dates: `days` up to 1,825 from
the scrape route or an alert re-scrape, or a raised `scrapeDays`. Without a lock, the merge would let
an equal-trust live row overwrite an archive event's fields on a same-day match, or move it with the
±30-day date-correction path. Curated corrections would be undone (Zagreb #2501 would return to
2025-11-06), redactions would come back (Zagreb #1797's hare, left out because it contains a racial
slur), and once a live RawEvent was linked, the reconcile shield would stop protecting that event.

So the merge gains one rule for **all** sources: when the matcher picks an event backed by an
`archiveOnly` source, and the incoming row is from a different source, the row's RawEvent is recorded
(`processed: true`, `eventId: null`) and the event is left untouched: no field update, no date move,
no link. The date-correction query also skips archive-backed events. The scrape log counts these rows
as `historyLocked`. The lock applies only to events of sources flagged `archiveOnly`, so the six
existing archive sources keep today's behaviour until the owner flags them.

### 6.6 Adoption of backfills applied by hand

An `adopt-only` manifest describes an archive already applied by hand. Its plan must find, for every
row, an event of the kennel on that date with that run number (or, for unnumbered rows, the only event
on that date), backed by the stated source. It then records the items and ends `ADOPTED` without
writing anything. If any row has no such event, it is `BLOCKED`. It matches on (kennel, date, run
number), not fingerprints, because the merge's pre-fingerprint clean-up changes over time (last on
2026-11-12, #2935) and would make old fingerprints miss. This is how the Music City and Zagreb
backfills enter the run record.

### 6.7 Drift, retries and re-submission

**No write when:** the merged content differs from the stamped content (A4); the recomputed manifest
differs from the committed one in any `approvalHash` field (G2); any row is neither CREATE nor COVERED
(G9, G10); the rows to create plus the rows covered differ from the manifest's `rows`; or any other
terminal guard fails.

**Retryable (`WAITING`)**, the watch cron tries again: deploy not yet containing `S`; stamp not yet
present; GitHub or database unavailable; the daily apply limit reached.

**Terminal (`BLOCKED`):** everything else. The partial unique index on `manifestSha256` covers every
status except `PREVIEW`, so a blocked manifest can't be planned again. To try again, the implementer
opens a new PR with a new archive file under a new name (`<code>-history-r2.json` and its manifest),
which CI allows when no earlier manifest for that kennel was applied. That needs a new label and stamp.

## 7. Server endpoints

### 7.1 Token

A new secret, `BACKFILL_AGENT_TOKEN` (32+ characters), checked like `AUDIT_AGENT_TOKEN` but with its
own env var, failing closed when unset or short. It is not `AUDIT_AGENT_TOKEN`, whose documented
promise is that nothing behind it edits event data.

### 7.2 Routes (`/api/agent/backfill/*`, all `maxDuration = 300`)

| Route | Effect | Writes |
|---|---|---|
| `GET /approval/:pr` | A2–A4 against the PR's current head, for the implementer's merge step | none |
| `POST /preview { prNumber }` | Plans an **open** PR's archive at its head against prod, for the PR body. Status `PREVIEW`, never applicable | Run row only |
| `POST /plan { prNumber }` | A1–A6, then every plan guard and the matcher simulation. Returns `PLANNED`, `WAITING` or `BLOCKED` | Run row only |
| `POST /runs/:id/advance` | One batch of a `PLANNED` or `APPLYING` run, or its final step | Events, through the merge pipeline in backfill mode |
| `POST /runs/:id/verify` | The checks in 9.3 | Run row only |
| `GET /runs/:id` | Status, counts, reason codes, verification result | none |

`HALTED` runs resume only from `/admin/backfills`, never through the token.

**What responses and PR text may contain:** counts, kennel codes, the archive's own dates, run
numbers and sample titles (all already public in the repo), reason codes. **Never:** matched PII
text, dates or details of existing prod events (some are private manual entries), user data, secrets.
Block reasons about existing events give counts only; the dates are shown only in the admin page.

**Limits:** one `preview`/`plan` per PR per 10 minutes; one run `APPLYING` at a time across the app;
`advance` returns `409` while another caller holds the lease.

### 7.3 Who drives the steps

- **The implementer**, in Phase A after the first prod scrape: `plan`; `advance` until done (at most
  40 calls); `verify`; the public-page check; one PR comment.
- **The daily `backfill-watch` cron** (Vercel cron, `CRON_SECRET`): resumes runs whose lease expired,
  retries `WAITING` runs, plans approved manifests from the last 30 days that have no run, re-verifies
  runs from the last 7 days, and raises the liveness errors in 11.3. In Phase 2 it never starts a
  fresh apply; that stays with the implementer so each start has a report beside it.
- **The owner**, from `/admin/backfills`: the same steps, plus resume, halt and undo.

QStash is not used. `self-healing-v2-plan.md` found its retries leave no trace, and a step function
with three independent callers needs no queue.

## 8. Guards

A guard either passes or stops the run; none warns and continues. Terminal failures end in `BLOCKED`
(at plan) or `HALTED` (mid-run). Retryable ones end in `WAITING`.

### 8.1 The list

| # | Guard | Checked at | Failure |
|---|---|---|---|
| G1 | Approval A1–A6 (missing stamp, deploy lag and GitHub errors are retryable) | plan, every batch | terminal / retryable |
| G2 | Recomputed manifest equals the committed one in every `approvalHash` field | CI, plan | terminal |
| G3 | Every row dated before today in `kennelTimezone`; future rows are an error, not skipped as `reportAndApplyBackfill` does | CI, plan | terminal |
| G4 | **Routing:** one tag per row, equal to the single expected `kennelCode`, resolving through the real resolver at the exact-`kennelCode` stage; the archive source is linked to that kennel and nothing else | plan, every batch | terminal |
| G5 | **Origin:** the origin source is linked to the expected kennel only, with no `kennelPatterns` or `defaultKennelTag` naming another kennel; every row's `sourceUrl` is on the origin's URL | CI, plan | terminal |
| G6 | **Sibling mention:** no row's title, hares, location or description names another kennel (code, short name or alias) in the same region or linked to the origin | CI (seed data), plan (prod aliases) | terminal |
| G7 | **Run numbers:** strictly increasing in (date, run) order within the caps; for CREATE rows, not equal to any run number an existing event of the kennel has | CI (order), plan, every batch | terminal |
| G8 | **PII:** zero phone numbers or email addresses in every string field, URLs also checked after decoding (8.2) | before commit, CI, plan, every batch | terminal |
| G9 | **Overlap is either covered or blocked.** For each row, look at existing events with the kennel as primary **or** co-host (`EventKennel`), in any status, on that date. None: the row is a CREATE candidate. Exactly one, CONFIRMED, backed by an enabled source, with the same run number: the row is COVERED and is skipped. Anything else (no run number to compare, a different one, a cancelled, manual or archive-backed event, several events): terminal. COVERED rows must all be later than every CREATE row, so the live feed owns one recent stretch and the archive the rest | plan, every batch | terminal |
| G10 | **Matcher says CREATE:** the merge's own matcher, run read-only over the CREATE rows in apply order, with each simulated create added to its same-day pool, returns CREATE for every one: no same-day, fuzzy, cross-window or date-correction match. Strict run numbers mean no archive row can date-correct another | plan | terminal |
| G11 | **Counts:** per kennel, CREATE + COVERED rows equal the manifest's `rows`; on a fresh plan, no CREATE row's fingerprint already exists on the archive source | plan | terminal |
| G12 | **Binding:** the archive source is disabled, `archiveOnly`, `replacedById` null; exactly one source has that name | plan, every batch | terminal |
| G13 | **Size and rate:** rows ≤ `BACKFILL_MAX_ROWS` (2,000) is terminal; more than 2 applies started per UTC day is retryable | plan | terminal / retryable |
| G14 | **Batch result:** no create-only violation; `created` equals the batch's rows; `updated`, `restored`, `blocked`, `eventErrors` are 0; every created event's primary kennel is the expected one and its date is the row's date; V3 and V4 (9.3) pass | every batch | terminal (`HALTED`) |
| G15 | **Guard code untouched:** the PR changes nothing under `src/lib/backfill/**`, the PII scanner, `src/pipeline/merge.ts`, `src/pipeline/kennel-resolver.ts`, `src/pipeline/fingerprint.ts`, `src/pipeline/scrape.ts`, `src/pipeline/reconcile.ts`, `src/lib/event-write.ts`, the shared kennel-page stats function, `prisma/schema.prisma`, the CI manifest script, `.github/workflows/**` or the agent routes | plan | terminal (the owner can still apply by hand) |
| G16 | **Kill switch:** env `BACKFILL_AUTOMATION` is `apply` (`off` and `shadow` refuse `advance`) | every call | `403` |
| G17 | **Migration shape:** every migration the PR adds consists only of `INSERT … ON CONFLICT DO NOTHING` (or `WHERE NOT EXISTS`) into `Kennel`, `KennelAlias`, `Region`, `Source` and `SourceKennel`. No `UPDATE`, `DELETE`, DDL or other tables. Other onboarding PRs are fine, but their backfills are applied by hand | CI, plan | terminal |

A `HALTED` run stops where it is. Nothing is rolled back automatically, because an automatic delete
would be a prod write without the owner's OK. Every row already written is complete (9.1), so a
halted run is always consistent for the owner to resume or undo.

### 8.2 The PII scanner

One module, used by the implementer before it commits, by CI and by the server, so the three can't
disagree. It covers every format already seen in archives: dashed, spaced, dotted and parenthesised
North American numbers, bare 10-digit numbers, 7-digit local numbers (`286-0444`), international
`+CC` numbers, Croatian and other European mobile shapes, and emails including `name (at) domain`.
It scans every string field, and URL fields again after percent-decoding (the Zagreb archive had a
phone number inside a Maps URL). It reports row index, field and pattern id, **never the matched
text**. It fails closed and has no allowlist.

**Out of scope, accepted risk:** home addresses and private individuals' real names. Archives are
public kennel schedules; curation at freeze time is the control for these.

**A hit after push is a leak, not a bug to patch.** The repo is public, so a hit in CI or at plan time
means the data is already published, and a fix-up commit leaves it in the branch history and in the
PR's `refs/pull/N/head`. The response:
1. Close the PR and delete the branch; never apply it.
2. Ask GitHub support to purge the PR's cached refs (only GitHub can remove `refs/pull/*`).
3. Rebuild from a fresh branch with the scrubbed archive under a new name, in a new PR.
4. The digest reports the leak as "Needs you today" until the owner marks it handled.

The scanner's real job is at freeze time, before the first push. The implementer runs it before every
commit that touches `scripts/data/`.

## 9. Plan, apply and verify

### 9.1 Changes to the merge pipeline

`processRawEvents` gains a `backfill` option, used only by this system:

1. **Any match throws.** Matching is pulled out of `upsertCanonicalEvent` into a read-only step that
   returns CREATE or MATCH (with its path: same-day, fuzzy window, cross-window, date-correction,
   orphan adoption). In backfill mode **any** MATCH, including one onto an event the run itself just
   created, throws `CreateOnlyViolation` before any write for that row. The ±30-day date-correction
   path (same `sourceUrl`, run number and label, `merge.ts` ~1726) matters most: archive rows carry
   the origin's URL, and curated date fixes are routine.
2. **One atomic write per row.** The RawEvent (with `processed: true`) is created inside the same
   nested create as the Event and its primary `EventKennel`, extending `createEventWithKennel`. There
   is never a RawEvent without its event, or an event waiting for the post-loop flush to link its
   RawEvent. After the create, `recomputeCanonical` still runs for the slot (`merge.ts` ~2356); G9
   leaves the new event alone on its slot, so it's a no-op, and any write it does make fails G14.
3. **No cluster linker.** The same-title cluster linker only reads events from yesterday onward
   (`src/pipeline/same-title-cluster.ts` ~241), so it can't link a past archive row; it would only
   re-link the kennel's upcoming live events as a side effect. Backfill mode skips it.
4. **Rows with `seriesId`, more than one kennel tag, or `externalLinks` are rejected**, since their
   extra writes happen after the per-row create.

Separately, for **every** source, the history lock in 6.5.

`Kennel.lastEventDate` is still updated after the loop; it is a derived field, recomputed at the end of
the run and after undo.

### 9.2 Plan, then apply

**Plan** (read-only):
1. A1–A6; fetch manifest and archive at `S`; G2.
2. Resolve the archive source, origin and kennel; G4, G5, G12.
3. Normalise each row the way `processRawEvents` does before fingerprinting, on a copy, and compute
   its fingerprint.
4. G3, G6, G7, G8, G13; classify each row with G9; the matcher simulation (G10) over CREATE rows; G11.
5. Record the V3 snapshot.
6. Store the plan: per-kennel counts of CREATE and COVERED, row order, batch boundaries and `planHash`
   (SHA-256 of the approval hash, source ids, kennel id and the ordered CREATE fingerprints).

**Apply** (one `advance` call = one batch of CREATE rows):
- **Lease.** `advance` sets `leaseToken` and `leaseExpiresAt = now + 6 min` with one conditional
  update that succeeds only if the lease is free or expired.
- **Batch.** The next CREATE rows in plan order. Same-date groups are never split. The first batch is
  50 rows; later ones are sized from the measured time per row to use at most 150 s of the 300 s limit,
  capped at 200.
- **Steps:** G1, G4, G8, G9 (for the batch's rows), G12, G16 → record the batch's row indexes as
  `inFlightBatch` → merge in backfill mode → for each row, read the RawEvent by (archive source,
  fingerprint) and write a `BackfillRunItem` → G14 → clear `inFlightBatch`, advance the cursor, release
  the lease (one short transaction, 30 s timeout).
- **No long transactions.** Each row is its own nested create; bookkeeping holds at most 200 small
  inserts. Nothing like the 76 s delete that hit P2028.
- **Finish.** When every CREATE row has an item: recompute `lastEventDate`, set `APPLIED`, run `verify`.

**Races with live scrapes.** A live scrape can reach archive dates (2.2), so the design doesn't
assume it won't:
- *Before a row is written:* if a live event has landed on its slot, the in-merge create-only check
  throws, and the run halts.
- *After it is written:* the history lock means a live row that matches it can't change it.
- *In the moment between:* a live row creating a second event on the same slot is caught by V4 after
  the batch, and the run halts.

### 9.3 Verify

`verify` runs after the last batch and daily for 7 days afterwards. V3 and V4 also run after every
batch, as part of G14. All are row checks:

| # | Check |
|---|---|
| V1 | Every item's event exists, is `CONFIRMED` and canonical, has the expected kennel as primary, and passes the kennel page's own display filter. The page's query and filters move into one shared function used by both the page and `verify` |
| V2 | Every archive (date, run number), CREATE and COVERED alike, appears in the kennel's displayed events. The implementer checks the same on the public page payload, from its own clone's copy of the archive |
| V3 | **Static history unchanged.** A hash over every pre-existing event of the kennel dated within 30 days of a CREATE row's date that **no enabled source backs** (id, date, status, `isCanonical`, primary kennel, run number, title, hares, location fields, `parentEventId`), taken at plan time, is unchanged. Live-backed events are left out, because their sources update them every day; a run that wrongly touched one would already have failed the in-merge check or G14's `updated = 0` |
| V4 | No CREATE slot shows any event other than the run's own |
| V5 | The public page's `totalEvents` equals the shared function's count at the same moment |

The count chain (rows → events → visible → unique dates, before and after) is reported for the owner
to read but is not pass or fail: totals can balance while rows are wrong, and live scrapes change
totals every day.

A V1–V4 failure is `VERIFY_FAILED` (or `HALTED` mid-run) with the check and row indexes. During the
7-day re-checks it also raises a Sentry error and appears under "Needs you" in the digest.

### 9.4 The Zagreb 716-vs-715 case

On 2026-11-13 the hand apply reported `created=716` and the kennel page showed 715. The page counts
unique dates, not events (`src/app/kennels/[slug]/page.tsx`: `uniqueDates = new Set(events.map(date))`).
The archive has 716 rows on 715 dates: #2059 and #2060 are both on 2014-10-04 and stay separate
events because their run numbers differ (the merge's run-number veto, #2656).

A count alone doesn't prove nothing is missing, so this was checked row by row on 2026-11-12 against
the public page payload: the page lists 716 distinct events on 715 unique dates; every archive
(date, run number) pair appears exactly once; and the page shows no event outside the archive. V2 is
that check, automated.

### 9.5 Reconciling a mismatch

1. Read the run's verification result (`GET /runs/:id` or the admin page). The failing check and row
   indexes name the cause.
2. **V1 fails, event `CANCELLED`:** something cancelled it after the apply. Check the reconciliation
   context of the latest `ScrapeLog` rows for the kennel's sources. The archive binding and history
   lock should make this impossible, so treat it as a bug.
3. **V1 fails, not canonical:** another event took the slot after the apply; V4 fails too. Inspect,
   then decide which event is wrong.
4. **V1 fails, wrong kennel:** G14 should have halted. Undo the run.
5. **V2 fails for a COVERED row:** the live event changed or was cancelled after the plan. That's the
   live source's business; record it and check the source.
6. **V2 fails while V1 passes:** the page filters something the shared function doesn't, so the two
   have drifted. Fix the shared function.
7. **V3 fails:** static history changed. If the run did it, undo; otherwise find the writer.
8. **Totals differ but V1–V4 pass:** expected. Same-date rows, live events and cancellations all move
   totals.

## 10. Idempotency, partial failure, resume and undo

### 10.1 Idempotency

- One run per approved manifest (A5 and the unique index). Calling `plan` again returns the existing
  run.
- `advance` on a finished run is a no-op that returns its status.
- Items are keyed by **row index**, so a deploy that changes fingerprint normalisation mid-run can't
  make done rows look new. The run records the deployed commit for each batch. If a resumed batch's
  fingerprints no longer match the plan's, the run halts instead of writing.

### 10.2 Partial failure and resume

Each row is atomic and the archive source has no other writer, so recovery needs no guessing.

| Failure | State left | Recovery |
|---|---|---|
| Timeout or crash during the merge | Some rows of `inFlightBatch` fully written, the rest not; lease held | Lease expires after 6 min. The next `advance` reads each in-flight row's RawEvent by (archive source, fingerprint): present means done, so its item is recorded from the RawEvent's `eventId`; absent means not done. It continues with the rows not done and never re-runs the merge for a done row |
| Crash after the merge, before bookkeeping | Same | Same |
| A terminal guard fails mid-run | `HALTED`; every written row complete and recorded | Owner: resume from the admin page after fixing the cause, or undo |
| Database, GitHub or deploy not ready | Nothing written | `WAITING`; the next `advance` or the watch cron retries |
| Mac mini off | Run sits in `PLANNED` or `APPLYING` | Watch cron resumes `APPLYING`; `PLANNED` waits for the implementer or owner in Phase 2 |
| Label removed mid-run | `HALTED` at the next batch | Re-label (a new stamp on the same content, which A4 accepts), then the owner resumes; or undo |

### 10.3 Undo

Undo deletes data, so it gets a dry run with counts and the owner's OK. It runs only from
`/admin/backfills/<runId>`, under the owner's Clerk admin session with **step-up re-authentication at
the strict multi-factor level** (Clerk reverification `strict_mfa`: a passkey or TOTP code, valid for
10 minutes and only for the undo or resume it was asked for). A saved password isn't enough, so an
agent driving a signed-in browser can't pass it. The owner's account needs a second factor before
Phase 2. No token can start an undo or a resume.

**Undo plan** (read-only), from the run's items:
- **events to delete:** created by the run, carrying only the run's RawEvent, with no `Attendance`,
  no `KennelAttendance`, and no `EventHare` row linked to a user or entered by a misman;
- **events to keep, with the reason:** a user or misman attached data, or another source's RawEvent
  joined it (the history lock should prevent this). A kept event is left exactly as it is, run
  RawEvent included, and listed for the owner. The merge can't rebuild an event from its remaining
  RawEvents, so stripping only the run's RawEvent would leave the archive's values with no record of
  where they came from;
- **RawEvents to delete:** the run's, except those on kept events;
- **slots to recompute:** every (kennel, date) the run touched.

COVERED rows were never written, so undo never touches them.

**Undo apply**, after the owner confirms those counts:
- One event per transaction through the existing hard-delete helper, moved from `scripts/lib` to
  `src/lib`: `FOR UPDATE` lock, required-empty user relations, a foreign RawEvent at delete time rolls
  that event back and moves it to "kept". 30 s timeout per transaction. Batched under a lease and
  resumable, like apply.
- RawEvents are **hard-deleted**, never unlinked. An unprocessed RawEvent with no event is re-adopted
  by the merge's orphan path, which would quietly recreate the event. The items and the archive in git
  remain the audit trail.
- After the deletes: `isCanonical` is recomputed for every touched slot (the delete helper doesn't do
  it, and an event that lost the canonical pick to a run event would otherwise stay hidden);
  `Kennel.lastEventDate` and the schedule-only flags are recomputed; V3 is checked against the
  plan-time snapshot.

The run becomes `UNDONE`. Its approval is spent.

## 11. Audit trail and liveness

### 11.1 Schema (one migration, e.g. `<ts>_add_backfill_run_tables`)

**`BackfillRun`:** id; PR number; merge SHA `S`; stamped SHA `H`; manifest path; `manifestSha256`;
`archiveSha256`; `approvalHash`; `planHash`; archive and origin source ids; kennel id; status
(`PREVIEW`, `WAITING`, `BLOCKED`, `PLANNED`, `ADOPTED`, `APPLYING`, `HALTED`, `APPLIED`, `VERIFIED`,
`VERIFY_FAILED`, `UNDOING`, `UNDONE`); reason codes; CREATE and COVERED counts and batch boundaries
(JSON); the V3 snapshot hash; cursor; `inFlightBatch`; `leaseToken`, `leaseExpiresAt`; batch log
(index, rows, duration, deployed commit); verification results (JSON); who started each step
(`backfill-agent`, `backfill-watch`, or the admin's user id); timestamps. A hand-written partial
unique index on `manifestSha256` for every status except `PREVIEW`.

**`BackfillRunItem`:** run id; row index; outcome (`CREATED`, `COVERED`, `ADOPTED`); fingerprint;
`rawEventId`; `eventId`; batch index; `undoneAt`, `undoOutcome` (deleted, or kept with reason).
Unique on (run id, row index).

**`CronHeartbeat`:** one row per job name with last start, last finish, last result.

**`Source.archiveOnly`:** boolean, default false (6.5).

`RawEvent` and `Event` gain no column.

### 11.2 Ops digest

`buildOpsDigest` gains a `backfills` block: runs from the last 7 days with status and counts; runs in
`BLOCKED`, `HALTED`, `VERIFY_FAILED`, or `WAITING` for over 24 hours; leases expired over an hour;
approved manifests merged over 48 hours ago without a `VERIFIED` run; PII leak flags; `historyLocked`
row counts from the last day's scrapes; and the watch cron's heartbeat.
`docs/ops/daily-digest-task.md` puts every blocked, halted or failed run, every leak flag and every
approved-but-unapplied manifest under **Needs you today**.

### 11.3 Liveness

The watch cron raises a Sentry error when a run has been `APPLYING` with an expired lease for over 2
hours; a run has been `HALTED` or `VERIFY_FAILED` for over 24 hours; an approved manifest has no
`VERIFIED` run 48 hours after merge; or a 7-day re-check fails. The digest flags the watch cron itself
when its heartbeat is over 26 hours old. Silence counts as failure.

## 12. What changes in existing code and manuals

### 12.1 Code (Phase 0)

| Area | Change |
|---|---|
| `src/pipeline/merge.ts` | Extract the read-only matcher from `upsertCanonicalEvent`; add `backfill` mode (any match throws, atomic per-row create, no cluster linker, reject series, multi-tag and link rows); add the history lock for all sources. Default behaviour unchanged except the lock, which applies only to `archiveOnly` sources. New tests for every match path in both modes |
| `src/lib/event-write.ts` | Optional nested RawEvent in `createEventWithKennel` |
| `src/pipeline/scrape.ts` | Refuse to scrape, or force-scrape, an `archiveOnly` source; count `historyLocked` rows |
| `src/app/kennels/[slug]/page.tsx` | Move the event query, filters and unique-date count into a shared function |
| `scripts/lib/delete-leaked-event.ts` | Move to `src/lib`; add canonical recompute for touched slots |
| `prisma/schema.prisma` | `Source.archiveOnly`, `BackfillRun`, `BackfillRunItem`, `CronHeartbeat` |
| New | `src/lib/backfill/**` (manifest, PII scanner, plan, apply, verify, undo); agent routes; admin page with Clerk `strict_mfa` reverification; watch cron; `approval-stamp.yml`; `backfill-manifest` CI job |
| Ops (owner) | Repository default workflow token set to read-only; `GITHUB_APPROVAL_READ_TOKEN` created; H3 (issue-filing GitHub App) before Phase 2; a second factor on the owner's Clerk account |

### 12.2 Manuals

**Implementer** (`implement-handoff-prompt.md`):
- Build: the onboarding migration also creates the disabled archive source, linked to the kennel only,
  and contains nothing but G17-shaped inserts. Freeze the archive up to `frozenAt` (no cut-off; the
  plan skips what the live feed already covers). Run the PII scanner and generate the manifest before
  the first commit that touches `scripts/data/`. Call `POST /preview` and put its result in the PR
  body, with a link to CI's manifest summary.
- Phase A merge step: replace the label-vs-commit-date comparison with `GET /approval/:pr`; merge only
  when it says approved.
- Phase A step 6 becomes: after the first prod scrape, `plan`; if `PLANNED`, `advance` until done;
  `verify`; check every archive (date, run) on the public page; comment on the PR. One-line report:
  `backfill: <code> VERIFIED <created> created + <covered> covered`, or the block or halt reason.
- On any PII hit after push: follow the leak response in 8.2; never push a fix-up to the same PR.
- Golden rule 2 gains one exception: calling the backfill agent API for a PR the owner approved.

**Research** (`daily-onboarding-prompt.md`): a history handoff names its origin source and says
whether the archive fits the Phase 2 scope (single-kennel origin, origin URLs, strict run numbers)
or needs a supervised apply.

**Digest** (`docs/ops/daily-digest-task.md`): the `backfills` block, leak flags, `historyLocked`
counts and the watch cron.

The hand-run `scripts/backfill-<code>-history.ts` loaders stay as the supervised path for everything
outside Phase 2 scope. They should later call the same library with a local run record so hand runs
can also be undone; until then, `adopt-only` manifests bring them into the record.

## 13. Rollout

| Phase | What runs | Entry | Exit |
|---|---|---|---|
| 0. Build | Section 12.1. `BACKFILL_AUTOMATION=off` | This design approved | Unit tests for every guard and every merge match path in both modes; plan, apply, crash-resume, history lock and undo tested end to end against a local copy of prod |
| 1. Shadow | `BACKFILL_AUTOMATION=shadow`. The implementer runs `plan` and posts it; the owner still applies by hand and compares. The approval endpoint runs beside the implementer's old merge check and any disagreement is reported | Phase 0 merged | `adopt-only` manifests for Music City and Zagreb come out `ADOPTED`; 5 new backfills where the shadow plan's CREATE count equals what the hand apply created, every block was correct, and no PII false positive went unexplained; no disagreement between the approval endpoint and the owner's intent |
| 2. Apply behind the label | `BACKFILL_AUTOMATION=apply`, Phase 2 scope (section 3), 2,000-row cap, 2 applies a day, the implementer starts every apply | Phase 1 exit; H3 done; default workflow token read-only; the owner's Clerk second factor; the owner's written acceptance of T1 and of H1/H2's absence | 10 applied runs, all `VERIFIED` first time or explained, no undo needed for a wrong write, no 7-day re-check failure |
| 3. Loosen | One change at a time: multi-kennel origins **only with per-row routing provenance** (the freeze tool records which pattern matched each row, default-bucket rows are forbidden, CI re-derives the routing from the origin's config); a higher cap; the watch cron starting approved applies | Phase 2 exit **and** H1 **and** H2 | Owner's call per change |

**Never loosened:** create-only, the archive binding and history lock for automated applies, the PII
guard, owner-only resume and undo with a second factor, and the owner's stamped label as the approval.

## 14. Failure modes considered

| Failure | What stops it |
|---|---|
| Agent rewrites the PR body after approval | The owner reads CI's summary; the server reads committed files only |
| Any PR change after the label: archive, migration, seed data (push, force-push, web-editor merge) | A4 compares merged content with stamped content, file by file |
| Agent adds `owner-approved` itself, or pushes its own status-writing workflow with the owner PAT | T1. A3 rejects stamps not from `approval-stamp.yml` on `main` via `pull_request_target`; the label itself is a prompt rule. Owner accepts for Phase 2; H1 before Phase 3 |
| PR edits the stamp workflow, guard code or the CI summary script | `pull_request_target` runs `main`'s workflow; G15 refuses the PR |
| PR's migration deletes or changes existing events | G17 allows only inserts of reference rows; A4 binds the migration to the stamp |
| Several manifests, or a regenerated one, in one PR | CI and A5: exactly one new manifest and archive per PR |
| Fork PR or collaborator | Must be merged into `main` and labelled by `OWNER_GITHUB_LOGIN` |
| Stolen `BACKFILL_AGENT_TOKEN` | Plans or advances only approved runs, which would run anyway; no approve, resume, undo or user data |
| Stolen server GitHub credential | After H3: the read-only token can't label; the issues App's labels fail A2. Before H3 it is the owner's PAT, which is why H3 is a Phase 2 entry condition |
| Stolen owner PAT or `DATABASE_URL` from the Mac | Owner-level compromise, outside what this design can contain (4.1); H2 |
| Same manifest replayed, re-planned after a block, or after undo | Partial unique index covers every non-preview status; a retry needs a new file, label and stamp |
| Row moves or merges into an existing event | In-merge "any match throws"; G10 at plan; G9 overlap rules; G7 run numbers |
| Live scrape reaches back over archive dates (`days` up to 1,825) | History lock: the event can't be changed or moved, and no live RawEvent is linked to it |
| Co-hosted existing event on an archive date | G9 checks `EventKennel` membership |
| Rows really from an aggregator, labelled as the kennel's own feed | G5 requires every row's `sourceUrl` on the origin's URL; strict run numbers with capped exceptions (G7); G6 sibling mentions; Phase 2 single-kennel origins only |
| Phone number or email in the archive | Scanner before commit, CI, plan, every batch; leak response if after push |
| Private event dates in public text | Responses and PR text carry counts only about existing events |
| Forced re-scrape deletes the run's RawEvents | Archive source can't be scraped or force-scraped |
| Reconcile cancels backfilled runs | Disabled archive source shields them, and the history lock keeps other sources' RawEvents off them; 7-day re-check |
| Crash mid-batch | Atomic rows; resume by fingerprint on an exclusive source; the merge never re-runs a done row |
| Same-date group split across batches | Never split; G10 predicts the group; G14 requires one event per row |
| Long transaction timeout (P2028) | No transaction spans more than one row's create or 200 bookkeeping inserts |
| Deploy changes fingerprints mid-run | Items keyed by row index; fingerprint mismatch on resume halts |
| Onboarding migration not yet live | A1 retryable until the deploy contains `S`; G12 finds no archive source otherwise |
| Actions slow to stamp | Missing stamp is retryable |
| Undo deletes something a user added | Required-empty relations, row locks, foreign RawEvent check, keep-and-report |
| Undo leaves a hidden event or an orphan | Canonical recompute per slot; RawEvents hard-deleted |
| Undo or resume triggered through a signed-in browser | Clerk `strict_mfa` step-up; a saved password isn't enough |
| "Created" doesn't match the page | Row checks V1–V4; totals informational (9.3, 9.4) |
| The loop dies quietly | Watch cron, `CronHeartbeat`, Sentry, digest |
| Geocoding cost and latency | Batch timing measured per batch; 2,000-row cap; same geocoding as today's hand applies |

## 15. Decisions for the owner

These are this draft's defaults. Overrule any of them.

| # | Default |
|---|---|
| 1 | Automated applies bind to a dedicated archive source, with the history lock; live-source binding stays manual |
| 2 | Phase 2 accepts single-kennel origins whose rows carry the origin's URL; multi-kennel needs per-row routing provenance and H1/H2 |
| 3 | Rows the live feed already has (same date, same run number) are skipped as covered; any other overlap blocks |
| 4 | The implementer's code-merge check moves to the same approval stamp |
| 5 | A new `BACKFILL_AGENT_TOKEN`; a read-only `GITHUB_APPROVAL_READ_TOKEN`; issue filing moves to a GitHub App (H3) before Phase 2 |
| 6 | Resume and undo only from the admin page with a passkey or TOTP step-up |
| 7 | Phase 2 cap: 2,000 rows a run, 2 applies a day |
| 8 | Phase 2 needs your written acceptance of T1 and of H1/H2's absence; Phase 3 needs H1 and H2 |
| 9 | Onboarding PRs whose migrations do more than insert reference rows, or that touch guard code, get hand-applied backfills |

## Appendix A. Adversarial review record

The gate: an adversarial review must approve this design before anything is built.

**Reviewer.** `/codex:adversarial-review` was tried first (2026-11-12). Codex refused to start: the
ChatGPT account it runs under doesn't support the configured `gpt-5.5`, nor `gpt-5.4` passed with
`--model`. The review was therefore done by an independent Claude subagent with no part in writing
the design. It read the design and the code it depends on, and was told to attack data-loss paths,
approval bypass, replay, token theft, PII leaks, misrouting, races with scrapes and reconcile,
partial writes, undo and verification, and to verify every claim the design makes about existing
code. It could only read; it made no edits and no prod queries. Every finding's code claims were
re-checked against the repo before being accepted; all held.

### Round 1 (design v1) — `NEEDS-CHANGES`: 2 blocking, 7 material, 2 minor

| # | Severity | Finding | Resolution in v2 |
|---|---|---|---|
| R1-1 | blocking | v1 checked "create only" after the write. The merge's ±30-day date-correction path (`merge.ts` ~1726) can **move** an existing event that has the same `sourceUrl` and run number, and archive rows carry the live URL. G7 looked only at the exact (kennel, date) and only at the primary kennel | Create-only enforced inside the merge before any write; plan runs the matcher read-only and requires CREATE for every row; overlap check covers co-hosts; run numbers may not repeat existing ones |
| R1-2 | blocking | Crash recovery and undo assumed fingerprint dedup. In fact `processed`/`eventId` are written only by the post-loop flush, so after a crash the orphan path re-processes rows; a re-run could fold #2060 into #2059 and still pass as `JOINED_RUN_EVENT`; undo could leave sourceless events | Each row is one atomic nested create (RawEvent + Event + kennel link); recovery reads done rows from the exclusive archive source and never re-runs the merge for them; `JOINED_RUN_EVENT` removed, every row must create its own event |
| R1-3 | material | `scrapeSource(force)` hard-deletes every RawEvent of a source; with a live-source binding that wipes provenance and reconcile shielding | Automated applies bind only to a disabled `archiveOnly` source that `scrapeSource` refuses to scrape |
| R1-4 | material | v1's A3 used the earliest check suite for the head SHA, which a force-push back to a pre-label commit passes; the update-branch exception checked a merge's shape, not its content | `approval-stamp` workflow on `pull_request_target` stamps the head at label time; the server compares merged and stamped content |
| R1-5 | material | Count-based verification can pass while rows are wrong, fails falsely as live data changes, can't see modified existing events; undo didn't recompute `isCanonical` | Row checks V1–V4 with a pre-existing snapshot; totals informational only; undo recomputes canonical per slot; the Zagreb case re-verified row by row |
| R1-6 | material | Exact kennel codes just move the OH3 misroute to freeze time; nothing re-checks routing | Phase 2 requires a single-kennel origin; sibling-mention guard covers hares and location; run-number sequence guard; multi-kennel only with per-row routing provenance in Phase 3 |
| R1-7 | material | The actor boundaries were prompt rules: every task reads the shared `.env` and the owner's `gh` credential; the server's `GITHUB_TOKEN` is the owner's PAT; agents may drive a signed-in browser | Trust model rewritten to say what is and isn't enforced; read-only server token; stamps must come from `github-actions[bot]`; step-up for resume and undo; H2 added |
| R1-8 | material | A PR could carry several manifests or regenerate one; the owner saw counts only through the agent-written PR body | Exactly one new manifest and archive per PR; CI renders the manifest into its check summary |
| R1-9 | material | A PII hit in CI is already public; private manual-entry dates could leak through block reasons; addresses and names were unaddressed | Leak response defined; counts only about existing events; addresses and names stated as accepted risk |
| R1-10 | minor | `BLOCKED` excluded from the unique index allowed replays; `advance` couldn't resume `HALTED`; the Phase 1 exit couldn't pass because the two existing archives have no manifests | Terminal vs retryable split, index covers every non-preview status; resume is admin-only; `adopt-only` manifests |
| R1-11 | minor | False claims: the cluster linker only reads events from yesterday on; #2059/#2060 stay apart because of the run-number veto (#2656), not the missing start time | Corrected; backfill mode skips the cluster linker |

### Round 2 (design v2) — `NEEDS-CHANGES`: 4 material, 3 minor

Status of round 1: R1-1, R1-2, R1-3, R1-5, R1-8, R1-9 and R1-11 closed; R1-4 closed for honest
mistakes but not for forgery or files other than the archive; R1-6 not closed; R1-7 and R1-10 partly
closed.

| # | Severity | Finding | Resolution in v3 |
|---|---|---|---|
| R2-1 | material | v2 claimed live feeds can't reach archive dates. They can: `days` up to 1,825 on the scrape route and alert re-scrapes, raised `scrapeDays`, and G9 was empty when the first scrape returned nothing. An equal-trust live row would then overwrite archive fields or move dates back (Zagreb #2501), restore the redacted #1797 hare, and break the reconcile shield | History lock in the merge for all sources: a row from another source that matches an archive-backed event is recorded but never changes, moves or links to it; the date-correction query skips archive-backed events (6.5). G9 no longer relies on "precedes live coverage": overlap is COVERED (same date, same run number, live-backed) or blocks (8.1) |
| R2-2 | material | The stamp bound only the archive and manifest, but the backfill depends on the whole PR (migration, seed, links), and code merges still used commit dates | A4 compares every PR file: added files by blob SHA, modified files by their added and removed lines. G17 limits migrations to reference-row inserts. The implementer's merge step uses the same approval check (6.4) |
| R2-3 | material | Section 14 overclaimed: with the owner PAT an agent can push a workflow that writes a status as `github-actions[bot]`; the server's `GITHUB_TOKEN` is the owner's PAT; a password-only step-up can be passed by an agent with a saved password | A3 verifies the stamp's Actions run (workflow path, `pull_request_target`, `main`); default workflow token read-only; T1 restated to include stamp forgery; H3 (server off the owner's identity) is a Phase 2 entry; step-up requires `strict_mfa`; wording now "through the app" (4.2) |
| R2-4 | material | The single-kennel origin was only the agent's claim; `runNumberExceptions` had no limit | Every row's `sourceUrl` must be on the origin's URL; run numbers strictly increase with at most 5 rows and 1% exceptions; at most 5% unnumbered (section 3, G5, G7) |
| R2-5 | minor | v2 threw only on matches to events the run didn't create, so a later archive row could date-correct the run's own earlier event | Any match throws in backfill mode, and strict run numbers make archive-internal date correction impossible (9.1, G10) |
| R2-6 | minor | Terminal blocks were a dead end: a missing stamp or GitHub error was terminal, G2 compared display samples, and CI forbade changing the archive | Missing stamp and GitHub errors are `WAITING`; G2 compares `approvalHash` fields only; re-submission under a new archive name is defined (6.7) |
| R2-7 | minor | MCH3 fails "run numbers present" (16 of 320 rows), so its adoption failed CI; adoption by fingerprint breaks when clean-up rules change (#2935); G15 missed `reconcile.ts`, the shared page function, the CI script, the schema; V3 omitted hares and location and would halt on ordinary live edits; V4 wasn't checked per batch | Scope rules apply only to `archive-source` manifests; adoption matches on (kennel, date, run number); G15 extended; V3 covers hares and location but only events no enabled source backs; V3 and V4 run per batch in G14 (9.3); `recomputeCanonical` after the create documented (9.1) |
