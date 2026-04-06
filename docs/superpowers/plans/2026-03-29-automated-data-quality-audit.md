# Automated Data Quality Audit — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Daily automated audit that queries the DB for bad data patterns, files a batched GitHub issue, and feeds into the existing self-healing autofix loop.

**Architecture:** A standalone TypeScript script (`scripts/audit-data-quality.ts`) runs audit checks against the Railway PostgreSQL database. A RemoteTrigger fires it daily. Findings are formatted as GitHub issues matching the existing test-case-report format, labeled for automatic pickup by claude-autofix.

**Tech Stack:** TypeScript, Prisma (PrismaPg adapter), `gh` CLI for issue filing, Claude Code RemoteTrigger for scheduling.

---

## File Structure

| File | Responsibility |
|------|---------------|
| `src/pipeline/audit-checks.ts` | Pure functions: each audit check takes events/data, returns findings. No DB access — testable in isolation. |
| `src/pipeline/audit-checks.test.ts` | Unit tests for every audit check function |
| `scripts/audit-data-quality.ts` | Entry point: connects to DB, runs checks, formats output. Supports `--dry-run` (default) and `--post-issue` flags. |
| `scripts/audit-format.ts` | Formats findings as GitHub-issue-compatible markdown |

---

### Task 1: Define AuditFinding Type + Hare Check Functions

**Files:**
- Create: `src/pipeline/audit-checks.ts`
- Create: `src/pipeline/audit-checks.test.ts`

- [ ] **Step 1: Write failing tests for hare checks**

```typescript
// src/pipeline/audit-checks.test.ts
import { describe, it, expect } from "vitest";
import { checkHareQuality } from "./audit-checks";

describe("checkHareQuality", () => {
  it("flags single-character hare values", () => {
    const findings = checkHareQuality([
      { id: "evt1", kennelShortName: "FWH3", haresText: "S", title: "Trail", date: "2026-03-28", sourceUrl: null, sourceType: "HTML_SCRAPER" },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0].rule).toBe("hare-single-char");
    expect(findings[0].currentValue).toBe("S");
  });

  it("flags CTA text as hare", () => {
    const findings = checkHareQuality([
      { id: "evt2", kennelShortName: "HMHHH", haresText: "Sign Up!", title: "Trail", date: "2026-03-28", sourceUrl: null, sourceType: "HTML_SCRAPER" },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0].rule).toBe("hare-cta-text");
  });

  it("flags URLs as hare", () => {
    const findings = checkHareQuality([
      { id: "evt3", kennelShortName: "AH3", haresText: "https://maps.google.com/foo", title: "Trail", date: "2026-03-28", sourceUrl: null, sourceType: "GOOGLE_CALENDAR" },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0].rule).toBe("hare-url");
  });

  it("flags description leaks (>200 chars)", () => {
    const findings = checkHareQuality([
      { id: "evt4", kennelShortName: "BH3", haresText: "A".repeat(250), title: "Trail", date: "2026-03-28", sourceUrl: null, sourceType: "GOOGLE_CALENDAR" },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0].rule).toBe("hare-description-leak");
  });

  it("flags phone numbers in hare field", () => {
    const findings = checkHareQuality([
      { id: "evt5", kennelShortName: "CH3", haresText: "Captain Hash 719-360-3805", title: "Trail", date: "2026-03-28", sourceUrl: null, sourceType: "GOOGLE_CALENDAR" },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0].rule).toBe("hare-phone-number");
  });

  it("flags boilerplate markers in hare field", () => {
    const findings = checkHareQuality([
      { id: "evt6", kennelShortName: "DH3", haresText: "Captain Hash WHAT TIME: 6:30 PM", title: "Trail", date: "2026-03-28", sourceUrl: null, sourceType: "GOOGLE_CALENDAR" },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0].rule).toBe("hare-boilerplate-leak");
  });

  it("passes clean hare values", () => {
    const findings = checkHareQuality([
      { id: "evt7", kennelShortName: "NYCH3", haresText: "Mudflap & Trail Blazer", title: "Trail", date: "2026-03-28", sourceUrl: null, sourceType: "HTML_SCRAPER" },
    ]);
    expect(findings).toHaveLength(0);
  });

  it("skips events with null hares", () => {
    const findings = checkHareQuality([
      { id: "evt8", kennelShortName: "NYCH3", haresText: null, title: "Trail", date: "2026-03-28", sourceUrl: null, sourceType: "HTML_SCRAPER" },
    ]);
    expect(findings).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/pipeline/audit-checks.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement AuditFinding type + checkHareQuality**

```typescript
// src/pipeline/audit-checks.ts

