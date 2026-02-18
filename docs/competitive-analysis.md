# Competitive Analysis: HashTracks vs Harrier Central

**Date:** February 17, 2026
**Purpose:** Strategic reference for roadmap prioritization. This doc captures what Harrier Central (HC) does, where it struggles, and what its user feedback reveals about unmet needs in the hashing community.

---

## Harrier Central Overview

**Harrier Central** is a mobile-first (iOS + Android) Hash House Harriers management platform built by two hashers ("Tuna Melt" and "Opee" — James & Melissa White) on a Microsoft Azure / .NET stack. Active since ~2019, 69+ kennels globally.

- **Website:** harriercentral.com
- **Admin Portal:** portal.harriercentral.com
- **Public GitHub Issues:** github.com/James-A-White/HarrierCentral (122 open, 213 closed — code is on Azure DevOps, not GitHub)
- **App Store:** iOS + Android native apps

### Business Model

- Free for individual hashers (find runs, RSVP, track run counts)
- Paid for kennels (in-app purchases): Hash Cash tracking, email distribution, Haberdashery promotion, advanced admin tools
- No advertising, no third-party data sharing
- Hosted on Azure cloud

### Tech Stack

- Backend: .NET on Microsoft Azure, Azure DevOps for source control
- Mobile: Native apps using Google Material Design
- Data: Kennel admins manually enter runs via portal or app
- No public API, no scraping, no calendar integrations

---

## Market Position Comparison

| Dimension | HashTracks | Harrier Central |
|-----------|-----------|----------------|
| **Market approach** | Hasher-first (B2C) + Misman tools | Kennel-admin-first (B2B) |
| **Data strategy** | Automated ingestion (7 sources, 3 adapter types) | Manual entry by kennel admins |
| **Regional depth** | Deep (24 kennels, 82 aliases, 7 regions) | Shallow (69 kennels, many countries) |
| **Platform** | Web-first (zero install) | Native apps (app store friction) |
| **Growth vector** | Add sources → instant coverage | Convince kennel admins → manual setup |
| **Key vulnerability** | Limited geographic reach | Manual data entry doesn't scale |

---

## HC Feature Inventory

### Core Features (Shipped)

| Category | Features |
|----------|----------|
| **Run Discovery** | Proximity-based search (radius in km/miles), kennel following, upcoming runs aggregation, map exploration with continent→city-block filtering |
| **RSVP** | Per-run RSVP, see who else is attending, visitor RSVP support |
| **Run Counts** | Automatic tracking per-kennel, milestone alerting (notifies mismanagement when a hasher hits a milestone), Excel export with per-kennel sheets |
| **Hash Cash** | Swipe-based collection (left = cash, right = electronic), per-run financial tracking, break-even analysis, credit/underpayment management, multiple payment platforms per kennel |
| **Trail Chat** | v2.0 feature: automatic chat groups for every run (coordinate transport, bag drops) |
| **Kennel Admin** | Portal at portal.harriercentral.com, run CRUD, member management, email distribution, hare volunteer signup ("Hare Raising") |
| **Haberdashery** | Merch/gear promotion features (paid tier) |
| **Notifications** | v2.0: smarter push notifications (only starting 6 hours before, none for runs you declined), RSVP→check-in reminders |
| **Reports** | Excel run reports emailed on demand, QR code sharing for kennel website/run list |
| **Platforms** | Native iOS + Android apps, web admin portal |

### Feature Gap Analysis: What HC Has That HashTracks Doesn't

| HC Feature | HashTracks Status | Priority Assessment |
|------------|-------------------|---------------------|
| Proximity/map-based discovery | Event model has lat/lng fields, no map UI | **Medium** — client-side map is 1 sprint, no PostGIS needed |
| Push notifications | Not implemented | **Medium** — PWA web push pairs with existing RSVP flow |
| Trail Chat / per-event messaging | Deferred to v2 social | **Low** — event comments are a cheaper test |
| Hash Cash amounts/credits/ledger | `paid` boolean on KennelAttendance | **Low** — boolean is sufficient; per-kennel payment link is easy add |
| Milestone alerts for mismanagement | Run count data exists, no alerting UI | **High** — tiny effort, high misman value |
| Excel export | CSV export deferred | **Medium** — simple CSV download from logbook |
| "Who's going" RSVP visibility | INTENDING status exists, not shown to others | **Medium** — UI-only change |
| Hare volunteer signup / nudging | Participation data tracked, no nudge system | **Low** — v2 feature |
| QR code sharing | Not implemented | **Low** — link sharing is sufficient |

### Feature Gap Analysis: What HashTracks Has That HC Doesn't

