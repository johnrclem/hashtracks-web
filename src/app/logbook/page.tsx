import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";
import { getOrCreateUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { LogbookList } from "@/components/logbook/LogbookList";

export const metadata: Metadata = {
  title: "My Logbook · HashTracks",
};

export default async function LogbookPage() {
  const user = await getOrCreateUser();
  if (!user) redirect("/sign-in");

  const attendances = await prisma.attendance.findMany({
    where: { userId: user.id },
    include: {
      event: {
        include: {
          kennel: {
            select: { id: true, shortName: true, fullName: true, slug: true, region: true },
          },
        },
      },
    },
    orderBy: { event: { date: "desc" } },
  });

  const entries = attendances.map((a) => ({
    attendance: {
      id: a.id,
      participationLevel: a.participationLevel as string,
      stravaUrl: a.stravaUrl,
      notes: a.notes,
    },
    event: {
      id: a.event.id,
      date: a.event.date.toISOString(),
      runNumber: a.event.runNumber,
      title: a.event.title,
      startTime: a.event.startTime,
      kennel: a.event.kennel,
    },
  }));

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">My Logbook</h1>
          <p className="mt-1 text-muted-foreground">
            {entries.length} {entries.length === 1 ? "run" : "runs"} logged
          </p>
        </div>
        <Link
          href="/logbook/stats"
          className="text-sm text-primary hover:underline"
        >
          View Stats
        </Link>
      </div>

      <div className="mt-6">
        <LogbookList entries={entries} />
      </div>
    </div>
  );
}
