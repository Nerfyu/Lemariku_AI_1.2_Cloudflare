import { useState, useRef, useEffect } from 'react';
import { X, Lock, ArrowRight, AlertCircle } from 'lucide-react';
import WardrobeLogo from './WardrobeLogo';

interface Props {
  onClose: () => void;
  onSuccess: () => void;
}

const ACCESS_CODE = 'cariakulemariku';

export default function AccessCodeModal({ onClose, onSuccess }: Props) {
  const [input, setInput] = useState('');
  const [error, setError] = useState(false);
  const [shake, setShake] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (input.trim().toLowerCase() === ACCESS_CODE) {
      onSuccess();
    } else {
      setError(true);
      setShake(true);
      setTimeout(() => setShake(false), 500);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />

      <div className={`relative w-full max-w-sm animate-fadeInUp ${shake ? 'animate-shake' : ''}`}>
        <div className="bg-[#0D1F3C] border border-blue-700/40 rounded-2xl shadow-2xl shadow-blue-950/60 overflow-hidden">
          {/* Header */}
          <div className="bg-gradient-to-br from-blue-700/40 via-blue-800/30 to-transparent px-6 pt-7 pb-5 text-center relative">
            <button
              onClick={onClose}
              className="absolute top-3 right-3 p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-700/50 transition-colors"
            >
              <X size={18} />
            </button>
            <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-blue-500/10 ring-1 ring-blue-400/30 mb-4">
              <Lock size={26} className="text-blue-300" />
            </div>
            <h2 className="text-xl font-bold text-white mb-1">Kode Akses</h2>
            <p className="text-sm text-blue-200/70">Masukkan kode akses untuk mulai telepon Lemari</p>
          </div>

          {/* Body */}
          <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
            <div>
              <input
                ref={inputRef}
                type="text"
                value={input}
                onChange={(e) => { setInput(e.target.value); setError(false); }}
                placeholder="Masukkan kode akses..."
                className={`w-full bg-[#13284F] text-sm text-slate-100 placeholder:text-slate-500 rounded-xl px-4 py-3.5 outline-none transition-all duration-300 ring-1 ${
                  error ? 'ring-red-600/60' : 'ring-blue-800/40 focus:ring-blue-500/60'
                }`}
                autoComplete="off"
              />
            </div>

            {error && (
              <div className="flex items-start gap-2 bg-red-900/30 border border-red-700/40 rounded-xl px-4 py-3 animate-fadeInUp">
                <AlertCircle size={15} className="text-red-400 mt-0.5 flex-shrink-0" />
                <p className="text-sm text-red-300 font-medium">
                  Kode akses salah. Coba lagi ya.
                </p>
              </div>
            )}

            <button
              type="submit"
              className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-blue-600 hover:bg-blue-500 active:scale-95 text-white text-sm font-bold transition-all duration-200 shadow-lg shadow-blue-900/40"
            >
              Masuk
              <ArrowRight size={16} />
            </button>

            <div className="flex items-center gap-2 justify-center pt-1">
              <div>
                <WardrobeLogo size={22} />
              </div>
              <p className="text-[10px] text-slate-600">Lemariku AI • Harus punya izin developer</p>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
