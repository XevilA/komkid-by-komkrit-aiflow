import React, { useEffect, useRef, useState } from 'react';
import {
  Bot,
  Send,
  Plus,
  Trash2,
  Sparkles,
  Image as ImageIcon,
  Film,
  Newspaper,
  CheckCircle2,
  RefreshCw,
  AlertTriangle,
  KeyRound,
  ArrowRight,
  Copy,
  Eye,
  Edit3,
  MessageSquare,
  Wand2,
  X,
} from 'lucide-react';
import {
  AiChatMessage,
  AiChatSession,
  AiDraftFromChat,
  AiEngineSettings,
  AiEvaluatedPrompt,
  AiMediaAsset,
  CATEGORIES,
  CategoryId,
  LlmProviderId,
  Post,
} from '../types';
import { api } from '../api';
import { renderRichMarkdown } from './ArticleReaderModal';

export interface MediaAgentHandoff {
  target: 'image' | 'video';
  fullPrompt: string;
  thaiSummary: string;
  assessmentThai: string;
  aspectRatio: '16:9' | '9:16' | '1:1';
  suggestedPostTitle?: string;
}

interface Props {
  onRefreshAll: () => Promise<void>;
  onOpenSettings: () => void;
  onPreviewPost: (postId: number) => void;
  onSendToMediaStudio: (handoff: MediaAgentHandoff) => void;
  onOpenInPostEditor: (draft: Partial<Post>) => void;
}

const PROVIDER_OPTIONS: {
  id: LlmProviderId;
  label: string;
  shortDesc: string;
}[] = [
  { id: 'auto', label: 'อัตโนมัติ (แนะนำ)', shortDesc: 'เลือกค่ายที่เชื่อมคีย์ไว้ให้ทันที' },
  { id: 'gemini', label: 'Google Gemini', shortDesc: 'รวดเร็ว แม่นยำ เชื่อมรูป/วิดีโอ' },
  { id: 'openai', label: 'ChatGPT (OpenAI)', shortDesc: 'สนทนาลื่นไหล เรียบเรียงเก่ง' },
  { id: 'claude', label: 'Claude (Anthropic)', shortDesc: 'เขียนบทความภาษาไทยสละสลวย' },
  { id: 'deepseek', label: 'DeepSeek', shortDesc: 'วิเคราะห์เชิงลึก เหตุผลคมชัด' },
];

const QUICK_STARTERS = [
  'วันนี้อยากทำข่าวเรื่อง AI ช่วยครูไทยลดงานเอกสาร ช่วยวางประเด็นให้หน่อย',
  'อยากได้ไอเดียทำภาพปกข่าวสวยๆ และคลิปสั้นเรื่อง การเรียนรู้ตลอดชีวิต',
  'ช่วยร่างข่าวประชาสัมพันธ์งานบรรยายพิเศษของ อาจารย์คมกฤช',
  'สรุปเทรนด์การศึกษายุคใหม่ที่ผู้ปกครองและโรงเรียนควรรู้ 5 ข้อ',
];

