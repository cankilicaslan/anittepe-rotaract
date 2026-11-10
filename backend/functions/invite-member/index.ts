// Supabase Edge Function: invite-member
// Başkan yeni bir üyeyi e-postayla davet eder. Üyenin profili doğrudan "active" olarak oluşturulur;
// üye e-postadaki bağlantıya tıklayıp şifresini belirleyerek panele girer.
// Yalnızca aktif "baskan" rolündeki üyeler çağırabilir.
//
// POST ${SUPABASE_URL}/functions/v1/invite-member
// Header: Authorization: Bearer <kullanıcının access token'ı>
// Body:   { full_name, email, phone?, title?, birth_date? ("YYYY-MM-DD"), profession?, instagram?, joined_at? ("YYYY-MM-DD") }
// Yanıt:  200 { ok: true, profile: <profiles satırı> }   |   4xx/5xx { ok: false, error: "<Türkçe mesaj>" }
//         409: bu e-postayla zaten bir hesap var.
//
// Davet e-postası Supabase Auth üzerinden gider (Authentication > Emails > "Invite user" şablonu).
// Supabase'in yerleşik e-posta servisi saatte çok az e-posta gönderir; düzenli kullanım için
// Authentication > SMTP Settings'e Resend SMTP bilgileri girilmesi önerilir (KURULUM.md, 10. bölüm).
// (SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY Supabase tarafından otomatik verilir)

import { createClient } from "npm:@supabase/supabase-js@2";

const REDIRECT_TO = "https://anitteperotaract.org/uye/";

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

async function requireBaskan(req: Request) {
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
  if (profErr || !profile) throw new HttpError(403, "Üye profiliniz bulunamadı.");
  const roles: string[] = profile.roles ?? [];
  if (profile.status !== "active" || !roles.includes("baskan")) {
    throw new HttpError(403, "Üye davet etmek için Başkan yetkisi gerekiyor.");
  }
  return { user: userData.user, profile };
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function str(v: unknown, max = 200): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t ? t.slice(0, max) : null;
}

function dateStr(v: unknown, label: string): string | null {
  const s = str(v, 10);
  if (!s) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || isNaN(new Date(s + "T12:00:00Z").getTime())) {
    throw new HttpError(400, `${label} geçerli bir tarih değil (YYYY-AA-GG).`);
  }
  return s;
}

// "@kullanici", "instagram.com/kullanici" veya "kullanici" → "kullanici"
function instagramHandle(v: unknown): string | null {
  const s = str(v, 200);
  if (!s) return null;
  const m = s.match(/instagram\.com\/([A-Za-z0-9._]+)/i);
  const h = (m ? m[1] : s).replace(/^@+/, "").replace(/\/+$/, "");
  return h ? h.slice(0, 30) : null;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  if (req.method !== "POST") return json({ ok: false, error: "Yalnızca POST desteklenir." }, 405);

  try {
    await requireBaskan(req);

    let input: Record<string, unknown>;
    try {
      input = await req.json();
    } catch {
      throw new HttpError(400, "İstek gövdesi geçerli bir JSON değil.");
    }

    const fullName = str(input.full_name, 120);
    const email = (str(input.email, 254) ?? "").toLowerCase();
    if (!fullName) throw new HttpError(400, "Ad soyad gerekli.");
    if (!EMAIL_RE.test(email)) throw new HttpError(400, "Geçerli bir e-posta adresi girin.");
    const phone = str(input.phone, 30);
    const fields = {
      full_name: fullName,
      phone,
      title: str(input.title, 80) ?? "Üye",
      birth_date: dateStr(input.birth_date, "Doğum tarihi"),
      profession: str(input.profession, 120),
      instagram: instagramHandle(input.instagram),
      joined_at: dateStr(input.joined_at, "Kulübe katılış tarihi") ?? new Date().toISOString().slice(0, 10),
    };

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );

    // Davet: auth.users'a kayıt eklenir; handle_new_user tetikleyicisi "pending" profili oluşturur.
    const { data: invited, error: invErr } = await admin.auth.admin.inviteUserByEmail(email, {
      data: { full_name: fullName, phone },
      redirectTo: REDIRECT_TO,
    });
    if (invErr || !invited?.user) {
      console.error("Davet hatası", invErr);
      const msg = String(invErr?.message ?? "").toLowerCase();
      const code = String((invErr as { code?: string } | null)?.code ?? "");
      if (code === "email_exists" || msg.includes("already been registered") || msg.includes("already registered")) {
        throw new HttpError(409, "Bu e-posta adresiyle zaten bir hesap var. Üyeyi Üyeler listesinden bulup onaylayabilirsiniz.");
      }
      if ((invErr as { status?: number } | null)?.status === 429 || msg.includes("rate limit")) {
        throw new HttpError(429, "Davet e-postası sınırına takıldı. Bir süre sonra tekrar deneyin (veya SMTP ayarını yapın).");
      }
      throw new HttpError(502, "Davet e-postası gönderilemedi. Lütfen tekrar deneyin.");
    }

    // Profili aktifleştir ve diğer alanları yaz (service role: koruma tetikleyicisi uygulanmaz).
    const { data: profile, error: upErr } = await admin
      .from("profiles")
      .upsert(
        { id: invited.user.id, email, status: "active", ...fields },
        { onConflict: "id" },
      )
      .select("*")
      .single();
    if (upErr || !profile) {
      console.error("Profil güncellenemedi", upErr);
      throw new HttpError(500, "Davet gönderildi ancak üye profili güncellenemedi. Üyeler listesinden elle onaylayın.");
    }

    return json({ ok: true, profile });
  } catch (err) {
    if (err instanceof HttpError) return json({ ok: false, error: err.message }, err.status);
    console.error("Beklenmeyen hata", err);
    return json({ ok: false, error: "Beklenmeyen bir hata oluştu. Lütfen tekrar deneyin." }, 500);
  }
});
