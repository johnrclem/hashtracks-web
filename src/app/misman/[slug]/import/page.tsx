import { notFound } from "next/navigation";
import { getMismanUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { ImportWizard } from "@/components/misman/ImportWizard";

interface Props {
  params: Promise<{ slug: string }>;
}

export default async function ImportPage({ params }: Props) {
  const { slug } = await params;

  const kennel = await prisma.kennel.findUnique({
    where: { slug },
    select: { id: true, shortName: true },
  });
  if (!kennel) notFound();

  const user = await getMismanUser(kennel.id);
  if (!user) notFound();

  return (
    <ImportWizard
      kennelId={kennel.id}
      kennelShortName={kennel.shortName}
    />
  );
}
