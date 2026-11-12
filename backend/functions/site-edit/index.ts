// Supabase Edge Function: site-edit
// HİTK görevlisinin yazdığı isteğe göre anasayfada (index.html, en/index.html) değişiklik önerir,
// onaylanınca GitHub'a commitler. Her istek, yanıt ve yayın public.site_edits tablosuna yazılır.
// Yalnızca aktif "pr" (Halkla İlişkiler ve Tanıtım) rolündeki üye (ve kulüp sahibi hesap) kullanabilir.
//
// POST ${SUPABASE_URL}/functions/v1/site-edit
// Header: Authorization: Bearer <kullanıcının access token'ı>
// Body:
//   { action: "propose", prompt, session_id }  -> { row }   (değişiklik önerisi ya da yalnızca yanıt)
//   { action: "publish", id }                  -> { row }   (öneriyi siteye yayınlar)
//   { action: "reject",  id }                  -> { row }
//   { action: "revert",  id }                  -> { row }   (yayınlanmış değişikliğin tersini öneri olarak hazırlar)
//
// Gerekli secret'lar: ANTHROPIC_API_KEY, GITHUB_TOKEN (yalnızca bu depoya "Contents: read and write" yetkili)
// SUPABASE_URL, SUPABASE_ANON_KEY ve SUPABASE_SERVICE_ROLE_KEY Supabase tarafından otomatik verilir.

import Anthropic from "npm:@anthropic-ai/sdk";
import { createClient } from "npm:@supabase/supabase-js@2";
import { decodeBase64, encodeBase64 } from "jsr:@std/encoding@1/base64";

const REPO = "cankilicaslan/anittepe-rotaract";
const BRANCH = "main";
const FILES = ["index.html", "en/index.html"] as const;
const MODEL = "claude-opus-5-5";
const DAILY_LIMIT = 40;

const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json; charset=utf-8" } });

class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

type Edit = { file: string; old_str: string; new_str: string };

const admin = () =>
  createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

// Çağıranın oturumunu doğrular: aktif HİTK (pr) üyesi ya da kulüp sahibi hesap olmalı.
async function requireHitk(req: Request) {
  const auth = req.headers.get("Authorization") || "";
  if (!auth.toLowerCase().startsWith("bearer ")) throw new HttpError(401, "Oturum bulunamadı. Lütfen tekrar giriş yap.");
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: auth } }, auth: { persistSession: false },
  });
  const { data: u, error } = await sb.auth.getUser(auth.slice(7).trim());
  if (error || !u?.user) throw new HttpError(401, "Oturumunun süresi dolmuş. Lütfen tekrar giriş yap.");
  const { data: p } = await sb.from("profiles").select("id, full_name, status, roles").eq("id", u.user.id).maybeSingle();
  if (!p) throw new HttpError(403, "Üye profilin bulunamadı.");
  const isPr = p.status === "active" && (p.roles ?? []).includes("pr");
  let owner = false;
  if (!isPr) { const { data } = await sb.rpc("is_owner"); owner = data === true; }
  if (!isPr && !owner) throw new HttpError(403, "Site düzenleme yalnızca Halkla İlişkiler ve Tanıtım görevlisine açık.");
  return p as { id: string; full_name: string };
}

