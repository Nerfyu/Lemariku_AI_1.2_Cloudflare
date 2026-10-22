// Nerfyu
import { useState, useRef, useEffect, useCallback } from 'react';
import { Send, Loader2, Sparkles, Heart, ImagePlus, X, Volume2, VolumeX, FileAudio } from 'lucide-react';
import WardrobeLogo from './components/WardrobeLogo';
import SubscribeModal from './components/SubscribeModal';
import Minigame from './components/Minigame';
import Sidebar from './components/Sidebar';
import VoiceCall from './components/VoiceCall';
import Transcript from './components/Transcript';
import Thesis from './components/Thesis';
import AccessCodeModal from './components/AccessCodeModal';
import { supabase } from '@/lib/supabase';
import { prepareImage } from '@/lib/image';
import {useBacksound} from '@/lib/useBacksound';

interface DisplayMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  mood?: 'ramah' | 'cuek' | 'marah';
  image?: string;
}

type LemarikuMood = 'ramah' | 'cuek' | 'marah';

const FREE_MESSAGE_LIMIT = 5;
const WELLBEING_CHECK_THRESHOLD = 15;

function parseFeatures(content: string) {
  const hasTranscript = /\[FITUR:transkrip\]/i.test(content);
  const text = content.replace(/\[FITUR:transkrip\]/gi, '').trim();
  return { text, hasTranscript };
}

function renderContent(text: string) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return (
        <strong key={i} className="font-bold text-white">
          {part.slice(2, -2)}
        </strong>
      );
    }
    return <span key={i}>{part}</span>;
  });
}

function getSessionId() {
  const KEY = 'lemariku_session_id';
  let id = localStorage.getItem(KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(KEY, id);
  }
  return id;
}

function WellbeingModal({ onClose, onDismiss }: { onClose: () => void; onDismiss: () => void }) {
  const [phase, setPhase] = useState<'ask' | 'waduh'>('ask');

  const handleClick = () => {
    setPhase('waduh');
    setTimeout(() => {
      onDismiss();
      onClose();
    }, 1800);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-fadeInUp p-4">
      <div className="w-full max-w-sm rounded-3xl bg-[#13284F] ring-1 ring-blue-700/40 shadow-2xl shadow-blue-900/40 p-6 text-center">
        {phase === 'ask' ? (
          <>
            <div className="mx-auto mb-4 w-14 h-14 rounded-2xl bg-red-500/15 ring-1 ring-red-500/30 flex items-center justify-center">
              <Heart size={26} className="text-red-400" />
            </div>
            <h2 className="text-lg font-bold text-white mb-1">
              Apakah kamu sedang tidak baik-baik saja?
            </h2>
            <p className="text-sm text-slate-400 mb-6">
              Kamu sudah ngobrol cukup lama. Lemari mau tanya dulu.
            </p>
            <div className="flex flex-col gap-2.5">
              <button
                onClick={handleClick}
                className="w-full rounded-xl bg-red-600 hover:bg-red-500 text-white text-sm font-semibold py-3 transition-all duration-200 hover:scale-[1.02] active:scale-95"
              >
                Iya, saya tidak baik-baik saja
              </button>
              <button
                onClick={handleClick}
                className="w-full rounded-xl bg-slate-700/60 hover:bg-slate-600/60 ring-1 ring-slate-600/40 text-slate-200 text-sm font-semibold py-3 transition-all duration-200 hover:scale-[1.02] active:scale-95"
              >
                Tidak, saya tidak baik-baik saja
              </button>
            </div>
          </>
        ) : (
          <div className="py-8 animate-fadeInUp">
            <p className="text-2xl font-bold text-white mb-2">Waduh...</p>
            <p className="text-sm text-slate-400">Tetap kuat ya. Lemari selalu di sini kalau mau ngobrol lagi.</p>
          </div>
        )}
      </div>
    </div>
  );
}

