-- ============================================================
-- RIO Coffee — Supabase veritabanı kurulum scripti
-- Kullanım: Supabase Dashboard -> SQL Editor -> New Query
--          bu dosyanın içeriğini yapıştırıp "Run" deyin.
-- ============================================================

-- 1) products (ürünler)
create table if not exists products (
  id text primary key,
  cat text not null default 'coffee',
  name_ru text not null,
  name_ky text default '',
  price int not null default 0,
  desc_ru text default '',
  desc_ky text default ''
);

-- 2) videos
create table if not exists videos (
  id text primary key,
  title_ru text default '',
  title_ky text default '',
  url text not null
);

-- 3) gallery
create table if not exists gallery (
  id text primary key,
  src text not null,
  label_ru text default '',
  label_ky text default ''
);

-- 4) reservations (rezervasyon talepleri)
create table if not exists reservations (
  id text primary key,
  name text not null,
  phone text not null,
  date text default '',
  time text default '',
  guests int default 1,
  note text default '',
  created text default ''
);

-- 5) reviews (yorumlar)
create table if not exists reviews (
  id text primary key,
  stars int default 5,
  author text not null,
  city_ru text default '',
  city_ky text default '',
  text_ru text not null,
  text_ky text default ''
);

-- 6) settings (tek satır: duyuru + site ayarları)
create table if not exists settings (
  id text primary key,
  announcement jsonb default '{}',
  site jsonb default '{}'
);
insert into settings (id, announcement, site) values ('main', '{}', '{}')
on conflict (id) do nothing;

-- 7) admins (admin şifresi - hash olarak saklanır)
create table if not exists admins (
  username text primary key,
  password_hash text not null
);
insert into admins (username, password_hash) values ('admin', '4fef1ca867dce804b226c59bf7c541026b3a3c4278c7403905f13a19b381c245')
on conflict (username) do nothing;

-- 8) users (müşteri üyelikleri - ad + şifre hash)
create table if not exists users (
  id text primary key,
  name text not null,
  email text default '',
  password_hash text not null,
  created text default ''
);

-- RLS politikalari
alter table users enable row level security;
create policy "public all users" on users for all using (true) with check (true);

-- Güvenlik: anon key ile okuma/yazma (küçük proje için RLS kapalı)
alter table products enable row level security;
alter table videos enable row level security;
alter table gallery enable row level security;
alter table reservations enable row level security;
alter table reviews enable row level security;
alter table settings enable row level security;
alter table admins enable row level security;

-- RLS politikaları: herkese izin (RLS kapalı da olsa politikalar ekleyelim)
create policy "public all products" on products for all using (true) with check (true);
create policy "public all videos" on videos for all using (true) with check (true);
create policy "public all gallery" on gallery for all using (true) with check (true);
create policy "public all reservations" on reservations for all using (true) with check (true);
create policy "public all reviews" on reviews for all using (true) with check (true);
create policy "public all settings" on settings for all using (true) with check (true);
create policy "public all admins" on admins for all using (true) with check (true);
