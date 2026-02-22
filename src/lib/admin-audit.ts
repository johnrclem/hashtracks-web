/**
 * Structured audit logging for admin actions.
 * Outputs pure JSON to stdout for log aggregation (Vercel, Datadog, etc.).
 */

interface AdminAuditEntry {
  auditSource: "admin";
  action: string;
  adminId: string;
  timestamp: string;
  details: Record<string, unknown>;
}

export function logAdminAudit(
  action: string,
  adminId: string,
  details: Record<string, unknown>,
): void {
  const entry: AdminAuditEntry = {
    auditSource: "admin",
    action,
    adminId,
    timestamp: new Date().toISOString(),
    details,
  };
  console.log(JSON.stringify(entry));
}
