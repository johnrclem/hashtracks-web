# Event schema — future-add fields

Living catalog of data elements we **could** add to the canonical `Event`
schema (or to `RawEventData`) but have intentionally deferred. Anchored
in what live adapters actually expose today, so each entry has a known
extraction path — we've already proven the field is reachable, we're
just choosing not to ship it yet.

Each entry: **what it is**, **where it's reachable**, **what it
unlocks**, **what schema surface it'd need**, **why it's not in scope
right now**.

Keep entries narrow. When one ships, delete the entry; don't migrate it
to a "shipped" section. The strategy doc + adapter changelog are the
historical record. This file is forward-looking only.

---

## Imagery

### Event cover image (header / hero)
- **What:** A wide event header image (FB ships ~620×400 PNG/JPEG with
  CDN URL) plus an `accessibility_caption` describing the image.
- **Where:**
  - **FACEBOOK_HOSTED_EVENTS detail page** —
    `event.cover_media_renderer.cover_photo.photo.full_image.uri`
    (also `blurred_image.uri` for placeholders, `accessibility_caption`
    for alt text). Verified in
    `fixtures/grand-strand-event-1012210268147290.html.fixture`.
  - **MEETUP** — `event.featured_photo.photo_link` (already in the
    REST payload; adapter currently ignores it).
  - **Hash Rego** — usually a banner `<img>` on the event detail page;
    not standardized.
  - **GOOGLE_CALENDAR** — `attachments[].fileUrl` when an event has a
    Drive image attachment (rare for hash kennels).
- **Unlocks:** Visual hareline cards, kennel page hero strips, social
  preview cards (Open Graph `og:image`), feed cards on `/discover`.
- **Schema:** New `EventImage` table (`eventId`, `url`, `width`, `height`,
  `altText?`, `kind: "COVER" | "GALLERY"`, `provenance: SourceType`).
  Or simpler v1: `Event.coverImageUrl: String?` + `Event.coverImageAlt:
  String?` and defer multi-image to a follow-up. Image hosting is
  already CDN-served by the upstream — we don't need to re-host.
- **Not in scope because:** introduces image-domain CSP additions
  (fbcdn.net, secure.meetupstatic.com, etc.); needs a fallback image
  per kennel for sources that don't expose covers; hareline card
  redesign needs design-spec sign-off before pulling in hero imagery.
  Right scope is a dedicated PR with the design pass.

### Venue thumbnail / kennel logo
- **What:** Small icon-shaped image of the venue (Big Air Myrtle Beach)
  or the hosting kennel's FB Page profile picture.
- **Where:**
  - **FACEBOOK_HOSTED_EVENTS** — `event.profile_picture_for_sticky_bar`
    + `event.event_place.profile_picture` (when venue is a Page).
- **Unlocks:** Map pin avatars, kennel page header, RSVP bar.
- **Schema:** Could attach to `Kennel.logoUrl` (already exists in some
  contexts) or per-venue if we ever model `Venue` separately.
- **Not in scope because:** kennel logo is curated separately per the
  kennel-page redesign spec; venue logos solve a problem we don't have
  yet.

---

## Engagement signals

### Interested / going counts
- **What:** Pre-event signal of how many people have RSVP'd
  ("interested" + "going" buckets on FB; "going + waitlist" on Meetup).
- **Where:**
  - **FACEBOOK_HOSTED_EVENTS** — `event.interested_users_count`
    (numeric, e.g. `2573`); `event.social_context.text` (pre-formatted
    "2.4K interested · 128 going").
  - **MEETUP** — `event.yes_rsvp_count` + `event.waitlist_count` (REST
    payload).
- **Unlocks:** "Hot trail this week" sort on hareline; popularity
  badges; trip planning hints in Travel Mode.
- **Schema:** `Event.interestedCount: Int?` + `Event.goingCount: Int?`.
  Updated on every scrape (not in fingerprint — would churn dedup).
- **Not in scope because:** needs a "this is a snapshot, not truth" UX
  signal so users don't anchor on a stale count when an event surfaces
  hours after the last scrape; needs a decision on whether we
  cross-source-merge counts (sum? max? prefer FB?). Defer until the
  hareline gets popularity-driven sorting.

### "Friends going" / social context
- **What:** "5 of your friends are interested" type strings.
- **Where:** FB exposes via `event.social_context` (login-walled — only
  works for the viewer).
