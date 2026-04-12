# Meetup Historical Event Scrape — Chrome Prompt

Use this prompt with Claude in Chrome to extract past events from a Meetup group's event archive. Each round extracts a batch of events from the visible page. Run multiple rounds to cover the full history.

## Setup

1. Open the Meetup group's past events page in Chrome:
   `https://www.meetup.com/AVLH3-On-On/events/?type=past`
2. Copy this prompt to Claude in Chrome

## Prompt

```
You are extracting historical event data from this Meetup past events page for import into HashTracks.

**Step 1: Scroll to load more events.**
Scroll down slowly to trigger Meetup's infinite scroll. Keep scrolling until either:
- You've loaded ~50 new events since your last extraction, OR
- No more events load after 3 scroll attempts

**Step 2: Extract every visible event card into JSON.**
For each event on the page, extract:
- `title`: the event title text
- `date`: the date in YYYY-MM-DD format (convert from Meetup's display format)
- `startTime`: the start time in HH:MM 24h format (e.g. "14:00" for 2 PM)
- `location`: the venue name if shown on the card (null if not visible)
- `url`: the full Meetup event URL (e.g. https://www.meetup.com/avlh3-on-on/events/123456/)
- `attendees`: the attendee count if shown (null if not visible)

**Step 3: Output the JSON array.**
Output ONLY a JSON array of objects — no commentary, no markdown code fences, just raw JSON. Each object has the fields above. Example:

[
  {"title": "AVL H3 Run #850 - Winter Trail", "date": "2026-01-10", "startTime": "14:00", "location": "Carrier Park", "url": "https://www.meetup.com/avlh3-on-on/events/305123456/", "attendees": 22},
  {"title": "AVL H3 Run #849 - New Year Hash", "date": "2026-01-03", "startTime": "14:00", "location": "Pack Square Park", "url": "https://www.meetup.com/avlh3-on-on/events/305123457/", "attendees": 18}
]

**Step 4: Report progress.**
After the JSON, on a new line write: "Extracted N events. Oldest: YYYY-MM-DD. Scroll more? (The page may have more events below.)"

**Important:**
- Extract ALL visible events, not just new ones — duplicates will be handled by the import script
- If you've already extracted events in a previous round, that's fine — just extract everything visible
- Dates MUST be in YYYY-MM-DD format
- Times MUST be in HH:MM 24h format
- Keep the JSON compact (one event per line is fine)
```

## After each round

1. Save the JSON output to a file: `scripts/data/avlh3-meetup-history-batch-N.json`
2. If Claude reports more events are available, scroll further and run the prompt again
3. When done (oldest event reached or no more events load), run the import script

## Import

```bash
# Merge all batch files
cat scripts/data/avlh3-meetup-history-batch-*.json | npx tsx scripts/import-meetup-history.ts --kennel avlh3 --source "Asheville H3 Meetup"
```

## Notes

- Meetup's past events page uses infinite scroll — it loads ~10-20 events per scroll
- Very old events (2008-2015) may not be accessible if Meetup has archived them
- The import script deduplicates by date + title fingerprint, so overlapping batches are safe
- Hares are NOT available from the list page cards — they're in the event detail descriptions. A separate enrichment pass could visit each event URL to extract hares, but that's 1,045 page visits and should be a follow-up
