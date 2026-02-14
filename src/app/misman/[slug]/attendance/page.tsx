import { notFound } from "next/navigation";
import { getMismanUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { AttendanceForm } from "@/components/misman/AttendanceForm";

interface Props {
  params: Promise<{ slug: string }>;
}

export default async function AttendancePage({ params }: Props) {
  const { slug } = await params;

  const kennel = await prisma.kennel.findUnique({
    where: { slug },
    select: { id: true, shortName: true, slug: true },
  });
  if (!kennel) notFound();

  const user = await getMismanUser(kennel.id);
  if (!user) notFound();

  // Get events for the last year for this kennel
  const oneYearAgo = new Date();
  oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);

  const events = await prisma.event.findMany({
    where: {
      kennelId: kennel.id,
      date: { gte: oneYearAgo },
    },
    select: {
      id: true,
      date: true,
      title: true,
      runNumber: true,
      kennelId: true,
      kennel: { select: { shortName: true } },
    },
    orderBy: { date: "desc" },
  });

  // Default to the event closest to today
  const now = Date.now();
  let closestEvent = events[0] ?? null;
  let closestDiff = closestEvent ? Math.abs(closestEvent.date.getTime() - now) : Infinity;
  for (const e of events) {
    const diff = Math.abs(e.date.getTime() - now);
    if (diff < closestDiff) {
      closestDiff = diff;
      closestEvent = e;
    }
  }

  const serializedEvents = events.map((e) => ({
    id: e.id,
    date: e.date.toISOString(),
    title: e.title,
    runNumber: e.runNumber,
    kennelShortName: e.kennel.shortName,
  }));

  return (
    <AttendanceForm
      events={serializedEvents}
      defaultEventId={closestEvent?.id ?? null}
      kennelId={kennel.id}
      kennelSlug={kennel.slug}
      kennelShortName={kennel.shortName}
    />
  );
}
