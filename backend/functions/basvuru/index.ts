// Supabase Edge Function: basvuru
// Sitedeki misafir üye başvurusu, iletişim formu ve panelden yapılan kayıtları alır:
//   1) public.applications tablosuna kaydeder (e-posta gitmese bile başvuru kaybolmaz),
//   2) kulübün Gmail adresine (anitteperotaract1996@gmail.com) e-posta olarak gönderir.
// Kimlik istemez (ziyaretçiler kullanır). Kötüye kullanıma karşı: alan uzunluk sınırları, gizli "hp"
// tuzak alanı ve aynı IP'den 10 dakikada en fazla 5 başvuru.
//
// POST ${SUPABASE_URL}/functions/v1/basvuru
// Body: { kind: "misafir"|"iletisim"|"panel", subject, body, reply_to?, page?, hp?, confirm? }
// confirm varsa başvurana türüne uygun bir onay e-postası da gider (bkz. confirmMail).
// Yanıt: 200 { ok: true, emailed: boolean } | 4xx { ok: false, error }
//
// Secret'lar: GMAIL_APP_PASSWORD (zorunlu), GMAIL_USER (isteğe bağlı)

import { createClient } from "npm:@supabase/supabase-js@2";

const CLUB = "anitteperotaract1996@gmail.com";
const ALLOWED_ORIGINS = [/^https:\/\/(www\.)?anitteperotaract\.org$/, /^http:\/\/localhost(:\d+)?$/, /^http:\/\/127\.0\.0\.1(:\d+)?$/];

