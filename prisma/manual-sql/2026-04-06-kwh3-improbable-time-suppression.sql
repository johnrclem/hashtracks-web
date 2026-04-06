-- Suppress event-improbable-time findings for Key West H3.
-- KWH3 legitimately runs late-night/overnight events; verified against the source
-- Google Calendar in audit issue #461.

INSERT INTO "AuditSuppression" ("id", "kennelCode", "rule", "reason", "createdBy", "createdAt")
VALUES (
  'csup_kwh3_improbable_time',
  'kwh3',
  'event-improbable-time',
  'Key West H3 legitimately runs late-night/overnight events (verified against source Google Calendar in #461)',
  'johnrclem',
  NOW()
)
ON CONFLICT ("kennelCode", "rule") DO NOTHING;
