import type { Express, Request, Response } from 'express';
import {
  OAUTH_CHANNELS,
  authorizeUrl,
  chooseFacebookPage,
  connectionStatus,
  disconnect,
  getAppCredentials,
  handleCallback,
  pendingPageNames,
  readState,
  redirectUri,
  reverify,
  saveAppCredentials,
  saveConnection,
  verifyFacebookPage,
  verifyLine,
  type OAuthChannel,
} from './channelConnect.ts';

const CONNECTABLE = ['line_oa', 'facebook', 'tiktok'];

function originOf(req: Request): string {
  const proto = String(req.headers['x-forwarded-proto'] || req.protocol || 'https').split(',')[0].trim();
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
  return `${proto}://${host}`;
}

export function registerChannelRoutes(app: Express) {
  // What the connection screen needs: the exact address to register in the platform's app settings.
  app.get('/api/channels/connect-info', (req, res) => {
    const origin = originOf(req);
    const info = (ch: OAuthChannel) => {
      const c = getAppCredentials(ch);
      return { hasApp: Boolean(c.id && c.secret), appId: c.id };
    };
    res.json({
      redirectUri: redirectUri(origin),
      facebook: info('facebook'),
      tiktok: info('tiktok'),
      status: Object.fromEntries(CONNECTABLE.map((k) => [k, connectionStatus(k)])),
    });
  });

  // LINE: paste the long-lived channel access token; it is checked with LINE before anything is saved.
  app.post('/api/channels/line_oa/connect', async (req: Request, res: Response) => {
    const token = String(req.body?.token ?? '').trim().replace(/\s+/g, '');
    if (token.length < 30) return void res.status(400).json({ error: 'โทเค็นสั้นเกินไป กรุณาคัดลอก Channel access token ให้ครบทั้งชุด' });
    const v = await verifyLine(token);
    if (!v.ok) return void res.status(400).json({ error: v.error });
    saveConnection('line_oa', { accessToken: token, accountName: v.accountName, mode: 'manual' });
    res.json({ ok: true, accountName: v.accountName, detail: v.detail });
  });

  // Facebook without an app: a Page ID + Page access token pasted by hand (advanced).
  app.post('/api/channels/facebook/connect-manual', async (req: Request, res: Response) => {
    const pageId = String(req.body?.pageId ?? '').trim();
    const token = String(req.body?.token ?? '').trim();
    if (!/^\d{5,}$/.test(pageId)) return void res.status(400).json({ error: 'Page ID ต้องเป็นตัวเลข' });
    if (token.length < 30) return void res.status(400).json({ error: 'Page access token สั้นเกินไป' });
    const v = await verifyFacebookPage(pageId, token);
    if (!v.ok) return void res.status(400).json({ error: v.error });
    saveConnection('facebook', { accessToken: token, targetId: pageId, accountName: v.accountName, mode: 'manual' });
    res.json({ ok: true, accountName: v.accountName, detail: v.detail });
  });

  // One-time app credentials of the site owner's own Facebook / TikTok app.
  app.post('/api/channels/:key/app', (req: Request, res: Response) => {
    const key = String(req.params.key) as OAuthChannel;
    if (!OAUTH_CHANNELS.includes(key)) return void res.status(404).json({ error: 'ช่องทางนี้ไม่ใช้แอปของแพลตฟอร์ม' });
    const id = String(req.body?.appId ?? '').trim();
    const secret = String(req.body?.appSecret ?? '').trim();
    if (id && !/^[A-Za-z0-9_-]{6,64}$/.test(id)) return void res.status(400).json({ error: 'App ID / Client key ไม่ถูกต้อง (ตรวจว่าไม่มีช่องว่างหรืออักขระแปลก)' });
    if (secret && secret !== '__KEEP__' && !/^[A-Za-z0-9_-]{8,128}$/.test(secret)) return void res.status(400).json({ error: 'App Secret / Client secret ไม่ถูกต้อง' });
    saveAppCredentials(key, id, secret);
    const c = getAppCredentials(key);
    res.json({ ok: true, hasApp: Boolean(c.id && c.secret) });
  });

  app.post('/api/channels/:key/oauth/start', (req: Request, res: Response) => {
    const key = String(req.params.key) as OAuthChannel;
    if (!OAUTH_CHANNELS.includes(key)) return void res.status(404).json({ error: 'ช่องทางนี้ไม่รองรับการเชื่อมต่อด้วยการเข้าสู่ระบบ' });
    const out = authorizeUrl(key, originOf(req));
    if (!out.url) return void res.status(400).json({ error: out.error });
    res.json({ url: out.url });
  });

  // The platform sends the visitor's browser back here. It carries no admin header, so trust comes
  // from the signed, expiring `state` we created when the admin pressed "connect".
  app.get('/api/channels/oauth/callback', async (req: Request, res: Response) => {
    const st = readState(String(req.query.state || ''));
    if (!st) return void res.status(400).send('ลิงก์เชื่อมต่อไม่ถูกต้องหรือหมดอายุ กรุณากลับไปกดเชื่อมต่อใหม่');
    const back = (q: Record<string, string>) =>
      res.redirect(302, `${st.origin}/admin?${new URLSearchParams({ channel: st.ch, ...q }).toString()}`);
    if (req.query.error) {
      return back({ connect: 'denied', message: 'คุณยกเลิกการอนุญาต หรือแพลตฟอร์มไม่อนุญาต' });
    }
    const code = String(req.query.code || '');
    if (!code) return back({ connect: 'error', message: 'ไม่ได้รับรหัสอนุญาตจากแพลตฟอร์ม' });
    const out = await handleCallback(code, st);
    if (!out.ok) return back({ connect: 'error', message: out.error });
    if (out.next === 'choose-page') return back({ connect: 'choose', nonce: out.nonce });
    return back({ connect: 'ok' });
  });

  app.get('/api/channels/facebook/pages', (req, res) => {
    const pages = pendingPageNames(String(req.query.nonce || ''));
    if (!pages) return void res.status(410).json({ error: 'หมดเวลาเลือกเพจ กรุณากดเชื่อมต่อด้วย Facebook ใหม่' });
    res.json({ pages });
  });

  app.post('/api/channels/facebook/choose-page', async (req, res) => {
    const v = await chooseFacebookPage(String(req.body?.nonce || ''), String(req.body?.pageId || ''));
    if (!v.ok) return void res.status(400).json({ error: v.error });
    res.json({ ok: true, accountName: v.accountName });
  });

  app.post('/api/channels/:key/verify', async (req, res) => {
    const key = String(req.params.key);
    if (!CONNECTABLE.includes(key)) return void res.status(404).json({ error: 'ช่องทางนี้ยังไม่รองรับการตรวจสอบอัตโนมัติ' });
    const v = await reverify(key);
    res.status(v.ok ? 200 : 400).json(v.ok ? { ok: true, accountName: v.accountName, detail: v.detail } : { ok: false, error: v.error });
  });

  app.post('/api/channels/:key/disconnect', (req, res) => {
    const key = String(req.params.key);
    if (!CONNECTABLE.includes(key)) return void res.status(404).json({ error: 'ไม่พบช่องทางนี้' });
    disconnect(key);
    res.json({ ok: true });
  });
}
