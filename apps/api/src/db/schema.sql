CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS unaccent;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'employee' CHECK (role IN ('admin', 'employee')),
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

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

CREATE TABLE IF NOT EXISTS warehouses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  code TEXT NOT NULL UNIQUE,
  map_width NUMERIC(7, 2) NOT NULL DEFAULT 5000 CHECK (map_width BETWEEN 520 AND 30000),
  map_height NUMERIC(7, 2) NOT NULL DEFAULT 3000 CHECK (map_height BETWEEN 340 AND 30000),
  map_perimeter JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(map_perimeter) = 'array'),
  map_structures JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(map_structures) = 'array'),
  timezone TEXT NOT NULL DEFAULT 'Europe/Madrid',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS zones (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  warehouse_id UUID NOT NULL REFERENCES warehouses(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  code TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'storage' CHECK (type IN ('receiving', 'storage', 'picking', 'shipping')),
  UNIQUE (warehouse_id, code)
);

CREATE TABLE IF NOT EXISTS aisles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  zone_id UUID NOT NULL REFERENCES zones(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  code TEXT NOT NULL,
  map_x NUMERIC(7, 2) NOT NULL DEFAULT 24,
  map_y NUMERIC(7, 2) NOT NULL DEFAULT 24,
  map_width NUMERIC(7, 2) NOT NULL DEFAULT 1200 CHECK (map_width BETWEEN 100 AND 4000),
  map_height NUMERIC(7, 2) NOT NULL DEFAULT 800 CHECK (map_height BETWEEN 80 AND 4000),
  UNIQUE (zone_id, code)
);

CREATE TABLE IF NOT EXISTS racks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  aisle_id UUID NOT NULL REFERENCES aisles(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  code TEXT NOT NULL,
  map_x NUMERIC(7, 2) NOT NULL DEFAULT 30,
  map_y NUMERIC(7, 2) NOT NULL DEFAULT 30,
  map_width NUMERIC(7, 2) NOT NULL DEFAULT 480 CHECK (map_width BETWEEN 160 AND 2000),
  map_height NUMERIC(7, 2) NOT NULL DEFAULT 280 CHECK (map_height BETWEEN 100 AND 1200),
  depth_slots SMALLINT NOT NULL DEFAULT 1 CHECK (depth_slots BETWEEN 1 AND 12),
  UNIQUE (aisle_id, code)
);

CREATE TABLE IF NOT EXISTS rack_levels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rack_id UUID NOT NULL REFERENCES racks(id) ON DELETE CASCADE,
  level_number INTEGER NOT NULL CHECK (level_number >= 0),
  height_cm NUMERIC(7, 2) NOT NULL DEFAULT 240 CHECK (height_cm BETWEEN 1 AND 1000),
  UNIQUE (rack_id, level_number)
);

CREATE TABLE IF NOT EXISTS bins (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rack_level_id UUID NOT NULL REFERENCES rack_levels(id) ON DELETE CASCADE,
  code TEXT NOT NULL UNIQUE,
  barcode TEXT UNIQUE,
  capacity NUMERIC(12, 2),
  map_x NUMERIC(7, 2) NOT NULL DEFAULT 0,
  map_y NUMERIC(7, 2) NOT NULL DEFAULT 0,
  map_width NUMERIC(7, 2) NOT NULL DEFAULT 100,
  map_height NUMERIC(7, 2) NOT NULL DEFAULT 64,
  display_name TEXT,
  width_units SMALLINT NOT NULL DEFAULT 1 CHECK (width_units BETWEEN 1 AND 12),
  depth_units SMALLINT NOT NULL DEFAULT 1 CHECK (depth_units BETWEEN 1 AND 12),
  depth_position SMALLINT NOT NULL DEFAULT 1 CHECK (depth_position BETWEEN 1 AND 12),
  merged_into_bin_id UUID REFERENCES bins(id) ON DELETE SET NULL,
  CONSTRAINT bins_merged_into_not_self CHECK (merged_into_bin_id IS NULL OR merged_into_bin_id <> id),
  CONSTRAINT bins_merged_children_single_unit CHECK (
    merged_into_bin_id IS NULL OR (width_units = 1 AND depth_units = 1)
  ),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'blocked'))
);