function createSessionId() {
  return `chat-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

export const AiChatStudio: React.FC<Props> = ({
  onRefreshAll,
  onOpenSettings,
  onPreviewPost,
  onSendToMediaStudio,
  onOpenInPostEditor,
}) => {
  const [settings, setSettings] = useState<AiEngineSettings | null>(null);
  const [sessions, setSessions] = useState<AiChatSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string>(() => createSessionId());
  const [messages, setMessages] = useState<AiChatMessage[]>([]);
  const [provider, setProvider] = useState<LlmProviderId>('auto');
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);

  const [errorBanner, setErrorBanner] = useState<string | null>(null);
  const [successBanner, setSuccessBanner] = useState<string | null>(null);

  // 1) AI Evaluated Prompt State (Chat -> Evaluate -> Full Prompt -> Send to Image/VDO Agent)
  const [evaluatingTarget, setEvaluatingTarget] = useState<'image' | 'video' | null>(null);
  const [evaluatedPrompt, setEvaluatedPrompt] = useState<AiEvaluatedPrompt | null>(null);
  const [editableFullPrompt, setEditableFullPrompt] = useState('');
  const [selectedAspect, setSelectedAspect] = useState<'16:9' | '9:16' | '1:1'>('16:9');
  const [agentGenerating, setAgentGenerating] = useState(false);

  // 2) Recheck & Preview Media Asset State (Like/Keep vs Delete vs Use in News)
  const [previewAsset, setPreviewAsset] = useState<AiMediaAsset | null>(null);
  const [reviewBusy, setReviewBusy] = useState(false);

  // 3) AI News / Content Writer State (Chat -> Draft News/Article/Content -> Recheck Preview -> Publish/Delete)
  const [draftingFormat, setDraftingFormat] = useState<
    'news' | 'article' | 'social_post' | null
  >(null);
  const [draftPost, setDraftPost] = useState<AiDraftFromChat | null>(null);
  const [draftCoverUrl, setDraftCoverUrl] = useState<string>('/images/thumb-ai-edu.jpg');
  const [draftVideoUrl, setDraftVideoUrl] = useState<string>('');
  const [draftPreviewMode, setDraftPreviewMode] = useState<'preview' | 'edit'>('preview');
  const [publishingDraft, setPublishingDraft] = useState(false);
  const [generatingDraftCover, setGeneratingDraftCover] = useState(false);

  const chatEndRef = useRef<HTMLDivElement | null>(null);
  const actionPanelRef = useRef<HTMLDivElement | null>(null);

  const showToast = (msg: string) => {
    setSuccessBanner(msg);
    setTimeout(() => {
      setSuccessBanner((prev) => (prev === msg ? null : prev));
    }, 5000);
  };

  const loadInitial = async () => {
    try {
      const [st, sess] = await Promise.all([api.getAiSettings(), api.getChatSessions()]);
      setSettings(st);
      setSessions(sess);
      if (sess.length > 0 && messages.length === 0) {
        setActiveSessionId(sess[0].sessionId);
        const hist = await api.getChatHistory(sess[0].sessionId);
        setMessages(hist);
      }
    } catch {
      // ignore initial load errors
    }
  };

  useEffect(() => {
    loadInitial();
  }, []);

  const refreshSessionsList = async () => {
    try {
      const sess = await api.getChatSessions();
      setSessions(sess);
    } catch {
      // ignore
    }
  };

  const handleSelectSession = async (sid: string) => {
    setActiveSessionId(sid);
    setErrorBanner(null);
    try {
      const hist = await api.getChatHistory(sid);
      setMessages(hist);
    } catch (err) {
      setErrorBanner((err as Error).message);
    }
  };

  const handleNewChat = () => {
    const newId = createSessionId();
    setActiveSessionId(newId);
    setMessages([]);
    setEvaluatedPrompt(null);
    setPreviewAsset(null);
    setDraftPost(null);
    setErrorBanner(null);
  };

  const handleDeleteSession = async (sid: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    try {
      await api.clearChatHistory(sid);
      const updated = sessions.filter((s) => s.sessionId !== sid);
      setSessions(updated);
      if (activeSessionId === sid) {
        if (updated.length > 0) {
          handleSelectSession(updated[0].sessionId);
        } else {
          handleNewChat();
        }
      }
      showToast('ลบประวัติการสนทนานี้เรียบร้อยแล้ว');
    } catch (err) {
      setErrorBanner((err as Error).message);
    }
  };

  const sendMessageText = async (textToSend: string) => {
    const clean = textToSend.trim();
    if (!clean || sending) return;
    setErrorBanner(null);
    setSending(true);

    const optimisticUser: AiChatMessage = {
      id: Date.now(),
      sessionId: activeSessionId,
      provider: provider === 'auto' ? 'gemini' : provider,
      model: '',
      role: 'user',
      content: clean,
      createdAt: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, optimisticUser]);
    setInput('');

    try {
      await api.sendChatMessage({
        sessionId: activeSessionId,
        provider,
        message: clean,
        useKnowledgeBase: true,
      });
      const [hist] = await Promise.all([
        api.getChatHistory(activeSessionId),
        refreshSessionsList(),
      ]);
      setMessages(hist);
      setTimeout(() => {
        chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
      }, 100);
    } catch (err) {
      setErrorBanner((err as Error).message);
      const hist = await api.getChatHistory(activeSessionId).catch(() => []);
      setMessages(hist);
    } finally {
      setSending(false);
    }
  };

  const handleSendForm = async (e: React.FormEvent) => {
    e.preventDefault();
    await sendMessageText(input);
  };

  // ---------------- STEP A: AI EVALUATES CHAT & WRITES FULL IMAGE/VIDEO PROMPT ----------------
  const handleEvaluatePrompt = async (
    target: 'image' | 'video',
    customContextText?: string
  ) => {
    if (messages.length === 0 && !input.trim() && !customContextText) {
      setErrorBanner(
        'กรุณาพิมพ์คุยกับ AI หรือพิมพ์สิ่งที่อยากทำในช่องข้อความด้านล่างก่อน เพื่อให้ AI ประเมินและเขียน Full Prompt ครับ'
      );
      return;
    }
    setErrorBanner(null);
    setEvaluatingTarget(target);
    try {
      const res = await api.evaluateMediaPrompt({
        target,
        sessionId: messages.length > 0 ? activeSessionId : undefined,
        ideaText: customContextText || input.trim() || undefined,
        aspectRatio: '16:9',
        provider,
      });
      setEvaluatedPrompt(res);
      setEditableFullPrompt(res.fullPrompt);
      setSelectedAspect(res.recommendedAspectRatio || '16:9');
      setTimeout(() => {
        actionPanelRef.current?.scrollIntoView({ behavior: 'smooth' });
      }, 120);
    } catch (err) {
      setErrorBanner((err as Error).message);
    } finally {
      setEvaluatingTarget(null);
    }
  };

  // ---------------- STEP B: DISPATCH FULL PROMPT TO REAL IMAGE / VIDEO AGENT ----------------
  const handleRunMediaAgentNow = async () => {
    if (!evaluatedPrompt || !editableFullPrompt.trim()) return;
    setErrorBanner(null);
    setAgentGenerating(true);
    try {
      if (evaluatedPrompt.target === 'image') {
        const asset = await api.generateRealImage({
          prompt: editableFullPrompt.trim(),
          aspectRatio: selectedAspect,
          thaiSummary: evaluatedPrompt.visualSummaryThai,
        });
        setPreviewAsset(asset);
        // If user also has a draft news post open, do not overwrite automatically until they approve!
        showToast('Agent สร้างรูปภาพเสร็จแล้ว! กรุณาตรวจดูตัวอย่างด้านล่างว่าชอบหรือไม่');
      } else {
        const vidAspect: '16:9' | '9:16' = selectedAspect === '9:16' ? '9:16' : '16:9';
        const asset = await api.generateRealVideo({
          prompt: editableFullPrompt.trim(),
          engine: 'gemini-omni-1.1-flash',
          aspectRatio: vidAspect,
          durationSec: 6,
          resolution: '720p',
          thaiSummary: evaluatedPrompt.visualSummaryThai,
        });
        setPreviewAsset(asset);
        showToast('Agent สร้างวิดีโอเสร็จแล้ว! กรุณาเปิดเล่นดูตัวอย่างด้านล่างว่าชอบหรือไม่');
      }
      await onRefreshAll();
      setTimeout(() => {
        actionPanelRef.current?.scrollIntoView({ behavior: 'smooth' });
      }, 150);
    } catch (err) {
      setErrorBanner((err as Error).message);
    } finally {
      setAgentGenerating(false);
    }
  };

  // ---------------- STEP C: RECHECK PREVIEW DECISION (KEEP / USE IN NEWS / DELETE) ----------------
  const handleApproveKeepAsset = async () => {
    if (!previewAsset) return;
    setReviewBusy(true);
    setErrorBanner(null);
    try {
      await api.reviewMediaAsset(previewAsset.id, 'approved');
      if (draftPost) {
        if (previewAsset.mediaType === 'image') {
          setDraftCoverUrl(previewAsset.fileUrl);
        } else if (previewAsset.mediaType === 'video') {
          setDraftVideoUrl(previewAsset.fileUrl);
        }
      }
      showToast('อนุมัติและเก็บผลงานไว้ในคลังเรียบร้อยแล้ว!');
      setPreviewAsset({ ...previewAsset, reviewStatus: 'approved' });
      await onRefreshAll();
    } catch (err) {
      setErrorBanner((err as Error).message);
    } finally {
      setReviewBusy(false);
    }
  };

  const handleRejectDeleteAsset = async () => {
    if (!previewAsset) return;
    setReviewBusy(true);
    setErrorBanner(null);
    try {
      await api.deleteMediaAsset(previewAsset.id);
      setPreviewAsset(null);
      showToast('ลบผลงานที่ไม่ชอบออกจากระบบเรียบร้อยแล้ว');
      await onRefreshAll();
    } catch (err) {
      setErrorBanner((err as Error).message);
    } finally {
      setReviewBusy(false);
    }
  };

  const handleUseAssetInNewPost = async () => {
    if (!previewAsset) return;
    try {
      await api.reviewMediaAsset(previewAsset.id, 'approved');
    } catch {
      // ignore
    }
    if (draftPost) {
      if (previewAsset.mediaType === 'image') setDraftCoverUrl(previewAsset.fileUrl);
      if (previewAsset.mediaType === 'video') setDraftVideoUrl(previewAsset.fileUrl);
      showToast('แนบผลงานนี้เข้ากับร่างข่าวด้านล่างเรียบร้อยแล้ว!');
      return;
    }
    onOpenInPostEditor({
      title: evaluatedPrompt?.suggestedPostTitle || '',
      coverImage:
        previewAsset.mediaType === 'image'
          ? previewAsset.fileUrl
          : '/images/thumb-ai-edu.jpg',
      videoUrl: previewAsset.mediaType === 'video' ? previewAsset.fileUrl : '',
      contentType: previewAsset.mediaType === 'video' ? 'video' : 'news',
    });
  };

  // ---------------- STEP D: AI WRITES NEWS / ARTICLE / CONTENT FROM CHAT ----------------
  const handleDraftNewsFromChat = async (
    format: 'news' | 'article' | 'social_post',
    customText?: string
  ) => {
    if (messages.length === 0 && !input.trim() && !customText) {
      setErrorBanner(
        'กรุณาพิมพ์คุยกับ AI หรือพิมพ์หัวข้อข่าวที่อยากให้เขียนก่อนกดสั่งเขียนข่าวครับ'
      );
      return;
    }
    setErrorBanner(null);
    setDraftingFormat(format);
    try {
      const draft = await api.draftContentFromChat({
        sessionId: messages.length > 0 ? activeSessionId : undefined,
        ideaText: customText || input.trim() || undefined,
        contentFormat: format,
        provider,
      });
      setDraftPost(draft);
      setDraftPreviewMode('preview');
      if (previewAsset?.mediaType === 'image') {
        setDraftCoverUrl(previewAsset.fileUrl);
      } else {
        setDraftCoverUrl('/images/thumb-ai-edu.jpg');
      }
      if (previewAsset?.mediaType === 'video') {
        setDraftVideoUrl(previewAsset.fileUrl);
      } else {
        setDraftVideoUrl('');
      }
      setTimeout(() => {
        actionPanelRef.current?.scrollIntoView({ behavior: 'smooth' });
      }, 150);
    } catch (err) {
      setErrorBanner((err as Error).message);
    } finally {
      setDraftingFormat(null);
    }
  };

  const handleGenerateCoverForDraft = async () => {
    if (!draftPost) return;
    setGeneratingDraftCover(true);
    setErrorBanner(null);
    try {
      const promptToUse =
        draftPost.suggestedImagePrompt ||
        `Editorial 16:9 cover photography illustrating "${draftPost.title}", warm natural lighting, clean modern composition, no text`;
      const asset = await api.generateRealImage({
        prompt: promptToUse,
        aspectRatio: '16:9',
        thaiSummary: `ภาพปกข่าว: ${draftPost.title}`,
      });
      setPreviewAsset(asset);
      setDraftCoverUrl(asset.fileUrl);
      showToast('สร้างภาพปกข่าวเสร็จแล้ว! ตรวจดูตัวอย่างรูปปกได้ด้านล่าง');
      await onRefreshAll();
    } catch (err) {
      setErrorBanner((err as Error).message);
    } finally {
      setGeneratingDraftCover(false);
    }
  };

  const handlePublishDraft = async (status: 'published' | 'draft') => {
    if (!draftPost) return;
    setPublishingDraft(true);
    setErrorBanner(null);
    try {
      const created = await api.createPost({
        title: draftPost.title,
        subtitle: draftPost.subtitle,
        excerpt: draftPost.excerpt,
        content: draftPost.content,
        category: draftPost.category,
        contentType: draftVideoUrl ? 'video' : draftPost.contentType,
        coverImage: draftCoverUrl || '/images/thumb-ai-edu.jpg',
        videoUrl: draftVideoUrl || '',
        tags: draftPost.tags,
        status,
      });
      if (previewAsset && previewAsset.reviewStatus === 'pending_review') {
        await api.reviewMediaAsset(previewAsset.id, 'approved').catch(() => {});
      }
      await onRefreshAll();
      setDraftPost(null);
      if (status === 'published') {
        showToast('บันทึกและนำข่าวขึ้นหน้าเว็บไซต์เรียบร้อยแล้ว!');
        onPreviewPost(created.id);
      } else {
        showToast('บันทึกเก็บเป็นฉบับร่างไว้ในระบบจัดการข่าวเรียบร้อยแล้ว!');
      }
    } catch (err) {
      setErrorBanner((err as Error).message);
    } finally {
      setPublishingDraft(false);
    }
  };

  const anyApiKeyConfigured = Boolean(
    settings?.hasGeminiKey ||
      settings?.hasOpenaiKey ||
      settings?.hasClaudeKey ||
      settings?.hasDeepseekKey
  );

  return (
    <div className="space-y-5">
      {/* Friendly Guide Header */}
      <div className="rounded-3xl bg-[#0d2546] text-white p-5 sm:p-6 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="inline-flex items-center gap-2 rounded-full bg-amber-400/20 border border-amber-300/40 px-3 py-1 text-xs font-extrabold text-amber-300">
              <Bot className="w-4 h-4" /> ห้องแชทคุยกับ AI แบบปกติ + สั่งสร้างข่าว / รูปภาพ / วิดีโอ
            </div>
            <h2 className="text-xl sm:text-2xl font-extrabold">
              คุยปรึกษา AI ได้ทุกเรื่อง แล้วสั่งเขียนข่าว หรือส่ง Full Prompt ให้ Agent รูป/VDO ได้ทันที
            </h2>
            <p className="text-sm text-slate-200">
              1. พิมพ์คุยว่าจะทำอะไร → 2. กดให้ AI ประเมินและเขียน Full Prompt หรือเขียนข่าว → 3. ตรวจดูตัวอย่าง (ชอบเก็บไว้ / ลงเว็บ หรือ ไม่ชอบกดลบทิ้ง)
            </p>
          </div>
          {!anyApiKeyConfigured && settings && (
            <button
              onClick={onOpenSettings}
              className="inline-flex items-center gap-2 rounded-2xl bg-amber-400 px-4 py-3 text-sm font-extrabold text-[#0d2546] hover:bg-amber-300 cursor-pointer"
            >
              <KeyRound className="w-4 h-4" /> ตั้งค่าใส่คีย์ AI ก่อนใช้งาน
            </button>
          )}
        </div>
      </div>

      {/* Banners */}
      {errorBanner && (
        <div className="rounded-2xl border-2 border-rose-300 bg-rose-50 p-4 flex flex-wrap items-center justify-between gap-3 text-rose-900">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-6 h-6 text-rose-600 shrink-0 mt-0.5" />
            <div className="text-sm sm:text-base font-bold">{errorBanner}</div>
          </div>
          <div className="flex items-center gap-2">
            {errorBanner.includes('API Key') && (
              <button
                onClick={onOpenSettings}
                className="rounded-xl bg-rose-700 px-4 py-2 text-xs sm:text-sm font-extrabold text-white hover:bg-rose-800 cursor-pointer"
              >
                ไปหน้าใส่คีย์ AI
              </button>
            )}
            <button
              onClick={() => setErrorBanner(null)}
              className="rounded-xl bg-white px-3 py-1.5 text-xs font-bold text-slate-600 border border-slate-200 cursor-pointer"
            >
              ปิด
            </button>
          </div>
        </div>
      )}

      {successBanner && (
        <div className="rounded-2xl border-2 border-emerald-300 bg-emerald-50 p-4 flex items-center gap-3 text-emerald-900">
          <CheckCircle2 className="w-6 h-6 text-emerald-600 shrink-0" />
          <div className="text-sm sm:text-base font-extrabold">{successBanner}</div>
        </div>
      )}

      {/* Main Chat Layout: Left Session History + Right Chat & Action Studio */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        {/* Left: Chat Conversations List */}
        <div className="lg:col-span-4 xl:col-span-3 rounded-3xl bg-white border border-slate-200 p-4 flex flex-col justify-between gap-4">
          <div className="space-y-3">
            <button
              onClick={handleNewChat}
              className="w-full flex items-center justify-center gap-2 rounded-2xl bg-[#0d2546] px-4 py-3.5 text-base font-extrabold text-white hover:bg-[#163a6b] transition cursor-pointer shadow-sm"
            >
              <Plus className="w-5 h-5 text-amber-300" /> เริ่มหัวข้อคุยใหม่
            </button>

            <div className="pt-1">
              <div className="text-xs font-extrabold text-slate-500 px-1 mb-2">
                ประวัติเรื่องที่เคยคุย ({sessions.length})
              </div>
              <div className="space-y-2 max-h-[420px] overflow-y-auto pr-1">
                {sessions.length === 0 ? (
                  <div className="rounded-2xl bg-slate-50 p-4 text-center text-sm text-slate-500">
                    ยังไม่มีประวัติแชท เริ่มพิมพ์คุยกับ AI ทางด้านขวาได้เลยครับ
                  </div>
                ) : (
                  sessions.map((s) => {
                    const active = s.sessionId === activeSessionId;
                    return (
                      <div
                        key={s.sessionId}
                        onClick={() => handleSelectSession(s.sessionId)}
                        className={`group flex items-start justify-between gap-2 rounded-2xl p-3 cursor-pointer border transition ${
                          active
                            ? 'bg-amber-50 border-amber-400 text-[#0d2546]'
                            : 'bg-slate-50/70 border-slate-200/80 hover:bg-slate-100 text-slate-700'
                        }`}
                      >
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-extrabold truncate">
                            {s.title || 'บทสนทนา AI'}
                          </div>
                          <div className="text-xs text-slate-500 truncate mt-0.5">
                            {s.messageCount} ข้อความ • {s.provider}
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={(e) => handleDeleteSession(s.sessionId, e)}
                          title="ลบแชทนี้"
                          className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 cursor-pointer shrink-0"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </div>

          {/* Provider Selector Box */}
          <div className="rounded-2xl bg-slate-50 border border-slate-200 p-3.5 space-y-2">
            <label className="block text-xs font-extrabold text-slate-600">
              เลือกค่าย AI ที่ต้องการคุย:
            </label>
            <div className="space-y-1.5">
              {PROVIDER_OPTIONS.map((p) => {
                const isSelected = provider === p.id;
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setProvider(p.id)}
                    className={`w-full text-left rounded-xl px-3 py-2 transition cursor-pointer border ${
                      isSelected
                        ? 'bg-[#0d2546] text-white border-[#0d2546]'
                        : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-100'
                    }`}
                  >
                    <div className="text-sm font-extrabold">{p.label}</div>
                    <div
                      className={`text-[11px] ${
                        isSelected ? 'text-amber-300' : 'text-slate-500'
                      }`}
                    >
                      {p.shortDesc}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Right: Normal AI Chat Window + One-Click Action Bar */}
        <div className="lg:col-span-8 xl:col-span-9 flex flex-col rounded-3xl bg-white border border-slate-200 shadow-sm overflow-hidden">
          {/* Messages Scroll Area */}
          <div className="flex-1 p-4 sm:p-6 space-y-4 min-h-[400px] max-h-[560px] overflow-y-auto bg-[#f8fafd]">
            {messages.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-center py-8 px-4 space-y-5">
                <div className="h-16 w-16 rounded-2xl bg-[#0d2546] text-amber-300 flex items-center justify-center shadow-md">
                  <MessageSquare className="w-8 h-8" />
                </div>
                <div className="max-w-lg space-y-1.5">
                  <h3 className="text-lg sm:text-xl font-extrabold text-[#0d2546]">
                    สวัสดีครับ! วันนี้อยากให้ AI ช่วยคิดเรื่องอะไรดีครับ?
                  </h3>
                  <p className="text-sm sm:text-base text-slate-600">
                    พิมพ์คุยเหมือนคุยกับผู้ช่วยส่วนตัวได้เลย หรือกดเลือกตัวอย่างด้านล่างเพื่อเริ่มต้นทันที
                  </p>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 w-full max-w-2xl">
                  {QUICK_STARTERS.map((q, idx) => (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => sendMessageText(q)}
                      className="text-left rounded-2xl border-2 border-slate-200 bg-white p-3.5 text-sm font-bold text-[#0d2546] hover:border-amber-400 hover:bg-amber-50/40 transition cursor-pointer"
                    >
                      “{q}”
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              messages.map((m) => {
                const isUser = m.role === 'user';
                return (
                  <div
                    key={m.id}
                    className={`flex flex-col ${isUser ? 'items-end' : 'items-start'}`}
                  >
                    <div
                      className={`max-w-[92%] sm:max-w-[85%] rounded-3xl px-5 py-4 shadow-xs ${
                        isUser
                          ? 'bg-[#0d2546] text-white rounded-br-lg'
                          : 'bg-white border border-slate-200 text-slate-800 rounded-bl-lg'
                      }`}
                    >
                      {!isUser && (
                        <div className="flex items-center justify-between gap-3 mb-2 pb-1.5 border-b border-slate-100">
                          <span className="inline-flex items-center gap-1.5 text-xs font-extrabold text-[#0d2546]">
                            <Bot className="w-4 h-4 text-amber-500" />
                            ผู้ช่วย AI ({m.provider} {m.model ? `• ${m.model}` : ''})
                          </span>
                          <button
                            type="button"
                            onClick={() => {
                              navigator.clipboard?.writeText(m.content);
                              showToast('คัดลอกข้อความ AI เรียบร้อยแล้ว');
                            }}
                            className="inline-flex items-center gap-1 text-xs font-bold text-slate-500 hover:text-[#0d2546] cursor-pointer"
                          >
                            <Copy className="w-3.5 h-3.5" /> คัดลอก
                          </button>
                        </div>
                      )}

                      {isUser ? (
                        <div className="text-base leading-relaxed whitespace-pre-wrap">
                          {m.content}
                        </div>
                      ) : (
                        <div className="prose prose-slate max-w-none text-base leading-relaxed">
                          {renderRichMarkdown(m.content)}
                        </div>
                      )}
                    </div>

                    {/* Direct Action Pills right under every AI response! */}
                    {!isUser && (
                      <div className="mt-2 flex flex-wrap items-center gap-2 pl-1">
                        <button
                          type="button"
                          onClick={() => handleEvaluatePrompt('image', m.content)}
                          disabled={evaluatingTarget !== null}
                          className="inline-flex items-center gap-1.5 rounded-xl bg-amber-50 border border-amber-300 px-3 py-1.5 text-xs sm:text-sm font-extrabold text-amber-950 hover:bg-amber-100 cursor-pointer disabled:opacity-50"
                        >
                          <ImageIcon className="w-4 h-4 text-amber-600" />
                          ประเมิน & เขียน Full Prompt สร้างรูป
                        </button>
                        <button
                          type="button"
                          onClick={() => handleEvaluatePrompt('video', m.content)}
                          disabled={evaluatingTarget !== null}
                          className="inline-flex items-center gap-1.5 rounded-xl bg-indigo-50 border border-indigo-200 px-3 py-1.5 text-xs sm:text-sm font-extrabold text-indigo-950 hover:bg-indigo-100 cursor-pointer disabled:opacity-50"
                        >
                          <Film className="w-4 h-4 text-indigo-600" />
                          ประเมิน & เขียน Full Prompt สร้าง VDO
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDraftNewsFromChat('news', m.content)}
                          disabled={draftingFormat !== null}
                          className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-50 border border-emerald-300 px-3 py-1.5 text-xs sm:text-sm font-extrabold text-emerald-950 hover:bg-emerald-100 cursor-pointer disabled:opacity-50"
                        >
                          <Newspaper className="w-4 h-4 text-emerald-600" />
                          นำเรื่องนี้มาเขียนข่าวลงเว็บ
                        </button>
                      </div>
                    )}
                  </div>
                );
              })
            )}

            {sending && (
              <div className="flex items-center gap-3 rounded-2xl bg-white border border-slate-200 px-4 py-3 w-fit text-sm font-bold text-[#0d2546]">
                <RefreshCw className="w-4 h-4 animate-spin text-amber-500" />
                AI กำลังคิดและพิมพ์คำตอบให้ครับ...
              </div>
            )}
            <div ref={chatEndRef} />
          </div>

          {/* Big Smart Action Strip above Input Box */}
          <div className="bg-slate-50 border-t border-slate-200 px-4 sm:px-5 py-3">
            <div className="text-xs font-extrabold text-slate-500 mb-2">
              สั่งงานต่อจากเรื่องที่คุยกันในแชทนี้ (คลิกปุ่มเดียว):
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
              <button
                type="button"
                onClick={() => handleEvaluatePrompt('image')}
                disabled={evaluatingTarget !== null}
                className="flex items-center justify-center gap-2 rounded-2xl border-2 border-amber-300 bg-amber-50 px-3.5 py-2.5 text-sm font-extrabold text-amber-950 hover:bg-amber-100 transition cursor-pointer disabled:opacity-50"
              >
                {evaluatingTarget === 'image' ? (
                  <RefreshCw className="w-4 h-4 animate-spin" />
                ) : (
                  <ImageIcon className="w-4 h-4 text-amber-600" />
                )}
                1. ให้ AI เขียน Full Prompt รูปภาพ
              </button>

              <button
                type="button"
                onClick={() => handleEvaluatePrompt('video')}
                disabled={evaluatingTarget !== null}
                className="flex items-center justify-center gap-2 rounded-2xl border-2 border-indigo-300 bg-indigo-50 px-3.5 py-2.5 text-sm font-extrabold text-indigo-950 hover:bg-indigo-100 transition cursor-pointer disabled:opacity-50"
              >
                {evaluatingTarget === 'video' ? (
                  <RefreshCw className="w-4 h-4 animate-spin" />
                ) : (
                  <Film className="w-4 h-4 text-indigo-600" />
                )}
                2. ให้ AI เขียน Full Prompt วิดีโอ
              </button>

              <button
                type="button"
                onClick={() => handleDraftNewsFromChat('news')}
                disabled={draftingFormat !== null}
                className="flex items-center justify-center gap-2 rounded-2xl border-2 border-emerald-300 bg-emerald-50 px-3.5 py-2.5 text-sm font-extrabold text-emerald-950 hover:bg-emerald-100 transition cursor-pointer disabled:opacity-50"
              >
                {draftingFormat !== null ? (
                  <RefreshCw className="w-4 h-4 animate-spin" />
                ) : (
                  <Newspaper className="w-4 h-4 text-emerald-600" />
                )}
                3. ให้ AI เขียนข่าว / คอนเทนต์
              </button>
            </div>
          </div>

          {/* Chat Input Form */}
          <form
            onSubmit={handleSendForm}
            className="p-4 sm:p-5 bg-white border-t border-slate-200 flex flex-col sm:flex-row items-stretch sm:items-end gap-3"
          >
            <textarea
              rows={2}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  sendMessageText(input);
                }
              }}
              placeholder="พิมพ์คุยกับ AI ที่นี่... (เช่น อยากทำข่าวเรื่องอะไร อยากได้ภาพหรือวิดีโอแบบไหน พิมพ์ภาษาไทยปกติได้เลย)"
              className="flex-1 rounded-2xl border-2 border-slate-300 px-4 py-3 text-base text-slate-800 focus:border-[#0d2546] focus:outline-none resize-none"
            />
            <button
              type="submit"
              disabled={sending || !input.trim()}
              className="inline-flex items-center justify-center gap-2 rounded-2xl bg-[#0d2546] px-6 py-3.5 text-base font-extrabold text-white hover:bg-[#163a6b] transition cursor-pointer disabled:opacity-50 shrink-0"
            >
              <Send className="w-5 h-5 text-amber-300" />
              {sending ? 'กำลังส่ง...' : 'ส่งข้อความ'}
            </button>
          </form>
        </div>
      </div>

      {/* ===================================================================== */}
      {/* INTERACTIVE WORKBENCH BELOW CHAT:                                     */}
      {/* 1) AI EVALUATED FULL PROMPT -> SEND TO IMAGE/VDO AGENT                */}
      {/* 2) RECHECK & PREVIEW GENERATED IMAGE/VIDEO (LIKE/KEEP OR DELETE)      */}
      {/* 3) AI WRITTEN NEWS/CONTENT RECHECK PREVIEW -> PUBLISH OR DELETE       */}
      {/* ===================================================================== */}
      <div ref={actionPanelRef} className="space-y-5">
        {/* 1) AI PROMPT EVALUATION & DISPATCH TO IMAGE/VDO AGENT */}
        {evaluatedPrompt && (
          <div className="rounded-3xl border-2 border-amber-400 bg-white p-5 sm:p-6 shadow-md space-y-5">
            <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-200 pb-4">
              <div className="space-y-1">
                <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-100 px-3 py-1 text-xs font-extrabold text-amber-900">
                  <Wand2 className="w-4 h-4" />
                  AI ประเมินแนวคิดและเขียน Full Prompt เสร็จแล้ว ({evaluatedPrompt.engineUsed})
                </span>
                <h3 className="text-lg sm:text-xl font-extrabold text-[#0d2546]">
                  {evaluatedPrompt.target === 'image'
                    ? '🎨 เตรียมส่ง Full Prompt ให้ Agent สร้างรูปภาพจริง'
                    : '🎬 เตรียมส่ง Full Prompt ให้ Agent สร้างวิดีโอจริง (Google Veo / Gemini Video)'}
                </h3>
              </div>
              <button
                onClick={() => setEvaluatedPrompt(null)}
                className="inline-flex items-center gap-1 rounded-xl bg-slate-100 px-3 py-2 text-sm font-bold text-slate-600 hover:bg-slate-200 cursor-pointer"
              >
                <X className="w-4 h-4" /> ปิดกล่องนี้
              </button>
            </div>

            {/* AI Thai Assessment & Visual Summary */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="rounded-2xl bg-amber-50/70 border border-amber-200 p-4 space-y-1.5">
                <div className="text-sm font-extrabold text-amber-950">
                  💡 ผลการประเมินแนวคิดโดย AI:
                </div>
                <p className="text-base text-slate-800 leading-relaxed">
                  {evaluatedPrompt.assessmentThai}
                </p>
              </div>
              <div className="rounded-2xl bg-sky-50/70 border border-sky-200 p-4 space-y-1.5">
                <div className="text-sm font-extrabold text-sky-950">
                  🖼️ ภาพ/ฉากที่จะได้จาก Prompt นี้:
                </div>
                <p className="text-base text-slate-800 leading-relaxed">
                  {evaluatedPrompt.visualSummaryThai}
                </p>
              </div>
            </div>

            {/* Aspect Ratio Selector */}
            <div className="space-y-2">
              <label className="block text-sm sm:text-base font-extrabold text-[#0d2546]">
                เลือกสัดส่วนผลงาน:
              </label>
              <div className="flex flex-wrap gap-2.5">
                {(evaluatedPrompt.target === 'video'
                  ? ([
                      { id: '16:9', label: 'แนวนอน 16:9 (ลงเว็บ / YouTube)' },
                      { id: '9:16', label: 'แนวตั้ง 9:16 (คลิปสั้น มือถือ / TikTok)' },
                    ] as const)
                  : ([
                      { id: '16:9', label: 'แนวนอน 16:9 (ภาพปกข่าวบนเว็บ)' },
                      { id: '1:1', label: 'จัตุรัส 1:1 (โพสต์ Facebook / LINE)' },
                      { id: '9:16', label: 'แนวตั้ง 9:16 (จอมือถือ)' },
                    ] as const)
                ).map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => setSelectedAspect(opt.id)}
                    className={`rounded-xl px-4 py-2.5 text-sm font-extrabold border-2 transition cursor-pointer ${
                      selectedAspect === opt.id
                        ? 'bg-[#0d2546] text-white border-[#0d2546]'
                        : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Editable Full Prompt */}
            <div className="space-y-2">
              <label className="block text-sm sm:text-base font-extrabold text-[#0d2546]">
                Full Prompt สำหรับส่งให้ Agent (ตรวจสอบหรือพิมพ์แก้ไขเพิ่มได้):
              </label>
              <textarea
                rows={4}
                value={editableFullPrompt}
                onChange={(e) => setEditableFullPrompt(e.target.value)}
                className="w-full rounded-2xl border-2 border-slate-300 p-4 text-sm sm:text-base text-slate-800 focus:border-[#0d2546] focus:outline-none"
              />
            </div>

            {/* Big Action Buttons: Generate Here OR Open in Dedicated Media Studio */}
            <div className="flex flex-wrap items-center gap-3 pt-1">
              <button
                type="button"
                onClick={handleRunMediaAgentNow}
                disabled={agentGenerating || !editableFullPrompt.trim()}
                className="inline-flex items-center justify-center gap-2.5 rounded-2xl bg-emerald-600 px-6 py-4 text-base font-extrabold text-white hover:bg-emerald-700 transition cursor-pointer shadow-sm disabled:opacity-50"
              >
                {agentGenerating ? (
                  <>
                    <RefreshCw className="w-5 h-5 animate-spin" />
                    {evaluatedPrompt.target === 'image'
                      ? 'Agent กำลังวาดรูปภาพจริงให้ครับ...'
                      : 'Agent กำลังสร้างวิดีโอจริง (อาจใช้เวลา 30-90 วินาที)...'}
                  </>
                ) : (
                  <>
                    <Sparkles className="w-5 h-5" />
                    {evaluatedPrompt.target === 'image'
                      ? 'ส่งให้ Agent สร้างรูปภาพทันที (ดู Preview ก่อนตัดสินใจ)'
                      : 'ส่งให้ Agent สร้างวิดีโอทันที (ดู Preview ก่อนตัดสินใจ)'}
                  </>
                )}
              </button>

              <button
                type="button"
                onClick={() =>
                  onSendToMediaStudio({
                    target: evaluatedPrompt.target,
                    fullPrompt: editableFullPrompt,
                    thaiSummary: evaluatedPrompt.visualSummaryThai,
                    assessmentThai: evaluatedPrompt.assessmentThai,
                    aspectRatio: selectedAspect,
                    suggestedPostTitle: evaluatedPrompt.suggestedPostTitle,
                  })
                }
                className="inline-flex items-center justify-center gap-2 rounded-2xl border-2 border-[#0d2546] bg-white px-5 py-3.5 text-sm sm:text-base font-extrabold text-[#0d2546] hover:bg-slate-50 transition cursor-pointer"
              >
                เปิดปรับแต่งต่อในหน้า “สร้างรูปภาพ & วิดีโอ AI”
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {/* 2) RECHECK & PREVIEW BOX FOR GENERATED IMAGE OR VIDEO (LIKE vs DELETE!) */}
        {previewAsset && (
          <div className="rounded-3xl border-4 border-emerald-500 bg-white p-5 sm:p-6 shadow-lg space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-100 px-3.5 py-1 text-xs font-extrabold text-emerald-900">
                  <Eye className="w-4 h-4" /> ระบบตรวจสอบผลงานก่อนนำไปใช้ (Recheck & Preview)
                </span>
                <h3 className="text-xl font-extrabold text-[#0d2546] mt-1">
                  ผลงาน{previewAsset.mediaType === 'video' ? 'วิดีโอ AI' : 'รูปภาพ AI'}เสร็จแล้ว — คุณชอบผลงานนี้ไหมครับ?
                </h3>
              </div>
              {previewAsset.reviewStatus === 'approved' && (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-600 px-4 py-1.5 text-sm font-extrabold text-white">
                  <CheckCircle2 className="w-4 h-4" /> อนุมัติเก็บไว้ในคลังแล้ว
                </span>
              )}
            </div>

            <div className="rounded-2xl bg-slate-900 p-3 flex items-center justify-center overflow-hidden">
              {previewAsset.mediaType === 'video' ? (
                <video
                  src={previewAsset.fileUrl}
                  controls
                  autoPlay
                  className="max-h-[460px] w-auto rounded-xl"
                />
              ) : (
                <img
                  src={previewAsset.fileUrl}
                  alt={previewAsset.thaiSummary || 'AI Generated'}
                  className="max-h-[460px] w-auto object-contain rounded-xl"
                />
              )}
            </div>

            {previewAsset.thaiSummary && (
              <div className="text-sm sm:text-base font-bold text-slate-700 bg-slate-50 rounded-xl px-4 py-2.5 border border-slate-200">
                รายละเอียด: {previewAsset.thaiSummary}
              </div>
            )}

            {/* 4 Big Clear Decision Buttons */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <button
                type="button"
                disabled={reviewBusy}
                onClick={handleApproveKeepAsset}
                className="flex items-center justify-center gap-2 rounded-2xl bg-emerald-600 px-4 py-4 text-base font-extrabold text-white hover:bg-emerald-700 cursor-pointer disabled:opacity-50"
              >
                <CheckCircle2 className="w-5 h-5" />
                ชอบ! เก็บไว้ในคลัง
              </button>

              <button
                type="button"
                disabled={reviewBusy}
                onClick={handleUseAssetInNewPost}
                className="flex items-center justify-center gap-2 rounded-2xl bg-[#0d2546] px-4 py-4 text-base font-extrabold text-white hover:bg-[#163a6b] cursor-pointer disabled:opacity-50"
              >
                <Newspaper className="w-5 h-5 text-amber-300" />
                {draftPost ? 'แนบใส่ร่างข่าวด้านล่าง' : 'ชอบ! นำไปลงข่าวใหม่'}
              </button>

              <button
                type="button"
                disabled={reviewBusy || agentGenerating}
                onClick={() => {
                  if (!evaluatedPrompt) {
                    setEvaluatedPrompt({
                      target: previewAsset.mediaType === 'video' ? 'video' : 'image',
                      assessmentThai: 'ปรับแก้รายละเอียด Full Prompt ด้านล่างแล้วกดสั่งสร้างใหม่ได้เลยครับ',
                      visualSummaryThai: previewAsset.thaiSummary || '',
                      fullPrompt: previewAsset.prompt,
                      recommendedAspectRatio:
                        (previewAsset.aspectRatio as any) || '16:9',
                      suggestedPostTitle: '',
                      engineUsed: previewAsset.model,
                    });
                    setEditableFullPrompt(previewAsset.prompt);
                  }
                  showToast('ปรับแก้ข้อความในกล่อง Full Prompt ด้านบนแล้วกดสร้างใหม่ได้เลยครับ');
                }}
                className="flex items-center justify-center gap-2 rounded-2xl border-2 border-amber-400 bg-amber-50 px-4 py-4 text-base font-extrabold text-amber-950 hover:bg-amber-100 cursor-pointer"
              >
                <RefreshCw className="w-5 h-5" />
                ปรับแก้แล้วสร้างใหม่
              </button>

              <button
                type="button"
                disabled={reviewBusy}
                onClick={handleRejectDeleteAsset}
                className="flex items-center justify-center gap-2 rounded-2xl border-2 border-rose-300 bg-rose-50 px-4 py-4 text-base font-extrabold text-rose-700 hover:bg-rose-600 hover:text-white transition cursor-pointer disabled:opacity-50"
              >
                <Trash2 className="w-5 h-5" />
                ไม่ชอบ — ลบทิ้งทันที
              </button>
            </div>
          </div>
        )}

        {/* 3) AI WRITTEN NEWS / ARTICLE / CONTENT RECHECK PREVIEW */}
        {draftPost && (
          <div className="rounded-3xl border-4 border-[#0d2546] bg-white p-5 sm:p-7 shadow-lg space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-4">
              <div>
                <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-100 px-3.5 py-1 text-xs font-extrabold text-amber-950">
                  <Newspaper className="w-4 h-4" /> ตรวจทานข่าว / บทความที่ AI เขียนให้ (Recheck & Preview)
                </span>
                <h3 className="text-xl font-extrabold text-[#0d2546] mt-1">
                  อ่านตรวจทานก่อนตัดสินใจ — แก้ไขได้ หรือกดลงหน้าเว็บได้ทันที!
                </h3>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() =>
                    setDraftPreviewMode((m) => (m === 'preview' ? 'edit' : 'preview'))
                  }
                  className="inline-flex items-center gap-1.5 rounded-xl border-2 border-slate-300 bg-white px-4 py-2 text-sm font-extrabold text-[#0d2546] hover:bg-slate-50 cursor-pointer"
                >
                  <Edit3 className="w-4 h-4" />
                  {draftPreviewMode === 'preview' ? 'แก้ไขข้อความเอง' : 'ดูตัวอย่างหน้าอ่านจริง'}
                </button>
                <button
                  type="button"
                  onClick={() => setDraftPost(null)}
                  className="inline-flex items-center gap-1 rounded-xl bg-rose-50 px-3.5 py-2 text-sm font-extrabold text-rose-700 hover:bg-rose-100 cursor-pointer"
                >
                  <Trash2 className="w-4 h-4" /> ไม่เอา / ลบร่างนี้
                </button>
              </div>
            </div>

            {/* Cover Image Strip + 1-Click Generate AI Cover */}
            <div className="rounded-2xl bg-slate-50 border border-slate-200 p-4 flex flex-col sm:flex-row items-center gap-4">
              <img
                src={draftCoverUrl}
                alt="Cover preview"
                className="w-full sm:w-48 h-32 object-cover rounded-xl border border-slate-200 shrink-0"
              />
              <div className="flex-1 space-y-2">
                <div className="text-sm font-extrabold text-[#0d2546]">
                  รูปปกสำหรับข่าวนี้:
                </div>
                <p className="text-xs sm:text-sm text-slate-600">
                  คุณสามารถสั่งให้ Agent วาดรูปปกใหม่ที่ตรงกับเนื้อหาข่าวนี้ได้ในคลิกเดียว
                </p>
                <button
                  type="button"
                  onClick={handleGenerateCoverForDraft}
                  disabled={generatingDraftCover}
                  className="inline-flex items-center gap-2 rounded-xl bg-amber-400 px-4 py-2.5 text-sm font-extrabold text-[#0d2546] hover:bg-amber-300 cursor-pointer disabled:opacity-50"
                >
                  {generatingDraftCover ? (
                    <>
                      <RefreshCw className="w-4 h-4 animate-spin" />
                      Agent กำลังวาดรูปปกข่าวให้...
                    </>
                  ) : (
                    <>
                      <ImageIcon className="w-4 h-4" />
                      สั่ง Agent สร้างรูปปกข่าวด้วย AI
                    </>
                  )}
                </button>
              </div>
            </div>

            {draftPreviewMode === 'edit' ? (
              <div className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-extrabold text-slate-700 mb-1">
                      หัวข้อข่าว / ชื่อเรื่อง
                    </label>
                    <input
                      type="text"
                      value={draftPost.title}
                      onChange={(e) =>
                        setDraftPost({ ...draftPost, title: e.target.value })
                      }
                      className="w-full rounded-xl border-2 border-slate-300 px-4 py-2.5 text-base font-bold"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-extrabold text-slate-700 mb-1">
                      หมวดหมู่ข่าว
                    </label>
                    <select
                      value={draftPost.category}
                      onChange={(e) =>
                        setDraftPost({
                          ...draftPost,
                          category: e.target.value as CategoryId,
                        })
                      }
                      className="w-full rounded-xl border-2 border-slate-300 px-4 py-2.5 text-base font-bold bg-white"
                    >
                      {CATEGORIES.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.nameTh}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-extrabold text-slate-700 mb-1">
                    คำโปรยรอง
                  </label>
                  <input
                    type="text"
                    value={draftPost.subtitle}
                    onChange={(e) =>
                      setDraftPost({ ...draftPost, subtitle: e.target.value })
                    }
                    className="w-full rounded-xl border-2 border-slate-300 px-4 py-2.5 text-base"
                  />
                </div>

                <div>
                  <label className="block text-sm font-extrabold text-slate-700 mb-1">
                    เนื้อหาข่าว / บทความฉบับเต็ม
                  </label>
                  <textarea
                    rows={12}
                    value={draftPost.content}
                    onChange={(e) =>
                      setDraftPost({ ...draftPost, content: e.target.value })
                    }
                    className="w-full rounded-2xl border-2 border-slate-300 p-4 text-base leading-relaxed"
                  />
                </div>
              </div>
            ) : (
              <div className="rounded-2xl border border-slate-200 bg-[#fcfdff] p-5 sm:p-6 space-y-3">
                <span className="inline-block rounded-full bg-[#0d2546] px-3 py-1 text-xs font-extrabold text-amber-300">
                  หมวด:{' '}
                  {CATEGORIES.find((c) => c.id === draftPost.category)?.nameTh ||
                    'การศึกษา'}
                </span>
                <h4 className="text-xl sm:text-2xl font-extrabold text-[#0d2546]">
                  {draftPost.title}
                </h4>
                {draftPost.subtitle && (
                  <p className="text-base font-bold text-slate-600">
                    {draftPost.subtitle}
                  </p>
                )}
                <div className="pt-2 border-t border-slate-100 prose prose-slate max-w-none text-base leading-relaxed">
                  {renderRichMarkdown(draftPost.content)}
                </div>
              </div>
            )}

            {/* Big Publish / Save Draft / Open Full Editor / Delete Buttons */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2">
              <button
                type="button"
                disabled={publishingDraft}
                onClick={() => handlePublishDraft('published')}
                className="flex items-center justify-center gap-2 rounded-2xl bg-emerald-600 px-5 py-4 text-base font-extrabold text-white hover:bg-emerald-700 cursor-pointer shadow-sm disabled:opacity-50"
              >
                <CheckCircle2 className="w-5 h-5" />
                {publishingDraft ? 'กำลังบันทึก...' : 'ชอบ! บันทึกและลงหน้าเว็บทันที'}
              </button>

              <button
                type="button"
                disabled={publishingDraft}
                onClick={() => handlePublishDraft('draft')}
                className="flex items-center justify-center gap-2 rounded-2xl border-2 border-slate-300 bg-white px-5 py-4 text-base font-extrabold text-slate-700 hover:bg-slate-50 cursor-pointer disabled:opacity-50"
              >
                เก็บเป็นฉบับร่างไว้ก่อน
              </button>

              <button
                type="button"
                onClick={() =>
                  onOpenInPostEditor({
                    title: draftPost.title,
                    subtitle: draftPost.subtitle,
                    excerpt: draftPost.excerpt,
                    content: draftPost.content,
                    category: draftPost.category,
                    contentType: draftVideoUrl ? 'video' : draftPost.contentType,
                    coverImage: draftCoverUrl,
                    videoUrl: draftVideoUrl,
                    tags: draftPost.tags,
                  })
                }
                className="flex items-center justify-center gap-2 rounded-2xl border-2 border-[#0d2546] bg-white px-5 py-4 text-base font-extrabold text-[#0d2546] hover:bg-slate-50 cursor-pointer"
              >
                <Edit3 className="w-5 h-5" />
                เปิดในหน้าจัดการข่าวแบบเต็ม
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
