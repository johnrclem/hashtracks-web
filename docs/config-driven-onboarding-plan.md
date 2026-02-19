# Config-Driven Source Onboarding — Implementation Plan

## Context

Currently, adding a new config-driven source (Google Calendar, Google Sheets, iCal Feed) requires editing `prisma/seed.ts` and redeploying. The admin SourceForm can create Source records with name/url/type/kennels, but has **no way to view, set, or edit** the `config` JSON or `scrapeDays`. This means:

- **New sources** (even config-driven ones needing zero adapter code) require a developer
- **Existing sources** (all 29) have configs that are invisible and uneditable in the admin UI
- **Troubleshooting** a broken config requires direct DB access or code changes + redeploy

### Goals

1. **Migrate existing sources**: All 29 sources' configs become visible and editable through the admin UI immediately (Phase 1)
2. **Self-service onboarding**: Admin can add a new Google Calendar, iCal, or Sheets source in ~5 minutes — no code deploy needed
3. **Troubleshoot & iterate**: Edit config → preview results → save — all from the admin UI (Phase 3)
4. **AI-assisted setup**: Auto-detect source type from URL, suggest kennel patterns from event data (Phase 6)

---

## Current Config Shapes (Reference)

Each adapter type has a distinct config structure stored as `Json?` on the Source model:

### CalendarSourceConfig (Google Calendar)
```typescript
interface CalendarSourceConfig {
  kennelPatterns?: [string, string][];  // [[regex, kennelTag], ...] — optional for single-kennel
  defaultKennelTag?: string;            // fallback tag — required for non-Boston calendars
}
```
Used by: BFM Calendar, Philly Calendar, Chicagoland Calendar, EWH3 Calendar, SHITH3 Calendar, Boston Calendar (null config — uses hardcoded fallback)

### ICalSourceConfig (iCal Feed)
```typescript
interface ICalSourceConfig {
  kennelPatterns?: [string, string][];  // same as Calendar
  defaultKennelTag?: string;            // same as Calendar
  skipPatterns?: string[];              // regex patterns to skip (e.g., "^Hand Pump")
}
```
Used by: SFH3 MultiHash iCal (14 patterns + 2 skip), CCH3 iCal (2 patterns), BAH3 iCal (default tag only)

### GoogleSheetsConfig (Google Sheets)
```typescript
interface GoogleSheetsConfig {
  sheetId: string;                      // REQUIRED — from spreadsheet URL
  tabs?: string[];                      // explicit tab names (auto-discovers if omitted)
  columns: {                            // REQUIRED — 0-indexed column indices
    runNumber: number; date: number; hares: number;
    location: number; title: number;
    specialRun?: number; description?: number;
  };
  kennelTagRules: {                     // REQUIRED
    default: string;                    // default kennel tag
    specialRunMap?: Record<string, string>;
    numericSpecialTag?: string;
  };
  startTimeRules?: {                    // optional time inference
    byDayOfWeek: Record<string, string>;
    default: string;
  };
}
```
Used by: Summit H3 Spreadsheet, W3H3 Hareline Spreadsheet

### HashRegoConfig (Hash Rego)
```typescript
interface HashRegoConfig {
  kennelSlugs: string[];  // REQUIRED — e.g., ["BFMH3", "EWH3"]
}
```
Used by: Hash Rego (8 kennel slugs)

### HTML_SCRAPER
No config — routing is URL-based via regex patterns in `src/adapters/registry.ts`. Exception: SFH3 HTML scraper reuses `ICalSourceConfig` shape for kennel patterns.

---

## Existing Utilities to Reuse

| Utility | File | Used By |
|---------|------|---------|
| `validateSourceConfig<T>()` | `src/adapters/utils.ts` | Sheets + HashRego adapters — generic config shape validator |
| `matchConfigPatterns()` | `src/adapters/google-calendar/adapter.ts` | Calendar adapter — regex kennel tag matching |
| `parseICalSummary()` | `src/adapters/ical/adapter.ts` | iCal adapter — kennel tag extraction from SUMMARY |
| `getAdapter()` | `src/adapters/registry.ts` | Pipeline — adapter factory (used by preview) |
| `Prisma.InputJsonValue` cast | Throughout | Required for all JSON field writes in Prisma 7 |

---

## Phase 1: Foundation — config + scrapeDays plumbing

