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
