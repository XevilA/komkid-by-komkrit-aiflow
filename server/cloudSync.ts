import crypto from 'node:crypto';
import {
  db,
  IS_SERVERLESS,
  exportDatabaseSnapshotBuffer,
  reloadDatabaseFromSnapshotBuffer,
} from './db.ts';

const BLOB_API_BASE = 'https://blob.vercel-storage.com';
const STATE_PREFIX = 'state/komkrit-db-';

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

interface BlobListItem {
  url: string;
  pathname: string;
  uploadedAt: string;
  size: number;
}

async function listStateBlobs(token: string): Promise<BlobListItem[]> {
  const res = await fetch(
    `${BLOB_API_BASE}?prefix=${encodeURIComponent(STATE_PREFIX)}&limit=20`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        'x-api-version': '7',
      },
      cache: 'no-store',
    }
  );
  if (!res.ok) return [];
  const data = (await res.json()) as { blobs?: BlobListItem[] };
  const blobs = Array.isArray(data.blobs) ? data.blobs : [];
  // Sort newest first by pathname (which embeds epoch ms)
  blobs.sort((a, b) => (b.pathname > a.pathname ? 1 : -1));
  return blobs;
}

async function deleteOldStateBlobs(token: string, urlsToDelete: string[]): Promise<void> {
  if (urlsToDelete.length === 0) return;
  try {
    await fetch(`${BLOB_API_BASE}/delete`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'x-api-version': '7',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ urls: urlsToDelete }),
    });
  } catch {
    // ignore cleanup errors
  }
}

export async function syncDatabaseBeforeRequest(forceCheck = false): Promise<void> {
  if (!isCloudSyncEnabled()) return;
  // Never overwrite newer local encrypted writes when the cloud blob store is suspended
  if (hasUnsyncedLocalMutations && blobWriteSuspended) {
    return;
  }
  const token = getBlobToken();
  const now = Date.now();
  // Throttle read-only checks to 30s so Hobby Blob advanced-ops quota is preserved
  if (!forceCheck && currentLoadedBlobPath && now - lastCheckAt < 30000) {
    return;
  }
  lastCheckAt = now;

  const blobs = await listStateBlobs(token);
  if (blobs.length === 0) {
    if (!currentLoadedBlobPath && !blobWriteSuspended) {
      await persistDatabaseToCloud();
    }
    return;
  }

  const newest = blobs[0];
  if (newest.pathname === currentLoadedBlobPath) {
    return;
  }

  const dl = await fetch(newest.url, { cache: 'no-store' });
  if (!dl.ok) return;
  const encryptedBytes = Buffer.from(await dl.arrayBuffer());
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

  currentLoadedBlobPath = newest.pathname;
  hasUnsyncedLocalMutations = false;
}

export async function persistDatabaseToCloud(): Promise<boolean> {
  if (!isCloudSyncEnabled()) return true;
  const now = Date.now();
  hasUnsyncedLocalMutations = true;

  // Back off 5 minutes when Vercel Blob store is suspended so requests stay fast
  if (blobWriteSuspended && now < blobSuspendedRetryAfter) {
    return false;
  }

  const token = getBlobToken();
  const sqliteBytes = exportDatabaseSnapshotBuffer();
  const encryptedBytes = encryptBuffer(sqliteBytes, token);
  const ts = String(now).padStart(15, '0');
  const rand = crypto.randomBytes(3).toString('hex');
  const pathname = `${STATE_PREFIX}${ts}-${rand}.enc`;

  const putRes = await fetch(`${BLOB_API_BASE}/${pathname}`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${token}`,
      'x-api-version': '7',
      'x-content-type': 'application/octet-stream',
      'x-add-random-suffix': '0',
      'x-cache-control-max-age': '0',
    },
    body: new Uint8Array(encryptedBytes),
  });

  if (putRes.ok) {
    blobWriteSuspended = false;
    blobSuspendedRetryAfter = 0;
    hasUnsyncedLocalMutations = false;
    currentLoadedBlobPath = pathname;
    lastCheckAt = Date.now();

    const blobs = await listStateBlobs(token);
    if (blobs.length > 2) {
      const oldUrls = blobs.slice(2).map((b) => b.url);
      await deleteOldStateBlobs(token, oldUrls);
    }
    return true;
  }

  blobWriteSuspended = true;
  blobSuspendedRetryAfter = Date.now() + 5 * 60 * 1000;
  try {
    const body = (await putRes.json()) as any;
    lastPersistError = String(body?.error?.code || body?.error?.message || `HTTP ${putRes.status}`);
  } catch {
    lastPersistError = `HTTP ${putRes.status}`;
  }
  return false;
}

export interface StorageStatus {
  persistent: boolean;
  runtime: 'disk' | 'vercel-blob';
  reason: string;
}

let probeCache: { at: number; value: StorageStatus } | null = null;

/**
 * Can data written now survive a restart? A long-lived server writes to its own disk (yes).
 * On Vercel the database lives in a Blob store; if that store refuses writes (suspended, quota,
 * bad token) everything saved is lost on the next cold start, so say so instead of pretending.
 */
export async function getStorageStatus(): Promise<StorageStatus> {
  if (!isCloudSyncEnabled()) {
    return IS_SERVERLESS
      ? { persistent: false, runtime: 'vercel-blob', reason: 'ยังไม่ได้ตั้งค่า BLOB_READ_WRITE_TOKEN ข้อมูลที่บันทึกจะหายเมื่อระบบรีสตาร์ต' }
      : { persistent: true, runtime: 'disk', reason: '' };
  }
  const now = Date.now();
  if (probeCache && now - probeCache.at < 60_000) return probeCache.value;
  let value: StorageStatus;
  try {
    const token = getBlobToken();
    const path = `probe/write-check-${now}.txt`;
    const res = await fetch(`${BLOB_API_BASE}/${path}`, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
        'x-api-version': '7',
        'x-content-type': 'text/plain',
        'x-add-random-suffix': '0',
      },
      body: 'ok',
      signal: AbortSignal.timeout(8000),
    });
    if (res.ok) {
      const data = (await res.json().catch(() => ({}))) as { url?: string };
      if (data.url) await deleteMediaFromCloudBlob(data.url);
      blobWriteSuspended = false;
      value = { persistent: true, runtime: 'vercel-blob', reason: '' };
    } else {
      const body = (await res.json().catch(() => ({}))) as any;
      const code = String(body?.error?.code || res.status);
      value = {
        persistent: false,
        runtime: 'vercel-blob',
        reason:
          code === 'store_suspended'
            ? 'ที่เก็บข้อมูล Vercel Blob ถูกระงับ ข้อมูลที่บันทึกบน Vercel จะหายเมื่อระบบรีสตาร์ต'
            : `ที่เก็บข้อมูล Vercel Blob ปฏิเสธการบันทึก (${code})`,
      };
    }
  } catch (err) {
    value = { persistent: false, runtime: 'vercel-blob', reason: `ตรวจสอบที่เก็บข้อมูลไม่สำเร็จ: ${(err as Error).message}` };
  }
  probeCache = { at: now, value };
  return value;
}

export function getLastPersistError(): string {
  return lastPersistError;
}

export function resetStorageProbeCache() {
  probeCache = null;
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
