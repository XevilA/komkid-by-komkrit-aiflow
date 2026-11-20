import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer } from './helpers/server.ts';

let srv: Awaited<ReturnType<typeof startTestServer>>;
let noPw: Awaited<ReturnType<typeof startTestServer>>;
before(async () => {
  srv = await startTestServer();
  // an install where nobody configured a password
  noPw = await startTestServer({ ADMIN_PASSWORD: '', ADMIN_USERNAME: 'admin' }).catch(() => null as any);
});
after(async () => { await srv.stop(); if (noPw) await noPw.stop(); });

const post = async (base: string, url: string, body: unknown, headers: Record<string, string> = {}) => {
  const r = await fetch(`${base}${url}`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
  return { status: r.status, json: await r.json().catch(() => null), headers: r.headers };
};

test('there is no built-in default password: the old public default must not log in', async () => {
  for (const guess of ['komkrit2026', 'admin', 'change-me-strong-password', 'password']) {
    const r = await post(srv.base, '/api/auth/login', { username: 'e2e-admin', password: guess });
    assert.equal(r.status, 401, guess);
  }
  if (noPw) {
    for (const [u, p] of [['admin', 'komkrit2026'], ['admin', ''], ['admin', 'admin']]) {
      const r = await post(noPw.base, '/api/auth/login', { username: u, password: p });
      assert.ok(r.status === 401 || r.status === 503, `unconfigured install must reject ${p}: got ${r.status}`);
    }
  }
});

test('login throttling cannot be bypassed by forging X-Forwarded-For (only the proxy-added address counts)', async () => {
  let blocked = false;
  for (let i = 0; i < 14; i++) {
    // attacker rotates the first entry; the trusted proxy appended the real address last
    const r = await post(srv.base, '/api/auth/login', { username: 'x', password: `guess-${i}` }, { 'x-forwarded-for': `10.0.0.${i}, 203.0.113.77` });
    if (r.status === 429) { blocked = true; break; }
  }
  assert.equal(blocked, true, 'rotating forged addresses must still hit the limiter');
  // and a correct login from that address is also held back while limited
  const stillLimited = await post(srv.base, '/api/auth/login', { username: 'e2e-admin', password: 'whatever' }, { 'x-forwarded-for': '10.9.9.9, 203.0.113.77' });
  assert.equal(stillLimited.status, 429);
});

test('anonymous visitors cannot send large JSON bodies; admins still can', async () => {
  const big = { name: 'x', email: 'a@b.co', message: 'y'.repeat(400_000) };
  const anon = await post(srv.base, '/api/contacts', big, { 'x-forwarded-for': '198.51.100.1' });
  assert.equal(anon.status, 413);
  const admin = await srv.api('POST', '/api/posts', { title: 'big', content: 'z'.repeat(400_000), category: 'education', status: 'draft' });
  assert.equal(admin.status, 201);
});

test('security headers are present', async () => {
  const r = await fetch(`${srv.base}/api/health`, { headers: { 'x-forwarded-proto': 'https' } });
  assert.match(r.headers.get('content-security-policy') || '', /object-src 'none'/);
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
  assert.match(r.headers.get('strict-transport-security') || '', /max-age=/);
  assert.equal(r.headers.get('x-powered-by'), null);
});

test('admin-only surfaces are closed to anonymous visitors', async () => {
  for (const [m, u] of [['GET', '/api/workspaces'], ['GET', '/api/ai/health'], ['GET', '/api/ai/batches'], ['POST', '/api/posts'], ['DELETE', '/api/posts/1'], ['PUT', '/api/site-config'], ['GET', '/api/settings/ai'], ['GET', '/api/subscribers'], ['GET', '/api/contacts']]) {
    const r = await fetch(`${srv.base}${u}`, { method: m, headers: { 'content-type': 'application/json' }, body: m === 'GET' ? undefined : '{}' });
    assert.equal(r.status, 401, `${m} ${u}`);
  }
});

test('comments: only on published posts, length-limited, role normalised, rate limited', async () => {
  const pub = await srv.api('POST', '/api/posts', { title: 'Commentable', content: 'c'.repeat(60), category: 'education', status: 'published', slug: 'commentable' });
  const draft = await srv.api('POST', '/api/posts', { title: 'Hidden draft', content: 'c'.repeat(60), category: 'education', status: 'draft', slug: 'hidden-draft' });
  const h = { 'x-forwarded-for': '198.51.100.50' };
  assert.equal((await post(srv.base, '/api/posts/99999/comments', { message: 'hi' }, h)).status, 404);
  assert.equal((await post(srv.base, `/api/posts/${draft.json.id}/comments`, { message: 'hi' }, h)).status, 404);
  assert.equal((await post(srv.base, `/api/posts/${pub.json.id}/comments`, { message: 'x'.repeat(1501) }, h)).status, 400);
  assert.equal((await post(srv.base, `/api/posts/${pub.json.id}/comments`, { message: '   ' }, h)).status, 400);
  const ok = await post(srv.base, `/api/posts/${pub.json.id}/comments`, { authorName: 'n'.repeat(200), authorRole: '<script>x</script>', message: '<b>hi</b>', rating: 99 }, h);
  assert.equal(ok.status, 201);
  assert.equal(ok.json.authorName.length, 80);
  assert.equal(ok.json.authorRole, 'ผู้สนใจทั่วไป');
  assert.equal(ok.json.rating, 5);
  assert.equal(ok.json.message, '<b>hi</b>', 'stored as text; the UI renders it as text, never as markup');
  let limited = false;
  for (let i = 0; i < 15; i++) {
    const r = await post(srv.base, `/api/posts/${pub.json.id}/comments`, { message: `spam ${i}` }, h);
    if (r.status === 429) { limited = true; break; }
  }
  assert.equal(limited, true);
});
