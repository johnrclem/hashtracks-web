# VOID — duplicate handoff (Kaohsiung H3 already shipped 2026-06-14, PR #2196)

**Do not implement this file.** It was generated in error on 2026-06-15 by a daily run whose
sandbox was parked on a stale branch (`docs/taipei-h3-ship`, 69 commits behind `origin/main`).
Kaohsiung H3 was already fully onboarded and **SHIPPED 2026-06-14 (PR #2196)** — live at
`/kennels/kaohsiung-h3` with `src/adapters/html-scraper/kaohsiung-hash.ts`, the Kaohsiung METRO
region, seed rows, self-hosted logo, and 2 events (#2732, #2734). The authoritative records are
`docs/kennel-onboarding/handoffs/2026-06-14-kaohsiung-h3.md` and its retro on `main`.

Root cause: the working tree was stale, so dedup against `seed-data/` saw no Kaohsiung; the live
sitemap correctly showed `kaohsiung-h3` live, but "live page + 0 events + absent from (stale) seed"
was misread as a manual entry needing a source-add. No action required — this is a no-op.
