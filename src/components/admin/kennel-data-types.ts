/**
 * Shared shape for admin Kennel UI components — the union of editable fields
 * the form needs and the display fields the table renders. KennelForm extends
 * this directly; KennelTable extends with `_count` for member/alias totals.
 */
export type AdminKennelData = {
  id: string;
  shortName: string;
  fullName: string;
  region: string;
  regionId: string | null;
  country: string;
  description: string | null;
  website: string | null;
  aliases: string[];
  // Profile fields
  scheduleDayOfWeek: string | null;
  scheduleTime: string | null;
  scheduleFrequency: string | null;
  scheduleNotes: string | null;
  facebookUrl: string | null;
  instagramHandle: string | null;
  twitterHandle: string | null;
  discordUrl: string | null;
  mailingListUrl: string | null;
  contactEmail: string | null;
  contactName: string | null;
  // Profile fields (#1415)
  gm: string | null;
  hareRaiser: string | null;
  signatureEvent: string | null;
  founder: string | null;
  parentKennelCode: string | null;
  hashCash: string | null;
  paymentLink: string | null;
  foundedYear: number | null;
  logoUrl: string | null;
  dogFriendly: boolean | null;
  walkersWelcome: boolean | null;
  isHidden: boolean;
  latitude: number | null;
  longitude: number | null;
};