CREATE TABLE IF NOT EXISTS categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  parent_id UUID REFERENCES categories(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS suppliers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  warehouse_id UUID NOT NULL REFERENCES warehouses(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  UNIQUE (id, warehouse_id)
);

CREATE TABLE IF NOT EXISTS products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  warehouse_id UUID NOT NULL REFERENCES warehouses(id) ON DELETE CASCADE,
  sku TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  category_id UUID REFERENCES categories(id) ON DELETE SET NULL,
  supplier_id UUID,
  barcode TEXT,
  unit_of_measure TEXT NOT NULL DEFAULT 'ud',
  min_stock NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (min_stock >= 0),
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (warehouse_id, sku),
  UNIQUE (warehouse_id, barcode),
  UNIQUE (id, warehouse_id),
  FOREIGN KEY (supplier_id, warehouse_id) REFERENCES suppliers(id, warehouse_id)
    ON DELETE SET NULL (supplier_id)
);

CREATE TABLE IF NOT EXISTS lots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES products(id),
  lot_code TEXT NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at DATE,
  UNIQUE (product_id, lot_code)
);

CREATE TABLE IF NOT EXISTS stock_balances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES products(id),
  lot_id UUID REFERENCES lots(id),
  bin_id UUID NOT NULL REFERENCES bins(id),
  quantity NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  reserved_quantity NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (reserved_quantity >= 0 AND reserved_quantity <= quantity),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE NULLS NOT DISTINCT (product_id, lot_id, bin_id)
);

CREATE TABLE IF NOT EXISTS bin_expectations (
  bin_id UUID NOT NULL REFERENCES bins(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES products(id),
  expected_quantity NUMERIC(12, 2) NOT NULL CHECK (expected_quantity > 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (bin_id, product_id)
);

CREATE TABLE IF NOT EXISTS movements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type TEXT NOT NULL CHECK (type IN ('receipt', 'dispatch', 'transfer', 'adjustment', 'in_use', 'return')),
  status TEXT NOT NULL DEFAULT 'posted' CHECK (status IN ('posted', 'reversed')),
  reference TEXT,
  notes TEXT,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  posted_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS employee_movement_alerts (
  movement_id UUID PRIMARY KEY REFERENCES movements(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS employee_movement_alert_reads (
  admin_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  movement_id UUID NOT NULL REFERENCES employee_movement_alerts(movement_id) ON DELETE CASCADE,
  read_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (admin_user_id, movement_id)
);

CREATE TABLE IF NOT EXISTS movement_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  movement_id UUID NOT NULL REFERENCES movements(id),
  product_id UUID NOT NULL REFERENCES products(id),
  destination_product_id UUID REFERENCES products(id),
  lot_id UUID REFERENCES lots(id),
  destination_lot_id UUID REFERENCES lots(id),
  quantity NUMERIC(12, 2) NOT NULL CHECK (quantity > 0),
  from_bin_id UUID REFERENCES bins(id),
  to_bin_id UUID REFERENCES bins(id),
  CHECK (from_bin_id IS NOT NULL OR to_bin_id IS NOT NULL)
);

CREATE OR REPLACE FUNCTION notify_admin_of_employee_movement()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM users WHERE id = NEW.created_by AND role = 'employee') THEN
    INSERT INTO employee_movement_alerts (movement_id)
    VALUES (NEW.id)
    ON CONFLICT (movement_id) DO NOTHING;
    IF FOUND THEN
      PERFORM pg_notify('employee_movement_alerts', NEW.id::text);
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS employee_movement_alert_trigger ON movements;
CREATE TRIGGER employee_movement_alert_trigger
AFTER INSERT ON movements
FOR EACH ROW
EXECUTE FUNCTION notify_admin_of_employee_movement();

CREATE INDEX IF NOT EXISTS idx_stock_product ON stock_balances(product_id);
CREATE INDEX IF NOT EXISTS idx_stock_bin ON stock_balances(bin_id);
CREATE INDEX IF NOT EXISTS idx_lots_expiry ON lots(expires_at);
CREATE INDEX IF NOT EXISTS idx_movements_created_at ON movements(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_movement_lines_product ON movement_lines(product_id);

CREATE OR REPLACE FUNCTION prevent_posted_movement_mutation()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' AND current_setting('stockflow.allow_rack_history_delete', true) = 'on' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'Posted movement history is immutable';
END;
$$;

DROP TRIGGER IF EXISTS immutable_movement_update ON movements;
CREATE TRIGGER immutable_movement_update
BEFORE UPDATE OR DELETE ON movements
FOR EACH ROW EXECUTE FUNCTION prevent_posted_movement_mutation();

DROP TRIGGER IF EXISTS immutable_movement_line_update ON movement_lines;
CREATE TRIGGER immutable_movement_line_update
BEFORE UPDATE OR DELETE ON movement_lines
FOR EACH ROW EXECUTE FUNCTION prevent_posted_movement_mutation();
