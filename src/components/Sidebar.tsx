import { Phone, FileAudio, Gamepad2, GraduationCap, Trash2, ChevronLeft, ChevronRight, X } from 'lucide-react';
import WardrobeLogo from './WardrobeLogo';

interface Props {
  open: boolean;
  onToggle: () => void;
  onCall: () => void;
  onTranscript: () => void;
  onMinigame: () => void;
  onThesis: () => void;
  onClearChat: () => void;
  isPremium: boolean;
}

export default function Sidebar({ open, onToggle, onCall, onTranscript, onMinigame, onThesis, onClearChat, isPremium }: Props) {
  return (
    <>
      {/* Mobile overlay */}
      {open && (
        <div
          className="fixed inset-0 z-30 bg-black/50 backdrop-blur-sm lg:hidden animate-fadeInUp"
          onClick={onToggle}
        />
      )}

      <aside
        className={`fixed top-0 left-0 z-40 h-full w-72 bg-[#0A1A33] border-r border-blue-900/50 flex flex-col transition-transform duration-300 ease-out ${
          open ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        {/* Sidebar header */}
        <div className="flex items-center justify-between px-4 py-4 border-b border-blue-900/40">
          <div className="flex items-center gap-3">
            <div>
              <WardrobeLogo size={36} />
            </div>
            <div>
              <h2 className="text-sm font-bold text-white leading-tight">Lemariku AI 1.2</h2>
              <p className="text-[10px] text-blue-300/60 leading-tight">Menu</p>
            </div>
          </div>
          <button
            onClick={onToggle}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-700/50 transition-colors lg:hidden"
          >
            <X size={18} />
          </button>
        </div>

        {/* Menu items */}
        <nav className="flex-1 px-3 py-4 space-y-1.5 overflow-y-auto">
          {/* Voice Call */}
          <button
            onClick={onCall}
            className="w-full flex items-center gap-3 px-3 py-3 rounded-xl bg-blue-600/15 hover:bg-blue-600/25 ring-1 ring-blue-600/30 text-white transition-all duration-200 group"
          >
            <div className="w-9 h-9 rounded-lg bg-blue-500/20 ring-1 ring-blue-400/30 flex items-center justify-center group-hover:scale-110 transition-transform">
              <Phone size={18} className="text-blue-300" />
            </div>
            <div className="text-left">
              <p className="text-sm font-semibold text-white">Panggilan Suara</p>
              <p className="text-[11px] text-blue-300/60">Telepon Lemari</p>
            </div>
          </button>

          {/* Transcript */}
          <button
            onClick={onTranscript}
            className="w-full flex items-center gap-3 px-3 py-3 rounded-xl bg-slate-800/50 hover:bg-slate-700/50 ring-1 ring-slate-600/30 text-slate-200 transition-all duration-200 group"
          >
            <div className="w-9 h-9 rounded-lg bg-slate-600/30 ring-1 ring-slate-500/20 flex items-center justify-center group-hover:scale-110 transition-transform">
              <FileAudio size={18} className="text-slate-300" />
            </div>
            <div className="text-left">
              <p className="text-sm font-semibold text-white">Transkrip</p>
              <p className="text-[11px] text-slate-400/80">Suara jadi teks</p>
            </div>
          </button>

          {/* Minigame */}
          <button
            onClick={onMinigame}
            className="w-full flex items-center gap-3 px-3 py-3 rounded-xl bg-slate-800/50 hover:bg-slate-700/50 ring-1 ring-slate-600/30 text-slate-200 transition-all duration-200 group"
          >
            <div className="w-9 h-9 rounded-lg bg-slate-600/30 ring-1 ring-slate-500/20 flex items-center justify-center group-hover:scale-110 transition-transform">
              <Gamepad2 size={18} className="text-slate-300" />
            </div>
            <div className="text-left">
              <p className="text-sm font-semibold text-white">Mini Game</p>
              <p className="text-[11px] text-slate-400/80">Cari barang di lantai</p>
            </div>
          </button>

          {/* Thesis */}
          <button
            onClick={onThesis}
            className="w-full flex items-center gap-3 px-3 py-3 rounded-xl bg-slate-800/50 hover:bg-slate-700/50 ring-1 ring-slate-600/30 text-slate-200 transition-all duration-200 group"
          >
            <div className="w-9 h-9 rounded-lg bg-slate-600/30 ring-1 ring-slate-500/20 flex items-center justify-center group-hover:scale-110 transition-transform">
              <GraduationCap size={18} className="text-slate-300" />
            </div>
            <div className="text-left">
              <p className="text-sm font-semibold text-white">Buat Skripsi</p>
              <p className="text-[11px] text-slate-400/80">Selesaikan skripsi dalam 30 menit</p>
            </div>
          </button>

          {/* Clear chat */}
          <button
            onClick={onClearChat}
            className="w-full flex items-center gap-3 px-3 py-3 rounded-xl bg-slate-800/50 hover:bg-red-950/40 ring-1 ring-slate-600/30 hover:ring-red-700/30 text-slate-200 hover:text-red-300 transition-all duration-200 group"
          >
            <div className="w-9 h-9 rounded-lg bg-slate-600/30 ring-1 ring-slate-500/20 group-hover:bg-red-600/15 group-hover:ring-red-500/20 flex items-center justify-center transition-all group-hover:scale-110">
              <Trash2 size={18} className="text-slate-300 group-hover:text-red-300" />
            </div>
            <div className="text-left">
              <p className="text-sm font-semibold">Bersihkan Obrolan</p>
              <p className="text-[11px] text-slate-400/80">Hapus semua pesan</p>
            </div>
          </button>
        </nav>

        {/* Footer */}
        <div className="px-4 py-4 border-t border-blue-900/40">
          <p className="text-[10px] text-slate-500 text-center">
            Lemariku AI 1.2 oleh Nerfyu
          </p>
          {isPremium && (
            <p className="text-[10px] text-yellow-500/70 text-center mt-1">
              Premium Aktif
            </p>
          )}
        </div>
      </aside>

      {/* Toggle button (always visible, outside sidebar) */}
      <button
        onClick={onToggle}
        className={`fixed top-1/2 -translate-y-1/2 z-30 w-7 h-14 rounded-r-xl bg-[#0A1A33] border border-blue-900/50 border-l-0 flex items-center justify-center text-blue-300/70 hover:text-white hover:bg-blue-800/50 transition-all duration-300 ${
          open ? 'left-72' : 'left-0'
        }`}
        title={open ? 'Tutup menu' : 'Buka menu'}
      >
        {open ? <ChevronLeft size={18} /> : <ChevronRight size={18} />}
      </button>
    </>
  );
}
