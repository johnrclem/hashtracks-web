/** Client-safe Half-Mind helpers. */

const LISTING_BASE = "https://half-mind.com/regionalwebsite/p_list1.php";

/** A kennel's Half-Mind directory listing page. */
export function halfMindListingUrl(listingId: string): string {
  return `${LISTING_BASE}?ID=${encodeURIComponent(listingId)}`;
}
