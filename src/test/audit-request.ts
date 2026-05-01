/**
 * Shared test helper for POST routes that expect Origin + JSON body.
 * Both `mint-filing-nonce/route.test.ts` and `file-finding/route.test.ts`
 * use this — keeps the request-construction shape DRY across the
 * audit-api test suite.
 */

export interface ApiPostInit {
  /** `undefined` → default to canonical site origin. `null` → omit
   *  the Origin header entirely (test the missing-Origin path). Any
   *  string value → set verbatim (test foreign / malformed origins). */
  origin?: string | null;
  /** Object body — JSON.stringify'd. Mutually exclusive with `bodyText`. */
  body?: unknown;
  /** Raw string body — used to test malformed JSON. Takes precedence
   *  over `body`. */
  bodyText?: string;
}

const DEFAULT_ORIGIN = "https://www.hashtracks.xyz";

export function buildApiPostRequest(
  url: string,
  defaultBody: unknown,
  opts: ApiPostInit = {},
): Request {
  const origin = opts.origin === undefined ? DEFAULT_ORIGIN : opts.origin;
  const headers = new Headers();
  if (origin !== null) headers.set("origin", origin);
  headers.set("content-type", "application/json");
  const init: RequestInit = { method: "POST", headers };
  if (opts.bodyText !== undefined) {
    init.body = opts.bodyText;
  } else {
    init.body = JSON.stringify(opts.body ?? defaultBody);
  }
  return new Request(url, init);
}
