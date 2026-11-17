"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { BackfillStepUp } from "@/components/admin/BackfillStepUp";
import { clearCutoff, continueUndo, getUndoPlan, haltRun, resumeRun, setCutoff, undoRun } from "../actions";

type UndoPlanView = { hash: string; delete: number; keep: Array<{ eventId: string; reason: string }>; rawEvents: number; slots: number };

export function RunControls({ runId, status, kennelId, hasCutoff }: { runId: string; status: string; kennelId: string | null; hasCutoff: boolean }) {
  const [message, setMessage] = useState<string | null>(null);
  const [undoPlan, setUndoPlan] = useState<UndoPlanView | null>(null);
  const [cutoffDate, setCutoffDate] = useState("");
  const say = (r: { ok: boolean; error?: string; data?: unknown }) => setMessage(r.ok ? `Done${r.data ? `: ${JSON.stringify(r.data)}` : ""}` : `Refused: ${r.error}`);

  return (
    <section className="space-y-4">
      <h2 className="font-semibold">Actions</h2>
      {(status === "PLANNED" || status === "APPLYING") && <Button size="sm" variant="destructive" onClick={async () => say(await haltRun(runId))}>Halt (no code needed)</Button>}
      {status === "HALTED" && <BackfillStepUp label="Resume…" action="RESUME" runId={runId} perform={(n, t) => resumeRun(runId, n, t)} />}
      {["APPLYING", "HALTED", "APPLIED", "VERIFIED", "VERIFY_FAILED"].includes(status) && (
        <div className="space-y-2">
          <Button size="sm" variant="outline" onClick={async () => { const r = await getUndoPlan(runId); if (r.ok && r.data) setUndoPlan(r.data); else say(r); }}>Read the undo plan</Button>
          {undoPlan && (
            <div className="text-sm">
              <p>Delete {undoPlan.delete} events and {undoPlan.rawEvents} RawEvents; recompute {undoPlan.slots} slots; keep {undoPlan.keep.length} events with user data.</p>
              <BackfillStepUp label="Undo…" action="UNDO" runId={runId} payload={undoPlan.hash} perform={(n, t) => undoRun(runId, undoPlan.hash, n, t)} />
            </div>
          )}
        </div>
      )}
      {status === "UNDOING" && <Button size="sm" variant="outline" onClick={async () => say(await continueUndo(runId))}>Continue the undo</Button>}
      {kennelId && !hasCutoff && (
        <div className="flex items-center gap-2">
          <Input className="w-40" placeholder="YYYY-MM-DD" value={cutoffDate} onChange={(e) => setCutoffDate(e.target.value)} />
          <BackfillStepUp label="Set cutoff…" action="SET_CUTOFF" kennelId={kennelId} payload={cutoffDate} perform={(n, t) => setCutoff(kennelId, cutoffDate, n, t)} />
        </div>
      )}
      {kennelId && hasCutoff && <BackfillStepUp label="Clear cutoff…" action="CLEAR_CUTOFF" kennelId={kennelId} perform={(n, t) => clearCutoff(kennelId, n, t)} />}
      {message && <p className="text-sm text-muted-foreground">{message}</p>}
    </section>
  );
}
