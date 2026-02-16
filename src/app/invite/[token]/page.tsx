import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { getOrCreateUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { redeemMismanInvite } from "@/app/misman/invite/actions";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

interface Props {
  params: Promise<{ token: string }>;
}

export default async function InvitePage({ params }: Props) {
  const { token } = await params;

  // Check auth
  const user = await getOrCreateUser();

  if (user) {
    // Authenticated: attempt to redeem immediately
    const result = await redeemMismanInvite(token);

    if (result.success) {
      redirect(`/kennels/${result.kennelSlug}?invited=true`);
    }

    // Redemption failed — show error
    return (
      <div className="mx-auto max-w-md space-y-6 py-12">
        <div className="rounded-lg border border-destructive/20 bg-destructive/5 p-6 text-center">
          <h1 className="text-xl font-bold">Unable to accept invite</h1>
          <p className="mt-2 text-muted-foreground">{result.error}</p>
          <Button asChild className="mt-4" variant="outline">
            <Link href="/hareline">Go to Hareline</Link>
          </Button>
        </div>
      </div>
    );
  }

  // Unauthenticated: validate token and show landing page
  const invite = await prisma.mismanInvite.findUnique({
    where: { token },
    include: {
      kennel: { select: { shortName: true, fullName: true } },
      inviter: { select: { hashName: true } },
    },
  });

  if (!invite) notFound();

  const isExpired = invite.expiresAt <= new Date();
  const isUsed = invite.status === "ACCEPTED";
  const isRevoked = invite.status === "REVOKED";

  if (isUsed || isRevoked || isExpired) {
    const message = isUsed
      ? "This invite has already been used."
      : isRevoked
        ? "This invite was cancelled."
        : "This invite has expired. Ask the inviter for a new link.";

    return (
      <div className="mx-auto max-w-md space-y-6 py-12">
        <div className="rounded-lg border p-6 text-center">
          <h1 className="text-xl font-bold">Invite unavailable</h1>
          <p className="mt-2 text-muted-foreground">{message}</p>
          <Button asChild className="mt-4" variant="outline">
            <Link href="/">Go to HashTracks</Link>
          </Button>
        </div>
      </div>
    );
  }

  // Valid invite — show landing page (token preserved in redirect URL through auth flow)
  const expiresFormatted = invite.expiresAt.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });

  const inviterName = invite.inviter.hashName || "A kennel member";
  const encodedRedirect = encodeURIComponent(`/invite/${token}`);

  return (
    <div className="mx-auto max-w-md space-y-6 py-12">
      <div className="rounded-lg border p-6 text-center space-y-4">
        <Badge variant="secondary" className="text-sm">
          Misman Invite
        </Badge>
        <h1 className="text-2xl font-bold">{invite.kennel.fullName}</h1>
        <p className="text-muted-foreground">
          {inviterName} invited you to manage{" "}
          <span className="font-medium">{invite.kennel.shortName}</span> on
          HashTracks.
        </p>

        <div className="flex flex-col gap-2 pt-2">
          <Button asChild size="lg">
            <Link href={`/sign-up?redirect_url=${encodedRedirect}`}>
              Sign Up to Accept
            </Link>
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link href={`/sign-in?redirect_url=${encodedRedirect}`}>
              Already have an account? Sign In
            </Link>
          </Button>
        </div>

        <p className="text-xs text-muted-foreground">
          This invite expires on {expiresFormatted}
        </p>
      </div>
    </div>
  );
}
