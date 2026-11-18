/*
# Fitur belanja Lemariku AI: katalog, pesanan, dan fungsi stok

1. Tabel baru
- `products`: katalog barang (slug, nama, harga, stok, penjual).
- `orders`: pesanan + data pembayaran Midtrans.
2. Keamanan
- `products`: anon/authenticated hanya boleh MEMBACA barang aktif.
- `orders`: tertutup untuk anon/authenticated. Hanya edge function `shop` (service role) yang boleh akses.
3. Fungsi
- create_order: kurangi stok + buat pesanan secara atomik (stok 1 tidak bisa dibeli dua orang).
- release_order: batalkan pesanan pending dan kembalikan stok.
- mark_order_paid: tandai lunas.
- expire_stale_orders: lepas pesanan pending > 35 menit.
*/

CREATE TABLE IF NOT EXISTS products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text UNIQUE NOT NULL,
  name text NOT NULL,
  price integer NOT NULL CHECK (price >= 0),
  stock integer NOT NULL CHECK (stock >= 0),
  seller_name text NOT NULL,
  -- Nama penjual yang boleh tampil ke pengguna (kalau kosong, pakai seller_name).
  seller_public_name text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_code text UNIQUE NOT NULL,
  session_id text NOT NULL,
  product_id uuid NOT NULL REFERENCES products(id),
  product_name text NOT NULL,
  seller_name text NOT NULL,
  qty integer NOT NULL CHECK (qty > 0),
  unit_price integer NOT NULL,
  subtotal integer NOT NULL,
  tax integer NOT NULL DEFAULT 10000,
  tax_discount integer NOT NULL DEFAULT 10000,
  total integer NOT NULL,
  buyer_name text NOT NULL,
  buyer_contact text NOT NULL,
  note text,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'paid', 'failed', 'expired', 'cancelled')),
  payment_type text,
  midtrans_transaction_id text,
  snap_token text,
  stock_released boolean NOT NULL DEFAULT false,
  created_at timestamptz DEFAULT now(),
  paid_at timestamptz,
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_orders_session_id ON orders(session_id);
CREATE INDEX IF NOT EXISTS idx_orders_status_created ON orders(status, created_at);

ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "public_read_active_products" ON products;
CREATE POLICY "public_read_active_products"
ON products FOR SELECT TO anon, authenticated USING (active = true);

REVOKE ALL ON orders FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON products FROM anon, authenticated;

-- ---------- Fungsi ----------

CREATE OR REPLACE FUNCTION create_order(
  p_session text, p_slug text, p_qty integer,
  p_name text, p_contact text, p_note text, p_code text
) RETURNS orders
LANGUAGE plpgsql AS $$
DECLARE
  prod products;
  o orders;
  seller text;
BEGIN
  SELECT * INTO prod FROM products WHERE slug = p_slug AND active = true FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'PRODUCT_NOT_FOUND'; END IF;
  IF prod.stock < p_qty THEN RAISE EXCEPTION 'OUT_OF_STOCK'; END IF;

  UPDATE products SET stock = stock - p_qty WHERE id = prod.id;
  seller := COALESCE(prod.seller_public_name, prod.seller_name);

  INSERT INTO orders (
    order_code, session_id, product_id, product_name, seller_name,
    qty, unit_price, subtotal, tax, tax_discount, total,
    buyer_name, buyer_contact, note
  ) VALUES (
    p_code, p_session, prod.id, prod.name, seller,
    p_qty, prod.price, prod.price * p_qty, 10000, 10000, prod.price * p_qty,
    p_name, p_contact, NULLIF(p_note, '')
  ) RETURNING * INTO o;

  RETURN o;
END $$;

CREATE OR REPLACE FUNCTION release_order(p_code text, p_status text)
RETURNS orders
LANGUAGE plpgsql AS $$
DECLARE o orders;
BEGIN
  UPDATE orders
     SET status = p_status, stock_released = true, updated_at = now()
   WHERE order_code = p_code AND status = 'pending'
   RETURNING * INTO o;
  IF FOUND THEN
    UPDATE products SET stock = stock + o.qty WHERE id = o.product_id;
  ELSE
    SELECT * INTO o FROM orders WHERE order_code = p_code;
  END IF;
  RETURN o;
END $$;

CREATE OR REPLACE FUNCTION mark_order_paid(p_code text, p_type text, p_tx text)
RETURNS orders
LANGUAGE plpgsql AS $$
DECLARE o orders;
BEGIN
  SELECT * INTO o FROM orders WHERE order_code = p_code FOR UPDATE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF o.status = 'paid' THEN RETURN o; END IF;

  -- Pembayaran telat masuk setelah stok dilepas: ambil lagi stoknya.
  IF o.stock_released THEN
    UPDATE products SET stock = GREATEST(stock - o.qty, 0) WHERE id = o.product_id;
  END IF;

  UPDATE orders
     SET status = 'paid', paid_at = now(), payment_type = p_type,
         midtrans_transaction_id = p_tx, stock_released = false, updated_at = now()
   WHERE id = o.id
   RETURNING * INTO o;
  RETURN o;
END $$;

CREATE OR REPLACE FUNCTION expire_stale_orders()
RETURNS void
LANGUAGE plpgsql AS $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT order_code FROM orders
     WHERE status = 'pending' AND created_at < now() - interval '35 minutes'
  LOOP
    PERFORM release_order(r.order_code, 'expired');
  END LOOP;
END $$;

REVOKE ALL ON FUNCTION create_order(text, text, integer, text, text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION release_order(text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION mark_order_paid(text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION expire_stale_orders() FROM PUBLIC, anon, authenticated;

-- ---------- Katalog awal ----------
INSERT INTO products (slug, name, price, stock, seller_name, seller_public_name) VALUES
  ('pulpen', 'Pulpen', 2000, 15, 'Ahmad M', NULL),
  -- Nerfyu sengaja disembunyikan dari pengguna (nama pencipta adalah rahasia di persona Lemari).
  ('smartphone', 'Smartphone', 5000000, 1, 'Nerfyu', 'Kenalan Rahasia Lemari')
ON CONFLICT (slug) DO NOTHING;