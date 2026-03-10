"use client";

import { FadeInSection } from "@/components/home/HeroAnimations";

const steps = [
  {
    number: "1",
    heading: "Request Access",
    description:
      "Tell us which kennel you manage. We'll verify and grant you misman access within a day.",
  },
  {
    number: "2",
    heading: "Set Up Your Roster",
    description:
      "Your roster builds organically as you take attendance, import from a spreadsheet, or seed from recent hares. Record hash names, nerd names, and internal notes.",
  },
  {
    number: "3",
    heading: "Record Attendance",
    description:
      "At the hash, pull up the form on your phone. Tap names, mark hash cash, done. Your regulars are suggested first.",
  },
];

export function HowItWorks() {
  return (
    <section className="border-t border-foreground/5 bg-foreground/[0.015] px-4 py-16 sm:py-24">
      <div className="mx-auto max-w-4xl">
        <FadeInSection>
          <h2 className="text-center text-2xl font-bold tracking-tight sm:text-3xl">
            Up and running in minutes
          </h2>
          <p className="mx-auto mt-3 max-w-lg text-center text-muted-foreground">
            No setup wizards, no training. If you can take attendance in a
            spreadsheet, you can do it faster here.
          </p>
        </FadeInSection>

        <div className="mt-14">
          {/* Desktop: horizontal */}
          <div className="hidden sm:flex sm:items-start sm:gap-4">
            {steps.map((step, i) => (
              <FadeInSection
                key={step.number}
                delay={i * 150}
                className="flex flex-1 flex-col items-center text-center"
              >
                {/* Number + connector row */}
                <div className="flex w-full items-center">
                  {/* Left connector */}
                  {i > 0 ? (
                    <div className="h-px flex-1 border-t-2 border-dashed border-foreground/10" />
                  ) : (
                    <div className="flex-1" />
                  )}

                  {/* Circle */}
                  <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full border-2 border-orange-500/30 bg-orange-500/10">
                    <span className="font-mono text-xl font-bold text-orange-500">
                      {step.number}
                    </span>
                  </div>

                  {/* Right connector */}
                  {i < steps.length - 1 ? (
                    <div className="h-px flex-1 border-t-2 border-dashed border-foreground/10" />
                  ) : (
                    <div className="flex-1" />
                  )}
                </div>

                <h3 className="mt-5 text-lg font-bold">{step.heading}</h3>
                <p className="mt-2 max-w-xs text-sm leading-relaxed text-muted-foreground">
                  {step.description}
                </p>
              </FadeInSection>
            ))}
          </div>

          {/* Mobile: vertical */}
          <div className="flex flex-col gap-8 sm:hidden">
            {steps.map((step, i) => (
              <FadeInSection key={step.number} delay={i * 150}>
                <div className="flex gap-4">
                  {/* Number + vertical line */}
                  <div className="flex flex-col items-center">
                    <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full border-2 border-orange-500/30 bg-orange-500/10">
                      <span className="font-mono text-lg font-bold text-orange-500">
                        {step.number}
                      </span>
                    </div>
                    {i < steps.length - 1 && (
                      <div className="mt-2 w-px flex-1 border-l-2 border-dashed border-foreground/10" />
                    )}
                  </div>

                  {/* Content */}
                  <div className="pb-2 pt-1">
                    <h3 className="text-lg font-bold">{step.heading}</h3>
                    <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
                      {step.description}
                    </p>
                  </div>
                </div>
              </FadeInSection>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
