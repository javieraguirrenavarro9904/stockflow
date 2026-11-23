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

INSERT INTO suppliers (name, email) VALUES
  ('TechSupply Europe', 'pedidos@techsupply.example'),
  ('Global Components', 'ventas@globalcomponents.example')
ON CONFLICT DO NOTHING;

INSERT INTO products (sku, name, category_id, supplier_id, barcode, unit_of_measure, min_stock)
VALUES
  ('SKU-1001', 'Auriculares inalámbricos Pro', (SELECT id FROM categories WHERE name = 'Electrónica'), (SELECT id FROM suppliers WHERE name = 'TechSupply Europe'), '8412345001001', 'ud', 20),
  ('SKU-1002', 'Teclado mecánico compacto', (SELECT id FROM categories WHERE name = 'Accesorios'), (SELECT id FROM suppliers WHERE name = 'Global Components'), '8412345001002', 'ud', 15),
  ('SKU-1003', 'Ratón ergonómico inalámbrico', (SELECT id FROM categories WHERE name = 'Accesorios'), (SELECT id FROM suppliers WHERE name = 'TechSupply Europe'), '8412345001003', 'ud', 25),
  ('SKU-1004', 'Hub USB-C 7 en 1', (SELECT id FROM categories WHERE name = 'Electrónica'), (SELECT id FROM suppliers WHERE name = 'Global Components'), '8412345001004', 'ud', 10),
  ('SKU-1005', 'Cable USB-C trenzado 2 m', (SELECT id FROM categories WHERE name = 'Componentes'), (SELECT id FROM suppliers WHERE name = 'TechSupply Europe'), '8412345001005', 'ud', 30)
ON CONFLICT (sku) DO NOTHING;

INSERT INTO lots (product_id, lot_code, received_at, expires_at)
SELECT p.id, 'LOT-' || p.sku || '-01', now() - interval '12 days',
       CASE WHEN p.sku = 'SKU-1004' THEN current_date + 45 ELSE NULL END
FROM products p
ON CONFLICT (product_id, lot_code) DO NOTHING;

INSERT INTO stock_balances (product_id, lot_id, bin_id, quantity)
SELECT p.id, l.id, b.id,
       CASE p.sku WHEN 'SKU-1001' THEN 128 WHEN 'SKU-1002' THEN 86 WHEN 'SKU-1003' THEN 14
                  WHEN 'SKU-1004' THEN 42 ELSE 204 END
FROM products p
JOIN lots l ON l.product_id = p.id AND l.lot_code = 'LOT-' || p.sku || '-01'
JOIN bins b ON b.code = 'A1-01-1'
ON CONFLICT DO NOTHING;
