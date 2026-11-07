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
  Edit3,
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
    badgeBg: 'bg-slate-900',
    shortIcon: 'YT',
    hint: 'YouTube Data API v3 (อัปโหลดไฟล์วิดีโอ .MP4 ด้วย OAuth2 Bearer Token หรือส่งผ่าน Webhook)',
  },
  facebook: {
    badgeBg: 'bg-slate-900',
    shortIcon: 'FB',
    hint: 'Facebook Graph API v21.0 (กำหนด Page ID + Page Access Token เพื่อเผยแพร่ข้อความ รูปภาพ หรือวิดีโอ)',
  },
  tiktok: {
    badgeBg: 'bg-slate-900',
    shortIcon: 'TT',
    hint: 'TikTok Content Posting API v2 (อัปโหลดคลิป .MP4 ด้วย User Access Token หรือผ่าน Webhook)',
  },
  line_oa: {
    badgeBg: 'bg-slate-900',
    shortIcon: 'LINE',
    hint: 'LINE Messaging API Broadcast (/v2/bot/message/broadcast — ระบุ Channel Access Token)',
  },
  x_twitter: {
    badgeBg: 'bg-slate-900',
    shortIcon: 'X',
    hint: 'X API v2 (/2/tweets — ระบุ OAuth2 User Bearer Token ที่มีสิทธิ์ tweet.write)',
  },
  instagram: {
    badgeBg: 'bg-slate-900',
    shortIcon: 'IG',
    hint: 'Instagram Graph API (ระบุ IG Business Account ID + Access Token)',
  },
  website_blog: {
    badgeBg: 'bg-slate-900',
    shortIcon: 'WEB',
    hint: 'เชื่อมต่อฐานข้อมูลเว็บไซต์หลัก (คมคิด by KOMKRIT) โดยตรง',
  },
  email_newsletter: {
    badgeBg: 'bg-slate-900',
    shortIcon: 'MAIL',
    hint: 'ส่งจดหมายข่าวไปยังฐานข้อมูลสมาชิกทางอีเมลผ่าน SMTP / Webhook',
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
  const [loading, setLoading] = useState(true);

  const [selectedSource, setSelectedSource] = useState<string>('');
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [coverImage, setCoverImage] = useState('/images/thumb-ai-edu.jpg');
  const [videoUrl, setVideoUrl] = useState('');
  const [selectedChannels, setSelectedChannels] = useState<ChannelKey[]>([
    'website_blog',
    'facebook',
    'youtube',
    'line_oa',
  ]);
  const [scheduleMode, setScheduleMode] = useState<'now' | 'schedule'>('now');
  const [scheduledAt, setScheduledAt] = useState(
    new Date(Date.now() + 3600 * 1000).toISOString().slice(0, 16)
  );
  const [dispatching, setDispatching] = useState(false);
  const [uploadingVideo, setUploadingVideo] = useState(false);
  const [dispatchNotice, setDispatchNotice] = useState<{
    ok: boolean;
    text: string;
  } | null>(null);

  const [editingChannel, setEditingChannel] = useState<ChannelConfig | null>(
    null
  );
  const [tokenInput, setTokenInput] = useState('');
  const [testingChannelKey, setTestingChannelKey] =
    useState<ChannelKey | null>(null);
  const [channelTestMsg, setChannelTestMsg] = useState<{
    ok: boolean;
    text: string;
  } | null>(null);

  const [surveyModalOpen, setSurveyModalOpen] = useState(false);
  const [editingSurveyId, setEditingSurveyId] = useState<number | null>(null);
  const [confirmDeleteSurveyId, setConfirmDeleteSurveyId] = useState<
    number | null
  >(null);
  const [triggeringTopic, setTriggeringTopic] = useState<string | null>(null);
  const [surveyForm, setSurveyForm] = useState({
    respondentName: '',
    respondentRole: 'ครู / บุคลากรทางการศึกษา',
    schoolOrOrg: '',
    preferredChannel: 'LINE OA',
    requestedTopic: '',
    satisfactionScore: 5,
    feedbackDetail: '',
  });

  const loadHub = async () => {
    setLoading(true);
    try {
      const [ch, lg, sv] = await Promise.all([
        api.getChannels(),
        api.getPublishLogs(),
        api.getSurveys(),
      ]);
      setChannels(ch);
      setLogs(lg);
      setSurveys(sv);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadHub();
  }, []);

  const handleSelectSource = (val: string) => {
    setSelectedSource(val);
    if (val.startsWith('post:')) {
      const id = Number(val.slice(5));
      const p = posts.find((x) => x.id === id);
      if (p) {
        setTitle(p.title);
        setContent(p.excerpt + '\n\n' + p.content.slice(0, 600));
        setCoverImage(p.coverImage);
        setVideoUrl(p.videoUrl || '');
      }
    } else if (val.startsWith('wf:')) {
      const id = Number(val.slice(3));
      const w = workflows.find((x) => x.id === id);
      if (w) {
        setTitle(w.scriptOutput?.headlines?.[0] || w.topic);
        setContent(
          w.publishingOutput?.facebookPost || w.scriptOutput?.hook || w.topic
        );
        setCoverImage(
          w.visualOutput?.generatedRealImageUrl ||
            w.visualOutput?.suggestedCoverImage ||
            '/images/thumb-ai-edu.jpg'
        );
        setVideoUrl(w.videoOutput?.generatedVideoUrl || '');
      }
    }
  };

  const handleUploadBroadcasterVideo = async (
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingVideo(true);
    setDispatchNotice(null);
    try {
      const url = await api.uploadVideo(file);
      setVideoUrl(url);
      setDispatchNotice({
        ok: true,
        text: `อัปโหลดไฟล์วิดีโอ (${url}) เรียบร้อยแล้ว`,
      });
    } catch (err) {
      setDispatchNotice({ ok: false, text: (err as Error).message });
    } finally {
      setUploadingVideo(false);
    }
  };

  const toggleSelectChannel = (key: ChannelKey) => {
    setSelectedChannels((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]
    );
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
          text: `บันทึกตารางเวลาเผยแพร่ล่วงหน้าจำนวน ${res.dispatched.length} ช่องทางเรียบร้อยแล้ว`,
        });
      } else if (failedCnt > 0) {
        setDispatchNotice({
          ok: publishedCnt > 0,
          text: `เผยแพร่สำเร็จ ${publishedCnt} ช่องทาง • ไม่สำเร็จ ${failedCnt} ช่องทาง (กรุณาตรวจสอบผลการส่งด้านขวา)`,
        });
      } else {
        setDispatchNotice({
          ok: true,
          text: `เผยแพร่เนื้อหาสำเร็จครบทั้ง ${publishedCnt} ช่องทาง`,
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

  const openEditSurvey = (sv: AudienceSurvey) => {
    setEditingSurveyId(sv.id);
    setSurveyForm({
      respondentName: sv.respondentName,
      respondentRole: sv.respondentRole,
      schoolOrOrg: sv.schoolOrOrg || '',
      preferredChannel: sv.preferredChannel || 'LINE OA',
      requestedTopic: sv.requestedTopic,
      satisfactionScore: sv.satisfactionScore || 5,
      feedbackDetail: sv.feedbackDetail || '',
    });
    setSurveyModalOpen(true);
  };

  const handleCreateSurvey = async (e: React.FormEvent) => {
    e.preventDefault();
    if (editingSurveyId) {
      await api.updateSurvey(editingSurveyId, surveyForm);
    } else {
      await api.createSurvey(surveyForm);
    }
    setSurveyModalOpen(false);
    setEditingSurveyId(null);
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
    await onRefreshAll();
  };

  const handleAiProduceFromSurvey = async (sv: AudienceSurvey) => {
    setTriggeringTopic(sv.requestedTopic);
    try {
      await onTriggerAiFromFeedback(sv.requestedTopic, sv.respondentRole);
    } finally {
      setTriggeringTopic(null);
    }
  };

  const connectedChannelsCount = channels.filter(
    (c) =>
      c.channelKey === 'website_blog' ||
      c.hasAccessToken ||
      Boolean(c.webhookUrl)
  ).length;

  return (
    <div className="space-y-5">
      {/* Header Summary Card */}
      <div className="rounded-lg bg-white border border-slate-200 p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 shadow-2xs">
        <div>
          <h2 className="text-sm sm:text-base font-bold text-slate-900">
            ระบบบริหารช่องทางเผยแพร่ (Omnichannel Publishing)
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            เชื่อมต่อ API ช่องทางโซเชียลมีเดีย กระจายข่าวสารพร้อมกัน และติดตามประวัติการส่งข้อมูล
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3 text-xs">
          <div className="rounded-md bg-slate-50 border border-slate-200 px-3 py-1.5">
            พร้อมเชื่อมต่อ API:{' '}
            <strong className="text-slate-900">
              {connectedChannelsCount} / {channels.length}
            </strong>{' '}
            ช่องทาง
          </div>
          <div className="rounded-md bg-slate-50 border border-slate-200 px-3 py-1.5">
            เผยแพร่สำเร็จสะสม:{' '}
            <strong className="text-emerald-700">
              {logs.filter((l) => l.status === 'published').length}
            </strong>{' '}
            รายการ
          </div>
        </div>
      </div>

      {/* 8-Channel Configuration Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
        {channels.map((ch) => {
          const st =
            CHANNEL_STYLE[ch.channelKey] || CHANNEL_STYLE.website_blog;
          const isReady =
            ch.channelKey === 'website_blog' ||
            ch.hasAccessToken ||
            Boolean(ch.webhookUrl);

          const statusLabel =
            ch.channelKey === 'website_blog'
              ? 'เชื่อมต่อฐานข้อมูลหลัก'
              : ch.hasAccessToken
              ? `ตั้งค่า API Token แล้ว (${ch.accessTokenMasked})`
              : ch.webhookUrl
              ? 'เชื่อมต่อ Webhook แล้ว'
              : 'ยังไม่ได้ตั้งค่า Token';

          return (
            <div
              key={ch.id}
              className={`rounded-lg bg-white border p-4 shadow-2xs flex flex-col justify-between transition ${
                ch.enabled
                  ? 'border-slate-200'
                  : 'border-slate-200 bg-slate-50 opacity-70'
              }`}
            >
              <div>
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div
                      className={`flex h-8 w-8 items-center justify-center rounded-md text-white text-[11px] font-bold shrink-0 ${st.badgeBg}`}
                    >
                      {st.shortIcon}
                    </div>
                    <div className="min-w-0">
                      <div className="font-bold text-xs text-slate-900 truncate">
                        {ch.channelName}
                      </div>
                      <div
                        className={`text-[11px] font-medium truncate ${
                          isReady ? 'text-emerald-700' : 'text-amber-700'
                        }`}
                      >
                        {statusLabel}
                      </div>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setEditingChannel({ ...ch });
                      setTokenInput('');
                    }}
                    className="rounded border border-slate-200 bg-white p-1.5 text-slate-600 hover:bg-slate-50 transition cursor-pointer shrink-0"
                    title="ตั้งค่าการเชื่อมต่อ"
                  >
                    <Settings2 className="w-3.5 h-3.5" />
                  </button>
                </div>
                <p className="mt-2.5 text-[11px] text-slate-500 line-clamp-2">
                  {st.hint}
                </p>
              </div>

              <div className="mt-3 pt-2.5 border-t border-slate-100 flex items-center justify-between text-[11px]">
                <span className="truncate text-slate-400 max-w-[140px]">
                  {ch.handleOrUrl || 'พร้อมเชื่อมต่อ'}
                </span>
                <span
                  className={`font-semibold ${
                    ch.enabled ? 'text-slate-900' : 'text-slate-400'
                  }`}
                >
                  {ch.enabled ? 'เปิดใช้งาน' : 'ปิดไว้'}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Broadcaster Form & Dispatch History */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
        <form
          onSubmit={handleDispatch}
          className="lg:col-span-6 rounded-lg bg-white border border-slate-200 p-5 shadow-2xs space-y-4"
        >
          <div className="border-b border-slate-100 pb-3">
            <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
              <Send className="w-4 h-4 text-slate-700" />
              ส่งเนื้อหาออกสู่หลายช่องทาง (Omnichannel Broadcaster)
            </h3>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              ดึงข้อมูลจากเนื้อหาที่มีอยู่หรือแคมเปญ AI
            </label>
            <select
              value={selectedSource}
              onChange={(e) => handleSelectSource(e.target.value)}
              className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-800 focus:border-slate-900 focus:outline-none"
            >
              <option value="">-- กำหนดเนื้อหาเองด้านล่าง หรือเลือกจากรายการ --</option>
              <optgroup label="แคมเปญจากระบบเวิร์กโฟลว์ AI">
                {workflows.map((w) => (
                  <option key={`wf:${w.id}`} value={`wf:${w.id}`}>
                    [AI #{w.id}] {w.topic}
                  </option>
                ))}
              </optgroup>
              <optgroup label="เนื้อหาบนเว็บไซต์">
                {posts.map((p) => (
                  <option key={`post:${p.id}`} value={`post:${p.id}`}>
                    [Post #{p.id}] {p.title}
                  </option>
                ))}
              </optgroup>
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              หัวข้อ / พาดหัวหลัก <span className="text-rose-600">*</span>
            </label>
            <input
              type="text"
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="ระบุหัวข้อที่ต้องการเผยแพร่"
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-xs sm:text-sm focus:border-slate-900 focus:outline-none"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              เนื้อหาแคปชัน / ข้อความประชาสัมพันธ์
            </label>
            <textarea
              rows={4}
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="พิมพ์เนื้อหาที่ต้องการส่งออกไปยังช่องทางที่เลือก..."
              className="w-full rounded-md border border-slate-300 p-3 text-xs sm:text-sm focus:border-slate-900 focus:outline-none"
            />
          </div>

          {/* Video Attachment */}
          <div className="rounded-md bg-slate-50 border border-slate-200 p-3.5 space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <label className="text-xs font-semibold text-slate-700 flex items-center gap-1.5">
                <Film className="w-3.5 h-3.5 text-slate-500" />
                ไฟล์วิดีโอแนบ (สำหรับ YouTube, TikTok, Facebook, Instagram)
              </label>
              <label className="inline-flex items-center gap-1 rounded border border-slate-300 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer">
                <Upload className="w-3 h-3" />
                {uploadingVideo ? 'กำลังอัปโหลด...' : 'อัปโหลด .MP4'}
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
              placeholder="URL วิดีโอ หรือไฟล์ /uploads/..."
              className="w-full rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs focus:border-slate-900 focus:outline-none"
            />
          </div>

          {/* Channel Selection */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">
              เลือกช่องทางเป้าหมาย ({selectedChannels.length} ช่องทาง)
            </label>
            <div className="flex flex-wrap gap-1.5">
              {channels.map((ch) => {
                const active = selectedChannels.includes(ch.channelKey);
                return (
                  <button
                    key={ch.channelKey}
                    type="button"
                    onClick={() => toggleSelectChannel(ch.channelKey)}
                    className={`rounded-md px-2.5 py-1.5 text-xs font-semibold border transition cursor-pointer ${
                      active
                        ? 'bg-slate-900 text-white border-slate-900'
                        : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                    }`}
                  >
                    {ch.channelName}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Schedule Mode */}
          <div className="rounded-md bg-slate-50 border border-slate-200 p-3 space-y-2">
            <div className="flex items-center gap-4 text-xs font-semibold text-slate-700">
              <label className="inline-flex items-center gap-1.5 cursor-pointer">
                <input
                  type="radio"
                  checked={scheduleMode === 'now'}
                  onChange={() => setScheduleMode('now')}
                  className="accent-slate-900"
                />
                เผยแพร่ทันที
              </label>
              <label className="inline-flex items-center gap-1.5 cursor-pointer">
                <input
                  type="radio"
                  checked={scheduleMode === 'schedule'}
                  onChange={() => setScheduleMode('schedule')}
                  className="accent-slate-900"
                />
                กำหนดเวลาเผยแพร่ล่วงหน้า
              </label>
            </div>

            {scheduleMode === 'schedule' && (
              <input
                type="datetime-local"
                value={scheduledAt}
                onChange={(e) => setScheduledAt(e.target.value)}
                className="w-full rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs"
              />
            )}
          </div>

          {dispatchNotice && (
            <div
              className={`rounded-md p-3 text-xs font-medium ${
                dispatchNotice.ok
                  ? 'bg-emerald-50 border border-emerald-200 text-emerald-900'
                  : 'bg-amber-50 border border-amber-200 text-amber-900'
              }`}
            >
              {dispatchNotice.text}
            </div>
          )}

          <button
            type="submit"
            disabled={dispatching || selectedChannels.length === 0}
            className="w-full inline-flex items-center justify-center gap-2 rounded-md bg-slate-900 py-2.5 text-xs sm:text-sm font-semibold text-white hover:bg-slate-800 transition cursor-pointer disabled:opacity-50"
          >
            {scheduleMode === 'schedule' ? (
              <>
                <CalendarClock className="w-4 h-4 text-amber-400" />
                บันทึกตารางเวลาเผยแพร่ ({selectedChannels.length} ช่องทาง)
              </>
            ) : (
              <>
                <Send className="w-4 h-4 text-amber-400" />
                {dispatching
                  ? 'กำลังส่งข้อมูลไปยัง API...'
                  : `ดำเนินการเผยแพร่ทันที (${selectedChannels.length} ช่องทาง)`}
              </>
            )}
          </button>
        </form>

        {/* Right: Publish Logs */}
        <div className="lg:col-span-6 rounded-lg bg-white border border-slate-200 p-5 shadow-2xs space-y-4">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <h3 className="text-sm font-bold text-slate-900">
              ประวัติการเผยแพร่และตารางเวลา ({logs.length})
            </h3>
            <button
              type="button"
              onClick={loadHub}
              className="inline-flex items-center gap-1 text-xs font-medium text-slate-600 hover:text-slate-900 cursor-pointer"
            >
              <RefreshCw
                className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`}
              />
              รีเฟรช
            </button>
          </div>

          <div className="space-y-2.5 max-h-[540px] overflow-y-auto pr-1">
            {logs.length === 0 ? (
              <p className="text-xs text-slate-400 text-center py-8">
                ยังไม่มีประวัติการเผยแพร่
              </p>
            ) : (
              logs.map((lg) => (
                <div
                  key={lg.id}
                  className="rounded-md border border-slate-200 bg-slate-50/50 p-3.5 flex flex-col gap-2"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="rounded bg-slate-900 px-2 py-0.5 text-[10px] font-semibold text-white">
                          {lg.channelName}
                        </span>
                        <span
                          className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                            lg.status === 'published'
                              ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                              : lg.status === 'scheduled'
                              ? 'bg-amber-50 text-amber-800 border border-amber-200'
                              : 'bg-rose-50 text-rose-800 border border-rose-200'
                          }`}
                        >
                          {lg.status === 'published'
                            ? 'สำเร็จ'
                            : lg.status === 'scheduled'
                            ? `รอส่ง: ${lg.scheduledAt?.replace('T', ' ')}`
                            : 'ไม่สำเร็จ'}
                        </span>
                      </div>
                      <div className="mt-1 font-semibold text-xs text-slate-900">
                        {lg.title}
                      </div>
                      <p className="text-[11px] text-slate-500 line-clamp-1">
                        {lg.contentSnippet}
                      </p>
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0">
                      {lg.status === 'published' && lg.postId && (
                        <button
                          type="button"
                          onClick={() => onOpenPost(lg.postId!)}
                          className="rounded border border-slate-200 bg-white px-2 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
                        >
                          ดูโพสต์
                        </button>
                      )}
                      {lg.status === 'published' &&
                        lg.publishedUrl &&
                        lg.publishedUrl.startsWith('http') && (
                          <a
                            href={lg.publishedUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 rounded border border-slate-200 bg-white px-2 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-50"
                          >
                            ลิงก์ปลายทาง <ExternalLink className="w-3 h-3" />
                          </a>
                        )}
                      <button
                        type="button"
                        onClick={async () => {
                          await api.deletePublishLog(lg.id);
                          await loadHub();
                        }}
                        className="p-1 text-slate-400 hover:text-rose-600 cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  {lg.errorDetail && (
                    <div className="rounded bg-rose-50 border border-rose-200 px-2.5 py-1.5 text-[11px] text-rose-800 flex items-center justify-between gap-2">
                      <span>สาเหตุ: {lg.errorDetail}</span>
                      <button
                        type="button"
                        onClick={() => {
                          const found = channels.find(
                            (c) => c.channelKey === lg.channelKey
                          );
                          if (found) {
                            setEditingChannel({ ...found });
                            setTokenInput('');
                          }
                        }}
                        className="rounded bg-rose-700 px-2 py-0.5 text-[10px] font-semibold text-white shrink-0 cursor-pointer"
                      >
                        ตั้งค่า Token
                      </button>
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Audience Survey & Feedback Loop */}
      <div className="rounded-lg bg-white border border-slate-200 p-5 shadow-2xs space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-3.5">
          <div>
            <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
              <MessageSquareHeart className="w-4 h-4 text-slate-700" />
              ข้อมูลสำรวจความต้องการของผู้ติดตาม (Audience Feedback)
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              รวบรวมหัวข้อที่ผู้เรียนและบุคลากรทางการศึกษาสนใจ เพื่อส่งต่อให้ระบบเวิร์กโฟลว์ AI ผลิตเนื้อหา
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              setEditingSurveyId(null);
              setSurveyForm({
                respondentName: '',
                respondentRole: 'ครู / บุคลากรทางการศึกษา',
                schoolOrOrg: '',
                preferredChannel: 'LINE OA',
                requestedTopic: '',
                satisfactionScore: 5,
                feedbackDetail: '',
              });
              setSurveyModalOpen(true);
            }}
            className="rounded-md bg-slate-900 px-3.5 py-2 text-xs font-semibold text-white hover:bg-slate-800 cursor-pointer"
          >
            + บันทึกข้อมูลสำรวจใหม่
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5">
          {surveys.map((sv) => (
            <div
              key={sv.id}
              className="rounded-md border border-slate-200 p-4 flex flex-col justify-between bg-slate-50/40"
            >
              <div>
                <div className="flex items-center justify-between gap-2 text-[11px]">
                  <span className="rounded bg-slate-200/80 px-2 py-0.5 font-semibold text-slate-800">
                    {sv.respondentRole}
                  </span>
                  <span className="text-slate-500">
                    ความพึงพอใจ {sv.satisfactionScore}/5
                  </span>
                </div>

                <div className="mt-2 font-bold text-xs sm:text-sm text-slate-900">
                  “{sv.requestedTopic}”
                </div>
                <p className="mt-1 text-xs text-slate-600 line-clamp-2">
                  {sv.feedbackDetail}
                </p>
              </div>

              <div className="mt-4 pt-2.5 border-t border-slate-200/80 flex items-center justify-between gap-2">
                <div className="text-[11px] text-slate-500 truncate">
                  {sv.respondentName} ({sv.schoolOrOrg || sv.preferredChannel})
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    type="button"
                    disabled={triggeringTopic === sv.requestedTopic}
                    onClick={() => handleAiProduceFromSurvey(sv)}
                    className="inline-flex items-center gap-1 rounded bg-slate-900 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-slate-800 cursor-pointer disabled:opacity-50"
                  >
                    <Sparkles className="w-3 h-3 text-amber-400" />
                    {triggeringTopic === sv.requestedTopic
                      ? 'กำลังส่ง...'
                      : 'สั่ง AI ผลิต'}
                  </button>
                  <button
                    type="button"
                    onClick={() => openEditSurvey(sv)}
                    className="p-1 text-slate-400 hover:text-slate-800 cursor-pointer"
                  >
                    <Edit3 className="w-3.5 h-3.5" />
                  </button>
                  {confirmDeleteSurveyId === sv.id ? (
                    <button
                      type="button"
                      onClick={async () => {
                        await api.deleteSurvey(sv.id);
                        setConfirmDeleteSurveyId(null);
                        await loadHub();
                      }}
                      className="rounded bg-rose-600 px-2 py-0.5 text-[10px] font-semibold text-white cursor-pointer"
                    >
                      ยืนยันลบ
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setConfirmDeleteSurveyId(sv.id)}
                      className="p-1 text-slate-400 hover:text-rose-600 cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Channel Configuration Modal */}
      {editingChannel && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 backdrop-blur-xs p-4 overflow-y-auto">
          <div className="my-auto w-full max-w-lg rounded-lg bg-white p-6 shadow-xl space-y-4 border border-slate-200">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                  CHANNEL API CONFIGURATION
                </div>
                <h3 className="text-base font-bold text-slate-900">
                  ตั้งค่าการเชื่อมต่อ {editingChannel.channelName}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setEditingChannel(null)}
                className="p-1 rounded-md hover:bg-slate-100 text-slate-500 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveChannelConfig} className="space-y-3.5">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  ชื่อบัญชี / URL ช่องทาง
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
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-xs sm:text-sm"
                />
              </div>

              {editingChannel.channelKey !== 'website_blog' && (
                <>
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Target ID (Page ID / Channel ID / Business Account ID)
                    </label>
                    <input
                      type="text"
                      value={editingChannel.targetId || ''}
                      onChange={(e) =>
                        setEditingChannel({
                          ...editingChannel,
                          targetId: e.target.value,
                        })
                      }
                      placeholder="ระบุรหัสเพจหรือบัญชีปลายทาง"
                      className="w-full rounded-md border border-slate-300 px-3 py-2 text-xs font-mono"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      API Access Token / Bearer Token
                    </label>
                    <input
                      type="password"
                      value={tokenInput}
                      onChange={(e) => setTokenInput(e.target.value)}
                      placeholder={
                        editingChannel.hasAccessToken
                          ? `บันทึกไว้แล้ว (${editingChannel.accessTokenMasked}) — พิมพ์ใหม่หากต้องการเปลี่ยน`
                          : 'วาง Access Token ที่นี่'
                      }
                      className="w-full rounded-md border border-slate-300 px-3 py-2 text-xs font-mono"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Webhook URL (Make / Zapier / n8n • ไม่บังคับ)
                    </label>
                    <input
                      type="url"
                      value={editingChannel.webhookUrl || ''}
                      onChange={(e) =>
                        setEditingChannel({
                          ...editingChannel,
                          webhookUrl: e.target.value,
                        })
                      }
                      placeholder="https://hook.eu1.make.com/..."
                      className="w-full rounded-md border border-slate-300 px-3 py-2 text-xs font-mono"
                    />
                  </div>
                </>
              )}

              <div className="space-y-2 pt-1">
                <label className="flex items-center gap-2 text-xs font-medium text-slate-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={editingChannel.enabled}
                    onChange={(e) =>
                      setEditingChannel({
                        ...editingChannel,
                        enabled: e.target.checked,
                      })
                    }
                    className="accent-slate-900"
                  />
                  เปิดใช้งานช่องทางนี้
                </label>

                <label className="flex items-center gap-2 text-xs font-medium text-slate-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={editingChannel.autoPublishOnApprove}
                    onChange={(e) =>
                      setEditingChannel({
                        ...editingChannel,
                        autoPublishOnApprove: e.target.checked,
                      })
                    }
                    className="accent-slate-900"
                  />
                  เผยแพร่อัตโนมัติเมื่ออนุมัติแคมเปญจากระบบเวิร์กโฟลว์ AI
                </label>
              </div>

              {channelTestMsg && (
                <div
                  className={`rounded-md p-2.5 text-xs font-medium ${
                    channelTestMsg.ok
                      ? 'bg-emerald-50 text-emerald-900 border border-emerald-200'
                      : 'bg-rose-50 text-rose-900 border border-rose-200'
                  }`}
                >
                  {channelTestMsg.text}
                </div>
              )}

              <div className="pt-3 border-t border-slate-100 flex flex-wrap justify-between gap-2">
                {editingChannel.channelKey !== 'website_blog' ? (
                  <button
                    type="button"
                    disabled={testingChannelKey === editingChannel.channelKey}
                    onClick={async () => {
                      setTestingChannelKey(editingChannel.channelKey);
                      setChannelTestMsg(null);
                      try {
                        await api.updateChannel(editingChannel.channelKey, {
                          handleOrUrl: editingChannel.handleOrUrl,
                          enabled: editingChannel.enabled,
                          autoPublishOnApprove:
                            editingChannel.autoPublishOnApprove,
                          targetId: editingChannel.targetId,
                          webhookUrl: editingChannel.webhookUrl,
                          accessToken: tokenInput.trim()
                            ? tokenInput.trim()
                            : '__KEEP__',
                        });
                        const res = await api.testChannelConnection(
                          editingChannel.channelKey
                        );
                        setChannelTestMsg({ ok: res.ok, text: res.detail });
                        await loadHub();
                      } catch (e) {
                        setChannelTestMsg({
                          ok: false,
                          text: (e as Error).message,
                        });
                      } finally {
                        setTestingChannelKey(null);
                      }
                    }}
                    className="rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer disabled:opacity-50"
                  >
                    {testingChannelKey === editingChannel.channelKey
                      ? 'กำลังทดสอบ...'
                      : 'ทดสอบการเชื่อมต่อ'}
                  </button>
                ) : (
                  <div />
                )}

                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setEditingChannel(null);
                      setChannelTestMsg(null);
                    }}
                    className="rounded-md border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-slate-700 cursor-pointer"
                  >
                    ยกเลิก
                  </button>
                  <button
                    type="submit"
                    className="rounded-md bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800 cursor-pointer"
                  >
                    บันทึกการตั้งค่า
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Survey Modal */}
      {surveyModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 backdrop-blur-xs p-4 overflow-y-auto">
          <div className="my-auto w-full max-w-lg rounded-lg bg-white p-6 shadow-xl space-y-4 border border-slate-200">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="text-base font-bold text-slate-900">
                {editingSurveyId
                  ? 'แก้ไขข้อมูลแบบสำรวจ'
                  : 'บันทึกข้อมูลสำรวจความต้องการใหม่'}
              </h3>
              <button
                type="button"
                onClick={() => setSurveyModalOpen(false)}
                className="p-1 rounded-md hover:bg-slate-100 text-slate-500 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleCreateSurvey} className="space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <input
                  type="text"
                  required
                  value={surveyForm.respondentName}
                  onChange={(e) =>
                    setSurveyForm({
                      ...surveyForm,
                      respondentName: e.target.value,
                    })
                  }
                  placeholder="ชื่อผู้ให้ข้อมูล"
                  className="rounded-md border border-slate-300 px-3 py-2 text-xs sm:text-sm"
                />
                <input
                  type="text"
                  value={surveyForm.schoolOrOrg}
                  onChange={(e) =>
                    setSurveyForm({
                      ...surveyForm,
                      schoolOrOrg: e.target.value,
                    })
                  }
                  placeholder="หน่วยงาน / สถานศึกษา"
                  className="rounded-md border border-slate-300 px-3 py-2 text-xs sm:text-sm"
                />
              </div>
              <input
                type="text"
                required
                value={surveyForm.requestedTopic}
                onChange={(e) =>
                  setSurveyForm({
                    ...surveyForm,
                    requestedTopic: e.target.value,
                  })
                }
                placeholder="หัวข้อหรือประเด็นที่ต้องการให้ผลิตเนื้อหา"
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-xs sm:text-sm"
              />
              <textarea
                rows={3}
                value={surveyForm.feedbackDetail}
                onChange={(e) =>
                  setSurveyForm({
                    ...surveyForm,
                    feedbackDetail: e.target.value,
                  })
                }
                placeholder="รายละเอียดหรือข้อเสนอแนะเพิ่มเติม..."
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-xs sm:text-sm"
              />
              <div className="pt-2 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setSurveyModalOpen(false)}
                  className="rounded-md border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-slate-700 cursor-pointer"
                >
                  ยกเลิก
                </button>
                <button
                  type="submit"
                  className="rounded-md bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800 cursor-pointer"
                >
                  บันทึกข้อมูล
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
