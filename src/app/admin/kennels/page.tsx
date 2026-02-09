import { prisma } from "@/lib/db";
import { KennelTable } from "@/components/admin/KennelTable";
import { KennelForm } from "@/components/admin/KennelForm";
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
  }));

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-semibold">Manage Kennels</h2>
        <KennelForm
          trigger={<Button size="sm">Add Kennel</Button>}
        />
      </div>

      <KennelTable kennels={serialized} />
    </div>
  );
}
