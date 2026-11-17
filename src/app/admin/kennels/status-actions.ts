"use server";

import { getAdminUser } from "@/lib/auth";
import { revalidateKennel } from "@/lib/kennel-revalidate";
import {
  confirmKennelRunningFor,
  stopKennelFor,
  restartKennelFor,
  type StatusInput,
} from "@/lib/kennel-confirmations";

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
