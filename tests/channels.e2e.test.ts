import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { startTestServer } from './helpers/server.ts';

let srv: Awaited<ReturnType<typeof startTestServer>>;
before(async () => { srv = await startTestServer({}, { fakeVendors: true }); });
after(async () => { await srv.stop(); });

const channel = async (key: string) => ((await srv.api('GET', '/api/channels')).json as any[]).find((c) => c.channelKey === key);
const log = () => fs.readFileSync(srv.logFile, 'utf8');

test('connection screen data: exact redirect address and nothing connected yet', async () => {
  const r = (await srv.api('GET', '/api/channels/connect-info')).json;
  assert.match(r.redirectUri, /\/api\/channels\/oauth\/callback$/);
  assert.equal(r.facebook.hasApp, false);
  assert.equal(r.status.line_oa.connected, false);
});

test('LINE: a wrong token is rejected with a plain reason and nothing is saved; a right one connects and shows the account name', async () => {
  const bad = await srv.api('POST', '/api/channels/line_oa/connect', { token: 'bad-token-' + 'z'.repeat(40) });
  assert.equal(bad.status, 400);
  assert.match(bad.json.error, /ปฏิเสธ|ออกโทเค็นใหม่/);
  assert.equal((await channel('line_oa')).connected, false);
  assert.equal((await srv.api('POST', '/api/channels/line_oa/connect', { token: 'short' })).status, 400);

  const token = 'LINE_REAL_TOKEN_' + 'k'.repeat(40);
  const ok = await srv.api('POST', '/api/channels/line_oa/connect', { token });
  assert.equal(ok.status, 200, ok.text);
  assert.equal(ok.json.accountName, 'คมคิด Official');
  const c = await channel('line_oa');
  assert.equal(c.connected, true);
  assert.equal(c.accountName, 'คมคิด Official');
  assert.ok(!JSON.stringify(c).includes(token), 'the token is never sent back to the browser');

  // the saved token is what real broadcasts use
  const d = await srv.api('POST', '/api/publish/dispatch', { channels: ['line_oa'], title: 'ทดสอบ', content: 'เนื้อหา' });
  assert.equal(d.status, 201, d.text);
  assert.match(log(), /line broadcast Bearer LINE_REAL_TOK/);

  assert.equal((await srv.api('POST', '/api/channels/line_oa/verify')).json.ok, true);
  await srv.api('POST', '/api/channels/line_oa/disconnect');
  assert.equal((await channel('line_oa')).connected, false);
  assert.equal((await srv.api('POST', '/api/channels/line_oa/verify')).status, 400);
});

test('connection endpoints are admin-only except the signed OAuth callback', async () => {
  for (const [m, u] of [['POST', '/api/channels/line_oa/connect'], ['GET', '/api/channels/connect-info'], ['POST', '/api/channels/facebook/oauth/start'], ['POST', '/api/channels/tiktok/disconnect'], ['GET', '/api/channels/facebook/pages?nonce=x']]) {
    assert.equal((await srv.api(m, u, m === 'POST' ? {} : undefined, { auth: false })).status, 401, `${m} ${u}`);
  }
  const cb = await fetch(`${srv.base}/api/channels/oauth/callback?code=abc&state=forged.state`, { redirect: 'manual' });
  assert.equal(cb.status, 400, 'a forged state is rejected');
});

