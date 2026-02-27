import { timingSafeEqual } from "crypto";
import { getQStashReceiver } from "@/lib/qstash";

export interface CronAuthResult {
  authenticated: boolean;
  method: "qstash" | "bearer" | "none";
}

/**
 * Verify cron request authentication.
 * Tries QStash signature first, then falls back to Bearer CRON_SECRET.
 */
export async function verifyCronAuth(request: Request): Promise<CronAuthResult> {
  // Try QStash signature verification first
  const signature = request.headers.get("upstash-signature");
  if (signature) {
    try {
      const receiver = getQStashReceiver();
      const body = await request.clone().text();
      await receiver.verify({ signature, body });
      return { authenticated: true, method: "qstash" };
    } catch {
      // QStash signature invalid — fall through to Bearer check
    }
  }

  // Fall back to Bearer CRON_SECRET
  const authHeader = request.headers.get("authorization") ?? "";
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return { authenticated: false, method: "none" };
  }

  const expected = `Bearer ${cronSecret}`;
  const authBuf = Buffer.from(authHeader);
  const expectedBuf = Buffer.from(expected);
  if (authBuf.length === expectedBuf.length && timingSafeEqual(authBuf, expectedBuf)) {
    return { authenticated: true, method: "bearer" };
  }

  return { authenticated: false, method: "none" };
}
