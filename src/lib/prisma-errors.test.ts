import { describe, it, expect } from "vitest";

import { Prisma } from "@/generated/prisma/client";
import { isUniqueConstraintViolation } from "@/lib/prisma-errors";
import { buildPrismaUniqueViolation } from "@/test/factories";

describe("isUniqueConstraintViolation", () => {
  it.each([
    // [label, err, required, expected]
    [
      "no-arg form matches any P2002",
      buildPrismaUniqueViolation(["x"]),
      undefined,
      true,
    ],
    [
      "array-target shape — exact match",
      buildPrismaUniqueViolation(["sourceId", "fingerprint"]),
      ["sourceId", "fingerprint"],
      true,
    ],
    [
      "array-target shape — wrong length (different constraint)",
      buildPrismaUniqueViolation(["sourceId", "fingerprint", "extra"]),
      ["sourceId", "fingerprint"],
      false,
    ],
    [
      "array-target shape — missing column",
      buildPrismaUniqueViolation(["sourceId", "wrong"]),
      ["sourceId", "fingerprint"],
      false,
    ],
    [
      // #1464 root cause: the production Postgres driver emits `meta.target`
      // as the constraint NAME string, not the column tuple. Pre-fix this
      // returned false and the race-window catch in merge.ts re-threw.
      "string-target shape (production Postgres) — constraint name contains both columns",
      buildPrismaUniqueViolation("RawEvent_sourceId_fingerprint_key"),
      ["sourceId", "fingerprint"],
      true,
    ],
    [
      "string-target shape — constraint name missing a required column",
      buildPrismaUniqueViolation("RawEvent_sourceId_key"),
      ["sourceId", "fingerprint"],
      false,
    ],
    [
      // Codex pass: raw substring matching would false-positive when a
      // column is a prefix of an unrelated column on the same constraint.
      // Token-boundary match must reject this.
      "string-target shape — superstring collision (fingerprintVersion ≠ fingerprint)",
      buildPrismaUniqueViolation("RawEvent_sourceId_fingerprintVersion_key"),
      ["sourceId", "fingerprint"],
      false,
    ],
    [
      "non-P2002 error never matches",
      new Prisma.PrismaClientKnownRequestError("not found", {
        code: "P2025",
        clientVersion: "0.0.0",
      }),
      ["sourceId", "fingerprint"],
      false,
    ],
    [
      "non-Prisma error never matches",
      new Error("boom"),
      undefined,
      false,
    ],
    [
      "narrowed mode with undefined meta returns false",
      new Prisma.PrismaClientKnownRequestError("missing meta", {
        code: "P2002",
        clientVersion: "0.0.0",
      }),
      ["sourceId", "fingerprint"],
      false,
    ],
  ])("%s", (_label, err, required, expected) => {
    expect(isUniqueConstraintViolation(err, required)).toBe(expected);
  });
});
