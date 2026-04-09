import { redirect } from "next/navigation";
import Link from "next/link";
import { getOrCreateUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

interface Props {
  searchParams: Promise<{ token?: string }>;
}

/** Centered notice card used by every error/info branch on this page. */
function InviteNotice({
  title,
  body,
  ctaHref,
  ctaLabel,
  tone = "neutral",
}: {
  title: string;
  body: React.ReactNode;
  ctaHref: string;
  ctaLabel: string;
  tone?: "neutral" | "destructive";
}) {
  const card =
    tone === "destructive"
      ? "rounded-lg border border-destructive/20 bg-destructive/5 p-6 text-center"
      : "rounded-lg border p-6 text-center";
  return (
    <div className="mx-auto max-w-md space-y-6 py-12">
      <div className={card}>
        <h1 className="text-xl font-bold">{title}</h1>
        <p className="mt-2 text-muted-foreground">{body}</p>
        <Button asChild className="mt-4" variant="outline">
          <Link href={ctaHref}>{ctaLabel}</Link>
        </Button>
      </div>
    </div>
  );
}

export default async function ProfileLinkInvitePage({ searchParams }: Props) {
  const { token } = await searchParams;

  if (!token) {
    return (
      <InviteNotice
        title="Invalid Link"
        body="No invite token provided. Check your invite link and try again."
        ctaHref="/"
        ctaLabel="Go to HashTracks"
        tone="destructive"
      />
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
      <InviteNotice
        title="Invite Not Found"
        body="This invite link is invalid or has already been used. Contact the kennel manager for a new link."
        ctaHref="/"
        ctaLabel="Go to HashTracks"
        tone="destructive"
      />
    );
  }

  // Check expiry
  if (hasher.profileInviteExpiresAt && hasher.profileInviteExpiresAt <= new Date()) {
    return (
      <InviteNotice
        title="Invite Expired"
        body="This invite link has expired. Ask the kennel manager for a new one."
        ctaHref="/"
        ctaLabel="Go to HashTracks"
      />
    );
  }

  // Check if already linked
  if (hasher.userLink && hasher.userLink.status === "CONFIRMED") {
    return (
      <InviteNotice
        title="Already Linked"
        body="This roster entry is already linked to an account."
        ctaHref="/profile"
        ctaLabel="Go to Profile"
      />
    );
  }

  const kennelName = hasher.kennel?.fullName ?? hasher.kennel?.shortName ?? hasher.rosterGroup.name;
  const hasherDisplayName = hasher.hashName ?? hasher.nerdName ?? "Unknown";

  // Check auth
  const user = await getOrCreateUser();

  if (user) {
    // Atomically: (1) re-check same-roster conflict, (2) consume the invite
    // token (still valid + not expired), (3) create/update the link. All
    // three steps run in one transaction so two concurrent redeems of the
    // same token, or two different tokens for the same roster group, can't
    // both succeed — the loser sees updateMany/findFirst behaviour that
    // rolls the transaction back.
    type RedeemResult =
      | { outcome: "ok" }
      | { outcome: "raced" }
      | { outcome: "already-linked"; hashName: string | null };

    const result = await prisma.$transaction(async (tx): Promise<RedeemResult> => {
      const existingLink = await tx.kennelHasherLink.findFirst({
        where: {
          userId: user.id,
          status: "CONFIRMED",
          kennelHasher: { rosterGroupId: hasher.rosterGroupId },
        },
        include: { kennelHasher: { select: { hashName: true } } },
      });
      if (existingLink) {
        return {
          outcome: "already-linked",
          hashName: existingLink.kennelHasher.hashName,
        };
      }

      const now = new Date();
      const cleared = await tx.kennelHasher.updateMany({
        where: {
          id: hasher.id,
          profileInviteToken: token,
          OR: [
            { profileInviteExpiresAt: null },
            { profileInviteExpiresAt: { gt: now } },
          ],
        },
        data: {
          profileInviteToken: null,
          profileInviteExpiresAt: null,
          profileInvitedBy: null,
        },
      });
      if (cleared.count === 0) return { outcome: "raced" };

      if (hasher.userLink) {
        await tx.kennelHasherLink.update({
          where: { id: hasher.userLink.id },
          data: {
            userId: user.id,
            status: "CONFIRMED",
            confirmedBy: user.id,
            dismissedBy: null,
          },
        });
      } else {
        await tx.kennelHasherLink.create({
          data: {
            kennelHasherId: hasher.id,
            userId: user.id,
            status: "CONFIRMED",
            suggestedBy: hasher.profileInvitedBy,
            confirmedBy: user.id,
          },
        });
      }
      return { outcome: "ok" };
    });

    if (result.outcome === "already-linked") {
      return (
        <InviteNotice
          title="Already Connected"
          body={
            <>
              Your account is already linked to{" "}
              <strong>{result.hashName}</strong> in this roster group. Contact
              the kennel manager if this is incorrect.
            </>
          }
          ctaHref="/profile"
          ctaLabel="Go to Profile"
          tone="destructive"
        />
      );
    }

    if (result.outcome === "raced") {
      redirect("/profile?linked=already");
    }

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
