'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = process.env.PLATFORM_DATA_DIR || path.join(__dirname, 'data');
const PORT = Number(process.env.PORT || 8080);
const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASS = process.env.ADMIN_PASS || 'change-me-please';

fs.mkdirSync(DATA_DIR, { recursive: true });

// 签名密钥：首次运行自动生成 Ed25519 密钥对
const KEYS_PATH = path.join(DATA_DIR, 'keys.json');
function loadKeys() {
  if (fs.existsSync(KEYS_PATH)) {
    return JSON.parse(fs.readFileSync(KEYS_PATH, 'utf8'));
  }
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const kp = {
    publicKey: publicKey.export({ type: 'spki', format: 'pem' }),
    privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' }),
  };
  fs.writeFileSync(KEYS_PATH, JSON.stringify(kp, null, 2));
  return kp;
}
const KEYS = loadKeys();

const DB_PATH = path.join(DATA_DIR, 'db.json');
function loadDb() {
  if (!fs.existsSync(DB_PATH)) return { channels: [], ads: [], clicks: [] };
  try {
    return JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
  } catch {
    return { channels: [], ads: [], clicks: [] };
  }
}
let DB = loadDb();
function saveDb() {
  const tmp = DB_PATH + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(DB, null, 2));
  fs.renameSync(tmp, DB_PATH);
}

const SESSIONS = new Map(); // token -> 过期时间
const clickLog = new Map(); // deviceId:adId -> 上次点击时间

function json(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'access-control-allow-origin': '*',
    'access-control-allow-headers': 'content-type, authorization',
    'access-control-allow-methods': 'GET,POST,PUT,DELETE,OPTIONS',
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => (data += c));
    req.on('end', () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

// 对公开数据签名：字段按 key 排序后 Ed25519 签名，防篡改
function signPayload(obj) {
  const sorted = {};
  for (const k of Object.keys(obj).sort()) sorted[k] = obj[k];
  const data = Buffer.from(JSON.stringify(sorted));
  const sig = crypto.sign(null, data, KEYS.privateKey).toString('base64');
  return { ...sorted, sig };
}

function isAuth(req) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  const exp = SESSIONS.get(token);
  return !!exp && exp > Date.now();
}

