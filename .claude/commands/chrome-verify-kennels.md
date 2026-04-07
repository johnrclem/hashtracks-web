Generate a Claude-in-Chrome verification prompt for deferred kennels in: $ARGUMENTS

Claude-in-Chrome (the browser-based Claude with full web search + Facebook page reading) is very good at re-checking kennels we've marked as "no scrapeable source" — it can find activity status, dead-domain successors, private-vs-public FB groups, and incidental mentions on aggregator pages. This skill produces a single self-contained prompt the user can paste into a fresh Chrome session.

## When to use
- After a regional research pass that produced deferred kennels
- When the user asks to "double check" or "verify" kennels we've already declared unshippable
- Before a deep-dive backfill where we need confidence the kennel is genuinely sourceless

## Inputs ($ARGUMENTS)
- A region name (e.g. `Mississippi`) → look up `docs/kennel-research/{region}-research.md` and extract every Skip/Deferred kennel
- OR an explicit kennel list (e.g. `Biloxi H3, Jackson H3, OUCH3`) → use as-is
- OR `recent` → scan the last 5 research docs for any deferred kennels

## Steps

### 1. Gather context
For each kennel to verify, collect from the research doc (or by asking the user):
- Kennel name + any abbreviations
- City + state
- Half-mind status + schedule (if known)
- Listed website (and whether it's dead/repurposed/live)
- What we already tried (GCal variants, HashRego slug, Harrier Central probe, WP REST, etc.)
- Any known FB / IG / hashrego presence

### 2. Generate the prompt

Output a single Markdown block the user can copy-paste. **Structure (MUST include all sections):**

```
I'm helping verify hash kennel data for HashTracks (a Hash House Harriers event aggregator). I need your help re-checking {N} kennels in {REGION} that came back as "no scrapeable source" in an automated research pass. Before you start, please skim these two docs from the project so you understand what counts as a usable source and the discovery patterns we use:

- **Research methodology & discovery checklist:** https://github.com/johnrclem/hashtracks-web/blob/main/docs/regional-research-prompt.md
- **Source onboarding playbook (adapter types & priority):** https://github.com/johnrclem/hashtracks-web/blob/main/docs/source-onboarding-playbook.md

The TL;DR of what counts as a "good source" (in priority order):
1. Google Calendar with a public ID
2. Meetup group with active events
3. iCal feed (`.ics` or `webcal://`)
4. Harrier Central API (`hashruns.org`) — already checked
5. WordPress site exposing The Events Calendar plugin (`/wp-json/tribe/events/v1/events`)
6. WordPress REST API for posts/pages
7. Any HTML page with structured event listings (table, list, JSON-in-script)
8. STATIC_SCHEDULE with a known recurrence + anchor date

Facebook-only / Instagram-only kennels are **not** usable — the merge pipeline can't ingest FB events, and per project policy we don't add directory-style entries.

## The {N} kennels to re-check

{FOR EACH KENNEL:}
**{N}. {Kennel name} ({abbrev if any}) — {City}, {State}**
- Half-mind says: {status} {schedule}
- Listed website: {url} ({dead/repurposed/live status})
- {Any other known facts: founded year, founder, sister kennels, etc.}
- **Things to try in Chrome:**
  - {Specific search queries for this kennel}
  - {Specific FB / IG / archive.org checks}
  - {Specific domain variants worth probing}
  - {Whether they may show up on a regional aggregator we already onboarded}

## What I already tried (don't repeat)

- **Google Calendar ID variants:** {comma-separated list of every @gmail.com / @group.calendar.google.com ID we probed and got 0 events for}
- **HashRego /events index:** {kennel slugs probed} → 0 hits
- **Harrier Central API:** {cities probed} → 0 hits
- **WordPress REST API endpoints:** {if any tried}
- **Domain DNS:** {dead domains confirmed}

## What I need back

For each of the {N} kennels, please report one of:
- **A working source** — type (calendar/iCal/Meetup/WordPress/etc.) plus the canonical URL or ID. **Verify it actually contains upcoming events** before reporting it.
- **A current website** even if it has no calendar yet — note the platform (WordPress, Wix, Squarespace, etc.) and whether they post any structured schedule.
- **Active but Facebook/Instagram-only** — confirm the kennel is alive (date of most recent post), note follower count, and flag whether the FB group is private or public.
- **Confirmed dormant or dead** — note what you found (e.g. "FB page hasn't posted since 2023", "no website found in search").

Skip Facebook, Instagram, WhatsApp, Discord, and email-only contacts as **sources** — but DO report on them as activity evidence.
```

### 3. Save the prompt to a file

Write to `docs/kennel-research/chrome-verification/{region}-{YYYY-MM-DD}.md` so the user can re-paste later and so we have a record.

### 4. Tell the user what to do next

Print:
> Prompt saved to `docs/kennel-research/chrome-verification/{region}-{YYYY-MM-DD}.md`. Paste it into a fresh Claude-in-Chrome session. When you have results, share them back and I'll update the research doc + capture activity status + flag any newly discovered sources.

## After Chrome results come back
When the user shares Chrome's findings:
1. Update the relevant `docs/kennel-research/{region}-research.md` with:
   - Activity status per kennel (active / dormant / dead)
   - Last-seen evidence (FB post date, club registry, etc.)
   - Any corrections to kennel names / abbreviations / IDs
   - Newly discovered sources (rare but worth a re-ship if any)
2. If any kennel has a real source surfaced, propose a ship plan (gated on user approval per `feedback_research_review_gate.md`).
3. If all kennels are confirmed sourceless, commit the doc update so we don't re-research the same kennels next sweep.

## Key principles
- **Single self-contained prompt** — Chrome session has no shared state with our tools
- **Always include the GitHub links** to the playbook + research-prompt docs
- **Always list what we already tried** so Chrome doesn't waste effort
- **Always specify the desired output shape** so results map cleanly back into our research docs
- **Save the prompt** for traceability — future re-checks should reference past verification rounds
