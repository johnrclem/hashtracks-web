-- Add WhatsApp group/broadcast-channel URL to the Kennel profile (#1541).
--
-- MH3 Munich (mh3-de) publishes a WhatsApp broadcast channel for last-minute
-- run updates. The existing social columns (facebookUrl / instagramHandle /
-- twitterHandle / discordUrl / mailingListUrl) had no home for it, so this adds
-- a dedicated nullable column. Purely additive — every existing kennel keeps
-- NULL, no backfill required.
--
-- Hand-authored (not `prisma migrate dev`): the shadow-DB replay used by
-- `migrate dev` fails on prior data-dependent migrations that RAISE on missing
-- seed rows against an empty shadow database. Applied locally via
-- `prisma migrate deploy`; Vercel applies it the same way on deploy.

ALTER TABLE "Kennel" ADD COLUMN "whatsappUrl" TEXT;
