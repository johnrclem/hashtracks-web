# HashTracks triage plan, refreshed 2026-11-06

Sources: the 12 workstream handoff notes, prod data (read-only) and the open GitHub issues and PRs, all checked 2026-11-06. This replaces the 9-item to-do list from earlier today; all 9 items are folded in below.

## 1. Where we are

**Original 8-step November triage:** done. Done since then:
- Restored the falsely cancelled runs.
- Fixed Oregon routing.
- Shipped `upcomingOnly` for 43 sources.
- Fixed Bangkok by fetching it through the browser render.

**This week's parallel wave:** 12 sessions. All their PRs are merged and all 12 sessions are archived.

| Workstream | Result |
|---|---|
| Issue backlog: HTML A–S, HTML S–Z, GCal/Sheets, HC/Meetup, profile/product | 145 → 31 open issues. All prod cleanups applied with owner OK. |
| Onboard UK SW | 10 kennels live. 2,742 history events. |
| Onboard UK Midlands/SE | 9 kennels live. Backfills **applied**: Surrey 257, Donnington 2,358, Quorn 326, Cambridge 1,040, MKH3 1,865, Oxford 515, NH4 53. *(Correction: I said earlier these were still waiting on you.)* |
| Onboard international | 15 kennels live across 8 new countries. Backfills applied for JAH3 547, Subic Bay 92 and Puerto Galera 951. |
| Onboard HC batch | 13 kennels. 158 history events. Travel rules for 5 of them (#2766). |
| Onboard iCal/Meetup | 4 kennels. Malvern +1,190, Chichester +1,047, Basel +15. |
| Rewrite 5 scrapers + silent-zero triage | New Taipei, Bangkok trio, STH3, Victoria and Mother Hash rewritten. WCFH disabled. Dayton H3 onboarded. |
| HC/Meetup backfills | HC gaps 512, ZH3 1,409, WSH3 287, Richmond 1,391 |

**Onboarding handoff backlog:** 52 → **3**. The remaining three are Athens (stale page), Guam (stale sheet) and Hanoi Hash (empty widget); all were skipped on purpose.

## 2. Live snapshot (prod, read-only, 2026-11-06)

| Area | Number | What it says |
|---|---|---|
| Open alerts | 20 | 8 are from the last 2 days (after this week's changes). **12 have sat open for 2–5 months** (May–Sep). |
| Open GitHub issues | 31 | 2 new today from audits: #2756 Hollyweird geocode, #2757 Taiwan title. |
| Open PRs | 1 | #1026, from April (travel polish). |
| Chrome kennel deep-dive | last run **2026-07-10** | Dead for 4 months. 474 active kennels: 73 never deep-dived, **460 not deep-dived in the last 120 days**. |
| Chrome daily hareline audit | last draft 2026-07-06 | Dead too. The server-side HARELINE cron still runs daily: 13–15 findings a day, but it files 0–2 issues. |
| Audit issue mirror (`/admin/audit`) | synced 12:31 today | Healthy. Its GitHub token works. |
| Strava | 3 connections, **last sync 2026-06-08** | No new activities in 5 months. Users are still logging attendance (the latest was today), so sync is very likely broken. |
| Prediction ledger | 1,391 HIT / 475 MISS / 840 UNOBSERVED / 1,938 PRECONFIRMED / 7,696 PENDING | Weekly snapshots are running: about 575 a week. |
| Onboarding routine | disabled | The re-enable condition (backlog < 10) is now met, but the trigger prompt was never updated. The queue has **0 `queued` rows**. |

### Prediction results (the question "do far-out predictions work?")

Precision = HIT ÷ (HIT + MISS), matched within ±1 day.

| Confidence | 30-day horizon | 90-day horizon | How early we predicted it vs. when the kennel posted it (90d, median) |
|---|---|---|---|
| HIGH | 70.4% | 72.1% | **51 days before** it appeared; kennels post about 39 days ahead |
| MEDIUM | 73.2% | 79.6% | **58 days before** it appeared; kennels post about 33 days ahead |

**Verdict:** the idea works. At the 90-day horizon, about 3 in 4 predictions come true. On median, we predicted the run roughly **8 weeks before it appeared** on any source.

Problems:
- **Calibration inversion still holds.** HIGH is *less* accurate than MEDIUM, because HIGH rules come mostly from STATIC_SCHEDULE.
- **Six kennels have 0 hits and 13–23 misses each**, with rules that are simply wrong:
  - clh3-sd, ljh3, nch3-sd (SDH3 family)
  - bjh3
  - philly-h3
  - gsh3
- **The 180-day horizon is unproven.** Its first scores mature on **2026-12-06**.
- **Measurement caveat:** "appeared" means `Event.createdAt`. Kennels onboarded after the snapshot inflate the lead time.

## 3. The full list

IDs are stable; the priorities and workstreams below refer to them.

### A. Kennel audits and automation (new)
- **A1. Find out why both Chrome audits stopped in early July.** Locate the Claude-in-Chrome scheduled tasks, and turn them off once Cowork replaces them.
- **A2. Move the daily hareline audit into Cowork:** a scheduled task that uses its own browser.
- **A3. Run a kennel deep-dive every 5 hours in Cowork,** one kennel per run, from `getDeepDiveQueue` (never-dived first, then oldest).
  - The agent should *read* in the browser and *write* only to the first-party queue.
  - Add a token-authenticated "next kennel + prompt" endpoint, and accept that token on `submit-finding`, so no Clerk session or UI clicks are needed.
  - Spike it with one "Run now" before scheduling. In July an unattended agent refused admin writes.
- **A4. Prioritize the deep-dive queue:**
  - The 73 never-dived kennels and the ~60 kennels onboarded this week go first.
  - At 5 a day, a full cycle of 474 kennels takes about 95 days.
- **A5. Check why the server HARELINE audit finds 13–15 issues a day but files 0–2:** suppression and dedupe working as designed, or a filing problem?
- **A6. Review the open audit issues on `/admin/audit`:** 22 chrome-kennel, 3 chrome-event and 1 automated. They overlap section F.

### B. Daily kennel search and onboarding (new)
- **B1. Review what's working.**
  - Working:
    - Research quality is high: handoffs became live kennels with large history backfills.
    - Parallel batch implementation by adapter type cleared 49 handoffs in about 2 days.
  - Not working:
    - Delivery through git in the live checkout.
    - Duplicate handoffs.
    - No-op loops.
    - Queue refill needs an interactive browser.
- **B2. Decide where research runs:** the RemoteTrigger bound to the Mac mini, or a Cowork scheduled task. Cowork's built-in browser can do the sitemap reads, JS-rendered source checks and queue refill that blocked unattended runs.
- **B3. Re-enable it:**
  - Apply the redesign's trigger prompt (temp clone, GitHub PR delivery, Step 0 preflight).
  - Do one "Run now" and check it.
- **B4. Refill the queue:** 0 `queued` rows and 60 `verify-live-first` rows. This needs a browser session.
- **B5. Close out the last 3 handoffs:**
  - Guam: add a fixed-schedule fallback, or drop it?
  - Athens: re-check its page later.
  - Hanoi Hash: void it.
- **B6. Run `/update-sources-rule`** now that every wave PR is merged.
- **B7. Post-onboarding rechecks:**
  - coeh3, tvh3 and the 10 HC kennels with no upcoming runs yet.
  - The 4 iCal/Meetup sources after a day of scrapes.
- **B8. Consider redesign option E:** let the routine implement config-only handoffs instead of only researching them.

### C. Predictions (new)
- **C1. Fix or demote the 6 zero-hit rules:**
  - clh3-sd, ljh3, nch3-sd, bjh3, philly-h3 (all MEDIUM, from seed data)
  - gsh3 (HIGH, from STATIC_SCHEDULE)
  - Payoff: overall precision would rise from about 74.5% to about 79.4%.
- **C2. Fix the HIGH < MEDIUM inversion:** cap rules derived from STATIC_SCHEDULE at MEDIUM, or re-derive them from independent history.
- **C3. Add the lead-time metric to `/admin/predictions`** ("predicted N days before posted"), excluding kennels onboarded after the snapshot. It's the clearest proof the feature works.
- **C4. Report UNOBSERVED (840) separately per kennel.** These kennels have no independent source to verify against.
- **C5. Review the 180-day horizon after its first scores mature on 2026-12-06.**
- **C6. Build recall** ("Change 2", deferred since June).
- **C7. Add schedule rules for this week's ~60 new kennels.** Only 5 have Travel rules today.
- **C8. Check the weekly rule-drift finding** (1 per week) is filed and handled.

### D. Strava (from the to-do list)
- **D1. Diagnose the stall.**
  - Every connection's `lastSyncAt` is 2026-06-08, and no activities were added after that date.
  - Check:
    - Sentry for Strava errors
    - token refresh in `src/lib/strava/client.ts`
    - what triggers sync
    - whether Strava's API terms changed
  - Before fixing, decide whether 3 connected users justify the effort.
- **D2. Fix and verify with your own account,** including that the logbook match suggestions show up.

### E. Alerts (20 open)
- **E1. Triage the 8 new alerts:**
  - STL H3 scrape failure (goes with G1)
  - Oregon and TDH3 event-count anomalies (Oregon is expected after the routing split, so reset its baseline)
  - Hanoi and Saigon fill drops, plus Hanoi excess cancellations (after the #2713 rewrites)
  - Sacramento and LSW excess cancellations
  - Kaohsiung fill drop
- **E2. Decide on the three stale Facebook failures** (Von Tramp since Sep; SOH4 and Survivor since Jul): disable those FB sources, or keep failing loud?
- **E3. Resolve or close the five May–Jun alerts:** Boise, Princeton and West of England kennel mismatches; Boston and ONH3 unmatched tags.
- **E4. Stop alerts going stale:** add a weekly alert sweep, either to the A2 automation or as a digest issue.

### F. GitHub issues (31 open)
- **Approved features:**
  - Queens split #2650
  - Dublin routing #2759
  - Event-fields umbrella #2711, which covers on-after (#2334, #2336, #2446) and #2438, #2223
  - Rumson FB posts #2147
  - Multi-day in-progress shown as past #2452
- **Adapter fixes with known causes:**
  - #2615 Boston hares (trailing-role terminator)
  - #2423 Bombay hash cash (drop the ₹1000 floor)
  - #2591 Newcastle (Sheets `dayFirst` option)
  - #2302 SCH4 hares (hashingstats.com times out from the dev box)
  - #2501 Pinelake on HashRego
  - #2757 Taiwan title
  - #2756 Hollyweird geocode
- **Coverage gaps:**
  - Tampa kennels #2465 #2346 #2342 (the WCFH calendar is dead)
  - #2315 SLOH3
  - #2428 VTH3 Strava link and HashVermont
  - #1526 Hibiscus profile
  - #1353 IndyScent detail pages
- **Owner decision:** #2516 sch3-atl vs soco-h3.
- **Deep history / park-or-close:**
  - #2400 Taipei Drive
  - #2053 LBH-PHX
  - #2048 Lisbon
  - #1131 BTH3 archive
  - #1942 JB H3 verify
  - #102 Photo feedback

### G. Data cleanups and carry-overs
- **G1. STLH3:**
  - Add `upcomingOnly` and restore the 22 cancelled past runs.
  - Fix the mis-dated Nov 8 row.
  - Covers the open alert.
- **G2. VBFMH3:** two "VB Full Moon" rows on Sep 25.
- **G3. Same run number on back-to-back days:** ih3 #1128 and phnom-penh-h3 #1849. Check whether the #2720 pattern fixes them.
- **G4. BCH3:** past Jul–Oct runs are stored at 20:00 instead of 19:00. Its profile rules also still say "Summer Thu / Winter Fri" (should be Thursday all year).
- **G5. Bangkok:** confirm the 53 BTH3 and 12 BFMH3 past runs cancelled before `upcomingOnly` were restored.
- **G6. Merge bug:** it keeps a stale synthesized title when the run number shifts (Larrikins #2520/#2521, Himalayan, P2H3).
- **G7. HK H3:** a stale homepage stamps the same run number on several Mondays.
- **G8. Disable candidates from the silent-zero triage:**
  - LVH3-Cin GCal
  - BDSM Meetup
  - HV Meetup
  - Richmond GCal
  - MVH3 GCal
  - Upstate website
  - Mooloo
- **G9. Profile decisions:**
  - Divahhh #39 start 09:30
  - Disable the SFFMH3 lunar static source
  - `stravaUrl` field (#2428)
  - t3h3-nz notes should say "1st+3rd Thursday"
  - Guam/Athens (B5)
- **G10. Product gap:** there's no explicit "folded / no longer active" kennel status (North Shore Wanderers).
- **G11. Find sourceless kennels** and decide source or hide.
- **G12. Cancellation health guard:** reconcile refuses to cancel above a threshold without review. Carried over from the original triage.

### H. Hygiene and tooling
- **H1. Delete merged remote branches:** 54 earlier plus the 17 from the international wave (your call).
- **H2. PR #1026:** close it or fix its `#1`-matches-`#10` regex.
- **H3. Main checkout:** it's parked on `docs/onboarding-backlog-rescue-2026-11` with a stray `err.txt`. That breaks `copy-newest-handoff.sh` by default and anything run "from main". Switch it to `main` and pull.
- **H4. Tokens:** the GitHub MCP plugin fails ("Authorization header badly formatted"). Refresh the local `GITHUB_TOKEN` and `SONARQUBE_TOKEN`.
- **H5. 24-hour rechecks:** Atlanta, Bangkok, the restored runs.
- **H6. Sentry and PostHog review:** not looked at in this whole triage.

## 4. Priorities

| Tier | Why | Items |
|---|---|---|
| **P0: this week, small, unblocks the rest** | Broken user features, live data loss, tooling the automation needs | H3, H4 · D1 · E1 + G1 · C1 |
| **P1: automation that compounds** | Every week without it, audits and onboarding go stale | A1–A5 · B2, B3, B6, B7 · E4 · C3 |
| **P2: approved features and model quality** | Owner-approved, user-visible | Queens #2650 · Dublin #2759 · #2711 umbrella (+ G6) · C2, C7 · #2452 · D2 |
| **P3: backlog** | Real but small, or needs a decision | F adapter fixes · G2–G5, G7–G12 · E2, E3 · B4, B5, B8 · coverage-gap issues · Rumson |
| **Park or close** | Deep history with no public path | #2400 #2053 #2048 #1131 #102 |

## 5. Parallel workstreams

Each workstream has its own set of files so they don't collide.

| # | Workstream | Items | Main files | Kind | Needs you for |
|---|---|---|---|---|---|
| WS1 | **Ops automation in Cowork** (audits + onboarding delivery + alert sweep) | A1–A6, B2–B4, B6, E4 | `src/app/api/audit/*`, `src/lib/admin/*`, `docs/kennel-onboarding/*`, scheduled tasks | Deep dive, **interactive** | Browser sign-in, task approval, the spike run |
| WS2 | **Strava fix** | D1, D2 | `src/lib/strava/*`, `src/app/strava/*`, `src/components/logbook/*` | Quick win → maybe deep | Testing with your Strava account |
| WS3 | **Prediction quality** | C1–C4, C6–C8 | `src/lib/travel/*`, `src/pipeline/prediction-ledger.ts`, `src/app/admin/predictions/*`, schedule-rule migrations | Quick win (C1) + medium | Migration counts |
| WS4 | **Alerts + data cleanups** | E1–E3, G1–G5, G7, G8, G11, H5 | adapters + data migrations (separate registry/seed anchors) | Quick-win bundle | One batched approval of dry-run counts |
| WS5 | **Kennel routing features** | Queens #2650, Dublin #2759, Pinelake #2501 | hashnyc iCal config, `dublin-hash.ts`, HashRego config, seed anchors, reassign scripts | Medium | Per-kennel reassignment counts |
| WS6 | **Event schema fields** | #2711 umbrella, G6, #2452, G10 | `prisma/schema.prisma`, `merge.ts`, Sheets adapter, event UI | Deep dive | The #2711 schema decision first |

- **Start now in parallel:** WS2, WS3, WS4 and WS5.
- **Here with you:** WS1, because it needs your browser sign-in and approvals.
- **After the #2711 decision:** WS6.
- **Anytime, inline:** H1–H4 and H6.
- **Conflict watch:**
  - WS4 and WS5 both touch `seed-data/*.ts` and `registry.ts`, so give them distinct anchors.
  - WS6 owns `merge.ts`, so G6 goes there and not in WS4.

## 5a. WS1 host and owner touchpoints (decided 2026-11-06)

WS1 runs as a desktop-app scheduled task in this Claude Code (Cowork) install on the Mac mini, and it uses the app's built-in browser.

**Facts this depends on (checked):**
- Scheduled tasks run only while the app is open; a task due while the app is closed runs at next launch. Each run is a new session with the task's saved permission mode and the tool approvals already granted to that task.
- The built-in browser keeps one persistent profile shared by all of the app's sessions, so a sign-in done once carries over to scheduled runs.
- "Keep awake while Claude works" is on, but it only holds while a session is running. It does not stop the Mac sleeping between runs.
- The audit agent's only write is `POST /api/audit/submit-finding`. Today that requires an Origin check plus a Clerk admin session (`authorizeAuditApi`).

**Recommended design:** the agent reads in the browser and writes with a token.
- Add an `AUDIT_AGENT_TOKEN` bearer path to `authorizeAuditApi`.
- Add a `GET /api/audit/next-deep-dive` endpoint that returns the next kennel and its prompt.
- The task calls both with `curl`, so the agent never needs the admin UI or a Clerk session.
- The browser is used only to read public kennel sites and hashtracks.xyz pages.
- The server-side promotion cron still does the GitHub filing.

**Owner touchpoints:**

| When | What you do | Why |
|---|---|---|
| Once | macOS System Settings → Energy: stop the Mac mini sleeping on its own; leave the Claude app open | Runs that fall due while it's asleep slip to wake time |
| Once | Generate the token (`openssl rand -hex 32`). Add `AUDIT_AGENT_TOKEN` to Vercel Production env and to the main checkout's `.env`, then Redeploy | Agents never create or change prod env vars or trigger prod deploys |
| Once (optional) | Sign in to hashtracks.xyz as admin in the built-in browser (Cmd+Shift+B, then go to the site). If Google OAuth balks inside the pane, use email/password | Only needed for your own spot-checks, or if we fall back to the browser-session write path |
| Once | Approve creating the scheduled task(s), and check their permission mode (auto) | The task saves its own permission mode |
| First "Run now" | Watch it and approve each tool and site prompt it raises with "always allow" for that task: hashtracks.xyz, the `curl` calls, read-only Bash | Approvals granted to a task carry over to its later runs |
| Once | In Chrome, open the Claude extension and delete or disable the old Daily Hareline Audit and Deep Dive scheduled tasks | Only you can see those |
| Ongoing | Answer site-approval prompts for new kennel domains when a banner appears. Remote Control is on, so you can answer from your phone | Each kennel uses different domains, so these can't all be approved in advance |
| Ongoing | Glance at the heartbeat: the `/admin/audit` "last deep dive" age, plus a completion notice to this session | How we notice silent stalls early |
| Never | Approving each finding. The agent only queues drafts, and the server cron files issues within caps and suppressions | Keeps you out of the per-run loop |

**Unattended-stall guard:** the task prompt has the agent fetch kennel sites with `curl` first, and use the browser only for JS-rendered pages. Each run is capped at one kennel. The supervised first runs reveal which domains still prompt, so those can be approved up front.

## 6. Self-assessment: gaps and risks in this plan

1. **Usage budget.** Five deep-dives a day, daily onboarding research and 4 parallel sessions all draw on the same plan limits. "Every 5 hours" needs a concrete schedule and a per-run cap, or automation and interactive work will starve each other. *Fix:* in WS1, decide the run times and cap each deep-dive (one kennel, about 30 tool calls).
2. **Unattended writes may still be refused.** In July the Chrome agent refused admin writes even after the prompt was rewritten. A Cowork agent or the auto-mode classifier could do the same. *Fix:* a token-scoped, first-party queue write, no GitHub writes by the agent, and a "Run now" spike before scheduling.
3. **Device dependency.** Cowork scheduled tasks need the Mac awake with the app open, and the RemoteTrigger is tied to the Mac mini. *Open question:* which machine hosts the automation?
4. **Silent sign-in failure.** If the browser's hashtracks.xyz session expires, every run fails quietly. That is exactly how the July audits died unnoticed. *Fix:* the token API avoids the session, and every run reports a heartbeat (`AuditLog` row or notification) so a gap is visible.
5. **Audit output vs. fix capacity.** About 5 deep-dives a day could add 5–10 issues a day, which would refill the backlog we just cut from 145 to 31. *Fix:* send config-only findings to `claude-autofix`, or throttle the cadence until fixes keep up.
6. **The prediction evidence has holes.** Lead time uses `Event.createdAt` as "posted" (inflated by onboarding and backfills). UNOBSERVED (840) is left out of precision. 180-day predictions are unscored until 2026-12-06. C3 and C5 address this; until then, treat "8 weeks ahead" as an upper bound.
7. **Strava may not be worth fixing.** Only 3 users have connected. Check Strava's current API terms and the actual error before building anything. Deprecating is a valid result.
8. **The approval bottleneck is you.** Four parallel sessions will each end in dry-run counts waiting for your OK. *Fix:* sessions post dry-runs to one shared file, and you approve once a day in a batch.
9. **No owner for alert hygiene.** Twelve alerts sat for months because nobody opens `/admin/alerts`. E4 only helps if the sweep output lands somewhere you already look (a digest issue or notification).
10. **Not covered:** Sentry and PostHog errors (H6 is a placeholder), Codacy/Sonar debt, test-suite health, and growth (15 users). That's deliberate, but worth knowing.
11. **The review items had no definition of done.** Defined now:
    - Predictions: a dashboard with lead time and a corrected rule list.
    - Onboarding: the routine re-enabled with one verified run.
    - Audits: 3 consecutive unattended runs, each with an `AuditLog` row.