- **Unlocks:** Personalized social proof on hareline cards.
- **Schema:** Not addable from a logged-out scraper. Requires Facebook
  Login on HashTracks itself, which is a much bigger product decision.
- **Not in scope because:** we don't authenticate users with FB. Park.

---

## Time / scheduling

### Explicit end time
- **What:** Event end timestamp (separate from start).
- **Where:**
  - **FACEBOOK_HOSTED_EVENTS** — `event.end_timestamp` (often `0`
    when the upstream didn't set one — kennel admins rarely fill it);
    sometimes populated for campouts / multi-day.
  - **MEETUP** — `event.duration` (ms) + computed end.
  - **GOOGLE_CALENDAR** — always set; we already read it but discard.
  - **ICAL_FEED** — `DTEND` always set.
- **Unlocks:** Trail-end-time display, "trail wraps at X" hints,
  Travel Mode conflict checks (don't double-book trails on the same
  evening).
- **Schema:** `Event.endTime: String?` (HH:MM, mirroring `startTime`
  convention). Adapters already speak `endTime?: string | null` on
  `RawEventData` per `src/adapters/types.ts:23` — the merge pipeline
  doesn't propagate it because the canonical column doesn't exist.
- **Not in scope because:** less than 30% of sources actually set this
  meaningfully — most hash trails are "however long it takes". Adding
  the column without a backfill story would create a sparse field
  that's almost always "TBD" on the UI. Revisit when end-time
  utilization in the source pool is materially higher.

### Pre-localized human-readable date strings
- **What:** Source-side formatted strings like
  `"Saturday, May 9, 2026 at 3:00 PM EDT"`.
- **Where:** **FACEBOOK_HOSTED_EVENTS** —
  `day_time_sentence`, `capitalized_day_time_sentence`,
  `start_time_formatted`.
- **Unlocks:** Skip our own date formatting in some surfaces, including
  for locales we haven't translated.
- **Schema:** None — these are derived. We already format dates
  ourselves and date formatting is not a problem we have.
- **Not in scope:** Permanently. Documented for completeness only.

### `is_happening_now` flag
- **What:** Pre-computed "trail is currently in progress."
- **Where:** **FACEBOOK_HOSTED_EVENTS** — `event.is_happening_now`.
- **Unlocks:** "Live now" badge on hareline.
- **Schema:** None — derive from `startTime + endTime` and current time
  if we ever want this. Snapshot-at-scrape would be wrong by the time
  the page renders.

---

## Event type / format

### Online vs in-person
- **What:** Whether the trail runs in physical space, virtually
  (Strava/Zoom), or both.
- **Where:**
  - **FACEBOOK_HOSTED_EVENTS** — `event.is_online` +
    `event.is_online_or_detected_online`; richer info under
    `event.online_event_setup` when set.
  - **MEETUP** — `event.is_online_event`.
- **Unlocks:** Filter hareline by virtual-only; Travel Mode skip
  filter; correct "no location needed" UX for solo trails.
- **Schema:** `Event.eventFormat: EventFormat?` enum with values
  `IN_PERSON | VIRTUAL | HYBRID`.
- **Not in scope because:** virtual hash kennels are a small slice
  (a few COVID-era full-moons remain). Adding a column for an edge
  case before the UX exists for it churns the schema. Park.

### Event category / kind
- **What:** Public/private, sale event, fundraiser, AGM, etc.
- **Where:**
  - **FACEBOOK_HOSTED_EVENTS** — `event.event_kind` ("PUBLIC_TYPE",
    others); `event.is_sale_event`; `event.event_category_list`.
- **Unlocks:** Distinguish "regular trail" from "AGPU / hash bash /
  red dress run / pub crawl". Could feed kennel anniversary detection.
- **Schema:** Either `Event.eventCategory: String?` (free-form,
  source-supplied) or a curated `EventKind` enum.
- **Not in scope because:** we'd want this to drive UX (different card
  treatment for AGPU vs regular trail) and the UX hasn't been
  designed yet. Premature.

---

## Venue (richer than current `location` text)

### Structured venue address
- **What:** Street, city, region, postal code as separate fields rather
  than one freeform `location` string.
