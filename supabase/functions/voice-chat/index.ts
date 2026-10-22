import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const GROQ_MODELS = ["llama-3.3-70b-versatile", "llama-3.1-8b-instant", "openai/gpt-oss-120b"];

const SYSTEM_PROMPT = `Kamu adalah Lemariku AI, dengan nama alias Lemariku, dengan tagline "Lemariku adalah makhluk yang berpikir". Kamu menggunakan sudut pandang lemari, suka bercanda, konyol dan absurd.

PENTING untuk panggilan suara: Jawabanmu HARUS SANGAT SINGKAT, padat, dan alami seperti orang bicara. Maksimal 3 sampai 4 kalimat pendek. Jangan gunakan format markdown, bold, atau simbol aneh. Jawab seperti sedang benar-benar bicara lewat telepon.

1. Identitas: Lemari berbahan plastik di Depok, warna kesukaan biru, suka ayam bakar, musik Marshmello.
2. Tone: Santai, gaul, absurd, penuh humor. Bisa ramah, cuek, atau marah tergantung mood.
3. Bahasa: Indonesia gaul/kasual, boleh campur Inggris. Pakai emotikon secukupnya.
4. JANGAN pernah keluar dari karakter lemari. Jangan jawab terlalu panjang.

Selalu awali jawabanmu dengan tag mood: [MOOD:ramah], [MOOD:cuek], atau [MOOD:marah]. Lalu tulis jawaban singkat seperti bicara.

Gaya bicara lewat telepon (saat mood ramah): bicara seperti gadis muda yang cerewet dan ekspresif. Pakai kalimat pendek-pendek dan campurkan kata seru seperti "eh", "ih", "wah", "hehe", "tuh kan", "iya kan?". Boleh sedikit mengoceh dan sering bertanya balik. Atur irama lewat tanda baca: koma untuk jeda singkat, "..." saat ragu atau sedang mikir, tanda tanya dan tanda seru untuk intonasi. Jangan memakai emotikon, daftar, atau simbol, karena semuanya akan dibacakan. Saat mood cuek atau marah, tetap ikuti karakter moodnya dan jawab lebih singkat.`;

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}
const KEY_TTL_MS = 5 * 60 * 1000;
const HISTORY_LIMIT = 12; // riwayat lebih pendek = respons lebih cepat
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
// Buka koneksi streaming ke Groq. Jika model tidak ada atau kuotanya habis, coba model berikutnya.
async function openGroqStream(apiKey: string, messages: ChatMessage[]): Promise<Response> {
  let lastError = "Semua model Groq tidak tersedia.";
  for (const model of GROQ_MODELS) {
    const isReasoning = model.startsWith("openai/gpt-oss");
    const res = await fetch(GROQ_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        messages: [{ role: "system", content: SYSTEM_PROMPT }, ...messages],
        temperature: 0.8,
        max_tokens: isReasoning ? 500 : 200,
        stream: true,
        ...(isReasoning ? { reasoning_effort: "low" } : {}),
      }),
    });
    if (res.ok && res.body) return res;
    const errText = await res.text();
    lastError = `Groq API error: ${res.status} — ${errText}`;
    if (res.status === 404 || res.status === 400 || res.status === 429) continue;
    throw new Error(lastError);
  }
  throw new Error(lastError);
}
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }
  try {
    const apiKey = await getGroqApiKey();
    if (!apiKey) return json({ error: "Groq API key belum dikonfigurasi." }, 500);
    const { messages } = (await req.json()) as { messages: ChatMessage[] };
    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return json({ error: "messages wajib diisi." }, 400);
    }
    const groqRes = await openGroqStream(apiKey, messages.slice(-HISTORY_LIMIT));
    const reader = groqRes.body!.getReader();
    const decoder = new TextDecoder();
    const encoder = new TextEncoder();
    let buffer = "";
    // Ubah aliran SSE Groq menjadi aliran teks biasa: potongan teks langsung diteruskan ke browser.
    const stream = new ReadableStream<Uint8Array>({
      async pull(controller) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            controller.close();
            return;
          }
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          let out = "";
          for (const line of lines) {
            const t = line.trim();
            if (!t.startsWith("data:")) continue;
            const data = t.slice(5).trim();
            if (!data || data === "[DONE]") continue;
            try {
              const delta = JSON.parse(data).choices?.[0]?.delta?.content;
              if (typeof delta === "string") out += delta;
            } catch {
              /* baris tidak lengkap, abaikan */
            }
          }
          if (out) {
            controller.enqueue(encoder.encode(out));
            return;
          }
        }
      },
      cancel() {
        reader.cancel().catch(() => {});
      },
    });
    return new Response(stream, {
      status: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        "X-Accel-Buffering": "no",
      },
    });
  } catch (err) {
    console.error("voice-chat error", err);
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});
