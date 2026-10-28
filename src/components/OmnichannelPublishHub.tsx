import React, { useEffect, useState } from 'react';
import {
  Share2,
  Send,
  CalendarClock,
  Settings2,
  CheckCircle2,
  ExternalLink,
  Trash2,
  Sparkles,
  MessageSquareHeart,
  X,
  Webhook,
  KeyRound,
  RefreshCw,
  Globe,
  Mail,
  AlertTriangle,
  Upload,
  Film,
} from 'lucide-react';
import {
  ChannelConfig,
  ChannelKey,
  PublishLog,
  AudienceSurvey,
  Post,
  AiWorkflow,
} from '../types';
import { api, formatThaiDate } from '../api';

interface Props {
  posts: Post[];
  workflows: AiWorkflow[];
  onRefreshAll: () => Promise<void>;
  onOpenPost: (postId: number) => void;
  onOpenSettings?: () => void;
  onTriggerAiFromFeedback: (topic: string, role: string) => Promise<void>;
}

const CHANNEL_STYLE: Record<
  ChannelKey,
  { badgeBg: string; shortIcon: string; hint: string }
> = {
  youtube: {
    badgeBg: 'bg-[#ef4444]',
    shortIcon: '▶',
    hint: 'YouTube Data API v3 (อัปโหลดไฟล์วิดีโอ .MP4 จริงด้วย OAuth2 Bearer Token หรือส่งผ่าน Webhook)',
  },
  facebook: {
    badgeBg: 'bg-[#1877f2]',
    shortIcon: 'f',
    hint: 'Facebook Graph API v21.0 (ใส่ Page ID + Page Access Token เพื่อโพสต์ข้อความ/รูป/วิดีโอจริงทันที)',
  },
  tiktok: {
    badgeBg: 'bg-slate-900',
    shortIcon: '♪',
    hint: 'TikTok Content Posting API v2 (อัปโหลดคลิป .MP4 จริงด้วย User Access Token หรือผ่าน Webhook)',
  },
  line_oa: {
    badgeBg: 'bg-[#06c755]',
    shortIcon: 'LINE',
    hint: 'LINE Messaging API Broadcast (/v2/bot/message/broadcast — ใส่ Channel Access Token ยิงจริงทันที)',
  },
  x_twitter: {
    badgeBg: 'bg-black',
    shortIcon: '𝕏',
    hint: 'X API v2 (/2/tweets — ใส่ OAuth2 User Bearer Token ที่มีสิทธิ์ tweet.write เพื่อโพสต์จริง)',
  },
  instagram: {
    badgeBg: 'bg-gradient-to-tr from-amber-500 via-pink-500 to-purple-600',
    shortIcon: 'IG',
    hint: 'Instagram Graph API (2-Step Media Container + Publish — ใส่ IG Business Account ID + Token + URL รูป/วิดีโอ)',
  },
  website_blog: {
    badgeBg: 'bg-[#0d2546]',
    shortIcon: '🌐',
    hint: 'เชื่อมต่อฐานข้อมูล SQLite เว็บไซต์หลัก คมคิด by KOMKRIT 100% (เผยแพร่ขึ้นหน้าเว็บจริงทันที)',
  },
  email_newsletter: {
    badgeBg: 'bg-sky-600',
    shortIcon: '✉️',
    hint: 'Resend Email API (api.resend.com/emails) ส่งอีเมลจริงถึงสมาชิก Subscribers ทั้งหมดในระบบ',
  },
};

