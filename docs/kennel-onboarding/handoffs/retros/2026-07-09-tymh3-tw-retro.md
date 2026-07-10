# Cowork Handoff Retro — Taoyuan Metro H3 (🇹🇼 Taiwan's 6th metro; Boom Calendar / Wix) — 2026-07-09

Feedback from the Claude Code session that finally shipped the `2026-06-23-tymh3-tw.md` handoff — the
one kennel that had been **blocked across multiple attempts** in the un-onboarded-handoffs sweep. The
handoff (and my own first two build attempts) called this a "JS-rendered **Wix Events** widget →
browserRender." That premise was wrong, and it's the whole story of this run: the widget is a
**third-party Boom Calendar** app, not Wix Events, and once that was identified the data fell out of a
single clean JSON GET. Shipped as a new **reusable `BoomCalendarAdapter`** —
[PR #2636](https://github.com/johnrclem/hashtracks-web/pull/2636).

**Outcome:** live-verified 3 upcoming runs (#181–#183, biweekly Fri 19:15–22:45, hares + real coords),
0 errors. `tsc` + `lint` + **9972 tests** green. New Taoyuan METRO under the existing Taiwan COUNTRY.

---

## The block, and how it broke

Three things kept this kennel blocked, and all three traced back to **misidentifying the platform**:

1. **SSR is empty** — the run list is client-loaded. (True, but a red herring for the *why*.)
2. **browserRender can't render it** — every event-selector wait **timed out (45 s) or 429'd** on the
   NAS render service. The page is heavy and the widget renders inside a **cross-origin iframe**
   (`calendar.boomte.ch`), so even a successful parent render never contains the event DOM. browserRender
   was never going to work here — not a flaky-NAS problem, a wrong-tool problem.
3. **The "Wix Events viewer API" chase was a dead end** — I got the Wix Events instance to authenticate
   (`?instance=` flipped 428→400), but kept failing on the request body. The reason, discovered later:
   **this site has zero Wix Events** — `wix_events_list` returns `{"events":[]}`. The events don't live
   in Wix Events at all.

### New-1 · The unlock: it's Boom Calendar, and a real browser was the only way to see it
The breakthrough came from handing the live page to **Claude-in-Chrome** (a real browser the user could
see). It identified the "Calendar" widget as the third-party **Boom Calendar** Wix app
(`appDefId 13b4a028-00fa-7133-242f-4628106b8c91`, iframe `calendar.boomte.ch`) whose data comes from
`calendar.apiboomtech.com` — **not** `/_api/wix-events-web/…`. Because the fetch happens inside a
cross-origin iframe, it's invisible to the parent page's network log; only a browser that can step into
the frame (or read the widget bundle) reveals it. **Lesson: when a Wix "calendar/events" widget won't
render headlessly and the Wix Events collection is empty, check the widget's `appDefId` against the
site's `/_api/v1/access-tokens` app list — it may be a third-party calendar app with its own backend.**

### New-2 · The data path is a clean, reusable two-step
Once identified, the integration is trivial and robust (no browserRender):
1. `GET https://<site>/_api/v1/access-tokens` → `apps["13b4a028-…"].instance` (a short-lived JWT).
2. `GET https://calendar.apiboomtech.com/api/calendar?comp_id=<compId>&instance=<jwt>` → **one** JSON
   response with the calendar config + every upcoming event, each carrying title (+ run #), start/end
   datetimes, an HTML `desc` (hares + place name), and a `venue` with **real lat/lng**.

Built this as a **config-driven `BoomCalendarAdapter`** (`boomCompId` + `kennelTag`) so any future
Boom-Calendar Wix site is a config-only onboard, not new code. The `instance` is minted fresh per scrape
(it's short-lived), so there's no token-rotation maintenance. → new memory candidate
[[reference_boom_calendar_wix_adapter]].

---

## What the handoff got right (and what live data corrected)

- **Right:** kennelCode `tymh3-tw` (bare `tymh3` free), slug `taoyuan-metro-h3`, Taoyuan METRO = 2
  region edits (Taiwan inference/group/code-map already present), self-host the logo, founded 2019, FB
  group, `upcomingOnly: true`.
- **Corrected by live data:** the schedule. The handoff proposed "1st & 3rd (occasionally 5th) Friday,
  7:30 PM" with `scheduleRules`. The actual Boom feed shows **#181 Jul 3 / #182 Jul 17 / #183 Jul 31 —
  every-other Friday at 19:15** (gather; desc says hare-off 19:30). Shipped flat **biweekly Friday
  7:15 PM** fields (the live adapter carries exact per-run times regardless), no `scheduleRules` — same
  choice as the HC batch, and it sidesteps the ScheduleRule seed-migration path.
- **Logo:** grabbed the 201×201 square emblem (`11062b_…~mv2.png`) rather than the wide banner og:image,
  and kept it **PNG** — deliberately avoiding the `.avif`-not-served-on-prod issue (separate task).

---

## Net

The kennel was never un-onboardable — it was mis-platformed. Two headless attempts (browserRender + Wix
Events API) failed because both assumed the wrong backend; a single Claude-in-Chrome pass on the real
page identified Boom Calendar and turned a "blocked, needs browserRender" kennel into a clean JSON adapter
that's more robust than the DOM scraper the handoff imagined. The reusable `BoomCalendarAdapter` + the
"`appDefId` via `/_api/v1/access-tokens`" recognition pattern carry forward to any other Boom-Calendar
Wix hash site. **Live-verify against a real browser before concluding a JS widget is un-scrapeable.**
