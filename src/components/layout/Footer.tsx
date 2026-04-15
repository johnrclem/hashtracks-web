import Link from "next/link";
import { Wordmark } from "@/components/layout/Wordmark";
import { FeedbackDialog } from "@/components/feedback/FeedbackDialog";

const exploreLinks = [
  { href: "/hareline", label: "The Hareline" },
  { href: "/travel", label: "Travel Mode" },
  { href: "/kennels", label: "Kennel Directory" },
  { href: "/logbook", label: "My Logbook" },
  { href: "/for-misman", label: "For Kennel Organizers" },
  { href: "/suggest", label: "Suggest a Kennel" },
];

const communityLinks = [
  { href: "/about", label: "About HashTracks" },
];

const linkClass = "text-foreground/80 hover:text-foreground transition-colors";

export function Footer() {
  return (
    <footer className="border-t bg-muted/30">
      <div className="mx-auto max-w-7xl px-4 py-12 md:py-16">
        <div className="grid gap-8 md:grid-cols-3">
          {/* Brand */}
          <div>
            <Wordmark />
            <p className="mt-3 max-w-xs text-sm text-muted-foreground">
              Find runs, track your hashes, never miss circle.
            </p>
          </div>

          {/* Explore */}
          <div>
            <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
              Explore
            </h3>
            <ul className="mt-3 space-y-2 text-sm">
              {exploreLinks.map((link) => (
                <li key={link.href}>
                  <Link href={link.href} className={linkClass}>{link.label}</Link>
                </li>
              ))}
            </ul>
          </div>

          {/* Community */}
          <div>
            <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
              Community
            </h3>
            <ul className="mt-3 space-y-2 text-sm">
              {communityLinks.map((link) => (
                <li key={link.href}>
                  <Link href={link.href} className={linkClass}>{link.label}</Link>
                </li>
              ))}
              <li>
                <FeedbackDialog />
              </li>
            </ul>
          </div>
        </div>

        {/* Bottom bar */}
        <div className="mt-10 flex flex-col items-center justify-between gap-2 border-t border-border/50 pt-6 text-xs text-muted-foreground sm:flex-row">
          <span>&copy; {new Date().getFullYear()} HashTracks. On-on!</span>
          <span>A drinking club with a running problem.</span>
        </div>
      </div>
    </footer>
  );
}
