import { FeedbackDialog } from "@/components/feedback/FeedbackDialog";

export function Footer() {
  return (
    <footer className="border-t py-4">
      <div className="mx-auto max-w-7xl px-4 flex items-center justify-between text-sm text-muted-foreground">
        <span>HashTracks &mdash; The Strava of Hashing</span>
        <FeedbackDialog />
      </div>
    </footer>
  );
}
