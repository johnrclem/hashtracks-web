/** True when a Clerk user's public metadata marks them as a site admin. */
export function isAdminUser(user: { publicMetadata?: unknown } | null | undefined): boolean {
  return (user?.publicMetadata as { role?: string } | undefined)?.role === "admin";
}
