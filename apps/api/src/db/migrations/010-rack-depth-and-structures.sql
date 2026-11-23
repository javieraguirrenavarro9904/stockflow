ALTER TABLE racks
  ADD COLUMN IF NOT EXISTS depth_slots SMALLINT NOT NULL DEFAULT 1;
ALTER TABLE racks DROP CONSTRAINT IF EXISTS racks_depth_slots_check;
ALTER TABLE racks ADD CONSTRAINT racks_depth_slots_check CHECK (depth_slots BETWEEN 1 AND 12);

ALTER TABLE bins
  ADD COLUMN IF NOT EXISTS depth_position SMALLINT NOT NULL DEFAULT 1;
ALTER TABLE bins DROP CONSTRAINT IF EXISTS bins_depth_position_check;
ALTER TABLE bins ADD CONSTRAINT bins_depth_position_check CHECK (depth_position BETWEEN 1 AND 12);

ALTER TABLE warehouses
  ADD COLUMN IF NOT EXISTS map_structures JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE warehouses DROP CONSTRAINT IF EXISTS warehouses_map_structures_check;
ALTER TABLE warehouses ADD CONSTRAINT warehouses_map_structures_check
  CHECK (jsonb_typeof(map_structures) = 'array');
