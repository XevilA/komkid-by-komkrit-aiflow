import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { startTestServer } from './helpers/server.ts';
import { hasPublishIntent } from '../server/ceoAgent.ts';

let srv: Awaited<ReturnType<typeof startTestServer>>;
before(async () => { srv = await startTestServer({}, { fakeVendors: true }); });
after(async () => { await srv.stop(); });

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function newWs(brief = '') {
  const r = await srv.api('POST', '/api/workspaces', brief ? { brief } : {});
  assert.equal(r.status, 201, r.text);
  return r.json.project.id as number;
}
async function say(id: number, message: string) {
  const r = await srv.api('POST', `/api/workspaces/${id}/message`, { message });
  assert.ok(r.status === 202 || r.status === 200, r.text);
  return settle(id);
}
async function settle(id: number) {
  for (let i = 0; i < 200; i++) {
    const r = await srv.api('GET', `/api/workspaces/${id}`);
    if (!r.json.running) return r.json;
    await sleep(50);
  }
  throw new Error('agent run did not finish');
}
const postsCount = async () => (await srv.api('GET', '/api/posts')).json.length as number;
const lastCeo = (s: any) => [...s.events].reverse().find((e: any) => e.role === 'ceo' && e.kind === 'message')?.content;

test('publish intent is strict: drafting a post is not publishing it', () => {
  assert.equal(hasPublishIntent('ช่วยเผยแพร่บทความนี้เลย'), true);
  assert.equal(hasPublishIntent('publish it'), true);
  assert.equal(hasPublishIntent('ลงเว็บให้หน่อย'), true);
  assert.equal(hasPublishIntent('ร่างโพสต์เรื่อง AI ให้หน่อย'), false);
  assert.equal(hasPublishIntent('ยังไม่ต้องเผยแพร่นะ'), false);
  assert.equal(hasPublishIntent('อย่าโพสต์ก่อน'), false);
});

test('capabilities reflect real configuration', async () => {
  const c = (await srv.api('GET', '/api/workspaces/capabilities')).json;
  assert.equal(c.llm, true);
  assert.equal(c.image, true);
  assert.equal(c.video, false);
});

test('CEO plans research -> write; draft + research land in the shared workspace; nothing is published', async () => {
  const before = await postsCount();
  const id = await newWs();
  const s = await say(id, 'ช่วยเขียนบทความเรื่อง AI ช่วยครูลดงานเอกสาร');
  assert.ok(s.project.draft.content.length > 300);
  assert.equal(s.project.draft.slug, 'test-article-slug');
  assert.ok(s.project.research.summary);
  assert.equal(s.project.status, 'drafting');
  assert.equal(await postsCount(), before, 'no post is created without a publish instruction');
  const kinds = s.events.map((e: any) => `${e.agent}:${e.kind}`);
  assert.ok(kinds.includes('research:action') && kinds.includes('writer:result'), kinds.join());
  assert.equal(lastCeo(s), 'ร่างบทความเสร็จแล้ว');
});

