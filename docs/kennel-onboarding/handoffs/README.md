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
