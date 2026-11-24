BEGIN;

ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS warehouse_id UUID;
ALTER TABLE products ADD COLUMN IF NOT EXISTS warehouse_id UUID;
ALTER TABLE movement_lines ADD COLUMN IF NOT EXISTS destination_product_id UUID REFERENCES products(id);
ALTER TABLE movement_lines ADD COLUMN IF NOT EXISTS destination_lot_id UUID REFERENCES lots(id);

CREATE TEMP TABLE legacy_suppliers ON COMMIT DROP AS
SELECT id, name, email, phone
FROM suppliers
WHERE warehouse_id IS NULL;

CREATE TEMP TABLE supplier_warehouse_map (
  old_supplier_id UUID NOT NULL,
  warehouse_id UUID NOT NULL,
  new_supplier_id UUID NOT NULL,
  PRIMARY KEY (old_supplier_id, warehouse_id)
) ON COMMIT DROP;

INSERT INTO supplier_warehouse_map (old_supplier_id, warehouse_id, new_supplier_id)
SELECT ls.id, w.id,
       CASE WHEN w.id = (SELECT id FROM warehouses ORDER BY created_at, name LIMIT 1)
            THEN ls.id ELSE gen_random_uuid() END
FROM legacy_suppliers ls
CROSS JOIN warehouses w;

UPDATE suppliers s
SET warehouse_id = m.warehouse_id
FROM supplier_warehouse_map m
WHERE s.id = m.old_supplier_id AND s.id = m.new_supplier_id;

INSERT INTO suppliers (id, warehouse_id, name, email, phone)
SELECT m.new_supplier_id, m.warehouse_id, ls.name, ls.email, ls.phone
FROM supplier_warehouse_map m
JOIN legacy_suppliers ls ON ls.id = m.old_supplier_id
WHERE m.new_supplier_id <> ls.id;

ALTER TABLE products DROP CONSTRAINT IF EXISTS products_sku_key;
ALTER TABLE products DROP CONSTRAINT IF EXISTS products_barcode_key;
ALTER TABLE products DROP CONSTRAINT IF EXISTS products_supplier_id_fkey;
ALTER TABLE purchase_orders DROP CONSTRAINT IF EXISTS purchase_orders_supplier_id_fkey;

CREATE TEMP TABLE legacy_products ON COMMIT DROP AS
SELECT id, sku, name, description, category_id, supplier_id, barcode,
       unit_of_measure, min_stock, active, created_at
FROM products
WHERE warehouse_id IS NULL;

CREATE TEMP TABLE product_warehouse_map (
  old_product_id UUID NOT NULL,
  warehouse_id UUID NOT NULL,
  new_product_id UUID NOT NULL,
  PRIMARY KEY (old_product_id, warehouse_id)
) ON COMMIT DROP;

INSERT INTO product_warehouse_map (old_product_id, warehouse_id, new_product_id)
SELECT lp.id, w.id,
       CASE WHEN w.id = (SELECT id FROM warehouses ORDER BY created_at, name LIMIT 1)
            THEN lp.id ELSE gen_random_uuid() END
FROM legacy_products lp
CROSS JOIN warehouses w;

INSERT INTO products (
  id, warehouse_id, sku, name, description, category_id, supplier_id, barcode,
  unit_of_measure, min_stock, active, created_at
)
SELECT pm.new_product_id, pm.warehouse_id, lp.sku, lp.name, lp.description,
       lp.category_id, sm.new_supplier_id, lp.barcode, lp.unit_of_measure,
       lp.min_stock, lp.active, lp.created_at
FROM product_warehouse_map pm
JOIN legacy_products lp ON lp.id = pm.old_product_id
LEFT JOIN supplier_warehouse_map sm
  ON sm.old_supplier_id = lp.supplier_id AND sm.warehouse_id = pm.warehouse_id
WHERE pm.new_product_id <> lp.id;

UPDATE products p
SET warehouse_id = pm.warehouse_id,
    supplier_id = sm.new_supplier_id
FROM product_warehouse_map pm
LEFT JOIN legacy_products lp ON lp.id = pm.old_product_id
LEFT JOIN supplier_warehouse_map sm
  ON sm.old_supplier_id = lp.supplier_id AND sm.warehouse_id = pm.warehouse_id
WHERE p.id = pm.old_product_id AND pm.new_product_id = pm.old_product_id;

CREATE TEMP TABLE legacy_lots ON COMMIT DROP AS
SELECT id, product_id, lot_code, received_at, expires_at
FROM lots;

CREATE TEMP TABLE lot_warehouse_map (
  old_lot_id UUID NOT NULL,
  warehouse_id UUID NOT NULL,
  new_lot_id UUID NOT NULL,
  PRIMARY KEY (old_lot_id, warehouse_id)
) ON COMMIT DROP;

