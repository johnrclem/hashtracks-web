# HashTracks Mini-Spec: Multi-Day Event Handling

**Document Status:** Draft  
**Owner:** John / HashTracks  
**Last Updated:** 2026-04-10  
**Related Docs:** `docs/special-events-prd.md`, `docs/roadmap.md`

---

## 1. Overview

Many of the most valuable events in HashTracks are multi-day:

- campouts
- hash weekends
- destination events
- pub crawl weekends
- event series imported from sources like HashRego

HashTracks already has roadmap acknowledgment that multi-day events are being split and linked at the scraper/data layer while grouped UI remains deferred. This mini-spec defines how multi-day events should be represented and handled so Special Events and future travel features can build on a stable foundation.

---

## 2. Problem Statement

Today, a multi-day event may be represented as multiple day-level event records. That works for ingestion and scheduling, but it can create product problems:

- users may see what feels like duplicate events
- Special Event labeling may be inconsistent across days
- kennel pages may waste promo space on multiple cards for what users think of as one event
- travel/discovery search may struggle to present a weekend or campout clearly
- admins may not know whether they are tagging one day or the whole event

---

## 3. Goals

### 3.1 Primary Goals

- Represent a multi-day event as one logical series with one or more day-level instances
- Ensure Special Event metadata can apply consistently across the whole series
- Avoid duplicated-looking surfacing in high-visibility modules
- Preserve day-level detail where needed
- Keep the model compatible with future travel/discovery experiences

### 3.2 Secondary Goals

- Support importer behavior from HashRego and similar sources
- Give admins a sane path to manage multi-day events without repetitive editing
- Enable future grouped UI without forcing it into the first release

---

## 4. Non-Goals

The following are out of scope for this mini-spec:

- fully polished grouped multi-day UI
- rich itinerary pages with custom content blocks
- lodging, payment, or package logic
- ticketing and registration workflows
- final card-level visual design for grouped series

---

## 5. Definitions

### 5.1 Single-Day Event

An event occurring on one date only.

### 5.2 Multi-Day Event / Event Series

A logically unified event spanning multiple dates, often sharing a title, theme, and destination significance while still having day-level schedule detail.

### 5.3 Parent Event / Series Parent

A logical parent identity representing the overall campout, weekend, or series.

### 5.4 Child Event / Day Instance

An individual day record associated with the multi-day parent.

---

## 6. Product Principles

- A multi-day event should feel like one logical event to users even if stored as multiple records.
- The data model should support both series-level identity and day-level schedule detail.
- Special Event metadata should apply consistently across the series unless deliberately overridden.
- The first implementation should prioritize data consistency and sane defaults over polished grouped UI.
- Promotion modules should avoid consuming multiple slots for one weekend whenever possible.

---

## 7. Scope

### 7.1 In Scope

- define expected behavior for multi-day identity
- define how Special Event metadata should relate to parent and child records
- define MVP and fast-follow display expectations
- define admin/editing expectations
- define key edge cases

### 7.2 Out of Scope

- final UI design
- custom itinerary builder
- full series-detail editorial page
- payment or lodging support

---

## 8. Data Model Expectations

### 8.1 Logical Representation

A multi-day event should support:

- one series-level identity
- one or more day-level event records

This may be represented via existing or extended concepts such as:

- `seriesId`
- `parentEventId`
- `isSeriesParent`

Exact implementation details can follow current HashTracks patterns, but the product behavior should reflect this structure.

### 8.2 Metadata Inheritance

Special Event metadata should generally be applied at the series level and inherited by child/day records unless explicitly overridden.

Example:

- "BeerH3 Pan-Yugo Hash 2026" is a Hash Weekend
- Friday, Saturday, and Sunday child records inherit that classification

### 8.3 Category Consistency

If a multi-day event is categorized as:

- Hash Weekend
- Campout
- Pub Crawl
- Special Event

then child records should remain category-consistent unless there is a deliberate and supported reason not to.

### 8.4 Cancellation and Child Variance

The model should allow one child/day to differ operationally from the rest of the series for cases such as:

- one day canceled
- one day time changed
- one day location changed

That variance should not break the overall series relationship.

---

## 9. Proposed Data Model Notes

