#!/usr/bin/env node
/*
 * RIO Coffee — Admin Backend Server
 * Pure Node.js (no external dependencies) for maximum portability.
 * - Serves static site (rio-cafe/index.html + assets)
 * - JSON-file backed storage (data.json) that persists in the workspace
 * - Admin API with login, products/videos/announcement/gallery management
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = __dirname;
const DATA_FILE = path.join(ROOT, 'data.json');
const CONFIG_FILE = path.join(ROOT, 'config.json');
const PORT = process.env.PORT || 8000;

// ---------- Config / auth ----------
function loadConfig() {
  try {
    const raw = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    if (raw && raw.passwordHash) return raw;
  } catch {}
  // config.json yok veya bozuksa, varsayılanla oluştur ve kalıcı olarak kaydet
  const fresh = { passwordHash: hashPw('rio123'), username: 'admin', kasaPw: 'kasa2024' };
  try { saveConfig(fresh); } catch {}
  return fresh;
}
function saveConfig(cfg) { fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2)); }
function hashPw(pw) { return crypto.createHash('sha256').update(String(pw)).digest('hex'); }

let config = loadConfig();
let sessions = {}; // token -> username

function verifyPw(pw) { return hashPw(pw) === config.passwordHash; }
function issueToken() { const t = crypto.randomBytes(24).toString('hex'); sessions[t] = config.username || 'admin'; return t; }
function isAuthed(req) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : '';
  return !!sessions[token];
}

// ---------- Data store ----------
const sb = require('./supabase');

function loadDataLocal() {
  try {
    const d = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    d.reviews = d.reviews || [];
    d.site = d.site || {};
    d.users = d.users || [];
    d.orders = d.orders || [];
    d.staff = d.staff || [];
    return d;
  }
  catch { return { announcement: { enabled: true, ru: '', ky: '' }, products: [], videos: [], gallery: [], reviews: [], site: {}, users: [], orders: [], staff: [] }; }
}

let data = loadDataLocal();

// Müşteri oturumları: token -> user id
let userSessions = {};

// Supabase aktifse, veritabanından tüm verileri yükleyip belleğe alır.
// Supabase'te veri yoksa (yeni kurulan boş tablolar), yerel JSON'daki verileri
// Supabase'e ilk yükleme (seed) yapar — böylece site boş kalmaz.
async function initData() {
  if (!sb.ENABLED) return; // Supabase yoksa JSON dosya kalır
  try {
    const seed = () => ({
      products: loadDataLocal().products || [],
      videos: loadDataLocal().videos || [],
      gallery: loadDataLocal().gallery || [],
      reviews: loadDataLocal().reviews || []
    });

    data.products = await sb.table('products').selectAll('id');
    data.videos = await sb.table('videos').selectAll('id');
    data.gallery = await sb.table('gallery').selectAll('id');
    data.reviews = await sb.table('reviews').selectAll('id');
    try { data.users = await sb.table('users').selectAll('id'); } catch(e){ data.users = data.users || []; }
    try {
      const rawOrders = await sb.table('orders').selectAll('id');
      data.orders = rawOrders.map(r => (r.data && typeof r.data==='object') ? r.data : r);
    } catch(e){ data.orders = data.orders || []; }
    try { data.staff = await sb.table('staff').selectAll('id'); } catch(e){ data.staff = data.staff || []; }
    const settings = await sb.table('settings').selectOne({ id: 'main' });
    if (settings) {
      data.announcement = settings.announcement || data.announcement;
      data.site = settings.site || data.site;
    }
    // admin şifresi
    const adm = await sb.table('admins').selectOne({ username: config.username || 'admin' });
    if (adm && adm.password_hash) {
      config = { ...config, passwordHash: adm.password_hash };
    }

    // Seed: eğer herhangi bir tablo boşsa ve yerel JSON'da veri varsa, dolduracağız.
    const local = loadDataLocal();
    let needSeed = false;
    if (!data.products.length && local.products.length) { needSeed = true; data.products = local.products; }
    if (!data.videos.length && local.videos.length) { needSeed = true; data.videos = local.videos; }
    if (!data.gallery.length && local.gallery.length) { needSeed = true; data.gallery = local.gallery; }
    if (!data.reviews.length && local.reviews.length) { needSeed = true; data.reviews = local.reviews; }
    if (needSeed) {
      console.log('Supabase boş — yerel verilerle dolduruluyor (seed)...');
      await syncToSupabase();
      console.log('Seed tamamlandı ✓');
    }

    console.log('Supabase veri yüklendi ✓');
  } catch (e) {
    console.error('Supabase yükleme hatası (JSON fallback):', e.message);
  }
}

function saveData() {
  // Her zaman yerel dosyayı da güncelle (yedek)
  try { fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2)); } catch {}
  // Supabase senkronizasyonu (fire-and-forget, hata loglanır)
  if (sb.ENABLED) {
    syncToSupabase().catch(e => console.error('Supabase sync hatası:', e.message));
  }
}

async function syncToSupabase() {
  const tasks = [];
  // Her tabloyu "hepsini sil + yeniden ekle" ile senkronize et (küçük veri için güvenli)
  const syncTable = async (name, rows) => {
    const t = sb.table(name);
    await t.deleteAll();
    for (const row of rows) await t.insert(row);
  };
  tasks.push(syncTable('products', data.products));
  tasks.push(syncTable('videos', data.videos));
  tasks.push(syncTable('gallery', data.gallery));
  tasks.push(syncTable('reviews', data.reviews));
  // users, orders, settings ayrı yönetilir (doğrudan API üzerinden Supabase'e yazılır)
  if (data.orders && data.orders.length) {
    tasks.push((async()=>{ const t=sb.table('orders'); await t.deleteAll(); for (const o of data.orders) await t.insert({ id: o.id, data: o }); })());
  }
  if (data.staff && data.staff.length) {
    tasks.push((async()=>{ try{ const t=sb.table('staff'); await t.deleteAll(); for (const s of data.staff) await t.insert(s); }catch(e){} })());
  }
  // settings tek satır (upsert)
  tasks.push(sb.table('settings').delete({ id: 'main' })
    .then(() => sb.table('settings').insert({ id: 'main', announcement: data.announcement, site: data.site })));
  // admin şifre
  tasks.push(sb.table('admins').delete({ username: 'admin' })
    .then(() => sb.table('admins').insert({ username: 'admin', password_hash: config.passwordHash })));
  await Promise.all(tasks);
}

function uid(p) { return p + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

// users'ı Supabase'e upsert et (şema uyumlu)
async function syncUserToSb(user) {
  if (!sb.ENABLED || !user || !user.id) return;
  try {
    const row = { ...user };
    if (!Array.isArray(row.bonusHistory)) row.bonusHistory = [];
    await sb.table('users').upsert(row);
  } catch (e) { console.error('syncUserToSb hata:', e.message); }
}

// ---------- Helpers ----------
function send(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store'
  });
  res.end(body);
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let b = '';
    req.on('data', c => { b += c; if (b.length > 5e6) req.destroy(); });
    req.on('end', () => { try { resolve(b ? JSON.parse(b) : {}); } catch { resolve({}); } });
    req.on('error', reject);
  });
}
function jsonBody(res, ok) {
  res.writeHead(ok ? 200 : 400, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
}

// ---------- Static file serving (with MIME + path safety) ----------
const MIME = {
  '.html':'text/html; charset=utf-8', '.css':'text/css; charset=utf-8', '.js':'text/javascript; charset=utf-8',
  '.json':'application/json', '.png':'image/png', '.jpg':'image/jpeg', '.jpeg':'image/jpeg', '.webp':'image/webp',
  '.svg':'image/svg+xml', '.ico':'image/x-icon', '.mp4':'video/mp4', '.webm':'video/webm', '.woff':'font/woff',
  '.woff2':'font/woff2', '.ttf':'font/ttf', '.mp3':'audio/mpeg', '.wav':'audio/wav', '.txt':'text/plain'
};
function serveStatic(req, res, urlPath) {
  let rel = decodeURIComponent(urlPath);
  if (rel === '/' ) rel = '/index.html';
  const filePath = path.normalize(path.join(ROOT, rel));
  if (!filePath.startsWith(ROOT)) { send(res, 403, { error: 'Forbidden' }); return; }
  fs.readFile(filePath, (err, buf) => {
    if (err) { send(res, 404, { error: 'Not found' }); return; }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Content-Length': buf.length,
      'Cache-Control': ext === '.html' ? 'no-store' : 'public, max-age=3600'
    });
    res.end(buf);
  });
}

// ---------- Validate ----------
const CATS = ['coffee','bubble','juice','limonade','milkshake','matcha','kakao','icetea','djuzboll','dessert'];
function normProduct(p) {
  if (!p || typeof p.name_ru !== 'string' || !p.name_ru.trim()) return null;
  const price = Math.max(0, parseInt(p.price, 10) || 0);
  const cat = CATS.includes(p.cat) ? p.cat : 'coffee';
  return { id: p.id || uid('p'), cat, name_ru: p.name_ru.trim(), name_ky: (p.name_ky || p.name_ru).trim(), price, desc_ru: (p.desc_ru || '').trim(), desc_ky: (p.desc_ky || p.desc_ru || '').trim() };
}
function normVideo(v) {
  if (!v || typeof v.url !== 'string' || !v.url.trim()) return null;
  return { id: v.id || uid('v'), title_ru: (v.title_ru || '').trim(), title_ky: (v.title_ky || v.title_ru || '').trim(), url: v.url.trim() };
}
function normGallery(g) {
  if (!g || typeof g.src !== 'string' || !g.src.trim()) return null;
  return { id: g.id || uid('g'), src: g.src.trim(), label_ru: (g.label_ru || '').trim(), label_ky: (g.label_ky || g.label_ru || '').trim() };
}

// ---------- Router ----------
const server = http.createServer(async (req, res) => {
  const url = req.url.split('?')[0];

  // Public API (no auth) — used by the public site
  if (url === '/api/data' && req.method === 'GET') {
    return send(res, 200, { announcement: data.announcement, products: data.products, videos: data.videos, gallery: data.gallery, reviews: data.reviews, site: data.site });
  }

  // ---- Müşteri üyeliği ----
  // Kayıt: ad + şifre
  if (url === '/api/register' && req.method === 'POST') {
    const b = await readBody(req);
    const name = String(b.name || '').trim();
    const pw = String(b.password || '');
    if (!name || name.length < 2) return send(res, 400, { ok: false, error: 'İsim çok kısa' });
    if (pw.length < 4) return send(res, 400, { ok: false, error: 'Şifre en az 4 karakter' });
    if (data.users.some(u => u.name.toLowerCase() === name.toLowerCase())) {
      return send(res, 409, { ok: false, error: 'Bu isim zaten kullanılıyor' });
    }
    const user = {
      id: uid('u'),
      name,
      email: String(b.email || '').trim(),
      phone: String(b.phone || '').trim(),
      points: 0,
      qr: 'RIO-' + uid('q').slice(-10).toUpperCase(),
      qrUsed: false,
      password_hash: hashPw(pw),
      created: new Date().toISOString()
    };
    data.users.push(user);
    await syncUserToSb(user);
    saveData();
    const token = crypto.randomBytes(24).toString('hex');
    userSessions[token] = user.id;
    return send(res, 200, { ok: true, token, user: { id: user.id, name: user.name, email: user.email } });
  }

  // Giriş: ad + şifre
  if (url === '/api/login' && req.method === 'POST') {
    const b = await readBody(req);
    const name = String(b.name || '').trim();
    const user = data.users.find(u => u.name.toLowerCase() === name.toLowerCase());
    if (!user || user.password_hash !== hashPw(String(b.password || ''))) {
      return send(res, 401, { ok: false, error: 'Yanlış isim veya şifre' });
    }
    const token = crypto.randomBytes(24).toString('hex');
    userSessions[token] = user.id;
    return send(res, 200, { ok: true, token, user: { id: user.id, name: user.name, email: user.email } });
  }

  // Çıkış
  if (url === '/api/logout' && req.method === 'POST') {
    const t = (req.headers.authorization || '').replace('Bearer ', '');
    delete userSessions[t];
    return send(res, 200, { ok: true });
  }

  // Oturum bilgisi
  if (url === '/api/me' && req.method === 'GET') {
    const t = (req.headers.authorization || '').replace('Bearer ', '');
    const uid_ = userSessions[t];
    const user = uid_ ? data.users.find(u => u.id === uid_) : null;
    if (!user) return send(res, 401, { ok: false });
    return send(res, 200, { ok: true, user: { id: user.id, name: user.name, email: user.email, phone: user.phone||'', points: user.points||0, qr: user.qr||'' } });
  }

  // Bonus durumu (müşteri, girişli)
  if (url === '/api/bonus/status' && req.method === 'GET') {
    const t = (req.headers.authorization || '').replace('Bearer ', '');
    const uid_ = userSessions[t];
    const user = uid_ ? data.users.find(u => u.id === uid_) : null;
    if (!user) return send(res, 401, { ok: false });
    const cfg = (data.site && data.site.bonus) || {};
    // QR kullanıldıysa yeni QR üret (tek kullanımlık)
    if (user.qrUsed) {
      user.qr = 'RIO-' + uid('q').slice(-10).toUpperCase();
      user.qrUsed = false;
      saveData();
    }
    return send(res, 200, { ok: true, points: user.points||0, qr: user.qr||'', qrUsed: !!user.qrUsed, active: !!cfg.active, config: cfg, user: { id: user.id, name: user.name } });
  }

  // Kasa: çalışan girişi (ad + şifre)
  if (url === '/api/kasa/unlock' && req.method === 'POST') {
    const b = await readBody(req);
    const name = String(b.name || '').trim();
    const staff = data.staff.find(s => s.name.toLowerCase() === name.toLowerCase() && s.password === String(b.password||''));
    if (staff) {
      const token = crypto.randomBytes(24).toString('hex');
      sessions['kasa:'+token] = staff.id;
      return send(res, 200, { ok: true, token, staff: { id: staff.id, name: staff.name } });
    }
    // geriye uyumluluk: eski kasa şifresi
    if (String(b.password||'') === (config.kasaPw||'kasa2024')) {
      const token = crypto.randomBytes(24).toString('hex');
      sessions['kasa:'+token] = 'kasa';
      return send(res, 200, { ok: true, token, staff: { id: 'kasa', name: 'Kasa' } });
    }
    return send(res, 401, { ok: false, error: 'wrong' });
  }

  // Admin: kasa şifresini değiştir
  if (url === '/api/admin/kasa-pw' && req.method === 'PUT') {
    if (!isAuthed(req)) return send(res, 401, { ok: false });
    const b = await readBody(req);
    if (!b.newPassword || String(b.newPassword).length < 4) return send(res, 400, { ok: false, error: 'kısa' });
    config.kasaPw = String(b.newPassword);
    saveConfig(config);
    return send(res, 200, { ok: true });
  }

  // Admin: kasa şifresi durumu
  if (url === '/api/admin/kasa-pw' && req.method === 'GET') {
    if (!isAuthed(req)) return send(res, 401, { ok: false });
    return send(res, 200, { ok: true, kasaPw: config.kasaPw || 'kasa2024' });
  }

  // Kasa: müşteriyi telefon veya QR ile bul
  if (url === '/api/kasa/find' && req.method === 'POST') {
    const b = await readBody(req);
    const q = String(b.query || '').trim().toLowerCase();
    if (!q) return send(res, 400, { ok: false, error: 'query' });
    const user = data.users.find(u => (u.phone||'').replace(/\D/g,'') === q.replace(/\D/g,'') || (u.qr||'').toLowerCase() === q);
    if (!user) return send(res, 404, { ok: false, error: 'not found' });
    return send(res, 200, { ok: true, user: { id: user.id, name: user.name, points: user.points||0, qr: user.qr } });
  }

  // Kasa: müşteri listesi
  if (url === '/api/kasa/list' && req.method === 'GET') {
    return send(res, 200, { ok: true, users: data.users.map(u => ({ id: u.id, name: u.name, phone: u.phone||'', points: u.points||0, qr: u.qr||'' })) });
  }

  // Kasa: puan ekle (sipariş)
  if (url === '/api/kasa/add' && req.method === 'POST') {
    const b = await readBody(req);
    const cfg = (data.site && data.site.bonus) || {};
    if (!cfg.active) return send(res, 403, { ok: false, error: 'bonus kapalı' });
    const user = data.users.find(u => u.id === b.userId);
    if (!user) return send(res, 404, { ok: false });
    const pts = Math.max(1, parseInt(b.points, 10) || (cfg.per_item||10));
    user.points = (user.points||0) + pts;
    // QR tek kullanımlık: puan eklenince bu QR kullanıldı sayılır, yeni siparişte yeni QR gerekir
    user.qrUsed = true;
    user.bonusHistory = user.bonusHistory || [];
    user.bonusHistory.push({ type: 'add', points: pts, note: String(b.note||''), at: new Date().toISOString() });
    saveData();
    await syncUserToSb(user);
    return send(res, 200, { ok: true, points: user.points, qrUsed: true });
  }

  // Kasa: ödül kullan (bedava içecek / indirim)
  if (url === '/api/kasa/redeem' && req.method === 'POST') {
    const b = await readBody(req);
    const cfg = (data.site && data.site.bonus) || {};
    if (!cfg.active) return send(res, 403, { ok: false, error: 'bonus kapalı' });
    const user = data.users.find(u => u.id === b.userId);
    if (!user) return send(res, 404, { ok: false });
    const cost = b.reward === 'free' ? (cfg.reward_free||100) : (cfg.reward_discount||50);
    if ((user.points||0) < cost) return send(res, 400, { ok: false, error: 'yetersiz puan' });
    user.points -= cost;
    user.bonusHistory = user.bonusHistory || [];
    user.bonusHistory.push({ type: 'redeem', points: -cost, note: b.reward==='free' ? 'bedava içecek' : '%'+ (cfg.discount_percent||10)+' indirim', at: new Date().toISOString() });
    saveData();
    await syncUserToSb(user);
    return send(res, 200, { ok: true, points: user.points });
  }

  // Sipariş: kasadan sipariş al, puan kazandır, fiş verisi döndür
  if (url === '/api/order' && req.method === 'POST') {
    const b = await readBody(req);
    const cfg = (data.site && data.site.bonus) || {};
    const userId = String(b.userId || '');
    const items = Array.isArray(b.items) ? b.items : []; // [{id, name, price, qty}]
    if (!items.length) return send(res, 400, { ok: false, error: 'boş sipariş' });
    // toplam hesapla
    let total = 0;
    for (const it of items) total += (parseInt(it.price,10)||0) * (parseInt(it.qty,10)||1);
    let user = userId ? data.users.find(u => u.id === userId) : null;
    let earnedPoints = 0;
    // puan kuralı: her içecek = per_item puan
    const perItem = cfg.per_item || 10;
    const itemCount = items.reduce((s,it)=>s+(parseInt(it.qty,10)||1),0);
    if (user && cfg.active) {
      earnedPoints = itemCount * perItem;
      user.points = (user.points||0) + earnedPoints;
      user.qrUsed = true;
      user.bonusHistory = user.bonusHistory || [];
      user.bonusHistory.push({ type:'add', points: earnedPoints, note:'sipariş #'+items.length, at:new Date().toISOString() });
    }
    // sipariş kaydet
    const order = {
      id: uid('o'),
      userId, userName: user ? user.name : (b.customerName||''),
      staffId: String(b.staffId||''),
      staffName: String(b.staffName||''),
      items, total,
      earnedPoints, itemCount,
      at: new Date().toISOString()
    };
    data.orders.push(order);
    saveData();
    if (user) await syncUserToSb(user);
    return send(res, 200, { ok:true, order, total, earnedPoints, points: user?user.points:0 });
  }

  // Kasa: sipariş geçmişi (opsiyonel userId filtresi)
  if (url === '/api/kasa/orders' && req.method === 'GET') {
    const u = new URL(req.url, 'http://x');
    const uid = u.searchParams.get('userId');
    let orders = data.orders;
    if (uid) orders = orders.filter(o => o.userId === uid);
    return send(res, 200, { ok:true, orders: orders.slice().reverse().slice(0,100) });
  }

  // Admin: sipariş geçmişi
  if (url === '/api/admin/orders' && req.method === 'GET') {
    if (!isAuthed(req)) return send(res, 401, { ok:false });
    return send(res, 200, { ok:true, orders: data.orders.slice().reverse() });
  }

  // Kasa geçmişi (kullanıcı bazlı)
  if (url === '/api/kasa/history' && req.method === 'GET') {
    const u = new URL(req.url, 'http://x');
    const id = u.searchParams.get('id');
    const user = data.users.find(x => x.id === id);
    if (!user) return send(res, 404, { ok: false });
    return send(res, 200, { ok: true, history: user.bonusHistory || [] });
  }

  // Admin: bonus ayarları
  if (url === '/api/admin/bonus' && req.method === 'GET') {
    if (!isAuthed(req)) return send(res, 401, { ok: false });
    return send(res, 200, { ok: true, config: (data.site && data.site.bonus)||{} });
  }
  if (url === '/api/admin/bonus' && req.method === 'PUT') {
    if (!isAuthed(req)) return send(res, 401, { ok: false });
    const b = await readBody(req);
    data.site = data.site || {};
    data.site.bonus = {
      active: !!b.active,
      per_item: parseInt(b.per_item,10) || 10,
      reward_free: parseInt(b.reward_free,10) || 100,
      reward_discount: parseInt(b.reward_discount,10) || 50,
      discount_percent: parseInt(b.discount_percent,10) || 10
    };
    saveData();
    return send(res, 200, { ok: true, config: data.site.bonus });
  }

  // Admin: müşteri listesi (puanlarla)
  if (url === '/api/admin/bonus/users' && req.method === 'GET') {
    if (!isAuthed(req)) return send(res, 401, { ok: false });
    return send(res, 200, { ok: true, users: data.users.map(u => ({ id: u.id, name: u.name, phone: u.phone||'', points: u.points||0, qr: u.qr||'' })) });
  }

  // Admin: müşteri puan geçmişi
  if (url === '/api/admin/bonus/history' && req.method === 'GET') {
    if (!isAuthed(req)) return send(res, 401, { ok: false });
    const u = new URL(req.url, 'http://x');
    const id = u.searchParams.get('id');
    const user = data.users.find(x => x.id === id);
    if (!user) return send(res, 404, { ok: false });
    return send(res, 200, { ok: true, user: { id: user.id, name: user.name, phone: user.phone||'', points: user.points||0 }, history: user.bonusHistory || [] });
  }

  // Admin auth
  if (url === '/api/admin/login' && req.method === 'POST') {
    const b = await readBody(req);
    if (verifyPw(b.password || '')) {
      const token = issueToken();
      return send(res, 200, { ok: true, token, username: config.username });
    }
    return send(res, 401, { ok: false, error: 'Неверный пароль' });
  }
  if (url === '/api/admin/logout' && req.method === 'POST') {
    const t = (req.headers.authorization || '').replace('Bearer ', '');
    delete sessions[t];
    return send(res, 200, { ok: true });
  }

  // ---- Protected admin routes ----
  if (url.startsWith('/api/admin/')) {
    if (!isAuthed(req)) return send(res, 401, { ok: false, error: 'Требуется авторизация' });

    // Products
    if (url === '/api/admin/products' && req.method === 'POST') {
      const b = await readBody(req);
      const p = normProduct(b);
      if (!p) return send(res, 400, { ok: false, error: 'Некорректные данные' });
      data.products.push(p); saveData(); return send(res, 200, { ok: true, item: p });
    }
    let m = url.match(/^\/api\/admin\/products\/(.+)$/);
    if (m) {
      const id = m[1];
      const i = data.products.findIndex(x => x.id === id);
      if (req.method === 'DELETE') {
        if (i < 0) return send(res, 404, { ok: false, error: 'Не найдено' });
        data.products.splice(i, 1); saveData(); return send(res, 200, { ok: true });
      }
      if (req.method === 'PUT') {
        if (i < 0) return send(res, 404, { ok: false, error: 'Не найдено' });
        const b = await readBody(req);
        const p = normProduct({ ...data.products[i], ...b, id });
        data.products[i] = p; saveData(); return send(res, 200, { ok: true, item: p });
      }
    }

    // Videos
    if (url === '/api/admin/videos' && req.method === 'POST') {
      const b = await readBody(req);
      const v = normVideo(b);
      if (!v) return send(res, 400, { ok: false, error: 'Некорректные данные' });
      data.videos.push(v); saveData(); return send(res, 200, { ok: true, item: v });
    }
    m = url.match(/^\/api\/admin\/videos\/(.+)$/);
    if (m) {
      const id = m[1];
      const i = data.videos.findIndex(x => x.id === id);
      if (req.method === 'DELETE') {
        if (i < 0) return send(res, 404, { ok: false, error: 'Не найдено' });
        data.videos.splice(i, 1); saveData(); return send(res, 200, { ok: true });
      }
      if (req.method === 'PUT') {
        if (i < 0) return send(res, 404, { ok: false, error: 'Не найдено' });
        const b = await readBody(req);
        const v = normVideo({ ...data.videos[i], ...b, id });
        data.videos[i] = v; saveData(); return send(res, 200, { ok: true, item: v });
      }
    }

    // Gallery
    if (url === '/api/admin/gallery' && req.method === 'POST') {
      const b = await readBody(req);
      const g = normGallery(b);
      if (!g) return send(res, 400, { ok: false, error: 'Некорректные данные' });
      data.gallery.push(g); saveData(); return send(res, 200, { ok: true, item: g });
    }
    m = url.match(/^\/api\/admin\/gallery\/(.+)$/);
    if (m) {
      const id = m[1];
      const i = data.gallery.findIndex(x => x.id === id);
      if (req.method === 'DELETE') {
        if (i < 0) return send(res, 404, { ok: false, error: 'Не найдено' });
        data.gallery.splice(i, 1); saveData(); return send(res, 200, { ok: true });
      }
    }

    // Reviews
    if (url === '/api/admin/reviews' && req.method === 'POST') {
      const b = await readBody(req);
      if (!b || !String(b.author || '').trim() || !String(b.text_ru || '').trim()) {
        return send(res, 400, { ok: false, error: 'Имя и текст обязательны' });
      }
      const rev = {
        id: uid('r'),
        stars: Math.min(5, Math.max(1, parseInt(b.stars, 10) || 5)),
        author: String(b.author).trim(),
        city_ru: String(b.city_ru || '').trim(),
        city_ky: String(b.city_ky || b.city_ru || '').trim(),
        text_ru: String(b.text_ru).trim(),
        text_ky: String(b.text_ky || b.text_ru).trim()
      };
      data.reviews.push(rev); saveData(); return send(res, 200, { ok: true, item: rev });
    }
    m = url.match(/^\/api\/admin\/reviews\/(.+)$/);
    if (m) {
      const id = m[1];
      const i = data.reviews.findIndex(x => x.id === id);
      if (req.method === 'DELETE') {
        if (i < 0) return send(res, 404, { ok: false, error: 'Не найдено' });
        data.reviews.splice(i, 1); saveData(); return send(res, 200, { ok: true });
      }
      if (req.method === 'PUT') {
        if (i < 0) return send(res, 404, { ok: false, error: 'Не найдено' });
        const b = await readBody(req);
        const cur = data.reviews[i];
        data.reviews[i] = {
          id,
          stars: Math.min(5, Math.max(1, parseInt(b.stars, 10) || cur.stars || 5)),
          author: String(b.author != null ? b.author : cur.author).trim(),
          city_ru: String(b.city_ru != null ? b.city_ru : cur.city_ru || '').trim(),
          city_ky: String(b.city_ky != null ? b.city_ky : (cur.city_ky || b.city_ru || '')).trim(),
          text_ru: String(b.text_ru != null ? b.text_ru : cur.text_ru).trim(),
          text_ky: String(b.text_ky != null ? b.text_ky : (cur.text_ky || b.text_ru || '')).trim()
        };
        saveData(); return send(res, 200, { ok: true, item: data.reviews[i] });
      }
    }

    // Announcement
    if (url === '/api/admin/announcement' && req.method === 'PUT') {
      const b = await readBody(req);
      data.announcement = {
        enabled: !!b.enabled,
        ru: String(b.ru || '').trim(),
        ky: String(b.ky || b.ru || '').trim(),
        en: String(b.en || b.ru || '').trim(),
        ar: String(b.ar || b.ru || '').trim()
      };
      saveData(); return send(res, 200, { ok: true, announcement: data.announcement });
    }

    // Password change
    if (url === '/api/admin/password' && req.method === 'PUT') {
      const b = await readBody(req);
      if (!verifyPw(b.current || '')) return send(res, 403, { ok: false, error: 'Текущий пароль неверен' });
      if (!b.newPassword || String(b.newPassword).length < 4) return send(res, 400, { ok: false, error: 'Пароль слишком короткий' });
      config.passwordHash = hashPw(b.newPassword); saveConfig(config);
      // Supabase'e de yansıt (şifre kalıcı olsun)
      if (sb.ENABLED) {
        sb.table('admins').delete({ username: 'admin' })
          .then(() => sb.table('admins').insert({ username: 'admin', password_hash: config.passwordHash }))
          .catch(e => console.error('Şifre Supabase sync hatası:', e.message));
      }
      return send(res, 200, { ok: true });
    }

    // Site content settings
    if (url === '/api/admin/site' && req.method === 'PUT') {
      const b = await readBody(req);
      const cur = data.site || {};
      // hero
      cur.hero = cur.hero || {};
      const h = b.hero || {};
      cur.hero.badge_ru = String(h.badge_ru ?? cur.hero.badge_ru ?? '').trim();
      cur.hero.badge_ky = String(h.badge_ky ?? cur.hero.badge_ky ?? cur.hero.badge_ru ?? '').trim();
      cur.hero.title1_ru = String(h.title1_ru ?? cur.hero.title1_ru ?? '').trim();
      cur.hero.title2_ru = String(h.title2_ru ?? cur.hero.title2_ru ?? '').trim();
      cur.hero.title1_ky = String(h.title1_ky ?? cur.hero.title1_ky ?? cur.hero.title1_ru ?? '').trim();
      cur.hero.title2_ky = String(h.title2_ky ?? cur.hero.title2_ky ?? cur.hero.title2_ru ?? '').trim();
      cur.hero.sub_ru = String(h.sub_ru ?? cur.hero.sub_ru ?? '').trim();
      cur.hero.sub_ky = String(h.sub_ky ?? cur.hero.sub_ky ?? cur.hero.sub_ru ?? '').trim();
      cur.hero.badge_en = String(h.badge_en ?? cur.hero.badge_en ?? '').trim();
      cur.hero.badge_ar = String(h.badge_ar ?? cur.hero.badge_ar ?? '').trim();
      cur.hero.title1_en = String(h.title1_en ?? cur.hero.title1_en ?? '').trim();
      cur.hero.title2_en = String(h.title2_en ?? cur.hero.title2_en ?? '').trim();
      cur.hero.title1_ar = String(h.title1_ar ?? cur.hero.title1_ar ?? '').trim();
      cur.hero.title2_ar = String(h.title2_ar ?? cur.hero.title2_ar ?? '').trim();
      cur.hero.sub_en = String(h.sub_en ?? cur.hero.sub_en ?? '').trim();
      cur.hero.sub_ar = String(h.sub_ar ?? cur.hero.sub_ar ?? '').trim();
      // hours
      cur.hours = cur.hours || {};
      const w = b.hours || {};
      ['week_ru','week_ky','week_hours','weekend_ru','weekend_ky','weekend_hours'].forEach(k => {
        cur.hours[k] = String(w[k] ?? cur.hours[k] ?? '').trim();
      });
      // socials
      cur.socials = cur.socials || {};
      const s = b.socials || {};
      cur.socials.instagram = String(s.instagram ?? cur.socials.instagram ?? '').trim();
      cur.socials.whatsapp = String(s.whatsapp ?? cur.socials.whatsapp ?? '').trim();
      cur.socials.telegram = String(s.telegram ?? cur.socials.telegram ?? '').trim();
      // contact
      cur.contact = cur.contact || {};
      const ct = b.contact || {};
      cur.contact.address_ru = String(ct.address_ru ?? cur.contact.address_ru ?? '').trim();
      cur.contact.address_ky = String(ct.address_ky ?? cur.contact.address_ky ?? cur.contact.address_ru ?? '').trim();
      cur.contact.address_en = String(ct.address_en ?? cur.contact.address_en ?? cur.contact.address_ru ?? '').trim();
      cur.contact.address_ar = String(ct.address_ar ?? cur.contact.address_ar ?? cur.contact.address_ru ?? '').trim();
      cur.contact.phone = String(ct.phone ?? cur.contact.phone ?? '').trim();
      cur.contact.maps = String(ct.maps ?? cur.contact.maps ?? '').trim();
      // categories
      cur.categories = cur.categories || {};
      const c = b.categories || {};
      ['coffee','bubble','juice','limonade','milkshake','matcha','kakao','dessert','icetea','djuzboll'].forEach(cat => {
        cur.categories[cat+'_ru'] = String(c[cat+'_ru'] ?? cur.categories[cat+'_ru'] ?? '').trim();
        cur.categories[cat+'_ky'] = String(c[cat+'_ky'] ?? cur.categories[cat+'_ky'] ?? cur.categories[cat+'_ru'] ?? '').trim();
        cur.categories[cat+'_en'] = String(c[cat+'_en'] ?? cur.categories[cat+'_en'] ?? cur.categories[cat+'_ru'] ?? '').trim();
        cur.categories[cat+'_ar'] = String(c[cat+'_ar'] ?? cur.categories[cat+'_ar'] ?? cur.categories[cat+'_ru'] ?? '').trim();
      });
      data.site = cur;
      saveData();
      return send(res, 200, { ok: true, site: data.site });
    }

    // Çalışanlar yönetimi
    if (url === '/api/admin/staff' && req.method === 'GET') {
      return send(res, 200, { ok: true, staff: data.staff.map(s=>({ id:s.id, name:s.name, password:s.password })) });
    }
    if (url === '/api/admin/staff' && req.method === 'POST') {
      const b = await readBody(req);
      const name = String(b.name||'').trim();
      const password = String(b.password||'').trim();
      if (!name || !password || password.length<3) return send(res, 400, { ok:false, error:'isim ve şifre gerekli (en az 3)' });
      if (data.staff.some(s=>s.name.toLowerCase()===name.toLowerCase())) return send(res, 409, { ok:false, error:'bu isim var' });
      const st = { id: uid('s'), name, password };
      data.staff.push(st); saveData();
      return send(res, 200, { ok:true, staff:st });
    }
    m = url.match(/^\/api\/admin\/staff\/(.+)$/);
    if (m) {
      const id = m[1];
      const i = data.staff.findIndex(x=>x.id===id);
      if (req.method==='DELETE' && i>=0){ data.staff.splice(i,1); saveData(); return send(res,200,{ok:true}); }
      if (req.method==='PUT' && i>=0){ const b=await readBody(req); data.staff[i].name=String(b.name||data.staff[i].name).trim(); if(b.password) data.staff[i].password=String(b.password).trim(); saveData(); return send(res,200,{ok:true}); }
    }

    // Satış raporu
    if (url === '/api/admin/report' && req.method === 'GET') {
      const u = new URL(req.url, 'http://x');
      const day = u.searchParams.get('day'); // YYYY-MM-DD
      const orders = day ? data.orders.filter(o=>String(o.at||'').slice(0,10)===day) : data.orders;
      const total = orders.reduce((s,o)=>s+(o.total||0),0);
      const orderCount = orders.length;
      // en çok satan ürünler
      const prodCount = {};
      for (const o of orders) for (const it of (o.items||[])) { const k=it.name; prodCount[k]=(prodCount[k]||0)+(parseInt(it.qty,10)||1); }
      const topProducts = Object.entries(prodCount).sort((a,b)=>b[1]-a[1]).slice(0,10).map(([name,count])=>({name,count}));
      // çalışan bazlı
      const staffStats = {};
      for (const o of orders) { const n=o.staffName||'—'; if(!staffStats[n]) staffStats[n]={count:0,total:0}; staffStats[n].count++; staffStats[n].total+=(o.total||0); }
      return send(res, 200, { ok:true, day:day||'all', total, orderCount, topProducts, staffStats });
    }

    // Status
    if (url === '/api/admin/status') return send(res, 200, { ok: true, username: config.username });

    return send(res, 404, { ok: false, error: 'Неизвестный маршрут' });
  }

  // Admin panel page
  if (url === '/admin' || url === '/admin.html') {
    const fp = path.join(ROOT, 'admin.html');
    fs.readFile(fp, (err, buf) => {
      if (err) return send(res, 404, { error: 'Not found' });
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Length': buf.length, 'Cache-Control': 'no-store' });
      res.end(buf);
    });
    return;
  }

  // Digital menu page (QR)
  if (url === '/menu' || url === '/menu.html') {
    const fp = path.join(ROOT, 'menu.html');
    fs.readFile(fp, (err, buf) => {
      if (err) return send(res, 404, { error: 'Not found' });
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Length': buf.length, 'Cache-Control': 'no-store' });
      res.end(buf);
    });
    return;
  }

  // Bonus müşteri uygulaması
  if (url === '/app' || url === '/app.html' || url === '/bonus') {
    const fp = path.join(ROOT, 'app.html');
    fs.readFile(fp, (err, buf) => {
      if (err) return send(res, 404, { error: 'Not found' });
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Length': buf.length, 'Cache-Control': 'no-store' });
      res.end(buf);
    });
    return;
  }

  // Kasa/çalışan paneli
  if (url === '/kasa' || url === '/kasa.html') {
    const fp = path.join(ROOT, 'kasa.html');
    fs.readFile(fp, (err, buf) => {
      if (err) return send(res, 404, { error: 'Not found' });
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Length': buf.length, 'Cache-Control': 'no-store' });
      res.end(buf);
    });
    return;
  }

  // Everything else -> static
  serveStatic(req, res, url);
});

initData().then(() => {
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`RIO Admin server running at http://0.0.0.0:${PORT}`);
    console.log(`Admin panel: http://0.0.0.0:${PORT}/admin`);
    if (sb.ENABLED) console.log('Veri deposu: Supabase (kalıcı) ✓');
    else console.log('Veri deposu: JSON dosya (geçici — Supabase kurulursa kalıcı olur)');
  });
}).catch(err => {
  console.error('Başlatma hatası:', err.message);
  server.listen(PORT, '0.0.0.0', () => console.log(`Fallback sunucu çalışıyor :${PORT}`));
});
