ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT true;
UPDATE users SET password_hash = 'disabled' WHERE password_hash IS NULL;
ALTER TABLE users ALTER COLUMN password_hash SET NOT NULL;
ALTER TABLE users ALTER COLUMN role SET DEFAULT 'employee';
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
UPDATE users SET role = 'employee' WHERE role NOT IN ('admin', 'employee');
ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('admin', 'employee'));

CREATE TABLE IF NOT EXISTS user_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_user_sessions_active ON user_sessions(token_hash, expires_at) WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE racks ADD COLUMN IF NOT EXISTS map_x NUMERIC(7, 2) NOT NULL DEFAULT 30;
ALTER TABLE racks ADD COLUMN IF NOT EXISTS map_y NUMERIC(7, 2) NOT NULL DEFAULT 30;
ALTER TABLE racks ADD COLUMN IF NOT EXISTS map_width NUMERIC(7, 2) NOT NULL DEFAULT 480;
ALTER TABLE racks ADD COLUMN IF NOT EXISTS map_height NUMERIC(7, 2) NOT NULL DEFAULT 280;
ALTER TABLE racks DROP CONSTRAINT IF EXISTS racks_map_width_check;
ALTER TABLE racks ADD CONSTRAINT racks_map_width_check CHECK (map_width BETWEEN 160 AND 1600);
ALTER TABLE racks DROP CONSTRAINT IF EXISTS racks_map_height_check;
ALTER TABLE racks ADD CONSTRAINT racks_map_height_check CHECK (map_height BETWEEN 100 AND 1200);

ALTER TABLE warehouses ADD COLUMN IF NOT EXISTS map_width NUMERIC(7, 2) NOT NULL DEFAULT 1600;
ALTER TABLE warehouses ADD COLUMN IF NOT EXISTS map_height NUMERIC(7, 2) NOT NULL DEFAULT 1000;
ALTER TABLE aisles ADD COLUMN IF NOT EXISTS map_x NUMERIC(7, 2) NOT NULL DEFAULT 24;
ALTER TABLE aisles ADD COLUMN IF NOT EXISTS map_y NUMERIC(7, 2) NOT NULL DEFAULT 24;
ALTER TABLE aisles ADD COLUMN IF NOT EXISTS map_width NUMERIC(7, 2) NOT NULL DEFAULT 1200;
ALTER TABLE aisles ADD COLUMN IF NOT EXISTS map_height NUMERIC(7, 2) NOT NULL DEFAULT 800;
ALTER TABLE rack_levels ADD COLUMN IF NOT EXISTS height_cm NUMERIC(7, 2) NOT NULL DEFAULT 240;

UPDATE aisles a
SET map_width = LEAST(4000, GREATEST(a.map_width, COALESCE((
      SELECT max(r.map_x + r.map_width) - a.map_x + 24 FROM racks r WHERE r.aisle_id = a.id
    ), a.map_width))),
    map_height = LEAST(4000, GREATEST(a.map_height, COALESCE((
      SELECT max(r.map_y + r.map_height) - a.map_y + 24 FROM racks r WHERE r.aisle_id = a.id
    ), a.map_height)))
WHERE a.map_width = 1200 AND a.map_height = 800;

UPDATE warehouses w
SET map_width = LEAST(5000, GREATEST(w.map_width, COALESCE((
      SELECT max(a.map_x + a.map_width) + 24
      FROM aisles a JOIN zones z ON z.id = a.zone_id WHERE z.warehouse_id = w.id
    ), w.map_width))),
    map_height = LEAST(5000, GREATEST(w.map_height, COALESCE((
      SELECT max(a.map_y + a.map_height) + 24
      FROM aisles a JOIN zones z ON z.id = a.zone_id WHERE z.warehouse_id = w.id
    ), w.map_height)))
WHERE w.map_width = 1600 AND w.map_height = 1000;
