import { fetchKennelsAndRegions } from "../queries";
import { SourceOnboardingWizard } from "@/components/admin/SourceOnboardingWizard";

export default async function NewSourcePage() {
  const geminiAvailable = !!process.env.GEMINI_API_KEY;

  const { allKennels, allRegions } = await fetchKennelsAndRegions();

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
