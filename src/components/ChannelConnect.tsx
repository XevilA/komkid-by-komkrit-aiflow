import React, { useCallback, useEffect, useState } from 'react';
import { Check, Copy, ExternalLink } from 'lucide-react';
import { api } from '../api';
import { Button, Card, ConfirmDialog, Input, Notice, StatusText } from './ui';

type Key = 'line_oa' | 'facebook' | 'tiktok';
type Info = Awaited<ReturnType<typeof api.getChannelConnectInfo>>;

const NAMES: Record<Key, string> = { line_oa: 'LINE Official Account', facebook: 'Facebook เพจ', tiktok: 'TikTok' };

const Steps: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <ol className="list-decimal space-y-2 pl-5 text-sm leading-relaxed text-slate-700">{children}</ol>
);

const Ext: React.FC<{ href: string; children: React.ReactNode }> = ({ href, children }) => (
  <a href={href} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-medium text-slate-900 underline underline-offset-2">
    {children}
    <ExternalLink className="h-3 w-3" />
  </a>
);

const CopyBox: React.FC<{ value: string }> = ({ value }) => {
  const [done, setDone] = useState(false);
  return (
    <div className="mt-1.5 flex items-center gap-2">
      <code className="min-w-0 flex-1 truncate rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-800">{value}</code>
      <Button
        size="sm"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(value);
            setDone(true);
            setTimeout(() => setDone(false), 1800);
          } catch {
            /* clipboard blocked: the text is selectable */
          }
        }}
      >
        {done ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />} {done ? 'คัดลอกแล้ว' : 'คัดลอก'}
      </Button>
    </div>
  );
};

