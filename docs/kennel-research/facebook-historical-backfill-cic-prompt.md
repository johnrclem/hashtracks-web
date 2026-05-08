# Facebook hosted_events historical backfill — CIC prompt

One-shot harvest. Paste the prompt block below into Claude-in-Chrome
from a tab logged in as the operator's regular Facebook account
(personal account is fine — volume is well below action-block
thresholds). Output is a directory of JSON shards that
`scripts/import-fb-historical-backfill.ts` consumes.

## Why CIC (not a server-side script)

Pagination of `/past_hosted_events` is gated on FB cookie identity —
unauthenticated `/api/graphql/` POSTs return `error: 1357001 "Log in
to continue"` even with valid `fb_dtsg`/`lsd`/`doc_id`/`variables`
(verified 2026-05-08, see decision log entry in
[`docs/facebook-integration-strategy.md`](../facebook-integration-strategy.md)).
A logged-in browser sidesteps the auth gate transparently; CIC
inherits the operator's session for a one-shot historical pull
without us standing up authenticated-scraper infrastructure.

## Operator pre-flight

1. Open Chrome, signed in to the FB account you'll use for the run.
   Volume is ~1000 paginated requests across the whole session at
   ~one POST every 4–5 seconds — operationally indistinguishable from
   energetic browsing. Personal account is fine.
2. Make a fresh local directory for the output:
   ```
   mkdir -p tmp/fb-backfill
   ```
3. Open Claude-in-Chrome. Paste the prompt below. Approve actions as
   they come up. Total wall-clock: ~30–60 minutes.
4. When CIC finishes (or aborts on an anti-bot signal), the JSON
   shards land in your local `tmp/fb-backfill/` directory.
5. Hand off to engineering: run
   `npx tsx scripts/import-fb-historical-backfill.ts --dir tmp/fb-backfill`.

## Prompt to paste into Claude-in-Chrome

```
You're harvesting historical Facebook hosted-events data for a
HashTracks one-shot backfill. The operator is signed in to Facebook
in this Chrome session; you'll inherit that session implicitly.

## What you're producing

For each Facebook Page in the target list below:
1. Visit https://www.facebook.com/{handle}/past_hosted_events
2. Capture every Event node — both from the SSR'd page payload and
   from each /api/graphql/ pagination response that fires as you
   scroll the events list to its end.
3. Emit a single JSON shard for that Page to the operator's local
   filesystem at `tmp/fb-backfill/{handle}.json`.
4. Move on to the next Page after a 30-second cooldown.

## What you should NOT do

- Do not click anything that posts, comments, RSVPs, likes, follows,
  shares, or invites. Read-only browsing only.
- Do not bypass any captcha, "are you human?", or "we noticed
  unusual activity" challenge. STOP the run instead.
- Do not log in or out. The operator's existing session is what we
  want; don't touch it.
- Do not exceed the per-Page request budget (see "Hard stop
  conditions" below).
- Do not rerun a Page you've already emitted a shard for (idempotency
  on the engineering side handles this, but redundant requests waste
  the request budget).

## Pacing rules

- **Within a Page:** wait at least 3 seconds after a pagination
  request completes before triggering the next scroll-to-bottom.
- **Between Pages:** 30-second cooldown after writing each shard,
  before navigating to the next Page.
- **Whole session:** if the cumulative request rate exceeds ~20
  GraphQL POSTs per minute averaged across the session, slow down.

## Hard stop conditions (abort the WHOLE session, don't retry)

Any one of these and you write a final `tmp/fb-backfill/_aborted.json`
with the reason and the handle that was being processed, then stop:

- HTTP 4xx / 5xx on any /api/graphql/ POST
- Captcha / "are you human?" / "unusual activity" interstitial
- Any login wall, logout, or session-expired prompt
- A pagination response whose body is not JSON (FB anti-XSSI prefix
  `for (;;);` is fine and expected — strip it before parsing)
- 20 consecutive paginated requests with `has_next_page: false` and
  zero new events (loop indicator)

Partial output is much more useful than no output. The engineering
side knows how to import partial shards.

## Per-Page procedure

For each handle in the target list:

### Step 1 — Navigate
- Open https://www.facebook.com/{handle}/past_hosted_events in the
  current tab.
- Wait for the events grid to render. If the Page itself is private
  / removed / unavailable, write a shard with
  `{ "handle": "{handle}", "status": "page_unavailable", "events": [] }`
  and move on to the next Page.

### Step 2 — Capture the SSR baseline
- Read the inline `<script type="application/json">` payloads that
  ship with the page. Walk every JSON island for objects matching
  `__typename: "Event"`. Each Event node carries:
  - `id` (numeric string)
  - `name` (string, the event title)
  - `start_timestamp` (unix seconds, UTC)
  - `is_canceled` (boolean)
  - `event_place` (optional object with `contextual_name` + optional
    `location.latitude` / `location.longitude`)
- Record each unique-by-id Event into the in-progress shard.
- Also capture the initial `page_info`:
  `{ "end_cursor": "...", "has_next_page": true|false }`.

### Step 3 — Paginate by scrolling
- Open DevTools → Network tab → filter "graphql".
- Scroll the events grid to the bottom slowly. FB's own client code
  fires a POST to `https://www.facebook.com/api/graphql/` with form
  field `fb_api_req_friendly_name=ProfileCometAppCollectionEventsRendererPaginationQuery`.
