# Daily onboarding routine — redesign proposal (2026-11-05)

**Status:** approved by the owner on 2026-11-05 and implemented in `daily-onboarding-prompt.md`: Step 0 preflight, Step 2 handed-off dedupe, Step 9 GitHub delivery. The trigger prompt was updated and the labels created. The routine `trig_01NkbKrM53oWTmUxB7AHsPMC` stays **disabled** until the implementation backlog is under 10. At 52 today, Step 0 would exit on every run anyway.

## What went wrong (Aug–Nov 2026)

1. **Delivery depended on git in the owner's live checkout.** The routine is bound to the Mac mini and writes into `/Users/johnclem/Developer/hashtracks-web`. That checkout is often parked on a feature branch with uncommitted work, and from 2026-08-19 stale `.git/*.lock` files blocked every write. The result was 49 handoffs stranded as untracked files for 11 weeks. This is the fourth backlog of this kind (after 07-05, 07-15 and 08-11).
2. **The prompt and the manual contradict each other.** The trigger prompt says "Do NOT run git checkout/branch/commit/push". `daily-onboarding-prompt.md` Step 9 says commit and push is mandatory. The prompt also says "the MANUAL wins", but then restates the opposite as a hard limit.
3. **No-op runs never stopped.** From 11-01 to 11-04 the queue had 0 `queued` rows. Every run re-confirmed that the Harrier Central vein was exhausted, wrote a 15–40 line "NO ONBOARD" run-log entry, and exited successfully. Nothing escalated beyond text in a file nobody was reading.
4. **The routine re-discovered kennels it had already handed off.** It wrote 8 duplicate handoffs (yh3, vh3-la, coeh3 ×3, pgh3, cernh3, blhhh, h5-gb). Step 2 dedupes against the live sitemap, but a handed-off kennel is not live yet, and the routine never checked its own `handoffs/` folder.
5. **Research outran implementation.** With #2690 merged there are **52 un-implemented handoffs** (`bash scripts/copy-newest-handoff.sh --list`) and 0 queued targets. Another research handoff a day adds nothing until the implementation side catches up.

## Proposed design

### A. Deliver through GitHub, never through the owner's working tree
- Each run works in a **throwaway clone**:
  ```bash
  TMP=$(mktemp -d)
  gh repo clone johnrclem/hashtracks-web "$TMP" -- --depth 1
  cd "$TMP"
  ```
  It writes only `docs/kennel-onboarding/**` there. `gh` on the Mac mini is already authenticated with `repo` scope.
- It commits to `onboarding/handoff-<date>-<code>`, pushes, and runs `gh pr create --label onboarding-handoff`. It enables auto-merge (`gh pr merge --auto --squash`), because docs-only PRs pass CI in a few minutes and need no review to be visible.
- `run-log.md` and `target-queue.md` are edited in the same fresh clone, so they always start from `origin/main`. That removes the stale-checkout 3-way-merge hazard from the 08-11 rescue.
- The owner's checkout is never touched. Drop the Step 9 stash/switch/pop sequence and the "Do NOT run git" line, and replace both with this single flow in **both** the trigger prompt and the manual.
- The bound device is still useful for the Chrome pane (sitemap reads, JS-rendered source verification). Delivery no longer depends on it.

### B. Fail loudly, and stop after repeated no-ops
- **Preflight (new Step 0, before any research):**
  1. `bash scripts/copy-newest-handoff.sh --list`. If **≥ 10 handoffs are un-implemented, write nothing and exit** with a one-line report ("implementation backlog N ≥ 10 — research paused").
  2. If an open GitHub issue labeled `onboarding-blocked` exists, exit immediately. The issue is the human's switch.
- **No-op accounting:** a run that writes no handoff appends **one line** to `run-log.md` (date, reason, queue count) instead of a 15–40 line essay. After **3 consecutive no-op runs**, the run opens, or comments on, an `onboarding-blocked` issue explaining why (queue empty, every source unverifiable, tooling denied) and what would unblock it. Every following run then exits at preflight until a human closes the issue.
- **Delivery failure is never silent.** If `gh pr create` or the push fails, the run opens an `onboarding-blocked` issue with the error and the handoff body attached. A handoff that cannot reach GitHub must reach the owner some other way.

### C. Dedupe against handed-off work, not just live kennels
Step 2 gains two checks before the sitemap:
- `npx tsx scripts/print-seeded-kennel-codes.ts` (#2691) for seeded kennels.
- `ls docs/kennel-onboarding/handoffs/*-<code>.md` plus `gh pr list --label onboarding-handoff --search <code>` for kennels that are handed off or in flight.

A hit means "already handed off", so the routine skips it and never writes a second handoff.

### D. Refilling `target-queue.md`
- Only refill when the implementation backlog is under 10 **and** fewer than 5 rows are `queued`. Refill to about 15 rows, not 20.
- Ranking and sources stay as in the manual's Step 8.3, with one change: a row is `queued` only with a **verified-live dynamic source cited in the row**. Candidates that can't be verified from the routine's sandbox (Meetup client-side render, Google Calendar embeds, new domains the browser auto-denies) go to `verify-live-first` and do not count toward the refill target. That stops the "refill owed but genuinely blocked" loop of 11-01 to 11-04 from counting as work.
- Today the queue has **0 `queued`, 60 `verify-live-first` and 2 `blocked`** rows. Its bench is mostly the unverifiable kind, so a refill needs a session with a working Chrome pane and someone to approve new domains. It can't be done unattended.

### E. Retarget the routine while the backlog is large (optional)
While 52 handoffs wait, a daily run that **implements** the oldest config-only handoff would add more value than one that researches. "Config-only" here means Harrier Central, GCal, Meetup and iCal handoffs with no new adapter. It would open a normal code PR and never merge it itself: live-verify, seed, migration, PR. Batches of the same adapter type follow the hc-batch precedent. Code PRs need the owner's review, so this would replace research rather than run alongside it, and would pause once the backlog drops below 10.

## Changes to make once agreed
1. Update the trigger prompt (RemoteTrigger `update`) to point at the new flow. Remove the contradictory git hard limit.
2. Rewrite manual Step 9 as section A, add Step 0 preflight as section B, and extend Step 2 as section C.
3. Create the `onboarding-handoff` and `onboarding-blocked` labels.
4. Re-enable the routine once #2690 and #2691 are merged.
