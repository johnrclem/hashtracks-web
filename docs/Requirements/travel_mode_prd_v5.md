# Product Requirements Document: Travel Mode (v5)

## 1. Overview & Objective

### Primary User Value
Travel Mode helps hashers discover confirmed and likely hashing opportunities during an upcoming trip, with clear trust signals and easy paths to independently verify uncertain details.

### Secondary Business Value
By making Travel Mode available to unauthenticated users, HashTracks can showcase the value of its aggregated event and kennel data as a top-of-funnel acquisition experience that drives account creation and saved-search behavior.

## 2. Problem Statement
Hashers frequently travel and want to know whether there are local trails happening while they are in town. This is difficult because:
- trail details are fragmented across kennel sites, social media, calendars, and event tools
- many future trails are not yet officially posted
- travelers often care about a broad surrounding region, not just one exact city
- users need a way to distinguish confirmed events from likely-but-unconfirmed activity

Travel Mode solves this by showing both:
- confirmed events during a user’s travel window
- likely hashing opportunities based on known kennel schedule patterns, with confidence labels and outbound verification links

## 3. Target Audience & Use Cases

### Personas
- **The Nomadic Hasher:** planning a longer trip and wanting to discover hashing options during a future stay
- **The Weekend Warrior:** taking a short trip and wanting a quick answer on whether a trail lines up
- **The Regional Explorer:** willing to travel outside the immediate destination city for a worthwhile kennel or event
- **The Skeptical Verifier:** interested in opportunities, but wanting strong trust signals and source links before making plans
- **The Unauthenticated Guest:** discovering HashTracks via search or social, testing Travel Mode, and encountering signup when they want persistence

## 4. MVP Product Scope

### In Scope
- Single-destination travel search
- Input of one destination plus start and end dates
- Display of confirmed events during the trip window
- Display of likely trails during the trip window
- Optional display of lower-confidence “possible activity” in a clearly separated or collapsed section
- Confidence labeling for non-confirmed results
- Outbound source links for verification
- Guest users can search and view full results
- Authenticated users can save a trip/search and revisit it later from a dashboard
- Basic filtering by confidence and distance tier
- No-results and low-signal states

### Out of Scope
- Multi-stop itinerary builder
- Notifications or alerts when likely activity becomes confirmed
- Calendar integration
- Route planning or drive-time estimation
- Bookmarking individual events or kennels
- Collaborative/shared trips
- Personalized recommendations
- Full 12-month projection horizon at launch

## 5. User Stories
- **US1:** As a traveling hasher, I want to enter a destination and travel dates so I can see hashing opportunities during my stay.
- **US2:** As a planner, I want to see both confirmed and likely activity, clearly distinguished from one another.
- **US3:** As a user exploring an unfamiliar area, I want to see a broad set of nearby options, while being able to filter by distance and confidence.
- **US4:** As a guest user, I want to search and view results without creating an account.
- **US5:** As a guest user, I want to be prompted to create an account when I try to save my trip/search so I can come back later without re-entering everything.
- **US6:** As a registered user, I want to save a trip/search to my dashboard so I can revisit it closer to travel and see refreshed results.
- **US7:** As a user viewing likely activity, I want links to the official kennel site or social presence so I can verify details independently.
- **US8:** As a cautious user, I want clear language explaining why a result is considered likely and how reliable it is.

## 6. Core UX Principles
- Prefer inclusion over omission, but rank and label results carefully
- Never present likely or possible activity as confirmed
- Make trust visible through badges, rationale, and outbound source links
- Let guests experience the value before asking them to sign up
- Optimize the MVP for fast list-based discovery rather than a complex trip-planning workflow
- Default to showing the most actionable results first

## 7. Result Types

### 7.1 Confirmed Events
Events with a known date and meaningful event details sourced from a confirmed posting.

### 7.2 Likely Trails
Date-specific results generated from highly or moderately reliable kennel schedule patterns.

These may appear as event-style cards when the system has enough confidence to associate the kennel with a likely date during the trip window.

### 7.3 Possible Activity
Lower-confidence indications that a kennel typically runs during a certain part of the month, week, or weekend, but without enough certainty to represent the result as a specific event.

