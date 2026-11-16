// Supabase Edge Function: letter-ai
// Başkan Mektubu "Neler Yaptık?" bölümü için madde başına tek paragraf yazar.
// Yalnızca Başkan, HİTK veya Kulüp Hizmetleri yetkisi olanlar çağırabilir (letter_editor() RPC).
//
// POST ${SUPABASE_URL}/functions/v1/letter-ai
// Header: Authorization: Bearer <kullanıcının access token'ı>
// Body:   { items: [{ kind, title, label, date, club_no?, term_no?, host?, notes }] }   (en fazla 20)
// Yanıt:  200 { texts: string[] }   |   4xx/5xx { error: "<Türkçe mesaj>" }
//
// Gerekli secret: ANTHROPIC_API_KEY  (SUPABASE_URL ve SUPABASE_ANON_KEY Supabase tarafından otomatik verilir)

import Anthropic from "npm:@anthropic-ai/sdk@1.8.0";
import { createClient } from "npm:@supabase/supabase-js@2";

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const MAX_ITEMS = 20;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json; charset=utf-8" },
  });
}

class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

// Çağıranın JWT'sini doğrular; letter_editor() false dönerse hata fırlatır.
async function requireLetterEditor(req: Request) {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader || !authHeader.toLowerCase().startsWith("bearer ")) {
    throw new HttpError(401, "Oturum bulunamadı. Lütfen tekrar giriş yapın.");
  }
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } }, auth: { persistSession: false } },
  );
  const token = authHeader.slice(7).trim();
  const { data: userData, error: userErr } = await supabase.auth.getUser(token);
  if (userErr || !userData?.user) {
    throw new HttpError(401, "Oturumunuzun süresi dolmuş. Lütfen tekrar giriş yapın.");
  }
  const { data: profile, error: profErr } = await supabase
    .from("profiles")
    .select("id, status")
    .eq("id", userData.user.id)
    .maybeSingle();
  if (profErr || !profile) {
    throw new HttpError(403, "Üye profiliniz bulunamadı.");
  }
  const { data: allowed, error: rpcErr } = await supabase.rpc("letter_editor");
  if (profile.status !== "active" || rpcErr || allowed !== true) {
    throw new HttpError(403, "Bu işlem için Başkan, HİTK veya Kulüp Hizmetleri yetkisi gerekiyor.");
  }
  return { user: userData.user, profile };
}

const SYSTEM_PROMPT = `Sen Ankara Anıttepe Rotaract Kulübü'nün Başkan Mektubu için "Neler Yaptık?" bölümünü yazan bir metin yazarısın.

Kulüp hakkında: Ankara'da gençlerden oluşan, Rotary'ye bağlı bir gönüllülük ve liderlik kulübü. Üyeler iki haftada bir perşembe akşamı toplanır, hizmet projeleri, etkinlikler ve "Ocakbaşı" adını verdiğimiz samimi sohbet buluşmaları düzenler.

Görevin: Sana verilen her madde (toplantı, proje, etkinlik, ocakbaşı) için mektupta yer alacak TEK bir paragraf yazmak.

Yazım kuralları:
- Türkçe yaz. Birinci çoğul şahısla ("biz") anlat. Sıcak ama kurumsal bir ton kullan.
- Her madde için tek paragraf, 50 ile 80 kelime.
- Üyenin yazdığı notlar ham bilgidir, çoğu zaman kısa ve dağınıktır. Notları olduğu gibi kopyalama: içindeki bilgileri koruyarak akıcı cümlelerle yeniden kur. Yaratıcılık anlatımda olsun, bilgide değil: notlarda olmayan kişi, sayı, yer veya olay ekleme.
- Örnek mektup dili: "Kulübümüzün 603., dönemimizin 4. toplantısında bir araya gelerek…", "…büyük bir heyecanla gerçekleştirdik." gibi akıcı, resmî ama içten cümleler kur.
- Toplantılarda, kulüp numarası ve dönem numarası verildiyse paragrafa "Kulübümüzün {kulüp no}., dönemimizin {dönem no}. toplantısı…" kalıbıyla başla. Numaralar verilmediyse numara uydurma.
- "Ocakbaşı", kulübümüzün bir üyenin evinde yaptığı samimi sohbet buluşmasının adıdır; gerçek bir ocakbaşı, mangal ya da restoran değildir. Ocakbaşı maddelerinde ateş, ızgara, mangal, kebap, ocak, sofra gibi kelimelerin gerçek anlamını çağrıştırma; notlarda geçmiyorsa yemekten söz etme. Ev sahibinden söz etmen gerekirse yalnızca maddede verilen hazır "Ev sahipliği ifadesi"ni aynen kullan; başka kalıp ya da ek kullanma.
- Uzun tire (—) ve kısa tire (–) kullanma.
- Hashtag, emoji, başlık, madde işareti ya da "İşte paragraf:" gibi giriş yazma. Yalnızca paragrafın kendisini yaz.

Çıktı biçimi: Her madde için önce kendi satırında "===1===", "===2===" gibi numaralı bir ayraç yaz, ardından o maddenin paragrafını yaz. Madde sayısı kadar ayraç olmalı, sıra girişle aynı olmalı. Ayraçların dışında hiçbir şey yazma.`;

