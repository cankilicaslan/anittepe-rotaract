-- =====================================================================
-- Ankara Anıttepe Rotaract Kulübü — Üye paneli veritabanı şeması
-- Supabase > SQL Editor'a yapıştırıp "Run" deyin. Tekrar çalıştırmak
-- güvenlidir (tablolar/kayıtlar silinmez, politikalar yeniden kurulur).
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- 1. TABLOLAR
-- ---------------------------------------------------------------------

create table if not exists public.profiles (
  id             uuid primary key references auth.users(id) on delete cascade,
  full_name      text not null,
  phone          text,
  email          text,
  photo_url      text,
  title          text default 'Üye',
  roles          text[] not null default '{}',
  past_president boolean not null default false,
  status         text not null default 'pending',
  birth_date     date,
  profession     text,
  joined_at      date default current_date,
  created_at     timestamptz not null default now(),
  constraint profiles_status_chk check (status in ('pending','active','passive')),
  constraint profiles_roles_chk  check (roles <@ array['baskan','sayman','sekreter','pr','hizmet']::text[])
);

create table if not exists public.terms (
  id                  uuid primary key default gen_random_uuid(),
  name                text not null unique,
  start_date          date not null,
  meeting_count       int not null default 24,
  club_meeting_offset int not null default 599,
  opening_balance     numeric(12,2) not null default 0,
  is_current          boolean not null default true,
  constraint terms_meeting_count_chk check (meeting_count between 1 and 100)
);
-- Aynı anda yalnızca bir "güncel" dönem olabilir
create unique index if not exists terms_one_current_idx on public.terms (is_current) where is_current;

create table if not exists public.meetings (
  id       uuid primary key default gen_random_uuid(),
  term_id  uuid not null references public.terms(id) on delete cascade,
  term_no  int not null,
  club_no  int not null,
  date     date not null,
  note     text,
  constraint meetings_term_no_uniq unique (term_id, term_no),
  constraint meetings_term_no_chk check (term_no > 0)
);
create index if not exists meetings_term_idx on public.meetings (term_id, term_no);

create table if not exists public.attendance (
  meeting_id uuid not null references public.meetings(id) on delete cascade,
  member_id  uuid not null references public.profiles(id) on delete cascade,
  status     text not null,
  note       text,
  updated_at timestamptz not null default now(),
  primary key (meeting_id, member_id),
  constraint attendance_status_chk check (status in ('geldi','gelmedi','mazeretli'))
);
create index if not exists attendance_member_idx on public.attendance (member_id);

create table if not exists public.dues (
  id         uuid primary key default gen_random_uuid(),
  term_id    uuid references public.terms(id) on delete set null,
  label      text not null,
  period     text,
  amount     numeric(10,2) not null,
  due_date   date,
  created_at timestamptz not null default now(),
  constraint dues_period_chk check (period is null or period ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  constraint dues_amount_chk check (amount >= 0)
);
create index if not exists dues_term_idx on public.dues (term_id);

create table if not exists public.charges (
  id        uuid primary key default gen_random_uuid(),
  due_id    uuid not null references public.dues(id) on delete cascade,
  member_id uuid not null references public.profiles(id) on delete cascade,
  amount    numeric(10,2) not null,
  paid_at   date,
  constraint charges_due_member_uniq unique (due_id, member_id),
  constraint charges_amount_chk check (amount >= 0)
);
create index if not exists charges_member_idx on public.charges (member_id);

create table if not exists public.transactions (
  id          uuid primary key default gen_random_uuid(),
  term_id     uuid references public.terms(id) on delete set null,
  date        date not null default current_date,
  kind        text not null,
  category    text,
  description text,
  amount      numeric(12,2) not null,
  created_at  timestamptz not null default now(),
  constraint transactions_kind_chk   check (kind in ('gelir','gider')),
  constraint transactions_amount_chk check (amount > 0)
);
create index if not exists transactions_term_date_idx on public.transactions (term_id, date);

create table if not exists public.projects (
  id          uuid primary key default gen_random_uuid(),
  title       text not null,
  kind        text not null default 'hizmet',
  date        date,
  time        text,
  location    text,
  description text,
  plan        text,
  owner       text,
  status      text not null default 'planlandi',
  public      boolean not null default false,
  created_at  timestamptz not null default now(),
  constraint projects_kind_chk   check (kind in ('hizmet','etkinlik','ocakbasi','diger')),
  constraint projects_status_chk check (status in ('planlandi','devam','tamamlandi','iptal'))
);
create index if not exists projects_date_idx on public.projects (date);
create index if not exists projects_public_idx on public.projects (public) where public;

create table if not exists public.posts (
  id          uuid primary key default gen_random_uuid(),
  type        text not null,
  term_no     int,
  club_no     int,
  ocakbasi_no int,
  summary     text,
  caption     text,
  image_url   text,
  ig_media_id text,
  status      text not null default 'taslak',
  created_by  uuid default auth.uid() references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now(),
  constraint posts_type_chk   check (type in ('toplanti','ocakbasi','proje','etkinlik')),
  constraint posts_status_chk check (status in ('taslak','paylasildi','hata'))
);
create index if not exists posts_created_idx on public.posts (created_at desc);

-- ---------------------------------------------------------------------
-- 2. YARDIMCI FONKSİYONLAR (security definer → RLS döngüsüne girmez)
-- ---------------------------------------------------------------------

create or replace function public.is_active()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles p where p.id = auth.uid() and p.status = 'active');
$$;

create or replace function public.has_role(r text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles p
                 where p.id = auth.uid() and p.status = 'active' and r = any(p.roles));
$$;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select public.has_role('baskan');
$$;

create or replace function public.can_view_all()
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_admin() or exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.status = 'active' and p.past_president);
$$;

grant execute on function public.is_active(), public.has_role(text), public.is_admin(), public.can_view_all()
  to anon, authenticated;

-- ---------------------------------------------------------------------
-- 3. TETİKLEYİCİLER
-- ---------------------------------------------------------------------

-- 3a. Başkan olmayan kullanıcı kendi profilinde unvan/rol/durum/geçmiş başkan/e-posta değiştiremez.
--     (Bu alanlar sessizce eski değerine döndürülür.)
--     SQL Editor / service_role çağrılarında (JWT yok) kısıtlama uygulanmaz; ilk başkan böyle atanır.
-- Not: security definer DEĞİL; current_user çağıran rolü (anon/authenticated/service_role/postgres) göstermeli.
create or replace function public.protect_profile_fields()
returns trigger language plpgsql set search_path = public as $$
begin
  if public.is_admin() then
    return new;
  end if;
  if auth.uid() is null and current_user not in ('anon', 'authenticated') then
    return new;  -- SQL Editor (postgres) veya service_role
  end if;
  new.title          := old.title;
  new.roles          := old.roles;
  new.status         := old.status;
  new.past_president := old.past_president;
  new.email          := old.email;
  new.id             := old.id;
  new.created_at     := old.created_at;
  new.joined_at      := old.joined_at;
  return new;
end;
$$;

drop trigger if exists profiles_protect_fields on public.profiles;
create trigger profiles_protect_fields
  before update on public.profiles
  for each row execute function public.protect_profile_fields();

-- 3b. Yeni kayıt olan kullanıcı için "onay bekliyor" profili oluştur.
--     Ön yüz signUp çağrısında options.data = { full_name, phone } göndermelidir.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, full_name, phone, email, status, roles, past_president)
  values (
    new.id,
    coalesce(nullif(trim(new.raw_user_meta_data->>'full_name'), ''), split_part(new.email, '@', 1)),
    nullif(trim(new.raw_user_meta_data->>'phone'), ''),
    new.email,
    'pending', '{}', false
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- 3c. Yoklama satırı güncellenince updated_at
create or replace function public.touch_updated_at()
returns trigger language plpgsql set search_path = public as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists attendance_touch on public.attendance;
create trigger attendance_touch
  before insert or update on public.attendance
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------
-- 4. ROW LEVEL SECURITY
-- ---------------------------------------------------------------------

alter table public.profiles     enable row level security;
alter table public.terms        enable row level security;
alter table public.meetings     enable row level security;
alter table public.attendance   enable row level security;
alter table public.dues         enable row level security;
alter table public.charges      enable row level security;
alter table public.transactions enable row level security;
alter table public.projects     enable row level security;
alter table public.posts        enable row level security;

-- Tablo yetkileri (asıl sınır RLS politikalarıdır)
grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
revoke all on all tables in schema public from anon;
grant select on public.projects to anon;   -- yalnızca public = true satırlar (politika aşağıda)

-- ---- profiles ----
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated
  using (public.is_active() or id = auth.uid());

drop policy if exists profiles_insert on public.profiles;
create policy profiles_insert on public.profiles for insert to authenticated
  with check (id = auth.uid() and status = 'pending' and roles = '{}' and past_president = false);

drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

drop policy if exists profiles_update_admin on public.profiles;
create policy profiles_update_admin on public.profiles for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists profiles_delete on public.profiles;
create policy profiles_delete on public.profiles for delete to authenticated
  using (public.is_admin());

-- ---- terms ----
drop policy if exists terms_select on public.terms;
create policy terms_select on public.terms for select to authenticated
  using (public.is_active());

drop policy if exists terms_insert on public.terms;
create policy terms_insert on public.terms for insert to authenticated
  with check (public.has_role('sekreter') or public.is_admin());

drop policy if exists terms_update on public.terms;
create policy terms_update on public.terms for update to authenticated
  using (public.has_role('sekreter') or public.has_role('sayman') or public.is_admin())
  with check (public.has_role('sekreter') or public.has_role('sayman') or public.is_admin());

drop policy if exists terms_delete on public.terms;
create policy terms_delete on public.terms for delete to authenticated
  using (public.is_admin());

-- ---- meetings ----
drop policy if exists meetings_select on public.meetings;
create policy meetings_select on public.meetings for select to authenticated
  using (public.is_active());

drop policy if exists meetings_write on public.meetings;
create policy meetings_write on public.meetings for all to authenticated
  using (public.has_role('sekreter') or public.is_admin())
  with check (public.has_role('sekreter') or public.is_admin());

-- ---- attendance ----
drop policy if exists attendance_select on public.attendance;
create policy attendance_select on public.attendance for select to authenticated
  using (public.has_role('sekreter') or public.can_view_all()
         or (member_id = auth.uid() and public.is_active()));

drop policy if exists attendance_write on public.attendance;
create policy attendance_write on public.attendance for all to authenticated
  using (public.has_role('sekreter') or public.is_admin())
  with check (public.has_role('sekreter') or public.is_admin());

-- ---- dues ----
drop policy if exists dues_select on public.dues;
create policy dues_select on public.dues for select to authenticated
  using (public.has_role('sayman') or public.can_view_all()
         or (public.is_active() and exists (
               select 1 from public.charges c where c.due_id = dues.id and c.member_id = auth.uid())));

drop policy if exists dues_write on public.dues;
create policy dues_write on public.dues for all to authenticated
  using (public.has_role('sayman') or public.is_admin())
  with check (public.has_role('sayman') or public.is_admin());

-- ---- charges ----
drop policy if exists charges_select on public.charges;
create policy charges_select on public.charges for select to authenticated
  using (public.has_role('sayman') or public.can_view_all()
         or (member_id = auth.uid() and public.is_active()));

drop policy if exists charges_write on public.charges;
create policy charges_write on public.charges for all to authenticated
  using (public.has_role('sayman') or public.is_admin())
  with check (public.has_role('sayman') or public.is_admin());

-- ---- transactions ----
drop policy if exists transactions_select on public.transactions;
create policy transactions_select on public.transactions for select to authenticated
  using (public.has_role('sayman') or public.can_view_all());

drop policy if exists transactions_write on public.transactions;
create policy transactions_write on public.transactions for all to authenticated
  using (public.has_role('sayman') or public.is_admin())
  with check (public.has_role('sayman') or public.is_admin());

-- ---- projects ----
drop policy if exists projects_select_public on public.projects;
create policy projects_select_public on public.projects for select to anon, authenticated
  using (public = true);

drop policy if exists projects_select on public.projects;
create policy projects_select on public.projects for select to authenticated
  using (public.has_role('hizmet') or public.can_view_all());

drop policy if exists projects_write on public.projects;
create policy projects_write on public.projects for all to authenticated
  using (public.has_role('hizmet') or public.is_admin())
  with check (public.has_role('hizmet') or public.is_admin());

-- ---- posts ----
drop policy if exists posts_select on public.posts;
create policy posts_select on public.posts for select to authenticated
  using (public.has_role('pr') or public.can_view_all());

drop policy if exists posts_write on public.posts;
create policy posts_write on public.posts for all to authenticated
  using (public.has_role('pr') or public.is_admin())
  with check (public.has_role('pr') or public.is_admin());

-- ---------------------------------------------------------------------
-- 5. STORAGE (fotoğraflar ve Instagram görselleri)
-- ---------------------------------------------------------------------
-- avatars: herkes okuyabilir; üye yalnızca "<kendi uid>/dosya.jpg" yoluna yazar; başkan her yere.
-- posts:   herkes okuyabilir (Instagram'ın görseli çekebilmesi için şart); pr/başkan yazar.

insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true), ('posts', 'posts', true)
on conflict (id) do update set public = excluded.public;

drop policy if exists "avatars_read" on storage.objects;
create policy "avatars_read" on storage.objects for select to anon, authenticated
  using (bucket_id = 'avatars');

drop policy if exists "avatars_insert" on storage.objects;
create policy "avatars_insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars'
              and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin()));

