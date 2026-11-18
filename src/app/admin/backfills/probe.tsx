"use client";

import { BackfillStepUp } from "@/components/admin/BackfillStepUp";
import { probeStepUp } from "./actions";

/** The step-up probe (design 10.3): run once straight through, once with each late mode. */
export function BackfillProbe() {
  return (
    <section className="space-y-2">
      <h2 className="text-lg font-semibold">Step-up probe</h2>
      <p className="text-sm text-muted-foreground">
        Runs the server&apos;s step-up checks when the nonce is minted and when it is used, and writes only its own audit row.
        Straight through should pass; both late modes should be refused.
      </p>
      <div className="flex flex-wrap gap-4">
        <BackfillStepUp label="Probe" action="PROBE" perform={probeStepUp} probeMode="straight" />
        <BackfillStepUp label="Probe, wait 70 s" action="PROBE" perform={probeStepUp} probeMode="wait" />
        <BackfillStepUp label="Probe, hold token 70 s" action="PROBE" perform={probeStepUp} probeMode="hold" />
      </div>
    </section>
  );
}