const KIND_LABELS: Record<string, string> = {
  toplanti: "Kulüp toplantısı",
  proje: "Hizmet projesi",
  etkinlik: "Etkinlik",
  ocakbasi: "Ocakbaşı buluşması",
};

type Item = {
  kind: string;
  title: string;
  label: string;
  date: string;
  club_no: number | null;
  term_no: number | null;
  host: string;
  notes: string;
};

function toInt(v: unknown): number | null {
  const n = typeof v === "string" ? parseInt(v, 10) : typeof v === "number" ? Math.trunc(v) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
}

function str(v: unknown, max: number): string {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}

function formatDateTr(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}/.test(value)) return value;
  const d = new Date(value.slice(0, 10) + "T12:00:00Z");
  if (isNaN(d.getTime())) return value;
  return new Intl.DateTimeFormat("tr-TR", {
    day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Istanbul",
  }).format(d);
}

// Özel ada tamlayan eki ekler (Kılıçaslan’ın, Gözüpek’in, Oğuzkurt’un, Ayşe’nin).
function genitive(name: string): string {
  const w = name.trim().split(/\s+/).pop()!.toLocaleLowerCase("tr");
  const vowels = "aıoueiöü";
  const last = [...w].reverse().find((c) => vowels.includes(c)) ?? "e";
  // ince L ile biten adlar (Kemal’in, Hilal’in, Meral’in)
  const soft = ["kemal", "cemal", "celal", "hilal", "bilal", "nihal", "meral", "iclal", "ikbal", "hayal", "cemil"].includes(w);
  const v = soft ? "i" : "aı".includes(last) ? "ı" : "ei".includes(last) ? "i" : "ou".includes(last) ? "u" : "ü";
  return `${name.trim()}’${vowels.includes(w.slice(-1)) ? "n" : ""}${v}n`;
}

function buildUserPrompt(items: Item[]): string {
  const blocks = items.map((it, i) => {
    const lines = [
      `Madde ${i + 1}`,
      `Tür: ${KIND_LABELS[it.kind] ?? it.kind}`,
    ];
    if (it.title) lines.push(`Başlık: ${it.title}`);
    if (it.label) lines.push(`Etiket: ${it.label}`);
    if (it.date) lines.push(`Tarih: ${formatDateTr(it.date)}`);
    if (it.club_no) lines.push(`Kulüp toplantı numarası: ${it.club_no}`);
    if (it.term_no) lines.push(`Dönem toplantı numarası: ${it.term_no}`);
    if (it.host) lines.push(`Ev sahipliği ifadesi (aynen kullan): "${genitive(it.host)} ev sahipliğinde"`);
    lines.push(it.notes ? `Notlar (ham bilgi):\n${it.notes}` : "Notlar: verilmedi (yalnızca türe uygun, bilgi uydurmayan kısa bir paragraf yaz).");
    return lines.join("\n");
  });
  return [
    `Aşağıdaki ${items.length} madde için, her biri tek paragraf olacak şekilde ===1=== ... ===${items.length}=== ayraçlarıyla yanıt ver.`,
    "",
    blocks.join("\n\n"),
  ].join("\n");
}

