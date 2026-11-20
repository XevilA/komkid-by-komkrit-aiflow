import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aiflow-batch-'));
process.env.DATA_DIR = tmp;
process.env.NODE_ENV = 'test';
process.env.DEEPSEEK_API_KEY = 'sk-test-deepseek-000000';
process.env.ANTHROPIC_API_KEY = 'sk-ant-test-000000';
process.env.OPENAI_API_KEY = 'sk-test-openai-000000';
process.env.VAULT_MASTER_KEY = 'a'.repeat(64);
process.env.ADMIN_AUTH_SECRET = 'b'.repeat(64);

const WF = JSON.stringify({
  ceoOutput: { goal: 'g', strategy: 's', keyMessage: 'k', kpiTargets: [], agentAssignments: [] },
  researchOutput: { deepInsights: ['a'], keyFacts: [], trendAnalysis: 't', references: [], kbSourcesUsed: [] },
  scriptOutput: {
    titleSuggestions: ['a', 'b', 'c'], selectedTitle: 'T', subtitle: 's', excerpt: 'e',
    learningObjectives: [], fullArticleMarkdown: '## หัวข้อ\n' + 'เนื้อหาบทความทดสอบ '.repeat(40),
    videoScript: 'v', socialHook: 'h',
  },
  designOutput: {}, visualOutput: { imagePrompts: [] }, videoOutput: {}, audioOutput: {},
  qaOutput: {}, analyticsOutput: {}, omnichannelOutput: {},
});

type H = (body: any) => { status: number; json: any };
const handlers: Record<string, H> = {};
const order: { vendor: string; model: string; topic: string }[] = [];

const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: any, init?: any) => {
  const url = String(typeof input === 'string' ? input : input.url);
  const vendor = url.includes('deepseek') ? 'deepseek' : url.includes('anthropic') ? 'claude' : url.includes('openai.com') ? 'openai' : 'other';
  if (vendor === 'other') return realFetch(input, init);
  if (/\/models/.test(url)) {
    const lists: any = {
      deepseek: { data: [{ id: 'deepseek-reasoner', created: 2 }, { id: 'deepseek-chat', created: 1 }] },
      claude: { data: [{ id: 'claude-opus-4-1', created_at: '2025-08-05T00:00:00Z' }, { id: 'claude-haiku-4-5', created_at: '2025-10-01T00:00:00Z' }] },
      openai: { data: [{ id: 'gpt-5', created: 3 }, { id: 'gpt-5-mini', created: 2 }] },
    };
    return new Response(JSON.stringify(lists[vendor]), { status: 200 });
  }
  const body = JSON.parse(init.body);
  const userMsg = (body.messages?.filter((m: any) => m.role === 'user').pop()?.content) || '';
  order.push({ vendor, model: body.model, topic: String(userMsg).match(/Topic\): (.*)/)?.[1] || '' });
  const r = handlers[vendor](body);
  return new Response(JSON.stringify(r.json), { status: r.status });
}) as typeof fetch;

const okChat = (text: string) => ({ status: 200, json: { choices: [{ message: { content: text } }], usage: { prompt_tokens: 3000, completion_tokens: 1500, prompt_cache_hit_tokens: 2500 } } });
const okClaude = (text: string) => ({ status: 200, json: { content: [{ type: 'text', text }], usage: { input_tokens: 500, output_tokens: 1500, cache_read_input_tokens: 2500 } } });
const err = (status: number, message: string) => ({ status, json: { error: { message } } });

let br: typeof import('../server/batchRunner.ts');
let router: typeof import('../server/aiRouter.ts');
let dbm: typeof import('../server/db.ts');

before(async () => {
  dbm = await import('../server/db.ts');
  dbm.initDatabase();
  router = await import('../server/aiRouter.ts');
  br = await import('../server/batchRunner.ts');
});
beforeEach(() => {
  router.resetHealth();
  order.length = 0;
  for (const k of Object.keys(handlers)) delete handlers[k];
  handlers.deepseek = () => okChat(WF);
  handlers.claude = () => okClaude(WF);
  handlers.openai = () => okChat(WF);
  dbm.db.prepare('DELETE FROM ai_cache').run();
});

test('input hygiene: dedupes topics, enforces limits', () => {
  assert.deepEqual(br.normalizeTopics('A\n a \n\nB\nA').topics, ['A', 'B']);
  assert.equal(br.normalizeTopics('A\n a \n\nB\nA').duplicates, 2);
  assert.throws(() => br.createBatch({ topics: '' }), /อย่างน้อย 1/);
  assert.throws(() => br.createBatch({ topics: Array.from({ length: 51 }, (_, i) => `t${i}`) }), /สูงสุด 50/);
});

test('economy batch: cheap model, every item saved as a real campaign, warm-up item runs first alone', async () => {
  const { id } = br.createBatch({ name: 't', topics: ['หัวข้อ 1', 'หัวข้อ 2', 'หัวข้อ 3', 'หัวข้อ 4', 'หัวข้อ 5'], options: { mode: 'economy', concurrency: 3 } });
  const wfBefore = (dbm.db.prepare('SELECT COUNT(*) c FROM ai_workflows').get() as any).c;
  const s = (await br.processBatch(id))!;
  assert.equal(s.status, 'completed');
  assert.equal(s.done, 5);
  assert.equal(s.failed, 0);
  assert.equal((dbm.db.prepare('SELECT COUNT(*) c FROM ai_workflows').get() as any).c, wfBefore + 5);
  // economy tier => cheapest provider + cost-efficient model, never the reasoner/flagship
  assert.ok(order.every((o) => o.vendor === 'deepseek' && o.model === 'deepseek-chat'));
  assert.equal(order[0].topic, 'หัวข้อ 1', 'warm-up item is sent first');
  assert.ok(s.items.every((i) => i.workflowId));
  assert.equal(s.stats.cachedInputPercent > 0, true);
  assert.equal(s.stats.escalatedToStandard, 0);
});

