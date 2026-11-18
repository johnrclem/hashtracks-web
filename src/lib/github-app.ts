/**
 * The server's GitHub credential: installation tokens of the "HashTracks Server" GitHub App
 * (ops plan S4, H3; docs/ops/system.md#identity). The App can read and write issues and read pull
 * requests, contents and metadata, and nothing else, so a leak from Vercel can't push, merge,
 * label a PR as the owner or approve anything. Approval checks don't use it: they keep the
 * read-only `GITHUB_APPROVAL_READ_TOKEN` (src/lib/backfill/approval.ts).
 *
 * Env, Production only: `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY` (the PEM GitHub generated, with
 * real newlines or `\n` escapes) and, optionally, `GITHUB_APP_INSTALLATION_ID` (looked up from the
 * repository when unset).
 *
 * CUTOVER FALLBACK: until the owner creates the App, the server keeps using `GITHUB_TOKEN`, the
 * owner's PAT, and warns once per process. Once any `GITHUB_APP_*` variable is set the fallback is
 * never used, not even when the App fails, so removing `GITHUB_TOKEN` from Vercel afterwards is
 * safe. To retire it, delete `patFallback` and its tests.
 */
import { createPrivateKey, sign } from "node:crypto";
import { getValidatedRepo } from "@/lib/github-repo";

const API_ORIGIN = "https://api.github.com";
const TIMEOUT_MS = 10_000;
/** Mint a new token once the cached one has less than this left (they last an hour). */
const REFRESH_MARGIN_MS = 5 * 60_000;
const INSTALLATION_ID_RE = /^\d{1,12}$/;

/** What call sites say when no credential is available; the reason is in the logs. */
export const NO_GITHUB_CREDENTIAL = "no GitHub credential (the server App failed or isn't configured; see the logs)";

export interface ServerGithubAuth {
  token: string;
  /** `app`: an installation token. `pat-fallback`: the owner's `GITHUB_TOKEN` (cutover only). */
  source: "app" | "pat-fallback";
  /** What GitHub granted the installation token (`{ issues: "write", … }`); null for the PAT. */
  permissions: Record<string, string> | null;
}

/** The App is configured but unusable: partial env, a bad key, or GitHub refused the token. */
export class GithubAppError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GithubAppError";
  }
}

interface AppConfig {
  appId: string;
  privateKey: string;
  installationId: string | null;
}

type Env = Record<string, string | undefined>;

/** `null`: no App variable is set. Throws when only some are, so a typo never falls back to the PAT. */
function readAppConfig(env: Env): AppConfig | null {
  const appId = env.GITHUB_APP_ID?.trim() || "";
  const key = env.GITHUB_APP_PRIVATE_KEY?.trim() || "";
  const installationId = env.GITHUB_APP_INSTALLATION_ID?.trim() || "";
  if (!appId && !key && !installationId) return null;
  if (!appId || !key) throw new GithubAppError("the server GitHub App needs both GITHUB_APP_ID and GITHUB_APP_PRIVATE_KEY");
  if (installationId && !INSTALLATION_ID_RE.test(installationId)) {
    throw new GithubAppError("GITHUB_APP_INSTALLATION_ID must be a number");
  }
  return { appId, privateKey: key.replaceAll(String.raw`\n`, "\n"), installationId: installationId || null };
}

/** A GitHub App JWT (RS256, valid for 9 minutes, issued a minute early for clock drift). */
export function appJwt(appId: string, privateKeyPem: string, nowMs: number): string {
  const now = Math.floor(nowMs / 1000);
  const part = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const unsigned = `${part({ alg: "RS256", typ: "JWT" })}.${part({ iat: now - 60, exp: now + 9 * 60, iss: appId })}`;
  let key;
  try {
    key = createPrivateKey(privateKeyPem);
  } catch {
    // Never echo the key material.
    throw new GithubAppError("GITHUB_APP_PRIVATE_KEY isn't a readable PEM private key");
  }
  return `${unsigned}.${sign("RSA-SHA256", Buffer.from(unsigned), key).toString("base64url")}`;
}

export interface ServerGithubAuthProvider {
  /** Some credential is set (the App, or the PAT fallback). It may still fail when used. */
  configured(): boolean;
  /** A usable credential, or null when none is set. Throws {@link GithubAppError} when the App fails. */
  get(): Promise<ServerGithubAuth | null>;
}