export default function App() {
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [sessionId] = useState(getSessionId);
  const [userMessageCount, setUserMessageCount] = useState(0);
  const [isPremium, setIsPremium] = useState(false);
  const [showSubscribeModal, setShowSubscribeModal] = useState(false);
  const [showMinigame, setShowMinigame] = useState(false);
  const [showVoiceCall, setShowVoiceCall] = useState(false);
  const [showTranscript, setShowTranscript] = useState(false);
  const [showThesis, setShowThesis] = useState(false);
  const [showAccessCode, setShowAccessCode] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [lemarikuMood, setLemarikuMood] = useState<LemarikuMood>('ramah');
  const [showWellbeingModal, setShowWellbeingModal] = useState(false);
  const [wellbeingDismissed, setWellbeingDismissed] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [pendingImage, setPendingImage] = useState<string | null>(null);
  const [imageError, setImageError] = useState<string | null>(null);

  useEffect(() => {
    async function loadHistory() {
      const { data } = await supabase
        .from('chat_messages')
        .select('id, role, content, created_at')
        .eq('session_id', sessionId)
        .order('created_at', { ascending: true });

      if (data && data.length > 0) {
        setMessages(data as unknown as DisplayMessage[]);
        const sentCount = data.filter((m) => m.role === 'user').length;
        setUserMessageCount(sentCount);
      } else {
        setMessages([
          {
            id: 'welcome',
            role: 'assistant',
            content:
              "Hai kamu! 👋 Aku **Lemariku AI**, makhluk yang berpikir (iya, lemari beneran, bukan AI biasa 😎). Aku siap dengerin cerita kamu, bantu masalah, atau cuma ngobrol ngalor-ngidul. Jadi, ada apa nih hari ini? Bisa kubantu apa? 🚪✨",
          },
        ]);
      }
    }
    loadHistory();
  }, [sessionId]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
    }
  }, [messages, loading]);

  const handlePickImage = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setImageError(null);
    try {
      setPendingImage(await prepareImage(file));
    } catch (err) {
      setPendingImage(null);
      setImageError(err instanceof Error ? err.message : 'Gambar tidak bisa dibaca.');
    }
  };
  
  const sendMessage = useCallback(async () => {
    const text = input.trim();
    const image = pendingImage;
    if ((!text && !image) || loading) return;

    const nextCount = userMessageCount + 1;

    if (!isPremium && nextCount > FREE_MESSAGE_LIMIT) {
      setShowSubscribeModal(true);
      return;
    }

    const userMsg: DisplayMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: text,
      image: image ?? undefined,
    };
    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    setPendingImage(null);
    setImageError(null);
    setLoading(true);
    setUserMessageCount(nextCount);

    await supabase.from('chat_messages').insert({
      session_id: sessionId,
      role: 'user',
      content: image ? `${text}\n\n[gambar terkirim]`.trim() : text,
    });

    try {
      const apiUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/chat`;
      const res = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
        },
        body: JSON.stringify({
          messages: [...messages.filter((m) => m.id !== 'welcome'), userMsg].map((m) => ({
            role: m.role,
            content: m.id !== userMsg.id && m.image ? `${m.content}\n\n[gambar terkirim]`.trim() : m.content,
          })),
          image: image ?? undefined,
        }),
      });

      if (!res.ok) {
  let detail = '';
  try {
    const errBody = await res.json();
    detail = errBody?.error ?? JSON.stringify(errBody);
  } catch (err) {
  console.error('[chat] gagal:', err);
    /* body bukan JSON */
  }
  throw new Error(`Server merespons ${res.status}${detail ? `: ${detail}` : ''}`);
      }

      const data = await res.json();
      const reply: string = data.reply?.trim() || 'Hmm, lemari lagi nge-blank nih 😅';
      const mood: LemarikuMood = data.mood ?? 'ramah';

      setLemarikuMood(mood);

      const aiMsg: DisplayMessage = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: reply,
        mood,
      };
      setMessages((prev) => [...prev, aiMsg]);

      await supabase.from('chat_messages').insert({
        session_id: sessionId,
        role: 'assistant',
        content: reply,
      });

      if (nextCount >= WELLBEING_CHECK_THRESHOLD && !wellbeingDismissed) {
        setShowWellbeingModal(true);
      }
    } catch {
      const errMsg: DisplayMessage = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content:
          'Waduh, koneksi ke otak lemariku putus nih 😵‍💫 Coba kirim lagi ya, mungkin laci-nya sulit dibuka tadi. (Jika menerima pesan ini berkali-kali, tolong hentikan penggunaan, coba lagi nanti, server mau meletup awokawok)' +
  (image && err instanceof Error ? `\n\n[Detail teknis: ${err.message}]` : ''),
      };
      setMessages((prev) => [...prev, errMsg]);
    } finally {
      if (!isPremium && nextCount >= FREE_MESSAGE_LIMIT) {
        setShowSubscribeModal(true);
      }
      setLoading(false);
      inputRef.current?.focus();
    }
  }, [input, pendingImage, loading, messages, sessionId, userMessageCount, isPremium, wellbeingDismissed]);

  const handleSubscribeClose = useCallback(() => {
    setShowSubscribeModal(false);
    setIsPremium(true);
    inputRef.current?.focus();
  }, []);

  const clearChat = useCallback(async () => {
    await supabase.from('chat_messages').delete().eq('session_id', sessionId);
    setUserMessageCount(0);
    setLemarikuMood('ramah');
    setWellbeingDismissed(false);
    setMessages([
      {
        id: 'welcome',
        role: 'assistant',
        content: 'Lemari udah dibersihin! 🧹 Ada yang mau disimpan lagi nggak? 👀',
      },
    ]);
    setSidebarOpen(false);
  }, [sessionId]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const { muted: backsoundMuted, toggle: toggleBacksound, failed: backsoundFailed } = useBacksound(
    showVoiceCall || showTranscript || showMinigame
  );

  if (showMinigame) {
    return <Minigame onBack={() => setShowMinigame(false)} />;
  }

  if (showVoiceCall) {
    return <VoiceCall onEnd={() => setShowVoiceCall(false)} />;
  }

  if (showTranscript) {
    return <Transcript onBack={() => setShowTranscript(false)} />;
  }

  if (showThesis) {
    return <Thesis onBack={() => setShowThesis(false)} />;
  }

  const isAngry = lemarikuMood === 'marah';

  return (
    <div className="h-[100dvh] overflow-hidden bg-[#0B1426] text-slate-100 flex flex-col">
      {/* Ambient background glow */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute -top-40 -left-40 w-96 h-96 bg-blue-600/10 rounded-full blur-3xl" />
        <div className="absolute -bottom-40 -right-40 w-96 h-96 bg-cyan-500/8 rounded-full blur-3xl" />
        {isAngry && <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[600px] h-[600px] bg-red-700/10 rounded-full blur-3xl" />}
        <div className="absolute top-1/3 right-1/4 w-64 h-64 bg-blue-500/5 rounded-full blur-2xl" />
      </div>

      {/* Sidebar */}
      <Sidebar
        open={sidebarOpen}
        onToggle={() => setSidebarOpen(!sidebarOpen)}
        onCall={() => { setShowAccessCode(true); setSidebarOpen(false); }}
        onTranscript={() => { setShowTranscript(true); setSidebarOpen(false); }}
        onMinigame={() => { setShowMinigame(true); setSidebarOpen(false); }}
        onThesis={() => { setShowThesis(true); setSidebarOpen(false); }}
        onClearChat={clearChat}
        isPremium={isPremium}
      />

      {/* Main content shifts when sidebar is open on desktop */}
      <div className={`flex-1 min-h-0 flex flex-col transition-all duration-300 ${sidebarOpen ? 'lg:ml-72' : ''}`}>
        {/* Header */}
        <header className="relative z-20 flex-shrink-0 border-b border-blue-900/40 bg-[#0B1426]/80 backdrop-blur-md">
          <div className="max-w-3xl mx-auto px-4 py-3 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="rounded-xl ring-1 ring-blue-700/30 shadow-lg shadow-blue-900/30 transition-transform hover:scale-105 duration-300">
                <button
                  type="button"
                onClick={() => setSidebarOpen((open) => !open)}
                  className="transition-transform hover:scale-105 active:scale-95 duration-300"
                  title={sidebarOpen ? 'Tutup menu' : 'Buka menu'}
                  aria-label={sidebarOpen ? 'Tutup menu' : 'Buka menu'}
                  >
                <WardrobeLogo size={44} />
                </button>
              </div>
              <div>
                <h1 className={`text-lg font-bold tracking-tight leading-tight transition-colors duration-500 ${isAngry ? 'text-red-500' : 'text-white'}`}>
                  Lemariku AI
                </h1>
                <p className="text-xs text-blue-300/70 leading-tight">
                  Lemariku adalah makhluk yang berpikir
                </p>
              </div>
            </div>
            {/* Menu button for mobile (when sidebar is closed) */}
            <button
             type="button"
            onClick={toggleBacksound}
            className="flex items-center justify-center rounded-xl bg-slate-800/60 ring-1 ring-slate-600/40 w-9 h-9 transition-all duration-200 hover:scale-110 hover:bg-slate-700/60 active:scale-95"
              title={backsoundFailed ? 'Backsound tidak ditemukan (public/audio/backsound.mp3)' : backsoundMuted ? 'Nyalakan suara latar' : 'Matikan suara latar'}
              aria-label={backsoundMuted ? 'nyalakan suara latar' : 'Matikan suara latar'}
              >
              {backsoundMuted ? (
                <VolumeX size={18} className="text-slate-400" />
              ) : (
                <Volume2 size={18} className={backsoundFailed ? 'text-amber-400' : 'text-blue-300'} />
              )}
            </button>
          </div>
        </header>

        {/* Chat area */}
        <main className="relative z-10 flex-1 overflow-y-auto min-h-0 overscroll-contain" ref={scrollRef}>
          <div className="max-w-3xl mx-auto px-4 py-6 space-y-5">
            {messages.map((msg) => {
              const { text, hasTranscript } =
                msg.role === 'assistant'
                  ? parseFeatures(msg.content)
                  : { text: msg.content, hasTranscript: false };
              return (
                <div
                  key={msg.id}
                  className={`flex gap-3 animate-fadeInUp ${
                    msg.role === 'user' ? 'flex-row-reverse' : 'flex-row'
                  }`}
                >
                  {/* Avatar — only for Lemariku */}
                  {msg.role === 'assistant' && (
                    <div className="flex-shrink-0 mt-0.5">
                      <div>
                        <WardrobeLogo size={36} />
                      </div>
                    </div>
                  )}

                  {/* Bubble + feature buttons */}
                  <div className="max-w-[80%] flex flex-col items-start gap-2">
                    <div
                      className={`rounded-2xl px-4 py-3 text-sm leading-relaxed transition-all duration-300 ${
                        msg.role === 'user'
                          ? 'bg-blue-600 text-white rounded-tr-sm'
                          : 'bg-[#13284F] text-slate-100 rounded-tl-sm ring-1 ring-blue-800/30'
                      }`}
                    >
                      {msg.image && (
                        <img
                          src={msg.image}
                          alt="Gambar yang dikirim"
                          className="mb-2 max-h-64 w-full rounded-xl object-cover"
                        />
                      )}
                      {msg.content && (
                        <p className="whitespace-pre-wrap break-words">{renderContent(msg.content)}</p>
                      )}
                    </div>
                    {hasTranscript && (
                      <button
                        type="button"
                        onClick={() => setShowTranscript(true)}
                        className="inline-flex items-center gap-2 rounded-xl bg-blue-600/20 hover:bg-blue-600/35 ring-1 ring-blue-500/40 text-blue-200 text-xs font-semibold px-3 py-2 transition-colors"
                      >
                        <FileAudio size={14} />
                        Buka Transkrip
                      </button>
                    )}
                  </div>
                </div>
              );
            })}

            {/* Loading indicator */}
            {loading && (
              <div className="flex gap-3 animate-fadeInUp">
                <div className="flex-shrink-0 mt-0.5">
                  <div className="rounded-lg ring-1 ring-blue-700/30">
                    <WardrobeLogo size={36} />
                  </div>
                </div>
                <div className="bg-[#13284F] ring-1 ring-blue-800/30 rounded-2xl rounded-tl-sm px-4 py-3.5">
                  <div className="flex items-center gap-2">
                    <Loader2 size={16} className="animate-spin text-blue-300" />
                    <span className="text-sm text-blue-300/80">Lemari lagi mikir nih...</span>
                    <Sparkles size={14} className="text-blue-400/50 animate-pulse" />
                  </div>
                </div>
              </div>
            )}
          </div>
        </main>

        {/* Input area */}
        <footer className="relative z-20 flex-shrink-0 border-t border-blue-900/40 bg-[#0B1426]/80 backdrop-blur-md">
          <div className="max-w-3xl mx-auto px-4 py-3">
             {pendingImage && (
              <div className="mb-2">
                <div className="relative inline-block">
                  <img
                    src={pendingImage}
                    alt="Pratinjau gambar"
                    className="h-16 w-16 rounded-xl object-cover ring-1 ring-blue-700/40"
                  />
                  <button
                    type="button"
                    onClick={() => setPendingImage(null)}
                    className="absolute -top-2 -right-2 w-5 h-5 rounded-full bg-slate-700 hover:bg-slate-600 text-white flex items-center justify-center"
                    title="Hapus gambar"
                  >
                    <X size={12} />
                  </button>
                </div>
              </div>
            )}
            {imageError && <p className="mb-2 text-xs text-red-300">{imageError}</p>}
            <div className="flex items-end gap-2.5 bg-[#13284F] rounded-2xl ring-1 ring-blue-800/40 focus-within:ring-blue-500/50 transition-all duration-300 px-4 py-2.5">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="hidden"
                onChange={handlePickImage}
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={loading || (!isPremium && userMessageCount >= FREE_MESSAGE_LIMIT)}
                className="flex-shrink-0 w-9 h-9 rounded-xl text-blue-300 hover:text-white hover:bg-blue-600/30 disabled:text-slate-600 disabled:hover:bg-transparent flex items-center justify-center transition-colors"
                title="Kirim gambar"
              >
                <ImagePlus size={18} />
              </button>
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                rows={1}
                placeholder={
                  !isPremium && userMessageCount >= FREE_MESSAGE_LIMIT
                    ? 'Upgrade ke Lemari Premium dulu yuk... 👑'
                    : 'Ketik sesuatu untuk Lemariku...'
                }
                className="flex-1 bg-transparent text-sm text-slate-100 placeholder:text-slate-500 resize-none outline-none max-h-32 leading-relaxed py-1"
                style={{ minHeight: '24px' }}
                disabled={loading || (!isPremium && userMessageCount >= FREE_MESSAGE_LIMIT)}
              />
              <button
                onClick={sendMessage}
                disabled={(!input.trim() && !pendingImage) || loading || (!isPremium && userMessageCount >= FREE_MESSAGE_LIMIT)}
                className="flex-shrink-0 w-9 h-9 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:bg-slate-700 disabled:text-slate-500 text-white flex items-center justify-center transition-all duration-300 hover:scale-105 active:scale-95 disabled:scale-100"
                title="Kirim"
              >
                <Send size={16} />
              </button>
            </div>
            <div className="flex items-center justify-between mt-2 px-1">
              <p className="text-[11px] text-slate-500">
                Lemariku AI 1.2 • Lemariku bisa keliru
              </p>
              {!isPremium && (
                <p className="text-[11px] text-slate-500">
                  {Math.max(0, FREE_MESSAGE_LIMIT - userMessageCount)} pesan tersisa
                </p>
              )}
              {isPremium && (
                <p className="text-[11px] text-yellow-500/70 flex items-center gap-1">
                  Premium
                </p>
              )}
            </div>
          </div>
        </footer>
      </div>

      {/* Subscribe modal */}
      {showSubscribeModal && <SubscribeModal onClose={handleSubscribeClose} />}

      {/* Wellbeing check modal */}
      {showWellbeingModal && (
        <WellbeingModal onClose={() => setShowWellbeingModal(false)} onDismiss={() => setWellbeingDismissed(true)} />
      )}

      {/* Access code modal for Voice Call */}
      {showAccessCode && (
        <AccessCodeModal
          onClose={() => setShowAccessCode(false)}
          onSuccess={() => { setShowAccessCode(false); setShowVoiceCall(true); }}
        />
      )}
    </div>
  );
}
