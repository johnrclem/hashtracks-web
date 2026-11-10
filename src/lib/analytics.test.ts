const posthogMock = vi.hoisted(() => ({
  __loaded: true,
  identify: vi.fn(),
  register: vi.fn(),
  reset: vi.fn(),
  capture: vi.fn(),
}));
vi.mock("posthog-js", () => ({ default: posthogMock }));
vi.mock("@/lib/visit-recency", () => ({ getVisitRecency: () => "returning_1_7d" }));

// Identity state lives in module scope (one page load); load a fresh copy per test.
let analytics: typeof import("./analytics");

beforeEach(async () => {
  // The helpers no-op on the server; give them a browser global.
  vi.stubGlobal("window", {});
  vi.clearAllMocks();
  vi.resetModules();
  analytics = await import("./analytics");
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("identifyUser", () => {
  it("identifies once per user, so effects re-running are harmless", () => {
    analytics.identifyUser("user_1", { isAdmin: false });
    analytics.identifyUser("user_1", { isAdmin: false });
    expect(posthogMock.identify).toHaveBeenCalledTimes(1);
    expect(posthogMock.identify).toHaveBeenCalledWith("user_1", { is_admin: false });
    expect(posthogMock.register).not.toHaveBeenCalled();
  });

  it("tags admins as internal traffic in the same identify call", () => {
    analytics.identifyUser("user_admin", { isAdmin: true });
    analytics.identifyUser("user_admin", { isAdmin: true });
    expect(posthogMock.identify).toHaveBeenCalledTimes(1);
    expect(posthogMock.identify).toHaveBeenCalledWith("user_admin", {
      is_admin: true,
      $internal_or_test_user: true,
    });
    expect(posthogMock.register).toHaveBeenCalledWith({ internal_user: true });
  });

  it("re-identifies when a different user signs in", () => {
    analytics.identifyUser("user_1", { isAdmin: false });
    analytics.identifyUser("user_2", { isAdmin: false });
    expect(posthogMock.identify).toHaveBeenCalledTimes(2);
  });
});

describe("resetIdentity", () => {
  it("does nothing for a visitor who was never identified", () => {
    analytics.resetIdentity();
    expect(posthogMock.reset).not.toHaveBeenCalled();
  });

  it("resets after a sign-out and restores the visit_recency super property", () => {
    analytics.identifyUser("user_1", { isAdmin: false });
    analytics.resetIdentity();
    expect(posthogMock.reset).toHaveBeenCalledTimes(1);
    expect(posthogMock.register).toHaveBeenCalledWith({ visit_recency: "returning_1_7d" });
  });

  it("lets the next sign-in identify again", () => {
    analytics.identifyUser("user_1", { isAdmin: false });
    analytics.resetIdentity();
    analytics.identifyUser("user_1", { isAdmin: false });
    expect(posthogMock.identify).toHaveBeenCalledTimes(2);
  });
});
