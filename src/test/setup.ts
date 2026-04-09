import { vi } from "vitest";

// Auto-mock analytics server — most server action tests import modules
// that transitively depend on posthog-node (not installed in test env)
vi.mock("@/lib/analytics-server", () => ({
  getServerPostHog: vi.fn(() => null),
  captureServerEvent: vi.fn(),
  identifyServerUser: vi.fn(),
}));

// Auto-mock DNS lookups used by validateSourceUrlWithDns. Most adapter
// and pipeline tests mock `fetch` directly and don't care about the real
// hostname — so we stub dns.lookup to return a single public IP. Tests
// that need to assert DNS-based SSRF behaviour (see utils.test.ts) override
// this mock locally with `mockLookup.mockResolvedValueOnce(...)`.
vi.mock("node:dns/promises", () => ({
  lookup: vi.fn().mockResolvedValue([
    { address: "93.184.216.34", family: 4 },
  ]),
}));
