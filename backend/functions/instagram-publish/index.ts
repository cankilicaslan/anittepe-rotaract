// Supabase Edge Function: instagram-publish
// JPEG görseli "posts" bucket'ına yükler ve Instagram Graph API ile kulüp hesabında paylaşır.
// Yalnızca aktif "pr" veya "baskan" rolündeki üyeler çağırabilir.
//
// POST ${SUPABASE_URL}/functions/v1/instagram-publish
// Header: Authorization: Bearer <kullanıcının access token'ı>
// Body (iki seçenek):
//   a) multipart/form-data: image (JPEG dosyası/Blob), caption, post_id (isteğe bağlı)
//   b) application/json:   { image_base64 (JPEG, "data:image/jpeg;base64," öneki olabilir), caption, post_id? }
//      ya da kaydırmalı gönderi için { images_base64: [JPEG, ...] (2–10 sayfa), caption, post_id? }
// Yanıt: 200 { ok: true, media_id, permalink, image_url }  |  4xx/5xx { ok: false, error: "<Türkçe mesaj>" }
//
// Gerekli secret'lar: IG_USER_ID, IG_ACCESS_TOKEN
// (SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY Supabase tarafından otomatik verilir)

import { createClient } from "npm:@supabase/supabase-js@2";

// Instagram Login (graph.instagram.com, Facebook sayfası gerekmez) varsayılan; Facebook Login kullanılıyorsa IG_GRAPH_HOST=graph.facebook.com
const GRAPH = `https://${Deno.env.get("IG_GRAPH_HOST") || "graph.instagram.com"}/v21.0`;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024; // Instagram JPEG sınırı 8 MB
const MAX_CAPTION_CHARS = 2200;

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
  if (profErr || !profile) throw new HttpError(403, "Üye profiliniz bulunamadı.");
  const roles: string[] = profile.roles ?? [];
  if (profile.status !== "active" || !(roles.includes("pr") || roles.includes("baskan"))) {
    throw new HttpError(403, "Bu işlem için Halkla İlişkiler veya Başkan yetkisi gerekiyor.");
  }
  return { user: userData.user, profile };
}

function base64ToBytes(b64: string): Uint8Array {
  const clean = b64.replace(/^data:[^;]+;base64,/, "").replace(/\s+/g, "");
  const bin = atob(clean);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function isJpeg(bytes: Uint8Array): boolean {
  return bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
}

const MAX_CAROUSEL = 10; // Instagram kaydırmalı gönderi sınırı

async function readInput(req: Request): Promise<{ images: Uint8Array[]; caption: string; postId: string | null }> {
  const ct = req.headers.get("content-type") ?? "";
  let bytes: Uint8Array | null = null;
  let images: Uint8Array[] = [];
  let caption = "";
  let postId: string | null = null;

  if (ct.includes("multipart/form-data")) {
    const form = await req.formData();
    const file = form.get("image") ?? form.get("file");
    if (file && typeof file !== "string") {
      bytes = new Uint8Array(await file.arrayBuffer());
    } else if (typeof form.get("image_base64") === "string") {
      bytes = base64ToBytes(form.get("image_base64") as string);
    }
    caption = String(form.get("caption") ?? "");
    const pid = form.get("post_id");
    postId = typeof pid === "string" && pid ? pid : null;
  } else {
    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      throw new HttpError(400, "İstek gövdesi geçerli değil (JSON veya multipart bekleniyor).");
    }
    try {
      if (Array.isArray(body.images_base64)) {
        images = (body.images_base64 as unknown[]).filter((x): x is string => typeof x === "string").map(base64ToBytes);
      } else if (typeof body.image_base64 === "string") {
        bytes = base64ToBytes(body.image_base64);
      }
    } catch {
      throw new HttpError(400, "Görsel verisi (base64) çözülemedi.");
    }
    caption = typeof body.caption === "string" ? body.caption : "";
    postId = typeof body.post_id === "string" && body.post_id ? body.post_id : null;
  }

  if (!images.length && bytes) images = [bytes];
  if (!images.length || images.some((b) => b.length === 0)) throw new HttpError(400, "Görsel bulunamadı.");
  if (images.length > MAX_CAROUSEL) throw new HttpError(400, `Bir gönderide en fazla ${MAX_CAROUSEL} sayfa olabilir.`);
  for (const [i, b] of images.entries()) {
    const which = images.length > 1 ? `${i + 1}. sayfa: ` : "";
    if (!isJpeg(b)) throw new HttpError(400, `${which}Instagram yalnızca JPEG görsel kabul ediyor.`);
    if (b.length > MAX_IMAGE_BYTES) throw new HttpError(400, `${which}Görsel 8 MB'tan büyük olamaz.`);
  }
  caption = caption.trim();
  if (caption.length > MAX_CAPTION_CHARS) {
    throw new HttpError(400, `Açıklama en fazla ${MAX_CAPTION_CHARS} karakter olabilir.`);
  }
  return { images, caption, postId };
}