// ---------------------------------------------------------------- GitHub
function gh(path: string, init: RequestInit = {}) {
  const token = Deno.env.get("GITHUB_TOKEN");
  if (!token) throw new HttpError(500, "GitHub anahtarı (GITHUB_TOKEN) tanımlı değil. Yöneticiye haber ver.");
  return fetch(`https://api.github.com/repos/${REPO}/${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "User-Agent": "anittepe-site-edit", "X-GitHub-Api-Version": "2022-11-28", ...(init.headers || {}) },
  });
}
async function readFile(path: string) {
  const r = await gh(`contents/${path}?ref=${BRANCH}&t=${Date.now()}`);
  if (!r.ok) throw new HttpError(502, `Site dosyası okunamadı (${path}, GitHub ${r.status}).`);
  const j = await r.json();
  return { sha: j.sha as string, text: new TextDecoder().decode(decodeBase64(String(j.content).replace(/\s/g, ""))) };
}
async function writeFile(path: string, text: string, sha: string, message: string) {
  const r = await gh(`contents/${path}`, {
    method: "PUT",
    body: JSON.stringify({ message, content: encodeBase64(new TextEncoder().encode(text)), sha, branch: BRANCH,
      committer: { name: "HİTK site paneli", email: "anitteperotaract1996@gmail.com" } }),
  });
  if (!r.ok) throw new HttpError(502, `Değişiklik siteye yazılamadı (${path}, GitHub ${r.status}). Biraz sonra tekrar dene.`);
  return (await r.json()).commit?.html_url as string;
}

// ---------------------------------------------------------------- Düzenleme kuralları
const count = (hay: string, needle: string) => needle ? hay.split(needle).length - 1 : 0;
const UNSAFE = /<\s*(script|style|iframe|object|embed|form)\b|\son[a-z]+\s*=|javascript:|data:text\/html/i;

function checkEdits(edits: Edit[], files: Record<string, string>): string | null {
  if (edits.length > 30) return "Bir seferde en fazla 30 değişiklik yapılabilir.";
  for (const [i, e] of edits.entries()) {
    if (!FILES.includes(e.file as typeof FILES[number])) return `${i + 1}. değişiklik: bilinmeyen dosya "${e.file}".`;
    if (e.old_str === e.new_str) return `${i + 1}. değişiklik: eski ve yeni metin aynı.`;
    const n = count(files[e.file], e.old_str);
    if (n !== 1) return `${i + 1}. değişiklik (${e.file}): old_str dosyada ${n} kez geçiyor; tam olarak 1 kez geçmeli. Dosyadan birebir ve daha uzun bir parça kopyala.`;
    if (UNSAFE.test(e.new_str) && !UNSAFE.test(e.old_str)) return `${i + 1}. değişiklik: betik, stil, form veya olay özniteliği eklenemez.`;
  }
  return null;
}
function apply(text: string, edits: Edit[]) {
  for (const e of edits) {
    if (count(text, e.old_str) !== 1) throw new HttpError(409, "Site bu öneriden sonra değişmiş; öneri artık uygulanamıyor. İsteği yeniden yaz.");
    text = text.replace(e.old_str, () => e.new_str);
  }
  return text;
}
// Modele gösterilen kopya: CSS ve JS gövdeleri gizlenir (yalnızca içerik düzenlenir, maliyet düşer).
const forModel = (html: string) =>
  html.replace(/(<style[^>]*>)[\s\S]*?(<\/style>)/gi, "$1/* CSS gizlendi, düzenlenemez */$2")
      .replace(/(<script[^>]*>)[\s\S]*?(<\/script>)/gi, "$1/* JS gizlendi, düzenlenemez */$2");

const SYSTEM = `Sen Ankara Anıttepe Rotaract Kulübünün web sitesinin (anitteperotaract.org) anasayfasını düzenleyen yardımcısın. Kulübün Halkla İlişkiler ve Tanıtım (HİTK) görevlisiyle Türkçe konuşuyorsun.

Dosyalar: "index.html" Türkçe anasayfa, "en/index.html" İngilizce anasayfa. Sana CSS ve JS gövdeleri gizlenmiş hâlleri verilir; yalnızca görünür içerikte (metin, başlık, liste, bağlantı, mevcut görsel yolları) değişiklik yap.

Kurallar:
- Her yanıtta propose_edits aracını bir kez çağır. "reply" kısa ve Türkçe olsun: ne yaptığını ya da neden yapmadığını söyle.
- old_str dosyadan birebir kopyalanmalı ve dosyada tam olarak bir kez geçmeli; gerekirse çevresinden biraz daha metin ekle. Gizlenmiş CSS/JS bölümlerine dokunma.
- HTML yapısını, class adlarını ve id'leri koru. Betik, stil, iframe, form ya da onclick gibi öznitelik ekleme.
- Türkçe metinlerde TDK yazım kurallarına uy: kurum ve kuruluş adlarına gelen ekler kesmeyle ayrılmaz ("Ankara Anıttepe Rotary Kulübünün"), belirli tarih bildirmeyen gün adları küçük harfle yazılır ("iki haftada bir perşembe"). Kulübün adı "Ankara Anıttepe Rotaract Kulübü"dür.
- İstenen metnin İngilizce sayfada karşılığı varsa onu da doğal bir çeviriyle güncelle; görevli "yalnızca Türkçe" derse dokunma.
- İstek belirsizse, sitede karşılığı yoksa ya da anasayfa dışı bir şeyse (üye paneli, tasarım/CSS, yeni bölüm kodu) değişiklik önerme: edits boş kalsın, reply'da kısaca açıkla veya netleştirici bir soru sor.
- Kişisel veri (telefon, e-posta, adres) yalnızca görevli açıkça verdiyse ve ilgili yere eklenecekse yazılır. Uydurma bilgi, tarih ya da sayı ekleme.
- Önerilerin görevli onaylayınca yayınlanır; görevli önce farkı görür.`;

const TOOL = {
  name: "propose_edits",
  description: "Anasayfa için önerilen değişiklikleri ve görevliye kısa yanıtı bildirir. Değişiklik gerekmiyorsa edits boş dizi olur.",
  input_schema: {
    type: "object",
    properties: {
      reply: { type: "string", description: "Görevliye kısa Türkçe yanıt: ne değişecek ya da neden değişiklik yok." },
      edits: {
        type: "array",
        items: {
          type: "object",
          properties: {
            file: { type: "string", enum: [...FILES] },
            old_str: { type: "string", description: "Dosyadan birebir kopyalanmış, dosyada tam bir kez geçen metin." },
            new_str: { type: "string", description: "old_str yerine gelecek metin." },
          },
          required: ["file", "old_str", "new_str"],
        },
      },
    },
    required: ["reply", "edits"],
  },
};

async function propose(user: { id: string; full_name: string }, prompt: string, sessionId: string) {
  const db = admin();
  const since = new Date(Date.now() - 864e5).toISOString();
  const { count: used } = await db.from("site_edits").select("id", { count: "exact", head: true }).eq("user_id", user.id).gte("created_at", since).is("revert_of", null);
  if ((used ?? 0) >= DAILY_LIMIT) throw new HttpError(429, `Son 24 saatte ${DAILY_LIMIT} istek sınırına ulaştın. Yarın tekrar dene.`);

  const files: Record<string, string> = {};
  for (const f of FILES) files[f] = (await readFile(f)).text;

  // Aynı sohbetteki önceki istekler bağlam olarak verilir.
  const { data: prev } = await db.from("site_edits").select("prompt, reply, status").eq("session_id", sessionId).order("created_at").limit(20);
  const STATUS: Record<string, string> = { onerildi: "öneri bekliyor", yayinlandi: "yayınlandı", reddedildi: "görevli reddetti", hata: "hata", yanit: "değişiklik önerilmedi" };
  const messages: Anthropic.Beta.BetaMessageParam[] = [];
  for (const r of (prev ?? []).slice(-8)) {
    messages.push({ role: "user", content: r.prompt });
    messages.push({ role: "assistant", content: `${r.reply || "(yanıt yok)"}\n[Durum: ${STATUS[r.status] || r.status}]` });
  }
  messages.push({ role: "user", content: prompt });

  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) throw new HttpError(500, "Yapay zekâ anahtarı (ANTHROPIC_API_KEY) tanımlı değil.");
  const client = new Anthropic({ apiKey });
  const system = [
    { type: "text" as const, text: SYSTEM },
    { type: "text" as const, text: FILES.map(f => `<file name="${f}">\n${forModel(files[f])}\n</file>`).join("\n\n"), cache_control: { type: "ephemeral" as const } },
  ];

  let inTok = 0, outTok = 0, reply = "", edits: Edit[] = [], problem: string | null = null;
  // Model geçersiz bir old_str verirse hatayı söyleyip en fazla iki kez düzeltmesini ister.
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await client.beta.messages.create({
      model: MODEL, max_tokens: 16000, output_config: { effort: "medium" },
      betas: ["server-side-fallback-2026-07-01"], fallbacks: "default",
      system, tools: [TOOL], tool_choice: { type: "tool", name: TOOL.name }, messages,
    });
    inTok += res.usage?.input_tokens ?? 0; outTok += res.usage?.output_tokens ?? 0;
    if (res.stop_reason === "refusal") throw new HttpError(422, "Yapay zekâ bu isteği yerine getirmedi. İsteği farklı yazmayı dene.");
    if (res.stop_reason === "max_tokens") throw new HttpError(422, "İstek tek seferde yapılamayacak kadar büyük. Daha küçük parçalara böl.");
    const call = res.content.find(b => b.type === "tool_use") as Anthropic.Beta.BetaToolUseBlock | undefined;
    if (!call) throw new HttpError(502, "Yapay zekâdan beklenen yanıt gelmedi. Tekrar dene.");
    const input = call.input as { reply?: unknown; edits?: unknown };
    reply = typeof input.reply === "string" ? input.reply : "";
    edits = Array.isArray(input.edits) ? (input.edits as Edit[]).filter(e => e && typeof e.old_str === "string" && typeof e.new_str === "string") : [];
    problem = checkEdits(edits, files);
    if (!problem) break;
    messages.push({ role: "assistant", content: res.content });
    messages.push({ role: "user", content: [{ type: "tool_result", tool_use_id: call.id, is_error: true, content: `Öneri uygulanamadı: ${problem} Düzeltip propose_edits'i tekrar çağır.` }] });
  }

  const row = {
    session_id: sessionId, user_id: user.id, user_name: user.full_name, prompt, reply,
    edits: problem ? [] : edits, status: problem ? "hata" : edits.length ? "onerildi" : "yanit",
    error: problem, model: MODEL, input_tokens: inTok, output_tokens: outTok,
  };
  const { data, error } = await db.from("site_edits").insert(row).select().single();
  if (error) throw new HttpError(500, "Kayıt yazılamadı: " + error.message);
  return data;
}

