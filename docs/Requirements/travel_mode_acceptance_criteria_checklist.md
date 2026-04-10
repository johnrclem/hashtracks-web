# Travel Mode MVP Acceptance Criteria & Implementation Checklist

## 1. Purpose
This document converts the Travel Mode PRD, Technical Build Spec, and ERD into an agent-friendly execution checklist.

It is designed to answer:
- what must be built
- what “done” means
- how work can be broken into implementation chunks
- what should be verified before calling the MVP complete

## 2. Definition of Done (MVP)
Travel Mode MVP is considered done when:

- a user can enter a destination and date range
- the system returns correctly ranked Travel Mode results
- confirmed, likely, and possible results are clearly distinguished
- guests can search without authentication
- authenticated users can save a search and revisit it later
- revisiting a saved search refreshes results using current data
- likely/possible results include explanation text and source links where available
- no-result and no-coverage states are handled explicitly
- analytics events are instrumented for core flows
- core edge cases and validation rules pass QA

## 3. Functional Acceptance Criteria

## 3.1 Search Input
### Acceptance Criteria
- user can enter a destination
- user can enter a start date
- user can enter an end date
- search submission is blocked if any required field is missing
- search submission is blocked if end date is before start date
- destination must geocode successfully before results are shown
- invalid input surfaces clear error messaging without losing user-entered values

### Implementation Checklist
- [ ] Build destination input
- [ ] Build start date input
- [ ] Build end date input
- [ ] Add client-side validation
- [ ] Add server-side validation
- [ ] Integrate geocoding for destination normalization
- [ ] Handle geocode failure state

---

## 3.2 Search Execution
### Acceptance Criteria
- valid search runs without authentication
- search returns normalized destination data
- search returns result groups for confirmed, likely, and possible activity
- search applies ranking rules consistently
- search returns appropriate empty-state metadata when no results exist

### Implementation Checklist
- [ ] Create Travel Mode search service or endpoint
- [ ] Accept destination, start_date, end_date, and optional filters
- [ ] Normalize destination into lat/lng/place_id if available
- [ ] Query confirmed events in window
- [ ] Query candidate kennels and schedule rules
- [ ] Compute likely and possible results
- [ ] Apply ranking and grouping
- [ ] Return structured response payload

---

## 3.3 Result Classification
### Acceptance Criteria
- confirmed results are based on actual events in the searched date window
- likely results are based on date-specific schedule inference and medium/high confidence
- possible results are based on weaker or lower-confidence schedule evidence
- no non-confirmed result is labeled as confirmed

### Implementation Checklist
- [ ] Implement confirmed result rules
- [ ] Implement likely result rules
- [ ] Implement possible result rules
- [ ] Prevent duplicated surfacing of the same opportunity across result types
- [ ] Add unit tests for classification logic

---

## 3.4 Confidence & Explanation Logic
### Acceptance Criteria
- likely and possible results include explanatory copy
- explanation text reflects known pattern where possible
- confidence is surfaced for likely results
- low-confidence results are not presented with the same weight as confirmed results
- if evidence-window language is available, it can be included

### Implementation Checklist
- [ ] Implement confidence assignment logic
- [ ] Generate explanation text from schedule-rule data
- [ ] Support optional evidence-window text
- [ ] Map confidence output to UI labels
- [ ] Add tests for representative rule types

---

## 3.5 Distance & Geographic Logic
### Acceptance Criteria
- confirmed results use event coordinates when available
- likely/possible results use kennel regional coordinates
- each result is assigned a distance tier
- broad/low-precision regional matches can be surfaced but should be demoted appropriately
- the system avoids claiming drive-time precision for MVP

### Implementation Checklist
- [ ] Implement distance calculation
- [ ] Implement distance-tier mapping
- [ ] Use event coords for confirmed results
- [ ] Use kennel region coords for likely/possible results
- [ ] Support region precision or similar demotion signal
- [ ] Add tests for missing coordinate scenarios

---

## 3.6 Ranking
### Acceptance Criteria
- confirmed results appear before likely results by default
- high-confidence likely results appear before medium-confidence likely results
- possible results appear after stronger result types
- within a ranking bucket, results are ordered by earliest relevant date and then proximity
- ranking is deterministic