test('re-running the same topics in a new batch is served from cache at zero provider cost', async () => {
  const topics = ['ซ้ำ 1', 'ซ้ำ 2', 'ซ้ำ 3'];
  const a = br.createBatch({ topics, options: { mode: 'economy' } }).id;
  await br.processBatch(a);
  const callsAfterFirst = order.length;
  const b = br.createBatch({ topics, options: { mode: 'economy' } }).id;
  const s = (await br.processBatch(b))!;
  assert.equal(order.length, callsAfterFirst, 'no provider traffic on the second run');
  assert.equal(s.stats.cacheHits, 3);
  assert.equal(s.done, 3);
});

test('a provider outage mid-batch is absorbed by automatic failover; all items still complete', async () => {
  let n = 0;
  handlers.deepseek = () => (++n > 2 ? err(503, 'Service Unavailable') : okChat(WF));
  const { id } = br.createBatch({ topics: ['x1', 'x2', 'x3', 'x4', 'x5', 'x6'], options: { mode: 'economy', concurrency: 2 } });
  const s = (await br.processBatch(id))!;
  assert.equal(s.done, 6);
  assert.equal(s.failed, 0);
  assert.ok(s.stats.failedOver >= 1, 'some items were rescued by another provider');
  assert.ok(Object.keys(s.stats.byProvider).length >= 2);
});

test('bad output from the cheap model escalates to the standard model for that item only', async () => {
  handlers.deepseek = (b) => okChat(b.model === 'deepseek-chat' ? '{"too":"short"}' : WF);
  handlers.claude = (b) => okClaude('garbage');
  handlers.openai = () => okChat('garbage');
  const { id } = br.createBatch({ topics: ['e1'], options: { mode: 'economy' } });
  const s = (await br.processBatch(id))!;
  assert.equal(s.done, 1);
  assert.equal(s.items[0].tier, 'standard');
  assert.equal(s.items[0].model, 'deepseek-reasoner');
  assert.equal(s.stats.escalatedToStandard, 1);
});

test('circuit stop: when everything is down the batch pauses after 3 failures instead of burning the whole queue', async () => {
  handlers.deepseek = () => err(500, 'down');
  handlers.claude = () => err(500, 'down');
  handlers.openai = () => err(500, 'down');
  const { id } = br.createBatch({ topics: Array.from({ length: 10 }, (_, i) => `d${i}`), options: { mode: 'economy', concurrency: 1 } });
  const s = (await br.processBatch(id))!;
  assert.equal(s.status, 'paused');
  assert.equal(s.failed, 3);
  assert.equal(s.pending, 7, 'remaining items were not attempted');
  assert.ok(s.items.find((i) => i.status === 'failed')!.error.length > 0);

  // recovery: provider comes back -> retry + resume completes the rest
  router.resetHealth();
  handlers.deepseek = () => okChat(WF);
  br.retryFailed(id);
  const s2 = (await br.processBatch(id))!;
  assert.equal(s2.status, 'completed');
  assert.equal(s2.done, 10);
});

test('time budget slices a batch for serverless; repeated calls finish it', async () => {
  const { id } = br.createBatch({ topics: ['s1', 's2', 's3', 's4'], options: { mode: 'economy', concurrency: 1 } });
  const first = (await br.processBatch(id, { budgetMs: 1 }))!;
  assert.ok(first.done < 4, 'stopped early because the budget ran out');
  let cur = first;
  for (let i = 0; i < 10 && cur.status !== 'completed'; i++) cur = (await br.processBatch(id, { budgetMs: 1 }))!;
  assert.equal(cur.status, 'completed');
  assert.equal(cur.done, 4);
});

test('cancel stops pending items', async () => {
  const { id } = br.createBatch({ topics: ['c1', 'c2', 'c3'], options: { mode: 'economy' } });
  const s = br.cancelBatch(id)!;
  assert.equal(s.status, 'cancelled');
  assert.equal(s.cancelled, 3);
  const after = (await br.processBatch(id))!;
  assert.equal(after.done, 0);
  assert.equal(order.length, 0);
});

test('standard mode uses the full model class and the standard provider order', async () => {
  const { id } = br.createBatch({ topics: ['std1'], options: { mode: 'standard' } });
  const s = (await br.processBatch(id))!;
  assert.equal(s.items[0].tier, 'standard');
  // standard order is gemini > openai > claude > deepseek; only openai/claude/deepseek have keys here
  assert.equal(order[0].vendor, 'openai');
  assert.equal(order[0].model, 'gpt-5', 'flagship class, not the economy pick (gpt-5-mini)');
});

test('stuck "running" items from a crashed process are recovered and re-queued', async () => {
  const { id } = br.createBatch({ topics: ['r1', 'r2'], options: { mode: 'economy', concurrency: 1 } });
  const old = new Date(Date.now() - 20 * 60 * 1000).toISOString();
  dbm.db.prepare("UPDATE ai_batch_items SET status='running', updated_at=? WHERE batch_id=?").run(old, id);
  const s = (await br.processBatch(id))!;
  assert.equal(s.done, 2);
});
