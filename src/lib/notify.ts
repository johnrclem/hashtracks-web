/**
 * Email to the owner, for the alarms the daily digest can't deliver: an automation gone silent,
 * the Mac mini down, a failed migration (the ops watchdog).
 *
 * Sends through Resend only when `RESEND_API_KEY` and `OWNER_EMAIL` are both set; otherwise it
 * sends nothing and says so, and Sentry carries the alarm. `NOTIFY_FROM_EMAIL` sets the sender;
 * without it Resend's shared test sender is used, which delivers only to the Resend account's own
 * address.
 */
import { Resend } from "resend";

export interface OwnerEmail {
  subject: string;
  text: string;
  /**
   * Resend drops a second send with the same key within 24 hours, so a retry after a crash
   * between sending and recording the send can't email twice.
   */
  idempotencyKey: string;
}

export type NotifyResult = { sent: true; id: string } | { sent: false; reason: string };

const DEFAULT_FROM = "HashTracks <onboarding@resend.dev>";
const SUBJECT_PREFIX = "[HashTracks] ";

export function ownerEmailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY?.trim() && process.env.OWNER_EMAIL?.trim());
}

export async function emailOwner({ subject, text, idempotencyKey }: OwnerEmail): Promise<NotifyResult> {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const to = process.env.OWNER_EMAIL?.trim();
  if (!apiKey || !to) return { sent: false, reason: "email not configured (RESEND_API_KEY, OWNER_EMAIL)" };

  const from = process.env.NOTIFY_FROM_EMAIL?.trim() || DEFAULT_FROM;
  try {
    const { data, error } = await new Resend(apiKey).emails.send(
      { from, to, subject: `${SUBJECT_PREFIX}${subject}`, text },
      { idempotencyKey },
    );
    if (error) return { sent: false, reason: `Resend: ${error.message}` };
    return { sent: true, id: data.id };
  } catch (err) {
    return { sent: false, reason: `Resend: ${err instanceof Error ? err.message : String(err)}` };
  }
}
