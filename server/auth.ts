import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { Request, Response, NextFunction } from 'express';
import { db, DATA_DIR, IS_SERVERLESS } from './db.ts';
import { getSettingValue } from './mediaEngine.ts';

const TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const SCRYPT_PREFIX = 'scrypt:v1:';
const LOGIN_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const MAX_LOGIN_ATTEMPTS = 10;

const loginAttemptsMap = new Map<string, number[]>();
let cachedAuthSecret: string | null = null;

function getOrCreateLocalAuthSecret(): string {
  if (cachedAuthSecret) return cachedAuthSecret;
  const keyFile = path.join(DATA_DIR, '.admin_auth.key');
  try {
    if (fs.existsSync(keyFile)) {
      const existing = fs.readFileSync(keyFile, 'utf8').trim();
      if (existing.length >= 32) {
        cachedAuthSecret = existing;
        return existing;
      }
    }
    const fresh = crypto.randomBytes(32).toString('hex');
    fs.writeFileSync(keyFile, fresh, { encoding: 'utf8', mode: 0o600 });
    try {
      fs.chmodSync(keyFile, 0o600);
    } catch {
      // ignore on non-POSIX filesystems
    }
    cachedAuthSecret = fresh;
    return fresh;
  } catch {
    const ephemeral = crypto.randomBytes(32).toString('hex');
    cachedAuthSecret = ephemeral;
    return ephemeral;
  }
}

function getAuthSecret(): string {
  const configured =
    getSettingValue('admin_auth_secret', 'ADMIN_AUTH_SECRET') ||
    (process.env.VAULT_MASTER_KEY || process.env.KOMKRIT_VAULT_SECRET || '').trim() ||
    (process.env.BLOB_READ_WRITE_TOKEN || '').trim();
  if (configured) {
    return crypto
      .createHash('sha256')
      .update(`komkrit-hmac-v2:${configured}`)
      .digest('hex');
  }
  if (IS_SERVERLESS && process.env.VERCEL_PROJECT_ID) {
    return crypto
      .createHash('sha256')
      .update(`komkrit-vercel-hmac:${process.env.VERCEL_PROJECT_ID}:${process.env.VERCEL_URL || ''}`)
      .digest('hex');
  }
  return getOrCreateLocalAuthSecret();
}

export function hashPasswordScrypt(plain: string): string {
  const salt = crypto.randomBytes(16).toString('base64url');
  const derived = crypto.scryptSync(plain, salt, 32).toString('base64url');
  return `${SCRYPT_PREFIX}${salt}:${derived}`;
}

function verifyPasswordHash(input: string, stored: string): boolean {
  if (!stored) return false;
  if (stored.startsWith(SCRYPT_PREFIX)) {
    const rest = stored.slice(SCRYPT_PREFIX.length);
    const [salt, hashB64] = rest.split(':');
    if (!salt || !hashB64) return false;
    try {
      const derived = crypto.scryptSync(input, salt, 32).toString('base64url');
      return safeEqual(derived, hashB64);
    } catch {
      return false;
    }
  }
  return safeEqual(input, stored);
}

export function getAdminCredentials(): { username: string; password: string } {
  const rawUser = getSettingValue('admin_username', 'ADMIN_USERNAME');
  const rawPass = getSettingValue('admin_password', 'ADMIN_PASSWORD');
  const username = rawUser && rawUser !== 'change-me-admin' ? rawUser : 'admin';
  const password =
    rawPass && rawPass !== 'change-me-strong-password' ? rawPass : 'komkrit2026';
  return { username, password };
}

function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

export function getClientIp(req: Request): string {
  const xff = req.headers['x-forwarded-for'];
  if (typeof xff === 'string' && xff.trim()) {
    return xff.split(',')[0].trim();
  }
  return req.ip || req.socket?.remoteAddress || 'unknown';
}

