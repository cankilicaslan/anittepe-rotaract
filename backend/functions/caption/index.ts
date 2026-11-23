// Supabase Edge Function: caption
// Instagram açıklaması (caption) üretir. Yalnızca aktif "pr" veya "baskan" rolündeki üyeler çağırabilir.
//
// POST ${SUPABASE_URL}/functions/v1/caption
// Header: Authorization: Bearer <kullanıcının access token'ı>
// Body:   { type, term_no, club_no, ocakbasi_no, summary, date, hybridhub? }
// Biçim:  Türkçe paragraflar + kapanış, "______", 🇬🇧EN🇬🇧, İngilizce paragraflar + kapanış. @ etiketlerini panel ekler (uye/js/ig-tags.js).
// Yanıt:  200 { caption, source: "ai" }   |   4xx/5xx { error: "<Türkçe mesaj>" }
//
// Gerekli secret: ANTHROPIC_API_KEY  (SUPABASE_URL ve SUPABASE_ANON_KEY Supabase tarafından otomatik verilir)

import Anthropic from "npm:@anthropic-ai/sdk@1.8.0";
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
  const { data: isAdmin } = await supabase.rpc("is_admin");
  if (profile.status !== "active" || !(roles.includes("pr") || isAdmin === true)) {
    throw new HttpError(403, "Bu işlem için Halkla İlişkiler veya Başkan yetkisi gerekiyor.");
  }
  return { user: userData.user, profile };
}

const SYSTEM_PROMPT = `Sen Ankara Anıttepe Rotaract Kulübü'nün Instagram hesabı için açıklama (caption) yazan bir metin yazarısın.

Kulüp hakkında: Ankara'da gençlerden oluşan, Rotary'ye bağlı bir gönüllülük ve liderlik kulübü. Üyeler iki haftada bir perşembe akşamı toplanır, hizmet projeleri, etkinlikler ve "Ocakbaşı" adını verdiğimiz samimi sohbet buluşmaları düzenler.

Görevin: Gönderinin Türkçe metnini ve onun İngilizce karşılığını yazmak. Türkçe açılış cümlesi ve iki dildeki kapanış cümleleri koddan gelir; onları sen yazmazsın.

Biçim: Önce Türkçe paragraflar, sonra tek başına bir satırda ===EN===, sonra İngilizce paragraflar. Paragrafları boş satırla ayır. Başka hiçbir şey yazma.

Türkçe bölüm (hazır açılış cümlesinden sonra gelecek):
- 1 ile 3 kısa paragraf, her biri 1 ile 2 cümle, toplam en fazla 90 kelime. Not azsa az yaz.
- Kulüp adına, birinci çoğul kişiyle (gerçekleştirdik, değerlendirdik, paylaştık), ölçülü, içten ve kurumsal bir dille yaz. Örnek üslup: "Toplantımızda, kulübümüzün kuruluşunun 30. yıl dönümünü kutlayarak 30 yıllık hizmet ve dostluk yolculuğumuzun gururunu paylaştık. Ayrıca önümüzdeki süreçte gerçekleştireceğimiz çalışmaları değerlendirdik."
- Üye alımı, ziyaret ya da tören gibi özel bir konu varsa ona ayrı bir paragraf ayır; uygunsa son paragrafta kısa bir teşekkür, hoş geldin ya da temenni yaz.
- Notlar ham bilgidir: kopyalama, bilgileri koruyarak akıcı cümlelerle yeniden kur. Notlarda olmayan kişi, sayı, yer veya olay ekleme.
- Açılış cümlesindeki bilgileri (toplantı numaraları, tarih, yer, ev sahibi) tekrar etme.
- Not verilmediyse türe uygun, bilgi uydurmayan tek bir cümle yaz.

İngilizce bölüm:
- Sana "Hazır İngilizce açılış" verildiyse o cümleyi yazma, ondan sonrasını yaz. Verilmediyse ilk paragrafta Türkçe açılış cümlesinin İngilizcesini yaz.
- Türkçe paragrafların sırasını ve içeriğini koruyan doğal bir çeviri olsun; yeni bilgi ekleme.
- Terimler: kulüp adları "X Rotaract Club", dönem "term", asbaşkan "vice president", üye alım töreni "new member induction ceremony", "Ocakbaşı" özel ad olarak kalır.

Ortak kurallar:
- Kişi adlarını notlarda geçtiği gibi, adı ve soyadıyla tam yaz. Başka Rotaract kulüplerinin adını her birinde ayrı ayrı ve tam yaz: Türkçede "Çankaya Rotaract Kulübü", İngilizcede "Çankaya Rotaract Club". "Çankaya ve Kızılay Rotaract kulüpleri" gibi birleştirme, "Rotaract Club of X" yazma.
- @ ile kullanıcı adı yazma; etiketler sonradan eklenir. Notlarda @ ya da parantez içinde hesap varsa metne alma.
- Hashtag, emoji, başlık, tırnak içine alma ya da "İşte metin:" gibi giriş yazma.
- Uzun tire (—) ve kısa tire (–) kullanma.
- Klişelerden kaçın: "unutulmaz bir gün", "dolu dolu", "harika bir etkinlik", "birlikte daha güçlüyüz", "kelimeler yetersiz".
- "Ocakbaşı", kulübümüzün bir üyenin evinde yaptığı samimi sohbet buluşmasının adıdır; gerçek bir ocakbaşı, mangal ya da restoran değildir. Ateş, ızgara, mangal, kebap gibi kelimelerin gerçek anlamını çağrıştırma; notlarda geçmiyorsa yemekten söz etme.
- Ev sahibinden söz etmen gerekirse yalnızca sana verilen hazır "Ev sahipliği ifadesi"ni aynen kullan.`;

