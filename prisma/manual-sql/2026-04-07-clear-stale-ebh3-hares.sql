-- Clear stale "Sign up!" haresText left over before PR #469's hare-cta filter shipped.
-- The adapter regex now strips this on every scrape; this is a one-shot cleanup
-- of the cached event row that the audit is still flagging.
-- Audit issue: #486 (closes after this runs).

UPDATE "Event"
SET "haresText" = NULL
WHERE id = 'cmndhtst7000a04jxmqbajxuv';
