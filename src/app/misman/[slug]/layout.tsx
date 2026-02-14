import { redirect, notFound } from "next/navigation";
import { getMismanUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { MismanKennelNav } from "@/components/misman/MismanKennelNav";
import { KennelSwitcher } from "@/components/misman/KennelSwitcher";

interface Props {
  children: React.ReactNode;
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const kennel = await prisma.kennel.findUnique({
    where: { slug },
    select: { shortName: true },
  });
  return { title: kennel ? `${kennel.shortName} Misman · HashTracks` : "Misman · HashTracks" };
}

export default async function MismanKennelLayout({ children, params }: Props) {
  const { slug } = await params;

  const kennel = await prisma.kennel.findUnique({
    where: { slug },
    select: { id: true, shortName: true, slug: true, fullName: true },
  });
  if (!kennel) notFound();

  const user = await getMismanUser(kennel.id);
  if (!user) redirect("/misman");

  // Fetch all kennels where this user has misman/admin access
  const mismanKennels = await prisma.userKennel.findMany({
    where: {
      userId: user.id,
      role: { in: ["MISMAN", "ADMIN"] },
    },
    include: {
      kennel: {
        select: { id: true, shortName: true, slug: true },
      },
    },
    orderBy: { kennel: { shortName: "asc" } },
  });

  const kennelOptions = mismanKennels.map((mk) => ({
    id: mk.kennel.id,
    shortName: mk.kennel.shortName,
    slug: mk.kennel.slug,
  }));

  return (
    <div className="space-y-4">
      <div>
        <KennelSwitcher
          currentKennel={{ shortName: kennel.shortName, slug: kennel.slug }}
          kennels={kennelOptions}
        />
        <p className="text-sm text-muted-foreground">{kennel.fullName}</p>
      </div>
      <MismanKennelNav slug={kennel.slug} />
      {children}
    </div>
  );
}
