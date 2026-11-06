import React, { useEffect, useRef, useState } from 'react';
import {
  Bot,
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
  ArrowUp,
  Copy,
  Eye,
  Edit3,
  Wand2,
  X,
  PanelLeftClose,
  PanelLeftOpen,
  Maximize2,
  Minimize2,
  Sun,
  Moon,
  Search,
  ChevronDown,
  SquarePen,
  FileText,
  Globe,
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
  UnifiedLiveModelsResponse,
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
  isTabMenuCollapsed?: boolean;
  onToggleTabMenu?: () => void;
  isFullScreen?: boolean;
  onToggleFullScreen?: () => void;
  onNavigateMenu?: (menuId: string) => void;
  onOpenPublicWebsite?: () => void;
}

const PROVIDER_OPTIONS: {
  id: LlmProviderId;
  label: string;
  shortLabel: string;
  shortDesc: string;
}[] = [
  {
    id: 'auto',
    label: 'อัตโนมัติ (แนะนำ)',
    shortLabel: 'Auto',
    shortDesc: 'เลือกค่ายที่เชื่อมคีย์ไว้และใช้รุ่นล่าสุดให้อัตโนมัติ',
  },
  {
    id: 'gemini',
    label: 'Google Gemini',
    shortLabel: 'Gemini',
    shortDesc: 'รวดเร็ว แม่นยำ เชื่อมรูปภาพและวิดีโอได้ครบ',
  },
  {
    id: 'openai',
    label: 'ChatGPT (OpenAI)',
    shortLabel: 'ChatGPT',
    shortDesc: 'สนทนาลื่นไหล เรียบเรียงบทความและข่าวคมชัด',
  },
  {
    id: 'claude',
    label: 'Claude (Anthropic)',
    shortLabel: 'Claude',
    shortDesc: 'เขียนบทความภาษาไทยสละสลวย ลึกซึ้ง',
  },
  {
    id: 'deepseek',
    label: 'DeepSeek',
    shortLabel: 'DeepSeek',
    shortDesc: 'วิเคราะห์เชิงลึก เหตุผลเป็นระบบ',
  },
];