Wire `config` and `scrapeDays` through the existing form and server actions so they actually get saved. **This immediately makes all 29 existing sources' configs editable** — when an admin clicks Edit on any source, the form hydrates from the stored JSON.

### Changes

**`src/components/admin/SourceForm.tsx`**
- Add `config` (Json) and `scrapeDays` (number) to `SourceData` type
- Add `HASHREGO` to `SOURCE_TYPES` array
- Add `scrapeDays` number input (default 90) between scrapeFreq and linked kennels
- Make type `Select` controlled via `useState` (`selectedType`) — needed for Phase 2 conditional panel rendering
- Add hidden `<input name="config">` populated from `configState`
- Track `configState` in component state, initialized from `source?.config` (hydrates existing configs)
- Serialize `configState` as JSON string into formData on submit
- For Phase 1 only: show raw JSON textarea for config when type is config-driven (replaced by proper panels in Phase 2+)

**`src/app/admin/sources/actions.ts`**
- `createSource`: extract `scrapeDays` (parseInt, default 90) and `config` (JSON.parse or null), pass to `prisma.source.create()` with `Prisma.InputJsonValue` cast
- `updateSource`: same — add scrapeDays + config to the update call

**`src/app/admin/sources/page.tsx`**
- Add `config` and `scrapeDays` to serialized source data (feeds into SourceTable → SourceForm edit)

**`src/components/admin/SourceTable.tsx`**
- Add `config` and `scrapeDays` to SourceData type so edit mode passes them to SourceForm

### Migration Note
No data migration needed — existing `Source.config` JSON is already stored in the DB by seed.ts. Phase 1 simply exposes it in the UI. All 29 existing sources become editable immediately.

### Open Questions
- **Raw JSON fallback**: Should the raw JSON textarea remain as a fallback for types without dedicated panels (e.g., for power users), or hide it entirely once Phase 2+ panels exist? **Decision: Keep it as a collapsible "Advanced: Raw JSON" section for all types — helpful for debugging.**
- **Config display on source detail page**: The detail page (`/admin/sources/[sourceId]`) currently doesn't show config. Should we add a read-only config display there too? **Deferred — edit via SourceForm is sufficient for now.**

---

## Phase 2: Calendar + iCal config panels + server validation

Calendar and iCal share the same base config shape (`kennelPatterns` + `defaultKennelTag`), with iCal adding `skipPatterns`.

### New Files

**`src/components/admin/config-panels/KennelPatternsEditor.tsx`**
- Reusable dynamic list editor for `[regex, tag][]` pairs
- Each row: two Inputs (Regex Pattern, Kennel Tag) + remove button
- "Add Pattern" button appends empty row
- Props: `patterns: [string, string][]`, `onChange: (patterns) => void`

**`src/components/admin/config-panels/CalendarConfigPanel.tsx`**
- Default Kennel Tag input (required for non-Boston calendars)
- KennelPatternsEditor for multi-kennel calendars (optional — single-kennel sources skip this)
- Props: `config: CalendarSourceConfig | null`, `onChange: (config) => void`

**`src/components/admin/config-panels/ICalConfigPanel.tsx`**
- Same as Calendar + skipPatterns dynamic list (regex strings to exclude events)
- Props: `config: ICalSourceConfig | null`, `onChange: (config) => void`

### Modified Files

**`src/components/admin/SourceForm.tsx`**
- Conditionally render CalendarConfigPanel / ICalConfigPanel based on `selectedType`
- For `HTML_SCRAPER`: info banner "This source type requires a custom adapter — config is managed in code"
- Clear configState when switching between incompatible types (Calendar → Sheets would lose kennelPatterns)
- Widen dialog to `sm:max-w-2xl` when config panel is visible
- Raw JSON textarea collapses to "Advanced" accordion

**`src/app/admin/sources/actions.ts`**
- Add `validateSourceConfig(type, config)` server-side validation function:
  - GOOGLE_CALENDAR: `kennelPatterns` is `[string,string][]` (if present), test regex compilation via `new RegExp()`
  - ICAL_FEED: same as Calendar + `skipPatterns` is `string[]` with valid regexes
  - HTML_SCRAPER/MANUAL: config should be null (warn if non-null)
  - Returns `{ valid: boolean, errors: string[] }`
- Call in `createSource` and `updateSource` before saving — return errors if invalid