export const ChannelConnect: React.FC = () => {
  const [info, setInfo] = useState<Info | null>(null);
  const [notice, setNotice] = useState<{ tone: 'ok' | 'error' | 'info'; text: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const [lineToken, setLineToken] = useState('');
  const [fbAppId, setFbAppId] = useState('');
  const [fbSecret, setFbSecret] = useState('');
  const [fbManual, setFbManual] = useState(false);
  const [fbPageId, setFbPageId] = useState('');
  const [fbToken, setFbToken] = useState('');
  const [ttKey, setTtKey] = useState('');
  const [ttSecret, setTtSecret] = useState('');
  const [offKey, setOffKey] = useState<Key | null>(null);
  const [pickNonce, setPickNonce] = useState('');
  const [pages, setPages] = useState<{ id: string; name: string }[]>([]);

  const load = useCallback(async () => {
    try {
      const i = await api.getChannelConnectInfo();
      setInfo(i);
      setFbAppId((v) => v || i.facebook.appId);
      setTtKey((v) => v || i.tiktok.appId);
    } catch (e) {
      setNotice({ tone: 'error', text: (e as Error).message });
    }
  }, []);

  // Coming back from Facebook / TikTok: show what happened
  useEffect(() => {
    load();
    const q = new URLSearchParams(window.location.search);
    const result = q.get('connect');
    const ch = q.get('channel');
    if (!result || !ch) return;
    window.history.replaceState({}, '', '/admin');
    const name = ch === 'facebook' ? 'Facebook' : ch === 'tiktok' ? 'TikTok' : ch;
    if (result === 'ok') setNotice({ tone: 'ok', text: `เชื่อมต่อ ${name} สำเร็จแล้ว` });
    else if (result === 'choose' && q.get('nonce')) {
      const nonce = q.get('nonce')!;
      setPickNonce(nonce);
      api.listFacebookPages(nonce).then((r) => setPages(r.pages)).catch((e) => setNotice({ tone: 'error', text: e.message }));
    } else setNotice({ tone: 'error', text: q.get('message') || `เชื่อมต่อ ${name} ไม่สำเร็จ` });
  }, [load]);

  const run = async (id: string, fn: () => Promise<string | void>) => {
    setBusy(id);
    setNotice(null);
    try {
      const msg = await fn();
      if (msg) setNotice({ tone: 'ok', text: msg });
      await load();
    } catch (e) {
      setNotice({ tone: 'error', text: (e as Error).message });
    } finally {
      setBusy(null);
    }
  };

  const oauth = (key: 'facebook' | 'tiktok', id: string, secret: string) =>
    run(`${key}-oauth`, async () => {
      const has = key === 'facebook' ? info?.facebook.hasApp : info?.tiktok.hasApp;
      if (id.trim() || secret.trim() || !has) await api.saveChannelApp(key, id, secret || '__KEEP__');
      const { url } = await api.startChannelOauth(key);
      window.location.assign(url);
    });

  const status = (k: Key) => info?.status[k];

  const header = (k: Key) => {
    const st = status(k);
    return (
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">{NAMES[k]}</h3>
          <div className="mt-1">
            {st?.connected ? (
              <StatusText tone="ok">เชื่อมต่อแล้ว: {st.accountName || 'บัญชีของคุณ'}</StatusText>
            ) : (
              <StatusText>ยังไม่ได้เชื่อมต่อ</StatusText>
            )}
          </div>
        </div>
        {st?.connected && (
          <div className="flex gap-2">
            <Button
              size="sm"
              disabled={busy !== null}
              onClick={() => run(`${k}-verify`, async () => {
                const r = await api.verifyChannel(k);
                return `การเชื่อมต่อใช้งานได้ปกติ: ${r.accountName}`;
              })}
            >
              ตรวจสอบการเชื่อมต่อ
            </Button>
            <Button
              size="sm"
              variant="danger"
              disabled={busy !== null}
              onClick={() => setOffKey(k)}
            >
              ยกเลิกการเชื่อมต่อ
            </Button>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-base font-semibold text-slate-900">เชื่อมต่อบัญชีโซเชียล</h2>
        <p className="mt-0.5 text-sm text-slate-600">
          ทำตามขั้นตอนทีละข้อ ระบบจะตรวจสอบกับแพลตฟอร์มจริงทุกครั้งก่อนบันทึก และเก็บโทเค็นแบบเข้ารหัส ไม่ต้องเขียนโค้ด
        </p>
      </div>

      {notice && <Notice tone={notice.tone}>{notice.text}</Notice>}

      <ConfirmDialog
        open={offKey !== null}
        title="ยกเลิกการเชื่อมต่อ"
        danger
        busy={busy !== null}
        confirmLabel="ยกเลิกการเชื่อมต่อ"
        message={offKey && `ยกเลิกการเชื่อมต่อ ${NAMES[offKey]} ระบบจะลบโทเค็นที่เก็บไว้ และโพสต์ลงช่องทางนี้ไม่ได้จนกว่าจะเชื่อมต่อใหม่`}
        onCancel={() => setOffKey(null)}
        onConfirm={() => {
          const k = offKey!;
          setOffKey(null);
          run(`${k}-off`, async () => {
            await api.disconnectChannel(k);
            return `ยกเลิกการเชื่อมต่อ ${NAMES[k]} แล้ว`;
          });
        }}
      />

      {pickNonce && pages.length > 0 && (
        <Card className="space-y-3 p-5">
          <h3 className="text-sm font-semibold text-slate-900">เลือกเพจ Facebook ที่จะโพสต์</h3>
          <div className="space-y-1.5">
            {pages.map((p) => (
              <Button
                key={p.id}
                className="w-full justify-start"
                disabled={busy !== null}
                onClick={() => run('fb-pick', async () => {
                  await api.chooseFacebookPage(pickNonce, p.id);
                  setPickNonce('');
                  setPages([]);
                  return `เชื่อมต่อเพจ "${p.name}" สำเร็จแล้ว`;
                })}
              >
                {p.name}
              </Button>
            ))}
          </div>
        </Card>
      )}

      {/* ------------------------------------------------------------ LINE */}
      <Card className="space-y-4 p-5">
        {header('line_oa')}
        {!status('line_oa')?.connected && (
          <>
            <Steps>
              <li>
                เปิด <Ext href="https://developers.line.biz/console/">LINE Developers Console</Ext> แล้วเข้าสู่ระบบด้วยบัญชี LINE ที่ดูแล Official Account
              </li>
              <li>
                เลือก Provider และเลือกช่อง (Channel) ของ Official Account แล้วเปิดแท็บ <strong>Messaging API</strong>
                <div className="text-xs text-slate-500">
                  ยังไม่มี Official Account? สมัครที่ <Ext href="https://manager.line.biz/">LINE Official Account Manager</Ext> แล้วกด "เปิดใช้ Messaging API" ในหน้าตั้งค่า
                </div>
              </li>
              <li>เลื่อนลงไปที่ <strong>Channel access token (long-lived)</strong> กดปุ่ม <strong>Issue</strong> แล้วคัดลอกข้อความยาวๆ ที่ปรากฏ</li>
              <li>วางลงในช่องด้านล่าง แล้วกด "เชื่อมต่อ LINE"</li>
            </Steps>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input type="password" autoComplete="off" value={lineToken} onChange={(e) => setLineToken(e.target.value)} placeholder="วาง Channel access token ที่นี่" />
              <Button
                variant="primary"
                disabled={busy !== null || lineToken.trim().length < 30}
                onClick={() => run('line', async () => {
                  const r = await api.connectLine(lineToken);
                  setLineToken('');
                  return `เชื่อมต่อ LINE สำเร็จ: ${r.accountName}`;
                })}
              >
                {busy === 'line' ? 'กำลังตรวจสอบ' : 'เชื่อมต่อ LINE'}
              </Button>
            </div>
            <p className="text-xs text-slate-500">การโพสต์จะส่งเป็นข้อความ Broadcast ถึงเพื่อนทุกคนของ Official Account (นับตามโควตาข้อความของแพ็กเกจที่ใช้อยู่)</p>
          </>
        )}
      </Card>

      {/* ------------------------------------------------------------ Facebook */}
      <Card className="space-y-4 p-5">
        {header('facebook')}
        {!status('facebook')?.connected && (
          <>
            <div className="flex gap-2">
              <Button size="sm" variant={fbManual ? 'secondary' : 'primary'} onClick={() => setFbManual(false)}>
                เชื่อมต่อด้วยบัญชี Facebook (แนะนำ)
              </Button>
              <Button size="sm" variant={fbManual ? 'primary' : 'secondary'} onClick={() => setFbManual(true)}>
                กรอก Page ID และโทเค็นเอง
              </Button>
            </div>

            {!fbManual ? (
              <>
                <Steps>
                  <li>
                    <strong>ขั้นเตรียมครั้งเดียว:</strong> เปิด <Ext href="https://developers.facebook.com/apps/">Facebook for Developers</Ext> กด <strong>สร้างแอป</strong> เลือกประเภท <strong>ธุรกิจ (Business)</strong> ตั้งชื่ออะไรก็ได้
                  </li>
                  <li>
                    ในแอปที่สร้าง กด <strong>เพิ่มผลิตภัณฑ์</strong> เลือก <strong>Facebook Login</strong> ไปที่การตั้งค่า แล้ววางลิงก์นี้ในช่อง <strong>Valid OAuth Redirect URIs</strong> จากนั้นกดบันทึก
                    {info && <CopyBox value={info.redirectUri} />}
                  </li>
                  <li>ไปที่ <strong>การตั้งค่า ▸ พื้นฐาน</strong> คัดลอก <strong>App ID</strong> และ <strong>App Secret</strong> (กดแสดงก่อน) มาวางด้านล่าง</li>
                  <li>กด <strong>เชื่อมต่อด้วย Facebook</strong> เลือกเพจที่ต้องการแล้วกดอนุญาต ระบบจะพากลับมาที่หน้านี้เอง</li>
                </Steps>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <Input value={fbAppId} onChange={(e) => setFbAppId(e.target.value)} placeholder="App ID" inputMode="numeric" />
                  <Input type="password" autoComplete="off" value={fbSecret} onChange={(e) => setFbSecret(e.target.value)} placeholder={info?.facebook.hasApp ? 'App Secret (บันทึกไว้แล้ว เว้นว่างได้)' : 'App Secret'} />
                </div>
                <Button
                  variant="primary"
                  disabled={busy !== null || (!info?.facebook.hasApp && (!fbAppId.trim() || !fbSecret.trim()))}
                  onClick={() => oauth('facebook', fbAppId, fbSecret)}
                >
                  {busy === 'facebook-oauth' ? 'กำลังไป Facebook' : 'เชื่อมต่อด้วย Facebook'}
                </Button>
                <p className="text-xs text-slate-500">แอปของคุณอยู่ในโหมดพัฒนา ใช้โพสต์ลงเพจที่คุณเป็นผู้ดูแลได้ทันที ไม่ต้องส่งแอปให้ Facebook ตรวจสอบ</p>
              </>
            ) : (
              <>
                <Steps>
                  <li>
                    เปิด <Ext href="https://developers.facebook.com/tools/explorer/">Graph API Explorer</Ext> เลือกแอปของคุณ แล้วขอสิทธิ์ <code>pages_manage_posts</code> และ <code>pages_show_list</code>
                  </li>
                  <li>คัดลอก Page ID (ตัวเลข) และ Page access token ของเพจ มาวางด้านล่าง</li>
                </Steps>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <Input value={fbPageId} onChange={(e) => setFbPageId(e.target.value)} placeholder="Page ID (ตัวเลข)" inputMode="numeric" />
                  <Input type="password" autoComplete="off" value={fbToken} onChange={(e) => setFbToken(e.target.value)} placeholder="Page access token" />
                </div>
                <Button
                  variant="primary"
                  disabled={busy !== null || !fbPageId.trim() || fbToken.trim().length < 30}
                  onClick={() => run('fb-manual', async () => {
                    const r = await api.connectFacebookManual(fbPageId.trim(), fbToken.trim());
                    setFbToken('');
                    return `เชื่อมต่อเพจ "${r.accountName}" สำเร็จแล้ว`;
                  })}
                >
                  ตรวจสอบและเชื่อมต่อ
                </Button>
              </>
            )}
          </>
        )}
      </Card>

      {/* ------------------------------------------------------------ TikTok */}
      <Card className="space-y-4 p-5">
        {header('tiktok')}
        {!status('tiktok')?.connected && (
          <>
            <Steps>
              <li>
                <strong>ขั้นเตรียมครั้งเดียว:</strong> เปิด <Ext href="https://developers.tiktok.com/apps/">TikTok for Developers</Ext> เข้าสู่ระบบ แล้วกด <strong>Connect an app</strong> ตั้งชื่อแอป
              </li>
              <li>
                ในแอป เพิ่มผลิตภัณฑ์ <strong>Login Kit</strong> และ <strong>Content Posting API</strong> แล้ววางลิงก์นี้ในช่อง <strong>Redirect URI</strong>
                {info && <CopyBox value={info.redirectUri} />}
              </li>
              <li>คัดลอก <strong>Client key</strong> และ <strong>Client secret</strong> มาวางด้านล่าง</li>
              <li>กด <strong>เชื่อมต่อด้วย TikTok</strong> เข้าสู่ระบบด้วยบัญชี TikTok ที่จะโพสต์ แล้วกดอนุญาต</li>
            </Steps>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <Input value={ttKey} onChange={(e) => setTtKey(e.target.value)} placeholder="Client key" />
              <Input type="password" autoComplete="off" value={ttSecret} onChange={(e) => setTtSecret(e.target.value)} placeholder={info?.tiktok.hasApp ? 'Client secret (บันทึกไว้แล้ว เว้นว่างได้)' : 'Client secret'} />
            </div>
            <Button
              variant="primary"
              disabled={busy !== null || (!info?.tiktok.hasApp && (!ttKey.trim() || !ttSecret.trim()))}
              onClick={() => oauth('tiktok', ttKey, ttSecret)}
            >
              {busy === 'tiktok-oauth' ? 'กำลังไป TikTok' : 'เชื่อมต่อด้วย TikTok'}
            </Button>
            <Notice>
              ข้อจำกัดของ TikTok: แอปที่ TikTok ยังไม่ได้ตรวจสอบ (audit) จะโพสต์ได้เฉพาะแบบ "ส่วนตัว" ที่เห็นเฉพาะบัญชีของคุณ หากต้องการโพสต์สาธารณะ ให้ส่งแอปขอตรวจสอบกับ TikTok นอกจากนี้การโพสต์ต้องมีไฟล์วิดีโอ
            </Notice>
          </>
        )}
      </Card>
    </div>
  );
};
