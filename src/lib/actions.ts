/**
 * Standardized return type for server actions.
 *
 * Usage:
 *   ActionResult                     → { success: true } | { error: string }
 *   ActionResult<{ id: string }>     → { success: true; id: string } | { error: string }
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type -- {} is intentional: "no extra fields"
export type ActionResult<T = {}> =
  | ({ success: true } & T)
  | { success?: never; error: string };