// "===1=== ... ===2=== ..." biçimindeki yanıtı n paragrafa böler; eksikler '' olur.
export function splitParagraphs(raw: string, n: number): string[] {
  const out: string[] = Array.from({ length: n }, () => "");
  const seen = new Set<number>();
  const re = /^\s*[*_]*\s*={3,}\s*(\d+)\s*={3,}\s*[*_]*\s*$/gm;
  const marks: { num: number; start: number; end: number }[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw)) !== null) {
    marks.push({ num: parseInt(m[1], 10), start: m.index, end: m.index + m[0].length });
  }
  for (let i = 0; i < marks.length; i++) {
    const { num, end } = marks[i];
    if (num < 1 || num > n || seen.has(num)) continue;
    const stop = i + 1 < marks.length ? marks[i + 1].start : raw.length;
    out[num - 1] = raw.slice(end, stop).trim();
    seen.add(num);
  }
  return out;
}

function cleanText(text: string): string {
  return text
    .replace(/\s*[—–]\s*/g, ", ")   // uzun/kısa tireleri temizle (güvenlik ağı)
    .replace(/\s*\n\s*/g, " ")
    .replace(/^["“”']+|["“”']+$/g, "")
    .trim();
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  if (req.method !== "POST") return json({ error: "Yalnızca POST desteklenir." }, 405);

  try {
    await requireLetterEditor(req);

    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      throw new HttpError(400, "İstek gövdesi geçerli bir JSON değil.");
    }
    const rawItems = body && typeof body === "object" ? body.items : null;
    if (!Array.isArray(rawItems) || rawItems.length === 0) {
      throw new HttpError(400, "En az bir madde gönderilmelidir.");
    }
    if (rawItems.length > MAX_ITEMS) {
      throw new HttpError(400, `En fazla ${MAX_ITEMS} madde gönderilebilir.`);
    }

    const items: Item[] = rawItems.map((r) => {
      const o = (r && typeof r === "object" ? r : {}) as Record<string, unknown>;
      return {
        kind: str(o.kind, 20),
        title: str(o.title, 300),
        label: str(o.label, 300),
        date: str(o.date, 40),
        club_no: toInt(o.club_no),
        term_no: toInt(o.term_no),
        host: str(o.host, 200),
        notes: str(o.notes, 3000),
      };
    });
    if (items.some((it) => !KIND_LABELS[it.kind])) {
      throw new HttpError(400, "Geçersiz madde türü. (toplanti, proje, etkinlik, ocakbasi)");
    }

    const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!apiKey) throw new HttpError(500, "Yapay zekâ anahtarı (ANTHROPIC_API_KEY) tanımlı değil.");

    const client = new Anthropic({ apiKey });
    const response = await client.beta.messages.create({
      model: "claude-opus-5-5",
      max_tokens: 12000,
      output_config: { effort: "low" },
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: buildUserPrompt(items) }],
    });

    if (response.stop_reason === "refusal") {
      throw new HttpError(422, "Yapay zekâ bu içerik için metin yazmadı. Notları değiştirip tekrar deneyin.");
    }

    const raw = response.content
      .filter((b) => b.type === "text")
      .map((b) => (b as { type: "text"; text: string }).text)
      .join("")
      .trim();
    if (!raw) throw new HttpError(502, "Yapay zekâdan boş yanıt geldi. Lütfen tekrar deneyin.");

    const parts = splitParagraphs(raw, items.length);
    if (response.stop_reason === "max_tokens") {
      // Kesilmiş son paragraf tamam sayılmasın: notlara düşsün.
      console.error("letter-ai: yanıt max_tokens nedeniyle kesildi");
      let last = parts.length - 1;
      while (last > 0 && !parts[last]) last--;
      if (last >= 0) parts[last] = "";
    }
    const texts = parts.map((p, i) => cleanText(p) || cleanText(items[i].notes));
    return json({ texts });
  } catch (err) {
    if (err instanceof HttpError) return json({ error: err.message }, err.status);
    if (err instanceof Anthropic.APIError) {
      console.error("Anthropic API hatası", err.status, err.message);
      const msg = err.status === 429
        ? "Yapay zekâ servisi şu an yoğun. Bir dakika sonra tekrar deneyin."
        : err.status === 401
        ? "Yapay zekâ anahtarı geçersiz. Yöneticiye haber verin."
        : "Yapay zekâ servisine ulaşılamadı. Lütfen tekrar deneyin.";
      return json({ error: msg }, 502);
    }
    console.error("Beklenmeyen hata", err);
    return json({ error: "Beklenmeyen bir hata oluştu. Lütfen tekrar deneyin." }, 500);
  }
});
