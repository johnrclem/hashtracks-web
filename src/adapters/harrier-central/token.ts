import { createHash } from "crypto";

/**
 * Epoch used by Harrier Central for time-based token generation.
 * Corresponds to 1963-08-15T09:52:28.000Z in Dart DateTime.
 */
const HC_EPOCH_MS = Date.UTC(1963, 7, 15, 9, 52, 28, 0);

const PUBLIC_HASHER_ID = "11111111-1111-1111-1111-111111111111";

/**
 * Generate a time-based access token for the Harrier Central public API.
 *
 * The token is a SHA-256 hash of:
 *   SHA256("{publicHasherId}#{storedProcName}#{timeSlot}".toUpperCase())
 *
 * where timeSlot = floor(floor((nowMicros - epochMicros) / 1e6) / 86469)
 *
 * Reverse-engineered from the hashruns.org Flutter web app's compiled Dart.
 */
export function generateAccessToken(queryType: string): string {
  const nowMicros = Date.now() * 1000;
  const epochMicros = HC_EPOCH_MS * 1000;
  // 86469 = time-slot divisor (seconds) from Harrier Central's Dart implementation
  const s = Math.floor(Math.floor((nowMicros - epochMicros) / 1e6) / 86469);

  const procName = `hcportal_${queryType}`;
  const input = `${PUBLIC_HASHER_ID}#${procName}#${s}`.toUpperCase();
  return createHash("sha256").update(Buffer.from(input, "utf8")).digest("hex").toUpperCase();
}

export { PUBLIC_HASHER_ID };
