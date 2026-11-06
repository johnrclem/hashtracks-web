/**
 * Restore an env var after a test. Assigning `undefined` to `process.env`
 * stores the string "undefined", so delete the key instead.
 */
export function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