const TYPE_LABELS: Record<string, string> = {
  toplanti: "Kulüp toplantısı",
  ocakbasi: "Ocakbaşı buluşması",
  proje: "Hizmet projesi",
  etkinlik: "Etkinlik",
};

const CLOSE_TR = "30 yıldır hizmet yoluyla dostluk.";
const CLOSE_EN = "30 Years of Fellowship Through Service.";

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

const ordinal = (n: number) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] ?? "th"}`;

// Açılış cümleleri her zaman aynı kalıpla, koddan gelir. Proje ve etkinlikte İngilizce açılışı (başlık çevirisi gerektiği için) yapay zekâ yazar.
function buildOpening(body: Record<string, unknown>, title: string, host: string): { tr: string; en: string } {
  const type = String(body.type ?? "");
  const termNo = toInt(body.term_no), clubNo = toInt(body.club_no), ocakNo = toInt(body.ocakbasi_no);
  const dateTr = formatDateTr(body.date);
  const when = dateTr ? `${dateTr} tarihinde ` : "";
  if (type === "toplanti") {
    const hub = body.hybridhub === true;
    return {
      tr: `Ankara Anıttepe Rotaract Kulübü olarak ${clubNo ?? "?"}. kulüp toplantımızı, dönemimizin ${termNo ?? "?"}. toplantısını ${hub ? "HybridHub’da (@hybridhub.tr) " : ""}gerçekleştirdik.`,
      en: `Ankara Anıttepe Rotaract Club held its ${clubNo ? ordinal(clubNo) : "?"} club meeting${hub ? " at HybridHub (@hybridhub.tr)" : ""}, marking the ${termNo ? ordinal(termNo) : "?"} meeting of the term.`,
    };
  }
  if (type === "ocakbasi") {
    return {
      tr: `Ankara Anıttepe Rotaract Kulübü olarak dönemimizin ${ocakNo ?? "?"}. Ocakbaşı buluşmasını ${host ? `${genitive(host)} ev sahipliğinde ` : ""}gerçekleştirdik.`,
      en: `Ankara Anıttepe Rotaract Club held the ${ocakNo ? ordinal(ocakNo) : "?"} Ocakbaşı gathering of the term${host ? `, hosted by ${host}` : ""}.`,
    };
  }
  const kind = type === "proje" ? "projemizi" : "etkinliğimizi";
  return { tr: `Ankara Anıttepe Rotaract Kulübü olarak ${title ? `${title} ` : ""}${kind} ${when}gerçekleştirdik.`, en: "" };
}

function buildUserPrompt(body: Record<string, unknown>, opening: { tr: string; en: string }, notes: string, title: string, host: string): string {
  const type = String(body.type ?? "");
  const info = [`Gönderi türü: ${TYPE_LABELS[type] ?? type}`];
  if (title) info.push(`Başlık: ${title}`);
  const dateTr = formatDateTr(body.date);
  if (dateTr) info.push(`Tarih: ${dateTr}`);
  if (toInt(body.club_no)) info.push(`Kulüp toplantı numarası: ${toInt(body.club_no)}`);
  if (toInt(body.term_no)) info.push(`Dönem toplantı numarası: ${toInt(body.term_no)}`);
  if (toInt(body.ocakbasi_no)) info.push(`Dönemin kaçıncı Ocakbaşı'sı: ${toInt(body.ocakbasi_no)}`);
  if (host) info.push(`Ev sahipliği ifadesi (gerekirse aynen kullan): "${genitive(host)} ev sahipliğinde"`);
  return [
    ...info,
    `Hazır Türkçe açılış cümlesi (tekrar etme): ${opening.tr}`,
    opening.en ? `Hazır İngilizce açılış (tekrar etme): ${opening.en}` : "Hazır İngilizce açılış yok: İngilizce bölümün ilk paragrafı Türkçe açılışın çevirisi olsun.",
    notes
      ? `Üyenin notları (ham bilgi; kopyalama, bu bilgilerle yaratıcı ve akıcı cümleler kur):\n${notes}`
      : "Not verilmedi.",
    "",
    "Türkçe paragrafları, ===EN=== satırını ve İngilizce paragrafları yaz.",
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
      messages: [{ role: "user", content: buildUserPrompt(body, opening, notes, title, host) }],
    });

    if (response.stop_reason === "refusal") {
      throw new HttpError(422, "Yapay zekâ bu içerik için açıklama yazmadı. Özeti değiştirip tekrar deneyin veya şablonu kullanın.");
    }

    let text = response.content
      .filter((b) => b.type === "text")
      .map((b) => (b as { type: "text"; text: string }).text)
      .join("")
      .trim();
    // Yarıda kesilen ya da boş yanıt yerine notlar kullanılır (Başkan Mektubu yapay zekâsındaki gibi)
    if (response.stop_reason === "max_tokens") { console.error("caption: yanıt max_tokens nedeniyle kesildi"); text = ""; }
    const [rawTr, rawEn = ""] = text.split(/\n*\s*===\s*EN\s*===\s*\n*/);
    const tr = cleanCaption(rawTr ?? ""), en = cleanCaption(rawEn);
    const ok = !!tr && !!en;
    const source = ok ? "ai" : "notlar";
    const trBody = ok ? tr : cleanCaption(notes);
    const caption = [
      opening.tr, trBody, CLOSE_TR, "______", "🇬🇧EN🇬🇧", opening.en || (ok ? "" : `Ankara Anıttepe Rotaract Club carried out its ${title ? `“${title}” ` : ""}${body.type === "proje" ? "project" : "event"}.`), ok ? en : "", CLOSE_EN,
    ].filter(Boolean).join("\n\n");
    return json({ caption, source });
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
