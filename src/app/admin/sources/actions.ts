"use server";

import { getAdminUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { revalidatePath } from "next/cache";

export async function createSource(formData: FormData) {
  const admin = await getAdminUser();
  if (!admin) return { error: "Not authorized" };

  const name = (formData.get("name") as string)?.trim();
  const url = (formData.get("url") as string)?.trim();
  const type = (formData.get("type") as string)?.trim();
  const trustLevel = parseInt(
    (formData.get("trustLevel") as string) || "5",
    10,
  );
  const scrapeFreq = (formData.get("scrapeFreq") as string)?.trim() || "daily";
  const kennelIds = (formData.get("kennelIds") as string)?.trim() || "";

  if (!name || !url || !type) {
    return { error: "Name, URL, and type are required" };
  }

  const source = await prisma.source.create({
    data: {
      name,
      url,
      type: type as "HTML_SCRAPER" | "GOOGLE_CALENDAR" | "GOOGLE_SHEETS" | "ICAL_FEED" | "RSS_FEED" | "JSON_API" | "MANUAL",
      trustLevel,
      scrapeFreq,
    },
  });

  // Create SourceKennel links
  const ids = kennelIds
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
  for (const kennelId of ids) {
    await prisma.sourceKennel.create({
      data: { sourceId: source.id, kennelId },
    });
  }

  revalidatePath("/admin/sources");
  return { success: true };
}

export async function updateSource(sourceId: string, formData: FormData) {
  const admin = await getAdminUser();
  if (!admin) return { error: "Not authorized" };

  const name = (formData.get("name") as string)?.trim();
  const url = (formData.get("url") as string)?.trim();
  const type = (formData.get("type") as string)?.trim();
  const trustLevel = parseInt(
    (formData.get("trustLevel") as string) || "5",
    10,
  );
  const scrapeFreq = (formData.get("scrapeFreq") as string)?.trim() || "daily";
  const kennelIds = (formData.get("kennelIds") as string)?.trim() || "";

  if (!name || !url || !type) {
    return { error: "Name, URL, and type are required" };
  }

  const ids = kennelIds
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);

  await prisma.$transaction([
    prisma.sourceKennel.deleteMany({ where: { sourceId } }),
    prisma.source.update({
      where: { id: sourceId },
      data: {
        name,
        url,
        type: type as "HTML_SCRAPER" | "GOOGLE_CALENDAR" | "GOOGLE_SHEETS" | "ICAL_FEED" | "RSS_FEED" | "JSON_API" | "MANUAL",
        trustLevel,
        scrapeFreq,
        kennels: {
          create: ids.map((kennelId) => ({ kennelId })),
        },
      },
    }),
  ]);

  revalidatePath("/admin/sources");
  return { success: true };
}

export async function deleteSource(sourceId: string) {
  const admin = await getAdminUser();
  if (!admin) return { error: "Not authorized" };

  // Check for raw events
  const rawEventCount = await prisma.rawEvent.count({
    where: { sourceId },
  });

  if (rawEventCount > 0) {
    return {
      error: `Cannot delete: source has ${rawEventCount} raw event(s). Remove them first.`,
    };
  }

  await prisma.$transaction([
    prisma.sourceKennel.deleteMany({ where: { sourceId } }),
    prisma.source.delete({ where: { id: sourceId } }),
  ]);

  revalidatePath("/admin/sources");
  return { success: true };
}
