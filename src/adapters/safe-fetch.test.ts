// SSRF/DNS validation is exercised elsewhere — stub it so these tests focus on
// the timeout-signal wiring of the direct-fetch path.
vi.mock("@/adapters/ssrf-dns", () => ({
  validateSourceUrlWithDns: vi.fn().mockResolvedValue(undefined),
}));

import { safeFetch } from "@/adapters/safe-fetch";

describe("safeFetch direct-fetch timeout", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("ok", { status: 200 }));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function initOf(callIndex: number): RequestInit | undefined {
    return fetchSpy.mock.calls[callIndex]?.[1] as RequestInit | undefined;
  }

  it("applies a default AbortSignal when the caller provides none", async () => {
    await safeFetch("https://example.com");

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(initOf(0)?.signal).toBeInstanceOf(AbortSignal);
  });

  it("uses the caller-supplied signal verbatim when provided", async () => {
    const controller = new AbortController();
    await safeFetch("https://example.com", { signal: controller.signal });

    expect(initOf(0)?.signal).toBe(controller.signal);
  });

  it("shares one signal across redirect hops (bounds total time, not per-hop)", async () => {
    fetchSpy
      .mockResolvedValueOnce(
        new Response("redirecting", {
          status: 302,
          headers: { location: "https://example.com/next" },
        }),
      )
      .mockResolvedValueOnce(new Response("ok", { status: 200 }));

    await safeFetch("https://example.com");

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    const first = initOf(0)?.signal;
    const second = initOf(1)?.signal;
    expect(first).toBeInstanceOf(AbortSignal);
    expect(second).toBe(first); // same object reused across the chain
  });
});

describe("safeFetch residential-proxy body forwarding", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;
  const prevUrl = process.env.RESIDENTIAL_PROXY_URL;
  const prevKey = process.env.RESIDENTIAL_PROXY_KEY;

  beforeEach(() => {
    process.env.RESIDENTIAL_PROXY_URL = "https://proxy.example";
    process.env.RESIDENTIAL_PROXY_KEY = "k".repeat(32);
    fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("ok", { status: 200 }));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.env.RESIDENTIAL_PROXY_URL = prevUrl;
    process.env.RESIDENTIAL_PROXY_KEY = prevKey;
  });

  function proxyPayload(): { url: string; method: string; headers: Record<string, string>; body?: string } {
    const init = fetchSpy.mock.calls[0]?.[1] as RequestInit | undefined;
    return JSON.parse(init?.body as string);
  }

  it("forwards a string POST body to the proxy (e.g. Bangkok's PHP hareline API)", async () => {
    await safeFetch("https://bangkokhash.com/api", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: '{"hashclub":"BTH3"}',
      useResidentialProxy: true,
    });

    expect(fetchSpy).toHaveBeenCalledWith(
      "https://proxy.example/proxy",
      expect.anything(),
    );
    const payload = proxyPayload();
    expect(payload.method).toBe("POST");
    expect(payload.url).toBe("https://bangkokhash.com/api");
    expect(payload.body).toBe('{"hashclub":"BTH3"}');
  });

  it("omits body for a proxied GET (no regression for body-less requests)", async () => {
    await safeFetch("https://bangkokhash.com/page", {
      useResidentialProxy: true,
    });

    const payload = proxyPayload();
    expect(payload.method).toBe("GET");
    expect(payload).not.toHaveProperty("body");
  });
});

describe("safeFetch egress selection (residential vs vpn)", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;
  const prev = {
    resUrl: process.env.RESIDENTIAL_PROXY_URL,
    resKey: process.env.RESIDENTIAL_PROXY_KEY,
    vpnUrl: process.env.VPN_PROXY_URL,
    vpnKey: process.env.VPN_PROXY_KEY,
  };

  beforeEach(() => {
    process.env.RESIDENTIAL_PROXY_URL = "https://residential.example";
    process.env.RESIDENTIAL_PROXY_KEY = "r".repeat(32);
    process.env.VPN_PROXY_URL = "https://vpn.example";
    process.env.VPN_PROXY_KEY = "v".repeat(32);
    fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("ok", { status: 200 }));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.env.RESIDENTIAL_PROXY_URL = prev.resUrl;
    process.env.RESIDENTIAL_PROXY_KEY = prev.resKey;
    process.env.VPN_PROXY_URL = prev.vpnUrl;
    process.env.VPN_PROXY_KEY = prev.vpnKey;
  });

  function targetUrl(): string {
    return fetchSpy.mock.calls[0]?.[0] as string;
  }
  function proxyKeyHeader(): string | undefined {
    const init = fetchSpy.mock.calls[0]?.[1] as RequestInit | undefined;
    return (init?.headers as Record<string, string> | undefined)?.["X-Proxy-Key"];
  }

  it('routes egress:"vpn" through the VPN relay', async () => {
    await safeFetch("https://board.atlantahash.com/feed", { egress: "vpn" });

    expect(targetUrl()).toBe("https://vpn.example/proxy");
    expect(proxyKeyHeader()).toBe("v".repeat(32));
  });

  it('routes egress:"residential" through the residential relay', async () => {
    await safeFetch("https://example.com/feed", { egress: "residential" });

    expect(targetUrl()).toBe("https://residential.example/proxy");
    expect(proxyKeyHeader()).toBe("r".repeat(32));
  });

  it("treats useResidentialProxy:true as the residential alias", async () => {
    await safeFetch("https://example.com/feed", { useResidentialProxy: true });

    expect(targetUrl()).toBe("https://residential.example/proxy");
  });

  it("lets egress take precedence over the useResidentialProxy alias", async () => {
    await safeFetch("https://board.atlantahash.com/feed", {
      egress: "vpn",
      useResidentialProxy: true,
    });

    expect(targetUrl()).toBe("https://vpn.example/proxy");
  });

  it("fails closed when an explicit vpn egress is requested but its env is unset", async () => {
    delete process.env.VPN_PROXY_URL;
    delete process.env.VPN_PROXY_KEY;

    await expect(
      safeFetch("https://board.atlantahash.com/feed", { egress: "vpn" }),
    ).rejects.toThrow(/VPN_PROXY_URL\/KEY not configured/);
    // Must NOT silently fall back to a direct fetch of the known-blocked origin.
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("legacy useResidentialProxy still falls back to a direct fetch when env is unset", async () => {
    delete process.env.RESIDENTIAL_PROXY_URL;
    delete process.env.RESIDENTIAL_PROXY_KEY;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    await safeFetch("https://example.com/feed", { useResidentialProxy: true });

    // Legacy alias keeps its graceful dev fallback: direct fetch to the target URL.
    expect(targetUrl()).toBe("https://example.com/feed");
    expect(warn).toHaveBeenCalled();
  });
});
