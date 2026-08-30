import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'platform-test-'));
process.env.PLATFORM_DATA_DIR = dir;
process.env.ADMIN_USER = 'admin';
process.env.ADMIN_PASS = 'test123';

const { createServer } = await import('./server.js');
let server;
let base;

before(async () => {
  server = createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = 'http://127.0.0.1:' + server.address().port;
});

after(() => new Promise((resolve) => server.close(resolve)));

test('健康检查', async () => {
  const res = await fetch(base + '/health');
  assert.equal(res.status, 200);
});

test('管理登录与渠道/广告/点击闭环', async () => {
  // 错误密码
  const bad = await fetch(base + '/api/admin/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'wrong' }),
  });
  assert.equal(bad.status, 401);

  const ok = await fetch(base + '/api/admin/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'test123' }),
  });
  const login = await ok.json();
  assert.ok(login.token);
  const auth = { 'content-type': 'application/json', authorization: 'Bearer ' + login.token };

  // 未登录访问管理接口应 401
  const noAuth = await fetch(base + '/api/admin/channels');
  assert.equal(noAuth.status, 401);

  // 新增渠道
  const chRes = await fetch(base + '/api/admin/channels', {
    method: 'POST',
    headers: auth,
    body: JSON.stringify({ name: '财会测试公司', paramsUrl: 'https://example.com/p.json' }),
  });
  const ch = await chRes.json();
  assert.equal(ch.name, '财会测试公司');

  // 公开渠道列表带签名
  const pub = await fetch(base + '/api/public/channels');
  const pubData = await pub.json();
  assert.ok(pubData.sig);
  assert.equal(pubData.list.length, 1);
  assert.equal(pubData.list[0].name, '财会测试公司');

  // 新增广告
  const adRes = await fetch(base + '/api/admin/ads', {
    method: 'POST',
    headers: auth,
    body: JSON.stringify({ title: '测试广告', link: 'https://example.com/ad', pages: ['home'] }),
  });
  const ad = await adRes.json();

  const pubAds = await (await fetch(base + '/api/public/ads')).json();
  assert.equal(pubAds.list.length, 1);

  // 点击上报
  const click1 = await fetch(base + '/api/public/click', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ adId: ad.id, deviceId: 'dev-1' }),
  });
  const clickData = await click1.json();
  assert.equal(clickData.ok, true);
  assert.equal(clickData.url, 'https://example.com/ad');

  // 3 秒内重复点击应被限频
  const click2 = await fetch(base + '/api/public/click', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ adId: ad.id, deviceId: 'dev-1' }),
  });
  assert.equal(click2.status, 429);

  const stats = await (await fetch(base + '/api/admin/stats', { headers: auth })).json();
  assert.equal(stats.totalClicks, 1);
});
