// Nerfyu
// Menyiapkan gambar sebelum dikirim ke Lemariku: dicek, diperkecil, lalu diubah ke teks base64.
// Gambar dikecilkan agar jauh di bawah batas Groq (permintaan base64 maksimal 4 MB) dan cepat terkirim.

const MAX_SIDE = 1024; // sisi terpanjang setelah diperkecil (piksel)
const MAX_BYTES = 1_500_000; // sasaran ukuran akhir (± 1,5 MB)
const MAX_INPUT_BYTES = 15 * 1024 * 1024; // gambar asli yang diterima (15 MB)
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

type DrawableImage = ImageBitmap | HTMLImageElement;

async function loadImage(file: File): Promise<DrawableImage> {
  if ('createImageBitmap' in window) {
    try {
      return await createImageBitmap(file);
    } catch {
      /* lanjut ke cara cadangan */
    }
  }
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Lemari gagal lihat gambar-nya nih, coba ganti dengan gambar lain'));
    };
    img.src = url;
  });
}

function sizeOf(img: DrawableImage): { width: number; height: number } {
  return img instanceof HTMLImageElement
    ? { width: img.naturalWidth, height: img.naturalHeight }
    : { width: img.width, height: img.height };
}

// Mengembalikan data URL JPEG (data:image/jpeg;base64,...). Melempar Error berbahasa Indonesia jika gagal.
export async function prepareImage(file: File): Promise<string> {
  if (!ALLOWED_TYPES.includes(file.type)) {
    throw new Error('Format gambar tidak bisa dilihat Lemari. Pakai JPG, PNG, atau WebP.');
  }
  if (file.size > MAX_INPUT_BYTES) {
    throw new Error('Lemari sekecil ini harus berhadapan dengan gambar yang besar :( (maksimal 15 MB).');
  }

  const img = await loadImage(file);
  const { width, height } = sizeOf(img);
  if (!width || !height) throw new Error('Lemari gak bisa lihat gambarnya, coba yang lain.');

  const scale = Math.min(1, MAX_SIDE / Math.max(width, height));
  const w = Math.max(1, Math.round(width * scale));
  const h = Math.max(1, Math.round(height * scale));

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Lemari tidak bisa lihat gambar dengan browser ini.');

  ctx.fillStyle = '#ffffff'; // PNG transparan diberi latar putih
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(img, 0, 0, w, h);
  if ('close' in img) img.close();

  for (let quality = 0.85; quality >= 0.4; quality -= 0.15) {
    const dataUrl = canvas.toDataURL('image/jpeg', quality);
    const approxBytes = (dataUrl.length - dataUrl.indexOf(',') - 1) * 0.75;
    if (approxBytes <= MAX_BYTES) return dataUrl;
  }
  throw new Error('Gambar masih terlalu besar setelah dikecilkan. Coba gambar lain.');
}
