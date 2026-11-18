"use client";

/**
 * One step-up action on /admin/backfills (design 10.3). Asks for the code only
 * when the owner confirms, so reading counts doesn't use up the one-minute
 * window. Each action starts a fresh Clerk verification, then mints a nonce
 * with a freshly fetched token and performs the action with another one.
 *
 * The probe's late modes test the server's refusals on production: "wait"
 * waits 70 s before fetching the token for its use (the fva check refuses);
 * "hold" fetches that token at once and holds it 70 s (the iat check refuses).
 */
import { useState } from "react";
import { useSession } from "@clerk/nextjs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { BackfillStepUpAction } from "@/generated/prisma/client";
import { mintStepUp } from "@/app/admin/backfills/actions";

type Perform = (nonce: string, freshToken: string) => Promise<{ ok: boolean; error?: string; data?: unknown }>;

export function BackfillStepUp(props: {
  label: string;
  action: BackfillStepUpAction;
  runId?: string;
  kennelId?: string;
  payload?: string;
  perform: Perform;
  probeMode?: "straight" | "wait" | "hold";
}) {
  const { session } = useSession();
  const [code, setCode] = useState("");
  const [asking, setAsking] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const fresh = async () => {
    const token = await session?.getToken({ skipCache: true });
    if (!token) throw new Error("No session token");
    return token;
  };

  const run = async () => {
    if (!session) return;
    setBusy(true);
    setMessage(null);
    try {
      await session.startVerification({ level: "second_factor" });
      const strategy = /^\d{6}$/.test(code.trim()) ? "totp" : "backup_code";
      await session.attemptSecondFactorVerification({ strategy, code: code.trim() } as never);
      const minted = await mintStepUp({ action: props.action, runId: props.runId, kennelId: props.kennelId, payload: props.payload }, await fresh());
      if (!minted.ok) throw new Error(minted.error);
      if (!minted.data) throw new Error("No nonce");
      let token: string;
      if (props.probeMode === "wait") {
        await new Promise((r) => setTimeout(r, 70_000));
        token = await fresh();
      } else if (props.probeMode === "hold") {
        token = await fresh();
        await new Promise((r) => setTimeout(r, 70_000));
      } else {
        token = await fresh();
      }
      const result = await props.perform(minted.data.nonce, token);
      setMessage(result.ok ? `Done${result.data ? `: ${JSON.stringify(result.data)}` : ""}` : `Refused: ${result.error}`);
    } catch (err) {
      setMessage(`Failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
      setCode("");
      setAsking(false);
    }
  };

  return (
    <div className="space-y-2">
      {asking ? (
        <div className="flex items-center gap-2">
          <Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="Authenticator or backup code" autoComplete="one-time-code" className="w-56" />
          <Button size="sm" onClick={run} disabled={busy || code.trim().length < 6}>{busy ? "Working…" : "Confirm"}</Button>
          <Button size="sm" variant="ghost" onClick={() => setAsking(false)} disabled={busy}>Cancel</Button>
        </div>
      ) : (
        <Button size="sm" variant="outline" onClick={() => setAsking(true)}>{props.label}</Button>
      )}
      {message && <p className="text-sm text-muted-foreground">{message}</p>}
    </div>
  );
}