| HashTracks Feature | HC Status | Competitive Advantage |
|--------------------|-----------|----------------------|
| Automated source engine (7 sources, 3 adapter types) | Manual data entry only | **Structural moat** — HC can't replicate without architectural change |
| Calendar export (Google Cal + .ics) | Not available | **Proven differentiator** |
| Activity links (Strava, Garmin, AllTrails) | Not available | **Unique in hashing space** |
| Source health monitoring + self-healing alerts | N/A (manual entry) | **Operational advantage** |
| Misman smart suggestions (frequency/recency/streak scoring) | Basic attendance tracking | **Superior UX** |
| Roster groups (shared rosters across kennels) | Per-kennel only | **Novel architecture** |
| Derived verification status (verified/misman-only/user-only) | Not available | **Trust/data quality signal** |
| Audit log with field-level diffs | Not available | **Enterprise-grade accountability** |
| Historical CSV import with fuzzy matching | Not available | **Backfill capability** |
| Invite links for misman onboarding | Not available | **Frictionless team growth** |
| Web-first (zero install) | Native app (install friction — issue #335) | **Accessibility advantage** |
| Config-driven source onboarding (Google Sheets) | N/A | **Scaling advantage** |

---

## GitHub Issues Analysis: User Pain Points

HC's 122 open issues (and 213 closed) reveal recurring friction themes.

### Theme 1: Data Entry & Event Management

| Issue | Insight |
|-------|---------|
| #309 — Recurring events | Open 3+ years. Kennels hashing weekly must manually enter every run. |
| #304 — Run description space | Data model too constrained for some kennels |
| #300 — Pin vs. general area | Location model doesn't handle "area TBA" pattern |
| #312 — No buttons to add/manage runs if none exist | UX dead-end for new kennel onboarding |
| #307 — Kennels can't edit their own Hash Cash settings | Self-service is limited |

**Strategic takeaway:** HC's manual data entry is its fundamental weakness. The 3-year-old recurring events request proves the architecture can't scale. HashTracks' source engine sidesteps this entirely.

### Theme 2: RSVP & Check-in

| Issue | Insight |
|-------|---------|
| #329 — Visitor RSVP adjusts own RSVP | Fundamental RSVP state bug |
| #302 — RSVP for runs plus extras | Users want RSVP with options (guests, rides) |
| #297 — Notification for RSVPed hashers to check in | Push notification gap |

**Strategic takeaway:** HashTracks' INTENDING → CONFIRMED auto-upgrade already handles the RSVP→check-in flow cleanly. The "extras" RSVP is a future enhancement.

### Theme 3: Financial Management

| Issue | Insight |
|-------|---------|
| #307 — Kennels can't edit Hash Cash settings | Admin autonomy gap |
| #311 — Need "other payment" button | Payment categorization too rigid |
| #301 — Haberdashery payment button | Merch payments don't fit cash/electronic binary |

**Strategic takeaway:** Hash Cash is a scope trap. HC charges for it and it generates significant support overhead. HashTracks' `paid` boolean is the right level; a per-kennel payment link URL is the smart next step.

### Theme 4: Communication & Notifications

| Issue | Insight |
|-------|---------|
| #326 — Email templates don't persist across versions | Email blast feature is brittle |
| #331 — Email parser for deleted accounts | Deleted users still receive emails |
| #317 — Phantom email addresses | Email system reliability issues |

**Strategic takeaway:** HC's email distribution (a paid feature) causes more support burden than value. Don't build custom email — leverage existing channels.

### Theme 5: Platform & UX

| Issue | Insight |
|-------|---------|
| #335 — App installation friction | Users struggle to install native app |
| #314 — Admin portal sorting broken | Basic admin UX issues |
| #306 — GDPR account deletion (still missing) | Compliance gap |
| #296 — Shorter shareable links | Shareability friction |

**Strategic takeaway:** Web-first means zero install friction. Being on the web is an underrated advantage for the hashing demographic.

### Theme 6: Unbuilt Feature Requests

| Issue/Signal | Gap |
|--------------|-----|
| #298 — Interactive songbook | Cultural feature, low ROI |
| #309 — Recurring events | Still not built after 3+ years |
| Strava/Garmin integration | Not mentioned anywhere |
| Calendar export | No .ics or Google Calendar support |
| Activity links | No fitness platform connectivity |

---

## Insights from Multiple AI Analyses

Three independent analyses (Claude, Gemini, ChatGPT) converged on these themes:

### All three agreed on:
- **Source engine is the primary moat** — HC can't replicate without an architectural rewrite
- **Map-based discovery is the biggest missing feature** for traveling hashers
- **Strava integration would be unique** in the hashing space
- **Misman tool is already more capable** than HC's paid kennel admin features
- **Web-first is the right platform strategy** — HC's native apps create friction

### Unique high-value insights per analysis:
- **Claude:** Misman as a B2B growth lever (approach kennel mismanagement directly); config-driven source onboarding as the force multiplier for scaling
- **Gemini:** Milestone Watch on misman attendance form (low effort, high value for GMs); "Hare Raising" nudge system for engagement
- **ChatGPT:** PWA Web Push notifications (pairs with existing RSVP flow without native app); per-kennel payment links as lightweight Hash Cash alternative; event-level comments as a cheap social test

### What the LLMs overstated:
- Hash Cash / financial tools (the `paid` boolean is sufficient for now)
- Trail Chat / messaging (high complexity, low priority relative to other gaps)
- Push notifications as Priority 1 (drives retention, not acquisition — source expansion and Strava drive acquisition)

---

## Reference Links

- HC Website: https://www.harriercentral.com
- HC GitHub Issues: https://github.com/James-A-White/HarrierCentral/issues
- HC iOS App: https://apps.apple.com/us/app/harrier-central/id1445513595
- HC Android App: https://play.google.com/store/apps/details?id=com.harriercentral.app
- HC Admin Portal: https://portal.harriercentral.com
