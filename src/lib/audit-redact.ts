/**
 * Personal-data guard for audit findings.
 *
 * Audit findings become issues in a public GitHub repo, and agents quote source
 * text in them, so a hasher's phone number in a calendar description can end up
 * published. GitHub also keeps an issue's edit history, so a later fix doesn't
 * undo that. This module removes phone numbers and email addresses from a
 * finding's title and body. It runs twice:
 *   1. `handleAuditSubmission`, before a finding is stored or hashed.
 *   2. `fileAuditFinding`, before anything reaches GitHub. That covers drafts
 *      queued before this guard existed and every other filing path.
 *
 * ## Kennel-published contacts
 * - **Phones are always removed, hash hotlines included.** A hotline is often one
 *   officer's own mobile and nothing in the digits says otherwise. `Kennel` has no
 *   phone column, so no fix needs the literal number; the finding links the source.
 * - **An email on the kennel's own website domain is kept.** The kennel published
 *   it to be contacted, HashTracks shows it as `Kennel.contactEmail`, and deep-dive
 *   findings need the literal value to set that field. `Kennel.website` decides
 *   what counts as the kennel's domain, and only that host or its subdomains
 *   qualify, so a shared host's parent domain never does. No website, or a failed
 *   lookup, means every address is removed.
 * - **Every other address is removed**, including a club's Gmail, because it looks
 *   exactly like a person's.
 *
 * Google Calendar IDs and iCal UIDs are shaped like addresses but aren't
 * mailboxes, and findings cite them, so they stay.
 *
 * ## Why this isn't `hare-pii.ts`
 * That scrubber handles a short hare field, where any 10-digit run is a phone.
 * Finding text is full of ids, URLs, dates and run numbers, so these patterns need
 * stricter boundaries.
 *
 * ## Choosing what to match
 * A wrongly redacted number costs a reader one click to the linked source; a missed
 * one is published permanently. Unclear cases are therefore removed. Shapes that
 * are only sometimes phones (a bare 10-digit run, `NXX-XXXX`) are removed unless
 * the preceding word marks them as an id or run range, and shorter or looser shapes
 * (`5550 0144`, `5550144`) are removed only right after a contact word. Bare 7-digit
 * numbers with no contact word are left alone: they can't be told from ids.
 *
 * A placeholder is seven characters, which no real phone number or address is
 * shorter than, so redacting can't push a validated title or body past its limit.
 */

import { displayDomain } from "@/lib/format";

const PHONE_PLACEHOLDER = "[phone]";
const EMAIL_PLACEHOLDER = "[email]";

/** How far back to look for a word that explains the number that follows. */
const CONTEXT_CHARS = 32;

// URLs are skipped by the phone rules so ids in links survive. A comma, semicolon
// or pipe ends the token, so a number stuck to the end of a URL is still scanned.
// The capture group makes `split` keep the URLs, at the odd indexes.
const URL_RE = /((?:https?:\/\/|www\.)[^\s<>)\]"'`,;|]+)/i;

// iOS contact copies and many web pages separate digits with these. They become
// plain separators first, so the rules below don't each have to list them.
const NO_BREAK_SPACE_RE = /(?<=[\d)])[  ](?=\d)/g;
const NO_BREAK_HYPHEN_RE = /(?<=\d)‑(?=\d)/g;

// The exceptions: URLs whose whole purpose is carrying a phone number. The query
// value allows hex letters for percent-encoding such as `%2B`.
const WHATSAPP_LINK_RE = /(?<=\bwa\.me\/)\+?\d{7,15}/gi;
const PHONE_QUERY_PARAM_RE = /(?<=[?&](?:phone|tel|mobile|cell)=)[%+\da-f().-]{7,24}/gi;

