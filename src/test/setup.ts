import { vi } from "vitest";

// Auto-mock analytics server — most server action tests import modules
// that transitively depend on posthog-node (not installed in test env)
vi.mock("@/lib/analytics-server", () => ({
  getServerPostHog: vi.fn(() => null),
  captureServerEvent: vi.fn(),
  identifyServerUser: vi.fn(),
}));
