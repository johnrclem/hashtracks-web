# Kennel Page Redesign — Implementation Spec

**Date:** February 17, 2026
**Purpose:** Spec for Claude Code CLI to enrich the Kennel data model and redesign `/kennels/[slug]` pages from minimal profiles into rich, useful kennel landing pages.

**Context:** HashTracks currently has 24 kennels across 7 regions, but kennel pages are bare — just name, region badge, aliases, subscriber count, and a flat event list. Competitors (Harrier Central, Makesweat, HashRego) and our own research on 40+ kennels across 5 new regions (London, DC, Chicago, SF Bay Area) reveal a consistent set of profile fields that traveling and local hashers expect. We need to capture this data and present it well before scaling to new regions.

---

## 1. Current State

### Current Kennel Model (Prisma)

```prisma
model Kennel {
  id          String   @id @default(cuid())
  shortName   String   @unique
  fullName    String
  region      String
  country     String   @default("USA")
  description String?
  website     String?
  // ... relations: aliases, sources, events, members, kennelHashers, mismanRequests, rosterGroups
}
```

### Current `/kennels/[slug]` Page Shows

- Full name + short name
- Region badge + country + subscriber count
- Subscribe/Unsubscribe button
- Misman Dashboard button (if misman)
- Misman Team section (team members + pending invites)
- "Also known as" aliases
- Upcoming Events (flat list, "Show N more" toggle)
- Past Events (flat list)

### What's Missing (Informed by Competitor Analysis + Regional Research)

Every kennel research doc we produced captures these fields per kennel, and competitors display most of them:

1. **Schedule** — day of week, time, frequency (weekly/biweekly/monthly) — *the #1 thing a traveling hasher needs*
2. **Social links** — Facebook group/page, Instagram, Twitter/X, Discord, mailing list URLs
3. **Contact** — GM/mismanagement contact email or name
4. **Hash cash** — typical trail fee (e.g., "$5", "£4", "Free")
5. **Founded** — year kennel was established
6. **Run count** — can be derived from latest event run number, but also worth storing as a baseline
7. **Logo** — kennel logo URL (uploaded or linked)
8. **Payment link** — Venmo/PayPal/CashApp URL for hash cash
9. **Kennel type metadata** — dog-friendly, walkers welcome, trail type hints

---

## 2. Schema Changes

### Add New Fields to Kennel Model

Add these nullable fields to the `Kennel` model in `prisma/schema.prisma`:

```prisma
model Kennel {
  // ... existing fields unchanged ...

  // ── SCHEDULE ──
  scheduleDayOfWeek  String?   // "Monday", "Saturday", "Thursday" (display string, not enum — some kennels vary seasonally)
  scheduleTime       String?   // "7:00 PM", "12:00 Noon", "6:45 PM" (display string)
  scheduleFrequency  String?   // "Weekly", "Biweekly", "Monthly", "1st Saturday", "Full Moon" (free text)
  scheduleNotes      String?   // "Summer: Mondays 7pm. Winter: Sundays 2pm." (seasonal/special notes)

  // ── SOCIAL & CONTACT ──
  facebookUrl        String?   // Facebook group or page URL
  instagramHandle    String?   // "@londonhash" (handle only, no URL)
  twitterHandle      String?   // "@sfh3" (handle only)
  discordUrl         String?   // Discord invite link
  mailingListUrl     String?   // Google Group, Mailman, etc.
  contactEmail       String?   // GM or mismanagement email
  contactName        String?   // "Grand Master: Mudflap" (display text)

  // ── DETAILS ──
  hashCash           String?   // "$5", "£4", "Free", "$7 members / $10 visitors"
  paymentLink        String?   // Venmo/PayPal/CashApp URL
  foundedYear        Int?      // 1978, 1975, etc.
  logoUrl            String?   // URL to kennel logo image

  // ── FLAGS ──
  dogFriendly        Boolean?  // null = unknown, true = yes, false = no
  walkersWelcome     Boolean?  // null = unknown

  // ... existing relations unchanged ...
}
```

### Design Rationale

