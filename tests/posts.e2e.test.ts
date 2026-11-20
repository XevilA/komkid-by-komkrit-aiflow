import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer, type TestServer } from './helpers/server.ts';

let srv: TestServer;
before(async () => { srv = await startTestServer(); });
after(async () => { await srv.stop(); });

const mk = (over: Record<string, unknown> = {}) => ({
  title: 'บทความทดสอบ', content: '## หัวข้อ\nเนื้อหา', category: 'education', status: 'published', ...over,
});

test('a new site starts with NO demo content, and older sample data can be reviewed and removed safely', async () => {
  const fresh = await srv.api('GET', '/api/posts', undefined, { auth: false });
  assert.equal(fresh.json.length, 0, 'no pre-filled articles');
  assert.equal((await srv.api('GET', '/api/pillars', undefined, { auth: false })).json.length, 0, 'no invented business statistics');
  const ch = (await srv.api('GET', '/api/channels')).json as any[];
  assert.ok(ch.length >= 6);
  assert.ok(ch.every((c) => !c.handleOrUrl || !/komkidbykomkrit|localhost|komkrit\.com/.test(c.handleOrUrl)), 'no example social accounts');
  assert.equal((await srv.api('GET', '/api/admin/sample-data')).json.total, 0);

  // an older install: demo article from the old seed next to a real one
  const sample = await srv.api('POST', '/api/posts', { title: 'การศึกษาไทย ในยุค AI', content: 'x'.repeat(60), category: 'education', status: 'published' });
  const real = await srv.api('POST', '/api/posts', { title: 'บทความจริงของเจ้าของเว็บ', content: 'y'.repeat(60), category: 'education', status: 'published' });
  const rep = (await srv.api('GET', '/api/admin/sample-data')).json;
  assert.equal(rep.posts.length, 1);
  assert.equal(rep.posts[0].id, sample.json.id);
  assert.equal((await srv.api('POST', '/api/admin/sample-data/remove', {})).status, 400, 'needs explicit confirmation');
  assert.equal((await srv.api('POST', '/api/admin/sample-data/remove', { confirm: true }, { auth: false })).status, 401);
  const done = await srv.api('POST', '/api/admin/sample-data/remove', { confirm: true });
  assert.equal(done.status, 200);
  assert.equal((await srv.api('GET', `/api/posts/${sample.json.id}`)).status, 404);
  assert.equal((await srv.api('GET', `/api/posts/${real.json.id}`)).status, 200, 'real content is never touched');
});

test('create derives a Thai slug; same title gets -2; explicit slug honoured; invalid/conflicting rejected', async () => {
  const a = await srv.api('POST', '/api/posts', mk());
  assert.equal(a.status, 201);
  assert.equal(a.json.slug, 'บทความทดสอบ');
  const b = await srv.api('POST', '/api/posts', mk());
  assert.equal(b.json.slug, 'บทความทดสอบ-2');
  const c = await srv.api('POST', '/api/posts', mk({ title: 'x', slug: 'my-custom-slug' }));
  assert.equal(c.json.slug, 'my-custom-slug');
  assert.equal((await srv.api('POST', '/api/posts', mk({ slug: 'my-custom-slug' }))).status, 409);
  assert.equal((await srv.api('POST', '/api/posts', mk({ slug: 'bad slug!' }))).status, 400);
  assert.equal((await srv.api('POST', '/api/posts', mk({ slug: '123' }))).status, 400);
  assert.equal((await srv.api('POST', '/api/posts', mk({ status: 'weird' }))).status, 400);
  assert.equal((await srv.api('POST', '/api/posts', mk({ title: '   ' }))).status, 400);
});

test('public by-slug page data: published visible, draft hidden (admin sees it), unknown 404', async () => {
  const pub = await srv.api('POST', '/api/posts', mk({ title: 'Public One', slug: 'public-one' }));
  const draft = await srv.api('POST', '/api/posts', mk({ title: 'Draft One', slug: 'draft-one', status: 'draft' }));
  const open = await srv.api('GET', `/api/posts/by-slug/public-one`, undefined, { auth: false });
  assert.equal(open.status, 200);
  assert.equal(open.json.id, pub.json.id);
  assert.equal(open.json.canonical, true);
  assert.equal((await srv.api('GET', '/api/posts/by-slug/draft-one', undefined, { auth: false })).status, 404);
  assert.equal((await srv.api('GET', '/api/posts/by-slug/draft-one')).status, 200);
  assert.equal((await srv.api('GET', '/api/posts/by-slug/does-not-exist', undefined, { auth: false })).status, 404);
  // Thai slug works percent-encoded
  const th = await srv.api('GET', `/api/posts/by-slug/${encodeURIComponent('บทความทดสอบ')}`, undefined, { auth: false });
  assert.equal(th.status, 200);
  // numeric id resolves but is flagged non-canonical so the client redirects
  const byId = await srv.api('GET', `/api/posts/by-slug/${pub.json.id}`, undefined, { auth: false });
  assert.equal(byId.json.canonical, false);
  assert.equal(byId.json.slug, 'public-one');
  void draft;
});

test('renaming the slug keeps the old address working as a non-canonical alias', async () => {
  const p = await srv.api('POST', '/api/posts', mk({ title: 'Rename Me', slug: 'rename-me' }));
  const upd = await srv.api('PUT', `/api/posts/${p.json.id}`, { slug: 'renamed-now' });
  assert.equal(upd.json.slug, 'renamed-now');
  const old = await srv.api('GET', '/api/posts/by-slug/rename-me', undefined, { auth: false });
  assert.equal(old.status, 200);
  assert.equal(old.json.canonical, false);
  assert.equal(old.json.slug, 'renamed-now');
  // another post cannot grab the old address
  assert.equal((await srv.api('POST', '/api/posts', mk({ slug: 'rename-me' }))).status, 409);
  // editing other fields never changes the slug
  const t = await srv.api('PUT', `/api/posts/${p.json.id}`, { title: 'Totally New Title' });
  assert.equal(t.json.slug, 'renamed-now');
});

