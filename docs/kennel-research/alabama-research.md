# Alabama Kennel Research

**Researched:** 2026-04-06
**Shipped:** 3 kennels (MRH3, GCH3, WSH3)

## Existing Coverage
None

## Aggregator Sources Found
- **Harrier Central:** No AL kennels
- **HashRego /events index:** 2 upcoming Alabama events (WSH3 SOEX June 2026, MRH3 Analversary May 2026). Reflects HashRego's role as a campout/RDR registration platform — weekly trails are NOT listed there.
- **HashRego legacy kennel pages:** show historical archives only, not accessible to our scraper.
- **Meetup:** No active AL groups
- **half-mind.com AL list:** 6 active kennels listed

## New Kennels Discovered

| # | Kennel | City | Status | Tier | Best Source | Source ID | Live Verification |
|---|--------|------|--------|------|-------------|-----------|-------------------|
| 1 | Mutha Rucker H3 | Enterprise, AL | ACTIVE | 1 | GOOGLE_CALENDAR | `mutharuckerh3@gmail.com` | 5 events ✓ + secondary HashRego (annual Analversary) |
| 2 | Gulf Coast H3 | Mobile, AL | ACTIVE | 1 | GOOGLE_CALENDAR | `gch3hash@gmail.com` | 5 events ✓ |
| 3 | Wandering Soul H3 | Birmingham, AL | ACTIVE | 1 | HASHREGO | slug `WSH3` | 1 event ✓ (annual SOEX campout) |

## Collision Check Results
- `mrh3` — OK
- `gch3` — OK
- `wsh3` — OK

## Discovery Notes
- **Gulf Coast H3 GCal ID:** Pattern `{shortcode}hash@gmail.com` (`gch3hash@gmail.com`) — NOT the obvious `gulfcoasth3@gmail.com` which exists but is empty. Worth trying multiple ID variants per kennel.
- **MRH3 GCal:** Found via iframe embed on mutharuckerh3.org homepage (`{name}@gmail.com` pattern works here).
- **HashRego coverage gap:** Our adapter scrapes only the live `/events` index. The legacy `/kennels_legacy/{SLUG}` profile pages contain historical archives we can't reach. So a kennel can have "76 trails on HashRego" historically but yield 0 events from our adapter.

## Deferred (no scrapeable source)
- **Vulcan H3 (Birmingham)**: weekly Tuesday hash, IG @vulcanh3, hashbham.com DEAD. GCal `vulcanh3@gmail.com` exists but private. No live data accessible.
- **Rocket Shitty H3 (Huntsville)**: rocketshitty.com DEAD, FB/IG only. Not in current HashRego /events index.
- **Montgomery H3**: oldest in state (founded 1983), Sunday afternoons, FB only.
- **Birmingham H3**: hashbham.com DEAD, FB only. HashRego slug `BHAMH3` exists but profile is empty.
- **Tuscaloosa H3**: Active per Half-Mind, Facebook-only (`facebook.com/tusc.hash`).

## Confirmed Dead
Anniston H3, Auburn-Opelika H3 (since ~2015), Magic City H3, Wiregrass H3, Global Trash H3, Fort Wainwright H3, Huntsville Redstone H3, Seward Hashers In Training.

## Lessons Learned
1. **Try multiple Google Calendar ID variants per kennel.** `{kennelname}@gmail.com` is only one of several patterns. Also try `{shortcode}@gmail.com`, `{shortcode}hash@gmail.com`, `{kennelname}hash@gmail.com`. Gulf Coast H3 was hiding behind `gch3hash@gmail.com`.
2. **HashRego = registration platform, not trail calendar.** A kennel having historical trails on `hashrego.com/kennels_legacy/{SLUG}` does NOT mean we can scrape their weekly schedule — we only see the live `/events` index, which is dominated by registration-required campouts and RDRs. Verify slug presence in `https://hashrego.com/events` (follow redirect) before adding HASHREGO sources.
3. **Many small-state kennels are genuinely Facebook-only.** Alabama has ~6 active kennels but only 3 had any structured data. Don't force HashRego sources for kennels that don't appear in the live index — they'll generate 0 events 11 months of the year.
4. **Live verification catches over-optimism.** The initial plan to "ship 6 via HashRego" survived planning but failed live verification. The mandatory verification step in `/ship-sources` paid for itself.
