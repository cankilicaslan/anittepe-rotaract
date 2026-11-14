// Supabase Edge Function: caption
// Instagram açıklaması (caption) üretir. Yalnızca aktif "pr" veya "baskan" rolündeki üyeler çağırabilir.
//
// POST ${SUPABASE_URL}/functions/v1/caption
// Header: Authorization: Bearer <kullanıcının access token'ı>
// Body:   { type, term_no, club_no, ocakbasi_no, summary, date, hybridhub? }
// Yanıt:  200 { caption, source: "ai" }   |   4xx/5xx { error: "<Türkçe mesaj>" }
//
// Gerekli secret: ANTHROPIC_API_KEY  (SUPABASE_URL ve SUPABASE_ANON_KEY Supabase tarafından otomatik verilir)

import Anthropic from "npm:@anthropic-ai/sdk";
import { createClient } from "npm:@supabase/supabase-js@2";

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

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

// Çağıranın JWT'sini doğrular; aktif ve pr/baskan rolünde değilse hata fırlatır.
async function requirePrOrBaskan(req: Request) {
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
    .select("id, status, roles")
    .eq("id", userData.user.id)
    .maybeSingle();
  if (profErr || !profile) {
    throw new HttpError(403, "Üye profiliniz bulunamadı.");
  }
  const roles: string[] = profile.roles ?? [];
  if (profile.status !== "active" || !(roles.includes("pr") || roles.includes("baskan"))) {
    throw new HttpError(403, "Bu işlem için Halkla İlişkiler veya Başkan yetkisi gerekiyor.");
  }
  return { user: userData.user, profile };
}

const SYSTEM_PROMPT = `Sen Ankara Anıttepe Rotaract Kulübü'nün Instagram hesabı için açıklama (caption) yazan bir metin yazarısın.

Kulüp hakkında: Ankara'da gençlerden oluşan, Rotary'ye bağlı bir gönüllülük ve liderlik kulübü. Üyeler iki haftada bir perşembe akşamı toplanır, hizmet projeleri, etkinlikler ve "Ocakbaşı" adını verdiğimiz samimi sohbet buluşmaları düzenler.

Görevin: Açıklamanın açılış cümlesi ve hashtag'leri hazır. Sen yalnızca açılıştan sonra gelecek TEK paragrafı yazarsın.

Yazım kuralları:
- Türkçe yaz. Sıcak, samimi, içten bir ton kullan; kurumsal ve abartılı olma.
- Tek paragraf, 2 ile 4 cümle, toplam 25 ile 55 kelime.
- Üyenin yazdığı notlar ham bilgidir, çoğu zaman kısa ve dağınıktır. Notları olduğu gibi kopyalama ya da madde madde sıralama: içindeki bilgileri koruyarak yaratıcı, akıcı ve canlı cümlelerle yeniden kur; cümle yapılarını çeşitlendir. Yaratıcılık anlatımda olsun, bilgide değil: notlarda olmayan kişi, sayı, yer veya olay ekleme.
- "Ocakbaşı", kulübümüzün bir üyenin evinde yaptığı samimi sohbet buluşmasının adıdır; gerçek bir ocakbaşı, mangal ya da restoran değildir. Ocakbaşı gönderilerinde ateş, ızgara, mangal, kebap, ocak, sofra gibi kelimelerin gerçek anlamını çağrıştırma; notlarda geçmiyorsa yemekten söz etme. Ev sahibinden söz etmen gerekirse "…'nın sıcacık sofrasında" gibi ifadeler değil, yalnızca "…'nın ev sahipliğinde" kalıbını kullan.
- Açılış cümlesindeki bilgileri (toplantı numarası, tarih, mekân, başlık, ev sahibi) tekrar etme.
- Not verilmediyse yalnızca türe uygun, bilgi uydurmayan tek bir sıcak cümle yaz.
- Uzun tire (—) ve kısa tire (–) kullanma.
- Klişelerden kaçın: "unutulmaz bir gün", "dolu dolu", "harika bir etkinlik", "birlikte daha güçlüyüz", "kelimeler yetersiz" gibi kalıpları kullanma.
- En fazla 1 emoji, yalnızca içerikle gerçekten ilgiliyse.
- Hashtag, başlık, tırnak işareti ya da "İşte paragraf:" gibi giriş yazma. Yalnızca paragrafın kendisini yaz.`;

const TYPE_LABELS: Record<string, string> = {
  toplanti: "Kulüp toplantısı",
  ocakbasi: "Ocakbaşı buluşması",
  proje: "Hizmet projesi",
  etkinlik: "Etkinlik",
};

const TAGS = "#Rotaract #AnıttepeRotaract #Bölge2430 #RotaractAnkara";

function toInt(v: unknown): number | null {
  const n = typeof v === "string" ? parseInt(v, 10) : typeof v === "number" ? Math.trunc(v) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
}

