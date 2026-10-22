// Nerfyu
import { useState, useRef, useCallback } from 'react';
import { ArrowLeft, FileAudio, Loader2, Copy, Check, RefreshCw, AlertCircle, CheckCircle2, Download, Globe } from 'lucide-react';
import WardrobeLogo from './WardrobeLogo';

interface Props {
  onBack: () => void;
}

type TranscribeState = 'idle' | 'processing' | 'done' | 'error';

interface LanguageOption {
  code: string;
  label: string;
  flag: string;
}

const LANGUAGES: LanguageOption[] = [
  { code: 'id', label: 'Indonesia', flag: 'ID' },
  { code: 'ar', label: 'Arab', flag: 'SA' },
  { code: 'en', label: 'Inggris', flag: 'GB' },
  { code: 'ja', label: 'Jepang', flag: 'JP' },
  { code: 'fa', label: 'Persia', flag: 'IR' },
];

const SUCCESS_MESSAGES = [
  'Udah jadi nih',
  'Udah selesai, cek dulu ya',
  'Here you go',
  'Siap, transkripnya kelar',
  'Lemari udah catat semuanya',
  'Voila! teks-nya siap pakai',
];

const ERROR_MESSAGES = [
  'Waduh, lemari gak denger apa-apa nih',
  'Maaf, suaranya terlalu pelan untuk lemari',
  'Hmm, file ini kayaknya rusak deh',
  'Lemari bingung, coba file lain ya',
  'Gagal nih, laci lemari kejepit tadi',
];

function randomMessage(arr: string[]): string {
  return arr[Math.floor(Math.random() * arr.length)];
}