INSERT INTO lot_warehouse_map (old_lot_id, warehouse_id, new_lot_id)
SELECT ll.id, pm.warehouse_id,
       CASE WHEN pm.new_product_id = ll.product_id THEN ll.id ELSE gen_random_uuid() END
FROM legacy_lots ll
JOIN product_warehouse_map pm ON pm.old_product_id = ll.product_id;

INSERT INTO lots (id, product_id, lot_code, received_at, expires_at)
SELECT lm.new_lot_id, pm.new_product_id, ll.lot_code, ll.received_at, ll.expires_at
FROM lot_warehouse_map lm
JOIN legacy_lots ll ON ll.id = lm.old_lot_id
JOIN product_warehouse_map pm
  ON pm.old_product_id = ll.product_id AND pm.warehouse_id = lm.warehouse_id
WHERE lm.new_lot_id <> ll.id;

UPDATE lots l
SET product_id = pm.new_product_id
FROM product_warehouse_map pm
WHERE l.product_id = pm.old_product_id
  AND pm.new_product_id = pm.old_product_id;

UPDATE stock_balances sb
SET product_id = pm.new_product_id,
    lot_id = COALESCE((
      SELECT lm.new_lot_id
      FROM lot_warehouse_map lm
      WHERE lm.old_lot_id = sb.lot_id AND lm.warehouse_id = z.warehouse_id
    ), sb.lot_id)
FROM bins b
JOIN rack_levels rl ON rl.id = b.rack_level_id
JOIN racks r ON r.id = rl.rack_id
JOIN aisles a ON a.id = r.aisle_id
JOIN zones z ON z.id = a.zone_id
JOIN product_warehouse_map pm ON pm.warehouse_id = z.warehouse_id
WHERE sb.bin_id = b.id AND sb.product_id = pm.old_product_id;

UPDATE bin_expectations be
SET product_id = pm.new_product_id
FROM bins b
JOIN rack_levels rl ON rl.id = b.rack_level_id
JOIN racks r ON r.id = rl.rack_id
JOIN aisles a ON a.id = r.aisle_id
JOIN zones z ON z.id = a.zone_id
JOIN product_warehouse_map pm ON pm.warehouse_id = z.warehouse_id
WHERE be.bin_id = b.id AND be.product_id = pm.old_product_id;

UPDATE purchase_orders po
SET supplier_id = sm.new_supplier_id
FROM supplier_warehouse_map sm
WHERE po.supplier_id = sm.old_supplier_id AND po.warehouse_id = sm.warehouse_id;

UPDATE purchase_order_lines pol
SET product_id = pm.new_product_id
FROM purchase_orders po
JOIN product_warehouse_map pm ON pm.warehouse_id = po.warehouse_id
WHERE pol.purchase_order_id = po.id AND pol.product_id = pm.old_product_id;

UPDATE sales_order_lines sol
SET product_id = pm.new_product_id
FROM sales_orders so
JOIN product_warehouse_map pm ON pm.warehouse_id = so.warehouse_id
WHERE sol.sales_order_id = so.id AND sol.product_id = pm.old_product_id;

DROP TRIGGER IF EXISTS immutable_movement_line_update ON movement_lines;

CREATE TEMP TABLE movement_line_warehouse_map ON COMMIT DROP AS
SELECT ml.id AS movement_line_id,
       src.new_product_id AS source_product_id,
       src_lot.new_lot_id AS source_lot_id,
       dst.new_product_id AS destination_product_id,
       dst_lot.new_lot_id AS destination_lot_id
FROM movement_lines ml
LEFT JOIN bins from_bin ON from_bin.id = ml.from_bin_id
LEFT JOIN rack_levels from_level ON from_level.id = from_bin.rack_level_id
LEFT JOIN racks from_rack ON from_rack.id = from_level.rack_id
LEFT JOIN aisles from_aisle ON from_aisle.id = from_rack.aisle_id
LEFT JOIN zones from_zone ON from_zone.id = from_aisle.zone_id
LEFT JOIN bins to_bin ON to_bin.id = ml.to_bin_id
LEFT JOIN rack_levels to_level ON to_level.id = to_bin.rack_level_id
LEFT JOIN racks to_rack ON to_rack.id = to_level.rack_id
LEFT JOIN aisles to_aisle ON to_aisle.id = to_rack.aisle_id
LEFT JOIN zones to_zone ON to_zone.id = to_aisle.zone_id
JOIN product_warehouse_map src
  ON src.old_product_id = ml.product_id
 AND src.warehouse_id = COALESCE(from_zone.warehouse_id, to_zone.warehouse_id)