function formatDateTr(value: unknown): string | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}/.test(value)) return null;
  const d = new Date(value.slice(0, 10) + "T12:00:00Z");
  if (isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat("tr-TR", {
    day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Istanbul",
  }).format(d);
}

// Paneldeki özet "Başlık: …", "Ev sahibi: …", "Kısa açıklama: …" satırlarını içerebilir.
function parseSummary(summary: string) {
  const pick = (label: string) => (summary.match(new RegExp(`^${label}:\\s*(.+)$`, "m")) || [])[1]?.trim() || "";
  const title = pick("Başlık");
  const host = pick("Ev sahibi");
  const notes = summary
    .replace(/^Başlık:.*$/m, "")
    .replace(/^Ev sahibi:.*$/m, "")
    .replace(/^Kısa açıklama:\s*/m, "")
    .trim();
  return { title, host, notes };
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

// Açılış cümlesi her zaman aynı kalıpla, koddan gelir.
function buildOpening(body: Record<string, unknown>, title: string, host: string): string {
  const type = String(body.type ?? "");
  const termNo = toInt(body.term_no);
  const clubNo = toInt(body.club_no);
  const ocakNo = toInt(body.ocakbasi_no);
  const dateTr = formatDateTr(body.date);
  const when = dateTr ? `, ${dateTr} tarihinde` : "";
  if (type === "toplanti") {
    const hub = body.hybridhub === true ? " HybridHub’da (@hybridhub.tr)" : "";
    return `Dönemimizin ${termNo ?? "?"}. ve kulübümüzün ${clubNo ?? "?"}. toplantısı${when}${hub} gerçekleşti.`;
  }
  if (type === "ocakbasi") {
    return `Dönemimizin ${ocakNo ?? "?"}. Ocakbaşı buluşması${when}${host ? ` ${genitive(host)} ev sahipliğinde` : ""} gerçekleşti.`;
  }
  const kind = type === "proje" ? "projemiz" : "etkinliğimiz";
  const name = title ? `${title} ${kind}` : kind.charAt(0).toUpperCase() + kind.slice(1);
  return `${name}${when} gerçekleşti.`;
}

function buildUserPrompt(body: Record<string, unknown>, opening: string, notes: string): string {
  const type = String(body.type ?? "");
  return [
    `Gönderi türü: ${TYPE_LABELS[type] ?? type}`,
    `Hazır açılış cümlesi (tekrar etme): ${opening}`,
    notes
      ? `Üyenin notları (ham bilgi; kopyalama, bu bilgilerle yaratıcı ve akıcı cümleler kur):\n${notes}`
      : "Not verilmedi.",
    "",
    "Açılıştan sonra gelecek tek paragrafı yaz.",
  ].join("\n");
}

function cleanCaption(text: string): string {
  return text
    .replace(/\s*[—–]\s*/g, ", ")   // uzun/kısa tireleri temizle (güvenlik ağı)
    .replace(/^["“”']+|["“”']+$/g, "")
    .trim();
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  if (req.method !== "POST") return json({ error: "Yalnızca POST desteklenir." }, 405);

  try {
    await requirePrOrBaskan(req);

    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      throw new HttpError(400, "İstek gövdesi geçerli bir JSON değil.");
    }
    if (!body || typeof body !== "object" || !TYPE_LABELS[String(body.type)]) {
      throw new HttpError(400, "Geçersiz gönderi türü. (toplanti, ocakbasi, proje, etkinlik)");
    }

    const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!apiKey) throw new HttpError(500, "Yapay zekâ anahtarı (ANTHROPIC_API_KEY) tanımlı değil.");

    const { title, host, notes } = parseSummary(typeof body.summary === "string" ? body.summary.trim().slice(0, 3000) : "");
    const opening = buildOpening(body, title, host);

    const client = new Anthropic({ apiKey });
    const response = await client.beta.messages.create({
      model: "claude-opus-5-5",
      max_tokens: 8000,
      output_config: { effort: "low" },
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: buildUserPrompt(body, opening, notes) }],
    });

    if (response.stop_reason === "refusal") {
      throw new HttpError(422, "Yapay zekâ bu içerik için açıklama yazmadı. Özeti değiştirip tekrar deneyin veya şablonu kullanın.");
    }

    const text = response.content
      .filter((b) => b.type === "text")
      .map((b) => (b as { type: "text"; text: string }).text)
      .join("")
      .trim();
    if (!text) throw new HttpError(502, "Yapay zekâdan boş yanıt geldi. Lütfen tekrar deneyin.");

    const tags = TAGS + (body.type === "ocakbasi" ? " #Ocakbaşı" : "");
    return json({ caption: [opening, cleanCaption(text), tags].join("\n\n"), source: "ai" });
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
