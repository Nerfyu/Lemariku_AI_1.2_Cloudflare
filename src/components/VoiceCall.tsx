// Ganti seluruh isi: src/components/VoiceCall.tsx
import { useState, useRef, useEffect } from 'react';
import { Phone, PhoneOff, Mic, MicOff, ChevronDown, ChevronUp, Loader2 } from 'lucide-react';
import WardrobeLogo from './WardrobeLogo';
import {
  playRingtone,
  playEndTone,
  speakQueued,
  stopSpeaking,
  unlockSpeech,
  prewarmVoices,
  formatDuration,
} from '@/lib/voice';
import type { SpeechMood } from '@/lib/voice';

// ---------------------------------------------------------------------------
// Pengaturan (ubah angka di sini kalau perlu menyetel rasa percakapan)
// ---------------------------------------------------------------------------
const API_BASE = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1`;
const AUTH_HEADER = { Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}` };

const FRAME_MS = 40; // seberapa sering volume suara dicek
const END_SILENCE_MS = 650; // hening segini lama = kamu dianggap selesai bicara (turunkan = lebih cepat, tapi mudah memotong)
const MIN_VOICED_MS = 250; // suara lebih pendek dari ini dianggap noise
const FILLER_MIN_VOICED_MS = 700; // suara pengisi ("hmm...") hanya jika kamu bicara cukup lama
const MAX_UTTERANCE_MS = 25000; // satu giliran bicara maksimal
const MIN_THRESHOLD = 0.012; // volume minimum yang dianggap suara (naikkan jika noise ikut terdeteksi, turunkan jika suara pelan tak terdeteksi)
const NOISE_MULT = 3; // suara harus sekian kali lebih keras dari noise latar
const POST_SPEECH_COOLDOWN_MS = 350; // jeda setelah Lemari selesai bicara, agar ekor suaranya tidak tertangkap mikrofon
const HISTORY_LIMIT = 12;
const FILLERS = ['Hmm...', 'Eh, bentar ya...', 'Ih, apa ya...', 'Emm... gimana ya...', 'Wah, bentar bentar...', 'Ehehe, bentar ya...'];

// ---------------------------------------------------------------------------
// Fungsi bantu (tidak bergantung pada React)
// ---------------------------------------------------------------------------
class UserFacingError extends Error {}

