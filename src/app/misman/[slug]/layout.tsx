import { redirect, notFound } from "next/navigation";
import { getMismanUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { MismanKennelNav } from "@/components/misman/MismanKennelNav";

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

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">{kennel.shortName}</h1>
        <p className="text-sm text-muted-foreground">{kennel.fullName}</p>
      </div>
      <MismanKennelNav slug={kennel.slug} />
      {children}
    </div>
  );
}
