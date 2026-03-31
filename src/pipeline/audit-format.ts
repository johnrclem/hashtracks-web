/**
 * Format audit findings as GitHub-issue-compatible markdown.
 */
import type { AuditFinding } from "./audit-checks";
import type { AuditGroup } from "./audit-runner";

const CATEGORY_LABELS: Record<string, string> = {
  hares: "Hare Extraction",
  title: "Title Extraction",
  location: "Location Extraction",
  event: "Event Quality",
  description: "Description Quality",
};

/** Format a single audit group as a focused GitHub issue for autofix. */
export function formatGroupIssueTitle(group: AuditGroup, date: string): string {
  const label = CATEGORY_LABELS[group.category] ?? group.category;
  return `[Audit] ${group.kennelShortName} — ${label} (${group.count} events) — ${date}`;
}

export function formatGroupIssueBody(group: AuditGroup): string {
  const lines: string[] = [
    `Automated audit found **${group.count} event${group.count === 1 ? "" : "s"}** affected by \`${group.rule}\` for **${group.kennelShortName}**.\n`,
    `**Severity:** ${group.severity}`,
    `**Adapter:** ${group.adapterType}`,
    `**Rule:** \`${group.rule}\``,
    "",
    "## Sample Events",
    "",
  ];

  for (const f of group.sampleFindings) {
    lines.push(`- **${f.eventUrl}**`);
    lines.push(`  - Current: \`"${f.currentValue}"\``);
    if (f.expectedValue) lines.push(`  - Expected: \`"${f.expectedValue}"\``);
    if (f.sourceUrl) lines.push(`  - Source: ${f.sourceUrl}`);
    lines.push("");
  }

  if (group.count > group.sampleFindings.length) {
    lines.push(`*...and ${group.count - group.sampleFindings.length} more events with the same issue.*\n`);
  }

  lines.push(
    "## Fix Guidance",
    "",
    formatFixGuidance(group),
    "",
  );

  return lines.join("\n");
}

/** Provide rule-specific fix guidance for the autofix agent. */
function formatFixGuidance(group: AuditGroup): string {
  switch (group.rule) {
    case "title-raw-kennel-code":
      return [
        `The default title uses the raw \`kennelCode\` (\`"${group.sampleFindings[0]?.currentValue}"\`) instead of the kennel's display name.`,
        `Fix: run the backfill script \`npx tsx scripts/backfill-event-titles.ts --apply\` or re-scrape the source.`,
        `The \`friendlyKennelName()\` function in \`src/pipeline/merge.ts\` handles this for new events.`,
      ].join("\n");
    case "hare-cta-text":
      return `Hare field contains CTA/placeholder text instead of actual hare names. Check if the adapter's hare extraction is filtering these patterns, or if the source genuinely has no hare data (in which case the field should be null).`;
    case "location-duplicate-segments":
      return `Location contains duplicated address segments (long-form + abbreviated). The \`deduplicateAddressPrefix()\` in \`sanitizeLocation()\` should catch this — verify it's running on this source's data.`;
    case "location-region-appended":
      return `Location display appends the kennel's region city to an address that already has a different city+state. Check \`getLocationDisplay()\` in \`src/lib/event-display.ts\` — the state-abbreviation guard should prevent this.`;
    case "event-improbable-time":
      return `Start time is between 23:00–04:00, which is unusual for a hash run. Check if this is a timezone conversion issue (UTC stored as local) or genuinely a late-night/early-morning event.`;
    case "description-dropped":
      return `The canonical event has no description but the raw scraped data does. Check the merge pipeline's description handling for this source type.`;
    default:
      return `See the audit rule \`${group.rule}\` in \`src/pipeline/audit-checks.ts\` for detection logic.`;
  }
}

/** Legacy: format all findings as a single batched issue (used by local script). */
export function formatIssueTitle(findings: AuditFinding[], date: string): string {
  return `[Audit] ${findings.length} data quality issue${findings.length === 1 ? "" : "s"} — ${date}`;
}

export function formatIssueBody(findings: AuditFinding[]): string {
  const kennelCount = new Set(findings.map(f => f.kennelShortName)).size;
  const lines: string[] = [
    `Automated daily audit found **${findings.length} issue${findings.length === 1 ? "" : "s"}** across ${kennelCount} kennel${kennelCount === 1 ? "" : "s"}.\n`,
  ];

  for (const f of findings) {
    lines.push(
      `### ${f.kennelShortName} — ${CATEGORY_LABELS[f.category] ?? f.category} Failure`,
      `* **Impacted HashTracks Event URL:** ${f.eventUrl}`,
    );
    if (f.sourceUrl) lines.push(`* **Source URL:** ${f.sourceUrl}`);
    lines.push(
      `* **Suspected Adapter:** ${f.adapterType}`,
      `* **Field(s) Affected:** ${f.field}`,
      `* **Current Extracted Value:** \`"${f.currentValue}"\``,
    );
    if (f.expectedValue) lines.push(`* **Expected Value:** \`"${f.expectedValue}"\``);
    lines.push(`* **Audit Rule:** \`${f.rule}\` (severity: ${f.severity})`, "");
  }

  return lines.join("\n");
}
