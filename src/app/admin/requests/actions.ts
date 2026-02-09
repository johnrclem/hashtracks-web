"use server";

import { getAdminUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { revalidatePath } from "next/cache";

export async function approveRequest(requestId: string) {
  const admin = await getAdminUser();
  if (!admin) return { error: "Not authorized" };

  await prisma.kennelRequest.update({
    where: { id: requestId },
    data: { status: "APPROVED", resolvedAt: new Date() },
  });

  revalidatePath("/admin/requests");
  return { success: true };
}

export async function rejectRequest(requestId: string) {
  const admin = await getAdminUser();
  if (!admin) return { error: "Not authorized" };

  await prisma.kennelRequest.update({
    where: { id: requestId },
    data: { status: "REJECTED", resolvedAt: new Date() },
  });

  revalidatePath("/admin/requests");
  return { success: true };
}
