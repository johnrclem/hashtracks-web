"use server";

import { revalidatePath, revalidateTag } from "next/cache";
import { getAdminUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { HARELINE_EVENTS_TAG } from "@/lib/cache-tags";
import { regionNameToSlug, regionSlug } from "@/lib/region";
import {
  confirmKennelRunningFor,
  stopKennelFor,
  restartKennelFor,
  type StatusInput,
} from "@/lib/kennel-confirmations";

async function revalidateKennel(kennelId: string) {
  const kennel = await prisma.kennel.findUnique({
    where: { id: kennelId },
    select: { slug: true, region: true },
  });
  revalidatePath("/admin/kennels");
  revalidatePath("/admin/sources");
  revalidatePath("/kennels");
  if (kennel) {
    revalidatePath(`/kennels/${kennel.slug}`);
    if (kennel.region) revalidatePath(`/kennels/region/${regionNameToSlug(kennel.region) ?? regionSlug(kennel.region)}`);
  }
  revalidatePath("/hareline");
  // Stopping hides a kennel's schedule-only runs from the cached hareline list.
  revalidateTag(HARELINE_EVENTS_TAG, { expire: 0 });
}

function audit(action: string, adminId: string, kennelId: string, extra: object = {}) {
  console.log("[admin-audit]", action, JSON.stringify({
    adminId,
    action,
    kennelId,
    ...extra,
    timestamp: new Date().toISOString(),
  }));
}

export async function confirmKennelRunning(kennelId: string, input: StatusInput) {
  const admin = await getAdminUser();
  if (!admin) return { error: "Not authorized" } as const;
  const result = await confirmKennelRunningFor(admin.id, kennelId, input);
  if ("error" in result) return result;
  audit("confirm_kennel_running", admin.id, kennelId, { observedOn: input.observedOn });
  await revalidateKennel(kennelId);
  return result;
}

export async function stopKennel(kennelId: string, input: StatusInput) {
  const admin = await getAdminUser();
  if (!admin) return { error: "Not authorized" } as const;
  const result = await stopKennelFor(admin.id, kennelId, input);
  if ("error" in result) return result;
  audit("stop_kennel", admin.id, kennelId, {
    observedOn: input.observedOn,
    disabledSources: result.disabledSources,
    deactivatedRules: result.deactivatedRules,
  });
  await revalidateKennel(kennelId);
  return result;
}

export async function restartKennel(kennelId: string) {
  const admin = await getAdminUser();
  if (!admin) return { error: "Not authorized" } as const;
  const result = await restartKennelFor(kennelId);
  if ("error" in result) return result;
  audit("restart_kennel", admin.id, kennelId, {
    enabledSources: result.enabledSources,
    reactivatedRules: result.reactivatedRules,
  });
  await revalidateKennel(kennelId);
  return result;
}
