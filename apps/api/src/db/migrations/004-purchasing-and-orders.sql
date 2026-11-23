CREATE TABLE IF NOT EXISTS purchase_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  warehouse_id UUID NOT NULL REFERENCES warehouses(id),
  supplier_id UUID NOT NULL REFERENCES suppliers(id),
  status TEXT NOT NULL DEFAULT 'ordered' CHECK (status IN ('ordered', 'received', 'cancelled')),
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  received_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS purchase_order_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_order_id UUID NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES products(id),
  quantity NUMERIC(12, 2) NOT NULL CHECK (quantity > 0),
  received_quantity NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (received_quantity >= 0 AND received_quantity <= quantity),
  UNIQUE (purchase_order_id, product_id)
);

CREATE INDEX IF NOT EXISTS idx_purchase_orders_open
  ON purchase_orders (warehouse_id, created_at DESC)
  WHERE status = 'ordered';

CREATE TABLE IF NOT EXISTS sales_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  warehouse_id UUID NOT NULL REFERENCES warehouses(id),
  customer_name TEXT NOT NULL,
  reference TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'picking', 'fulfilled', 'cancelled')),
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  fulfilled_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS sales_order_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sales_order_id UUID NOT NULL REFERENCES sales_orders(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES products(id),
  quantity NUMERIC(12, 2) NOT NULL CHECK (quantity > 0),
  UNIQUE (sales_order_id, product_id)
);

CREATE TABLE IF NOT EXISTS sales_order_allocations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sales_order_line_id UUID NOT NULL REFERENCES sales_order_lines(id) ON DELETE CASCADE,
  stock_balance_id UUID NOT NULL REFERENCES stock_balances(id),
  quantity NUMERIC(12, 2) NOT NULL CHECK (quantity > 0),
  picked BOOLEAN NOT NULL DEFAULT false,
  UNIQUE (sales_order_line_id, stock_balance_id)
);

CREATE INDEX IF NOT EXISTS idx_sales_orders_warehouse
  ON sales_orders (warehouse_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sales_order_allocations_balance
  ON sales_order_allocations (stock_balance_id);
