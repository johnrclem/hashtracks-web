import { Globe, CalendarX, Compass, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import Link from "next/link";

interface EmptyStatesProps {
  variant: "no_coverage" | "no_confirmed" | "no_nearby" | "error";
  radiusKm?: number;
  broaderRadiusKm?: number;
}

const STATES: Record<
  EmptyStatesProps["variant"],
  {
    icon: typeof Globe;
    headline: string;
    body: (props: EmptyStatesProps) => string;
    cta?: { label: string; href: string };
    secondary?: string;
  }
> = {
  no_coverage: {
    icon: Globe,
    headline: "We haven't mapped any hashes here — yet.",
    body: () =>
      "HashTracks only shows regions where we have at least one data source. Know a kennel we should add?",
    cta: { label: "Suggest a kennel", href: "/suggest" },
    secondary: "Or check GototheHash for broader worldwide coverage.",
  },
  no_confirmed: {
    icon: CalendarX,
    headline: "No posted trails for your exact dates.",
    body: () =>
      "These kennels usually run during your stay — but you'll want to check directly to confirm.",
  },
  no_nearby: {
    icon: Compass,
    headline: "Nothing within range — but the region is active.",
    body: (props) =>
      `We expanded the search to ${props.broaderRadiusKm ?? "a wider"} km. Worth a drive?`,
  },
  error: {
    icon: AlertTriangle,
    headline: "We hit a snag finding trails.",
    body: () =>
      "Something went wrong on our end. You can try again, or let us know what you were searching for.",
    cta: { label: "Try again", href: "/travel" },
  },
};

export function EmptyStates(props: EmptyStatesProps) {
  const state = STATES[props.variant];
  const Icon = state.icon;

  return (
    <div
      className="mx-auto mt-12 max-w-lg text-center"
      role={props.variant === "error" ? "alert" : undefined}
    >
      <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-muted">
        <Icon className="h-8 w-8 text-muted-foreground" />
      </div>

      <h2 className="mt-6 font-display text-xl font-medium">
        {state.headline}
      </h2>

      <p className="mt-3 text-muted-foreground leading-relaxed">
        {state.body(props)}
      </p>

      {state.cta && (
        <div className="mt-6">
          <Button asChild>
            <Link href={state.cta.href}>{state.cta.label} →</Link>
          </Button>
        </div>
      )}

      {state.secondary && (
        <p className="mt-4 text-sm text-muted-foreground/60">
          {state.secondary}
        </p>
      )}
    </div>
  );
}
