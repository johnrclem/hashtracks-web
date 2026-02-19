import { prisma } from "@/lib/db";
import { KennelTable } from "@/components/admin/KennelTable";
import { KennelForm } from "@/components/admin/KennelForm";
import { KennelMergeDialog } from "@/components/admin/KennelMergeDialog";
import { Button } from "@/components/ui/button";

export default async function AdminKennelsPage() {
  const kennels = await prisma.kennel.findMany({
    orderBy: [{ region: "asc" }, { shortName: "asc" }],
    include: {
      aliases: { select: { alias: true } },
      _count: { select: { members: true, aliases: true } },
    },
  });

  const serialized = kennels.map((k) => ({
    id: k.id,
    shortName: k.shortName,
    fullName: k.fullName,
    region: k.region,
    country: k.country,
    description: k.description,
    website: k.website,
    aliases: k.aliases.map((a) => a.alias),
    _count: k._count,
    // Profile fields
    scheduleDayOfWeek: k.scheduleDayOfWeek,
    scheduleTime: k.scheduleTime,
    scheduleFrequency: k.scheduleFrequency,
    scheduleNotes: k.scheduleNotes,
    facebookUrl: k.facebookUrl,
    instagramHandle: k.instagramHandle,
    twitterHandle: k.twitterHandle,
    discordUrl: k.discordUrl,
    mailingListUrl: k.mailingListUrl,
    contactEmail: k.contactEmail,
    contactName: k.contactName,
    hashCash: k.hashCash,
    paymentLink: k.paymentLink,
    foundedYear: k.foundedYear,
    logoUrl: k.logoUrl,
    dogFriendly: k.dogFriendly,
    walkersWelcome: k.walkersWelcome,
  }));

  // Simplified kennel list for merge dialog
  const kennelsForMerge = kennels.map((k) => ({
    id: k.id,
    shortName: k.shortName,
    fullName: k.fullName,
    region: k.region,
    slug: k.slug,
  }));

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-semibold">Manage Kennels</h2>
        <div className="flex items-center gap-2">
          <KennelMergeDialog
            kennels={kennelsForMerge}
            trigger={<Button size="sm" variant="outline">Merge Kennels</Button>}
          />
          <KennelForm
            trigger={<Button size="sm">Add Kennel</Button>}
          />
        </div>
      </div>

      <KennelTable kennels={serialized} />
    </div>
  );
}
