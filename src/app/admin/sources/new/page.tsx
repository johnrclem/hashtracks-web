import { prisma } from "@/lib/db";
import { SourceOnboardingWizard } from "@/components/admin/SourceOnboardingWizard";

export default async function NewSourcePage() {
  const geminiAvailable = !!process.env.GEMINI_API_KEY;

  const allKennels = await prisma.kennel.findMany({
    orderBy: { shortName: "asc" },
    select: { id: true, shortName: true, fullName: true, region: true },
  });

  return (
    <div>
      <SourceOnboardingWizard
        allKennels={allKennels}
        geminiAvailable={geminiAvailable}
      />
    </div>
  );
}
