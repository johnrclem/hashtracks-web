import { prisma } from "@/lib/db";

/**
 * Public markdown endpoint listing active audit suppressions.
 * Consumed by docs/audit-chrome-prompt.md so the chrome agent picks up
 * accepted false positives without a manual doc update.
 */
export async function GET() {
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

  return new Response(lines.join("\n"), {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Cache-Control": "public, max-age=300, s-maxage=300, stale-while-revalidate=60",
    },
  });
}
