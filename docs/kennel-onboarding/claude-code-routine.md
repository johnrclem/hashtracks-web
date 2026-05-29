# Claude Code Routine — Auto-Implement Daily Handoff

> **Currently parked.** John is running implementation in **local** Claude Code sessions
> (manual paste — see [`README.md`](README.md)) because HashTracks adapters routinely need
> NAS-only resources during live verification (`browserRender` for Wix/Google-Sites/SPA;
> residential proxy) — both on Tailscale, unreachable from Anthropic's cloud routines.
>
> Revisit this doc if (a) those services get exposed publicly (e.g. via Cloudflare Tunnel) or
> (b) a stretch of kennels lands that doesn't need them. The setup below is ready to use as-is.

---

The second half of the loop (handoff → PR) can run as a **Claude Code routine** — a cloud-hosted
recurring task created via `/schedule` in any Claude Code session.

## How the two halves would fit together

1. **Cowork scheduled task (~6 AM)** — `onboard-daily-kennel` researches one kennel against the
   live sitemap and writes a complete, verified handoff to `docs/kennel-onboarding/handoffs/`.
2. **Bridge — commit + push the handoff to `main`.** Routines see only committed files (they
   clone from GitHub). See [Bridging the handoff](#bridging-the-handoff) below.
3. **Claude Code routine (~7 AM)** — picks up the newest handoff, follows its top "▶ FOR CLAUDE
   CODE" directive, and opens a PR. You review and merge.

## Create the routine

In any Claude Code session in this repo, type `/schedule`, paste the prompt below as the
routine's instructions, set the schedule to **daily at 7 AM in your timezone**, and confirm. You
can also create/manage routines at <https://claude.ai/code/routines>. Pro plan limit is 5 routine
runs/day; one daily run is well inside that.

## The routine prompt (copy verbatim)

```
You are the HashTracks daily kennel onboarding implementer. A separate task writes a
verified onboarding handoff into docs/kennel-onboarding/handoffs/ each morning. Your job
is to implement the NEWEST handoff that hasn't been implemented yet, end-to-end, and open
a PR. STOP after opening the PR — do not merge.

STEPS:

1. Refresh the repo.
   - git fetch origin --prune
   - git checkout main && git pull --ff-only
   - eval "$(fnm env)"; fnm use 20
   - npm ci   (if node_modules is missing)

2. Pick today's handoff.
   - Scan docs/kennel-onboarding/handoffs/*.md (skip README.md).
   - Skip any file whose first 5 lines contain "VOID" (case-insensitive).
   - Order by filename desc (newest YYYY-MM-DD- first).
   - For each candidate, derive <code> from the filename (the part after the
     YYYY-MM-DD- prefix, before .md). Check whether an implementation branch
     already exists on origin:
       git ls-remote --heads origin "onboard/<code>-*"
     If any matching branch exists, that handoff was already implemented — skip it
     and try the next.
   - If no un-implemented handoff is found, print "nothing to do" and exit 0.

3. Implement it. Open the chosen handoff file and follow its TOP "▶ FOR CLAUDE CODE"
   directive exactly. The whole file is the brief. Required honors:
   - Branch off clean main:  onboard/<code>-<YYYYMMDD>
   - Apply the Ready-to-paste seed (kennel + alias + source; for "source-add" type,
     don't duplicate the kennel — just add/repoint the source and enrich missing fields).
   - If the handoff's Effort says "NEW adapter", build it per the parsing plan:
     create src/adapters/<dir>/<name>.ts + <name>.test.ts and add the URL pattern to
     htmlScrapersByUrl in src/adapters/registry.ts. If Effort says "config-only", the
     adapter already exists — only the Source row + URL pattern (if applicable) changes.
   - If the handoff says the region isn't seeded, add it to the region seed mirroring an
     existing metro (METRO level under the right country, with centroid + timezone).
   - npx prisma db seed
   - Live-verify against the real source URL per .claude/rules/live-verification.md AND
     the handoff's "feed HEAD-check" guidance. Resolve every item marked "⚠️ Claude
     Code must confirm" (e.g. HEAD the feed URL — text/calendar for an .ics; if it's
     text/html the export is gated off and you use the documented fallback). Events
     non-empty + upcoming, dates UTC-noon, startTime "HH:MM", kennelTag resolves with no
     unmatched.
   - Honor the "Implementation gotchas" block at the bottom of the handoff:
       * Rejecting upstream coords needs dropCachedCoords:true (not just undefined).
       * On partial pagination failure, set kennelPageFetchErrors + kennelPagesStopReason.
       * For historical-archive sources, set config.upcomingOnly:true (ONH3 pattern).
       * Tests using vi.spyOn(globalThis,"fetch") need beforeEach(vi.restoreAllMocks).
       * Keep functions under Sonar S3776 cognitive complexity ≤15 (extract helpers).
       * Use known-safe regex patterns for Sonar S5852 (split combined regexes; use
         (\S.*) instead of (.+)$; make optional groups truly optional).
       * Self-host tokenized CDN logos to public/kennel-logos/<code>.<ext>.
   - Consult docs/kennel-onboarding/source-platform-notes.md for platform-specific gotchas
     before drafting parsing logic; if you learn a new platform-level lesson while
     implementing, append it there.
   - Include the historical backfill only if the handoff says it's worth it.
   - npx tsc --noEmit && npm run lint && npm test
     All three must pass. Fix what's red. Don't disable lint rules or skip tests.

4. Open the PR.
   - git push -u origin onboard/<code>-<YYYYMMDD>
   - gh pr create --base main --title "Onboard <shortName> (<region>)" with a body that
     includes:
       * Source type + URL (and adapter: config-only vs new).
       * Live-verification results: event count + date range + a sample event.
       * Whether historical backfill is included + count.
       * The deep-dive checklist from the handoff (showing nothing was deferred).
       * A "Implements: docs/kennel-onboarding/handoffs/<handoff-filename>" line.
   - STOP. Do NOT merge. Do NOT enable auto-merge.

5. If you cannot complete safely (live-verify fails and the documented fallback also fails;
   tests can't be made green in-run; ambiguous adapter plan): push what you have and open
   a DRAFT PR titled "WIP: onboard <shortName>" explaining what blocked you. Do NOT
   force-fix, guess, or skip live verification.

NEVER:
 - edit applied prisma migration files (author a new migration if needed),
 - commit secrets (.env, .env.local),
 - modify RawEvent records or anything outside the onboarding scope,
 - merge the PR,
 - touch unrelated files in the same PR.

If anything here conflicts with the handoff file, the HANDOFF takes precedence (it carries
source-specific detail this prompt cannot).
```

## Bridging the handoff

Routines see only what's committed and pushed. Two options to surface the morning's handoff:

**Option A — manual commit (simplest, 30 seconds/morning):**

```bash
cd ~/Developer/hashtracks-web
git checkout main && git pull
git add docs/kennel-onboarding/handoffs docs/kennel-onboarding/run-log.md docs/kennel-onboarding/target-queue.md
git commit -m "handoff: $(ls -t docs/kennel-onboarding/handoffs/*.md | head -1 | xargs basename .md)"
git push
```

**Option B — minimal launchd helper (fully hands-off):** a small `~6:30 AM` job that just
commits + pushes new handoffs. Keep the helper one job, separate from the implementation work
(which is now the routine's job).

## Migrating from the local launchd implementer

The `scripts/onboard-implement.sh` + `scripts/com.hashtracks.onboard-implement.plist` workflow
in this repo is a parallel option that runs a full local implementation cycle. With a routine in
place you can:

```bash
launchctl unload -w ~/Library/LaunchAgents/com.hashtracks.onboard-implement.plist
rm ~/Library/LaunchAgents/com.hashtracks.onboard-implement.plist
```

…and leave the scripts in the repo as a fallback.

## Why this design

- **Cloud-hosted** → laptop power state and network don't matter; runs on Anthropic infra.
- **Full autonomous permissions in the routine** → no `--dangerously-skip-permissions` debate;
  no permission prompts to stall on.
- **Clean isolation** → routine starts from a fresh GitHub checkout each run; no entanglement
  with a dirty working tree.
- **Stops at PR** → CI + your review remain the safety net before anything lands on `main`.
- **Self-improving** → both the daily research prompt and the routine reference
  `source-platform-notes.md`; new platform learnings accrue there over time.
