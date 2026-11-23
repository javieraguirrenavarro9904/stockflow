ALTER TABLE warehouses
  ALTER COLUMN map_width SET DEFAULT 5000,
  ALTER COLUMN map_height SET DEFAULT 3000,
  ADD COLUMN IF NOT EXISTS map_perimeter JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE warehouses DROP CONSTRAINT IF EXISTS warehouses_map_width_check;
ALTER TABLE warehouses ADD CONSTRAINT warehouses_map_width_check
  CHECK (map_width BETWEEN 520 AND 30000);
ALTER TABLE warehouses DROP CONSTRAINT IF EXISTS warehouses_map_height_check;
ALTER TABLE warehouses ADD CONSTRAINT warehouses_map_height_check
  CHECK (map_height BETWEEN 340 AND 30000);
ALTER TABLE warehouses DROP CONSTRAINT IF EXISTS warehouses_map_perimeter_check;
ALTER TABLE warehouses ADD CONSTRAINT warehouses_map_perimeter_check
  CHECK (jsonb_typeof(map_perimeter) = 'array');

UPDATE warehouses
SET map_width = 5000, map_height = 3000
WHERE map_width = 1600 AND map_height = 1000;
