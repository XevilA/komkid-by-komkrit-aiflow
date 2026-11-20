// ============================================================================
// CHANNEL CONNECTIONS — make LINE, Facebook and TikTok connectable by a non-developer.
//  * every connection is verified against the platform's real API before it is saved
//  * Facebook and TikTok use the platform's own "log in and allow" (OAuth) screens
//  * tokens are stored encrypted; TikTok's short-lived token is refreshed automatically
// Nothing here fakes success: a failed check returns the platform's real reason in Thai.
// ============================================================================
import crypto from 'node:crypto';
import { db } from './db.ts';
import { getSettingValue } from './mediaEngine.ts';
import { decryptSecretValue, encryptSecretValue } from './secretVault.ts';

const FB_VERSION = 'v21.0';
export const OAUTH_CHANNELS = ['facebook', 'tiktok'] as const;
export type OAuthChannel = (typeof OAUTH_CHANNELS)[number];

export interface Verified {
  ok: boolean;
  accountName: string;
  detail: string;
  error?: string;
}

const fail = (error: string): Verified => ({ ok: false, accountName: '', detail: '', error });

async function jsonFetch(url: string, init?: RequestInit): Promise<{ status: number; data: any }> {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(15000) });
  let data: any = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  return { status: res.status, data };
}

// ----------------------------------------------------------------------------
// Verification against the real platform APIs
// ----------------------------------------------------------------------------
export async function verifyLine(token: string): Promise<Verified> {
  try {
    const { status, data } = await jsonFetch('https://api.line.me/v2/bot/info', {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (status === 200 && (data?.displayName || data?.userId)) {
      return {
        ok: true,
        accountName: String(data.displayName || data.basicId || data.userId),
        detail: data.basicId ? `LINE ID ${data.basicId}` : 'เชื่อมต่อ LINE Official Account แล้ว',
      };
    }
    if (status === 401 || status === 403) {
      return fail('LINE ปฏิเสธโทเค็นนี้ อาจคัดลอกไม่ครบ หมดอายุ หรือเป็นของ Channel ที่ไม่ใช่ Messaging API กรุณาออกโทเค็นใหม่แล้วลองอีกครั้ง');
    }
    return fail(`LINE ตอบกลับผิดปกติ (HTTP ${status}): ${String(data?.message || '').slice(0, 120)}`);
  } catch (err) {
    return fail(`เชื่อมต่อ LINE ไม่สำเร็จ: ${(err as Error).message}`);
  }
}

export async function verifyFacebookPage(pageId: string, pageToken: string): Promise<Verified> {
  try {
    const { status, data } = await jsonFetch(
      `https://graph.facebook.com/${FB_VERSION}/${encodeURIComponent(pageId)}?fields=name,link,fan_count&access_token=${encodeURIComponent(pageToken)}`
    );
    if (status === 200 && data?.name) {
      return {
        ok: true,
        accountName: String(data.name),
        detail: data.fan_count !== undefined ? `ผู้ติดตาม ${Number(data.fan_count).toLocaleString('th-TH')} คน` : 'เชื่อมต่อเพจแล้ว',
      };
    }
    const msg = String(data?.error?.message || '');
    if (data?.error?.code === 190) return fail('โทเค็น Facebook หมดอายุหรือถูกยกเลิก กรุณาเชื่อมต่อใหม่');
    return fail(`Facebook ปฏิเสธการเข้าถึงเพจนี้ (HTTP ${status})${msg ? `: ${msg.slice(0, 140)}` : ''}`);
  } catch (err) {
    return fail(`เชื่อมต่อ Facebook ไม่สำเร็จ: ${(err as Error).message}`);
  }
}

export async function verifyTikTok(accessToken: string): Promise<Verified> {
  try {
    const { status, data } = await jsonFetch(
      'https://open.tiktokapis.com/v2/user/info/?fields=open_id,display_name,avatar_url',
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    const user = data?.data?.user;
    if (status === 200 && user?.display_name) {
      return { ok: true, accountName: String(user.display_name), detail: 'เชื่อมต่อบัญชี TikTok แล้ว' };
    }
    const msg = String(data?.error?.message || '');
    if (status === 401 || data?.error?.code === 'access_token_invalid') {
      return fail('โทเค็น TikTok หมดอายุหรือไม่ถูกต้อง กรุณาเชื่อมต่อใหม่');
    }
    return fail(`TikTok ตอบกลับผิดปกติ (HTTP ${status})${msg ? `: ${msg.slice(0, 140)}` : ''}`);
  } catch (err) {
    return fail(`เชื่อมต่อ TikTok ไม่สำเร็จ: ${(err as Error).message}`);
  }
}

// ----------------------------------------------------------------------------
// Stored connection state
// ----------------------------------------------------------------------------
function row(key: string): any {
  return db.prepare('SELECT * FROM channel_configs WHERE channel_key = ?').get(key);
}

export function saveConnection(
  key: string,
  v: {
    accessToken: string;
    refreshToken?: string;
    expiresAt?: string;
    targetId?: string;
    accountName: string;
    mode: 'manual' | 'oauth';
    handle?: string;
  }
) {
  const now = new Date().toISOString();
  db.prepare(
    `UPDATE channel_configs SET
       access_token = ?, refresh_token = ?, token_expires_at = ?, target_id = ?, account_name = ?,
       connection_mode = ?, last_verified_at = ?, enabled = 1,
       handle_or_url = CASE WHEN ? != '' THEN ? ELSE handle_or_url END, updated_at = ?
     WHERE channel_key = ?`
  ).run(
    encryptSecretValue(v.accessToken, `channel:${key}`),
    v.refreshToken ? encryptSecretValue(v.refreshToken, `channel:${key}:refresh`) : '',
    v.expiresAt || '',
    v.targetId ?? row(key)?.target_id ?? '',
    v.accountName,
    v.mode,
    now,
    v.handle || '',
    v.handle || '',
    now,
    key
  );
}

export function disconnect(key: string) {
  db.prepare(
    `UPDATE channel_configs SET access_token = '', refresh_token = '', token_expires_at = '', target_id = '',
       account_name = '', connection_mode = '', last_verified_at = '', updated_at = ? WHERE channel_key = ?`
  ).run(new Date().toISOString(), key);
}

export interface ConnectionStatus {
  key: string;
  connected: boolean;
  accountName: string;
  mode: string;
  lastVerifiedAt: string;
}

export function connectionStatus(key: string): ConnectionStatus {
  const r = row(key);
  const token = r ? decryptSecretValue(r.access_token, `channel:${key}`) : '';
  const needsTarget = key === 'facebook';
  return {
    key,
    connected: Boolean(token) && (!needsTarget || Boolean(r?.target_id)),
    accountName: r?.account_name || '',
    mode: r?.connection_mode || '',
    lastVerifiedAt: r?.last_verified_at || '',
  };
}

/** Re-checks a saved connection with the platform and records the result. */
export async function reverify(key: string): Promise<Verified> {
  const r = row(key);
  if (!r) return fail('ไม่พบช่องทางนี้');
  const token = await getUsableToken(key);
  if (!token) return fail('ยังไม่ได้เชื่อมต่อช่องทางนี้');
  const v =
    key === 'line_oa'
      ? await verifyLine(token)
      : key === 'facebook'
      ? await verifyFacebookPage(String(r.target_id || ''), token)
      : key === 'tiktok'
      ? await verifyTikTok(token)
      : fail('ช่องทางนี้ยังไม่รองรับการตรวจสอบอัตโนมัติ');
  if (v.ok) {
    db.prepare('UPDATE channel_configs SET last_verified_at = ?, account_name = ? WHERE channel_key = ?').run(
      new Date().toISOString(),
      v.accountName,
      key
    );
  }
  return v;
}

// ----------------------------------------------------------------------------
// OAuth app credentials (entered once by the site owner) and signed state
// ----------------------------------------------------------------------------
export function getAppCredentials(ch: OAuthChannel): { id: string; secret: string } {
  return ch === 'facebook'
    ? {
        id: getSettingValue('oauth_facebook_app_id', 'FACEBOOK_APP_ID'),
        secret: getSettingValue('oauth_facebook_app_secret', 'FACEBOOK_APP_SECRET'),
      }
    : {
        id: getSettingValue('oauth_tiktok_client_key', 'TIKTOK_CLIENT_KEY'),
        secret: getSettingValue('oauth_tiktok_client_secret', 'TIKTOK_CLIENT_SECRET'),
      };
}

export function saveAppCredentials(ch: OAuthChannel, id: string, secret: string) {
  const set = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');
  const idKey = ch === 'facebook' ? 'oauth_facebook_app_id' : 'oauth_tiktok_client_key';
  const secKey = ch === 'facebook' ? 'oauth_facebook_app_secret' : 'oauth_tiktok_client_secret';
  if (id.trim()) set.run(idKey, id.trim());
  if (secret.trim() && secret.trim() !== '__KEEP__') set.run(secKey, encryptSecretValue(secret.trim(), secKey));
}

function stateSecret(): Buffer {
  return crypto
    .createHash('sha256')
    .update(`oauth-state:${process.env.ADMIN_AUTH_SECRET || process.env.VAULT_MASTER_KEY || process.env.BLOB_READ_WRITE_TOKEN || getSettingValue('admin_auth_secret', 'ADMIN_AUTH_SECRET') || 'local'}`)
    .digest();
}

export function signState(payload: { ch: OAuthChannel; origin: string }): string {
  const body = Buffer.from(
    JSON.stringify({ ...payload, exp: Date.now() + 10 * 60 * 1000, n: crypto.randomBytes(8).toString('hex') })
  ).toString('base64url');
  const sig = crypto.createHmac('sha256', stateSecret()).update(body).digest('base64url');
  return `${body}.${sig}`;
}

export function readState(state: string): { ch: OAuthChannel; origin: string } | null {
  const [body, sig] = String(state || '').split('.');
  if (!body || !sig) return null;
  const expect = crypto.createHmac('sha256', stateSecret()).update(body).digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expect);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (!p.exp || Date.now() > p.exp || !OAUTH_CHANNELS.includes(p.ch)) return null;
    return { ch: p.ch, origin: String(p.origin) };
  } catch {
    return null;
  }
}

export function redirectUri(origin: string): string {
  return `${origin.replace(/\/$/, '')}/api/channels/oauth/callback`;
}

export function authorizeUrl(ch: OAuthChannel, origin: string): { url?: string; error?: string } {
  const { id, secret } = getAppCredentials(ch);
  if (!id || !secret) return { error: 'ยังไม่ได้กรอก App ID และ App Secret ของแอปที่สร้างไว้' };
  const state = signState({ ch, origin });
  if (ch === 'facebook') {
    const u = new URL(`https://www.facebook.com/${FB_VERSION}/dialog/oauth`);
    u.searchParams.set('client_id', id);
    u.searchParams.set('redirect_uri', redirectUri(origin));
    u.searchParams.set('state', state);
    u.searchParams.set('scope', 'pages_show_list,pages_manage_posts,pages_read_engagement');
    u.searchParams.set('response_type', 'code');
    return { url: u.toString() };
  }
  const u = new URL('https://www.tiktok.com/v2/auth/authorize/');
  u.searchParams.set('client_key', id);
  u.searchParams.set('redirect_uri', redirectUri(origin));
  u.searchParams.set('state', state);
  u.searchParams.set('scope', 'user.info.basic,video.publish');
  u.searchParams.set('response_type', 'code');
  return { url: u.toString() };
}

// ----------------------------------------------------------------------------
// OAuth callback handling
// ----------------------------------------------------------------------------
export interface FacebookPage {
  id: string;
  name: string;
  token: string;
}

function putPending(channel: string, payload: unknown): string {
  const nonce = crypto.randomBytes(16).toString('hex');
  db.prepare('DELETE FROM oauth_pending WHERE expires_at < ?').run(new Date().toISOString());
  db.prepare('INSERT INTO oauth_pending (nonce, channel_key, payload_enc, expires_at) VALUES (?, ?, ?, ?)').run(
    nonce,
    channel,
    encryptSecretValue(JSON.stringify(payload), `oauth_pending:${nonce}`),
    new Date(Date.now() + 10 * 60 * 1000).toISOString()
  );
  return nonce;
}

export function takePending<T>(nonce: string, channel: string): T | null {
  const r = db.prepare('SELECT * FROM oauth_pending WHERE nonce = ? AND channel_key = ?').get(nonce, channel) as any;
  if (!r || r.expires_at < new Date().toISOString()) return null;
  try {
    return JSON.parse(decryptSecretValue(r.payload_enc, `oauth_pending:${nonce}`)) as T;
  } catch {
    return null;
  }
}

export function dropPending(nonce: string) {
  db.prepare('DELETE FROM oauth_pending WHERE nonce = ?').run(nonce);
}

export type CallbackResult =
  | { ok: true; channel: OAuthChannel; next: 'done' }
  | { ok: true; channel: 'facebook'; next: 'choose-page'; nonce: string }
  | { ok: false; channel: OAuthChannel; error: string };

export async function handleCallback(code: string, st: { ch: OAuthChannel; origin: string }): Promise<CallbackResult> {
  const { id, secret } = getAppCredentials(st.ch);
  const redirect = redirectUri(st.origin);
  try {
    if (st.ch === 'facebook') {
      const short = await jsonFetch(
        `https://graph.facebook.com/${FB_VERSION}/oauth/access_token?client_id=${encodeURIComponent(id)}&redirect_uri=${encodeURIComponent(redirect)}&client_secret=${encodeURIComponent(secret)}&code=${encodeURIComponent(code)}`
      );
      if (!short.data?.access_token) {
        return { ok: false, channel: 'facebook', error: `Facebook ไม่ยอมรับการอนุญาต: ${String(short.data?.error?.message || '').slice(0, 160)}` };
      }
      // long-lived user token -> page tokens derived from it never expire
      const long = await jsonFetch(
        `https://graph.facebook.com/${FB_VERSION}/oauth/access_token?grant_type=fb_exchange_token&client_id=${encodeURIComponent(id)}&client_secret=${encodeURIComponent(secret)}&fb_exchange_token=${encodeURIComponent(short.data.access_token)}`
      );
      const userToken = long.data?.access_token || short.data.access_token;
      const pages = await jsonFetch(
        `https://graph.facebook.com/${FB_VERSION}/me/accounts?fields=id,name,access_token&limit=50&access_token=${encodeURIComponent(userToken)}`
      );
      const list: FacebookPage[] = (Array.isArray(pages.data?.data) ? pages.data.data : [])
        .filter((p: any) => p?.id && p?.access_token)
        .map((p: any) => ({ id: String(p.id), name: String(p.name || p.id), token: String(p.access_token) }));
      if (list.length === 0) {
        return {
          ok: false,
          channel: 'facebook',
          error: 'ไม่พบเพจ Facebook ที่คุณเป็นผู้ดูแล หรือยังไม่ได้อนุญาตให้เข้าถึงเพจ ลองเชื่อมต่อใหม่แล้วเลือกเพจในหน้าต่างที่ Facebook แสดง',
        };
      }
      if (list.length === 1) {
        const v = await verifyFacebookPage(list[0].id, list[0].token);
        if (!v.ok) return { ok: false, channel: 'facebook', error: v.error || 'ตรวจสอบเพจไม่ผ่าน' };
        saveConnection('facebook', { accessToken: list[0].token, targetId: list[0].id, accountName: v.accountName, mode: 'oauth' });
        return { ok: true, channel: 'facebook', next: 'done' };
      }
      return { ok: true, channel: 'facebook', next: 'choose-page', nonce: putPending('facebook', list) };
    }

    // TikTok
    const body = new URLSearchParams({
      client_key: id,
      client_secret: secret,
      code,
      grant_type: 'authorization_code',
      redirect_uri: redirect,
    });
    const tok = await jsonFetch('https://open.tiktokapis.com/v2/oauth/token/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    if (!tok.data?.access_token) {
      return { ok: false, channel: 'tiktok', error: `TikTok ไม่ยอมรับการอนุญาต: ${String(tok.data?.error_description || tok.data?.error || '').slice(0, 160)}` };
    }
    const v = await verifyTikTok(tok.data.access_token);
    if (!v.ok) return { ok: false, channel: 'tiktok', error: v.error || 'ตรวจสอบบัญชีไม่ผ่าน' };
    saveConnection('tiktok', {
      accessToken: tok.data.access_token,
      refreshToken: tok.data.refresh_token,
      expiresAt: new Date(Date.now() + Number(tok.data.expires_in || 86400) * 1000).toISOString(),
      targetId: String(tok.data.open_id || ''),
      accountName: v.accountName,
      mode: 'oauth',
    });
    return { ok: true, channel: 'tiktok', next: 'done' };
  } catch (err) {
    return { ok: false, channel: st.ch, error: `เชื่อมต่อไม่สำเร็จ: ${(err as Error).message}` };
  }
}

export async function chooseFacebookPage(nonce: string, pageId: string): Promise<Verified> {
  const pages = takePending<FacebookPage[]>(nonce, 'facebook');
  const page = pages?.find((p) => p.id === pageId);
  if (!page) return fail('หมดเวลาเลือกเพจ กรุณากดเชื่อมต่อด้วย Facebook ใหม่อีกครั้ง');
  const v = await verifyFacebookPage(page.id, page.token);
  if (!v.ok) return v;
  saveConnection('facebook', { accessToken: page.token, targetId: page.id, accountName: v.accountName, mode: 'oauth' });
  dropPending(nonce);
  return v;
}

export function pendingPageNames(nonce: string): { id: string; name: string }[] | null {
  const pages = takePending<FacebookPage[]>(nonce, 'facebook');
  return pages ? pages.map((p) => ({ id: p.id, name: p.name })) : null;
}

// ----------------------------------------------------------------------------
// Token freshness (TikTok access tokens last ~24h; the refresh token ~1 year)
// ----------------------------------------------------------------------------
export async function getUsableToken(key: string): Promise<string> {
  const r = row(key);
  if (!r) return '';
  const token = decryptSecretValue(r.access_token, `channel:${key}`);
  if (key !== 'tiktok' || !r.token_expires_at || !r.refresh_token) return token;
  if (new Date(r.token_expires_at).getTime() - Date.now() > 10 * 60 * 1000) return token;
  const refresh = decryptSecretValue(r.refresh_token, `channel:${key}:refresh`);
  const { id, secret } = getAppCredentials('tiktok');
  if (!refresh || !id || !secret) return token;
  try {
    const res = await jsonFetch('https://open.tiktokapis.com/v2/oauth/token/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_key: id, client_secret: secret, grant_type: 'refresh_token', refresh_token: refresh }),
    });
    if (res.data?.access_token) {
      saveConnection('tiktok', {
        accessToken: res.data.access_token,
        refreshToken: res.data.refresh_token || refresh,
        expiresAt: new Date(Date.now() + Number(res.data.expires_in || 86400) * 1000).toISOString(),
        targetId: String(r.target_id || ''),
        accountName: String(r.account_name || ''),
        mode: 'oauth',
      });
      return res.data.access_token;
    }
  } catch {
    /* fall through to the stored token; the publish attempt will report the real error */
  }
  return token;
}
