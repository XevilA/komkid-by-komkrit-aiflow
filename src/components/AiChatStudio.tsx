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
  FolderOpen,
  Layers,
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

interface TeamStepStatus {
  id: 'writer' | 'image' | 'video';
  label: string;
  status: 'pending' | 'running' | 'done' | 'skipped' | 'error';
  detail?: string;
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
  initialAiSettings?: AiEngineSettings | null;
  onSyncAiSettings?: (st: AiEngineSettings) => void;
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

function embedMediaIntoMarkdownBody(
  body: string,
  fileUrl: string,
  rawCaption: string,
  isVideo: boolean,
  insertAfterIntro = false
): string {
  if (!fileUrl) return body;
  if (body.includes(fileUrl)) return body;
  const safeCaption = (rawCaption || (isVideo ? 'วิดีโอประกอบเนื้อหา' : 'ภาพประกอบเนื้อหา'))
    .replace(/[\[\]\n]/g, ' ')
    .trim();
  const mdTag = isVideo
    ? `![วิดีโอ: ${safeCaption}](${fileUrl})`
    : `![${safeCaption}](${fileUrl})`;

  const trimmed = body.trim();
  if (!trimmed) return mdTag;

  if (insertAfterIntro) {
    const blocks = trimmed.split(/\n\s*\n/);
    if (blocks.length >= 2) {
      return [blocks[0], mdTag, ...blocks.slice(1)].join('\n\n');
    }
  }
  return `${trimmed}\n\n${mdTag}`;
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
  initialAiSettings = null,
  onSyncAiSettings,
}) => {
  const [settings, setSettings] = useState<AiEngineSettings | null>(initialAiSettings);
  const [liveModels, setLiveModels] = useState<UnifiedLiveModelsResponse | null>(null);
  const [refreshingModels, setRefreshingModels] = useState(false);
  const [sessions, setSessions] = useState<AiChatSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string>(() => createSessionId());
  const [messages, setMessages] = useState<AiChatMessage[]>([]);
  const [provider, setProvider] = useState<LlmProviderId>('auto');
  const [selectedModel, setSelectedModel] = useState<string>('');
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);

  // Shared AI Media Assets across Agents (Images & Videos ready to drop into Content)
  const [mediaAssets, setMediaAssets] = useState<AiMediaAsset[]>([]);
  const [showDraftMediaTray, setShowDraftMediaTray] = useState(false);

  // Multi-Agent Collaboration Pipeline State (Writer + Image Agent + Video Agent -> Content)
  const [teamIncludeImage, setTeamIncludeImage] = useState(true);
  const [teamIncludeVideo, setTeamIncludeVideo] = useState(false);
  const [teamVideoTouched, setTeamVideoTouched] = useState(false);
  const [teamRunning, setTeamRunning] = useState(false);
  const [teamSteps, setTeamSteps] = useState<TeamStepStatus[]>([]);

  // Studio UI States
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

  // 1) AI Evaluated Prompt State
  const [evaluatingTarget, setEvaluatingTarget] = useState<'image' | 'video' | null>(null);
  const [evaluatedPrompt, setEvaluatedPrompt] = useState<AiEvaluatedPrompt | null>(null);
  const [editableFullPrompt, setEditableFullPrompt] = useState('');
  const [selectedAspect, setSelectedAspect] = useState<'16:9' | '9:16' | '1:1'>('16:9');
  const [agentGenerating, setAgentGenerating] = useState(false);

  // 2) Recheck & Preview Media Asset State
  const [previewAsset, setPreviewAsset] = useState<AiMediaAsset | null>(null);
  const [reviewBusy, setReviewBusy] = useState(false);
  const [writingAroundAsset, setWritingAroundAsset] = useState(false);

  // 3) AI News / Content Writer + Inline Media State
  const [draftingFormat, setDraftingFormat] = useState<
    'news' | 'article' | 'social_post' | null
  >(null);
  const [draftPost, setDraftPost] = useState<AiDraftFromChat | null>(null);
  const [draftCoverUrl, setDraftCoverUrl] = useState<string>('/images/thumb-ai-edu.jpg');
  const [draftVideoUrl, setDraftVideoUrl] = useState<string>('');
  const [draftPreviewMode, setDraftPreviewMode] = useState<'preview' | 'edit'>('preview');
  const [publishingDraft, setPublishingDraft] = useState(false);
  const [generatingDraftCover, setGeneratingDraftCover] = useState(false);
  const [generatingDraftInlineImg, setGeneratingDraftInlineImg] = useState(false);
  const [generatingDraftVideo, setGeneratingDraftVideo] = useState(false);

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

  const refreshMediaLibrary = async () => {
    try {
      const assets = await api.getMediaAssets();
      setMediaAssets(
        assets.filter((a) => a.mediaType === 'image' || a.mediaType === 'video')
      );
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    if (initialAiSettings) {
      setSettings(initialAiSettings);
      if (!teamVideoTouched && initialAiSettings.hasGeminiKey) {
        setTeamIncludeVideo(true);
      }
    }
  }, [initialAiSettings, teamVideoTouched]);

  const loadInitial = async () => {
    try {
      const st = await api.getAiSettings();
      setSettings(st);
      onSyncAiSettings?.(st);
      if (!teamVideoTouched && st.hasGeminiKey) {
        setTeamIncludeVideo(true);
      }
      const [sess, lm, assets] = await Promise.all([
        api.getChatSessions(),
        api.getLiveModels(false),
        api.getMediaAssets().catch(() => [] as AiMediaAsset[]),
      ]);
      setSessions(sess);
      setLiveModels(lm);
      setMediaAssets(
        assets.filter((a) => a.mediaType === 'image' || a.mediaType === 'video')
      );
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
    setTeamSteps([]);
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

  // ============================================================================
  // UNIFIED MULTI-AGENT COLLABORATION PIPELINE (Writer + Image + Video -> Content)
  // ============================================================================
  const handleRunUnifiedAgentTeam = async (customContextText?: string) => {
    setPlusMenuOpen(false);
    const idea = (customContextText || input).trim();
    if (messages.length === 0 && !idea) {
      setErrorBanner(
        'กรุณาพิมพ์หัวข้อที่อยากทำในช่องแชทก่อน แล้วกด “ให้ทีม Agent ทำครบชุด” ได้เลยครับ'
      );
      textareaRef.current?.focus();
      return;
    }

    setErrorBanner(null);
    setTeamRunning(true);
    const canGenerateImage = Boolean(settings?.hasGeminiKey || settings?.hasOpenaiKey);
    const canGenerateVideo = Boolean(settings?.hasGeminiKey);

    const initialSteps: TeamStepStatus[] = [
      {
        id: 'writer',
        label: '1. Agent นักเขียน Content (เรียบเรียงข่าว & บทความฉบับเต็ม)',
        status: 'running',
        detail: 'กำลังวิเคราะห์ประเด็นและเขียนเนื้อหา...',
      },
      {
        id: 'image',
        label: '2. Agent ครีเอทีฟ & วาดรูปภาพ (สร้างรูปปก + แทรกรูปเข้าเนื้อหา)',
        status: teamIncludeImage ? 'pending' : 'skipped',
        detail: teamIncludeImage ? 'รอรับเนื้อหาจาก Agent นักเขียน...' : 'ปิดไว้',
      },
      {
        id: 'video',
        label: '3. Agent ผู้กำกับ & สร้างวิดีโอ (สร้างคลิป VDO + แทรกเข้าเนื้อหา)',
        status: teamIncludeVideo ? 'pending' : 'skipped',
        detail: teamIncludeVideo ? 'รอคิวสร้างวิดีโอประกอบ Content...' : 'ปิดไว้',
      },
    ];
    setTeamSteps(initialSteps);

    const updateStep = (
      id: TeamStepStatus['id'],
      patch: Partial<TeamStepStatus>
    ) => {
      setTeamSteps((prev) =>
        prev.map((s) => (s.id === id ? { ...s, ...patch } : s))
      );
    };

    try {
      setTimeout(() => {
        actionPanelRef.current?.scrollIntoView({ behavior: 'smooth' });
      }, 80);

      // 1) CONTENT WRITER AGENT
      const draft = await api.draftContentFromChat({
        sessionId: messages.length > 0 ? activeSessionId : undefined,
        ideaText: idea || undefined,
        contentFormat: 'article',
        provider,
        model: provider !== 'auto' && selectedModel ? selectedModel : undefined,
      });

      let workingContent = draft.content;
      setDraftPost(draft);
      setDraftPreviewMode('preview');
      setDraftCoverUrl('/images/thumb-ai-edu.jpg');
      setDraftVideoUrl('');
      if (idea && idea === input.trim()) {
        setInput('');
      }

      updateStep('writer', {
        status: 'done',
        detail: `เขียนเสร็จแล้ว: “${draft.title}”`,
      });

      // 2) PROMPT EVALUATOR + IMAGE AGENT -> PUT DIRECTLY INTO CONTENT (COVER + INLINE)
      if (teamIncludeImage) {
        if (!canGenerateImage) {
          updateStep('image', {
            status: 'skipped',
            detail:
              'ข้ามการวาดรูปอัตโนมัติ (ต้องเชื่อมคีย์ Gemini หรือ OpenAI สำหรับสร้างรูปภาพ)',
          });
        } else {
          updateStep('image', {
            status: 'running',
            detail: 'กำลังเขียน Full Prompt และวาดรูปภาพจริงใส่ปก + เนื้อหา...',
          });
          try {
            let finalImgPrompt = draft.suggestedImagePrompt || '';
            let imgSummaryThai = `ภาพประกอบ: ${draft.title}`;
            try {
              const evalImg = await api.evaluateMediaPrompt({
                target: 'image',
                ideaText: `${draft.title}\n${draft.excerpt}`,
                aspectRatio: '16:9',
                provider,
                model: provider !== 'auto' && selectedModel ? selectedModel : undefined,
              });
              finalImgPrompt = evalImg.fullPrompt || finalImgPrompt;
              imgSummaryThai = evalImg.visualSummaryThai || imgSummaryThai;
            } catch {
              // fallback to draft.suggestedImagePrompt
            }

            if (!finalImgPrompt) {
              finalImgPrompt = `Editorial 16:9 photography illustrating "${draft.title}", authentic Thai educational context, warm natural lighting, no text`;
            }

            const imgAsset = await api.generateRealImage({
              prompt: finalImgPrompt,
              aspectRatio: '16:9',
              thaiSummary: imgSummaryThai,
              reviewStatus: 'approved',
            });

            workingContent = embedMediaIntoMarkdownBody(
              workingContent,
              imgAsset.fileUrl,
              imgAsset.thaiSummary || draft.title,
              false,
              true
            );
            setDraftCoverUrl(imgAsset.fileUrl);
            setDraftPost((prev) =>
              prev ? { ...prev, content: workingContent } : prev
            );
            updateStep('image', {
              status: 'done',
              detail: 'สร้างรูปปกและแทรกรูปภาพเข้าไปในเนื้อหาบทความเรียบร้อยแล้ว!',
            });
          } catch (imgErr) {
            updateStep('image', {
              status: 'error',
              detail: (imgErr as Error).message,
            });
          }
        }
      }

      // 3) PROMPT EVALUATOR + VIDEO AGENT -> PUT DIRECTLY INTO CONTENT (BANNER + INLINE)
      if (teamIncludeVideo) {
        if (!canGenerateVideo) {
          updateStep('video', {
            status: 'skipped',
            detail:
              'ข้ามการสร้าง VDO (ต้องเชื่อม Google Gemini API Key สำหรับโมเดลวิดีโอ Veo)',
          });
        } else {
          updateStep('video', {
            status: 'running',
            detail: 'กำลังกำกับฉากและสร้างวิดีโอ AI จริง (ประมาณ 30-90 วินาที)...',
          });
          try {
            const evalVid = await api.evaluateMediaPrompt({
              target: 'video',
              ideaText: `${draft.title}\n${draft.excerpt}`,
              aspectRatio: '16:9',
              provider,
              model: provider !== 'auto' && selectedModel ? selectedModel : undefined,
            });

            const vidAsset = await api.generateRealVideo({
              prompt: evalVid.fullPrompt,
              engine: settings?.geminiVideoModel || undefined,
              aspectRatio: '16:9',
              durationSec: 6,
              resolution: '720p',
              thaiSummary: evalVid.visualSummaryThai || `วิดีโอประกอบ: ${draft.title}`,
            });

            workingContent = embedMediaIntoMarkdownBody(
              workingContent,
              vidAsset.fileUrl,
              vidAsset.thaiSummary || draft.title,
              true,
              false
            );
            setDraftVideoUrl(vidAsset.fileUrl);
            setDraftPost((prev) =>
              prev ? { ...prev, content: workingContent } : prev
            );
            updateStep('video', {
              status: 'done',
              detail: 'สร้างวิดีโอ AI และแทรกเครื่องเล่นวิดีโอเข้าสู่ Content เรียบร้อยแล้ว!',
            });
          } catch (vidErr) {
            updateStep('video', {
              status: 'error',
              detail: (vidErr as Error).message,
            });
          }
        }
      }

      await Promise.all([refreshMediaLibrary(), onRefreshAll()]);
      showToast('ทีม Agent ร่วมกันเขียน Content พร้อมประกอบสื่อเสร็จเรียบร้อยแล้ว!');
      setTimeout(() => {
        actionPanelRef.current?.scrollIntoView({ behavior: 'smooth' });
      }, 150);
    } catch (err) {
      updateStep('writer', {
        status: 'error',
        detail: (err as Error).message,
      });
      setErrorBanner((err as Error).message);
    } finally {
      setTeamRunning(false);
    }
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
        if (draftPost) {
          setDraftCoverUrl(asset.fileUrl);
          setDraftPost((prev) =>
            prev
              ? {
                  ...prev,
                  content: embedMediaIntoMarkdownBody(
                    prev.content,
                    asset.fileUrl,
                    asset.thaiSummary || prev.title,
                    false,
                    true
                  ),
                }
              : prev
          );
          showToast('สร้างรูปภาพเสร็จและแทรกเข้าไปใน Content ด้านล่างให้ทันทีแล้ว!');
        } else {
          showToast('Agent สร้างรูปภาพเสร็จแล้ว! กดส่งเข้า Content หรือเก็บไว้ได้เลย');
        }
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
        if (draftPost) {
          setDraftVideoUrl(asset.fileUrl);
          setDraftPost((prev) =>
            prev
              ? {
                  ...prev,
                  content: embedMediaIntoMarkdownBody(
                    prev.content,
                    asset.fileUrl,
                    asset.thaiSummary || prev.title,
                    true,
                    false
                  ),
                }
              : prev
          );
          showToast('สร้างวิดีโอเสร็จและแทรกเข้าไปใน Content ด้านล่างให้ทันทีแล้ว!');
        } else {
          showToast('Agent สร้างวิดีโอเสร็จแล้ว! กดส่งเข้า Content หรือเปิดดูได้เลย');
        }
      }
      await Promise.all([refreshMediaLibrary(), onRefreshAll()]);
      setTimeout(() => {
        actionPanelRef.current?.scrollIntoView({ behavior: 'smooth' });
      }, 150);
    } catch (err) {
      setErrorBanner((err as Error).message);
    } finally {
      setAgentGenerating(false);
    }
  };

  // ---------------- INSERT ANY ASSET DIRECTLY INTO DRAFT CONTENT ----------------
  const handleInsertAssetIntoDraft = (
    asset: AiMediaAsset,
    mode: 'cover_or_main' | 'inline_body' | 'both'
  ) => {
    if (!draftPost) return;
    if (mode === 'cover_or_main' || mode === 'both') {
      if (asset.mediaType === 'image') {
        setDraftCoverUrl(asset.fileUrl);
      } else {
        setDraftVideoUrl(asset.fileUrl);
      }
    }
    if (mode === 'inline_body' || mode === 'both') {
      setDraftPost((prev) =>
        prev
          ? {
              ...prev,
              content: embedMediaIntoMarkdownBody(
                prev.content,
                asset.fileUrl,
                asset.thaiSummary || prev.title,
                asset.mediaType === 'video',
                asset.mediaType === 'image'
              ),
            }
          : prev
      );
    }
    showToast(
      asset.mediaType === 'video'
        ? 'นำวิดีโอ AI ไปใส่ใน Content ด้านล่างเรียบร้อยแล้ว!'
        : 'นำรูปภาพ AI ไปใส่ใน Content ด้านล่างเรียบร้อยแล้ว!'
    );
  };

  const handleWriteContentAroundAsset = async (asset: AiMediaAsset) => {
    setWritingAroundAsset(true);
    setErrorBanner(null);
    try {
      if (asset.reviewStatus === 'pending_review') {
        await api.reviewMediaAsset(asset.id, 'approved').catch(() => {});
      }
      const draft = await api.draftContentFromChat({
        sessionId: messages.length > 0 ? activeSessionId : undefined,
        ideaText:
          evaluatedPrompt?.suggestedPostTitle ||
          asset.thaiSummary ||
          `เขียนบทความและข่าวให้ความรู้ประกอบสื่อหัวข้อ: ${asset.prompt}`,
        contentFormat: 'article',
        provider,
        model: provider !== 'auto' && selectedModel ? selectedModel : undefined,
      });
      const contentWithMedia = embedMediaIntoMarkdownBody(
        draft.content,
        asset.fileUrl,
        asset.thaiSummary || draft.title,
        asset.mediaType === 'video',
        asset.mediaType === 'image'
      );
      setDraftPost({ ...draft, content: contentWithMedia });
      setDraftPreviewMode('preview');
      if (asset.mediaType === 'image') {
        setDraftCoverUrl(asset.fileUrl);
      } else {
        setDraftVideoUrl(asset.fileUrl);
      }
      showToast('Agent เขียน Content พร้อมนำรูป/วิดีโอใส่เข้าเนื้อหาให้เรียบร้อยแล้ว!');
      setTimeout(() => {
        actionPanelRef.current?.scrollIntoView({ behavior: 'smooth' });
      }, 120);
    } catch (err) {
      setErrorBanner((err as Error).message);
    } finally {
      setWritingAroundAsset(false);
    }
  };

  // ---------------- STEP C: RECHECK PREVIEW DECISION ----------------
  const handleApproveKeepAsset = async () => {
    if (!previewAsset) return;
    setReviewBusy(true);
    setErrorBanner(null);
    try {
      await api.reviewMediaAsset(previewAsset.id, 'approved');
      if (draftPost) {
        handleInsertAssetIntoDraft(previewAsset, 'both');
      } else {
        showToast('อนุมัติและเก็บผลงานไว้ในคลังเรียบร้อยแล้ว!');
      }
      setPreviewAsset({ ...previewAsset, reviewStatus: 'approved' });
      await Promise.all([refreshMediaLibrary(), onRefreshAll()]);
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
      await Promise.all([refreshMediaLibrary(), onRefreshAll()]);
    } catch (err) {
      setErrorBanner((err as Error).message);
    } finally {
      setReviewBusy(false);
    }
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

      let contentWithExistingMedia = draft.content;
      if (previewAsset) {
        contentWithExistingMedia = embedMediaIntoMarkdownBody(
          contentWithExistingMedia,
          previewAsset.fileUrl,
          previewAsset.thaiSummary || draft.title,
          previewAsset.mediaType === 'video',
          previewAsset.mediaType === 'image'
        );
      }

      setDraftPost({ ...draft, content: contentWithExistingMedia });
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
        reviewStatus: 'approved',
      });
      setPreviewAsset(asset);
      setDraftCoverUrl(asset.fileUrl);
      showToast('Agent วาดรูปปกข่าวเสร็จและใส่ให้เรียบร้อยแล้ว!');
      await Promise.all([refreshMediaLibrary(), onRefreshAll()]);
    } catch (err) {
      setErrorBanner((err as Error).message);
    } finally {
      setGeneratingDraftCover(false);
    }
  };

  const handleGenerateInlineImageForDraft = async () => {
    if (!draftPost) return;
    setGeneratingDraftInlineImg(true);
    setErrorBanner(null);
    try {
      const evalRes = await api
        .evaluateMediaPrompt({
          target: 'image',
          ideaText: `${draftPost.title}\n${draftPost.excerpt}`,
          aspectRatio: '16:9',
          provider,
          model: provider !== 'auto' && selectedModel ? selectedModel : undefined,
        })
        .catch(() => null);

      const promptToUse =
        evalRes?.fullPrompt ||
        draftPost.suggestedImagePrompt ||
        `Documentary 16:9 editorial illustration for "${draftPost.title}", modern Thai classroom and technology, natural lighting, no text`;
      const summary = evalRes?.visualSummaryThai || `ภาพประกอบ: ${draftPost.title}`;

      const asset = await api.generateRealImage({
        prompt: promptToUse,
        aspectRatio: '16:9',
        thaiSummary: summary,
        reviewStatus: 'approved',
      });

      if (draftCoverUrl === '/images/thumb-ai-edu.jpg') {
        setDraftCoverUrl(asset.fileUrl);
      }
      setDraftPost((prev) =>
        prev
          ? {
              ...prev,
              content: embedMediaIntoMarkdownBody(
                prev.content,
                asset.fileUrl,
                summary,
                false,
                false
              ),
            }
          : prev
      );
      setDraftPreviewMode('preview');
      showToast('Agent วาดรูปประกอบใหม่และแทรกลงในเนื้อหาบทความให้แล้ว!');
      await Promise.all([refreshMediaLibrary(), onRefreshAll()]);
    } catch (err) {
      setErrorBanner((err as Error).message);
    } finally {
      setGeneratingDraftInlineImg(false);
    }
  };

  const handleGenerateVideoForDraft = async () => {
    if (!draftPost) return;
    setGeneratingDraftVideo(true);
    setErrorBanner(null);
    try {
      const evalVid = await api.evaluateMediaPrompt({
        target: 'video',
        ideaText: `${draftPost.title}\n${draftPost.excerpt}`,
        aspectRatio: '16:9',
        provider,
        model: provider !== 'auto' && selectedModel ? selectedModel : undefined,
      });

      const asset = await api.generateRealVideo({
        prompt: evalVid.fullPrompt,
        engine: settings?.geminiVideoModel || undefined,
        aspectRatio: '16:9',
        durationSec: 6,
        resolution: '720p',
        thaiSummary: evalVid.visualSummaryThai || `วิดีโอประกอบ: ${draftPost.title}`,
      });

      setDraftVideoUrl(asset.fileUrl);
      setDraftPost((prev) =>
        prev
          ? {
              ...prev,
              content: embedMediaIntoMarkdownBody(
                prev.content,
                asset.fileUrl,
                asset.thaiSummary || prev.title,
                true,
                false
              ),
            }
          : prev
      );
      setDraftPreviewMode('preview');
      showToast('Agent สร้างวิดีโอเสร็จและแทรกลงใน Content ให้เรียบร้อยแล้ว!');
      await Promise.all([refreshMediaLibrary(), onRefreshAll()]);
    } catch (err) {
      setErrorBanner((err as Error).message);
    } finally {
      setGeneratingDraftVideo(false);
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
      setTeamSteps([]);
      if (status === 'published') {
        showToast('บันทึกและนำ Content (พร้อมรูป/วิดีโอ) ขึ้นหน้าเว็บไซต์เรียบร้อยแล้ว!');
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

  const firstConnectedProvider: Exclude<LlmProviderId, 'auto' | 'openai_compatible'> | null =
    (() => {
      if (!settings) return null;
      const pref = settings.provider;
      if (pref === 'gemini' && settings.hasGeminiKey) return 'gemini';
      if (pref === 'openai' && settings.hasOpenaiKey) return 'openai';
      if (pref === 'claude' && settings.hasClaudeKey) return 'claude';
      if (pref === 'deepseek' && settings.hasDeepseekKey) return 'deepseek';
      if (settings.hasGeminiKey) return 'gemini';
      if (settings.hasOpenaiKey) return 'openai';
      if (settings.hasClaudeKey) return 'claude';
      if (settings.hasDeepseekKey) return 'deepseek';
      return null;
    })();

  const activeProviderMeta =
    PROVIDER_OPTIONS.find((p) => p.id === provider) || PROVIDER_OPTIONS[0];
  const currentCatalog =
    provider !== 'auto' ? liveModels?.providers?.[provider] : undefined;
  const currentTextModels = currentCatalog?.textModels || [];

  const topModelDisplayLabel = (() => {
    if (provider === 'auto') {
      if (firstConnectedProvider) {
        const connectedMeta = PROVIDER_OPTIONS.find(
          (p) => p.id === firstConnectedProvider
        );
        return `คมคิด AI • Auto (${connectedMeta?.shortLabel || firstConnectedProvider})`;
      }
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
    messages.length === 0 &&
    !evaluatedPrompt &&
    !previewAsset &&
    !draftPost &&
    teamSteps.length === 0;

  const selectedProviderMissingKeyButAnotherConnected =
    Boolean(settings) &&
    provider !== 'auto' &&
    !isProviderConnected(provider) &&
    firstConnectedProvider !== null;

  // Reusable Qwen-style Pill Composer
  const renderComposerPill = (isCenteredHero: boolean) => (
    <div className="space-y-2 w-full">
      {selectedProviderMissingKeyButAnotherConnected && firstConnectedProvider && (
        <div
          className={`flex flex-wrap items-center justify-between gap-2 rounded-2xl px-4 py-2.5 text-xs font-bold border ${
            isDark
              ? 'bg-amber-500/10 border-amber-400/30 text-amber-200'
              : 'bg-amber-50 border-amber-300 text-amber-950'
          }`}
        >
          <span>
            ค่าย <strong>{activeProviderMeta.shortLabel}</strong> ยังไม่ได้ใส่คีย์ — แต่เชื่อมคีย์{' '}
            <strong>
              {PROVIDER_OPTIONS.find((p) => p.id === firstConnectedProvider)?.label}
            </strong>{' '}
            พร้อมใช้แล้ว
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                setProvider('auto');
                setSelectedModel('');
                setErrorBanner(null);
              }}
              className="rounded-full bg-emerald-600 px-3 py-1 text-white font-extrabold hover:bg-emerald-700 cursor-pointer"
            >
              สลับใช้ค่ายที่เชื่อมไว้ทันที
            </button>
            <button
              type="button"
              onClick={onOpenSettings}
              className={`rounded-full px-2.5 py-1 font-bold underline cursor-pointer ${
                isDark ? 'text-amber-300' : 'text-amber-900'
              }`}
            >
              เพิ่มคีย์ {activeProviderMeta.shortLabel}
            </button>
          </div>
        </div>
      )}

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
              title="คำสั่งทีม Agent: ทำครบชุด Content + รูป + VDO"
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
                className={`absolute left-0 bottom-12 z-40 w-80 rounded-2xl p-2 shadow-2xl border ${
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
                  สั่งทีม AI Agent ทำงานร่วมกัน
                </div>
                <button
                  type="button"
                  onClick={() => handleRunUnifiedAgentTeam()}
                  className="w-full flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-sm font-extrabold bg-emerald-600 text-white hover:bg-emerald-700 transition cursor-pointer mb-1"
                >
                  <Layers className="w-4 h-4 text-amber-300 shrink-0" />
                  <span>ทีม Agent ทำครบชุด (Content + รูป + VDO)</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleDraftNewsFromChat('article')}
                  className={`w-full flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-sm font-bold transition cursor-pointer ${
                    isDark ? 'hover:bg-white/10' : 'hover:bg-zinc-100'
                  }`}
                >
                  <Newspaper className="w-4 h-4 text-emerald-500 shrink-0" />
                  <span>เขียนข่าว / บทความลงเว็บ</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleEvaluatePrompt('image')}
                  className={`w-full flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-sm font-bold transition cursor-pointer ${
                    isDark ? 'hover:bg-white/10' : 'hover:bg-zinc-100'
                  }`}
                >
                  <ImageIcon className="w-4 h-4 text-amber-500 shrink-0" />
                  <span>ประเมิน & สร้างรูปภาพใส่ Content</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleEvaluatePrompt('video')}
                  className={`w-full flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-sm font-bold transition cursor-pointer ${
                    isDark ? 'hover:bg-white/10' : 'hover:bg-zinc-100'
                  }`}
                >
                  <Film className="w-4 h-4 text-indigo-400 shrink-0" />
                  <span>ประเมิน & สร้างวิดีโอใส่ Content</span>
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
            placeholder="พิมพ์เรื่องที่ต้องการคุย หรือพิมพ์หัวข้อแล้วกด “ทีม Agent ทำครบชุด” ได้เลย..."
            className={`flex-1 max-h-44 bg-transparent py-2 px-1 text-[15px] sm:text-base leading-relaxed focus:outline-none resize-none ${
              isDark
                ? 'text-zinc-100 placeholder:text-zinc-400'
                : 'text-zinc-900 placeholder:text-zinc-400'
            }`}
          />

          {/* Inline Provider Selector + Circular '↑' Send Button */}
          <div className="flex items-center gap-1.5 shrink-0 pb-0.5">
            <div className="relative">
              <select
                aria-label="เลือกค่าย AI"
                value={provider}
                onChange={(e) => {
                  setProvider(e.target.value as LlmProviderId);
                  setSelectedModel('');
                  setErrorBanner(null);
                }}
                className={`appearance-none rounded-full pl-3 pr-7 py-1.5 text-xs sm:text-sm font-bold cursor-pointer focus:outline-none transition ${
                  isDark
                    ? 'bg-transparent text-zinc-300 hover:bg-white/10'
                    : 'bg-transparent text-zinc-600 hover:bg-zinc-100'
                }`}
              >
                {PROVIDER_OPTIONS.map((p) => {
                  const connected = isProviderConnected(p.id);
                  return (
                    <option
                      key={p.id}
                      value={p.id}
                      className="bg-zinc-900 text-white"
                    >
                      {p.id === 'auto'
                        ? 'Auto'
                        : `${p.shortLabel}${connected ? ' ✓' : ''}`}
                    </option>
                  );
                })}
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
              title="ส่งข้อความแชท (Enter)"
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
    </div>
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
      {/* LEFT COLLAPSIBLE CHAT HISTORY & STUDIO SIDEBAR                      */}
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
                คมคิด AI Studio
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
                    คลัง & สตูดิโอรูป/วิดีโอ ({mediaAssets.length})
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
                {anyApiKeyConfigured ? 'ตั้งค่าคีย์ API แล้ว' : 'คลิกตั้งค่าคีย์ AI'}
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
      {/* MAIN FULL-SCREEN CHAT & MULTI-AGENT CONTENT CANVAS                  */}
      {/* =================================================================== */}
      <div className="flex-1 flex flex-col min-w-0 h-full overflow-hidden">
        {/* Top Bar */}
        <header className="h-14 px-3 sm:px-5 flex items-center justify-between gap-2 shrink-0">
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
                          อัตโนมัติ (ใช้รุ่นใหม่ล่าสุดจาก API)
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

        {/* Alerts */}
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
        {/* BODY: HERO EMPTY STATE vs CONVERSATION + COLLABORATIVE WORKBENCH  */}
        {/* ================================================================= */}
        {isHeroEmpty ? (
          <div className="flex-1 flex flex-col items-center justify-center px-4 sm:px-6 pb-10 overflow-y-auto">
            <div className="w-full max-w-3xl space-y-6">
              <div className="text-center space-y-1.5">
                <h2
                  className={`text-2xl sm:text-3xl font-semibold tracking-tight ${
                    isDark ? 'text-zinc-100' : 'text-zinc-900'
                  }`}
                >
                  วันนี้ให้ทีม AI Agent ช่วยคิดหรือทำ Content อะไรดีครับ?
                </h2>
                <p
                  className={`text-xs sm:text-sm ${
                    isDark ? 'text-zinc-400' : 'text-zinc-500'
                  }`}
                >
                  พิมพ์คุยปรึกษาก่อน หรือกดให้ทีม Agent เขียน Content พร้อมวาดรูปและสร้างวิดีโอใส่เข้าเนื้อหาให้ครบในคลิกเดียว
                </p>
              </div>

              {renderComposerPill(true)}

              {/* UNIFIED 1-CLICK MULTI-AGENT TEAM ORCHESTRATION BAR */}
              <div
                className={`rounded-2xl border p-3.5 flex flex-col sm:flex-row items-center justify-between gap-3 ${
                  isDark
                    ? 'bg-emerald-500/10 border-emerald-500/30'
                    : 'bg-emerald-50/80 border-emerald-200'
                }`}
              >
                <div className="flex flex-wrap items-center gap-3 text-xs sm:text-sm font-bold">
                  <span
                    className={`font-semibold ${
                      isDark ? 'text-emerald-300' : 'text-emerald-950'
                    }`}
                  >
                    ระบบ Multi-Agent อัตโนมัติ:
                  </span>
                  <label className="inline-flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={teamIncludeImage}
                      onChange={(e) => setTeamIncludeImage(e.target.checked)}
                      className="h-4 w-4 accent-emerald-600"
                    />
                    <span>วาดรูปใส่ปก + เนื้อหา</span>
                  </label>
                  <label className="inline-flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={teamIncludeVideo}
                      onChange={(e) => {
                        setTeamVideoTouched(true);
                        setTeamIncludeVideo(e.target.checked);
                      }}
                      className="h-4 w-4 accent-indigo-600"
                    />
                    <span>สร้างวิดีโอ VDO ใส่เนื้อหา</span>
                  </label>
                </div>

                <button
                  type="button"
                  disabled={teamRunning}
                  onClick={() => handleRunUnifiedAgentTeam()}
                  className="w-full sm:w-auto inline-flex items-center justify-center gap-2 rounded-full bg-emerald-600 px-5 py-2.5 text-xs sm:text-sm font-extrabold text-white hover:bg-emerald-700 shadow-md transition cursor-pointer shrink-0 disabled:opacity-50"
                >
                  <Layers className="w-4 h-4 text-amber-300" />
                  สั่งทีม Agent ทำครบชุด (Content + รูป + VDO)
                </button>
              </div>

              {/* Individual Quick Pills */}
              <div className="flex flex-wrap items-center justify-center gap-2">
                <button
                  type="button"
                  disabled={draftingFormat !== null}
                  onClick={() => handleDraftNewsFromChat('article')}
                  className={`inline-flex items-center gap-2 rounded-full px-4 py-2 text-xs sm:text-sm font-bold border transition cursor-pointer ${
                    isDark
                      ? 'border-white/12 bg-white/5 text-zinc-200 hover:bg-white/10'
                      : 'border-zinc-200 bg-zinc-50 text-zinc-700 hover:bg-zinc-100'
                  }`}
                >
                  <Newspaper className="w-4 h-4 text-emerald-500" />
                  เขียนเฉพาะข่าว / บทความ
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
                  ประเมิน & สร้างรูปภาพ
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
                  ประเมิน & สร้างวิดีโอ
                </button>
              </div>

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
            {/* Active Conversation + Unified Multi-Agent Workbench */}
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

                          {/* 1-Click Collaborative & Individual Handoff Pills beneath every AI turn */}
                          <div className="flex flex-wrap items-center gap-2 pt-0.5">
                            <button
                              type="button"
                              onClick={() => handleRunUnifiedAgentTeam(m.content)}
                              disabled={teamRunning}
                              className="inline-flex items-center gap-1.5 rounded-full bg-emerald-600 px-3.5 py-1.5 text-xs font-extrabold text-white hover:bg-emerald-700 transition cursor-pointer disabled:opacity-50 shadow-xs"
                            >
                              <Layers className="w-3.5 h-3.5 text-amber-300" />
                              ให้ทีม Agent ทำครบชุด (เขียน Content + รูป + VDO)
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDraftNewsFromChat('article', m.content)}
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
                              สร้างรูปภาพ
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
                              สร้างวิดีโอ
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
                {/* UNIFIED MULTI-AGENT WORKBENCH                               */}
                {/* =========================================================== */}
                <div ref={actionPanelRef} className="space-y-5">
                  {/* 0) LIVE MULTI-AGENT TEAM PROGRESS CARD */}
                  {teamSteps.length > 0 && (
                    <div className="rounded-lg border border-slate-200 bg-white text-slate-900 p-5 shadow-xs space-y-3">
                      <div className="flex items-center justify-between gap-2 border-b border-slate-100 pb-2.5">
                        <div className="flex items-center gap-2">
                          <Layers className="w-4 h-4 text-slate-700" />
                          <h3 className="text-sm sm:text-base font-bold text-slate-900">
                            สถานะการประมวลผลของระบบ Multi-Agent
                          </h3>
                        </div>
                        {!teamRunning && (
                          <button
                            type="button"
                            onClick={() => setTeamSteps([])}
                            className="text-xs font-semibold text-slate-500 hover:text-slate-800 cursor-pointer"
                          >
                            ซ่อนสถานะ
                          </button>
                        )}
                      </div>

                      <div className="space-y-2">
                        {teamSteps.map((st) => (
                          <div
                            key={st.id}
                            className={`rounded-md border px-3.5 py-2.5 flex items-start justify-between gap-3 text-xs ${
                              st.status === 'done'
                                ? 'border-emerald-200 bg-emerald-50/70 text-emerald-950'
                                : st.status === 'running'
                                ? 'border-amber-200 bg-amber-50/70 text-amber-950'
                                : st.status === 'error'
                                ? 'border-rose-200 bg-rose-50 text-rose-900'
                                : 'border-slate-200 bg-slate-50 text-slate-600'
                            }`}
                          >
                            <div className="space-y-0.5">
                              <div className="font-semibold flex items-center gap-2">
                                {st.status === 'running' && (
                                  <RefreshCw className="w-3.5 h-3.5 animate-spin text-amber-600 shrink-0" />
                                )}
                                {st.status === 'done' && (
                                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                                )}
                                {st.status === 'error' && (
                                  <AlertTriangle className="w-3.5 h-3.5 text-rose-600 shrink-0" />
                                )}
                                <span>{st.label}</span>
                              </div>
                              {st.detail && (
                                <div className="text-xs opacity-85 pl-5">{st.detail}</div>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* 1) AI PROMPT EVALUATION & DISPATCH TO IMAGE/VDO AGENT */}
                  {evaluatedPrompt && (
                    <div className="rounded-lg border border-slate-200 bg-white text-slate-900 p-5 shadow-xs space-y-4">
                      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 pb-3.5">
                        <div className="space-y-1">
                          <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                            <Wand2 className="w-3.5 h-3.5 text-amber-600" />
                            ผลการวิเคราะห์คำสั่งสร้างสื่อ ({evaluatedPrompt.engineUsed})
                          </span>
                          <h3 className="text-sm sm:text-base font-bold text-slate-900">
                            {evaluatedPrompt.target === 'image'
                              ? 'ตรวจสอบ Full Prompt สำหรับสร้างภาพประกอบ'
                              : 'ตรวจสอบ Full Prompt สำหรับสร้างสื่อวิดีโอ'}
                          </h3>
                        </div>
                        <button
                          type="button"
                          onClick={() => setEvaluatedPrompt(null)}
                          className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50 cursor-pointer"
                        >
                          <X className="w-3.5 h-3.5" /> ปิดหน้าต่าง
                        </button>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                        <div className="rounded-md bg-slate-50 border border-slate-200 p-3.5 space-y-1">
                          <div className="text-xs font-semibold text-slate-800">
                            ผลการวิเคราะห์แนวคิด:
                          </div>
                          <p className="text-xs text-slate-600 leading-relaxed">
                            {evaluatedPrompt.assessmentThai}
                          </p>
                        </div>
                        <div className="rounded-md bg-slate-50 border border-slate-200 p-3.5 space-y-1">
                          <div className="text-xs font-semibold text-slate-800">
                            องค์ประกอบภาพและฉากที่จะได้รับ:
                          </div>
                          <p className="text-xs text-slate-600 leading-relaxed">
                            {evaluatedPrompt.visualSummaryThai}
                          </p>
                        </div>
                      </div>

                      <div className="space-y-1.5">
                        <label className="block text-xs font-semibold text-slate-700">
                          สัดส่วนสื่อ (Aspect Ratio)
                        </label>
                        <div className="flex flex-wrap gap-2">
                          {(evaluatedPrompt.target === 'video'
                            ? ([
                                { id: '16:9', label: 'แนวนอน 16:9 (เว็บไซต์ / YouTube)' },
                                { id: '9:16', label: 'แนวตั้ง 9:16 (วิดีโอสั้น)' },
                              ] as const)
                            : ([
                                { id: '16:9', label: 'แนวนอน 16:9 (ภาพปกบทความ)' },
                                { id: '1:1', label: 'จัตุรัส 1:1 (โซเชียลมีเดีย)' },
                                { id: '9:16', label: 'แนวตั้ง 9:16' },
                              ] as const)
                          ).map((opt) => (
                            <button
                              key={opt.id}
                              type="button"
                              onClick={() => setSelectedAspect(opt.id)}
                              className={`rounded-md px-3 py-1.5 text-xs font-semibold border transition cursor-pointer ${
                                selectedAspect === opt.id
                                  ? 'bg-slate-900 text-white border-slate-900'
                                  : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                              }`}
                            >
                              {opt.label}
                            </button>
                          ))}
                        </div>
                      </div>

                      <div className="space-y-1.5">
                        <label className="block text-xs font-semibold text-slate-700">
                          คำสั่งฉบับสมบูรณ์ (Full Prompt)
                        </label>
                        <textarea
                          rows={3}
                          value={editableFullPrompt}
                          onChange={(e) => setEditableFullPrompt(e.target.value)}
                          className="w-full rounded-md border border-slate-300 p-3 text-xs sm:text-sm text-slate-800 focus:border-slate-900 focus:outline-none"
                        />
                      </div>

                      <div className="flex flex-wrap items-center gap-2.5">
                        <button
                          type="button"
                          onClick={handleRunMediaAgentNow}
                          disabled={agentGenerating || !editableFullPrompt.trim()}
                          className="inline-flex items-center justify-center gap-2 rounded-md bg-slate-900 px-4 py-2.5 text-xs sm:text-sm font-semibold text-white hover:bg-slate-800 transition cursor-pointer disabled:opacity-50"
                        >
                          {agentGenerating ? (
                            <>
                              <RefreshCw className="w-4 h-4 animate-spin text-amber-400" />
                              {evaluatedPrompt.target === 'image'
                                ? 'กำลังประมวลผลสร้างรูปภาพ...'
                                : 'กำลังเรนเดอร์วิดีโอ (30-90 วินาที)...'}
                            </>
                          ) : (
                            <>
                              <Sparkles className="w-4 h-4 text-amber-400" />
                              {evaluatedPrompt.target === 'image'
                                ? draftPost
                                  ? 'สร้างรูปภาพและแทรกลงเนื้อหา'
                                  : 'ดำเนินการสร้างรูปภาพ'
                                : draftPost
                                ? 'สร้างวิดีโอและแทรกลงเนื้อหา'
                                : 'ดำเนินการสร้างวิดีโอ'}
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
                          className="inline-flex items-center justify-center gap-1.5 rounded-md border border-slate-300 bg-white px-3.5 py-2.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition cursor-pointer"
                        >
                          เปิดในสตูดิโอผลิตสื่อ
                          <ArrowRight className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  )}

                  {/* 2) RECHECK & PREVIEW BOX FOR GENERATED IMAGE OR VIDEO */}
                  {previewAsset && (
                    <div className="rounded-lg border border-slate-200 bg-white text-slate-900 p-5 shadow-xs space-y-4">
                      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-3">
                        <div>
                          <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                            <Eye className="w-3.5 h-3.5 text-amber-600" /> ตรวจสอบตัวอย่างผลงาน
                          </span>
                          <h3 className="text-sm sm:text-base font-bold text-slate-900 mt-0.5">
                            ตัวอย่าง{previewAsset.mediaType === 'video' ? 'สื่อวิดีโอ' : 'ภาพประกอบ'}ที่สร้างเสร็จสมบูรณ์
                          </h3>
                        </div>
                        <button
                          type="button"
                          onClick={() => setPreviewAsset(null)}
                          className="rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50 cursor-pointer"
                        >
                          ซ่อนหน้าต่าง
                        </button>
                      </div>

                      <div className="rounded-md bg-slate-950 p-3 flex items-center justify-center overflow-hidden border border-slate-200">
                        {previewAsset.mediaType === 'video' ? (
                          <video
                            src={previewAsset.fileUrl}
                            controls
                            autoPlay
                            className="max-h-[400px] w-auto rounded"
                          />
                        ) : (
                          <img
                            src={previewAsset.fileUrl}
                            alt={previewAsset.thaiSummary || 'AI Generated'}
                            className="max-h-[400px] w-auto object-contain rounded"
                          />
                        )}
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                        {draftPost ? (
                          <>
                            <button
                              type="button"
                              disabled={reviewBusy}
                              onClick={() => handleInsertAssetIntoDraft(previewAsset, 'both')}
                              className="flex items-center justify-center gap-2 rounded-md bg-slate-900 px-4 py-2.5 text-xs font-semibold text-white hover:bg-slate-800 cursor-pointer"
                            >
                              <Newspaper className="w-4 h-4 text-amber-400" />
                              {previewAsset.mediaType === 'video'
                                ? 'แนบและแทรกวิดีโอลงเนื้อหา'
                                : 'ตั้งเป็นภาพปกและแทรกลงเนื้อหา'}
                            </button>

                            <button
                              type="button"
                              disabled={reviewBusy}
                              onClick={handleApproveKeepAsset}
                              className="flex items-center justify-center gap-2 rounded-md bg-emerald-600 px-4 py-2.5 text-xs font-semibold text-white hover:bg-emerald-700 cursor-pointer"
                            >
                              <CheckCircle2 className="w-4 h-4" />
                              อนุมัติเก็บในคลังสื่อ
                            </button>
                          </>
                        ) : (
                          <>
                            <button
                              type="button"
                              disabled={writingAroundAsset}
                              onClick={() => handleWriteContentAroundAsset(previewAsset)}
                              className="flex items-center justify-center gap-2 rounded-md bg-slate-900 px-4 py-2.5 text-xs font-semibold text-white hover:bg-slate-800 cursor-pointer disabled:opacity-50"
                            >
                              {writingAroundAsset ? (
                                <>
                                  <RefreshCw className="w-4 h-4 animate-spin text-amber-400" />
                                  กำลังร่างบทความประกอบสื่อ...
                                </>
                              ) : (
                                <>
                                  <Newspaper className="w-4 h-4 text-amber-400" />
                                  ให้ AI ร่างบทความพร้อมแนบสื่อนี้
                                </>
                              )}
                            </button>

                            <button
                              type="button"
                              disabled={reviewBusy}
                              onClick={handleApproveKeepAsset}
                              className="flex items-center justify-center gap-2 rounded-md bg-emerald-600 px-4 py-2.5 text-xs font-semibold text-white hover:bg-emerald-700 cursor-pointer disabled:opacity-50"
                            >
                              <CheckCircle2 className="w-4 h-4" />
                              อนุมัติเก็บในคลังสื่อ
                            </button>
                          </>
                        )}

                        <button
                          type="button"
                          disabled={reviewBusy || agentGenerating}
                          onClick={() => {
                            setEvaluatedPrompt({
                              target: previewAsset.mediaType === 'video' ? 'video' : 'image',
                              assessmentThai:
                                'ปรับแก้รายละเอียด Full Prompt ด้านบนแล้วกดสั่งสร้างใหม่ได้ทันที',
                              visualSummaryThai: previewAsset.thaiSummary || '',
                              fullPrompt: previewAsset.prompt,
                              recommendedAspectRatio:
                                (previewAsset.aspectRatio as any) || '16:9',
                              suggestedPostTitle: '',
                              engineUsed: previewAsset.model,
                            });
                            setEditableFullPrompt(previewAsset.prompt);
                            showToast('เปิด Full Prompt ให้แก้ไขด้านบนแล้ว');
                          }}
                          className="flex items-center justify-center gap-2 rounded-md border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
                        >
                          <RefreshCw className="w-3.5 h-3.5" />
                          แก้ไข Prompt และสร้างใหม่
                        </button>

                        <button
                          type="button"
                          disabled={reviewBusy}
                          onClick={handleRejectDeleteAsset}
                          className="flex items-center justify-center gap-2 rounded-md border border-rose-200 bg-rose-50 px-4 py-2 text-xs font-semibold text-rose-700 hover:bg-rose-100 transition cursor-pointer disabled:opacity-50"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                          ลบไฟล์นี้
                        </button>
                      </div>
                    </div>
                  )}

                  {/* 3) UNIFIED CONTENT + IMAGE + VIDEO STUDIO CARD */}
                  {draftPost && (
                    <div className="rounded-lg border border-slate-200 bg-white text-slate-900 p-5 shadow-xs space-y-4">
                      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-3.5">
                        <div>
                          <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                            <Newspaper className="w-3.5 h-3.5 text-amber-600" /> ร่างเนื้อหาและสื่อประกอบ
                          </span>
                          <h3 className="text-sm sm:text-base font-bold text-slate-900 mt-0.5">
                            ตรวจสอบเนื้อหา ภาพหน้าปก และสื่อวิดีโอก่อนเผยแพร่
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
                            className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
                          >
                            <Edit3 className="w-3.5 h-3.5" />
                            {draftPreviewMode === 'preview'
                              ? 'แก้ไขข้อความ'
                              : 'ดูตัวอย่างการแสดงผล'}
                          </button>
                          <button
                            type="button"
                            onClick={() => setDraftPost(null)}
                            className="inline-flex items-center gap-1 rounded-md border border-rose-200 bg-rose-50 px-2.5 py-1.5 text-xs font-semibold text-rose-700 hover:bg-rose-100 cursor-pointer"
                          >
                            <Trash2 className="w-3.5 h-3.5" /> ยกเลิกร่างนี้
                          </button>
                        </div>
                      </div>

                      {/* COLLABORATIVE MEDIA BAR RIGHT ON THE CONTENT DRAFT */}
                      <div className="rounded-md bg-slate-50 border border-slate-200 p-4 space-y-3.5">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-center">
                          {/* Cover Image Preview */}
                          <div className="flex items-center gap-3">
                            <img
                              src={draftCoverUrl}
                              alt="Cover preview"
                              className="w-28 h-16 object-cover rounded border border-slate-300 shrink-0 bg-slate-900"
                            />
                            <div className="text-xs space-y-0.5">
                              <div className="font-semibold text-slate-900">
                                ภาพหน้าปกเนื้อหา (Cover Image)
                              </div>
                              <div className="text-slate-500">
                                แสดงผลเป็นภาพปกบนหน้าเว็บไซต์หลัก
                              </div>
                            </div>
                          </div>

                          {/* Attached Main Video Preview (if any) */}
                          <div className="flex items-center gap-3">
                            {draftVideoUrl ? (
                              <>
                                <video
                                  src={draftVideoUrl}
                                  controls
                                  playsInline
                                  className="w-32 h-16 object-cover rounded border border-slate-300 bg-black shrink-0"
                                />
                                <div className="text-xs space-y-1">
                                  <div className="font-semibold text-slate-900">
                                    แนบไฟล์วิดีโอหลักแล้ว
                                  </div>
                                  <button
                                    type="button"
                                    onClick={() => setDraftVideoUrl('')}
                                    className="text-rose-600 font-semibold hover:underline cursor-pointer"
                                  >
                                    นำวิดีโอหลักออก
                                  </button>
                                </div>
                              </>
                            ) : (
                              <div className="text-xs text-slate-500 bg-white border border-dashed border-slate-300 rounded px-3 py-2.5 w-full">
                                ยังไม่มีวิดีโอหลัก — สามารถสั่งสร้างวิดีโอประกอบหรือเลือกจากคลังสื่อด้านล่าง
                              </div>
                            )}
                          </div>
                        </div>

                        {/* 1-CLICK AGENT COLLABORATION BUTTONS FOR THIS CONTENT */}
                        <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-slate-200">
                          <button
                            type="button"
                            onClick={handleGenerateCoverForDraft}
                            disabled={generatingDraftCover}
                            className="inline-flex items-center gap-1.5 rounded-md bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-800 cursor-pointer disabled:opacity-50"
                          >
                            {generatingDraftCover ? (
                              <>
                                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                                กำลังสร้างภาพปก...
                              </>
                            ) : (
                              <>
                                <ImageIcon className="w-3.5 h-3.5 text-amber-400" />
                                สร้างภาพปกใหม่
                              </>
                            )}
                          </button>

                          <button
                            type="button"
                            onClick={handleGenerateInlineImageForDraft}
                            disabled={generatingDraftInlineImg}
                            className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer disabled:opacity-50"
                          >
                            {generatingDraftInlineImg ? (
                              <>
                                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                                กำลังสร้างภาพแทรกเนื้อหา...
                              </>
                            ) : (
                              <>
                                <Sparkles className="w-3.5 h-3.5 text-amber-600" />
                                สร้างภาพแทรกในเนื้อหา
                              </>
                            )}
                          </button>

                          <button
                            type="button"
                            onClick={handleGenerateVideoForDraft}
                            disabled={generatingDraftVideo}
                            className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer disabled:opacity-50"
                          >
                            {generatingDraftVideo ? (
                              <>
                                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                                กำลังเรนเดอร์วิดีโอ...
                              </>
                            ) : (
                              <>
                                <Film className="w-3.5 h-3.5 text-slate-600" />
                                สร้างวิดีโอประกอบเนื้อหา
                              </>
                            )}
                          </button>

                          <button
                            type="button"
                            onClick={() => setShowDraftMediaTray((v) => !v)}
                            className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
                          >
                            <FolderOpen className="w-3.5 h-3.5 text-slate-500" />
                            เลือกจากคลังสื่อ ({mediaAssets.length})
                          </button>
                        </div>

                        {/* SHARED AI MEDIA TRAY */}
                        {showDraftMediaTray && (
                          <div className="pt-2 border-t border-slate-200 space-y-2">
                            <div className="text-xs font-semibold text-slate-700">
                              คลิกเลือกสื่อจากคลังเพื่อนำไปใช้ในเนื้อหานี้:
                            </div>
                            {mediaAssets.length === 0 ? (
                              <div className="text-xs text-slate-500 py-2">
                                ยังไม่มีไฟล์สื่อในคลัง
                              </div>
                            ) : (
                              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5 max-h-60 overflow-y-auto pr-1">
                                {mediaAssets.slice(0, 12).map((item) => (
                                  <div
                                    key={item.id}
                                    className="rounded-md border border-slate-200 bg-white p-2 space-y-1.5"
                                  >
                                    <div className="relative aspect-video rounded bg-slate-900 overflow-hidden">
                                      {item.mediaType === 'video' ? (
                                        <video
                                          src={item.fileUrl}
                                          muted
                                          playsInline
                                          className="h-full w-full object-cover"
                                        />
                                      ) : (
                                        <img
                                          src={item.fileUrl}
                                          alt={item.thaiSummary || 'AI Asset'}
                                          className="h-full w-full object-cover"
                                        />
                                      )}
                                      <span className="absolute top-1 left-1 rounded bg-slate-900/80 px-1.5 py-0.5 text-[10px] font-semibold text-white">
                                        {item.mediaType === 'video' ? 'VIDEO' : 'IMAGE'}
                                      </span>
                                    </div>
                                    <div className="text-[11px] font-medium text-slate-700 line-clamp-1">
                                      {item.thaiSummary || item.prompt}
                                    </div>
                                    <div className="flex gap-1">
                                      <button
                                        type="button"
                                        onClick={() =>
                                          handleInsertAssetIntoDraft(item, 'cover_or_main')
                                        }
                                        className="flex-1 rounded bg-slate-900 px-2 py-1 text-[10px] font-semibold text-white hover:bg-slate-800 cursor-pointer"
                                      >
                                        {item.mediaType === 'video'
                                          ? 'ตั้งเป็นวิดีโอหลัก'
                                          : 'ตั้งเป็นภาพปก'}
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() =>
                                          handleInsertAssetIntoDraft(item, 'inline_body')
                                        }
                                        className="flex-1 rounded border border-slate-300 bg-white px-2 py-1 text-[10px] font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
                                      >
                                        + แทรกในเนื้อหา
                                      </button>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        )}
                      </div>

                      {draftPreviewMode === 'edit' ? (
                        <div className="space-y-3.5">
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                            <div>
                              <label className="block text-xs font-semibold text-slate-700 mb-1">
                                หัวข้อเนื้อหา
                              </label>
                              <input
                                type="text"
                                value={draftPost.title}
                                onChange={(e) =>
                                  setDraftPost({ ...draftPost, title: e.target.value })
                                }
                                className="w-full rounded-md border border-slate-300 px-3 py-2 text-xs sm:text-sm font-semibold"
                              />
                            </div>
                            <div>
                              <label className="block text-xs font-semibold text-slate-700 mb-1">
                                หมวดหมู่
                              </label>
                              <select
                                value={draftPost.category}
                                onChange={(e) =>
                                  setDraftPost({
                                    ...draftPost,
                                    category: e.target.value as CategoryId,
                                  })
                                }
                                className="w-full rounded-md border border-slate-300 px-3 py-2 text-xs sm:text-sm bg-white"
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
                            <label className="block text-xs font-semibold text-slate-700 mb-1">
                              คำโปรยรอง
                            </label>
                            <input
                              type="text"
                              value={draftPost.subtitle}
                              onChange={(e) =>
                                setDraftPost({ ...draftPost, subtitle: e.target.value })
                              }
                              className="w-full rounded-md border border-slate-300 px-3 py-2 text-xs sm:text-sm"
                            />
                          </div>

                          <div>
                            <label className="block text-xs font-semibold text-slate-700 mb-1">
                              เนื้อหาฉบับเต็ม (Markdown)
                            </label>
                            <textarea
                              rows={10}
                              value={draftPost.content}
                              onChange={(e) =>
                                setDraftPost({ ...draftPost, content: e.target.value })
                              }
                              className="w-full rounded-md border border-slate-300 p-3 text-xs sm:text-sm leading-relaxed"
                            />
                          </div>
                        </div>
                      ) : (
                        <div className="rounded-md border border-slate-200 bg-slate-50/40 p-4 space-y-2.5">
                          <span className="inline-block rounded bg-slate-900 px-2.5 py-0.5 text-[11px] font-semibold text-white">
                            หมวดหมู่:{' '}
                            {CATEGORIES.find((c) => c.id === draftPost.category)?.nameTh ||
                              'การศึกษา'}
                          </span>
                          <h4 className="text-base sm:text-lg font-bold text-slate-900">
                            {draftPost.title}
                          </h4>
                          {draftPost.subtitle && (
                            <p className="text-xs sm:text-sm font-medium text-slate-600">
                              {draftPost.subtitle}
                            </p>
                          )}
                          <div className="pt-2 border-t border-slate-200/80 prose prose-slate max-w-none text-xs sm:text-sm leading-relaxed">
                            {renderRichMarkdown(draftPost.content)}
                          </div>
                        </div>
                      )}

                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 pt-1">
                        <button
                          type="button"
                          disabled={publishingDraft}
                          onClick={() => handlePublishDraft('published')}
                          className="flex items-center justify-center gap-2 rounded-md bg-emerald-600 px-4 py-2.5 text-xs sm:text-sm font-semibold text-white hover:bg-emerald-700 cursor-pointer disabled:opacity-50"
                        >
                          <CheckCircle2 className="w-4 h-4" />
                          {publishingDraft ? 'กำลังบันทึก...' : 'อนุมัติและเผยแพร่ขึ้นเว็บไซต์'}
                        </button>

                        <button
                          type="button"
                          disabled={publishingDraft}
                          onClick={() => handlePublishDraft('draft')}
                          className="flex items-center justify-center gap-2 rounded-md border border-slate-300 bg-white px-4 py-2.5 text-xs sm:text-sm font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer disabled:opacity-50"
                        >
                          บันทึกเป็นฉบับร่าง
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
                          className="flex items-center justify-center gap-2 rounded-md border border-slate-300 bg-white px-4 py-2.5 text-xs sm:text-sm font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
                        >
                          <Edit3 className="w-4 h-4" />
                          เปิดในหน้าจัดการเนื้อหา
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                <div ref={chatEndRef} />
              </div>
            </div>

            {/* Sticky Bottom Qwen-Style Pill Composer + Unified Team Quick Bar */}
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
                    onClick={() => handleRunUnifiedAgentTeam()}
                    disabled={teamRunning}
                    className="inline-flex items-center gap-1.5 rounded-full bg-emerald-600 px-3.5 py-1 text-xs font-extrabold text-white hover:bg-emerald-700 transition cursor-pointer disabled:opacity-50"
                  >
                    {teamRunning ? (
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Layers className="w-3.5 h-3.5 text-amber-300" />
                    )}
                    ทีม Agent ครบชุด (Content+รูป+VDO)
                  </button>

                  <label
                    className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-bold border cursor-pointer ${
                      isDark
                        ? 'border-white/12 bg-white/5 text-zinc-300'
                        : 'border-zinc-200 bg-zinc-50 text-zinc-700'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={teamIncludeImage}
                      onChange={(e) => setTeamIncludeImage(e.target.checked)}
                      className="h-3.5 w-3.5 accent-emerald-600"
                    />
                    รูป AI
                  </label>

                  <label
                    className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-bold border cursor-pointer ${
                      isDark
                        ? 'border-white/12 bg-white/5 text-zinc-300'
                        : 'border-zinc-200 bg-zinc-50 text-zinc-700'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={teamIncludeVideo}
                      onChange={(e) => {
                        setTeamVideoTouched(true);
                        setTeamIncludeVideo(e.target.checked);
                      }}
                      className="h-3.5 w-3.5 accent-indigo-600"
                    />
                    VDO AI
                  </label>

                  <button
                    type="button"
                    onClick={() => handleDraftNewsFromChat('article')}
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
                    เขียน Content
                  </button>

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
                    สร้างรูป
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
                    สร้าง VDO
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