export function checkLoginRateLimit(ip: string): { allowed: boolean; retryAfterSec: number } {
  const now = Date.now();
  const prev = (loginAttemptsMap.get(ip) || []).filter((ts) => now - ts < LOGIN_WINDOW_MS);
  loginAttemptsMap.set(ip, prev);
  if (prev.length >= MAX_LOGIN_ATTEMPTS) {
    const oldest = prev[0];
    const retryAfterSec = Math.max(1, Math.ceil((LOGIN_WINDOW_MS - (now - oldest)) / 1000));
    return { allowed: false, retryAfterSec };
  }
  return { allowed: true, retryAfterSec: 0 };
}

export function recordLoginFailure(ip: string): void {
  const now = Date.now();
  const prev = (loginAttemptsMap.get(ip) || []).filter((ts) => now - ts < LOGIN_WINDOW_MS);
  prev.push(now);
  loginAttemptsMap.set(ip, prev);
}

export function clearLoginFailures(ip: string): void {
  loginAttemptsMap.delete(ip);
}

export function verifyCredentials(usernameInput: string, passwordInput: string): boolean {
  const { username, password } = getAdminCredentials();
  const userOk = safeEqual(usernameInput.trim(), username);
  const passOk = verifyPasswordHash(passwordInput, password);
  if (userOk && passOk) {
    // Auto-upgrade legacy plaintext DB password to scrypt hash transparently
    const dbRow = db
      .prepare('SELECT value FROM settings WHERE key = ?')
      .get('admin_password') as { value: string } | undefined;
    if (dbRow?.value && !dbRow.value.startsWith(SCRYPT_PREFIX)) {
      try {
        db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(
          'admin_password',
          hashPasswordScrypt(passwordInput)
        );
      } catch {
        // ignore
      }
    }
    return true;
  }
  return false;
}

export function createAdminToken(username: string): { token: string; expiresAt: number } {
  const expiresAt = Date.now() + TOKEN_TTL_MS;
  const payload = Buffer.from(
    JSON.stringify({ u: username, exp: expiresAt }),
    'utf8'
  ).toString('base64url');
  const sig = crypto
    .createHmac('sha256', getAuthSecret())
    .update(payload)
    .digest('base64url');
  return {
    token: `${payload}.${sig}`,
    expiresAt,
  };
}

export function verifyAdminToken(token?: string | null): { valid: boolean; username?: string } {
  if (!token || !token.includes('.')) return { valid: false };
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return { valid: false };

  const expectedSig = crypto
    .createHmac('sha256', getAuthSecret())
    .update(payload)
    .digest('base64url');

  if (!safeEqual(sig, expectedSig)) return { valid: false };

  try {
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!parsed?.exp || Date.now() > Number(parsed.exp)) {
      return { valid: false };
    }
    return { valid: true, username: String(parsed.u || 'admin') };
  } catch {
    return { valid: false };
  }
}

export function extractBearerToken(req: Request): string | null {
  const header = req.headers.authorization || '';
  if (header.startsWith('Bearer ')) {
    return header.slice(7).trim();
  }
  return null;
}

export function isRequestAdmin(req: Request): boolean {
  const token = extractBearerToken(req);
  return verifyAdminToken(token).valid;
}

export function requireAdminAuth(req: Request, res: Response, next: NextFunction): void {
  const token = extractBearerToken(req);
  const check = verifyAdminToken(token);
  if (!check.valid) {
    res.status(401).json({ error: 'กรุณาเข้าสู่ระบบผู้ดูแล (Admin) ก่อนใช้งานส่วนนี้' });
    return;
  }
  next();
}

export function updateAdminCredentials(newUsername: string, newPassword: string): void {
  const upsert = db.prepare(`
    INSERT INTO settings (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `);
  if (newUsername.trim()) {
    upsert.run('admin_username', newUsername.trim());
  }
  if (newPassword.trim()) {
    upsert.run('admin_password', hashPasswordScrypt(newPassword.trim()));
  }
}
