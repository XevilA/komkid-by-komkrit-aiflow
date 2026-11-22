import crypto from 'node:crypto';
import {
  db,
  IS_SERVERLESS,
  exportDatabaseSnapshotBuffer,
  reloadDatabaseFromSnapshotBuffer,
} from './db.ts';

const BLOB_API_BASE = 'https://blob.vercel-storage.com';

let currentLoadedBlobPath = '';
let lastCheckAt = 0;
let blobWriteSuspended = false;
let blobSuspendedRetryAfter = 0;
let hasUnsyncedLocalMutations = false;
let lastPersistError = '';

function getBlobToken(): string {
  return (process.env.BLOB_READ_WRITE_TOKEN || '').trim();
}

export function isCloudSyncEnabled(): boolean {
  return IS_SERVERLESS && Boolean(getBlobToken());
}

function deriveEncryptionKey(token: string): Buffer {
  return crypto.createHash('sha256').update(`komkrit-sqlite-v1:${token}`).digest();
}

function encryptBuffer(plain: Buffer, token: string): Buffer {
  const key = deriveEncryptionKey(token);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plain), cipher.final()]);
  const tag = cipher.getAuthTag();
  // Format: [12-byte IV][16-byte GCM Tag][Ciphertext]
  return Buffer.concat([iv, tag, encrypted]);
}

