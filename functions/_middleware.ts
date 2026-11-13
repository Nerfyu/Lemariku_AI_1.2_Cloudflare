// Nerfyu
// Cloudflare Pages Function: mengacak judul, deskripsi, dan gambar pratinjau (OG)
// setiap kali halaman HTML diminta (termasuk oleh crawler WhatsApp/Telegram/FB/X).

interface Variant {
  title: string;
  description: string;
  image: string; // 1200x630 atau URL gambar
}

const VARIANTS: Variant[] = [
  {
    title: 'Lemariku AI 1.3',
    description: 'Konon katanya Lemari adalah makhluk yang berpikir',
    image: '/og/og-1.jpg',
  },
  {
    title: 'Lemariku AI 1.4 ehh... 3',
    description: 'Lemariku AI: "Kalo typo itu dihapus, tolong segera diiniin"',
    image: '/og/og-2.jpg',
  },
  {
    title: 'Coba lihat gambar',
    description: 'Lemariku AI 1.3: "Yang bikin thumbnail agak lain."',
    image: '/og/og-3.jpg',
  },
  {
    title: '[BERAKING NEWS!] Bikin heboh satu bumi! Nerfyu makan mie kuah pakai tangan kosong',
    description: 'Saksi Lemariku AI: "Aku melihatnya sendiri dengan kedua laciku"',
    image: '/og/og-4.jpg',
  },
];

export const onRequest: PagesFunction = async (context) => {
  const response = await context.next();

  // Hanya olah HTML, biarkan JS/CSS/gambar/audio lewat apa adanya.
  const type = response.headers.get('content-type') ?? '';
  if (!type.includes('text/html')) return response;

  const url = new URL(context.request.url);

  // ?v=2 untuk memaksa varian tertentu (berguna saat testing).
  const forced = Number(url.searchParams.get('v'));
  const idx =
    Number.isInteger(forced) && forced >= 1 && forced <= VARIANTS.length
      ? forced - 1
      : Math.floor(Math.random() * VARIANTS.length);
  const v = VARIANTS[idx];

  const image = v.image.startsWith('http') ? v.image : `${url.origin}${v.image}`;
  const set = (content: string) => ({
    element(el: Element) {
      el.setAttribute('content', content);
    },
  });

  const rewritten = new HTMLRewriter()
    .on('meta[property="og:title"]', set(v.title))
    .on('meta[name="twitter:title"]', set(v.title))
    .on('meta[property="og:description"]', set(v.description))
    .on('meta[name="twitter:description"]', set(v.description))
    .on('meta[property="og:image"]', set(image))
    .on('meta[name="twitter:image"]', set(image))
    .on('meta[property="og:url"]', set(`${url.origin}/`))
    .transform(response);

  // Jangan di-cache agar tiap permintaan bisa dapat varian berbeda.
  const headers = new Headers(rewritten.headers);
  headers.set('Cache-Control', 'no-cache');
  return new Response(rewritten.body, { status: rewritten.status, headers });
};
