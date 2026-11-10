// Supabase Edge Function: birthday-reminder
// Her sabah zamanlayıcı (pg_cron) çağırır. Ertesi gün doğum günü olan aktif üyeleri bulur ve
// başkan ile sekretere kulüp Gmail'inden e-posta gönderir.
//
// Güvenlik: kimlik istemez, ama aynı gün için yalnızca bir kez e-posta gönderir (reminder_log tablosu).
// Bu yüzden biri adresi tekrar tekrar çağırsa da fazladan e-posta gitmez. İçerik yalnızca başkan ve
// sekreterin e-postasına gider; yanıt gövdesinde kişisel bilgi döndürülmez.
//
// Secret'lar: GMAIL_APP_PASSWORD (zorunlu), GMAIL_USER (isteğe bağlı, varsayılan kulüp adresi)
// (SUPABASE_URL ve SUPABASE_SERVICE_ROLE_KEY Supabase tarafından otomatik verilir)

import { createClient } from "npm:@supabase/supabase-js@2";

const CLUB_GMAIL = "anitteperotaract1996@gmail.com";
const MONTHS = ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"];
const DAYS = ["Pazar", "Pazartesi", "Salı", "Çarşamba", "Perşembe", "Cuma", "Cumartesi"];

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json; charset=utf-8" } });

// Türkiye saatine göre bugünün tarihi (YYYY-MM-DD)
function istanbulToday(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Istanbul", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}
function addDays(iso: string, n: number): string {
  const d = new Date(iso + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
const isLeap = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

Deno.serve(async () => {
  try {
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
    const today = istanbulToday();
    const target = addDays(today, 1);           // yarın
    const [ty, tm, td] = target.split("-").map(Number);
    const md = target.slice(5);

    const { data: people, error } = await admin
      .from("profiles")
      .select("id, full_name, phone, email, birth_date, roles, status")
      .eq("status", "active");
    if (error) throw error;

    const birthdays = (people ?? []).filter((p) => {
      if (!p.birth_date) return false;
      let b = String(p.birth_date).slice(5);
      if (b === "02-29" && !isLeap(ty)) b = "02-28";
      return b === md;
    });
    if (!birthdays.length) return json({ ok: true, sent: 0, reason: "Yarın doğum günü olan yok." });

    // Aynı gün için yalnızca bir kez gönder
    const { error: logErr } = await admin.from("reminder_log").insert({ kind: "birthday", day: today });
    if (logErr) {
      if (logErr.code === "23505") return json({ ok: true, sent: 0, reason: "Bugünün hatırlatması zaten gönderildi." });
      throw logErr;
    }

    const recipients = (people ?? [])
      .filter((p) => Array.isArray(p.roles) && (p.roles.includes("baskan") || p.roles.includes("sekreter")))
      .map((p) => String(p.email ?? "").trim().toLowerCase())
      .filter((e, i, a) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) && a.indexOf(e) === i);
    if (!recipients.length) return json({ ok: false, error: "Başkan veya sekreterin e-posta adresi kayıtlı değil." }, 500);

    const pass = (Deno.env.get("GMAIL_APP_PASSWORD") ?? "").replace(/\s+/g, "");
    if (!pass) return json({ ok: false, error: "GMAIL_APP_PASSWORD secret'ı yok." }, 500);

    const when = `${td} ${MONTHS[tm - 1]} ${DAYS[new Date(target + "T12:00:00Z").getUTCDay()]}`;
    const lines = birthdays.map((p) => {
      const y = +String(p.birth_date).slice(0, 4);
      const age = y > 1900 ? ty - y : null;
      return { name: p.full_name as string, age, phone: (p.phone as string) || "" };
    });
    const subject = `Yarın doğum günü: ${lines.map((l) => l.name).join(", ")}`;
    const text = `Merhaba,\n\nYarın (${when}) doğum günü olan üye${lines.length > 1 ? "ler" : ""}:\n\n` +
      lines.map((l) => `- ${l.name}${l.age ? ` (${l.age} yaşına giriyor)` : ""}${l.phone ? ` · ${l.phone}` : ""}`).join("\n") +
      `\n\nKutlama mesajı ya da sürpriz için hatırlatmadır.\n\nAnıttepe Rotaract üye paneli\nhttps://anitteperotaract.org/uye/`;
    const html = `<!doctype html><html><body style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.5;color:#222;max-width:600px;margin:0 auto;padding:16px">
<h2 style="font-size:18px;margin:0 0 14px;color:#d41367">🎂 Yarın doğum günü</h2>
<p style="margin:0 0 10px">Yarın (${escapeHtml(when)}) doğum günü olan üye${lines.length > 1 ? "ler" : ""}:</p>
<ul style="margin:0 0 16px;padding-left:20px">${lines.map((l) => `<li><b>${escapeHtml(l.name)}</b>${l.age ? ` · ${l.age} yaşına giriyor` : ""}${l.phone ? ` · ${escapeHtml(l.phone)}` : ""}</li>`).join("")}</ul>
<p style="margin:0 0 16px">Kutlama mesajı ya da sürpriz için hatırlatmadır.</p>
<p style="font-size:12px;color:#777;margin:0">Anıttepe Rotaract üye paneli · <a href="https://anitteperotaract.org/uye/" style="color:#777">anitteperotaract.org/uye</a></p>
</body></html>`;

    const { default: nodemailer } = await import("npm:nodemailer@6.9.16");
    const user = Deno.env.get("GMAIL_USER") || CLUB_GMAIL;
    const transporter = nodemailer.createTransport({ host: "smtp.gmail.com", port: 465, secure: true, auth: { user, pass } });
    let sent = 0;
    for (const to of recipients) {
      try {
        await transporter.sendMail({ from: `"Anıttepe Rotaract" <${user}>`, to, subject, text, html });
        sent++;
      } catch (e) {
        console.error("Doğum günü e-postası gönderilemedi", to, String(e));
      }
    }
    transporter.close();
    if (!sent) {
      // Hiçbiri gitmediyse kaydı geri al ki zamanlayıcı ya da elle tekrar denenebilsin
      await admin.from("reminder_log").delete().match({ kind: "birthday", day: today });
      return json({ ok: false, error: "E-posta gönderilemedi." }, 502);
    }
    return json({ ok: true, sent, birthdays: lines.length });
  } catch (e) {
    console.error("birthday-reminder hatası", e);
    return json({ ok: false, error: "Beklenmeyen bir hata oluştu." }, 500);
  }
});
