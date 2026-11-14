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

Yazım kuralları:
- Türkçe yaz. Sıcak, samimi, içten bir ton kullan; kurumsal ve abartılı olma.
- Kısa tut: toplam 35 ile 70 kelime arası (hashtag'ler hariç), en fazla 3 kısa paragraf.
- İlk satır güçlü bir kanca olsun: Instagram'da "...devamı" kesiminden önce görünen tek satır budur, tek başına merak uyandırmalı ve yaklaşık 125 karakteri geçmemeli.
- Üyenin yazdığı notlar ham bilgidir, çoğu zaman kısa ve dağınıktır. Notları olduğu gibi kopyalama ya da madde madde sıralama: içindeki her bilgiyi koruyarak yaratıcı, akıcı ve canlı cümlelerle yeniden kur. Ortamı, duyguyu ve anlamı hissettiren bir anlatım kullan; cümle yapılarını çeşitlendir. Yaratıcılık anlatımda olsun, bilgide değil: notlarda olmayan kişi, sayı, yer veya olay ekleme.
- "Başlık:" satırı verilmişse etkinliğin ya da projenin adıdır; metinde doğal bir şekilde geçir.
- Sana verilen somut bilgileri mutlaka ve doğru şekilde kullan (ör. "Dönemimizin 11. ve kulübümüzün 610. toplantısı", tarih, Ocakbaşı numarası). Verilmeyen bilgi, isim, sayı veya olay uydurma.
- Uzun tire (—) ve kısa tire (–) kullanma. Gerekirse virgül, nokta veya iki nokta kullan.
- Klişelerden kaçın: "unutulmaz bir gün", "dolu dolu", "harika bir etkinlik", "birlikte daha güçlüyüz", "kelimeler yetersiz" gibi kalıpları kullanma.
- En fazla 3 emoji, yalnızca içerikle gerçekten ilgiliyse.
- Kısa paragraflar kullan, aralarında boş satır bırak.
- Kısa bir harekete geçirme cümlesiyle bitir (ör. bir sonraki toplantıya davet, yorumlarda düşünce sorma, profildeki bağlantı).
- En sonda ayrı bir satırda 3 ile 5 hashtag: #Rotaract #AnıttepeRotaract #Bölge2430 mutlaka olsun, varsa içerikle ilgili 1-2 tane daha ekle.
- Yalnızca caption metnini yaz. Başlık, açıklama, tırnak işareti veya "İşte caption:" gibi giriş cümleleri ekleme.`;

const TYPE_LABELS: Record<string, string> = {
  toplanti: "Kulüp toplantısı",
  ocakbasi: "Ocakbaşı buluşması",
  proje: "Hizmet projesi",
  etkinlik: "Etkinlik",
};

function toInt(v: unknown): number | null {
  const n = typeof v === "string" ? parseInt(v, 10) : typeof v === "number" ? Math.trunc(v) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
}

function formatDateTr(value: unknown): string | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}/.test(value)) return null;
  const d = new Date(value.slice(0, 10) + "T12:00:00Z");
  if (isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat("tr-TR", {
    day: "numeric", month: "long", year: "numeric", weekday: "long", timeZone: "Europe/Istanbul",
  }).format(d);
}

function buildUserPrompt(body: Record<string, unknown>): string {
  const type = String(body.type ?? "");
  const termNo = toInt(body.term_no);
  const clubNo = toInt(body.club_no);
  const ocakbasiNo = toInt(body.ocakbasi_no);
  const summary = typeof body.summary === "string" ? body.summary.trim().slice(0, 3000) : "";
  const dateTr = formatDateTr(body.date);

  const facts: string[] = [`Gönderi türü: ${TYPE_LABELS[type] ?? type}`];
  if (type === "toplanti" && termNo && clubNo) {
    facts.push(`Bu, dönemimizin ${termNo}. ve kulübümüzün ${clubNo}. toplantısı (metinde bu ifadeyi kullan: "Dönemimizin ${termNo}. ve kulübümüzün ${clubNo}. toplantısı").`);
  } else {
    if (termNo) facts.push(`Dönem toplantı numarası: ${termNo}`);
    if (clubNo) facts.push(`Kulüp toplantı numarası: ${clubNo}`);
  }
  if (type === "ocakbasi" && ocakbasiNo) facts.push(`Bu, ${ocakbasiNo}. Ocakbaşı buluşmamız.`);
  else if (ocakbasiNo) facts.push(`Ocakbaşı numarası: ${ocakbasiNo}`);
  if (dateTr) facts.push(`Tarih: ${dateTr}`);
  if (type === "toplanti" && body.hybridhub === true) {
    facts.push(`Toplantı HybridHub'da yapıldı. Metinde bunu "toplantımızı ${dateTr ? dateTr + " tarihinde " : ""}HybridHub'da" anlamında doğal bir cümleyle söyle ve mekânı @hybridhub.tr etiketiyle an (ör. "HybridHub'da (@hybridhub.tr)").`);
  }
  facts.push(summary
    ? `Üyenin notları (ham bilgi; kopyalama, bu bilgilerle yaratıcı ve akıcı cümleler kur):\n${summary}`
    : "Not verilmedi; yalnızca yukarıdaki bilgileri kullan.");

  return `Aşağıdaki bilgilerle bir Instagram açıklaması yaz.\n\n${facts.join("\n")}`;
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

    const client = new Anthropic({ apiKey });
    const response = await client.beta.messages.create({
      model: "claude-opus-5-5",
      max_tokens: 8000,
      output_config: { effort: "low" },
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: buildUserPrompt(body) }],
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

    return json({ caption: cleanCaption(text), source: "ai" });
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
