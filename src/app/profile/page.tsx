import { getOrCreateUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { redirect } from "next/navigation";
import { ProfileForm } from "@/components/profile/ProfileForm";
import { MyKennels } from "@/components/profile/MyKennels";
import { KennelConnections } from "@/components/profile/KennelConnections";
import { StravaConnectionCard } from "@/components/profile/StravaConnectionCard";
import { Separator } from "@/components/ui/separator";
import { getMyKennelLinks } from "./actions";
import { getStravaConnection } from "@/app/strava/actions";

export default async function ProfilePage() {
  const user = await getOrCreateUser();
  if (!user) redirect("/sign-in");

  const [subscriptions, linksResult, stravaResult] = await Promise.all([
    prisma.userKennel.findMany({
    where: { userId: user.id },
    include: {
      kennel: {
        select: { slug: true, shortName: true, fullName: true, region: true },
      },
    },
    orderBy: { createdAt: "desc" },
  }),
    getMyKennelLinks(),
    getStravaConnection(),
  ]);

  const kennelLinks = linksResult.data ?? [];
  const stravaConnection = stravaResult.success
    ? stravaResult
    : { connected: false as const };

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold">Profile</h1>
        <p className="mt-1 text-muted-foreground">
          Manage your hash identity
        </p>
      </div>

      <ProfileForm
        user={{
          email: user.email,
          hashName: user.hashName,
          nerdName: user.nerdName,
          bio: user.bio,
        }}
      />

      <Separator />

      <div>
        <h2 className="text-lg font-semibold">Strava</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Link your Strava account to auto-match activities
        </p>
        <div className="mt-3">
          <StravaConnectionCard connection={stravaConnection} />
        </div>
      </div>

      <Separator />

      <div>
        <h2 className="text-lg font-semibold">Kennel Connections</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Kennels where your profile is linked to their roster
        </p>
        <div className="mt-3">
          <KennelConnections links={kennelLinks} />
        </div>
      </div>

      <Separator />

      <div>
        <h2 className="text-lg font-semibold">My Kennels</h2>
        <div className="mt-3">
          <MyKennels kennels={subscriptions} />
        </div>
      </div>
    </div>
  );
}
