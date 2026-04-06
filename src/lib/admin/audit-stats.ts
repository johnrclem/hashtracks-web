import { prisma } from "@/lib/db";

/** Findings count from the most recent HARELINE audit run, or 0 if none. */
export async function getLatestAuditFindingsCount(): Promise<number> {
  const latest = await prisma.auditLog.findFirst({
    where: { type: "HARELINE" },
    orderBy: { createdAt: "desc" },
    select: { findingsCount: true },
  });
  return latest?.findingsCount ?? 0;
}
