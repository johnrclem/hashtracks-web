"use server";

import { prisma } from "@/lib/db";
import { getAdminUser } from "@/lib/auth";
import { revalidatePath } from "next/cache";

export async function acknowledgeAlert(alertId: string) {
  const admin = await getAdminUser();
  if (!admin) return { error: "Unauthorized" };

  const alert = await prisma.alert.findUnique({ where: { id: alertId } });
  if (!alert) return { error: "Alert not found" };
  if (alert.status !== "OPEN") return { error: "Alert is not open" };

  await prisma.alert.update({
    where: { id: alertId },
    data: { status: "ACKNOWLEDGED" },
  });

  revalidatePath("/admin/alerts");
  revalidatePath(`/admin/sources/${alert.sourceId}`);
  return { success: true };
}

export async function snoozeAlert(alertId: string, hours: number) {
  const admin = await getAdminUser();
  if (!admin) return { error: "Unauthorized" };

  const alert = await prisma.alert.findUnique({ where: { id: alertId } });
  if (!alert) return { error: "Alert not found" };
  if (alert.status === "RESOLVED") return { error: "Alert is already resolved" };

  const snoozedUntil = new Date(Date.now() + hours * 60 * 60 * 1000);

  await prisma.alert.update({
    where: { id: alertId },
    data: { status: "SNOOZED", snoozedUntil },
  });

  revalidatePath("/admin/alerts");
  revalidatePath(`/admin/sources/${alert.sourceId}`);
  return { success: true };
}

export async function resolveAlert(alertId: string) {
  const admin = await getAdminUser();
  if (!admin) return { error: "Unauthorized" };

  const alert = await prisma.alert.findUnique({ where: { id: alertId } });
  if (!alert) return { error: "Alert not found" };
  if (alert.status === "RESOLVED") return { error: "Alert is already resolved" };

  await prisma.alert.update({
    where: { id: alertId },
    data: {
      status: "RESOLVED",
      resolvedAt: new Date(),
      resolvedBy: admin.id,
    },
  });

  revalidatePath("/admin/alerts");
  revalidatePath(`/admin/sources/${alert.sourceId}`);
  return { success: true };
}

export async function resolveAllForSource(sourceId: string) {
  const admin = await getAdminUser();
  if (!admin) return { error: "Unauthorized" };

  await prisma.alert.updateMany({
    where: {
      sourceId,
      status: { in: ["OPEN", "ACKNOWLEDGED"] },
    },
    data: {
      status: "RESOLVED",
      resolvedAt: new Date(),
      resolvedBy: admin.id,
    },
  });

  revalidatePath("/admin/alerts");
  revalidatePath(`/admin/sources/${sourceId}`);
  return { success: true };
}
