# ☕ RIO Coffee — Web Site + Admin + POS + 3D Hero

Karakol (Kyrgyzstan) merkezli **RIO Coffee** için geliştirilmiş kafe platformu.
Altın / koyu tasarım, çok dilli (KG / RU / EN / AR) arayüz, tam yönetilebilir
admin paneli, kasa (POS) ekranı, bonus/loyalty mobil uygulaması ve **yeni,
immersive Three.js 3D hero giriş animasyonu**.

---

## ✨ Yeni: 3D Hero Giriş Animasyonu

Ana sayfadaki hero bölümü artık WebGL ile çalışan, sıfır bağımlılık (self-hosted
Three.js) bir giriş sekansına sahip:

1. **Dev boba küresi** — görüntünün ortasında süzülen, parlak ve yarı saydam dev bir tapioka/boba küresi.
2. **Patlama efekti** — küre, fizik simülasyonuyla onlarca boba incisine ayrılır.
3. **Bardak & içecek** — inciler aşağıdaki şeffaf 3D boba bardağına dökülür; renkli içecek bardağı doldurur.
4. **Paketleme & markalama** — kapak bardağa oturur, pipet kapağı deler ve **RIO logosu** bardağın üzerine kaliteli bir dekal olarak işlenir.
5. **Geçiş** — sekans bitince (veya **Skip / Order Now** ile) ana site akışına yumuşak geçiş yapılır.

Kontroller: tıklama/dokunma küreyi patlatır, ikinci tıklama veya kaydırma animasyonu
atlar. `prefers-reduced-motion` tercihine ve WebGL'siz tarayıcılara otomatik fallback
vardır (orijinal CSS kupası gösterilir).

---

## 🚀 Özellikler

- **Ana site** — 3D hero, menü, galeri, video, hakkımızda, yorumlar, iletişim
- **Çoklu dil** — KG / RU / EN / AR anlık geçiş
- **Admin paneli** — `/admin` (şifre korumalı): ürün, video, galeri, duyuru, yorum, çalışma saatleri, sosyal medya, kategori, rezervasyon, çalışan (staff), bonus ve satış raporu yönetimi
- **Kasa / POS** — `/kasa`: çalışan girişi, ürün seçimi, sepet, sipariş, fiş, müşteri puan ekleme/kullanma
- **Bonus uygulaması** — `/app`: müşteri kayıt/giriş, puan, tek kullanımlık QR, ödüller
- **Dijital menü** — `/menu` (QR ile kullanım için)

---

## 🖥 Yerel Çalıştırma

```bash
node server.js          # Node 16+
```

| Adres | Sayfa |
|---|---|
| `/` | Ana sayfa (3D hero'lu) |
| `/menu` | Dijital menü |
| `/admin` | Admin paneli (varsayılan: `admin` / `rio123`) |
| `/kasa` | Kasa / POS (varsayılan kasa şifresi: `kasa2024`) |
| `/app` | Bonus müşteri uygulaması |
| `/api/data` | Genel API (menü/ürün/galeri/video verisi) |

> ⚠️ Yayınlamadan önce `/admin` → Ayarlar'dan şifreleri değiştirin.

## 🛠 Teknoloji

- Saf **Node.js** sunucu (harici bağımlılık yok) — `server.js`
- JSON dosya depolama (`data.json`) + opsiyonel **Supabase** senkronizasyonu
- **Three.js r160** (self-hosted, `vendor/`) + custom fizik/zaman çizelgesi (`js/hero3d.js`)
- PWA (`manifest.json`, `sw.js`)

## 📁 Proje Yapısı

```
rio/
├── server.js            # Node.js sunucusu + API
├── index.html           # Ana site + 3D hero
├── admin.html           # Admin paneli
├── kasa.html            # Kasa / POS
├── app.html             # Bonus uygulaması
├── menu.html            # Dijital menü
├── data.json            # Veriler (ürün, yorum, site ayarları…)
├── js/hero3d.js         # 3D hero sahnesi (Three.js)
├── vendor/              # three.module.min.js + RoomEnvironment.js
├── img/                 # Görseller + logo
├── supabase.js / *.sql  # Supabase bağlantısı ve şema
└── package.json
```
