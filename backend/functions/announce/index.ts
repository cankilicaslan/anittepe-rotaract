// Supabase Edge Function: announce
// Seçilen üyelere sunucudan e-posta (Resend) ve/veya SMS (Netgsm ya da Twilio) ile duyuru gönderir
// ve "announcements" tablosuna sent_via = 'sunucu' kaydı ekler.
// Yalnızca aktif "baskan", "sekreter" veya "pr" rolündeki üyeler çağırabilir.
//
// POST ${SUPABASE_URL}/functions/v1/announce
// Header: Authorization: Bearer <kullanıcının access token'ı>
// Body:   { subject, body, recipient_ids: uuid[], channels: ("email"|"sms")[], kind?: "toplanti"|"etkinlik"|"proje"|"diger" }
// Yanıt:  200 {
//           ok,                                   // hiç hata yoksa ve istenen hiçbir kanal atlanmadıysa true
//           email: { sent, failed },              // kişi sayısı
//           sms:   { sent, failed },              // kişi sayısı
//           missing: { email: [ad soyad], phone: [ad soyad] },   // adresi/geçerli numarası olmayanlar
//           skipped: { email?: "<Türkçe neden>", sms?: "<Türkçe neden>" },  // ayarı eksik kanallar
//           errors: [ "<Türkçe hata özeti>" ],
//           announcement_id                       // eklenen announcements satırı (eklenemezse null)
//         }
//         4xx/5xx { ok: false, error: "<Türkçe mesaj>" }
//
// Secret'lar:
//   E-posta (önerilen): GMAIL_APP_PASSWORD (kulüp Gmail'inin uygulama şifresi), GMAIL_USER (isteğe bağlı)
//   E-posta (alternatif): RESEND_API_KEY, RESEND_FROM (ör. "Anıttepe Rotaract <duyuru@anitteperotaract.org>"),
//            RESEND_REPLY_TO (isteğe bağlı)
//   SMS:     SMS_PROVIDER = "netgsm" | "twilio"
//            netgsm: NETGSM_USER, NETGSM_PASS, NETGSM_HEADER
//            twilio: TWILIO_SID, TWILIO_TOKEN, TWILIO_FROM
// (SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY Supabase tarafından otomatik verilir)

import { createClient } from "npm:@supabase/supabase-js@2";

const MAX_RECIPIENTS = 500;
const MAX_SUBJECT = 200;
const MAX_BODY = 10000;
const RESEND_BATCH = 100; // Resend /emails/batch: çağrı başına en fazla 100 e-posta

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

const ALLOWED_ROLES = ["baskan", "sekreter", "pr"];

