// Nerfyu
import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const GROQ_WHISPER_URL = "https://api.groq.com/openai/v1/audio/transcriptions";
const GROQ_CHAT_URL = "https://api.groq.com/openai/v1/chat/completions";
const WHISPER_MODEL = "whisper-large-v3";
// Dicoba berurutan. Kalau model pertama tidak tersedia (404/400), pakai berikutnya.
const CHAT_MODELS = ["llama-3.3-70b-versatile", "openai/gpt-oss-120b"];

const MAX_FILE_SIZE = 25 * 1024 * 1024; // 25MB (batas tier gratis Groq)
const TIME_BUDGET_MS = 100_000; // batas waktu total sebelum fungsi berhenti merapikan teks
const BATCH_MAX_CHARS = 1500; // maksimal karakter per panggilan perapian
const PARAGRAPH_MAX_CHARS = 700;
const PARAGRAPH_GAP_SECONDS = 1.8; // jeda bicara yang dianggap pergantian paragraf
const MIN_PUNCT_PER_UNIT = 1 / 25; // kurang dari ini = dianggap kurang tanda baca

const UNCLEAR_MSG = "Suara tidak terbaca secara jelas. Coba gunakan file suara yang lebih bersih dan jelas.";

// ---------- Konfigurasi bahasa ----------
const LANGUAGE_CONFIG: Record<string, { whisperCode: string; promptExample: string; scriptName: string }> = {
  id: {
    whisperCode: "id",
    promptExample:
      "Halo, selamat datang di Lemariku AI. Hari ini kita akan membahas beberapa hal penting, mulai dari kabar terbaru, tips berguna, sampai pertanyaan dari para pendengar. Apa yang bisa saya bantu?",
    scriptName: "Latin script (Bahasa Indonesia)",
  },
  ar: {
    whisperCode: "ar",
    promptExample: "مرحبا، أهلا وسهلا بك. كيف يمكنني مساعدتك اليوم؟",
    scriptName: "Arabic script (العربية)",
  },
  en: {
    whisperCode: "en",
    promptExample:
      "Hello, and welcome to Lemariku AI. Today we will talk about a few important things, from the latest news and useful tips to questions from our listeners. How can I help?",
    scriptName: "Latin script (English)",
  },
  ja: {
    whisperCode: "ja",
    promptExample: "こんにちは、いらっしゃいませ。本日はどのようなご用件でしょうか？",
    scriptName: "Japanese script (日本語 — kanji, hiragana, katakana)",
  },
  fa: {
    whisperCode: "fa",
    promptExample: "سلام، خوش آمدید. امروز چطور می‌توانم به شما کمک کنم؟",
    scriptName: "Persian script (فارسی)",
  },
};

// ---------- Utilitas teks ----------
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// Huruf kecil, buang tanda baca/simbol, rapikan spasi.
function norm(s: string): string {
  return s.toLowerCase().replace(/[\p{P}\p{S}]/gu, " ").replace(/\s+/g, " ").trim();
}

// Perkiraan jumlah "kata". Bahasa Jepang tidak memakai spasi, jadi dihitung per karakter.
function units(s: string, lang: string): number {
  const n = norm(s);
  if (!n) return 0;
  if (lang === "ja") return Math.round(n.replace(/ /g, "").length / 2);
  return n.split(" ").length;
}

const PUNCT_RE = /[.,;:!?。、！？،؛؟]/g;

function needsPunctuation(text: string, lang: string): boolean {
  const u = units(text, lang);
  if (u < 8) return false;
  const punct = (text.match(PUNCT_RE) ?? []).length;
  return punct / u < MIN_PUNCT_PER_UNIT;
}

// Pastikan hasil perapian tidak mengubah/menghapus/menambah kata.
function isFaithful(input: string, output: string, lang: string): boolean {
  const a = units(input, lang);
  const b = units(output, lang);
  if (a === 0) return false;
  if (a < 10) return Math.abs(a - b) <= 2;
  const ratio = b / a;
  return ratio >= 0.9 && ratio <= 1.1;
}

function splitByLength(text: string, max: number): string[] {
  const out: string[] = [];
  let rest = text.trim();
  while (rest.length > max) {
    let cut = rest.lastIndexOf(". ", max);
    if (cut < max * 0.5) cut = rest.lastIndexOf(" ", max);
    if (cut <= 0) cut = max;
    out.push(rest.slice(0, cut + 1).trim());
    rest = rest.slice(cut + 1).trim();
  }
  if (rest) out.push(rest);
  return out;
}

