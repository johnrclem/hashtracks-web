"use server";

import { getOrCreateUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { revalidatePath } from "next/cache";

export async function subscribeToKennel(kennelId: string) {
  const user = await getOrCreateUser();
  if (!user) return { error: "Not authenticated" };

  // Check if already subscribed (handle race conditions gracefully)
  const existing = await prisma.userKennel.findUnique({
    where: { userId_kennelId: { userId: user.id, kennelId } },
  });
  if (existing) return { success: true };

  await prisma.userKennel.create({
    data: { userId: user.id, kennelId, role: "MEMBER" },
  });

  const { captureServerEvent } = await import("@/lib/analytics-server");
  captureServerEvent(user.id, "kennel_subscribe", { kennelId });

  revalidatePath("/kennels");
  revalidatePath("/profile");
  return { success: true };
}

export async function unsubscribeFromKennel(kennelId: string) {
  const user = await getOrCreateUser();
  if (!user) return { error: "Not authenticated" };

  await prisma.userKennel.deleteMany({
    where: { userId: user.id, kennelId },
  });

  const { captureServerEvent } = await import("@/lib/analytics-server");
  captureServerEvent(user.id, "kennel_unsubscribe", { kennelId });

  revalidatePath("/kennels");
  revalidatePath("/profile");
  return { success: true };
}
