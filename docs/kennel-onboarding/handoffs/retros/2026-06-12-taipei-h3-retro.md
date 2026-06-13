# Cowork Handoff Retro — Taipei H3 (🇹🇼 台北捷兔, Taiwan's oldest hash, est. 1973) — 2026-06-12

Feedback from the Claude Code implementation session for the `2026-06-12-taipei-h3.md` handoff — a
**NEW `TaipeiHashAdapter`** (HTML_SCRAPER, static Cheerio over the SSR'd PHP `run_site.php`, **not**
config-only) + seed + self-hosted logo, with **zero `region.ts` edits** (Taipei METRO + Taiwan
COUNTRY already on `main` from Taiwan H3 #2107). The 2nd Taipei-area kennel after the live Taiwan H3.

The handoff was **exceptionally high-fidelity** — the hard part (the run-number-anchored year
inference) was specified in full and held exactly; the divergences were all *additive discoveries*
from the real DOM (which the handoff explicitly flagged the research sandbox couldn't capture), plus
a long, productive bot-review round that hardened the adapter and **spun one out-of-scope finding
into its own PR**.

**PRs produced:**
- Onboarding (adapter + tests + seed + self-hosted logo): [PR #2170](https://github.com/johnrclem/hashtracks-web/pull/2170) (merged). 4 commits — onboard, Maps-selector resilience, test-smell cleanups, real-`Response` mock.
- Follow-up (shared infra, spun out): [PR #2176](https://github.com/johnrclem/hashtracks-web/pull/2176) (merged, closes [#2174](https://github.com/johnrclem/hashtracks-web/issues/2174)) — default `AbortSignal.timeout(45s)` on `safeFetch`'s direct-fetch branch.
- Docs (this retro + run-log → SHIPPED + a Taipei platform note): this PR.

**Outcome:** Live at https://www.hashtracks.xyz/kennels/taipei-h3 — **27 canonical Events** (#2756
2026-01-03 → #2782 2026-07-04, weekly Saturday 15:00). Live-verify before CI returned all 27 with
**correct year resolution across the deep history** (#2756 → 2026-01-03, NOT 2027), 0 unmatched
tags, 0 PII phone leaks, 27/27 Maps shortlinks. Post-merge from the **worktree** on prod `.env`:
`prisma generate` → `db seed` (additive — kennel/5 aliases/source, no new regions) →
`scrapeSource()` → **eventsFound 27 / created 27 / 0 unmatched / 0 blocked / 0 errors**.

---

## The loop is working — previous retro fixes LANDED

1. **kennelCode/alias collision discipline (Taiwan H3 / Lisbon / Budapest retros).** Handoff led with
   the bare-`TH3` global collision (Tidewater/Thirstday/Tacoma/Tokyo) → `kennelCode: taipei-h3` (clear)
   + bare-`TH3` alias **omitted**, with the kennelCode-exact-precedes-alias rationale. Landed exactly.
2. **`<ext>` logo placeholder, confirm via magic bytes (ah3-nz / Budapest / Taiwan H3 retros).** Asset
   was a genuine JPEG (`\xff\xd8` + `image/jpeg` Content-Type + `file` confirmed) → `/kennel-logos/taipei-h3.jpg`.
3. **Split adapter-verify from post-merge seed (ZH3 / Budapest / Taiwan H3 retros).** Structured exactly
   so — `adapter.fetch()` (no DB write) pre-PR confirmed 27 events; `db seed` + `scrapeSource` as a
   separate post-merge runbook. Landed.
4. **Worktree-`@/`-alias for live-verify scripts (worktree-relative-import memory).** The throwaway
   live-verify `tsx` script lived under `scripts/` (in-worktree) and imported via the `@/` alias — no
   `../../../` escape to the main repo. Verified clean.
5. **CJK / region work pre-done (Taiwan H3 retro).** Taipei/Taiwan + the CJK `COUNTRY_INFERENCE_RULES`
   branch shipped with Taiwan H3 — the handoff correctly said "do NOT touch `region.ts`". Zero edits.

---

## What the handoff got RIGHT (keep doing)

1. **🔴 The run-number-anchored year-inference spec was the headline — and it was dead-on.** Year-less
   `MM/DD` dates over a ~6-month window that *includes ~23 past runs*; a naive today-anchored
   bidirectional rollover ("past >60d → +year") would shove every Jan/Feb history row a full year into
   the future. The handoff prescribed the exact fix: anchor on the run nearest today, expect each row
   at `anchorDate + (runNumber − anchorRun) × 7d`, resolve the year to the candidate (`y−1/y/y+1`)
   nearest that expectation with a `Date.UTC` round-trip. Implemented verbatim; live-verify proved
   #2756 (01/03) → 2026-01-03, not 2027. **This is the reusable learning** (→ platform note + memory).
2. **Flagged the sandbox couldn't capture raw markup → "build the fixture from the real DOM".** Exactly
   right: the real `run_site.php` markup made the adapter *simpler* than the inferred shape — the phone
   is in a dedicated `<span class="phone">` (precise `.remove()` beats a regex), and the mobile-card
   duplicates use `div.mobile-event-card`, **not** `<td>`, so parsing `<table>` rows naturally skips
   them (the dedup-by-run-number Map became belt-and-suspenders, not the primary defense).
3. **PII phone strip + fail-loud zero-event guard flagged up front.** Both implemented; the guard
   pushes an `errors[]` + `errorDetails.parse` entry so a markup drift can't "succeed" with `events: []`
   and let `reconcile` cancel live runs (a brand-new source has a 0 baseline the health alert misses).
4. **`upcomingOnly: true` + the reconcile rationale.** Rolling ~6-month window → history rows age off;
   `upcomingOnly` keeps `reconcile.ts` from false-cancelling them. Correct.
5. **The Saturday-vs-Sunday discrepancy pre-resolved.** Editorial directories say Sunday; the kennel's
   own current hareline + live run dates are Saturday → seeded Saturday, discrepancy noted in
   `scheduleNotes`. (Operational reality over stale directories — same instinct as Taiwan H3's 1975-vs-1976.)

---

## Handoff GAPS → research-prompt / process improvements (the actionable part)

### A. 🟡 The handoff's start time was right; a *reviewer's* "correction" was the false positive — but it's a recurring sibling-confusion trap

Codex posted a **P2 "set Taipei runs to 2:30 PM"** claiming the live page said `每星期六下午 2:30`.
The live page actually says `每星期六下午 **3:00** 起跑`; the only `2:00` is the suggested early-arrival
warm-up time. Codex had conflated Taipei H3 with its **sibling Taiwan H3** (`twh3-tw`), whose seed
*does* say "hares off at 14:30". Declined with the verbatim page text + the sibling explanation; thread
resolved. No code change — `15:00` was correct.

> **Prompt note:** when two kennels share a metro and a near-identical name (Taipei H3 / Taiwan H3,
> and the queued New Taipei H3), expect reviewers (and scouts) to cross-contaminate their schedule /
> founding / socials. The handoff already did the right thing — it explicitly warned "the `@HashTaiwan`
> Twitter + `taiwanhash.com` belong to the *sibling* Taiwan H3 — do NOT reuse them here." Keep adding
> that **"do-not-confuse-with-sibling" callout** for same-metro near-namesakes, and verify any
> reviewer schedule "correction" against the kennel's *own* page before acting.

### B. 🟡 A new raw-`fetch(variable)` line trips Codacy's critical SSRF rule — even inside the SSRF-guard file

The CodeRabbit-suggested Maps-selector broadening + later the `safeFetch` edit both touched lines that
do `fetch(<variable>)`. Codacy flagged the `safeFetch` one as **1 critical Security (SSRF)** — on the
very file whose *job* is SSRF protection (`validateSourceUrlWithDns` runs before the first fetch and
after every redirect target). It's flagged only because the PR *touched* the line (Codacy scopes to the
diff). Cleared with a bare `// nosemgrep` + a justification comment, matching the repo's existing
suppression precedent (`meetup/adapter.ts`, `hare-extraction.ts`). Codacy is **non-blocking**
(UNSTABLE+MERGEABLE), but clearing it keeps the security gate honest.

> **Prompt note:** any PR that adds or moves a `fetch(<non-literal>)` call (new HTML adapters that fetch
> a constructed URL, edits to `safe-fetch.ts`) should expect a Codacy/Semgrep **critical SSRF** flag on
> that line. If the URL is validated (it always is, via `safeFetch`/`validateSourceUrlWithDns`), suppress
> with a bare `// nosemgrep` + a one-line justification — don't churn. (→ memory.)

### C. 🟢 Test-file convention nits are cheap and reviewers WILL flag them — bake them into the first write

Both SonarCloud (S7721 "hoist `buildSource`", S4325 "redundant `as Response`") and CodeRabbit/Claude
(drop the explicit `vitest` globals import; use `@/` aliases) flagged the new test file. All trivially
fixed, but they cost an extra two review→push cycles. Notable: the S4325 cast was **required by tsc**
(the partial mock isn't assignable to `Response`) yet **flagged by Sonar** — the clean resolution that
satisfies both is to build a **real** object: `new Response(html, { status: 200 })`, no cast at all.

> **Prompt note:** new `*.test.ts` files must follow the repo conventions from the first write — **no
> explicit `vitest` import** (`globals: true`), **`@/` aliases** for cross-module imports and `vi.mock`
> targets, and **hoist helper fns to module scope** (S7721). For a `fetch` mock, return
> `new Response(body, { status })` rather than a partial-shape `{...} as Response` (dodges S4325 +
> the tsc-vs-Sonar cast conflict).

---

## Implementation / process learnings (loop context)

1. **🔴 A CodeRabbit "fix" can be correct but OUT OF SCOPE — spin it out, don't bloat the onboard.**
   CodeRabbit flagged that `safeFetch`'s *direct-fetch* branch has no default request timeout (only the
   residential-proxy branch does) — a real bug affecting **every** HTML-scraper adapter via
   `fetchHTMLPage`. Fixing it in the Taipei PR would have been a cross-cutting change unrelated to the
   kennel. Declined-on-this-PR with that rationale, tracked it (a `spawn_task` chip + accepted
   CodeRabbit's offer to open [#2174](https://github.com/johnrclem/hashtracks-web/issues/2174)), and
   shipped it as its own [PR #2176](https://github.com/johnrclem/hashtracks-web/pull/2176). The
   scope-discipline call kept the onboard reviewable and gave the infra fix its own focused review.
2. **🔴 Running `scrapeSource()` from a standalone script does NOT bust the page's ISR cache.** Same
   `after()` / `revalidateTag … no request scope` no-ops as prior retros — but the added nuance: the 27
   events were written to prod, yet `/kennels/taipei-h3` may not *show* them until the ISR TTL expires or
   the next **request-context** scrape (the daily cron) revalidates. Verify via a prod **DB query**
   (authoritative), not the live page, immediately post-scrape; tell the user the page may lag.
3. **🟢 Live-verify proved END-TO-END before CI** — `adapter.fetch(source, {days:365})` returned 27
   events with correct UTC-noon dates, `15:00`, `kennelTags=["taipei-h3"]`, 0 errors, deep-history year
   resolution confirmed — before tsc/lint/test and before any DB write.
4. **🟢 Review gates: one false positive (Codex 2:30), the rest real + cheap.** Maps-selector broadening,
   `parseMapsUrl` host/scheme allowlist, malformed-row parse diagnostics, host-anchored registry regex,
   test conventions — all applied with tests; the SSRF flag suppressed with justification. Each inline
   thread got a one-line reply + resolve.
5. **🛑 A real ops hazard surfaced: a system-wide `fork: resource temporarily unavailable` lockup.**
   During post-merge, the **whole Mac mini** ran out of process slots (`maxprocperuid`) — even the
   user's *own* shell couldn't `fork` git/`ps`/`kill`. Almost certainly leaked `esbuild`/`vitest`-worker/
   `node` helper processes accumulating across the session's many `tsx`/`vitest`/retry-loop runs (every
   `tsx`/`vitest` spawns a persistent esbuild service child). Recovery was a **reboot** (Apple-menu →
   Restart works without a shell fork). Mitigation adopted mid-session: run vitest with **`--pool=threads`**
   (worker threads, not forked child processes) — it kept passing tests while forks were starved.

> **Prompt note (ops):** for long sessions with many `tsx`/`vitest` invocations, prefer
> `vitest run --pool=threads` and avoid tight retry loops that spawn processes — they leak esbuild/node
> helpers and can exhaust the machine's process table. If `fork: resource temporarily unavailable`
> appears (even in the user's own terminal), it's `maxprocperuid`, not the sandbox — reboot or quit the
> browser/heavy apps to reclaim slots.

---

## TL;DR for the research prompt + platform notes

1. **Run-number-anchored year inference is the reusable win.** For any year-less `MM/DD` hareline that
   ships *deep history* on one page (Taiwanese `.php`/`.htm` cousins, and any weekly kennel), anchor the
   year on the **run number** (`anchorMs + (run − anchorRun) × 7d`), never a today-anchored rollover.
   (→ platform note added; memory `reference_runnumber_anchored_year_inference`.)
2. **Same-metro near-namesakes (Taipei H3 / Taiwan H3 / New Taipei H3) cross-contaminate reviews.** Keep
   the handoff's explicit "do-not-confuse-with-sibling" callout for schedule/founding/socials, and verify
   any reviewer schedule "correction" against the kennel's own page.
3. **A new/moved `fetch(<variable>)` line → expect a Codacy critical SSRF flag; suppress with a justified
   `// nosemgrep`** when the URL is `safeFetch`-validated. Don't churn (Codacy is non-blocking).
4. **New test files: `globals: true` (no vitest import), `@/` aliases, module-scope helpers, and a real
   `new Response(...)` mock** (not `{...} as Response`) — pre-empts S7721/S4325 + the CodeRabbit nit.
5. **Out-of-scope review findings get their own PR + issue** — don't bloat the onboard (safeFetch → #2176/#2174).
6. **Keep:** the run-number year-inference spec, the "build the fixture from the real DOM" instruction,
   the PII strip + fail-loud single-page guard, `upcomingOnly` for rolling windows, kennelCode/alias
   collision discipline, the split adapter-verify / post-merge-seed runbook, and the prod-DB-query
   (not live-page) post-scrape verification.