// ---------- Filter halusinasi Whisper (per segmen, bukan potong kata) ----------
// Kalimat yang sering "dikarang" Whisper saat audio hening. Dibuang hanya jika SELURUH segmen sama persis.
const ALWAYS_DROP = new Set(
  [
    "terima kasih telah menonton",
    "terima kasih sudah menonton",
    "terima kasih atas perhatian",
    "jangan lupa like dan subscribe",
    "thank you for watching",
    "thanks for watching",
    "please subscribe",
    "don't forget to like and subscribe",
    "thank you for listening",
    "شكرا للمشاهدة",
    "شكرا على المشاهدة",
    "ご視聴ありがとうございました",
    "ご覧いただきありがとうございました",
    "از تماشای شما متشکرم",
    "مرسی بابت مشاهده",
  ].map(norm),
);

// Kata pendek yang bisa saja ucapan asli, jadi hanya dibuang kalau Whisper sendiri ragu.
const DROP_IF_UNSURE = new Set(["you", "thank you", "so", "bye", "music", "applause", "uh", "um"].map(norm));

interface Segment {
  text: string;
  start: number;
  end: number;
  avg_logprob?: number;
  no_speech_prob?: number;
  compression_ratio?: number;
}

function isBadSegment(seg: Segment, promptNorm: string): boolean {
  const t = norm(seg.text);
  if (!t) return true;
  const noSpeech = seg.no_speech_prob ?? 0;
  const logprob = seg.avg_logprob ?? 0;
  const unsure = noSpeech > 0.4 || logprob < -0.8;

  if (noSpeech > 0.6 && logprob < -1) return true; // kemungkinan besar hening
  if ((seg.compression_ratio ?? 0) > 2.4) return true; // kalimat berulang-ulang (loop)
  if (ALWAYS_DROP.has(t)) return true;
  if (unsure && DROP_IF_UNSURE.has(t)) return true;
  // Prompt contoh yang "bocor" ke hasil saat audio hening
  if (unsure && promptNorm && (t === promptNorm || (t.length > 15 && promptNorm.includes(t)))) return true;
  return false;
}

// Buang segmen yang sama persis lebih dari 2 kali berturut-turut.
function dropRepeats(segs: Segment[]): Segment[] {
  const out: Segment[] = [];
  let run = 0;
  for (const s of segs) {
    const prev = out[out.length - 1];
    if (prev && norm(prev.text) === norm(s.text)) {
      run++;
      if (run >= 2) continue;
    } else {
      run = 0;
    }
    out.push(s);
  }
  return out;
}

// Gabungkan segmen jadi paragraf berdasarkan jeda bicara dan panjang teks.
function buildParagraphs(segs: Segment[], lang: string): string[] {
  const joiner = lang === "ja" ? "" : " ";
  const paras: string[] = [];
  let cur = "";
  let prevEnd = 0;
  for (const s of segs) {
    const text = s.text.trim();
    if (!text) continue;
    const gap = s.start - prevEnd;
    const endsSentence = /[.!?。！？؟]$/.test(cur);
    const longGap = gap > PARAGRAPH_GAP_SECONDS && cur.length > 200;
    const tooLong = cur.length > PARAGRAPH_MAX_CHARS && (endsSentence || cur.length > PARAGRAPH_MAX_CHARS * 1.5);
    if (cur && (longGap || tooLong)) {
      paras.push(cur);
      cur = "";
    }
    cur += (cur ? joiner : "") + text;
    prevEnd = s.end;
  }
  if (cur) paras.push(cur);
  return paras;
}

// ---------- Groq ----------
async function getGroqApiKey(): Promise<string | null> {
  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? Deno.env.get("VITE_SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) return null;

  const client = createClient(supabaseUrl, serviceRoleKey);
  const { data, error } = await client
    .from("app_secrets")
    .select("value")
    .eq("key", "GROQ_API_KEY")
    .maybeSingle();

  if (error || !data) return null;
  return data.value;
}

// Rapikan tanda baca & huruf kapital. Mengembalikan null jika gagal (teks asli dipakai).
async function formatWithLlm(
  apiKey: string,
  text: string,
  scriptName: string,
  lang: string,
  deadline: number,
): Promise<string | null> {
  const systemPrompt = `You are a text formatting assistant for speech-to-text transcripts.
The transcript is written in ${scriptName}.

Your job:
1. Add proper punctuation (periods, commas, question marks, exclamation marks) appropriate for the language.
2. Apply correct capitalization rules for the language.
3. Keep existing blank lines (paragraph breaks) exactly where they are. Do not merge or add paragraphs.
4. Keep the SAME LANGUAGE and SAME SCRIPT. Do NOT translate.
5. Do NOT change, add, remove, or reorder any words.
6. Output ONLY the formatted transcript text, with no commentary, labels, or quotes.`;

  for (const model of CHAT_MODELS) {
    for (let attempt = 0; attempt < 3; attempt++) {
      if (Date.now() > deadline) return null;

      let res: Response;
      try {
        res = await fetch(GROQ_CHAT_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
          body: JSON.stringify({
            model,
            messages: [
              { role: "system", content: systemPrompt },
              { role: "user", content: text },
            ],
            temperature: 0.1,
            max_tokens: 1500,
          }),
        });
      } catch {
        return null;
      }

      if (res.status === 429) {
        const wait = (Number(res.headers.get("retry-after")) || 8 * (attempt + 1)) * 1000;
        if (Date.now() + wait > deadline) return null;
        await sleep(wait);
        continue;
      }
      if (res.status === 404 || res.status === 400) break; // coba model berikutnya
      if (!res.ok) return null;

      const data = await res.json();
      const out: string = (data.choices?.[0]?.message?.content ?? "").trim();
      if (!out || !isFaithful(text, out, lang)) return null;
      return out;
    }
  }
  return null;
}

