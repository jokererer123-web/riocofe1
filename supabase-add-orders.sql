-- RIO Coffee - Worker POS için eksik tablolar
-- Supabase Dashboard -> SQL Editor -> Run

-- orders tablosu (siparişler)
create table if not exists orders (
  id text primary key,
  data jsonb default '{}'
);
alter table orders enable row level security;
drop policy if exists "public all orders" on orders;
create policy "public all orders" on orders for all using (true) with check (true);

-- staff tablosu (çalışanlar)
create table if not exists staff (
  id text primary key,
  name text not null,
  password text not null
);
alter table staff enable row level security;
drop policy if exists "public all staff" on staff;
create policy "public all staff" on staff for all using (true) with check (true);

-- users tablosuna bonus kolonları (yoksa)
alter table users add column if not exists phone text default '';
alter table users add column if not exists points int default 0;
alter table users add column if not exists qr text default '';
alter table users add column if not exists bonusHistory jsonb default '[]';
alter table users add column if not exists qrUsed boolean default false;
