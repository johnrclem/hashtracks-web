import { encryptToken, decryptToken } from "./crypto";

const VALID_KEY = "a".repeat(64); // 32 bytes of 0xaa

describe("strava token crypto", () => {
  const originalKey = process.env.STRAVA_TOKEN_KEY;

  afterEach(() => {
    if (originalKey === undefined) delete process.env.STRAVA_TOKEN_KEY;
    else process.env.STRAVA_TOKEN_KEY = originalKey;
  });

  it("roundtrips encrypt -> decrypt when key is set", () => {
    process.env.STRAVA_TOKEN_KEY = VALID_KEY;
    const plaintext = "strava-access-token-xyz123";
    const cipher = encryptToken(plaintext);
    expect(cipher).toMatch(/^enc:v1:/);
    expect(cipher).not.toContain(plaintext);
    expect(decryptToken(cipher)).toBe(plaintext);
  });

  it("produces distinct ciphertexts for the same input (random IV)", () => {
    process.env.STRAVA_TOKEN_KEY = VALID_KEY;
    const a = encryptToken("token");
    const b = encryptToken("token");
    expect(a).not.toBe(b);
    expect(decryptToken(a)).toBe("token");
    expect(decryptToken(b)).toBe("token");
  });

  it("passes legacy plaintext through decryptToken unchanged", () => {
    process.env.STRAVA_TOKEN_KEY = VALID_KEY;
    const legacy = "legacy-plaintext-token";
    expect(decryptToken(legacy)).toBe(legacy);
  });

  it("is a no-op when STRAVA_TOKEN_KEY is unset", () => {
    delete process.env.STRAVA_TOKEN_KEY;
    const plaintext = "token";
    expect(encryptToken(plaintext)).toBe(plaintext);
    expect(decryptToken(plaintext)).toBe(plaintext);
  });

  it("rejects a non-32-byte key", () => {
    process.env.STRAVA_TOKEN_KEY = "deadbeef";
    expect(() => encryptToken("token")).toThrow(/32 bytes/);
  });

  it("throws when asked to decrypt enc:v1: payload without a key", () => {
    process.env.STRAVA_TOKEN_KEY = VALID_KEY;
    const cipher = encryptToken("token");
    delete process.env.STRAVA_TOKEN_KEY;
    expect(() => decryptToken(cipher)).toThrow(
      /STRAVA_TOKEN_KEY is not configured/,
    );
  });

  it("fails authentication tag verification when ciphertext is tampered", () => {
    process.env.STRAVA_TOKEN_KEY = VALID_KEY;
    const cipher = encryptToken("token");
    const tampered = cipher.slice(0, -2) + "AA";
    expect(() => decryptToken(tampered)).toThrow();
  });
});