- After each paginated POST returns:
  - Strip the leading `for (;;);` from the response body.
  - JSON-parse the rest.
  - Walk the parsed result for `__typename: "Event"` nodes and record
    them (de-dupe by `id` — the SSR + first paginated response often
    overlap by a couple of cards).
  - Capture the new `page_info` for the next iteration.
- Wait 3 seconds after each pagination response, then scroll again
  to trigger the next.
- Continue until `has_next_page: false`, OR the loop indicator fires
  (20 consecutive empty paginated responses), OR a hard-stop
  condition fires.

### Step 4 — Emit the shard
- Write `tmp/fb-backfill/{handle}.json` with this exact shape:

```json
{
  "schemaVersion": 1,
  "handle": "MemphisH3",
  "harvestedAt": "2026-05-08T14:23:00Z",
  "status": "complete",
  "stoppedReason": "has_next_page: false",
  "paginationRequests": 60,
  "events": [
    {
      "id": "1234567890123456",
      "name": "Trail #1234 — Pizza on the Plaza",
      "startTimestamp": 1714502400,
      "isCanceled": false,
      "eventPlace": {
        "contextualName": "Some Bar",
        "latitude": 35.149,
        "longitude": -90.048
      }
    }
  ],
  "totalEvents": 487,
  "earliestEventDate": "2018-03-15",
  "latestEventDate": "2026-04-26"
}
```

