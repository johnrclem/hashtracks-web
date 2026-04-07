# West Virginia Kennel Research

**Researched:** 2026-04-08
**Shipped:** 1 new kennel (Morgantown H3) with dual-source coverage

## Existing Coverage
- **W3H3** (Wild and Wonderful Wednesday) — Jefferson County, WV (Eastern Panhandle) — already covered, attached to D.C. Metro state group.

## Aggregator Sources Found
- **Harrier Central:** Probed every plausible WV city. Only **Morgantown** returns results — kennel `MH3-US`, 5 upcoming events.
- **HashRego /events index:** zero WV slug matches
- **half-mind.com WV list:** 9 kennels enumerated

## New Kennel Shipped

| Kennel | City | Sources | Live verification |
|---|---|---|---|
| **Morgantown H3** (`mh3-wv`) | Morgantown | GOOGLE_CALENDAR `morgantownh3@gmail.com` (primary) + HARRIER_CENTRAL `MH3-US` (secondary) | GCal: 17 events (very active, ~biweekly + full moons + themed runs); HC: 5 registration-required events. Both verified live, zero errors. |

The Morgantown calendar appears to absorb the half-mind-listed "Morgantown Full Moon H3" kennel — full-moon trails like "April 2 Fool Moon" show up in the same MH3 GCal stream rather than as a separate kennel.

## Deferred Kennels

| Kennel | City | Reason |
|---|---|---|
| Mountain Mamma H3 | Charleston | FB only; tried 5 GCal ID variants, all 0 items |
| Humpin Herd H3 (H5) | Huntington | FB only; no calendar variants worked |
| Green Bank H3 | Green Bank (rural) | No website at all |
| Morgantown-Fairmont H3 | Morgantown/Fairmont | Yahoo group (Yahoo Groups dead since 2020) |
| Trash Panda H3 | Morgantown | Marked "Never/Dead" on half-mind |
| MountainBeers H3 | WV (unspecified) | Marked Dead on half-mind |

## Region Updates
- New STATE_PROVINCE: `West Virginia`
- New METRO: `Morgantown, WV`
- `STATE_GROUP_MAP`: `Morgantown, WV` → `West Virginia`
- `COUNTRY_GROUP_MAP`: `West Virginia` → `United States`
- Note: existing `Jefferson County, WV` remains in the D.C. Metro state group (Harpers Ferry is functionally a DC commuter region).

## Lessons Learned
- **Dual-source coverage is the right call when both feeds exist.** Morgantown H3's GCal carries weekly trails; Harrier Central carries the registration events. Together they give complete coverage with zero adapter code.
- **WordPress.com hosted blogs don't expose the REST API on free tier.** `morgantownh3.wordpress.com/wp-json/wp/v2/posts` returns 404. Don't assume `wp-json` is available just because the site is on WordPress.
- **State-level Harrier Central searches are city-by-city.** The `state` field doesn't filter the way `cityNames` does — had to probe each city individually to find Morgantown.