function decryptBuffer(packed: Buffer, token: string): Buffer {
  if (packed.length < 29) {
    throw new Error('Invalid encrypted DB snapshot');
  }
  const key = deriveEncryptionKey(token);
  const iv = packed.subarray(0, 12);
  const tag = packed.subarray(12, 28);
  const ciphertext = packed.subarray(28);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

/**
 * Blob billing counts uploads, copies and listings as "advanced operations" (a very small monthly
 * allowance on the free plan) and plain downloads as "simple operations". So the database snapshot
 * lives at ONE fixed path: saving is a single overwrite (no list, no cleanup delete, no new file
 * per save) and checking for newer data is a plain conditional download.
 */
const STATE_PATH = 'state/komkrit-db.enc';
/** Minimum seconds between "is there newer data?" checks on one warm instance. */
const CHECK_INTERVAL_MS = 45_000;

let loadedEtag = '';
let lastWriteOk: boolean | null = null;

/** `vercel_blob_rw_<storeId>_<secret>` -> https://<storeid>.public.blob.vercel-storage.com */
function blobBaseUrl(token: string): string {
  const m = /^vercel_blob_rw_([a-z0-9]+)_/i.exec(token);
  return m ? `https://${m[1].toLowerCase()}.public.blob.vercel-storage.com` : '';
}

function stateUrl(token: string): string {
  const base = blobBaseUrl(token);
  return base ? `${base}/${STATE_PATH}` : '';
}

export async function syncDatabaseBeforeRequest(forceCheck = false): Promise<void> {
  if (!isCloudSyncEnabled()) return;
  // Never overwrite newer local writes with an older cloud copy while the store refuses writes
  if (hasUnsyncedLocalMutations && blobWriteSuspended) return;
  const token = getBlobToken();
  const url = stateUrl(token);
  if (!url) return;
  const now = Date.now();
  if (!forceCheck && currentLoadedBlobPath && now - lastCheckAt < CHECK_INTERVAL_MS) return;
  lastCheckAt = now;

  // The random query keeps the CDN from answering with a copy that predates the last overwrite.
  const headers: Record<string, string> = {};
  if (loadedEtag) headers['If-None-Match'] = loadedEtag;
  let dl: Response;
  try {
    dl = await fetch(`${url}?v=${now}`, { cache: 'no-store', headers, signal: AbortSignal.timeout(10_000) });
  } catch {
    return;
  }
  if (dl.status === 304) return;
  if (dl.status === 404) {
    // First run on an empty store: publish the current database once.
    if (!currentLoadedBlobPath && !blobWriteSuspended) await persistDatabaseToCloud();
    return;
  }
  if (!dl.ok) return;
  const etag = dl.headers.get('etag') || '';
  const encryptedBytes = Buffer.from(await dl.arrayBuffer());
  if (etag && etag === loadedEtag) return;
  const sqliteBytes = decryptBuffer(encryptedBytes, token);

  // Preserve any newer in-memory encrypted settings before reloading an older cloud snapshot
  let memVaultTs = 0;
  let memSettingsRows: { key: string; value: string }[] = [];
  try {
    const tsRow = db
      .prepare("SELECT value FROM settings WHERE key = '_vault_updated_at'")
      .get() as { value: string } | undefined;
    memVaultTs = Number(tsRow?.value || '0') || 0;
    if (memVaultTs > 0) {
      memSettingsRows = db
        .prepare('SELECT key, value FROM settings')
        .all() as { key: string; value: string }[];
    }
  } catch {
    // ignore
  }

  reloadDatabaseFromSnapshotBuffer(sqliteBytes);

  if (memVaultTs > 0 && memSettingsRows.length > 0) {
    try {
      const snapTsRow = db
        .prepare("SELECT value FROM settings WHERE key = '_vault_updated_at'")
        .get() as { value: string } | undefined;
      const snapVaultTs = Number(snapTsRow?.value || '0') || 0;
      if (memVaultTs > snapVaultTs) {
        const setStmt = db.prepare(
          'INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)'
        );
        for (const r of memSettingsRows) {
          setStmt.run(r.key, r.value);
        }
      }
    } catch {
      // ignore
    }
  }

  loadedEtag = etag;
  currentLoadedBlobPath = STATE_PATH;
  hasUnsyncedLocalMutations = false;
}

export async function persistDatabaseToCloud(): Promise<boolean> {
  if (!isCloudSyncEnabled()) return true;
  const now = Date.now();
  hasUnsyncedLocalMutations = true;

  // Back off 5 minutes when the store refuses writes so requests stay fast
  if (blobWriteSuspended && now < blobSuspendedRetryAfter) {
    return false;
  }

  const token = getBlobToken();
  const sqliteBytes = exportDatabaseSnapshotBuffer();
  const encryptedBytes = encryptBuffer(sqliteBytes, token);

  let putRes: Response;
  try {
    putRes = await fetch(`${BLOB_API_BASE}/${STATE_PATH}`, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
        'x-api-version': '7',
        'x-content-type': 'application/octet-stream',
        'x-add-random-suffix': '0',
        'x-allow-overwrite': '1',
        'x-cache-control-max-age': '60',
      },
      body: new Uint8Array(encryptedBytes),
      signal: AbortSignal.timeout(20_000),
    });
  } catch (err) {
    lastPersistError = (err as Error).message;
    lastWriteOk = false;
    return false;
  }

  if (putRes.ok) {
    blobWriteSuspended = false;
    blobSuspendedRetryAfter = 0;
    hasUnsyncedLocalMutations = false;
    currentLoadedBlobPath = STATE_PATH;
    loadedEtag = ''; // next check re-validates once; nothing else to clean up
    lastCheckAt = Date.now();
    lastWriteOk = true;
    lastPersistError = '';
    probeCache = null;
    return true;
  }

  blobWriteSuspended = true;
  blobSuspendedRetryAfter = Date.now() + 5 * 60 * 1000;
  lastWriteOk = false;
  try {
    const body = (await putRes.json()) as any;
    lastPersistError = String(body?.error?.code || body?.error?.message || `HTTP ${putRes.status}`);
  } catch {
    lastPersistError = `HTTP ${putRes.status}`;
  }
  probeCache = null;
  return false;
}

export interface StorageStatus {
  persistent: boolean;
  runtime: 'disk' | 'vercel-blob';
  reason: string;
}

let probeCache: { at: number; value: StorageStatus } | null = null;

