# Meetup Historical Backfill

Use this workflow to backfill older events from any Meetup-backed kennel page into HashTracks.

## What worked for AVL H3

- Source page: `https://www.meetup.com/AVLH3-On-On/events/?type=past`
- Previously captured through: `2022-06-17`
- Additional archive discovered by automated scrolling: `2021-06-25` back to `2008-09-13`
- End-of-archive condition:
  Repeated bottom-scrolls stopped increasing the number of parsed event cards for 10 consecutive rounds. The oldest visible event remained `2008-09-13`, so that was treated as saturation for the session.

## Reusable scraper

The repo now includes [scrape-meetup-history.mjs](/Users/johnclem/.codex/worktrees/f085/hashtracks-web/scripts/scrape-meetup-history.mjs), a Playwright-based extractor that:

- opens a Meetup `?type=past` page
- scrolls to the bottom until the archive stops growing
- parses visible event cards into the JSON format expected by `import-meetup-history.ts`
- filters to rows older than a cutoff date
- optionally writes numbered batch files

It intentionally does not depend on a local Playwright install. Run it with a temporary package install:

```bash
npx -y -p playwright node scripts/scrape-meetup-history.mjs \
  --url "https://www.meetup.com/AVLH3-On-On/events/?type=past" \
  --before-date 2021-06-26 \
  --out /tmp/avlh3-older.json \
  --batch-prefix "scripts/data/avlh3-meetup-history-batch-" \
  --batch-start 6
```

## Recommended workflow for another kennel

1. Identify the kennel's Meetup past-events page.
   Example: `https://www.meetup.com/<group>/events/?type=past`
2. Identify the last already-imported event date.
   Use the newest already-backfilled historical event as the cutoff.
3. Run the scraper with `--before-date` set to the day after the older archive should begin.
   Example: if the last captured event is `2021-06-25`, pass `--before-date 2021-06-26`.
4. Review the generated JSON.
   Spot-check oldest and newest rows, a few URLs, and any obviously placeholder events.
5. Dry-run the importer.

```bash
cat scripts/data/<prefix>*.json | npx tsx scripts/import-meetup-history.ts --kennel <code> --source "<source name>"
```

6. If the dry-run looks good, apply it.

```bash
cat scripts/data/<prefix>*.json | BACKFILL_APPLY=1 npx tsx scripts/import-meetup-history.ts --kennel <code> --source "<source name>"
```

## Notes

- Meetup card order is newest to oldest. The scraper writes batch files in that same continuation-friendly order.
- The importer already deduplicates by fingerprint, so reruns and overlapping batches are safe.
- Card data is limited to what the list page shows.
  Hares usually require a second pass against event detail pages.
- Placeholder and cancelled titles can appear in the archive.
  The importer already filters common non-event placeholders.
- Some rows have weak locations like `Asheville, NC, US` or `Location not specified yet`.
  That is expected from Meetup’s card view.
- Very old archives may stop before the kennel’s true first run if Meetup no longer exposes older cards.

## AVL H3 outcome

- New continuation batches created: `scripts/data/avlh3-meetup-history-batch-6.json` through `scripts/data/avlh3-meetup-history-batch-21.json`
- Oldest reachable Meetup card in this session: `2008-09-13`
- Combined dry-run status after batches `1..21`:
  Run the importer locally to confirm against your active database before applying, since dry-run/apply depend on your Prisma target being available.