function cors(origin: string | null): Record<string, string> {
  const ok = origin && ALLOWED_ORIGINS.some((r) => r.test(origin));
  return {
    "Access-Control-Allow-Origin": ok ? origin! : "https://anitteperotaract.org",
    "Access-Control-Allow-Headers": "content-type, authorization, apikey, x-client-info",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}
const json = (body: unknown, status: number, h: Record<string, string>) =>
  new Response(JSON.stringify(body), { status, headers: { ...h, "Content-Type": "application/json; charset=utf-8" } });
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// "Etiket: değer" satırlarını tabloya, kalanını paragrafa çevir
function bodyHtml(subject: string, body: string): string {
  const rows: string[] = [], paras: string[] = [];
  for (const line of body.split(/\n/)) {
    const m = /^([^:\n]{1,40}):\s*(.*)$/.exec(line.trim());
    if (m && !/^https?$/i.test(m[1])) rows.push(`<tr><td style="padding:6px 12px 6px 0;color:#666;vertical-align:top;white-space:nowrap">${esc(m[1])}</td><td style="padding:6px 0;font-weight:600">${esc(m[2]) || "-"}</td></tr>`);
    else if (line.trim()) paras.push(`<p style="margin:0 0 10px">${esc(line)}</p>`);
  }
  return `<div style="font-family:Arial,Helvetica,sans-serif;max-width:600px;margin:0 auto;padding:20px;color:#222;font-size:15px;line-height:1.5">
<p style="margin:0 0 16px;font-weight:700;color:#D41367">Ankara Anıttepe Rotaract Kulübü · web sitesi</p>
<h2 style="font-size:19px;margin:0 0 14px">${esc(subject)}</h2>
${rows.length ? `<table style="border-collapse:collapse;margin:0 0 14px">${rows.join("")}</table>` : ""}${paras.join("")}
<p style="margin:20px 0 0;font-size:12px;color:#888">Bu başvuru siteden otomatik iletildi ve kulübün başvuru kayıtlarına da eklendi. Yanıtla dediğinizde başvuran kişiye yazarsınız.</p></div>`;
}

// ---------- Başvurana giden onay e-postaları ----------
// confirm: { name, lang: "tr"|"en", meeting?: "20 Kasım Perşembe", meeting_no?, topic?, message? }
type Confirm = { name: string; lang: "tr" | "en"; meeting: string; meetingNo: string; topic: string; message: string };
const IG = "https://www.instagram.com/anitteperotaract/";
const MAP = "https://www.google.com/maps/search/?api=1&query=Hybrid+Hub+Ankara";

function shell(title: string, inner: string, lang: "tr" | "en"): string {
  const foot = lang === "en"
    ? "You received this email because you filled in a form on anitteperotaract.org. Just reply if you have a question."
    : "Bu e-postayı anitteperotaract.org'daki formu doldurduğun için aldın. Sorun olursa bu e-postayı yanıtlaman yeterli.";
  return `<div style="background:#f6f3f4;padding:24px 12px;font-family:Arial,Helvetica,sans-serif">
<div style="max-width:560px;margin:0 auto;background:#fff;border-radius:14px;overflow:hidden;color:#222;font-size:15px;line-height:1.6">
<div style="background:#D41367;color:#fff;padding:18px 24px;font-weight:700;font-size:16px">Ankara Anıttepe Rotaract Kulübü</div>
<div style="padding:24px">
<h1 style="font-size:21px;line-height:1.3;margin:0 0 14px;color:#111">${title}</h1>
${inner}
<p style="margin:22px 0 0">${lang === "en" ? "See you soon," : "Görüşmek üzere,"}<br><b>Ankara Anıttepe Rotaract Kulübü</b></p>
</div>
<div style="border-top:1px solid #eee;padding:14px 24px;font-size:12px;color:#888">${foot}<br>
<a href="https://anitteperotaract.org" style="color:#A30C4D">anitteperotaract.org</a> · <a href="${IG}" style="color:#A30C4D">Instagram</a></div>
</div></div>`;
}
const p = (s: string) => `<p style="margin:0 0 12px">${s}</p>`;
const box = (rows: [string, string][]) =>
  `<table style="border-collapse:collapse;width:100%;background:#fbf4f7;border-radius:10px;margin:4px 0 16px">${rows.map(([k, v]) =>
    `<tr><td style="padding:10px 14px;color:#777;white-space:nowrap;vertical-align:top">${k}</td><td style="padding:10px 14px;font-weight:700">${v}</td></tr>`).join("")}</table>`;
const btn = (href: string, label: string) =>
  `<p style="margin:0 0 14px"><a href="${href}" style="display:inline-block;background:#D41367;color:#fff;text-decoration:none;font-weight:700;padding:11px 18px;border-radius:999px">${label}</a></p>`;

function confirmMail(kind: string, c: Confirm): { subject: string; html: string; text: string } {
  const first = esc(c.name.split(/\s+/)[0] || c.name);
  const en = c.lang === "en";
  if (kind === "misafir") {
    const when = esc(c.meeting) + (en ? ", 7:30 pm" : ", 19.30");
    const subject = en ? `Your application is in – see you on ${c.meeting}` : `Başvurun alındı – ${c.meeting} toplantısında görüşmek üzere`;
    const html = shell(en ? `Thanks, ${first}! We'll see you at the meeting.` : `Teşekkürler ${first}, toplantıda görüşmek üzere!`, (en
      ? p("We received your guest application to Ankara Anıttepe Rotaract Kulübü. Here are the details of the meeting you picked:")
      : p("Ankara Anıttepe Rotaract Kulübü misafir üye başvurun bize ulaştı. Seçtiğin toplantının bilgileri:")) +
      box([[en ? "Date" : "Tarih", when], [en ? "Place" : "Yer", "Hybrid Hub, Ankara"], ...(c.meetingNo ? [[en ? "Meeting" : "Toplantı", en ? `No. ${esc(c.meetingNo)}` : `${esc(c.meetingNo)}. toplantı`] as [string, string]] : [])]) +
      btn(MAP, en ? "Open in Maps" : "Haritada aç") +
      (en
        ? p("If you can't make it or want to pick another date, just reply to this email.")
        : p("Gelemeyeceksen ya da başka bir tarih seçmek istersen bu e-postayı yanıtlaman yeterli.")), c.lang);
    const text = en
      ? `Thanks, ${c.name}! Your guest application is in.\nDate: ${c.meeting}, 7:30 pm\nPlace: Hybrid Hub, Ankara (${MAP})\nCan't make it? Just reply to this email.\n\nAnkara Anıttepe Rotaract Kulübü`
      : `Teşekkürler ${c.name}, misafir üye başvurun alındı.\nTarih: ${c.meeting}, 19.30\nYer: Hybrid Hub, Ankara (${MAP})\nGelemeyeceksen bu e-postayı yanıtlaman yeterli.\n\nAnkara Anıttepe Rotaract Kulübü`;
    return { subject, html, text };
  }
  if (kind === "panel") {
    const subject = "Üye paneli hesabın oluşturuldu – onay bekleniyor";
    const html = shell(`Hoş geldin ${first}!`,
      p("Ankara Anıttepe Rotaract Kulübü üye panelinde hesabın oluşturuldu. Hesabın kulüp başkanının onayını bekliyor.") +
      box([["Durum", "Onay bekliyor"], ["Sonraki adım", "Başkan onayladığında panele giriş yapabilirsin"]]) +
      p("Supabase'den ayrıca bir e-posta doğrulama bağlantısı geldiyse önce ona tıkla. Onaydan sonra profilini, takvimi, üyeleri ve fotoğraf arşivini görebilirsin.") +
      btn("https://anitteperotaract.org/uye/", "Üye paneline git") +
      p("Bu kaydı sen yapmadıysan bu e-postayı yanıtlayarak bize haber ver."), "tr");
    const text = `Hoş geldin ${c.name}!\nÜye paneli hesabın oluşturuldu ve başkan onayını bekliyor. Onaylandığında https://anitteperotaract.org/uye/ adresinden giriş yapabilirsin.\nBu kaydı sen yapmadıysan bu e-postayı yanıtla.\n\nAnkara Anıttepe Rotaract Kulübü`;
    return { subject, html, text };
  }
  // iletisim
  const topic = esc(c.topic || (en ? "General question" : "Genel soru"));
  const msg = c.message ? esc(c.message).replace(/\n/g, "<br>") : "";
  const subject = en ? "We got your message – Ankara Anıttepe Rotaract Kulübü" : "Mesajın bize ulaştı – Ankara Anıttepe Rotaract Kulübü";
  const html = shell(en ? `Thanks for reaching out, ${first}!` : `Bize yazdığın için teşekkürler ${first}!`,
    (en ? p("Your message reached us. Someone from the club will get back to you as soon as possible, usually within a few days.")
        : p("Mesajın bize ulaştı. Kulüpten biri en kısa sürede, genellikle birkaç gün içinde sana dönüş yapacak.")) +
    box([[en ? "Topic" : "Konu", topic], ...(msg ? [[en ? "Your message" : "Mesajın", msg] as [string, string]] : [])]) +
    (en ? p("Want to see us in person? Our meetings are every other Thursday at 7:30 pm at Hybrid Hub, Ankara.")
        : p("Bizi yakından tanımak istersen toplantılarımız iki haftada bir Perşembe 19.30'da Hybrid Hub'da.")) +
    btn("https://anitteperotaract.org/#basvuru", en ? "Come as a guest" : "Misafir olarak gel"), c.lang);
  const text = en
    ? `Thanks, ${c.name}! Your message reached us and we'll get back to you soon.\nTopic: ${c.topic}\n\nAnkara Anıttepe Rotaract Kulübü`
    : `Teşekkürler ${c.name}! Mesajın bize ulaştı, en kısa sürede dönüş yapacağız.\nKonu: ${c.topic}\n\nAnkara Anıttepe Rotaract Kulübü`;
  return { subject, html, text };
}

Deno.serve(async (req: Request) => {
  const h = cors(req.headers.get("origin"));
  if (req.method === "OPTIONS") return new Response("ok", { headers: h });
  if (req.method !== "POST") return json({ ok: false, error: "Yalnızca POST desteklenir." }, 405, h);

  let input: Record<string, unknown>;
  try { input = await req.json(); } catch { return json({ ok: false, error: "Geçersiz istek." }, 400, h); }
  if (typeof input.hp === "string" && input.hp.trim()) return json({ ok: true, emailed: false }, 200, h); // bot tuzağı

  const kind = ["misafir", "iletisim", "panel"].includes(String(input.kind)) ? String(input.kind) : "iletisim";
  const subject = String(input.subject ?? "").trim().slice(0, 200);
  const body = String(input.body ?? "").trim().slice(0, 8000);
  const replyTo = String(input.reply_to ?? "").trim().toLowerCase().slice(0, 254);
  const page = String(input.page ?? "").slice(0, 300);
  if (!subject || !body) return json({ ok: false, error: "Başvuru bilgileri eksik." }, 400, h);

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || null;

  if (ip) {
    const since = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const { count } = await admin.from("applications").select("id", { count: "exact", head: true }).eq("ip", ip).gte("created_at", since);
    if ((count ?? 0) >= 5) return json({ ok: false, error: "Çok fazla başvuru gönderildi. Birkaç dakika sonra tekrar dene." }, 429, h);
  }

  const { data: row, error: insErr } = await admin.from("applications")
    .insert({ kind, subject, body, reply_to: EMAIL_RE.test(replyTo) ? replyTo : null, page, ip })
    .select("id").single();
  if (insErr) console.error("Başvuru kaydedilemedi", insErr);

  let emailed = false;
  try {
    const pass = (Deno.env.get("GMAIL_APP_PASSWORD") ?? "").replace(/\s+/g, "");
    if (!pass) throw new Error("GMAIL_APP_PASSWORD yok");
    const { default: nodemailer } = await import("npm:nodemailer@6.9.16");
    const user = Deno.env.get("GMAIL_USER") || CLUB;
    const t = nodemailer.createTransport({ host: "smtp.gmail.com", port: 465, secure: true, auth: { user, pass } });
    await t.sendMail({
      from: `"Anıttepe Rotaract Web" <${user}>`, to: CLUB, subject, text: body, html: bodyHtml(subject, body),
      ...(EMAIL_RE.test(replyTo) ? { replyTo } : {}),
    });
    emailed = true;
    if (row?.id) await admin.from("applications").update({ emailed: true }).eq("id", row.id);

    // Başvurana onay e-postası (aynı adrese 10 dakikada en fazla 1 kez)
    const c = (input.confirm ?? {}) as Record<string, unknown>;
    const name = String(c.name ?? "").trim().slice(0, 80);
    if (EMAIL_RE.test(replyTo) && name) {
      const since = new Date(Date.now() - 10 * 60 * 1000).toISOString();
      const { count } = await admin.from("applications").select("id", { count: "exact", head: true }).eq("reply_to", replyTo).gte("created_at", since);
      if ((count ?? 0) <= 1) {
        try {
          const m = confirmMail(kind, {
            name, lang: c.lang === "en" ? "en" : "tr",
            meeting: String(c.meeting ?? "").slice(0, 60), meetingNo: String(c.meeting_no ?? "").slice(0, 6),
            topic: String(c.topic ?? "").slice(0, 60), message: String(c.message ?? "").slice(0, 2000),
          });
          await t.sendMail({ from: `"Ankara Anıttepe Rotaract Kulübü" <${user}>`, to: replyTo, replyTo: CLUB, ...m });
        } catch (e) { console.error("Onay e-postası gönderilemedi", String(e)); }
      }
    }
    t.close();
  } catch (e) {
    console.error("Başvuru e-postası gönderilemedi", String(e));
  }

  if (!emailed && insErr) return json({ ok: false, error: "Başvuru şu an iletilemedi. Lütfen tekrar dene." }, 502, h);
  return json({ ok: true, emailed }, 200, h);
});