test('Facebook OAuth: needs app credentials first, validates them, then one page connects automatically', async () => {
  assert.equal((await srv.api('POST', '/api/channels/facebook/oauth/start')).status, 400);
  assert.equal((await srv.api('POST', '/api/channels/facebook/app', { appId: 'bad id!', appSecret: 'abcdefgh12345' })).status, 400);
  const saved = await srv.api('POST', '/api/channels/facebook/app', { appId: '123456789012345', appSecret: 'abcdef0123456789abcdef' });
  assert.equal(saved.json.hasApp, true);
  const info = (await srv.api('GET', '/api/channels/connect-info')).json;
  assert.equal(info.facebook.appId, '123456789012345');
  assert.ok(!JSON.stringify(info).includes('abcdef0123456789abcdef'), 'the app secret is never returned');

  const start = await srv.api('POST', '/api/channels/facebook/oauth/start');
  const u = new URL(start.json.url);
  assert.equal(u.hostname, 'www.facebook.com');
  assert.equal(u.searchParams.get('client_id'), '123456789012345');
  assert.match(u.searchParams.get('scope') || '', /pages_manage_posts/);
  assert.match(u.searchParams.get('redirect_uri') || '', /\/api\/channels\/oauth\/callback$/);
  const state = u.searchParams.get('state')!;

  // tampering with the state must fail
  const [body, sig] = state.split('.');
  const forged = await fetch(`${srv.base}/api/channels/oauth/callback?code=abc&state=${body}x.${sig}`, { redirect: 'manual' });
  assert.equal(forged.status, 400);

  const denied = await fetch(`${srv.base}/api/channels/oauth/callback?error=access_denied&state=${state}`, { redirect: 'manual' });
  assert.match(denied.headers.get('location') || '', /connect=denied/);

  const cb = await fetch(`${srv.base}/api/channels/oauth/callback?code=abc&state=${state}`, { redirect: 'manual' });
  assert.equal(cb.status, 302);
  assert.match(cb.headers.get('location') || '', /\/admin\?channel=facebook&connect=ok/);
  const c = await channel('facebook');
  assert.equal(c.connected, true);
  assert.equal(c.accountName, 'เพจคมคิด');
  assert.equal(c.targetId, '1000000001');
  assert.equal(c.connectionMode, 'oauth');
  assert.match(log(), /fb token long/, 'exchanged for a long-lived token');
  // real posting works with the saved page token
  const d = await srv.api('POST', '/api/publish/dispatch', { channels: ['facebook'], title: 'โพสต์ทดสอบ', content: 'เนื้อหา', coverImage: '', videoUrl: '' });
  assert.equal(d.status, 201, d.text);
  assert.match(log(), /fb feed/);
});

test('Facebook OAuth with several pages: the admin chooses; with none: a clear message', async () => {
  fs.writeFileSync(srv.ctrlFile, 'fb-two-pages');
  const state = new URL((await srv.api('POST', '/api/channels/facebook/oauth/start')).json.url).searchParams.get('state')!;
  const cb = await fetch(`${srv.base}/api/channels/oauth/callback?code=abc&state=${state}`, { redirect: 'manual' });
  const loc = new URL(cb.headers.get('location')!, srv.base);
  assert.equal(loc.searchParams.get('connect'), 'choose');
  const nonce = loc.searchParams.get('nonce')!;
  const pages = (await srv.api('GET', `/api/channels/facebook/pages?nonce=${nonce}`)).json.pages;
  assert.deepEqual(pages.map((p: any) => p.name).sort(), ['เพจคมคิด', 'เพจโครงการพิเศษ']);
  assert.ok(!JSON.stringify(pages).includes('PAGE_TOKEN'), 'page tokens never leave the server');
  assert.equal((await srv.api('POST', '/api/channels/facebook/choose-page', { nonce, pageId: '999' })).status, 400);
  const pick = await srv.api('POST', '/api/channels/facebook/choose-page', { nonce, pageId: '1000000002' });
  assert.equal(pick.json.accountName, 'เพจโครงการพิเศษ');
  assert.equal((await channel('facebook')).targetId, '1000000002');
  assert.equal((await srv.api('POST', '/api/channels/facebook/choose-page', { nonce, pageId: '1000000002' })).status, 400, 'pending selection is single-use');

  fs.writeFileSync(srv.ctrlFile, 'fb-no-pages');
  const s2 = new URL((await srv.api('POST', '/api/channels/facebook/oauth/start')).json.url).searchParams.get('state')!;
  const none = await fetch(`${srv.base}/api/channels/oauth/callback?code=abc&state=${s2}`, { redirect: 'manual' });
  assert.match(decodeURIComponent(none.headers.get('location') || ''), /ไม่พบเพจ/);
  fs.writeFileSync(srv.ctrlFile, '');
});

test('TikTok OAuth connects, and its short-lived token is refreshed automatically before use', async () => {
  await srv.api('POST', '/api/channels/tiktok/app', { appId: 'awtiktokclientkey', appSecret: 'tiktoksecret123456' });
  const state = new URL((await srv.api('POST', '/api/channels/tiktok/oauth/start')).json.url).searchParams.get('state')!;
  const cb = await fetch(`${srv.base}/api/channels/oauth/callback?code=abc&state=${state}`, { redirect: 'manual' });
  assert.match(cb.headers.get('location') || '', /connect=ok/);
  const c = await channel('tiktok');
  assert.equal(c.connected, true);
  assert.equal(c.accountName, 'คมคิดทีวี');
  // the fake platform issued a token that expires in 60s -> the next use must refresh it
  const v = await srv.api('POST', '/api/channels/tiktok/verify');
  assert.equal(v.json.ok, true);
  assert.match(log(), /tiktok refresh/);
  await srv.api('POST', '/api/channels/tiktok/disconnect');
  assert.equal((await channel('tiktok')).connected, false);
});
