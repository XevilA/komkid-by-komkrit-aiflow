// The serverless database lives in a Vercel Blob store. These tests prove two things:
//  1. the app reports the truth when that store refuses writes (as it did: "store_suspended");
//  2. it spends as few billable "advanced" operations as possible (one overwrite per save, no list/delete).
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { test, before } from 'node:test';
import assert from 'node:assert/strict';

process.env.VERCEL = '1';
process.env.BLOB_READ_WRITE_TOKEN = 'vercel_blob_rw_teststore_secret0000000000000000000000';
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'aiflow-cloud-'));
process.env.NODE_ENV = 'test';

let mode: 'ok' | 'suspended' | 'down' = 'ok';
let stored: Buffer | null = null;
let etagN = 0;
const ops: string[] = [];
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: any, init?: any) => {
  const url = String(typeof input === 'string' ? input : input.url);
  const isApi = url.startsWith('https://blob.vercel-storage.com');
  const isCdn = url.includes('teststore.public.blob.vercel-storage.com');
  if (!isApi && !isCdn) return realFetch(input, init);
  const method = init?.method || 'GET';
  ops.push(`${method} ${isApi ? 'api' : 'cdn'}`);
  if (mode === 'down') throw new Error('network down');
  if (mode === 'suspended') {
    return new Response(JSON.stringify({ error: { code: 'store_suspended', message: 'Store is suspended' } }), { status: 403 });
  }
  if (isApi && method === 'PUT') {
    assert.equal(init.headers['x-allow-overwrite'], '1', 'saves overwrite one fixed file');
    stored = Buffer.from(init.body);
    etagN++;
    return new Response(JSON.stringify({ url: 'https://teststore.public.blob.vercel-storage.com/state/komkrit-db.enc' }), { status: 200 });
  }
  if (isCdn) {
    if (!stored) return new Response('not found', { status: 404 });
    if (init?.headers?.['If-None-Match'] === `"v${etagN}"`) return new Response(null, { status: 304 });
    return new Response(method === 'HEAD' ? null : new Uint8Array(stored), { status: 200, headers: { etag: `"v${etagN}"` } });
  }
  return new Response('{}', { status: 200 });
}) as typeof fetch;

let cs: typeof import('../server/cloudSync.ts');
before(async () => {
  const db = await import('../server/db.ts');
  db.initDatabase();
  cs = await import('../server/cloudSync.ts');
});

test('a save is exactly one overwrite: no listing, no cleanup delete, no new file per save', async () => {
  mode = 'ok';
  cs.resetStorageProbeCache();
  ops.length = 0;
  assert.equal(await cs.persistDatabaseToCloud(), true);
  assert.equal(await cs.persistDatabaseToCloud(), true);
  assert.deepEqual(ops, ['PUT api', 'PUT api']);
});

test('healthy store: status says persistent, and polling it costs no billable write', async () => {
  mode = 'ok';
  cs.resetStorageProbeCache();
  ops.length = 0;
  const s = await cs.getStorageStatus();
  assert.equal(s.persistent, true);
  assert.ok(ops.every((o) => !o.endsWith('api')), 'status check must not call the billable API');
});

test('another instance picks up the saved snapshot with a plain download', async () => {
  mode = 'ok';
  await cs.persistDatabaseToCloud();
  ops.length = 0;
  await cs.syncDatabaseBeforeRequest(true);
  assert.deepEqual(ops, ['GET cdn']);
});

test('suspended store: status explains it in Thai and a save reports failure', async () => {
  mode = 'suspended';
  cs.resetStorageProbeCache();
  assert.equal(await cs.persistDatabaseToCloud(), false, 'a write that cannot be stored must not look saved');
  assert.match(cs.getLastPersistError(), /store_suspended/);
  const s = await cs.getStorageStatus();
  assert.equal(s.persistent, false);
  assert.match(s.reason, /ถูกระงับ/);
});

test('unreachable store: reported as not persistent with the reason', async () => {
  mode = 'down';
  cs.resetStorageProbeCache();
  const s = await cs.getStorageStatus();
  assert.equal(s.persistent, false);
  assert.match(s.reason, /ไม่สำเร็จ/);
});
