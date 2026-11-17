vi.mock("@/lib/db", () => ({ prisma: {} }));
vi.mock("@/pipeline/kennel-evidence", () => ({ refreshKennelEvidence: vi.fn() }));

import { evidenceAfter } from "./kennel-confirmations";

const d = (iso: string) => new Date(`${iso}T12:00:00Z`);
const NOW = new Date("2026-11-13T12:00:00Z");
const base = { lastRunSeenAt: null, nextRunPostedAt: null, lastConfirmedAt: null, lastConfirmedVia: null };

describe("evidenceAfter", () => {
  it("names an admin confirmation", () => {
    expect(
      evidenceAfter({ ...base, lastConfirmedAt: d("2026-10-20"), lastConfirmedVia: "ADMIN" }, d("2026-10-01"), NOW),
    ).toBe("an admin confirmed this kennel running on Oct 20, after that date");
  });
  it("names a Half-Mind check", () => {
    expect(
      evidenceAfter({ ...base, lastConfirmedAt: d("2026-10-20"), lastConfirmedVia: "HALF_MIND" }, d("2026-10-01"), NOW),
    ).toBe("the Half-Mind listing was checked on Oct 20, after that date");
  });
});
