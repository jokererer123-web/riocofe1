/*
 * Supabase REST (PostgREST) bağlantı katmanı
 * Harici paket gerektirmez — Node fetch + HTTP kullanır.
 * Ortam değişkenleri:
 *   SUPABASE_URL  = https://xxxx.supabase.co
 *   SUPABASE_ANON_KEY = eyJ... (anon key)
 * Bu değişkenler yoksa bu modül devre dışı kalır (JSON dosya fallback).
 */
const https = require('https');

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY || '';
const ENABLED = !!(SUPABASE_URL && SUPABASE_KEY);

function request(url, options) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.request({
      hostname: u.hostname,
      path: u.pathname + u.search,
      method: options.method || 'GET',
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': 'Bearer ' + SUPABASE_KEY,
        'Content-Type': 'application/json',
        ...(options.headers || {})
      }
    }, res => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => {
        let json = null;
        try { json = body ? JSON.parse(body) : null; } catch { json = body; }
        resolve({ status: res.statusCode, json, body });
      });
    });
    req.on('error', reject);
    if (options.body) req.write(JSON.stringify(options.body));
    req.end();
  });
}

function table(name) {
  return {
    // tüm satırları çek (ordering opsiyonel)
    async selectAll(orderBy) {
      const q = SUPABASE_URL + '/rest/v1/' + name +
        (orderBy ? '?order=' + encodeURIComponent(orderBy) : '?limit=10000');
      const r = await request(q, { method: 'GET' });
      if (r.status >= 400) throw new Error(name + ' select: ' + r.status);
      return r.json || [];
    },
    // tek satır çek (filter: {col: val})
    async selectOne(filter) {
      const parts = [];
      for (const k in filter) parts.push(k + '=eq.' + encodeURIComponent(filter[k]));
      const q = SUPABASE_URL + '/rest/v1/' + name + '?' + parts.join('&') + '&limit=1';
      const r = await request(q, { method: 'GET' });
      if (r.status >= 400) throw new Error(name + ' selectOne: ' + r.status);
      return (r.json || [])[0] || null;
    },
    // ekle (tek nesne)
    async insert(row) {
      const r = await request(SUPABASE_URL + '/rest/v1/' + name, {
        method: 'POST', body: row, headers: { 'Prefer': 'return=representation' }
      });
      if (r.status >= 400 && r.status !== 201) throw new Error(name + ' insert: ' + r.status + ' ' + (typeof r.body==='string'?r.body.slice(0,200):''));
      return (r.json || [])[0];
    },
    // upsert: id çakışırsa güncelle (şema uyumlu)
    async upsert(row) {
      const r = await request(SUPABASE_URL + '/rest/v1/' + name + '?on_conflict=id', {
        method: 'POST', body: row, headers: { 'Prefer': 'resolution=merge-duplicates,return=minimal' }
      });
      if (r.status >= 400 && r.status !== 201) throw new Error(name + ' upsert: ' + r.status + ' ' + (typeof r.body==='string'?r.body.slice(0,200):''));
      return true;
    },
    // güncelle (filter ile)
    async update(filter, patch) {
      const parts = [];
      for (const k in filter) parts.push(k + '=eq.' + encodeURIComponent(filter[k]));
      const r = await request(SUPABASE_URL + '/rest/v1/' + name + '?' + parts.join('&'), {
        method: 'PATCH', body: patch, headers: { 'Prefer': 'return=representation' }
      });
      if (r.status >= 400) throw new Error(name + ' update: ' + r.status);
      return r.json || [];
    },
    // sil (filter ile)
    async delete(filter) {
      const parts = [];
      for (const k in filter) parts.push(k + '=eq.' + encodeURIComponent(filter[k]));
      const r = await request(SUPABASE_URL + '/rest/v1/' + name + '?' + parts.join('&'), {
        method: 'DELETE'
      });
      if (r.status >= 400) throw new Error(name + ' delete: ' + r.status);
      return r.json || [];
    },
    // tümünü sil
    async deleteAll() {
      const r = await request(SUPABASE_URL + '/rest/v1/' + name + '?id=neq.____', {
        method: 'DELETE'
      });
      if (r.status >= 400 && r.status !== 204) throw new Error(name + ' deleteAll: ' + r.status);
      return true;
    }
  };
}

module.exports = { ENABLED, table, request };