/** Shape of an event row for audit checks (queried from DB with joins). */
export interface AuditEventRow {
  id: string;
  kennelShortName: string;
  haresText: string | null;
  title: string | null;
  description: string | null;
  locationName: string | null;
  locationCity: string | null;
  startTime: string | null;
  runNumber: number | null;
  date: string;           // ISO date
  sourceUrl: string | null;
  sourceType: string;     // e.g., "GOOGLE_CALENDAR", "HTML_SCRAPER"
  kennelCode: string;
  scrapeDays: number;
}

export interface AuditFinding {
  kennelShortName: string;
  eventId: string;
  eventUrl: string;
  sourceUrl: string | null;
  adapterType: string;
  category: "hares" | "title" | "location" | "event" | "description";
  field: string;
  currentValue: string;
  expectedValue?: string;
  rule: string;
  severity: "error" | "warning";
}

const HASHTRACKS_BASE = "https://www.hashtracks.xyz/hareline";

function finding(
  event: Pick<AuditEventRow, "id" | "kennelShortName" | "sourceUrl" | "sourceType">,
  category: AuditFinding["category"],
  field: string,
  currentValue: string,
  rule: string,
  severity: AuditFinding["severity"] = "warning",
  expectedValue?: string,
): AuditFinding {
  return {
    kennelShortName: event.kennelShortName,
    eventId: event.id,
    eventUrl: `${HASHTRACKS_BASE}/${event.id}`,
    sourceUrl: event.sourceUrl,
    adapterType: event.sourceType,
    category,
    field,
    currentValue,
    rule,
    severity,
    ...(expectedValue ? { expectedValue } : {}),
  };
}

// ── Hare Checks ──

const CTA_HARE_RE = /^(?:tbd|tba|tbc|n\/a|sign[\s\u00A0]*up!?|volunteer|needed|required)$/i;
const PHONE_RE = /\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}/;
const BOILERPLATE_RE = /\b(?:WHAT TIME|WHAT TO WEAR|WHERE|Location|HASH CASH|Cost|Price|Length|Distance|Directions|Trail Type|Trail is|Start|Meet at|Registration|On-On|On On|Question|Call\s)[:\s]/i;

