import { useState } from 'react';
import { X, Crown, CheckCircle2, AlertCircle } from 'lucide-react';

interface Props {
  onClose: () => void;
}

type Step = 'offer' | 'paying' | 'success';

export default function SubscribeModal({ onClose }: Props) {
  const [step, setStep] = useState<Step>('offer');
  const [notNowError, setNotNowError] = useState(false);

  function handleNotNow() {
    setNotNowError(true);
  }

  function handlePay() {
    setStep('paying');
    setTimeout(() => {
      setStep('success');
      setTimeout(() => {
        onClose();
      }, 1200);
    }, 2000);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />

      {/* Modal */}
      <div className="relative w-full max-w-sm animate-fadeInUp">
        <div className="bg-[#0D1F3C] border border-blue-700/40 rounded-2xl shadow-2xl shadow-blue-950/60 overflow-hidden">

          {step === 'offer' && (
            <>
              {/* Header */}
              <div className="bg-gradient-to-br from-blue-700/40 via-blue-800/30 to-transparent px-6 pt-7 pb-5 text-center">
                <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-yellow-500/10 ring-1 ring-yellow-400/30 mb-4">
                  <Crown size={28} className="text-yellow-400" />
                </div>
                <h2 className="text-xl font-bold text-white mb-1">Lemari Premium</h2>
                <p className="text-sm text-blue-200/70">Upgrade biar Lemari nggak kehabisan laci 🚪✨</p>
              </div>

              {/* Body */}
              <div className="px-6 py-5 space-y-4">
                <div className="text-center">
                  <p className="text-3xl font-bold text-white">
                    IDR 19.000.000
                    <span className="text-sm font-normal text-slate-400">/Tahun</span>
                  </p>
                  <p className="text-xs text-slate-500 mt-1">Bayar sekarang sebelum naik sebesar 58%</p>
                </div>

                <ul className="space-y-2 text-sm text-slate-300">
                  {[
                    'Chat dengan Lemariku tanpa batas',
                    'Respons lemari lebih ngawur',
                    'Akses eksklusif ke rak premium',
                    'Dapat akses telepon, tapi boong',
                  ].map((item) => (
                    <li key={item} className="flex items-start gap-2">
                      <CheckCircle2 size={15} className="text-blue-400 mt-0.5 flex-shrink-0" />
                      {item}
                    </li>
                  ))}
                </ul>

                {/* Error message for "Tidak sekarang" */}
                {notNowError && (
                  <div className="flex items-start gap-2 bg-red-900/30 border border-red-700/40 rounded-xl px-4 py-3 animate-fadeInUp">
                    <AlertCircle size={15} className="text-red-400 mt-0.5 flex-shrink-0" />
                    <p className="text-sm text-red-300 font-medium">
                      Tidak bisa nanti, harus bayar sekarang!
                    </p>
                  </div>
                )}

                {/* Buttons */}
                <div className="flex flex-col gap-2 pt-1">
                  <button
                    onClick={handlePay}
                    className="w-full py-3 rounded-xl bg-blue-600 hover:bg-blue-500 active:scale-95 text-white text-sm font-bold transition-all duration-250 shadow-lg shadow-blue-900/40"
                  >
                    Bayar
                  </button>
                  <button
                    onClick={handleNotNow}
                    className="w-full py-2.5 rounded-xl text-slate-400 hover:text-slate-200 hover:bg-slate-700/40 text-sm transition-all duration-250"
                  >
                    Tidak sekarang
                  </button>
                </div>

                <p className="text-center text-[10px] text-slate-600">
                  *Bisa bayar pakai keris
                </p>
              </div>
            </>
          )}

          {step === 'paying' && (
            <div className="px-6 py-14 flex flex-col items-center gap-4">
              <div className="w-14 h-14 rounded-2xl bg-blue-700/20 ring-1 ring-blue-600/40 flex items-center justify-center">
                <div className="w-7 h-7 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
              </div>
              <p className="text-lg font-semibold text-white">Proses membayar...</p>
              <p className="text-sm text-slate-400">Tolong tunggu, lemari lagi ngitung recehan..</p>
            </div>
          )}

          {step === 'success' && (
            <div className="px-6 py-14 flex flex-col items-center gap-4 animate-fadeInUp">
              <div className="w-14 h-14 rounded-2xl bg-green-700/20 ring-1 ring-green-500/40 flex items-center justify-center">
                <CheckCircle2 size={32} className="text-green-400" />
              </div>
              <p className="text-lg font-bold text-white">Transaksi berhasil! 🎉</p>
              <p className="text-sm text-slate-400 text-center">
                Selamat datang di Lemari Premium!<br />Laci kamu kini tak terbatas ✨
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
