/**
 * Render active audit suppressions as markdown for audit agents.
 * Served by `/api/audit/suppressions` (browser session) and
 * `/api/audit/agent/suppressions` (agent token).
 */
import { prisma } from "@/lib/db";

export async function renderSuppressionsMarkdown(): Promise<string> {
  const rows = await prisma.auditSuppression.findMany({
    select: {
      kennelCode: true,
      rule: true,
      reason: true,
      kennel: { select: { shortName: true } },
    },
    orderBy: [{ kennelCode: "asc" }, { rule: "asc" }],
  });

  const lines = [
    "## Active Suppressions",
    "",
    "These kennel+rule combos are accepted behavior — do not flag:",
    "",
  ];

  if (rows.length === 0) {
    lines.push("*(none currently)*");
  } else {
    for (const r of rows) {
      const scope =
        r.kennelCode === null
          ? "**Global**"
          : `**${r.kennel?.shortName ?? r.kennelCode}** (\`${r.kennelCode}\`)`;
      lines.push(`- ${scope} — \`${r.rule}\` — ${r.reason}`);
    }
  }
  lines.push("");

  return lines.join("\n");
}

/** Response headers shared by both suppressions routes. */
export const SUPPRESSIONS_RESPONSE_HEADERS = {
  "Content-Type": "text/markdown; charset=utf-8",
  "Cache-Control": "private, max-age=300",
} as const;
