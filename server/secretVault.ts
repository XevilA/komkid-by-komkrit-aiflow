import crypto from 'node:crypto';
import zlib from 'node:zlib';

const ENC_PREFIX = 'enc:v1:';
const SEALED_VAULT_PREFIX = 'kvault1.';

export const SECRET_SETTING_KEYS = new Set<string>([
  'gemini_api_key',
  'claude_api_key',
  'deepseek_api_key',
  'openai_api_key',
  'vertex_access_token',
  'elevenlabs_api_key',
  'resend_api_key',
  'local_api_key',
]);

export interface UnsealedVaultPayload {
  updatedAt: number;
  rows: Record<string, string>;
}

function getMasterSeedMaterial(): string {
  const parts = [
    process.env.VAULT_MASTER_KEY || '',
    process.env.BLOB_READ_WRITE_TOKEN || '',
    process.env.ADMIN_AUTH_SECRET || '',
    'komkid-by-komkrit-aes256gcm-vault-v1',
  ];
  return parts.join('|');
}

function deriveSubkey(purpose: string): Buffer {
  const ikm = Buffer.from(getMasterSeedMaterial(), 'utf8');
  const salt = Buffer.from('komkid-by-komkrit-hkdf-salt-2026', 'utf8');
  const info = Buffer.from(`komkid:${purpose}`, 'utf8');
  return Buffer.from(crypto.hkdfSync('sha256', ikm, salt, info, 32));
}

export function isEncryptedSecret(val?: string | null): boolean {
  return typeof val === 'string' && val.startsWith(ENC_PREFIX);
}

/**
 * Encrypts a single secret field using AES-256-GCM with authenticated AAD bound to fieldName.
 * Output format: enc:v1:<iv_b64url>:<tag_b64url>:<ciphertext_b64url>
 */
export function encryptSecretValue(plain: string, fieldName: string): string {
  const clean = (plain || '').trim();
  if (!clean) return '';
  if (isEncryptedSecret(clean)) return clean;

  const key = deriveSubkey('field-encryption-v1');
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(`field:${fieldName}`, 'utf8'));

  const encrypted = Buffer.concat([cipher.update(clean, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return `${ENC_PREFIX}${iv.toString('base64url')}:${tag.toString('base64url')}:${encrypted.toString('base64url')}`;
}

/**
 * Decrypts an enc:v1:... value in memory only when needed to call an upstream AI API.
 * Gracefully handles legacy plaintext values prior to automatic DB migration.
 */
export function decryptSecretValue(stored: string | undefined | null, fieldName: string): string {
  const raw = (stored || '').trim();
  if (!raw) return '';
  if (!raw.startsWith(ENC_PREFIX)) {
    return raw;
  }

  const body = raw.slice(ENC_PREFIX.length);
  const parts = body.split(':');
  if (parts.length !== 3) return '';

  try {
    const iv = Buffer.from(parts[0], 'base64url');
    const tag = Buffer.from(parts[1], 'base64url');
    const ciphertext = Buffer.from(parts[2], 'base64url');

    const key = deriveSubkey('field-encryption-v1');
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAAD(Buffer.from(`field:${fieldName}`, 'utf8'));
    decipher.setAuthTag(tag);

    const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return decrypted.toString('utf8');
  } catch {
    return '';
  }
}

/**
 * Creates a server-sealed, versioned, gzipped AES-256-GCM encrypted backup token containing
 * encrypted settings rows. Indecipherable outside the server (requires server secret material).
 * Guarantees multi-container serverless consistency & cold-start persistence.
 */
export function sealSettingsVaultToken(
  settingsRows: Record<string, string>,
  updatedAt = Date.now()
): string {
  const payload = JSON.stringify({
    v: 1,
    iat: updatedAt,
    updatedAt,
    rows: settingsRows,
  });
  const compressed = zlib.gzipSync(Buffer.from(payload, 'utf8'));
  const key = deriveSubkey('stateless-sealed-vault-v1');
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from('komkid-sealed-vault-v1', 'utf8'));

  const encrypted = Buffer.concat([cipher.update(compressed), cipher.final()]);
  const tag = cipher.getAuthTag();

  return `${SEALED_VAULT_PREFIX}${iv.toString('base64url')}.${tag.toString('base64url')}.${encrypted.toString('base64url')}`;
}

export function unsealSettingsVaultWithMeta(
  token?: string | null
): UnsealedVaultPayload | null {
  const raw = (token || '').trim();
  if (!raw || !raw.startsWith(SEALED_VAULT_PREFIX)) return null;

  const parts = raw.slice(SEALED_VAULT_PREFIX.length).split('.');
  if (parts.length !== 3) return null;

  try {
    const iv = Buffer.from(parts[0], 'base64url');
    const tag = Buffer.from(parts[1], 'base64url');
    const ciphertext = Buffer.from(parts[2], 'base64url');

    const key = deriveSubkey('stateless-sealed-vault-v1');
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAAD(Buffer.from('komkid-sealed-vault-v1', 'utf8'));
    decipher.setAuthTag(tag);

    const compressed = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    const jsonStr = zlib.gunzipSync(compressed).toString('utf8');
    const parsed = JSON.parse(jsonStr);
    if (parsed && typeof parsed.rows === 'object' && parsed.rows !== null) {
      const ts = Number(parsed.updatedAt || parsed.iat || 0);
      return {
        updatedAt: Number.isFinite(ts) ? ts : 0,
        rows: parsed.rows as Record<string, string>,
      };
    }
    return null;
  } catch {
    return null;
  }
}

export function unsealSettingsVaultToken(
  token?: string | null
): Record<string, string> | null {
  const meta = unsealSettingsVaultWithMeta(token);
  return meta ? meta.rows : null;
}

/**
 * Strict key masking for UI display — never exposes middle characters or short keys.
 */
export function maskSecretStrict(val?: string | null): string {
  const s = (val || '').trim();
  if (!s) return '';
  if (s.length <= 12) return '••••••••••••••••';
  return `${s.slice(0, 4)}••••••••••••${s.slice(-4)}`;
}

/**
 * Redacts any API keys or bearer tokens from error strings / logs so secrets never leak.
 */
export function redactSecrets(message: string, knownSecrets: (string | undefined)[] = []): string {
  let out = String(message || '');
  for (const sec of knownSecrets) {
    const clean = (sec || '').trim();
    if (clean.length >= 8) {
      out = out.split(clean).join('[REDACTED_KEY]');
    }
  }
  out = out.replace(/\bsk-[A-Za-z0-9_-]{12,}\b/g, 'sk-••••••••[REDACTED]');
  out = out.replace(/\bAIza[A-Za-z0-9_-]{20,}\b/g, 'AIza••••••••[REDACTED]');
  out = out.replace(/\bre_[A-Za-z0-9_]{12,}\b/g, 're_••••••••[REDACTED]');
  out = out.replace(/\bvercel_blob_rw_[A-Za-z0-9_]{10,}\b/g, '[REDACTED_BLOB_TOKEN]');
  return out;
}
