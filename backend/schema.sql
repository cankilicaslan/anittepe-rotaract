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