function createServer() {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    const p = url.pathname;
    if (req.method === 'OPTIONS') return json(res, 204, {});
    try {
      // 健康检查
      if (req.method === 'GET' && p === '/health') return json(res, 200, { ok: true });

      // ---- 公开接口（客户端使用） ----
      if (p.startsWith('/api/public/')) {
        if (req.method === 'GET' && p === '/api/public/key') {
          return json(res, 200, { publicKey: KEYS.publicKey });
        }
        if (req.method === 'GET' && p === '/api/public/channels') {
          const now = Date.now();
          const list = DB.channels
            .filter((c) => c.enabled && (!c.expiresAt || c.expiresAt > now))
            .map((c) => ({
              id: c.id,
              name: c.name,
              logo: c.logo || '',
              paramsUrl: c.paramsUrl,
              updatedAt: c.updatedAt || '',
            }));
          return json(res, 200, signPayload({ list }));
        }
        if (req.method === 'GET' && p === '/api/public/ads') {
          const now = Date.now();
          const list = DB.ads
            .filter(
              (a) =>
                a.enabled &&
                (!a.startAt || a.startAt <= now) &&
                (!a.endAt || a.endAt > now),
            )
            .map((a) => ({
              id: a.id,
              title: a.title,
              image: a.image || '',
              link: a.link,
              pages: a.pages || [],
            }));
          return json(res, 200, signPayload({ list }));
        }
        if (req.method === 'POST' && p === '/api/public/click') {
          const body = await readBody(req);
          const ad = DB.ads.find((a) => a.id === body.adId);
          if (!ad) return json(res, 404, { error: 'ad not found' });
          const now = Date.now();
          const key = (body.deviceId || 'anon') + ':' + body.adId;
          const last = clickLog.get(key) || 0;
          if (now - last < 3000) return json(res, 429, { error: 'too many clicks' });
          clickLog.set(key, now);
          DB.clicks.push({
            adId: body.adId,
            deviceId: body.deviceId || 'anon',
            ts: now,
            ip: req.socket.remoteAddress || '',
          });
          if (DB.clicks.length > 200000) DB.clicks.splice(0, 100000);
          saveDb();
          return json(res, 200, { ok: true, url: ad.link });
        }
        return json(res, 404, { error: 'not found' });
      }

      // ---- 管理后台接口 ----
      if (req.method === 'POST' && p === '/api/admin/login') {
        const b = await readBody(req);
        if (b.username === ADMIN_USER && b.password === ADMIN_PASS) {
          const token = crypto.randomBytes(24).toString('hex');
          SESSIONS.set(token, Date.now() + 7 * 24 * 3600 * 1000);
          return json(res, 200, { token });
        }
        return json(res, 401, { error: 'bad credentials' });
      }
      if (!isAuth(req)) return json(res, 401, { error: 'unauthorized' });

      if (p === '/api/admin/channels' && req.method === 'GET') {
        return json(res, 200, DB.channels);
      }
      if (p === '/api/admin/channels' && req.method === 'POST') {
        const b = await readBody(req);
        const ch = {
          id: crypto.randomUUID(),
          enabled: true,
          expiresAt: null,
          ...b,
          updatedAt: new Date().toISOString(),
        };
        DB.channels.push(ch);
        saveDb();
        return json(res, 200, ch);
      }
      const cm = p.match(/^\/api\/admin\/channels\/([^/]+)$/);
      if (cm && req.method === 'PUT') {
        const b = await readBody(req);
        const idx = DB.channels.findIndex((c) => c.id === cm[1]);
        if (idx < 0) return json(res, 404, { error: 'not found' });
        DB.channels[idx] = { ...DB.channels[idx], ...b, id: cm[1], updatedAt: new Date().toISOString() };
        saveDb();
        return json(res, 200, DB.channels[idx]);
      }
      if (cm && req.method === 'DELETE') {
        DB.channels = DB.channels.filter((c) => c.id !== cm[1]);
        saveDb();
        return json(res, 200, { ok: true });
      }

      if (p === '/api/admin/ads' && req.method === 'GET') return json(res, 200, DB.ads);
      if (p === '/api/admin/ads' && req.method === 'POST') {
        const b = await readBody(req);
        const ad = {
          id: crypto.randomUUID(),
          enabled: true,
          startAt: null,
          endAt: null,
          pages: [],
          ...b,
          createdAt: new Date().toISOString(),
        };
        DB.ads.push(ad);
        saveDb();
        return json(res, 200, ad);
      }
      const am = p.match(/^\/api\/admin\/ads\/([^/]+)$/);
      if (am && req.method === 'PUT') {
        const b = await readBody(req);
        const idx = DB.ads.findIndex((a) => a.id === am[1]);
        if (idx < 0) return json(res, 404, { error: 'not found' });
        DB.ads[idx] = { ...DB.ads[idx], ...b, id: am[1] };
        saveDb();
        return json(res, 200, DB.ads[idx]);
      }
      if (am && req.method === 'DELETE') {
        DB.ads = DB.ads.filter((a) => a.id !== am[1]);
        saveDb();
        return json(res, 200, { ok: true });
      }

      if (p === '/api/admin/stats' && req.method === 'GET') {
        const byAd = {};
        for (const c of DB.clicks) byAd[c.adId] = (byAd[c.adId] || 0) + 1;
        return json(res, 200, { totalClicks: DB.clicks.length, byAd });
      }

      // ---- 管理后台静态页面 ----
      if (p === '/' || p === '/admin' || p === '/admin/') {
        res.writeHead(302, { location: '/admin/index.html' });
        return res.end();
      }
      if (p.startsWith('/admin/')) {
        const adminRoot = path.join(__dirname, '..', 'admin');
        const file = path.normalize(path.join(adminRoot, p.slice('/admin/'.length)));
        if (!file.startsWith(adminRoot)) return json(res, 403, { error: 'forbidden' });
        if (fs.existsSync(file) && fs.statSync(file).isFile()) {
          const ext = path.extname(file);
          const type =
            ext === '.html'
              ? 'text/html; charset=utf-8'
              : ext === '.js'
                ? 'application/javascript; charset=utf-8'
                : ext === '.css'
                  ? 'text/css; charset=utf-8'
                  : 'application/octet-stream';
          res.writeHead(200, { 'content-type': type });
          fs.createReadStream(file).pipe(res);
          return;
        }
        return json(res, 404, { error: 'not found' });
      }
      return json(res, 404, { error: 'not found' });
    } catch (e) {
      json(res, 500, { error: String((e && e.message) || e) });
    }
  });
}

if (require.main === module) {
  const server = createServer();
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`平台服务已启动：http://0.0.0.0:${PORT}（管理后台 /admin）`);
    console.log(`管理员：${ADMIN_USER}（请用环境变量 ADMIN_PASS 修改密码）`);
  });
}

module.exports = { createServer, getKeys: () => KEYS, getDb: () => DB };