export const OmnichannelPublishHub: React.FC<Props> = ({
  posts,
  workflows,
  onRefreshAll,
  onOpenPost,
  onOpenSettings,
  onTriggerAiFromFeedback,
}) => {
  const [channels, setChannels] = useState<ChannelConfig[]>([]);
  const [logs, setLogs] = useState<PublishLog[]>([]);
  const [surveys, setSurveys] = useState<AudienceSurvey[]>([]);

  // Composer State
  const [selectedSource, setSelectedSource] = useState<string>('custom');
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [coverImage, setCoverImage] = useState('/images/thumb-ai-edu.jpg');
  const [videoUrl, setVideoUrl] = useState('');
  const [uploadingVideo, setUploadingVideo] = useState(false);
  const [selectedChannels, setSelectedChannels] = useState<ChannelKey[]>([
    'website_blog',
  ]);
  const [scheduleMode, setScheduleMode] = useState<'now' | 'schedule'>('now');
  const [scheduledAt, setScheduledAt] = useState('');
  const [dispatching, setDispatching] = useState(false);
  const [dispatchNotice, setDispatchNotice] = useState<{
    ok: boolean;
    text: string;
  } | null>(null);
  const [feedbackError, setFeedbackError] = useState<string | null>(null);

  // Channel Config Modal
  const [editingChannel, setEditingChannel] = useState<ChannelConfig | null>(null);
  const [tokenInput, setTokenInput] = useState('');

  // Survey Add Modal
  const [surveyModalOpen, setSurveyModalOpen] = useState(false);
  const [surveyForm, setSurveyForm] = useState({
    respondentName: '',
    respondentRole: 'ครู / บุคลากรทางการศึกษา',
    schoolOrOrg: '',
    preferredChannel: 'LINE OA',
    requestedTopic: '',
    satisfactionScore: 5,
    feedbackDetail: '',
  });
  const [loopLoadingId, setLoopLoadingId] = useState<number | null>(null);

  const loadHub = async (autoSelectConfigured = false) => {
    const [ch, lg, sv] = await Promise.all([
      api.getChannels(),
      api.getPublishLogs(),
      api.getSurveys(),
    ]);
    setChannels(ch);
    setLogs(lg);
    setSurveys(sv);
    if (autoSelectConfigured) {
      const readyKeys = ch
        .filter(
          (c) =>
            c.channelKey === 'website_blog' ||
            c.hasAccessToken ||
            Boolean(c.webhookUrl)
        )
        .map((c) => c.channelKey);
      if (readyKeys.length > 0) {
        setSelectedChannels(readyKeys);
      }
    }
  };

  useEffect(() => {
    loadHub(true);
  }, []);

  const handleSelectSource = (val: string) => {
    setSelectedSource(val);
    if (val.startsWith('wf:')) {
      const wfId = Number(val.slice(3));
      const wf = workflows.find((w) => w.id === wfId);
      if (wf) {
        setTitle(wf.scriptOutput?.selectedTitle || wf.topic);
        setContent(
          wf.omnichannelOutput?.facebook?.post ||
            wf.scriptOutput?.excerpt ||
            wf.scriptOutput?.fullArticleMarkdown ||
            ''
        );
        setCoverImage(
          wf.visualOutput?.generatedRealImageUrl ||
            wf.visualOutput?.generatedSvgDataUrl ||
            '/images/thumb-ai-edu.jpg'
        );
        setVideoUrl(wf.videoOutput?.generatedVideoUrl || '');
      }
    } else if (val.startsWith('post:')) {
      const pId = Number(val.slice(5));
      const p = posts.find((x) => x.id === pId);
      if (p) {
        setTitle(p.title);
        setContent(`${p.excerpt}\n\n${p.content.slice(0, 600)}`);
        setCoverImage(p.coverImage || '/images/thumb-ai-edu.jpg');
        setVideoUrl(p.videoUrl || '');
      }
    }
  };

  const toggleChannelSelection = (key: ChannelKey) => {
    setSelectedChannels((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]
    );
  };

  const handleUploadBroadcasterVideo = async (
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingVideo(true);
    try {
      const url = await api.uploadFile(file);
      setVideoUrl(url);
    } catch (err) {
      setDispatchNotice({ ok: false, text: (err as Error).message });
    } finally {
      setUploadingVideo(false);
    }
  };

  const handleDispatch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || selectedChannels.length === 0) return;
    setDispatching(true);
    setDispatchNotice(null);
    try {
      const linkedPostId = selectedSource.startsWith('post:')
        ? Number(selectedSource.slice(5))
        : null;
      const linkedWfId = selectedSource.startsWith('wf:')
        ? Number(selectedSource.slice(3))
        : null;

      const res = await api.dispatchOmnichannel({
        channels: selectedChannels,
        title: title.trim(),
        content: content.trim() || title.trim(),
        coverImage,
        videoUrl: videoUrl.trim(),
        postId: linkedPostId,
        workflowId: linkedWfId,
        scheduledAt: scheduleMode === 'schedule' ? scheduledAt : null,
      });

      const publishedCnt = res.dispatched.filter(
        (d: any) => d.status === 'published'
      ).length;
      const failedCnt = res.dispatched.filter(
        (d: any) => d.status === 'failed'
      ).length;

      if (scheduleMode === 'schedule') {
        setDispatchNotice({
          ok: true,
          text: `ตั้งเวลาเผยแพร่ล่วงหน้าครบ ${res.dispatched.length} ช่องทางเรียบร้อยแล้ว!`,
        });
      } else if (failedCnt > 0) {
        setDispatchNotice({
          ok: publishedCnt > 0,
          text: `เผยแพร่จริงสำเร็จ ${publishedCnt} ช่องทาง • ยังไม่สำเร็จ ${failedCnt} ช่องทาง (ดูเหตุผลและตั้งค่า API Token ได้ในประวัติทางขวา)`,
        });
      } else {
        setDispatchNotice({
          ok: true,
          text: `ยิง API เผยแพร่จริงสำเร็จครบทั้ง ${publishedCnt} ช่องทาง!`,
        });
      }
      await loadHub();
      await onRefreshAll();
    } catch (err) {
      setDispatchNotice({ ok: false, text: (err as Error).message });
    } finally {
      setDispatching(false);
    }
  };

  const handleSaveChannelConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingChannel) return;
    await api.updateChannel(editingChannel.channelKey, {
      handleOrUrl: editingChannel.handleOrUrl,
      enabled: editingChannel.enabled,
      autoPublishOnApprove: editingChannel.autoPublishOnApprove,
      targetId: editingChannel.targetId,
      webhookUrl: editingChannel.webhookUrl,
      accessToken: tokenInput.trim() ? tokenInput.trim() : '__KEEP__',
    });
    setEditingChannel(null);
    setTokenInput('');
    await loadHub();
  };

  const handleCreateSurvey = async (e: React.FormEvent) => {
    e.preventDefault();
    await api.submitSurvey(surveyForm);
    setSurveyModalOpen(false);
    setSurveyForm({
      respondentName: '',
      respondentRole: 'ครู / บุคลากรทางการศึกษา',
      schoolOrOrg: '',
      preferredChannel: 'LINE OA',
      requestedTopic: '',
      satisfactionScore: 5,
      feedbackDetail: '',
    });
    await loadHub();
  };

  return (
    <div className="space-y-6">
      {/* HEADER BANNER MATCHING THE RED HIGHLIGHTED BOX IN IMAGE 1 */}
      <div className="rounded-2xl bg-gradient-to-r from-[#0d2546] via-[#173968] to-[#0d2546] p-5 sm:p-6 text-white shadow-md border-2 border-rose-500/80">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-rose-600 px-3 py-0.5 text-[11px] font-extrabold text-white">
              <Share2 className="w-3.5 h-3.5" />
              PUBLISH & DISTRIBUTE • ระบบเผยแพร่สู่ทุกช่องทางอัตโนมัติ (8 CHANNELS)
            </span>
            <h2 className="mt-2 text-xl sm:text-2xl font-extrabold">
              ศูนย์กระจายคอนเทนต์ 8 แพลตฟอร์ม & วงจรเสียงสะท้อนผู้ชม (Audience Feedback Loop)
            </h2>
            <p className="text-xs sm:text-sm text-slate-300 mt-0.5">
              เผยแพร่ทันทีหรือตั้งเวลาล่วงหน้าสู่ YouTube, Facebook, TikTok, LINE OA, X, Instagram, Website/Blog และ Email Newsletter พร้อมรับ Feedback ส่งกลับให้ทีม AI พัฒนาต่อ
            </p>
          </div>
          <button
            onClick={() => setSurveyModalOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-xl bg-amber-400 px-4 py-2.5 text-xs font-extrabold text-[#0b1e38] hover:brightness-105 cursor-pointer shrink-0"
          >
            <MessageSquareHeart className="w-4 h-4" />
            + บันทึกแบบสำรวจผู้เรียน/โรงเรียน
          </button>
        </div>
      </div>

      {/* 8 CHANNELS CONNECTOR GRID (Exact 8 Platforms — 100% Real Status Badges!) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
        {channels.map((ch) => {
          const st = CHANNEL_STYLE[ch.channelKey] || CHANNEL_STYLE.website_blog;
          const isDbLive = ch.channelKey === 'website_blog';
          const statusLabel = isDbLive
            ? '● เชื่อมต่อฐานข้อมูลเว็บจริง'
            : ch.hasAccessToken
            ? '● เชื่อมต่อ Live API Token แล้ว'
            : ch.webhookUrl
            ? '● เชื่อมต่อ Webhook จริงแล้ว'
            : '○ รอใส่ API Token / Webhook';
          const statusColor =
            isDbLive || ch.hasAccessToken
              ? 'text-emerald-700'
              : ch.webhookUrl
              ? 'text-sky-700'
              : 'text-amber-700';

          return (
            <div
              key={ch.channelKey}
              className="rounded-2xl bg-white border border-slate-200/90 p-4 shadow-2xs flex flex-col justify-between"
            >
              <div>
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2.5">
                    <div
                      className={`flex h-9 w-9 items-center justify-center rounded-xl text-white text-xs font-extrabold shadow-xs ${st.badgeBg}`}
                    >
                      {st.shortIcon}
                    </div>
                    <div>
                      <div className="font-extrabold text-sm text-[#0d2546]">
                        {ch.channelName}
                      </div>
                      <div className={`text-[10.5px] font-bold ${statusColor}`}>
                        {statusLabel}
                      </div>
                    </div>
                  </div>
                  <button
                    onClick={() => {
                      setEditingChannel({ ...ch });
                      setTokenInput('');
                    }}
                    className="rounded-lg bg-slate-100 p-1.5 text-slate-600 hover:bg-[#0d2546] hover:text-white transition cursor-pointer"
                    title="ตั้งค่า API Token / Webhook จริง"
                  >
                    <Settings2 className="w-4 h-4" />
                  </button>
                </div>
                <p className="mt-2.5 text-[11px] text-slate-500 line-clamp-2">
                  {st.hint}
                </p>
              </div>

              <div className="mt-3 pt-2.5 border-t border-slate-100 flex items-center justify-between text-[11px]">
                <span className="truncate text-slate-400 max-w-[150px]">
                  {ch.handleOrUrl || 'พร้อมเชื่อมต่อ'}
                </span>
                <span
                  className={`font-bold ${
                    ch.enabled ? 'text-[#0d2546]' : 'text-slate-400'
                  }`}
                >
                  {ch.enabled ? 'เปิดใช้งาน' : 'ปิดไว้'}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {/* OMNICHANNEL COMPOSER & SCHEDULER + PUBLISH LOGS */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
        {/* Left: Broadcaster Form */}
        <form
          onSubmit={handleDispatch}
          className="lg:col-span-6 rounded-2xl bg-white border border-slate-200 p-5 shadow-2xs space-y-4"
        >
          <div className="flex items-center justify-between">
            <h3 className="text-base font-extrabold text-[#0d2546] flex items-center gap-2">
              <Send className="w-4 h-4 text-rose-600" />
              กระจายคอนเทนต์สู่ทุกช่องทาง (Omnichannel Broadcaster)
            </h3>
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">
              ดึงเนื้อหาจากแคมเปญ AI หรือโพสต์ที่มีอยู่ (หรือพิมพ์ใหม่ด้านล่าง)
            </label>
            <select
              value={selectedSource}
              onChange={(e) => handleSelectSource(e.target.value)}
              className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2 text-xs font-semibold focus:border-[#f59e0b] focus:outline-none"
            >
              <option value="custom">-- พิมพ์ข้อความประกาศ/คอนเทนต์ใหม่ด้วยตนเอง --</option>
              <optgroup label="แคมเปญจากทีม AI Multi-Agent">
                {workflows.map((w) => (
                  <option key={`wf:${w.id}`} value={`wf:${w.id}`}>
                    🤖 [AI Campaign] {w.scriptOutput?.selectedTitle || w.topic}
                  </option>
                ))}
              </optgroup>
              <optgroup label="บทความและข่าวสารในระบบ CRUD">
                {posts.map((p) => (
                  <option key={`post:${p.id}`} value={`post:${p.id}`}>
                    📄 [Post #{p.id}] {p.title}
                  </option>
                ))}
              </optgroup>
            </select>
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">
              หัวข้อหลักสำหรับการเผยแพร่ *
            </label>
            <input
              type="text"
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="เช่น สรุป 5 แนวทางพัฒนาการศึกษายุค AI โดย คมคิด by KOMKRIT"
              className="w-full rounded-xl border border-slate-200 px-3.5 py-2 text-sm font-semibold focus:border-[#f59e0b] focus:outline-none"
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">
              เนื้อหา / แคปชัน / ข้อความ Broadcast *
            </label>
            <textarea
              rows={4}
              required
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="รายละเอียดเนื้อหา ลิงก์ หรือข้อคิดสำคัญ..."
              className="w-full rounded-xl border border-slate-200 px-3.5 py-2 text-sm font-body focus:border-[#f59e0b] focus:outline-none"
            />
          </div>

          {/* Optional Video File (.MP4 for YouTube / TikTok / Facebook / IG) */}
          <div className="rounded-xl bg-slate-50 border border-slate-200 p-3 space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-[11px] font-extrabold text-[#0d2546] flex items-center gap-1">
                <Film className="w-3.5 h-3.5 text-purple-600" />
                ไฟล์วิดีโอ .MP4 แนบโพสต์ (สำหรับ YouTube / TikTok / Facebook / Website)
              </label>
              <label className="inline-flex items-center gap-1 text-[11px] font-bold text-sky-700 hover:underline cursor-pointer">
                <Upload className="w-3 h-3" />
                {uploadingVideo ? 'อัปโหลด...' : 'อัปโหลด .MP4'}
                <input
                  type="file"
                  accept="video/*"
                  onChange={handleUploadBroadcasterVideo}
                  className="hidden"
                />
              </label>
            </div>
            <input
              type="text"
              value={videoUrl}
              onChange={(e) => setVideoUrl(e.target.value)}
              placeholder="/uploads/videos/... หรือ URL ไฟล์วิดีโอ .mp4 (ไม่บังคับ)"
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs"
            />
          </div>

          {/* Select Target Channels */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs font-extrabold text-[#0d2546]">
                เลือกช่องทางที่ต้องการเผยแพร่ ({selectedChannels.length}/8 ช่องทาง)
              </label>
              <button
                type="button"
                onClick={() =>
                  setSelectedChannels(
                    selectedChannels.length === 8
                      ? []
                      : (channels.map((c) => c.channelKey) as ChannelKey[])
                  )
                }
                className="text-[11px] font-bold text-[#d97706] hover:underline cursor-pointer"
              >
                {selectedChannels.length === 8 ? 'ยกเลิกทั้งหมด' : 'เลือกครบทั้ง 8 ช่องทาง'}
              </button>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {channels.map((ch) => {
                const checked = selectedChannels.includes(ch.channelKey);
                const st = CHANNEL_STYLE[ch.channelKey];
                return (
                  <button
                    key={ch.channelKey}
                    type="button"
                    onClick={() => toggleChannelSelection(ch.channelKey)}
                    className={`flex items-center gap-2 rounded-xl border px-2.5 py-2 text-left text-xs font-bold transition cursor-pointer ${
                      checked
                        ? 'border-[#0d2546] bg-[#0d2546]/5 text-[#0d2546]'
                        : 'border-slate-200 text-slate-400 opacity-70'
                    }`}
                  >
                    <span
                      className={`flex h-5 w-5 shrink-0 items-center justify-center rounded text-[9px] font-extrabold text-white ${st.badgeBg}`}
                    >
                      {checked ? '✓' : st.shortIcon.slice(0, 2)}
                    </span>
                    <span className="truncate">{ch.channelName}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Publish Now vs Schedule */}
          <div className="rounded-xl bg-slate-50 border border-slate-200 p-3 space-y-2.5">
            <div className="flex items-center gap-4 text-xs font-bold">
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input
                  type="radio"
                  checked={scheduleMode === 'now'}
                  onChange={() => setScheduleMode('now')}
                  className="accent-[#0d2546]"
                />
                เผยแพร่ทันที (Publish Now)
              </label>
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input
                  type="radio"
                  checked={scheduleMode === 'schedule'}
                  onChange={() => setScheduleMode('schedule')}
                  className="accent-[#0d2546]"
                />
                <CalendarClock className="w-3.5 h-3.5 text-amber-600" />
                ตั้งเวลาเผยแพร่ล่วงหน้า
              </label>
            </div>
            {scheduleMode === 'schedule' && (
              <input
                type="datetime-local"
                required
                value={scheduledAt}
                onChange={(e) => setScheduledAt(e.target.value)}
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs"
              />
            )}
          </div>

          {dispatchNotice && (
            <div
              className={`rounded-xl px-4 py-2.5 text-xs font-bold flex items-center gap-2 ${
                dispatchNotice.ok
                  ? 'bg-emerald-50 border border-emerald-200 text-emerald-900'
                  : 'bg-amber-50 border border-amber-200 text-amber-950'
              }`}
            >
              {dispatchNotice.ok ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
              ) : (
                <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
              )}
              <span>{dispatchNotice.text}</span>
            </div>
          )}

          <button
            type="submit"
            disabled={dispatching || selectedChannels.length === 0}
            className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-rose-600 to-[#e88d14] py-3 text-sm font-extrabold text-white shadow-sm hover:brightness-105 transition cursor-pointer disabled:opacity-50"
          >
            <Send className="w-4 h-4" />
            {dispatching
              ? 'กำลังยิง API เผยแพร่จริง...'
              : scheduleMode === 'schedule'
              ? `บันทึกคิวตั้งเวลาเผยแพร่จริง (${selectedChannels.length} ช่องทาง)`
              : `ยิง API เผยแพร่จริงสู่ ${selectedChannels.length} ช่องทางทันที`}
          </button>
        </form>

        {/* Right: Distribution History & Queue Logs */}
        <div className="lg:col-span-6 rounded-2xl bg-white border border-slate-200 p-5 shadow-2xs space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-base font-extrabold text-[#0d2546]">
              ประวัติการยิง API เผยแพร่จริง & คิวตั้งเวลา ({logs.length})
            </h3>
            <button
              onClick={() => loadHub()}
              className="text-xs font-bold text-slate-500 hover:text-[#0d2546] inline-flex items-center gap-1 cursor-pointer"
            >
              <RefreshCw className="w-3.5 h-3.5" /> รีเฟรช
            </button>
          </div>

          <div className="space-y-2.5 max-h-[500px] overflow-y-auto pr-1">
            {logs.length === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-200 p-8 text-center text-xs text-slate-400">
                ยังไม่มีประวัติการเผยแพร่ — เลือกช่องทางด้านซ้ายแล้วกดยิง API จริงได้เลยครับ
              </div>
            ) : (
              logs.map((log) => {
                const st =
                  CHANNEL_STYLE[log.channelKey] || CHANNEL_STYLE.website_blog;
                return (
                  <div
                    key={log.id}
                    className={`rounded-xl border p-3 text-xs ${
                      log.status === 'failed'
                        ? 'border-rose-200 bg-rose-50/40'
                        : 'border-slate-200/80 bg-slate-50/50'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span
                          className={`rounded-md px-2 py-0.5 text-[10.5px] font-extrabold text-white ${st.badgeBg}`}
                        >
                          {log.channelName}
                        </span>
                        <span
                          className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                            log.status === 'scheduled'
                              ? 'bg-amber-100 text-amber-900'
                              : log.status === 'failed'
                              ? 'bg-rose-100 text-rose-900'
                              : 'bg-emerald-100 text-emerald-900'
                          }`}
                        >
                          {log.status === 'scheduled'
                            ? `⏰ ตั้งเวลา: ${log.scheduledAt}`
                            : log.status === 'failed'
                            ? '✗ ยังไม่สำเร็จ / รอตั้งค่าคีย์'
                            : `✓ เผยแพร่จริงสำเร็จ (${log.mode})`}
                        </span>
                      </div>
                      <button
                        onClick={async () => {
                          await api.deletePublishLog(log.id);
                          await loadHub();
                        }}
                        className="text-slate-300 hover:text-rose-600 cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                    <div className="mt-1.5 font-extrabold text-[#0d2546]">
                      {log.title}
                    </div>
                    <p
                      className={`mt-0.5 text-[11px] ${
                        log.status === 'failed'
                          ? 'text-rose-700 font-medium'
                          : 'text-slate-600'
                      }`}
                    >
                      {log.responseNote}
                    </p>
                    <div className="mt-1.5 flex items-center justify-between text-[10.5px] text-slate-400">
                      <span>{formatThaiDate(log.createdAt)}</span>
                      <div className="flex items-center gap-2">
                        {log.postId && (
                          <button
                            onClick={() => onOpenPost(log.postId!)}
                            className="font-bold text-[#0d2546] hover:underline inline-flex items-center gap-0.5 cursor-pointer"
                          >
                            <Globe className="w-3 h-3" /> เปิดดูโพสต์บนเว็บ
                          </button>
                        )}
                        {log.externalUrl && log.externalUrl.startsWith('http') && (
                          <a
                            href={log.externalUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="font-bold text-sky-700 hover:underline inline-flex items-center gap-0.5"
                          >
                            <ExternalLink className="w-3 h-3" /> เปิดลิงก์ช่องทางจริง
                          </a>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>

      {/* CLOSED-LOOP AUDIENCE FEEDBACK & SCHOOL SURVEYS -> 08 ANALYTICS -> CEO AGENT */}
      <div className="rounded-2xl bg-white border border-slate-200 p-5 shadow-2xs space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <span className="rounded-full bg-purple-100 px-3 py-0.5 text-[10.5px] font-extrabold text-purple-900">
              AUDIENCE FEEDBACK → 08 ANALYTICS AGENT → CEO AGENT
            </span>
            <h3 className="mt-1 text-lg font-extrabold text-[#0d2546]">
              เสียงสะท้อน แบบสำรวจ และการตอบรับจากผู้เรียน / ครู / โรงเรียน ({surveys.length})
            </h3>
            <p className="text-xs text-slate-500">
              คลิกปุ่ม <strong>"ส่งโจทย์ให้ CEO Agent สร้างคอนเทนต์"</strong> เพื่อหมุนวงจร Feedback กลับไปสร้างบทความและสื่อการสอนใหม่อัตโนมัติ
            </p>
          </div>
          <button
            onClick={() => setSurveyModalOpen(true)}
            className="rounded-xl bg-[#0d2546] px-4 py-2 text-xs font-extrabold text-white hover:bg-[#193d6e] cursor-pointer"
          >
            + เพิ่มข้อมูลแบบสำรวจผู้เรียน
          </button>
        </div>

        {feedbackError && (
          <div className="rounded-xl bg-rose-50 border border-rose-200 p-3 text-xs text-rose-900 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
              <span className="font-semibold">{feedbackError}</span>
            </div>
            {onOpenSettings && (
              <button
                type="button"
                onClick={onOpenSettings}
                className="inline-flex items-center gap-1 rounded-lg bg-[#0d2546] px-3 py-1.5 text-[11px] font-extrabold text-amber-300 hover:bg-[#193d6e] cursor-pointer"
              >
                <KeyRound className="w-3.5 h-3.5" /> ไปตั้งค่า API Keys
              </button>
            )}
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {surveys.map((sv) => (
            <div
              key={sv.id}
              className="rounded-xl border border-purple-200/80 bg-purple-50/30 p-4 flex flex-col justify-between gap-3"
            >
              <div>
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <span className="font-extrabold text-sm text-[#0d2546]">
                      {sv.respondentName}
                    </span>
                    <span className="ml-2 rounded-full bg-purple-100 px-2.5 py-0.5 text-[10.5px] font-bold text-purple-900">
                      {sv.respondentRole}
                    </span>
                  </div>
                  <span className="text-xs font-extrabold text-amber-600">
                    ★ {sv.satisfactionScore}/5
                  </span>
                </div>
                {sv.schoolOrOrg && (
                  <div className="text-[11px] text-slate-500 mt-0.5">
                    สังกัด/โรงเรียน: {sv.schoolOrOrg} • ช่องทางที่ติดตาม: {sv.preferredChannel}
                  </div>
                )}
                <div className="mt-2 rounded-lg bg-white p-2.5 border border-purple-100">
                  <div className="text-[10.5px] font-extrabold text-purple-900">
                    โจทย์/หัวข้อที่ผู้เรียนและโรงเรียนอยากให้ผลิตเพิ่ม:
                  </div>
                  <div className="text-xs font-bold text-[#0d2546] mt-0.5">
                    “{sv.requestedTopic}”
                  </div>
                </div>
                {sv.feedbackDetail && (
                  <p className="mt-2 text-xs text-slate-600 font-body">
                    ข้อเสนอแนะ: {sv.feedbackDetail}
                  </p>
                )}
              </div>

              <div className="flex items-center justify-between gap-2 pt-2 border-t border-purple-100">
                <button
                  disabled={loopLoadingId === sv.id}
                  onClick={async () => {
                    setLoopLoadingId(sv.id);
                    setFeedbackError(null);
                    try {
                      await onTriggerAiFromFeedback(
                        sv.requestedTopic,
                        sv.respondentRole
                      );
                    } catch (err) {
                      setFeedbackError((err as Error).message);
                    } finally {
                      setLoopLoadingId(null);
                    }
                  }}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-[#0d2546] to-purple-900 px-3.5 py-2 text-xs font-extrabold text-amber-300 hover:brightness-110 transition cursor-pointer disabled:opacity-50"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  {loopLoadingId === sv.id
                    ? 'กำลังสั่งงานทีม AI...'
                    : 'ส่งโจทย์ให้ CEO Agent สร้างคอนเทนต์ทันที'}
                </button>
                <button
                  onClick={async () => {
                    await api.deleteSurvey(sv.id);
                    await loadHub();
                  }}
                  className="p-1.5 text-slate-400 hover:text-rose-600 cursor-pointer"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* CHANNEL API & WEBHOOK SETTINGS MODAL */}
      {editingChannel && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4"
          onClick={() => setEditingChannel(null)}
        >
          <div
            className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h3 className="font-extrabold text-lg text-[#0d2546]">
                ตั้งค่าการเชื่อมต่อช่องทาง: {editingChannel.channelName}
              </h3>
              <button
                onClick={() => setEditingChannel(null)}
                className="p-1 text-slate-400 hover:text-slate-700 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveChannelConfig} className="space-y-3">
              <div>
                <label className="block text-xs font-bold mb-1">
                  ชื่อบัญชี / URL ช่องทาง (Handle / Page URL)
                </label>
                <input
                  type="text"
                  value={editingChannel.handleOrUrl}
                  onChange={(e) =>
                    setEditingChannel({
                      ...editingChannel,
                      handleOrUrl: e.target.value,
                    })
                  }
                  className="w-full rounded-xl border border-slate-200 px-3.5 py-2 text-sm"
                />
              </div>

              <div>
                <label className="block text-xs font-bold mb-1">
                  Page ID / Channel ID / Business Account ID (สำหรับ Facebook / IG / YouTube)
                </label>
                <input
                  type="text"
                  value={editingChannel.targetId}
                  onChange={(e) =>
                    setEditingChannel({
                      ...editingChannel,
                      targetId: e.target.value,
                    })
                  }
                  placeholder="เช่น Facebook Page ID..."
                  className="w-full rounded-xl border border-slate-200 px-3.5 py-2 text-sm"
                />
              </div>

              <div>
                <label className="block text-xs font-bold mb-1 flex items-center gap-1">
                  <KeyRound className="w-3.5 h-3.5 text-amber-600" />
                  API Access Token (เช่น LINE Channel Access Token / FB Page Token)
                </label>
                <input
                  type="password"
                  value={tokenInput}
                  onChange={(e) => setTokenInput(e.target.value)}
                  placeholder={
                    editingChannel.hasAccessToken
                      ? `บันทึกไว้แล้ว (${editingChannel.accessTokenMasked}) เว้นว่างหากไม่เปลี่ยน`
                      : 'วาง Access Token เพื่อยิง API จริง (ไม่บังคับ)'
                  }
                  className="w-full rounded-xl border border-slate-200 px-3.5 py-2 text-sm"
                />
              </div>

              <div>
                <label className="block text-xs font-bold mb-1 flex items-center gap-1">
                  <Webhook className="w-3.5 h-3.5 text-sky-600" />
                  Automation Webhook URL (รองรับ n8n / Make.com / Zapier)
                </label>
                <input
                  type="text"
                  value={editingChannel.webhookUrl}
                  onChange={(e) =>
                    setEditingChannel({
                      ...editingChannel,
                      webhookUrl: e.target.value,
                    })
                  }
                  placeholder="https://hook.make.com/... หรือ https://n8n.../webhook/..."
                  className="w-full rounded-xl border border-slate-200 px-3.5 py-2 text-sm"
                />
              </div>

              <label className="flex items-center gap-2 text-xs font-bold text-[#0d2546] pt-1 cursor-pointer">
                <input
                  type="checkbox"
                  checked={editingChannel.enabled}
                  onChange={(e) =>
                    setEditingChannel({
                      ...editingChannel,
                      enabled: e.target.checked,
                    })
                  }
                  className="accent-[#0d2546]"
                />
                เปิดใช้งานช่องทางนี้ในระบบกระจายคอนเทนต์อัตโนมัติ
              </label>

              <div className="pt-3 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setEditingChannel(null)}
                  className="rounded-xl border border-slate-200 px-4 py-2 text-xs font-bold"
                >
                  ยกเลิก
                </button>
                <button
                  type="submit"
                  className="rounded-xl bg-[#0d2546] px-5 py-2 text-xs font-extrabold text-white cursor-pointer"
                >
                  บันทึกการเชื่อมต่อ
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* SURVEY MODAL */}
      {surveyModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4"
          onClick={() => setSurveyModalOpen(false)}
        >
          <div
            className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl space-y-3"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h3 className="font-extrabold text-lg text-[#0d2546]">
                แบบสำรวจความต้องการผู้เรียน / ครู / โรงเรียน
              </h3>
              <button
                onClick={() => setSurveyModalOpen(false)}
                className="p-1 text-slate-400 hover:text-slate-700 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleCreateSurvey} className="space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <input
                  type="text"
                  required
                  value={surveyForm.respondentName}
                  onChange={(e) =>
                    setSurveyForm({ ...surveyForm, respondentName: e.target.value })
                  }
                  placeholder="ชื่อผู้ตอบแบบสำรวจ *"
                  className="rounded-xl border border-slate-200 px-3.5 py-2 text-sm"
                />
                <select
                  value={surveyForm.respondentRole}
                  onChange={(e) =>
                    setSurveyForm({ ...surveyForm, respondentRole: e.target.value })
                  }
                  className="rounded-xl border border-slate-200 px-3.5 py-2 text-sm"
                >
                  <option value="ครู / บุคลากรทางการศึกษา">ครู / บุคลากรทางการศึกษา</option>
                  <option value="นักเรียน / นักศึกษา">นักเรียน / นักศึกษา</option>
                  <option value="ผู้ปกครอง">ผู้ปกครอง</option>
                  <option value="ผู้บริหารโรงเรียน">ผู้บริหารโรงเรียน</option>
                  <option value="ผู้สนใจทั่วไป">ผู้สนใจทั่วไป</option>
                </select>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <input
                  type="text"
                  value={surveyForm.schoolOrOrg}
                  onChange={(e) =>
                    setSurveyForm({ ...surveyForm, schoolOrOrg: e.target.value })
                  }
                  placeholder="ชื่อโรงเรียน / หน่วยงาน"
                  className="rounded-xl border border-slate-200 px-3.5 py-2 text-sm"
                />
                <select
                  value={surveyForm.preferredChannel}
                  onChange={(e) =>
                    setSurveyForm({
                      ...surveyForm,
                      preferredChannel: e.target.value,
                    })
                  }
                  className="rounded-xl border border-slate-200 px-3.5 py-2 text-sm"
                >
                  <option>LINE OA</option>
                  <option>YouTube</option>
                  <option>Facebook</option>
                  <option>TikTok</option>
                  <option>Website / Blog</option>
                  <option>Email / Newsletter</option>
                </select>
              </div>
              <input
                type="text"
                required
                value={surveyForm.requestedTopic}
                onChange={(e) =>
                  setSurveyForm({ ...surveyForm, requestedTopic: e.target.value })
                }
                placeholder="หัวข้อความรู้หรือปัญหาที่อยากให้ คมคิด นำเสนอ *"
                className="w-full rounded-xl border border-slate-200 px-3.5 py-2 text-sm font-semibold"
              />
              <textarea
                rows={3}
                value={surveyForm.feedbackDetail}
                onChange={(e) =>
                  setSurveyForm({ ...surveyForm, feedbackDetail: e.target.value })
                }
                placeholder="ข้อเสนอแนะเพิ่มเติม..."
                className="w-full rounded-xl border border-slate-200 px-3.5 py-2 text-sm"
              />
              <div className="pt-2 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setSurveyModalOpen(false)}
                  className="rounded-xl border border-slate-200 px-4 py-2 text-xs font-bold"
                >
                  ยกเลิก
                </button>
                <button
                  type="submit"
                  className="rounded-xl bg-[#0d2546] px-5 py-2 text-xs font-extrabold text-white cursor-pointer"
                >
                  บันทึกแบบสำรวจ
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
