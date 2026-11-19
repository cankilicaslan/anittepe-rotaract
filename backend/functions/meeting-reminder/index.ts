// Supabase Edge Function: meeting-reminder
// Her sabah zamanlayıcı (pg_cron) çağırır. 6 gün sonra yapılacak toplantı varsa, Yoklama'daki WhatsApp
// toplantı duyurusunun aynısını kulüp Gmail'inden tüm aktif üyelere ve e-postası kayıtlı misafirlere gönderir.
//
// Güvenlik: kimlik istemez; ama her toplantı için yalnızca bir kez gönderir (reminder_log: kind = "meeting:<id>").
// Yanıtta kişisel bilgi döndürülmez (yalnızca sayılar).
// Deneme: { "dry": true, "date": "YYYY-MM-DD" } → mail göndermeden o tarihli toplantı için alıcı sayısını ve konuyu döndürür.
//
// Secret'lar: GMAIL_APP_PASSWORD (zorunlu), GMAIL_USER (isteğe bağlı, varsayılan kulüp adresi)

import { createClient } from "npm:@supabase/supabase-js@2";

const CLUB_GMAIL = "anitteperotaract1996@gmail.com";
const DAYS_BEFORE = 6;
const MONTHS = ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"];
const DAYS = ["Pazar", "Pazartesi", "Salı", "Çarşamba", "Perşembe", "Cuma", "Cumartesi"];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Paneldeki WhatsApp şablonuyla aynı imza (uye/js/app.js → WA_SIGN)
const SIGN = `Rtc. Simay Oğuzkurt
Ankara Anıttepe Rotaract Kulübü
2026-27 Dönem Başkanı

Rtc. Oğulcan Görgülü
Ankara Anıttepe Rotaract Kulübü
2026-27 Dönem Sekreteri`;
const MAP_URL = "https://maps.app.goo.gl/SuKHmR4eTei8gXPK7";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json; charset=utf-8" } });