drop policy if exists "avatars_update" on storage.objects;
create policy "avatars_update" on storage.objects for update to authenticated
  using (bucket_id = 'avatars'
         and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin()))
  with check (bucket_id = 'avatars'
              and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin()));

drop policy if exists "avatars_delete" on storage.objects;
create policy "avatars_delete" on storage.objects for delete to authenticated
  using (bucket_id = 'avatars'
         and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin()));

drop policy if exists "posts_read" on storage.objects;
create policy "posts_read" on storage.objects for select to anon, authenticated
  using (bucket_id = 'posts');

drop policy if exists "posts_insert" on storage.objects;
create policy "posts_insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'posts' and (public.has_role('pr') or public.is_admin()));

drop policy if exists "posts_update" on storage.objects;
create policy "posts_update" on storage.objects for update to authenticated
  using (bucket_id = 'posts' and (public.has_role('pr') or public.is_admin()))
  with check (bucket_id = 'posts' and (public.has_role('pr') or public.is_admin()));

drop policy if exists "posts_delete" on storage.objects;
create policy "posts_delete" on storage.objects for delete to authenticated
  using (bucket_id = 'posts' and (public.has_role('pr') or public.is_admin()));

-- ---------------------------------------------------------------------
-- 6. BAŞLANGIÇ VERİSİ: 2026-27 dönemi ve 24 toplantı
--    Toplantılar 2026-07-02'den itibaren 14 günde bir (Perşembe 19.30).
--    Kulüp toplantı no = 599 + dönem toplantı no (11. toplantı = 610. = 19 Kasım 2026).
-- ---------------------------------------------------------------------

insert into public.terms (name, start_date, meeting_count, club_meeting_offset, opening_balance, is_current)
select '2026-27', date '2026-07-02', 24, 599, 0, true
where not exists (select 1 from public.terms where name = '2026-27');

insert into public.meetings (term_id, term_no, club_no, date)
select t.id, n, t.club_meeting_offset + n, t.start_date + (n - 1) * 14
from public.terms t
cross join generate_series(1, 24) as n
where t.name = '2026-27'
on conflict (term_id, term_no) do nothing;

-- ---------------------------------------------------------------------
-- 7. İLK BAŞKAN
--    Önce sitedeki "Kayıt ol" formundan kendi hesabınızı açın, sonra
--    aşağıdaki satırın başındaki "-- " işaretini silip e-postanızı yazarak
--    yalnızca bu satırı çalıştırın:
-- ---------------------------------------------------------------------
-- update profiles set status='active', roles='{baskan}', title='Başkan' where email='ornek@eposta.com';

-- =====================================================================
-- -- v2  (Kasım 2026): Instagram ve kan grubu, kulüp etkinlikleri ve
--         katılım cevapları, duyurular, projelerin tüm üyelere açılması.
-- Bu bölüm de tekrar çalıştırılabilir. v1'i daha önce kurduysanız dosyanın
-- tamamını yeniden çalıştırmanız güvenlidir (veya yalnızca bu bölümü).
-- =====================================================================

-- ---------------------------------------------------------------------
-- v2.1 profiles.instagram
--      Üye kendisi düzenleyebilir. Koruma tetikleyicisi (protect_profile_fields)
--      yalnızca unvan/rol/durum/geçmiş başkan/e-posta/katılım tarihini kilitler,
--      bu yüzden tetikleyicide değişiklik gerekmez.
-- ---------------------------------------------------------------------
alter table public.profiles add column if not exists instagram text;

-- ---------------------------------------------------------------------
-- v2.2 profile_private: sağlık verisi (kan grubu). Diğer üyeler GÖREMEZ.
--      Okuma: üyenin kendisi, başkan, geçmiş başkanlar.
--      Yazma: üyenin kendisi, başkan.
-- ---------------------------------------------------------------------
create table if not exists public.profile_private (
  member_id  uuid primary key references public.profiles(id) on delete cascade,
  blood_type text,
  updated_at timestamptz not null default now(),
  constraint profile_private_blood_len_chk check (blood_type is null or char_length(blood_type) <= 12)
);

drop trigger if exists profile_private_touch on public.profile_private;
create trigger profile_private_touch
  before insert or update on public.profile_private
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------
-- v2.3 club_events: kulüplerin (bizim ve diğer kulüplerin) etkinlik takvimi
-- ---------------------------------------------------------------------
create table if not exists public.club_events (
  id          uuid primary key default gen_random_uuid(),
  club        text not null,
  title       text not null,
  date        date not null,
  time        text,
  location    text,
  description text,
  link        text,
  created_by  uuid default auth.uid() references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now()
);
create index if not exists club_events_date_idx on public.club_events (date);

-- ---------------------------------------------------------------------
-- v2.4 club_event_rsvps: üyenin etkinliğe katılım cevabı
-- ---------------------------------------------------------------------
create table if not exists public.club_event_rsvps (
  event_id   uuid not null references public.club_events(id) on delete cascade,
  member_id  uuid not null references public.profiles(id) on delete cascade,
  status     text not null,
  note       text,
  updated_at timestamptz not null default now(),
  primary key (event_id, member_id),
  constraint club_event_rsvps_status_chk check (status in ('katiliyorum','katilamiyorum'))
);
create index if not exists club_event_rsvps_member_idx on public.club_event_rsvps (member_id);

drop trigger if exists club_event_rsvps_touch on public.club_event_rsvps;
create trigger club_event_rsvps_touch
  before insert or update on public.club_event_rsvps
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------
-- v2.5 announcements: gönderilen duyuruların kaydı
--      sent_via: 'cihaz'  = ön yüz cihazın e-posta/SMS uygulamasını açtı (kaydı ön yüz ekler)
--                'sunucu' = "announce" Edge Function'ı gönderdi (kaydı fonksiyon ekler)
-- ---------------------------------------------------------------------
create table if not exists public.announcements (
  id            uuid primary key default gen_random_uuid(),
  kind          text not null default 'diger',
  subject       text,
  body          text,
  channels      text[] not null default '{}',
  recipient_ids uuid[] not null default '{}',
  sent_via      text not null default 'cihaz',
  result        jsonb,
  created_by    uuid default auth.uid() references public.profiles(id) on delete set null,
  created_at    timestamptz not null default now(),
  constraint announcements_kind_chk     check (kind in ('toplanti','etkinlik','proje','diger')),
  constraint announcements_sent_via_chk check (sent_via in ('cihaz','sunucu')),
  constraint announcements_channels_chk check (channels <@ array['email','sms']::text[])
);
create index if not exists announcements_created_idx on public.announcements (created_at desc);

-- ---------------------------------------------------------------------
-- v2.6 Yetkiler ve RLS
--      Supabase yeni tablolara anon'a da varsayılan yetki verir; geri alıyoruz.
-- ---------------------------------------------------------------------
alter table public.profile_private  enable row level security;
alter table public.club_events      enable row level security;
alter table public.club_event_rsvps enable row level security;
alter table public.announcements    enable row level security;

revoke all on public.profile_private, public.club_events, public.club_event_rsvps, public.announcements from anon;
grant select, insert, update, delete
  on public.profile_private, public.club_events, public.club_event_rsvps, public.announcements
  to authenticated;

-- ---- profile_private ----
drop policy if exists profile_private_select on public.profile_private;
create policy profile_private_select on public.profile_private for select to authenticated
  using (member_id = auth.uid() or public.can_view_all());

drop policy if exists profile_private_insert on public.profile_private;
create policy profile_private_insert on public.profile_private for insert to authenticated
  with check (member_id = auth.uid() or public.is_admin());

drop policy if exists profile_private_update on public.profile_private;
create policy profile_private_update on public.profile_private for update to authenticated
  using (member_id = auth.uid() or public.is_admin())
  with check (member_id = auth.uid() or public.is_admin());

drop policy if exists profile_private_delete on public.profile_private;
create policy profile_private_delete on public.profile_private for delete to authenticated
  using (member_id = auth.uid() or public.is_admin());

-- ---- club_events ----
drop policy if exists club_events_select on public.club_events;
create policy club_events_select on public.club_events for select to authenticated
  using (public.is_active());

drop policy if exists club_events_insert on public.club_events;
create policy club_events_insert on public.club_events for insert to authenticated
  with check (public.is_active() and (created_by = auth.uid() or public.is_admin()));

drop policy if exists club_events_update on public.club_events;
create policy club_events_update on public.club_events for update to authenticated
  using ((public.is_active() and created_by = auth.uid()) or public.is_admin())
  with check ((public.is_active() and created_by = auth.uid()) or public.is_admin());

drop policy if exists club_events_delete on public.club_events;
create policy club_events_delete on public.club_events for delete to authenticated
  using ((public.is_active() and created_by = auth.uid()) or public.is_admin());

-- ---- club_event_rsvps ----
drop policy if exists club_event_rsvps_select on public.club_event_rsvps;
create policy club_event_rsvps_select on public.club_event_rsvps for select to authenticated
  using (public.is_active());

drop policy if exists club_event_rsvps_insert on public.club_event_rsvps;
create policy club_event_rsvps_insert on public.club_event_rsvps for insert to authenticated
  with check (member_id = auth.uid() and public.is_active());

drop policy if exists club_event_rsvps_update on public.club_event_rsvps;
create policy club_event_rsvps_update on public.club_event_rsvps for update to authenticated
  using (member_id = auth.uid() and public.is_active())
  with check (member_id = auth.uid() and public.is_active());

drop policy if exists club_event_rsvps_delete on public.club_event_rsvps;
create policy club_event_rsvps_delete on public.club_event_rsvps for delete to authenticated
  using (member_id = auth.uid() and public.is_active());

-- ---- announcements ----
drop policy if exists announcements_select on public.announcements;
create policy announcements_select on public.announcements for select to authenticated
  using (public.is_admin() or public.has_role('sekreter') or public.has_role('pr') or public.can_view_all());

drop policy if exists announcements_insert on public.announcements;
create policy announcements_insert on public.announcements for insert to authenticated
  with check ((public.is_admin() or public.has_role('sekreter') or public.has_role('pr'))
              and created_by = auth.uid());

-- ---- projects: ortak aylık takvim için tüm aktif üyeler TÜM projeleri görür ----
--      (anon için "public = true" politikası projects_select_public aynen kalır)
drop policy if exists projects_select_members on public.projects;
create policy projects_select_members on public.projects for select to authenticated
  using (public.is_active());

