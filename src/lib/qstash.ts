import { Client, Receiver } from "@upstash/qstash";

const globalForQStash = globalThis as unknown as {
  qstashClient: Client | undefined;
  qstashReceiver: Receiver | undefined;
};

/**
 * Returns a singleton QStash Client for publishing messages.
 * Lazily initialized and cached on `globalThis` to survive hot reloads.
 * Requires the `QSTASH_TOKEN` environment variable.
 */
export function getQStashClient(): Client {
  if (globalForQStash.qstashClient) return globalForQStash.qstashClient;

  const token = process.env.QSTASH_TOKEN;
  if (!token) throw new Error("QSTASH_TOKEN environment variable is not set");

  const client = new Client({ token });
  globalForQStash.qstashClient = client;
  return client;
}

/**
 * Returns a singleton QStash Receiver for verifying message signatures.
 * Lazily initialized and cached on `globalThis` to survive hot reloads.
 * Requires `QSTASH_CURRENT_SIGNING_KEY` and `QSTASH_NEXT_SIGNING_KEY`.
 */
export function getQStashReceiver(): Receiver {
  if (globalForQStash.qstashReceiver) return globalForQStash.qstashReceiver;

  const currentSigningKey = process.env.QSTASH_CURRENT_SIGNING_KEY;
  const nextSigningKey = process.env.QSTASH_NEXT_SIGNING_KEY;
  if (!currentSigningKey || !nextSigningKey) {
    throw new Error("QSTASH_CURRENT_SIGNING_KEY and QSTASH_NEXT_SIGNING_KEY must be set");
  }

  const receiver = new Receiver({ currentSigningKey, nextSigningKey });
  globalForQStash.qstashReceiver = receiver;
  return receiver;
}
