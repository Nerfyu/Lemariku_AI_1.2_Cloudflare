// Nerfyu
interface LogoProps {
  size?: number;
  className?: string;
}

// ---------------------------------------------------------------------------
// Logo = gambar apa adanya (transparan)
// Mengambil file bernama "logo" di folder src/assets. Formatnya bebas: png, gif, webp, jpg, svg.
// Cara mengganti logo: hapus logo lama, lalu taruh logo baru, misalnya src/assets/logo.gif.
// Kode ini tidak perlu diubah. Sebaiknya hanya ada SATU file logo di folder itu
// (kalau ada lebih dari satu, urutan huruf menentukan: gif lebih dulu daripada png).
// ---------------------------------------------------------------------------
const LOGO_FILES = import.meta.glob('../assets/logo.{png,gif,webp,jpg,jpeg,svg}', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>;

const LOGO_SRC: string | undefined = Object.keys(LOGO_FILES)
  .sort()
  .map((key) => LOGO_FILES[key])[0];

export default function WardrobeLogo({ size = 48, className = '' }: LogoProps) {
  // Belum ada file logo: pakai logo bawaan lama supaya aplikasi tidak rusak
  if (!LOGO_SRC) return <FallbackLogo size={size} className={className} />;

  return (
    <img
      src={LOGO_SRC}
      alt="Lemariku logo"
      width={size}
      height={size}
      draggable={false}
      className={`inline-block flex-shrink-0 select-none ${className}`}
      style={{ width: size, height: size, objectFit: 'contain' }}
    />
  );
}

// Logo lama (gambar vektor), hanya muncul jika file logo di src/assets belum ada.
function FallbackLogo({ size, className }: { size: number; className: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      className={className}
      aria-label="Lemariku logo"
    >
      <rect x="2" y="2" width="60" height="60" rx="14" fill="#0A0A0A" />
      <rect x="2" y="2" width="60" height="60" rx="14" stroke="#1E3A5F" strokeWidth="1.5" />
      <rect x="16" y="12" width="32" height="44" rx="3" fill="#2563EB" />
      <rect x="16" y="12" width="32" height="44" rx="3" stroke="#3B82F6" strokeWidth="1" />
      <rect x="18" y="14" width="14" height="40" rx="2" fill="#1D4ED8" />
      <rect x="32" y="14" width="14" height="40" rx="2" fill="#1D4ED8" />
      <line x1="32" y1="14" x2="32" y2="54" stroke="#0A0A0A" strokeWidth="0.8" opacity="0.5" />
      <circle cx="29" cy="34" r="1.5" fill="#93C5FD" />
      <circle cx="35" cy="34" r="1.5" fill="#93C5FD" />
      <line x1="18" y1="24" x2="46" y2="24" stroke="#0A0A0A" strokeWidth="0.5" opacity="0.3" />
      <line x1="18" y1="44" x2="46" y2="44" stroke="#0A0A0A" strokeWidth="0.5" opacity="0.3" />
      <rect x="16" y="12" width="32" height="44" rx="3" stroke="#60A5FA" strokeWidth="0.5" opacity="0.4" />
    </svg>
  );
}