// Shapes that are phones wherever they appear.
const INTERNATIONAL_RE = /(?<![\w+])\+\d{1,3}[ ().-]{0,3}\d(?:[ ().-]{0,3}\d){6,11}(?!\d)/g;
const NANP_SEPARATED_RE =
  /(?<![\w#]|\d[.-])(?:1[ .-]{0,2})?(?:\(\d{3}\)[ .-]{0,2}|\d{3}[ .-])\d{3}[ .-]\d{4}(?!\w|-\d)/g;
const NATIONAL_PAIRS_RE = /(?<![\w#]|\d[.-])0\d(?:[ .-]\d{2}){4}(?!\w|-\d)/g;
// Dots are left out here: "03.1234567" is a decimal.
const NATIONAL_SEPARATED_RE =
  /(?<![\w#]|\d[.-])(?:\(0\d{1,4}\)[ -]?|0\d{1,4}[ -])\d{3,4}[ -]?\d{3,4}(?!\w|-\d)/g;
// A letter before a slash means a URL path segment ("groups/5045550123"). A digit
// there means a second number in a pair ("5045550123/5045550124").
const NATIONAL_BARE_RE = /(?<![\w#]|\d[.-]|[A-Za-z_-]\/)0\d{9,10}(?!\w|-\d|\.\d)/g;

// Sometimes phones. Area code and exchange can't start with 0 or 1, which also
// rules out Unix timestamps.
const NANP_BARE_RE = /(?<![\w#]|\d[.-]|[A-Za-z_-]\/)1?[2-9]\d{2}[2-9]\d{6}(?!\w|-\d|\.\d)/g;
const LOCAL_SEVEN_RE = /(?<![\w#.-]|[A-Za-z_-]\/)[2-9]\d{2}-\d{4}(?![\w-])/g;
const ID_WORD_RE = /\b(?:gid|ids?)[ #:=.]{0,3}$/i;
// Only a short number can be a range, so these words apply to NXX-XXXX alone.
const RANGE_WORD_RE = /\b(?:runs?|trails?|events?|issues?|pages?|rows?|prs?)[ #:=.]{0,3}$/i;

// Only phones when a contact word comes first.
const DIGIT_GROUP_RE = /(?<![\w#/.+-])\d[\d .-]{5,16}\d(?!\w)/g;
const CONTACT_WORD_RE =
  /\b(?:phone|telephone|tel|call|text|sms|whatsapp|mobile|cell|contact|hotline|hash ?line)(?: number| no| at| on)?[^\w\n]{0,4}$/i;
const DATE_LIKE_RE = /^(?:\d{4}[-. ]\d{2}[-. ]\d{2}|\d{2}[-. ]\d{2}[-. ]\d{4}|(?:19|20)\d{2}[ -]{1,3}(?:19|20)\d{2}$)/;

interface PhoneRule {
  re: RegExp;
  /** When present, the match is only removed if this returns true. */
  accept?: (before: string, match: string) => boolean;
}

function isNotId(before: string): boolean {
  return !ID_WORD_RE.test(before);
}

function isNotIdOrRange(before: string): boolean {
  return isNotId(before) && !RANGE_WORD_RE.test(before);
}

function followsContactWord(before: string, match: string): boolean {
  const digits = match.replaceAll(/\D/g, "").length;
  return digits >= 7 && digits <= 15 && CONTACT_WORD_RE.test(before) && !DATE_LIKE_RE.test(match);
}

// Order matters: the conclusive shapes run first so the looser rules below only
// see what's left.
const PHONE_RULES: readonly PhoneRule[] = [
  { re: INTERNATIONAL_RE },
  { re: NANP_SEPARATED_RE },
  { re: NATIONAL_PAIRS_RE },
  { re: NATIONAL_SEPARATED_RE },
  { re: NATIONAL_BARE_RE },
  { re: NANP_BARE_RE, accept: isNotId },
  { re: LOCAL_SEVEN_RE, accept: isNotIdOrRange },
  { re: DIGIT_GROUP_RE, accept: followsContactWord },
];

// `{1,64}` is the RFC limit and keeps a long run with no "@" from going quadratic.
// The lookahead skips retina image names such as "logo@2x.png".
const EMAIL_RE = /[a-z0-9._%+-]{1,64}(?:@|%40)(?!\d{1,2}x\.)(?:[a-z0-9-]{1,63}\.){1,8}[a-z]{2,24}/gi;
const AT_SIGN_RE = /@|%40/;
const CALENDAR_ID_RE = /(?:@|%40)(?:group(?:\.v)?|import)\.calendar\.google\.com$/i;
const ICAL_UID_RE = /^[a-z0-9_]{20,}(?:@|%40)google\.com$/i;

/**
 * The host of the kennel's website without `www.`. An unparseable website comes
 * back unchanged, which can never equal an address's domain, so it fails closed.
 */
function kennelDomainOf(website: string | null | undefined): string | null {
  if (!website) return null;
  return displayDomain(/^https?:\/\//i.test(website) ? website : `https://${website}`);
}

function isKeptAddress(address: string, kennelDomain: string | null): boolean {
  if (CALENDAR_ID_RE.test(address) || ICAL_UID_RE.test(address)) return true;
  if (!kennelDomain) return false;
  // The last part: a local part can itself contain "%40".
  const domain = (address.split(AT_SIGN_RE).at(-1) ?? "").toLowerCase();
  return domain === kennelDomain || domain.endsWith(`.${kennelDomain}`);
}

function redactPhonesInText(text: string, replacePhone: () => string): string {
  let result = text;
  for (const { re, accept } of PHONE_RULES) {
    result = result.replaceAll(re, (match: string, offset: number, whole: string) => {
      const before = whole.slice(Math.max(0, offset - CONTEXT_CHARS), offset);
      return accept && !accept(before, match) ? match : replacePhone();
    });
  }
  return result;
}

/** Replace phone numbers and personal email addresses with placeholders. */
export function redactPersonalData(
  text: string,
  kennelWebsite?: string | null,
): { text: string; redactions: number } {
  const kennelDomain = kennelDomainOf(kennelWebsite);
  let redactions = 0;
  const replacePhone = (): string => {
    redactions += 1;
    return PHONE_PLACEHOLDER;
  };

  const normalized = text.replaceAll(NO_BREAK_SPACE_RE, " ").replaceAll(NO_BREAK_HYPHEN_RE, "-");

  const withoutEmails = normalized.replaceAll(EMAIL_RE, (address: string) => {
    if (isKeptAddress(address, kennelDomain)) return address;
    redactions += 1;
    return EMAIL_PLACEHOLDER;
  });

  const redacted = withoutEmails
    .replaceAll(WHATSAPP_LINK_RE, replacePhone)
    .replaceAll(PHONE_QUERY_PARAM_RE, replacePhone)
    .split(URL_RE)
    .map((part, index) => (index % 2 === 1 ? part : redactPhonesInText(part, replacePhone)))
    .join("");

  return { text: redacted, redactions };
}

/** Redact the two public text fields of a finding. `redactions` totals both. */
export function redactFinding(
  finding: { title: string; bodyMarkdown: string },
  kennelWebsite?: string | null,
): { title: string; bodyMarkdown: string; redactions: number } {
  const title = redactPersonalData(finding.title, kennelWebsite);
  const body = redactPersonalData(finding.bodyMarkdown, kennelWebsite);
  return {
    title: title.text,
    bodyMarkdown: body.text,
    redactions: title.redactions + body.redactions,
  };
}
