import { SignUp } from "@clerk/nextjs";

export default function SignUpPage() {
  return (
    <div className="flex flex-col items-center justify-center gap-8 px-4">
      <div className="text-center">
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
          Join HashTracks
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          The Strava of Hashing — discover runs, track attendance, view stats.
        </p>
      </div>
      <SignUp />
    </div>
  );
}