- `status` is one of: `"complete"` (reached has_next_page=false),
  `"truncated"` (loop indicator fired), `"page_unavailable"` (Page
  doesn't exist or is restricted), `"aborted"` (hard-stop fired).
- Sort `events` ascending by `startTimestamp` before writing.
- Compute `earliestEventDate` / `latestEventDate` as ISO YYYY-MM-DD
  strings in UTC from the min/max `startTimestamp`.
- The schema is intentionally close to FB's own field names but
  camelCased — the import script knows this shape.

### Step 5 — Cooldown and move on
- Wait 30 seconds.
- Navigate to the next handle. Repeat from Step 1.

## Target handles

Process in this order. Some handles map to multiple HashTracks
kennels (the import script handles that fan-out); only fetch each
handle once.

**Tier 1 — also have upcoming events (already-active Pages, scrape
these first because if FB is going to throttle us, we want the most
valuable data captured first):**

1. HollyweirdH6
2. MemphisH3
3. soh4onon
4. PCH3FL
5. DaytonHash
6. GrandStrandHashing

**Tier 2 — past events only (re-audit candidates from PR #1294, in
the order the audit listed them):**

7. adelaidehash
8. AlohaH3
9. augustaundergroundH3
10. BerlinHashHouseHarriers
11. BurlingtonH3
12. CapeFearH3
13. chiangmaihashhouseharriershhh
14. CharmCityH3
15. charlestonheretics
16. clevelandhash
17. FWBAreaHHH
18. FoothillH3
19. h4hongkonghash
20. Licking-Valley-Hash-House-Harriers-841860922532429
21. madisonHHH
22. MileHighH3
23. MOA2H3
24. HashNarwhal
25. NorfolkH3
26. rh3columbus
27. SurvivorH3
28. sirwaltersh3
29. vontramph3

29 unique handles total. (Berlin H3 + Berlin Full Moon share one
Page; 4 Chiang Mai kennels share one Page — that's where the
33-kennel-vs-29-handle discrepancy comes from.)

## Status reports

Print a brief status line in chat after each shard is written:

```
[12/29] MemphisH3 — 487 events, 60 paginated requests, status: complete
```

If a hard-stop fires, print the abort reason verbatim along with the
handle that was in flight, write `_aborted.json`, and stop.

## Final summary

After processing all handles (or aborting), write
`tmp/fb-backfill/_summary.json` with totals:

```json
{
  "handles_attempted": 29,
  "handles_complete": 27,
  "handles_truncated": 1,
  "handles_unavailable": 1,
  "handles_aborted": 0,
  "total_events_harvested": 8421,
  "session_started_at": "2026-05-08T14:00:00Z",
  "session_finished_at": "2026-05-08T14:51:00Z",
  "total_pagination_requests": 1014
}
```

Then print the same summary in chat. Done.
```

## After CIC finishes

The operator should:

1. Verify the shards landed: `ls tmp/fb-backfill/`.
2. Spot-check one shard: `jq '.totalEvents,.earliestEventDate' tmp/fb-backfill/MemphisH3.json`.
3. Run the import script in dry-run mode first (default — no flag
   needed):
   ```
   npx tsx scripts/import-fb-historical-backfill.ts --dir tmp/fb-backfill
   ```
4. Review the dry-run output. If it looks right, run the real import
   with `--apply` (or `BACKFILL_APPLY=1` as an env-var alternative):
   ```
   npx tsx scripts/import-fb-historical-backfill.ts --dir tmp/fb-backfill --apply
   ```
5. The script is idempotent (RawEvent fingerprint dedup), so
   re-running on the same shards is safe.

If the script exits with `❌ Missing FACEBOOK_HOSTED_EVENTS sources`,
add the listed kennelCodes to `prisma/seed-data/sources.ts`, run
`npx prisma db seed`, then retry. The script refuses to proceed when
any expected kennel→source mapping is missing (otherwise most
harvested events would be silently dropped).

## Rough time/cost estimate

- 29 handles × ~30s navigation + ~3min scroll-paginate (varies
  hugely by archive depth) ≈ 30–60 min wall-clock.
- ~1000 paginated GraphQL POSTs across the session, paced at ~1
  every 4–5 seconds.
- Zero monetary cost (no API). Operator's FB session is the only
  resource consumed.

## When to NOT use this prompt

- If FB has changed the pagination shape since 2026-05-08 — re-run
  the investigation prompt at `docs/kennel-research/` first to
  re-confirm `friendly_name` / `doc_id` / variables before running
  this harvester.
- If you're trying to backfill a Page not in the list above —
  re-run the audit (`scripts/audit-fb-hosted-events.ts`) first to
  confirm the Page actually has past hosted events.
- If you don't have a logged-in FB session — the prompt fails fast
  on the first paginated request. Investigation prompt explains why.