**New: `src/app/admin/sources/config-validation.test.ts`**
- Unit tests for validateSourceConfig: valid configs, invalid regex, missing required fields, type mismatches

### Open Questions
- **Boston Calendar special case**: The Boston Hash Calendar has `config: null` and relies on hardcoded patterns in the adapter (`extractKennelTag()`). Should the CalendarConfigPanel show those hardcoded patterns as read-only? **Decision: No — show empty config panel with note "Using built-in Boston pattern matching". Long-term, migrate Boston to use config patterns like other calendars.**
- **Regex validation UX**: Should we validate regex on keystroke (annoying mid-typing) or on blur/submit? **Decision: Validate on submit only — show error toast with the specific invalid pattern.**
- **SFH3 HTML scraper config**: SFH3's HTML scraper shares the iCal config shape (kennelPatterns + skipPatterns). Should it show the ICalConfigPanel? **Decision: Yes — detect that the HTML_SCRAPER source has a config and show the appropriate panel. Use a heuristic: if config has `kennelPatterns`, show the Calendar/iCal-style panel.**

---

## Phase 3: Preview mode — test before you save

The key troubleshooting tool: let admins test their config by fetching events **without committing to DB**. Works for both new sources and editing existing ones.

### Use Cases
- **New source**: fill out form → "Test Config" → see parsed events → fix patterns → test again → save
- **Troubleshooting existing source**: Edit → tweak config → "Test Config" → verify fix → save
- **Quick diagnosis**: see what the adapter produces with current config without triggering a full scrape

### New Files

**`src/components/admin/PreviewResults.tsx`**
- Summary line: "Found X events (Y unique kennel tags)" + error count if any
- Table: Date | Kennel Tag | Title | Location | Hares | Time
- Kennel tags color-coded: green = resolved to known kennel, amber = unmatched
- Error list (collapsible if >3)
- Collapsible diagnostic context JSON

### Modified Files

**`src/app/admin/sources/actions.ts`**
- Add `previewSource(formData)` server action:
  - Auth check, extract type/url/config fields, validate config
  - Build a temporary Source-like object (id: "preview", config from form, scrapeDays from form)
  - Call `getAdapter(type, url).fetch(tempSource, { days })` — no DB writes, no ScrapeLog, no merge
  - Run `resolveKennelTag()` on each event's kennelTag to check resolution status
  - Return `{ events: first 25 parsed events, totalCount, errors, diagnosticContext, unmatchedTags: string[] }`

**`src/components/admin/SourceForm.tsx`**
- Add "Test Config" button (visible for config-driven types: GOOGLE_CALENDAR, ICAL_FEED, GOOGLE_SHEETS, HASHREGO)
- On click: build formData from current state → call `previewSource` → show PreviewResults below form
- Loading state: "Fetching preview..." with spinner
- Results persist until dialog closes or config changes
- Preview renders below the form inside the dialog (scrollable)

### Open Questions
- **Preview lookback days**: Default to scrapeDays value from form, or use a shorter default (e.g., 30 days) for faster preview? **Decision: Use 30 days for preview (faster), show note "Previewing last 30 days". Admin can adjust via scrapeDays input if needed.**
- **Rate limiting**: Should preview be rate-limited to prevent hammering external APIs? **Decision: Not for Phase 3 — admin-only feature, low volume. Revisit if needed.**
- **HTML_SCRAPER preview**: Some HTML scrapers work without config but need URL routing. Should preview work for HTML sources? **Decision: Yes, if the URL matches a registered adapter in the registry. Show "No adapter found for this URL" for unregistered URLs.**
- **Dialog scrolling**: Preview results could make the dialog very tall. **Decision: Fixed max-height on PreviewResults with internal scroll, dialog itself stays at `max-h-[90vh]`.**

---

## Phase 4: Hash Rego config panel

### New Files

**`src/components/admin/config-panels/HashRegoConfigPanel.tsx`**
- Kennel Slugs: dynamic list of string inputs (e.g., "BFMH3", "EWH3") + add/remove buttons
- Each row: single Input + remove button
- "Add Slug" button
- Props: `config: HashRegoConfig | null`, `onChange: (config) => void`

### Modified Files

**`src/components/admin/SourceForm.tsx`**
- Wire HashRegoConfigPanel for HASHREGO type

