# Cowork Handoff Retro — Lima H3 (Lima, Peru) — ⏸️ NOT ONBOARDED (source dormant) — 2026-06-09

Retro for the `2026-06-09-lima-h3.md` handoff — HashTracks' would-be **first Peru kennel** (the only
hash in Peru). **No PR / no code / no seed shipped.** The handoff's own mandatory, blocking live-verify
gate failed at build: the source blog is reachable but **dormant**, and per the no-dormant-source
standard the kennel was correctly **not onboarded**. This retro records the block, the completeness of
the record, and the re-verifications — so the target isn't silently forgotten and can be picked up the
day a live Lima source appears.

**PR produced:** none (blocked at the gate — this is a "did not ship, on purpose" retro).

**Outcome:** NOT ONBOARDED. The handoff made local `fetchBloggerPosts` recency the gating step (the
research sandbox couldn't reach `limahashash.blogspot.com` by any method, but the user confirmed the
blog exists). From local env the keyed Blogger API v3 **reached** the blog (blogId
`4935356690439854808` — not deleted/private), but it is **dormant**: newest post **Hash 765,
2023-09-07**, only **8 posts total** (2018→2023, EN/ES recap pairs → ~6 distinct runs). The kennel runs
every other Saturday, so "recently active" = a run within ~4 weeks; the newest was ~33 months old. The
handoff's explicit *"if the newest post is months old, STOP and report back rather than shipping a
dormant source"* rule fired → aborted, no seed/code/region/PR.

---

## Re-verification history (the gate keeps holding)

| Date | Method | Newest post | Verdict |
|---|---|---|---|
| 2026-06-10 | local `fetchBloggerPosts(url, 12)` | Hash 765 · 2023-09-07 (8 posts) | **dormant → not onboarded** |
| 2026-07-09 | primary blog + `limahash.com` sibling re-check | blog #765 2023-09-07 (~1036d); sibling last real post 2024-02-10 (~881d) | **still dormant → stays blocked** |
| 2026-07-15 | local `fetchBloggerPosts(url, 10)` (keyed Blogger API v3) | Hash 765 · 2023-09-07 (~1042d, 8 posts) | **still dormant → stays blocked** |

The 2026-07-15 check (this completion sweep) reproduced the exact same 8-post archive, newest **Hash 765
"Rincones y recovecos" · 2023-09-07** (then Hash 749 2023-01-22, Hash 743 2022-10-17, Hash 736
2022-07-11 EN/ES pair, Hash 725 2022-02-08). No new posts in ~2.9 years. **Both** Lima hashes remain
dead as scrapeable sources: the primary blog `limahashash.blogspot.com` (Saturday kennel) **and** the
sibling `limahash.com` (Lima Extra Miércoles, monthly Wednesday, last real post Feb 2024).

---

## What the handoff got RIGHT (keep doing)

1. **Made LOCAL live-verify the blocking gate, not sandbox reachability.** The sandbox got empty bodies
   by every method (Blogger JSON feed, HTML, `?m=1`, `site:` search = 0 indexed, Chrome domain denied,
   JSONP CSP-blocked) — which looks like "dead," but the user knew the blog existed. The handoff refused
   to conclude "dead" from sandbox silence and pushed the real check to Claude Code's local env, which
   **can** reach Blogspot. That was exactly right: "unreachable from the sandbox" ≠ "dead."
2. **But the gate checked RECENCY, not just reachability.** The keyed API *did* return data — a naive
   "got posts → ship it" would have onboarded a directory tombstone whose newest run is nearly 3 years
   old. Requiring "newest run within ~2× the cadence" is what caught it. Reachable ≠ active.
3. **Full dedup + region + seed work pre-staged, so a future revive is cheap.** Sitemap dedup (436
   slugs, no `lima`/`peru`), `kennelCode: lima-h3` collision check (bare `lh3`=London → descriptive
   suffix; bare "LH3" alias omitted), the 5-edit Peru-COUNTRY / Lima-METRO `region.ts` block (rose
   palette), and the ready-to-paste seed are all in the handoff. The day a live Lima source appears the
   onboard is mechanical.
4. **Sibling sweep kept the two Lima hashes distinct.** Lima Hash (this target, Saturday, Blogspot) vs
   Lima Extra Miércoles (`limahash.com`, monthly Wednesday, WP REST works but 1 post) were correctly
   NOT bundled — separate kennels, separate future targets.

---

## Queue record — already good (a correction to an earlier draft of this retro)

An earlier draft of this retro asserted that Lima "was never actually written into `target-queue.md`"
and proposed adding **Blocked / dormant** rows. **That was wrong** — it was written against a stale
checkout. `target-queue.md` already documents *both* Lima hashes properly, in the **Leads** section:

- **Lima H3** — "⏸️ **DORMANT, do not onboard (build-verified 2026-06-10)**", with the blogId, the
  keyed-vs-public-feed distinction, the exact staleness (Hash 765, 2023-09-07, ~33 mo, 8 posts), the
  recency-gate failure, *and* the confirmed post structure for a future revival (bilingual EN/ES,
  `Hash NNN - <theme>` titles, Spanish labels `Cuota de Hash:` / `Liebres:` / `Punto de inicio:`,
  `D de <mes> de YYYY` dates).
- **Lima Extra Miércoles** — the sibling, with its working-but-dormant WP REST endpoint, its dead
  Meetup, and the conclusion "**Both Lima hashes dormant → no live Peru source yet.**"

No queue edit is owed; adding Blocked-table rows would only duplicate a better record. The real lesson
is the meta one below.

> **Process note:** verify a claimed documentation gap against a **synced** working tree before
> "fixing" it. This retro's own first draft invented a gap that didn't exist because it was written from
> a worktree that predated the daily runs' (uncommitted) queue updates — the same stale-checkout trap
> that hid six un-onboarded kennels for six days (see `2026-07-15-hc-batch-6-retro.md`).

---

## TL;DR

- **Lima H3 was never onboarded — correctly.** The source blog is reachable but frozen at Hash 765
  (2023-09-07); re-verified dormant three times (2026-06-10, -07-09, -07-15). No live Peru source exists
  (the Extra Miércoles sibling is dormant too).
- **The recency gate did its job** — "reachable from local env" is necessary but not sufficient; the
  newest-run-within-cadence check is what prevents shipping a dormant directory entry.
- **Everything's staged for a cheap revive** — dedup, Peru region 5-edit, and seed are in the handoff;
  onboard the day a structured live Lima source (blog resumes / new Meetup / FB-events feed) appears.
- **No queue edit owed** — `target-queue.md`'s Leads section already carries a full dormant record for
  both Lima hashes (an earlier draft of this retro claimed otherwise; it was written from a stale
  checkout). Verify a claimed doc gap against a synced tree before "fixing" it.