test('delete removes the post, its comments and aliases; second delete is a clear 404; needs admin', async () => {
  const p = await srv.api('POST', '/api/posts', mk({ title: 'To Delete', slug: 'to-delete' }));
  const id = p.json.id;
  const cm = await srv.api('POST', `/api/posts/${id}/comments`, { authorName: 'Tester', message: 'hello', rating: 5 }, { auth: false });
  assert.ok(cm.status < 300, cm.text);
  assert.equal((await srv.api('DELETE', `/api/posts/${id}`, undefined, { auth: false })).status, 401);
  const del = await srv.api('DELETE', `/api/posts/${id}`);
  assert.equal(del.status, 200);
  assert.equal(del.json.removedComments, 1);
  assert.equal((await srv.api('GET', '/api/posts/by-slug/to-delete', undefined, { auth: false })).status, 404);
  assert.equal((await srv.api('GET', `/api/posts/${id}`)).status, 404);
  assert.equal((await srv.api('DELETE', `/api/posts/${id}`)).status, 404);
  // the slug is free again only after deletion of both post and alias
  assert.equal((await srv.api('POST', '/api/posts', mk({ title: 'again', slug: 'to-delete' }))).status, 201);
});

test('sitemap lists slug URLs of published posts only', async () => {
  await srv.api('POST', '/api/posts', mk({ title: 'Mapped', slug: 'mapped-post' }));
  await srv.api('POST', '/api/posts', mk({ title: 'Hidden', slug: 'hidden-post', status: 'draft' }));
  const r = await srv.api('GET', '/sitemap.xml', undefined, { auth: false });
  assert.match(r.text, /\/articles\/mapped-post</);
  assert.doesNotMatch(r.text, /hidden-post/);
  assert.doesNotMatch(r.text, /\?post=/);
});

test('article page shell: real title/OG tags for the slug, 404 status for unknown, 301 for renamed slugs', async () => {
  const p = await srv.api('POST', '/api/posts', mk({ title: 'Shell Test <b>x</b>', slug: 'shell-test', excerpt: 'สรุปสำหรับแชร์ "quote" & <tag>', content: '## หัวข้อ\nเนื้อหา <script>alert(1)</script> ปกติ' }));
  assert.equal(p.status, 201);
  const ok = await fetch(`${srv.base}/articles/shell-test`);
  const html = await ok.text();
  assert.equal(ok.status, 200);
  assert.match(html, /<title>Shell Test &lt;b&gt;x&lt;\/b&gt; \|/);
  assert.match(html, /property="og:title" content="Shell Test &lt;b&gt;x&lt;\/b&gt;"/);
  assert.match(html, /rel="canonical" href="https:\/\/[^"]+\/articles\/shell-test"/);
  assert.match(html, /application\/ld\+json/);
  assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/, 'user content must never become live markup');
  assert.match(html, /data-seo-fallback/);

  assert.equal((await fetch(`${srv.base}/articles/nope-nope`)).status, 404);

  await srv.api('PUT', `/api/posts/${p.json.id}`, { slug: 'shell-test-new' });
  const moved = await fetch(`${srv.base}/articles/shell-test`, { redirect: 'manual' });
  assert.equal(moved.status, 301);
  assert.equal(moved.headers.get('location'), '/articles/shell-test-new');
  const byId = await fetch(`${srv.base}/articles/${p.json.id}`, { redirect: 'manual' });
  assert.equal(byId.status, 301);

  await srv.api('PUT', `/api/posts/${p.json.id}`, { status: 'draft' });
  assert.equal((await fetch(`${srv.base}/articles/shell-test-new`)).status, 404, 'drafts are not public');
});

test('bulk delete removes comments and slug aliases too (slugs become reusable) and bulk status changes work', async () => {
  const a = await srv.api('POST', '/api/posts', mk({ title: 'Bulk A', slug: 'bulk-a' }));
  const b = await srv.api('POST', '/api/posts', mk({ title: 'Bulk B', slug: 'bulk-b' }));
  await srv.api('POST', `/api/posts/${a.json.id}/comments`, { authorName: 'T', message: 'c', rating: 5 }, { auth: false });
  const un = await srv.api('POST', '/api/posts/bulk', { ids: [a.json.id, b.json.id], action: 'draft' });
  assert.equal(un.json.affected, 2);
  assert.equal((await srv.api('GET', '/api/posts/by-slug/bulk-a', undefined, { auth: false })).status, 404);
  const del = await srv.api('POST', '/api/posts/bulk', { ids: [a.json.id, b.json.id], action: 'delete' });
  assert.equal(del.status, 200, del.text);
  assert.equal((await srv.api('GET', '/api/posts/by-slug/bulk-a')).status, 404);
  assert.equal((await srv.api('POST', '/api/posts', mk({ title: 'again', slug: 'bulk-a' }))).status, 201, 'slug is reusable after deletion');
  assert.equal((await srv.api('POST', '/api/posts/bulk', { ids: [], action: 'delete' })).status, 400);
  assert.equal((await srv.api('POST', '/api/posts/bulk', { ids: [1], action: 'nuke' })).status, 400);
});
