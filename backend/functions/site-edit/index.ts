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
//   { action: "direct",  edits, note }         -> { row }   (panelde elle düzeltilen metinleri yapay zekâsız yayınlar)
//   { action: "status" }                       -> { ai: "gemini" | "claude" | null }
//
// Gerekli secret: GITHUB_TOKEN (yalnızca bu depoya "Contents: read and write" yetkili).
// İsteğe bağlı: GEMINI_API_KEY (ücretsiz katman, öncelikli) ya da ANTHROPIC_API_KEY; GEMINI_MODEL (varsayılan gemini-3.8-flash).
// SUPABASE_URL, SUPABASE_ANON_KEY ve SUPABASE_SERVICE_ROLE_KEY Supabase tarafından otomatik verilir.

import Anthropic from "npm:@anthropic-ai/sdk";
import { createClient } from "npm:@supabase/supabase-js@2";
import { decodeBase64, encodeBase64 } from "jsr:@std/encoding@1/base64";
import { parseHTML } from "npm:linkedom@0.18.5";

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

type Edit = { file: string; old_str: string; new_str: string; all?: boolean };

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

// all: true yalnızca doğrudan düzenleyicide, sayfada birebir tekrar eden metinler (ör. kayan şerit) için kullanılır.
function checkEdits(edits: Edit[], files: Record<string, string>, max = 30): string | null {
  if (edits.length > max) return `Bir seferde en fazla ${max} değişiklik yapılabilir.`;
  for (const [i, e] of edits.entries()) {
    if (!FILES.includes(e.file as typeof FILES[number])) return `${i + 1}. değişiklik: bilinmeyen dosya "${e.file}".`;
    if (e.old_str === e.new_str) return `${i + 1}. değişiklik: eski ve yeni metin aynı.`;
    const n = count(files[e.file], e.old_str);
    if (e.all ? n < 1 : n !== 1) return `${i + 1}. değişiklik (${e.file}): old_str dosyada ${n} kez geçiyor; tam olarak 1 kez geçmeli. Dosyadan birebir ve daha uzun bir parça kopyala.`;
    if (UNSAFE.test(e.new_str) && !UNSAFE.test(e.old_str)) return `${i + 1}. değişiklik: betik, stil, form veya olay özniteliği eklenemez.`;
  }
  return null;
}
function apply(text: string, edits: Edit[]) {
  for (const e of edits) {
    const n = count(text, e.old_str);
    if (e.all ? n < 1 : n !== 1) throw new HttpError(409, "Site bu öneriden sonra değişmiş; öneri artık uygulanamıyor. Sayfayı yenileyip yeniden dene.");
    text = e.all ? text.split(e.old_str).join(e.new_str) : text.replace(e.old_str, () => e.new_str);
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

// ---------------------------------------------------------------- Yapay zekâ sağlayıcıları
// GEMINI_API_KEY varsa Google Gemini (ücretsiz katman), yoksa ANTHROPIC_API_KEY ile Claude kullanılır.
type AiOut = { reply: string; edits: Edit[]; problem: string | null; model: string; inTok: number; outTok: number };
const aiProvider = () => Deno.env.get("GEMINI_API_KEY") ? "gemini" : Deno.env.get("ANTHROPIC_API_KEY") ? "claude" : null;
const cleanEdits = (x: unknown): Edit[] => Array.isArray(x)
  ? (x as Edit[]).filter(e => e && typeof e.file === "string" && typeof e.old_str === "string" && typeof e.new_str === "string").map(e => ({ file: e.file, old_str: e.old_str, new_str: e.new_str }))
  : [];

async function runClaude(history: { role: "user" | "assistant"; text: string }[], filesText: string, files: Record<string, string>): Promise<AiOut> {
  const client = new Anthropic({ apiKey: Deno.env.get("ANTHROPIC_API_KEY")! });
  const system = [
    { type: "text" as const, text: SYSTEM },
    { type: "text" as const, text: filesText, cache_control: { type: "ephemeral" as const } },
  ];
  const messages: Anthropic.Beta.BetaMessageParam[] = history.map(h => ({ role: h.role, content: h.text }));
  const out: AiOut = { reply: "", edits: [], problem: null, model: MODEL, inTok: 0, outTok: 0 };
  // Model geçersiz bir old_str verirse hatayı söyleyip en fazla iki kez düzeltmesini ister.
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await client.beta.messages.create({
      model: MODEL, max_tokens: 16000, output_config: { effort: "medium" },
      betas: ["server-side-fallback-2026-07-01"], fallbacks: "default",
      system, tools: [TOOL], tool_choice: { type: "tool", name: TOOL.name }, messages,
    });
    out.inTok += res.usage?.input_tokens ?? 0; out.outTok += res.usage?.output_tokens ?? 0;
    if (res.stop_reason === "refusal") throw new HttpError(422, "Yapay zekâ bu isteği yerine getirmedi. İsteği farklı yazmayı dene.");
    if (res.stop_reason === "max_tokens") throw new HttpError(422, "İstek tek seferde yapılamayacak kadar büyük. Daha küçük parçalara böl.");
    const call = res.content.find(b => b.type === "tool_use") as Anthropic.Beta.BetaToolUseBlock | undefined;
    if (!call) throw new HttpError(502, "Yapay zekâdan beklenen yanıt gelmedi. Tekrar dene.");
    const input = call.input as { reply?: unknown; edits?: unknown };
    out.reply = typeof input.reply === "string" ? input.reply : "";
    out.edits = cleanEdits(input.edits);
    out.problem = checkEdits(out.edits, files);
    if (!out.problem) break;
    messages.push({ role: "assistant", content: res.content });
    messages.push({ role: "user", content: [{ type: "tool_result", tool_use_id: call.id, is_error: true, content: `Öneri uygulanamadı: ${out.problem} Düzeltip propose_edits'i tekrar çağır.` }] });
  }
  return out;
}

// Hızlı mod: modele sayfanın tamamı yerine yalnızca düzenlenebilir metinlerin numaralı listesi gider
// (paneldeki "Metinleri düzenle" ile aynı yöntem). Model "şu numaralı metnin yeni hâli" der; değişiklik kaynakta birebir uygulanır.
type Block = { id: string; file: string; tag: string; key: string; n: number; plain: boolean; value: string; section: string };
const BLOCK_TAGS = "h1,h2,h3,h4,p,li,summary,small,span,a,time,b,label,figcaption,blockquote,dt,dd";
const escHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
function blocksOf(file: string, src: string, prefix: string): Block[] {
  const { document } = parseHTML(src);
  const cands = [...document.querySelectorAll(BLOCK_TAGS)].filter((el: Element) =>
    !el.closest("script,style,svg,noscript,template,select,button") && (el.textContent || "").trim().length > 1);
  const set = new Set(cands);
  const out: Block[] = [];
  for (const el of cands as Element[]) {
    if ([...el.querySelectorAll(BLOCK_TAGS)].some(c => set.has(c))) continue;
    const tag = el.tagName.toLowerCase(), inner = el.innerHTML, key = `>${inner}</${tag}>`;
    const n = count(src, key);
    if (!n || out.some(b => b.key === key)) continue;
    const sec = el.closest("section,header,nav,main");
    const section = el.closest("footer") ? "Alt bilgi" : (sec?.querySelector("h2")?.textContent || "").trim() || (sec && /HEADER|NAV/.test(sec.tagName) ? "Üst menü" : "Giriş");
    const plain = el.children.length === 0;
    out.push({ id: prefix + out.length, file, tag, key, n, plain, value: plain ? (el.textContent || "") : inner, section });
  }
  return out;
}
function blocksText(blocks: Block[]) {
  let cur = "", s = "";
  for (const b of blocks) {
    const head = `${b.file === "index.html" ? "TÜRKÇE SAYFA" : "İNGİLİZCE SAYFA"} — ${b.section}`;
    if (head !== cur) { s += `\n## ${head}\n`; cur = head; }
    s += `[${b.id}] ${b.plain ? "" : "(HTML) "}${b.value.replace(/\s+/g, " ").trim()}\n`;
  }
  return s;
}
const GEMINI_RULES = `\n\nBu modda sana sayfaların kendisi değil, düzenlenebilir metinlerin numaralı listesi verilir. Her satır "[kimlik] metin" biçimindedir; t ile başlayanlar Türkçe, e ile başlayanlar İngilizce sayfadadır. "(HTML)" işaretli satırlarda metin içinde etiket vardır; bunları değiştirirken etiketleri koru. Değişiklik için changes dizisine {id, text} yaz: text, o satırın yeni tam hâlidir. Listede olmayan bir şey (yeni bölüm, geleneksel projeler/takvim kartları gibi kodla üretilen içerik) istenirse changes boş kalsın ve reply'da bunun "Metinleri düzenle" sekmesinden ya da yöneticiden yapılması gerektiğini söyle. Yanıtı yalnızca {reply, changes} JSON'u olarak ver.`;

async function runGemini(history: { role: "user" | "assistant"; text: string }[], files: Record<string, string>): Promise<AiOut> {
  const model = Deno.env.get("GEMINI_MODEL") || "gemini-3.8-flash";
  const blocks = [...blocksOf("index.html", files["index.html"], "t"), ...blocksOf("en/index.html", files["en/index.html"], "e")];
  const byId = new Map(blocks.map(b => [b.id, b]));
  const listText = blocksText(blocks);
  const contents = history.map(h => ({ role: h.role === "assistant" ? "model" : "user", parts: [{ text: h.text }] }));
  const schema = {
    type: "OBJECT",
    properties: {
      reply: { type: "STRING" },
      changes: { type: "ARRAY", items: { type: "OBJECT", properties: { id: { type: "STRING" }, text: { type: "STRING" } }, required: ["id", "text"] } },
    },
    required: ["reply", "changes"],
  };
  const toEdits = (changes: unknown): { edits: Edit[]; bad: string | null } => {
    const edits: Edit[] = [];
    for (const c of Array.isArray(changes) ? changes as { id?: string; text?: string }[] : []) {
      const b = byId.get(String(c?.id ?? "").replace(/[\[\]\s]/g, ""));
      if (!b) return { edits: [], bad: `"${c?.id}" kimlikli bir metin yok; yalnızca listedeki kimlikleri kullan.` };
      if (typeof c.text !== "string") continue;
      const inner = b.plain ? escHtml(c.text) : c.text;
      const new_str = `>${inner}</${b.tag}>`;
      if (new_str !== b.key) edits.push({ file: b.file, old_str: b.key, new_str, ...(b.n > 1 ? { all: true } : {}) });
    }
    return { edits, bad: null };
  };
  const out: AiOut = { reply: "", edits: [], problem: null, model, inTok: 0, outTok: 0 };
  const key = Deno.env.get("GEMINI_API_KEY")!;
  const BASE = "https://generativelanguage.googleapis.com/v1beta";
  const sleep = (ms: number) => new Promise(res => setTimeout(res, ms));
  // Yedek modeller: hesabın erişebildiği, generateContent destekleyen diğer "flash" modelleri (en yeni önce).
  let backups: string[] | null = null;
  const loadBackups = async () => {
    if (backups) return backups;
    try {
      const lj = await (await fetch(`${BASE}/models?pageSize=200`, { headers: { "x-goog-api-key": key } })).json();
      backups = ((lj.models ?? []) as { name: string; supportedGenerationMethods?: string[] }[])
        .filter(m => /flash/i.test(m.name) && !/image|tts|audio|live|embed|thinking-exp/i.test(m.name) && (m.supportedGenerationMethods ?? []).includes("generateContent"))
        .map(m => m.name.replace(/^models\//, "")).filter(n => n !== model).sort().reverse().slice(0, 3);
    } catch { backups = []; }
    return backups;
  };
  // Yoğunlukta (503) ve dakikalık sınırda (429) kısa beklemelerle tekrar dener, olmazsa yedek modele geçer.
  const call = async (body: string) => {
    const tries = [out.model, out.model, out.model];
    let last = { status: 0, j: {} as Record<string, unknown> };
    for (let i = 0; i < 6; i++) {
      const m = tries[i] ?? (await loadBackups())[i - tries.length];
      if (!m) break;
      const r = await fetch(`${BASE}/models/${m}:generateContent`, { method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": key }, body });
      const j = await r.json().catch(() => ({}));
      if (r.ok) { out.model = m; return j; }
      console.error("Gemini API hatası", m, r.status, JSON.stringify(j).slice(0, 400));
      last = { status: r.status, j };
      if (![429, 500, 503, 404].includes(r.status)) break;
      if (r.status === 404 && i < tries.length) { i = tries.length - 1; continue; } // model yoksa doğrudan yedeklere geç
      if (i < tries.length - 1) await sleep(700 * (i + 1));
    }
    throw new HttpError(502, last.status === 429 ? "Yapay zekânın ücretsiz kullanım sınırı doldu. Biraz sonra tekrar dene ya da \"Metinleri düzenle\" sekmesini kullan."
      : last.status === 503 || last.status === 500 ? "Yapay zekâ servisi şu an çok yoğun. Birkaç dakika sonra tekrar dene ya da \"Metinleri düzenle\" sekmesini kullan."
      : last.status === 401 || last.status === 403 || /api key/i.test(JSON.stringify(last.j)) ? "Yapay zekâ anahtarı (GEMINI_API_KEY) geçersiz. Yöneticiye haber ver."
      : "Yapay zekâ servisine ulaşılamadı. Tekrar dene.");
  };
  for (let attempt = 0; attempt < 3; attempt++) {
    const j = await call(JSON.stringify({
      systemInstruction: { parts: [{ text: SYSTEM + GEMINI_RULES }, { text: listText }] },
      contents,
      generationConfig: { responseMimeType: "application/json", responseSchema: schema, temperature: 0.2, maxOutputTokens: 4096 },
    }));
    out.inTok += j.usageMetadata?.promptTokenCount ?? 0; out.outTok += j.usageMetadata?.candidatesTokenCount ?? 0;
    const text = (j.candidates?.[0]?.content?.parts ?? []).map((p: { text?: string }) => p.text || "").join("");
    let parsed: { reply?: unknown; changes?: unknown } = {};
    try { parsed = JSON.parse(text); } catch { /* aşağıda hata olarak döner */ }
    out.reply = typeof parsed.reply === "string" ? parsed.reply : "";
    const { edits, bad } = toEdits(parsed.changes);
    out.edits = edits;
    out.problem = !text || out.reply === "" ? "Yapay zekâdan okunabilir bir yanıt gelmedi." : bad || checkEdits(out.edits, files, 60);
    if (!out.problem) break;
    contents.push({ role: "model", parts: [{ text: text || "{}" }] });
    contents.push({ role: "user", parts: [{ text: `Öneri uygulanamadı: ${out.problem} Düzeltip aynı JSON biçiminde tekrar yanıt ver.` }] });
  }
  return out;
}

// Doğrudan düzenleyici: görevlinin panelde düzelttiği metinler yapay zekâsız, doğrudan yayınlanır.
async function directPublish(user: { id: string; full_name: string }, body: Record<string, unknown>) {
  const raw = Array.isArray(body.edits) ? body.edits as Edit[] : [];
  const edits: Edit[] = raw.filter(e => e && typeof e.file === "string" && typeof e.old_str === "string" && typeof e.new_str === "string")
    .map(e => ({ file: e.file, old_str: e.old_str, new_str: e.new_str, ...(e.all ? { all: true } : {}) }));
  if (!edits.length) throw new HttpError(400, "Yayınlanacak bir değişiklik yok.");
  const files: Record<string, string> = {};
  for (const f of FILES) files[f] = (await readFile(f)).text;
  const problem = checkEdits(edits, files, 60);
  if (problem) throw new HttpError(409, problem.replace(/old_str[^.]*\./, "metin sitede bulunamadı; sayfayı yenileyip yeniden dene."));
  const note = String(body.note ?? "").trim().slice(0, 500);
  const { data, error } = await admin().from("site_edits").insert({
    session_id: crypto.randomUUID(), user_id: user.id, user_name: user.full_name,
    prompt: `Doğrudan düzenleme (${edits.length} metin)${note ? ": " + note : ""}`,
    reply: note || null, edits, status: "onerildi", model: "dogrudan",
  }).select().single();
  if (error) throw new HttpError(500, "Kayıt yazılamadı: " + error.message);
  return await publish(data.id);
}

async function propose(user: { id: string; full_name: string }, prompt: string, sessionId: string) {
  const db = admin();
  const since = new Date(Date.now() - 864e5).toISOString();
  const { count: used } = await db.from("site_edits").select("id", { count: "exact", head: true }).eq("user_id", user.id).gte("created_at", since).is("revert_of", null).neq("model", "dogrudan");
  if ((used ?? 0) >= DAILY_LIMIT) throw new HttpError(429, `Son 24 saatte ${DAILY_LIMIT} istek sınırına ulaştın. Yarın tekrar dene.`);

  const files: Record<string, string> = {};
  for (const f of FILES) files[f] = (await readFile(f)).text;

  // Aynı sohbetteki önceki istekler bağlam olarak verilir.
  const { data: prev } = await db.from("site_edits").select("prompt, reply, status").eq("session_id", sessionId).order("created_at").limit(20);
  const STATUS: Record<string, string> = { onerildi: "öneri bekliyor", yayinlandi: "yayınlandı", reddedildi: "görevli reddetti", hata: "hata", yanit: "değişiklik önerilmedi" };
  const history: { role: "user" | "assistant"; text: string }[] = [];
  for (const r of (prev ?? []).slice(-8)) {
    history.push({ role: "user", text: r.prompt });
    history.push({ role: "assistant", text: `${r.reply || "(yanıt yok)"}\n[Durum: ${STATUS[r.status] || r.status}]` });
  }
  history.push({ role: "user", text: prompt });
  const filesText = FILES.map(f => `<file name="${f}">\n${forModel(files[f])}\n</file>`).join("\n\n");

  const provider = aiProvider();
  if (!provider) throw new HttpError(503, "Yapay zekâ anahtarı tanımlı değil. \"Metinleri düzenle\" sekmesinden doğrudan düzenleyebilirsin.");
  const out = provider === "gemini" ? await runGemini(history, files) : await runClaude(history, filesText, files);

  const row = {
    session_id: sessionId, user_id: user.id, user_name: user.full_name, prompt, reply: out.reply,
    edits: out.problem ? [] : out.edits, status: out.problem ? "hata" : out.edits.length ? "onerildi" : "yanit",
    error: out.problem, model: out.model, input_tokens: out.inTok, output_tokens: out.outTok,
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
  const edits = (row.edits as Edit[]).map(e => ({ file: e.file, old_str: e.new_str, new_str: e.old_str, ...(e.all ? { all: true } : {}) }));
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
      case "status": return json({ ai: aiProvider() });
      case "direct": return json({ row: await directPublish(user, body) });
      case "publish": return json({ row: await publish(id) });
      case "reject": return json({ row: await reject(id) });
      case "revert": return json({ row: await revert(user, id) });
      default: throw new HttpError(400, "Bilinmeyen işlem.");
    }
  } catch (err) {
    if (err instanceof HttpError) return json({ error: err.message }, err.status);
    if (err instanceof Anthropic.APIError) {
      console.error("Anthropic API hatası", err.status, err.message);
      const msg = err.status === 429 ? "Yapay zekâ servisi şu an yoğun. Bir dakika sonra tekrar dene."
        : err.status === 401 || err.status === 403 ? "Yapay zekâ anahtarı (ANTHROPIC_API_KEY) geçersiz. Yöneticiye haber ver."
        : err.status === 400 && /credit|balance/i.test(err.message) ? "Yapay zekâ hesabında kredi kalmamış. Yöneticiye haber ver."
        : "Yapay zekâ servisine ulaşılamadı. Tekrar dene.";
      return json({ error: msg }, 502);
    }
    console.error("Beklenmeyen hata", err);
    return json({ error: "Beklenmeyen bir hata oluştu. Tekrar dene." }, 500);
  }
});
