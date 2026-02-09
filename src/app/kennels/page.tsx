import Link from "next/link";
import { prisma } from "@/lib/db";
import { KennelDirectory } from "@/components/kennels/KennelDirectory";
import { Button } from "@/components/ui/button";

export default async function KennelsPage() {
  const kennels = await prisma.kennel.findMany({
    orderBy: [{ region: "asc" }, { fullName: "asc" }],
    include: { _count: { select: { members: true } } },
  });

  return (
    <div>
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold">Kennel Directory</h1>
          <p className="mt-1 text-muted-foreground">
            Browse hashing kennels and subscribe to your home kennels.
          </p>
        </div>
        <Button variant="outline" size="sm" asChild>
          <Link href="/kennels/request">Request a Kennel</Link>
        </Button>
      </div>

      <KennelDirectory kennels={kennels} />
    </div>
  );
}