export function checkHareQuality(events: Pick<AuditEventRow, "id" | "kennelShortName" | "haresText" | "sourceUrl" | "sourceType">[]): AuditFinding[] {
  const findings: AuditFinding[] = [];
  for (const ev of events) {
    if (!ev.haresText) continue;
    const h = ev.haresText;
    if (h.length === 1) {
      findings.push(finding(ev, "hares", "haresText", h, "hare-single-char", "error"));
    } else if (CTA_HARE_RE.test(h)) {
      findings.push(finding(ev, "hares", "haresText", h, "hare-cta-text"));
    } else if (/^https?:\/\//i.test(h)) {
      findings.push(finding(ev, "hares", "haresText", h, "hare-url"));
    } else if (h.length > 200) {
      findings.push(finding(ev, "hares", "haresText", h.slice(0, 80) + "...", "hare-description-leak"));
    } else if (PHONE_RE.test(h)) {
      findings.push(finding(ev, "hares", "haresText", h, "hare-phone-number"));
    } else if (BOILERPLATE_RE.test(h)) {
      findings.push(finding(ev, "hares", "haresText", h, "hare-boilerplate-leak"));
    }
  }
  return findings;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/pipeline/audit-checks.test.ts`
Expected: PASS (8 tests)

- [ ] **Step 5: Commit**

```bash
git add src/pipeline/audit-checks.ts src/pipeline/audit-checks.test.ts
git commit -m "feat: add audit check types and hare quality checks"
```

---

### Task 2: Title Quality Checks

**Files:**
- Modify: `src/pipeline/audit-checks.ts`
- Modify: `src/pipeline/audit-checks.test.ts`

- [ ] **Step 1: Write failing tests for title checks**

```typescript
// Add to audit-checks.test.ts
import { checkTitleQuality } from "./audit-checks";

describe("checkTitleQuality", () => {
  it("flags title using raw kennelCode instead of shortName", () => {
    const findings = checkTitleQuality([
      { id: "evt1", kennelShortName: "Houston H3", kennelCode: "h4-tx", title: "h4-tx Trail #2555", haresText: null, date: "2026-03-28", sourceUrl: null, sourceType: "GOOGLE_CALENDAR" },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0].rule).toBe("title-raw-kennel-code");
  });

  it("flags CTA text as title", () => {
    const findings = checkTitleQuality([
      { id: "evt2", kennelShortName: "KAW!H3", kennelCode: "kawh3", title: "Wanna Hare? Check out our upcoming available dates!", haresText: null, date: "2026-03-28", sourceUrl: null, sourceType: "GOOGLE_CALENDAR" },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0].rule).toBe("title-cta-text");
  });

  it("flags schedule description as title", () => {
    const findings = checkTitleQuality([
      { id: "evt3", kennelShortName: "Mosquito H3", kennelCode: "mosquito-h3", title: "Mosquito H3 runs on the first and third Wednesdays", haresText: null, date: "2026-03-28", sourceUrl: null, sourceType: "GOOGLE_CALENDAR" },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0].rule).toBe("title-schedule-description");
  });

  it("flags HTML entities in title", () => {
    const findings = checkTitleQuality([
      { id: "evt4", kennelShortName: "NYCH3", kennelCode: "nych3", title: "St Patrick&apos;s Day Hash &amp; Run", haresText: null, date: "2026-03-28", sourceUrl: null, sourceType: "HTML_SCRAPER" },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0].rule).toBe("title-html-entities");
  });

  it("flags time-only title", () => {
    const findings = checkTitleQuality([
      { id: "evt5", kennelShortName: "BH3", kennelCode: "bh3", title: "12:30pm", haresText: null, date: "2026-03-28", sourceUrl: null, sourceType: "GOOGLE_CALENDAR" },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0].rule).toBe("title-time-only");
  });

  it("passes clean titles", () => {
    const findings = checkTitleQuality([
      { id: "evt6", kennelShortName: "NYCH3", kennelCode: "nych3", title: "NYCH3 #2800 Spring Equinox", haresText: null, date: "2026-03-28", sourceUrl: null, sourceType: "HTML_SCRAPER" },
    ]);
    expect(findings).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/pipeline/audit-checks.test.ts`
Expected: FAIL — checkTitleQuality not exported

- [ ] **Step 3: Implement checkTitleQuality**

```typescript
// Add to audit-checks.ts

const CTA_TITLE_RE = /\b(?:wanna\s+hare|available\s+dates|check\s+out\s+our|sign\s*up)\b/i;
const SCHEDULE_TITLE_RE = /\b(?:runs?\s+on\s+the\s+(?:first|second|third|fourth|last)|meets?\s+every|hashes?\s+on\s+the|runs?\s+every)\b/i;
const HTML_ENTITY_RE = /&(?:amp|lt|gt|quot|apos|#\d+|#x[\da-f]+);/i;
const TIME_ONLY_RE = /^(?:\d{1,2}(?::\d{2})?\s*(?:am|pm)|\d{1,2}:\d{2})$/i;

export function checkTitleQuality(events: Pick<AuditEventRow, "id" | "kennelShortName" | "kennelCode" | "title" | "sourceUrl" | "sourceType">[]): AuditFinding[] {
  const findings: AuditFinding[] = [];
  for (const ev of events) {
    if (!ev.title) continue;
    const t = ev.title;
    // Check if title uses raw kennelCode instead of shortName
    const codeTrailRe = new RegExp(`^${ev.kennelCode.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s+Trail`, "i");
    if (codeTrailRe.test(t) && !t.startsWith(ev.kennelShortName)) {
      findings.push(finding(ev, "title", "title", t, "title-raw-kennel-code", "error", `${ev.kennelShortName} Trail...`));
    } else if (CTA_TITLE_RE.test(t)) {
      findings.push(finding(ev, "title", "title", t, "title-cta-text"));
    } else if (SCHEDULE_TITLE_RE.test(t)) {
      findings.push(finding(ev, "title", "title", t, "title-schedule-description"));
    } else if (HTML_ENTITY_RE.test(t)) {
      findings.push(finding(ev, "title", "title", t, "title-html-entities"));
    } else if (TIME_ONLY_RE.test(t)) {
      findings.push(finding(ev, "title", "title", t, "title-time-only"));
    }
  }
  return findings;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/pipeline/audit-checks.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/pipeline/audit-checks.ts src/pipeline/audit-checks.test.ts
git commit -m "feat: add title quality audit checks"
```

---

### Task 3: Location + Event + Description Checks

**Files:**
- Modify: `src/pipeline/audit-checks.ts`
- Modify: `src/pipeline/audit-checks.test.ts`

- [ ] **Step 1: Write failing tests for location, event, and description checks**

```typescript
// Add to audit-checks.test.ts
import { checkLocationQuality, checkEventQuality, checkDescriptionQuality } from "./audit-checks";

describe("checkLocationQuality", () => {
  it("flags duplicated address segments", () => {
    const findings = checkLocationQuality([
      { id: "evt1", kennelShortName: "LBH3", locationName: "North San Miguel Road & Barcelona Place, N San Miguel Rd & Barcelona Pl, Walnut, CA", locationCity: null, title: "Trail", date: "2026-03-28", sourceUrl: null, sourceType: "GOOGLE_CALENDAR" },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0].rule).toBe("location-duplicate-segments");
  });

  it("flags URL in location", () => {
    const findings = checkLocationQuality([
      { id: "evt2", kennelShortName: "AH3", locationName: "https://maps.google.com/foo", locationCity: null, title: "Trail", date: "2026-03-28", sourceUrl: null, sourceType: "GOOGLE_CALENDAR" },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0].rule).toBe("location-url");
  });

  it("flags region appended to complete address", () => {
    const findings = checkLocationQuality([
      { id: "evt3", kennelShortName: "RCH3", locationName: "13480 Congress Lake Ave, Hartville, OH", locationCity: "Akron, OH", title: "Trail", date: "2026-03-28", sourceUrl: null, sourceType: "MEETUP" },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0].rule).toBe("location-region-appended");
  });

  it("passes clean locations", () => {
    const findings = checkLocationQuality([
      { id: "evt4", kennelShortName: "NYCH3", locationName: "Central Park, New York, NY", locationCity: "New York, NY", title: "Trail", date: "2026-03-28", sourceUrl: null, sourceType: "HTML_SCRAPER" },
    ]);
    expect(findings).toHaveLength(0);
  });
});

describe("checkEventQuality", () => {
  it("flags improbable late-night start times", () => {
    const findings = checkEventQuality([
      { id: "evt1", kennelShortName: "BH3", startTime: "23:45", title: "Trail", date: "2026-03-28", sourceUrl: null, sourceType: "GOOGLE_CALENDAR", scrapeDays: 90 },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0].rule).toBe("event-improbable-time");
  });

  it("passes normal start times", () => {
    const findings = checkEventQuality([
      { id: "evt2", kennelShortName: "BH3", startTime: "18:30", title: "Trail", date: "2026-03-28", sourceUrl: null, sourceType: "GOOGLE_CALENDAR", scrapeDays: 90 },
    ]);
    expect(findings).toHaveLength(0);
  });
});

describe("checkDescriptionQuality", () => {
  it("flags events missing description when raw data had one", () => {
    const findings = checkDescriptionQuality([
      { id: "evt1", kennelShortName: "BH3", description: null, rawDescription: "Trail details here", title: "Trail", date: "2026-03-28", sourceUrl: null, sourceType: "GOOGLE_CALENDAR" },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0].rule).toBe("description-dropped");
  });

  it("passes events with descriptions", () => {
    const findings = checkDescriptionQuality([
      { id: "evt2", kennelShortName: "BH3", description: "Trail details", rawDescription: "Trail details", title: "Trail", date: "2026-03-28", sourceUrl: null, sourceType: "GOOGLE_CALENDAR" },
    ]);
    expect(findings).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/pipeline/audit-checks.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement location, event, and description checks**

```typescript
// Add to audit-checks.ts

// ── Location Checks ──

/** Reuse the abbreviation normalization from merge.ts for duplicate detection */
const ADDR_ABBREVS: Record<string, string> = {
  north: "n", south: "s", east: "e", west: "w",
  road: "rd", street: "st", avenue: "ave",
  boulevard: "blvd", place: "pl", drive: "dr",
};

function normalizeAddrSegment(s: string): string {
  let n = s.toLowerCase();
  for (const [word, abbr] of Object.entries(ADDR_ABBREVS)) {
    n = n.replaceAll(new RegExp(`\\b${word}\\b`, "gi"), abbr);
  }
  return n.replaceAll(/[.\s]+/g, " ").trim();
}

export function checkLocationQuality(events: Pick<AuditEventRow, "id" | "kennelShortName" | "locationName" | "locationCity" | "sourceUrl" | "sourceType">[]): AuditFinding[] {
  const findings: AuditFinding[] = [];
  for (const ev of events) {
    if (!ev.locationName) continue;
    const loc = ev.locationName;
    // URL as location
    if (/^https?:\/\//i.test(loc)) {
      findings.push(finding(ev, "location", "locationName", loc, "location-url"));
      continue;
    }
    // Duplicated segments
    const parts = loc.split(", ");
    if (parts.length >= 3) {
      const n0 = normalizeAddrSegment(parts[0]);
      const n1 = normalizeAddrSegment(parts[1]);
      if (n0 && n1 && (n0 === n1 || n0.includes(n1) || n1.includes(n0))) {
        findings.push(finding(ev, "location", "locationName", loc, "location-duplicate-segments"));
        continue;
      }
    }
    // Region appended: location ends with state abbreviation but locationCity has a different city
    if (ev.locationCity) {
      const stateMatch = loc.match(/, ([A-Z]{2})(?:\s+\d{5})?\s*$/);
      const cityName = ev.locationCity.split(",")[0]?.trim();
      if (stateMatch && cityName && !loc.toLowerCase().includes(cityName.toLowerCase())) {
        // Location already has a complete address but locationCity would add a different city
        findings.push(finding(ev, "location", "locationName+locationCity", `${loc}, ${ev.locationCity}`, "location-region-appended", "warning", loc));
      }
    }
  }
  return findings;
}

// ── Event Checks ──

export function checkEventQuality(events: Pick<AuditEventRow, "id" | "kennelShortName" | "startTime" | "date" | "sourceUrl" | "sourceType" | "scrapeDays">[]): AuditFinding[] {
  const findings: AuditFinding[] = [];
  for (const ev of events) {
    // Improbable start time (23:00–04:00)
    if (ev.startTime) {
      const hour = parseInt(ev.startTime.split(":")[0], 10);
      if (hour >= 23 || (hour >= 0 && hour < 4)) {
        findings.push(finding(ev, "event", "startTime", ev.startTime, "event-improbable-time"));
      }
    }
  }
  return findings;
}

// ── Description Checks ──

export function checkDescriptionQuality(events: { id: string; kennelShortName: string; description: string | null; rawDescription: string | null; sourceUrl: string | null; sourceType: string }[]): AuditFinding[] {
  const findings: AuditFinding[] = [];
  for (const ev of events) {
    if (!ev.description && ev.rawDescription && ev.rawDescription.length > 20) {
      findings.push(finding(ev, "description", "description", "(empty)", "description-dropped", "warning", `Raw data has ${ev.rawDescription.length} chars`));
    }
  }
  return findings;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/pipeline/audit-checks.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/pipeline/audit-checks.ts src/pipeline/audit-checks.test.ts
git commit -m "feat: add location, event, and description audit checks"
```

---

### Task 4: GitHub Issue Formatter

**Files:**
- Create: `scripts/audit-format.ts`

- [ ] **Step 1: Implement the formatter**

```typescript
// scripts/audit-format.ts
import type { AuditFinding } from "../src/pipeline/audit-checks";

const CATEGORY_LABELS: Record<string, string> = {
  hares: "Hare Extraction",
  title: "Title Extraction",
  location: "Location Extraction",
  event: "Event Quality",
  description: "Description Quality",
};

export function formatIssueTitle(findings: AuditFinding[], date: string): string {
  return `[Audit] ${findings.length} data quality issue${findings.length === 1 ? "" : "s"} — ${date}`;
}

export function formatIssueBody(findings: AuditFinding[]): string {
  const lines: string[] = [
    `Automated daily audit found **${findings.length} issue${findings.length === 1 ? "" : "s"}** across ${new Set(findings.map(f => f.kennelShortName)).size} kennel${new Set(findings.map(f => f.kennelShortName)).size === 1 ? "" : "s"}.\n`,
  ];

  for (const f of findings) {
    lines.push(`### ${f.kennelShortName} — ${CATEGORY_LABELS[f.category] ?? f.category} Failure`);
    lines.push(`* **Impacted HashTracks Event URL:** ${f.eventUrl}`);
    if (f.sourceUrl) lines.push(`* **Source URL:** ${f.sourceUrl}`);
    lines.push(`* **Suspected Adapter:** ${f.adapterType}`);
    lines.push(`* **Field(s) Affected:** ${f.field}`);
    lines.push(`* **Current Extracted Value:** \`"${f.currentValue}"\``);
    if (f.expectedValue) lines.push(`* **Expected Value:** \`"${f.expectedValue}"\``);
    lines.push(`* **Audit Rule:** \`${f.rule}\` (severity: ${f.severity})`);
    lines.push("");
  }

  return lines.join("\n");
}
```

- [ ] **Step 2: Commit**

```bash
git add scripts/audit-format.ts
git commit -m "feat: add GitHub issue formatter for audit findings"
```

---

### Task 5: Main Audit Script (DB Queries + Issue Filing)

**Files:**
- Create: `scripts/audit-data-quality.ts`

- [ ] **Step 1: Implement the main audit script**

```typescript
// scripts/audit-data-quality.ts
/**
 * Automated data quality audit — queries upcoming events for known bad patterns.
 *
 * Usage:
 *   npx tsx scripts/audit-data-quality.ts              # dry run (print findings)
 *   npx tsx scripts/audit-data-quality.ts --post-issue  # create GitHub issue
 */
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import pg from "pg";
import { execSync } from "child_process";
import {
  checkHareQuality,
  checkTitleQuality,
  checkLocationQuality,
  checkEventQuality,
  checkDescriptionQuality,
  type AuditFinding,
} from "../src/pipeline/audit-checks";
import { formatIssueTitle, formatIssueBody } from "./audit-format";

const postIssue = process.argv.includes("--post-issue");

async function main() {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  const adapter = new PrismaPg(pool);
  const prisma = new PrismaClient({ adapter } as never);

  console.log(postIssue ? "📋 AUDIT — will post GitHub issue\n" : "🔍 AUDIT — dry run\n");

  // Query upcoming events (next 90 days) with kennel + source data
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - 7); // include recently-past events
  const futureDate = new Date();
  futureDate.setDate(futureDate.getDate() + 90);

  const events = await prisma.event.findMany({
    where: {
      date: { gte: cutoffDate, lte: futureDate },
      status: "CONFIRMED",
    },
    select: {
      id: true,
      title: true,
      haresText: true,
      description: true,
      locationName: true,
      locationCity: true,
      startTime: true,
      runNumber: true,
      date: true,
      sourceUrl: true,
      kennel: { select: { shortName: true, kennelCode: true } },
      rawEvents: {
        take: 1,
        orderBy: { createdAt: "desc" },
        select: {
          rawData: true,
          source: { select: { type: true, scrapeDays: true } },
        },
      },
    },
  });

  console.log(`Queried ${events.length} upcoming events\n`);

  // Flatten for check functions
  const rows = events.map(e => ({
    id: e.id,
    kennelShortName: e.kennel.shortName,
    kennelCode: e.kennel.kennelCode,
    haresText: e.haresText,
    title: e.title,
    description: e.description,
    locationName: e.locationName,
    locationCity: e.locationCity,
    startTime: e.startTime,
    runNumber: e.runNumber,
    date: e.date.toISOString().split("T")[0],
    sourceUrl: e.sourceUrl,
    sourceType: e.rawEvents[0]?.source?.type ?? "UNKNOWN",
    scrapeDays: e.rawEvents[0]?.source?.scrapeDays ?? 90,
    rawDescription: (e.rawEvents[0]?.rawData as Record<string, unknown>)?.description as string | null ?? null,
  }));

  // Run all checks
  const findings: AuditFinding[] = [
    ...checkHareQuality(rows),
    ...checkTitleQuality(rows),
    ...checkLocationQuality(rows),
    ...checkEventQuality(rows),
    ...checkDescriptionQuality(rows.map(r => ({
      id: r.id,
      kennelShortName: r.kennelShortName,
      description: r.description,
      rawDescription: r.rawDescription,
      sourceUrl: r.sourceUrl,
      sourceType: r.sourceType,
    }))),
  ];

  // Print summary
  const byCategory = new Map<string, number>();
  for (const f of findings) {
    byCategory.set(f.category, (byCategory.get(f.category) ?? 0) + 1);
  }

  if (findings.length === 0) {
    console.log("✅ No issues found!");
  } else {
    console.log(`Found ${findings.length} issues:`);
    for (const [cat, count] of byCategory) {
      console.log(`  ${cat}: ${count}`);
    }
    console.log("");

    // Print findings
    for (const f of findings) {
      console.log(`  [${f.severity}] ${f.kennelShortName}: ${f.rule} — "${f.currentValue.slice(0, 60)}"`);
    }

    // Post GitHub issue if requested
    if (postIssue && findings.length > 0) {
      const today = new Date().toISOString().split("T")[0];
      const title = formatIssueTitle(findings, today);
      const body = formatIssueBody(findings);

      console.log(`\nCreating GitHub issue: ${title}`);
      const bodyFile = "/tmp/audit-issue-body.md";
      require("fs").writeFileSync(bodyFile, body);

      try {
        const result = execSync(
          `gh issue create --repo johnrclem/hashtracks-web --title "${title}" --label audit --label claude-fix --body-file ${bodyFile}`,
          { encoding: "utf8" },
        );
        console.log(`Issue created: ${result.trim()}`);
      } catch (err) {
        console.error("Failed to create GitHub issue:", err);
      }
    }
  }

  await prisma.$disconnect();
  pool.end();
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
```

- [ ] **Step 2: Run dry-run locally to verify**

Run: `npx tsx scripts/audit-data-quality.ts`
Expected: Prints findings (or "No issues found") without creating a GitHub issue

- [ ] **Step 3: Commit**

```bash
git add scripts/audit-data-quality.ts
git commit -m "feat: add main audit script with DB queries and GitHub issue filing"
```

---

### Task 6: Set Up RemoteTrigger

- [ ] **Step 1: Create the remote trigger**

Use the Claude Code `RemoteTrigger` tool to create a daily schedule:

```
RemoteTrigger create:
  name: "daily-data-quality-audit"
  description: "Run automated data quality audit against upcoming events"
  schedule: "7 7 * * *"
  prompt: |
    Run the automated data quality audit:
    1. cd to the project root
    2. Run: npx tsx scripts/audit-data-quality.ts --post-issue
    3. Report whether issues were found and if a GitHub issue was created
```

- [ ] **Step 2: Test the trigger manually**

Run the trigger once to verify it works end-to-end.

- [ ] **Step 3: Commit any trigger config files**

```bash
git add .claude/
git commit -m "feat: add daily data quality audit remote trigger"
```

---

### Task 7: End-to-End Verification

- [ ] **Step 1: Run audit locally in dry-run mode**

Run: `npx tsx scripts/audit-data-quality.ts`
Verify: Output shows findings matching known issues (or clean bill of health if all fixed)

- [ ] **Step 2: Run audit with --post-issue against a test label**

Run: `npx tsx scripts/audit-data-quality.ts --post-issue`
Verify: GitHub issue created with correct format, labels `audit` + `claude-fix`

- [ ] **Step 3: Verify autofix workflow triggers**

Check: Does `claude-issue-triage.yml` fire on the new issue?
Verify: Triage comment posted with confidence score

- [ ] **Step 4: Run full test suite**

Run: `npm test`
Verify: All tests pass including new audit check tests
