// Supabase Edge Function: basvuru
// Sitedeki misafir üye başvurusu, iletişim formu ve panelden yapılan kayıtları alır:
//   1) public.applications tablosuna kaydeder (e-posta gitmese bile başvuru kaybolmaz),
//   2) kulübün Gmail adresine (anitteperotaract1996@gmail.com) e-posta olarak gönderir.
// Kimlik istemez (ziyaretçiler kullanır). Kötüye kullanıma karşı: alan uzunluk sınırları, gizli "hp"
// tuzak alanı ve aynı IP'den 10 dakikada en fazla 5 başvuru.
//
// POST ${SUPABASE_URL}/functions/v1/basvuru
// Body: { kind: "misafir"|"iletisim"|"panel", subject, body, reply_to?, page?, hp? }
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
<p style="margin:0 0 16px;font-weight:700;color:#D41367">Ankara Anıttepe Rotaract · web sitesi</p>
<h2 style="font-size:19px;margin:0 0 14px">${esc(subject)}</h2>
${rows.length ? `<table style="border-collapse:collapse;margin:0 0 14px">${rows.join("")}</table>` : ""}${paras.join("")}
<p style="margin:20px 0 0;font-size:12px;color:#888">Bu başvuru siteden otomatik iletildi ve üye panelindeki kayıtlara da eklendi. Yanıtla dediğinizde başvuran kişiye yazarsınız.</p></div>`;
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
    t.close();
    emailed = true;
    if (row?.id) await admin.from("applications").update({ emailed: true }).eq("id", row.id);
  } catch (e) {
    console.error("Başvuru e-postası gönderilemedi", String(e));
  }

  if (!emailed && insErr) return json({ ok: false, error: "Başvuru şu an iletilemedi. Lütfen tekrar dene." }, 502, h);
  return json({ ok: true, emailed }, 200, h);
});
