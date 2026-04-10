# HashTracks PRD: Special Events

**Document Status:** Draft  
**Owner:** John / HashTracks  
**Last Updated:** 2026-04-10  
**Related Docs:** `docs/roadmap.md`, `docs/multi-day-events-mini-spec.md`

---

## 1. Overview

HashTracks already aggregates events from many sources and surfaces them in Hareline, kennel pages, and related discovery flows. This feature introduces **Special Events**: a structured way to identify events that are more notable, destination-worthy, or non-routine than a normal weekly trail.

Examples include:

- campouts
- hash weekends
- pub crawls
- dress runs and other themed events
- other one-off or major events

Special Events should help:

- kennel admins and mismans promote important events
- hashers identify standout events more easily
- future discovery and travel experiences answer questions like "where are the campouts this summer?"

---

## 2. Problem Statement

Today, most events in HashTracks are treated similarly. That works for weekly trails, but it does not reflect the difference between a routine run and a special event such as a campout or hash weekend.

This creates several issues:

- important events can get buried in Hareline
- users cannot easily browse by event type
- kennel admins cannot reliably spotlight major events
- upstream data from HashRego and special-event adapters is not yet fully leveraged
- future travel search cannot easily distinguish "interesting destination event" from ordinary weekly trail

---

## 3. Goals

### 3.1 Primary Goals

- Identify events as Special Events
- Classify Special Events using a small, controlled taxonomy
- Highlight Special Events in Hareline and kennel pages
- Support filtering by Special Event type
- Automatically infer Special Event status from strong sources like HashRego where appropriate
- Provide the metadata needed for future travel and discovery features

### 3.2 Secondary Goals

- Preserve manual admin override capability
- Support special-event-specific surfacing rules without duplicating events
- Keep taxonomy clean and useful for filtering and travel queries
- Remain compatible with multi-day event handling

---

## 4. Non-Goals

The following are out of scope for V1:

- ticketing, registration, or payment workflows
- rich editorial event landing pages
- open-ended category creation by users
- recommendation or ranking algorithms
- a full global discovery landing page for Special Events
- fully mature grouped multi-day event UI
- final visual design choice between carousel, rotating slot, or dual-card module

---

## 5. Terminology

### 5.1 Product Term

Use **Special Event** as the core product term.

### 5.2 UI Term

Use **featured** only as a possible presentation treatment, such as:

- featured section
- featured card
- highlighted treatment

### 5.3 Rationale

"Special Event" describes what the event is.  
"Featured" describes how it is shown.

---

## 6. Users and User Stories

### 6.1 Kennel Admin / Misman

- As a misman, I want the upcoming 5 Boro Pub Crawl to stand out on NYC H3 surfaces in HashTracks so hashers notice it.
- As a kennel admin, I want to classify an event as a campout, pub crawl, or special event so users understand what kind of event it is.
- As a kennel admin, I want imported event data to auto-tag special events where possible, but I also want to override it when source behavior is misleading.

### 6.2 Hasher

- As a hasher, I want to quickly spot major upcoming events in Hareline.
- As a hasher, I want to filter for campouts or hash weekends.
- As a traveling hasher, I want future travel search to surface special events as a strong use case.

### 6.3 Global Admin

- As a global admin, I want a tightly controlled taxonomy so the metadata stays useful and clean.
- As a global admin, I want trusted imported events to auto-classify when appropriate while still allowing overrides.

---

## 7. Product Principles

- Special Events should feel meaningful, not inflated.
- Structured metadata is more important than one-off visual treatment.
- Automatic sourcing is preferred where confidence is high.
- Manual override is required.
- Discovery and filtering value matter as much as kennel-page promotion.
- The model should anticipate multi-day events even if grouped UI is fast follow.

---

## 8. Category Taxonomy

### 8.1 V1 Categories

- Hash Weekend
- Campout
- Pub Crawl
- Special Event

