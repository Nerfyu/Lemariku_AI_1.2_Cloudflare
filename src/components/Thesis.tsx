import { ArrowLeft, AlertTriangle } from 'lucide-react';
interface Props {
  onBack: () => void;
}
export default function Thesis({ onBack }: Props) {
  return (
    <div className="h-[100dvh] flex flex-col bg-gradient-to-b from-[#0A2E5C] via-[#0B1F3A] to-[#061528] text-white">
      <header className="flex items-center gap-3 px-4 py-3 border-b border-blue-900/40">
        <button
          onClick={onBack}
          className="p-2 rounded-lg text-slate-300 hover:text-white hover:bg-slate-700/50 transition-colors"
          title="Kembali"
        >
          <ArrowLeft size={20} />
        </button>
        <div>
          <h1 className="text-base font-bold leading-tight">Buat Skripsi</h1>
          <p className="text-[11px] text-blue-300/70 leading-tight">Selesaikan skripsi dalam 30 menit</p>
        </div>
      </header>
      <main className="flex-1 min-h-0 overflow-y-auto flex items-center justify-center px-6">
        <div className="max-w-sm w-full rounded-2xl bg-black/30 ring-1 ring-red-500/30 p-6 text-center">
          <div className="mx-auto w-14 h-14 rounded-full bg-red-500/15 ring-1 ring-red-400/30 flex items-center justify-center mb-4">
            <AlertTriangle size={26} className="text-red-300" />
          </div>
          <h2 className="text-lg font-semibold mb-1">Fitur belum tersedia</h2>
          <p className="text-sm text-slate-300/80">Fitur "Buat Skripsi" masih dalam tahap peninjauan dan pengembangan. Coba lagi nanti ya.</p>
          <button
            onClick={onBack}
            className="mt-5 px-4 py-2 rounded-xl bg-blue-600/80 hover:bg-blue-500 text-sm font-semibold transition-colors"
          >
            Kembali ke obrolan
          </button>
        </div>
      </main>
    </div>
  );
}
