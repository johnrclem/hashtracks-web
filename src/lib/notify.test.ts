import { afterEach, describe, expect, it, vi } from "vitest";

const send = vi.fn();
vi.mock("resend", () => ({
  Resend: vi.fn(function Resend() {
    return { emails: { send } };
  }),
}));

import { emailOwner, ownerEmailConfigured, senderAddress } from "./notify";

const email = { subject: "Hareline audit is overdue", text: "details", idempotencyKey: "ops-watchdog/x/1/overdue" };

describe("emailOwner", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it("is a no-op without RESEND_API_KEY and OWNER_EMAIL", async () => {
    vi.stubEnv("RESEND_API_KEY", "");
    vi.stubEnv("OWNER_EMAIL", "owner@example.com");
    expect(ownerEmailConfigured()).toBe(false);
    expect(await emailOwner(email)).toEqual({ sent: false, reason: "email not configured (RESEND_API_KEY, OWNER_EMAIL)" });
    expect(send).not.toHaveBeenCalled();
  });

  it("sends through Resend with the idempotency key", async () => {
    vi.stubEnv("RESEND_API_KEY", "re_test");
    vi.stubEnv("OWNER_EMAIL", "owner@example.com");
    vi.stubEnv("NOTIFY_FROM_EMAIL", "");
    vi.stubEnv("RESEND_EMAIL_DOMAIN", "");
    send.mockResolvedValue({ data: { id: "em_1" }, error: null });

    expect(ownerEmailConfigured()).toBe(true);
    expect(await emailOwner(email)).toEqual({ sent: true, id: "em_1" });
    expect(send).toHaveBeenCalledWith(
      {
        from: "HashTracks <onboarding@resend.dev>",
        to: "owner@example.com",
        subject: "[HashTracks] Hareline audit is overdue",
        text: "details",
      },
      { idempotencyKey: "ops-watchdog/x/1/overdue" },
    );
  });

  it("reports a Resend error or exception as not sent", async () => {
    vi.stubEnv("RESEND_API_KEY", "re_test");
    vi.stubEnv("OWNER_EMAIL", "owner@example.com");
    send.mockResolvedValueOnce({ data: null, error: { message: "domain not verified", statusCode: 403, name: "x" } });
    expect(await emailOwner(email)).toEqual({ sent: false, reason: "Resend: domain not verified" });
    send.mockRejectedValueOnce(new Error("socket hang up"));
    expect(await emailOwner(email)).toEqual({ sent: false, reason: "Resend: socket hang up" });
  });
});

describe("senderAddress", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("prefers NOTIFY_FROM_EMAIL", () => {
    vi.stubEnv("NOTIFY_FROM_EMAIL", "Ops <ops@hashtracks.xyz>");
    vi.stubEnv("RESEND_EMAIL_DOMAIN", "mail.example.com");
    expect(senderAddress()).toBe("Ops <ops@hashtracks.xyz>");
  });

  it("falls back to ops@ the Marketplace sending domain, bare or as an address", () => {
    vi.stubEnv("NOTIFY_FROM_EMAIL", "");
    vi.stubEnv("RESEND_EMAIL_DOMAIN", " Mail.Example.com ");
    expect(senderAddress()).toBe("HashTracks Ops <ops@mail.example.com>");
    vi.stubEnv("RESEND_EMAIL_DOMAIN", "noreply@mail.example.com");
    expect(senderAddress()).toBe("HashTracks Ops <ops@mail.example.com>");
  });

  it("ignores a malformed domain and uses Resend's test sender", () => {
    vi.stubEnv("NOTIFY_FROM_EMAIL", "");
    for (const bad of ["", "localhost", "evil.com>\nBcc: x@y.z", "-bad.com", "a..com"]) {
      vi.stubEnv("RESEND_EMAIL_DOMAIN", bad);
      expect(senderAddress()).toBe("HashTracks <onboarding@resend.dev>");
    }
  });
});
