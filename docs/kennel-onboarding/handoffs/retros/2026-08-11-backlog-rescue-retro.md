# Cowork Handoff Retro — BACKLOG RESCUE (20 orphaned handoffs) — 2026-08-11

Retro for the rescue of **20 un-implemented handoffs** (`2026-07-16-ph3-cz` → `2026-08-11-essex-h3`)
that existed only as **untracked files in the main repo working tree**. No kennels were onboarded in
this pass — it exists to get the work into git and to make the failure mode structurally impossible.

**Outcome:** 20 handoffs + 848 lines of `run-log.md` / `source-platform-notes.md` / `target-queue.md`
edits committed; `scripts/copy-newest-handoff.sh` rewritten around a correct implemented-ness test;
`daily-onboarding-prompt.md` Step 9 (commit + push) added; the audit snippet in `handoffs/README.md`
fixed after it was found to be **silently broken**.

---

## 🔴 This is the third recurrence — and the prescribed fix had never been built

| Date | Backlog | Retro's prescribed fix | Built? |
|---|---|---|---|
| 2026-07-05 | 4 kennels | "teach `copy-newest-handoff.sh` to warn when >1 un-implemented handoff exists (or add an `--oldest` mode)" | ❌ |
| 2026-07-15 | 6 kennels | same, plus "the daily run must commit + push its output" | ❌ |
| 2026-08-11 | **20 kennels** | — | ✅ both, this PR |

Twice diagnosed correctly, twice written down as prose, twice not built — and the scale tripled each
time. The lesson isn't "diagnose better", it's **a process fix that lives only in a retro is not a
fix**. Everything in this pass is enforced in code or in the operating prompt.

---

## The three mechanisms (two were invisible)

### A. 🔴 The helper's implemented-ness test was inverted for exactly this case

`copy-newest-handoff.sh` judged a handoff implemented **solely** by whether `onboard/<code>-*`
existed on origin. A handoff that was never committed never gets a branch — so the test reported
every orphaned handoff as **already done**. The tool most likely to reveal the backlog was the one
guaranteeing it stayed hidden, and it got quieter as the backlog grew.

> **Fixed:** the authoritative test is now **seed presence** — every `kennelCode` in the handoff must
> appear in *both* `kennels.ts` and `sources.ts`. The branch check survives only as a secondary skip
> for in-flight work. The script also fails loud if the seed files are missing, rather than reporting
> everything as un-implemented.

### B. 🔴 The audit snippet published in `handoffs/README.md` was broken under zsh

This is the one that should sting. The README's remedy for the *previous* backlog was an inline
audit loop — and it silently under-reported:

- **zsh does not word-split unquoted variables.** `for c in $codes` bound all codes as a single
  newline-joined string instead of iterating.
- **`grep` treats an embedded newline as pattern-OR.** So `grep -c "kennelCode: \"dh3⏎donnington-h3\""`
  matched on `dh3` alone and returned nonzero.

Net effect: **any handoff mentioning more than one `kennelCode` false-passed as "shipped."** That is
precisely how `2026-08-07-donnington-h3` hid — its dedup prose cites `dh3` (Dublin H3, seeded) while
its real code `donnington-h3` was absent. The snippet was written for bash, pasted into a zsh shell,
and never tested against a known-bad case.

> **Fixed:** the README now points at `copy-newest-handoff.sh --list` as the audit, and the hand-run
> fallback is wrapped in `bash -c` with a `while read` loop. **Test an audit against a handoff you
> know is un-onboarded before trusting a clean result.** A green audit is a claim, not evidence.

### C. 🟡 The daily prompt explicitly forbade the fix

`daily-onboarding-prompt.md` ended with *"Never attempt git operations in this run."* The daily run
was doing exactly as instructed; the backlog was designed in, not an accident of discipline.