function istanbulToday(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Istanbul", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}
function addDays(iso: string, n: number): string {
  const d = new Date(iso + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// WhatsApp duyurusuyla aynı metin (*kalın* işaretleri e-postada kalın yazıya çevrilir)
function buildText(m: { date: string; term_no: number; club_no: number }): string {
  const d = new Date(m.date + "T12:00:00Z"), prev = new Date(d); prev.setUTCDate(d.getUTCDate() - 1);
  const full = (x: Date) => `${x.getUTCDate()} ${MONTHS[x.getUTCMonth()]} ${x.getUTCFullYear()} ${DAYS[x.getUTCDay()]}`;
  const p2 = (n: number) => String(n).padStart(2, "0");
  const dot = `${p2(d.getUTCDate())}.${p2(d.getUTCMonth() + 1)}.${d.getUTCFullYear()} ${DAYS[d.getUTCDay()]}`;
  return [
    "Kıymetli Anıttepe Rotaract Kulübü Üye ve Misafirleri,", "",
    `Kulübümüzün *${m.club_no}.* ve dönemin *${m.term_no}. toplantısı,* *${full(d)}* günü, saat *19:30’da HybridHub’da* gerçekleştirilecektir.`, "",
    `Katılım durumunuzu ve katılamamanız halinde sebebini, *${full(prev)}* akşamına kadar bildirmeniz gerekmektedir.`, "",
    "Toplantımızda smart casual dress code olduğunu hatırlatmak isteriz.", "",
    `🗓️ : *${dot}*`,
    "⏰ : *19:30*",
    "💃🏻 : *Smart Casual*",
    "📍 : *HybridHub*",
    MAP_URL, "",
    "En derin Rotaract Sevgi ve Saygılarımızla,", "",
    SIGN,
  ].join("\n");
}
function toHtml(text: string): string {
  const body = esc(text)
    .replace(/\*([^*\n]+)\*/g, "<b>$1</b>")
    .replace(MAP_URL, `<a href="${MAP_URL}" style="color:#d41367">Konumu haritada aç</a>`)
    .replace(/\n/g, "<br>");
  return `<!doctype html><html><body style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.55;color:#222;max-width:600px;margin:0 auto;padding:16px">
<p style="margin:0 0 18px">${body}</p>
<p style="font-size:12px;color:#777;margin:0">Anıttepe Rotaract · <a href="https://anitteperotaract.org/uye/" style="color:#777">Üye paneli</a></p>
</body></html>`;
}

Deno.serve(async (req: Request) => {
  try {
    let input: Record<string, unknown> = {};
    try { input = await req.json(); } catch { /* boş gövde */ }
    const dry = input.dry === true;
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
    const today = istanbulToday();
    const target = dry && typeof input.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(input.date) ? input.date : addDays(today, DAYS_BEFORE);

    const { data: meetings, error: mErr } = await admin.from("meetings").select("id, date, term_no, club_no").eq("date", target);
    if (mErr) throw mErr;
    if (!meetings?.length) return json({ ok: true, sent: 0, reason: `${target} tarihinde toplantı yok.` });

    const [{ data: members, error: pErr }, { data: guests, error: gErr }] = await Promise.all([
      admin.from("profiles").select("email").eq("status", "active"),
      admin.from("guests").select("email"),
    ]);
    if (pErr) throw pErr;
    if (gErr) throw gErr;
    const recipients = [...(members ?? []), ...(guests ?? [])]
      .map((p) => String(p.email ?? "").trim().toLowerCase())
      .filter((e, i, a) => EMAIL_RE.test(e) && a.indexOf(e) === i);

    const results = [];
    for (const m of meetings) {
      const subject = `Toplantı duyurusu: ${m.term_no}. toplantı · ${Number(m.date.slice(8))} ${MONTHS[+m.date.slice(5, 7) - 1]}`;
      if (dry) { results.push({ term_no: m.term_no, subject, recipients: recipients.length, members: (members ?? []).length, guests: (guests ?? []).length }); continue; }

      // Her toplantı için yalnızca bir kez
      const kind = `meeting:${m.id}`;
      const { error: logErr } = await admin.from("reminder_log").insert({ kind, day: m.date });
      if (logErr) {
        if (logErr.code === "23505") { results.push({ term_no: m.term_no, sent: 0, reason: "zaten gönderildi" }); continue; }
        throw logErr;
      }
      const pass = (Deno.env.get("GMAIL_APP_PASSWORD") ?? "").replace(/\s+/g, "");
      if (!pass) { await admin.from("reminder_log").delete().match({ kind, day: m.date }); return json({ ok: false, error: "GMAIL_APP_PASSWORD secret'ı yok." }, 500); }

      const text = buildText(m), html = toHtml(text);
      const { default: nodemailer } = await import("npm:nodemailer@6.9.16");
      const user = Deno.env.get("GMAIL_USER") || CLUB_GMAIL;
      const transporter = nodemailer.createTransport({ host: "smtp.gmail.com", port: 465, secure: true, auth: { user, pass } });
      let sent = 0, failed = 0;
      for (const to of recipients) {
        try {
          await transporter.sendMail({ from: `"Anıttepe Rotaract" <${user}>`, to, replyTo: user, subject, text: text.replace(/\*/g, ""), html });
          sent++;
        } catch (e) {
          failed++;
          console.error("Toplantı duyurusu gönderilemedi", String(e));
        }
      }
      transporter.close();
      if (!sent) {
        await admin.from("reminder_log").delete().match({ kind, day: m.date });
        return json({ ok: false, error: "E-posta gönderilemedi." }, 502);
      }
      // Duyurular geçmişine kayıt
      await admin.from("announcements").insert({ kind: "toplanti", subject, body: text, channels: ["email"], sent_via: "sunucu", result: { auto: true, sent, failed }, created_by: null });
      results.push({ term_no: m.term_no, sent, failed });
    }
    return json({ ok: true, date: target, dry, results });
  } catch (e) {
    console.error("meeting-reminder hatası", e);
    return json({ ok: false, error: "Beklenmeyen bir hata oluştu." }, 500);
  }
});
