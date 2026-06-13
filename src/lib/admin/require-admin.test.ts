import { getAdminUser } from "@/lib/auth";
import { mockAdminUser } from "@/test/factories";
import { requireAdmin } from "./require-admin";

vi.mock("@/lib/auth", () => ({
  getAdminUser: vi.fn(),
}));

describe("requireAdmin", () => {
  beforeEach(() => {
    vi.mocked(getAdminUser).mockReset();
  });

  it("throws Unauthorized when the caller is not an admin", async () => {
    vi.mocked(getAdminUser).mockResolvedValue(null);
    await expect(requireAdmin()).rejects.toThrow("Unauthorized");
  });

  it("returns the admin user when the caller is an admin", async () => {
    vi.mocked(getAdminUser).mockResolvedValue(mockAdminUser as never);
    await expect(requireAdmin()).resolves.toBe(mockAdminUser);
  });
});
