import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  runWithFailover,
  classifyError,
  resetHealth,
  getProviderHealth,
  isCoolingDown,
  AllProvidersFailedError,
  type AttemptSpec,
} from '../server/aiRouter.ts';

const std = (p: string): AttemptSpec => ({ provider: p, tier: 'standard' });
const noSleep = async () => {};

beforeEach(() => resetHealth());

test('classifyError maps real provider messages', () => {
  assert.equal(classifyError('HTTP 429 Too Many Requests'), 'rate');
  assert.equal(classifyError('Incorrect API key provided: sk-***'), 'auth');
  assert.equal(classifyError('You exceeded your current quota, please check your plan and billing'), 'billing');
  assert.equal(classifyError('Overloaded'), 'transient');
  assert.equal(classifyError('503 Service Unavailable'), 'transient');
  assert.equal(classifyError('fetch failed'), 'transient');
  assert.equal(classifyError('ยังไม่ได้ใส่ Google Gemini API Key'), 'config');
  assert.equal(classifyError('โมเดล AI ตอบกลับไม่ใช่รูปแบบ JSON ที่ถูกต้อง'), 'output');
  assert.equal(classifyError('something weird'), 'other');
});

test('fails over to the next provider when the first is down', async () => {
  const calls: string[] = [];
  const out = await runWithFailover({
    attempts: [std('gemini'), std('claude')],
    call: async (a) => {
      calls.push(a.provider);
      if (a.provider === 'gemini') throw new Error('503 Service Unavailable');
      return { provider: a.provider, text: 'ok' };
    },
    sleep: noSleep,
  });
  assert.deepEqual(calls, ['gemini', 'claude']);
  assert.equal(out.result.provider, 'claude');
  assert.equal(out.attempts.length, 2);
  assert.equal(out.attempts[0].ok, false);
  assert.equal(out.attempts[0].kind, 'transient');
});

test('hard failures (auth/billing/rate) open the breaker immediately and later calls skip that provider', async () => {
  await runWithFailover({
    attempts: [std('openai'), std('claude')],
    call: async (a) => {
      if (a.provider === 'openai') throw new Error('Incorrect API key provided');
      return { provider: a.provider };
    },
    sleep: noSleep,
  });
  assert.equal(isCoolingDown('openai'), true);

  const calls: string[] = [];
  const out = await runWithFailover({
    attempts: [std('openai'), std('claude')],
    call: async (a) => {
      calls.push(a.provider);
      return { provider: a.provider };
    },
    sleep: noSleep,
  });
  assert.deepEqual(calls, ['claude'], 'cooling provider must not be tried first');
  assert.equal(out.result.provider, 'claude');
});

test('transient failures only open the breaker after 2 consecutive failures', async () => {
  const flaky = async (a: AttemptSpec) => {
    if (a.provider === 'gemini') throw new Error('overloaded');
    return { provider: a.provider };
  };
  await runWithFailover({ attempts: [std('gemini'), std('claude')], call: flaky, sleep: noSleep });
  assert.equal(isCoolingDown('gemini'), false);
  await runWithFailover({ attempts: [std('gemini'), std('claude')], call: flaky, sleep: noSleep });
  assert.equal(isCoolingDown('gemini'), true);
});

test('a cooling provider is still used as last resort when everything else fails', async () => {
  await runWithFailover({
    attempts: [std('a'), std('b')],
    call: async (x) => {
      if (x.provider === 'a') throw new Error('Incorrect API key');
      return { provider: 'b' };
    },
    sleep: noSleep,
  });
  assert.equal(isCoolingDown('a'), true);
  const out = await runWithFailover({
    attempts: [std('a'), std('b')],
    call: async (x) => {
      if (x.provider === 'b') throw new Error('overloaded');
      return { provider: 'a' };
    },
    sleep: noSleep,
  });
  assert.equal(out.result.provider, 'a');
});

