ALTER TABLE racks DROP CONSTRAINT IF EXISTS racks_map_width_check;
ALTER TABLE racks ADD CONSTRAINT racks_map_width_check
  CHECK (map_width BETWEEN 160 AND 2000);