These are implementation-oriented recommendations, not locked schema requirements.

### 9.1 Event Relationship Fields

Recommended existing or target fields on `Event`:

```prisma
model Event {
  // existing fields ...

  isSeriesParent Boolean @default(false)
  parentEventId  String?
  parentEvent    Event?  @relation("EventSeries", fields: [parentEventId], references: [id])
  childEvents    Event[] @relation("EventSeries")

  seriesId       String? // optional import-side or reconciliation helper
}
```

### 9.2 Optional future helper fields

These are not required immediately but may prove useful:

```prisma
model Event {
  seriesTitle      String?
  seriesStartDate  DateTime?
  seriesEndDate    DateTime?
}
```

### 9.3 Why this matters

- preserves day-level scheduling fidelity
- gives promotion and discovery flows a way to treat multiple child rows as one logical event
- reduces duplicated-looking kennel-page and travel results
- allows Special Event metadata to apply consistently across the series

---

## 10. Functional Requirements

### 10.1 Ingestion and Storage

For MVP:

- continue allowing per-day event records for import and scheduling purposes
- ensure they can be linked as part of one logical multi-day event
- ensure Special Event metadata can be attached consistently across the series

### 10.2 Series-Level Management

Admins should ideally be able to manage multi-day event classification at the series level rather than editing each child day one by one.

If true series-level editing is not available in the first implementation, then:

- editing one linked child should support propagation to the other linked children where appropriate

### 10.3 Hareline Behavior

For initial product behavior:

- Hareline may continue to show day-level records if that is how events are currently stored
- the UI should avoid making the event feel like accidental duplication where feasible
- users should be able to understand that a given event is part of a multi-day series

### 10.4 Kennel Page Promotion

For kennel promo modules:

- a multi-day event should ideally count as one logical promoted item
- the module should not spend multiple slots on separate child days of the same event unless explicitly desired by future design rules

### 10.5 Travel and Discovery Readiness

The model should support later travel/discovery result shapes such as:

- one result representing the overall weekend with a date range
- optional drill-down into day-level events
- filtering by Special Event category across the whole series

---

## 11. Admin UI Entry Points

### 11.1 Event-Level Entry

If series-level admin UI does not exist yet, the first useful entry point is the event detail or admin event page, with controls like:

- `Apply to this day only`
- `Apply to entire series`

### 11.2 Future Series-Level Entry

Fast follow admin UI could include:

- link / unlink events in a series
- view all child days for a series
- edit series title / category / parent-level metadata

### 11.3 Expected UX

Admins should not have to guess whether they are editing one child record or the whole weekend.

---

## 12. Querying and Display Notes

### 12.1 Kennel Page Promo Modules

Recommended behavior:

1. identify upcoming special events
2. collapse child events with the same logical parent into one promo candidate
3. sort by priority or earliest upcoming date
4. count the series as one item against the promo limit

### 12.2 Hareline

Recommended initial behavior:

- allow child day records to remain visible
- add subtle labeling or grouping hint where feasible
- avoid surfacing obviously repetitive rows in featured/promoted contexts

### 12.3 Travel Search

Recommended future behavior:

- series-aware result card with date range summary
- optional expansion into per-day child details
- category inherited from parent series unless intentionally overridden

---

## 13. MVP Recommendation

### 13.1 MVP

- preserve linked per-day event records
- maintain a logical series identity
- support consistent Special Event metadata across the series
- avoid wasting multiple kennel promo slots on one weekend where feasible
- keep day-level detail accessible

### 13.2 Fast Follow

- grouped Hareline display for event series
- parent card with expandable day breakdown
- series detail page showing all days together
- travel search result cards showing one weekend/campout as one primary result with range summary
- admin UI to explicitly link/unlink event series

---

## 14. Admin and Operational Expectations

### 14.1 Admin Classification

Admins should be able to understand whether they are editing:

- one day only
- the entire multi-day series

### 14.2 Source Update Handling

The system should preserve series integrity when:

- one child day updates
- date/time/location changes for a single child
- a source re-imports the full series
- one day disappears temporarily from a source feed

### 14.3 Override Expectations

Series-level metadata and child-level exceptions should be supported without breaking the overall parent-child structure.

---

