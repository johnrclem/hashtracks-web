import { notFound } from "next/navigation";
import { getMismanUser, getRosterKennelIds } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { RosterTable } from "@/components/misman/RosterTable";
import { SeedRosterButton } from "@/components/misman/SeedRosterButton";

interface Props {
  params: Promise<{ slug: string }>;
}

export default async function RosterPage({ params }: Props) {
  const { slug } = await params;

  const kennel = await prisma.kennel.findUnique({
    where: { slug },
    select: { id: true, shortName: true },
  });
  if (!kennel) notFound();

  const user = await getMismanUser(kennel.id);
  if (!user) notFound();

  const rosterKennelIds = await getRosterKennelIds(kennel.id);

  const hashers = await prisma.kennelHasher.findMany({
    where: { kennelId: { in: rosterKennelIds } },
    include: {
      _count: { select: { attendances: true } },
      kennel: { select: { shortName: true } },
    },
    orderBy: [{ hashName: "asc" }, { nerdName: "asc" }],
  });

  const serialized = hashers.map((h) => ({
    id: h.id,
    kennelId: h.kennelId,
    kennelShortName: h.kennel.shortName,
    hashName: h.hashName,
    nerdName: h.nerdName,
    email: h.email,
    phone: h.phone,
    notes: h.notes,
    attendanceCount: h._count.attendances,
  }));

  const isSharedRoster = rosterKennelIds.length > 1;

  return (
    <div className="space-y-4">
      <RosterTable
        hashers={serialized}
        kennelId={kennel.id}
        kennelSlug={slug}
        isSharedRoster={isSharedRoster}
      />
      {hashers.length === 0 && (
        <div className="flex justify-center">
          <SeedRosterButton kennelId={kennel.id} />
        </div>
      )}
    </div>
  );
}