**`src/app/admin/sources/actions.ts`**
- Add HASHREGO validation to `validateSourceConfig()`: kennelSlugs must be non-empty `string[]`

### Open Questions
- **Slug validation**: Should we validate that slugs match known Hash Rego kennel pages? **Decision: No — just validate non-empty strings. The preview mode will catch invalid slugs (they'll return 0 events).**

---

## Phase 5: Google Sheets config panel

Most complex config — column mapping, kennel tag rules, start time rules.

### New Files

**`src/components/admin/config-panels/GoogleSheetsConfigPanel.tsx`**
- **Sheet ID**: auto-extracted from URL via `/spreadsheets\/d\/([a-zA-Z0-9_-]+)/`, shown as read-only badge
- **Tab Names**: optional dynamic list of strings (if empty, adapter auto-discovers year-prefixed tabs)
- **Column Mapping**: labeled number inputs in a compact grid layout
  - Required: Run#, Date, Hares, Location, Title (0-indexed)
  - Optional: SpecialRun, Description
  - Helper text: "Column A=0, B=1, C=2..."
- **Kennel Tag Rules**: default tag (required) + specialRunMap key/value pairs + numericSpecialTag
- **Start Time Rules**: day-of-week → time pairs + default time
- Props: `config: GoogleSheetsConfig | null`, `url: string`, `onChange: (config) => void`

### Modified Files

**`src/components/admin/SourceForm.tsx`**
- Wire GoogleSheetsConfigPanel for GOOGLE_SHEETS type, pass URL prop

**`src/app/admin/sources/actions.ts`**
- Add GOOGLE_SHEETS validation: required fields (sheetId, columns with date/hares/location/title, kennelTagRules.default)

### Open Questions
- **Column auto-detection**: Could we fetch the first row of the sheet and suggest column mappings? **Decision: Defer to Phase 6 (AI-assisted). For Phase 5, manual mapping is sufficient — there are only 2 Sheets sources.**
- **Sheets URL → sheetId extraction**: Should this happen client-side (on URL blur) or server-side? **Decision: Client-side — pure regex, no API call needed. Same pattern as Phase 6 auto-detect.**

---

## Phase 6: AI-assisted onboarding (Auto-detect + suggest)

Help admins bootstrap a new source with smart defaults. Two tiers: deterministic URL analysis (no API key needed) + optional Gemini analysis for richer suggestions.

### Tier 1 — Deterministic auto-detect (no Gemini)

**New: `src/lib/source-detect.ts`**
- `detectSourceType(url: string)`: URL pattern → suggested SourceType
  - `calendar.google.com/calendar` → GOOGLE_CALENDAR
  - `docs.google.com/spreadsheets` or `sheets.google.com` → GOOGLE_SHEETS
  - URL ending in `.ics` or `.ical` → ICAL_FEED
  - `hashrego.com` → HASHREGO
  - Everything else → HTML_SCRAPER (with note: "requires custom adapter")
- `extractCalendarId(url: string)`: pull calendar ID from Google Calendar URL
- `extractSheetId(url: string)`: pull sheet ID from Google Sheets URL

**`src/components/admin/SourceForm.tsx`**
- On URL field `onBlur`: call `detectSourceType()` client-side → auto-select type + extract IDs
- Show subtle hint: "Detected: Google Calendar" with auto-filled type
- Don't override if admin already manually set a type

### Tier 2 — Pattern suggestion from preview data

**`src/app/admin/sources/actions.ts` → `suggestKennelPatterns(events: RawEventData[])` helper**
- Analyzes kennel tag / title fields from preview events
- **Deterministic approach**: extract unique prefixes from event titles, group by frequency, suggest `[regex, tag][]`
  - e.g., 20 events with "EWH3 Trail #123" → `["^EWH3", "EWH3"]`
  - 5 events with "SHITH3 Run" → `["^SHITH3", "SHITH3"]`
- Returns suggested patterns with match counts + example titles

**`src/components/admin/config-panels/CalendarConfigPanel.tsx` / `ICalConfigPanel.tsx`**
- "Suggest Patterns" button (only enabled after preview has run)
- Shows suggestions as accept/reject chips that auto-populate KennelPatternsEditor

### Tier 3 — Gemini enhancement (future)
- If `GEMINI_API_KEY` is set: enhance with Gemini for ambiguous cases
- **Deferred**: not part of this implementation. The deterministic heuristic handles 80%+ of cases.

### Open Questions
- **Auto-detect aggressiveness**: Should auto-detect override a manually chosen type, or only fill empty type? **Decision: Only fill when type hasn't been explicitly set. Show hint text but don't override user choice.**
- **Gemini scope**: When we eventually add Gemini, should it only suggest patterns or also help with HTML scraper field selectors? **Decision: Patterns first (config-driven sources). HTML scraper AI is a separate roadmap item.**

---

## Implementation Order

| Phase | Scope | New Files | Modified Files | Effort |
|-------|-------|-----------|----------------|--------|
| 1 | Foundation (config + scrapeDays plumbing) | 0 | 4 | Small |
| 2 | Calendar + iCal panels + server validation | 3 + 1 test | 2 | Medium |
| 3 | Preview mode | 1 | 2 | Medium |
| 4 | Hash Rego panel | 1 | 2 | Small |
| 5 | Google Sheets panel | 1 | 2 | Large |
| 6 | Auto-detect + pattern suggestion | 1 + 1 test | 3 | Medium |

**Phases 1-3** deliver the most immediate value — existing sources become editable, Calendar/iCal configs get proper UIs, and preview mode enables troubleshooting.

**Phase 4** is quick (simple list editor).

**Phase 5** is complex UI but Sheets sources are added rarely.

**Phase 6** is additive — auto-detect is lightweight (client-side URL analysis), pattern suggestion builds on preview data.

---

## Key Files Reference

| File | Role |
|------|------|
| `src/components/admin/SourceForm.tsx` | Core form — all phases modify |
| `src/app/admin/sources/actions.ts` | Server actions — create/update/preview/validate |
| `src/app/admin/sources/page.tsx` | Source list — serialize config + scrapeDays |
| `src/components/admin/SourceTable.tsx` | Table — pass config to edit form |
| `src/adapters/google-calendar/adapter.ts` | CalendarSourceConfig type + matchConfigPatterns() |
| `src/adapters/ical/adapter.ts` | ICalSourceConfig type + parseICalSummary() |
| `src/adapters/google-sheets/adapter.ts` | GoogleSheetsConfig type |
| `src/adapters/hashrego/adapter.ts` | HashRegoConfig type |
| `src/adapters/registry.ts` | `getAdapter()` — adapter factory for preview |
| `src/adapters/utils.ts` | `validateSourceConfig<T>()` — generic config validator |
| `src/pipeline/kennel-resolver.ts` | `resolveKennelTag()` — used by preview to check tag resolution |

---

## Verification

After each phase:
1. `npm test` — all existing tests pass + new tests pass
2. `npm run build` — clean build

### Phase 1 — Edit existing source configs
3. `/admin/sources` → click Edit on BFM Google Calendar → verify config JSON visible in raw textarea + scrapeDays field shows "90"
4. Change scrapeDays to 60 → Save → verify persisted in DB via Prisma Studio
5. Edit config JSON → Save → verify config persisted

### Phase 2 — Config panels for Calendar + iCal
6. Edit BFM Calendar → verify CalendarConfigPanel shows existing 4 kennelPatterns + defaultKennelTag "BFM"
7. Edit SFH3 iCal → verify ICalConfigPanel shows 14 patterns + 2 skipPatterns
8. Add new Calendar source → fill in default kennel tag + 2 patterns → Save → verify config in DB
9. Test invalid regex in pattern → submit → verify error message

### Phase 3 — Preview for troubleshooting
10. Edit existing Calendar source → "Test Config" → verify event table shows parsed events with kennel tag colors
11. Modify a kennel pattern → "Test Config" again → verify changed results before saving
12. New source → fill config → "Test Config" → verify events appear → then Save

### Phase 4 — Hash Rego panel
13. Edit Hash Rego source → verify 8 kennel slugs shown in list editor
14. Add/remove a slug → Save → verify

### Phase 5 — Google Sheets panel
15. Edit Summit Sheets → verify column mapping, kennel tag rules, start time rules all populated
16. Create new Sheets source with column mapping → Save → verify scrape works

### Phase 6 — Auto-detect
17. Paste Google Calendar URL → verify type auto-selects + hint shows
18. Paste `.ics` URL → verify ICAL_FEED selected
19. Preview → "Suggest Patterns" → verify suggestions match event titles
