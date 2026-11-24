INSERT INTO warehouses (name, code, map_width, map_height)
VALUES ('Centro logístico Madrid', 'MAD-01', 5000, 3000)
ON CONFLICT (code) DO NOTHING;

INSERT INTO zones (warehouse_id, name, code, type)
SELECT id, 'Almacenamiento', 'STO', 'storage' FROM warehouses WHERE code = 'MAD-01'
ON CONFLICT (warehouse_id, code) DO NOTHING;

INSERT INTO aisles (zone_id, name, code)
SELECT id, 'Pasillo A', 'A' FROM zones WHERE code = 'STO'
ON CONFLICT (zone_id, code) DO NOTHING;

INSERT INTO racks (aisle_id, name, code, map_x, map_y, map_width, map_height)
SELECT id, 'Estantería A1', 'A1', 30, 30, 480, 280 FROM aisles WHERE code = 'A'
ON CONFLICT (aisle_id, code) DO NOTHING;

INSERT INTO rack_levels (rack_id, level_number)
SELECT r.id, levels.level_number FROM racks r CROSS JOIN generate_series(1, 3) AS levels(level_number) WHERE r.code = 'A1'
ON CONFLICT (rack_id, level_number) DO NOTHING;

INSERT INTO bins (rack_level_id, code, barcode, map_x, map_y)
SELECT rl.id, 'A1-' || lpad(rl.level_number::text, 2, '0') || '-' || b.bin_num,
       'LOC-' || 'A1-' || lpad(rl.level_number::text, 2, '0') || '-' || b.bin_num,
       40 + (b.bin_num::int - 1) * 112, 40 + (rl.level_number - 1) * 84
FROM rack_levels rl
JOIN racks r ON r.id = rl.rack_id
CROSS JOIN generate_series(1, 4) AS b(bin_num)
WHERE r.code = 'A1'
ON CONFLICT (code) DO NOTHING;

INSERT INTO categories (name) VALUES ('Electrónica'), ('Accesorios'), ('Componentes')
ON CONFLICT (name) DO NOTHING;

INSERT INTO suppliers (warehouse_id, name, email)
SELECT w.id, seed.name, seed.email
FROM warehouses w
CROSS JOIN (VALUES
  ('TechSupply Europe', 'pedidos@techsupply.example'),
  ('Global Components', 'ventas@globalcomponents.example')
) AS seed(name, email)
WHERE w.code = 'MAD-01'
  AND NOT EXISTS (
    SELECT 1 FROM suppliers s WHERE s.warehouse_id = w.id AND s.name = seed.name
  );

INSERT INTO products (warehouse_id, sku, name, category_id, supplier_id, barcode, unit_of_measure, min_stock)
SELECT w.id, seed.sku, seed.name, c.id, s.id, seed.barcode, 'ud', seed.min_stock
FROM warehouses w
CROSS JOIN (VALUES
  ('SKU-1001', 'Auriculares inalámbricos Pro', 'Electrónica', 'TechSupply Europe', '8412345001001', 20),
  ('SKU-1002', 'Teclado mecánico compacto', 'Accesorios', 'Global Components', '8412345001002', 15),
  ('SKU-1003', 'Ratón ergonómico inalámbrico', 'Accesorios', 'TechSupply Europe', '8412345001003', 25),
  ('SKU-1004', 'Hub USB-C 7 en 1', 'Electrónica', 'Global Components', '8412345001004', 10),
  ('SKU-1005', 'Cable USB-C trenzado 2 m', 'Componentes', 'TechSupply Europe', '8412345001005', 30)
) AS seed(sku, name, category, supplier, barcode, min_stock)
JOIN categories c ON c.name = seed.category
JOIN suppliers s ON s.name = seed.supplier AND s.warehouse_id = w.id
WHERE w.code = 'MAD-01'
ON CONFLICT (warehouse_id, sku) DO NOTHING;

INSERT INTO lots (product_id, lot_code, received_at, expires_at)
SELECT p.id, 'LOT-' || p.sku || '-01', now() - interval '12 days',
       CASE WHEN p.sku = 'SKU-1004' THEN current_date + 45 ELSE NULL END
FROM products p
WHERE p.warehouse_id = (SELECT id FROM warehouses WHERE code = 'MAD-01')
ON CONFLICT (product_id, lot_code) DO NOTHING;

INSERT INTO stock_balances (product_id, lot_id, bin_id, quantity)
SELECT p.id, l.id, b.id,
       CASE p.sku WHEN 'SKU-1001' THEN 128 WHEN 'SKU-1002' THEN 86 WHEN 'SKU-1003' THEN 14
                  WHEN 'SKU-1004' THEN 42 ELSE 204 END
FROM products p
JOIN lots l ON l.product_id = p.id AND l.lot_code = 'LOT-' || p.sku || '-01'
JOIN bins b ON b.code = 'A1-01-1'
JOIN rack_levels rl ON rl.id = b.rack_level_id
JOIN racks r ON r.id = rl.rack_id
JOIN aisles a ON a.id = r.aisle_id
JOIN zones z ON z.id = a.zone_id AND z.warehouse_id = p.warehouse_id
ON CONFLICT DO NOTHING;
