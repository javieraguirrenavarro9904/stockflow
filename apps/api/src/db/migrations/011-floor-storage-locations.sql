ALTER TABLE rack_levels DROP CONSTRAINT IF EXISTS rack_levels_level_number_check;
ALTER TABLE rack_levels ADD CONSTRAINT rack_levels_level_number_check CHECK (level_number >= 0);

INSERT INTO rack_levels (rack_id, level_number, height_cm)
SELECT r.id, 0, 1
FROM racks r
WHERE NOT EXISTS (
  SELECT 1 FROM rack_levels rl WHERE rl.rack_id = r.id AND rl.level_number = 0
);

WITH rack_slots AS (
  SELECT rl.rack_id,
         max((regexp_match(b.code, '-([0-9]+)$'))[1]::int) AS bins_per_level,
         max(b.depth_position)::int AS depth_slots
  FROM rack_levels rl
  JOIN bins b ON b.rack_level_id = rl.id
  WHERE rl.level_number > 0
  GROUP BY rl.rack_id
)
INSERT INTO bins (rack_level_id, code, barcode, map_x, map_y, map_width, map_height, depth_position)
SELECT floor_level.id,
       w.code || '-' || z.code || '-' || a.code || '-' || r.code || '-00' ||
         CASE WHEN positions.depth_position = 1 THEN '' ELSE '-D' || lpad(positions.depth_position::text, 2, '0') END ||
         '-' || lpad(positions_slots.slot_position::text, 2, '0'),
       'LOC-' || w.code || '-' || z.code || '-' || a.code || '-' || r.code || '-00' ||
         CASE WHEN positions.depth_position = 1 THEN '' ELSE '-D' || lpad(positions.depth_position::text, 2, '0') END ||
         '-' || lpad(positions_slots.slot_position::text, 2, '0'),
       r.map_x + 22 + (positions_slots.slot_position - 1) * (GREATEST(5, floor((r.map_width - 44) / rack_slots.bins_per_level) - 6) + 6),
       r.map_y + 38,
       GREATEST(5, floor((r.map_width - 44) / rack_slots.bins_per_level) - 6),
       GREATEST(20, floor((r.map_height - 56) /
         GREATEST(1, (SELECT count(*) FROM rack_levels normal_levels
                      WHERE normal_levels.rack_id = r.id AND normal_levels.level_number > 0))) - 8),
       positions.depth_position
FROM racks r
JOIN aisles a ON a.id = r.aisle_id
JOIN zones z ON z.id = a.zone_id
JOIN warehouses w ON w.id = z.warehouse_id
JOIN rack_slots ON rack_slots.rack_id = r.id
JOIN rack_levels floor_level ON floor_level.rack_id = r.id AND floor_level.level_number = 0
CROSS JOIN LATERAL generate_series(1, rack_slots.depth_slots) AS positions(depth_position)
CROSS JOIN LATERAL generate_series(1, rack_slots.bins_per_level) AS positions_slots(slot_position)
ON CONFLICT (code) DO NOTHING;
