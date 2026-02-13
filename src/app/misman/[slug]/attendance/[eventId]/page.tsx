import { notFound } from "next/navigation";
import { getMismanUser, getRosterKennelIds } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { AttendanceForm } from "@/components/misman/AttendanceForm";

interface Props {
  params: Promise<{ slug: string; eventId: string }>;
}

export default async function EventAttendancePage({ params }: Props) {
  const { slug, eventId } = await params;

  const kennel = await prisma.kennel.findUnique({
    where: { slug },
    select: { id: true, shortName: true, slug: true },
  });
  if (!kennel) notFound();

  const user = await getMismanUser(kennel.id);
  if (!user) notFound();

  // Verify the event exists and belongs to roster scope
  const rosterKennelIds = await getRosterKennelIds(kennel.id);
  const event = await prisma.event.findUnique({
    where: { id: eventId },
    select: { id: true, kennelId: true },
  });
  if (!event || !rosterKennelIds.includes(event.kennelId)) notFound();

  const oneYearAgo = new Date();
  oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);

  const events = await prisma.event.findMany({
    where: {
      kennelId: { in: rosterKennelIds },
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
      defaultEventId={eventId}
      kennelId={kennel.id}
      kennelSlug={kennel.slug}
      kennelShortName={kennel.shortName}
    />
  );
}
