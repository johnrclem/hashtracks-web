-- Drop the LedgerObservation census table. Recall is computed at report time from
-- actual events + PredictionSnapshot coverage (a never-predicted kennel's real run
-- is in the events with no covering snapshot → false negative), so the frozen
-- per-(kennel,band,week) census is unnecessary and overcounted the denominator
-- (Codex review on PR #2164). The FK + indexes drop with the table.
DROP TABLE "LedgerObservation";