type GraphResult = Record<string, unknown> & { error?: { message?: string; code?: number; error_user_msg?: string } };

async function graph(method: "GET" | "POST", path: string, params: Record<string, string>): Promise<GraphResult> {
  const qs = new URLSearchParams(params);
  const res = method === "GET"
    ? await fetch(`${GRAPH}/${path}?${qs}`)
    : await fetch(`${GRAPH}/${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: qs,
    });
  const data = (await res.json().catch(() => ({}))) as GraphResult;
  if (!res.ok || data.error) {
    const e = data.error ?? {};
    console.error("Instagram Graph API hatası", path, res.status, JSON.stringify(e));
    if (e.code === 190) {
      throw new HttpError(502, "Instagram erişim anahtarının süresi dolmuş veya geçersiz. IG_ACCESS_TOKEN yenilenmeli (KURULUM.md).");
    }
    if (e.code === 4 || e.code === 9 || e.code === 32 || e.code === 613) {
      throw new HttpError(502, "Instagram paylaşım sınırına ulaşıldı. Bir süre sonra tekrar deneyin.");
    }
    throw new HttpError(502, `Instagram paylaşımı başarısız: ${e.error_user_msg ?? e.message ?? `HTTP ${res.status}`}`);
  }
  return data;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  if (req.method !== "POST") return json({ ok: false, error: "Yalnızca POST desteklenir." }, 405);

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );
  let postId: string | null = null;
  let imageUrl: string | null = null;

  try {
    await requirePrOrBaskan(req);
    const input = await readInput(req);
    postId = input.postId;

    const igUserId = Deno.env.get("IG_USER_ID");
    const igToken = Deno.env.get("IG_ACCESS_TOKEN");
    if (!igUserId || !igToken) {
      throw new HttpError(500, "Instagram ayarları (IG_USER_ID / IG_ACCESS_TOKEN) tanımlı değil.");
    }

    // 1) Görselleri Storage'a yükle (Instagram görseli herkese açık bir URL'den çeker)
    const now = new Date();
    const dir = `ig/${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
    const urls: string[] = [];
    for (const bytes of input.images) {
      const path = `${dir}/${crypto.randomUUID()}.jpg`;
      const { error: upErr } = await admin.storage.from("posts").upload(path, bytes, { contentType: "image/jpeg", upsert: false });
      if (upErr) {
        console.error("Storage yükleme hatası", upErr);
        throw new HttpError(500, "Görsel depolamaya yüklenemedi.");
      }
      urls.push(admin.storage.from("posts").getPublicUrl(path).data.publicUrl);
    }
    imageUrl = urls[0];

    // Kapsayıcı hazır olana kadar bekler (en fazla ~30 sn)
    const waitReady = async (id: string, what: string) => {
      for (let i = 0; i < 15; i++) {
        const st = await graph("GET", id, { fields: "status_code", access_token: igToken });
        const code = String(st.status_code ?? "");
        if (code === "FINISHED") return;
        if (code === "ERROR" || code === "EXPIRED") {
          throw new HttpError(502, `Instagram ${what} işleyemedi. Görselin JPEG olduğundan ve oranının 4:5 ile 1.91:1 arasında olduğundan emin olun.`);
        }
        await sleep(2000);
      }
      throw new HttpError(504, `Instagram ${what} zamanında hazırlayamadı. Birkaç dakika sonra tekrar deneyin.`);
    };

    // 2) Medya kapsayıcısı: tek görselde doğrudan, birden fazlasında kaydırmalı (CAROUSEL)
    let creationId = "";
    if (urls.length === 1) {
      const container = await graph("POST", `${igUserId}/media`, { image_url: urls[0], caption: input.caption, access_token: igToken });
      creationId = String(container.id ?? "");
      if (!creationId) throw new HttpError(502, "Instagram medya kapsayıcısı oluşturulamadı.");
      await waitReady(creationId, "görseli");
    } else {
      const children: string[] = [];
      for (const [i, url] of urls.entries()) {
        const item = await graph("POST", `${igUserId}/media`, { image_url: url, is_carousel_item: "true", access_token: igToken });
        const id = String(item.id ?? "");
        if (!id) throw new HttpError(502, `Instagram ${i + 1}. sayfanın kapsayıcısını oluşturamadı.`);
        children.push(id);
      }
      for (const [i, id] of children.entries()) await waitReady(id, `${i + 1}. sayfayı`);
      const carousel = await graph("POST", `${igUserId}/media`, {
        media_type: "CAROUSEL",
        children: children.join(","),
        caption: input.caption,
        access_token: igToken,
      });
      creationId = String(carousel.id ?? "");
      if (!creationId) throw new HttpError(502, "Instagram kaydırmalı gönderi kapsayıcısı oluşturulamadı.");
      await waitReady(creationId, "kaydırmalı gönderiyi");
    }

    // 4) Yayınla
    const published = await graph("POST", `${igUserId}/media_publish`, {
      creation_id: creationId,
      access_token: igToken,
    });
    const mediaId = String(published.id ?? "");
    if (!mediaId) throw new HttpError(502, "Instagram paylaşımı onaylanmadı.");

    // 5) Kalıcı bağlantıyı al (başarısız olsa da paylaşım yapılmıştır)
    let permalink: string | null = null;
    try {
      const info = await graph("GET", mediaId, { fields: "permalink", access_token: igToken });
      permalink = typeof info.permalink === "string" ? info.permalink : null;
    } catch (e) {
      console.warn("permalink alınamadı", e);
    }

    // 6) posts satırını güncelle
    if (postId) {
      const { error: dbErr } = await admin.from("posts").update({
        status: "paylasildi",
        ig_media_id: mediaId,
        image_url: imageUrl,
        caption: input.caption,
      }).eq("id", postId);
      if (dbErr) console.error("posts güncellenemedi", dbErr);
    }

    return json({ ok: true, media_id: mediaId, permalink, image_url: imageUrl });
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500;
    const message = err instanceof HttpError ? err.message : "Beklenmeyen bir hata oluştu. Lütfen tekrar deneyin.";
    if (!(err instanceof HttpError)) console.error("Beklenmeyen hata", err);

    // Yetki/doğrulama hatalarında satıra dokunma; paylaşım denemesi başarısız olduysa 'hata' işaretle
    if (postId && status !== 401 && status !== 403) {
      const patch: Record<string, unknown> = { status: "hata" };
      if (imageUrl) patch.image_url = imageUrl;
      const { error: dbErr } = await admin.from("posts").update(patch).eq("id", postId);
      if (dbErr) console.error("posts 'hata' olarak işaretlenemedi", dbErr);
    }
    return json({ ok: false, error: message }, status);
  }
});
