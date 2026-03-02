import { prisma } from "@/lib/db";
import { SourceOnboardingWizard } from "@/components/admin/SourceOnboardingWizard";

export default async function NewSourcePage() {
  const geminiAvailable = !!process.env.GEMINI_API_KEY;

  const [allKennels, allRegions] = await Promise.all([
    prisma.kennel.findMany({
      orderBy: { shortName: "asc" },
      select: { id: true, shortName: true, fullName: true, region: true },
    }),
    prisma.region.findMany({
      orderBy: [{ country: "asc" }, { name: "asc" }],
      select: { id: true, name: true, country: true, abbrev: true },
    }),
  ]);

  return (
    <div>
      <SourceOnboardingWizard
        allKennels={allKennels}
        allRegions={allRegions}
        geminiAvailable={geminiAvailable}
      />
    </div>
  );
}
