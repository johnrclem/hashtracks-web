# Onboarding backfill automation: design

**Status:** v5.2. Approved by adversarial review in round 5 (Appendix A); round 5's minor findings applied in v5.1. v5.2 aligns the design with the kennel status work (Status 1, #2923): the calendar series marker, the evidence refresh and the never-enabled archive source. Its review took rounds 7–9, and round 9 approved it. Pending owner review. Nothing is built yet. 2026-11-13.
**Scope:** design only. Nothing here is built yet. No code, migration or prod write was made to produce it.
**Related:** [`kennel-onboarding/implement-handoff-prompt.md`](kennel-onboarding/implement-handoff-prompt.md) (the implementer),
[`kennel-onboarding/daily-onboarding-prompt.md`](kennel-onboarding/daily-onboarding-prompt.md) (research),
[`self-healing-v2-plan.md`](self-healing-v2-plan.md) (same shape: scheduled task + owner gate + server endpoints),
[`ops/audit-fixer-task.md`](ops/audit-fixer-task.md), [`ops/daily-digest-task.md`](ops/daily-digest-task.md),
[`../.claude/rules/prod-data-ops.md`](../.claude/rules/prod-data-ops.md),
[`superpowers/specs/2026-11-10-kennel-status-design.md`](superpowers/specs/2026-11-10-kennel-status-design.md) (kennel status; section 9.6 here).

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
page shows what it wrote.

Seven decisions carry most of the safety:

1. **Approval is bound to the PR's content at label time.** When the owner adds the label, a workflow
   on `main` stamps the PR's head commit. The server applies only if the head that merged is the
   stamped one, or differs from it only by merges of `main`. The implementer merges with
   `--match-head-commit`, using the same check.
2. **The live feed owns its stretch; the archive owns everything before it.** The split point is the
   earliest past run the kennel's live feed has in prod. Archive rows from that date on are left to
   the live feed, which must actually have them; rows before it are written by the backfill, and
   nothing may already exist on their dates. A gap between the two stretches blocks the run.
3. **The archive gets its own source and a cutoff.** Rows bind to a disabled archive source that is
   never scraped, as six existing archive sources do. When the apply starts, the kennel gets an
   archive cutoff, and from then on the merge drops any other source's row for that kennel dated
   before it, before writing anything. Wide re-scrapes therefore can't duplicate, move, overwrite or
   resurrect curated history.
4. **The backfill only creates, and the merge enforces it before writing.** In backfill mode any match
   onto an existing event throws before any write for that row.
5. **Each row is written atomically.** The RawEvent, the Event and its kennel link are one nested
   create, so a crash leaves each row fully written or not at all.
6. **The server decides, the agent only nudges.** The scheduled task can ask the server to plan or take
   the next step of an approved run. Resume and undo need the owner with a second factor.
7. **Verification checks rows, not totals.** Every written archive (date, run number) must appear on
   the public kennel page. The Zagreb "716 created, 715 shown" case is the page counting unique dates;
   all 716 runs are there (section 9.4).

Phase 2 scope is deliberately narrow: one kennel with one live feed, rows provably from that feed,
run numbers strictly increasing, at most 2,000 rows. Rollout is shadow first, then apply behind the
label, then loosening only on evidence and only after agents and the server stop holding the owner's
GitHub identity.

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
| Dropping a source's rows before they're stored | the per-source `silentlySkipPatterns` filter |
| Event + primary kennel link in one nested create | `createEventWithKennel` in `src/lib/event-write.ts` |
| Race-safe event delete that refuses user data | `scripts/lib/delete-leaked-event.ts` (`RequireZeroCount`, `FOR UPDATE`, `ForeignRawSourceError`) |
| Read-only ops snapshot for the digest | `GET /api/audit/agent/ops-digest`, `buildOpsDigest` |
| Kennel status evidence: `Event.isScheduleOnly` and the kennel's cached evidence dates (`lastRunSeenAt`, `nextRunPostedAt`, `lastConfirmedAt`, `stoppedAt`) | `refreshScheduleOnlyFlags` and `refreshKennelEvidence` in `src/pipeline/kennel-evidence.ts`, run by `scrapeSource` after every scrape and by the daily audit cron |

## 3. Goals and non-goals

**Goals**
- From the owner's `owner-approved` label to a verified backfill with no human step, for the Phase 2
  scope below.
- Every write is preceded by a dry run whose counts the owner approved, and any drift blocks it.
- Every applied run can be undone exactly.
- The owner learns of every apply, block and failure from the PR and the daily digest, without
  reading logs.

**Phase 2 scope (what automation accepts at first)**
- One kennel per archive. In prod, that kennel is linked to exactly one enabled source, the **origin**:
  the live feed the archive was frozen from. The origin is linked to that kennel only and has no
  `kennelPatterns` or `defaultKennelTag` routing to anyone else.
- The origin's type has a defined row-provenance rule (G5), so each row provably came from it:

  | Origin type | Rule for each row's `sourceUrl` |
  |---|---|
  | `GOOGLE_SHEETS` | Equals the origin's sheet URL (same sheet id) |
  | `GOOGLE_CALENDAR` | An event link whose `eid`, base64-decoded, names the origin's calendar id (Google's short domain forms `@g`, `@m`, `@v`, `@i` expanded) |
  | `MEETUP` | Path starts with the origin's group, `/<groupUrlname>/events/` |
  | `HTML_SCRAPER` | Same host as the origin's URL, path under the origin's path, and the origin's query parameters present with the same values. Only if no source linked to another kennel uses that host; a shared host (for example `sfh3.com`, which serves 13 kennels) is supervised |

  Other types (Facebook, Harrier Central, Hash Rego, iCal) are supervised until a rule is defined
  and tested for them.
- One kennel tag per row, no `seriesId`, no `externalLinks`.
- Run numbers **strictly increase** in (date, run) order, with at most 5 rows and at most 1% of rows
  listed as exceptions. At most 5% of rows may lack a run number.
- Bound to a dedicated archive source (section 6.5). The PR's migrations pass G17.
- At most 2,000 rows.

Zagreb H4 (716 rows, all numbered, one sheet URL) fits. Music City H3 (320 rows, 16 unnumbered, which is
exactly 5%, all on `musiccityhash.com`) fits at the limit. Both are already applied by hand and enter
the record through adoption (section 6.6), which writes nothing and doesn't need the Phase 2 scope.

**Non-goals**
- Enriching or correcting existing events from an archive. An archive row on a date that already has
  an event blocks the run.
- Hardening the live feed's own stretch. Rows from the split date on are the live feed's, with the same
  exposure every kennel's recent history has today (forced re-scrapes, reconcile).
- Multi-kennel archives, multi-kennel feeds and kennels with several live sources, until per-row
  routing provenance exists (section 13, Phase 3). This is the OH3 class.
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
| Scheduled agents | Open PRs, merge approved PRs, call the backfill agent API. Halt a run by removing the label (T1) | Resume, undo or clear a cutoff (step-up needs a passkey or TOTP code). Outside the app they hold owner-level secrets (4.1) |
| `BACKFILL_AGENT_TOKEN` | Plan, preview, advance a run the owner approved, check a PR's approval, read status | Approve, choose an archive, resume, undo, read user data |
| `GITHUB_APPROVAL_READ_TOKEN` (server, new, fine-grained, read-only) | Read PRs, labels, statuses, commits and file contents | Add labels or statuses, merge, push |
| The server's issue-filing credential | Today: the owner's repo-scope PAT, which can label, push and merge as the owner. **H3 replaces it** with a GitHub App limited to issues, whose actions show as the App, so A2 rejects any label it adds | |
| `approval-stamp` workflow (`pull_request_target` on `main`) | Record the head SHA when `owner-approved` is added | Run PR code (it never checks it out) |
| CI | Recompute and check manifests and migrations; render the manifest in its check summary | Write anything outside GitHub |
| Anyone on the internet | Open a PR from a fork; read the public repo and pages | Get a PR merged or labelled |

### 4.3 Assumptions and hardening

- **T1. Anything acting as the owner's GitHub account can approve.** Agents run `gh` as the owner. An
  agent could add the label itself, and the stamp workflow would record it. It could also forge a
  stamp: any workflow on a branch it pushes can ask for `statuses: write` and write a status as
  `github-actions[bot]`, with any `target_url` it likes. The stamp protects against **mistakes**
  (a push or force-push after the label, a stale branch), not against an agent misusing the owner's
  credential. That is the same assumption that already guards every code merge. Phase 2 needs the
  owner's written acceptance of T1; Phase 3 needs H1.
- **T2. GitHub's records are honest; git's are not.** Label events, statuses and merge records come
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
 write manifest (hashes, counts)      scope rules, PII,         samples, preview plan
 migration adds archive source        migration shape;          adds `owner-approved`
 POST /preview → plan in PR body      summary in check run          │
                                                          approval-stamp workflow records
                                                          the head SHA at that moment
   implementer Phase A: approval check; merge with --match-head-commit; deploy; first prod scrape
                                                │
 app server (prod) ─────────────────────────────▼──────────────────────────────────────
 POST /plan     approval: stamp + merged head; recompute manifest; split at the live feed's
                earliest run; every guard; matcher says CREATE → PLANNED, WAITING or BLOCKED
 POST /advance  set the kennel's archive cutoff (first batch); re-check approval + guards;
                merge one batch in backfill mode (any match throws, one atomic write per row);
                record items; slot + snapshot checks → APPLYING … APPLIED / HALTED
 POST /verify   every written row visible on the page; nothing pre-existing changed
                → VERIFIED / VERIFY_FAILED
 daily cron     resume expired leases, retry WAITING, plan unplanned approvals, 7-day re-verify,
                liveness errors
 admin UI       owner + second factor: resume, halt, undo (with its own dry run)
 every scrape   archive cutoff: other sources' rows for the kennel before the cutoff are dropped
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
| `runNumberExceptions` | Rows that break the strict run-number order (capped) |
| `scheduleOnlyEstimate` | Informational, not part of `approvalHash`: about how many rows the kennel status rules will count as a usual schedule rather than a run, namely rows with a `recurringSeriesId`, no run number and no hares. CI computes it from the raw rows for the owner to read. The authoritative set is computed at plan from the rows as the merge will store them (9.2) |
| `expectedGaps` | Declared by the curator: date ranges with no runs and a reason (seasonal break, pause), excluded from G20's gap rule. Each contains no archive row and is at most 120 days |
| `curatedCorrections` | Declared by the curator: rows whose date or run number was changed from the source, excluded from G20's 95% count. At most 20 rows or 2% of rows, whichever is larger (Zagreb has about 12) |
| `piiScan` | Scanner version and residual count (must be 0) |
| `approvalHash` | SHA-256 over the canonical JSON of every field above except the sample titles, which depend on display names, and `scheduleOnlyEstimate`, which depends on placeholder rules that change between CI and plan |

### 6.2 CI makes the manifest honest and shows it to the owner

A required CI job, `backfill-manifest`, runs on every PR that touches `scripts/data/*-history*` or
`prisma/migrations/`. Its script lives under a guard path (G15), so a PR can't change the numbers it
shows.

**Every manifest:**
- The manifest recomputed from the archive equals the committed one in every `approvalHash` field
  that can be derived from the archive. The two declared fields, `expectedGaps` and
  `curatedCorrections`, can't be recomputed; CI checks their shape and caps instead (every row index
  exists, every gap lies inside the archive's span and contains no row) and includes them in the hash.
