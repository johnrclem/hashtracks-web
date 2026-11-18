/**
 * Shape of an audit rule slug. Built-in audit rules and the free-form slugs
 * agents submit with their findings share it, so suppressions validate
 * against the same pattern the submit endpoint does.
 */
export const RULE_SLUG_RE = /^[a-z0-9-]{1,64}$/;