const QUICK_STARTERS = [
  'ช่วยเขียน Content เกี่ยวกับการศึกษาไทยให้หน่อย',
  'วันนี้อยากทำข่าวเรื่อง AI ช่วยครูไทยลดงานเอกสาร ช่วยวางประเด็นให้หน่อย',
  'อยากได้ไอเดียทำภาพปกข่าวสวยๆ และคลิปสั้นเรื่อง การเรียนรู้ตลอดชีวิต',
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
  isTabMenuCollapsed = false,
  onToggleTabMenu,
  isFullScreen = false,
  onToggleFullScreen,
  onNavigateMenu,
  onOpenPublicWebsite,
}) => {
  const [settings, setSettings] = useState<AiEngineSettings | null>(null);
  const [liveModels, setLiveModels] = useState<UnifiedLiveModelsResponse | null>(null);
  const [refreshingModels, setRefreshingModels] = useState(false);
  const [sessions, setSessions] = useState<AiChatSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string>(() => createSessionId());
  const [messages, setMessages] = useState<AiChatMessage[]>([]);
  const [provider, setProvider] = useState<LlmProviderId>('auto');
  const [selectedModel, setSelectedModel] = useState<string>('');
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);

  // Studio UI States (Dark/Light Qwen-style, Collapsible Chat History Sidebar, Search, Popovers)
  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    try {
      const saved = localStorage.getItem('komkrit_chat_theme');
      return saved === 'light' ? 'light' : 'dark';
    } catch {
      return 'dark';
    }
  });
  const [chatSidebarOpen, setChatSidebarOpen] = useState<boolean>(() => {
    try {
      if (typeof window !== 'undefined' && window.innerWidth < 1024) return false;
      const saved = localStorage.getItem('komkrit_chat_sidebar');
      return saved === '0' ? false : true;
    } catch {
      return true;
    }
  });
  const [searchQuery, setSearchQuery] = useState('');
  const [searchFocused, setSearchFocused] = useState(false);
  const [modelPopoverOpen, setModelPopoverOpen] = useState(false);
  const [plusMenuOpen, setPlusMenuOpen] = useState(false);

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
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const modelDropdownRef = useRef<HTMLDivElement | null>(null);
  const plusMenuRef = useRef<HTMLDivElement | null>(null);

  const isDark = theme === 'dark';

  const toggleTheme = () => {
    setTheme((prev) => {
      const next = prev === 'dark' ? 'light' : 'dark';
      try {
        localStorage.setItem('komkrit_chat_theme', next);
      } catch {
        // ignore
      }
      return next;
    });
  };

  const toggleChatSidebar = (next?: boolean) => {
    setChatSidebarOpen((prev) => {
      const val = typeof next === 'boolean' ? next : !prev;
      try {
        localStorage.setItem('komkrit_chat_sidebar', val ? '1' : '0');
      } catch {
        // ignore
      }
      return val;
    });
  };

  // Close popovers on outside click & exit fullscreen on Escape
  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (
        modelDropdownRef.current &&
        !modelDropdownRef.current.contains(e.target as Node)
      ) {
        setModelPopoverOpen(false);
      }
      if (plusMenuRef.current && !plusMenuRef.current.contains(e.target as Node)) {
        setPlusMenuOpen(false);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (modelPopoverOpen) setModelPopoverOpen(false);
        else if (plusMenuOpen) setPlusMenuOpen(false);
        else if (isFullScreen && onToggleFullScreen) onToggleFullScreen();
      }
    };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [modelPopoverOpen, plusMenuOpen, isFullScreen, onToggleFullScreen]);

  // Auto-resize composer textarea smoothly
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 180)}px`;
  }, [input]);

  const showToast = (msg: string) => {
    setSuccessBanner(msg);
    setTimeout(() => {
      setSuccessBanner((prev) => (prev === msg ? null : prev));
    }, 5000);
  };

  const loadInitial = async () => {
    try {
      const [st, sess, lm] = await Promise.all([
        api.getAiSettings(),
        api.getChatSessions(),
        api.getLiveModels(false),
      ]);
      setSettings(st);
      setSessions(sess);
      setLiveModels(lm);
      if (sess.length > 0 && messages.length === 0) {
        setActiveSessionId(sess[0].sessionId);
        const hist = await api.getChatHistory(sess[0].sessionId);
        setMessages(hist);
      }
    } catch {
      // ignore initial load errors
    }
  };

  const handleRefreshChatModels = async () => {
    setRefreshingModels(true);
    try {
      const lm = await api.getLiveModels(true);
      setLiveModels(lm);
      showToast('ดึงรายชื่อโมเดลล่าสุดจาก API เรียบร้อยแล้ว');
    } catch {
      // ignore
    } finally {
      setRefreshingModels(false);
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
    if (typeof window !== 'undefined' && window.innerWidth < 1024) {
      setChatSidebarOpen(false);
    }
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
    if (typeof window !== 'undefined' && window.innerWidth < 1024) {
      setChatSidebarOpen(false);
    }
    setTimeout(() => textareaRef.current?.focus(), 60);
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
        model: provider !== 'auto' && selectedModel ? selectedModel : undefined,
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
    setPlusMenuOpen(false);
    if (messages.length === 0 && !input.trim() && !customContextText) {
      setErrorBanner(
        'กรุณาพิมพ์สิ่งที่อยากทำในช่องแชทก่อน เพื่อให้ AI ประเมินแนวคิดและเขียน Full Prompt ครับ'
      );
      textareaRef.current?.focus();
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
        model: provider !== 'auto' && selectedModel ? selectedModel : undefined,
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
        showToast('Agent สร้างรูปภาพเสร็จแล้ว! กรุณาตรวจดูตัวอย่างด้านล่างว่าชอบหรือไม่');
      } else {
        const vidAspect: '16:9' | '9:16' = selectedAspect === '9:16' ? '9:16' : '16:9';
        const asset = await api.generateRealVideo({
          prompt: editableFullPrompt.trim(),
          engine: settings?.geminiVideoModel || undefined,
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
    setPlusMenuOpen(false);
    if (messages.length === 0 && !input.trim() && !customText) {
      setErrorBanner(
        'กรุณาพิมพ์หัวข้อข่าวหรือคุยกับ AI ก่อนกดสั่งเขียนข่าวครับ'
      );
      textareaRef.current?.focus();
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
        model: provider !== 'auto' && selectedModel ? selectedModel : undefined,
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

  const isProviderConnected = (pid: LlmProviderId) => {
    if (pid === 'auto') return anyApiKeyConfigured;
    if (pid === 'gemini') return Boolean(settings?.hasGeminiKey);
    if (pid === 'openai') return Boolean(settings?.hasOpenaiKey);
    if (pid === 'claude') return Boolean(settings?.hasClaudeKey);
    if (pid === 'deepseek') return Boolean(settings?.hasDeepseekKey);
    return true;
  };

  const activeProviderMeta =
    PROVIDER_OPTIONS.find((p) => p.id === provider) || PROVIDER_OPTIONS[0];
  const currentCatalog =
    provider !== 'auto' ? liveModels?.providers?.[provider] : undefined;
  const currentTextModels = currentCatalog?.textModels || [];

  const topModelDisplayLabel = (() => {
    if (provider === 'auto') {
      return 'คมคิด AI • Auto';
    }
    if (selectedModel) {
      return `${activeProviderMeta.shortLabel} • ${selectedModel}`;
    }
    const latestLive = currentTextModels[0]?.id;
    return latestLive
      ? `${activeProviderMeta.shortLabel} • ${latestLive}`
      : activeProviderMeta.label;
  })();

  const filteredSessions = sessions.filter((s) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      (s.title || '').toLowerCase().includes(q) ||
      (s.provider || '').toLowerCase().includes(q)
    );
  });

  const isHeroEmpty =
    messages.length === 0 && !evaluatedPrompt && !previewAsset && !draftPost;

  // Reusable Qwen-style Pill Composer (used in both Centered Empty Hero & Sticky Bottom)
  const renderComposerPill = (isCenteredHero: boolean) => (
    <form
      onSubmit={handleSendForm}
      className={`relative w-full transition-all ${
        isDark
          ? 'bg-[#242429] border border-white/12 focus-within:border-white/25 shadow-2xl shadow-black/40'
          : 'bg-white border border-zinc-300 focus-within:border-zinc-500 shadow-md shadow-zinc-200/60'
      } ${isCenteredHero ? 'rounded-[30px] px-3.5 py-2.5' : 'rounded-[28px] px-3.5 py-2'}`}
    >
      <div className="flex items-end gap-2">
        {/* Left '+' Quick-Tools Menu Button */}
        <div ref={plusMenuRef} className="relative shrink-0 pb-0.5">
          <button
            type="button"
            onClick={() => setPlusMenuOpen((v) => !v)}
            title="คำสั่งพิเศษ: เขียนข่าว / ประเมิน Full Prompt รูป-วิดีโอ"
            className={`flex h-9 w-9 items-center justify-center rounded-full transition cursor-pointer ${
              isDark
                ? 'text-zinc-300 hover:bg-white/10 hover:text-white'
                : 'text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900'
            }`}
          >
            <Plus className="w-5 h-5" />
          </button>

          {plusMenuOpen && (
            <div
              className={`absolute left-0 bottom-12 z-40 w-72 rounded-2xl p-2 shadow-2xl border ${
                isDark
                  ? 'bg-[#1f1f24] border-white/15 text-zinc-100'
                  : 'bg-white border-zinc-200 text-zinc-800'
              }`}
            >
              <div
                className={`px-3 py-1.5 text-[11px] font-extrabold ${
                  isDark ? 'text-zinc-400' : 'text-zinc-500'
                }`}
              >
                สั่ง AI ทำงานต่อทันที
              </div>
              <button
                type="button"
                onClick={() => handleDraftNewsFromChat('news')}
                className={`w-full flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-sm font-bold transition cursor-pointer ${
                  isDark ? 'hover:bg-white/10' : 'hover:bg-zinc-100'
                }`}
              >
                <Newspaper className="w-4 h-4 text-emerald-500 shrink-0" />
                <span>ให้ AI เขียนข่าว / บทความลงเว็บ</span>
              </button>
              <button
                type="button"
                onClick={() => handleEvaluatePrompt('image')}
                className={`w-full flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-sm font-bold transition cursor-pointer ${
                  isDark ? 'hover:bg-white/10' : 'hover:bg-zinc-100'
                }`}
              >
                <ImageIcon className="w-4 h-4 text-amber-500 shrink-0" />
                <span>ประเมิน & เขียน Full Prompt รูปภาพ</span>
              </button>
              <button
                type="button"
                onClick={() => handleEvaluatePrompt('video')}
                className={`w-full flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-sm font-bold transition cursor-pointer ${
                  isDark ? 'hover:bg-white/10' : 'hover:bg-zinc-100'
                }`}
              >
                <Film className="w-4 h-4 text-indigo-400 shrink-0" />
                <span>ประเมิน & เขียน Full Prompt วิดีโอ</span>
              </button>
              <div
                className={`my-1 border-t ${
                  isDark ? 'border-white/10' : 'border-zinc-100'
                }`}
              />
              <button
                type="button"
                onClick={() => {
                  setPlusMenuOpen(false);
                  handleNewChat();
                }}
                className={`w-full flex items-center gap-2.5 rounded-xl px-3 py-2 text-left text-xs font-bold transition cursor-pointer ${
                  isDark
                    ? 'text-zinc-300 hover:bg-white/10'
                    : 'text-zinc-600 hover:bg-zinc-100'
                }`}
              >
                <SquarePen className="w-4 h-4 shrink-0" />
                <span>เริ่มบทสนทนาใหม่</span>
              </button>
            </div>
          )}
        </div>

        {/* Auto-expanding Textarea */}
        <textarea
          ref={textareaRef}
          rows={1}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              sendMessageText(input);
            }
          }}
          placeholder="ช่วยเขียน Content เกี่ยวกับการศึกษาไทยให้หน่อย..."
          className={`flex-1 max-h-44 bg-transparent py-2 px-1 text-[15px] sm:text-base leading-relaxed focus:outline-none resize-none ${
            isDark
              ? 'text-zinc-100 placeholder:text-zinc-400'
              : 'text-zinc-900 placeholder:text-zinc-400'
          }`}
        />

        {/* Inline Provider Selector ('Auto ▾') + Circular '↑' Send Button */}
        <div className="flex items-center gap-1.5 shrink-0 pb-0.5">
          <div className="relative">
            <select
              aria-label="เลือกค่าย AI"
              value={provider}
              onChange={(e) => {
                setProvider(e.target.value as LlmProviderId);
                setSelectedModel('');
              }}
              className={`appearance-none rounded-full pl-3 pr-7 py-1.5 text-xs sm:text-sm font-bold cursor-pointer focus:outline-none transition ${
                isDark
                  ? 'bg-transparent text-zinc-300 hover:bg-white/10'
                  : 'bg-transparent text-zinc-600 hover:bg-zinc-100'
              }`}
            >
              {PROVIDER_OPTIONS.map((p) => (
                <option
                  key={p.id}
                  value={p.id}
                  className="bg-zinc-900 text-white"
                >
                  {p.shortLabel}
                </option>
              ))}
            </select>
            <ChevronDown
              className={`pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 ${
                isDark ? 'text-zinc-400' : 'text-zinc-500'
              }`}
            />
          </div>

          <button
            type="submit"
            disabled={sending || !input.trim()}
            title="ส่งข้อความ (Enter)"
            className={`flex h-9 w-9 items-center justify-center rounded-full transition cursor-pointer shrink-0 ${
              isDark
                ? 'bg-white text-zinc-950 hover:bg-zinc-200 disabled:bg-zinc-700 disabled:text-zinc-500'
                : 'bg-zinc-900 text-white hover:bg-zinc-700 disabled:bg-zinc-200 disabled:text-zinc-400'
            }`}
          >
            {sending ? (
              <RefreshCw className="w-4 h-4 animate-spin" />
            ) : (
              <ArrowUp className="w-5 h-5 stroke-[2.5]" />
            )}
          </button>
        </div>
      </div>
    </form>
  );

  return (
    <div
      className={`${
        isFullScreen
          ? 'fixed inset-0 z-50 h-screen w-screen'
          : 'relative flex-1 h-full w-full min-h-0'
      } flex overflow-hidden select-text ${
        isDark ? 'bg-[#141416] text-zinc-100' : 'bg-white text-zinc-900'
      }`}
    >
      {/* Mobile Backdrop for Chat History Sidebar */}
      {chatSidebarOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/50 lg:hidden"
          onClick={() => toggleChatSidebar(false)}
        />
      )}

      {/* =================================================================== */}
      {/* LEFT COLLAPSIBLE CHAT HISTORY & STUDIO SIDEBAR (Qwen Style)         */}
      {/* =================================================================== */}
      <aside
        className={`${
          chatSidebarOpen
            ? 'translate-x-0 w-[268px]'
            : '-translate-x-full w-0 lg:w-0 overflow-hidden border-r-0'
        } fixed lg:static inset-y-0 left-0 z-40 flex flex-col justify-between shrink-0 transition-all duration-200 border-r ${
          isDark
            ? 'bg-[#1b1b1f] border-white/10 text-zinc-200'
            : 'bg-[#f7f7f8] border-zinc-200/90 text-zinc-800'
        }`}
      >
        <div className="flex flex-col flex-1 min-h-0 w-[268px]">
          {/* Sidebar Brand + Collapse [|<] Button */}
          <div className="h-14 px-3.5 flex items-center justify-between shrink-0">
            <div className="flex items-center gap-2.5 min-w-0">
              <div
                className={`flex h-7 w-7 items-center justify-center rounded-lg font-extrabold text-xs shrink-0 ${
                  isDark
                    ? 'bg-amber-400 text-zinc-950'
                    : 'bg-[#0d2546] text-amber-300'
                }`}
              >
                <Sparkles className="w-4 h-4" />
              </div>
              <span className="font-extrabold text-base tracking-tight truncate">
                คมคิด AI
              </span>
            </div>

            <button
              type="button"
              onClick={() => toggleChatSidebar(false)}
              title="ซ่อนแถบประวัติแชท"
              className={`p-1.5 rounded-lg transition cursor-pointer ${
                isDark
                  ? 'text-zinc-400 hover:text-white hover:bg-white/10'
                  : 'text-zinc-500 hover:text-zinc-900 hover:bg-zinc-200/70'
              }`}
            >
              <PanelLeftClose className="w-4 h-4" />
            </button>
          </div>

          {/* Primary Actions: New Chat, Search Chats, Quick Studio Links */}
          <div className="px-2.5 space-y-1 shrink-0">
            <button
              type="button"
              onClick={handleNewChat}
              className={`w-full flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm font-bold transition cursor-pointer ${
                isDark
                  ? 'text-zinc-100 hover:bg-white/10'
                  : 'text-zinc-800 hover:bg-zinc-200/70'
              }`}
            >
              <SquarePen className="w-4 h-4 shrink-0" />
              <span>แชทใหม่ (New Chat)</span>
            </button>

            <div
              className={`flex items-center gap-2 rounded-xl px-3 py-2 text-sm transition ${
                searchFocused
                  ? isDark
                    ? 'bg-white/10 ring-1 ring-white/20'
                    : 'bg-white ring-1 ring-zinc-300'
                  : isDark
                  ? 'hover:bg-white/5 text-zinc-300'
                  : 'hover:bg-zinc-200/60 text-zinc-700'
              }`}
              onClick={() => searchInputRef.current?.focus()}
            >
              <Search className="w-4 h-4 shrink-0 opacity-70" />
              <input
                ref={searchInputRef}
                type="text"
                value={searchQuery}
                onFocus={() => setSearchFocused(true)}
                onBlur={() => setSearchFocused(false)}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="ค้นหาแชท..."
                className="w-full bg-transparent text-sm focus:outline-none placeholder:opacity-70"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="opacity-60 hover:opacity-100 cursor-pointer"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            {/* Studio Quick Navigation (Works seamlessly even in 100% Fullscreen) */}
            {onNavigateMenu && (
              <div className="pt-1 space-y-0.5">
                <button
                  type="button"
                  onClick={() => onNavigateMenu('media-gen')}
                  className={`w-full flex items-center justify-between rounded-xl px-3 py-2 text-xs font-bold transition cursor-pointer ${
                    isDark
                      ? 'text-zinc-300 hover:bg-white/10'
                      : 'text-zinc-700 hover:bg-zinc-200/70'
                  }`}
                >
                  <span className="flex items-center gap-2.5">
                    <ImageIcon className="w-4 h-4 text-amber-400 shrink-0" />
                    สร้างรูปภาพ & วิดีโอ AI
                  </span>
                  <ArrowRight className="w-3.5 h-3.5 opacity-50" />
                </button>
                <button
                  type="button"
                  onClick={() => onNavigateMenu('posts')}
                  className={`w-full flex items-center justify-between rounded-xl px-3 py-2 text-xs font-bold transition cursor-pointer ${
                    isDark
                      ? 'text-zinc-300 hover:bg-white/10'
                      : 'text-zinc-700 hover:bg-zinc-200/70'
                  }`}
                >
                  <span className="flex items-center gap-2.5">
                    <FileText className="w-4 h-4 text-sky-400 shrink-0" />
                    จัดการข่าวและบทความ
                  </span>
                  <ArrowRight className="w-3.5 h-3.5 opacity-50" />
                </button>
              </div>
            )}
          </div>

          {/* All Chats Scrollable History */}
          <div className="mt-4 px-2.5 flex-1 flex flex-col min-h-0">
            <div
              className={`px-2.5 pb-1.5 text-[11px] font-extrabold uppercase tracking-wider flex items-center justify-between ${
                isDark ? 'text-zinc-500' : 'text-zinc-400'
              }`}
            >
              <span>ประวัติแชททั้งหมด ({filteredSessions.length})</span>
            </div>

            <div className="flex-1 overflow-y-auto space-y-0.5 pr-1">
              {filteredSessions.length === 0 ? (
                <div
                  className={`px-3 py-6 text-center text-xs ${
                    isDark ? 'text-zinc-500' : 'text-zinc-400'
                  }`}
                >
                  {searchQuery
                    ? 'ไม่พบแชทที่ค้นหา'
                    : 'ยังไม่มีประวัติการสนทนา เริ่มพิมพ์คุยได้เลยครับ'}
                </div>
              ) : (
                filteredSessions.map((s) => {
                  const active = s.sessionId === activeSessionId;
                  return (
                    <div
                      key={s.sessionId}
                      onClick={() => handleSelectSession(s.sessionId)}
                      className={`group flex items-center justify-between gap-2 rounded-xl px-3 py-2.5 text-sm cursor-pointer transition ${
                        active
                          ? isDark
                            ? 'bg-white/12 text-white font-bold'
                            : 'bg-zinc-200/90 text-zinc-950 font-bold'
                          : isDark
                          ? 'text-zinc-300 hover:bg-white/6'
                          : 'text-zinc-700 hover:bg-zinc-200/50'
                      }`}
                    >
                      <span className="truncate flex-1">
                        {s.title || 'บทสนทนา AI'}
                      </span>
                      <button
                        type="button"
                        onClick={(e) => handleDeleteSession(s.sessionId, e)}
                        title="ลบแชทนี้"
                        className={`opacity-0 group-hover:opacity-100 p-1 rounded-md transition cursor-pointer shrink-0 ${
                          isDark
                            ? 'text-zinc-400 hover:text-rose-400 hover:bg-white/10'
                            : 'text-zinc-400 hover:text-rose-600 hover:bg-zinc-300/50'
                        }`}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>

        {/* Sidebar Bottom User / Key Status Bar */}
        <div
          className={`w-[268px] p-3 border-t flex items-center justify-between gap-2 shrink-0 ${
            isDark ? 'border-white/10' : 'border-zinc-200'
          }`}
        >
          <button
            type="button"
            onClick={onOpenSettings}
            className="flex items-center gap-2.5 min-w-0 text-left cursor-pointer"
          >
            <div
              className={`h-8 w-8 rounded-full flex items-center justify-center text-xs font-extrabold shrink-0 ${
                anyApiKeyConfigured
                  ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40'
                  : 'bg-amber-500/20 text-amber-400 border border-amber-500/40'
              }`}
            >
              K
            </div>
            <div className="min-w-0">
              <div className="text-xs font-extrabold truncate">คมคิด Admin</div>
              <div
                className={`text-[11px] truncate ${
                  anyApiKeyConfigured ? 'text-emerald-500' : 'text-amber-500'
                }`}
              >
                {anyApiKeyConfigured ? '🔒 คีย์เข้ารหัสพร้อมใช้' : 'คลิกตั้งค่าคีย์ AI'}
              </div>
            </div>
          </button>

          {onOpenPublicWebsite && (
            <button
              type="button"
              onClick={onOpenPublicWebsite}
              title="เปิดดูหน้าเว็บจริง"
              className={`rounded-lg px-2.5 py-1.5 text-xs font-bold border transition cursor-pointer shrink-0 inline-flex items-center gap-1 ${
                isDark
                  ? 'border-white/15 text-zinc-200 hover:bg-white/10'
                  : 'border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-100'
              }`}
            >
              <Globe className="w-3.5 h-3.5" />
              เว็บจริง
            </button>
          )}
        </div>
      </aside>

      {/* =================================================================== */}
      {/* MAIN FULL-SCREEN CHAT CANVAS                                        */}
      {/* =================================================================== */}
      <div className="flex-1 flex flex-col min-w-0 h-full overflow-hidden">
        {/* Minimal Qwen-Style Top Bar */}
        <header className="h-14 px-3 sm:px-5 flex items-center justify-between gap-2 shrink-0">
          {/* Top-Left: Reopen Sidebar [>|] + Model/Provider Selector Dropdown */}
          <div className="flex items-center gap-1.5 min-w-0">
            {!chatSidebarOpen && (
              <>
                <button
                  type="button"
                  onClick={() => toggleChatSidebar(true)}
                  title="เปิดแถบประวัติแชท"
                  className={`p-2 rounded-xl transition cursor-pointer ${
                    isDark
                      ? 'text-zinc-300 hover:bg-white/10 hover:text-white'
                      : 'text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900'
                  }`}
                >
                  <PanelLeftOpen className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={handleNewChat}
                  title="เริ่มแชทใหม่"
                  className={`p-2 rounded-xl transition cursor-pointer ${
                    isDark
                      ? 'text-zinc-300 hover:bg-white/10 hover:text-white'
                      : 'text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900'
                  }`}
                >
                  <SquarePen className="w-4 h-4" />
                </button>
              </>
            )}

            {/* Qwen-Style Top-Left Model & Provider Dropdown */}
            <div ref={modelDropdownRef} className="relative">
              <button
                type="button"
                onClick={() => setModelPopoverOpen((v) => !v)}
                className={`inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-sm sm:text-base font-extrabold transition cursor-pointer max-w-[220px] sm:max-w-[340px] ${
                  isDark
                    ? 'text-zinc-100 hover:bg-white/10'
                    : 'text-zinc-900 hover:bg-zinc-100'
                }`}
              >
                <span className="truncate">{topModelDisplayLabel}</span>
                <ChevronDown className="w-4 h-4 opacity-70 shrink-0" />
              </button>

              {modelPopoverOpen && (
                <div
                  className={`absolute left-0 top-11 z-50 w-80 sm:w-96 rounded-2xl p-3 shadow-2xl border space-y-2.5 ${
                    isDark
                      ? 'bg-[#1f1f24] border-white/15 text-zinc-100'
                      : 'bg-white border-zinc-200 text-zinc-900'
                  }`}
                >
                  <div className="flex items-center justify-between px-1">
                    <span className="text-xs font-extrabold opacity-75">
                      เลือกค่าย AI และรุ่นโมเดลสดจาก API
                    </span>
                    <button
                      type="button"
                      disabled={refreshingModels}
                      onClick={handleRefreshChatModels}
                      className={`inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-bold cursor-pointer ${
                        isDark
                          ? 'bg-white/10 hover:bg-white/15 text-amber-300'
                          : 'bg-zinc-100 hover:bg-zinc-200 text-[#0d2546]'
                      }`}
                    >
                      <RefreshCw
                        className={`w-3 h-3 ${refreshingModels ? 'animate-spin' : ''}`}
                      />
                      ดึงรุ่นล่าสุด
                    </button>
                  </div>

                  <div className="space-y-1">
                    {PROVIDER_OPTIONS.map((p) => {
                      const active = provider === p.id;
                      const connected = isProviderConnected(p.id);
                      return (
                        <button
                          key={p.id}
                          type="button"
                          onClick={() => {
                            setProvider(p.id);
                            setSelectedModel('');
                          }}
                          className={`w-full flex items-start justify-between gap-2 rounded-xl px-3 py-2 text-left transition cursor-pointer ${
                            active
                              ? isDark
                                ? 'bg-white/15 text-white'
                                : 'bg-[#0d2546] text-white'
                              : isDark
                              ? 'hover:bg-white/8 text-zinc-200'
                              : 'hover:bg-zinc-100 text-zinc-800'
                          }`}
                        >
                          <div>
                            <div className="text-sm font-extrabold flex items-center gap-2">
                              <span>{p.label}</span>
                            </div>
                            <div
                              className={`text-[11px] ${
                                active
                                  ? 'text-amber-300'
                                  : isDark
                                  ? 'text-zinc-400'
                                  : 'text-zinc-500'
                              }`}
                            >
                              {p.shortDesc}
                            </div>
                          </div>
                          <span
                            className={`mt-1 inline-block h-2.5 w-2.5 rounded-full shrink-0 ${
                              connected ? 'bg-emerald-400' : 'bg-zinc-500/50'
                            }`}
                            title={connected ? 'เชื่อมต่อคีย์แล้ว' : 'ยังไม่ใส่คีย์'}
                          />
                        </button>
                      );
                    })}
                  </div>

                  {provider !== 'auto' && (
                    <div
                      className={`pt-2 border-t space-y-1.5 ${
                        isDark ? 'border-white/10' : 'border-zinc-200'
                      }`}
                    >
                      <label className="block text-[11px] font-extrabold opacity-75">
                        รุ่นโมเดลสดจาก API ({currentTextModels.length} รุ่น):
                      </label>
                      <select
                        value={selectedModel}
                        onChange={(e) => {
                          setSelectedModel(e.target.value);
                          setModelPopoverOpen(false);
                        }}
                        className={`w-full rounded-xl border px-3 py-2 text-xs font-bold focus:outline-none ${
                          isDark
                            ? 'bg-[#141416] border-white/15 text-zinc-100'
                            : 'bg-zinc-50 border-zinc-300 text-zinc-900'
                        }`}
                      >
                        <option value="">
                          ✨ อัตโนมัติ (ใช้รุ่นใหม่ล่าสุดจาก API)
                        </option>
                        {currentTextModels.map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Top-Right Controls: API Key Badge, Theme Switch, Tab Menu Toggle, Fullscreen Toggle */}
          <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
            {!anyApiKeyConfigured && settings && (
              <button
                type="button"
                onClick={onOpenSettings}
                className="inline-flex items-center gap-1.5 rounded-full bg-amber-400 px-3 py-1.5 text-xs font-extrabold text-zinc-950 hover:bg-amber-300 transition cursor-pointer"
              >
                <KeyRound className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">ใส่คีย์ AI</span>
              </button>
            )}

            {/* Dark / Light Theme Switch */}
            <button
              type="button"
              onClick={toggleTheme}
              title={isDark ? 'สลับเป็นโหมดสว่าง' : 'สลับเป็นโหมดมืด'}
              className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-bold border transition cursor-pointer ${
                isDark
                  ? 'border-white/15 bg-white/5 text-zinc-200 hover:bg-white/12'
                  : 'border-zinc-200 bg-zinc-100 text-zinc-700 hover:bg-zinc-200'
              }`}
            >
              {isDark ? (
                <>
                  <Sun className="w-3.5 h-3.5 text-amber-300" />
                  <span className="hidden md:inline">โหมดสว่าง</span>
                </>
              ) : (
                <>
                  <Moon className="w-3.5 h-3.5 text-indigo-600" />
                  <span className="hidden md:inline">โหมดมืด</span>
                </>
              )}
            </button>

            {/* Close / Open Admin Left Tab Menu (Desktop, when not in fixed Fullscreen) */}
            {!isFullScreen && onToggleTabMenu && (
              <button
                type="button"
                onClick={onToggleTabMenu}
                title={
                  isTabMenuCollapsed
                    ? 'เปิดแสดงแถบเมนูแท็บหลังบ้าน'
                    : 'พับปิดแถบเมนูแท็บหลังบ้านเพื่อให้หน้าแชทกว้างขึ้น'
                }
                className={`hidden lg:inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-bold border transition cursor-pointer ${
                  isDark
                    ? 'border-white/15 bg-white/5 text-zinc-200 hover:bg-white/12'
                    : 'border-zinc-200 bg-zinc-100 text-zinc-700 hover:bg-zinc-200'
                }`}
              >
                {isTabMenuCollapsed ? (
                  <>
                    <PanelLeftOpen className="w-3.5 h-3.5" />
                    <span>เปิดเมนูแท็บ</span>
                  </>
                ) : (
                  <>
                    <PanelLeftClose className="w-3.5 h-3.5" />
                    <span>ปิดเมนูแท็บ</span>
                  </>
                )}
              </button>
            )}

            {/* 100% Fullscreen Toggle */}
            {onToggleFullScreen && (
              <button
                type="button"
                onClick={onToggleFullScreen}
                title={
                  isFullScreen
                    ? 'ออกจากโหมดเต็มจอ (กด Esc ได้)'
                    : 'ขยายหน้า AI Chat เต็มจอ 100%'
                }
                className={`inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-extrabold transition cursor-pointer ${
                  isFullScreen
                    ? isDark
                      ? 'bg-amber-400 text-zinc-950 hover:bg-amber-300'
                      : 'bg-[#0d2546] text-white hover:bg-[#163a6b]'
                    : isDark
                    ? 'bg-white text-zinc-950 hover:bg-zinc-200'
                    : 'bg-zinc-900 text-white hover:bg-zinc-800'
                }`}
              >
                {isFullScreen ? (
                  <>
                    <Minimize2 className="w-3.5 h-3.5" />
                    <span>ย่อกลับ</span>
                  </>
                ) : (
                  <>
                    <Maximize2 className="w-3.5 h-3.5" />
                    <span>เต็มจอ</span>
                  </>
                )}
              </button>
            )}
          </div>
        </header>

        {/* Floating Alerts (Error / Toast) */}
        {(errorBanner || successBanner) && (
          <div className="px-4 sm:px-6 pt-1 shrink-0 max-w-3xl w-full mx-auto space-y-2">
            {errorBanner && (
              <div className="rounded-2xl border border-rose-500/40 bg-rose-500/10 px-4 py-3 flex flex-wrap items-center justify-between gap-2 text-sm">
                <div className="flex items-start gap-2.5">
                  <AlertTriangle className="w-5 h-5 text-rose-500 shrink-0 mt-0.5" />
                  <span
                    className={`font-bold ${
                      isDark ? 'text-rose-200' : 'text-rose-900'
                    }`}
                  >
                    {errorBanner}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  {errorBanner.includes('API Key') && (
                    <button
                      type="button"
                      onClick={onOpenSettings}
                      className="rounded-lg bg-rose-600 px-3 py-1 text-xs font-extrabold text-white hover:bg-rose-700 cursor-pointer"
                    >
                      ไปหน้าใส่คีย์ AI
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setErrorBanner(null)}
                    className="p-1 opacity-70 hover:opacity-100 cursor-pointer"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>
            )}

            {successBanner && (
              <div className="rounded-2xl border border-emerald-500/40 bg-emerald-500/10 px-4 py-2.5 flex items-center gap-2.5 text-sm">
                <CheckCircle2 className="w-5 h-5 text-emerald-500 shrink-0" />
                <span
                  className={`font-bold ${
                    isDark ? 'text-emerald-200' : 'text-emerald-900'
                  }`}
                >
                  {successBanner}
                </span>
              </div>
            )}
          </div>
        )}

        {/* ================================================================= */}
        {/* BODY: CENTERED HERO EMPTY STATE vs ACTIVE CONVERSATION + STUDIO   */}
        {/* ================================================================= */}
        {isHeroEmpty ? (
          <div className="flex-1 flex flex-col items-center justify-center px-4 sm:px-6 pb-10 overflow-y-auto">
            <div className="w-full max-w-3xl space-y-7">
              <div className="text-center space-y-2">
                <h2
                  className={`text-2xl sm:text-3xl font-semibold tracking-tight ${
                    isDark ? 'text-zinc-100' : 'text-zinc-900'
                  }`}
                >
                  วันนี้ให้ AI ช่วยคิดหรือสร้างงานอะไรดีครับ?
                </h2>
              </div>

              {/* Centered Qwen-Style Pill Input Bar */}
              {renderComposerPill(true)}

              {/* Quick 1-Click Studio Action Pills */}
              <div className="flex flex-wrap items-center justify-center gap-2">
                <button
                  type="button"
                  disabled={draftingFormat !== null}
                  onClick={() => handleDraftNewsFromChat('news')}
                  className={`inline-flex items-center gap-2 rounded-full px-4 py-2 text-xs sm:text-sm font-bold border transition cursor-pointer ${
                    isDark
                      ? 'border-white/12 bg-white/5 text-zinc-200 hover:bg-white/10'
                      : 'border-zinc-200 bg-zinc-50 text-zinc-700 hover:bg-zinc-100'
                  }`}
                >
                  <Newspaper className="w-4 h-4 text-emerald-500" />
                  เขียนข่าว / คอนเทนต์ลงเว็บ
                </button>
                <button
                  type="button"
                  disabled={evaluatingTarget !== null}
                  onClick={() => handleEvaluatePrompt('image')}
                  className={`inline-flex items-center gap-2 rounded-full px-4 py-2 text-xs sm:text-sm font-bold border transition cursor-pointer ${
                    isDark
                      ? 'border-white/12 bg-white/5 text-zinc-200 hover:bg-white/10'
                      : 'border-zinc-200 bg-zinc-50 text-zinc-700 hover:bg-zinc-100'
                  }`}
                >
                  <ImageIcon className="w-4 h-4 text-amber-400" />
                  ประเมิน & เขียน Full Prompt รูปภาพ
                </button>
                <button
                  type="button"
                  disabled={evaluatingTarget !== null}
                  onClick={() => handleEvaluatePrompt('video')}
                  className={`inline-flex items-center gap-2 rounded-full px-4 py-2 text-xs sm:text-sm font-bold border transition cursor-pointer ${
                    isDark
                      ? 'border-white/12 bg-white/5 text-zinc-200 hover:bg-white/10'
                      : 'border-zinc-200 bg-zinc-50 text-zinc-700 hover:bg-zinc-100'
                  }`}
                >
                  <Film className="w-4 h-4 text-indigo-400" />
                  ประเมิน & เขียน Full Prompt วิดีโอ
                </button>
              </div>

              {/* Starter Prompts */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-1">
                {QUICK_STARTERS.map((q, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => sendMessageText(q)}
                    className={`text-left rounded-2xl border px-4 py-3 text-xs sm:text-sm transition cursor-pointer ${
                      isDark
                        ? 'border-white/10 bg-[#1b1b1f]/80 text-zinc-300 hover:bg-white/8 hover:border-white/20'
                        : 'border-zinc-200 bg-zinc-50/70 text-zinc-700 hover:bg-zinc-100 hover:border-zinc-300'
                    }`}
                  >
                    “{q}”
                  </button>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <>
            {/* Active Conversation + Workbench Scroll Area */}
            <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-5">
              <div className="max-w-3xl w-full mx-auto space-y-6">
                {messages.map((m) => {
                  const isUser = m.role === 'user';
                  return (
                    <div
                      key={m.id}
                      className={`flex flex-col ${
                        isUser ? 'items-end' : 'items-start'
                      }`}
                    >
                      {isUser ? (
                        <div
                          className={`max-w-[88%] sm:max-w-[78%] rounded-3xl rounded-br-lg px-5 py-3.5 text-[15px] sm:text-base leading-relaxed whitespace-pre-wrap ${
                            isDark
                              ? 'bg-[#2a2a30] text-zinc-100 border border-white/10'
                              : 'bg-zinc-100 text-zinc-900 border border-zinc-200/80'
                          }`}
                        >
                          {m.content}
                        </div>
                      ) : (
                        <div className="w-full space-y-2.5">
                          <div className="flex items-center justify-between gap-3">
                            <span
                              className={`inline-flex items-center gap-2 text-xs font-extrabold ${
                                isDark ? 'text-zinc-300' : 'text-zinc-700'
                              }`}
                            >
                              <span
                                className={`inline-flex h-6 w-6 items-center justify-center rounded-full ${
                                  isDark
                                    ? 'bg-amber-400/20 text-amber-300'
                                    : 'bg-[#0d2546] text-amber-300'
                                }`}
                              >
                                <Bot className="w-3.5 h-3.5" />
                              </span>
                              {m.provider}
                              {m.model ? ` • ${m.model}` : ''}
                            </span>
                            <button
                              type="button"
                              onClick={() => {
                                navigator.clipboard?.writeText(m.content);
                                showToast('คัดลอกข้อความ AI เรียบร้อยแล้ว');
                              }}
                              className={`inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-bold transition cursor-pointer ${
                                isDark
                                  ? 'text-zinc-400 hover:text-white hover:bg-white/10'
                                  : 'text-zinc-500 hover:text-zinc-900 hover:bg-zinc-100'
                              }`}
                            >
                              <Copy className="w-3.5 h-3.5" /> คัดลอก
                            </button>
                          </div>

                          <div
                            className={`rounded-2xl px-4 sm:px-5 py-4 border ${
                              isDark
                                ? 'bg-[#1b1b1f] border-white/10 text-zinc-100 prose prose-invert max-w-none'
                                : 'bg-white border-zinc-200 text-zinc-800 prose prose-slate max-w-none shadow-2xs'
                            } text-[15px] sm:text-base leading-relaxed`}
                          >
                            {renderRichMarkdown(m.content)}
                          </div>

                          {/* 1-Click Handoff Action Pills beneath every AI turn */}
                          <div className="flex flex-wrap items-center gap-2 pt-0.5">
                            <button
                              type="button"
                              onClick={() => handleEvaluatePrompt('image', m.content)}
                              disabled={evaluatingTarget !== null}
                              className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-bold border transition cursor-pointer disabled:opacity-50 ${
                                isDark
                                  ? 'border-amber-400/30 bg-amber-400/10 text-amber-200 hover:bg-amber-400/20'
                                  : 'border-amber-300 bg-amber-50 text-amber-950 hover:bg-amber-100'
                              }`}
                            >
                              <ImageIcon className="w-3.5 h-3.5 text-amber-500" />
                              เขียน Full Prompt รูปภาพ
                            </button>
                            <button
                              type="button"
                              onClick={() => handleEvaluatePrompt('video', m.content)}
                              disabled={evaluatingTarget !== null}
                              className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-bold border transition cursor-pointer disabled:opacity-50 ${
                                isDark
                                  ? 'border-indigo-400/30 bg-indigo-400/10 text-indigo-200 hover:bg-indigo-400/20'
                                  : 'border-indigo-200 bg-indigo-50 text-indigo-950 hover:bg-indigo-100'
                              }`}
                            >
                              <Film className="w-3.5 h-3.5 text-indigo-500" />
                              เขียน Full Prompt วิดีโอ
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDraftNewsFromChat('news', m.content)}
                              disabled={draftingFormat !== null}
                              className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-bold border transition cursor-pointer disabled:opacity-50 ${
                                isDark
                                  ? 'border-emerald-400/30 bg-emerald-400/10 text-emerald-200 hover:bg-emerald-400/20'
                                  : 'border-emerald-300 bg-emerald-50 text-emerald-950 hover:bg-emerald-100'
                              }`}
                            >
                              <Newspaper className="w-3.5 h-3.5 text-emerald-500" />
                              นำไปเขียนข่าวลงเว็บ
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}

                {sending && (
                  <div
                    className={`inline-flex items-center gap-2.5 rounded-2xl px-4 py-3 text-sm font-bold border ${
                      isDark
                        ? 'bg-[#1b1b1f] border-white/10 text-zinc-200'
                        : 'bg-zinc-50 border-zinc-200 text-zinc-800'
                    }`}
                  >
                    <RefreshCw className="w-4 h-4 animate-spin text-amber-400" />
                    AI กำลังคิดและพิมพ์คำตอบให้ครับ...
                  </div>
                )}

                {/* =========================================================== */}
                {/* INLINE WORKBENCH CARDS (PROMPT EVAL / RECHECK / NEWS DRAFT) */}
                {/* =========================================================== */}
                <div ref={actionPanelRef} className="space-y-5">
                  {/* 1) AI PROMPT EVALUATION & DISPATCH TO IMAGE/VDO AGENT */}
                  {evaluatedPrompt && (
                    <div className="rounded-3xl border-2 border-amber-400 bg-white text-slate-900 p-5 sm:p-6 shadow-xl space-y-5">
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
                          type="button"
                          onClick={() => setEvaluatedPrompt(null)}
                          className="inline-flex items-center gap-1 rounded-xl bg-slate-100 px-3 py-2 text-sm font-bold text-slate-600 hover:bg-slate-200 cursor-pointer"
                        >
                          <X className="w-4 h-4" /> ปิดกล่องนี้
                        </button>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="rounded-2xl bg-amber-50/70 border border-amber-200 p-4 space-y-1.5">
                          <div className="text-sm font-extrabold text-amber-950">
                            💡 ผลการประเมินแนวคิดโดย AI:
                          </div>
                          <p className="text-sm sm:text-base text-slate-800 leading-relaxed">
                            {evaluatedPrompt.assessmentThai}
                          </p>
                        </div>
                        <div className="rounded-2xl bg-sky-50/70 border border-sky-200 p-4 space-y-1.5">
                          <div className="text-sm font-extrabold text-sky-950">
                            🖼️ ภาพ/ฉากที่จะได้จาก Prompt นี้:
                          </div>
                          <p className="text-sm sm:text-base text-slate-800 leading-relaxed">
                            {evaluatedPrompt.visualSummaryThai}
                          </p>
                        </div>
                      </div>

                      <div className="space-y-2">
                        <label className="block text-sm font-extrabold text-[#0d2546]">
                          เลือกสัดส่วนผลงาน:
                        </label>
                        <div className="flex flex-wrap gap-2">
                          {(evaluatedPrompt.target === 'video'
                            ? ([
                                { id: '16:9', label: 'แนวนอน 16:9 (ลงเว็บ / YouTube)' },
                                { id: '9:16', label: 'แนวตั้ง 9:16 (คลิปสั้น มือถือ)' },
                              ] as const)
                            : ([
                                { id: '16:9', label: 'แนวนอน 16:9 (ภาพปกข่าวบนเว็บ)' },
                                { id: '1:1', label: 'จัตุรัส 1:1 (Facebook / LINE)' },
                                { id: '9:16', label: 'แนวตั้ง 9:16 (จอมือถือ)' },
                              ] as const)
                          ).map((opt) => (
                            <button
                              key={opt.id}
                              type="button"
                              onClick={() => setSelectedAspect(opt.id)}
                              className={`rounded-xl px-4 py-2 text-xs sm:text-sm font-extrabold border-2 transition cursor-pointer ${
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

                      <div className="space-y-2">
                        <label className="block text-sm font-extrabold text-[#0d2546]">
                          Full Prompt สำหรับส่งให้ Agent (ตรวจสอบหรือแก้ไขได้):
                        </label>
                        <textarea
                          rows={4}
                          value={editableFullPrompt}
                          onChange={(e) => setEditableFullPrompt(e.target.value)}
                          className="w-full rounded-2xl border-2 border-slate-300 p-3.5 text-sm sm:text-base text-slate-800 focus:border-[#0d2546] focus:outline-none"
                        />
                      </div>

                      <div className="flex flex-wrap items-center gap-3">
                        <button
                          type="button"
                          onClick={handleRunMediaAgentNow}
                          disabled={agentGenerating || !editableFullPrompt.trim()}
                          className="inline-flex items-center justify-center gap-2 rounded-2xl bg-emerald-600 px-5 py-3.5 text-sm sm:text-base font-extrabold text-white hover:bg-emerald-700 transition cursor-pointer shadow-sm disabled:opacity-50"
                        >
                          {agentGenerating ? (
                            <>
                              <RefreshCw className="w-5 h-5 animate-spin" />
                              {evaluatedPrompt.target === 'image'
                                ? 'Agent กำลังวาดรูปภาพจริง...'
                                : 'Agent กำลังสร้างวิดีโอจริง (30-90 วินาที)...'}
                            </>
                          ) : (
                            <>
                              <Sparkles className="w-5 h-5" />
                              {evaluatedPrompt.target === 'image'
                                ? 'ส่งให้ Agent สร้างรูปภาพทันที (ดู Preview ก่อน)'
                                : 'ส่งให้ Agent สร้างวิดีโอทันที (ดู Preview ก่อน)'}
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
                          className="inline-flex items-center justify-center gap-2 rounded-2xl border-2 border-[#0d2546] bg-white px-4 py-3 text-sm font-extrabold text-[#0d2546] hover:bg-slate-50 transition cursor-pointer"
                        >
                          เปิดในหน้า “สร้างรูปภาพ & วิดีโอ AI”
                          <ArrowRight className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  )}

                  {/* 2) RECHECK & PREVIEW BOX FOR GENERATED IMAGE OR VIDEO */}
                  {previewAsset && (
                    <div className="rounded-3xl border-4 border-emerald-500 bg-white text-slate-900 p-5 sm:p-6 shadow-xl space-y-5">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-100 px-3.5 py-1 text-xs font-extrabold text-emerald-900">
                            <Eye className="w-4 h-4" /> ระบบตรวจสอบผลงานก่อนนำไปใช้ (Recheck & Preview)
                          </span>
                          <h3 className="text-lg sm:text-xl font-extrabold text-[#0d2546] mt-1">
                            ผลงาน{previewAsset.mediaType === 'video' ? 'วิดีโอ AI' : 'รูปภาพ AI'}เสร็จแล้ว — ชอบผลงานนี้ไหมครับ?
                          </h3>
                        </div>
                        {previewAsset.reviewStatus === 'approved' && (
                          <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-600 px-4 py-1.5 text-xs sm:text-sm font-extrabold text-white">
                            <CheckCircle2 className="w-4 h-4" /> อนุมัติเก็บไว้แล้ว
                          </span>
                        )}
                      </div>

                      <div className="rounded-2xl bg-slate-950 p-3 flex items-center justify-center overflow-hidden">
                        {previewAsset.mediaType === 'video' ? (
                          <video
                            src={previewAsset.fileUrl}
                            controls
                            autoPlay
                            className="max-h-[440px] w-auto rounded-xl"
                          />
                        ) : (
                          <img
                            src={previewAsset.fileUrl}
                            alt={previewAsset.thaiSummary || 'AI Generated'}
                            className="max-h-[440px] w-auto object-contain rounded-xl"
                          />
                        )}
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <button
                          type="button"
                          disabled={reviewBusy}
                          onClick={handleApproveKeepAsset}
                          className="flex items-center justify-center gap-2 rounded-2xl bg-emerald-600 px-4 py-3.5 text-sm sm:text-base font-extrabold text-white hover:bg-emerald-700 cursor-pointer disabled:opacity-50"
                        >
                          <CheckCircle2 className="w-5 h-5" />
                          ชอบ! เก็บไว้ในคลัง
                        </button>

                        <button
                          type="button"
                          disabled={reviewBusy}
                          onClick={handleUseAssetInNewPost}
                          className="flex items-center justify-center gap-2 rounded-2xl bg-[#0d2546] px-4 py-3.5 text-sm sm:text-base font-extrabold text-white hover:bg-[#163a6b] cursor-pointer disabled:opacity-50"
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
                                assessmentThai:
                                  'ปรับแก้รายละเอียด Full Prompt ด้านล่างแล้วกดสั่งสร้างใหม่ได้เลยครับ',
                                visualSummaryThai: previewAsset.thaiSummary || '',
                                fullPrompt: previewAsset.prompt,
                                recommendedAspectRatio:
                                  (previewAsset.aspectRatio as any) || '16:9',
                                suggestedPostTitle: '',
                                engineUsed: previewAsset.model,
                              });
                              setEditableFullPrompt(previewAsset.prompt);
                            }
                            showToast('ปรับแก้ Full Prompt ด้านบนแล้วกดสร้างใหม่ได้เลยครับ');
                          }}
                          className="flex items-center justify-center gap-2 rounded-2xl border-2 border-amber-400 bg-amber-50 px-4 py-3.5 text-sm sm:text-base font-extrabold text-amber-950 hover:bg-amber-100 cursor-pointer"
                        >
                          <RefreshCw className="w-5 h-5" />
                          ปรับแก้แล้วสร้างใหม่
                        </button>

                        <button
                          type="button"
                          disabled={reviewBusy}
                          onClick={handleRejectDeleteAsset}
                          className="flex items-center justify-center gap-2 rounded-2xl border-2 border-rose-300 bg-rose-50 px-4 py-3.5 text-sm sm:text-base font-extrabold text-rose-700 hover:bg-rose-600 hover:text-white transition cursor-pointer disabled:opacity-50"
                        >
                          <Trash2 className="w-5 h-5" />
                          ไม่ชอบ — ลบทิ้งทันที
                        </button>
                      </div>
                    </div>
                  )}

                  {/* 3) AI WRITTEN NEWS / ARTICLE / CONTENT RECHECK PREVIEW */}
                  {draftPost && (
                    <div className="rounded-3xl border-4 border-[#0d2546] bg-white text-slate-900 p-5 sm:p-6 shadow-xl space-y-5">
                      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-4">
                        <div>
                          <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-100 px-3.5 py-1 text-xs font-extrabold text-amber-950">
                            <Newspaper className="w-4 h-4" /> ตรวจทานข่าว / บทความที่ AI เขียนให้
                          </span>
                          <h3 className="text-lg sm:text-xl font-extrabold text-[#0d2546] mt-1">
                            อ่านตรวจทานก่อนตัดสินใจ — แก้ไขได้ หรือกดลงหน้าเว็บได้ทันที!
                          </h3>
                        </div>

                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() =>
                              setDraftPreviewMode((m) =>
                                m === 'preview' ? 'edit' : 'preview'
                              )
                            }
                            className="inline-flex items-center gap-1.5 rounded-xl border-2 border-slate-300 bg-white px-3.5 py-2 text-xs sm:text-sm font-extrabold text-[#0d2546] hover:bg-slate-50 cursor-pointer"
                          >
                            <Edit3 className="w-4 h-4" />
                            {draftPreviewMode === 'preview'
                              ? 'แก้ไขข้อความเอง'
                              : 'ดูตัวอย่างหน้าอ่านจริง'}
                          </button>
                          <button
                            type="button"
                            onClick={() => setDraftPost(null)}
                            className="inline-flex items-center gap-1 rounded-xl bg-rose-50 px-3 py-2 text-xs sm:text-sm font-extrabold text-rose-700 hover:bg-rose-100 cursor-pointer"
                          >
                            <Trash2 className="w-4 h-4" /> ลบร่างนี้
                          </button>
                        </div>
                      </div>

                      <div className="rounded-2xl bg-slate-50 border border-slate-200 p-4 flex flex-col sm:flex-row items-center gap-4">
                        <img
                          src={draftCoverUrl}
                          alt="Cover preview"
                          className="w-full sm:w-44 h-28 object-cover rounded-xl border border-slate-200 shrink-0"
                        />
                        <div className="flex-1 space-y-2">
                          <div className="text-sm font-extrabold text-[#0d2546]">
                            รูปปกสำหรับข่าวนี้:
                          </div>
                          <button
                            type="button"
                            onClick={handleGenerateCoverForDraft}
                            disabled={generatingDraftCover}
                            className="inline-flex items-center gap-2 rounded-xl bg-amber-400 px-4 py-2 text-xs sm:text-sm font-extrabold text-[#0d2546] hover:bg-amber-300 cursor-pointer disabled:opacity-50"
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
                                className="w-full rounded-xl border-2 border-slate-300 px-3.5 py-2 text-sm sm:text-base font-bold"
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
                                className="w-full rounded-xl border-2 border-slate-300 px-3.5 py-2 text-sm sm:text-base font-bold bg-white"
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
                              className="w-full rounded-xl border-2 border-slate-300 px-3.5 py-2 text-sm sm:text-base"
                            />
                          </div>

                          <div>
                            <label className="block text-sm font-extrabold text-slate-700 mb-1">
                              เนื้อหาข่าว / บทความฉบับเต็ม
                            </label>
                            <textarea
                              rows={10}
                              value={draftPost.content}
                              onChange={(e) =>
                                setDraftPost({ ...draftPost, content: e.target.value })
                              }
                              className="w-full rounded-2xl border-2 border-slate-300 p-3.5 text-sm sm:text-base leading-relaxed"
                            />
                          </div>
                        </div>
                      ) : (
                        <div className="rounded-2xl border border-slate-200 bg-[#fcfdff] p-5 space-y-3">
                          <span className="inline-block rounded-full bg-[#0d2546] px-3 py-1 text-xs font-extrabold text-amber-300">
                            หมวด:{' '}
                            {CATEGORIES.find((c) => c.id === draftPost.category)?.nameTh ||
                              'การศึกษา'}
                          </span>
                          <h4 className="text-xl font-extrabold text-[#0d2546]">
                            {draftPost.title}
                          </h4>
                          {draftPost.subtitle && (
                            <p className="text-sm sm:text-base font-bold text-slate-600">
                              {draftPost.subtitle}
                            </p>
                          )}
                          <div className="pt-2 border-t border-slate-100 prose prose-slate max-w-none text-sm sm:text-base leading-relaxed">
                            {renderRichMarkdown(draftPost.content)}
                          </div>
                        </div>
                      )}

                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-1">
                        <button
                          type="button"
                          disabled={publishingDraft}
                          onClick={() => handlePublishDraft('published')}
                          className="flex items-center justify-center gap-2 rounded-2xl bg-emerald-600 px-4 py-3.5 text-sm sm:text-base font-extrabold text-white hover:bg-emerald-700 cursor-pointer shadow-sm disabled:opacity-50"
                        >
                          <CheckCircle2 className="w-5 h-5" />
                          {publishingDraft ? 'กำลังบันทึก...' : 'ชอบ! ลงหน้าเว็บทันที'}
                        </button>

                        <button
                          type="button"
                          disabled={publishingDraft}
                          onClick={() => handlePublishDraft('draft')}
                          className="flex items-center justify-center gap-2 rounded-2xl border-2 border-slate-300 bg-white px-4 py-3.5 text-sm sm:text-base font-extrabold text-slate-700 hover:bg-slate-50 cursor-pointer disabled:opacity-50"
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
                          className="flex items-center justify-center gap-2 rounded-2xl border-2 border-[#0d2546] bg-white px-4 py-3.5 text-sm sm:text-base font-extrabold text-[#0d2546] hover:bg-slate-50 cursor-pointer"
                        >
                          <Edit3 className="w-5 h-5" />
                          เปิดในหน้าจัดการข่าวเต็ม
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                <div ref={chatEndRef} />
              </div>
            </div>

            {/* Sticky Bottom Qwen-Style Pill Composer + Quick Action Chips */}
            <div
              className={`px-4 sm:px-6 pb-4 pt-2 shrink-0 ${
                isDark
                  ? 'bg-gradient-to-t from-[#141416] via-[#141416] to-transparent'
                  : 'bg-gradient-to-t from-white via-white to-transparent'
              }`}
            >
              <div className="max-w-3xl w-full mx-auto space-y-2">
                <div className="flex flex-wrap items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => handleEvaluatePrompt('image')}
                    disabled={evaluatingTarget !== null}
                    className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold border transition cursor-pointer disabled:opacity-50 ${
                      isDark
                        ? 'border-white/12 bg-white/5 text-zinc-300 hover:bg-white/10'
                        : 'border-zinc-200 bg-zinc-50 text-zinc-700 hover:bg-zinc-100'
                    }`}
                  >
                    {evaluatingTarget === 'image' ? (
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <ImageIcon className="w-3.5 h-3.5 text-amber-400" />
                    )}
                    เขียน Full Prompt รูปภาพ
                  </button>

                  <button
                    type="button"
                    onClick={() => handleEvaluatePrompt('video')}
                    disabled={evaluatingTarget !== null}
                    className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold border transition cursor-pointer disabled:opacity-50 ${
                      isDark
                        ? 'border-white/12 bg-white/5 text-zinc-300 hover:bg-white/10'
                        : 'border-zinc-200 bg-zinc-50 text-zinc-700 hover:bg-zinc-100'
                    }`}
                  >
                    {evaluatingTarget === 'video' ? (
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Film className="w-3.5 h-3.5 text-indigo-400" />
                    )}
                    เขียน Full Prompt วิดีโอ
                  </button>

                  <button
                    type="button"
                    onClick={() => handleDraftNewsFromChat('news')}
                    disabled={draftingFormat !== null}
                    className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold border transition cursor-pointer disabled:opacity-50 ${
                      isDark
                        ? 'border-white/12 bg-white/5 text-zinc-300 hover:bg-white/10'
                        : 'border-zinc-200 bg-zinc-50 text-zinc-700 hover:bg-zinc-100'
                    }`}
                  >
                    {draftingFormat !== null ? (
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Newspaper className="w-3.5 h-3.5 text-emerald-500" />
                    )}
                    เขียนข่าว / คอนเทนต์
                  </button>
                </div>

                {renderComposerPill(false)}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
};