test('validation failure (bad output) fails over without opening the breaker', async () => {
  const out = await runWithFailover({
    attempts: [std('deepseek'), std('gemini')],
    call: async (a) => ({ provider: a.provider, text: a.provider === 'deepseek' ? 'garbage' : '{"ok":true}' }),
    validate: (r) => {
      if (!r.text.startsWith('{')) throw new Error('โมเดล AI ตอบกลับไม่ใช่รูปแบบ JSON ที่ถูกต้อง');
    },
    sleep: noSleep,
  });
  assert.equal(out.result.provider, 'gemini');
  assert.equal(isCoolingDown('deepseek'), false);
  assert.equal(getProviderHealth('deepseek').totalFailures, 1);
});

test('throws AllProvidersFailedError with every attempt when all fail', async () => {
  await assert.rejects(
    runWithFailover({
      attempts: [std('a'), std('b')],
      call: async (x) => {
        throw new Error(`${x.provider} exploded 500`);
      },
      sleep: noSleep,
    }),
    (e: unknown) => {
      assert.ok(e instanceof AllProvidersFailedError);
      assert.equal(e.attempts.length, 2);
      assert.match(e.message, /a exploded/);
      assert.match(e.message, /b exploded/);
      return true;
    }
  );
});

test('a single configured provider gets one quick retry on transient errors', async () => {
  let n = 0;
  const out = await runWithFailover({
    attempts: [std('only')],
    call: async () => {
      n += 1;
      if (n === 1) throw new Error('503 overloaded');
      return { provider: 'only' };
    },
    sleep: noSleep,
  });
  assert.equal(n, 2);
  assert.equal(out.result.provider, 'only');
});

test('per-attempt timeout triggers failover', async () => {
  const out = await runWithFailover({
    attempts: [std('slow'), std('fast')],
    timeoutMs: 40,
    call: async (a) => {
      if (a.provider === 'slow') await new Promise((r) => setTimeout(r, 300));
      return { provider: a.provider };
    },
    sleep: noSleep,
  });
  assert.equal(out.result.provider, 'fast');
  assert.equal(out.attempts[0].kind, 'transient');
});

test('success resets the failure counter', async () => {
  const t = async (a: AttemptSpec) => {
    if (fail) throw new Error('overloaded');
    return { provider: a.provider };
  };
  let fail = true;
  await assert.rejects(runWithFailover({ attempts: [std('x')], call: t, sleep: noSleep }));
  fail = false;
  await runWithFailover({ attempts: [std('x')], call: t, sleep: noSleep });
  assert.equal(getProviderHealth('x').consecutiveFailures, 0);
  assert.equal(isCoolingDown('x'), false);
});

import { pickEconomyModelId } from '../server/modelRegistry.ts';

test('pickEconomyModelId picks cost-efficient models from live catalogs, never flagships/reasoning/media', () => {
  assert.equal(
    pickEconomyModelId([
      'gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-2.5-flash-image',
      'gemini-2.5-flash-preview-tts', 'gemini-3-pro-preview', 'gemini-2.0-flash',
    ]),
    'gemini-2.5-flash'
  );
  assert.equal(
    pickEconomyModelId(['claude-opus-4-1', 'claude-sonnet-4-5', 'claude-haiku-4-5', 'claude-3-haiku-20240307']),
    'claude-haiku-4-5'
  );
  assert.equal(
    pickEconomyModelId(['gpt-5', 'gpt-5-mini', 'gpt-5-nano', 'o3', 'o4-mini', 'gpt-4o-mini', 'gpt-image-1', 'gpt-4o-mini-tts']),
    'gpt-5-mini'
  );
  assert.equal(pickEconomyModelId(['deepseek-reasoner', 'deepseek-chat']), 'deepseek-chat');
  // only light class available -> still usable
  assert.equal(pickEconomyModelId(['big-model', 'foo-nano']), 'foo-nano');
  assert.equal(pickEconomyModelId(['gemini-2.5-pro', 'claude-opus-4-1']), null);
});