These should not look identical to confirmed or likely trails, and should be visually demoted or placed in a separate/collapsed section by default.

## 8. Input Model

### MVP Search Inputs
- destination
- start date
- end date

### Future Inputs
- multiple destinations
- willingness to travel farther
- pinned events or kennels
- search radius controls
- trip notes

## 9. Data Model

### 9.1 Trip
- `id` (UUID)
- `user_id` (nullable FK)
- `session_id` (nullable string, for guest persistence before signup)
- `name` (string, auto-generated initially; editable later if low effort)
- `status` (optional enum: `draft`, `active`, `completed`, `archived`)
- `created_at`
- `updated_at`
- `last_viewed_at` (optional)

### 9.2 TripDestination
For MVP, only one destination will be supported in the product experience, though the model may remain extensible.

- `trip_id`
- `location_name`
- `lat`
- `lng`
- `start_date`
- `end_date`
- `timezone` (recommended)
- `place_id` or normalized location reference (recommended)

## 10. Projection / Likelihood Engine

### 10.1 Projection Horizon
MVP will generate likely activity up to 90 days out.

### 10.2 Confidence Tiers
Non-confirmed activity will carry one of three confidence levels:
- **High Confidence:** strict, predictable schedule with strong consistency and a stable source
- **Medium Confidence:** recurring pattern exists, but there is some variability in timing or consistency
- **Low Confidence:** loose cadence or limited validation; should surface only as possible activity rather than a standard likely trail card

### 10.3 Confidence Inputs
Confidence should be informed by some combination of:
- schedule specificity
- historical consistency
- recency of source validation
- exception frequency
- certainty of location
- quality/stability of source

### 10.4 Minimum Threshold (MVP)
For MVP, a kennel may produce a likely or possible result when at least one known schedule rule exists.

This is intentionally permissive to support broader coverage early, with the expectation that thresholds and weighting will be refined based on real user behavior, data quality, and trust outcomes.

### 10.5 User-Facing Messaging
Likely and possible results should explain why they are appearing. Examples:
- “Usually runs every Thursday evening”
- “Typically hosts a trail on the second Saturday of the month”
- “Pattern based on recent historical activity”
- “Often active this weekend of the month; verify closer to your trip”

Where possible, supporting context should reference the evidence window, such as:
- “Based on activity over the last 12 months”
- “Based on recent pattern observed in HashTracks data”

## 11. Geo-Spatial Query Logic

To avoid filtering out viable trails, Travel Mode will use broad inclusion logic.

### Matching Logic
- Confirmed events: distance based on known event start location
- Likely or possible results: distance based on kennel operating region

### Distance Treatment
Results will be grouped into user-friendly tiers such as:
- Under 5 miles
- 5–15 miles
- 15+ miles

These tiers are intended for filtering and scanning, not for overstating routing precision.

### Low-Precision Region Handling
For kennels with only broad regional precision, Travel Mode should be more forgiving in weaker-data areas and more selective in denser areas with stronger nearby coverage.

This logic will likely require iteration during design and early implementation.

## 12. Result Ranking & Presentation

### Default Ranking
1. Confirmed events during the trip window
2. High-confidence likely trails
3. Medium-confidence likely trails
4. Low-confidence possible activity

Within each category, rank by:
- soonest relevant date
- then proximity tier

### Default Presentation
For MVP, results should be list-first.

The list should be primarily organized by date, with each result also showing:
- status (Confirmed / Likely / Possible)
- confidence level where applicable
- distance tier
- source links
- short explanation for why the result is being shown

Map-based presentation should remain on the roadmap, but is not required for MVP.

## 13. UI/UX Requirements

### 13.1 Likely Trail Treatment
Any non-confirmed date-specific result must have:
- distinct visual treatment from confirmed events
- confidence badge
- explanatory copy
- explicit note that exact details may still be unconfirmed

### 13.2 Possible Activity Treatment
Low-confidence results should not use the same card pattern as confirmed or likely trails. They should feel more like “other possibilities worth checking.”

These may appear:
- in a visually demoted section
- behind an expandable “Possible activity” section
- only after stronger results have been shown

