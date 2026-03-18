import { timingSafeEqual } from "crypto";
import { getQStashReceiver } from "@/lib/qstash";

/** Result of cron request authentication indicating success and which method matched. */
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
    let receiver;
    try {
      receiver = getQStashReceiver();
    } catch (err) {
      console.error("[cron-auth] QStash receiver setup failed:", err);
      // Fall through to Bearer check
    }
    if (receiver) {
      try {
        const body = await request.clone().text();
        // Omit `url` — Vercel may rewrite request.url for custom domains,
        // causing a mismatch with the URL QStash signed. Body + signature is sufficient.
        await receiver.verify({ signature, body });
        return { authenticated: true, method: "qstash" };
      } catch (err) {
        console.warn("[cron-auth] QStash signature verification failed:", err instanceof Error ? err.message : err);
        // Fall through to Bearer check
      }
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
  // Length check required by timingSafeEqual; minimal timing leak is acceptable for cron auth
  if (authBuf.length === expectedBuf.length && timingSafeEqual(authBuf, expectedBuf)) {
    return { authenticated: true, method: "bearer" };
  }

  return { authenticated: false, method: "none" };
}
