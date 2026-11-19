vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));
vi.mock("@/lib/db", () => ({ prisma: { kennel: { findUnique: vi.fn() } } }));

import { revalidatePath, revalidateTag } from "next/cache";
import { prisma } from "@/lib/db";
import { HARELINE_EVENTS_TAG } from "@/lib/cache-tags";
import { revalidateKennel } from "./kennel-revalidate";

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(prisma.kennel.findUnique).mockResolvedValue({ slug: "peach-fuzz-h3", region: null } as never);
});

describe("revalidateKennel", () => {
  it("revalidates the kennel pages and expires the cached hareline list", async () => {
    await revalidateKennel("k-pf");
    expect(revalidatePath).toHaveBeenCalledWith("/kennels/peach-fuzz-h3");
    expect(revalidatePath).toHaveBeenCalledWith("/hareline");
    expect(revalidateTag).toHaveBeenCalledWith(HARELINE_EVENTS_TAG, { expire: 0 });
  });

  it("leaves the hareline alone with hareline: false", async () => {
    await revalidateKennel("k-pf", { hareline: false });
    expect(revalidatePath).toHaveBeenCalledWith("/kennels/peach-fuzz-h3");
    expect(revalidatePath).toHaveBeenCalledWith("/kennels");
    expect(revalidatePath).not.toHaveBeenCalledWith("/hareline");
    expect(revalidateTag).not.toHaveBeenCalled();
  });
});
