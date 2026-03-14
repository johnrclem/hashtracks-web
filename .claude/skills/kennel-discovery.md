---
description: Regional kennel discovery and source research methodology for Hash House Harrier kennels
globs:
  - src/pipeline/kennel-discovery-ai.ts
  - src/pipeline/source-research.ts
  - src/app/admin/research/**
  - docs/kennel-research/**
---

# Kennel Discovery & Source Research

## Overview
HashTracks discovers kennels region-by-region using AI-powered search (Gemini with search grounding) and validates findings against existing database records. This skill covers the methodology for discovering new kennels and evaluating their data sources.

## Discovery Pipeline
1. **AI Search** — `discoverKennelsForRegion()` in `src/pipeline/kennel-discovery-ai.ts` uses Gemini search grounding to find all HHH kennels in a region
2. **Fuzzy Dedup** — Results are matched against existing kennels using Levenshtein distance (threshold: 0.8)
3. **KennelDiscovery Records** — New findings are persisted with status NEW or MATCHED
4. **Source Research** — `src/pipeline/source-research.ts` discovers and classifies data source URLs for each kennel

## Research Methodology (from docs/kennel-research/)
When researching a new region, produce a structured report with:

### Regional Summary
- Total kennels found
- Regional aggregator sources (highest value — one source covers many kennels)
- Recommended onboarding order (aggregators first, then high-quality individual sources)

### Per-Kennel Detail Card
```
### **{SHORTNAME}** — {Full Name}
- Region: {location}
- Country: {country}
- Schedule: {frequency} {day} {time}
- Website: {URL}
- Facebook: {URL}
- Aliases: {list}
- Founded: {year}

**Source Assessment:**
- Source A (Website): {description} → {trust level}
- Source B (Calendar): {description} → {trust level}

**Best Source:** {type}
**Secondary Source:** {type}
**Notes:** {special considerations}
```

### Source Type Priority
1. **GOOGLE_CALENDAR** — Most reliable, structured data, multi-kennel aggregators common
2. **ICAL_FEED** — Standard format, easy to parse
3. **GOOGLE_SHEETS** — Structured but fragile (column changes)
4. **HTML_SCRAPER** — Most common, requires per-site adapter
5. **MEETUP** — Public API, good for smaller kennels
6. **STATIC_SCHEDULE** — RRULE-based, no external fetch needed (for kennels with fixed recurring schedules)
7. **HASHREGO** — Hash Rego platform (hashrego.com)

### Trust Level Assessment
- **High** — Maintained by kennel officers, updated regularly, structured format
- **Medium** — Community-maintained, some gaps, parseable
- **Low** — Infrequent updates, unstructured, or unreliable

## Seed Data Format
When adding discovered kennels, provide seed data blocks:
```typescript
{ shortName: "XYZ3", fullName: "XYZ Hash House Harriers", regionId: "...", website: "..." }
```
With aliases: `{ kennelShortName: "XYZ3", alias: "XYZ Hash" }`

## Key Files
- `src/pipeline/kennel-discovery-ai.ts` — AI discovery prompts and parsing
- `src/pipeline/source-research.ts` — URL discovery and classification
- `src/app/admin/research/actions.ts` — Server actions (approve/reject proposals)
- `src/lib/fuzzy.ts` — Fuzzy matching for dedup
- `docs/kennel-research/` — Completed regional research reports (Chicago, DC, SF Bay, London)
