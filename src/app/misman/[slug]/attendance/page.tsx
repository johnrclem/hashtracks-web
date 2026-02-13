import { notFound } from "next/navigation";
import { getMismanUser, getRosterKennelIds } from "@/lib/auth";
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

  const rosterKennelIds = await getRosterKennelIds(kennel.id);

  // Get events for the last year for this kennel
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

  // Find today's event (if any) to default to
  const today = new Date();
  today.setUTCHours(12, 0, 0, 0);
  const todayStr = today.toISOString().split("T")[0];

  const todayEvent = events.find(
    (e) => e.date.toISOString().split("T")[0] === todayStr,
  );

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
      defaultEventId={todayEvent?.id ?? events[0]?.id ?? null}
      kennelId={kennel.id}
      kennelSlug={kennel.slug}
      kennelShortName={kennel.shortName}
    />
  );
}
