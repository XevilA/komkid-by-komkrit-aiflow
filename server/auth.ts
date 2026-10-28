import crypto from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import { db } from './db.ts';
import { getSettingValue } from './mediaEngine.ts';

const TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

function getAuthSecret(): string {
  const configured = getSettingValue('admin_auth_secret', 'ADMIN_AUTH_SECRET');
  if (configured) return configured;
  return `komkrit-admin-hmac-${process.env.VERCEL_PROJECT_ID || 'local-secret-key-2026'}`;
}

export function getAdminCredentials(): { username: string; password: string } {
  const username = getSettingValue('admin_username', 'ADMIN_USERNAME') || 'admin';
  const password = getSettingValue('admin_password', 'ADMIN_PASSWORD') || 'komkrit2026';
  return { username, password };
}

function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

export function verifyCredentials(usernameInput: string, passwordInput: string): boolean {
  const { username, password } = getAdminCredentials();
  return (
    safeEqual(usernameInput.trim(), username) &&
    safeEqual(passwordInput, password)
  );
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
    upsert.run('admin_password', newPassword.trim());
  }
}