### Implementation Checklist
- [ ] Implement primary ranking buckets
- [ ] Implement secondary sort by date
- [ ] Implement tertiary sort / tiebreaker
- [ ] Add ranking tests covering mixed result sets

---

## 3.7 Results UI
### Acceptance Criteria
- results are displayed in a list-first layout
- confirmed, likely, and possible results are visually distinguishable
- likely results show explanation text
- possible activity is visually demoted or placed in a separated/collapsed section
- source links are visible where available
- save CTA is visible at the search/page level
- page handles loading state cleanly

### Implementation Checklist
- [ ] Build results page shell
- [ ] Build confirmed result card/pattern
- [ ] Build likely result card/pattern
- [ ] Build possible activity section/pattern
- [ ] Add loading state
- [ ] Add empty state rendering
- [ ] Add source link rendering
- [ ] Add save CTA

---

## 3.8 Empty / Low-Signal States
### Acceptance Criteria
- if no confirmed results exist but likely results do, user sees an explicit “no confirmed yet” message
- if no close results exist but broader regional results do, user sees a broader-region message
- if no HashTracks coverage exists, user sees a no-coverage message
- no-coverage is not confused with system failure
- optional external aggregation fallback appears only in true no-coverage cases

### Implementation Checklist
- [ ] Define empty_state_type values in API/service response
- [ ] Build no-confirmed-but-likely UI
- [ ] Build broader-region UI
- [ ] Build no-coverage UI
- [ ] Add optional external-link fallback handling
- [ ] Add QA coverage for each empty state

---

## 3.9 Guest Search Experience
### Acceptance Criteria
- guest users can submit search
- guest users can view full result set
- guest users are not required to authenticate before seeing results
- guest users can click save, but save action triggers auth gate

### Implementation Checklist
- [ ] Allow unauthenticated search requests
- [ ] Ensure results page is viewable for guests
- [ ] Gate save action behind auth
- [ ] Preserve search context through auth handoff

---

## 3.10 Authenticated Save Search
### Acceptance Criteria
- authenticated user can save a Travel Mode search
- saved search stores destination and date criteria
- saved search appears in user’s saved-search/dashboard list
- save action shows success state or confirmation
- duplicate-save behavior is defined and handled reasonably

### Implementation Checklist
- [ ] Create persisted travel search record
- [ ] Create persisted destination record
- [ ] Add save action from results page
- [ ] Add success/confirmation UX
- [ ] Decide duplicate-save behavior
- [ ] Add tests for save success/failure

---

## 3.11 Revisit Saved Search
### Acceptance Criteria
- authenticated user can view a list of saved searches
- user can open an individual saved search
- opening a saved search re-runs result computation using current data
- saved searches are not treated as static result snapshots
- last_viewed_at or equivalent is updated on access

### Implementation Checklist
- [ ] Build saved-search list query
- [ ] Build saved-search detail route/page
- [ ] Recompute results on load
- [ ] Update last_viewed_at
- [ ] Add tests for refreshed-result behavior

---

## 3.12 Source Links / Verification
### Acceptance Criteria
- likely and possible results display one or more source links when available
- source links use the most relevant official or semi-official sources available
- source-link clicks are trackable for analytics
- missing source links do not break result rendering

### Implementation Checklist
- [ ] Expose source links in result payload
- [ ] Render source-link UI in result cards/sections
- [ ] Add click tracking for source links
- [ ] Handle missing or partial source-link data gracefully

---

## 3.13 Analytics / Instrumentation
### Acceptance Criteria
The following events are instrumented:
- travel_search_submitted
- travel_search_results_viewed
- travel_result_clicked
- travel_source_link_clicked
- travel_save_clicked
- travel_auth_prompt_shown
- travel_saved_search_created
- travel_saved_search_viewed
- travel_possible_section_expanded

### Implementation Checklist
- [ ] Define analytics schema/event payloads
- [ ] Fire search submission event
- [ ] Fire results viewed event
- [ ] Fire result click event
- [ ] Fire source-link click event
- [ ] Fire save click event
- [ ] Fire auth-prompt event
- [ ] Fire saved-search created event
- [ ] Fire saved-search viewed event
- [ ] Fire possible-section expanded event

---

