// Nerfyu
// Edge function "shop": membuat pesanan + token Midtrans Snap, mengecek status, dan menerima notifikasi Midtrans.
//   POST { action: "create", ... }   -> buat pesanan
//   POST { action: "status", ... }   -> cek status pesanan
//   POST ?action=webhook             -> notifikasi dari Midtrans (isi: order_id, signature_key, dst.)
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const TAX = 10000;
const TAX_DISCOUNT = 10000;
const MAX_QTY = 10;
const MAX_PENDING_PER_SESSION = 3;
// Metode bayar yang ditampilkan di Snap. Ubah di sini kalau mau menambah/mengurangi.
const ENABLED_PAYMENTS = ["other_qris", "gopay", "shopeepay"];

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function admin(): SupabaseClient {
  const url = Deno.env.get("SUPABASE_URL") ?? Deno.env.get("VITE_SUPABASE_URL")!;
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  return createClient(url, key);
}

interface MidtransConfig {
  serverKey: string;
  clientKey: string;
  isProduction: boolean;
}

async function getConfig(db: SupabaseClient): Promise<MidtransConfig | null> {
  const { data, error } = await db
    .from("app_secrets")
    .select("key, value")
    .in("key", ["MIDTRANS_SERVER_KEY", "MIDTRANS_CLIENT_KEY", "MIDTRANS_IS_PRODUCTION"]);
  if (error || !data) return null;
  const m = Object.fromEntries(data.map((r: { key: string; value: string }) => [r.key, r.value]));
  if (!m.MIDTRANS_SERVER_KEY || !m.MIDTRANS_CLIENT_KEY) return null;
  return {
    serverKey: m.MIDTRANS_SERVER_KEY.trim(),
    clientKey: m.MIDTRANS_CLIENT_KEY.trim(),
    isProduction: String(m.MIDTRANS_IS_PRODUCTION ?? "false").trim().toLowerCase() === "true",
  };
}

const snapUrl = (c: MidtransConfig) =>
  c.isProduction
    ? "https://app.midtrans.com/snap/v1/transactions"
    : "https://app.sandbox.midtrans.com/snap/v1/transactions";
const statusUrl = (c: MidtransConfig, orderId: string) =>
  `${c.isProduction ? "https://api.midtrans.com" : "https://api.sandbox.midtrans.com"}/v2/${encodeURIComponent(orderId)}/status`;
const basicAuth = (c: MidtransConfig) => "Basic " + btoa(`${c.serverKey}:`);

async function sha512Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-512", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function newOrderCode(): string {
  const rand = crypto.getRandomValues(new Uint8Array(3));
  const suffix = [...rand].map((b) => b.toString(36)).join("").toUpperCase().slice(0, 4);
  return `LMR-${Date.now().toString(36).toUpperCase()}${suffix}`;
}

// Data pesanan yang aman dikirim ke browser.
function publicOrder(o: Record<string, unknown>, cfg: MidtransConfig | null) {
  return {
    order_code: o.order_code,
    status: o.status,
    product_name: o.product_name,
    seller_name: o.seller_name,
    qty: o.qty,
    unit_price: o.unit_price,
    subtotal: o.subtotal,
    tax: o.tax,
    tax_discount: o.tax_discount,
    total: o.total,
    buyer_name: o.buyer_name,
    payment_type: o.payment_type,
    created_at: o.created_at,
    paid_at: o.paid_at,
    snap_token: o.status === "pending" ? o.snap_token : null,
    client_key: cfg?.clientKey ?? null,
    is_production: cfg?.isProduction ?? false,
  };
}

