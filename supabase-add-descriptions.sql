-- ============================================================
-- RIO Coffee — products tablosuna açıklama sütunlarını ekle
-- Kullanım: Supabase Dashboard -> SQL Editor -> New Query
--          bu içeriği yapıştırıp "Run" deyin.
-- ============================================================

-- Açıklama sütunları yoksa ekle (tekrar çalıştırılsa bile hata vermez)
alter table products
  add column if not exists desc_ru text default '',
  add column if not exists desc_ky text default '';

-- Kontrol (isteğe bağlı, çalışınca kolonları gösterir)
select column_name from information_schema.columns
where table_name = 'products' order by ordinal_position;
