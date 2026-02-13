import { notFound } from "next/navigation";
import { getMismanUser, getRosterKennelIds } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { HasherDetail } from "@/components/misman/HasherDetail";

interface Props {
  params: Promise<{ slug: string; hasherId: string }>;
}

export default async function HasherDetailPage({ params }: Props) {
  const { slug, hasherId } = await params;

  const kennel = await prisma.kennel.findUnique({
    where: { slug },
    select: { id: true, shortName: true },
  });
  if (!kennel) notFound();

  const user = await getMismanUser(kennel.id);
  if (!user) notFound();

  const rosterKennelIds = await getRosterKennelIds(kennel.id);

  const hasher = await prisma.kennelHasher.findUnique({
    where: { id: hasherId },
    include: {
      kennel: { select: { shortName: true } },
      userLink: {
        include: {
          user: { select: { hashName: true, email: true } },
        },
      },
      attendances: {
        include: {
          event: {
            select: {
              id: true,
              date: true,
              title: true,
              runNumber: true,
              kennel: { select: { shortName: true } },
            },
          },
        },
        orderBy: { event: { date: "desc" } },
      },
    },
  });

  if (!hasher) notFound();
  if (!rosterKennelIds.includes(hasher.kennelId)) notFound();

  const totalRuns = hasher.attendances.length;
  const hareCount = hasher.attendances.filter((a) => a.haredThisTrail).length;
  const paidCount = hasher.attendances.filter((a) => a.paid).length;
  const firstRun =
    totalRuns > 0 ? hasher.attendances[totalRuns - 1].event.date : null;
  const lastRun = totalRuns > 0 ? hasher.attendances[0].event.date : null;

  const serialized = {
    id: hasher.id,
    kennelId: hasher.kennelId,
    kennelShortName: hasher.kennel.shortName,
    hashName: hasher.hashName,
    nerdName: hasher.nerdName,
    email: hasher.email,
    phone: hasher.phone,
    notes: hasher.notes,
    createdAt: hasher.createdAt.toISOString(),
    userLink: hasher.userLink
      ? {
          status: hasher.userLink.status,
          userHashName: hasher.userLink.user.hashName,
          userEmail: hasher.userLink.user.email,
        }
      : null,
    stats: {
      totalRuns,
      hareCount,
      paidCount,
      firstRun: firstRun?.toISOString() ?? null,
      lastRun: lastRun?.toISOString() ?? null,
    },
    attendances: hasher.attendances.map((a) => ({
      id: a.id,
      eventId: a.event.id,
      date: a.event.date.toISOString(),
      title: a.event.title,
      runNumber: a.event.runNumber,
      kennelShortName: a.event.kennel.shortName,
      paid: a.paid,
      haredThisTrail: a.haredThisTrail,
      isVirgin: a.isVirgin,
      isVisitor: a.isVisitor,
      createdAt: a.createdAt.toISOString(),
    })),
  };

  return <HasherDetail hasher={serialized} kennelSlug={slug} />;
}
