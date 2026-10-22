// Ganti seluruh isi: src/lib/voice.ts
// Fungsi dan nama ekspor sama seperti versi sebelumnya, jadi VoiceCall.tsx tidak perlu diubah
// (kecuali satu baris kecil di playFiller, lihat panduan).
let audioCtx: AudioContext | null = null;

function getCtx(): AudioContext {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
  }
  if (audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
  return audioCtx;
}

export function playRingtone(durationMs = 3000): () => void {
  const ctx = getCtx();
  const now = ctx.currentTime;
  const oscNodes: OscillatorNode[] = [];
  const gainNodes: GainNode[] = [];

  // Two-tone ring: alternating frequencies like a phone ring
  const tonePattern = [
    { freq: 440, start: 0, dur: 0.4 },
    { freq: 550, start: 0.5, dur: 0.4 },
    { freq: 440, start: 1.0, dur: 0.4 },
    { freq: 550, start: 1.5, dur: 0.4 },
    { freq: 440, start: 2.0, dur: 0.4 },
    { freq: 550, start: 2.5, dur: 0.4 },
  ];

  tonePattern.forEach(({ freq, start, dur }) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0, now + start);
    gain.gain.linearRampToValueAtTime(0.15, now + start + 0.05);
    gain.gain.setValueAtTime(0.15, now + start + dur - 0.05);
    gain.gain.linearRampToValueAtTime(0, now + start + dur);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now + start);
    osc.stop(now + start + dur);
    oscNodes.push(osc);
    gainNodes.push(gain);
  });

  const stop = () => {
    oscNodes.forEach((o) => { try { o.stop(); } catch { /* already stopped */ } });
  };

  setTimeout(stop, durationMs);
  return stop;
}

export function playEndTone(): void {
  const ctx = getCtx();
  const now = ctx.currentTime;
  // Descending three-note "call ended" tone
  const notes = [
    { freq: 660, start: 0, dur: 0.2 },
    { freq: 523, start: 0.2, dur: 0.2 },
    { freq: 392, start: 0.4, dur: 0.4 },
  ];
  notes.forEach(({ freq, start, dur }) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0, now + start);
    gain.gain.linearRampToValueAtTime(0.12, now + start + 0.03);
    gain.gain.linearRampToValueAtTime(0, now + start + dur);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now + start);
    osc.stop(now + start + dur);
  });
}

// ---------------------------------------------------------------------------
// Suara AI: TTS bawaan browser + intonasi buatan
// ---------------------------------------------------------------------------
// Browser hanya mengizinkan mengatur nada (pitch) dan kecepatan (rate) per ucapan. Karena itu
// kalimat dipecah per frasa (di koma dll.), lalu tiap frasa diberi nada, tempo, dan jeda yang
// berbeda mengikuti jenis kalimatnya (tanya, seru, menggantung, biasa). Hasilnya jauh lebih
// hidup daripada satu nada datar, tapi tetap terbatas oleh kualitas suara bawaan perangkat.

const TTS_LANG = 'id-ID';
const TTS_RATE = 1.05;
const TTS_PITCH = 1.15;

// false = bacakan satu kalimat utuh (lebih halus di HP yang lemah, tapi nadanya lebih datar)
const SPLIT_PHRASES = true;

export type SpeechMood = 'ramah' | 'cuek' | 'marah';

interface MoodVoice {
  rate: number; // kecepatan dasar
  pitch: number; // nada dasar (makin tinggi makin "muda")
  pitchJitter: number; // seberapa acak nada tiap frasa
  rateJitter: number; // seberapa acak tempo tiap frasa
  gapScale: number; // pengali jeda (kecil = cerewet dan rapat, besar = santai)
}

// Setelan utama untuk menyetel karakter suara. rate 1.2-1.3 masih jelas didengar.
const MOOD_VOICE: Record<SpeechMood, MoodVoice> = {
  ramah: { rate: 1.22, pitch: 1.35, pitchJitter: 0.08, rateJitter: 0.08, gapScale: 0.8 },
  cuek: { rate: 1.02, pitch: 1.1, pitchJitter: 0.03, rateJitter: 0.04, gapScale: 1.4 },
  marah: { rate: 1.32, pitch: 1.2, pitchJitter: 0.09, rateJitter: 0.1, gapScale: 0.6 },
};

