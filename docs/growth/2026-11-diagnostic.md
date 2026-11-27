# Growth diagnostic, November 2026 (WS8)

Read-only diagnostic for objective O2 ("real people use it") of the 24 Nov – 21 Dec 2026 round. It sets the two O2 baselines, defines the bot filter the weekly scorecard reuses, and ranks three growth bets for the CP2 decision (Mon 7 Dec).

Data was read on 25 Nov 2026 from PostHog (ad-hoc HogQL; nothing was saved or changed in PostHog), prod Postgres (read-only transactions), and Google Search Console (Performance report). All numbers are aggregates. No names, emails, user ids, IP addresses or replay links appear here.

## Summary

- **Active non-admin users per 28 days: 0.** The plan's baseline of 1 was the owner's admin account. Its 19 check-ins were logged in one sitting on 6 Nov, all with Strava links, for runs 4 to 84 days old. No other account has recorded anything since 22 May. The last sign-up was 21 Oct, and that account has recorded nothing.
- **Human visitors per week: 5 (week of 16 Nov), of whom 1 engaged.** The partial week of 10–15 Nov had 17 (2 engaged); 23–25 Nov had 0. Before the filter, the same weeks show 3,873 and 306 sessions: 99.6% and 98.4% of sessions are bots, crawlers or the owner.
- **Nobody arrives from search, social or kennel sites.** Across the 22 human sessions in 16 days, 1 had a referrer (a code-hosting site). In eight months, Search Console shows 47 impressions and 5 clicks, all on brand queries.
- **No session replays exist.** `posthog-provider.tsx` sets `disable_session_recording: true`, so step 3 (watch 10–15 replays) could not be done. The engaged humans are described from their event sequences instead.
- **Recommendation for CP2:** replace the D6 default with owner-led outreach to kennel organisers (bet 1), starting in week 3 rather than week 4. Keep ICS feeds as the thing the outreach offers, built only if organisers ask for it.

## 1. What can be measured, and since when

