// Integration test: drives the REAL provider code paths (aiEngine.callRealLlm) while the
// network boundary (global fetch) simulates each vendor's wire protocol and outages.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aiflow-test-'));
process.env.DATA_DIR = tmp;
process.env.NODE_ENV = 'test';
process.env.DEEPSEEK_API_KEY = 'sk-test-deepseek-000000';
process.env.ANTHROPIC_API_KEY = 'sk-ant-test-000000';
process.env.OPENAI_API_KEY = 'sk-test-openai-000000';
process.env.VAULT_MASTER_KEY = 'a'.repeat(64);
process.env.ADMIN_AUTH_SECRET = 'b'.repeat(64);

type Handler = (body: any, url: string) => { status: number; json: any };
const handlers: Record<string, Handler> = {};
const seen: { vendor: string; body: any }[] = [];

const VALID = JSON.stringify({ ok: true, article: 'x'.repeat(10) });

function vendorOf(url: string): string {
  if (url.includes('api.deepseek.com')) return 'deepseek';
  if (url.includes('api.anthropic.com')) return 'claude';
  if (url.includes('api.openai.com')) return 'openai';
  return 'other';
}

const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: any, init?: any) => {
  const url = String(typeof input === 'string' ? input : input.url);
  const vendor = vendorOf(url);
  if (vendor === 'other') return realFetch(input, init);
  // model catalogs
  if (/\/models/.test(url)) {
    const lists: Record<string, any> = {
      deepseek: { data: [{ id: 'deepseek-reasoner', created: 2 }, { id: 'deepseek-chat', created: 1 }] },
      claude: {
        data: [
          { id: 'claude-opus-4-1', created_at: '2025-08-05T00:00:00Z' },
          { id: 'claude-haiku-4-5', created_at: '2025-10-01T00:00:00Z' },
        ],
      },
      openai: { data: [{ id: 'gpt-5', created: 3 }, { id: 'gpt-5-mini', created: 2 }] },
    };
    return new Response(JSON.stringify(lists[vendor]), { status: 200, headers: { 'content-type': 'application/json' } });
  }
  const body = init?.body ? JSON.parse(init.body) : {};
  seen.push({ vendor, body });
  const h = handlers[vendor];
  if (!h) throw new Error(`no handler for ${vendor}`);
  const r = h(body, url);
  return new Response(JSON.stringify(r.json), { status: r.status, headers: { 'content-type': 'application/json' } });
}) as typeof fetch;

const okChat = (text: string, usage: any = { prompt_tokens: 100, completion_tokens: 20 }) => ({
  status: 200,
  json: { choices: [{ message: { content: text } }], usage },
});
const okClaude = (text: string) => ({
  status: 200,
  json: {
    content: [{ type: 'text', text }],
    usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 900, cache_creation_input_tokens: 0 },
  },
});
const errRes = (status: number, message: string) => ({ status, json: { error: { message } } });

let engine: typeof import('../server/aiEngine.ts');
let router: typeof import('../server/aiRouter.ts');
let dbmod: typeof import('../server/db.ts');

before(async () => {
  dbmod = await import('../server/db.ts');
  dbmod.initDatabase();
  router = await import('../server/aiRouter.ts');
  engine = await import('../server/aiEngine.ts');
});

beforeEach(() => {
  router.resetHealth();
  seen.length = 0;
  for (const k of Object.keys(handlers)) delete handlers[k];
  dbmod.db.prepare('DELETE FROM ai_cache').run();
  dbmod.db.prepare('DELETE FROM ai_call_log').run();
});

const msg = [{ role: 'user' as const, content: 'hello' }];

test('explicit provider is down (503) -> automatically served by another provider', async () => {
  handlers.deepseek = () => errRes(503, 'Service Unavailable');
  handlers.claude = () => okClaude('จาก claude');
  handlers.openai = () => okChat('จาก openai');
  const r = await engine.callRealLlm({ provider: 'deepseek', messages: msg });
  assert.notEqual(r.provider, 'deepseek');
  assert.deepEqual(r.failedOverFrom, ['deepseek']);
  assert.match(r.engineLabel, /สลับอัตโนมัติจาก deepseek/);
  const rows = dbmod.db.prepare('SELECT provider, ok, error_kind FROM ai_call_log ORDER BY id').all() as any[];
  assert.equal(rows[0].provider, 'deepseek');
  assert.equal(rows[0].ok, 0);
  assert.equal(rows[0].error_kind, 'transient');
  assert.equal(rows[rows.length - 1].ok, 1);
});

