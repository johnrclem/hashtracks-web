/**
 * Standardized return type for server actions.
 *
 * Usage:
 *   ActionResult                     → { success: true } | { error: string }
 *   ActionResult<{ id: string }>     → { success: true; id: string } | { error: string }
 */
export type ActionResult<T = Record<string, never>> =
  | ({ success: true } & T)
  | { success?: never; error: string };
