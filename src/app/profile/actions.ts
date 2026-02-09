"use server";

import { getOrCreateUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { revalidatePath } from "next/cache";

export async function updateProfile(
  _prevState: { success?: boolean; error?: string } | null,
  formData: FormData,
) {
  const user = await getOrCreateUser();
  if (!user) return { error: "Not authenticated" };

  const hashName = formData.get("hashName") as string | null;
  const nerdName = formData.get("nerdName") as string | null;
  const bio = formData.get("bio") as string | null;

  await prisma.user.update({
    where: { id: user.id },
    data: {
      hashName: hashName?.trim() || null,
      nerdName: nerdName?.trim() || null,
      bio: bio?.trim() || null,
    },
  });

  revalidatePath("/profile");
  return { success: true };
}