The constraint behind it is real and documented in *Why handoff, not direct PR* — the Cowork sandbox
often has the repo parked on a feature branch, and `.git/` writes have historically been
permission-blocked. So the new Step 9 is **best-effort, not assumed**: `fetch` → `stash` → `switch
--detach origin/main` → `stash pop` → diff-review → scoped `add` → `commit` → `push origin
HEAD:main`, and if any step fails, **report it loudly** rather than reporting success over untracked
output. (An earlier draft of this step used a plain `pull --ff-only` + `push`, which a feature-branch
mount would silently mis-target — caught and fixed via Codex + CodeRabbit review on this PR.)
Detection (A + B) is the durable fix; committing is the cheap one when the environment allows it.

---

## The near-miss: the rescue itself almost destroyed history

The main repo's working copies of `run-log.md` and `target-queue.md` were written on a **stale base**
(local `HEAD` was behind `origin/main`). Diffed against `origin/main` they showed **87 and 26 deleted
lines** — including the entire hc-batch-6 post-merge block and six `Outcome: SHIPPED` lines that had
been rewritten back to `handed-off — awaiting Claude Code build/PR`.

Copying those files wholesale — the obvious move, and what "rescue the untracked files" sounds like —
would have silently reverted real, verified history. Recovery needed a hand-built 3-way merge
(`git merge-file` against the stale base) with conflicts resolved per file:

| File | vs `origin/main` | Resolution |
|---|---|---|
| `source-platform-notes.md` | 452+ / **0−** | Strict superset → take working copy |
| `run-log.md` | 174+ / **87−** | 3-way merge: banners + new entries + `origin/main`'s SHIPPED statuses |
| `target-queue.md` | 107+ / **26−** | Superset in substance — verified **all 96** table rows survive |

> **Rule:** before rescuing untracked work, diff it against `origin/main` and **check the removal
> count, not just the addition count**. `N+ / 0−` is safe to take wholesale; anything with removals
> needs a real merge. Verify semantically too — for the queue, that every kennel row survives, not
> just that the line count looks plausible.

---

## What went right

1. **The handoffs themselves are excellent** — 20 complete, self-contained briefs with verified live
   samples, collision checks, field-fill tables, and pre-empted platform gotchas. The research half
   of this pipeline is working well; only the plumbing failed.
2. **The retro convention gave the rescue a free discriminator.** Because blocked handoffs get a
   retro (`2026-06-09-lima-h3`), "in seed **or** has a retro" cleanly separates *resolved* from
   *backlog* — so the dormant Lima source doesn't nag forever. That fell out of an existing
   convention rather than needing new state.
3. **Sibling-region sequencing was pre-noted in the handoffs.** Mickleover explicitly says "0
   `region.ts` edits if Quorn's East Midlands METRO merges first; else 2", and the Exeter METRO is
   shared by Devon Lunatics / City of Exeter / Isca. Batching wrote itself.
4. **`tamar-h3` deliberately avoided the `tvh3` code** because the pending Teign Valley handoff had
   reserved it — a cross-handoff collision check that held across 6 days of unimplemented work.

---

## TL;DR for the research prompt + platform notes

1. **🔴 A process fix that lives only in a retro is not a fix.** Same diagnosis, twice, unbuilt,
   3 → 6 → 20 kennels. Land it in code or in the prompt, or expect it back at triple scale.
2. **🔴 Test your audit against a known-bad case.** The published snippet returned clean while 20
   kennels sat unimplemented, and it was wrong in *two* independent ways (zsh word-splitting, grep
   newline-OR). A green audit is a claim, not evidence.
3. **🔴 Never judge "done" by an artifact the failure mode also suppresses.** Branch-existence can't
   detect never-committed work — the test and the bug shared a root cause.
4. **Diff removals before rescuing untracked files.** `N+ / 0−` is safe; removals mean a stale base
   and need a 3-way merge (the batch-6 history was one `cp` from being erased).
5. **Use `bash -c` for repo audit loops**, never the ambient zsh — and use absolute paths, since a
   silently-failing `cd` unsets later variables and inverts the result.
6. **Keep:** the handoff format itself, the retro-for-blocked-handoffs convention (it doubles as
   backlog state), and cross-handoff kennelCode reservation.
