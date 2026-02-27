import { verifyCronAuth } from "./cron-auth";
import { getQStashReceiver } from "@/lib/qstash";

vi.mock("@/lib/qstash");

const CRON_SECRET = "test-cron-secret-123";

function makeRequest(headers: Record<string, string> = {}, body = ""): Request {
  return new Request("https://example.com/api/cron/dispatch", {
    method: "POST",
    headers,
    body,
  });
}

describe("verifyCronAuth", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    process.env.CRON_SECRET = CRON_SECRET;
  });

  afterEach(() => {
    delete process.env.CRON_SECRET;
  });

  it("authenticates valid Bearer CRON_SECRET", async () => {
    const req = makeRequest({ authorization: `Bearer ${CRON_SECRET}` });
    const result = await verifyCronAuth(req);
    expect(result).toEqual({ authenticated: true, method: "bearer" });
  });

  it("rejects invalid Bearer token", async () => {
    const req = makeRequest({ authorization: "Bearer wrong-secret" });
    const result = await verifyCronAuth(req);
    expect(result).toEqual({ authenticated: false, method: "none" });
  });

  it("rejects when no auth headers provided", async () => {
    const req = makeRequest();
    const result = await verifyCronAuth(req);
    expect(result).toEqual({ authenticated: false, method: "none" });
  });

  it("rejects when CRON_SECRET is not set and no QStash signature", async () => {
    delete process.env.CRON_SECRET;
    const req = makeRequest({ authorization: "Bearer anything" });
    const result = await verifyCronAuth(req);
    expect(result).toEqual({ authenticated: false, method: "none" });
  });

  it("authenticates valid QStash signature", async () => {
    const mockReceiver = { verify: vi.fn().mockResolvedValue(true) };
    vi.mocked(getQStashReceiver).mockReturnValue(mockReceiver as never);

    const req = makeRequest({ "upstash-signature": "valid-sig" }, "{}");
    const result = await verifyCronAuth(req);

    expect(result).toEqual({ authenticated: true, method: "qstash" });
    expect(mockReceiver.verify).toHaveBeenCalledWith({
      signature: "valid-sig",
      body: "{}",
    });
  });

  it("falls back to Bearer when QStash signature is invalid", async () => {
    const mockReceiver = { verify: vi.fn().mockRejectedValue(new Error("invalid")) };
    vi.mocked(getQStashReceiver).mockReturnValue(mockReceiver as never);

    const req = makeRequest({
      "upstash-signature": "bad-sig",
      authorization: `Bearer ${CRON_SECRET}`,
    }, "{}");
    const result = await verifyCronAuth(req);

    expect(result).toEqual({ authenticated: true, method: "bearer" });
  });

  it("rejects when both QStash signature and Bearer are invalid", async () => {
    const mockReceiver = { verify: vi.fn().mockRejectedValue(new Error("invalid")) };
    vi.mocked(getQStashReceiver).mockReturnValue(mockReceiver as never);

    const req = makeRequest({
      "upstash-signature": "bad-sig",
      authorization: "Bearer wrong-secret",
    }, "{}");
    const result = await verifyCronAuth(req);

    expect(result).toEqual({ authenticated: false, method: "none" });
  });
});
