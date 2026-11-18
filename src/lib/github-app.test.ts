import { generateKeyPairSync, verify } from "node:crypto";
import { appJwt, createServerGithubAuth, GithubAppError } from "./github-app";

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const PEM = privateKey.export({ type: "pkcs1", format: "pem" }).toString();
const NOW = Date.parse("2026-11-18T12:00:00Z");

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

function tokenResponse(token = "ghs_app", expiresAt = "2026-11-18T13:00:00Z") {
  return json({ token, expires_at: expiresAt, permissions: { issues: "write", metadata: "read" } });
}

describe("appJwt", () => {
  it("signs an RS256 JWT for the App, issued a minute early and valid under 10 minutes", () => {
    const jwt = appJwt("12345", PEM, NOW);
    const [header, payload, signature] = jwt.split(".");
    expect(JSON.parse(Buffer.from(header, "base64url").toString())).toEqual({ alg: "RS256", typ: "JWT" });
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString());
    expect(claims).toEqual({ iss: "12345", iat: NOW / 1000 - 60, exp: NOW / 1000 + 540 });
    expect(verify("RSA-SHA256", Buffer.from(`${header}.${payload}`), publicKey, Buffer.from(signature, "base64url"))).toBe(true);
  });

  it("refuses a key it can't read, without echoing it", () => {
    expect(() => appJwt("1", "not a key", NOW)).toThrow(/isn't a readable PEM/);
    expect(() => appJwt("1", "not a key", NOW)).not.toThrow(/not a key/);
  });
});

describe("createServerGithubAuth", () => {
  const appEnv = { GITHUB_APP_ID: "12345", GITHUB_APP_PRIVATE_KEY: PEM, GITHUB_APP_INSTALLATION_ID: "678" };

  it("mints an installation token scoped to the repository, and caches it", async () => {
    const fetchImpl = vi.fn(async () => tokenResponse());
    const auth = createServerGithubAuth({ env: appEnv, fetchImpl: fetchImpl as never, now: () => NOW });

    expect(await auth.get()).toEqual({ token: "ghs_app", source: "app", permissions: { issues: "write", metadata: "read" } });
    await auth.get();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [URL, RequestInit];
    expect(String(url)).toBe("https://api.github.com/app/installations/678/access_tokens");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({ repositories: ["hashtracks-web"] });
    expect((init.headers as Record<string, string>).Authorization).toMatch(/^Bearer [\w-]+\.[\w-]+\.[\w-]+$/);
  });

  it("accepts a key with escaped newlines, as Vercel may store it", async () => {
    const fetchImpl = vi.fn(async () => tokenResponse());
    const env = { ...appEnv, GITHUB_APP_PRIVATE_KEY: PEM.replaceAll("\n", String.raw`\n`) };
    await expect(createServerGithubAuth({ env, fetchImpl: fetchImpl as never, now: () => NOW }).get()).resolves.toMatchObject({ source: "app" });
  });

  it("looks the installation up from the repository when its id isn't set", async () => {
    const fetchImpl = vi.fn(async (url: URL) => (String(url).endsWith("/installation") ? json({ id: 999 }) : tokenResponse()));
    const env = { GITHUB_APP_ID: "12345", GITHUB_APP_PRIVATE_KEY: PEM };
    await createServerGithubAuth({ env, fetchImpl: fetchImpl as never, now: () => NOW }).get();
    expect(fetchImpl.mock.calls.map(([url]) => String(url))).toEqual([
      "https://api.github.com/repos/johnrclem/hashtracks-web/installation",
      "https://api.github.com/app/installations/999/access_tokens",
    ]);
  });

  it("mints again when the cached token is about to expire", async () => {
    let clock = NOW;
    const fetchImpl = vi.fn(async () => tokenResponse());
    const auth = createServerGithubAuth({ env: appEnv, fetchImpl: fetchImpl as never, now: () => clock });
    await auth.get();
    clock = Date.parse("2026-11-18T12:56:00Z"); // 4 minutes left
    await auth.get();
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("shares one mint between concurrent callers, and retries after a failure", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(json({ message: "nope" }, 401)).mockResolvedValue(tokenResponse());
    const auth = createServerGithubAuth({ env: appEnv, fetchImpl: fetchImpl as never, now: () => NOW });
    const both = await Promise.allSettled([auth.get(), auth.get()]);
    expect(both.map((r) => r.status)).toEqual(["rejected", "rejected"]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    await expect(auth.get()).resolves.toMatchObject({ token: "ghs_app" });
  });

  it("never falls back to GITHUB_TOKEN once the App is configured", async () => {
    const fetchImpl = vi.fn(async () => json({ message: "Bad credentials" }, 401));
    const auth = createServerGithubAuth({ env: { ...appEnv, GITHUB_TOKEN: "ghp_owner" }, fetchImpl: fetchImpl as never, now: () => NOW });
    await expect(auth.get()).rejects.toThrow(new GithubAppError("GitHub App POST /app/installations/:id/access_tokens: HTTP 401"));
  });

  it("refuses partial App settings instead of falling back", async () => {
    const auth = createServerGithubAuth({ env: { GITHUB_APP_ID: "12345", GITHUB_TOKEN: "ghp_owner" } });
    expect(auth.configured()).toBe(true);
    await expect(auth.get()).rejects.toThrow(/needs both GITHUB_APP_ID and GITHUB_APP_PRIVATE_KEY/);
    await expect(
      createServerGithubAuth({ env: { ...appEnv, GITHUB_APP_INSTALLATION_ID: "../x" } }).get(),
    ).rejects.toThrow(/must be a number/);
  });

  it("uses GITHUB_TOKEN, with one warning, while no App variable is set", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const auth = createServerGithubAuth({ env: { GITHUB_TOKEN: "ghp_owner" } });
    expect(await auth.get()).toEqual({ token: "ghp_owner", source: "pat-fallback", permissions: null });
    await auth.get();
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it("returns null when nothing is configured", async () => {
    const auth = createServerGithubAuth({ env: {} });
    expect(auth.configured()).toBe(false);
    expect(await auth.get()).toBeNull();
  });
});