LEFT JOIN lot_warehouse_map src_lot
  ON src_lot.old_lot_id = ml.lot_id AND src_lot.warehouse_id = src.warehouse_id
LEFT JOIN product_warehouse_map dst
  ON dst.old_product_id = ml.product_id AND dst.warehouse_id = to_zone.warehouse_id
LEFT JOIN lot_warehouse_map dst_lot
  ON dst_lot.old_lot_id = ml.lot_id AND dst_lot.warehouse_id = to_zone.warehouse_id;

UPDATE movement_lines ml
SET product_id = m.source_product_id,
    lot_id = m.source_lot_id,
    destination_product_id = CASE
      WHEN m.destination_product_id IS DISTINCT FROM m.source_product_id
      THEN m.destination_product_id ELSE NULL END,
    destination_lot_id = CASE
      WHEN m.destination_product_id IS DISTINCT FROM m.source_product_id
      THEN m.destination_lot_id ELSE NULL END
FROM movement_line_warehouse_map m
WHERE ml.id = m.movement_line_id;

CREATE TRIGGER immutable_movement_line_update
BEFORE UPDATE OR DELETE ON movement_lines
FOR EACH ROW EXECUTE FUNCTION prevent_posted_movement_mutation();

ALTER TABLE suppliers ALTER COLUMN warehouse_id SET NOT NULL;
ALTER TABLE products ALTER COLUMN warehouse_id SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_suppliers_id_warehouse
  ON suppliers (id, warehouse_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_products_id_warehouse
  ON products (id, warehouse_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_products_warehouse_sku
  ON products (warehouse_id, sku);
CREATE UNIQUE INDEX IF NOT EXISTS idx_products_warehouse_barcode
  ON products (warehouse_id, barcode);
CREATE INDEX IF NOT EXISTS idx_products_warehouse
  ON products (warehouse_id, active);
CREATE INDEX IF NOT EXISTS idx_suppliers_warehouse
  ON suppliers (warehouse_id);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'suppliers_warehouse_id_fkey') THEN
    ALTER TABLE suppliers ADD CONSTRAINT suppliers_warehouse_id_fkey
      FOREIGN KEY (warehouse_id) REFERENCES warehouses(id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'products_warehouse_id_fkey') THEN
    ALTER TABLE products ADD CONSTRAINT products_warehouse_id_fkey
      FOREIGN KEY (warehouse_id) REFERENCES warehouses(id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'products_supplier_id_warehouse_id_fkey') THEN
    ALTER TABLE products ADD CONSTRAINT products_supplier_id_warehouse_id_fkey
      FOREIGN KEY (supplier_id, warehouse_id) REFERENCES suppliers(id, warehouse_id)
      ON DELETE SET NULL (supplier_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'purchase_orders_supplier_id_warehouse_id_fkey') THEN
    ALTER TABLE purchase_orders ADD CONSTRAINT purchase_orders_supplier_id_warehouse_id_fkey
      FOREIGN KEY (supplier_id, warehouse_id) REFERENCES suppliers(id, warehouse_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'movement_lines_destination_product_id_fkey') THEN
    ALTER TABLE movement_lines ADD CONSTRAINT movement_lines_destination_product_id_fkey
      FOREIGN KEY (destination_product_id) REFERENCES products(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'movement_lines_destination_lot_id_fkey') THEN
    ALTER TABLE movement_lines ADD CONSTRAINT movement_lines_destination_lot_id_fkey
      FOREIGN KEY (destination_lot_id) REFERENCES lots(id);
  END IF;
END;
$$;

ALTER TABLE movements DROP CONSTRAINT IF EXISTS movements_type_check;
ALTER TABLE movements ADD CONSTRAINT movements_type_check
  CHECK (type IN ('receipt', 'dispatch', 'transfer', 'adjustment', 'in_use', 'return'));

CREATE TABLE IF NOT EXISTS in_use_loans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  warehouse_id UUID NOT NULL REFERENCES warehouses(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES products(id),
  lot_id UUID REFERENCES lots(id),
  movement_line_id UUID NOT NULL UNIQUE REFERENCES movement_lines(id),
  original_bin_id UUID NOT NULL REFERENCES bins(id),
  quantity NUMERIC(12, 2) NOT NULL CHECK (quantity > 0),
  returned_quantity NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (returned_quantity >= 0 AND returned_quantity <= quantity),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (product_id, warehouse_id) REFERENCES products(id, warehouse_id)
);

CREATE INDEX IF NOT EXISTS idx_in_use_loans_pending
  ON in_use_loans (warehouse_id, created_at DESC)
  WHERE returned_quantity < quantity;

COMMIT;
