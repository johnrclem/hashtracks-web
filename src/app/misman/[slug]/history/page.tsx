import { notFound } from "next/navigation";
import { getMismanUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { HistoryList } from "@/components/misman/HistoryList";

interface Props {
  params: Promise<{ slug: string }>;
}

const PAGE_SIZE = 25;

export default async function HistoryPage({ params }: Props) {
  const { slug } = await params;

  const kennel = await prisma.kennel.findUnique({
    where: { slug },
    select: { id: true, shortName: true },
  });
  if (!kennel) notFound();

  const user = await getMismanUser(kennel.id);
  if (!user) notFound();

  const where = {
    kennelAttendances: { some: {} },
    kennelId: kennel.id,
  };

  const [events, total] = await Promise.all([
    prisma.event.findMany({
      where,
      include: {
        kennel: { select: { shortName: true } },
        kennelAttendances: {
          include: {
            kennelHasher: {
              select: { hashName: true, nerdName: true },
            },
          },
          orderBy: { createdAt: "asc" },
        },
      },
      orderBy: { date: "desc" },
      take: PAGE_SIZE,
    }),
    prisma.event.count({ where }),
  ]);

  const serialized = events.map((e) => ({
    id: e.id,
    date: e.date.toISOString(),
    title: e.title,
    runNumber: e.runNumber,
    kennelShortName: e.kennel.shortName,
    attendeeCount: e.kennelAttendances.length,
    paidCount: e.kennelAttendances.filter((a) => a.paid).length,
    hareCount: e.kennelAttendances.filter((a) => a.haredThisTrail).length,
    virginCount: e.kennelAttendances.filter((a) => a.isVirgin).length,
    visitorCount: e.kennelAttendances.filter((a) => a.isVisitor).length,
    attendees: e.kennelAttendances.map((a) => ({
      id: a.id,
      hashName: a.kennelHasher.hashName,
      nerdName: a.kennelHasher.nerdName,
      paid: a.paid,
      haredThisTrail: a.haredThisTrail,
      isVirgin: a.isVirgin,
      isVisitor: a.isVisitor,
    })),
  }));

  return (
    <HistoryList
      initialEvents={serialized}
      initialTotal={total}
      initialPage={1}
      pageSize={PAGE_SIZE}
      totalPages={Math.ceil(total / PAGE_SIZE)}
      kennelId={kennel.id}
    />
  );
}
