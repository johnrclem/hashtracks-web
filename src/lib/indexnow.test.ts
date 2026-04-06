import { pingIndexNow } from "@/lib/indexnow";

const ENDPOINT = "https://api.indexnow.org/IndexNow";

describe("pingIndexNow", () => {
  const originalFetch = global.fetch;
  const originalKey = process.env.INDEXNOW_KEY;
  const originalVercelEnv = process.env.VERCEL_ENV;

  beforeEach(() => {
    process.env.INDEXNOW_KEY = "test-key-1234";
    process.env.VERCEL_ENV = "production";
    global.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200 });
  });

  afterEach(() => {
    global.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.INDEXNOW_KEY;
    else process.env.INDEXNOW_KEY = originalKey;
    if (originalVercelEnv === undefined) delete process.env.VERCEL_ENV;
    else process.env.VERCEL_ENV = originalVercelEnv;
    vi.restoreAllMocks();
  });

  it("submits a POST with the expected payload shape", async () => {
    const urls = [
      "https://www.hashtracks.xyz/hareline/abc",
      "https://www.hashtracks.xyz/hareline/def",
    ];
    await pingIndexNow(urls);

    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [endpoint, init] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(endpoint).toBe(ENDPOINT);
    expect(init.method).toBe("POST");
    const body = JSON.parse(init.body);
    expect(body.host).toBe("www.hashtracks.xyz");
    expect(body.key).toBe("test-key-1234");
    expect(body.keyLocation).toBe("https://www.hashtracks.xyz/test-key-1234.txt");
    expect(body.urlList).toEqual(urls);
  });

  it("deduplicates URLs", async () => {
    await pingIndexNow([
      "https://www.hashtracks.xyz/hareline/abc",
      "https://www.hashtracks.xyz/hareline/abc",
      "https://www.hashtracks.xyz/hareline/def",
    ]);
    const body = JSON.parse(
      (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body,
    );
    expect(body.urlList).toHaveLength(2);
  });

  it("is a no-op when INDEXNOW_KEY is unset", async () => {
    delete process.env.INDEXNOW_KEY;
    await pingIndexNow(["https://www.hashtracks.xyz/hareline/abc"]);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("is a no-op outside production VERCEL_ENV", async () => {
    process.env.VERCEL_ENV = "preview";
    await pingIndexNow(["https://www.hashtracks.xyz/hareline/abc"]);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("is a no-op when VERCEL_ENV is unset (local dev)", async () => {
    delete process.env.VERCEL_ENV;
    await pingIndexNow(["https://www.hashtracks.xyz/hareline/abc"]);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("is a no-op for empty input", async () => {
    await pingIndexNow([]);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("does not throw on network failure", async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error("network down"));
    await expect(
      pingIndexNow(["https://www.hashtracks.xyz/hareline/abc"]),
    ).resolves.toBeUndefined();
  });

  it("does not throw on non-OK response", async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 422 });
    await expect(
      pingIndexNow(["https://www.hashtracks.xyz/hareline/abc"]),
    ).resolves.toBeUndefined();
  });
});
