ALTER TABLE bins
  ADD COLUMN IF NOT EXISTS width_units SMALLINT NOT NULL DEFAULT 1 CHECK (width_units BETWEEN 1 AND 12),
  ADD COLUMN IF NOT EXISTS merged_into_bin_id UUID REFERENCES bins(id) ON DELETE SET NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'bins_merged_into_not_self'
  ) THEN
    ALTER TABLE bins ADD CONSTRAINT bins_merged_into_not_self
      CHECK (merged_into_bin_id IS NULL OR merged_into_bin_id <> id);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'bins_merged_children_single_unit'
  ) THEN
    ALTER TABLE bins ADD CONSTRAINT bins_merged_children_single_unit
      CHECK (merged_into_bin_id IS NULL OR width_units = 1);
  END IF;
END $$;
