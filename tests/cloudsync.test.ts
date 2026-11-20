// The serverless database lives in a Vercel Blob store. These tests prove the app reports the truth
// when that store refuses writes (as it does today: "store_suspended") instead of pretending to save.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { test, before } from 'node:test';
import assert from 'node:assert/strict';

process.env.VERCEL = '1';
process.env.BLOB_READ_WRITE_TOKEN = 'vercel_blob_rw_test_token_0000000000000000000000000000000';
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'aiflow-cloud-'));
process.env.NODE_ENV = 'test';

let mode: 'ok' | 'suspended' | 'down' = 'ok';
const calls: string[] = [];
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: any, init?: any) => {
  const url = String(typeof input === 'string' ? input : input.url);
  if (!url.includes('blob.vercel-storage.com')) return realFetch(input, init);
  calls.push(`${init?.method || 'GET'} ${url.replace('https://blob.vercel-storage.com', '')}`);
  if (mode === 'down') throw new Error('network down');
  if (init?.method === 'PUT') {
    return mode === 'suspended'
      ? new Response(JSON.stringify({ error: { code: 'store_suspended', message: 'Store is suspended' } }), { status: 403 })
      : new Response(JSON.stringify({ url: 'https://x.public.blob.vercel-storage.com/' + url.split('/').pop() }), { status: 200 });
  }
  if (init?.method === 'POST') return new Response('{}', { status: 200 });
  return new Response(JSON.stringify({ blobs: [] }), { status: 200 }); // list
}) as typeof fetch;

let cs: typeof import('../server/cloudSync.ts');
before(async () => {
  const db = await import('../server/db.ts');
  db.initDatabase();
  cs = await import('../server/cloudSync.ts');
});

test('healthy store: status says data is persistent and the probe file is cleaned up', async () => {
  mode = 'ok';
  cs.resetStorageProbeCache();
  const s = await cs.getStorageStatus();
  assert.equal(s.persistent, true);
  assert.ok(calls.some((c) => c.startsWith('POST /delete')), 'probe blob removed');
});

test('suspended store: status explains it in Thai and persisting a change reports failure', async () => {
  mode = 'suspended';
  cs.resetStorageProbeCache();
  const s = await cs.getStorageStatus();
  assert.equal(s.persistent, false);
  assert.match(s.reason, /ถูกระงับ/);
  assert.equal(await cs.persistDatabaseToCloud(), false, 'a write that cannot be stored must not look saved');
  assert.match(cs.getLastPersistError(), /store_suspended/);
});

test('unreachable store: reported as not persistent with the reason', async () => {
  mode = 'down';
  cs.resetStorageProbeCache();
  const s = await cs.getStorageStatus();
  assert.equal(s.persistent, false);
  assert.match(s.reason, /ไม่สำเร็จ/);
});