### 8.2 Category Rules

- Categories are tightly controlled in V1.
- Red Dress, Green Dress, and other color dress runs are categorized as **Special Event** in V1.
- Additional categories may be considered later only if data volume and user behavior justify expanding the taxonomy.

---

## 9. Sources of Special Event Data

### 9.1 Manual Classification

Global admins and kennel admins/mismans can manually:

- mark an event as a Special Event
- remove Special Event status
- assign a category
- override imported status or category

### 9.2 Automatic Classification

Initial automatic classification sources may include:

- HashRego
- trusted adapters or source pages that clearly distinguish special events from routine runs
- future inference logic when source structure is strong enough

### 9.3 HashRego Default Rule

In general, events sourced from HashRego should automatically be treated as Special Events.

However, some kennels may use HashRego for nearly every trail rather than only for notable events. Because of that:

- HashRego is a strong signal, but not an infallible one
- auto-classification must remain overridable
- source attribution should be retained for admin visibility and debugging

---

## 10. Scope

### 10.1 In Scope for V1

- Special Event metadata on existing events
- controlled category list
- highlighting on kennel pages
- highlighting in Hareline
- filtering by Special Event and by category
- manual management by global admin and kennel admin/misman
- automatic classification from HashRego and selected trusted sources
- surfacing limit for kennel promo modules

### 10.2 Fast Follow

- grouped multi-day event UI
- regional or global Special Event discovery page
- more advanced source-confidence and review workflows
- richer visual treatment and editorial surfacing
- travel search integration using Special Event metadata

---

## 11. Functional Requirements

### 11.1 Event Metadata

Each event should support Special Event metadata, likely including:

- `isSpecialEvent`
- `specialEventCategory`
- `specialEventSource` such as `manual`, `hashrego`, or `adapter_inferred`
- `specialEventPriority` or surfacing rank
- optional promotion/display window fields if needed later
- manual override metadata or equivalent precedence behavior

The data model should remain compatible with multi-day event handling and series relationships.

### 11.2 Automatic Classification

The system should support automatic tagging from:

- HashRego
- configured trusted adapters or special-event pages
- future inference logic where source structure is reliable

### 11.3 Manual Override

Authorized users must be able to:

- add Special Event status
- remove Special Event status
- change category
- override imported classification

Manual decisions should take precedence over imported defaults.

### 11.4 Hareline Behavior

In Hareline:

- Special Events should include visible labeling or treatment
- users should be able to filter for all Special Events
- users should be able to filter by category
- all Special Events should remain discoverable even if only some are prominently surfaced elsewhere

### 11.5 Kennel Page Behavior

Kennel pages should include a dedicated Special Events area that:

- shows up to 2 upcoming events
- prioritizes nearest upcoming and/or explicit admin priority
- links to normal event detail pages
- includes category labeling

### 11.6 Historical Behavior

- past Special Events should not appear in active promo modules by default
- Special Event metadata should be preserved historically
- historical data should remain usable for analytics and future browsing

### 11.7 Discovery / Travel Readiness

Special Event metadata must be queryable later for:

- region-based discovery
- date-range travel search
- category-driven exploration, such as campouts in a given season or region

---

## 12. User Experience Requirements

### 12.1 Hasher Experience

A hasher should be able to:

- notice Special Events quickly
- distinguish them from routine trails
- filter by event type
- encounter useful Special Event metadata in normal Hareline usage
- benefit from the same metadata in future travel features

### 12.2 Admin Experience

A kennel admin or misman should be able to:

- classify an event with minimal friction
- trust automatic classification when correct
- override it quickly when wrong
- avoid creating duplicate editorial records

### 12.3 Visual Treatment Guidance

Exact visual treatment will be iterated during design/build. Possible patterns include:

- showing both top events
- showing one highlighted event at a time
- carousel behavior
- dedicated module plus inline badge treatment