async function getRow(id: string) {
  const { data } = await admin().from("site_edits").select("*").eq("id", id).maybeSingle();
  if (!data) throw new HttpError(404, "Kayıt bulunamadı.");
  return data;
}

async function publish(id: string) {
  const db = admin();
  const row = await getRow(id);
  if (row.status !== "onerildi") throw new HttpError(409, "Bu öneri yayınlanmaya hazır değil.");
  const edits = row.edits as Edit[];
  const msg = `HİTK paneli: ${String(row.reply || row.prompt).replace(/\s+/g, " ").slice(0, 72)}\n\nKayıt: ${row.id}`;
  const urls: string[] = [];
  try {
    for (const f of FILES) {
      const mine = edits.filter(e => e.file === f);
      if (!mine.length) continue;
      const cur = await readFile(f);
      urls.push(await writeFile(f, apply(cur.text, mine), cur.sha, msg));
    }
  } catch (e) {
    await db.from("site_edits").update({ error: (e as Error).message, commit_urls: urls.length ? urls : null }).eq("id", id);
    throw e;
  }
  const { data } = await db.from("site_edits").update({ status: "yayinlandi", published_at: new Date().toISOString(), commit_urls: urls, error: null }).eq("id", id).select().single();
  return data;
}

async function reject(id: string) {
  const row = await getRow(id);
  if (row.status !== "onerildi") throw new HttpError(409, "Yalnızca bekleyen öneriler reddedilebilir.");
  const { data } = await admin().from("site_edits").update({ status: "reddedildi" }).eq("id", id).select().single();
  return data;
}

