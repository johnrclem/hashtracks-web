import Link from "next/link";
import { auth } from "@clerk/nextjs/server";
import { Button } from "@/components/ui/button";

export default async function HomePage() {
  const { userId } = await auth();

  return (
    <div className="flex flex-col items-center justify-center gap-8 py-16 text-center">
      <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">
        HashTracks
      </h1>
      <p className="max-w-lg text-lg text-muted-foreground">
        The Strava of Hashing. Discover upcoming runs, track your attendance,
        and view your personal stats &mdash; all in one place.
      </p>

      {userId ? (
        <div className="flex gap-4">
          <Button asChild>
            <Link href="/hareline">View Hareline</Link>
          </Button>
          <Button variant="outline" asChild>
            <Link href="/logbook">My Logbook</Link>
          </Button>
        </div>
      ) : (
        <div className="flex gap-4">
          <Button asChild>
            <Link href="/sign-up">Get Started</Link>
          </Button>
          <Button variant="outline" asChild>
            <Link href="/sign-in">Sign In</Link>
          </Button>
        </div>
      )}
    </div>
  );
}
