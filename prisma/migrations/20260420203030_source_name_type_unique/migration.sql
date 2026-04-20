-- Enforce (name, type) as Source identity at the DB layer.
-- prisma/seed.ts::ensureSources already upserts by (name, type) in app code;
-- this index makes the invariant impossible to violate via admin creation,
-- manual SQL, or future seed edits that collide on (name, type).
-- See #817 for the HARRIER_CENTRAL collapse that motivated this guard.
CREATE UNIQUE INDEX "Source_name_type_key" ON "Source"("name", "type");