The PRD defines behavior and constraints, not final pixel design.

---

## 13. Permissions

### 13.1 Allowed Roles

Special Event metadata may be managed by:

- global admins
- kennel admins / mismans for their own kennel(s)

### 13.2 Disallowed Roles

Standard users without relevant admin or misman permissions cannot manage Special Event metadata.

---

## 14. Risks

- HashRego may over-tag for kennels that use it as a general hareline source
- "Special Event" may lose meaning if applied too broadly
- taxonomy may become messy if expanded too early
- visual prominence may create noise if overdone
- multi-day events may feel awkward if schema and surfacing logic are not aligned

---

## 15. Dependencies and Related Work

This feature complements and should be designed with awareness of:

- Travel / Discovery UX
- HashRego adapter behavior
- event series / multi-day event handling
- Hareline filtering behavior
- kennel page promotion modules

See also: `docs/multi-day-events-mini-spec.md`

---

## 16. Proposed Data Model Notes

These are implementation-oriented recommendations, not locked schema requirements.

### 16.1 Event Fields

Recommended additions on `Event`:

```prisma
enum SpecialEventCategory {
  HASH_WEEKEND
  CAMPOUT
  PUB_CRAWL
  SPECIAL_EVENT
}

enum SpecialEventSource {
  MANUAL
  HASHREGO
  ADAPTER_INFERRED
  SYSTEM_DEFAULT
}

model Event {
  // existing fields ...

  isSpecialEvent          Boolean             @default(false)
  specialEventCategory    SpecialEventCategory?
  specialEventSource      SpecialEventSource?
  specialEventPriority    Int?                // optional manual sort order
  specialEventOverride    Boolean             @default(false)
  specialEventUpdatedById String?             // optional audit trail
  specialEventUpdatedAt   DateTime?

  // existing multi-day linkage fields are expected to remain compatible
}
```

### 16.2 Why these fields

- `isSpecialEvent` gives simple filter behavior
- `specialEventCategory` supports structured browsing
- `specialEventSource` explains why the event was classified
- `specialEventPriority` supports kennel-module ordering later without changing the model
- `specialEventOverride` protects manual decisions from re-import drift

### 16.3 Compatibility with current roadmap

The roadmap already notes HashRego adapter support and series linking for multi-day events, which makes this a natural extension rather than a new isolated model.

---

## 17. Admin UI Entry Points

### 17.1 Event Detail / Event Admin Entry Point

Recommended admin controls on the event detail or admin event edit surface:

- toggle: `Special Event`
- select: `Category`
- read-only or subtle label: `Classification Source`
- optional input: `Priority`
- button/action: `Reset to imported default` if a manual override exists

### 17.2 Kennel Admin / Misman Entry Point

For kennel admins or mismans, the most useful entry point is likely:

- the event detail panel/page for one of their kennel's events
- a light inline edit action in the kennel page Special Events section
- optionally later, a kennel-level queue of upcoming special events

### 17.3 Permissions behavior

- global admin can edit any event
- kennel admin / misman can edit only their kennel's relevant events
- standard users see labels and filters only

---

## 18. Display and Querying Notes

### 18.1 Hareline

Recommended query behavior:

- `Special Events only` filter maps to `isSpecialEvent = true`
- category filter maps to `specialEventCategory`
- special-event metadata should flow through list, calendar, and relevant detail surfaces

### 18.2 Kennel Page Module

Recommended module logic:

1. filter to upcoming events for the kennel where `isSpecialEvent = true`
2. collapse linked multi-day series to one logical result where possible
3. sort by explicit priority first, then by upcoming date
4. display at most 2 promoted items

### 18.3 Travel Search Readiness

Future travel search should be able to query:

- destination / region
- date range
- Special Event only
- category = campout / hash weekend / pub crawl / special event

---

## 19. Rollout Plan

### Phase 1: Data and Admin Control

