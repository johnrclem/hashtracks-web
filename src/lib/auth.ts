import { currentUser } from "@clerk/nextjs/server";
import { prisma } from "@/lib/db";
import type { User } from "@/generated/prisma/client";

export async function getOrCreateUser(): Promise<User | null> {
  const clerkUser = await currentUser();
  if (!clerkUser) return null;

  const existingUser = await prisma.user.findUnique({
    where: { clerkId: clerkUser.id },
  });

  if (existingUser) return existingUser;

  // First sign-in: create User record
  return prisma.user.create({
    data: {
      clerkId: clerkUser.id,
      email: clerkUser.emailAddresses[0]?.emailAddress ?? "",
      hashName: null,
      nerdName: clerkUser.firstName
        ? `${clerkUser.firstName} ${clerkUser.lastName ?? ""}`.trim()
        : null,
    },
  });
}
