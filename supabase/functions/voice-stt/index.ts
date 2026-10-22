// File BARU: supabase/functions/voice-stt/index.ts
// Fungsi ringan untuk panggilan suara: audio pendek -> teks, secepat mungkin.
import { createClient } from "npm:@supabase/supabase-js@2.57.4";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};
const GROQ_WHISPER_URL = "https://api.groq.com/openai/v1/audio/transcriptions";
// Turbo = lebih cepat. Kalau ingin lebih akurat (tapi sedikit lebih lambat), ganti ke "whisper-large-v3".
const WHISPER_MODEL = "whisper-large-v3-turbo";
const MIN_FILE_SIZE = 1500; // byte; lebih kecil dari ini dianggap kosong
const MAX_FILE_SIZE = 10 * 1024 * 1024;
const KEY_TTL_MS = 5 * 60 * 1000;
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
// Simpan API key sementara di memori supaya tidak query database di setiap giliran bicara.
let cachedKey: { value: string; at: number } | null = null;
async function getGroqApiKey(): Promise<string | null> {
  if (cachedKey && Date.now() - cachedKey.at < KEY_TTL_MS) return cachedKey.value;
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
  cachedKey = { value: data.value, at: Date.now() };
  return data.value;
}
function norm(s: string): string {
  return s.toLowerCase().replace(/[\p{P}\p{S}]/gu, " ").replace(/\s+/g, " ").trim();
}
// Kalimat "karangan" Whisper saat audio hening. Dibuang hanya jika SELURUH segmen sama persis.
const ALWAYS_DROP = new Set(
  [
    "terima kasih telah menonton",
    "terima kasih sudah menonton",
    "jangan lupa like dan subscribe",
    "thank you for watching",
    "thanks for watching",
    "please subscribe",
    "subtitles by the amara org community",
    "subtitle by amara org",
  ].map(norm),
);
interface Segment {
  text: string;
  avg_logprob?: number;
  no_speech_prob?: number;
  compression_ratio?: number;
}
function isBadSegment(seg: Segment): boolean {
  const t = norm(seg.text);
  if (!t) return true;
  const noSpeech = seg.no_speech_prob ?? 0;
  const logprob = seg.avg_logprob ?? 0;
  if (noSpeech > 0.6 && logprob < -1) return true; // kemungkinan besar hening
  if ((seg.compression_ratio ?? 0) > 2.4) return true; // kalimat berulang-ulang
  if (ALWAYS_DROP.has(t)) return true;
  return false;
}
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }
  try {
    const apiKey = await getGroqApiKey();
    if (!apiKey) return json({ error: "Groq API key belum dikonfigurasi." }, 500);
    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    const langRaw = (formData.get("language") as string | null) ?? "id";
    const language = /^[a-z]{2}$/.test(langRaw) ? langRaw : "id";
    if (!file || file.size < MIN_FILE_SIZE) return json({ text: "" });
    if (file.size > MAX_FILE_SIZE) return json({ error: "Rekaman terlalu besar." }, 413);
    const groqForm = new FormData();
    groqForm.append("file", file, file.name || "voice.webm");
    groqForm.append("model", WHISPER_MODEL);
    groqForm.append("language", language);
    groqForm.append("response_format", "verbose_json");
    groqForm.append("temperature", "0");
    const res = await fetch(GROQ_WHISPER_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: groqForm,
    });
    if (!res.ok) {
      const errText = await res.text();
      console.error("voice-stt Groq error", res.status, errText);
      if (res.status === 429) {
        return json({ error: "Kuota suara sedang habis. Coba lagi beberapa menit lagi." }, 429);
      }
      // Rekaman rusak/terlalu pendek: anggap tidak ada ucapan, jangan tampilkan error.
      if (res.status === 400) return json({ text: "" });
      return json({ error: `Gagal mengenali suara (${res.status}).` }, res.status);
    }
    const data = await res.json();
    const segments: Segment[] = Array.isArray(data.segments) ? data.segments : [];
    let text: string;
    if (segments.length > 0) {
      text = segments
        .filter((s) => !isBadSegment(s))
        .map((s) => s.text.trim())
        .join(" ")
        .trim();
    } else {
      text = isBadSegment({ text: data.text ?? "" }) ? "" : String(data.text).trim();
    }
    if (norm(text).length < 2) text = "";
    return json({ text });
  } catch (err) {
    console.error("voice-stt error", err);
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});