function describeStoreError(code: string): string {
  return code === 'store_suspended'
    ? 'ที่เก็บข้อมูล Vercel Blob ถูกระงับ ข้อมูลที่บันทึกบน Vercel จะหายเมื่อระบบรีสตาร์ต'
    : `ที่เก็บข้อมูล Vercel Blob ปฏิเสธการบันทึก (${code})`;
}

/**
 * Can data written now survive a restart? A long-lived server writes to its own disk (yes).
 * On Vercel the database lives in a Blob store; if that store refuses writes (suspended, quota,
 * bad token) everything saved is lost on the next cold start, so say so instead of pretending.
 * The answer comes from the outcome of the last real save plus a free download check, so
 * polling this endpoint never costs billable write operations.
 */
export async function getStorageStatus(): Promise<StorageStatus> {
  if (!isCloudSyncEnabled()) {
    return IS_SERVERLESS
      ? { persistent: false, runtime: 'vercel-blob', reason: 'ยังไม่ได้ตั้งค่า BLOB_READ_WRITE_TOKEN ข้อมูลที่บันทึกจะหายเมื่อระบบรีสตาร์ต' }
      : { persistent: true, runtime: 'disk', reason: '' };
  }
  if (lastWriteOk === false) {
    return { persistent: false, runtime: 'vercel-blob', reason: describeStoreError(lastPersistError) };
  }
  const now = Date.now();
  if (probeCache && now - probeCache.at < 60_000) return probeCache.value;
  let value: StorageStatus = { persistent: true, runtime: 'vercel-blob', reason: '' };
  if (lastWriteOk === null) {
    // Nothing saved yet by this instance: a download (a free "simple" operation) tells us whether
    // the store is reachable; a suspended store answers every request with an error.
    try {
      const url = stateUrl(getBlobToken());
      const res = await fetch(`${url}?v=${now}`, {
        method: 'HEAD',
        cache: 'no-store',
        signal: AbortSignal.timeout(8000),
      });
      if (res.status !== 404 && !res.ok) {
        value = {
          persistent: false,
          runtime: 'vercel-blob',
          reason: describeStoreError(String(res.status)),
        };
      }
    } catch (err) {
      value = { persistent: false, runtime: 'vercel-blob', reason: `ตรวจสอบที่เก็บข้อมูลไม่สำเร็จ: ${(err as Error).message}` };
    }
  }
  probeCache = { at: now, value };
  return value;
}

export function getLastPersistError(): string {
  return lastPersistError;
}

/** Forget cached storage health (used when the operator fixes the store, and by tests). */
export function resetStorageProbeCache() {
  probeCache = null;
  lastWriteOk = null;
  lastPersistError = '';
  blobWriteSuspended = false;
  blobSuspendedRetryAfter = 0;
}

export async function uploadMediaToCloudBlob(
  buffer: Buffer,
  filename: string,
  mimeType: string
): Promise<string | null> {
  const token = getBlobToken();
  if (!IS_SERVERLESS || !token) return null;

  const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, '-');
  const pathname = `media/${Date.now()}-${safeName}`;
  const res = await fetch(`${BLOB_API_BASE}/${pathname}`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${token}`,
      'x-api-version': '7',
      'x-content-type': mimeType || 'application/octet-stream',
      'x-add-random-suffix': '0',
    },
    body: new Uint8Array(buffer),
  });
  if (!res.ok) return null;
  const data = (await res.json()) as { url?: string };
  return data.url || null;
}

export async function deleteMediaFromCloudBlob(blobUrl: string): Promise<void> {
  const token = getBlobToken();
  if (!token || !blobUrl || !blobUrl.includes('blob.vercel-storage.com')) return;
  try {
    await fetch(`${BLOB_API_BASE}/delete`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'x-api-version': '7',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ urls: [blobUrl] }),
    });
  } catch {
    // ignore cleanup errors
  }
}