test('invalid API key (401) switches provider and opens the breaker so the next call skips it', async () => {
  handlers.deepseek = () => errRes(401, 'Authentication Fails, invalid api key');
  handlers.claude = () => okClaude('claude ok');
  handlers.openai = () => okChat('openai ok');
  await engine.callRealLlm({ provider: 'deepseek', messages: msg });
  assert.equal(router.isCoolingDown('deepseek'), true);
  seen.length = 0;
  const r2 = await engine.callRealLlm({ provider: 'deepseek', messages: msg });
  assert.ok(!seen.find((s) => s.vendor === 'deepseek'), 'cooling provider must not receive traffic');
  assert.notEqual(r2.provider, 'deepseek');
});

test('rate limit 429 on the first provider falls through', async () => {
  handlers.deepseek = () => errRes(429, 'Rate limit reached');
  handlers.claude = () => okClaude('ok');
  handlers.openai = () => okChat('ok');
  const r = await engine.callRealLlm({ provider: 'deepseek', messages: msg });
  assert.ok(['claude', 'openai'].includes(r.provider));
});

test('jsonMode: unparsable JSON from one provider is rejected and the next provider is used', async () => {
  handlers.deepseek = () => okChat('this is definitely not json');
  handlers.claude = () => okClaude(VALID);
  handlers.openai = () => okChat(VALID);
  const r = await engine.callRealLlm({ provider: 'deepseek', messages: msg, jsonMode: true });
  assert.notEqual(r.provider, 'deepseek');
  assert.deepEqual(JSON.parse(r.text).ok, true);
});

test('custom validate() rejection also triggers failover', async () => {
  handlers.deepseek = () => okChat('SHORT');
  handlers.claude = () => okClaude('long enough answer text');
  handlers.openai = () => okChat('long enough answer text');
  const r = await engine.callRealLlm({
    provider: 'deepseek',
    messages: msg,
    validate: (t) => {
      if (t.length < 10) throw new Error('ผลลัพธ์ไม่ครบ');
    },
  });
  assert.notEqual(r.provider, 'deepseek');
});

test('economy tier uses cost-efficient models discovered from the live catalog', async () => {
  handlers.deepseek = () => okChat(VALID);
  handlers.claude = () => okClaude(VALID);
  handlers.openai = () => okChat(VALID);
  const r = await engine.callRealLlm({ messages: msg, tier: 'economy', jsonMode: true });
  assert.equal(r.tier, 'economy');
  assert.equal(r.provider, 'deepseek', 'economy order starts with the cheapest provider');
  assert.equal(r.model, 'deepseek-chat');
  assert.equal(seen[0].body.model, 'deepseek-chat');
});

test('economy escalates to the full model only when every cheap attempt fails validation', async () => {
  const used: string[] = [];
  handlers.deepseek = (b) => (used.push(`deepseek:${b.model}`), okChat(b.model === 'deepseek-reasoner' ? VALID : 'garbage'));
  handlers.claude = (b) => (used.push(`claude:${b.model}`), okClaude(b.model === 'claude-haiku-4-5' ? 'garbage' : 'garbage'));
  handlers.openai = (b) => (used.push(`openai:${b.model}`), okChat('garbage'));
  const r = await engine.callRealLlm({ messages: msg, tier: 'economy', jsonMode: true });
  assert.equal(r.tier, 'standard');
  assert.equal(r.provider, 'deepseek');
  assert.equal(r.model, 'deepseek-reasoner');
  assert.ok(used.indexOf('deepseek:deepseek-chat') < used.indexOf('deepseek:deepseek-reasoner'));
});

test('cache: identical call is served from cache with zero provider traffic', async () => {
  let calls = 0;
  handlers.deepseek = () => (calls++, okChat(VALID));
  handlers.claude = () => (calls++, okClaude(VALID));
  handlers.openai = () => (calls++, okChat(VALID));
  const a = await engine.callRealLlm({ messages: msg, tier: 'economy', jsonMode: true, cache: true });
  const callsAfterFirst = calls;
  const b = await engine.callRealLlm({ messages: msg, tier: 'economy', jsonMode: true, cache: true });
  assert.equal(calls, callsAfterFirst);
  assert.equal(b.cacheHit, true);
  assert.equal(b.text, a.text);
  assert.equal(b.usage?.inputTokens, 0);
  // a different prompt must not hit
  await engine.callRealLlm({ messages: [{ role: 'user', content: 'different' }], tier: 'economy', jsonMode: true, cache: true });
  assert.ok(calls > callsAfterFirst);
});