### 13.3 Outbound Linking
Likely and possible results must prominently include links to one or more of:
- kennel website
- Facebook group/page
- HashRego page
- other official kennel source

### 13.4 Guest Conversion
Guest users can search and view full results. Saving a trip/search requires signup.

Primary authenticated-value CTA:
- Save trip/search

Primary guest conversion CTA:
- Create account to save and revisit this search later

### 13.5 “Why Am I Seeing This?” Explanation
Likely and possible results should include concise explanatory text that helps users understand why the result was surfaced.

Where available, this should describe both:
- the pattern
- the evidence window

Example:
- “Usually runs on Thursdays, based on recent historical activity”

### 13.6 Vocabulary to Test
The product should test user-facing labels for non-confirmed results during design validation.

Candidate labels include:
- Likely trail
- Probably happening
- Unconfirmed but likely
- Possible activity

“Projected” may remain useful internally, but should not be assumed to be the clearest default label in the UI.

## 14. Empty / Low-Signal States

### No Confirmed Events, But Likely Activity Exists
Message:
- No confirmed trails found yet for your dates, but these kennels usually run during your stay.

### No Nearby Results, But Broader Regional Results Exist
Message:
- Nothing found very close to your destination, but here are options in the surrounding region.

### No HashTracks Coverage in Area
Message:
- No known hashing activity found in this area in HashTracks.
- Optional secondary link: direct users to a broader external aggregation source such as GototheHash, with clear framing that HashTracks only shows areas where it can display event-level activity.

## 15. Authentication, Save Behavior & Persistence

### Guest Experience
- can run search
- can view full result set
- session can temporarily hold trip/search context

### Registered Experience
- can save trip/search
- can revisit saved searches from dashboard
- saved searches should re-run against the latest available data while preserving the original destination and date criteria

For MVP, save behavior should be thought of primarily as a **saved search with refresh**, not a full itinerary-management experience.

## 16. Success Metrics

### Usage
- trips/searches created per week
- percent of trips/searches with at least one result
- percent with at least one confirmed result

### Engagement
- CTR from results to event detail pages
- outbound link CTR to kennel verification sources
- filter usage by confidence and distance
- expansion rate of any collapsed “Possible activity” section

### Acquisition
- guest search to signup click
- signup click to completed registration
- guest search to registered saved-search conversion

### Retention
- percent of authenticated users who revisit a saved search before travel begins
- average number of return visits per saved search

### Trust / Quality
- percent of likely results later confirmed
- distribution of results by confidence tier
- exposure rate of low-confidence possible activity
- qualitative feedback or complaint rate indicating misleading results
- bounce rate from results pages with only likely/possible content

## 17. Risks & Mitigations

### Trust Risk
Users may interpret likely activity as confirmed.

**Mitigation:**
- distinct visual treatment
- rationale text
- evidence-window copy where possible
- source links
- separate treatment for possible activity

### Data Freshness Risk
Kennel schedules may be stale or inconsistent.

**Mitigation:**
- recency as a confidence input
- prefer confirmed events when available
- degrade stale patterns to lower confidence

### Noise Risk
Broad-radius or low-confidence results may overwhelm users.

**Mitigation:**
- strong default ranking
- date-first organization
- distance/confidence filters
- visually demoted or collapsed possible-activity section

### Acquisition Risk
Guests may get enough value without signing up.

**Mitigation:**
- keep search open
- make save/revisit clearly valuable
- frame saved searches as living references that get better over time

## 18. Decision Log

- MVP is focused on the core job of fast discovery, not a full trip-planning workflow
- MVP supports a single destination, even if the data model remains extensible for multi-stop trips later
- List-first presentation is acceptable for MVP; map remains a future enhancement
- Guests can see full results, but saving and persistence require signup
- Saved searches should refresh against the latest available data when revisited
- MVP projection horizon is 90 days
- A single known schedule rule is sufficient to allow a likely or possible result in MVP, subject to future refinement
- Low-confidence results should not sit in the main result set with equal weight; they should be clearly demoted or separated
- User-facing terminology for non-confirmed results should be validated in design testing rather than assuming “projected” is best
- External aggregator links should be used only in true no-coverage areas
