-- Align PredictionSnapshot.independentSourceIds with the required `String[] @default([])`
-- schema field (CodeRabbit review on PR #2164). The original add_prediction_ledger migration
-- created it as a plain nullable TEXT[]; backfill any NULLs then enforce NOT NULL DEFAULT '{}',
-- matching the repo's array-column convention (e.g. Alert.affectedEventIds).
UPDATE "PredictionSnapshot" SET "independentSourceIds" = '{}' WHERE "independentSourceIds" IS NULL;
ALTER TABLE "PredictionSnapshot" ALTER COLUMN "independentSourceIds" SET DEFAULT '{}';
ALTER TABLE "PredictionSnapshot" ALTER COLUMN "independentSourceIds" SET NOT NULL;
