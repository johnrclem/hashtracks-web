"use server";

import { getMismanUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { safeUrl } from "@/lib/safe-url";
import type { ActionResult } from "@/lib/actions";
import { revalidatePath } from "next/cache";

/** Update editable profile fields for a kennel. Requires misman or admin role. */
export async function updateKennelSettings(
  kennelId: string,
  formData: FormData,
): Promise<ActionResult> {
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
  const currentYear = new Date().getFullYear();
  const intInRange = (name: string, min: number, max: number) => {
    const val = (formData.get(name) as string | null)?.trim();
    if (!val) return null;
    const n = parseInt(val, 10);
    if (isNaN(n) || n < min || n > max) return null;
    return n;
  };

  try {
    await prisma.kennel.update({
      where: { id: kennelId },
      data: {
        // Text fields
        description: str("description"),
        scheduleDayOfWeek: str("scheduleDayOfWeek"),
        scheduleTime: str("scheduleTime"),
        scheduleFrequency: str("scheduleFrequency"),
        scheduleNotes: str("scheduleNotes"),
        instagramHandle: str("instagramHandle"),
        twitterHandle: str("twitterHandle"),
        contactEmail: str("contactEmail"),
        contactName: str("contactName"),
        hashCash: str("hashCash"),
        // URL fields — protocol-validated to prevent stored XSS
        website: safeUrl(formData.get("website") as string),
        facebookUrl: safeUrl(formData.get("facebookUrl") as string),
        discordUrl: safeUrl(formData.get("discordUrl") as string),
        mailingListUrl: safeUrl(formData.get("mailingListUrl") as string),
        paymentLink: safeUrl(formData.get("paymentLink") as string),
        logoUrl: safeUrl(formData.get("logoUrl") as string),
        // Typed fields
        foundedYear: intInRange("foundedYear", 1938, currentYear),
        dogFriendly: triState("dogFriendly"),
        walkersWelcome: triState("walkersWelcome"),
      },
    });
  } catch {
    return { error: "Unable to update kennel settings" };
  }

  revalidatePath(`/kennels/${kennel.slug}`);
  revalidatePath(`/misman/${kennel.slug}/settings`);
  revalidatePath("/kennels");
  return { success: true };
}