// Terapkan status dari Midtrans ke pesanan kita.
async function applyMidtransStatus(
  db: SupabaseClient,
  orderCode: string,
  ms: Record<string, string>,
) {
  const ts = ms.transaction_status;
  const fraud = ms.fraud_status;
  if ((ts === "capture" && fraud !== "challenge") || ts === "settlement") {
    await db.rpc("mark_order_paid", {
      p_code: orderCode,
      p_type: ms.payment_type ?? null,
      p_tx: ms.transaction_id ?? null,
    });
  } else if (ts === "deny" || ts === "failure") {
    await db.rpc("release_order", { p_code: orderCode, p_status: "failed" });
  } else if (ts === "cancel") {
    await db.rpc("release_order", { p_code: orderCode, p_status: "cancelled" });
  } else if (ts === "expire") {
    await db.rpc("release_order", { p_code: orderCode, p_status: "expired" });
  } else if (ms.payment_type) {
    await db
      .from("orders")
      .update({ payment_type: ms.payment_type, updated_at: new Date().toISOString() })
      .eq("order_code", orderCode)
      .eq("status", "pending");
  }
}

async function fetchMidtransStatus(cfg: MidtransConfig, orderCode: string) {
  const res = await fetch(statusUrl(cfg, orderCode), {
    headers: { Accept: "application/json", Authorization: basicAuth(cfg) },
  });
  if (!res.ok) return null;
  const body = await res.json();
  // 404 dari Midtrans = pelanggan belum memilih metode bayar.
  if (String(body.status_code) === "404") return null;
  return body as Record<string, string>;
}

// ---------- Aksi ----------