// Çağıranın JWT'sini doğrular; aktif ve baskan/sekreter/pr rolünde değilse hata fırlatır.
async function requireAnnouncer(req: Request) {
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
    .select("id, status, roles, full_name")
    .eq("id", userData.user.id)
    .maybeSingle();
  if (profErr || !profile) throw new HttpError(403, "Üye profiliniz bulunamadı.");
  const roles: string[] = profile.roles ?? [];
  if (profile.status !== "active" || !roles.some((r) => ALLOWED_ROLES.includes(r))) {
    throw new HttpError(403, "Duyuru göndermek için Başkan, Sekreter veya Halkla İlişkiler yetkisi gerekiyor.");
  }
  return { user: userData.user, profile };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Türkiye cep numarasını 905XXXXXXXXX biçimine getirir; geçersizse null.
export function normalizeTrPhone(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  let d = raw.replace(/\D/g, "");
  if (d.startsWith("00")) d = d.slice(2);
  if (d.length === 10 && d.startsWith("5")) d = "90" + d;
  else if (d.length === 11 && d.startsWith("05")) d = "9" + d;
  return /^905\d{9}$/.test(d) ? d : null;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function emailHtml(subject: string, body: string): string {
  const paragraphs = escapeHtml(body)
    .split(/\n{2,}/)
    .map((p) => `<p style="margin:0 0 14px">${p.replace(/\n/g, "<br>")}</p>`)
    .join("");
  return `<!doctype html><html><body style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.5;color:#222;max-width:600px;margin:0 auto;padding:16px">
<h2 style="font-size:18px;margin:0 0 16px;color:#d41367">${escapeHtml(subject)}</h2>
${paragraphs}
<hr style="border:none;border-top:1px solid #ddd;margin:24px 0 12px">
<p style="font-size:12px;color:#777;margin:0">Ankara Anıttepe Rotaract Kulübü · <a href="https://anitteperotaract.org/" style="color:#777">anitteperotaract.org</a></p>
</body></html>`;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Recipient = { id: string; full_name: string; email: string | null; phone: string | null };
type ChannelResult = { sent: number; failed: number };

// ---------------------------------------------------------------------
// E-posta: Resend. Her alıcıya AYRI e-posta gider (adresler birbirine görünmez);
// /emails/batch ile 100'erli gruplar halinde. (Batch uç noktası Resend dokümanından doğrulandı.)
// ---------------------------------------------------------------------
async function sendEmails(
  list: { name: string; email: string }[],
  subject: string,
  body: string,
  errors: string[],
): Promise<ChannelResult> {
  const apiKey = Deno.env.get("RESEND_API_KEY")!;
  const from = Deno.env.get("RESEND_FROM")!;
  const replyTo = Deno.env.get("RESEND_REPLY_TO") || undefined;
  const html = emailHtml(subject, body);
  const result: ChannelResult = { sent: 0, failed: 0 };

  for (let i = 0; i < list.length; i += RESEND_BATCH) {
    const chunk = list.slice(i, i + RESEND_BATCH);
    const payload = chunk.map((r) => ({
      from,
      to: [r.email],
      subject,
      html,
      text: body,
      ...(replyTo ? { reply_to: replyTo } : {}),
    }));
    try {
      const res = await fetch("https://api.resend.com/emails/batch", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && Array.isArray(data?.data)) {
        result.sent += data.data.length;
        result.failed += Math.max(0, chunk.length - data.data.length);
      } else {
        result.failed += chunk.length;
        console.error("Resend hatası", res.status, JSON.stringify(data));
        const msg = String(data?.message ?? data?.error ?? "");
        if (res.status === 401 || res.status === 403) {
          errors.push(`E-posta gönderilemedi: Resend anahtarı geçersiz veya gönderen adres doğrulanmamış. ${msg}`.trim());
        } else if (res.status === 422) {
          errors.push(`E-posta gönderilemedi: Resend isteği reddetti (gönderen adres/alan adı doğrulanmış mı?). ${msg}`.trim());
        } else if (res.status === 429) {
          errors.push("E-posta gönderimi sınıra takıldı (Resend). Birkaç dakika sonra kalanlara tekrar deneyin.");
        } else {
          errors.push(`E-posta servisine ulaşılamadı (HTTP ${res.status}).`);
        }
      }
    } catch (e) {
      result.failed += chunk.length;
      console.error("Resend bağlantı hatası", e);
      errors.push("E-posta servisine bağlanılamadı.");
    }
    if (i + RESEND_BATCH < list.length) await sleep(600); // varsayılan hız sınırı: saniyede 2 istek
  }
  return result;
}

// ---------------------------------------------------------------------
// SMS: Netgsm (HTTP GET). DOĞRULANMADI: parametreler ve dönüş kodları bilgiye dayanarak yazıldı;
// canlıya almadan önce Netgsm panelindeki API dokümanıyla karşılaştırın.
//   GET https://api.netgsm.com.tr/sms/send/get?usercode=&password=&gsmno=&message=&msgheader=&dil=TR
//   Başarılı yanıt: "00 <görev_id>" (ayrıca "01"/"02" tarih uyarısıyla başarılı sayılır)
//   Hata kodları: 20 mesaj metni/uzunluk, 30 kullanıcı adı/şifre veya API erişim/IP izni,
//                 40 mesaj başlığı (msgheader) tanımlı değil, 50/51 İYS kontrolü, 70 hatalı parametre,
//                 80 gönderim sınırı, 85 mükerrer gönderim sınırı
// Her numaraya ayrı istek atılır (kişi bazında başarı sayımı için).
// ---------------------------------------------------------------------
const NETGSM_ERRORS: Record<string, string> = {
  "20": "mesaj metni hatalı veya çok uzun",
  "30": "kullanıcı adı/şifre hatalı ya da API erişim izni yok (Netgsm panelinde API yetkisi ve IP kısıtını kontrol edin)",
  "40": "mesaj başlığı (NETGSM_HEADER) sistemde tanımlı değil",
  "50": "İYS kontrollü gönderimde hata",
  "51": "İYS marka bilgisi bulunamadı",
  "70": "hatalı veya eksik parametre",
  "80": "gönderim sınırı aşıldı",
  "85": "aynı numaraya mükerrer gönderim sınırı aşıldı",
};

async function sendNetgsm(phone: string, message: string): Promise<{ ok: boolean; error?: string }> {
  const params = new URLSearchParams({
    usercode: Deno.env.get("NETGSM_USER")!,
    password: Deno.env.get("NETGSM_PASS")!,
    gsmno: phone,
    message,
    msgheader: Deno.env.get("NETGSM_HEADER")!,
    dil: "TR", // Türkçe karakterler (ş, ğ, ı...) için; mesaj başına karakter sınırı düşer
  });
  const res = await fetch(`https://api.netgsm.com.tr/sms/send/get?${params.toString()}`);
  const text = (await res.text()).trim();
  const code = text.split(/\s+/)[0] ?? "";
  if (res.ok && ["00", "01", "02"].includes(code)) return { ok: true };
  return { ok: false, error: NETGSM_ERRORS[code] ?? `beklenmeyen yanıt (${text.slice(0, 60) || res.status})` };
}

// Twilio Messages API: POST /2010-04-01/Accounts/{SID}/Messages.json (form: To, From, Body; Basic auth)
async function sendTwilio(phone: string, message: string): Promise<{ ok: boolean; error?: string }> {
  const sid = Deno.env.get("TWILIO_SID")!;
  const token = Deno.env.get("TWILIO_TOKEN")!;
  const form = new URLSearchParams({ To: "+" + phone, From: Deno.env.get("TWILIO_FROM")!, Body: message });
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}/Messages.json`, {
    method: "POST",
    headers: {
      Authorization: "Basic " + btoa(`${sid}:${token}`),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: form.toString(),
  });
  if (res.ok) return { ok: true };
  const data = await res.json().catch(() => ({}));
  return { ok: false, error: `Twilio hatası ${data?.code ?? res.status}: ${data?.message ?? ""}`.trim() };
}

async function sendSms(
  provider: "netgsm" | "twilio",
  list: { name: string; phone: string }[],
  message: string,
  errors: string[],
): Promise<ChannelResult> {
  const result: ChannelResult = { sent: 0, failed: 0 };
  const seen = new Set<string>();
  for (const r of list) {
    try {
      const out = provider === "netgsm" ? await sendNetgsm(r.phone, message) : await sendTwilio(r.phone, message);
      if (out.ok) result.sent++;
      else {
        result.failed++;
        const msg = `SMS gönderilemedi (${provider === "netgsm" ? "Netgsm" : "Twilio"}): ${out.error}`;
        if (!seen.has(msg)) { seen.add(msg); errors.push(msg); }
        // Kimlik/başlık hatası tüm numaralar için aynıdır; boşuna denemeye devam etme.
        if (out.error && /kullanıcı adı|başlığı|20003|21606|21659/.test(out.error)) {
          result.failed += list.length - (result.sent + result.failed);
          break;
        }
      }
    } catch (e) {
      result.failed++;
      console.error("SMS bağlantı hatası", e);
      const msg = "SMS servisine bağlanılamadı.";
      if (!seen.has(msg)) { seen.add(msg); errors.push(msg); }
    }
  }
  return result;
}

function smsConfig(): { provider: "netgsm" | "twilio" } | { skip: string } {
  const provider = (Deno.env.get("SMS_PROVIDER") ?? "").trim().toLowerCase();
  if (!provider) return { skip: "SMS gönderilmedi: SMS servisi ayarlanmamış (SMS_PROVIDER secret'ı yok)." };
  if (provider === "netgsm") {
    const missing = ["NETGSM_USER", "NETGSM_PASS", "NETGSM_HEADER"].filter((k) => !Deno.env.get(k));
    return missing.length ? { skip: `SMS gönderilmedi: Netgsm ayarları eksik (${missing.join(", ")}).` } : { provider };
  }
  if (provider === "twilio") {
    const missing = ["TWILIO_SID", "TWILIO_TOKEN", "TWILIO_FROM"].filter((k) => !Deno.env.get(k));
    return missing.length ? { skip: `SMS gönderilmedi: Twilio ayarları eksik (${missing.join(", ")}).` } : { provider };
  }
  return { skip: `SMS gönderilmedi: SMS_PROVIDER değeri "${provider}" tanınmadı ("netgsm" veya "twilio" olmalı).` };
}

// ---------------------------------------------------------------------
// E-posta: kulübün Gmail hesabı (SMTP, port 465). Her alıcıya ayrı e-posta gider.
// Secret'lar: GMAIL_APP_PASSWORD (zorunlu), GMAIL_USER (varsayılan kulüp adresi), MAIL_FROM_NAME (isteğe bağlı)
// ---------------------------------------------------------------------
const CLUB_GMAIL = "anitteperotaract1996@gmail.com";

async function sendGmail(
  list: { name: string; email: string }[],
  subject: string,
  body: string,
  errors: string[],
): Promise<ChannelResult> {
  const { default: nodemailer } = await import("npm:nodemailer@6.9.16");
  const user = Deno.env.get("GMAIL_USER") || CLUB_GMAIL;
  const transporter = nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 465,
    secure: true,
    auth: { user, pass: (Deno.env.get("GMAIL_APP_PASSWORD") ?? "").replace(/\s+/g, "") },
  });
  const from = `"${Deno.env.get("MAIL_FROM_NAME") || "Anıttepe Rotaract"}" <${user}>`;
  const html = emailHtml(subject, body);
  const result: ChannelResult = { sent: 0, failed: 0 };
  const seen = new Set<string>();
  for (const r of list) {
    try {
      await transporter.sendMail({ from, to: r.email, replyTo: user, subject, text: body, html });
      result.sent++;
    } catch (e) {
      result.failed++;
      const code = (e as { responseCode?: number }).responseCode;
      console.error("Gmail gönderim hatası", r.email, code, String(e));
      const msg = code === 535
        ? "E-posta gönderilemedi: Gmail uygulama şifresi (GMAIL_APP_PASSWORD) kabul edilmedi."
        : `E-posta gönderilemedi (Gmail${code ? " " + code : ""}).`;
      if (!seen.has(msg)) { seen.add(msg); errors.push(msg); }
      if (code === 535) { result.failed += list.length - (result.sent + result.failed); break; }
    }
  }
  transporter.close();
  return result;
}

function emailProvider(): "gmail" | "resend" | null {
  if (Deno.env.get("GMAIL_APP_PASSWORD")) return "gmail";
  if (Deno.env.get("RESEND_API_KEY") && Deno.env.get("RESEND_FROM")) return "resend";
  return null;
}

function emailConfigSkip(): string | null {
  return emailProvider() ? null : "E-posta gönderilmedi: e-posta servisi ayarlanmamış (GMAIL_APP_PASSWORD secret'ı yok).";
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  if (req.method !== "POST") return json({ ok: false, error: "Yalnızca POST desteklenir." }, 405);

  try {
    const { user } = await requireAnnouncer(req);

    let input: Record<string, unknown>;
    try {
      input = await req.json();
    } catch {
      throw new HttpError(400, "İstek gövdesi geçerli bir JSON değil.");
    }

    const subject = typeof input.subject === "string" ? input.subject.trim() : "";
    const body = typeof input.body === "string" ? input.body.trim() : "";
    const kind = ["toplanti", "etkinlik", "proje", "diger"].includes(String(input.kind)) ? String(input.kind) : "diger";
    const channels = Array.isArray(input.channels)
      ? [...new Set(input.channels.map(String).filter((c) => c === "email" || c === "sms"))]
      : [];
    const recipientIds = Array.isArray(input.recipient_ids)
      ? [...new Set(input.recipient_ids.map(String).filter((id) => UUID_RE.test(id)))]
      : [];

    if (!body) throw new HttpError(400, "Duyuru metni boş olamaz.");
    if (channels.includes("email") && !subject) throw new HttpError(400, "E-posta için konu (subject) gerekli.");
    if (subject.length > MAX_SUBJECT) throw new HttpError(400, `Konu en fazla ${MAX_SUBJECT} karakter olabilir.`);
    if (body.length > MAX_BODY) throw new HttpError(400, `Duyuru metni en fazla ${MAX_BODY} karakter olabilir.`);
    if (!channels.length) throw new HttpError(400, "En az bir kanal seçin (e-posta veya SMS).");
    if (!recipientIds.length) throw new HttpError(400, "En az bir alıcı seçin.");
    if (recipientIds.length > MAX_RECIPIENTS) throw new HttpError(400, `Tek seferde en fazla ${MAX_RECIPIENTS} alıcı seçilebilir.`);

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false } },
    );

    const { data: rows, error: recErr } = await admin
      .from("profiles")
      .select("id, full_name, email, phone")
      .in("id", recipientIds);
    if (recErr) {
      console.error("Alıcılar okunamadı", recErr);
      throw new HttpError(500, "Alıcı bilgileri okunamadı.");
    }
    const recipients = (rows ?? []) as Recipient[];

    const errors: string[] = [];
    const skipped: { email?: string; sms?: string } = {};
    const missing = { email: [] as string[], phone: [] as string[] };
    const emailRes: ChannelResult = { sent: 0, failed: 0 };
    let smsRes: ChannelResult = { sent: 0, failed: 0 };

    // ---- E-posta ----
    if (channels.includes("email")) {
      const emailList: { name: string; email: string }[] = [];
      const seen = new Set<string>();
      for (const r of recipients) {
        const e = (r.email ?? "").trim().toLowerCase();
        if (!EMAIL_RE.test(e)) missing.email.push(r.full_name);
        else if (!seen.has(e)) { seen.add(e); emailList.push({ name: r.full_name, email: e }); }
      }
      const skip = emailConfigSkip();
      if (skip) skipped.email = skip;
      else if (emailList.length) {
        const send = emailProvider() === "gmail" ? sendGmail : sendEmails;
        Object.assign(emailRes, await send(emailList, subject, body, errors));
      }
    }

    // ---- SMS ----
    if (channels.includes("sms")) {
      const smsList: { name: string; phone: string }[] = [];
      const seen = new Set<string>();
      for (const r of recipients) {
        const p = normalizeTrPhone(r.phone);
        if (!p) missing.phone.push(r.full_name);
        else if (!seen.has(p)) { seen.add(p); smsList.push({ name: r.full_name, phone: p }); }
      }
      const cfg = smsConfig();
      if ("skip" in cfg) skipped.sms = cfg.skip;
      else if (smsList.length) {
        const text = subject ? `${subject}\n${body}` : body;
        smsRes = await sendSms(cfg.provider, smsList, text, errors);
      }
    }

    const ok = errors.length === 0 && emailRes.failed === 0 && smsRes.failed === 0 && !skipped.email && !skipped.sms;
    const result = { ok, email: emailRes, sms: smsRes, missing, skipped, errors };

    // Kayıt (service role ile; created_by çağıran üye)
    let announcementId: string | null = null;
    const { data: ins, error: insErr } = await admin
      .from("announcements")
      .insert({
        kind,
        subject: subject || null,
        body,
        channels,
        recipient_ids: recipients.map((r) => r.id),
        sent_via: "sunucu",
        result,
        created_by: user.id,
      })
      .select("id")
      .single();
    if (insErr) console.error("Duyuru kaydı eklenemedi", insErr);
    else announcementId = ins.id;

    return json({ ...result, announcement_id: announcementId });
  } catch (err) {
    if (err instanceof HttpError) return json({ ok: false, error: err.message }, err.status);
    console.error("Beklenmeyen hata", err);
    return json({ ok: false, error: "Beklenmeyen bir hata oluştu. Lütfen tekrar deneyin." }, 500);
  }
});