- add schema fields
- add admin/misman editing controls
- add source classification logic
- preserve manual override precedence

### Phase 2: Hareline and Kennel Surfacing

- add inline badge treatment in Hareline
- add filters for Special Event and category
- add kennel page Special Events module
- enforce kennel promo surfacing limit

### Phase 3: Measurement and Refinement

- instrument analytics events
- monitor classification volume and false positives
- refine HashRego/source rules for edge-case kennels
- iterate visual treatment

### Phase 4: Travel / Discovery Integration

- expose Special Event filters in travel mode
- support region/time/category driven discovery questions
- evaluate need for dedicated discovery landing page

---

## 20. Suggested Analytics / Instrumentation

Recommended events:

- `special_event_marked_manual`
- `special_event_removed_manual`
- `special_event_auto_classified`
- `special_event_filter_used`
- `special_event_category_filter_used`
- `special_event_module_click`
- `special_event_hareline_click`

These do not need to ship day one if instrumentation timing is tight, but they should be planned early.

---

## 21. Success Metrics

### 21.1 Product Metrics

- number of events classified as Special Events
- percentage auto-classified vs manually classified
- filter usage for categories such as Campout and Hash Weekend
- click-through rate for Special Events vs standard events
- engagement with kennel-page Special Event modules

### 21.2 Strategic Validation

- users can more easily identify major events
- admins find the feature easy enough to maintain
- category metadata remains clean and useful
- future travel/discovery features can reuse this model without rework

---

## 22. Open Questions

- Should some HashRego auto-tagging scenarios be suggestions instead of immediate auto-apply?
- What is the best surfacing pattern when more than two events qualify for promotion?
- Should category-specific discovery landing pages come before or after travel search?
- How much multi-day grouped UI should be bundled into this work versus fast follow?

---

## 23. Acceptance Criteria

### 23.1 Data Model and Classification

**AC-1: Event can store Special Event metadata**  
**Given** an event exists in HashTracks  
**When** the system or an authorized admin classifies it as a Special Event  
**Then** the event stores whether it is a Special Event, its category, the source of classification, and manual override state if applicable

**AC-2: Controlled taxonomy is enforced**  
**Given** a user or import process attempts to assign a category  
**When** the category is saved  
**Then** it must be one of the approved V1 values:
- Hash Weekend
- Campout
- Pub Crawl
- Special Event

**AC-3: Dress runs map to Special Event**  
**Given** an event such as Red Dress, Green Dress, or another color dress run is marked as special  
**When** the category is assigned  
**Then** it is stored as `Special Event` in V1

### 23.2 Automatic Classification

**AC-4: HashRego events auto-classify by default**  
**Given** an event is imported from HashRego  
**When** the event is created or updated from that source  
**Then** it is automatically marked as a Special Event by default

**AC-5: HashRego auto-classification is overridable**  
**Given** a kennel uses HashRego for many normal trails rather than just notable events  
**When** an authorized admin or misman removes or changes the classification  
**Then** the manual decision is saved and takes precedence over the imported default

**AC-6: Adapter-specific trusted sources can auto-classify**  
**Given** an adapter or special-event page is explicitly configured as a trusted source of special events  
**When** it imports an event  
**Then** the event may be automatically marked as a Special Event with a category if source logic supports it

### 23.3 Permissions and Admin Controls

**AC-7: Authorized roles can manage Special Event metadata**  
**Given** a global admin or kennel admin/misman for the relevant kennel  
**When** they edit an event  
**Then** they can add or remove Special Event status, assign or change category, and override imported classification

**AC-8: Unauthorized users cannot manage Special Event metadata**  
**Given** a standard user without admin/misman permission for that kennel  
**When** they view or interact with the event  
**Then** they cannot change Special Event metadata

**AC-9: Manual override wins over imported logic**  
**Given** an event was auto-classified from HashRego or another adapter  
**When** an authorized user manually changes its status or category  
**Then** the manual value takes precedence until intentionally changed again