// ---------- Handler ----------
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  const deadline = Date.now() + TIME_BUDGET_MS;

  try {
    const apiKey = await getGroqApiKey();
    if (!apiKey) return json({ error: "Groq API key belum dikonfigurasi." }, 500);

    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    const language = (formData.get("language") as string | null) ?? "id";

    if (!file || file.size === 0) return json({ error: "File audio wajib diunggah." }, 400);
    if (file.size > MAX_FILE_SIZE) {
      return json(
        { error: `File terlalu besar. Maksimal 25MB, file kamu ${(file.size / 1024 / 1024).toFixed(1)}MB.` },
        413,
      );
    }

    const lang = LANGUAGE_CONFIG[language] ? language : "id";
    const langConfig = LANGUAGE_CONFIG[lang];

    // Langkah 1: transkripsi dengan Whisper (verbose_json supaya dapat data per segmen)
    const groqFormData = new FormData();
    groqFormData.append("file", file, file.name || "audio");
    groqFormData.append("model", WHISPER_MODEL);
    groqFormData.append("language", langConfig.whisperCode);
    groqFormData.append("response_format", "verbose_json");
    groqFormData.append("temperature", "0");
    groqFormData.append("prompt", langConfig.promptExample);

    const groqRes = await fetch(GROQ_WHISPER_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: groqFormData,
    });

    if (!groqRes.ok) {
      const errText = await groqRes.text();
      console.error("Groq Whisper error", groqRes.status, errText);
      let message = `Groq Whisper error: ${groqRes.status}`;
      if (groqRes.status === 429) message = "Kuota transkripsi sedang habis. Coba lagi beberapa menit lagi ya.";
      else if (groqRes.status === 400) {
        message = "File suara tidak bisa diproses. Gunakan format mp3, m4a, wav, ogg, flac, atau webm.";
      } else if (groqRes.status === 413) message = "File terlalu besar untuk diproses.";
      return json({ error: message }, groqRes.status);
    }

    const whisperData = await groqRes.json();
    const rawText: string = whisperData.text ?? "";
    const segments: Segment[] = Array.isArray(whisperData.segments) ? whisperData.segments : [];

    // Langkah 2: buang segmen halusinasi, lalu susun paragraf
    let paragraphs: string[];
    if (segments.length > 0) {
      const promptNorm = norm(langConfig.promptExample);
      const good = dropRepeats(segments.filter((s) => !isBadSegment(s, promptNorm)));
      paragraphs = buildParagraphs(good, lang);
    } else {
      // Cadangan jika data segmen tidak ada
      paragraphs = norm(rawText) ? splitByLength(rawText, PARAGRAPH_MAX_CHARS) : [];
    }

    const joined = paragraphs.join(" ");
    if (norm(joined).length < 5) {
      return json({ text: "", unclear: true, error: UNCLEAR_MSG });
    }

    // Langkah 3: rapikan tanda baca hanya pada paragraf yang memang kurang tanda baca
    const out: string[] = [];
    let incomplete = false;
    let i = 0;
    while (i < paragraphs.length) {
      if (!needsPunctuation(paragraphs[i], lang)) {
        out.push(paragraphs[i]);
        i++;
        continue;
      }
      // Kumpulkan paragraf berurutan yang butuh dirapikan, maksimal BATCH_MAX_CHARS
      const group: string[] = [];
      let size = 0;
      while (
        i < paragraphs.length &&
        needsPunctuation(paragraphs[i], lang) &&
        (group.length === 0 || size + paragraphs[i].length <= BATCH_MAX_CHARS)
      ) {
        group.push(paragraphs[i]);
        size += paragraphs[i].length;
        i++;
      }
      const formatted = await formatWithLlm(apiKey, group.join("\n\n"), langConfig.scriptName, lang, deadline);
      if (formatted) out.push(formatted);
      else {
        out.push(...group); // gagal: pakai teks asli bagian ini
        incomplete = true;
      }
    }

    const finalText = out.join("\n\n").trim();
    if (!norm(finalText)) return json({ text: "", unclear: true, error: UNCLEAR_MSG });

    return json({
      text: finalText,
      punctuated: !incomplete,
      ...(incomplete
        ? { warning: "Sebagian teks belum dirapikan karena batas kuota atau waktu. Coba lagi nanti ya." }
        : {}),
    });
  } catch (err) {
    console.error("transcribe error", err);
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});
