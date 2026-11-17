/** Client-safe Half-Mind helpers. */

const LISTING_BASE = "https://half-mind.com/regionalwebsite/p_list1.php";

/** A kennel's Half-Mind directory listing page, or null for a kennel without a listing. */
export function halfMindListingUrl(listingId: string): string;
export function halfMindListingUrl(listingId: string | null | undefined): string | null;
export function halfMindListingUrl(listingId: string | null | undefined): string | null {
  return listingId ? `${LISTING_BASE}?ID=${encodeURIComponent(listingId)}` : null;
}

/** `KennelDiscovery.externalSource` for Half-Mind listings. */
export const HALF_MIND_EXTERNAL_SOURCE = "HALFMIND";