async function revert(user: { id: string; full_name: string }, id: string) {
  const row = await getRow(id);
  if (row.status !== "yayinlandi") throw new HttpError(409, "Yalnızca yayınlanmış değişiklikler geri alınabilir.");
  const edits = (row.edits as Edit[]).map(e => ({ file: e.file, old_str: e.new_str, new_str: e.old_str }));
  const files: Record<string, string> = {};
  for (const f of FILES) files[f] = (await readFile(f)).text;
  const problem = checkEdits(edits, files);
  const { data, error } = await admin().from("site_edits").insert({
    session_id: row.session_id, user_id: user.id, user_name: user.full_name, revert_of: row.id,
    prompt: `Geri al: ${row.prompt}`.slice(0, 2000),
    reply: problem ? "Bu değişiklik otomatik geri alınamıyor; site o kısımda sonradan değişmiş. Ne istediğini yazarak yeniden düzenleyebilirsin." : "Önceki değişikliğin tersi hazır. Kontrol edip yayınlayabilirsin.",
    edits: problem ? [] : edits, status: problem ? "hata" : "onerildi", error: problem,
  }).select().single();
  if (error) throw new HttpError(500, "Kayıt yazılamadı: " + error.message);
  return data;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Yalnızca POST desteklenir." }, 405);
  try {
    const user = await requireHitk(req);
    const body = await req.json().catch(() => null) as Record<string, unknown> | null;
    if (!body) throw new HttpError(400, "İstek gövdesi geçerli bir JSON değil.");
    const id = typeof body.id === "string" ? body.id : "";
    switch (body.action) {
      case "propose": {
        const prompt = String(body.prompt ?? "").trim();
        const sid = String(body.session_id ?? "");
        if (!prompt) throw new HttpError(400, "Ne değişmesini istediğini yaz.");
        if (prompt.length > 4000) throw new HttpError(400, "İstek en fazla 4000 karakter olabilir.");
        if (!/^[0-9a-f-]{36}$/i.test(sid)) throw new HttpError(400, "Geçersiz sohbet kimliği.");
        return json({ row: await propose(user, prompt, sid) });
      }
      case "publish": return json({ row: await publish(id) });
      case "reject": return json({ row: await reject(id) });
      case "revert": return json({ row: await revert(user, id) });
      default: throw new HttpError(400, "Bilinmeyen işlem.");
    }
  } catch (err) {
    if (err instanceof HttpError) return json({ error: err.message }, err.status);
    if (err instanceof Anthropic.APIError) {
      console.error("Anthropic API hatası", err.status, err.message);
      return json({ error: err.status === 429 ? "Yapay zekâ servisi şu an yoğun. Bir dakika sonra tekrar dene." : "Yapay zekâ servisine ulaşılamadı. Tekrar dene." }, 502);
    }
    console.error("Beklenmeyen hata", err);
    return json({ error: "Beklenmeyen bir hata oluştu. Tekrar dene." }, 500);
  }
});
