"use server";

import { prisma } from "@/lib/db";
import { getAdminUser } from "@/lib/auth";
import { clearResolverCache } from "@/pipeline/kennel-resolver";

/**
 * Create a kennel alias directly from the source form preview panel.
 * Used when "Test Config" returns unmatched tags and the admin wants to
 * link a tag to an existing kennel without navigating away.
 */
export async function createInlineAlias(
  tag: string,
  kennelId: string,
): Promise<{ success?: true; error?: string }> {
  const admin = await getAdminUser();
  if (!admin) return { error: "Unauthorized" };

  const existing = await prisma.kennelAlias.findFirst({
    where: { alias: { equals: tag, mode: "insensitive" } },
  });
  if (existing) return { error: `Alias "${tag}" already exists` };

  await prisma.kennelAlias.create({ data: { kennelId, alias: tag } });
  clearResolverCache();
  return { success: true };
}