## 3.14 Error Handling
### Acceptance Criteria
- input validation errors are shown clearly
- geocoding failure is distinct from no results
- search-service failure is distinct from no coverage
- errors do not silently collapse into misleading empty states
- entered form values are preserved where possible after error

### Implementation Checklist
- [ ] Add form validation error states
- [ ] Add geocoding failure messaging
- [ ] Add search-service failure messaging
- [ ] Preserve form state on recoverable errors
- [ ] Add QA coverage for failure modes

## 4. Data / Schema Checklist

### Acceptance Criteria
- schema supports saved searches
- schema supports one destination per search in MVP behavior
- schema supports schedule rules and kennel region logic
- schema supports confidence-related inputs
- schema supports guest flow if server-side persistence is used

### Implementation Checklist
- [ ] Create `trip_searches` table
- [ ] Create `trip_destinations` table
- [ ] Confirm `kennels` supports region fields
- [ ] Confirm `kennels` supports region precision
- [ ] Confirm `events` supports confirmed event data needed by search
- [ ] Create or extend `schedule_rules`
- [ ] Add necessary indexes
- [ ] Decide whether `source_links` is needed for MVP
- [ ] Decide whether `guest_sessions` is needed for MVP

## 5. Backend Task Breakdown

### Search / Compute Layer
- [ ] Build Travel Mode search orchestrator
- [ ] Build confirmed-event retrieval logic
- [ ] Build schedule-rule retrieval logic
- [ ] Build likely/possible computation engine
- [ ] Build ranking layer
- [ ] Build empty-state determination logic
- [ ] Build response formatter

### Persistence Layer
- [ ] Build save-search write path
- [ ] Build saved-search read path
- [ ] Build saved-search detail read path
- [ ] Build last_viewed update
- [ ] Optionally build delete/archive behavior

### Cross-Cutting
- [ ] Add auth enforcement for save
- [ ] Add analytics hooks
- [ ] Add error handling and logging
- [ ] Add automated tests

## 6. Frontend Task Breakdown

### Search Entry
- [ ] Build Travel Mode entry point/page
- [ ] Build destination input
- [ ] Build date inputs
- [ ] Build validation states
- [ ] Build submit/loading state

### Results Experience
- [ ] Build results layout
- [ ] Build confirmed section
- [ ] Build likely section
- [ ] Build possible section
- [ ] Build source-link UI
- [ ] Build save CTA
- [ ] Build empty states
- [ ] Build error states

### Saved Search Experience
- [ ] Build saved-search list view
- [ ] Build saved-search detail view
- [ ] Build refresh-on-open behavior
- [ ] Build auth handoff return flow for guest save attempts

## 7. Testing Checklist

## 7.1 Unit Tests
- [ ] classification logic
- [ ] confidence mapping
- [ ] ranking logic
- [ ] distance-tier mapping
- [ ] explanation text generation
- [ ] empty-state determination

## 7.2 Integration Tests
- [ ] search request → result payload
- [ ] guest search flow
- [ ] guest save → auth prompt
- [ ] authenticated save flow
- [ ] saved-search revisit flow
- [ ] no-coverage behavior
- [ ] partial missing-data behavior

## 7.3 UI / End-to-End Tests
- [ ] valid search submission
- [ ] invalid search validation
- [ ] results render by type
- [ ] possible section expands/collapses if applicable
- [ ] save flow works for authenticated users
- [ ] guest save prompts auth
- [ ] saved search detail refreshes correctly

## 8. Launch Readiness Checklist
- [ ] PRD-approved scope is implemented
- [ ] build spec acceptance criteria are satisfied
- [ ] analytics verified in non-prod or staging
- [ ] edge-case QA completed
- [ ] copy for likely/possible states reviewed
- [ ] no-coverage fallback reviewed
- [ ] saved-search dashboard entry reviewed
- [ ] performance is acceptable for typical search response times
- [ ] open questions documented and consciously deferred

## 9. Recommended Agent Handoff Order
If handing this to an engineering agent, provide these docs together:
1. PRD v5
2. Technical Build Spec
3. Data Model / ERD
4. This Acceptance Criteria & Implementation Checklist

## 10. Optional Next-Level Additions
Not required before implementation, but useful if you want an even tighter handoff:
- endpoint-by-endpoint API contract doc
- low-fi wireframe/state spec
- seed data examples / sample payloads
- copy deck for empty states and result labels
