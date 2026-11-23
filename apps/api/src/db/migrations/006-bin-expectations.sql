CREATE TABLE IF NOT EXISTS bin_expectations (
  bin_id UUID NOT NULL REFERENCES bins(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES products(id),
  expected_quantity NUMERIC(12, 2) NOT NULL CHECK (expected_quantity > 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (bin_id, product_id)
);
