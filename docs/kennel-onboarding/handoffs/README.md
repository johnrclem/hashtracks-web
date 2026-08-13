# Onboarding Handoffs

The daily Cowork onboarding task writes one file here per run:
`<YYYY-MM-DD>-<kennelCode>.md`.

Each file is a complete, self-contained onboarding package — verified live source sample,
full kennel metadata (logo, founded year, socials, hash cash, schedule, description),
ready-to-paste seed blocks, adapter plan, historical-backfill assessment, end-time/coord/
pagination notes, and an embedded **`▶ FOR CLAUDE CODE`** directive **at the top of the file**.

## To implement one

Run `bash scripts/copy-newest-handoff.sh` to copy the newest un-implemented, non-voided handoff
to your clipboard, then paste the whole file as the first message into a fresh Claude Code
session in `hashtracks-web`. The top directive drives implementation through PR.

The copy helper skips:
- the `README.md` you're reading
- voided handoffs (any with `VOID` in the first ~5 lines)
- handoffs whose `onboard/<code>-*` branch already exists on origin (i.e. already implemented)

Once a handoff's PR is merged, you can delete the file (or leave it as a record).

## 🔴 Check for a backlog first — it has now bitten three times

Backlogs at escalating scale: **4 kennels** (2026-07-02→05, caught by the `2026-07-05` catch-up),
**6 kennels** (2026-07-10→15, shipped as HC batch-6), and **20 kennels** (2026-07-16→08-11, the
2026-08-11 rescue).

Three failure modes, all real, all now fixed in code rather than prose:

1. **The helper only surfaced the newest handoff**, so skipped days piled up silently.
   → `copy-newest-handoff.sh` now prints a **loud backlog banner** and grew `--oldest` / `--list`.
2. **Handoffs were never committed** (the batch-6 and 20-kennel root cause) — the daily run left its
   handoff + run-log + queue edits as *untracked files in one working tree*. `origin/main` never
   moved, so every other checkout saw a folder that looked complete. Worse, the helper judged
   "implemented" **solely by `onboard/<code>-*` existing on origin** — and a handoff that was never
   committed never gets a branch, so that test actively reported the backlog as done.
   → The helper's authoritative test is now **seed presence**; `daily-onboarding-prompt.md` Step 9
   now requires the run to commit + push (and to report loudly if the sandbox blocks it).
3. **The audit snippet published here was itself broken under zsh** (found 2026-08-11). zsh does not
   word-split unquoted variables, so `for c in $codes` bound *all* codes as one newline-joined
   string — and `grep` treats an embedded newline as **pattern-OR**, so the whole handoff matched if
   *any* code did. Every handoff mentioning more than one `kennelCode` false-passed as "shipped".
   That is exactly how `2026-08-07-donnington-h3` hid (it also mentions `dh3`, which is seeded).

**Just run the helper — it is the audit now:**

```bash
bash scripts/copy-newest-handoff.sh --list
```

It reports every actionable handoff, oldest-first, and copies nothing. A handoff counts as resolved
when it is in the seed **or** has its own retro (a documented live-verify block, e.g.
`2026-06-09-lima-h3`). It fails loud if the seed files are missing rather than reporting everything
as un-implemented.

If you want the raw check by hand, **run it under `bash`, not zsh**, and iterate with `while read`.
This mirrors `copy-newest-handoff.sh`'s two other checks too — it validates it's running from the
repo root (the paths below are relative) and skips any handoff that already has its own retro (a
documented live-verify block, e.g. `2026-06-09-lima-h3`), not just ones present in the seed:

```bash
bash -c '
[ -d docs/kennel-onboarding/handoffs ] || { echo "Run this from the repo root." >&2; exit 1; }
for f in docs/kennel-onboarding/handoffs/[0-9]*.md; do
  head -8 "$f" | grep -qi VOID && continue
  base="$(basename "$f")"; date_part="${base:0:10}"
  code_for_retro="$(echo "$base" | sed -E "s/^[0-9]{4}-[0-9]{2}-[0-9]{2}-(.+)\.md\$/\1/")"
  [ -f "docs/kennel-onboarding/handoffs/retros/${date_part}-${code_for_retro}-retro.md" ] && continue
  while IFS= read -r c; do
    [ -z "$c" ] && continue
    k=$(grep -c "kennelCode: \"$c\"" prisma/seed-data/kennels.ts)
    s=$(grep -cE "\"$c\"" prisma/seed-data/sources.ts)
    { [ "$k" -eq 0 ] || [ "$s" -eq 0 ]; } && echo "UN-ONBOARDED: $f :: $c"
  done < <(grep -oE "kennelCode: *\"[a-z0-9-]+\"" "$f" | grep -oE "\"[a-z0-9-]+\"" | tr -d "\"" | sort -u)
done'
```

Two more traps worth knowing:

- **Audit a synced tree.** `git fetch && git pull --ff-only` (or verify `git rev-parse HEAD` equals
  `git rev-parse origin/main` and abort otherwise — `git fetch` alone updates remote refs but leaves
  your checkout stale). Auditing a stale checkout produced a confident, wrong "0 kennels left to
  onboard" while six live kennels sat unimplemented.
- **Use absolute paths in tool-driven shells.** A `cd` that fails silently unsets later variables, so
  `grep` targets a nonexistent file and *every* handoff reads as un-onboarded — the inverse error,
  equally misleading.

Config-only handoffs of the same type (e.g. several `HARRIER_CENTRAL` rows) are best shipped as **one
batch PR** — see the hc-batch-4 / -6 / -10 precedent.

## Retros

Every implemented handoff gets a retro in [`retros/`](retros) — `<YYYY-MM-DD>-<code>-retro.md`, dated to
match the handoff — capturing what the handoff got right, the mid-implementation corrections, and the
research-prompt / platform-note improvements that feed the loop. **Batch handoffs share one retro**
(e.g. the four backlog-catchup kennels → `retros/2026-07-05-backlog-catchup-retro.md`; the HC batches →
`retros/2026-07-09-hc-batch-4-retro.md` and `retros/2026-07-02-hc-batch-10-retro.md`), so a handoff
without its own file may be covered by a batch retro of the same session/arc.

**Blocked handoffs also get a retro.** When a handoff is stopped at the live-verify gate (dormant / dead
source), write a "not-onboarded" retro documenting the block + its re-verification dates, and make sure
the target is recorded in [`../target-queue.md`](../target-queue.md) (Leads or **Blocked / dormant**)
so a refill re-check has an anchor — the run-log is append-only history, the queue is the working
backlog. Example: `retros/2026-06-09-lima-h3-retro.md`.

The [`../run-log.md`](../run-log.md) top block is the source of truth for overall completion status
(which handoffs shipped, which stay blocked).