- **All new fields are nullable** — most kennels won't have all fields populated at first. The page should gracefully show/hide sections based on what's available.
- **Strings over enums for schedule** — kennels have wildly varied schedules (seasonal changes, "1st Saturday", "Full Moon", etc.). Free text is more flexible than trying to enum every pattern.
- **`hashCash` as string, not decimal** — handles "$5", "£4", "Free", "$7/$10 visitor", and international currencies without currency math.
- **Booleans are nullable** — `null` means "unknown/not specified" which is different from `false`.
- **No `logoUrl` file upload** — just a URL field for now. Logo upload (with image processing) is a future enhancement. Admin can paste a URL to an image hosted anywhere.

### Migration

Run `npx prisma migrate dev --name add-kennel-profile-fields` after schema update.

### Seed Update

Update `prisma/seed.ts` to populate the new fields for existing kennels where we have the data. Examples from our research:

```typescript
// In the kennels array, add fields to existing entries:
{
  shortName: "NYCH3",
  fullName: "New York City Hash House Harriers",
  region: "New York City, NY",
  country: "USA",
  website: "https://hashnyc.com",
  scheduleDayOfWeek: "Wednesday",
  scheduleTime: "7:00 PM",
  scheduleFrequency: "Weekly",
  hashCash: "$8",
  facebookUrl: "https://www.facebook.com/groups/nychash",
},
{
  shortName: "BoH3",
  fullName: "Boston Hash House Harriers",
  region: "Boston, MA",
  country: "USA",
  website: null,
  scheduleDayOfWeek: "Sunday",
  scheduleTime: "2:30 PM",
  scheduleFrequency: "Weekly",
},
{
  shortName: "BFM",
  fullName: "Ben Franklin Mob H3",
  region: "Philadelphia, PA",
  country: "USA",
  website: "https://benfranklinmob.com",
  scheduleDayOfWeek: "Saturday",
  scheduleTime: "2:00 PM",
  scheduleFrequency: "Biweekly",
},
// ... etc. for all 24 kennels where we know the data
```

Don't worry about getting every field for every kennel — populate what's known and leave the rest null. The page design handles missing data gracefully.

---

## 3. Admin Kennel Edit

### Update Admin Kennel Form

The existing admin kennel edit page (`/admin/kennels/[id]` or wherever the kennel CRUD form lives) needs the new fields added. Group them into logical sections:

**Existing fields** (already in the form):
- Short name, Full name, Region, Country, Description, Website

**New section: "Schedule"**
- Day of week (text input)
- Time (text input)
- Frequency (text input)
- Schedule notes (textarea, for seasonal variations)

**New section: "Social & Contact"**
- Facebook URL
- Instagram handle
- Twitter/X handle
- Discord URL
- Mailing list URL
- Contact email
- Contact name

**New section: "Details"**
- Hash cash (text input)
- Payment link (URL input)
- Founded year (number input)
- Logo URL (URL input)
- Dog friendly (tri-state: Yes / No / Unknown)
- Walkers welcome (tri-state: Yes / No / Unknown)

All fields are optional. The form should work the same as today with the new fields added below the existing ones.

---

## 4. Kennel Page Redesign (`/kennels/[slug]`)

### Design Goals

1. **Traveling hasher test**: A hasher visiting a new city should see everything they need to show up to a run in one glance — when, where (general area), how much, and how to find out more.
2. **Progressive disclosure**: Show the most important info prominently. Tuck details into expandable sections.
3. **Graceful degradation**: Pages with minimal data (just name + events) should still look good — no empty sections or skeleton placeholder boxes.
4. **Mobile-first**: The page must work well on phones since hashers look these up while traveling.

### Page Layout

#### Hero Section (Top)

```
┌────────────────────────────────────────────────────┐
│  [Logo]  New York City Hash House Harriers          │
│          NYCH3                                      │
│          ┌──────────┐ ┌─────┐                       │
│          │NYC, NY   │ │ USA │  3 subscribers         │
│          └──────────┘ └─────┘                       │
│                                                     │
│  [Subscribe]  [Misman Dashboard]                    │
└────────────────────────────────────────────────────┘
```

- If `logoUrl` exists, show a small logo (48x48 or 64x64) to the left of the name. If not, skip it — no placeholder.
- Existing layout is fine. Just add the logo if present.

#### Quick Info Card (NEW — the key addition)

A card immediately below the hero, showing at-a-glance run info. **Only render this card if at least one of its fields has data.** Don't show an empty card.

