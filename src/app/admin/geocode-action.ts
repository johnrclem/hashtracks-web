"use server";

import { getAdminUser } from "@/lib/auth";
import { geocodeAddress } from "@/lib/geo";

export async function geocodeAction(
  address: string,
): Promise<{ lat: number; lng: number } | null> {
  const admin = await getAdminUser();
  if (!admin) throw new Error("Unauthorized");
  return geocodeAddress(address);
}