- Every row has a `YYYY-MM-DD` date before `frozenAt` in `kennelTimezone`, and one kennel tag in
  `expectedKennelCodes`.
- PII residual is 0 (8.2).
- The per-kennel table, samples, same-date groups, run-number exceptions and approval hash go into the
  job's **check-run summary**. The owner reads the numbers there, derived by CI from the committed
  file, not from a PR body the agent wrote.

**`archive-source` manifests also need:**
- The PR adds **exactly one** archive and **one** manifest, both new files, and changes nothing else
  under `scripts/data/*-history*`.
- The Phase 2 scope rules in section 3, checked against the seed data: single-kennel origin of a
  supported type, the row-provenance rule for that type, no `seriesId` or `externalLinks`, strict
  run-number order with the caps.
- The archive source in the seed data is disabled, `archiveOnly`, linked to the kennel only, and the
  migration's insert of it sets `enabled` to the literal `false` (G17).
- Every migration the PR adds passes G17.
- For a `GOOGLE_CALENDAR` origin, every row carries the `recurringSeriesId` key, either as the series
  id or as an explicit `null` (G21). The summary shows `scheduleOnlyEstimate` and how many rows have an
  `eid` naming a repeating instance but a `null` marker. The adapter drops the marker on orphan
  overrides, so that count is for the owner to read, not a failure.

**`adopt-only` manifests** need only the checks for every manifest, plus: the PR adds just the
manifest, for an existing archive it doesn't change.

CI has no prod access, so the checks that need prod (the kennel's sources in prod, earlier runs for the
kennel, overlap) happen on the server (G9, G18, G19).

### 6.3 Stamping the approval

A workflow on `main`, `approval-stamp.yml`, runs on `pull_request_target` with `types: [labeled]`.
When the label is `owner-approved`, it sets a commit status `backfill/approved` on
`github.event.pull_request.head.sha` (the head GitHub reports at that moment), with the PR number in
its description. It never checks out or runs PR code. `pull_request_target` always runs the workflow
file from `main`, so a PR can't change what this workflow does.

This makes the stamp reliable against mistakes. It does not make it unforgeable: as T1 says, a
workflow on any branch pushed with the owner's credential can also write such a status.

### 6.4 What the server checks before it treats a PR as approved

At plan time and before every batch, using `GITHUB_APPROVAL_READ_TOKEN`:

| # | Check | Why |
|---|---|---|
| A1 | The PR is merged into `main`; its merge commit `S` is an ancestor of the deployed commit (`VERCEL_GIT_COMMIT_SHA`) | The onboarding migration is live, and the code judging the archive includes the PR |
| A2 | The PR carries `owner-approved` now, and the newest `labeled owner-approved` event was made by `OWNER_GITHUB_LOGIN` | Removing the label stops the run at the next batch. After H3 no server credential can make this event |
| A3 | A `backfill/approved` status created by `github-actions[bot]` exists on a SHA `H`, names this PR, and was created after that label event | The label was added while `H` was the head |
| A4 | **The merged head is the stamped head, up to merges of `main`.** GitHub's record of the PR's head at merge is `M`. Either `M = H`, or every commit after `H` up to `M` is a merge of `main` and the PR's own change is identical at `H` and `M`: the same set of paths with the same statuses (added, modified, removed, renamed); for each path, either the same blob at both, or the same ordered sequence of added and removed lines across the whole file (not per hunk, since a change on `main` nearby can merge or split hunks). A binary file, or a file whose patch GitHub omits, must have the same blob | Covers every file the backfill depends on (the migration, seed data, archive, manifest) and catches a force-push, a post-label commit or a web-editor conflict fix that changes the PR's own lines. A merge of `main` alone passes |
| A5 | The manifest is the PR's only manifest, and no other non-preview run exists for its `manifestSha256` | One approval, one apply |
| A6 | The PR changes no guard path (G15), and its migrations pass G17 | The PR can't edit the checks that judge it, or change existing data to make a guard pass |

A missing stamp, or a GitHub API error, is **retryable** (`WAITING`): Actions may simply be slow. A
stamp that fails A3 or A4 is terminal.

The manifest and archive are fetched with GitHub's contents API at `S`, for this repository only, with
the path matching `^scripts/data/[a-z0-9-]+-history[a-z0-9-]*\.(manifest\.)?json$` and a 10 MB cap.
The server never fetches a URL supplied by a caller.

**The code merge uses the same check.** The implementer's Phase A merge step today compares the label
time with the head commit's date, which T2 says to distrust. It changes to calling
`GET /api/agent/backfill/approval/:pr` (read-only), which runs A2–A4 against the PR's current head and
returns the head SHA it approved. The implementer then merges with
`gh pr merge --squash --match-head-commit <that SHA>`, so GitHub refuses the merge if the head moved
in between. This is still the agent following its manual, but it is the same check the server applies
after the merge.

### 6.5 The archive source and the archive cutoff

