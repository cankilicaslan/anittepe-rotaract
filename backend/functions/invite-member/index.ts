// Supabase Edge Function: invite-member
// Başkan yeni bir üyeyi e-postayla davet eder. Üyenin profili doğrudan "active" olarak oluşturulur;
// üye e-postadaki bağlantıya tıklayıp şifresini belirleyerek panele girer.
// Yalnızca aktif "baskan" rolündeki üyeler çağırabilir.
// Misafir daveti: Body { kind: "guest", guest_id } → misafirin kayıtlı e-postasına davet gider; profil açılmaz,
// hesap guests.user_id ile bağlanır (handle_new_user). Başkan, sekreter ya da site sahibi çağırabilir.
// Panel maili: Body { kind: "login", member_ids: [...] } → hiç giriş yapmamış ve şifre belirlememiş üyelere
// şifre belirleme bağlantısı gider (hesabı hiç açılmamışsa önce profil kimliğiyle açılır). Başkan, sekreter, sahip.
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

async function requireBaskan(req: Request, guest = false) {
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
  // Başkan ya da site sahibi (is_admin) davet edebilir.
  const { data: isAdmin } = await supabase.rpc("is_admin");
  const { data: isSek } = guest ? await supabase.rpc("has_role", { r: "sekreter" }) : { data: false };
  if (profile.status !== "active" || (isAdmin !== true && isSek !== true)) {
    throw new HttpError(403, guest ? "Bu işlem için Başkan ya da Sekreter yetkisi gerekiyor." : "Üye davet etmek için Başkan yetkisi gerekiyor.");
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

async function sendLoginMails(req: Request, input: Record<string, unknown>): Promise<Response> {
  await requireBaskan(req, true);
  const ids = Array.isArray(input.member_ids) ? input.member_ids.filter((x) => typeof x === "string").slice(0, 60) as string[] : [];
  if (!ids.length) throw new HttpError(400, "Kişi seçilmedi.");
  const url = Deno.env.get("SUPABASE_URL")!;
  const userClient = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: req.headers.get("Authorization")! } }, auth: { persistSession: false },
  });
  const anon = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, { auth: { persistSession: false, autoRefreshToken: false } });
  const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false, autoRefreshToken: false } });
  // Hesap durumu: şifresi olan ya da en az bir kez giriş yapmış kişiye mail gitmez
  const { data: accts } = await userClient.rpc("member_accounts");
  const acc = new Map((accts ?? []).map((a: { id: string; has_password: boolean; last_sign_in_at: string | null }) => [a.id, a]));
  const { data: profs } = await admin.from("profiles").select("id, full_name, email, status").in("id", ids);
  const sent: string[] = [], skipped: { name: string; reason: string }[] = [];
  for (const p of profs ?? []) {
    const a = acc.get(p.id) as { has_password: boolean; last_sign_in_at: string | null } | undefined;
    if (a && (a.has_password || a.last_sign_in_at)) { skipped.push({ name: p.full_name, reason: "zaten giriş yapmış" }); continue; }
    if (p.status !== "active") { skipped.push({ name: p.full_name, reason: "aktif üye değil" }); continue; }
    const email = String(p.email ?? "").trim().toLowerCase();
    if (!EMAIL_RE.test(email)) { skipped.push({ name: p.full_name, reason: "e-posta adresi yok" }); continue; }
    if (!a) {
      // Profil var ama giriş hesabı hiç açılmamış: aynı kimlikle hesap açılır
      const { error: cErr } = await admin.auth.admin.createUser({ id: p.id, email, email_confirm: true, user_metadata: { full_name: p.full_name } } as never);
      if (cErr) { console.error("Hesap açılamadı", p.id, cErr); skipped.push({ name: p.full_name, reason: String(cErr.message || "").toLowerCase().includes("already") ? "bu e-postayla başka bir hesap var" : "hesap açılamadı" }); continue; }
    }
    const { error: rErr } = await anon.auth.resetPasswordForEmail(email, { redirectTo: REDIRECT_TO });
    if (rErr) {
      console.error("Mail gönderilemedi", p.id, rErr);
      const m = String(rErr.message || "").toLowerCase();
      skipped.push({ name: p.full_name, reason: m.includes("rate") || (rErr as { status?: number }).status === 429 ? "mail sınırına takıldı, biraz sonra tekrar deneyin" : "mail gönderilemedi" });
      continue;
    }
    sent.push(p.full_name);
  }
  return json({ ok: true, sent, skipped });
}

async function inviteGuest(req: Request, input: Record<string, unknown>): Promise<Response> {
  await requireBaskan(req, true);
  const guestId = str(input.guest_id, 40);
  if (!guestId) throw new HttpError(400, "Misafir seçilmedi.");
  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const { data: g } = await admin.from("guests").select("id, full_name, email, user_id").eq("id", guestId).maybeSingle();
  if (!g) throw new HttpError(404, "Misafir bulunamadı.");
  if (g.user_id) throw new HttpError(409, "Bu misafirin panel hesabı zaten var.");
  const email = String(g.email ?? "").trim().toLowerCase();
  if (!EMAIL_RE.test(email)) throw new HttpError(400, "Önce misafirin e-posta adresini kaydedin.");
  const { data: invited, error: invErr } = await admin.auth.admin.inviteUserByEmail(email, {
    data: { kind: "guest", guest_id: g.id, full_name: g.full_name },
    redirectTo: REDIRECT_TO,
  });
  if (invErr || !invited?.user) {
    console.error("Misafir davet hatası", invErr);
    const msg = String(invErr?.message ?? "").toLowerCase();
    const code = String((invErr as { code?: string } | null)?.code ?? "");
    if (code === "email_exists" || msg.includes("already been registered") || msg.includes("already registered")) {
      throw new HttpError(409, "Bu e-posta adresiyle zaten bir hesap var (ör. bir üyenin hesabı).");
    }
    if ((invErr as { status?: number } | null)?.status === 429 || msg.includes("rate limit")) {
      throw new HttpError(429, "Davet e-postası sınırına takıldı. Bir süre sonra tekrar deneyin.");
    }
    throw new HttpError(502, "Davet e-postası gönderilemedi. Lütfen tekrar deneyin.");
  }
  // Tetikleyici bağlamadıysa (ör. eski tetikleyici) burada bağla
  await admin.from("guests").update({ user_id: invited.user.id }).eq("id", g.id).is("user_id", null);
  return json({ ok: true, guest_id: g.id });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  if (req.method !== "POST") return json({ ok: false, error: "Yalnızca POST desteklenir." }, 405);

  try {
    let input: Record<string, unknown>;
    try {
      input = await req.json();
    } catch {
      throw new HttpError(400, "İstek gövdesi geçerli bir JSON değil.");
    }
    if (input.kind === "guest") return await inviteGuest(req, input);
    if (input.kind === "login") return await sendLoginMails(req, input);
    await requireBaskan(req);

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
