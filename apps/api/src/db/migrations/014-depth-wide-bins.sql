BEGIN;

ALTER TABLE bins
  ADD COLUMN IF NOT EXISTS depth_units SMALLINT NOT NULL DEFAULT 1
  CHECK (depth_units BETWEEN 1 AND 12);

ALTER TABLE bins DROP CONSTRAINT IF EXISTS bins_merged_children_single_unit;
ALTER TABLE bins ADD CONSTRAINT bins_merged_children_single_unit
  CHECK (merged_into_bin_id IS NULL OR (width_units = 1 AND depth_units = 1));

COMMIT;
