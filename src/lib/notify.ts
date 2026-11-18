/**
 * Email to the owner, for the alarms the daily digest can't deliver: an automation gone silent,
 * the Mac mini down, a failed migration (the ops watchdog).
 *
 * Sends through Resend only when `RESEND_API_KEY` and `OWNER_EMAIL` are both set; otherwise it
 * sends nothing and says so, and Sentry carries the alarm. The sender is `NOTIFY_FROM_EMAIL` if
 * set; otherwise `ops@` the sending domain the Vercel Marketplace Resend integration provides in
 * `RESEND_EMAIL_DOMAIN`; otherwise Resend's shared test sender, which delivers only to the Resend
 * account's own address.
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
const DOMAIN_LABEL = /^[a-z0-9-]{1,63}$/;
const LOCAL_PART = /^[a-z0-9._+-]{1,64}$/;
const SUBJECT_PREFIX = "[HashTracks] ";

/** A plain domain like `mail.example.com`: anything else is ignored rather than put in a header. */
function isDomain(value: string): boolean {
  const labels = value.split(".");
  return (
    labels.length >= 2 &&
    labels.every((l) => DOMAIN_LABEL.test(l) && !l.startsWith("-") && !l.endsWith("-"))
  );
}

/** The From address: `NOTIFY_FROM_EMAIL`, else `ops@<RESEND_EMAIL_DOMAIN>`, else Resend's test sender. */
export function senderAddress(): string {
  const explicit = process.env.NOTIFY_FROM_EMAIL?.trim();
  if (explicit) return explicit;
  const domain = sendingDomain(process.env.RESEND_EMAIL_DOMAIN?.trim().toLowerCase() ?? "");
  return isDomain(domain) ? `HashTracks Ops <ops@${domain}>` : DEFAULT_FROM;
}

/** The domain in a bare domain or a plain address on it; empty for anything else. */
function sendingDomain(raw: string): string {
  const at = raw.indexOf("@");
  if (at === -1) return raw;
  return LOCAL_PART.test(raw.slice(0, at)) ? raw.slice(at + 1) : "";
}

export function ownerEmailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY?.trim() && process.env.OWNER_EMAIL?.trim());
}

export async function emailOwner({ subject, text, idempotencyKey }: OwnerEmail): Promise<NotifyResult> {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const to = process.env.OWNER_EMAIL?.trim();
  if (!apiKey || !to) return { sent: false, reason: "email not configured (RESEND_API_KEY, OWNER_EMAIL)" };

  const from = senderAddress();
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
