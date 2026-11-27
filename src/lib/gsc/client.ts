/**
 * Google Search Console reads for the weekly scorecard (objective O1).
 *
 * Auth is a service account whose JSON key sits in `GSC_SERVICE_ACCOUNT_JSON` (Vercel Production
 * only). The service account's email must be added as a user on the `sc-domain:hashtracks.xyz`
 * property; see `docs/ops/system.md` and owner action A7. Without the key, {@link gscFromEnv}
 * returns null and every GSC measure reports "not available" instead of failing the run.
 *
 * Read-only: the only scope requested is `webmasters.readonly`.
 */
import { createSign } from "node:crypto";

export const GSC_KEY_ENV = "GSC_SERVICE_ACCOUNT_JSON";
export const GSC_PROPERTY = "sc-domain:hashtracks.xyz";

const SCOPE = "https://www.googleapis.com/auth/webmasters.readonly";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const WEBMASTERS = "https://www.googleapis.com/webmasters/v3";
const INSPECT_URL = "https://searchconsole.googleapis.com/v1/urlInspection/index:inspect";
const TIMEOUT_MS = 20_000;

export interface ServiceAccountKey {
  client_email: string;
  private_key: string;
}

export interface SitemapStatus {
  path: string;
  lastSubmitted: Date | null;
  lastDownloaded: Date | null;
  isPending: boolean;
  isSitemapsIndex: boolean;
  errors: number;
  warnings: number;
  /** URLs Google counted as submitted, summed over content types. */
  submitted: number;
}

export interface SearchTotals {
  impressions: number;
  clicks: number;
}

export interface InspectionResult {
  url: string;
  /** "PASS" (indexed), "NEUTRAL" (excluded), "FAIL", "PARTIAL" or "VERDICT_UNSPECIFIED". */
  verdict: string;
  /** Google's wording, e.g. "Submitted and indexed", "Crawled - currently not indexed". */
  coverageState: string;
}

export interface Gsc {
  serviceAccountEmail: string;
  listSitemaps(): Promise<SitemapStatus[]>;
  searchTotals(startDate: string, endDate: string): Promise<SearchTotals>;
  inspect(url: string): Promise<InspectionResult>;
}

export class GscError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GscError";
  }
}

/** The key from `GSC_SERVICE_ACCOUNT_JSON`, or null when unset. Throws on a key that is set but unusable. */
export function readServiceAccountKey(raw = process.env[GSC_KEY_ENV]): ServiceAccountKey | null {
  if (!raw?.trim()) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new GscError(`${GSC_KEY_ENV} is not valid JSON`);
  }
  const key = parsed as Partial<ServiceAccountKey> | null;
  if (typeof key?.client_email !== "string" || typeof key.private_key !== "string") {
    throw new GscError(`${GSC_KEY_ENV} lacks client_email or private_key`);
  }
  // Vercel may store the PEM with literal \n escapes.
  return { client_email: key.client_email, private_key: key.private_key.replace(/\\n/g, "\n") };
}

const b64url = (s: string | Buffer) => Buffer.from(s).toString("base64url");

/** A signed JWT assertion for Google's OAuth token endpoint (RFC 7523). */
export function signAssertion(key: ServiceAccountKey, nowSec: number): string {
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = b64url(
    JSON.stringify({ iss: key.client_email, scope: SCOPE, aud: TOKEN_URL, iat: nowSec, exp: nowSec + 3600 }),
  );
  const signer = createSign("RSA-SHA256");
  signer.update(`${header}.${claims}`);
  return `${header}.${claims}.${signer.sign(key.private_key).toString("base64url")}`;
}

const num = (v: unknown): number => (typeof v === "number" ? v : Number(v ?? 0) || 0);
const dateOrNull = (v: unknown): Date | null => (typeof v === "string" ? new Date(v) : null);

export function createGsc(key: ServiceAccountKey, fetchImpl: typeof fetch = fetch): Gsc {
  let cached: { token: string; expiresAt: number } | null = null;

  async function token(): Promise<string> {
    const now = Date.now();
    if (cached && cached.expiresAt - 60_000 > now) return cached.token;
    const res = await fetchImpl(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion: signAssertion(key, Math.floor(now / 1000)),
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) throw new GscError(`GSC token exchange: HTTP ${res.status}`);
    const body = (await res.json()) as { access_token?: string; expires_in?: number };
    if (!body.access_token) throw new GscError("GSC token exchange returned no access_token");
    cached = { token: body.access_token, expiresAt: now + num(body.expires_in ?? 3600) * 1000 };
    return cached.token;
  }

  async function call(url: string, init: RequestInit = {}): Promise<Record<string, unknown>> {
    const res = await fetchImpl(url, {
      ...init,
      headers: { Authorization: `Bearer ${await token()}`, "Content-Type": "application/json" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) throw new GscError(`GSC ${init.method ?? "GET"} ${new URL(url).pathname}: HTTP ${res.status}`);
    return (await res.json()) as Record<string, unknown>;
  }

  const site = encodeURIComponent(GSC_PROPERTY);

  return {
    serviceAccountEmail: key.client_email,
    async listSitemaps() {
      const body = await call(`${WEBMASTERS}/sites/${site}/sitemaps`);
      const rows = Array.isArray(body.sitemap) ? (body.sitemap as Array<Record<string, unknown>>) : [];
      return rows.map((r) => ({
        path: typeof r.path === "string" ? r.path : "",
        lastSubmitted: dateOrNull(r.lastSubmitted),
        lastDownloaded: dateOrNull(r.lastDownloaded),
        isPending: r.isPending === true,
        isSitemapsIndex: r.isSitemapsIndex === true,
        errors: num(r.errors),
        warnings: num(r.warnings),
        submitted: (Array.isArray(r.contents) ? (r.contents as Array<Record<string, unknown>>) : []).reduce(
          (sum, c) => sum + num(c.submitted),
          0,
        ),
      }));
    },
    async searchTotals(startDate, endDate) {
      const body = await call(`${WEBMASTERS}/sites/${site}/searchAnalytics/query`, {
        method: "POST",
        body: JSON.stringify({ startDate, endDate, dataState: "all" }),
      });
      const row = (Array.isArray(body.rows) ? body.rows[0] : undefined) as Record<string, unknown> | undefined;
      return { impressions: num(row?.impressions), clicks: num(row?.clicks) };
    },
    async inspect(url) {
      const body = await call(INSPECT_URL, {
        method: "POST",
        body: JSON.stringify({ inspectionUrl: url, siteUrl: GSC_PROPERTY }),
      });
      const status = ((body.inspectionResult as Record<string, unknown> | undefined)?.indexStatusResult ?? {}) as Record<
        string,
        unknown
      >;
      return {
        url,
        verdict: typeof status.verdict === "string" ? status.verdict : "VERDICT_UNSPECIFIED",
        coverageState: typeof status.coverageState === "string" ? status.coverageState : "",
      };
    },
  };
}

/** The GSC client, or null when `GSC_SERVICE_ACCOUNT_JSON` is unset (owner action A7 not done yet). */
export function gscFromEnv(fetchImpl: typeof fetch = fetch): Gsc | null {
  const key = readServiceAccountKey();
  return key ? createGsc(key, fetchImpl) : null;
}
