# Checkpoint review — prompt for an interactive session

Every Monday at 06:00 UTC the `weekly-scorecard` cron computes the round's scorecard, stores it in
its `AutomationRun` row, files a `lane:decision` issue titled **"Checkpoint CPn — <date>"** and
emails the owner the same summary. The checkpoints of the November–December 2026 round are CP1
30 Nov, CP2 7 Dec, CP3 14 Dec and CP4 21 Dec; between rounds the issue is titled "Weekly scorecard".

The owner opens a fresh session in `~/Developer/hashtracks-web` and pastes:

> Run the checkpoint review in `docs/ops/checkpoint-review-prompt.md` for this week's checkpoint issue.

The review takes about 20 minutes of the owner's time. Everything below is read-only except the
review page, the issue comment and closing the issue, which the owner approves in the session.

## 1. Read

1. **The checkpoint issue:** the newest open `lane:decision` issue whose title starts with
   "Checkpoint" or "Weekly scorecard":
   ```bash
   gh issue list --state open --label lane:decision --search 'in:title Checkpoint' --json number,title,createdAt,body
   ```
   If there is none, the cron didn't deliver: check the ops digest's `scorecard` block (below) and
   the watchdog's `cron:weekly-scorecard` state, and compute the scorecard by hand from the targets
   in [`src/lib/scorecard/config.ts`](../../src/lib/scorecard/config.ts).
2. **The stored scorecard:** the ops digest API returns the latest run as `scorecard`:
   ```bash
   TOKEN=$(grep -m1 '^AUDIT_AGENT_TOKEN=' .env | cut -d= -f2- | tr -d '"'); curl -s -H "Authorization: Bearer $TOKEN" https://www.hashtracks.xyz/api/audit/agent/ops-digest | jq '.data.scorecard'
   ```
   `scorecard.values` holds each measure's value, what the table showed, its target and status.
   Last week's issue (closed) gives the previous values.
3. **The plan:** `~/.claude/plans/hashtracks-next-round-2026-11/next-round-plan.md`, sections 2
   (objectives and targets), 6 (workstreams and their levers) and 9 (checkpoints).
4. **What moved this week:** merged PRs (`gh pr list --state merged --search "merged:>=<last Monday>"`),
   the linked sessions' notes in the shared notes folder, and the last seven ops digests in
   `~/Developer/hashtracks-ops-digests/`.

## 2. Fill in what the server can't read

Rows marked **n/a** in the issue have no server source yet. Fill them in where you can and say how:

- **O2 human visitors per week:** PostHog, with WS8's bot filter (`docs/growth/2026-11-diagnostic.md`).
  Also drop internal traffic: `AND coalesce(properties.internal_user, false) != true` in SQL, or the
  event filter `internal_user` *is not set* in an insight. Admins and any browser opened once with
  `?internal=1` carry that property (PR #3144); the count is only clean for weeks after it shipped.
- **O3 reopened within 30 days:** `gh issue list --label lane:defect --state all --search "reopened"`
  is not reliable; read the timeline of last month's closes (`gh api repos/johnrclem/hashtracks-web/issues/<n>/timeline`).
- **O7 dark-kennel dispositions and moves to live:** WS5's `docs/ops/dark-kennels-2026-11.md`.
- **O9 handoff → live median:** pair merged `onboarding-handoff` PRs with the `onboarding-impl` PR
  for the same kennel.
- **O1 (GSC) and O10 (Sentry):** only until the owner adds `GSC_SERVICE_ACCOUNT_JSON` (A7) and
  `SENTRY_READ_TOKEN` (A8); read them in Search Console and Sentry meanwhile.
- **Dated checks marked "manual":** CP2's Vercel and Railway usage (`vercel` CLI usage, Railway
  MCP `get-service-metrics`), CP4's round close.

Never write to prod for any of this: reads only, with
`PGOPTIONS='-c default_transaction_read_only=on'` for SQL.

## 3. Report

Write the review in the session, short:

1. **Headline:** objectives on track, behind, and missed, in one line each.
2. **Each miss** (status `missed`, or a guardrail `not yet`): its value against the target, the
   cause you found (cite the PR, issue, scrape log or digest), and whether the lever in section 6 is
   still the right one.
3. **Not-yet rows** that won't make their next checkpoint at this week's pace.
4. **Dated checks:** pass, fail, or what you read by hand.
5. **Re-prioritisation:** what to cut, reorder or add, within the section 3 caps and the owner's
   minutes in section 4. Never propose raising a cap; propose cutting from the bottom of the
   priority order instead. If a target is wrong (not the work), say so and propose the new target
   as a change to `src/lib/scorecard/config.ts`.

## 4. Record (with the owner's OK in the session)

1. **Review page:** update https://claude.ai/artifact/MSp9n2T5C9mDhstNYizRNv with this
   checkpoint's table, misses with causes, and the re-prioritisation. Read the page first and keep
   its structure; add the checkpoint as a new section, don't rewrite earlier ones.
2. **Issue:** comment the review (scrub it first: `npx tsx scripts/scrub.ts`), then close the issue
   as completed. Closing it is what tells next week's digest the review happened.
3. **Plan:** if the owner accepted re-prioritisation, record it in the plan file's change log.
4. **Targets:** a target change is a PR to `src/lib/scorecard/config.ts`, not an edit here.

## At CP4 (21 Dec)

Also draft the next round's plan: what each objective ended at, what carried over, what to stop.
The next round replaces `CHECKPOINTS` and `MEASURES` in `src/lib/scorecard/config.ts`; until then
the cron keeps running weekly and titles its issue "Weekly scorecard", judging nothing against a
checkpoint.
