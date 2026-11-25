BEGIN;

SELECT pg_advisory_xact_lock(21703, 13);

DO $migration$
DECLARE
  duplicate_rack RECORD;
  suffix_number INTEGER;
  suffix TEXT;
  candidate_code TEXT;
BEGIN
  IF EXISTS (
    SELECT 1 FROM app_settings WHERE key = 'location_code_format_v1'
  ) THEN
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM bins WHERE code !~ '-[0-9]+$') THEN
    RAISE EXCEPTION 'No se pueden migrar los códigos de ubicación: hay ubicaciones cuyo código no termina en el número de hueco';
  END IF;

  CREATE TEMP TABLE location_rack_code_migration ON COMMIT DROP AS
  WITH ranked_racks AS (
    SELECT r.id,
           z.warehouse_id,
           upper(r.code) AS base_code,
           row_number() OVER (PARTITION BY z.warehouse_id, upper(r.code) ORDER BY r.id) AS duplicate_number
    FROM racks r
    JOIN aisles a ON a.id = r.aisle_id
    JOIN zones z ON z.id = a.zone_id
  )
  SELECT id, warehouse_id, base_code, base_code AS final_code, duplicate_number
  FROM ranked_racks;

  FOR duplicate_rack IN
    SELECT id, warehouse_id, base_code, duplicate_number
    FROM location_rack_code_migration
    WHERE duplicate_number > 1
    ORDER BY warehouse_id, base_code, duplicate_number
  LOOP
    suffix_number := duplicate_rack.duplicate_number;
    LOOP
      suffix := lpad(suffix_number::text, 2, '0');
      candidate_code := left(duplicate_rack.base_code, 24 - length(suffix) - 1) || '-' || suffix;
      EXIT WHEN NOT EXISTS (
        SELECT 1
        FROM location_rack_code_migration
        WHERE warehouse_id = duplicate_rack.warehouse_id
          AND id <> duplicate_rack.id
          AND final_code = candidate_code
      );
      suffix_number := suffix_number + 1;
    END LOOP;

    UPDATE location_rack_code_migration
    SET final_code = candidate_code
    WHERE id = duplicate_rack.id;
  END LOOP;

  CREATE TEMP TABLE location_bin_code_migration ON COMMIT DROP AS
  SELECT b.id,
         w.code || '-' || rack_codes.final_code ||
           '-N' || lpad(rl.level_number::text, 2, '0') ||
           CASE WHEN b.depth_position = 1 THEN '' ELSE '-D' || lpad(b.depth_position::text, 2, '0') END ||
           '-H' || lpad(substring(b.code FROM '([0-9]+)$'), 2, '0') AS code
  FROM bins b
  JOIN rack_levels rl ON rl.id = b.rack_level_id
  JOIN location_rack_code_migration rack_codes ON rack_codes.id = rl.rack_id
  JOIN warehouses w ON w.id = rack_codes.warehouse_id;

  IF EXISTS (
    SELECT code FROM location_bin_code_migration GROUP BY code HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'No se pueden migrar los códigos de ubicación: el nuevo formato genera códigos duplicados';
  END IF;

  UPDATE racks
  SET code = '__location_code_migration__' || id::text;

  UPDATE bins
  SET code = '__location_code_migration__' || id::text,
      barcode = 'LOC-__location_code_migration__' || id::text;

  UPDATE racks r
  SET code = rack_codes.final_code
  FROM location_rack_code_migration rack_codes
  WHERE rack_codes.id = r.id;

  UPDATE bins b
  SET code = bin_codes.code,
      barcode = 'LOC-' || bin_codes.code
  FROM location_bin_code_migration bin_codes
  WHERE bin_codes.id = b.id;

  INSERT INTO app_settings (key, value)
  VALUES ('location_code_format_v1', 'true')
  ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
END
$migration$;

COMMIT;
