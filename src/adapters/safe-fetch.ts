/**
 * SSRF-safe fetch wrapper.
 * Validates URLs against private/reserved ranges before making requests.
 * All adapter fetches should use this instead of raw `fetch()`.
 */
import { validateSourceUrl } from "./utils";

export async function safeFetch(url: string, init?: RequestInit): Promise<Response> {
  validateSourceUrl(url);
  return fetch(url, init);
}