function cleanForSpeech(s: string): string {
  return s
    .replace(/\[[A-Z]+:[^\]]*\]/g, '') // penanda seperti [MOOD:...] atau [FITUR:...]
    .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{200D}]/gu, '') // emoji
    .replace(/[*_`#>~|]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/\s+([!?.,;:])/g, '$1') // spasi sisa sebelum tanda baca setelah emoji dibuang
    .trim();
}

// Memotong teks yang sedang mengalir menjadi potongan yang siap dibacakan (per kalimat).
// Kalimat panjang tanpa titik dipotong di koma supaya suara bisa mulai lebih awal.
const SENTENCE_END = /[.!?…]+["')\]]*(?=\s|$)/;

function extractChunks(buffer: string, final: boolean): { chunks: string[]; rest: string } {
  const chunks: string[] = [];
  let rest = buffer;

  for (;;) {
    const m = SENTENCE_END.exec(rest);
    if (m) {
      const end = m.index + m[0].length;
      chunks.push(rest.slice(0, end).trim());
      rest = rest.slice(end);
      continue;
    }
    if (rest.length >= 70) {
      const idx = Math.max(rest.lastIndexOf(', '), rest.lastIndexOf('; '));
      if (idx > 25) {
        chunks.push(rest.slice(0, idx + 1).trim());
        rest = rest.slice(idx + 1);
        continue;
      }
    }
    break;
  }

  if (final && rest.trim()) {
    chunks.push(rest.trim());
    rest = '';
  }
  return { chunks: chunks.filter(Boolean), rest };
}

// Membaca penanda mood di awal jawaban, misalnya "[MOOD:cuek] ya terserah".
function parseMoodPrefix(
  buf: string,
  final: boolean,
): { buf: string; mood: SpeechMood | null; done: boolean } {
  const t = buf.trimStart();
  if (!t) return { buf: '', mood: null, done: final };
  if (t[0] !== '[') return { buf: t, mood: null, done: true };

  const close = t.indexOf(']');
  if (close === -1) {
    return { buf: t, mood: null, done: final || t.length >= 20 };
  }
  const m = t.slice(0, close + 1).match(/^\[MOOD:(ramah|cuek|marah)\]/i);
  if (m) {
    return { buf: t.slice(close + 1).trimStart(), mood: m[1].toLowerCase() as SpeechMood, done: true };
  }
  return { buf: t, mood: null, done: true };
}

function pickMime(): string {
  if (typeof MediaRecorder === 'undefined') return '';
  const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'];
  for (const c of candidates) {
    if (MediaRecorder.isTypeSupported(c)) return c;
  }
  return '';
}

function fileNameForMime(mime: string): string {
  if (mime.includes('mp4')) return 'voice.mp4';
  if (mime.includes('ogg')) return 'voice.ogg';
  return 'voice.webm';
}

// ---------------------------------------------------------------------------
// Komponen
// ---------------------------------------------------------------------------
interface TranscriptEntry {
  id: string;
  role: 'user' | 'assistant';
  text: string;
}

interface Props {
  onEnd: () => void;
}

type CallPhase = 'connecting' | 'active' | 'ending';
type Turn = 'listening' | 'userSpeaking' | 'thinking' | 'speaking';

export default function VoiceCall({ onEnd }: Props) {
  const [phase, setPhase] = useState<CallPhase>('connecting');
  const [turn, setTurn] = useState<Turn>('listening');
  const [muted, setMuted] = useState(false);
  const [duration, setDuration] = useState(0);
  const [transcriptOpen, setTranscriptOpen] = useState(true);
  const [transcriptExpanded, setTranscriptExpanded] = useState(false);
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);

  // Ref dipakai untuk logika (timer/callback tidak boleh membaca state lama)
  const phaseRef = useRef<CallPhase>('connecting');
  const turnRef = useRef<Turn>('listening');
  const mutedRef = useRef(false);
  const endingRef = useRef(false);
  const turnInFlightRef = useRef(false); // sedang memproses ucapan (STT + jawaban)
  const pendingSpeechRef = useRef(0); // jumlah potongan ucapan yang belum selesai dibacakan
  const cooldownUntilRef = useRef(0);
  const fillerPlayedRef = useRef(false);

  const streamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const vadTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const mimeRef = useRef('');
  const abortRef = useRef<AbortController | null>(null);
  const conversationRef = useRef<{ role: 'user' | 'assistant'; content: string }[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const ringtoneStopRef = useRef<(() => void) | null>(null);
  const transcriptEndRef = useRef<HTMLDivElement>(null);

  function changeTurn(next: Turn) {
    turnRef.current = next;
    setTurn(next);
  }

  function addTranscript(role: 'user' | 'assistant', text: string) {
    setTranscript((prev) => [...prev, { id: crypto.randomUUID(), role, text }]);
  }

  // Start the call
  useEffect(() => {
    endingRef.current = false;
    prewarmVoices();
    unlockSpeech();
    warmUpServer();

    const stopRing = playRingtone(2500);
    ringtoneStopRef.current = stopRing;

    // Sentuhan pertama di layar membuka kunci audio/suara di HP (terutama iPhone)
    const resumeOnTouch = () => {
      audioCtxRef.current?.resume().catch(() => {});
      unlockSpeech();
    };
    window.addEventListener('pointerdown', resumeOnTouch);

    const initTimeout = setTimeout(() => {
      ringtoneStopRef.current?.();
      phaseRef.current = 'active';
      setPhase('active');
      startTimer();
      void startMic();
    }, 2500);

    return () => {
      endingRef.current = true;
      clearTimeout(initTimeout);
      window.removeEventListener('pointerdown', resumeOnTouch);
      ringtoneStopRef.current?.();
      stopTimer();
      abortRef.current?.abort();
      stopSpeaking();
      teardownMic();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (transcriptEndRef.current) {
      transcriptEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [transcript]);

  function startTimer() {
    timerRef.current = setInterval(() => {
      setDuration((d) => d + 1);
    }, 1000);
  }

  function stopTimer() {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }

  // "Membangunkan" fungsi server selagi telepon berdering, supaya giliran pertama tidak lambat.
  function warmUpServer() {
    ['voice-stt', 'voice-chat'].forEach((fn) => {
      fetch(`${API_BASE}/${fn}`, { method: 'OPTIONS' }).catch(() => {});
    });
  }

  // -------------------------------------------------------------------------
  // Mikrofon: SATU aliran untuk mendeteksi bicara dan merekam
  // -------------------------------------------------------------------------
  async function startMic() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      if (endingRef.current) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      streamRef.current = stream;
      mimeRef.current = pickMime();

      const AC = window.AudioContext || (window as any).webkitAudioContext;
      const ctx: AudioContext = new AC();
      audioCtxRef.current = ctx;
      await ctx.resume().catch(() => {});

      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      source.connect(analyser); // tidak disambung ke speaker, jadi tidak ada gema

      if (ctx.state !== 'running') {
        addTranscript('assistant', 'Ketuk layar sekali untuk mengaktifkan mikrofon.');
      }

      runVad(analyser);
      changeTurn('listening');
    } catch {
      addTranscript('assistant', 'Tidak bisa akses mikrofon. Izinkan mikrofon untuk mulai bicara.');
    }
  }

  function teardownMic() {
    if (vadTimerRef.current) {
      clearInterval(vadTimerRef.current);
      vadTimerRef.current = null;
    }
    cancelRecording();
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    audioCtxRef.current?.close().catch(() => {});
    audioCtxRef.current = null;
  }

  // Deteksi bicara berbasis volume (VAD sederhana) dengan batas yang menyesuaikan noise latar.
  function runVad(analyser: AnalyserNode) {
    const buf = new Float32Array(analyser.fftSize);
    let noiseFloor = 0.004;
    let recording = false;
    let voicedMs = 0;
    let silenceMs = 0;
    let totalMs = 0;

    vadTimerRef.current = setInterval(() => {
      if (endingRef.current) return;

      analyser.getFloatTimeDomainData(buf);
      let sum = 0;
      for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
      const rms = Math.sqrt(sum / buf.length);

      const canListen =
        phaseRef.current === 'active' &&
        !mutedRef.current &&
        (turnRef.current === 'listening' || turnRef.current === 'userSpeaking') &&
        Date.now() >= cooldownUntilRef.current;

      if (!canListen) {
        if (recording) {
          recording = false;
          cancelRecording();
        }
        return;
      }

      const threshold = Math.max(MIN_THRESHOLD, noiseFloor * NOISE_MULT);
      const loud = rms > threshold;

      if (!recording) {
        if (!loud) {
          noiseFloor = noiseFloor * 0.95 + rms * 0.05;
          return;
        }
        recording = true;
        voicedMs = 0;
        silenceMs = 0;
        totalMs = 0;
        beginRecording();
        changeTurn('userSpeaking');
      }

      totalMs += FRAME_MS;
      if (loud) {
        voicedMs += FRAME_MS;
        silenceMs = 0;
      } else {
        silenceMs += FRAME_MS;
      }

      if (silenceMs >= END_SILENCE_MS || totalMs >= MAX_UTTERANCE_MS) {
        recording = false;
        finishRecording(voicedMs);
      }
    }, FRAME_MS);
  }

  function beginRecording() {
    const stream = streamRef.current;
    if (!stream) return;
    chunksRef.current = [];
    try {
      const rec = new MediaRecorder(stream, mimeRef.current ? { mimeType: mimeRef.current } : undefined);
      rec.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorderRef.current = rec;
      rec.start();
    } catch {
      recorderRef.current = null;
    }
  }

  function cancelRecording() {
    const rec = recorderRef.current;
    recorderRef.current = null;
    if (rec) {
      rec.onstop = null;
      try { rec.stop(); } catch { /* sudah berhenti */ }
    }
    chunksRef.current = [];
    if (turnRef.current === 'userSpeaking') changeTurn('listening');
  }

  function finishRecording(voicedMs: number) {
    const rec = recorderRef.current;
    recorderRef.current = null;

    if (!rec) {
      changeTurn('listening');
      return;
    }

    // Terlalu pendek: kemungkinan hanya noise atau batuk
    if (voicedMs < MIN_VOICED_MS) {
      rec.onstop = null;
      try { rec.stop(); } catch { /* noop */ }
      chunksRef.current = [];
      changeTurn('listening');
      return;
    }

    turnInFlightRef.current = true;
    fillerPlayedRef.current = false;
    changeTurn('thinking');

    // Suara pengisi langsung diputar supaya tidak ada jeda hening saat AI berpikir
    if (voicedMs >= FILLER_MIN_VOICED_MS) playFiller();

    const mime = rec.mimeType || mimeRef.current || 'audio/webm';
    rec.onstop = () => {
      const blob = new Blob(chunksRef.current, { type: mime });
      chunksRef.current = [];
      void handleUtterance(blob, mime);
    };
    try {
      rec.stop();
    } catch {
      turnInFlightRef.current = false;
      maybeResumeListening();
    }
  }

  // -------------------------------------------------------------------------
  // Giliran bicara: suara -> teks -> jawaban (streaming) -> dibacakan
  // -------------------------------------------------------------------------
  function queueSpeech(text: string, mood?: SpeechMood, rate?: number, pitch?: number) {
    pendingSpeechRef.current += 1;
    speakQueued(text, { mood, rate, pitch, onEnd: onSpeechUnitDone });
  }

  function playFiller() {
    fillerPlayedRef.current = true;
    const phrase = FILLERS[Math.floor(Math.random() * FILLERS.length)];
    queueSpeech(phrase);
  }

  function onSpeechUnitDone() {
    pendingSpeechRef.current = Math.max(0, pendingSpeechRef.current - 1);
    maybeResumeListening();
  }

  function maybeResumeListening() {
    if (endingRef.current || phaseRef.current !== 'active') return;
    if (turnInFlightRef.current) return; // masih menunggu sisa jawaban
    if (pendingSpeechRef.current > 0) return; // masih ada yang dibacakan
    cooldownUntilRef.current = Date.now() + POST_SPEECH_COOLDOWN_MS;
    changeTurn('listening');
  }

  async function handleUtterance(blob: Blob, mime: string) {
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      // 1) Suara -> teks
      const form = new FormData();
      form.append('file', blob, fileNameForMime(mime));
      form.append('language', 'id');

      const sttRes = await fetch(`${API_BASE}/voice-stt`, {
        method: 'POST',
        headers: AUTH_HEADER,
        body: form,
        signal: controller.signal,
      });
      if (!sttRes.ok) {
        const err = await sttRes.json().catch(() => null);
        throw new UserFacingError(err?.error ?? 'Waduh, telinga lemari lagi error. Coba bicara lagi ya.');
      }
      const { text } = await sttRes.json();
      const userText = String(text ?? '').trim();

      if (!userText) {
        // Tidak terbaca. Kalau sudah terlanjur bilang "hmm...", jangan diam saja.
        if (fillerPlayedRef.current) queueSpeech('Hah? Tadi apa ya?');
        return;
      }

      addTranscript('user', userText);
      conversationRef.current.push({ role: 'user', content: userText });

      // 2) Jawaban mengalir, dibacakan kalimat demi kalimat
      await streamAnswer(controller);
    } catch (err) {
      if (controller.signal.aborted || endingRef.current) return;
      addTranscript(
        'assistant',
        err instanceof UserFacingError ? err.message : 'Waduh, otak lemari putus. Coba bicara lagi ya.',
      );
    } finally {
      turnInFlightRef.current = false;
      maybeResumeListening();
    }
  }

  async function streamAnswer(controller: AbortController) {
    const res = await fetch(`${API_BASE}/voice-chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...AUTH_HEADER },
      body: JSON.stringify({ messages: conversationRef.current.slice(-HISTORY_LIMIT) }),
      signal: controller.signal,
    });
    if (!res.ok || !res.body) throw new Error(`Server ${res.status}`);

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let fullReply = '';
    let moodParsed = false;
    let mood: SpeechMood = 'ramah';
    let entryId: string | null = null;

    const showAssistantText = (text: string) => {
      if (!entryId) {
        const id = crypto.randomUUID();
        entryId = id;
        setTranscript((prev) => [...prev, { id, role: 'assistant', text }]);
      } else {
        const id = entryId;
        setTranscript((prev) => prev.map((e) => (e.id === id ? { ...e, text } : e)));
      }
    };

    const queueChunks = (chunks: string[]) => {
      for (const raw of chunks) {
        const clean = cleanForSpeech(raw);
        if (!clean) continue;
        fullReply = fullReply ? `${fullReply} ${clean}` : clean;
        showAssistantText(fullReply);
        changeTurn('speaking');
        queueSpeech(clean, mood);
      }
    };

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      if (!moodParsed) {
        const r = parseMoodPrefix(buffer, false);
        buffer = r.buf;
        if (r.mood) mood = r.mood;
        moodParsed = r.done;
        if (!moodParsed) continue;
      }

      const { chunks, rest } = extractChunks(buffer, false);
      buffer = rest;
      queueChunks(chunks);
    }

    buffer += decoder.decode();
    if (!moodParsed) {
      const r = parseMoodPrefix(buffer, true);
      buffer = r.buf;
      if (r.mood) mood = r.mood;
      moodParsed = true;
    }
    queueChunks(extractChunks(buffer, true).chunks);

    if (!fullReply) {
      fullReply = 'Hmm, lemari bingung nih.';
      showAssistantText(fullReply);
      changeTurn('speaking');
      queueSpeech(fullReply, mood);
    }
    conversationRef.current.push({ role: 'assistant', content: fullReply });
  }

  // -------------------------------------------------------------------------
  // Tombol
  // -------------------------------------------------------------------------
  function handleMuteToggle() {
    const next = !mutedRef.current;
    mutedRef.current = next;
    setMuted(next);
    streamRef.current?.getAudioTracks().forEach((track) => {
      track.enabled = !next;
    });
    // Jika sedang merekam, VAD otomatis membatalkannya pada pengecekan berikutnya.
  }

  function handleEndCall() {
    if (phaseRef.current === 'ending') return;
    phaseRef.current = 'ending';
    endingRef.current = true;
    setPhase('ending');
    ringtoneStopRef.current?.();
    abortRef.current?.abort();
    stopSpeaking();
    stopTimer();
    teardownMic();
    playEndTone();
    setTimeout(() => {
      onEnd();
    }, 1500);
  }

  const pulseRing = phase === 'connecting';
  const aiThinking = turn === 'thinking';

  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center bg-gradient-to-b from-[#0A2E5C] via-[#0B1F3A] to-[#061528] overflow-hidden">
      {/* Ambient glow */}
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-80 h-80 bg-blue-500/20 rounded-full blur-3xl animate-pulse" />
        <div className="absolute bottom-1/4 left-1/2 -translate-x-1/2 w-64 h-64 bg-cyan-400/10 rounded-full blur-3xl" />
      </div>

      {/* Top: Avatar + status */}
      <div className="relative z-10 flex-1 flex flex-col items-center justify-center gap-5 pt-12">
        {/* Pulsing avatar */}
        <div className="relative flex items-center justify-center">
          {pulseRing && (
            <>
              <div className="absolute w-32 h-32 rounded-full bg-blue-400/20 animate-ping" />
              <div className="absolute w-28 h-28 rounded-full bg-blue-400/15 animate-ping" style={{ animationDelay: '0.3s' }} />
            </>
          )}
          <div
            className={`relative w-24 h-24 flex items-center justify-center ${
              phase === 'active' && !muted ? 'animate-pulse' : ''
            }`}
          >
            <div className="rounded-2xl">
              <WardrobeLogo size={56} />
            </div>
          </div>
        </div>

        <div className="text-center">
          <h2 className="text-2xl font-bold text-white tracking-tight">Lemariku AI</h2>
          <p className="text-sm text-blue-300/80 mt-1">
            {phase === 'connecting' && 'Memanggil...'}
            {phase === 'active' &&
              (turn === 'thinking'
                ? 'Lemari mikir...'
                : turn === 'speaking'
                  ? 'Lemari bicara...'
                  : muted
                    ? 'Dibisukan'
                    : turn === 'userSpeaking'
                      ? 'Kamu bicara...'
                      : 'Mendengarkan...')}
            {phase === 'ending' && 'Memutuskan...'}
          </p>
        </div>

        {/* Call duration */}
        {phase === 'active' && (
          <div className="text-lg font-mono text-blue-200/90 tabular-nums">
            {formatDuration(duration)}
          </div>
        )}
      </div>

      {/* Transcript box */}
      {phase !== 'ending' && (
        <div className="relative z-10 w-full max-w-md px-4 mb-4">
          <div
            className={`rounded-2xl bg-black/30 backdrop-blur-md ring-1 ring-blue-700/30 overflow-hidden transition-all duration-300 ${
              transcriptExpanded ? 'max-h-[35vh]' : transcriptOpen ? 'max-h-[14vh]' : 'max-h-11'
            }`}
          >
            <button
              onClick={() => setTranscriptOpen(!transcriptOpen)}
              className="w-full flex items-center justify-between px-4 py-2.5 text-xs font-semibold text-blue-300/80 hover:text-blue-200 transition-colors"
            >
              <span>Transkrip ({transcript.length})</span>
              {transcriptOpen ? (
                <ChevronDown size={14} className={transcriptExpanded ? '' : ''} onClick={(e) => { e.stopPropagation(); setTranscriptExpanded(!transcriptExpanded); }} />
              ) : (
                <ChevronUp size={14} />
              )}
            </button>
            {transcriptOpen && (
              <div className="overflow-y-auto px-4 pb-3 space-y-2" style={{ maxHeight: transcriptExpanded ? '30vh' : '10vh' }}>
                {transcript.length === 0 && (
                  <p className="text-xs text-slate-500 italic py-2">Mulai bicara, Lemari lagi dengerin...</p>
                )}
                {transcript.map((entry) => (
                  <div key={entry.id} className={`text-xs leading-relaxed ${entry.role === 'user' ? 'text-blue-300' : 'text-slate-200'}`}>
                    <span className="font-semibold opacity-60 mr-1">{entry.role === 'user' ? 'Kamu' : 'Lemari'}:</span>
                    {entry.text}
                  </div>
                ))}
                {aiThinking && (
                  <div className="flex items-center gap-1.5 text-xs text-blue-400/70">
                    <Loader2 size={11} className="animate-spin" />
                    <span>Lemari mikir...</span>
                  </div>
                )}
                <div ref={transcriptEndRef} />
              </div>
            )}
          </div>
        </div>
      )}

      {/* Bottom: Call controls */}
      <div className="relative z-10 pb-10 pt-2 flex flex-col items-center gap-5">
        <div className="flex items-center gap-6">
          {/* Mute button */}
          <button
            onClick={handleMuteToggle}
            disabled={phase !== 'active'}
            className={`w-14 h-14 rounded-full flex items-center justify-center transition-all duration-200 active:scale-90 disabled:opacity-40 ${
              muted
                ? 'bg-slate-600 hover:bg-slate-500 ring-2 ring-slate-400/30'
                : 'bg-white/15 hover:bg-white/25 ring-2 ring-white/20'
            }`}
            title={muted ? 'Unmute' : 'Mute'}
          >
            {muted ? <MicOff size={22} className="text-white" /> : <Mic size={22} className="text-white" />}
          </button>

          {/* End call button */}
          <button
            onClick={handleEndCall}
            className="w-16 h-16 rounded-full bg-red-500 hover:bg-red-400 flex items-center justify-center transition-all duration-200 active:scale-90 shadow-lg shadow-red-900/40 ring-2 ring-red-400/30"
            title="Akhiri panggilan"
          >
            {phase === 'ending' ? (
              <Loader2 size={24} className="text-white animate-spin" />
            ) : (
              <PhoneOff size={24} className="text-white" />
            )}
          </button>

          {/* Spacer for symmetry */}
          <div className="w-14 h-14 flex items-center justify-center">
            <Phone size={20} className="text-blue-400/40" />
          </div>
        </div>

        {phase === 'connecting' && (
          <p className="text-xs text-blue-300/50 flex items-center gap-1.5">
            <Phone size={11} /> Nada dering...
          </p>
        )}
      </div>
    </div>
  );
}
