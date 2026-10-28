import crypto from 'node:crypto';
import {
  IS_SERVERLESS,
  exportDatabaseSnapshotBuffer,
  reloadDatabaseFromSnapshotBuffer,
} from './db.ts';

const BLOB_API_BASE = 'https://blob.vercel-storage.com';
const STATE_PREFIX = 'state/komkrit-db-';

let currentLoadedBlobPath = '';
let lastCheckAt = 0;

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
  const token = getBlobToken();
  const now = Date.now();
  if (!forceCheck && currentLoadedBlobPath && now - lastCheckAt < 1200) {
    return;
  }
  lastCheckAt = now;

  const blobs = await listStateBlobs(token);
  if (blobs.length === 0) {
    // First boot on cloud: push initial seeded SQLite DB so all instances share the exact baseline
    await persistDatabaseToCloud();
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
  reloadDatabaseFromSnapshotBuffer(sqliteBytes);
  currentLoadedBlobPath = newest.pathname;
}

export async function persistDatabaseToCloud(): Promise<void> {
  if (!isCloudSyncEnabled()) return;
  const token = getBlobToken();

  const sqliteBytes = exportDatabaseSnapshotBuffer();
  const encryptedBytes = encryptBuffer(sqliteBytes, token);
  const ts = String(Date.now()).padStart(15, '0');
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
    currentLoadedBlobPath = pathname;
    lastCheckAt = Date.now();

    // Clean up older snapshots keeping only the 2 most recent
    const blobs = await listStateBlobs(token);
    if (blobs.length > 2) {
      const oldUrls = blobs.slice(2).map((b) => b.url);
      await deleteOldStateBlobs(token, oldUrls);
    }
  }
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