test('whole flow in one workspace: draft -> cover -> revise keeps cover -> publish attaches everything', async () => {
  const id = await newWs();
  await say(id, 'ช่วยเขียนบทความเรื่อง ห้องเรียน Active Learning');
  const withCover = await say(id, 'ทำรูปปกให้หน่อย');
  const coverUrl = withCover.project.media.cover?.url;
  assert.match(coverUrl, /^\/uploads\/images\//);

  const revised = await say(id, 'ช่วยปรับให้ละเอียดขึ้น');
  assert.match(revised.project.draft.content, /เพิ่มเติม/);
  assert.equal(revised.project.media.cover.url, coverUrl, 'revising must not lose the cover');

  const before = await postsCount();
  const done = await say(id, 'เผยแพร่เลย');
  assert.equal(done.project.status, 'published');
  assert.ok(done.project.postId);
  assert.equal(await postsCount(), before + 1);
  const post = (await srv.api('GET', `/api/posts/by-slug/${done.project.draft.slug}`, undefined, { auth: false })).json;
  assert.equal(post.status, 'published');
  assert.equal(post.coverImage, coverUrl, 'the cover made earlier is what gets published');
  assert.match(post.content, /เพิ่มเติม/);
});

test('"drafting a post" wording never publishes', async () => {
  const id = await newWs();
  const before = await postsCount();
  const s = await say(id, 'ร่างโพสต์เรื่องทักษะแห่งอนาคตให้หน่อย');
  assert.ok(s.project.draft.content);
  assert.equal(s.project.postId, null);
  assert.equal(await postsCount(), before);
});

test('Publish button = CEO pipeline: QA, SEO, post saved with the team media; events narrate each step', async () => {
  const id = await newWs();
  await say(id, 'เขียนบทความเรื่อง การวัดผลแบบ Portfolio');
  await say(id, 'ทำรูปปก');
  const r = await srv.api('POST', `/api/workspaces/${id}/publish`, { status: 'published' });
  assert.ok(r.status === 202 || r.status === 200);
  const s = await settle(id);
  assert.equal(s.project.status, 'published');
  assert.equal(s.project.qa.verdict, 'pass');
  // the writer already proposed a slug (made unique against earlier tests' posts), so SEO is not re-run
  assert.match(s.project.draft.slug, /^test-article-slug/);
  const tools = s.events.filter((e: any) => e.kind === 'action').map((e: any) => e.data?.tool).filter(Boolean);
  for (const t of ['qa_check', 'save_post']) assert.ok(tools.includes(t), `${t} in ${tools}`);
  const pub = (await srv.api('GET', `/api/posts/by-slug/${s.project.draft.slug}`, undefined, { auth: false })).json;
  assert.equal(pub.coverImage, s.project.media.cover.url);

  // when metadata is missing the CEO prepares it
  const id2 = await newWs();
  await srv.api('PUT', `/api/workspaces/${id2}`, { draft: { title: 'ไม่มี slug', content: '## ก\n' + 'เนื้อหา '.repeat(60) }, media: { cover: '/images/thumb-ai-edu.jpg' } });
  await srv.api('POST', `/api/workspaces/${id2}/publish`, {});
  const s2 = await settle(id2);
  assert.match(s2.project.draft.slug, /^seo-optimized-slug/);
  assert.ok(s2.events.some((e: any) => e.data?.tool === 'optimize_seo' && e.kind === 'action'));
});

test('Publish with no cover: CEO generates one automatically first', async () => {
  const id = await newWs();
  await say(id, 'เขียนบทความเรื่อง ทักษะอาชีพอาเซียน');
  assert.equal((await srv.api('GET', `/api/workspaces/${id}`)).json.project.media.cover, undefined);
  await srv.api('POST', `/api/workspaces/${id}/publish`, {});
  const s = await settle(id);
  assert.match(s.project.media.cover.url, /^\/uploads\/images\//);
  assert.equal(s.project.status, 'published');
});

test('QA "block" stops publishing and creates no post; explicit force overrides', async () => {
  const id = await newWs();
  await say(id, 'เขียนบทความเรื่อง นโยบายการศึกษา');
  fs.writeFileSync(srv.ctrlFile, 'qa-block');
  const before = await postsCount();
  await srv.api('POST', `/api/workspaces/${id}/publish`, {});
  let s = await settle(id);
  assert.equal(s.project.qa.verdict, 'block');
  assert.equal(s.project.postId, null);
  assert.equal(await postsCount(), before);
  assert.ok(s.events.some((e: any) => e.kind === 'error' && /หยุดการเผยแพร่/.test(e.content)));
  await srv.api('POST', `/api/workspaces/${id}/publish`, { force: true });
  s = await settle(id);
  assert.equal(s.project.status, 'published');
  fs.writeFileSync(srv.ctrlFile, '');
});

test('a human can publish their own manual draft even when the AI is unavailable', async () => {
  const id = await newWs();
  const put = await srv.api('PUT', `/api/workspaces/${id}`, { draft: { title: 'บทความที่เขียนเอง', content: '## หัวข้อ\n' + 'เนื้อหาที่เขียนเองโดยผู้ดูแลระบบ '.repeat(20), category: 'society', tags: ['เขียนเอง'] }, media: { cover: '/images/thumb-ai-edu.jpg' } });
  assert.equal(put.status, 200, put.text);
  fs.writeFileSync(srv.ctrlFile, 'deepseek-down'); // every LLM call now fails
  await srv.api('POST', `/api/workspaces/${id}/publish`, {});
  const s = await settle(id);
  fs.writeFileSync(srv.ctrlFile, '');
  assert.equal(s.project.status, 'published', JSON.stringify(s.events.slice(-4)));
  const pub = (await srv.api('GET', `/api/posts/by-slug/${s.project.draft.slug}`, undefined, { auth: false })).json;
  assert.equal(pub.title, 'บทความที่เขียนเอง');
});

test('when every AI is down the CEO says so plainly and the workspace is untouched', async () => {
  const id = await newWs();
  await say(id, 'เขียนบทความเรื่อง สุขภาพจิตนักเรียน');
  const before = (await srv.api('GET', `/api/workspaces/${id}`)).json.project.draft.content;
  fs.writeFileSync(srv.ctrlFile, 'deepseek-down');
  const s = await say(id, 'ช่วยแก้ให้กระชับขึ้น');
  fs.writeFileSync(srv.ctrlFile, '');
  assert.ok(s.events.some((e: any) => e.kind === 'error' && /ตอบสนองไม่ได้/.test(e.content)));
  assert.equal(s.project.draft.content, before);
});

test('delete goes through human confirmation and then really deletes', async () => {
  const p = await srv.api('POST', '/api/posts', { title: 'จะถูกลบ', content: 'x'.repeat(50), category: 'education', status: 'published' });
  const id = await newWs();
  const s = await say(id, `ลบบทความหมายเลข ${p.json.id}`);
  const confirmEv = s.events.find((e: any) => e.kind === 'confirm');
  assert.ok(confirmEv, 'a confirmation is requested');
  assert.equal((await srv.api('GET', `/api/posts/${p.json.id}`)).status, 200, 'nothing deleted before confirmation');
  const c = await srv.api('POST', `/api/workspaces/${id}/confirm`, { eventId: confirmEv.id });
  assert.equal(c.status, 200, c.text);
  assert.equal((await srv.api('GET', `/api/posts/${p.json.id}`)).status, 404);
  assert.equal((await srv.api('POST', `/api/workspaces/${id}/confirm`, { eventId: confirmEv.id })).status, 400, 'cannot be confirmed twice');
});

test('manual edits are validated and invalidate stale QA', async () => {
  const id = await newWs();
  assert.equal((await srv.api('PUT', `/api/workspaces/${id}`, { draft: { slug: 'bad slug!' } })).status, 400);
  assert.equal((await srv.api('PUT', `/api/workspaces/${id}`, { draft: { category: 'nope' } })).status, 400);
  assert.equal((await srv.api('PUT', `/api/workspaces/${id}`, { media: { cover: 'javascript:alert(1)' } })).status, 400);
  assert.equal((await srv.api('PUT', `/api/workspaces/${id}`, { draft: { title: 'x'.repeat(201) } })).status, 400);
  const ok = await srv.api('PUT', `/api/workspaces/${id}`, { draft: { title: 'ok', content: 'c'.repeat(10) } });
  assert.equal(ok.status, 200);
});

test('workspace endpoints require admin; unknown ids are 404; a post can be reopened as a workspace', async () => {
  assert.equal((await srv.api('GET', '/api/workspaces', undefined, { auth: false })).status, 401);
  assert.equal((await srv.api('POST', '/api/workspaces/1/message', { message: 'x' }, { auth: false })).status, 401);
  assert.equal((await srv.api('GET', '/api/workspaces/99999')).status, 404);
  const p = await srv.api('POST', '/api/posts', { title: 'บทความเดิม', content: '## ก\n' + 'ข'.repeat(80), category: 'education', status: 'published', coverImage: '/images/thumb-ai-edu.jpg' });
  const w = await srv.api('POST', '/api/workspaces', { fromPostId: p.json.id });
  assert.equal(w.json.project.postId, p.json.id);
  assert.equal(w.json.project.draft.title, 'บทความเดิม');
  assert.equal(w.json.project.draft.slug, p.json.slug);
  // reopening returns the same workspace instead of creating duplicates
  const again = await srv.api('POST', '/api/workspaces', { fromPostId: p.json.id });
  assert.equal(again.json.project.id, w.json.project.id);
  // deleting the post detaches (not deletes) the workspace
  await srv.api('DELETE', `/api/posts/${p.json.id}`);
  assert.equal((await srv.api('GET', `/api/workspaces/${w.json.project.id}`)).json.project.postId, null);
});
