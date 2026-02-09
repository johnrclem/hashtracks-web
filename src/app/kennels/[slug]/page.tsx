import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { getOrCreateUser } from "@/lib/auth";
import { Badge } from "@/components/ui/badge";
import { SubscribeButton } from "@/components/kennels/SubscribeButton";

export default async function KennelDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  const kennel = await prisma.kennel.findUnique({
    where: { slug },
    include: {
      aliases: { select: { alias: true }, orderBy: { alias: "asc" } },
      _count: { select: { members: true } },
    },
  });

  if (!kennel) notFound();

  const user = await getOrCreateUser();
  let isSubscribed = false;
  if (user) {
    const subscription = await prisma.userKennel.findUnique({
      where: { userId_kennelId: { userId: user.id, kennelId: kennel.id } },
    });
    isSubscribed = !!subscription;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">{kennel.fullName}</h1>
        <p className="mt-1 text-lg text-muted-foreground">
          {kennel.shortName}
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Badge>{kennel.region}</Badge>
          <Badge variant="outline">{kennel.country}</Badge>
          <span className="text-sm text-muted-foreground">
            {kennel._count.members}{" "}
            {kennel._count.members === 1 ? "subscriber" : "subscribers"}
          </span>
        </div>
      </div>

      <SubscribeButton
        kennelId={kennel.id}
        isSubscribed={isSubscribed}
        isAuthenticated={!!user}
      />

      {kennel.description && (
        <p className="text-muted-foreground">{kennel.description}</p>
      )}

      {kennel.website && (
        <a
          href={kennel.website}
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm text-primary hover:underline"
        >
          {kennel.website}
        </a>
      )}

      {kennel.aliases.length > 0 && (
        <div>
          <h2 className="text-sm font-medium text-muted-foreground">
            Also known as
          </h2>
          <div className="mt-1 flex flex-wrap gap-1">
            {kennel.aliases.map((a) => (
              <Badge key={a.alias} variant="secondary">
                {a.alias}
              </Badge>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
