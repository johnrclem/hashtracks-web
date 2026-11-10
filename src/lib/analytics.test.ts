const posthogMock = vi.hoisted(() => ({
  __loaded: true,
  identify: vi.fn(),
  register: vi.fn(),
  setInternalOrTestUser: vi.fn(),
  reset: vi.fn(),
  capture: vi.fn(),
}));

vi.mock("posthog-js", () => ({ default: posthogMock }));

import { __resetAnalyticsIdentityState, identifyUser, resetIdentity } from "./analytics";

beforeEach(() => {
  // The helpers no-op on the server; give them a browser global.
  vi.stubGlobal("window", {});
  vi.clearAllMocks();
  __resetAnalyticsIdentityState();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("identifyUser", () => {
  it("identifies once per user, so repeated calls from two effects are harmless", () => {
    identifyUser("user_1", { isAdmin: false });
    identifyUser("user_1", { isAdmin: false });
    expect(posthogMock.identify).toHaveBeenCalledTimes(1);
    expect(posthogMock.identify).toHaveBeenCalledWith("user_1", { is_admin: false });
    expect(posthogMock.register).not.toHaveBeenCalled();
  });

  it("tags admins as internal traffic once", () => {
    identifyUser("user_admin", { isAdmin: true });
    identifyUser("user_admin", { isAdmin: true });
    expect(posthogMock.register).toHaveBeenCalledTimes(1);
    expect(posthogMock.register).toHaveBeenCalledWith({ internal_user: true });
    expect(posthogMock.setInternalOrTestUser).toHaveBeenCalledTimes(1);
  });

  it("re-identifies when a different user signs in", () => {
    identifyUser("user_1", { isAdmin: false });
    identifyUser("user_2", { isAdmin: false });
    expect(posthogMock.identify).toHaveBeenCalledTimes(2);
  });
});

describe("resetIdentity", () => {
  it("does nothing for a visitor who was never identified", () => {
    resetIdentity();
    expect(posthogMock.reset).not.toHaveBeenCalled();
  });

  it("resets after a sign-out and allows the next sign-in to identify again", () => {
    identifyUser("user_1", { isAdmin: true });
    resetIdentity();
    expect(posthogMock.reset).toHaveBeenCalledTimes(1);
    identifyUser("user_1", { isAdmin: true });
    expect(posthogMock.identify).toHaveBeenCalledTimes(2);
    expect(posthogMock.register).toHaveBeenCalledTimes(2);
  });
});