| Gap | Effect | Source |
|---|---|---|
| PostHog only saw signed-in visitors until 10 Nov 2026 | Clerk rewrote every signed-out `/ingest` request to a 404, so earlier weeks contain almost only the owner (fixed in #2873, deployed 10 Nov). An 8-week human series does not exist anywhere | `git show c302f392`, PostHog daily counts |
| Vercel Web Analytics is off | Returns no data for any window, so it cannot fill the gap | `vercel api /v1/query/web-analytics/visits/aggregate` |
| `persistence: "memory"` | Every full page load gets a new anonymous id and session, so PostHog cannot count weekly unique visitors. A "visitor" below is a human session (one page load plus in-app navigation). `first_visit_today` gives daily unique browsers; summed over a week it is browser-days, and for these weeks it equals the session count | `src/components/providers/posthog-provider.tsx`, `src/lib/visit-recency.ts` |
| `disable_session_recording: true` | No replays. Project setting `session_recording_opt_in` is on, but the client never records. 0 recordings in the last 30 days | `session_replay_events` |
| Admin tagging starts after `identify` | The first pageview of each page load is sent before Clerk identifies the owner, and the owner's signed-out or agent-driven browsing is never tagged. Rule 6 of the filter handles this by fingerprint; a code fix is better (see §6) | `src/lib/analytics.ts` |
| Server-side events | `check_in` was captured server-side only for 3 of the owner's 19 check-ins; `signup_completed` exists. Prod SQL stays the source of truth for user activity | PostHog `posthog-node` events |

The baseline window is therefore 10 Nov 15:00 UTC to 25 Nov 2026: one partial week (10–15 Nov), one full week (16–22 Nov) and three days (23–25 Nov).

## 2. Bot filter

### 2.1 What the non-human traffic looks like

- **A residential-proxy botnet on 13–14 Nov.** About 3,700 pageviews in two days from 830+ cities in 90+ countries, all with stale browsers (Chrome 117–120, Edge 119–120, Firefox 120–121), screen width 1920, no referrer, one pageview, no clicks, 2–18 s. It hit event pages (`/hareline/<id>`) and kennel pages directly. PostHog's user-agent classifier passes it as human.
- **Search-engine renderers.** Bing's renderer (Edge 12 user agent, widths 800/1600, Microsoft data-centre cities) and Google's (Chrome 138, Council Bluffs) run the JavaScript and send pageviews and clicks.
- **A fixed-fingerprint link crawler, 10–21 Nov.** Chrome iOS 144 at width 390 from one US metro, visiting kennel pages roughly in alphabetical order, 5–6 s each, sometimes following a link. 45 sessions.
- **Single-page drive-bys.** One deep link, no referrer, under 2 s, no clicks: crawlers from China, Japan and scattered residential IPs with current Chrome versions.
- **The owner.** The admin account (209 sessions since 5 Nov) plus the same desktop browser while signed out or driven by agents, including clicks through from PR previews.

Total traffic fell to 3–8 pageviews a day from 22 Nov. The ingest proxy still answers (`/ingest/decide` 200 on 25 Nov) and the owner's own visits still arrive, so this is the bots stopping, not capture breaking.

### 2.2 Definition (for the weekly scorecard)

A session counts as a **human visitor** when all of these hold:

1. **Production host:** `$host = 'www.hashtracks.xyz'` (drops preview and localhost).
2. **Not admin:** the session's person never carried `internal_user = true` or `is_admin = true` in the last 90 days.
3. **Not a declared bot:** `NOT isLikelyBot($raw_user_agent)`. This project sends `$raw_user_agent` only; `$user_agent` is absent.
4. **Not stale or headless:** Chrome, Chrome iOS or Edge major version ≥ 130; Firefox ≥ 128; Safari ≥ 16; browser known; screen width not 800 or 1600. Raise the thresholds each quarter (Chrome ships about every 4 weeks; 130 is a year old in Nov 2026).
5. **Not a data-centre city:** `$geoip_city_name` not in the list in the query below (hyperscaler regions plus Hetzner).
6. **Not the owner's own browser:** sessions matching the owner's desktop fingerprint (metro, desktop Chrome ≥ 150, width ≥ 1280) are excluded. The exact values are kept in the checkpoint session's notes, not in this repo. Replace this rule with the opt-out flag in §6.
7. **Not a known crawler fingerprint:** Chrome iOS 144 at width 390 in the US. Every session with this fingerprint since 10 Nov was in the US (mostly New York or no city), none lasted over 8 s, and most landed on an event page. The query also reports `crawler_fingerprint_sessions`, so a real visitor caught by the rule shows up in the review.
8. **Not zero-duration:** not (1 pageview, no `$autocapture`, no custom interaction event, under 2 s).

A human visitor is **engaged** when it has ≥ 2 pageviews, a click (`$autocapture`), a custom interaction event, or an external referrer and ≥ 3 s. A custom interaction event is any event not starting with `$` and not ending in `_view`, `_viewed` or `_shown`. Those view events fire on their own when a page renders (`location_prompt_shown`, `travel_search_results_viewed`, `kennel_profile_view`, …), so they don't count as interaction. A new view event must follow that naming or the query must list it.

### 2.3 Query

Run with PostHog `execute-sql` (HogQL). Add the owner-fingerprint clause from the checkpoint notes after rule 7 (marked); without it the counts include the owner's signed-out browsing.

```sql
WITH admins AS (
  SELECT DISTINCT person_id FROM events
  WHERE timestamp >= now() - INTERVAL 90 DAY
    AND (properties.internal_user = true OR person.properties.is_admin = true)
),
s AS (
  SELECT
    properties.$session_id AS sid,
    min(timestamp) AS t0,
    any(properties.$host) AS host,
    any(properties.$raw_user_agent) AS ua,
    any(properties.$browser) AS browser,
    any(toInt(splitByChar('.', toString(coalesce(properties.$browser_version, 0)))[1])) AS major,
    any(properties.$screen_width) AS sw,
    any(properties.$geoip_city_name) AS city,
    argMinIf(properties.$referring_domain, timestamp, event = '$pageview') AS ref,
    argMinIf(properties.utm_campaign, timestamp, event = '$pageview') AS campaign,
    any(properties.$geoip_country_code) AS country,
    countIf(event = '$pageview') AS pv,
    countIf(event = '$autocapture') AS ac,
    countIf(NOT startsWith(event, '$') AND NOT match(event, '_(view|viewed|shown)$')) AS interact,
    dateDiff('second', min(timestamp), max(timestamp)) AS dur_s,
    max(person_id IN (SELECT person_id FROM admins)) AS admin
  FROM events
  WHERE timestamp >= toStartOfWeek(now(), 1) - INTERVAL 4 WEEK
    AND properties.$session_id IS NOT NULL
  GROUP BY sid
  HAVING pv > 0
),
c AS (
  SELECT *,
    (browser = 'Chrome iOS' AND major = 144 AND sw = 390 AND country = 'US') AS crawler_fp,
    (host = 'www.hashtracks.xyz'                                        -- rule 1
     AND NOT admin                                                      -- rule 2
     AND NOT isLikelyBot(ua)                                            -- rule 3
     AND NOT ((browser IN ('Chrome', 'Chrome iOS', 'Microsoft Edge') AND major < 130)
              OR (browser = 'Firefox' AND major < 128)
              OR (browser IN ('Safari', 'Mobile Safari') AND major < 16)
              OR browser IS NULL OR major = 0
              OR sw IN (800, 1600))                                     -- rule 4
     AND coalesce(city, '') NOT IN ('Council Bluffs', 'Ashburn', 'Santa Clara', 'Boardman', 'The Dalles',
                                    'Quincy', 'Boydton', 'Moncks Corner', 'Lenoir', 'Pryor', 'Prineville',
                                    'Forest City', 'Altoona', 'Papillion', 'Covington', 'Des Moines',
                                    'San Antonio', 'Cheyenne', 'Hillsboro', 'Falkenstein', 'Nuremberg',
                                    'Helsinki')                                 -- rule 5
     AND NOT crawler_fp                                                 -- rule 7
     -- rule 6 (owner fingerprint) goes here
     AND NOT (pv = 1 AND ac = 0 AND interact = 0 AND dur_s < 2)         -- rule 8
    ) AS human,
    (pv >= 2 OR ac >= 1 OR interact >= 1
     OR (ref NOT IN ('$direct', 'www.hashtracks.xyz', 'hashtracks.xyz') AND ref IS NOT NULL AND dur_s >= 3)) AS engaged
  FROM s
)
SELECT
  toStartOfWeek(t0, 1) AS week,
  count() AS all_sessions,
  countIf(human) AS human_visitors,
  countIf(human AND engaged) AS engaged_human_visitors,
  countIf(human AND ref NOT IN ('$direct', 'www.hashtracks.xyz', 'hashtracks.xyz')) AS referred_human_visitors,
  countIf(human AND campaign = 'outreach-2026-12') AS outreach_human_visitors,
  countIf(crawler_fp) AS crawler_fingerprint_sessions
FROM c
GROUP BY week
ORDER BY week
```

This filter is a heuristic. It will need new crawler fingerprints as they appear; check the residual list (`human` sessions with 1 pageview and `$direct`) at each checkpoint. The counts are heuristic estimates, not bounds: bots that pass the rules inflate them, and rules 7 and 8 and the engaged flag can drop real visitors (rule 8 drops anyone who opens one page and leaves within 2 s). Check `crawler_fingerprint_sessions` and the residual list to judge which way a week leans.

### 2.4 What each rule removed

Sessions per week (Monday start). The week of 9 Nov starts at the 10 Nov fix.

| Week | All sessions | Off-host | Admin account | Declared bot (UA) | Stale / headless | Data-centre city | Zero-duration | Owner fingerprint | Crawler fingerprint | **Human** | Engaged |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 10–15 Nov | 3,873 | 6 | 52 | 423 | 3,194 | 50 | 96 | 9 | 26 | **17** | 2 |
| 16–22 Nov | 306 | 0 | 45 | 31 | 113 | 6 | 65 | 22 | 19 | **5** | 1 |
| 23–25 Nov | 17 | 0 | 1 | 1 | 0 | 1 | 8 | 6 | 0 | **0** | 0 |

The rules are applied in the column order shown; each column counts sessions removed at that step. Weeks before 10 Nov can't be filtered meaningfully because signed-out traffic wasn't captured.

## 3. O2 baselines

| Measure | Baseline | How measured |
|---|---|---|
| **Active non-admin users per 28 days** | **0** (28 days to 25 Nov) | Prod: non-admin accounts with any check-in, follow, trip, misman record or edit in 28 days; PostHog: non-admin `$identify` events (signed-in visits). Both 0. The last non-admin activity was a check-in on 22 May; the 21 Oct sign-up recorded nothing |
| **Human visitors per week (bot-filtered)** | **5** (16–22 Nov, the only full week), 1 engaged | §2.3 query. 10–15 Nov: 17 (2 engaged). 23–25 Nov: 0 |

**Correction to the plan:** §1 and §2 of the plan list the O2 baseline as 1 active user. That user is the owner's admin account, which O2 excludes. The CP4 target of ≥ 3 therefore starts from 0.

## 4. Findings

### 4.1 Human traffic: landing pages, referrers, paths, funnel

All 22 human sessions, 10–25 Nov:

| Landing | Sessions | Pattern |
|---|---|---|
| Event page `/hareline/<id>` | 13 | One page, no referrer, 2–8 s, "new" browser. Indistinguishable from the crawlers above; probably mostly crawlers on residential or mobile IPs |
| Kennel page `/kennels/<slug>` | 4 | Same pattern |
| Home `/` | 4 | 1 engaged (below); 1 via a code-hosting site referrer (5 s, likely a developer); 2 drive-bys of 2 s |
| `/travel` | 1 | Engaged (below) |

- **Referrers:** 1 of 22 (the code-hosting site). 0 from search engines, 0 from social, 0 from kennel websites or Facebook groups.
- **Countries:** US 9, Japan 6, Singapore 2, one each from the UK, Chile, Brazil, Australia and China.
- **Devices:** 13 desktop, 9 phone.
- **Returning visitors:** none. Every human session was a "new" browser (`visit_recency`).
- **Sign-up funnel:** landing 22 → sign-in or sign-up page 0 → account 0 → first check-in or kennel follow 0. Nobody reached `/sign-up` or `/sign-in`.

### 4.2 The engaged visitors

No replays exist, so these are reconstructed from their events. Three sessions pass the engaged test: the 5 s visit from a code-hosting link (counted by the referrer clause) and these two:

- **Phone, US, 80 s:** home page, home page again, then Travel. Two taps, no search submitted, left from Travel.
- **Desktop, UK, 93 s:** Travel, then the hareline, then home, where they ran a home search (dismissing the location prompt) and viewed Travel results; then the kennel directory, where they left. 13 clicks.

Both went for the trip-planning question ("what's on where I'll be?"), through Travel and the home search. Neither looked at a kennel page, signed up or followed a kennel. Neither came back. Two sessions are too few to call a drop-off point; the one honest reading is that cold visitors try Travel first.

### 4.3 The active account

The only account active in the last 28 days is the owner's admin account. Its pattern, for context only (excluded from O2):

- **Check-ins:** 19 in 28 days, all logged on 6 Nov in one sitting, for runs 4–84 days old across 9 kennels, every one with a Strava link. This is a Strava-sync catch-up, not weekly logging. It recorded 79 check-ins and 253 misman attendance rows since February.
- **Surfaces (PostHog, 28 days, desktop only):** hareline list (78 pageviews over 16 days), admin pages (74 over 11 days), event pages (57 over 14 days), kennel pages (23), logbook (11 over 3 days), home (10), travel (8). This is a reviewer's pattern: checking data quality, not planning runs.

The other 14 accounts: 6 recorded something between February and May (four with 19, 2, 1 and 1 check-ins; two with 11 and 2 misman rows in February), and 8 never recorded anything. None has recorded anything since 22 May.

### 4.4 Search

Google Search Console, 1 Apr – 23 Nov 2026 (16-month view; data starts in April):

- 5 clicks, 47 impressions, average position 18.
- Visible queries: "hashtrack" (5 impressions) and "hash track" (4). The rest are too rare for Google to show. No non-brand query is visible.
- Pages with impressions: home 37 (all 5 clicks), `/kennels` 15, `/hareline` 10, `/logbook` 5, `/travel` 5, one event page 3.

Search is not a channel yet; WS1 and WS2 address indexing. The GSC API client from WS10 (after A7) will report this weekly.

### 4.5 What the evidence says about growth

1. **The problem is arrival, not conversion.** About 5 humans a week reach the site, none from a channel that repeats. No on-site change can produce 3 active users from that.
2. **Search will not fill the gap by 21 Dec.** Even if WS1 gets the sitemap read and pages indexed in week 1–2, new pages for niche queries take weeks to earn impressions; the plan's own CP4 target is 300 impressions, which at the current CTR is a few dozen clicks a month.
3. **Hashers already gather in kennel channels** (kennel websites, Facebook groups, mailing lists, WhatsApp). 414 of 561 visible kennels list a website and 303 a Facebook page. A link from an organiser in one of those channels is the only route that can bring dozens of hashers in a week.
4. **The product already has the hooks** for anyone who arrives: kennel pages, follow, check-in, Travel, misman. A per-event "add to calendar" exists in `src/lib/calendar.ts`; there is no subscribable feed yet.

## 5. Growth bets, ranked

O2's target is ≥ 3 active non-admin users per 28 days by CP4 (21 Dec). Week 4 (15–21 Dec) falls in the holiday slowdown, when kennels run less and organisers answer slower, so any bet that waits until week 4 to start reaching people will likely miss CP4.

### Bet 1 (recommended): owner-led outreach to kennel organisers, with a kennel-page link and badge

- **What:** the owner contacts the organisers of 20 kennels (start with kennels the owner knows, then the most active kennels with complete, live data). The message offers their kennel's HashTracks page link, a small "Upcoming runs on HashTracks" badge for their site, and asks them to share the page in their group. Code: a badge (SVG plus copy-paste snippet) on the kennel page or `/for-misman`, and share links with UTM tags (`utm_source=kennel`, `utm_campaign=outreach-2026-12`, `utm_content=<kennel>`).
- **Expected effect:** if 5 of 20 organisers share the link once in a channel of 50–200 hashers, expect roughly 50–150 human visitors in the following week and 2–6 sign-ups. That would reach O2's ≥ 3 if even a few of them check in or follow a kennel. Badges on kennel sites add a small steady trickle and backlinks that help WS1/WS2 indexing. Uncertainty is high: reply rates for cold organiser outreach could be well under 25%; warm contacts do better.
- **Cost:** 1 session (badge, snippet, UTM links, a check that the 20 kennel pages show live runs; about 1 PR). Owner about 150–240 minutes: 20 messages at 5–10 minutes each plus replies. Can be halved to 10 kennels.
- **Scorecard:** human visitors with a `utm_campaign=outreach-2026-12` landing (`outreach_human_visitors` in §2.3) and with an external referrer (`referred_human_visitors`), reported side by side and never added together, since one session can count in both; sign-ups per week (prod `User.createdAt`); active non-admin users per 28 days; organisers contacted / replied / shared (owner logs counts in the checkpoint issue).
- **Risks:** owner time; holiday timing. Mitigation: start in week 3 (8–14 Dec), not week 4.

### Bet 2: misman pilot with one or two kennels the owner knows

- **What:** get one kennel's on-run record-keeper to record attendance in the misman tool for the December runs, and invite the kennel's hashers to claim their profile through the existing invite and link flow.
- **Expected effect:** one kennel at 20–40 hashers a run creates 20–40 roster rows per run. If 3–10 hashers claim profiles and check in, O2 is met from a single kennel, and the kennel keeps using the tool after the round. The ceiling is lower than bet 1 because it depends on one person's habit.
- **Cost:** 0–1 session (polish whatever the pilot kennel trips over). Owner 60–120 minutes: pitch, onboarding, one run of support.
- **Scorecard:** misman attendance rows recorded by non-admin accounts per week (O2 table, currently 0 in 30 days); profiles claimed; active non-admin users per 28 days.
- **Note:** bets 1 and 2 combine well: a kennel that says yes to bet 1 is the natural pilot for bet 2.

### Bet 3 (the D6 default): ICS subscription feeds per kennel and region with a "Subscribe" button

- **What:** `webcal://` and `https://…ics` feeds per kennel and per region, a "Subscribe" button on kennel and region pages, validated in Google Calendar and Apple Calendar.
- **Expected effect on O2 by CP4: about zero on its own.** A Subscribe button reaches only people already on the page: about 5 humans a week. 4 of the 22 sample sessions landed on a kennel page, and those 4 look like crawlers (§4.1). A feed subscriber also isn't an active user under O2 unless they sign in. Its value is retention and distribution later: once organisers link a kennel calendar from their own site, calendar apps fetch it every few hours, and every subscriber sees HashTracks-hosted runs. That makes it a good thing for bet 1 to offer, not a channel by itself.
- **Cost:** 1–2 sessions (feed route with caching, region feeds, button, tests, validation in two calendar apps, a fetch counter for the scorecard). Owner about 15 minutes (subscribe in a personal calendar to test).
- **Scorecard:** feed fetches per week and distinct subscribed feeds (server count by feed and user agent, e.g. Google's calendar fetcher); Subscribe button clicks (a new analytics event).

## 6. Measurement fixes before CP2 (small, not a growth bet)

These make the CP2 and later numbers trustworthy. They touch `src/lib/analytics.ts` and `src/components/providers/posthog-provider.tsx`, which belong to whichever session the owner assigns (WS10 owns the scorecard, not these files).

1. **Owner opt-out flag:** a `localStorage` flag (set from an admin page, or by `?internal=1`) that registers `internal_user: true` before the first pageview on every page load, on any device, signed in or not. This retires filter rule 6 and catches agent-driven browsing.
2. **Session replay, if the owner wants step 3 answered next time:** enable recording with a low sample rate and input masking (`disable_session_recording: false`, `session_recording.maskAllInputs`), excluding internal users. This is a privacy and consent decision for the owner; it was not needed for this diagnostic's conclusion.
3. **UTM landing capture** for bet 1: PostHog records `utm_*` on the first pageview automatically; the badge and share links only need to include them.

## 7. Recommendation for CP2 (Mon 7 Dec)

**Replace D6's default with bet 1, and pair it with bet 2 for any kennel that says yes.** Concretely:

1. At CP2, the owner picks the 20 kennels (or 10) and confirms the outreach minutes.
2. WS-G moves from week 4 to week 3 and becomes one small PR: badge, snippet and UTM share links. Outreach starts the same week.
3. Build ICS feeds (bet 3) only if organisers ask for a calendar to embed or subscribe to; otherwise defer it to the next round.
4. Judge at CP3 (14 Dec) on organisers who shared and on referred human visitors, and at CP4 on active non-admin users.

If the owner can't give the outreach minutes, bet 3 is still the cheapest owner-light option, but it should be expected to move retention later, not O2 this round.