export function createServerGithubAuth(
  options: { env?: Env; fetchImpl?: typeof fetch; now?: () => number } = {},
): ServerGithubAuthProvider {
  // Read per call: tests (and Next's env handling) may replace process.env after this module loads.
  const envNow = (): Env => options.env ?? process.env;
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? Date.now;
  let cached: { key: string; auth: ServerGithubAuth; expiresAt: number } | null = null;
  let inflight: { key: string; promise: Promise<ServerGithubAuth> } | null = null;
  let warnedFallback = false;

  async function appCall(path: string, jwt: string, init: RequestInit = {}): Promise<Record<string, unknown>> {
    const url = new URL(path, API_ORIGIN);
    // Installation ids are no secret, but keep messages stable across installations.
    const what = `GitHub App ${init.method ?? "GET"} ${path.replaceAll(/\d+/g, ":id")}`;
    let res: Response;
    try {
      res = await fetchImpl(url, {
        ...init,
        headers: {
          Authorization: `Bearer ${jwt}`,
          Accept: "application/vnd.github+json",
          "Content-Type": "application/json",
          "X-GitHub-Api-Version": "2022-11-28",
        },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (err) {
      throw new GithubAppError(`${what} failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    if (!res.ok) throw new GithubAppError(`${what}: HTTP ${res.status}`);
    return (await res.json()) as Record<string, unknown>;
  }

  async function mint(cfg: AppConfig): Promise<ServerGithubAuth & { expiresAt: number }> {
    const repo = getValidatedRepo();
    const jwt = appJwt(cfg.appId, cfg.privateKey, now());
    let installationId = cfg.installationId;
    if (!installationId) {
      const found = String((await appCall(`/repos/${repo}/installation`, jwt)).id ?? "");
      if (!INSTALLATION_ID_RE.test(found)) throw new GithubAppError("the server App isn't installed on the repository");
      installationId = found;
    }
    // Scope the token to this one repository, whatever else the App is installed on.
    const body = await appCall(`/app/installations/${installationId}/access_tokens`, jwt, {
      method: "POST",
      body: JSON.stringify({ repositories: [repo.split("/")[1]] }),
    });
    const token = typeof body.token === "string" ? body.token : "";
    const expiresAt = Date.parse(typeof body.expires_at === "string" ? body.expires_at : "");
    if (!token || !Number.isFinite(expiresAt)) throw new GithubAppError("GitHub returned an installation token without a token or expiry");
    const permissions = body.permissions && typeof body.permissions === "object" ? (body.permissions as Record<string, string>) : {};
    return { token, source: "app", permissions, expiresAt };
  }

  function patFallback(env: Env): ServerGithubAuth | null {
    const token = env.GITHUB_TOKEN;
    if (!token) return null;
    if (!warnedFallback) {
      warnedFallback = true;
      console.warn("[github-app] the server GitHub App isn't configured; using the GITHUB_TOKEN fallback (docs/ops/system.md#identity)");
    }
    return { token, source: "pat-fallback", permissions: null };
  }

  return {
    configured() {
      const env = envNow();
      return Boolean(env.GITHUB_APP_ID || env.GITHUB_APP_PRIVATE_KEY || env.GITHUB_APP_INSTALLATION_ID || env.GITHUB_TOKEN);
    },
    async get() {
      const env = envNow();
      const cfg = readAppConfig(env);
      if (!cfg) return patFallback(env);
      const key = `${cfg.appId}:${cfg.installationId ?? ""}`;
      if (cached?.key === key && cached.expiresAt - now() > REFRESH_MARGIN_MS) return cached.auth;
      if (inflight?.key === key) return inflight.promise;
      const promise = mint(cfg).then(({ expiresAt, ...auth }) => {
        cached = { key, auth, expiresAt };
        return auth;
      });
      inflight = { key, promise };
      // Concurrent callers share one mint. Clear it once settled, so a failure is retried next call.
      const clear = () => {
        if (inflight?.promise === promise) inflight = null;
      };
      promise.then(clear, clear);
      return promise;
    },
  };
}

const serverAuth = createServerGithubAuth();

/** True when the server has some GitHub credential configured. */
export function hasServerGithubCredential(): boolean {
  return serverAuth.configured();
}

/** The credential with its source and granted permissions. Throws {@link GithubAppError} when the App fails. */
export function serverGithubAuth(): Promise<ServerGithubAuth | null> {
  return serverAuth.get();
}

/**
 * A token for the server's GitHub calls, or null when there is none. Never throws: an App failure
 * is logged and comes back as null, so callers keep their "no credential" path.
 */
export async function serverGithubToken(): Promise<string | null> {
  try {
    return (await serverAuth.get())?.token ?? null;
  } catch (err) {
    console.error("[github-app] couldn't get a GitHub token:", err instanceof Error ? err.message : String(err));
    return null;
  }
}

/** Like {@link serverGithubToken}, but throws when there is none (for clients that fail loudly). */
export async function requireServerGithubToken(): Promise<string> {
  const auth = await serverAuth.get();
  if (!auth) throw new GithubAppError(NO_GITHUB_CREDENTIAL);
  return auth.token;
}
