"use server";

import { getMismanUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { revalidatePath } from "next/cache";

export async function updateKennelSettings(kennelId: string, formData: FormData) {
  const user = await getMismanUser(kennelId);
  if (!user) return { error: "Not authorized" };

  const kennel = await prisma.kennel.findUnique({
    where: { id: kennelId },
    select: { slug: true },
  });
  if (!kennel) return { error: "Kennel not found" };

  const str = (name: string) => {
    const val = (formData.get(name) as string | null)?.trim();
    return val || null;
  };
  const triState = (name: string) => {
    const val = (formData.get(name) as string | null)?.trim();
    if (val === "true") return true;
    if (val === "false") return false;
    return null;
  };
  const int = (name: string) => {
    const val = (formData.get(name) as string | null)?.trim();
    if (!val) return null;
    const n = parseInt(val, 10);
    return isNaN(n) ? null : n;
  };

  await prisma.kennel.update({
    where: { id: kennelId },
    data: {
      description: str("description"),
      website: str("website"),
      scheduleDayOfWeek: str("scheduleDayOfWeek"),
      scheduleTime: str("scheduleTime"),
      scheduleFrequency: str("scheduleFrequency"),
      scheduleNotes: str("scheduleNotes"),
      facebookUrl: str("facebookUrl"),
      instagramHandle: str("instagramHandle"),
      twitterHandle: str("twitterHandle"),
      discordUrl: str("discordUrl"),
      mailingListUrl: str("mailingListUrl"),
      contactEmail: str("contactEmail"),
      contactName: str("contactName"),
      hashCash: str("hashCash"),
      paymentLink: str("paymentLink"),
      foundedYear: int("foundedYear"),
      logoUrl: str("logoUrl"),
      dogFriendly: triState("dogFriendly"),
      walkersWelcome: triState("walkersWelcome"),
    },
  });

  revalidatePath(`/kennels/${kennel.slug}`);
  revalidatePath(`/misman/${kennel.slug}/settings`);
  return { success: true as const };
}
