"use server";

import { getOrCreateUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { redirect } from "next/navigation";

export async function submitKennelRequest(
  _prevState: { error?: string } | null,
  formData: FormData,
) {
  const user = await getOrCreateUser();
  if (!user) return { error: "Not authenticated" };

  const kennelName = (formData.get("kennelName") as string)?.trim();
  if (!kennelName) return { error: "Kennel name is required" };

  await prisma.kennelRequest.create({
    data: {
      userId: user.id,
      kennelName,
      region: (formData.get("region") as string)?.trim() || null,
      country: (formData.get("country") as string)?.trim() || null,
      sourceUrl: (formData.get("sourceUrl") as string)?.trim() || null,
      notes: (formData.get("notes") as string)?.trim() || null,
    },
  });

  redirect("/kennels?requested=true");
}