// <PROSODY-START>
interface PhraseItem {
  text: string;
  rate: number;
  pitch: number;
  gapAfterMs: number;
  onChunkEnd?: () => void; // dipanggil setelah frasa terakhir dari satu potongan selesai
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const rand = (lo: number, hi: number) => lo + Math.random() * (hi - lo);
const jitter = (amount: number) => rand(-amount, amount);

// Kata seru pendek: dibaca lebih panjang dan lebih tinggi, lalu diberi jeda ("Eh... bentar").
const INTERJECTION =
  /^(e+h+|i+h+|o+h+|a+h+|u+h+|wah+|duh+|yah+|hah+|h?m{2,}|e+m{2,}|ehm+|e?(he){2,}h?|(ha){2,}h?)[,.!?…\s]*$/i;

function isInterjection(s: string): boolean {
  return INTERJECTION.test(s.trim());
}

function lettersCount(s: string): number {
  return s.replace(/[^\p{L}\p{N}]/gu, '').length;
}

// Memecah satu kalimat menjadi frasa pendek di koma, titik koma, titik dua, dan titik-titik (...).
function splitPhrases(text: string): string[] {
  if (!SPLIT_PHRASES) return [text];

  const raw = text
    .replace(/([,;:]|\.{2,}|…)\s+/g, '$1\u0001')
    .split('\u0001')
    .map((s) => s.trim())
    .filter(Boolean);

  // Gabungkan potongan yang terlalu pendek (kecuali kata seru) supaya tidak terdengar patah-patah.
  const merged: string[] = [];
  for (const p of raw) {
    const prev = merged[merged.length - 1];
    if (prev && lettersCount(prev) < 4 && !isInterjection(prev)) {
      merged[merged.length - 1] = `${prev} ${p}`;
    } else {
      merged.push(p);
    }
  }
  if (merged.length > 1) {
    const last = merged[merged.length - 1];
    if (lettersCount(last) < 4 && !isInterjection(last)) {
      merged.pop();
      merged[merged.length - 1] = `${merged[merged.length - 1]} ${last}`;
    }
  }
  return merged.length > 0 ? merged : [text];
}

type Ending = 'tanya' | 'seru' | 'gantung' | 'titik' | 'lanjut';

function endingOf(text: string): Ending {
  const t = text.trim();
  if (/\?["')\]]*$/.test(t)) return 'tanya';
  if (/!["')\]]*$/.test(t)) return 'seru';
  if (/(…|\.{2,})["')\]]*$/.test(t)) return 'gantung';
  if (/\.["')\]]*$/.test(t)) return 'titik';
  return 'lanjut'; // potongan di tengah kalimat panjang
}

// Jeda (ms) setelah frasa TERAKHIR dari satu potongan, menurut jenis akhir kalimat
const END_GAP: Record<Ending, [number, number]> = {
  titik: [230, 380],
  tanya: [260, 420],
  seru: [200, 320],
  gantung: [380, 560],
  lanjut: [60, 140],
};

function buildItems(
  text: string,
  mood: SpeechMood,
  rateOverride?: number,
  pitchOverride?: number,
): PhraseItem[] {
  const base = MOOD_VOICE[mood];
  const baseRate = rateOverride ?? base.rate;
  const basePitch = pitchOverride ?? base.pitch;
  const phrases = splitPhrases(text);
  const kind = endingOf(text);
  const n = phrases.length;

  return phrases.map((p, i) => {
    const last = i === n - 1;
    const pos = n > 1 ? i / (n - 1) : 0; // 0 = frasa awal, 1 = frasa akhir

    let pitch = basePitch + jitter(base.pitchJitter);
    let rate = baseRate + jitter(base.rateJitter);

    // Intonasi menurut jenis kalimat
    switch (kind) {
      case 'titik': // mulai agak tinggi lalu turun perlahan, ditutup turun
        pitch += 0.06 - 0.11 * pos;
        if (last) rate *= 0.95;
        break;
      case 'tanya': // datar lalu naik di akhir
        pitch += last ? 0.14 : 0.02;
        if (last) rate *= 0.96;
        break;
      case 'seru': // lebih tinggi dan lebih bersemangat
        pitch += last ? 0.1 : 0.08;
        rate += 0.05;
        break;
      case 'gantung': // melambat dan menurun, seperti ragu atau mikir
        pitch += 0.03 - 0.1 * pos;
        if (last) {
          rate *= 0.85;
          pitch -= 0.04;
        }
        break;
      default: // 'lanjut': masih ada sambungan
        pitch += 0.03;
    }

    // Kata seru pendek: ditarik lebih panjang dan lebih tinggi
    const interjection = isInterjection(p);
    if (interjection) {
      rate *= 0.82;
      pitch += 0.1;
    } else if (lettersCount(p) < 12) {
      rate *= 0.95;
    }

    // Jeda setelah frasa
    let gap = last ? rand(...END_GAP[kind]) : rand(90, 170);
    if (interjection) gap = Math.max(gap, rand(140, 260));
    gap *= base.gapScale;

    return {
      text: p,
      rate: clamp(rate, 0.85, 1.6),
      pitch: clamp(pitch, 0.8, 1.75),
      gapAfterMs: Math.round(gap),
    };
  });
}
// <PROSODY-END>

// ---------------------------------------------------------------------------
// Memilih suara perempuan Indonesia terbaik yang ada di perangkat
// ---------------------------------------------------------------------------
let currentUtterance: SpeechSynthesisUtterance | null = null;
let cachedVoice: SpeechSynthesisVoice | null = null;
let voicesListenerAdded = false;

// Chrome bisa membuang objek utterance sebelum selesai bicara, sehingga onend tidak pernah terpanggil.
// Menyimpan referensinya di sini mencegah hal itu.
const activeUtterances = new Set<SpeechSynthesisUtterance>();

function isIndonesianVoice(v: SpeechSynthesisVoice): boolean {
  const lang = v.lang.replace('_', '-').toLowerCase();
  return lang.startsWith('id') || lang === 'in-id'; // beberapa Android lama memakai "in-ID"
}

// Nilai lebih tinggi = lebih disukai. Suara "natural/online/neural" jauh lebih manusiawi.
function voiceScore(v: SpeechSynthesisVoice): number {
  const n = v.name.toLowerCase();
  let s = 0;
  if (/natural|online|neural/.test(n)) s += 4;
  if (/gadis|damayanti|female|wanita|perempuan/.test(n)) s += 3;
  if (/google/.test(n)) s += 2;
  if (/\b(ardi|andika|pria|laki-laki|male)\b/.test(n)) s -= 5;
  return s;
}

function pickIndonesianVoice(): SpeechSynthesisVoice | null {
  if (!('speechSynthesis' in window)) return null;
  const voices = window.speechSynthesis.getVoices();
  if (voices.length === 0) return cachedVoice;

  const idVoices = voices.filter(isIndonesianVoice);
  if (idVoices.length === 0) {
    cachedVoice = null;
    return null;
  }
  const best = [...idVoices].sort((a, b) => voiceScore(b) - voiceScore(a))[0];
  if (best !== cachedVoice) {
    cachedVoice = best;
    console.info('[voice] memakai suara:', best.name, best.lang);
  }
  return cachedVoice;
}

// Daftar suara dimuat async oleh browser; panggil ini lebih awal agar siap saat dibutuhkan.
export function prewarmVoices(): void {
  if (!('speechSynthesis' in window)) return;
  pickIndonesianVoice();
  if (!voicesListenerAdded) {
    voicesListenerAdded = true;
    window.speechSynthesis.addEventListener('voiceschanged', () => {
      pickIndonesianVoice();
    });
  }
}

// iOS dan sebagian HP baru mau bersuara setelah ada "suara pertama" yang dipicu sentuhan pengguna.
// Panggil ini dari event sentuhan; ia memutar ucapan kosong tanpa suara.
export function unlockSpeech(): void {
  if (!('speechSynthesis' in window)) return;
  if (window.speechSynthesis.speaking || window.speechSynthesis.pending) return;
  try {
    const u = new SpeechSynthesisUtterance(' ');
    u.volume = 0;
    window.speechSynthesis.speak(u);
  } catch {
    /* noop */
  }
}

// ---------------------------------------------------------------------------
// Antrean ucapan: satu frasa sekali jalan, dengan jeda di antaranya
// ---------------------------------------------------------------------------
const queue: PhraseItem[] = [];
let running = false;
let currentItem: PhraseItem | null = null;
let epoch = 0; // naik setiap stopSpeaking() agar callback lama diabaikan

function speakPhrase(item: PhraseItem, done: () => void): void {
  if (!('speechSynthesis' in window)) {
    done();
    return;
  }

  const utter = new SpeechSynthesisUtterance(item.text);
  utter.lang = TTS_LANG;
  utter.rate = item.rate;
  utter.pitch = item.pitch;
  const voice = pickIndonesianVoice();
  if (voice) utter.voice = voice;

  let finished = false;
  let safetyTimer: ReturnType<typeof setTimeout> | null = null;

  const finish = () => {
    if (finished) return;
    finished = true;
    if (safetyTimer) clearTimeout(safetyTimer);
    activeUtterances.delete(utter);
    done();
  };

  utter.onend = finish;
  utter.onerror = finish;

  // Jaga-jaga jika browser tidak memanggil onend: anggap selesai setelah perkiraan durasi + cadangan.
  const estimateMs = Math.max(2500, (item.text.length * 90) / item.rate) + 3000;
  safetyTimer = setTimeout(finish, estimateMs);

  activeUtterances.add(utter);
  window.speechSynthesis.speak(utter);
}

function pump(): void {
  if (running) return;
  const item = queue.shift();
  if (!item) return;

  running = true;
  currentItem = item;
  const myEpoch = epoch;

  speakPhrase(item, () => {
    if (myEpoch !== epoch) return; // sudah dihentikan lewat stopSpeaking()
    currentItem = null;
    item.onChunkEnd?.(); // boleh menambah antrean baru

    const wait = queue.length > 0 ? item.gapAfterMs : 0;
    const release = () => {
      if (myEpoch !== epoch) return;
      running = false;
      pump();
    };
    if (wait > 0) setTimeout(release, wait);
    else release();
  });
}

interface QueuedSpeechOptions {
  mood?: SpeechMood;
  rate?: number; // menimpa kecepatan dasar mood
  pitch?: number; // menimpa nada dasar mood
  onEnd?: () => void;
}

// Menambahkan ucapan ke ANTREAN (tidak memotong yang sedang berbicara).
// Dipakai untuk membacakan jawaban kalimat demi kalimat sambil jawabannya masih datang.
export function speakQueued(text: string, options: QueuedSpeechOptions = {}): void {
  const done = () => options.onEnd?.();

  if (!('speechSynthesis' in window)) {
    done();
    return;
  }

  const clean = text.trim();
  if (!clean) {
    done();
    return;
  }

  const items = buildItems(clean, options.mood ?? 'ramah', options.rate, options.pitch);
  items[items.length - 1].onChunkEnd = done;
  queue.push(...items);
  pump();
}

export function speakText(text: string, onEnd?: () => void): void {
  if (!('speechSynthesis' in window)) return;

  window.speechSynthesis.cancel();

  const clean = text.replace(/\*\*/g, '').replace(/\[MOOD:[^\]]+\]/g, '').trim();
  if (!clean) {
    onEnd?.();
    return;
  }

  const utter = new SpeechSynthesisUtterance(clean);
  utter.lang = TTS_LANG;
  utter.rate = TTS_RATE;
  utter.pitch = TTS_PITCH;

  const voices = window.speechSynthesis.getVoices();
  const idVoice = voices.find((v) => v.lang.startsWith('id'));
  const femaleVoice = idVoice ?? voices.find((v) => v.name.toLowerCase().includes('female')) ?? voices.find((v) => v.lang.startsWith('en') && v.name.toLowerCase().includes('female'));
  if (femaleVoice) utter.voice = femaleVoice;

  utter.onend = () => {
    currentUtterance = null;
    onEnd?.();
  };
  utter.onerror = () => {
    currentUtterance = null;
    onEnd?.();
  };

  currentUtterance = utter;
  window.speechSynthesis.speak(utter);
}

export function stopSpeaking(): void {
  epoch += 1;
  const dropped = queue.splice(0, queue.length);
  if (currentItem) dropped.unshift(currentItem);
  currentItem = null;
  running = false;

  if ('speechSynthesis' in window) {
    window.speechSynthesis.cancel();
  }
  currentUtterance = null;

  // Beri tahu pemanggil bahwa antreannya dibatalkan, supaya hitungan di sisi mereka tidak menggantung.
  dropped.forEach((it) => it.onChunkEnd?.());
}

export function isSpeaking(): boolean {
  return running || ('speechSynthesis' in window && window.speechSynthesis.speaking);
}

export function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}