```
┌────────────────────────────────────────────────────┐
│  📅 Wednesdays at 7:00 PM · Weekly                  │
│  💰 $8 hash cash          [Pay online →]            │
│  🌐 hashnyc.com                                     │
│  📍 Founded 1975                                    │
│  🐕 Dog friendly · 🚶 Walkers welcome               │
└────────────────────────────────────────────────────┘
```

Implementation details:
- Each line only renders if the relevant field(s) are non-null.
- **Schedule line**: Combine `scheduleDayOfWeek`, `scheduleTime`, `scheduleFrequency` into one natural sentence. Examples:
  - All three: "Wednesdays at 7:00 PM · Weekly"
  - Day + time only: "Wednesdays at 7:00 PM"
  - Day + frequency: "Saturdays · Biweekly"
  - Just frequency: "Monthly"
- If `scheduleNotes` exists, show it as a smaller muted line below the main schedule line.
- **Hash cash line**: Show `hashCash` text. If `paymentLink` exists, add a "Pay online →" link (opens in new tab).
- **Website line**: Show `website` as a clickable link. Display just the domain (strip protocol).
- **Founded line**: "Est. {foundedYear}" if present.
- **Flags line**: Only show if either `dogFriendly` or `walkersWelcome` is `true`. Use simple text labels. Don't show "not dog friendly" — just omit the flag if false/null.

Use a clean card style consistent with the rest of the app (shadcn Card component). Use subtle icons or emoji — keep it lightweight.

#### Social Links (NEW)

If any social links exist, render a row of icon links below the quick info card (or integrated into it). Use small recognizable icons/logos for each platform.

```
[Facebook]  [Instagram]  [Twitter/X]  [Discord]  [Mailing List]  [Email]
```

- Only show icons for links that are populated.
- Use `target="_blank"` and `rel="noopener noreferrer"`.
- For `contactEmail`, use a `mailto:` link.
- For `instagramHandle` and `twitterHandle`, construct full URLs: `https://instagram.com/{handle}` and `https://x.com/{handle}` (strip leading `@` if present).
- If `contactName` exists but no other social links, show it as text: "Contact: Grand Master Mudflap" (with email link if available).
- If no social/contact fields are populated, don't render this section at all.

#### Description (Existing, Relocated)

If `description` exists, show it below the quick info card. Currently it may already be shown — just ensure it's positioned between quick info and events.

#### Misman Team Section (Existing)

Keep as-is. Already shows team members and pending invites for mismans.

#### Also Known As (Existing)

Keep as-is. Alias chips.

#### Upcoming Events (Existing, Enhanced)

Keep the existing event list but make two small improvements:

1. **Show hares inline** if available: After "Run #2137 · 7:00 PM", add "· Hares: Fraggle Cock" in muted text (data already exists on events).
2. **Show location** if available: Below the event line, show `locationName` in small muted text if present.

These are minor enhancements — the event data already exists in the Event model. Just surface it in the kennel page event cards.

#### Past Events (Existing)

Keep as-is.

#### Computed Stats Section (NEW — below events)

A small stats summary at the bottom of the page. Computed from event data — no schema change needed.

```
┌────────────────────────────────────────────────────┐
│  📊 Kennel Stats                                    │
│  Total events: 2,137 · Since: Jan 2016              │
│  Next run: Wed, Feb 18                              │
└────────────────────────────────────────────────────┘
```

- **Total events**: Count of all canonical events for this kennel.
- **Since**: Date of the oldest event in the database.
- **Next run**: Date of the next upcoming event, if one exists.
- Only show this section if there are events. Don't show for brand-new kennels with zero events.
- Keep this lightweight — it's computed from data we already have.

---

## 5. Implementation Notes

### File Changes Summary

| File | Change |
|------|--------|
| `prisma/schema.prisma` | Add 17 new nullable fields to Kennel model |
| `prisma/seed.ts` | Populate new fields for existing kennels |
| `src/app/kennels/[slug]/page.tsx` | Redesigned page layout with new sections |
| `src/app/admin/kennels/` (form) | Add new fields to admin kennel edit form |
| New: `src/components/kennels/QuickInfoCard.tsx` | Quick info card component |
| New: `src/components/kennels/SocialLinks.tsx` | Social links icon row |
| New: `src/components/kennels/KennelStats.tsx` | Computed stats section |

