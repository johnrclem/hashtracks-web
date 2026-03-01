import { notFound, redirect } from "next/navigation";
import { getMismanUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { KennelSettingsForm } from "@/components/misman/KennelSettingsForm";

interface Props {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: Props) {
  const { slug } = await params;
  const kennel = await prisma.kennel.findUnique({
    where: { slug },
    select: { shortName: true },
  });
  return { title: kennel ? `${kennel.shortName} Settings · HashTracks` : "Settings · HashTracks" };
}

export default async function SettingsPage({ params }: Props) {
  const { slug } = await params;

  const kennel = await prisma.kennel.findUnique({
    where: { slug },
    select: {
      id: true,
      shortName: true,
      slug: true,
      description: true,
      website: true,
      scheduleDayOfWeek: true,
      scheduleTime: true,
      scheduleFrequency: true,
      scheduleNotes: true,
      facebookUrl: true,
      instagramHandle: true,
      twitterHandle: true,
      discordUrl: true,
      mailingListUrl: true,
      contactEmail: true,
      contactName: true,
      hashCash: true,
      paymentLink: true,
      foundedYear: true,
      logoUrl: true,
      dogFriendly: true,
      walkersWelcome: true,
    },
  });
  if (!kennel) notFound();

  const user = await getMismanUser(kennel.id);
  if (!user) redirect("/misman");

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h2 className="text-lg font-semibold">Kennel Profile</h2>
        <p className="text-sm text-muted-foreground">
          Edit public profile information for {kennel.shortName}. To change the kennel name or
          region, contact an admin.
        </p>
      </div>
      <KennelSettingsForm kennel={kennel} currentYear={new Date().getUTCFullYear()} />
    </div>
  );
}
