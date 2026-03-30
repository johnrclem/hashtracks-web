import { PostHog } from "posthog-node";

let posthogClient: PostHog | null = null;

export function getServerPostHog(): PostHog | null {
  if (!process.env.POSTHOG_API_KEY) return null;

  if (!posthogClient) {
    posthogClient = new PostHog(process.env.POSTHOG_API_KEY, {
      host: "https://us.i.posthog.com",
      flushAt: 1,
      flushInterval: 0,
    });
  }
  return posthogClient;
}

/**
 * Capture an event server-side. Flushes immediately for Vercel serverless
 * reliability (function freezes after return). Safe to call even if PostHog
 * is not configured.
 */
export async function captureServerEvent(
  userId: string,
  event: string,
  properties?: Record<string, unknown>,
) {
  const ph = getServerPostHog();
  if (!ph) return;
  ph.capture({ distinctId: userId, event, properties });
  await ph.flush();
}

/**
 * Identify a user server-side with person properties.
 */
export async function identifyServerUser(
  userId: string,
  properties: Record<string, unknown>,
) {
  const ph = getServerPostHog();
  if (!ph) return;
  ph.identify({ distinctId: userId, properties });
  await ph.flush();
}