async function createOrder(db: SupabaseClient, req: Record<string, unknown>) {
  const cfg = await getConfig(db);
  if (!cfg) return json({ error: "Midtrans belum dikonfigurasi di database." }, 500);

  const sessionId = String(req.session_id ?? "").trim();
  const slug = String(req.slug ?? "").trim().toLowerCase();
  const qty = Number(req.qty);
  const name = String(req.buyer_name ?? "").trim();
  const contact = String(req.buyer_contact ?? "").trim();
  const note = String(req.note ?? "").trim();

  if (!sessionId || sessionId.length > 100) return json({ error: "Sesi tidak sah." }, 400);
  if (!/^[a-z0-9-]{1,40}$/.test(slug)) return json({ error: "Barang tidak sah." }, 400);
  if (!Number.isInteger(qty) || qty < 1 || qty > MAX_QTY) {
    return json({ error: `Jumlah harus 1 sampai ${MAX_QTY}.` }, 400);
  }
  if (name.length < 2 || name.length > 60) return json({ error: "Nama harus 2–60 karakter." }, 400);
  if (contact.length < 5 || contact.length > 60) {
    return json({ error: "Kontak (nomor WA / IG / dsb.) harus 5–60 karakter." }, 400);
  }
  if (note.length > 200) return json({ error: "Catatan maksimal 200 karakter." }, 400);

  await db.rpc("expire_stale_orders");

  const { count } = await db
    .from("orders")
    .select("id", { count: "exact", head: true })
    .eq("session_id", sessionId)
    .eq("status", "pending");
  if ((count ?? 0) >= MAX_PENDING_PER_SESSION) {
    return json({ error: "Masih ada beberapa pesanan yang belum dibayar. Selesaikan atau tunggu kedaluwarsa dulu ya." }, 429);
  }

  const code = newOrderCode();
  const { data: order, error } = await db.rpc("create_order", {
    p_session: sessionId,
    p_slug: slug,
    p_qty: qty,
    p_name: name,
    p_contact: contact,
    p_note: note,
    p_code: code,
  });
  if (error) {
    if (error.message.includes("OUT_OF_STOCK")) return json({ error: "Stok barang tidak cukup." }, 409);
    if (error.message.includes("PRODUCT_NOT_FOUND")) return json({ error: "Barang tidak ditemukan." }, 404);
    return json({ error: error.message }, 500);
  }

  const phone = /^\+?[0-9\s-]{8,16}$/.test(contact) ? contact.replace(/[\s-]/g, "") : undefined;
  const payload = {
    transaction_details: { order_id: order.order_code, gross_amount: order.total },
    item_details: [
      { id: slug.slice(0, 50), price: order.unit_price, quantity: order.qty, name: order.product_name.slice(0, 50) },
      { id: "tax", price: TAX, quantity: 1, name: "Pajak Lemari" },
      { id: "tax-discount", price: -TAX_DISCOUNT, quantity: 1, name: "Diskon Pajak Lemari" },
    ],
    customer_details: { first_name: name.slice(0, 50), ...(phone ? { phone } : {}) },
    enabled_payments: ENABLED_PAYMENTS,
    expiry: { unit: "minutes", duration: 30 },
  };

  const res = await fetch(snapUrl(cfg), {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json", Authorization: basicAuth(cfg) },
    body: JSON.stringify(payload),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.token) {
    console.error("[shop] Midtrans gagal:", res.status, JSON.stringify(body));
    await db.rpc("release_order", { p_code: order.order_code, p_status: "failed" });
    return json({ error: `Midtrans menolak pesanan (${res.status}). ${body?.error_messages?.join?.(" ") ?? ""}`.trim() }, 502);
  }

  await db.from("orders").update({ snap_token: body.token }).eq("order_code", order.order_code);
  return json({ order: publicOrder({ ...order, snap_token: body.token }, cfg) });
}

async function orderStatus(db: SupabaseClient, req: Record<string, unknown>) {
  const code = String(req.order_code ?? "").trim();
  const sessionId = String(req.session_id ?? "").trim();
  if (!code || !sessionId) return json({ error: "Data tidak lengkap." }, 400);

  const cfg = await getConfig(db);
  const load = async () =>
    (await db.from("orders").select("*").eq("order_code", code).eq("session_id", sessionId).maybeSingle()).data;

  let order = await load();
  if (!order) return json({ error: "Pesanan tidak ditemukan." }, 404);

  if (order.status === "pending" && cfg) {
    // Tanya langsung ke Midtrans, jadi tetap jalan walau webhook belum disetel.
    const ms = await fetchMidtransStatus(cfg, code);
    if (ms) await applyMidtransStatus(db, code, ms);
    else await db.rpc("expire_stale_orders");
    order = (await load()) ?? order;
  }
  return json({ order: publicOrder(order, cfg) });
}

async function webhook(db: SupabaseClient, body: Record<string, string>) {
  const cfg = await getConfig(db);
  if (!cfg) return json({ error: "Midtrans belum dikonfigurasi." }, 500);

  const { order_id, status_code, gross_amount, signature_key } = body;
  if (!order_id || !status_code || !gross_amount || !signature_key) return json({ error: "Payload tidak sah." }, 400);

  const expected = await sha512Hex(`${order_id}${status_code}${gross_amount}${cfg.serverKey}`);
  if (expected !== signature_key) return json({ error: "Signature tidak cocok." }, 403);

  const { data: order } = await db.from("orders").select("order_code, total").eq("order_code", order_id).maybeSingle();
  if (!order) return json({ ok: true, ignored: true }); // mis. notifikasi tes dari dashboard

  // Jangan percaya isi webhook mentah-mentah: ambil status resmi dari Midtrans.
  const ms = await fetchMidtransStatus(cfg, order_id);
  if (ms) {
    if (Math.round(Number(ms.gross_amount)) !== order.total) {
      console.error("[shop] gross_amount tidak cocok untuk", order_id);
      return json({ ok: true, ignored: true });
    }
    await applyMidtransStatus(db, order_id, ms);
  }
  return json({ ok: true });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method tidak didukung." }, 405);

  try {
    const db = admin();
    const url = new URL(req.url);
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const action = url.searchParams.get("action") ?? String(body.action ?? "");

    if (action === "webhook") return await webhook(db, body as Record<string, string>);
    if (action === "create") return await createOrder(db, body);
    if (action === "status") return await orderStatus(db, body);
    return json({ error: "Aksi tidak dikenal." }, 400);
  } catch (err) {
    console.error("[shop] error:", err);
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});