**The split point.** At plan time the server finds `C`, the earliest date before today of any event of
the kennel backed by the origin (the kennel's only enabled source, G18). `C` is therefore always in
the past. If the origin backs no past event yet (an "upcoming runs only" feed right after its first
scrape, or a first scrape that returned nothing), the run is `WAITING` until it does; the server never
falls back to today. Archive rows dated **from `C` on** belong to the live feed and are not written.
Rows dated **before `C`** are the backfill's to write, and their dates must have no existing event of
any kind (G9).

**The two stretches must actually join** (G20). A wrong `C` would otherwise quietly drop history: a
stray early origin event (a year-inference phantom, a typo'd old row) would hand most of the archive
to a live feed that doesn't have it. So:
- **No gap.** If the archive ends before `C`, the distance from its last row to `C` must be at most 1.5
  times the archive's median interval between run dates over its last 20 rows, not counting any gap
  the manifest declares in `expectedGaps` (a date range and a reason, such as a seasonal break). CI
  shows declared gaps in its summary, so the owner's label covers them. An "upcoming runs only" feed
  starts at the first run it listed, so an archive frozen long before the merge fails this and must be
  re-frozen (and re-labelled).
- **The live feed really has its stretch.** For the numbered archive rows dated from `C` to
  `frozenAt`, the kennel's displayed events must contain at least 95% of them by (date, run number).
  Rows the manifest lists in `curatedCorrections` (rows whose date or run number the curator changed
  from the source) and unnumbered rows are left out of both sides of that count, since a date alone
  could match an unrelated event. At least 10 rows, or half of the stretch's rows, must remain to be
  counted, so the exclusions can't empty the check. Otherwise the run is `BLOCKED`, with the counts.

V2 applies the same 95% threshold at verify.

**The archive source.** The backfill's rows bind to a dedicated source, like the six archive sources
already seeded: `enabled: false`, a new `Source.archiveOnly = true` column, `config.upcomingOnly: true`
as a backstop, `replacedById` null, linked to the one kennel, `trustLevel` no higher than the origin's.
The onboarding migration creates it next to the live source. `scrapeSource` refuses to scrape or
force-scrape it, and `deleteSource` refuses to delete it (both would hard-delete its RawEvents).
It is never enabled. A database CHECK, `NOT ("archiveOnly" AND enabled)`, enforces this against every
writer: admin actions, the seed and migrations alike. `toggleSourceEnabled` refuses it with a clear
message, and `updateSource` refuses an actual change to an `archiveOnly` source's name, type or kennel links. The admin form always resubmits the links, so it compares them with the existing set rather than refusing every save; G12 binds the source by name, so a rename is refused too. If
it were enabled, the dispatcher would send it to `scrapeSource` every day only to be refused. The
kennel page's coverage line (kennel status, Status 1 Task 9) counts enabled sources other than
STATIC_SCHEDULE that produced a real run in the last 180 days, so it would also name the archive as the
kennel's live feed. With the CHECK, both of them can rely on `enabled` alone. The source's type matters
too: the status rules count a RawEvent from any type except STATIC_SCHEDULE, so G12 pins the archive
source's type to the origin's.

Each archive RawEvent stores the row as the merge leaves it after its pre-write clean-up
(`sanitizeRawFields`: entities decoded, `<br>` replaced, "Hared by X" moved from the title to `hares`),
`recurringSeriesId` included. The kennel status rules therefore judge archive rows exactly as they judge
live ones (9.6).

**The archive cutoff.** The first `advance` call sets `Kennel.archiveCutoffDate = C` (and
`archiveCutoffRunId`) and writes nothing else (9.2). From then on, the merge drops, before creating a
RawEvent, any row from a source other than the kennel's archive source whose resolved kennel has a
cutoff and whose date is before it. Because `C` is always in the past, the drop never touches today's
or upcoming runs. Co-host rows don't add the kennel as a secondary on such dates either. The merge
result and the scrape log count these rows as `archiveCutoffDropped`. Separately, the ±30-day
date-correction query, for every source, skips events whose only backing is an `archiveOnly` source,
so a live row dated after `C` can't move an archive event either. A live row with the same run number
as an archive event within 30 days of it would otherwise become a second event with that run number.
So, at the top of the loop next to the cutoff drop and before any RawEvent is stored, such a row is
dropped and counted as `archiveCorrectionSkipped` (a per-batch prefetch of the kennel's archive-only
events keeps this to one query). Nothing is stored, so no tombstone is left: after an undo the row
simply creates its event.
The digest shows that count, because it means the live feed and the archive disagree about a run's
date.

| Risk | How the cutoff and the archive source remove it |
|---|---|
| A wide re-scrape (`days` up to 1,825) reaches archive dates and overwrites a curated event, or moves it with the ±30-day date-correction path | The row is dropped before the matcher sees it |
| The re-scrape brings back a row the curator removed (Music City's non-trail rows, cancelled runs, "Hare Needed" slots), or puts a curated date back (Zagreb #2501 on the sheet's 2025-11-06) as a duplicate | Dropped: the date is before the cutoff |
| A redaction comes back (Zagreb #1797's hare, left out because it contains a racial slur) | Dropped |
| A dropped row leaves a tombstone that blocks it forever | No RawEvent is stored, so nothing is left behind; once the cutoff is cleared, the rows process normally |
| Reconcile cancels archive events | Their only backing is the disabled archive source, and other sources' rows never attach to them, so `protectedByOtherSources` shields them from every other source |
| A forced re-scrape or source delete wipes the backfill's RawEvents | The archive source can't be scraped or deleted |
| Proving a RawEvent is the backfill's | Nothing but backfills writes to an archive source |

The cutoff can't hide existing live data: before any row is written, the server re-checks that no event
of the kennel before `C` is backed by an enabled source (9.2), after any scrape that was running when
the cutoff was set has finished. The cost is deliberate: a source added to the kennel later can't bring
in history before `C` until the owner clears the cutoff. Clearing it re-exposes the archive to
overwrites, so it needs the same step-up and single-use nonce as undo (10.3). Undo clears it.

Adopted archives (6.6), including Music City and Zagreb, get **no** cutoff automatically: adoption
writes nothing. The Zagreb examples above (#2501, #1797) stay exposed to a wide re-scrape exactly as
today, until the owner sets a cutoff for the kennel from the admin page (same step-up).

### 6.6 Adoption of backfills applied by hand

An `adopt-only` manifest describes an archive already applied by hand. Its plan must find, for every
row, an event of the kennel on that date with that run number (or, for unnumbered rows, the only event
on that date), backed by the stated source. It then records the items and ends `ADOPTED` without
writing anything and without setting a cutoff. If any row has no such event, it is `BLOCKED`. It
matches on (kennel, date, run number), not fingerprints, because the merge's pre-fingerprint clean-up
changes over time (last on 2026-11-12, #2935) and would make old fingerprints miss. This is how the
Music City and Zagreb backfills enter the run record.

### 6.7 Drift, retries and re-submission

**No write when:** the merged content isn't the stamped content (A4); the recomputed manifest differs
from the committed one in any `approvalHash` field (G2); any row before `C` isn't a clean CREATE (G7,
G9, G10); or any other terminal guard fails. The counts the owner approved are the manifest's rows; the
plan reports how many fall before `C` (written) and from `C` on (left to the live feed), and V2 checks
the written ones.

**Retryable (`WAITING`)**, the watch cron tries again: deploy not yet containing `S`; stamp not yet
present; the origin backs no past event yet; GitHub or database unavailable; the daily apply limit
reached.

**Terminal (`BLOCKED`):** everything else. The partial unique index on `manifestSha256` covers every
status except `PREVIEW`, so a blocked manifest can't be planned again. To try again, the implementer
opens a new PR with a new archive file under a new name (`<code>-history-r2.json` and its manifest).
The server accepts it only if no earlier run for the kennel ever wrote anything (G19). It needs a new
label and stamp.

## 7. Server endpoints

### 7.1 Token

A new secret, `BACKFILL_AGENT_TOKEN` (32+ characters), checked like `AUDIT_AGENT_TOKEN` but with its
own env var, failing closed when unset or short. It is not `AUDIT_AGENT_TOKEN`, whose documented
promise is that nothing behind it edits event data.

### 7.2 Routes (`/api/agent/backfill/*`, all `maxDuration = 300`)

| Route | Effect | Writes |
|---|---|---|
| `GET /approval/:pr` | A2–A4 against the PR's current head, for the implementer's merge step; returns the approved head SHA | none |
| `POST /preview { prNumber }` | Plans an **open** PR's archive at its head against prod, for the PR body. Status `PREVIEW`, never applicable. For a new kennel the split point isn't known until the first live scrape, so the preview says so and checks everything else | Run row only |
| `POST /plan { prNumber }` | A1–A6, then every plan guard and the matcher simulation. Returns `PLANNED`, `WAITING` or `BLOCKED` | Run row only |
| `POST /runs/:id/advance` | The next step of a `PLANNED` or `APPLYING` run: set the cutoff (first call), one batch, or the final step | The cutoff; events, through the merge pipeline in backfill mode |
| `POST /runs/:id/verify` | The checks in 9.3 | Run row only |
| `GET /runs/:id` | Status, counts, reason codes, verification result | none |

`HALTED` runs resume only from `/admin/backfills`, never through the token.

**What responses and PR text may contain:** counts, kennel codes, the archive's own dates, run
numbers and sample titles (all already public in the repo), reason codes. **Never:** matched PII text,
dates or details of existing prod events (some are private manual entries), user data, secrets. Block
reasons about existing events give counts only; the dates are shown only in the admin page.

**Limits:** one `preview`/`plan` per PR per 10 minutes; one run `APPLYING` at a time across the app;
`advance` returns `409` while another caller holds the lease.

### 7.3 Who drives the steps

- **The implementer**, in Phase A after the first prod scrape: `plan`; `advance` until done (at most
  40 calls); `verify`; the public-page check; one PR comment.
- **The daily `backfill-watch` cron** (Vercel cron, `CRON_SECRET`): resumes runs whose lease expired,
  retries `WAITING` runs, plans approved manifests from the last 30 days that have no run, re-verifies
  runs from the last 7 days, and raises the liveness errors in 11.3. In Phase 2 it never starts a
  fresh apply; that is enforced in the cron's code. Starting an apply is open to any holder of the
  token; that it is the implementer, with a report beside it, is a rule in its manual.
- **The owner**, from `/admin/backfills`: the same steps, plus resume, halt, undo, and setting or
  clearing a cutoff (the last four with step-up, 10.3).

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
| G5 | **Origin and provenance:** the origin is linked to the expected kennel only, has no `kennelPatterns` or `defaultKennelTag` naming another kennel, is of a supported type, and every row's `sourceUrl` passes that type's rule (section 3), including the shared-host refusal for websites (checked against prod sources at plan) | CI, plan | terminal |
| G6 | **Sibling mention:** no row's title, hares, location or description names another kennel (code, short name or alias) in the same region | CI (seed data), plan (prod aliases) | terminal |
| G7 | **Run numbers:** strictly increasing in (date, run) order within the caps; no row before `C` has a run number any existing event of the kennel already has | CI (order), plan, every batch | terminal |
| G8 | **PII:** zero phone numbers or email addresses in every string field, URLs also checked after decoding (8.2) | before commit, CI, plan, every batch | terminal |
| G9 | **No overlap before the split point:** for every row before `C`, no existing event, in any status, canonical or not, has the kennel as primary **or** co-host (`EventKennel`) on that date | plan, every batch | terminal |
| G10 | **Matcher says CREATE:** the merge's own matcher, run read-only over the rows before `C` in apply order, with each simulated create added to its same-day pool, returns CREATE for every one: no same-day, fuzzy, cross-window or date-correction match. It also predicts that `recomputeCanonical` changes nothing for same-date groups | plan | terminal |
| G11 | **Counts:** per kennel, rows before `C` plus rows from `C` on equal the manifest's `rows`; on a fresh plan, no row's fingerprint already exists on the archive source | plan | terminal |
| G12 | **Binding:** the archive source is disabled, `archiveOnly`, `replacedById` null, and of the origin's type; exactly one source has that name | plan, every batch | terminal |
| G13 | **Size and rate:** rows ≤ `BACKFILL_MAX_ROWS` (2,000) is terminal; more than 2 applies started per UTC day is retryable | plan | terminal / retryable |
| G14 | **Batch result:** no create-only violation; `created` equals the batch's rows; `updated`, `restored`, `blocked`, `eventErrors` are 0; every created event's primary kennel is the expected one, its date is the row's date, and its `isScheduleOnly` is the plan's value; V3 and V4 (9.3) pass | every batch | terminal (`HALTED`) |
| G15 | **Guard code untouched:** the PR changes nothing under `src/lib/backfill/**`, the PII scanner, `src/pipeline/merge.ts`, `src/pipeline/kennel-resolver.ts`, `src/pipeline/fingerprint.ts`, `src/pipeline/scrape.ts`, `src/pipeline/reconcile.ts`, `src/lib/event-write.ts`, `src/app/admin/sources/actions.ts`, the shared kennel-page stats function, `prisma/schema.prisma`, the CI manifest script, `.github/workflows/**` or the agent routes | plan | terminal (the owner can still apply by hand) |
| G16 | **Kill switch:** env `BACKFILL_AUTOMATION` is `apply` (`off` and `shadow` refuse `advance`) | every call | `403` |
| G17 | **Migration shape**, checked with a real SQL parser (`libpg_query`), allow-list only: `INSERT … ON CONFLICT DO NOTHING` or `INSERT … SELECT … WHERE NOT EXISTS` into `Kennel`, `KennelAlias`, `Region`, `Source`, `SourceKennel` and `ScheduleRule`; and `UPDATE "Region"` setting only `parentId` and `updatedAt`, whose target rows are restricted by literal names that the same migration inserts. No other statements, no CTE that modifies data, no `DO` blocks, and no function calls other than `NOW()` and `timezone()` with a literal zone (the parser's form of `NOW() AT TIME ZONE 'UTC'`, used by all eight recent onboarding migrations). A Phase 0 test checks the rule against those eight; any that update a region they didn't insert are reviewed with the owner before the rule ships. Crafted bypasses must fail it. A `Source` insert that sets `archiveOnly` to true must also set `enabled` to the literal `false`: `enabled` defaults to true, so leaving it out would break the CHECK in 11.1, fail `migrate deploy` in the production build and block every later deploy. G17 only decides whether the **backfill** is automated; the migration itself still ships through the ordinary code-merge review | CI, plan | terminal |
| G18 | **One live feed:** in prod, the kennel is linked to exactly one enabled source, the origin, plus the archive source | plan, every batch | terminal |
| G19 | **One archive per kennel:** no earlier run for this kennel has written anything (status `APPLYING` or later, unless it was fully `UNDONE`), and the kennel has no cutoff yet | plan | terminal |
| G20 | **The stretches join:** `C` is in the past; no gap between the archive's last row and `C` beyond 1.5 median run intervals; the live feed shows at least 95% of the archive rows dated from `C` to `frozenAt` (6.5) | plan, before the first batch | terminal (`WAITING` while the origin backs no past event) |
| G21 | **Calendar series marker:** for a `GOOGLE_CALENDAR` origin, every row in the archive file has the `recurringSeriesId` key, as the series id or an explicit `null`. If a capture or a hand edit dropped the field, a repeating calendar entry would be stored as a run, and the nightly status refresh could never correct it. This key check reads the file as committed: in CI, and at plan step 1, before step 4 removes the `null`s. The plan also checks the overlap at step 6. Each archive row from `C` to `frozenAt` is compared with the origin's current RawEvent for the same `sourceUrl`, using the same newest-copy rule as `CURRENT_RAW_SQL`. A RawEvent stored before the adapter began emitting the marker (#2923) is skipped, because RawEvents are immutable and events that haven't been re-scraped since keep a copy without it. "Before" is a fixed constant, set once in Phase 0 from the data: the earliest `scrapedAt` of any calendar RawEvent carrying `recurringSeriesId`, plus one hour. That margin covers old function instances still finishing during the rollout. Content can't decide it, since an absent key means both "one-off event" and "stored before #2923". A cut-off set too early brings back the false block; one set too late only skips a few more rows. Every compared row must carry the same marker. The run records how many rows were compared and how many skipped; a skip is not a failure | CI and plan step 1 (key present), plan step 6 (overlap agrees) | terminal |

A `HALTED` run stops where it is. Nothing is rolled back automatically, because an automatic delete
would be a prod write without the owner's OK. Every row already written is complete (9.1), so a halted
run is always consistent for the owner to resume or undo.

### 8.2 The PII scanner

One module, used by the implementer before it commits, by CI and by the server, so the three can't
disagree. It covers every format already seen in archives: dashed, spaced, dotted and parenthesised
North American numbers, bare 10-digit numbers, 7-digit local numbers (`286-0444`), international
`+CC` numbers, Croatian and other European mobile shapes, and emails including `name (at) domain`. It
scans every string field, and URL fields again after percent-decoding (the Zagreb archive had a phone
number inside a Maps URL). It reports row index, field and pattern id, **never the matched text**. It
fails closed and has no allowlist.

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
   RawEvent. After the create, `recomputeCanonical` still runs for the slot (`merge.ts` ~2356). For a
   single row it's a no-op. For a same-date group whose rows have different run numbers, every row
   stays canonical and it's also a no-op; G10 predicts this, and any write it does make fails G14.
   That call is the one write outside the per-row create.
3. **No cluster linker.** The same-title cluster linker only reads events from yesterday onward
   (`src/pipeline/same-title-cluster.ts` ~241), so it can't link a past archive row; it would only
   re-link the kennel's upcoming live events as a side effect. Backfill mode skips it.
4. **Rows with `seriesId`, more than one kennel tag, or `externalLinks` are rejected**, since their
   extra writes happen after the per-row create.

Separately, for **every** source, the two archive protections in 6.5: the cutoff drop and the
date-correction skip. The drop runs at the top of the loop: the row's kennel tag is resolved (the
resolver is cached), and a row before that kennel's cutoff from any source other than its archive
source is dropped and counted in the result as `archiveCutoffDropped`. The hand-run loader's
`reportAndApplyBackfill` throws when that count is above 0, so a supervised backfill for a kennel with
a cutoff fails loudly instead of reporting `created=0`.

`Kennel.lastEventDate` is still updated after the loop; it is a derived field, recomputed at the end of
the run and after undo. Backfill mode doesn't go through `scrapeSource`, so it doesn't get the two
kennel status refreshes `scrapeSource` runs after every scrape. The run calls them itself, at the end
(9.2) and after undo (10.3).

### 9.2 Plan, then apply

**Plan** (read-only):
1. A1–A6; fetch manifest and archive at `S`; G2; G21's key check on the archive file.
2. Resolve the archive source, origin and kennel; G4, G5, G12, G18, G19.
3. Find `C` (6.5); split the rows; G20.
4. Normalise each row the way `processRawEvents` does before fingerprinting (`sanitizeRawFields`
   included), on a copy, and compute its fingerprint. An explicit `recurringSeriesId: null` from the
   archive file is turned into an absent key first, so the fingerprint and the stored row match a live
   one-off event's. The `null` exists only to prove the capture kept the field (G21).
5. Compute each row's expected `isScheduleOnly` by evaluating `POSTED_RUN_RAW_SQL` itself in the prod
   database, over the normalised rows as `jsonb` (built with `JSON.stringify` of the same normalised
   object the merge will store) with the archive source's type. Doing it in SQL means no second copy
   of the rule can drift from it, whether through whitespace, word boundaries, an empty or zero run
   number, or the placeholder list. Each archive event has exactly one RawEvent, so the refresh's
   newest-copy test (`CURRENT_RAW_SQL`) can't change the answer.
6. G3, G6, G7, G8, G9, G11, G13, G21's overlap check; the matcher simulation (G10) over the rows
   before `C`.
7. Record the V3 snapshot.
8. Store the plan: `C`, per-kennel counts before and from `C`, row order, batch boundaries, each row's
   expected `isScheduleOnly`, and `planHash` (SHA-256 of the approval hash, source ids, kennel id, `C`,
   the ordered fingerprints of the rows to write and their expected flags).

**Apply** (one `advance` call = one batch of rows before `C`):
- **Lease.** `advance` sets `leaseToken` and `leaseExpiresAt = now + 6 min` with one conditional update
  that succeeds only if the lease is free or expired.
- **Cutoff, in two steps.** The first `advance` call, in one transaction, recomputes `C` and halts if
  it differs from the plan's; then it sets `Kennel.archiveCutoffDate = C`, moves the run to `APPLYING`
  and records the time and the kennel's status line (9.6). It writes no rows. A scrape already running at that moment read the kennel's
  settings before the cutoff existed and could still store an event before `C`. So the next `advance`
  writes nothing until every `ScrapeLog` row for the kennel's sources that was `RUNNING` at the cutoff
  time has finished. A `RUNNING` row older than 10 minutes counts as finished: the scrape function
  can't live past its 300 s limit, and stale rows are otherwise only marked `FAILED` when the source's
  next scrape starts, which can be a day later. Callers of the merge that write no `ScrapeLog` (the
  hand loaders, the Atlanta deep-backfill route) aren't waited for; they are supervised paths. Nor is a
  `scrapeSource` call from a local script, which writes a `ScrapeLog` row but has no time limit: the
  supervised-session rule is not to run a wide one-shot scrape for a kennel while its backfill is
  `APPLYING` (the digest lists those), and V3, V4 and the 7-day re-checks catch one that does. Then it
  re-checks that no event of the kennel before `C` is backed by an enabled source, and G20 again. Only
  if both hold does it write the first batch; otherwise the run halts with the cutoff in place, for the
  owner.
- **Batch.** The next rows in plan order. Same-date groups are never split. The first batch is 50 rows;
  later ones are sized from the measured time per row to use at most 150 s of the 300 s limit, capped at
  200.
- **Steps:** G1, G4, G8, G9 (for the batch's rows), G12, G16, G18 → record the batch's row indexes as
  `inFlightBatch` → merge in backfill mode; each row's nested create sets the event's `isScheduleOnly`
  to the plan's expected value, so an origin scrape that refreshes the kennel's evidence mid-run never
  reads a usual-schedule archive row as a real run → for each row, read the RawEvent by (archive source,
  fingerprint) and write a `BackfillRunItem` → G14 → clear `inFlightBatch`, advance the cursor, release
  the lease (one short transaction, 30 s timeout).
- **No long transactions.** Each row is its own nested create; bookkeeping holds at most 200 small
  inserts. Nothing like the 76 s delete that hit P2028.
- **Finish.** When every row before `C` has an item, recompute `lastEventDate`, then run
  `refreshScheduleOnlyFlags({ sourceId: <archive source>, since: <epoch> })` and then
  `refreshKennelEvidence([kennel])`, in that order, because the second reads the flags the first writes.
  The archive source holds only this run's RawEvents (G19; undo hard-deletes them), so scoping by
  source alone covers exactly the written events. No app-clock `since` is needed. Record the kennel's
  status line again, then set `APPLIED` and run `verify`. `APPLIED` is set only after both refreshes
  succeed. If one throws, the run stays `APPLYING` with every row written, and the next `advance`
  retries only the finish step. The daily audit cron runs both refreshes as a backstop.

**Races with live scrapes.** Between plan and the cutoff, a wide re-scrape could store events before
`C`, on archive dates or on others; the post-cutoff re-check catches both and the run halts before
writing anything. Once the cutoff is in force and the scrapes that predate it have finished, no other
source's row before `C` reaches the merge, so nothing can race the writes. Other sources' rows from `C`
on are the live feed's, as before.

### 9.3 Verify

`verify` runs after the last batch and daily for 7 days afterwards. V3 and V4 also run after every
batch, as part of G14. All are row checks:

| # | Check |
|---|---|
| V1 | Every item's event exists, is `CONFIRMED` and canonical, has the expected kennel as primary, and passes the kennel page's own display filter. The page's query and filters move into one shared function used by both the page and `verify`. For `CREATED` items, the event's `isScheduleOnly` equals the plan's expected value, which proves the series marker made it from the archive to the flag. The flag check passes if the flag equals the plan's value. Otherwise it passes with a "rule changed" note if all three hold: the deployed commit differs from the plan's; the stored RawEvent's fingerprint equals the plan's; and the flag equals the rule re-run on the stored `rawData`. Otherwise it fails. A stopped kennel's page hides its usual-schedule events (`HIDE_STOPPED_SCHEDULE_RUNS` in `src/lib/event-filters.ts`), so while `stoppedAt` is set, rows the plan expects to be schedule-only are checked against the display filter without that clause. Being hidden by the stop is correct, not a failure |
| V2 | Every written archive (date, run number) appears in the kennel's displayed events, and at least 95% of the counted rows from `C` to `frozenAt` do too (the live feed's stretch, with G20's exclusions); the missing ones are listed. Rows V1 excuses because of a stop are excused here too. The implementer checks the same on the public page payload, from its own clone's copy of the archive |
| V3 | **Static history unchanged.** A hash over every pre-existing event of the kennel dated within 30 days of a written row's date that **no enabled source backs** (id, date, status, `isCanonical`, primary kennel, run number, title, hares, location fields, `parentEventId`), taken at plan time, is unchanged. Live-backed events are left out, because their sources update them every day; a run that wrongly touched one would already have failed the in-merge check or G14's `updated = 0` |
| V4 | No written row's (kennel, date) slot shows any event other than the run's own |
| V5 | The public page's `totalEvents` equals the shared function's count at the same moment |

The count chain (rows → written → visible → unique dates, before and after) is reported for the owner
to read but is not pass or fail: totals can balance while rows are wrong, and live scrapes change
totals every day.

A V1–V4 failure is `VERIFY_FAILED` (or `HALTED` mid-run) with the check and row indexes. During the
7-day re-checks it also raises a Sentry error and appears under "Needs you" in the digest.

### 9.4 The Zagreb 716-vs-715 case

On 2026-11-13 the hand apply reported `created=716` and the kennel page showed 715. The page counts
unique dates, not events (`src/app/kennels/[slug]/page.tsx`: `uniqueDates = new Set(events.map(date))`).
The archive has 716 rows on 715 dates: #2059 and #2060 are both on 2014-10-04 and stay separate events
because their run numbers differ (the merge's run-number veto, #2656).

A count alone doesn't prove nothing is missing, so this was checked row by row on 2026-11-12 against the
public page payload: the page lists 716 distinct events on 715 unique dates; every archive
(date, run number) pair appears exactly once; and the page shows no event outside the archive. V2 is
that check, automated.

### 9.5 Reconciling a mismatch

1. Read the run's verification result (`GET /runs/:id` or the admin page). The failing check and row
   indexes name the cause.
2. **V1 fails, event `CANCELLED`:** something cancelled it after the apply. The archive binding and the
   cutoff should make this impossible, so treat it as a bug: check the reconciliation context of the
   latest `ScrapeLog` rows for the kennel's sources.
3. **V1 fails, not canonical:** another event took the slot after the apply; V4 fails too. Inspect,
   then decide which event is wrong.
4. **V1 fails, wrong kennel:** G14 should have halted. Undo the run.
5. **V2 lists live-owned rows missing:** the live feed doesn't have those runs. Under the 5% threshold
   that's for the live source or a supervised fix. Over it, `C` was probably wrong (a stray early
   origin event): undo, fix the stray event, and re-submit.
6. **V2 fails for a written row while V1 passes:** the page filters something the shared function
   doesn't, so the two have drifted. Fix the shared function.
7. **V3 fails:** static history changed. If the run did it, undo; otherwise find the writer.
8. **V1 fails on `isScheduleOnly` alone:** the event is right, and only the flag disagrees with the
   plan. A rule change from a deploy is recorded as a note rather than a failure (V1). The plan and the
   refresh evaluate the same SQL on the same stored row, so a failure here means either something
   rewrote the flag or the stored `rawData` differs from the plan's row. Find the writer.
9. **Schedule-only rows hidden on a stopped kennel:** not a failure (V1). They return if the kennel is
   restarted.
10. **Totals differ but V1–V4 pass:** expected. Same-date rows, live events and cancellations all move
    totals.

### 9.6 Effect on kennel status

The kennel status rules ([spec](superpowers/specs/2026-11-10-kennel-status-design.md)) split "is it
running?" from "what do we have?". Here is how a backfill fits them.

- **Archive rows count as real runs**, except those the plan expects to be schedule-only. They are
  dated records from the kennel's own sheet, calendar or site, backed by a RawEvent from a source of the
  origin's type (never STATIC_SCHEDULE) and not entered by hand, so this is intended. The flag is right
  from the moment each row is created (9.2), not only after the finish refresh.
- **They rarely change the status line.** Every archive row is dated before `C`, and `C` is a past event
  the origin backs. The archive changes `lastRunSeenAt` only when none of the live feed's past events
  is itself a real run, for example a calendar whose past entries are all bare repeating instances.
  Then the archive's last row becomes "Last run we saw", and "How we know" names the archive source.
  That is true, so name archive sources as a source a reader understands ("<Kennel> run history"). In
  that case coverage can still say "We don't get their runs": no live feed has produced a real run.
  Both statements hold.
- **Upcoming runs are untouched, but past evidence feeds Travel.** Every row is in the past, so
  `nextRunPostedAt`, Travel's Confirmed list and the Hareline's "usual schedule" tag don't change.
  Travel's projection scoring does read past evidence: the inactivity downgrade
  (`src/lib/travel/projections.ts`, `lastEventDate` today, the last real run once the status plan's
  Travel task lands) and the evidence and agreement gates over about the last 12 weeks of independent
  runs (`src/lib/travel/search.ts`). Rule drift and the prediction ledger read the same runs. For an
  "upcoming runs only" origin, archive rows near `C` can fall inside those windows and raise a Likely or
  Possible row. That's intended, since they are real runs, and the status-line change below is what
  makes it visible.
- **A stop can be overturned.** `refreshKennelEvidence` keeps `stoppedAt` only while no evidence is
  later than it. An archive row dated after an admin stop clears the stop, which is correct: the
  kennel's own records show it ran after that date. The run stores the kennel's status line before its
  first write and after its finish refresh, and undo does the same. The digest lists every run or undo
  that changed one. While a stop stands, the kennel page hides the archive's schedule-only rows like
  any other usual-schedule run, and verification allows for that (V1).
- **Kennels with a usual schedule stay out of Phase 2.** G18 allows one enabled source, so a kennel
  with a STATIC_SCHEDULE source never gets that far, and no generated run can sit on an archive date.
  Stopping a kennel disables its unshared STATIC_SCHEDULE sources, so a stopped kennel can pass G18.
  Its leftover generated past events on archive dates then fail G9, and the run blocks rather than
  overwriting them. Once Phase 3 admits kennels with a schedule source, expect this block often.
  Create-only is never loosened, so such events would have to be retired before the run, never
  overwritten by it.
- **A calendar of bare repeating entries can't be wrongly joined.** If the origin's past events are
  only repeating instances with no run number, they can't match numbered archive rows, so G20's 95%
  check blocks, or `C` sits where the archive already ends.

## 10. Idempotency, partial failure, resume and undo

### 10.1 Idempotency

- One run per approved manifest (A5 and the unique index), one archive per kennel (G19). Calling
  `plan` again returns the existing run.
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
| A terminal guard fails mid-run | `HALTED`; every written row complete and recorded; cutoff in place | Owner: resume from the admin page after fixing the cause, or undo |
| Database, GitHub or deploy not ready | Nothing written | `WAITING`; the next `advance` or the watch cron retries |
| Mac mini off | Run sits in `PLANNED` or `APPLYING` | Watch cron resumes `APPLYING`; `PLANNED` waits for the implementer or owner in Phase 2 |
| Label removed mid-run | `HALTED` at the next batch | Re-label (a new stamp on the same content, which A4 accepts), then the owner resumes; or undo |

### 10.3 Undo

Undo deletes data, so it gets a dry run with counts and the owner's OK. It runs only from
`/admin/backfills/<runId>`, under the owner's Clerk admin session with **step-up re-authentication at
the strict multi-factor level** (Clerk reverification `strict_mfa`: a passkey or TOTP code). Clerk's
reverification is a freshness window for the whole session, so on success the server mints a
single-use nonce bound to this run and this action, valid for 2 minutes, and the undo or resume
request must carry it. The same step-up and nonce guard resume, setting a cutoff by hand (for example
on an adopted kennel) and clearing one. Setting the cutoff inside an approved run (9.2) is covered by
that run's approval and needs no step-up. A saved password isn't enough, so an agent driving a
signed-in browser can't pass it. The owner's account needs a second factor before Phase 2. No token can
do any of the step-up actions.

**Undo plan** (read-only), from the run's items:
- **events to delete:** created by the run, carrying only the run's RawEvent, with no `Attendance`, no
  `KennelAttendance`, and no `EventHare` row linked to a user or entered by a misman;
- **events to keep, with the reason:** a user or misman attached data, or another source's RawEvent
  joined it (the cutoff should prevent this). A kept event is left exactly as it is, run RawEvent
  included, and listed for the owner. The merge can't rebuild an event from its remaining RawEvents, so
  stripping only the run's RawEvent would leave the archive's values with no record of where they came
  from;
- **RawEvents to delete:** the run's, except those on kept events;
- **slots to recompute:** every (kennel, date) the run touched.

**Undo apply**, after the owner confirms those counts:
- One event per transaction through the existing hard-delete helper, moved from `scripts/lib` to
  `src/lib`: `FOR UPDATE` lock, required-empty user relations, a foreign RawEvent at delete time rolls
  that event back and moves it to "kept". 30 s timeout per transaction. Batched under a lease and
  resumable, like apply.
- RawEvents are **hard-deleted**, never unlinked. An unprocessed RawEvent with no event is re-adopted by
  the merge's orphan path, which would quietly recreate the event. The items and the archive in git
  remain the audit trail.
- After the deletes: `isCanonical` is recomputed for every touched slot (the delete helper doesn't do
  it, and an event that lost the canonical pick to a run event would otherwise stay hidden);
  `Kennel.lastEventDate` is recomputed; then `refreshKennelEvidence([kennel])` runs. It reads
  `isCanonical`, so it runs after that recompute, and "Last run we saw" can't keep pointing at a
  deleted run. Kept events' flags need no refresh, because their RawEvents are untouched. The kennel's
  status line is recorded before the first delete and after this refresh (9.6). V3 is checked against
  the plan-time snapshot.
- Last, if nothing was kept, the kennel's cutoff is cleared, so live sources process those dates
  normally again. Nothing was stored for the dropped rows, so the next wide scrape simply sees them as
  new. If events were kept, the cutoff stays until the owner decides about them.

The run becomes `UNDONE`. Its approval is spent; a new archive for the kennel can be submitted (G19).

## 11. Audit trail and liveness

### 11.1 Schema (one migration, e.g. `<ts>_add_backfill_run_tables`)

**`BackfillRun`:** id; PR number; merge SHA `S`; stamped SHA `H`; merged head `M`; manifest path;
`manifestSha256`; `archiveSha256`; `approvalHash`; `planHash`; archive and origin source ids; kennel
id; split point `C`; status (`PREVIEW`, `WAITING`, `BLOCKED`, `PLANNED`, `ADOPTED`, `APPLYING`,
`HALTED`, `APPLIED`, `VERIFIED`, `VERIFY_FAILED`, `UNDOING`, `UNDONE`); reason codes; counts before and
from `C`, and batch boundaries (JSON); the V3 snapshot hash; cursor; `inFlightBatch`; `leaseToken`,
`leaseExpiresAt`; batch log (index, rows, duration, deployed commit); verification results (JSON); who
started each step (`backfill-agent`, `backfill-watch`, or the admin's user id); timestamps. A
hand-written partial unique index on `manifestSha256` for every status except `PREVIEW`.

**`BackfillRunItem`:** run id; row index; outcome (`CREATED`, `LIVE_OWNED`, `ADOPTED`); fingerprint;
`rawEventId`; `eventId`; batch index; `undoneAt`, `undoOutcome` (deleted, or kept with reason). Unique
on (run id, row index).

**`CronHeartbeat`:** one row per job name with last start, last finish, last result.

**`Source.archiveOnly`:** boolean, default false, with a hand-written CHECK
`NOT ("archiveOnly" AND enabled)` in the same migration (Prisma can't express it in the schema).
**`Kennel.archiveCutoffDate`** and **`Kennel.archiveCutoffRunId`:** nullable.

`RawEvent` and `Event` gain no column.

### 11.2 Ops digest

`buildOpsDigest` gains a `backfills` block: runs from the last 7 days with status and counts; runs in
`BLOCKED`, `HALTED`, `VERIFY_FAILED`, or `WAITING` for over 24 hours; leases expired over an hour;
approved manifests merged over 48 hours ago without a `VERIFIED` run; PII leak flags; the
`archiveCutoffDropped` and `archiveCorrectionSkipped` counts from the last day's scrapes, per kennel;
runs that changed their kennel's status line, before and after (9.6); and the watch cron's heartbeat.
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
| `src/pipeline/merge.ts` | Extract the read-only matcher from `upsertCanonicalEvent`; add `backfill` mode (any match throws, atomic per-row create, no cluster linker, reject series, multi-tag and link rows); add the archive-cutoff drop and `archiveCutoffDropped` count for all sources; the date-correction query skips archive-only events. Default behaviour unchanged for kennels without archive-only events. New tests for every match path in both modes, the drop and the skip |
| `scripts/lib/backfill-runner.ts` | `reportAndApplyBackfill` throws when `archiveCutoffDropped` is above 0 |
| `src/lib/event-write.ts` | Optional nested RawEvent in `createEventWithKennel` |
| `src/pipeline/scrape.ts` | Refuse to scrape, or force-scrape, an `archiveOnly` source; count `archiveCutoffDropped` rows |
| `src/app/admin/sources/actions.ts` | `deleteSource` and `toggleSourceEnabled` refuse an `archiveOnly` source; `updateSource` refuses an actual change to its name, type or kennel links (comparing submitted links with the existing set) |
| `src/app/kennels/[slug]/page.tsx` | Move the event query, filters and unique-date count into a shared function |
| `scripts/lib/delete-leaked-event.ts` | Move to `src/lib`; add canonical recompute for touched slots |
| `prisma/schema.prisma` | `Source.archiveOnly`, `Kennel.archiveCutoffDate` and `archiveCutoffRunId`, `BackfillRun`, `BackfillRunItem`, `CronHeartbeat` |
| New | `src/lib/backfill/**` (manifest with `scheduleOnlyEstimate` and G21, PII scanner, provenance rules, migration checker, plan with the expected `isScheduleOnly` from `POSTED_RUN_RAW_SQL`, apply with the kennel status refreshes, verify, undo); agent routes; admin page with Clerk `strict_mfa` reverification and single-use action nonces; watch cron; `approval-stamp.yml`; `backfill-manifest` CI job |
| Ops (owner) | `GITHUB_APPROVAL_READ_TOKEN` created; H3 (issue-filing GitHub App) before Phase 2; a second factor on the owner's Clerk account |

### 12.2 Manuals

**Implementer** (`implement-handoff-prompt.md`):
- Build: the onboarding migration also creates the disabled archive source, linked to the kennel only,
  and passes G17. Freeze the archive up to `frozenAt`; the plan leaves to the live feed whatever it
  already has. For an "upcoming runs only" origin, the archive must reach the last run before the
  merge (G20's gap rule), so re-freeze if the PR waits long for review. For a calendar origin, keep
  each row's `recurringSeriesId` as the adapter emits it, writing an explicit `null` when it has none
  (G21). Run the PII scanner and generate the manifest before the first commit that touches
  `scripts/data/`. Call `POST /preview` and put its result in the PR body, with a link to CI's manifest
  summary.
- Phase A merge step: replace the label-vs-commit-date comparison with `GET /approval/:pr`, then
  `gh pr merge --squash --match-head-commit <approved SHA>`.
- Phase A step 6 becomes: after the first prod scrape, `plan`; if `PLANNED`, `advance` until done;
  `verify`; check every written archive (date, run) on the public page; comment on the PR. One-line
  report: `backfill: <code> VERIFIED <written> written, <live> left to the live feed`, or the block or
  halt reason.
- On any PII hit after push: follow the leak response in 8.2; never push a fix-up to the same PR.
- Golden rule 2 gains one exception: calling the backfill agent API for a PR the owner approved.

**Research** (`daily-onboarding-prompt.md`): a history handoff names its origin source and says whether
the archive fits the Phase 2 scope (one live feed, a supported origin type, strict run numbers) or needs
a supervised apply.

**Digest** (`docs/ops/daily-digest-task.md`): the `backfills` block, leak flags, cutoff drop counts and
the watch cron.

The hand-run `scripts/backfill-<code>-history.ts` loaders stay as the supervised path for everything
outside Phase 2 scope. They should later call the same library with a local run record so hand runs can
also be undone; until then, `adopt-only` manifests bring them into the record.

## 13. Rollout

| Phase | What runs | Entry | Exit |
|---|---|---|---|
| 0. Build | Section 12.1. `BACKFILL_AUTOMATION=off` | This design approved | Unit tests for every guard, every merge match path in both modes, the cutoff drop, the provenance rules (against real Sheets, GCal, Meetup and website archives) and the migration checker (the last eight onboarding migrations pass, crafted bypasses fail, and a sample onboarding migration that creates an archive source applies cleanly to a local database with the CHECK in place); plan, apply, crash-resume and undo tested end to end against a local copy of prod |
| 1. Shadow | `BACKFILL_AUTOMATION=shadow`. The implementer runs `plan` and posts it; the owner still applies by hand and compares. The approval endpoint runs beside the implementer's old merge check and any disagreement is reported | Phase 0 merged | `adopt-only` manifests for Music City and Zagreb come out `ADOPTED`; 5 new backfills where the shadow plan's written-row count equals what the hand apply created, every block was correct, and no PII false positive went unexplained; no disagreement between the approval endpoint and the owner's intent |
| 2. Apply behind the label | `BACKFILL_AUTOMATION=apply`, Phase 2 scope (section 3), 2,000-row cap, 2 applies a day, the implementer starts every apply | Phase 1 exit; H3 done; the owner's Clerk second factor; the owner's written acceptance of T1 and of H1/H2's absence | 10 applied runs, all `VERIFIED` first time or explained, no undo needed for a wrong write, no 7-day re-check failure |
| 3. Loosen | One change at a time: multi-kennel origins or several live sources **only with per-row routing provenance** (the freeze tool records which pattern matched each row, default-bucket rows are forbidden, CI re-derives the routing from the origin's config); more origin types; a higher cap; the watch cron starting approved applies | Phase 2 exit **and** H1 **and** H2 | Owner's call per change |

**Never loosened:** create-only, the archive binding and cutoff for automated applies, the PII guard,
owner-only resume and undo with a second factor, and the owner's stamped label as the approval.

## 14. Failure modes considered

| Failure | What stops it |
|---|---|
| Agent rewrites the PR body after approval | The owner reads CI's summary; the server reads committed files only |
| Any PR change after the label (push, force-push, web-editor merge) | A4 requires the merged head to be the stamped head up to merges of `main`; the implementer merges with `--match-head-commit` |
| Agent adds `owner-approved` itself, or forges a stamp with a workflow on a branch | T1: not stopped. Owner accepts for Phase 2; H1 before Phase 3 |
| PR edits the stamp workflow or guard code | `pull_request_target` runs `main`'s workflow; G15 refuses the PR |
| PR's migration deletes or changes existing data | The code-merge review, as today; the migration runs on deploy whatever this design decides. G17 (a real SQL parser and an allow-list) only keeps such a PR's backfill from being automated; A4 binds the migration to the stamp |
| Several manifests, or a regenerated one, in one PR | CI and A5: exactly one new manifest and archive per PR |
| Fork PR or collaborator | Must be merged into `main` and labelled by `OWNER_GITHUB_LOGIN` |
| Stolen `BACKFILL_AGENT_TOKEN` | Plans or advances only approved runs, which would run anyway; no approve, resume, undo or user data |
| Stolen server GitHub credential | After H3: the read-only token can't label; the issues App's labels fail A2. Before H3 it is the owner's PAT, which is why H3 is a Phase 2 entry condition |
| Stolen owner PAT or `DATABASE_URL` from the Mac | Owner-level compromise, outside what this design can contain (4.1); H2 |
| Same manifest replayed, re-planned after a block, or after undo | Partial unique index covers every non-preview status; G19 one archive per kennel; a retry needs a new file, label and stamp |
| Row moves or merges into an existing event | In-merge "any match throws"; G10 at plan; G9 overlap; G7 run numbers |
| Wide re-scrape reaches archive dates: overwrite, date move, duplicate, resurrected row or redaction | Archive cutoff drops other sources' rows before the cutoff before anything is stored; the date-correction query skips archive-only events, so a later live row can't move one either. Adopted archives have no cutoff unless the owner sets one |
| The split point is wrong: future (upcoming-only feed), today (empty first scrape), or years back (a stray early origin event) | `C` is always a past origin-backed date, else `WAITING`; G20 blocks a gap between the archive and `C` and requires the live feed to show 95% of its stretch; V2 re-checks the same |
| A scrape running when the cutoff is set stores an event before it | The first batch waits for every scrape that predates the cutoff to finish, then re-checks that nothing before `C` is live-backed |
| Rows from a shared website host labelled as one kennel's | G5 refuses a website host that any other kennel's source uses, and requires the origin's query parameters |
| Supervised hand loader for a kennel with a cutoff silently creates nothing | The merge reports `archiveCutoffDropped`; the loader throws when it's above 0 |
| Dropped rows leave tombstones after undo | Nothing is stored for them; undo clears the cutoff |
| Co-hosted existing event on an archive date | G9 checks `EventKennel` membership |
| Rows really from an aggregator, labelled as the kennel's own feed | G5 per-type provenance rule on every row; strict run numbers with capped exceptions (G7); G6 sibling mentions; one live feed per kennel (G18) |
| Origin type whose URLs can't prove provenance (Facebook) | Not in Phase 2 |
| Phone number or email in the archive | Scanner before commit, CI, plan, every batch; leak response if after push |
| Private event dates in public text | Responses and PR text carry counts only about existing events |
| Forced re-scrape or source delete wipes the run's RawEvents | Archive source can't be scraped, force-scraped or deleted |
| Reconcile cancels backfilled runs | Disabled archive source shields them, and the cutoff keeps other sources' RawEvents off them; 7-day re-check |
| Live feed's own stretch is fragile | Non-goal: the same exposure as every kennel today; V2 reports missing live-owned rows |
| Crash mid-batch | Atomic rows; resume by fingerprint on an exclusive source; the merge never re-runs a done row |
| Same-date group split across batches | Never split; G10 predicts the group and the canonical recompute; G14 requires one event per row |
| Long transaction timeout (P2028) | No transaction spans more than one row's create or 200 bookkeeping inserts |
| Deploy changes fingerprints mid-run | Items keyed by row index; fingerprint mismatch on resume halts |
| Onboarding migration not yet live | A1 retryable until the deploy contains `S`; G12 finds no archive source otherwise |
| Actions slow to stamp | Missing stamp is retryable |
| Undo deletes something a user added | Required-empty relations, row locks, foreign RawEvent check, keep-and-report |
| Undo leaves a hidden event or an orphan | Canonical recompute per slot; RawEvents hard-deleted |
| Undo, resume, or a cutoff set or cleared through a signed-in browser | Clerk `strict_mfa` step-up plus a single-use nonce per action |
| "Created" doesn't match the page | Row checks V1–V4; totals informational (9.3, 9.4) |
| The loop dies quietly | Watch cron, `CronHeartbeat`, Sentry, digest |
| Geocoding cost and latency | Batch timing measured per batch; 2,000-row cap; same geocoding as today's hand applies |
| A calendar archive drops or invents the repeating-series marker, so usual-schedule entries are stored as runs | G21: the key on every row of the committed file, and agreement with the origin's current RawEvents on the overlap at plan (RawEvents stored before the marker existed are skipped and counted); the CI summary counts instance-shaped `eid`s with a `null` marker |
| The manifest's schedule-only rule drifts from `POSTED_RUN_RAW_SQL` (whitespace, word boundaries, `runNumber` forms, placeholder edits, the merge's clean-up) | No second rule: the plan evaluates the SQL itself on rows normalised as the merge stores them; the manifest's estimate is outside `approvalHash`, so a placeholder edit can't block an approved run |
| Usual-schedule archive rows read as real runs mid-run | The nested create sets `isScheduleOnly` from the plan, so a mid-run evidence refresh sees the right flag |
| The kennel's status shows a stale or deleted "Last run we saw" after an apply or undo | Both run the kennel status refreshes themselves (9.2, 10.3); `APPLIED` waits for them; the daily audit cron is the backstop |
| An archive source is enabled, renamed, retyped or relinked and shown as the kennel's live feed | Database CHECK against enabling; `toggleSourceEnabled` and `updateSource` refuse; G12 pins disabled, the name and the origin's type on every batch |
| An onboarding migration inserts the archive source without `enabled = false`, so the CHECK fails `migrate deploy` and blocks later deploys | G17 and CI require the literal `false`; a Phase 0 test applies a sample migration locally |
| A deploy that changes the posted-run rule makes correct runs fail their 7-day re-checks | V1 records a rule change as a note when the stored row still equals the plan's |
| A stopped kennel's schedule-only archive rows fail verification as missing | V1 and V2 check them without the stop clause while `stoppedAt` is set |
| A backfill quietly changes a kennel's status or Travel tier, or overturns a stop | Intended when the archive shows later runs; the before and after status lines of every apply and undo are stored and shown in the digest (9.6) |

## 15. Decisions for the owner

These are this draft's defaults. Overrule any of them.

| # | Default |
|---|---|
| 1 | Automated applies bind to a dedicated archive source, and the kennel gets an archive cutoff; live-source binding stays manual |
| 2 | The live feed keeps the stretch from its earliest run on; the backfill writes only before it, and only on empty dates |
| 3 | A kennel with an archive cutoff takes no history from other sources before it until you clear the cutoff |
| 4 | Phase 2 accepts one-feed kennels with Sheets, Google Calendar, Meetup or website origins; anything else is supervised |
| 5 | The implementer's code-merge check moves to the same approval stamp, with `--match-head-commit` |
| 6 | A new `BACKFILL_AGENT_TOKEN`; a read-only `GITHUB_APPROVAL_READ_TOKEN`; issue filing moves to a GitHub App (H3) before Phase 2 |
| 7 | Resume and undo only from the admin page with a passkey or TOTP step-up |
| 8 | Phase 2 cap: 2,000 rows a run, 2 applies a day |
| 9 | Phase 2 needs your written acceptance of T1 and of H1/H2's absence; Phase 3 needs H1 and H2 |
| 10 | Onboarding PRs whose migrations fall outside G17, or that touch guard code, get hand-applied backfills |

## Appendix A. Adversarial review record

The gate: an adversarial review must approve this design before anything is built.

**Reviewer.** `/codex:adversarial-review` was tried first (2026-11-12). Codex refused to start: the
ChatGPT account it runs under doesn't support the configured `gpt-5.5`, nor `gpt-5.4` passed with
`--model`. The review was therefore done by an independent Claude subagent with no part in writing the
design. It read the design and the code it depends on, and was told to attack data-loss paths, approval
bypass, replay, token theft, PII leaks, misrouting, races with scrapes and reconcile, partial writes,
undo and verification, and to verify every claim the design makes about existing code. It could only
read; it made no edits and no prod queries. Every finding's code claims were re-checked against the
repo before being accepted; all held.

### Round 1 (design v1) — `NEEDS-CHANGES`: 2 blocking, 7 material, 2 minor

| # | Severity | Finding | Resolution in v2 |
|---|---|---|---|
| R1-1 | blocking | v1 checked "create only" after the write. The merge's ±30-day date-correction path (`merge.ts` ~1726) can **move** an existing event that has the same `sourceUrl` and run number, and archive rows carry the live URL. G7 looked only at the exact (kennel, date) and only at the primary kennel | Create-only enforced inside the merge before any write; plan runs the matcher read-only and requires CREATE for every row; overlap check covers co-hosts; run numbers may not repeat existing ones |
| R1-2 | blocking | Crash recovery and undo assumed fingerprint dedup. In fact `processed`/`eventId` are written only by the post-loop flush, so after a crash the orphan path re-processes rows; a re-run could fold #2060 into #2059 and still pass as `JOINED_RUN_EVENT`; undo could leave sourceless events | Each row is one atomic nested create (RawEvent + Event + kennel link); recovery reads done rows from the exclusive archive source and never re-runs the merge for them; `JOINED_RUN_EVENT` removed, every row must create its own event |
| R1-3 | material | `scrapeSource(force)` hard-deletes every RawEvent of a source; with a live-source binding that wipes provenance and reconcile shielding | Automated applies bind only to a disabled `archiveOnly` source that `scrapeSource` refuses to scrape |
| R1-4 | material | v1's A3 used the earliest check suite for the head SHA, which a force-push back to a pre-label commit passes; the update-branch exception checked a merge's shape, not its content | `approval-stamp` workflow on `pull_request_target` stamps the head at label time; the server compares merged and stamped content |
| R1-5 | material | Count-based verification can pass while rows are wrong, fails falsely as live data changes, can't see modified existing events; undo didn't recompute `isCanonical` | Row checks V1–V4 with a pre-existing snapshot; totals informational only; undo recomputes canonical per slot; the Zagreb case re-verified row by row |
| R1-6 | material | Exact kennel codes just move the OH3 misroute to freeze time; nothing re-checks routing | Phase 2 requires a single-kennel origin; sibling-mention guard covers hares and location; run-number sequence guard; multi-kennel only with per-row routing provenance in Phase 3 |
| R1-7 | material | The actor boundaries were prompt rules: every task reads the shared `.env` and the owner's `gh` credential; the server's `GITHUB_TOKEN` is the owner's PAT; agents may drive a signed-in browser | Trust model rewritten to say what is and isn't enforced; read-only server token; step-up for resume and undo; H2 added |
| R1-8 | material | A PR could carry several manifests or regenerate one; the owner saw counts only through the agent-written PR body | Exactly one new manifest and archive per PR; CI renders the manifest into its check summary |
| R1-9 | material | A PII hit in CI is already public; private manual-entry dates could leak through block reasons; addresses and names were unaddressed | Leak response defined; counts only about existing events; addresses and names stated as accepted risk |
| R1-10 | minor | `BLOCKED` excluded from the unique index allowed replays; `advance` couldn't resume `HALTED`; the Phase 1 exit couldn't pass because the two existing archives have no manifests | Terminal vs retryable split, index covers every non-preview status; resume is admin-only; `adopt-only` manifests |
| R1-11 | minor | False claims: the cluster linker only reads events from yesterday on; #2059/#2060 stay apart because of the run-number veto (#2656), not the missing start time | Corrected; backfill mode skips the cluster linker |

### Round 2 (design v2) — `NEEDS-CHANGES`: 4 material, 3 minor

Status of round 1: R1-1, R1-2, R1-3, R1-5, R1-8, R1-9 and R1-11 closed; R1-4 closed for honest mistakes
but not for forgery or files other than the archive; R1-6 not closed; R1-7 and R1-10 partly closed.

| # | Severity | Finding | Resolution in v3 |
|---|---|---|---|
| R2-1 | material | v2 claimed live feeds can't reach archive dates. They can: `days` up to 1,825 on the scrape route and alert re-scrapes, raised `scrapeDays`, and the overlap rule was empty when the first scrape returned nothing. A live row would then overwrite archive fields, move dates back (Zagreb #2501), restore the redacted #1797 hare, and break the reconcile shield | v3 added a "history lock" on matches and COVERED rows. **Both replaced in v4** (see round 3) by the archive cutoff (6.5) |
| R2-2 | material | The stamp bound only the archive and manifest, but the backfill depends on the whole PR (migration, seed, links), and code merges still used commit dates | A4 covers every PR file; G17 limits migrations; the implementer's merge step uses the same approval check. Refined in v4 (R3-4, R3-6, R3-7) |
| R2-3 | material | Section 14 overclaimed: with the owner PAT an agent can push a workflow that writes a status as `github-actions[bot]`; the server's `GITHUB_TOKEN` is the owner's PAT; a password-only step-up can be passed by an agent with a saved password | H3 (server off the owner's identity) is a Phase 2 entry; step-up requires `strict_mfa`; wording "through the app". v3's Actions-run check was itself overclaimed; v4 drops it and states the forgery under T1 (R3-5) |
| R2-4 | material | The single-kennel origin was only the agent's claim; `runNumberExceptions` had no limit | Row provenance against the origin; strict run numbers with capped exceptions. v4 makes provenance per origin type (R3-3) |
| R2-5 | minor | v2 threw only on matches to events the run didn't create, so a later archive row could date-correct the run's own earlier event | Any match throws in backfill mode; strict run numbers |
| R2-6 | minor | Terminal blocks were a dead end: missing stamp or GitHub error was terminal, G2 compared display samples, CI forbade changing the archive | Missing stamp and GitHub errors are `WAITING`; G2 compares `approvalHash` fields only; re-submission under a new archive name |
| R2-7 | minor | MCH3's 16 unnumbered rows failed CI, so its adoption failed; adoption by fingerprint breaks when clean-up rules change (#2935); guard paths incomplete; V3 omitted hares and location and would halt on live edits; V4 not per batch | Scope rules only for `archive-source` manifests; adoption by (kennel, date, run number); G15 extended; V3 covers hares and location but only events no enabled source backs; V3 and V4 per batch |

### Round 3 (design v3) — `NEEDS-CHANGES`: 5 material, 4 minor

Status of earlier findings: R1-4 closed for mistakes; R1-6/R2-4 not closed; R1-7/R2-3 partly closed;
R1-10/R2-6 closed except one CI claim; R2-1 not closed; R2-2 closed in design with holes; R2-5 and R2-7
closed.

The round's findings clustered in mechanisms v3 had added (the history lock, COVERED rows, G17, A4).
v4 removes the first two rather than patching them.

| # | Severity | Finding | Resolution in v4 |
|---|---|---|---|
| R3-1 | material | The history lock stopped overwrites but not duplicates (a blocked date move created a second #2501), resurrections of curator-dropped rows, or permanent tombstones (`processed: true, eventId: null` rows skipped forever, never released by undo or deletes) | History lock removed. The kennel's archive cutoff drops other sources' rows before the cutoff **before a RawEvent is stored**, so there is nothing to duplicate, resurrect or leave behind; undo clears the cutoff (6.5, 9.1, 10.3) |
| R3-2 | material | COVERED rows got none of the archive source's protection: forced re-scrapes, reconcile and the lock all left them exposed | COVERED removed. The split point is the live feed's earliest run; rows from it on are the live feed's, stated as a non-goal with the same exposure every kennel has today; the backfill only writes before it, on empty dates (6.5, section 3) |
| R3-3 | material | The `sourceUrl` tie can't work for Google Calendar (`htmlLink`, never the calendar id) or Facebook, the class behind the OH3 incident | Per-type provenance rules: Sheets id, GCal `eid` decoded to the calendar id, Meetup group, website host and path; other types supervised (section 3, G5); tested against real archives in Phase 0 |
| R3-4 | material | G17 rejected all 8 recent onboarding migrations (`UPDATE "Region"` parent links, `ScheduleRule` inserts), and a data-modifying CTE passed a naive check | Allow-list extended to `ScheduleRule` and Region parent updates; checked with a real SQL parser; no data-modifying CTEs, `DO` blocks or functions beyond `NOW()`; Phase 0 test that the 8 pass and bypasses fail (G17) |
| R3-5 | material | A3's Actions-run check doesn't stop a forged stamp: a workflow on a pushed branch can request `statuses: write` and point `target_url` at the genuine run; §6.3 misstated GitHub | Claim dropped; T1 now states that an agent can forge a stamp and that the stamp protects against mistakes only (4.3, 6.3, section 14) |
| R3-6 | minor | A4's comparison missed deleted or renamed paths, binary files and omitted patches, and ignored line order | A4 now requires: the merged head is the stamped head, or differs only by merges of `main`; the same set of paths with the same statuses; per path the same blob or the same ordered lines per hunk; binary or patch-less files blob-equal (6.4) |
| R3-7 | minor | The merge step could merge a different head than it checked | `gh pr merge --squash --match-head-commit <approved SHA>` (6.4, 12.2) |
| R3-8 | minor | Clerk reverification is session-wide, not per action; `deleteSource` wipes an archive source's RawEvents; CI can't know whether an earlier manifest was applied; `recomputeCanonical` writes outside the nested create for same-date groups | Single-use action nonce after step-up (10.3); `deleteSource` refuses `archiveOnly` sources (6.5); "one archive per kennel" moved to the server (G19); the canonical recompute is predicted by G10 and named as the one write outside the per-row create (9.1) |
| R3-9 | minor | COVERED/CREATE couldn't be known before merge, and curated dates inside the live window made "no cut-off" burn manifests (Zagreb #2501 would block) | The split point is the live feed's earliest run, found after the first scrape; rows from it on are never checked against live events, so a curated date in the live feed's stretch can't block the run (6.5) |

### Round 4 (design v4) — `NEEDS-CHANGES`: 1 material, 4 minor

Status of earlier findings: R2-1/R3-1 closed (one residue each, below); R3-2 closed by removing COVERED
rows; R3-3 and R1-6/R2-4 closed for Sheets, Google Calendar and Meetup, not for websites on shared
hosts; R3-4 largely closed; R3-5 and R1-7/R2-3 closed; R3-6 closed; R3-7, R3-8, R3-9 and R2-2 closed.
The reviewer also checked that the cutoff drop leaves reconcile, fill rates, kennel evidence and health
counts unaffected.

| # | Severity | Finding | Resolution in v5 |
|---|---|---|---|
| R4-1 | material | Nothing checked that the split point joins the archive to the live feed. `C` could be in the future (upcoming-only feeds), so the cutoff dropped new upcoming runs; today (empty first scrape), leaving a permanent gap; or years back (a stray early origin event), handing most of the archive to a live feed that doesn't have it, and still ending `VERIFIED`. A wide re-scrape between plan and the first batch could also store live events before `C` that the cutoff would then freeze | `C` is the earliest **past** origin-backed date, else `WAITING`; G20 blocks a gap of more than 1.5 median run intervals and requires the live feed to show 95% of its stretch; V2 checks the same at verify (6.5, 8.1, 9.3). The cutoff is set on its own; the first batch waits for scrapes that predate it, recomputes `C`, and re-checks that nothing before `C` is live-backed (9.2) |
| R4-2 | minor | The website provenance rule passed shared hosts (`sfh3.com` serves 13 kennels) and ignored query parameters | Websites only on a host no other kennel's source uses, with the origin's query parameters required; otherwise supervised (section 3, G5) |
| R4-3 | minor | G17 would reject the eight migrations it promised to pass (`NOW() AT TIME ZONE` parses as `timezone()`), and the allowed Region update had no bound | `timezone()` with a literal zone allowed; Region updates limited to rows the same migration inserts; the Phase 0 test, with owner review of any migration that falls outside (G17) |
| R4-4 | minor | A live row after `C` could still date-correct an archive event before it; per-hunk comparison could give false A4 mismatches; a hand loader for a kennel with a cutoff would report `created=0` silently | Date-correction query skips archive-only events (6.5); A4 compares the whole file's ordered +/- lines; the merge reports `archiveCutoffDropped` and the loader throws on it (9.1, 12.1). Adopted archives' lack of a cutoff is now stated (6.5) |
| R4-5 | minor | Still overstated: G17 "stops" bad migrations (it only stops the automated backfill); clearing a cutoff had no step-up; agents can halt by removing the label; "the implementer starts every apply" is a manual rule | Reworded (sections 14, 4.2, 7.3); setting or clearing a cutoff needs `strict_mfa` and a nonce (6.5, 10.3) |

### Round 5 (design v5) — `APPROVE`, with 5 minor findings

All round 4 findings closed. The reviewer found no remaining blocking or material issue: "the approval
binding, create-only, atomic rows, the archive source, the cutoff, the per-row verification, the undo
controls and the trust statements all hold against the code I re-checked." It also confirmed that the
date-correction skip changes no existing behaviour, since no source has `archiveOnly` set today.

The minor findings were applied in v5.1:

| # | Finding | Resolution in v5.1 |
|---|---|---|
| R5-1 | §10.3 required step-up to set a cutoff, while the token-driven run sets one | Step-up covers setting a cutoff by hand and clearing one; setting it inside an approved run is covered by that run's approval (10.3) |
| R5-2 | The wait on running scrapes could last a day, because stale `RUNNING` rows are only failed when the source's next scrape starts | A `RUNNING` row older than 10 minutes counts as finished; supervised callers that write no `ScrapeLog` are named (9.2) |
| R5-3 | G20 blocks seasonal kennels, and counts curated fixes as missing; each block burns a manifest | Manifest declares `expectedGaps` and `curatedCorrections`, shown in CI's summary and excluded from G20 (6.1, 6.5) |
| R5-4 | With date-correction skipping archive events, a live row could become a second event with the same run number | Such a row is dropped and counted as `archiveCorrectionSkipped`, shown in the digest (6.5, 11.2) |
| R5-5 | Unnumbered rows matched on date alone | Left out of both sides of the 95% count; written rows are checked through their recorded event ids (6.5, 9.3) |

### Round 6 (v5.1, confirmation of the minor fixes) — `APPROVE`

The reviewer checked only the v5 → v5.1 diff and confirmed each R5 fix resolves its finding: "None of
these is blocking or material. The round 5 approval stands." Its notes, all minor, were applied in the
final text:

| # | Note | Applied |
|---|---|---|
| N-1 | Unlimited `curatedCorrections` or `expectedGaps` could switch G20 off (for example a freeze-tool bug marking most rows "curated") | Capped: corrections at most 20 rows or 2%; gaps at most 120 days and containing no row; at least 10 rows (or half the stretch) must remain counted (6.1, 6.5) |
| N-2 | G2 can't recompute curator-declared fields | They are declared inputs: CI checks shape and caps and hashes them, but doesn't recompute them (6.2) |
| N-3 | Where an `archiveCorrectionSkipped` row is stored was unspecified; marking it processed would recreate the tombstone R3-1 removed | The check runs at the top of the loop with the cutoff drop, before any RawEvent is stored (6.5) |
| R5-2 residue | A `scrapeSource` call from a local script has no time limit, so the 10-minute rule doesn't bound it | Stated as a supervised-session rule, with V3, V4 and the 7-day re-checks as detection (9.2) |

### Round 7 (v5.2, alignment with kennel status) — `NEEDS-CHANGES`: 2 material, 7 minor

v5.2 aligned the design with the kennel status work merged after round 6 (Status 1, #2923:
`Event.isScheduleOnly`, the kennel's cached evidence dates, and the posted-run rule in
`src/pipeline/kennel-evidence.ts`). It made three changes:
- calendar archives keep `recurringSeriesId` (G21);
- apply and undo run the status refreshes themselves;
- an archive source can never be enabled.

It also added section 9.6. A fresh reviewer confirmed the following against the code:
- the refresh order;
- that kept events need no flag refresh;
- the stop, `nextRunPostedAt` and coverage claims.

It found that nothing earlier rounds closed was reopened, and nothing blocking. Every code claim below
was re-checked before being accepted.

| # | Severity | Finding | Resolution |
|---|---|---|---|
| R7-1 | material | The manifest's schedule-only rule wasn't the SQL's. `rawData` is the row after `sanitizeRawFields`, which can move "Hared by X" from the title into `hares`. JS and Postgres treat whitespace and word boundaries differently. `runNumber` `""` and `0` behave differently in each. Hashing the set into `approvalHash` would turn any placeholder edit between CI and plan into a terminal block | The plan computes the expected flags by evaluating `POSTED_RUN_RAW_SQL` itself over the normalised rows and stores them in the plan. The manifest keeps only an informational estimate outside `approvalHash`. Section 6.5 now says the merge's clean-up runs before storage (6.1, 6.5, 9.2) |
| R7-2 | material | The kennel page hides a stopped kennel's schedule-only events (`HIDE_STOPPED_SCHEDULE_RUNS`), so V1 and V2 would fail on correctly written rows | While `stoppedAt` is set, those rows are checked without that clause; a new item in 9.5 (9.3, 9.5) |
| R7-3 | minor | "Travel's Likely and Possible lists don't change" was wrong: the inactivity downgrade and the 12-week evidence and agreement gates read past runs | Reworded: past archive rows can raise Travel rows, by design, and the status-line change in the digest surfaces it. The "How we know" versus coverage case is explained (9.6) |
| R7-4 | minor | G21 passes an archive with `null` written on every row | At plan, archive rows on the overlap must carry the same marker as the live origin RawEvent with the same `sourceUrl`. CI counts instance-shaped `eid`s that have a `null` marker (6.2, G21) |
| R7-5 | minor | New events default to `isScheduleOnly = false`, so a mid-run origin scrape could count schedule-only archive rows as runs. A refresh failure's effect on `APPLIED` was unspecified | The nested create sets the flag from the plan. `APPLIED` waits for both refreshes, and a failure retries the finish step (9.2) |
| R7-6 | minor | The refresh's `since` rested on the app clock | The scope is the archive source with `since` at epoch, since that source holds only this run's RawEvents (9.2) |
| R7-7 | minor | The seed, `updateSource` and migrations could enable, retype or relink the archive source, and type decides real runs | A database CHECK `NOT ("archiveOnly" AND enabled)`; `updateSource` refuses type, link and `enabled` changes; G12 pins the origin's type (6.5, 8.1, 11.1, 12.1) |
| R7-8 | minor | An explicit `null` marker would reach the fingerprint (the gate tests `=== undefined`) | The plan turns an explicit `null` into an absent key before normalising (9.2) |
| R7-9 | minor | The flag check should cover `CREATED` items only; the set was described as calendar-only; undo didn't record status lines | V1 checks `CREATED` items; the plan computes flags for every origin type; undo records status lines (9.3, 9.2, 10.3) |

### Round 8 (v5.2, confirmation of the R7 fixes) — `NEEDS-CHANGES`: 1 material, 4 minor

The reviewer confirmed the R7 fixes. Evaluating the rule in SQL at plan gives the same answer as the
refresh on the stored row:
- each archive event has exactly one RawEvent;
- the stored `rawData` is the same sanitised object;
- every field the rule reads is in the fingerprint, so a clean-up change halts the run.

Setting `isScheduleOnly` at create adds no column, and V3 doesn't hash it. The CHECK leaves the six
existing archive sources (`archiveOnly` false), the seed sync and kennel restart untouched.

| # | Severity | Finding | Resolution |
|---|---|---|---|
| R8-1 | material | The overlap check would block every calendar origin scraped before #2923. RawEvents are immutable, so origin events not re-scraped since then keep a copy without the marker, and a correct capture "mismatches" | Compare only with the origin's current RawEvent per `sourceUrl` (the `CURRENT_RAW_SQL` rule), and skip RawEvents stored before the marker existed. Compared and skipped rows are counted; a skip is not a failure (G21) |
| R8-2 | minor | `Source.enabled` defaults to true, so an archive insert without `enabled = false` violates the CHECK and fails `migrate deploy` | G17 and CI require the literal `false`; a Phase 0 test applies a sample onboarding migration locally (6.2, 8.1, 13) |
| R8-3 | minor | `updateSource` always recreates the links, so refusing every save would block config edits. `enabled` isn't one of its fields. Renames weren't covered, though G12 binds by name | It refuses actual changes to the name, type or links, comparing the links with the existing set (6.5, 12.1) |
| R8-4 | minor | G21's key check ran after step 4 had removed the `null`s | The key check reads the committed file at plan step 1; only the overlap check runs at step 6 (9.2, 8.1) |
| R8-5 | minor | A deploy that changes the rule would fail correct runs' 7-day re-checks; G14 didn't check the flag set at create | V1 records a rule change as a note when the stored row still equals the plan's; G14 checks each created flag (9.3, 9.5, 8.1) |

### Round 9 (v5.2, confirmation of the R8 fixes) — `APPROVE`

The reviewer confirmed all five R8 fixes and found nothing blocking or material: "The approval stands."
It noted that one-off origin events keep their fingerprints across #2923 (the marker is a gated
fingerprint token), so most of them are skipped by the overlap check and only repeating instances
scraped since are compared. That is expected, and the recorded counts show it. Its two wording points
were applied:

| # | Note | Applied |
|---|---|---|
| R9-1 | G21's "stored before the marker existed" cut-off was undefined, and an early one fails closed | A constant set once in Phase 0: the earliest `scrapedAt` of a calendar RawEvent carrying the marker, plus one hour. Early versus late trade-off stated (G21) |
| R9-2 | V1's pass rule after a rule change was implicit | Stated as three steps: the plan's value passes; a rule change with an unchanged stored row passes with a note; anything else fails (9.3) |
