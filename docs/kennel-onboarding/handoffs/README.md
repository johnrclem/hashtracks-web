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

## 🔴 Check for a backlog first — it has bitten twice

`copy-newest-handoff.sh` only ever surfaces the **newest** un-implemented handoff, so skipped days pile
up silently. This has now caused two multi-kennel backlogs: **4 kennels** (2026-07-02→05, caught by the
`2026-07-05` catch-up) and **6 kennels** (2026-07-10→15, shipped as HC batch-6).

Two failure modes, both real:
1. **Handoffs generated but never implemented** — the newest-only helper hides the older ones.
2. **Handoffs never committed** (the batch-6 root cause) — the daily run left its handoff + run-log +
   queue edits as *untracked/uncommitted files in one working tree*. `origin/main` never moved, so any
   other checkout saw a folder that looked complete. **The daily run must commit + push its output.**

Before implementing, audit rather than trusting the helper:

```bash
# Untracked handoffs the repo doesn't know about yet (the batch-6 trap):
git status --short docs/kennel-onboarding/

# Which handoffs are genuinely un-onboarded? A code must appear in BOTH seed files.
for f in docs/kennel-onboarding/handoffs/[0-9]*.md; do
  head -5 "$f" | grep -qi VOID && continue  # VOID marker sits in the first ~5 lines
  for c in $(grep -oE 'kennelCode: *"[a-z0-9-]+"' "$f" | grep -oE '"[a-z0-9-]+"' | tr -d '"' | sort -u); do
    k=$(grep -c "kennelCode: \"$c\"" prisma/seed-data/kennels.ts)
    s=$(grep -cE "\"$c\"" prisma/seed-data/sources.ts)
    { [ "$k" -eq 0 ] || [ "$s" -eq 0 ]; } && echo "UN-ONBOARDED: $f :: $c"
  done
done
```

Run it against a **synced** tree — `git fetch && git pull --ff-only` (or verify
`git rev-parse HEAD` equals `git rev-parse origin/main` and abort otherwise; `git fetch` alone updates
remote refs but leaves your checkout stale). Auditing a stale checkout is what produced a confident,
wrong "0 kennels left to onboard" while six live kennels sat unimplemented.
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
