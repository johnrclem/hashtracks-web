import { getOrCreateUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { redirect } from "next/navigation";
import { ProfileForm } from "@/components/profile/ProfileForm";
import { MyKennels } from "@/components/profile/MyKennels";
import { Separator } from "@/components/ui/separator";

export default async function ProfilePage() {
  const user = await getOrCreateUser();
  if (!user) redirect("/sign-in");

  const subscriptions = await prisma.userKennel.findMany({
    where: { userId: user.id },
    include: {
      kennel: {
        select: { slug: true, shortName: true, fullName: true, region: true },
      },
    },
    orderBy: { createdAt: "desc" },
  });

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
        <h2 className="text-lg font-semibold">My Kennels</h2>
        <div className="mt-3">
          <MyKennels kennels={subscriptions} />
        </div>
      </div>
    </div>
  );
}
