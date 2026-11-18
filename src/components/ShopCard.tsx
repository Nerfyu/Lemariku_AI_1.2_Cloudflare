// Nerfyu
import { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, Minus, Plus, ShoppingBag, CheckCircle2, XCircle, CreditCard, RotateCcw } from 'lucide-react';
import { supabase } from '@/lib/supabase';

interface Product {
  slug: string;
  name: string;
  price: number;
  stock: number;
  seller_name: string;
  seller_public_name: string | null;
}

interface Order {
  order_code: string;
  status: 'pending' | 'paid' | 'failed' | 'expired' | 'cancelled';
  product_name: string;
  seller_name: string;
  qty: number;
  unit_price: number;
  subtotal: number;
  tax: number;
  tax_discount: number;
  total: number;
  buyer_name: string;
  payment_type: string | null;
  created_at: string;
  paid_at: string | null;
  snap_token: string | null;
  client_key: string | null;
  is_production: boolean;
}

declare global {
  interface Window {
    snap?: {
      pay: (
        token: string,
        opts?: {
          onSuccess?: () => void;
          onPending?: () => void;
          onError?: () => void;
          onClose?: () => void;
        },
      ) => void;
    };
  }
}

const MAX_QTY = 10;
const rupiah = (n: number) => 'Rp' + Math.abs(n).toLocaleString('id-ID');
const SHOP_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/shop`;

async function shopCall<T>(body: Record<string, unknown>): Promise<T> {
  const res = await fetch(SHOP_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
    },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error ?? `Server merespons ${res.status}`);
  return data as T;
}

let snapLoading: Promise<void> | null = null;
function loadSnap(isProduction: boolean, clientKey: string): Promise<void> {
  if (window.snap) return Promise.resolve();
  if (snapLoading) return snapLoading;
  snapLoading = new Promise<void>((resolve, reject) => {
    const s = document.createElement('script');
    s.src = isProduction
      ? 'https://app.midtrans.com/snap/snap.js'
      : 'https://app.sandbox.midtrans.com/snap/snap.js';
    s.setAttribute('data-client-key', clientKey);
    s.onload = () => resolve();
    s.onerror = () => {
      snapLoading = null;
      reject(new Error('Gagal memuat jendela pembayaran Midtrans.'));
    };
    document.body.appendChild(s);
  });
  return snapLoading;
}

const PAYMENT_LABEL: Record<string, string> = {
  qris: 'QRIS',
  gopay: 'GoPay',
  shopeepay: 'ShopeePay',
};

const RECEIPT_JOKES = [
  'Dicap oleh laci nomor 3 yang paling jujur.',
  'Struk ini sah menurut hukum rak dan gantungan.',
  'Barang sudah dilap pakai kain flanel. Mungkin.',
  'Simpan struk ini di laci. Atau di dompet. Atau di lemari lain.',
];

interface Props {
  messageId: string;
  slug: string;
  sessionId: string;
}

export default function ShopCard({ messageId, slug, sessionId }: Props) {
  const storageKey = `lemariku_order_${messageId}`;
  const [product, setProduct] = useState<Product | null>(null);
  const [productMissing, setProductMissing] = useState(false);
  const [order, setOrder] = useState<Order | null>(null);
  const [qty, setQty] = useState(1);
  const [name, setName] = useState('');
  const [contact, setContact] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const orderCodeRef = useRef<string | null>(null);

  const refresh = useCallback(async (): Promise<Order | null> => {
    const code = orderCodeRef.current;
    if (!code) return null;
    try {
      const { order: o } = await shopCall<{ order: Order }>({
        action: 'status',
        order_code: code,
        session_id: sessionId,
      });
      setOrder(o);
      return o;
    } catch (e) {
      console.error('[shop] gagal cek status:', e);
      return null;
    }
  }, [sessionId]);

  // Muat barang.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from('products')
        .select('slug, name, price, stock, seller_name, seller_public_name')
        .eq('slug', slug)
        .maybeSingle();
      if (cancelled) return;
      if (data) setProduct(data as Product);
      else setProductMissing(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [slug]);

  // Pulihkan pesanan yang pernah dibuat dari kartu ini (mis. setelah halaman dimuat ulang).
  useEffect(() => {
    const saved = localStorage.getItem(storageKey);
    if (saved) {
      orderCodeRef.current = saved;
      void refresh();
    }
  }, [storageKey, refresh]);

  // Selama masih menunggu pembayaran, cek status berkala.
  useEffect(() => {
    if (order?.status !== 'pending') return;
    const t = setInterval(() => void refresh(), 5000);
    return () => clearInterval(t);
  }, [order?.status, refresh]);

  const openPayment = useCallback(
    async (o: Order) => {
      if (!o.snap_token || !o.client_key) return;
      setError(null);
      try {
        await loadSnap(o.is_production, o.client_key);
        window.snap?.pay(o.snap_token, {
          onSuccess: () => void refresh(),
          onPending: () => void refresh(),
          onError: () => setError('Pembayaran gagal. Coba lagi ya.'),
          onClose: () => void refresh(),
        });
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Gagal membuka pembayaran.');
      }
    },
    [refresh],
  );

  const submit = async () => {
    if (!product) return;
    setBusy(true);
    setError(null);
    try {
      const { order: o } = await shopCall<{ order: Order }>({
        action: 'create',
        session_id: sessionId,
        slug: product.slug,
        qty,
        buyer_name: name,
        buyer_contact: contact,
        note,
      });
      orderCodeRef.current = o.order_code;
      localStorage.setItem(storageKey, o.order_code);
      setOrder(o);
      await openPayment(o);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Gagal membuat pesanan.');
    } finally {
      setBusy(false);
    }
  };

  const resetOrder = () => {
    localStorage.removeItem(storageKey);
    orderCodeRef.current = null;
    setOrder(null);
    setError(null);
  };

  const shell = 'w-full max-w-sm rounded-2xl bg-[#0F2145] ring-1 ring-blue-500/30 p-4 text-sm text-slate-100';

  if (productMissing) {
    return <div className={shell}>Barangnya nggak ketemu di laciku 😵 Coba tanya lagi ya.</div>;
  }
  if (!product) {
    return (
      <div className={`${shell} flex items-center gap-2 text-blue-300/80`}>
        <Loader2 size={14} className="animate-spin" /> Membuka laci katalog...
      </div>
    );
  }

  // ---------- Struk ----------
  if (order?.status === 'paid') {
    const joke = RECEIPT_JOKES[order.order_code.charCodeAt(order.order_code.length - 1) % RECEIPT_JOKES.length];
    const paidAt = order.paid_at ? new Date(order.paid_at) : new Date(order.created_at);
    return (
      <div className="w-full max-w-sm rounded-md bg-[#FBF7EC] text-slate-800 font-mono text-[12px] leading-relaxed px-4 py-4 shadow-lg">
        <div className="text-center">
          <div className="flex items-center justify-center gap-1.5 text-emerald-700 font-bold text-sm">
            <CheckCircle2 size={16} /> LUNAS
          </div>
          <div className="font-bold tracking-widest mt-1">STRUK LEMARIKU</div>
          <div className="text-[11px] text-slate-500">Toko Laci &amp; Rak Serbaguna</div>
        </div>
        <div className="border-t border-dashed border-slate-400 my-3" />
        <Row l="No. Pesanan" r={order.order_code} />
        <Row l="Waktu" r={paidAt.toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' })} />
        <Row l="Pembeli" r={order.buyer_name} />
        <Row l="Penjual" r={order.seller_name} />
        {order.payment_type && <Row l="Bayar via" r={PAYMENT_LABEL[order.payment_type] ?? order.payment_type} />}
        <div className="border-t border-dashed border-slate-400 my-3" />
        <div className="font-bold">{order.product_name}</div>
        <Row l={`${order.qty} x ${rupiah(order.unit_price)}`} r={rupiah(order.subtotal)} />
        <Row l="Pajak Lemari" r={`+${rupiah(order.tax)}`} />
        <Row l="Diskon Pajak Lemari" r={`-${rupiah(order.tax_discount)}`} />
        <div className="border-t border-dashed border-slate-400 my-3" />
        <div className="flex justify-between font-bold text-sm">
          <span>TOTAL</span>
          <span>{rupiah(order.total)}</span>
        </div>
        <div className="border-t border-dashed border-slate-400 my-3" />
        <p className="text-center text-[11px] text-slate-600">
          Penjual akan menghubungimu untuk ketemuan/pengantaran.
          <br />
          {joke}
        </p>
      </div>
    );
  }

  // ---------- Menunggu bayar / gagal ----------
  if (order) {
    const done = order.status !== 'pending';
    return (
      <div className={shell}>
        <div className="flex items-center gap-2 font-semibold">
          {done ? <XCircle size={16} className="text-rose-400" /> : <Loader2 size={16} className="animate-spin text-blue-300" />}
          {order.status === 'pending' && 'Menunggu pembayaran'}
          {order.status === 'expired' && 'Pesanan kedaluwarsa'}
          {order.status === 'failed' && 'Pembayaran gagal'}
          {order.status === 'cancelled' && 'Pesanan dibatalkan'}
        </div>
        <p className="mt-2 text-slate-300">
          {order.qty} x {order.product_name} · total <strong className="text-white">{rupiah(order.total)}</strong>
          <br />
          <span className="text-xs text-slate-400">No. {order.order_code}</span>
        </p>
        {error && <p className="mt-2 text-rose-300 text-xs">{error}</p>}
        <div className="mt-3 flex flex-wrap gap-2">
          {order.status === 'pending' ? (
            <button type="button" onClick={() => void openPayment(order)} className={btnPrimary}>
              <CreditCard size={14} /> Bayar sekarang
            </button>
          ) : (
            <button type="button" onClick={resetOrder} className={btnPrimary}>
              <RotateCcw size={14} /> Pesan lagi
            </button>
          )}
          {order.status === 'pending' && (
            <button type="button" onClick={() => void refresh()} className={btnGhost}>
              Cek status
            </button>
          )}
        </div>
      </div>
    );
  }

  // ---------- Formulir ----------
  const soldOut = product.stock < 1;
  const maxQty = Math.max(1, Math.min(MAX_QTY, product.stock));
  const subtotal = product.price * qty;
  const valid = name.trim().length >= 2 && contact.trim().length >= 5 && !soldOut;
  const seller = product.seller_public_name ?? product.seller_name;

  return (
    <div className={shell}>
      <div className="flex items-start gap-2">
        <ShoppingBag size={16} className="mt-0.5 text-blue-300" />
        <div className="min-w-0">
          <div className="font-semibold">{product.name}</div>
          <div className="text-xs text-slate-400">
            {rupiah(product.price)} · stok {product.stock} · penjual: {seller}
          </div>
        </div>
      </div>

      {soldOut ? (
        <p className="mt-3 text-amber-300">Yah, stoknya habis barusan 😭</p>
      ) : (
        <>
          <div className="mt-3 flex items-center justify-between">
            <span className="text-slate-300">Jumlah</span>
            <div className="flex items-center gap-2">
              <button type="button" aria-label="Kurangi" onClick={() => setQty((q) => Math.max(1, q - 1))} className={stepBtn}>
                <Minus size={14} />
              </button>
              <span className="w-6 text-center font-semibold">{qty}</span>
              <button type="button" aria-label="Tambah" onClick={() => setQty((q) => Math.min(maxQty, q + 1))} className={stepBtn}>
                <Plus size={14} />
              </button>
            </div>
          </div>

          <div className="mt-3 space-y-2">
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} placeholder="Nama kamu" className={inputCls} />
            <input value={contact} onChange={(e) => setContact(e.target.value)} maxLength={60} placeholder="Nomor WA / kontak untuk dihubungi" className={inputCls} />
            <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} placeholder="Catatan (lokasi ketemuan, dll.) – opsional" className={inputCls} />
          </div>

          <div className="mt-3 rounded-lg bg-black/20 px-3 py-2 text-xs space-y-1">
            <Line l={`${qty} x ${rupiah(product.price)}`} r={rupiah(subtotal)} />
            <Line l="Pajak Lemari" r={`+${rupiah(10000)}`} />
            <Line l="Diskon Pajak Lemari" r={`-${rupiah(10000)}`} />
            <div className="flex justify-between border-t border-white/10 pt-1 font-semibold text-sm text-white">
              <span>Total</span>
              <span>{rupiah(subtotal)}</span>
            </div>
          </div>

          {error && <p className="mt-2 text-rose-300 text-xs">{error}</p>}

          <button type="button" disabled={!valid || busy} onClick={() => void submit()} className={`${btnPrimary} mt-3 w-full justify-center disabled:opacity-50 disabled:cursor-not-allowed`}>
            {busy ? <Loader2 size={14} className="animate-spin" /> : <CreditCard size={14} />}
            Pesan &amp; Bayar (QRIS / e-wallet)
          </button>
        </>
      )}
    </div>
  );
}

const inputCls =
  'w-full rounded-lg bg-[#0B1730] ring-1 ring-blue-800/50 focus:ring-blue-400 outline-none px-3 py-2 text-sm text-white placeholder:text-slate-500';
const btnPrimary =
  'inline-flex items-center gap-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold px-3 py-2.5 transition-colors';
const btnGhost =
  'inline-flex items-center gap-2 rounded-xl bg-blue-600/20 hover:bg-blue-600/35 ring-1 ring-blue-500/40 text-blue-200 text-xs font-semibold px-3 py-2.5 transition-colors';
const stepBtn =
  'h-7 w-7 inline-flex items-center justify-center rounded-lg bg-blue-600/25 hover:bg-blue-600/45 ring-1 ring-blue-500/40';

function Line({ l, r }: { l: string; r: string }) {
  return (
    <div className="flex justify-between text-slate-300">
      <span>{l}</span>
      <span>{r}</span>
    </div>
  );
}

function Row({ l, r }: { l: string; r: string }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-slate-500">{l}</span>
      <span className="text-right break-all">{r}</span>
    </div>
  );
}