### 23.4 Hareline Experience

**AC-10: Special Events are visibly distinguishable in Hareline**  
**Given** a Special Event appears in Hareline results  
**When** a user views the event in list, calendar, or relevant detail surfaces  
**Then** the event includes visible Special Event labeling or treatment

**AC-11: Users can filter to all Special Events**  
**Given** a user is browsing Hareline  
**When** they apply a Special Events filter  
**Then** Hareline returns only events classified as Special Events

**AC-12: Users can filter by category**  
**Given** a user is browsing Hareline  
**When** they filter by a category such as Campout  
**Then** Hareline returns only events with that Special Event category

**AC-13: Special Event metadata remains present outside promo modules**  
**Given** a kennel has more than two upcoming Special Events over time  
**When** a user browses Hareline outside a kennel promo module  
**Then** all relevant events can still be found and retain their Special Event metadata

### 23.5 Kennel Page Experience

**AC-14: Kennel page shows promoted Special Events section**  
**Given** a kennel has one or more upcoming Special Events  
**When** a user visits that kennel's page  
**Then** the page includes a dedicated Special Events section or equivalent promoted treatment

**AC-15: Kennel promo module shows at most two events**  
**Given** a kennel has more than two upcoming Special Events  
**When** the kennel page renders its promoted area  
**Then** only up to two are surfaced in that module at a time

**AC-16: Surfacing limit does not affect discoverability**  
**Given** a kennel has more than two upcoming Special Events  
**When** a user searches or filters elsewhere in Hareline  
**Then** all Special Events remain discoverable regardless of kennel-page promo limits

### 23.6 Time and Historical Behavior

**AC-17: Past events do not appear in active promo modules by default**  
**Given** a Special Event has already ended  
**When** a user visits a kennel page or other active promo surface  
**Then** that event is not shown by default in upcoming promotional sections

**AC-18: Historical metadata is preserved**  
**Given** a Special Event has ended  
**When** the event remains stored in HashTracks  
**Then** its metadata remains available for history, analytics, or future historical views

### 23.7 Travel / Discovery Readiness

**AC-19: Special Event metadata is queryable for future discovery features**  
**Given** a Special Event exists in HashTracks  
**When** future travel or discovery features query events by region, time, and category  
**Then** the event can participate in those queries using its Special Event metadata

**AC-20: Campout and Hash Weekend support discovery use cases**  
**Given** a user wants to answer a question like "where are the campouts this summer in the Northeast?"  
**When** travel/discovery filtering is later built  
**Then** the required category metadata already exists in the event model

### 23.8 Edge Cases

**AC-21: Normal events are unaffected by default**  
**Given** an event has no Special Event metadata  
**When** it is shown in Hareline or kennel pages  
**Then** it behaves as a normal event without Special Event labeling or filtering behavior

**AC-22: Re-import does not erase valid manual override**  
**Given** an event has been manually reclassified by an authorized user  
**When** its source re-imports updated data  
**Then** the manual override is preserved unless intentionally reset by supported admin logic

**AC-23: Category filtering stays consistent across supported views**  
**Given** Special Event category filters are available on supported Hareline surfaces  
**When** a user switches between relevant views  
**Then** filtering behavior remains consistent with existing filter expectations

---

## 24. Implementation Checklist

- [ ] Add schema fields / enums for Special Event metadata
- [ ] Create migration
- [ ] Update import pipeline for HashRego default classification
- [ ] Add trusted-adapter classification hooks
- [ ] Add manual override logic and precedence rules
- [ ] Add admin / misman UI controls
- [ ] Add Hareline badge treatment
- [ ] Add Hareline filters
- [ ] Add kennel page promoted Special Events module
- [ ] Add analytics events
- [ ] Test re-import + override edge cases
- [ ] Manual QA on a mix of HashRego-heavy and non-HashRego kennels
