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
  const kennelCount = new Set(findings.map(f => f.kennelShortName)).size;
  const lines: string[] = [
    `Automated daily audit found **${findings.length} issue${findings.length === 1 ? "" : "s"}** across ${kennelCount} kennel${kennelCount === 1 ? "" : "s"}.\n`,
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