### Conventions to Follow

- **Existing patterns**: Follow the code conventions in `CLAUDE.md` — cuid IDs, UTC dates, Tailwind + shadcn, server components where possible.
- **Conditional rendering**: Every new section should be wrapped in a check that hides it when all its fields are null/empty. Never show empty sections or placeholder text like "No schedule available."
- **No new dependencies**: Use existing shadcn components (Card, Badge, etc.) and Tailwind. No new npm packages.
- **Tests**: Add tests for any new server actions or data-fetching logic. The page itself is a server component — focus tests on the data query (does it include the new fields?) and any helper functions (schedule formatting, URL construction from handles).

### Schedule Formatting Helper

Create a small pure function for formatting schedule info:

```typescript
// src/lib/format.ts (add to existing file)
export function formatSchedule(kennel: {
  scheduleDayOfWeek?: string | null;
  scheduleTime?: string | null;
  scheduleFrequency?: string | null;
}): string | null {
  const parts: string[] = [];
  if (kennel.scheduleDayOfWeek) {
    // Pluralize: "Monday" → "Mondays"
    const day = kennel.scheduleDayOfWeek;
    parts.push(day.endsWith("y") ? day.slice(0, -1) + "ies" :
               day.endsWith("s") ? day : day + "s");
  }
  if (kennel.scheduleTime) {
    parts.push(parts.length ? `at ${kennel.scheduleTime}` : kennel.scheduleTime);
  }
  if (kennel.scheduleFrequency) {
    parts.push(parts.length ? `· ${kennel.scheduleFrequency}` : kennel.scheduleFrequency);
  }
  return parts.length ? parts.join(" ") : null;
}
```

Note: the day pluralization is naive. "Wednesday" → "Wednesdays" works. "Saturday" → "Saturdays" works. The `y → ies` rule handles "Sunday" → "Sundays". Edge case: "Monday" → "Mondays" (doesn't end in y after stripping). Actually, English day names all end in "day" so just appending "s" is safe for all seven days. Simplify to just `day + "s"`.

### Social URL Construction

```typescript
// src/lib/format.ts (add to existing file)
export function instagramUrl(handle: string): string {
  return `https://instagram.com/${handle.replace(/^@/, "")}`;
}

export function twitterUrl(handle: string): string {
  return `https://x.com/${handle.replace(/^@/, "")}`;
}

export function displayDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}
```

---

## 6. What This Does NOT Include

These are explicitly deferred:

- **Logo upload** — just a URL field for now. Image upload + processing is a separate feature.
- **Map/location** — the competitive analysis notes map-based discovery as a medium-priority gap. That's a separate feature (PostGIS or client-side map). Kennel pages don't need a map yet.
- **Editable by mismans** — for now, only site admins can edit kennel profile fields via the admin panel. Misman self-service profile editing is a future enhancement.
- **i18n / localization** — currency symbols, time formats, etc. are handled by the free-text fields (admin types "$5" or "£4").
- **SEO / Open Graph** — listed separately in the roadmap. Not part of this spec.
- **Kennel request form updates** — the existing kennel request form (`KennelRequest` model) doesn't need new fields yet. When we onboard new regions, the researcher gathers this data and the admin populates it.

---

## 7. Migration Checklist

1. [ ] Update `prisma/schema.prisma` with new Kennel fields
2. [ ] Run `npx prisma migrate dev --name add-kennel-profile-fields`
3. [ ] Update `prisma/seed.ts` with known data for existing 24 kennels
4. [ ] Run `npx prisma db seed` to populate
5. [ ] Add schedule/social helpers to `src/lib/format.ts` + tests
6. [ ] Create `QuickInfoCard`, `SocialLinks`, `KennelStats` components
7. [ ] Redesign `/kennels/[slug]/page.tsx` with new layout
8. [ ] Update admin kennel edit form with new field sections
9. [ ] `npm run build` — no type errors
10. [ ] `npm test` — all tests pass
11. [ ] Manual review of a few kennel pages at different data completeness levels:
    - Full data (NYCH3 with schedule + social + hash cash)
    - Partial data (a kennel with just schedule)
    - Minimal data (a kennel with no new fields — should look like today, not worse)
12. [ ] Deploy to Vercel