const MAX_FILE_SIZE = 25 * 1024 * 1024; // 25MB

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export default function Transcript({ onBack }: Props) {
  const [state, setState] = useState<TranscribeState>('idle');
  const [resultText, setResultText] = useState('');
  const [statusMessage, setStatusMessage] = useState('');
  const [fileName, setFileName] = useState('');
  const [fileSize, setFileSize] = useState(0);
  const [errorMsg, setErrorMsg] = useState('');
  const [copied, setCopied] = useState(false);
  const [selectedLang, setSelectedLang] = useState<string>('id');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const validateFile = useCallback((file: File): string | null => {
    if (!file.type.startsWith('audio/')) {
      return 'File harus berupa audio (mp3, wav, ogg, m4a, dll).';
    }
    if (file.size > MAX_FILE_SIZE) {
      return `File terlalu besar. Maksimal 25MB, berkas-mu ${formatBytes(file.size)}.`;
    }
    return null;
  }, []);

  const startTranscription = useCallback(async (file: File) => {
    setState('processing');
    setStatusMessage('');

    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('language', selectedLang);

      const apiUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/transcribe`;
      const res = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
        },
        body: formData,
      });

      const data = await res.json();

      if (!res.ok) {
        const serverError: string = data.error ?? 'Unknown error';
        throw new Error(serverError);
      }

      const text: string = data.text ?? '';

      if (text.trim()) {
        setResultText(text.trim());
        setState('done');
        setStatusMessage(randomMessage(SUCCESS_MESSAGES));
      } else {
        setState('error');
        setStatusMessage(randomMessage(ERROR_MESSAGES));
        setErrorMsg(data.error ?? 'Tidak ada teks yang terdeteksi dari file suara ini.');
      }
    } catch (err) {
      setState('error');
      setStatusMessage(randomMessage(ERROR_MESSAGES));
      setErrorMsg(err instanceof Error ? err.message : 'Terjadi kesalahan saat memproses file.');
    }
  }, [selectedLang]);

  const handleFileChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Reset
    setResultText('');
    setCopied(false);
    setErrorMsg('');
    setFileName(file.name);
    setFileSize(file.size);

    // Validate file type and size
    const validationError = validateFile(file);
    if (validationError) {
      setState('error');
      setStatusMessage(randomMessage(ERROR_MESSAGES));
      setErrorMsg(validationError);
      return;
    }

    await startTranscription(file);

    // Reset input so the same file can be re-selected later
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }, [validateFile, startTranscription]);

  function handleReset() {
    setState('idle');
    setResultText('');
    setStatusMessage('');
    setFileName('');
    setFileSize(0);
    setErrorMsg('');
    setCopied(false);
  }

  function handleCopy() {
    if (!resultText) return;
    navigator.clipboard.writeText(resultText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function handleDownload() {
    if (!resultText) return;
    const blob = new Blob([resultText], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `transkrip-${fileName || 'lemariku'}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const isProcessing = state === 'processing';
  const selectedLangObj = LANGUAGES.find((l) => l.code === selectedLang) ?? LANGUAGES[0];

  return (
    <div className="h-[100dvh] overflow-hidden bg-[#0B1426] text-slate-100 flex flex-col">
      {/* Ambient background */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute -top-40 -left-40 w-96 h-96 bg-blue-600/10 rounded-full blur-3xl" />
        <div className="absolute -bottom-40 -right-40 w-96 h-96 bg-cyan-500/8 rounded-full blur-3xl" />
      </div>

      {/* Header */}
      <header className="relative z-20 flex-shrink-0 border-b border-blue-900/40 bg-[#0B1426]/80 backdrop-blur-md">
        <div className="max-w-3xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button
              onClick={onBack}
              className="flex items-center justify-center rounded-xl bg-slate-800/60 ring-1 ring-slate-600/40 w-9 h-9 transition-all duration-200 hover:scale-110 hover:bg-slate-700/60 active:scale-95"
              title="Kembali"
            >
              <ArrowLeft size={18} className="text-slate-300" />
            </button>
            <div>
              <WardrobeLogo size={36} />
            </div>
            <div>
              <h1 className="text-lg font-bold tracking-tight leading-tight text-white">Lemariku - Transkrip</h1>
              <p className="text-xs text-blue-300/70 leading-tight">Ubah berkas suara jadi teks</p>
            </div>
          </div>
          {state !== 'idle' && state !== 'processing' && (
            <button
              onClick={handleReset}
              className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-white bg-slate-800/60 hover:bg-slate-700/60 rounded-lg px-3 py-2 ring-1 ring-slate-600/40 transition-all"
            >
              <RefreshCw size={14} />
              <span className="hidden sm:inline">Reset</span>
            </button>
          )}
        </div>
      </header>

      {/* Main content */}
      <main className="relative z-10 flex-1 overflow-y-auto min-h-0">
        <div className="max-w-3xl mx-auto px-4 py-6">
          {state === 'idle' && (
            <div className="flex flex-col items-center justify-center min-h-[60vh] gap-6">
              {/* Language selector */}
              <div className="w-full max-w-md">
                <div className="flex items-center gap-2 mb-3">
                  <Globe size={16} className="text-blue-300" />
                  <p className="text-sm font-semibold text-white">Fokus Bahasa</p>
                </div>
                <div className="grid grid-cols-5 gap-2">
                  {LANGUAGES.map((lang) => (
                    <button
                      key={lang.code}
                      onClick={() => setSelectedLang(lang.code)}
                      className={`flex flex-col items-center gap-1.5 py-3 rounded-xl transition-all duration-200 ${
                        selectedLang === lang.code
                          ? 'bg-blue-600/30 ring-2 ring-blue-500/60 scale-105'
                          : 'bg-slate-800/50 ring-1 ring-slate-600/30 hover:bg-slate-700/50 hover:ring-slate-500/40'
                      }`}
                      title={lang.label}
                    >
                      <span className="text-xl">{lang.flag}</span>
                      <span className={`text-[10px] font-medium leading-tight text-center ${
                        selectedLang === lang.code ? 'text-white' : 'text-slate-400'
                      }`}>
                        {lang.label}
                      </span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Upload zone */}
              <label className="w-full max-w-md cursor-pointer group">
                <div className="border-2 border-dashed border-blue-700/40 rounded-3xl px-8 py-12 text-center transition-all duration-300 group-hover:border-blue-500/60 group-hover:bg-blue-600/5">
                  <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-blue-500/10 ring-1 ring-blue-400/30 mb-4 group-hover:scale-110 transition-transform duration-300">
                    <FileAudio size={32} className="text-blue-300" />
                  </div>
                  <p className="text-base font-bold text-white mb-1">Pilih berkas suara</p>
                  <p className="text-sm text-slate-400">Tekan untuk unggah berkas suara</p>
                </div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="audio/*"
                  onChange={handleFileChange}
                  className="hidden"
                />
              </label>

              {/* Info card */}
              <div className="bg-[#13284F] ring-1 ring-blue-800/30 rounded-2xl px-5 py-4 max-w-md w-full space-y-2">
                <p className="text-xs text-blue-300/70 leading-relaxed text-center">
                  Lemari akan memproses berkas suara-mu dengan fokus bahasa {selectedLangObj.label} dan mengubahnya menjadi teks.
                </p>
                <div className="flex items-center justify-center gap-4 pt-1 border-t border-blue-800/20">
                  <div className="text-center">
                    <p className="text-[10px] text-slate-500 uppercase tracking-wider">Maks. Ukuran</p>
                    <p className="text-xs font-semibold text-blue-300">25 MB</p>
                  </div>
                  <div className="w-px h-8 bg-blue-800/20" />
                  <div className="text-center">
                    <p className="text-[10px] text-slate-500 uppercase tracking-wider">Format</p>
                    <p className="text-xs font-semibold text-blue-300">mp3, wav, ogg, m4a</p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {isProcessing && (
            <div className="flex flex-col items-center justify-center min-h-[60vh] gap-5">
              <div className="relative flex items-center justify-center">
                <div className="absolute w-28 h-28 rounded-full bg-blue-400/15 animate-ping" />
                <div className="relative w-24 h-24 flex items-center justify-center">
                  <div className="rounded-2xl">
                    <WardrobeLogo size={52} />
                  </div>
                </div>
              </div>
              <div className="text-center">
                <div className="flex items-center justify-center gap-2 mb-2">
                  <Loader2 size={18} className="animate-spin text-blue-300" />
                  <p className="text-lg font-bold text-white">Lemari lagi dengerin...</p>
                </div>
                <p className="text-sm text-blue-300/60 truncate max-w-xs">{fileName}</p>
                <div className="flex items-center justify-center gap-2 mt-2">
                  <span className="text-base">{selectedLangObj.flag}</span>
                  <p className="text-xs text-slate-500">{selectedLangObj.label} • {formatBytes(fileSize)}</p>
                </div>
              </div>
            </div>
          )}

          {(state === 'done' || state === 'error') && (
            <div className="space-y-5">
              {/* Status banner */}
              <div className={`rounded-2xl px-5 py-4 flex items-center gap-3 animate-fadeInUp ${
                state === 'done'
                  ? 'bg-green-900/20 ring-1 ring-green-700/40'
                  : 'bg-red-900/20 ring-1 ring-red-700/40'
              }`}>
                {state === 'done' ? (
                  <CheckCircle2 size={22} className="text-green-400 flex-shrink-0" />
                ) : (
                  <AlertCircle size={22} className="text-red-400 flex-shrink-0" />
                )}
                <div className="min-w-0 flex-1">
                  <p className={`text-sm font-bold ${state === 'done' ? 'text-green-300' : 'text-red-300'}`}>
                    {statusMessage}
                  </p>
                  <p className="text-xs text-slate-400 mt-0.5 truncate">
                    {fileName} • {formatBytes(fileSize)} • {selectedLangObj.flag} {selectedLangObj.label}
                  </p>
                  {errorMsg && (
                    <p className="text-xs text-red-400/80 mt-1">{errorMsg}</p>
                  )}
                </div>
              </div>

              {/* Transcript result */}
              {state === 'done' && resultText && (
                <div className="bg-[#13284F] ring-1 ring-blue-800/30 rounded-2xl p-5 animate-fadeInUp">
                  <div className="flex items-center justify-between mb-3">
                    <p className="text-xs font-semibold text-blue-300/70 uppercase tracking-widest">Hasil Transkrip</p>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={handleCopy}
                        className="flex items-center gap-1 text-xs text-slate-400 hover:text-white bg-slate-700/40 hover:bg-slate-700/60 rounded-lg px-2.5 py-1.5 transition-all"
                      >
                        {copied ? <Check size={13} className="text-green-400" /> : <Copy size={13} />}
                        {copied ? 'Tersalin' : 'Salin'}
                      </button>
                      <button
                        onClick={handleDownload}
                        className="flex items-center gap-1 text-xs text-slate-400 hover:text-white bg-slate-700/40 hover:bg-slate-700/60 rounded-lg px-2.5 py-1.5 transition-all"
                      >
                        <Download size={13} />
                        <span>Unduh</span>
                      </button>
                    </div>
                  </div>
                  <div className="max-h-[50vh] overflow-y-auto">
                    <p className="text-sm text-slate-100 leading-relaxed whitespace-pre-wrap break-words">
                      {resultText}
                    </p>
                  </div>
                </div>
              )}

              {/* Action buttons */}
              <div className="flex gap-3">
                <button
                  onClick={handleReset}
                  className="flex-1 py-3 rounded-xl bg-slate-800/60 hover:bg-slate-700/60 ring-1 ring-slate-600/40 text-sm font-semibold text-slate-200 transition-all duration-200 hover:scale-[1.02] active:scale-95"
                >
                  Transkrip Lagi
                </button>
                <button
                  onClick={onBack}
                  className="flex-1 py-3 rounded-xl bg-blue-600 hover:bg-blue-500 text-sm font-bold text-white transition-all duration-200 hover:scale-[1.02] active:scale-95"
                >
                  Kembali ke Chat
                </button>
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