-- =====================================================================
-- v3: misafir yoklaması, üyenin yoklamada başladığı toplantı, yetki etiketlerini gizleme
-- (Supabase SQL Editor'da bir kez çalıştırın; tekrar çalıştırmak zararsızdır.)
-- =====================================================================
alter table public.profiles add column if not exists hide_roles boolean not null default false;
alter table public.profiles add column if not exists start_meeting_id uuid references public.meetings(id) on delete set null;

create or replace function public.protect_profile_fields()
returns trigger language plpgsql set search_path = public as $$
begin
  if public.is_admin() then
    return new;
  end if;
  if auth.uid() is null and current_user not in ('anon', 'authenticated') then
    return new;  -- SQL Editor (postgres) veya service_role
  end if;
  new.title            := old.title;
  new.roles            := old.roles;
  new.status           := old.status;
  new.past_president   := old.past_president;
  new.email            := old.email;
  new.id               := old.id;
  new.created_at       := old.created_at;
  new.joined_at        := old.joined_at;
  new.hide_roles       := old.hide_roles;
  new.start_meeting_id := old.start_meeting_id;
  return new;
end;
$$;

create table if not exists public.guests (
  id         uuid primary key default gen_random_uuid(),
  full_name  text not null,
  phone      text,
  email      text,
  note       text,
  created_at timestamptz not null default now()
);

create table if not exists public.guest_attendance (
  meeting_id uuid not null references public.meetings(id) on delete cascade,
  guest_id   uuid not null references public.guests(id) on delete cascade,
  status     text not null,
  note       text,
  updated_at timestamptz not null default now(),
  primary key (meeting_id, guest_id),
  constraint guest_attendance_status_chk check (status in ('geldi','gelmedi','mazeretli'))
);
create index if not exists guest_attendance_guest_idx on public.guest_attendance (guest_id);

alter table public.guests           enable row level security;
alter table public.guest_attendance enable row level security;

drop policy if exists guests_select on public.guests;
create policy guests_select on public.guests for select to authenticated
  using (public.has_role('sekreter') or public.can_view_all());
drop policy if exists guests_write on public.guests;
create policy guests_write on public.guests for all to authenticated
  using (public.has_role('sekreter') or public.is_admin())
  with check (public.has_role('sekreter') or public.is_admin());

drop policy if exists guest_attendance_select on public.guest_attendance;
create policy guest_attendance_select on public.guest_attendance for select to authenticated
  using (public.has_role('sekreter') or public.can_view_all());
drop policy if exists guest_attendance_write on public.guest_attendance;
create policy guest_attendance_write on public.guest_attendance for all to authenticated
  using (public.has_role('sekreter') or public.is_admin())
  with check (public.has_role('sekreter') or public.is_admin());

-- =====================================================================
-- v4: Üye listesinde "siteye şifresini oluşturdu mu" belirteci
-- auth.users tarayıcıdan okunamaz; bu fonksiyon yalnızca evet/hayır ve son giriş tarihini verir.
-- Başkan, geçmiş dönem başkanları ve sekreter görür; diğerlerine boş döner.
-- =====================================================================
create or replace function public.member_accounts()
returns table (id uuid, has_password boolean, last_sign_in_at timestamptz)
language sql stable security definer set search_path = public, auth as $$
  select u.id, coalesce(u.encrypted_password, '') <> '', u.last_sign_in_at
  from auth.users u
  where public.can_view_all() or public.has_role('sekreter');
$$;
revoke all on function public.member_accounts() from public, anon;
grant execute on function public.member_accounts() to authenticated;

-- =====================================================================
-- v5: Doğum günü hatırlatması (her sabah 09.00'da başkan ve sekretere e-posta)
-- Önce birthday-reminder Edge Function'ını yükleyin ve "Verify JWT" ayarını kapatın.
-- =====================================================================
create table if not exists public.reminder_log (
  kind       text not null,
  day        date not null,
  created_at timestamptz not null default now(),
  primary key (kind, day)
);
alter table public.reminder_log enable row level security;  -- politika yok: yalnızca sunucu (service role) erişir

create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

select cron.unschedule(jobid) from cron.job where jobname = 'birthday-reminder';
select cron.schedule(
  'birthday-reminder',
  '0 6 * * *',  -- 06.00 UTC = 09.00 Türkiye
  $$ select net.http_post(
       url     := 'https://fyjcgfbooajuljebxnil.supabase.co/functions/v1/birthday-reminder',
       headers := '{"Content-Type": "application/json"}'::jsonb,
       body    := '{}'::jsonb
     ); $$
);

-- =====================================================================
-- v6: Fotoğraf arşivi
-- Başkan, sekreter ve Halkla İlişkiler (pr) yükleme linki (albüm) açar; aktif üyeler giriş yapıp
-- fotoğraf yükler ve arşivi görür. Fotoğraflar "photos" adlı özel (herkese açık olmayan) depoda durur.
-- =====================================================================
create or replace function public.can_manage_albums()
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_admin() or public.has_role('sekreter') or public.has_role('pr');
$$;
grant execute on function public.can_manage_albums() to authenticated;

create table if not exists public.albums (
  id         uuid primary key default gen_random_uuid(),
  type       text not null,
  name       text not null,
  date       date not null,
  cover_path text,
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  constraint albums_type_chk check (type in ('toplanti','ocakbasi','proje','etkinlik','diger'))
);
create index if not exists albums_type_date_idx on public.albums (type, date desc);

create table if not exists public.album_photos (
  id          uuid primary key default gen_random_uuid(),
  album_id    uuid not null references public.albums(id) on delete cascade,
  path        text not null,
  thumb_path  text not null,
  width       int,
  height      int,
  uploaded_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at  timestamptz not null default now()
);
create index if not exists album_photos_album_idx on public.album_photos (album_id, created_at);

-- İlk yüklenen fotoğraf albümün kapağı olur
create or replace function public.album_set_cover()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.albums set cover_path = new.thumb_path where id = new.album_id and cover_path is null;
  return new;
end;
$$;
drop trigger if exists album_photos_cover on public.album_photos;
create trigger album_photos_cover after insert on public.album_photos
  for each row execute function public.album_set_cover();

-- Kapak fotoğrafı silinirse sıradakini kapak yap
create or replace function public.album_fix_cover()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.albums a set cover_path = (
    select p.thumb_path from public.album_photos p where p.album_id = a.id order by p.created_at limit 1)
  where a.id = old.album_id and a.cover_path = old.thumb_path;
  return old;
end;
$$;
drop trigger if exists album_photos_uncover on public.album_photos;
create trigger album_photos_uncover after delete on public.album_photos
  for each row execute function public.album_fix_cover();

alter table public.albums       enable row level security;
alter table public.album_photos enable row level security;

drop policy if exists albums_select on public.albums;
create policy albums_select on public.albums for select to authenticated using (public.is_active());
drop policy if exists albums_write on public.albums;
create policy albums_write on public.albums for all to authenticated
  using (public.can_manage_albums()) with check (public.can_manage_albums());

drop policy if exists album_photos_select on public.album_photos;
create policy album_photos_select on public.album_photos for select to authenticated using (public.is_active());
drop policy if exists album_photos_insert on public.album_photos;
create policy album_photos_insert on public.album_photos for insert to authenticated
  with check (public.is_active() and uploaded_by = auth.uid());
drop policy if exists album_photos_delete on public.album_photos;
create policy album_photos_delete on public.album_photos for delete to authenticated
  using (uploaded_by = auth.uid() or public.can_manage_albums());

-- Depo: özel, en fazla 10 MB, yalnızca JPEG (tarayıcı yüklemeden önce JPEG'e çevirir)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('photos', 'photos', false, 10485760, array['image/jpeg'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "photos_read" on storage.objects;
create policy "photos_read" on storage.objects for select to authenticated
  using (bucket_id = 'photos' and public.is_active());
drop policy if exists "photos_insert" on storage.objects;
create policy "photos_insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'photos' and public.is_active());
drop policy if exists "photos_delete" on storage.objects;
create policy "photos_delete" on storage.objects for delete to authenticated
  using (bucket_id = 'photos' and (owner = auth.uid() or public.can_manage_albums()));

-- =====================================================================
-- v7: Gizli site sahibi (en yetkili hesap)
-- app_owners tablosundaki hesap her şeyi düzenleyebilir; başkan dahil hiç kimse onun yetkilerini,
-- durumunu ya da unvanını değiştiremez veya hesabını silemez. Tablo tarayıcıdan okunamaz ve
-- arayüzde hiçbir yerde gösterilmez. Sahip hesap SQL Editor'dan ayrıca eklenir (e-posta bu dosyada tutulmaz).
-- =====================================================================
create table if not exists public.app_owners (
  user_id uuid primary key references auth.users(id) on delete cascade
);
alter table public.app_owners enable row level security;  -- politika yok: kimse okuyamaz/yazamaz

create or replace function public.is_owner()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.app_owners where user_id = auth.uid());
$$;
revoke all on function public.is_owner() from public, anon;
grant execute on function public.is_owner() to authenticated;

-- Sahip, başkanın tüm yetkilerine sahiptir (rolü kaldırılsa bile)
create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select public.has_role('baskan') or public.is_owner();
$$;

create or replace function public.protect_profile_fields()
returns trigger language plpgsql set search_path = public as $$
begin
  -- Sahip hesabın yetki ve kimlik alanlarını kendisinden başkası değiştiremez
  if auth.uid() is not null and not public.is_owner()
     and exists (select 1 from public.app_owners where user_id = old.id) then
    new.title            := old.title;
    new.roles            := old.roles;
    new.status           := old.status;
    new.past_president   := old.past_president;
    new.hide_roles       := old.hide_roles;
    new.email            := old.email;
    new.id               := old.id;
    new.created_at       := old.created_at;
    return new;
  end if;
  if public.is_admin() then
    return new;
  end if;
  if auth.uid() is null and current_user not in ('anon', 'authenticated') then
    return new;  -- SQL Editor (postgres) veya service_role
  end if;
  new.title            := old.title;
  new.roles            := old.roles;
  new.status           := old.status;
  new.past_president   := old.past_president;
  new.email            := old.email;
  new.id               := old.id;
  new.created_at       := old.created_at;
  new.joined_at        := old.joined_at;
  new.hide_roles       := old.hide_roles;
  new.start_meeting_id := old.start_meeting_id;
  return new;
end;
$$;

-- Sahip hesabın profili silinemez
drop policy if exists profiles_delete on public.profiles;
create policy profiles_delete on public.profiles for delete to authenticated
  using (public.is_admin() and not exists (select 1 from public.app_owners o where o.user_id = profiles.id));

-- =====================================================================
-- v8: Site başvuruları (misafir üye, iletişim, panel kaydı)
-- basvuru Edge Function'ı her başvuruyu buraya kaydeder ve kulüp Gmail'ine iletir.
-- Yalnızca başkan, sekreter ve geçmiş dönem başkanları okuyabilir; tarayıcıdan yazılamaz.
-- =====================================================================
create table if not exists public.applications (
  id         uuid primary key default gen_random_uuid(),
  kind       text not null default 'iletisim',
  subject    text not null,
  body       text not null,
  reply_to   text,
  page       text,
  ip         text,
  emailed    boolean not null default false,
  created_at timestamptz not null default now(),
  constraint applications_kind_chk check (kind in ('misafir','iletisim','panel'))
);
create index if not exists applications_created_idx on public.applications (created_at desc);
create index if not exists applications_ip_idx on public.applications (ip, created_at);
alter table public.applications enable row level security;
drop policy if exists applications_select on public.applications;
create policy applications_select on public.applications for select to authenticated
  using (public.has_role('sekreter') or public.can_view_all());

-- =====================================================================
-- v9: Asbaşkan rolü — tüm yönetim panellerini görür, hiçbirini düzenleyemez
-- =====================================================================
alter table public.profiles drop constraint if exists profiles_roles_chk;
alter table public.profiles add constraint profiles_roles_chk
  check (roles <@ array['baskan','asbaskan','sayman','sekreter','pr','hizmet']::text[]);

-- Okuma yetkisi: başkan/sahip, geçmiş dönem başkanları ve asbaşkan (yazma yetkileri değişmez)
create or replace function public.can_view_all()
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_admin() or exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.status = 'active' and (p.past_president or 'asbaskan' = any(p.roles)));
$$;

-- =====================================================================
-- v10: Duyurular yalnızca başkan ve sekreterde (HİTK/pr çıkarıldı)
-- =====================================================================
drop policy if exists announcements_select on public.announcements;
create policy announcements_select on public.announcements for select to authenticated
  using (public.is_admin() or public.has_role('sekreter') or public.can_view_all());
drop policy if exists announcements_insert on public.announcements;
create policy announcements_insert on public.announcements for insert to authenticated
  with check ((public.is_admin() or public.has_role('sekreter')) and created_by = auth.uid());

-- =====================================================================
-- v11: Bağışlar (Rotary Vakfı vb.) ve proje formları
-- Kasaya "Bağış" kategorisinde gider girilince bağış listesine kendiliğinden aktarılır.
-- Bağışlar: sayman ve başkan yönetir. Proje formları: hizmet (HPK), sekreter ve başkan yönetir.
-- =====================================================================
alter table public.transactions add column if not exists donation_fund text;
alter table public.transactions add column if not exists donation_for  text;

create table if not exists public.donations (
  id               uuid primary key default gen_random_uuid(),
  tx_id            uuid unique references public.transactions(id) on delete cascade,
  date             date not null default current_date,
  fund             text,
  on_behalf        text,
  amount           numeric(12,2) not null check (amount > 0),
  note             text,
  district_form_at date,
  created_at       timestamptz not null default now()
);
create index if not exists donations_date_idx on public.donations (date desc);

create or replace function public.tx_to_donation()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.kind = 'gider' and new.category = 'Bağış' then
    insert into public.donations (tx_id, date, fund, on_behalf, amount, note)
    values (new.id, new.date, new.donation_fund, new.donation_for, new.amount, new.description)
    on conflict (tx_id) do nothing;
  end if;
  return new;
end;
$$;
drop trigger if exists transactions_to_donation on public.transactions;
create trigger transactions_to_donation after insert on public.transactions
  for each row execute function public.tx_to_donation();

alter table public.donations enable row level security;
drop policy if exists donations_select on public.donations;
create policy donations_select on public.donations for select to authenticated
  using (public.has_role('sayman') or public.can_view_all());
drop policy if exists donations_write on public.donations;
create policy donations_write on public.donations for all to authenticated
  using (public.has_role('sayman') or public.is_admin())
  with check (public.has_role('sayman') or public.is_admin());

-- Proje formları: komite ve bölgeye proje formunun girildiği tarih
alter table public.projects add column if not exists committee text;
alter table public.projects add column if not exists form_submitted_at date;

-- Sekreter de projeleri görür ve proje formu bilgisini işaretleyebilir
drop policy if exists projects_select on public.projects;
create policy projects_select on public.projects for select to authenticated
  using (public.has_role('hizmet') or public.has_role('sekreter') or public.can_view_all());
drop policy if exists projects_update_sekreter on public.projects;
create policy projects_update_sekreter on public.projects for update to authenticated
  using (public.has_role('sekreter')) with check (public.has_role('sekreter'));

-- =====================================================================
-- v12: Sekreter "Proje formları" sayfasından proje ekleyebilir
-- =====================================================================
drop policy if exists projects_insert_sekreter on public.projects;
create policy projects_insert_sekreter on public.projects for insert to authenticated
  with check (public.has_role('sekreter'));

-- =====================================================================
-- v13: Kasa takibi Excel düzenine göre
-- Kasa hareketine ödeyen / ödemeyi yapan kişi, etkinlik-proje adı ve misafirin toplantısı eklenir.
-- Bağış yapılan fon artık kalemin parçası ("Bağış – PolioPlus"); bu kalemler Bağışlar listesine düşer.
-- =====================================================================
alter table public.transactions add column if not exists person     text;
alter table public.transactions add column if not exists group_name text;
alter table public.transactions add column if not exists meeting_no int;

create or replace function public.tx_to_donation()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.kind = 'gider' and (new.category = 'Bağış' or new.category like 'Bağış – %') then
    insert into public.donations (tx_id, date, fund, on_behalf, amount, note)
    values (new.id, new.date,
            coalesce(new.donation_fund, nullif(substring(new.category from 'Bağış – (.*)$'), '')),
            new.donation_for, new.amount, new.description)
    on conflict (tx_id) do nothing;
  end if;
  return new;
end;
$$;

-- Eski "Bağış" kategorili giderleri yeni kalem adına taşı
update public.transactions set category = 'Bağış – ' || donation_fund
 where kind = 'gider' and category = 'Bağış' and donation_fund is not null;
-- Eski kategori adlarını Excel'deki kalemlere eşle
update public.transactions set category = 'Etkinlik gideri'         where kind = 'gider' and category = 'Etkinlik';
update public.transactions set category = 'Proje gideri'            where kind = 'gider' and category = 'Proje';
update public.transactions set category = 'Bölge katkı payı (BKP)'  where kind = 'gider' and category = 'Bölge katkı payı';
update public.transactions set category = 'Bağış geliri'            where kind = 'gelir' and category = 'Bağış';

-- =====================================================================
-- v14: "Üye tahsilatı" kalemi "Üye aidat tahsilatı" oldu
-- =====================================================================
update public.transactions set category = 'Üye aidat tahsilatı' where category = 'Üye tahsilatı';

-- =====================================================================
-- v15: Kasada etkinlik ve projeler (önce adıyla açılır, gelir/giderleri içinden girilir)
-- =====================================================================
create table if not exists public.kasa_groups (
  id         uuid primary key default gen_random_uuid(),
  term_id    uuid references public.terms(id) on delete cascade,
  kind       text not null check (kind in ('etkinlik','proje')),
  name       text not null,
  created_at timestamptz not null default now(),
  unique (term_id, kind, name)
);
alter table public.kasa_groups enable row level security;
drop policy if exists kasa_groups_select on public.kasa_groups;
create policy kasa_groups_select on public.kasa_groups for select to authenticated
  using (public.has_role('sayman') or public.can_view_all());
drop policy if exists kasa_groups_write on public.kasa_groups;
create policy kasa_groups_write on public.kasa_groups for all to authenticated
  using (public.has_role('sayman') or public.is_admin())
  with check (public.has_role('sayman') or public.is_admin());

-- Excel'deki "Proje x" sayfasında yer alan önceki dönem borç ödemeleri kendi kaydı altında toplansın
update public.transactions set group_name = 'Önceki dönemden kalan borçlar'
 where category = 'Proje gideri' and group_name is null and description like '%önceki dönemden kalan borç%';

-- Kasadaki mevcut etkinlik/proje adlarını listeye ekle
insert into public.kasa_groups (term_id, kind, name)
select distinct term_id, case when category like 'Proje%' then 'proje' else 'etkinlik' end, group_name
  from public.transactions
 where group_name is not null and (category like 'Proje%' or category like 'Etkinlik%')
on conflict do nothing;

select kind, name from public.kasa_groups order by kind, name;

-- =====================================================================
-- v16: Önceki dönem borç ödemeleri proje değil; normal kasa gideri ("Diğer gider")
-- =====================================================================
update public.transactions set group_name = null, category = 'Diğer gider'
 where group_name = 'Önceki dönemden kalan borçlar';
delete from public.kasa_groups where name = 'Önceki dönemden kalan borçlar';

select kind, name from public.kasa_groups order by kind, name;

-- =====================================================================
-- v17: Rozet satışı alanları, borç ödemeleri ve "Parti" adı
-- (Aidat taksitleri ve Excel'deki ödemeler kişisel veri içerdiği için ayrı, depoya girmeyen bir SQL ile işlendi.)
-- =====================================================================
alter table public.transactions add column if not exists badge      text;
alter table public.transactions add column if not exists qty        int;
alter table public.transactions add column if not exists unit_price numeric(12,2);

update public.transactions set group_name = null, category = 'Diğer gider'
 where group_name = 'Önceki dönemden kalan borçlar';
delete from public.kasa_groups where name = 'Önceki dönemden kalan borçlar';

update public.transactions set group_name = 'Döneme Merhaba Partisi' where group_name = 'Parti' and category like 'Etkinlik%';
update public.kasa_groups  set name = 'Döneme Merhaba Partisi' where name = 'Parti' and kind = 'etkinlik';

-- =====================================================================
-- v18: Panel hesabı (e-postası) olmayan üyeler de listeye eklenebilsin
-- (Eklenen üyeler kişisel veri içerdiği için ayrı bir SQL ile işlendi.)
-- =====================================================================
do $$
declare c text;
begin
  select conname into c from pg_constraint
   where conrelid = 'public.profiles'::regclass and contype = 'f' and confrelid = 'auth.users'::regclass;
  if c is not null then execute format('alter table public.profiles drop constraint %I', c); end if;
end $$;
alter table public.profiles alter column id set default gen_random_uuid();

-- =====================================================================
-- v20: HİTK site düzenleme paneli — istekler, yapay zekâ yanıtları ve yayın kayıtları
-- =====================================================================
create table if not exists public.site_edits (
  id            uuid primary key default gen_random_uuid(),
  created_at    timestamptz not null default now(),
  session_id    uuid not null,
  user_id       uuid,
  user_name     text,
  prompt        text not null,
  reply         text,
  edits         jsonb not null default '[]'::jsonb,
  status        text not null default 'onerildi',
  error         text,
  revert_of     uuid references public.site_edits(id) on delete set null,
  commit_urls   text[],
  published_at  timestamptz,
  model         text,
  input_tokens  int,
  output_tokens int,
  constraint site_edits_status_chk check (status in ('onerildi','yayinlandi','reddedildi','hata','yanit'))
);
create index if not exists site_edits_created_idx on public.site_edits (created_at desc);
create index if not exists site_edits_session_idx on public.site_edits (session_id, created_at);
alter table public.site_edits enable row level security;
-- Okuma: HİTK görevlisi (ve kulüp sahibi hesap). Yazma yalnızca site-edit fonksiyonu (service role) üzerinden.
drop policy if exists site_edits_select on public.site_edits;
create policy site_edits_select on public.site_edits for select to authenticated
  using (public.has_role('pr') or public.is_owner());

-- =====================================================================
-- v21: Toplantı numaraları bir ileri (19 Kasım 2026 = kulübün 611., dönemin 12. toplantısı)
-- =====================================================================
do $$
declare t uuid;
begin
  select id into t from public.terms where is_current;
  -- benzersizlik kısıtı çakışmasın diye iki adımda
  update public.meetings set term_no = term_no + 1000 where term_id = t;
  update public.meetings set term_no = term_no - 999, club_no = club_no + 1 where term_id = t;
  update public.terms set club_meeting_offset = club_meeting_offset + 1 where id = t;
  -- Kasadaki misafir ücretleri kulüp toplantı numarasıyla tutuluyor
  update public.transactions set meeting_no = meeting_no + 1 where term_id = t and meeting_no is not null;
end $$;

select term_no, club_no, date from public.meetings
 where term_id = (select id from public.terms where is_current) and date between '2026-11-01' and '2026-12-01' order by date;

-- =====================================================================
-- v22: Toplantı tarihleri (WhatsApp duyurularına göre) ve tür etiketi
-- =====================================================================
alter table public.meetings add column if not exists label text;   -- ör. "Rotary ortak", "Yaz ortak", "BRT ziyareti"
-- 2026-27 için uygulanan veri düzeltmeleri (yalnızca bu dönem):
--   600 eklendi (5 Temmuz), 601 23 Tem, 602 6 Ağu, 603 20 Ağu, 604 3 Eyl, 605 17 Eyl, 606 15 Eyl,
--   607 1 Eki, 608 15 Eki, 609 27 Eki, 610 7 Kas, 611 19 Kas; meeting_count = toplantı satırı sayısı.

-- =====================================================================
-- v23: Kulüp geneli ayarlar (ör. aidat hatırlatmasındaki ödeme bilgisi: key = 'wa_pay')
-- =====================================================================
create table if not exists public.app_settings (
  key        text primary key,
  value      text,
  updated_at timestamptz not null default now(),
  updated_by uuid
);
alter table public.app_settings enable row level security;
drop policy if exists app_settings_select on public.app_settings;
create policy app_settings_select on public.app_settings for select to authenticated using (public.is_active());
drop policy if exists app_settings_write on public.app_settings;
create policy app_settings_write on public.app_settings for all to authenticated
  using (public.has_role('sayman') or public.is_admin())
  with check (public.has_role('sayman') or public.is_admin());
-- Değer panelden (Aidat hatırlatma → Ödeme bilgisi → Değiştir) girilir; kişisel bilgi olduğu için burada tutulmaz.

-- =====================================================================
-- v24: Anasayfa yönetim/komite fotoğrafları panelden güncel gelir (yalnızca istenen isimler, aktif üyeler)
-- =====================================================================
create or replace function public.public_member_photos(names text[])
returns table(full_name text, photo_url text)
language sql stable security definer set search_path = public as $$
  select p.full_name, p.photo_url from public.profiles p
   where p.status = 'active' and p.full_name = any(names)
     and coalesce(p.photo_url, '') like 'http%';
$$;
revoke all on function public.public_member_photos(text[]) from public;
grant execute on function public.public_member_photos(text[]) to anon, authenticated;

-- =====================================================================
-- v25: Instagram ocakbaşı ev sahibi listesi için misafir adları (telefon/e-posta olmadan)
-- =====================================================================
create or replace function public.guest_names()
returns table(full_name text)
language sql stable security definer set search_path = public as $$
  select g.full_name from public.guests g
   where public.has_role('pr') or public.has_role('sekreter') or public.can_view_all()
   order by g.full_name;
$$;
revoke all on function public.guest_names() from public;
grant execute on function public.guest_names() to authenticated;

-- =====================================================================
-- v26: Komite başkanlığı rolleri (panel yetkileri ve üye listesinde görev olarak görünür)
-- =====================================================================
alter table public.profiles drop constraint if exists profiles_roles_chk;
alter table public.profiles add constraint profiles_roles_chk
  check (roles <@ array['baskan','asbaskan','sayman','sekreter','pr','hizmet','uyelik','uluslararasi','kulup','meslek','afet','hobi','interact']::text[]);

-- =====================================================================
-- v27: Başkan Mektubu (panelde hazırlanır, PDF indirilir, yalnızca Başkan yayınlar)
-- =====================================================================
create or replace function public.letter_editor()
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_admin() or public.has_role('sekreter') or public.has_role('kulup');
$$;
revoke all on function public.letter_editor() from public, anon;
grant execute on function public.letter_editor() to authenticated;

create table if not exists public.letters (
  id              uuid primary key default gen_random_uuid(),
  term_id         uuid not null references public.terms(id) on delete cascade,
  issue_no        int  not null check (issue_no > 0),
  period          text not null default '',
  status          text not null default 'taslak',
  pages           jsonb not null default '[]'::jsonb,
  folders         jsonb not null default '{}'::jsonb,
  published_pages jsonb,
  published_at    timestamptz,
  updated_at      timestamptz not null default now(),
  updated_by      uuid,
  constraint letters_status_chk check (status in ('taslak','yayinda')),
  constraint letters_issue_uniq unique (term_id, issue_no)
);
alter table public.letters enable row level security;

-- Yayın alanlarını (status, published_pages, published_at) yalnızca yayın fonksiyonları değiştirir.
create or replace function public.letters_guard()
returns trigger language plpgsql set search_path = public as $$
begin
  if coalesce(current_setting('app.letter_publish', true), '') <> '1' then
    if tg_op = 'INSERT' then
      new.status := 'taslak'; new.published_pages := null; new.published_at := null;
    else
      new.status := old.status; new.published_pages := old.published_pages; new.published_at := old.published_at;
    end if;
  end if;
  new.updated_at := clock_timestamp();  -- her kayıtta farklı damga (çakışma kontrolü buna dayanır)
  new.updated_by := coalesce(auth.uid(), new.updated_by);
  return new;
end $$;
drop trigger if exists letters_guard on public.letters;
create trigger letters_guard before insert or update on public.letters
  for each row execute function public.letters_guard();

drop policy if exists letters_select_anon on public.letters;
create policy letters_select_anon on public.letters for select to anon using (status = 'yayinda');
drop policy if exists letters_select on public.letters;
-- Giriş yapmış üyeler taslağı (pages, folders) görmesin: sitede yayın anon olarak okunur.
create policy letters_select on public.letters for select to authenticated
  using (public.letter_editor() or public.can_view_all());
drop policy if exists letters_insert on public.letters;
create policy letters_insert on public.letters for insert to authenticated with check (public.letter_editor());
drop policy if exists letters_update on public.letters;
create policy letters_update on public.letters for update to authenticated
  using (public.letter_editor()) with check (public.letter_editor());
drop policy if exists letters_delete on public.letters;
create policy letters_delete on public.letters for delete to authenticated using (public.is_admin());

-- Ziyaretçi (anon) yalnızca yayın sütunlarını görür; taslak içerik (pages, folders) kapalı.
revoke all on public.letters from anon;
grant select (id, term_id, issue_no, period, status, published_pages, published_at) on public.letters to anon;
grant select, insert, update, delete on public.letters to authenticated;

create or replace function public.publish_letter(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Yalnızca Başkan yayınlayabilir'; end if;
  perform set_config('app.letter_publish', '1', true);
  update public.letters set status = 'yayinda', published_pages = pages, published_at = now() where id = p_id;
  if not found then raise exception 'Mektup bulunamadı'; end if;
end $$;
create or replace function public.unpublish_letter(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Yalnızca Başkan yayından kaldırabilir'; end if;
  perform set_config('app.letter_publish', '1', true);
  update public.letters set status = 'taslak', published_pages = null, published_at = null where id = p_id;
  if not found then raise exception 'Mektup bulunamadı'; end if;
end $$;
revoke all on function public.publish_letter(uuid) from public, anon;
revoke all on function public.unpublish_letter(uuid) from public, anon;
grant execute on function public.publish_letter(uuid) to authenticated;
grant execute on function public.unpublish_letter(uuid) to authenticated;

-- Mektup görselleri: herkes okur, yalnızca düzenleyiciler yazar/siler.
insert into storage.buckets (id, name, public) values ('letters', 'letters', true) on conflict (id) do nothing;
drop policy if exists "letters_read" on storage.objects;
create policy "letters_read" on storage.objects for select to anon, authenticated using (bucket_id = 'letters');
drop policy if exists "letters_insert" on storage.objects;
create policy "letters_insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'letters' and public.letter_editor());
drop policy if exists "letters_update" on storage.objects;
create policy "letters_update" on storage.objects for update to authenticated
  using (bucket_id = 'letters' and public.letter_editor());
drop policy if exists "letters_delete" on storage.objects;
create policy "letters_delete" on storage.objects for delete to authenticated
  using (bucket_id = 'letters' and public.letter_editor());

-- Misafir adları (Anıttepeliler Köşesi için) Kulüp Hizmetleri'ne de açık.
create or replace function public.guest_names()
returns table(full_name text)
language sql stable security definer set search_path = public as $$
  select g.full_name from public.guests g
   where public.has_role('pr') or public.has_role('sekreter') or public.has_role('kulup') or public.can_view_all()
   order by g.full_name;
$$;

-- Künye: Rotary ve bölge yöneticileri (herkese açık görevler). Kulüp yönetim kurulu panelden okunur.
insert into public.app_settings (key, value) values ('letter_kunye', '[
 {"title":"Uluslararası Rotary Kurucusu","name":"Paul HARRIS"},
 {"title":"Uluslararası Rotary Başkanı","name":"Rtn. Olayinka Hakeem BABALOLA"},
 {"title":"UR Bölge 2430 Guvernörü","name":"Rtn. Orhan ULUDAĞ & Zeynep"},
 {"title":"UR Bölge 2430 Bölge Rotaract Temsilcisi","name":"Rtn. Rtc. Alper ABACIGİL & Irmak"},
 {"title":"1.Grup Kulüplerinden Sorumlu BRT Yardımcısı","name":"Rtc. Mert TOKTAŞ"}
]') on conflict (key) do nothing;
drop policy if exists app_settings_write on public.app_settings;
create policy app_settings_write on public.app_settings for all to authenticated
  using (public.has_role('sayman') or public.is_admin() or (key = 'letter_kunye' and public.letter_editor()))
  with check (public.has_role('sayman') or public.is_admin() or (key = 'letter_kunye' and public.letter_editor()));

-- =====================================================================
-- v28: Başkan Mektubu yeniden yayın: ilk yayın tarihi korunur (sitede sıra ve dönem kaymasın)
-- ==============================================================
-- =====================================================================
create or replace function public.publish_letter(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Yalnızca Başkan yayınlayabilir'; end if;
  perform set_config('app.letter_publish', '1', true);
  update public.letters set status = 'yayinda', published_pages = pages, published_at = coalesce(published_at, now()) where id = p_id;
  if not found then raise exception 'Mektup bulunamadı'; end if;
end $$;
revoke all on function public.publish_letter(uuid) from public, anon;
grant execute on function public.publish_letter(uuid) to authenticated;
=======
-- v29: Üye-Misafir listesi (misafir adları tüm aktif üyelere) ve komite paneli notları
-- =====================================================================
create or replace function public.guest_names()
returns table(full_name text)
language sql stable security definer set search_path = public as $$
  select g.full_name from public.guests g
   where public.is_active()
   order by g.full_name;
$$;
-- Komite notları: app_settings anahtarı komite_notes_<rol>; yalnızca o komitenin başkanı ya da Başkan yazar.
drop policy if exists app_settings_write on public.app_settings;
create policy app_settings_write on public.app_settings for all to authenticated
  using (public.has_role('sayman') or public.is_admin()
         or (key = 'letter_kunye' and public.letter_editor())
         or (key like 'komite\_notes\_%' and public.has_role(substr(key, 14))))
  with check (public.has_role('sayman') or public.is_admin()
         or (key = 'letter_kunye' and public.letter_editor())
         or (key like 'komite\_notes\_%' and public.has_role(substr(key, 14))));

-- =====================================================================
-- v30: Duyurular misafirlere de gider: duyuru yapan HİTK misafir iletişim bilgilerini okuyabilir
-- =====================================================================
drop policy if exists guests_select on public.guests;
create policy guests_select on public.guests for select to authenticated
  using (public.has_role('sekreter') or public.has_role('pr') or public.can_view_all());

-- =====================================================================
-- v31: Tüm komite başkanları misafir iletişim bilgilerini görür (üye bilgileri zaten tüm üyelere açık)
-- =====================================================================
create or replace function public.is_committee_chair()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles p
                 where p.id = auth.uid() and p.status = 'active'
                   and p.roles && array['hizmet','uyelik','uluslararasi','pr','kulup','meslek','afet','hobi','interact']::text[]);
$$;
revoke all on function public.is_committee_chair() from public, anon;
grant execute on function public.is_committee_chair() to authenticated;
drop policy if exists guests_select on public.guests;
create policy guests_select on public.guests for select to authenticated
  using (public.has_role('sekreter') or public.is_committee_chair() or public.can_view_all());

-- =====================================================================
-- v32: Anasayfa komite başkanları panelden: aktif üyelerin komite rolleri (yalnızca ad, rol, fotoğraf)
-- =====================================================================
create or replace function public.public_committee_chairs()
returns table(role text, full_name text, photo_url text)
language sql stable security definer set search_path = public as $$
  select r.role, p.full_name, p.photo_url
    from public.profiles p
    cross join lateral unnest(p.roles) as r(role)
   where p.status = 'active' and coalesce(p.hide_roles, false) = false
     and r.role = any(array['hizmet','uyelik','uluslararasi','pr','kulup','meslek','afet','hobi','interact'])
   order by p.full_name;
$$;
revoke all on function public.public_committee_chairs() from public;
grant execute on function public.public_committee_chairs() to anon, authenticated;

-- =====================================================================
-- v33: Misafiri üye yap (Başkan/sahip). Profil davetle oluşturulduktan sonra çağrılır:
--      üyelik tarihinden sonraki taksitler borç olur, misafir devamı üyeye aktarılır, misafir kaydı silinir.
-- =====================================================================
create or replace function public.convert_guest(p_guest uuid, p_member uuid, p_joined date)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_att int := 0; v_ch int := 0; v_first uuid;
begin
  if not public.is_admin() then raise exception 'Üye almak için Başkan yetkisi gerekiyor'; end if;
  if not exists (select 1 from public.guests where id = p_guest) then raise exception 'Misafir bulunamadı'; end if;
  if not exists (select 1 from public.profiles where id = p_member) then raise exception 'Üye profili bulunamadı'; end if;
  -- Devam: misafirken katıldığı toplantılar üyenin yoklamasına aktarılır
  insert into public.attendance (meeting_id, member_id, status, note)
    select ga.meeting_id, p_member, ga.status, ga.note from public.guest_attendance ga where ga.guest_id = p_guest
  on conflict (meeting_id, member_id) do nothing;
  get diagnostics v_att = row_count;
  -- Devam oranı misafir olarak geldiği ilk toplantıdan (yoksa üyelik tarihinden sonraki ilk toplantıdan) başlar
  select m.id into v_first from public.guest_attendance ga join public.meetings m on m.id = ga.meeting_id
   where ga.guest_id = p_guest order by m.date nulls last, m.term_no limit 1;
  if v_first is null then
    select m.id into v_first from public.meetings m where m.date >= p_joined order by m.date, m.term_no limit 1;
  end if;
  update public.profiles set joined_at = p_joined, start_meeting_id = coalesce(v_first, start_meeting_id) where id = p_member;
  -- Aidat: son ödeme tarihi üyelik tarihinden sonra (ya da aynı gün) olan taksitler borç olarak eklenir
  insert into public.charges (due_id, member_id, amount)
    select d.id, p_member, d.amount from public.dues d where d.due_date >= p_joined
  on conflict (due_id, member_id) do nothing;
  get diagnostics v_ch = row_count;
  delete from public.guests where id = p_guest;
  return jsonb_build_object('attendance', v_att, 'charges', v_ch);
end $$;
revoke all on function public.convert_guest(uuid, uuid, date) from public, anon;
grant execute on function public.convert_guest(uuid, uuid, date) to authenticated;

-- =====================================================================
-- v34: Başkan Mektubu'nu Sekreter yerine HİTK hazırlar; Sekreter bağışları görüntüler
-- =====================================================================
create or replace function public.letter_editor()
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_admin() or public.has_role('pr') or public.has_role('kulup');
$$;
drop policy if exists donations_select on public.donations;
create policy donations_select on public.donations for select to authenticated
  using (public.has_role('sayman') or public.has_role('sekreter') or public.can_view_all());

-- =====================================================================
-- v35: Yönetim kurulu üyesi görevi (ykuye): özel paneli yok, üye görünümü; listede YK etiketi
-- =====================================================================
alter table public.profiles drop constraint if exists profiles_roles_chk;
alter table public.profiles add constraint profiles_roles_chk
  check (roles <@ array['baskan','asbaskan','sayman','sekreter','ykuye','pr','hizmet','uyelik','uluslararasi','kulup','meslek','afet','hobi','interact']::text[]);

-- =====================================================================
-- v36: Gelecek dönemi planla (2027-28 taslak dönemi)
--      Pasif dönem satırı; dönem tablolarına "aktif dönem ya da planlayıcı" kapısı.
--      Planlayıcı = asbaşkan ya da site sahibi (başkan ve GDB değil).
-- =====================================================================
create or replace function public.is_planner()
returns boolean language sql stable security definer set search_path = public as $$
  select public.has_role('asbaskan') or public.is_owner();
$$;
create or replace function public.term_is_current(p_term uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select p_term is null or exists (select 1 from public.terms t where t.id = p_term and t.is_current);
$$;
revoke all on function public.is_planner(), public.term_is_current(uuid) from public;
grant execute on function public.is_planner() to authenticated;
grant execute on function public.term_is_current(uuid) to anon, authenticated;

-- Plan dönemi (yoksa oluşturur). Yalnızca planlayıcı.
create or replace function public.ensure_plan_term()
returns public.terms language plpgsql security definer set search_path = public as $$
declare c public.terms; p public.terms;
begin
  if not public.is_planner() then raise exception 'Planlama yalnızca asbaşkana açık'; end if;
  select * into p from public.terms where name = '2027-28';
  if found then return p; end if;
  select * into c from public.terms where is_current;
  insert into public.terms (name, start_date, meeting_count, club_meeting_offset, opening_balance, is_current)
  values ('2027-28', date '2027-07-01', 24, coalesce(c.club_meeting_offset + c.meeting_count, 599), 0, false)
  returning * into p;
  return p;
end $$;
revoke all on function public.ensure_plan_term() from public, anon;
grant execute on function public.ensure_plan_term() to authenticated;

-- Projelere dönem
alter table public.projects add column if not exists term_id uuid references public.terms(id) on delete set null;
create index if not exists projects_term_idx on public.projects (term_id);

-- Dönemi boş eski kayıtlar aktif döneme bağlanır
update public.dues         set term_id = (select id from public.terms where is_current) where term_id is null;
update public.transactions set term_id = (select id from public.terms where is_current) where term_id is null;
update public.kasa_groups  set term_id = (select id from public.terms where is_current) where term_id is null;
update public.projects     set term_id = (select id from public.terms where is_current) where term_id is null;

-- Kapı: aktif olmayan dönemin satırlarını yalnızca planlayıcı okur/yazar
drop policy if exists dues_term_gate on public.dues;
create policy dues_term_gate on public.dues as restrictive for all to authenticated
  using (public.term_is_current(term_id) or public.is_planner()) with check (public.term_is_current(term_id) or public.is_planner());
drop policy if exists transactions_term_gate on public.transactions;
create policy transactions_term_gate on public.transactions as restrictive for all to authenticated
  using (public.term_is_current(term_id) or public.is_planner()) with check (public.term_is_current(term_id) or public.is_planner());
drop policy if exists kasa_groups_term_gate on public.kasa_groups;
create policy kasa_groups_term_gate on public.kasa_groups as restrictive for all to authenticated
  using (public.term_is_current(term_id) or public.is_planner()) with check (public.term_is_current(term_id) or public.is_planner());
drop policy if exists projects_term_gate on public.projects;
create policy projects_term_gate on public.projects as restrictive for all to authenticated
  using (public.term_is_current(term_id) or public.is_planner()) with check (public.term_is_current(term_id) or public.is_planner());
drop policy if exists projects_anon_gate on public.projects;
create policy projects_anon_gate on public.projects as restrictive for select to anon
  using (public.term_is_current(term_id));
-- charges kapısı dues politikalarını tetiklemesin (dues_select charges okur → sonsuz döngü): security definer yardımcı
create or replace function public.due_term_ok(p_due uuid)
returns boolean language sql stable security definer set search_path = public as $
  select exists (select 1 from public.dues d where d.id = p_due and (public.term_is_current(d.term_id) or public.is_planner()));
$;
revoke all on function public.due_term_ok(uuid) from public, anon;
grant execute on function public.due_term_ok(uuid) to authenticated;
drop policy if exists charges_term_gate on public.charges;
create policy charges_term_gate on public.charges as restrictive for all to authenticated
  using (public.due_term_ok(due_id)) with check (public.due_term_ok(due_id));
drop policy if exists terms_plan_gate on public.terms;
create policy terms_plan_gate on public.terms as restrictive for select to authenticated
  using (is_current or public.is_planner());

-- Planlayıcı taslak dönemde yazar (rol kısıtlarından bağımsız)
drop policy if exists dues_planner_write on public.dues;
create policy dues_planner_write on public.dues for all to authenticated
  using (not public.term_is_current(term_id) and public.is_planner()) with check (not public.term_is_current(term_id) and public.is_planner());
drop policy if exists transactions_planner_write on public.transactions;
create policy transactions_planner_write on public.transactions for all to authenticated
  using (not public.term_is_current(term_id) and public.is_planner()) with check (not public.term_is_current(term_id) and public.is_planner());
drop policy if exists kasa_groups_planner_write on public.kasa_groups;
create policy kasa_groups_planner_write on public.kasa_groups for all to authenticated
  using (not public.term_is_current(term_id) and public.is_planner()) with check (not public.term_is_current(term_id) and public.is_planner());
drop policy if exists projects_planner_write on public.projects;
create policy projects_planner_write on public.projects for all to authenticated
  using (not public.term_is_current(term_id) and public.is_planner()) with check (not public.term_is_current(term_id) and public.is_planner());

-- YK planı (taslak; kimseye görev vermez)
create table if not exists public.term_board_plans (
  term_id    uuid primary key references public.terms(id) on delete cascade,
  slots      jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id) on delete set null
);
alter table public.term_board_plans enable row level security;
drop policy if exists term_board_plans_planner on public.term_board_plans;
create policy term_board_plans_planner on public.term_board_plans for all to authenticated
  using (public.is_planner()) with check (public.is_planner());

-- Taslak dönemin "Bağış" gideri bugünkü Bağışlar listesine düşmez
create or replace function public.tx_to_donation()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not public.term_is_current(new.term_id) then return new; end if;
  if new.kind = 'gider' and (new.category = 'Bağış' or new.category like 'Bağış – %') then
    insert into public.donations (tx_id, date, fund, on_behalf, amount, note)
    values (new.id, new.date,
            coalesce(new.donation_fund, nullif(substring(new.category from 'Bağış – (.*)$'), '')),
            new.donation_for, new.amount, new.description)
    on conflict (tx_id) do nothing;
  end if;
  return new;
end;
$$;

-- Misafiri üye yaparken yalnızca aktif dönemin taksitleri borç olur
create or replace function public.convert_guest(p_guest uuid, p_member uuid, p_joined date)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_att int := 0; v_ch int := 0; v_first uuid;
begin
  if not public.is_admin() then raise exception 'Üye almak için Başkan yetkisi gerekiyor'; end if;
  if not exists (select 1 from public.guests where id = p_guest) then raise exception 'Misafir bulunamadı'; end if;
  if not exists (select 1 from public.profiles where id = p_member) then raise exception 'Üye profili bulunamadı'; end if;
  insert into public.attendance (meeting_id, member_id, status, note)
    select ga.meeting_id, p_member, ga.status, ga.note from public.guest_attendance ga where ga.guest_id = p_guest
  on conflict (meeting_id, member_id) do nothing;
  get diagnostics v_att = row_count;
  select m.id into v_first from public.guest_attendance ga join public.meetings m on m.id = ga.meeting_id
   where ga.guest_id = p_guest order by m.date nulls last, m.term_no limit 1;
  if v_first is null then
    select m.id into v_first from public.meetings m where m.date >= p_joined order by m.date, m.term_no limit 1;
  end if;
  update public.profiles set joined_at = p_joined, start_meeting_id = coalesce(v_first, start_meeting_id) where id = p_member;
  insert into public.charges (due_id, member_id, amount)
    select d.id, p_member, d.amount from public.dues d where d.due_date >= p_joined and public.term_is_current(d.term_id)
  on conflict (due_id, member_id) do nothing;
  get diagnostics v_ch = row_count;
  delete from public.guests where id = p_guest;
  return jsonb_build_object('attendance', v_att, 'charges', v_ch);
end $$;

-- Aktifleştirme (1 Temmuz 2027, elle; tek transaction):
--   begin;
--   update public.terms set is_current = false where is_current;
--   update public.terms set is_current = true where name = '2027-28';
--   commit;
--   Sonra: aktif üyeler için 2027-28 taksitlerine charge üret, toplantıları oluştur,
--   YK planına bakıp görevleri panelden ata.

-- =====================================================================
-- v37: (1) Görevi olan herkes fotoğraf arşivi klasörlerini yönetir (ad değiştirir, siler)
--      (2) Asbaşkan rolünü ve geçmiş dönem başkanlığını yalnızca site sahibi atar
--      (3) Misafir bilgileri: doğum tarihi, meslek/okul, Instagram; kan grubu ayrı (gizli) tabloda
-- =====================================================================
create or replace function public.can_manage_albums()
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_admin() or exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.status = 'active' and coalesce(array_length(p.roles, 1), 0) > 0);
$$;

create or replace function public.guard_owner_only_roles()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- Sunucu (servis anahtarı / SQL editörü) için auth.uid() boştur; kısıtlama yalnızca panel kullanıcılarına
  if auth.uid() is null or public.is_owner() then return new; end if;
  if ('asbaskan' = any(coalesce(new.roles, '{}'))) is distinct from ('asbaskan' = any(coalesce(old.roles, '{}')))
     or new.past_president is distinct from old.past_president then
    raise exception 'Asbaşkan ve geçmiş dönem başkanı görevlerini yalnızca site sahibi değiştirebilir';
  end if;
  return new;
end $$;
drop trigger if exists profiles_owner_only_roles on public.profiles;
create trigger profiles_owner_only_roles before update on public.profiles
  for each row execute function public.guard_owner_only_roles();

alter table public.guests add column if not exists birth_date date;
alter table public.guests add column if not exists profession text;
alter table public.guests add column if not exists instagram  text;

create table if not exists public.guest_private (
  guest_id   uuid primary key references public.guests(id) on delete cascade,
  blood_type text
);
alter table public.guest_private enable row level security;
drop policy if exists guest_private_rw on public.guest_private;
create policy guest_private_rw on public.guest_private for all to authenticated
  using (public.has_role('sekreter') or public.is_admin())
  with check (public.has_role('sekreter') or public.is_admin());

-- =====================================================================
-- v38: Planlayıcı taslak dönemin ayarlarını (açılış bakiyesi vb.) düzenler
-- =====================================================================
drop policy if exists terms_planner_update on public.terms;
create policy terms_planner_update on public.terms for update to authenticated
  using (not is_current and public.is_planner()) with check (not is_current and public.is_planner());

-- =====================================================================
-- v39: Geçmiş dönem başkanları 2027-28 YK-GYK planını görüntüler (yalnız okuma)
-- =====================================================================
create or replace function public.board_plan_view()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not (public.is_planner() or exists (select 1 from public.profiles p where p.id = auth.uid() and p.status = 'active' and p.past_president)) then
    raise exception 'Bu planı görüntüleme yetkin yok';
  end if;
  return coalesce((select b.slots from public.term_board_plans b join public.terms t on t.id = b.term_id where t.name = '2027-28'), '{}'::jsonb);
end $$;
revoke all on function public.board_plan_view() from public, anon;
grant execute on function public.board_plan_view() to authenticated;

-- =====================================================================
-- v40: Asbaşkanın planlama notları (term_board_plans.notes; yalnızca planlayıcı)
-- =====================================================================
alter table public.term_board_plans add column if not exists notes text;

-- =====================================================================
-- v41: Hazır PDF olarak yayımlanan sayılar: sayfalar "gorsel" düzeniyle tam sayfa görsel,
--      orijinal PDF indirme bağlantısı letters.pdf_url
-- =====================================================================
alter table public.letters add column if not exists pdf_url text;
-- Anonim okuyucu (/mektup/) pdf_url sütununu da okur (letters sütun bazlı izinli)
grant select (pdf_url) on public.letters to anon;

-- =====================================================================
-- v42: Sayman, kasada misafir toplantı ücreti girerken misafir adlarını görür (yalnızca adlar)
-- =====================================================================
create or replace function public.guest_names()
returns table(full_name text)
language sql stable security definer set search_path = public as $$
  select g.full_name from public.guests g
   where public.has_role('pr') or public.has_role('sekreter') or public.has_role('sayman') or public.can_view_all()
   order by g.full_name;
$$;

-- =====================================================================
-- v43: Site düzenleme Saymana da açık (kayıtları görür; yayın site-edit fonksiyonundan)
-- =====================================================================
drop policy if exists site_edits_select on public.site_edits;
create policy site_edits_select on public.site_edits for select to authenticated
  using (public.has_role('pr') or public.has_role('sayman') or public.is_owner());

-- =====================================================================
-- v44: Site sahibi tüm görevlerin yetkilerine sahiptir (gizli: arayüzde görev olarak görünmez,
--      anasayfa ve listeler profiles.roles dizisini kullanır; yalnızca yetki kontrolleri değişir)
-- =====================================================================
create or replace function public.has_role(r text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles p
                 where p.id = auth.uid() and p.status = 'active' and r = any(p.roles))
      or exists (select 1 from public.app_owners o where o.user_id = auth.uid());
$$;

-- =====================================================================
-- v45: Site sahibinin profili, gizli bilgileri, görevleri ve yetkisi panelden başkası tarafından
--      değiştirilemez ve silinemez (yalnızca kendisi düzenler; SQL editörü/servis anahtarı hariç).
--      SECURITY DEFINER fonksiyonlar da (ör. convert_guest) çağıranın kimliğiyle bu kurala takılır.
-- =====================================================================
-- (iki tablo için ayrı fonksiyon: tek fonksiyonda new.member_id profiles tetikleyicisinde hata veriyordu)
create or replace function public.guard_owner_profile()
returns trigger language plpgsql security definer set search_path = public as $$
declare target uuid := old.id;
begin
  if auth.uid() is not null and auth.uid() <> target
     and exists (select 1 from public.app_owners o where o.user_id = target) then
    raise exception 'Bu üyenin bilgileri panelden değiştirilemez.';
  end if;
  return coalesce(new, old);
end $$;
create or replace function public.guard_owner_private()
returns trigger language plpgsql security definer set search_path = public as $$
declare target uuid;
begin
  if tg_op = 'DELETE' then target := old.member_id; else target := new.member_id; end if;
  if auth.uid() is not null and auth.uid() <> target
     and exists (select 1 from public.app_owners o where o.user_id = target) then
    raise exception 'Bu üyenin bilgileri panelden değiştirilemez.';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;
drop trigger if exists profiles_owner_guard on public.profiles;
create trigger profiles_owner_guard before update or delete on public.profiles
  for each row execute function public.guard_owner_profile();
drop trigger if exists profile_private_owner_guard on public.profile_private;
create trigger profile_private_owner_guard before insert or update or delete on public.profile_private
  for each row execute function public.guard_owner_private();
-- Sahiplik kaydına panelden kimse dokunamaz (politika yok = erişim yok; açıkça kapatılır)
alter table public.app_owners enable row level security;
revoke insert, update, delete on public.app_owners from anon, authenticated;

-- =====================================================================
-- v46: Başkan görevini de yalnızca site sahibi atar/kaldırır (asbaşkan ve GDB gibi)
-- =====================================================================
create or replace function public.guard_owner_only_roles()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or public.is_owner() then return new; end if;
  if ('asbaskan' = any(coalesce(new.roles, '{}'))) is distinct from ('asbaskan' = any(coalesce(old.roles, '{}')))
     or ('baskan' = any(coalesce(new.roles, '{}'))) is distinct from ('baskan' = any(coalesce(old.roles, '{}')))
     or new.past_president is distinct from old.past_president then
    raise exception 'Başkan, asbaşkan ve geçmiş dönem başkanı görevlerini yalnızca site sahibi değiştirebilir';
  end if;
  return new;
end $$;

-- =====================================================================
-- v47: Misafirin ilk geldiği toplantı Yoklama'dan seçilebilir; devam oranı ve listeler buradan başlar
-- =====================================================================
alter table public.guests add column if not exists start_meeting_id uuid references public.meetings(id) on delete set null;

-- =====================================================================
-- v48: Misafir fotoğrafı; misafir üye alınınca fotoğrafı, doğum tarihi, meslek, Instagram ve kan grubu
--      üye profiline taşınır (önceden misafir kaydıyla birlikte siliniyordu)
-- =====================================================================
alter table public.guests add column if not exists photo_url text;

create or replace function public.convert_guest(p_guest uuid, p_member uuid, p_joined date)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_att int := 0; v_ch int := 0; v_first uuid; g public.guests%rowtype; v_blood text;
begin
  if not public.is_admin() then raise exception 'Üye almak için Başkan yetkisi gerekiyor'; end if;
  select * into g from public.guests where id = p_guest;
  if not found then raise exception 'Misafir bulunamadı'; end if;
  if not exists (select 1 from public.profiles where id = p_member) then raise exception 'Üye profili bulunamadı'; end if;
  insert into public.attendance (meeting_id, member_id, status, note)
    select ga.meeting_id, p_member, ga.status, ga.note from public.guest_attendance ga where ga.guest_id = p_guest
  on conflict (meeting_id, member_id) do nothing;
  get diagnostics v_att = row_count;
  select m.id into v_first from public.guest_attendance ga join public.meetings m on m.id = ga.meeting_id
   where ga.guest_id = p_guest order by m.date nulls last, m.term_no limit 1;
  if v_first is null then
    select m.id into v_first from public.meetings m where m.date >= p_joined order by m.date, m.term_no limit 1;
  end if;
  update public.profiles set joined_at = p_joined, start_meeting_id = coalesce(v_first, start_meeting_id),
    photo_url  = coalesce(nullif(photo_url, ''), g.photo_url),
    birth_date = coalesce(birth_date, g.birth_date),
    profession = coalesce(nullif(profession, ''), g.profession),
    instagram  = coalesce(nullif(instagram, ''), g.instagram)
  where id = p_member;
  select blood_type into v_blood from public.guest_private where guest_id = p_guest;
  if coalesce(v_blood, '') <> '' then
    insert into public.profile_private (member_id, blood_type) values (p_member, v_blood)
    on conflict (member_id) do update set blood_type = coalesce(nullif(profile_private.blood_type, ''), excluded.blood_type);
  end if;
  insert into public.charges (due_id, member_id, amount)
    select d.id, p_member, d.amount from public.dues d where d.due_date >= p_joined and public.term_is_current(d.term_id)
  on conflict (due_id, member_id) do nothing;
  get diagnostics v_ch = row_count;
  delete from public.guests where id = p_guest;
  return jsonb_build_object('attendance', v_att, 'charges', v_ch);
end $$;

-- =====================================================================
-- v49: Site sahibi her yetki kontrolünden geçer. has_role (v44) canlıda yeniden uygulanır;
--      komite başkanı kontrolü de sahibi kapsar. Bundan sonra eklenen her "yalnızca X görür" kuralı
--      has_role / is_admin üzerinden yazılmalı ki sahip de görsün.
-- =====================================================================
create or replace function public.has_role(r text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles p
                 where p.id = auth.uid() and p.status = 'active' and r = any(p.roles))
      or exists (select 1 from public.app_owners o where o.user_id = auth.uid());
$$;

create or replace function public.is_committee_chair()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles p
                 where p.id = auth.uid() and p.status = 'active'
                   and p.roles && array['hizmet','uyelik','uluslararasi','pr','kulup','meslek','afet','hobi','interact']::text[])
      or exists (select 1 from public.app_owners o where o.user_id = auth.uid());
$$;

-- =====================================================================
-- v50: Misafir hesapları. Misafir e-postayla davet edilir (invite-member, kind: "guest"); hesabı
--      guests.user_id ile bağlanır, profiles'a satır açılmaz. Üyelerin görebildiği her şeyi
--      görüntüler (yazamaz); kendi misafir bilgilerini düzenler. Üye alınınca aynı hesap üye olur.
-- =====================================================================
alter table public.guests add column if not exists user_id uuid unique references auth.users(id) on delete set null;

create or replace function public.is_guest()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.guests where user_id = auth.uid());
$$;
create or replace function public.is_viewer()
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_active() or public.is_guest();
$$;
grant execute on function public.is_guest(), public.is_viewer() to authenticated;

-- Davet edilen misafir için profil açılmaz; hesap misafir kaydına bağlanır
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.raw_user_meta_data->>'kind' = 'guest' and (new.raw_user_meta_data->>'guest_id') is not null then
    update public.guests set user_id = new.id where id = (new.raw_user_meta_data->>'guest_id')::uuid and user_id is null;
    return new;
  end if;
  insert into public.profiles (id, full_name, phone, email, status, roles, past_president)
  values (
    new.id,
    coalesce(nullif(trim(new.raw_user_meta_data->>'full_name'), ''), split_part(new.email, '@', 1)),
    nullif(trim(new.raw_user_meta_data->>'phone'), ''),
    new.email,
    'pending', '{}', false
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

-- Üyelerin görüntüleyebildikleri misafirlere de açık (yalnızca okuma)
alter policy album_photos_select     on public.album_photos     using (public.is_viewer());
alter policy albums_select           on public.albums           using (public.is_viewer());
alter policy app_settings_select     on public.app_settings     using (public.is_viewer());
alter policy club_event_rsvps_select on public.club_event_rsvps using (public.is_viewer());
alter policy club_events_select      on public.club_events      using (public.is_viewer());
alter policy meetings_select         on public.meetings         using (public.is_viewer());
alter policy projects_select_members on public.projects         using (public.is_viewer());
alter policy terms_select            on public.terms            using (public.is_viewer());
alter policy profiles_select         on public.profiles         using (public.is_viewer() or id = auth.uid());
alter policy photos_read             on storage.objects         using (bucket_id = 'photos' and public.is_viewer());

-- Misafir kendi kaydını, yoklamasını ve kan grubunu görür
drop policy if exists guests_select_own on public.guests;
create policy guests_select_own on public.guests for select to authenticated using (user_id = auth.uid());
drop policy if exists guest_attendance_select_own on public.guest_attendance;
create policy guest_attendance_select_own on public.guest_attendance for select to authenticated
  using (guest_id in (select id from public.guests where user_id = auth.uid()));
drop policy if exists guest_private_select_own on public.guest_private;
create policy guest_private_select_own on public.guest_private for select to authenticated
  using (guest_id in (select id from public.guests where user_id = auth.uid()));

-- Misafir kendi bilgilerini yalnızca bu fonksiyonla değiştirir (not, başlangıç toplantısı vb. değişmez)
create or replace function public.update_my_guest(p jsonb)
returns public.guests language plpgsql security definer set search_path = public as $$
declare g public.guests;
begin
  select * into g from public.guests where user_id = auth.uid();
  if not found then raise exception 'Misafir kaydın bulunamadı'; end if;
  if p ? 'full_name' and coalesce(trim(p->>'full_name'), '') = '' then raise exception 'Adını yaz.'; end if;
  update public.guests set
    full_name  = case when p ? 'full_name'  then left(trim(p->>'full_name'), 120) else full_name end,
    phone      = case when p ? 'phone'      then nullif(left(trim(p->>'phone'), 30), '') else phone end,
    birth_date = case when p ? 'birth_date' then nullif(p->>'birth_date', '')::date else birth_date end,
    profession = case when p ? 'profession' then nullif(left(trim(p->>'profession'), 120), '') else profession end,
    instagram  = case when p ? 'instagram'  then nullif(left(regexp_replace(trim(p->>'instagram'), '^@+', ''), 30), '') else instagram end,
    photo_url  = case when p ? 'photo_url'  then nullif(p->>'photo_url', '') else photo_url end
  where id = g.id returning * into g;
  if p ? 'blood_type' then
    insert into public.guest_private (guest_id, blood_type) values (g.id, nullif(left(trim(p->>'blood_type'), 12), ''))
    on conflict (guest_id) do update set blood_type = excluded.blood_type;
  end if;
  return g;
end $$;
revoke all on function public.update_my_guest(jsonb) from public, anon;
grant execute on function public.update_my_guest(jsonb) to authenticated;

-- Hesabı olan misafir üye alınırken aynı hesaba aktif üye profili açılır (yeni davet gerekmez)
create or replace function public.guest_member_profile(p_guest uuid, p_joined date)
returns uuid language plpgsql security definer set search_path = public as $$
declare g public.guests; v_email text;
begin
  if not public.is_admin() then raise exception 'Üye almak için Başkan yetkisi gerekiyor'; end if;
  select * into g from public.guests where id = p_guest;
  if not found or g.user_id is null then raise exception 'Misafirin panel hesabı yok'; end if;
  select email into v_email from auth.users where id = g.user_id;
  insert into public.profiles (id, full_name, phone, email, status, roles, past_president, title, joined_at)
  values (g.user_id, g.full_name, g.phone, coalesce(v_email, g.email), 'active', '{}', false, 'Üye', p_joined)
  on conflict (id) do update set status = 'active';
  return g.user_id;
end $$;
revoke all on function public.guest_member_profile(uuid, date) from public, anon;
grant execute on function public.guest_member_profile(uuid, date) to authenticated;

-- =====================================================================
-- v51: Toplantıdan 6 gün önce tüm üyelere ve e-postası kayıtlı misafirlere otomatik toplantı duyurusu
--      (meeting-reminder fonksiyonu; her sabah 09.00 Türkiye). Her toplantı için bir kez (reminder_log).
-- =====================================================================
select cron.unschedule(jobid) from cron.job where jobname = 'meeting-reminder';
select cron.schedule(
  'meeting-reminder',
  '0 6 * * *',  -- 06.00 UTC = 09.00 Türkiye
  $$ select net.http_post(
       url     := 'https://fyjcgfbooajuljebxnil.supabase.co/functions/v1/meeting-reminder',
       headers := '{"Content-Type": "application/json"}'::jsonb,
       body    := '{}'::jsonb
     ); $$
);

-- =====================================================================
-- v52: "Şifresini oluşturdu" yalnızca en az bir kez giriş yapmış hesaplarda sayılır. Panel maili ile
--      hesabı yeni açılanlara Supabase rastgele bir şifre koyuyor; bu kişiler hiç girmemiş görünmeli.
-- =====================================================================
create or replace function public.member_accounts()
returns table (id uuid, has_password boolean, last_sign_in_at timestamptz)
language sql stable security definer set search_path = public, auth as $$
  select u.id, coalesce(u.encrypted_password, '') <> '' and u.last_sign_in_at is not null, u.last_sign_in_at
  from auth.users u
  where public.can_view_all() or public.has_role('sekreter');
$$;

-- =====================================================================
-- v53: Panel mailiyle hesabı açılan kişiye rastgele şifre konmaz; şifreyi kişi kendisi oluşturur.
--      Supabase admin createUser şifre verilmese de rastgele şifre koyduğu için hiç giriş yapmamış
--      hesaplarda şifre boşaltılır (yalnızca sunucu/servis anahtarı çağırabilir).
-- =====================================================================
create or replace function public.clear_unused_password(p_uid uuid)
returns void language sql security definer set search_path = public, auth as $$
  update auth.users set encrypted_password = '' where id = p_uid and last_sign_in_at is null;
$$;
revoke all on function public.clear_unused_password(uuid) from public, anon, authenticated;
grant execute on function public.clear_unused_password(uuid) to service_role;
-- Mevcut rastgele şifreler (hiç giriş yapılmamış hesaplar)
update auth.users set encrypted_password = '' where last_sign_in_at is null and coalesce(encrypted_password, '') <> '';

-- =====================================================================
-- v54: Arşivdeki "Üye ve misafir fotoğrafları": misafirlerin adı ve fotoğrafı tüm üyelere ve misafirlere
--      açık (yalnızca ad + fotoğraf; diğer misafir bilgileri gizli kalır). İndirme panelde YK/GYK'ya açık.
-- =====================================================================
create or replace function public.guest_photos()
returns table (id uuid, full_name text, photo_url text)
language sql stable security definer set search_path = public as $$
  select g.id, g.full_name, g.photo_url from public.guests g
  where public.is_viewer() and coalesce(g.photo_url, '') <> ''
  order by g.full_name;
$$;
revoke all on function public.guest_photos() from public, anon;
grant execute on function public.guest_photos() to authenticated;

-- =====================================================================
-- v55: Misafir üye alınınca taksitler yerine yeni üye aidatı borç yazılır (3 kalem):
--      1000 + 500 + (24 - misafirken katıldığı toplantı) x 350
-- =====================================================================
alter table public.dues    add column if not exists kind text;
alter table public.charges add column if not exists note text;
create unique index if not exists dues_term_kind_uniq on public.dues (term_id, kind) where kind is not null;

create or replace function public.convert_guest(p_guest uuid, p_member uuid, p_joined date)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_att int := 0; v_ch int := 0; v_first uuid; g public.guests%rowtype; v_blood text; v_term uuid; v_x int := 0; v_left int := 0;
begin
  if not public.is_admin() then raise exception 'Üye almak için Başkan yetkisi gerekiyor'; end if;
  select * into g from public.guests where id = p_guest;
  if not found then raise exception 'Misafir bulunamadı'; end if;
  if not exists (select 1 from public.profiles where id = p_member) then raise exception 'Üye profili bulunamadı'; end if;
  insert into public.attendance (meeting_id, member_id, status, note)
    select ga.meeting_id, p_member, ga.status, ga.note from public.guest_attendance ga where ga.guest_id = p_guest
  on conflict (meeting_id, member_id) do nothing;
  get diagnostics v_att = row_count;
  select m.id into v_first from public.guest_attendance ga join public.meetings m on m.id = ga.meeting_id
   where ga.guest_id = p_guest order by m.date nulls last, m.term_no limit 1;
  if v_first is null then
    select m.id into v_first from public.meetings m where m.date >= p_joined order by m.date, m.term_no limit 1;
  end if;
  update public.profiles set joined_at = p_joined, start_meeting_id = coalesce(v_first, start_meeting_id),
    photo_url  = coalesce(nullif(photo_url, ''), g.photo_url),
    birth_date = coalesce(birth_date, g.birth_date),
    profession = coalesce(nullif(profession, ''), g.profession),
    instagram  = coalesce(nullif(instagram, ''), g.instagram)
  where id = p_member;
  select blood_type into v_blood from public.guest_private where guest_id = p_guest;
  if coalesce(v_blood, '') <> '' then
    insert into public.profile_private (member_id, blood_type) values (p_member, v_blood)
    on conflict (member_id) do update set blood_type = coalesce(nullif(profile_private.blood_type, ''), excluded.blood_type);
  end if;
  -- Yeni üye aidatı: 1000 bölge katkı payı + 500 Uluslararası Rotary + (24 - misafirken katıldığı toplantı) x 350
  select t.id into v_term from public.terms t where t.is_current limit 1;
  if v_term is null then raise exception 'Güncel dönem bulunamadı'; end if;
  select count(*) into v_x from public.guest_attendance ga join public.meetings m on m.id = ga.meeting_id
   where ga.guest_id = p_guest and ga.status = 'geldi' and m.term_id = v_term;
  v_left := greatest(24 - v_x, 0);
  insert into public.dues (term_id, label, amount, kind) values
    (v_term, 'Yeni üye: Bölge katkı payı', 1000, 'yeni_bolge'),
    (v_term, 'Yeni üye: Uluslararası Rotary aidatı', 500, 'yeni_rotary'),
    (v_term, 'Yeni üye: Kalan toplantı ücreti', 350, 'yeni_toplanti')
  on conflict (term_id, kind) where kind is not null do nothing;
  insert into public.charges (due_id, member_id, amount, note)
    select d.id, p_member,
      case d.kind when 'yeni_toplanti' then v_left * 350 else d.amount end,
      case d.kind when 'yeni_toplanti' then format('24 − %s = %s toplantı × 350 TL', v_x, v_left) end
    from public.dues d where d.term_id = v_term and d.kind in ('yeni_bolge','yeni_rotary','yeni_toplanti')
      and not (d.kind = 'yeni_toplanti' and v_left = 0)
  on conflict (due_id, member_id) do nothing;
  get diagnostics v_ch = row_count;
  delete from public.guests where id = p_guest;
  return jsonb_build_object('attendance', v_att, 'charges', v_ch, 'total', 1500 + v_left * 350);
end $$;
