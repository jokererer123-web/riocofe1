-- RIO Bonus sistemi: users tablosuna bonus kolonları ekle
alter table users
  add column if not exists phone text default '',
  add column if not exists points int default 0,
  add column if not exists qr text default '',
  add column if not exists bonusHistory jsonb default '[]';
