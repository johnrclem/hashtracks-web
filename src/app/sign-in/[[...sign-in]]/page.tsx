import { SignIn } from "@clerk/nextjs";

export default function SignInPage() {
  return (
    <div className="flex min-h-[calc(100vh-10rem)] flex-col items-center justify-center gap-8 px-4">
      <div className="text-center">
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
          Welcome back to HashTracks
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Sign in to track your runs and view your stats.
        </p>
      </div>
      <SignIn />
    </div>
  );
}