test('Claude receives cache_control on the system prompt when cacheSystem is set and usage reports cached tokens', async () => {
  handlers.claude = () => okClaude('hi');
  const r = await engine.callRealLlm({
    provider: 'claude',
    systemInstruction: 'STATIC PREFIX',
    messages: msg,
    cacheSystem: true,
    failover: false,
  });
  const sent = seen.find((s) => s.vendor === 'claude')!.body;
  assert.equal(Array.isArray(sent.system), true);
  assert.deepEqual(sent.system[0].cache_control, { type: 'ephemeral' });
  assert.equal(r.usage?.cachedTokens, 900);
});

test('explicit model id is only sent to the provider it was chosen for', async () => {
  handlers.deepseek = () => errRes(500, 'boom');
  handlers.claude = () => okClaude('ok');
  handlers.openai = () => okChat('ok');
  await engine.callRealLlm({ provider: 'deepseek', model: 'deepseek-chat', messages: msg });
  const other = seen.filter((s) => s.vendor !== 'deepseek');
  assert.ok(other.length > 0);
  assert.ok(other.every((s) => s.body.model !== 'deepseek-chat'));
});

test('all providers down -> one clear error naming every provider; log has every attempt', async () => {
  handlers.deepseek = () => errRes(500, 'ds down');
  handlers.claude = () => errRes(529, 'Overloaded');
  handlers.openai = () => errRes(500, 'oa down');
  await assert.rejects(
    engine.callRealLlm({ messages: msg }),
    (e: Error) => {
      assert.match(e.message, /ทุกค่าย/);
      assert.match(e.message, /deepseek/);
      assert.match(e.message, /claude/);
      assert.match(e.message, /openai/);
      return true;
    }
  );
  const n = (dbmod.db.prepare('SELECT COUNT(*) c FROM ai_call_log WHERE ok = 0').get() as any).c;
  assert.ok(n >= 3);
});

test('connection test with an explicit key never fails over and never touches the breaker', async () => {
  handlers.claude = () => errRes(401, 'invalid x-api-key');
  handlers.openai = () => okChat('should not be called');
  await assert.rejects(
    engine.testProviderConnection({ provider: 'claude', apiKey: 'sk-ant-user-typed-key' })
  );
  assert.equal(seen.some((s) => s.vendor === 'openai'), false);
  assert.equal(router.isCoolingDown('claude'), false);
});

test('failover can be disabled from settings', async () => {
  dbmod.db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('ai_failover_enabled','0')").run();
  handlers.deepseek = () => errRes(503, 'down');
  handlers.claude = () => okClaude('ok');
  await assert.rejects(engine.callRealLlm({ provider: 'deepseek', messages: msg }));
  assert.equal(seen.some((s) => s.vendor === 'claude'), false);
  dbmod.db.prepare("DELETE FROM settings WHERE key = 'ai_failover_enabled'").run();
});

test('the seeded placeholder local endpoint is not treated as a configured provider', () => {
  const set = engine.configuredProviderSet();
  assert.equal(set.has('openai_compatible'), false);
  assert.equal(set.has('deepseek'), true);
});

test('media failover: image/voice generation switches provider when the first is down', async () => {
  const media = await import('../server/mediaEngine.ts');
  const tried: string[] = [];
  const out = await media.withMediaFailover(
    'image',
    'gemini',
    ['gemini', 'openai'],
    { gemini: true, openai: true },
    async (p, isReq) => {
      tried.push(`${p}:${isReq}`);
      if (p === 'gemini') throw new Error('503 Service Unavailable');
      return { provider: p };
    }
  );
  assert.deepEqual(tried, ['gemini:true', 'openai:false']);
  assert.equal(out.provider, 'openai');

  // nothing configured -> the original provider runs so the user sees the real "add your key" error
  await assert.rejects(
    media.withMediaFailover('audio', undefined, ['gemini', 'elevenlabs'], { gemini: false, elevenlabs: false }, async (p) => {
      throw new Error(`ยังไม่ได้ตั้งค่า ${p} API Key`);
    }),
    /ยังไม่ได้ตั้งค่า gemini/
  );
});
