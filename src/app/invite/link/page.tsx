import { redirect } from "next/navigation";
import Link from "next/link";
import { getOrCreateUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

interface Props {
  searchParams: Promise<{ token?: string }>;
}

export default async function ProfileLinkInvitePage({ searchParams }: Props) {
  const { token } = await searchParams;

  if (!token) {
    return (
      <div className="mx-auto max-w-md space-y-6 py-12">
        <div className="rounded-lg border border-destructive/20 bg-destructive/5 p-6 text-center">
          <h1 className="text-xl font-bold">Invalid Link</h1>
          <p className="mt-2 text-muted-foreground">
            No invite token provided. Check your invite link and try again.
          </p>
          <Button asChild className="mt-4" variant="outline">
            <Link href="/">Go to HashTracks</Link>
          </Button>
        </div>
      </div>
    );
  }

  // Look up the hasher by invite token
  const hasher = await prisma.kennelHasher.findUnique({
    where: { profileInviteToken: token },
    include: {
      kennel: { select: { shortName: true, fullName: true, slug: true } },
      userLink: true,
      rosterGroup: {
        select: {
          name: true,
          kennels: {
            select: { kennel: { select: { shortName: true } } },
          },
        },
      },
    },
  });

  if (!hasher) {
    return (
      <div className="mx-auto max-w-md space-y-6 py-12">
        <div className="rounded-lg border border-destructive/20 bg-destructive/5 p-6 text-center">
          <h1 className="text-xl font-bold">Invite Not Found</h1>
          <p className="mt-2 text-muted-foreground">
            This invite link is invalid or has already been used.
            Contact the kennel manager for a new link.
          </p>
          <Button asChild className="mt-4" variant="outline">
            <Link href="/">Go to HashTracks</Link>
          </Button>
        </div>
      </div>
    );
  }

  // Check expiry
  if (hasher.profileInviteExpiresAt && hasher.profileInviteExpiresAt <= new Date()) {
    return (
      <div className="mx-auto max-w-md space-y-6 py-12">
        <div className="rounded-lg border p-6 text-center">
          <h1 className="text-xl font-bold">Invite Expired</h1>
          <p className="mt-2 text-muted-foreground">
            This invite link has expired. Ask the kennel manager for a new one.
          </p>
          <Button asChild className="mt-4" variant="outline">
            <Link href="/">Go to HashTracks</Link>
          </Button>
        </div>
      </div>
    );
  }

  // Check if already linked
  if (hasher.userLink && hasher.userLink.status === "CONFIRMED") {
    return (
      <div className="mx-auto max-w-md space-y-6 py-12">
        <div className="rounded-lg border p-6 text-center">
          <h1 className="text-xl font-bold">Already Linked</h1>
          <p className="mt-2 text-muted-foreground">
            This roster entry is already linked to an account.
          </p>
          <Button asChild className="mt-4" variant="outline">
            <Link href="/profile">Go to Profile</Link>
          </Button>
        </div>
      </div>
    );
  }

  const kennelName = hasher.kennel?.fullName ?? hasher.kennel?.shortName ?? hasher.rosterGroup.name;
  const hasherDisplayName = hasher.hashName ?? hasher.nerdName ?? "Unknown";

  // Check auth
  const user = await getOrCreateUser();

  if (user) {
    // Authenticated: redeem invite
    // Check if user is already linked to another hasher in the same roster group
    const existingLink = await prisma.kennelHasherLink.findFirst({
      where: {
        userId: user.id,
        status: "CONFIRMED",
        kennelHasher: { rosterGroupId: hasher.rosterGroupId },
      },
      include: { kennelHasher: { select: { hashName: true } } },
    });

    if (existingLink) {
      return (
        <div className="mx-auto max-w-md space-y-6 py-12">
          <div className="rounded-lg border border-destructive/20 bg-destructive/5 p-6 text-center">
            <h1 className="text-xl font-bold">Already Connected</h1>
            <p className="mt-2 text-muted-foreground">
              Your account is already linked to{" "}
              <strong>{existingLink.kennelHasher.hashName}</strong> in this
              roster group. Contact the kennel manager if this is incorrect.
            </p>
            <Button asChild className="mt-4" variant="outline">
              <Link href="/profile">Go to Profile</Link>
            </Button>
          </div>
        </div>
      );
    }

    // Create or update the link
    if (hasher.userLink) {
      // Update existing (dismissed) link
      await prisma.kennelHasherLink.update({
        where: { id: hasher.userLink.id },
        data: {
          userId: user.id,
          status: "CONFIRMED",
          confirmedBy: user.id,
          dismissedBy: null,
        },
      });
    } else {
      await prisma.kennelHasherLink.create({
        data: {
          kennelHasherId: hasher.id,
          userId: user.id,
          status: "CONFIRMED",
          suggestedBy: hasher.profileInvitedBy,
          confirmedBy: user.id,
        },
      });
    }

    // Clear the invite token (one-time use)
    await prisma.kennelHasher.update({
      where: { id: hasher.id },
      data: {
        profileInviteToken: null,
        profileInviteExpiresAt: null,
        profileInvitedBy: null,
      },
    });

    // Show success and redirect
    const kennelSlug = hasher.kennel?.slug;
    redirect(
      kennelSlug
        ? `/kennels/${kennelSlug}?linked=true`
        : `/profile?linked=true`,
    );
  }

  // Unauthenticated: show landing page
  const encodedRedirect = encodeURIComponent(`/invite/link?token=${token}`);

  return (
    <div className="mx-auto max-w-md space-y-6 py-12">
      <div className="rounded-lg border p-6 text-center space-y-4">
        <Badge variant="secondary" className="text-sm">
          Profile Link Invite
        </Badge>
        <h1 className="text-2xl font-bold">{kennelName}</h1>
        <p className="text-muted-foreground">
          You&apos;ve been invited to link your HashTracks profile to{" "}
          <span className="font-medium">{kennelName}</span>&apos;s roster as{" "}
          <strong>{hasherDisplayName}</strong>.
        </p>
        <div className="rounded-lg bg-muted/50 p-3 text-sm text-muted-foreground">
          When linked, attendance recorded by the kennel&apos;s manager will
          automatically appear in your logbook.
        </div>

        <div className="flex flex-col gap-2 pt-2">
          <Button asChild size="lg">
            <Link href={`/sign-up?redirect_url=${encodedRedirect}`}>
              Sign Up to Link
            </Link>
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link href={`/sign-in?redirect_url=${encodedRedirect}`}>
              Already have an account? Sign In
            </Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
