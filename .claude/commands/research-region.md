Research all Hash House Harrier kennels in: $ARGUMENTS

Discover kennels, identify the best data source for each, and write a research file for user review before implementation.

## Required Reading
1. `docs/source-onboarding-playbook.md` — adapter types, config shapes, source priority
2. `docs/regional-research-prompt.md` — Chrome-assisted discovery workflow, JS detection snippets

## Stage 1: Check Existing Coverage

Check BOTH seed data AND the live production database. Seed files alone are not authoritative — kennels can be added directly via the admin UI and exist only in the DB until backfilled. Skipping this check has caused duplicate research passes on already-onboarded kennels.

```bash
# 1. Seed data
grep -i "REGION_KEYWORDS" prisma/seed-data/kennels.ts prisma/seed-data/aliases.ts
```

```bash
# 2. Live DB — any kennel attached to a region whose name matches the target
set -a; source .env.local 2>/dev/null || source .env; set +a
cat > /tmp/check-region.ts <<'EOF'
import { PrismaClient } from './src/generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
async function main(){
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false }});
  const p = new PrismaClient({ adapter: new PrismaPg(pool) });
  // Replace REGION_KEYWORDS with all relevant terms (state name, abbrev, major cities)
  const terms = ["REGION_KEYWORDS"];
  const regions = await p.region.findMany({ where: { OR: terms.map(t => ({ name: { contains: t, mode: "insensitive" as const }})) }});
  for (const r of regions) {
    const ks = await p.kennel.findMany({ where: { regionId: r.id }, select:{kennelCode:true, shortName:true, fullName:true}});
    console.log(`${r.name} (${r.level}): ${ks.length} kennels`, ks.map(k=>k.kennelCode).join(", "));
  }
  await p.$disconnect();
}
main();
EOF
npx tsx /tmp/check-region.ts && rm /tmp/check-region.ts
```

Any kennel returned here is already onboarded and MUST NOT be re-researched. If any DB kennel is missing from seed files, flag it — that's a backfill candidate (the seed files should be the source of truth).

## Stage 2: Aggregator-First Discovery

Check these BEFORE visiting individual kennel websites:
1. **Harrier Central API** — check all cities in region via POST to `harriercentralpublicapi.azurewebsites.net/api/PortalApi/`
2. **HashRego** — fetch `hashrego.com/events` with `curl -L` and grep for region kennel slugs. CRITICAL: This is the live registration index and is the ONLY surface our HashRego adapter can scrape. Do NOT rely on `hashrego.com/kennels_legacy/{SLUG}` profile pages — those are historical archives our scraper cannot reach. A kennel with "76 trails on its legacy page" yields 0 events from our adapter unless it also appears in the live `/events` index. HashRego is dominated by registration-required campouts/RDRs, not weekly trails — only add a HASHREGO source if the kennel actually appears in the live index.
3. **Meetup** — search `meetup.com/find/?keywords=hash+house+harriers&location=[REGION]`
4. **Regional Google Calendar** — search for "[REGION] hash house harriers calendar"
5. **gotothehash.net lineage pages** — `gotothehash.net/{country}.html` (international)
6. **hashhouseharriers.nl** — `hashhouseharriers.nl/eu-chapters` (European)

## Stage 3: Per-Kennel Source Detection (CRITICAL — do ALL checks)

For EVERY kennel found, run the FULL enhanced checklist. A persistent problem is finding the kennel correctly but missing the best source — we've repeatedly built HTML scrapers only to discover a Google Calendar existed all along.

**Use Chrome** (not just curl) for source-type detection — JS snippet catches things curl misses.

### Mandatory checks for EVERY kennel website:

1. **Homepage** — run the source-type detection JS snippet from `docs/regional-research-prompt.md` Step 1.4
2. **Navigate to subpages** — `/events`, `/calendar`, `/hareline`, `/runs`, `/upcoming`, `/schedule` — repeat detection on each
3. **Try multiple Google Calendar ID variants** — `{kennelname}@gmail.com` is only ONE pattern. Also try `{shortcode}@gmail.com`, `{shortcode}hash@gmail.com`, `{kennelname}hash@gmail.com`. Verify each via:
   ```bash
   curl -s "https://www.googleapis.com/calendar/v3/calendars/{id}/events?key=$API_KEY&maxResults=3&timeMin=2025-01-01T00:00:00Z&singleEvents=true&orderBy=startTime"
   ```
   (Gulf Coast H3 was hiding behind `gch3hash@gmail.com`, NOT `gulfcoasth3@gmail.com` which exists but is empty.)
4. **Try WordPress REST API** — BOTH endpoints:
   ```bash
   curl -s "https://site.com/wp-json/wp/v2/posts?per_page=1"
   curl -s "https://site.com/wp-json/wp/v2/pages?per_page=3"
   ```
5. **Try Substack API** — `curl -s "https://site.com/api/v1/archive?limit=1"`
6. **Check iframes** for Google Doc/Sheet embeds (may load async)
7. **Check "Links" / "Other Kennels" / "About" pages** for source hints
8. **If Wix site**: check for Table Master iframes, Wix Events, BoomTech calendar
9. **Check for iCal feeds** — try `/calendar.ics`, `/events/?ical=1`, `webcal://` links

### Source escalation rule

Before recommending HTML_SCRAPER, you MUST have exhausted ALL config-only options:
```
GOOGLE_CALENDAR > MEETUP > ICAL_FEED > HARRIER_CENTRAL > WordPress API > Substack API > HTML Scraper (Cheerio) > HTML Scraper (browser-render) > STATIC_SCHEDULE
```

## Stage 4: kennelCode Collision Check

For EVERY proposed kennelCode:
```bash
grep -i '"proposed-code"' prisma/seed-data/kennels.ts prisma/seed-data/aliases.ts
```

Known collision-prone abbreviations: ah3, bh3, ch3, dh3, eh3, fch3, lh3, mh3, oh3, rh3, sh3, sah3, swh3, th3.

## Stage 5: Write Research File

Save to `docs/kennel-research/{region}-research.md`:

```markdown
# {Region} Kennel Research

## Existing Coverage
- [List kennels already in seed data]

## Aggregator Sources Found
- [Any regional calendars, Harrier Central, HashRego hits]

## New Kennels Discovered

| # | Kennel | City | Status | Tier | Best Source | Source URL/ID | Notes |
|---|--------|------|--------|------|-------------|---------------|-------|

Tier legend:
- Tier 1: Config-only (Calendar, Meetup, iCal, Harrier Central) — zero code
- Tier 2: HTML scraper needed (WordPress API, Substack API, Cheerio, browser-render)
- Tier 3: Static schedule (Facebook-only, known recurrence)
- Skip: Inactive, dormant, no scrapeable source

## Collision Check Results
- [Results for each proposed kennelCode]

## Recommended Onboarding Order
1. Config-only sources first (fastest)
2. WordPress/Substack API adapters (reuse existing patterns)
3. Custom HTML scrapers last

## Skipped Kennels
- [Kennel]: [reason — e.g., "website dead", "Facebook only", "dormant"]
```

## Stage 6: Present Results and Ask

STOP HERE. Present the research file contents and explicitly ask:

> "Do you know of any Google Calendars, Meetup groups, or other structured sources for these kennels that I may have missed? The research is saved to `docs/kennel-research/{region}-research.md` — review and let me know what to proceed with."

Do NOT begin implementation until the user has reviewed and approved the research.