## 15. Rollout Plan

### Phase 1: Data Consistency

- confirm or extend schema support for linked event series
- ensure import pipeline preserves or creates parent-child relationships
- ensure Special Event metadata can propagate across linked children

### Phase 2: Promo-Surface Awareness

- make kennel-page promo logic series-aware
- prevent multiple slots being consumed by one weekend where feasible
- preserve child-level accessibility

### Phase 3: UX Refinement

- add grouped or hinted Hareline display
- expose series-aware admin controls
- support travel-search summary cards for multi-day events

---

## 16. Risks

- users may experience duplicate-looking cards if grouping is not clear enough
- promo modules may surface noisy or repetitive content if series logic is ignored
- inconsistent child/parent metadata could make filtering unreliable
- travel results may become confusing if day-level fidelity is preserved without a coherent series identity
- admin tooling may become cumbersome if edits must be repeated per child event

---

## 17. Dependencies and Related Work

This mini-spec is tightly related to:

- Special Events classification
- HashRego ingestion rules
- Hareline surfacing and filtering
- kennel page promotion modules
- future Travel / Discovery UX
- future event-series UI work

---

## 18. Open Questions

- Should the parent series have its own standalone detail page in fast follow, or should one child page act as the main entry point?
- How should titles be displayed when daily child names differ slightly?
- When a source only provides partial day-level detail, what should be displayed at the series level?
- Should grouped series display happen first in Hareline or only in kennel-page promo modules?

---

## 19. Acceptance Criteria

**AC-M1: Multi-day events can be logically linked**  
**Given** a multi-day event is imported or created  
**When** it spans multiple dates  
**Then** the system can represent those dates as belonging to one logical event series

**AC-M2: Special Event metadata can apply across the series**  
**Given** a multi-day event is marked as a Campout, Hash Weekend, Pub Crawl, or Special Event  
**When** the event is saved  
**Then** all linked day-level event records reflect that classification unless intentionally overridden

**AC-M3: Kennel promo surfaces do not waste multiple slots on one weekend by default**  
**Given** a multi-day special event has multiple child day records  
**When** the kennel page determines which events to surface  
**Then** the series should ideally count as one logical event for promo-slot purposes

**AC-M4: Day-level events remain individually accessible**  
**Given** a multi-day event has day-specific records  
**When** a user navigates into the event data  
**Then** individual day records remain available for schedule/detail use cases

**AC-M5: Multi-day representation is compatible with future travel search**  
**Given** a multi-day special event exists  
**When** future travel/discovery features query event ranges and categories  
**Then** the series can be returned in a way that supports weekend or campout-style discovery without losing day-level fidelity

**AC-M6: Child-day operational changes do not break the series**  
**Given** one child day of a multi-day event changes time, location, or cancellation status  
**When** the event data is updated  
**Then** the child record reflects the change while the parent-child series relationship remains intact

**AC-M7: Series-level classification changes can propagate**  
**Given** an authorized admin updates the classification for a multi-day event series  
**When** the change is saved  
**Then** linked child records inherit the updated series-level classification unless a supported child-specific override exists

**AC-M8: Re-import preserves series linkage where possible**  
**Given** a multi-day event series already exists in HashTracks  
**When** the source re-imports updated event data  
**Then** the system preserves or re-establishes the logical series relationship rather than fragmenting the event into unrelated records

---

## 20. Implementation Checklist

- [ ] Confirm current schema support for parent/child event linkage
- [ ] Add or normalize series helper fields if needed
- [ ] Ensure import pipeline preserves multi-day series relationships
- [ ] Define metadata propagation rules from parent to child
- [ ] Make kennel promo queries series-aware
- [ ] Add admin UI affordance for apply-to-series vs apply-to-day
- [ ] Test partial source updates on one child day
- [ ] Test one-day cancellation within a multi-day series
- [ ] Test travel/discovery query compatibility

---

## 21. Recommended Product / Engineering Stance

For the Special Events release:

- do not require fully grouped UI before launch
- do require linked multi-day compatibility
- do require series-aware metadata behavior
- do require kennel promo logic that treats a weekend/campout as one logical promoted item wherever possible

This provides a practical release path without backing the product into a schema or UX corner later.
