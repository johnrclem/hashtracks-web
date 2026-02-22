import { notFound } from "next/navigation";
import { getMismanUser, getRosterGroupId, getRosterKennelIds } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { RosterTable } from "@/components/misman/RosterTable";
import { SeedRosterButton } from "@/components/misman/SeedRosterButton";
import { DuplicateScanResults } from "@/components/misman/DuplicateScanResults";
import { RosterGroupBanner } from "@/components/misman/RosterGroupBanner";
import { RosterGroupChangeRequest } from "@/components/misman/RosterGroupChangeRequest";
import { RequestSharedRosterSection } from "@/components/misman/RequestSharedRosterSection";

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

  const rosterGroupId = await getRosterGroupId(kennel.id);
  const rosterKennelIds = await getRosterKennelIds(kennel.id);

  const hashers = await prisma.kennelHasher.findMany({
    where: { rosterGroupId },
    include: {
      _count: { select: { attendances: true } },
      kennel: { select: { shortName: true } },
      userLink: { select: { status: true } },
    },
    orderBy: [{ hashName: "asc" }, { nerdName: "asc" }],
  });

  const serialized = hashers.map((h) => ({
    id: h.id,
    kennelId: h.kennelId,
    kennelShortName: h.kennel?.shortName ?? null,
    hashName: h.hashName,
    nerdName: h.nerdName,
    email: h.email,
    phone: h.phone,
    notes: h.notes,
    attendanceCount: h._count.attendances,
    linkStatus: h.userLink?.status ?? null,
  }));

  const isSharedRoster = rosterKennelIds.length > 1;

  // Fetch roster group details for the banner when shared
  let rosterGroupInfo: { name: string; kennelNames: string[] } | null = null;
  if (isSharedRoster) {
    const group = await prisma.rosterGroup.findUnique({
      where: { id: rosterGroupId },
      select: {
        name: true,
        kennels: {
          select: { kennel: { select: { shortName: true } } },
          orderBy: { kennel: { shortName: "asc" } },
        },
      },
    });
    if (group) {
      rosterGroupInfo = {
        name: group.name,
        kennelNames: group.kennels.map((k) => k.kennel.shortName),
      };
    }
  }

  // For non-shared rosters, check for pending roster group requests
  let hasPendingRosterGroupRequest = false;
  if (!isSharedRoster) {
    const pendingReq = await prisma.rosterGroupRequest.findFirst({
      where: { userId: user.id, status: "PENDING" },
    });
    hasPendingRosterGroupRequest = !!pendingReq;
  }

  return (
    <div className="space-y-4">
      {rosterGroupInfo && (
        <div className="flex items-start justify-between gap-2">
          <RosterGroupBanner
            groupName={rosterGroupInfo.name}
            kennelNames={rosterGroupInfo.kennelNames}
          />
          <RosterGroupChangeRequest
            rosterGroupId={rosterGroupId}
            groupName={rosterGroupInfo.name}
            kennelId={kennel.id}
          />
        </div>
      )}
      {!isSharedRoster && (
        <RequestSharedRosterSection
          kennelShortName={kennel.shortName}
          kennelId={kennel.id}
          hasPendingRequest={hasPendingRosterGroupRequest}
        />
      )}
      <RosterTable
        hashers={serialized}
        kennelId={kennel.id}
        kennelSlug={slug}
        isSharedRoster={isSharedRoster}
      />
      {hashers.length > 1 && (
        <DuplicateScanResults kennelId={kennel.id} kennelSlug={slug} />
      )}
      {hashers.length === 0 && (
        <div className="flex justify-center">
          <SeedRosterButton kennelId={kennel.id} />
        </div>
      )}
    </div>
  );
}
