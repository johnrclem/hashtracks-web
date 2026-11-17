/** Client-safe Half-Mind helpers. */

const LISTING_BASE = "https://half-mind.com/regionalwebsite/p_list1.php";

/** A kennel's Half-Mind directory listing page. */
export function halfMindListingUrl(listingId: string): string {
  return `${LISTING_BASE}?ID=${encodeURIComponent(listingId)}`;
}

/** `KennelDiscovery.externalSource` for Half-Mind listings. */
export const HALF_MIND_EXTERNAL_SOURCE = "HALFMIND";

/** Only an unreviewed Half-Mind row may be dismissed; linked and added ones are undone elsewhere. */
export const HALF_MIND_DISMISS_NEW_ONLY = "Only a NEW Half-Mind row can be dismissed.";