- **Where:**
  - **FACEBOOK_HOSTED_EVENTS** — `event.event_place.address.street`,
    `event.event_place.city.contextual_name`,
    `event.event_place.url` (the venue's own FB Page URL).
  - **GOOGLE_CALENDAR** — `event.location` is already best-effort
    structured.
- **Unlocks:** Better map pin clustering, region-aware Travel filters,
  cleaner `LocalBusiness` schema.org markup, "directions to venue"
  links that actually resolve.
- **Schema:** `Event.locationStreet: String?` already exists in
  `prisma/schema.prisma`. The remaining gap is `locationCity`,
  `locationRegion` (US state / IANA equivalent), `locationPostalCode`.
  Adapter `RawEventData` would need matching nullable fields.
- **Not in scope because:** the current text-blob `location` is good
  enough for hareline cards and the kennel page; structured address
  only matters if we're shipping schema.org JSON-LD or the map
  experience needs better clustering. Drives no current user-visible
  feature; revisit when one demands it.

### Venue blurb (description of the venue itself, not the event)
- **What:** Marketing copy from the venue's FB Page about the venue.
- **Where:** **FACEBOOK_HOSTED_EVENTS** —
  `event.event_place.best_description.text`.
- **Unlocks:** Tooltip on the venue name with "what is this place".
- **Schema:** Probably belongs on a `Venue` table, not `Event`.
- **Not in scope because:** we don't model `Venue` and venue blurbs
  read as ad copy ("Voted Best Kids Fun Center..."). Probably never
  in scope without a venue model.

---

## Pricing / hash cash

### Structured price
- **What:** Numeric price + currency, separate from the freeform
  `cost` string we have today.
- **Where:**
  - **FACEBOOK_HOSTED_EVENTS** — `event.price_info` (often null;
    populated when the event is a sale event).
  - **MEETUP** — `event.fee.amount` + `event.fee.currency`.
- **Unlocks:** Currency-aware sorting; "free trails near me" filter;
  region-aware fee comparisons.
- **Schema:** `Event.priceCents: Int?` + `Event.priceCurrency: String?`.
- **Not in scope because:** hash cash conventions are gloriously
  irregular ("$5 with shoes, $10 without, free for virgins"). Numeric
  prices can't represent these. Our current freeform `cost` string is
  more honest. Park unless a strong UX demand emerges.

---

## Trail-specific (HashTracks-native, no current source)

These don't exist on FB or any other public source — they'd come from
admin/misman entry, the paste flow (PR 3 / T2b), or a future inline
editing UX.

### After-after venue
- **What:** The on-after-the-on-after pub.
- **Schema:** `Event.afterAfterVenue: String?` +
  `Event.afterAfterUrl: String?`.
- **Not in scope because:** highly inconsistent capture across sources.
  Better captured via the misman attendance form than the scrape
  pipeline.

### Parking / dropoff lot
- **What:** Free-form parking instructions.
- **Schema:** `Event.parkingNote: String?` — could probably live in
  `description` for now. Already does, in fact (FB descriptions
  routinely say "park at Big Air").
- **Not in scope because:** description handles this. Promoting to a
  first-class field needs a parsing/extraction step that doesn't pay
  off until we want a "tap to nav" button.

### Pet / stroller policy flags
- **What:** Boolean dog-friendly, kid-friendly, stroller-friendly.
- **Schema:** Either bools per flag or a `tags: String[]` array on
  `Event`.
- **Not in scope because:** belongs at the Kennel level, not the Event
  level. Most kennels are consistently dog-friendly or not. Reflects
  a kennel attribute, not a per-event one.

### Trail GPS track
- **What:** GPS polyline of where the hares laid trail.
- **Schema:** `EventGpsTrack` table or `Event.gpsTrackJson` JSON column.
- **Not in scope because:** Strava integration already handles the
  hasher's track; the hare-set track is a different artifact and
  capturing it cleanly needs Strava-on-the-hares' phones, not the
  scraper.

### Weather forecast at trail-time
- **What:** Locked-in forecast snapshot (so a "rain chance: 80%" badge
  on the hareline card doesn't update to "rain chance: 0%" after the
  fact).
- **Where:** Already integrated via `src/lib/weather.ts` for
  display, but not persisted to the Event row.
- **Schema:** `Event.weatherSnapshot: Json?` (condition emoji, temp,
  precip, fetched-at).
- **Not in scope because:** persistence introduces a refresh-policy
  question (when do we re-poll? snapshot at +24h-before? at scrape
  time?). The current "fetch at view time, cache 30min" is good enough.

---

## Cancellation / lifecycle

### Cancellation reason
- **What:** Why an event was canceled (weather, hare backed out,
  permit denied, kennel folded). FB exposes a free-text reason on the
  detail page when a hare cancels.
- **Where:** Detail-page parsing — we already read `is_canceled` and
  drop the event at ingest. The reason string sits next to it.
- **Schema:** `Event.cancellationReason: String?` —
  paired with promoting "drop at ingest" to "store with `status:
  CANCELLED`".
- **Not in scope because:** PR #1185's admin override flow is the
  authoritative cancellation surface. Capturing source-side reasons
  would need to interact with the override (which wins?) and that's
  a non-trivial design conversation.

### `is_past` historical flag
- **What:** FB flags whether the event has happened yet.
- **Where:** **FACEBOOK_HOSTED_EVENTS** — `event.is_past`.
- **Schema:** None — derive from `date < today`.
- **Not in scope:** Permanently — date math is fine.

---

## Cross-cutting: locale / language

- **What:** What language the event description is in.
- **Where:** FB ships a top-level `locale` ("en_US") on the page.
- **Schema:** `Event.locale: String?`.
- **Not in scope because:** we have one English-language UI today.
  Locale becomes interesting when (a) we add i18n and (b) we want to
  filter / translate descriptions for non-English kennels. The MY/HK/
  SG kennels in the active-sources list write in English anyway, so
  we have very little to gain near-term.

---

## Kennel schema (related but not Event-row)

These are tracked here for adjacency rather than splitting into a parallel
doc. Same shipping rule applies — delete the entry when the work lands.

### Multi-Facebook-surface kennels (Group + Page split)
- **What:** `Kennel.facebookUrl` stores **one** FB surface per kennel today.
  Real-world kennels often have **both** a Facebook Group AND a Facebook
  Page that serve different content. The two surfaces are not redundant:
  - Group: discussion thread, RSVPs, often the day-of "we're at X tonight"
    posts. Reachable only via T2b paste-flow or admin-installed Graph API.
  - Page: \`upcoming_hosted_events\` / \`past_hosted_events\` tabs that the
    `FACEBOOK_HOSTED_EVENTS` adapter scrapes. Logged-out reachable.
- **Where (concrete example):** **NYC H3** has Group `groups/nychash` (the
  one we store) AND Page `hashnyc` (we don't store it — see
  `docs/kennel-research/facebook-hosted-events-audit.md`'s "Schema gap
  surfaced" section). The Page exposes a hosted_events tab; the Group
  doesn't, but it has discussion. We're storing the wrong-shape surface
  for FB-events scraping.
- **Unlocks:** Per-kennel Group AND Page integration without one
  overwriting the other. The 106 `/groups/...` rows in the audit's
  Skipped table are presumed Group-only today; an unknown subset of them
  also have a Page we'd auto-onboard if the schema let us.
- **Schema:** Two reasonable shapes:
  1. Two columns: `Kennel.facebookPageUrl?: String` +
     `Kennel.facebookGroupUrl?: String`. Simple, captures the 99% case
     (kennels have at most one of each). Migration is additive; backfill
     reads the existing `facebookUrl` and routes to the right new column
     based on URL shape.
  2. Separate `KennelFacebookSurface` table (`kennelId`, `kind: "PAGE" |
     "GROUP"`, `url`, `verified: Boolean`). Generalizes if FB ever ships
     a third Page-like surface or if a kennel ever needs multiple Pages.
     Heavier — only justified if (1) hits a real wall.
  
  v1 should be (1). The `SocialLinks` UI component already takes one URL;
  it'd start preferring `facebookPageUrl` over `facebookGroupUrl` on the
  display side. Source-row routing wires `FACEBOOK_HOSTED_EVENTS` to the
  Page column; the future T2b paste-flow source binds to either.
- **Not in scope because:** the audit identified the gap but only one
  kennel (NYC H3) has been verified to have both surfaces. Before
  authoring a schema migration, run a follow-up audit pass against the
  106 Group-only kennels to see how many also have a Page — that
  audited count drives whether (1) is enough or whether the long tail
  justifies the heavier (2) shape.

## When something here ships

1. Open a new PR introducing the schema column / table.
2. Update **all** adapters that can populate the field (don't ship
   single-source coverage of a new field — gives users a misleading
   "this kennel has it / that kennel doesn't" experience).
3. Update the merge pipeline's `RawEventData → Event` projection.
4. Delete the entry from this doc.
5. If the field demands UI, do it in a separate PR — schema and UX
   ship at different cadences.
