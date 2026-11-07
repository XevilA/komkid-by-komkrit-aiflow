import React, { useCallback, useEffect, useState } from 'react';
import {
  Sparkles,
  Bot,
  Search,
  Lightbulb,
  Palette,
  Image as ImageIcon,
  Film,
  Mic,
  ShieldCheck,
  BarChart3,
  Share2,
  CheckCircle2,
  RefreshCw,
  Send,
  Volume2,
  Square,
  Copy,
  Check,
  Trash2,
  ExternalLink,
  Layers,
  Database,
  UserCheck,
  Download,
  Eye,
  X,
  KeyRound,
  Clapperboard,
  AlertTriangle,
  Crown,
  GraduationCap,
  ShoppingBag,
  Handshake,
  PlusCircle,
  ArrowRight,
  FolderOpen,
} from 'lucide-react';
import {
  AiWorkflow,
  AiMediaAsset,
  CATEGORIES,
  INPUT_SOURCES,
  CategoryId,
  LlmProviderId,
} from '../types';
import { api, formatThaiDate } from '../api';
import { renderRichMarkdown } from './ArticleReaderModal';

interface Props {
  workflows: AiWorkflow[];
  kbCount: number;
  onRefreshAll: () => Promise<void>;
  onOpenPublishedPost: (postId: number) => void;
  onGoToKnowledgeBase: () => void;
  onOpenSettings?: () => void;
  onOpenFlowStudio?: () => void;
}

const QUICK_PROMPTS = [
  'แนวทางประยุกต์ใช้ AI Tutor ช่วยลดความเหลื่อมล้ำในโรงเรียนขนาดเล็ก',
  'การพัฒนาทักษะภาษาและวิชาชีพ ไทย-เมียนมา สู่มาตรฐานตลาดงานอาเซียน',
  'ออกแบบห้องเรียน Active Learning ที่สอนให้เด็กตั้งคำถามเก่งกว่าท่องจำ',
  'ยกระดับภูเก็ตสู่ศูนย์กลางการเรียนรู้ตลอดชีวิต (Lifelong Learning Hub)',
];

const REVENUE_ENGINES = [
  {
    id: '1. Content Creation | ผลิตสื่อสร้างผู้ติดตาม (Website & Social)',
    short: '1. Content Creation',
    sub: 'บทความ • วิดีโอ • Infographic',
    defaultCategory: 'ai-tech' as CategoryId,
    icon: <Clapperboard className="w-3.5 h-3.5 text-sky-600" />,
  },
  {
    id: '2. School Sponsorship | ความร่วมมือโรงเรียนและพันธมิตร',
    short: '2. School Sponsorship',
    sub: 'ข้อเสนอความร่วมมือ • เครือข่ายโรงเรียน',
    defaultCategory: 'education' as CategoryId,
    icon: <Handshake className="w-3.5 h-3.5 text-emerald-600" />,
  },
  {
    id: '3. Online Courses | คอร์สออนไลน์พัฒนาทักษะแห่งอนาคต',
    short: '3. Online Courses',
    sub: 'หลักสูตรคุณภาพ • เรียนได้ทุกที่',
    defaultCategory: 'career' as CategoryId,
    icon: <GraduationCap className="w-3.5 h-3.5 text-amber-600" />,
  },
  {
    id: '4. Marketplace | สินค้าเพื่อการศึกษา & Affiliate',
    short: '4. Marketplace',
    sub: 'ร้านตัวเอง • Shopee • Lazada • LINE OA',
    defaultCategory: 'innovation' as CategoryId,
    icon: <ShoppingBag className="w-3.5 h-3.5 text-violet-600" />,
  },
];

const AGENT_PIPELINE_STEPS = [
  'AGENT CEO กำลังวางแผนกลยุทธ์ กำหนดเป้าหมาย และมอบหมายงาน...',
  '01 Research Agent กำลังค้นคว้าข้อมูล อ้างอิงแหล่งข้อมูล และสร้าง Insight...',
  '02 Idea & Script Agent กำลังระดมไอเดีย วางโครงเรื่อง และเขียนบทความ/สคริปต์...',
  '03 Content Design & 04 Visual Agent กำลังออกแบบโครงสไลด์และสื่อภาพประกอบ...',
  '05 Video & 06 Audio Agent กำลังจัดทำ Storyboard วิดีโอและบทพากย์เสียง...',
  '07 Quality Check Agent กำลังตรวจสอบความถูกต้อง ความเหมาะสม และคุณภาพสื่อ...',
  '08 Analytics & Improvement Agent กำลังวิเคราะห์ผลและเตรียมกระจายสื่อทุกช่องทาง...',
];

const ALL_CHANNELS = [
  'YouTube',
  'Facebook',
  'TikTok',
  'LINE OA',
  'X (Twitter)',
  'Instagram',
  'Website / Blog',
  'Email / Newsletter',
];

const AI_TOOLS_ECOSYSTEM = [
  {
    group: '01 RESEARCH',
    accent: 'border-slate-200 bg-slate-50 text-slate-800',
    tools: ['ChatGPT', 'Perplexity', 'Google Scholar', 'Elicit', 'Consensus', 'Notion AI'],
  },
  {
    group: '02 SCRIPT & IDEA',
    accent: 'border-slate-200 bg-slate-50 text-slate-800',
    tools: ['ChatGPT', 'Claude', 'Gemini', 'Notion AI', 'MindMeister'],
  },
  {
    group: '03 DESIGN',
    accent: 'border-slate-200 bg-slate-50 text-slate-800',
    tools: ['Canva AI', 'Beautiful.ai', 'Gamma', 'Lucidchart'],
  },
  {
    group: '04 VISUAL',
    accent: 'border-slate-200 bg-slate-50 text-slate-800',
    tools: ['Gemini Image', 'OpenAI Image', 'Midjourney', 'Leonardo AI', 'Canva AI'],
  },
  {
    group: '05 VIDEO',
    accent: 'border-slate-200 bg-slate-50 text-slate-800',
    tools: ['Google Veo', 'Pictory AI', 'HeyGen (AI Avatar)', 'Runway', 'CapCut AI'],
  },
  {
    group: '06 AUDIO',
    accent: 'border-slate-200 bg-slate-50 text-slate-800',
    tools: ['ElevenLabs', 'Gemini TTS', 'Play.ht', 'Adobe Podcast', 'Soundraw'],
  },
  {
    group: '08 ANALYTICS',
    accent: 'border-slate-200 bg-slate-50 text-slate-800',
    tools: ['YouTube Analytics', 'Facebook Insights', 'Google Analytics', 'Sheets AI'],
  },
];

function embedMediaIntoMarkdown(
  markdown: string,
  mediaType: 'image' | 'video',
  fileUrl: string,
  caption: string
): string {
  const cleanUrl = fileUrl.trim();
  if (!cleanUrl) return markdown;
  if (markdown.includes(cleanUrl)) return markdown;
  const safeCaption = (caption || (mediaType === 'video' ? 'วิดีโอประกอบเนื้อหา' : 'ภาพประกอบเนื้อหา'))
    .replace(/[\[\]\r\n]+/g, ' ')
    .trim()
    .slice(0, 95);
  const tag =
    mediaType === 'video'
      ? `\n\n![วิดีโอ: ${safeCaption}](${cleanUrl})\n\n`
      : `\n\n![${safeCaption}](${cleanUrl})\n\n`;

  const trimmed = markdown.trim();
  if (!trimmed) return tag.trim();

  // Insert naturally after the first paragraph or heading block for clean editorial layout
  const paragraphs = trimmed.split(/\n{2,}/);
  if (paragraphs.length >= 2) {
    const insertIdx = mediaType === 'image' ? 1 : Math.min(2, paragraphs.length);
    const before = paragraphs.slice(0, insertIdx).join('\n\n');
    const after = paragraphs.slice(insertIdx).join('\n\n');
    return `${before}${tag}${after}`;
  }
  return `${trimmed}${tag}`;
}

export const AiCommandCenter: React.FC<Props> = ({
  workflows,
  kbCount,
  onRefreshAll,
  onOpenPublishedPost,
  onGoToKnowledgeBase,
  onOpenSettings,
  onOpenFlowStudio,
}) => {
  const [selectedId, setSelectedId] = useState<number | null>(
    workflows[0]?.id ?? null
  );
  const [activeAgentTab, setActiveAgentTab] = useState<string>('overview');
  const [blueprintModalOpen, setBlueprintModalOpen] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showMediaVault, setShowMediaVault] = useState(false);

  // Shared AI Media Library (from Chat, Media Studio, and Workflows)
  const [sharedAssets, setSharedAssets] = useState<AiMediaAsset[]>([]);
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  const notify = useCallback((msg: string) => {
    setToastMsg(msg);
    setTimeout(() => {
      setToastMsg((prev) => (prev === msg ? null : prev));
    }, 3400);
  }, []);

  const loadSharedMedia = useCallback(async () => {
    try {
      const list = await api.getMediaAssets();
      setSharedAssets(list);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    loadSharedMedia();
  }, [loadSharedMedia]);

  // Dispatch Form aligned with Blueprint 1 (Input Source) & Blueprint 2 (4 Revenue Engines)
  const [topic, setTopic] = useState('');
  const [inputSource, setInputSource] = useState(INPUT_SOURCES[0].label);
  const [category, setCategory] = useState<CategoryId>('ai-tech');
  const [targetAudience, setTargetAudience] = useState('ครู / บุคลากรทางการศึกษา');
  const [businessPillar, setBusinessPillar] = useState(REVENUE_ENGINES[0].id);
  const [flowMode] = useState<'full_8agent' | 'core_3agent'>('full_8agent');
  const [llmProvider, setLlmProvider] = useState<LlmProviderId>('auto');
  const [autoGenerateCoverImage, setAutoGenerateCoverImage] = useState(true);

  // Execution & Real Media Generation states
  const [running, setRunning] = useState(false);
  const [stepIdx, setStepIdx] = useState(0);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [mediaBusy, setMediaBusy] = useState<'image' | 'video' | 'audio' | null>(null);
  const [videoEngineChoice, setVideoEngineChoice] = useState<string>('');
  const [liveVideoModels, setLiveVideoModels] = useState<
    { id: string; label: string }[]
  >([]);
  const [videoAspectChoice, setVideoAspectChoice] = useState<'16:9' | '9:16'>('16:9');

  useEffect(() => {
    api
      .getLiveModels()
      .then((cat) => {
        const merged: { id: string; label: string }[] = [];
        const seen = new Set<string>();
        for (const m of [
          ...(cat.providers.gemini?.videoModels || []),
          ...(cat.providers.vertex_veo?.videoModels || []),
        ]) {
          if (!seen.has(m.id)) {
            seen.add(m.id);
            merged.push({ id: m.id, label: m.label });
          }
        }
        setLiveVideoModels(merged);
      })
      .catch(() => {});
  }, []);

  // Human Approval, Selected Media & Inline Edit States
  const [editTitle, setEditTitle] = useState('');
  const [editArticle, setEditArticle] = useState('');
  const [selectedCoverUrl, setSelectedCoverUrl] = useState<string>('');
  const [selectedVideoUrl, setSelectedVideoUrl] = useState<string>('');
  const [selectedAudioUrl, setSelectedAudioUrl] = useState<string>('');
  const [isEditingScript, setIsEditingScript] = useState(false);
  const [checklist, setChecklist] = useState({
    isAccurate: true,
    isAppropriate: true,
    isOnBrand: true,
    isReady: true,
  });
  const [revisionNote, setRevisionNote] = useState('');
  const [publishAsFeatured, setPublishAsFeatured] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [revising, setRevising] = useState(false);

  // Audio TTS & Copy state
  const [speaking, setSpeaking] = useState(false);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const activeWf =
    workflows.find((w) => w.id === selectedId) || workflows[0] || null;

  useEffect(() => {
    if (activeWf) {
      setSelectedId(activeWf.id);
      setEditTitle(activeWf.scriptOutput?.selectedTitle || activeWf.topic);
      setEditArticle(activeWf.scriptOutput?.fullArticleMarkdown || '');
      setSelectedCoverUrl(
        activeWf.visualOutput?.generatedRealImageUrl ||
          activeWf.visualOutput?.generatedSvgDataUrl ||
          ''
      );
      setSelectedVideoUrl(activeWf.videoOutput?.generatedVideoUrl || '');
      setSelectedAudioUrl(activeWf.audioOutput?.generatedAudioUrl || '');
      setChecklist({
        isAccurate: activeWf.humanApproval?.isAccurate ?? true,
        isAppropriate: activeWf.humanApproval?.isAppropriate ?? true,
        isOnBrand: activeWf.humanApproval?.isOnBrand ?? true,
        isReady: activeWf.humanApproval?.isReady ?? true,
      });
      setIsEditingScript(false);
    }
  }, [activeWf?.id, activeWf?.updatedAt]);

  const persistArticleAndMediaToWorkflow = async (
    wf: AiWorkflow,
    nextTitle: string,
    nextArticle: string,
    opts?: { coverUrl?: string; videoUrl?: string; audioUrl?: string }
  ) => {
    await api.updateWorkflow(wf.id, {
      scriptOutput: {
        ...wf.scriptOutput,
        selectedTitle: nextTitle,
        fullArticleMarkdown: nextArticle,
      },
      ...(opts?.coverUrl
        ? {
            visualOutput: {
              ...wf.visualOutput,
              generatedRealImageUrl: opts.coverUrl,
            },
          }
        : {}),
      ...(opts?.videoUrl
        ? {
            videoOutput: {
              ...wf.videoOutput,
              generatedVideoUrl: opts.videoUrl,
            },
          }
        : {}),
      ...(opts?.audioUrl
        ? {
            audioOutput: {
              ...wf.audioOutput,
              generatedAudioUrl: opts.audioUrl,
            },
          }
        : {}),
    });
  };

  const handleDispatchCeo = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!topic.trim()) return;
    setRunning(true);
    setErrorMsg(null);
    setStepIdx(0);
    const timer = setInterval(() => {
      setStepIdx((prev) =>
        prev < AGENT_PIPELINE_STEPS.length - 1 ? prev + 1 : prev
      );
    }, 500);

    try {
      const created = await api.runWorkflow({
        topic: topic.trim(),
        inputSource,
        category,
        targetAudience,
        businessPillar,
        flowMode,
        provider: llmProvider,
        autoGenerateCoverImage,
      });

      // If a real cover image was automatically created during workflow dispatch, embed it into content too
      if (created.visualOutput?.generatedRealImageUrl) {
        const mergedMd = embedMediaIntoMarkdown(
          created.scriptOutput?.fullArticleMarkdown || '',
          'image',
          created.visualOutput.generatedRealImageUrl,
          created.scriptOutput?.selectedTitle || created.topic
        );
        await persistArticleAndMediaToWorkflow(
          created,
          created.scriptOutput?.selectedTitle || created.topic,
          mergedMd,
          { coverUrl: created.visualOutput.generatedRealImageUrl }
        );
      }

      await Promise.all([onRefreshAll(), loadSharedMedia()]);
      setSelectedId(created.id);
      setActiveAgentTab('overview');
      setTopic('');
      notify('AGENT CEO และทีม 01–08 สร้างแคมเปญพร้อมประกอบสื่อเสร็จสมบูรณ์');
    } catch (err) {
      setErrorMsg((err as Error).message);
    } finally {
      clearInterval(timer);
      setRunning(false);
    }
  };

  const handleRequestRevision = async () => {
    if (!activeWf) return;
    if (!revisionNote.trim()) {
      setErrorMsg('กรุณาระบุประเด็นที่ต้องการให้ทีม AI ปรับปรุงแก้ไข');
      return;
    }
    setRevising(true);
    setErrorMsg(null);
    try {
      const updated = await api.requestWorkflowRevision(
        activeWf.id,
        revisionNote.trim(),
        llmProvider
      );
      setRevisionNote('');
      await onRefreshAll();
      setSelectedId(updated.id);
      notify('ทีม AI ปรับปรุงเนื้อหาตามคำสั่งเรียบร้อยแล้ว');
    } catch (err) {
      setErrorMsg((err as Error).message);
    } finally {
      setRevising(false);
    }
  };

  const handleApproveAndPublish = async () => {
    if (!activeWf) return;
    if (
      !checklist.isAccurate ||
      !checklist.isAppropriate ||
      !checklist.isOnBrand
    ) {
      setErrorMsg('กรุณาติ๊กยืนยันการตรวจสอบความถูกต้อง เหมาะสม และตรงกับแบรนด์ก่อนอนุมัติเผยแพร่');
      return;
    }
    setPublishing(true);
    setErrorMsg(null);
    try {
      const res = await api.approveAndPublishWorkflow(activeWf.id, {
        customTitle: editTitle,
        customContent: editArticle,
        coverImageChoice:
          selectedCoverUrl ||
          activeWf.visualOutput?.generatedRealImageUrl ||
          activeWf.visualOutput?.generatedSvgDataUrl,
        videoUrlChoice:
          selectedVideoUrl || activeWf.videoOutput?.generatedVideoUrl || undefined,
        audioUrlChoice:
          selectedAudioUrl || activeWf.audioOutput?.generatedAudioUrl || undefined,
        isFeatured: publishAsFeatured,
        reviewerNote:
          revisionNote.trim() ||
          'อนุมัติผ่าน 07 Quality Check & CEO Approval เผยแพร่พร้อมสื่อภาพ/วิดีโอเรียบร้อยแล้ว',
        channelsToPublish: ALL_CHANNELS,
      });
      await onRefreshAll();
      setSelectedId(res.workflow.id);
      notify('เผยแพร่ Content พร้อมรูปภาพและวิดีโอขึ้นหน้าเว็บไซต์สำเร็จ');
    } catch (err) {
      setErrorMsg((err as Error).message);
    } finally {
      setPublishing(false);
    }
  };

  const handleGenerateRealVisual = async (promptText?: string, insertInline = true) => {
    if (!activeWf) return;
    setMediaBusy('image');
    setErrorMsg(null);
    try {
      const finalPrompt =
        promptText ||
        activeWf.visualOutput?.imagePrompts?.[0]?.prompt ||
        `Editorial educational visual for Komkrit Thailand: ${activeWf.topic}, modern clean composition, 16:9`;
      const asset = await api.generateRealImage({
        prompt: finalPrompt,
        aspectRatio: '16:9',
        workflowId: activeWf.id,
        thaiSummary: editTitle || activeWf.topic,
        reviewStatus: 'approved',
      });
      setSelectedCoverUrl(asset.fileUrl);
      let nextMd = editArticle;
      if (insertInline) {
        nextMd = embedMediaIntoMarkdown(
          editArticle,
          'image',
          asset.fileUrl,
          editTitle || activeWf.topic
        );
        setEditArticle(nextMd);
        await persistArticleAndMediaToWorkflow(activeWf, editTitle, nextMd, {
          coverUrl: asset.fileUrl,
        });
      }
      await Promise.all([onRefreshAll(), loadSharedMedia()]);
      notify('04 Visual Agent สร้างภาพจริง ตั้งเป็นรูปปก และแทรกในเนื้อหา Content แล้ว');
    } catch (err) {
      setErrorMsg((err as Error).message);
    } finally {
      setMediaBusy(null);
    }
  };

  const handleGenerateRealVideo = async (insertInline = true) => {
    if (!activeWf) return;
    setMediaBusy('video');
    setErrorMsg(null);
    try {
      const scenePrompt = (activeWf.videoOutput?.scenes || [])
        .map(
          (s, idx) =>
            `Scene ${idx + 1} (${s.time}): ${s.visual}. Thai narration: "${s.dialogue}".`
        )
        .join(' ');
      const asset = await api.generateRealVideo({
        prompt:
          scenePrompt ||
          `Cinematic educational video for Komkrit Thailand about ${activeWf.topic}`,
        engine: videoEngineChoice,
        aspectRatio: videoAspectChoice,
        durationSec: 8,
        resolution: '720p',
        firstFrameUrl:
          selectedCoverUrl.startsWith('http') || selectedCoverUrl.startsWith('/uploads')
            ? selectedCoverUrl
            : activeWf.visualOutput?.generatedRealImageUrl || undefined,
        workflowId: activeWf.id,
        thaiSummary: editTitle || activeWf.topic,
      });
      setSelectedVideoUrl(asset.fileUrl);
      if (insertInline) {
        const nextMd = embedMediaIntoMarkdown(
          editArticle,
          'video',
          asset.fileUrl,
          editTitle || activeWf.topic
        );
        setEditArticle(nextMd);
        await persistArticleAndMediaToWorkflow(activeWf, editTitle, nextMd, {
          videoUrl: asset.fileUrl,
        });
      }
      await Promise.all([onRefreshAll(), loadSharedMedia()]);
      notify('05 Video Agent เรนเดอร์วิดีโอ .MP4 และฝังเข้าสู่เนื้อหา Content เรียบร้อยแล้ว');
    } catch (err) {
      setErrorMsg((err as Error).message);
    } finally {
      setMediaBusy(null);
    }
  };

  const handleGenerateRealAudio = async () => {
    if (!activeWf) return;
    setMediaBusy('audio');
    setErrorMsg(null);
    try {
      const scriptText =
        activeWf.audioOutput?.narrationScriptWithCues ||
        activeWf.scriptOutput?.videoScript ||
        activeWf.topic;
      const res = await api.generateRealAudio({
        text: scriptText.replace(/\[[^\]]*\]/g, ''),
        style: activeWf.audioOutput?.voiceTone,
        workflowId: activeWf.id,
      });
      setSelectedAudioUrl(res.fileUrl);
      await onRefreshAll();
      notify('06 Audio Agent สร้างไฟล์เสียงพากย์แนบเข้ากับ Content เรียบร้อยแล้ว');
    } catch (err) {
      setErrorMsg((err as Error).message);
    } finally {
      setMediaBusy(null);
    }
  };

  const handleAttachSharedAsset = async (
    asset: AiMediaAsset,
    mode: 'primary' | 'inline' | 'both'
  ) => {
    if (!activeWf) return;
    const isVideo = asset.mediaType === 'video';
    const nextCover = !isVideo && (mode === 'primary' || mode === 'both')
      ? asset.fileUrl
      : selectedCoverUrl;
    const nextVideo = isVideo && (mode === 'primary' || mode === 'both')
      ? asset.fileUrl
      : selectedVideoUrl;

    let nextMd = editArticle;
    if (mode === 'inline' || mode === 'both') {
      nextMd = embedMediaIntoMarkdown(
        editArticle,
        isVideo ? 'video' : 'image',
        asset.fileUrl,
        asset.thaiSummary || editTitle || activeWf.topic
      );
      setEditArticle(nextMd);
    }
    if (!isVideo && (mode === 'primary' || mode === 'both')) {
      setSelectedCoverUrl(asset.fileUrl);
    }
    if (isVideo && (mode === 'primary' || mode === 'both')) {
      setSelectedVideoUrl(asset.fileUrl);
    }

    await persistArticleAndMediaToWorkflow(activeWf, editTitle, nextMd, {
      coverUrl: nextCover || undefined,
      videoUrl: nextVideo || undefined,
    });
    await onRefreshAll();
    notify(
      isVideo
        ? 'นำวิดีโอ AI จากคลังร่วมเข้าสู่ Content เรียบร้อยแล้ว'
        : 'นำรูปภาพ AI จากคลังร่วมเข้าสู่ Content เรียบร้อยแล้ว'
    );
  };

  const handleSaveInlineEdit = async () => {
    if (!activeWf) return;
    await api.updateWorkflow(activeWf.id, {
      scriptOutput: {
        ...activeWf.scriptOutput,
        selectedTitle: editTitle,
        fullArticleMarkdown: editArticle,
      },
      humanApproval: {
        ...activeWf.humanApproval,
        ...checklist,
      },
    });
    setIsEditingScript(false);
    await onRefreshAll();
    notify('บันทึกเนื้อหาที่แก้ไขเรียบร้อยแล้ว');
  };

  const handleDeleteWorkflow = async (id: number) => {
    await api.deleteWorkflow(id);
    await onRefreshAll();
  };

  const toggleVoicePreview = (text: string) => {
    if (!('speechSynthesis' in window)) return;
    if (speaking) {
      window.speechSynthesis.cancel();
      setSpeaking(false);
      return;
    }
    const clean = text.replace(/\[[^\]]*\]/g, '');
    const u = new SpeechSynthesisUtterance(clean);
    u.lang = 'th-TH';
    u.rate = 1.0;
    u.onend = () => setSpeaking(false);
    u.onerror = () => setSpeaking(false);
    setSpeaking(true);
    window.speechSynthesis.speak(u);
  };

  const copyText = (key: string, text: string) => {
    navigator.clipboard?.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 1800);
  };

  // Interactive 01-08 Agent Flow Nodes (Matches Image 1 Architecture)
  const flowNodes = [
    {
      code: '01',
      id: 'research',
      title: 'Research',
      role: 'นักวิจัยอัจฉริยะ',
      done: Boolean(activeWf?.researchOutput?.deepInsights?.length),
      icon: <Search className="w-3.5 h-3.5" />,
    },
    {
      code: '02',
      id: 'script',
      title: 'Idea & Script',
      role: 'นักคิดและเขียนบท',
      done: Boolean(activeWf?.scriptOutput?.fullArticleMarkdown),
      icon: <Lightbulb className="w-3.5 h-3.5" />,
    },
    {
      code: '03',
      id: 'design',
      title: 'Content Design',
      role: 'นักออกแบบเนื้อหา',
      done: Boolean(activeWf?.designOutput?.slideDeckOutline?.length),
      icon: <Palette className="w-3.5 h-3.5" />,
    },
    {
      code: '04',
      id: 'visual',
      title: 'Visual Creator',
      role: 'นักสร้างสื่อภาพ',
      done: Boolean(selectedCoverUrl || activeWf?.visualOutput?.generatedRealImageUrl),
      icon: <ImageIcon className="w-3.5 h-3.5" />,
    },
    {
      code: '05',
      id: 'video',
      title: 'Video Prod.',
      role: 'นักสร้างวิดีโอ',
      done: Boolean(selectedVideoUrl || activeWf?.videoOutput?.generatedVideoUrl),
      icon: <Film className="w-3.5 h-3.5" />,
    },
    {
      code: '06',
      id: 'audio',
      title: 'Audio Prod.',
      role: 'นักสร้างเสียง',
      done: Boolean(selectedAudioUrl || activeWf?.audioOutput?.generatedAudioUrl),
      icon: <Mic className="w-3.5 h-3.5" />,
    },
    {
      code: '07',
      id: 'overview',
      title: 'Quality Check',
      role: 'ตรวจ & ประกอบ Content',
      done: activeWf?.status === 'published' || Boolean(activeWf?.qaOutput?.overallScore),
      icon: <ShieldCheck className="w-3.5 h-3.5" />,
    },
    {
      code: '08',
      id: 'qa_analytics',
      title: 'Analytics',
      role: 'วิเคราะห์และพัฒนา',
      done: Boolean(activeWf?.analyticsOutput?.predictedReach),
      icon: <BarChart3 className="w-3.5 h-3.5" />,
    },
    {
      code: 'PUB',
      id: 'omnichannel',
      title: 'Publish',
      role: 'กระจาย 8 ช่องทาง',
      done: activeWf?.status === 'published',
      icon: <Share2 className="w-3.5 h-3.5" />,
    },
  ];

  return (
    <div className="space-y-6">
      {toastMsg && (
        <div className="fixed bottom-5 right-5 z-50 rounded-xl bg-[#0a101d] text-white border border-amber-300/40 px-4 py-3 text-xs font-semibold shadow-xl flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-amber-300 shrink-0" />
          <span>{toastMsg}</span>
        </div>
      )}

      {/* ===================================================================== */}
      {/* EXECUTIVE AGENT CEO (COMMAND CENTER) — MINIMAL LUXURY CARD            */}
      {/* ===================================================================== */}
      <div className="rounded-2xl bg-white border border-slate-200/80 shadow-2xs overflow-hidden">
        {/* Top Obsidian CEO Banner */}
        <div className="bg-gradient-to-r from-[#0a101d] via-[#101b30] to-[#162644] text-white px-5 sm:px-7 py-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="flex items-start sm:items-center gap-3.5">
            <img
              src="/images/avatar-komkrit.png"
              alt="AGENT CEO"
              className="h-12 w-12 rounded-full object-cover ring-1 ring-amber-300/60 shrink-0"
            />
            <div>
              <div className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.15em] text-amber-300">
                <Crown className="w-3.5 h-3.5" />
                AGENT CEO (COMMAND CENTER) • KOMKID BY KOMKRIT
              </div>
              <h2 className="text-base sm:text-lg font-bold tracking-tight mt-0.5">
                สั่งงาน วางแผน ติดตาม ตรวจสอบ และประกอบสื่อลง Content ผ่าน CEO คนเดียว
              </h2>
              <p className="text-xs text-slate-300/80 mt-0.5">
                เชื่อมโยง 01 Research → 02 Script → 03 Design → 04 Visual → 05 Video → 06 Audio → 07 QA ↔ 08 Analytics
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={onGoToKnowledgeBase}
              className="inline-flex items-center gap-1.5 rounded-xl border border-white/15 bg-white/[0.06] px-3 py-2 text-xs font-medium text-slate-200 hover:bg-white/[0.12] transition cursor-pointer"
            >
              <Database className="w-3.5 h-3.5 text-amber-300" />
              Knowledge Base ({kbCount})
            </button>
            <button
              type="button"
              onClick={() => setBlueprintModalOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-xl border border-amber-300/35 bg-amber-300/10 px-3 py-2 text-xs font-semibold text-amber-200 hover:bg-amber-300/20 transition cursor-pointer"
            >
              <Layers className="w-3.5 h-3.5" />
              ดูผัง Flow ต้นฉบับ
            </button>
          </div>
        </div>

        {/* CEO Dispatch Body */}
        <form onSubmit={handleDispatchCeo} className="p-5 sm:p-6 space-y-4">
          {/* 4 Revenue Engines Selector (Blueprint 2: KOM KID 4 ธุรกิจหลัก) */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                เลือกเป้าหมายธุรกิจหลัก (4 Revenue Engines — AI Co-work)
              </span>
              <button
                type="button"
                onClick={() => setShowAdvanced((v) => !v)}
                className="text-xs font-semibold text-slate-500 hover:text-slate-900 transition cursor-pointer"
              >
                {showAdvanced ? 'ซ่อนตั้งค่าเชิงลึก ▲' : 'ตั้งค่าค่าย AI & กลุ่มเป้าหมาย ▼'}
              </button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
              {REVENUE_ENGINES.map((eng) => {
                const active = businessPillar === eng.id;
                return (
                  <button
                    key={eng.id}
                    type="button"
                    onClick={() => {
                      setBusinessPillar(eng.id);
                      setCategory(eng.defaultCategory);
                    }}
                    className={`rounded-xl border px-3.5 py-2.5 text-left transition cursor-pointer flex items-start gap-2.5 ${
                      active
                        ? 'border-[#0a101d] bg-slate-900/[0.03] ring-1 ring-[#0a101d]/10'
                        : 'border-slate-200/80 bg-white hover:bg-slate-50/70'
                    }`}
                  >
                    <span className="mt-0.5 shrink-0">{eng.icon}</span>
                    <div className="min-w-0">
                      <div className="text-xs font-bold text-slate-900 truncate">
                        {eng.short}
                      </div>
                      <div className="text-[10.5px] text-slate-500 truncate">
                        {eng.sub}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Input / Idea Source Pills (Blueprint 1 Left Column) */}
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] font-semibold text-slate-400 mr-1">
              Input / แหล่งไอเดีย:
            </span>
            {INPUT_SOURCES.map((src) => {
              const selected = inputSource === src.label;
              return (
                <button
                  key={src.id}
                  type="button"
                  onClick={() => setInputSource(src.label)}
                  className={`rounded-full px-3 py-1 text-[11px] font-medium transition cursor-pointer ${
                    selected
                      ? 'bg-[#0a101d] text-amber-300 font-semibold'
                      : 'bg-slate-100/90 text-slate-600 hover:bg-slate-200/70'
                  }`}
                >
                  {src.label}
                </button>
              );
            })}
          </div>

          {/* Main Command Input */}
          <div className="flex flex-col sm:flex-row gap-2.5">
            <input
              type="text"
              required
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              placeholder="สั่งงาน AGENT CEO เช่น วิเคราะห์แนวทางใช้ AI ลดงานเอกสารครูไทย พร้อมสร้างภาพปกประกอบบทความ..."
              className="flex-1 rounded-xl border border-slate-200 bg-slate-50/60 px-4 py-3 text-sm font-medium text-slate-900 placeholder:text-slate-400 focus:border-[#0a101d] focus:bg-white focus:outline-none transition"
            />
            <button
              type="submit"
              disabled={running}
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#0a101d] px-6 py-3 text-sm font-semibold text-amber-300 hover:bg-slate-800 transition cursor-pointer disabled:opacity-60 shrink-0 shadow-xs"
            >
              <Sparkles className="w-4 h-4" />
              {running ? 'ทีม Agent กำลังทำงาน...' : 'สั่งงาน AGENT CEO'}
            </button>
          </div>

          {/* Subtle Quick Topic Starters & Auto-Cover Toggle */}
          <div className="flex flex-wrap items-center justify-between gap-3 pt-0.5">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[11px] text-slate-400">โจทย์แนะนำ:</span>
              {QUICK_PROMPTS.map((qp, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={() => setTopic(qp)}
                  className="rounded-full border border-slate-200/80 bg-white hover:border-amber-400 hover:bg-amber-50/40 px-2.5 py-1 text-[11px] text-slate-600 transition cursor-pointer truncate max-w-[230px]"
                >
                  {qp}
                </button>
              ))}
            </div>

            <label className="inline-flex items-center gap-2 text-xs font-medium text-slate-700 cursor-pointer shrink-0">
              <input
                type="checkbox"
                checked={autoGenerateCoverImage}
                onChange={(e) => setAutoGenerateCoverImage(e.target.checked)}
                className="accent-[#0a101d] rounded"
              />
              สั่ง 04 Visual วาดรูปปก & แทรกในบทความอัตโนมัติ
            </label>
          </div>

          {/* Collapsible Deep Settings */}
          {showAdvanced && (
            <div className="rounded-xl bg-slate-50/80 border border-slate-200/80 p-4 grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <span className="block text-[11px] font-semibold text-slate-600 mb-1">
                  หมวดหมู่เนื้อหาเว็บไซต์
                </span>
                <select
                  value={category}
                  onChange={(e) => setCategory(e.target.value as CategoryId)}
                  className="w-full rounded-lg bg-white border border-slate-200 px-3 py-2 text-xs font-medium text-slate-800 focus:outline-none"
                >
                  {CATEGORIES.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.nameTh}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <span className="block text-[11px] font-semibold text-slate-600 mb-1">
                  กลุ่มผู้เรียน / ผู้อ่านเป้าหมาย
                </span>
                <select
                  value={targetAudience}
                  onChange={(e) => setTargetAudience(e.target.value)}
                  className="w-full rounded-lg bg-white border border-slate-200 px-3 py-2 text-xs font-medium text-slate-800 focus:outline-none"
                >
                  <option value="ครู / บุคลากรทางการศึกษา">ครู / บุคลากรทางการศึกษา</option>
                  <option value="นักเรียน / นักศึกษา">นักเรียน / นักศึกษา</option>
                  <option value="ผู้ปกครอง">ผู้ปกครอง</option>
                  <option value="ผู้บริหารสถานศึกษา & พันธมิตรโรงเรียน">
                    ผู้บริหารสถานศึกษา & พันธมิตรโรงเรียน
                  </option>
                </select>
              </div>

              <div>
                <span className="block text-[11px] font-semibold text-slate-600 mb-1">
                  ค่าย AI หลักของ CEO (Real Live API)
                </span>
                <select
                  value={llmProvider}
                  onChange={(e) => setLlmProvider(e.target.value as LlmProviderId)}
                  className="w-full rounded-lg bg-white border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-800 focus:outline-none"
                >
                  <option value="auto">อัตโนมัติ (ตาม API Vault ที่เชื่อมต่อ)</option>
                  <option value="gemini">Google Gemini</option>
                  <option value="openai">OpenAI ChatGPT</option>
                  <option value="claude">Anthropic Claude</option>
                  <option value="deepseek">DeepSeek</option>
                  <option value="openai_compatible">Custom OpenAI Server</option>
                </select>
              </div>
            </div>
          )}

          {errorMsg && (
            <div className="rounded-xl bg-rose-50/90 border border-rose-200 px-4 py-3 text-xs text-rose-800 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
                <span>{errorMsg}</span>
              </div>
              {onOpenSettings && (
                <button
                  type="button"
                  onClick={onOpenSettings}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-[#0a101d] px-3 py-1.5 text-[11px] font-semibold text-amber-300 hover:bg-slate-800 cursor-pointer shrink-0"
                >
                  <KeyRound className="w-3.5 h-3.5" /> ตั้งค่า API Vault
                </button>
              )}
            </div>
          )}

          {running && (
            <div className="rounded-xl bg-[#0a101d] text-white p-4 flex items-center gap-3.5">
              <RefreshCw className="w-4 h-4 text-amber-300 animate-spin shrink-0" />
              <div className="flex-1">
                <div className="text-xs font-semibold text-amber-200">
                  {AGENT_PIPELINE_STEPS[stepIdx]}
                </div>
                <div className="mt-2 h-1.5 w-full rounded-full bg-white/10 overflow-hidden">
                  <div
                    className="h-full bg-amber-300 transition-all duration-300"
                    style={{
                      width: `${((stepIdx + 1) / AGENT_PIPELINE_STEPS.length) * 100}%`,
                    }}
                  />
                </div>
              </div>
            </div>
          )}
        </form>
      </div>

      {/* ===================================================================== */}
      {/* INTERACTIVE 01–08 MULTI-AGENT FLOW PIPELINE BAR (MATCHES IMAGE 1)     */}
      {/* ===================================================================== */}
      {activeWf && (
        <div className="rounded-2xl bg-white border border-slate-200/80 p-4 shadow-2xs">
          <div className="flex items-center justify-between gap-2 mb-3">
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                AI CONTENT CREATION FLOW (คลิกสลับดูผลงานแต่ละ Agent ได้ทันที)
              </span>
            </div>
            <span className="text-[11px] font-medium text-slate-500">
              Engine: <strong className="text-slate-800">{activeWf.engineUsed}</strong>
            </span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-9 gap-2">
            {flowNodes.map((node) => {
              const isSelected = activeAgentTab === node.id;
              return (
                <button
                  key={node.id}
                  type="button"
                  onClick={() => setActiveAgentTab(node.id)}
                  className={`group relative rounded-xl border p-2.5 text-left transition cursor-pointer flex flex-col justify-between min-h-[72px] ${
                    isSelected
                      ? 'bg-[#0a101d] border-[#0a101d] text-white shadow-xs'
                      : 'bg-slate-50/60 border-slate-200/80 text-slate-800 hover:bg-white hover:border-slate-300'
                  }`}
                >
                  <div className="flex items-center justify-between gap-1">
                    <span
                      className={`text-[10px] font-extrabold px-1.5 py-0.5 rounded ${
                        isSelected
                          ? 'bg-amber-300 text-[#0a101d]'
                          : 'bg-slate-200/80 text-slate-700'
                      }`}
                    >
                      {node.code}
                    </span>
                    <span
                      className={`h-2 w-2 rounded-full ${
                        node.done ? 'bg-emerald-500' : 'bg-slate-300'
                      }`}
                      title={node.done ? 'พร้อมใช้งาน' : 'รอดำเนินการ'}
                    />
                  </div>
                  <div className="mt-2">
                    <div className="text-[11.5px] font-bold leading-tight truncate">
                      {node.title}
                    </div>
                    <div
                      className={`text-[10px] truncate mt-0.5 ${
                        isSelected ? 'text-slate-300' : 'text-slate-500'
                      }`}
                    >
                      {node.role}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* ===================================================================== */}
      {/* CAMPAIGN LIST (LEFT) + COLLABORATIVE AGENT WORKSPACE (RIGHT)          */}
      {/* ===================================================================== */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-5 items-start">
        {/* Left List of Campaigns */}
        <div className="xl:col-span-3 rounded-2xl bg-white border border-slate-200/80 p-4 shadow-2xs space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500">
              แคมเปญ AI ({workflows.length})
            </h3>
          </div>

          <div className="space-y-2 max-h-[600px] overflow-y-auto pr-1">
            {workflows.map((wf) => {
              const active = wf.id === activeWf?.id;
              return (
                <div
                  key={wf.id}
                  onClick={() => setSelectedId(wf.id)}
                  className={`rounded-xl border p-3 cursor-pointer transition ${
                    active
                      ? 'border-[#0a101d] bg-slate-900/[0.03] shadow-2xs'
                      : 'border-slate-200/70 bg-white hover:bg-slate-50/80'
                  }`}
                >
                  <div className="flex items-center justify-between gap-1 mb-1.5">
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                        wf.status === 'published'
                          ? 'bg-emerald-50 text-emerald-800 border border-emerald-200/80'
                          : 'bg-amber-50 text-amber-900 border border-amber-200/80'
                      }`}
                    >
                      {wf.status === 'published' ? '✓ เผยแพร่แล้ว' : 'รอตรวจอนุมัติ'}
                    </span>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDeleteWorkflow(wf.id);
                      }}
                      className="text-slate-300 hover:text-rose-600 p-0.5 cursor-pointer"
                      title="ลบแคมเปญ"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  <div className="text-xs font-bold text-slate-900 line-clamp-2 leading-snug">
                    {wf.scriptOutput?.selectedTitle || wf.topic}
                  </div>
                  <div className="mt-2 flex items-center justify-between text-[10.5px] text-slate-400">
                    <span>QA {wf.qaOutput?.overallScore || 96}/100</span>
                    <span>{formatThaiDate(wf.createdAt)}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Right Detailed Multi-Agent Workspace */}
        <div className="xl:col-span-9 space-y-5">
          {!activeWf ? (
            <div className="rounded-2xl bg-white p-12 text-center border border-slate-200/80">
              <p className="text-sm text-slate-500">
                ยังไม่มีแคมเปญ พิมพ์โจทย์ด้านบนเพื่อสั่งงาน AGENT CEO ได้เลยครับ
              </p>
            </div>
          ) : (
            <>
              {/* =============================================================== */}
              {/* TAB 07 / OVERVIEW: UNIFIED CONTENT + IMAGE + VIDEO + PUBLISH    */}
              {/* =============================================================== */}
              {activeAgentTab === 'overview' && (
                <div className="space-y-5">
                  {/* Executive Approval & Unified Media Co-work Card */}
                  <div className="rounded-2xl bg-white border border-slate-200/80 p-5 sm:p-6 shadow-2xs space-y-5">
                    <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-4 pb-4 border-b border-slate-100">
                      <div className="space-y-1">
                        <div className="inline-flex items-center gap-2 text-xs font-semibold text-emerald-700">
                          <ShieldCheck className="w-4 h-4" />
                          07 Quality Check • คะแนนคุณภาพ {activeWf.qaOutput?.overallScore || 97}/100
                        </div>
                        <h3 className="text-lg sm:text-xl font-bold text-slate-900 leading-snug">
                          {editTitle}
                        </h3>
                        <p className="text-xs text-slate-500">
                          เป้าหมาย CEO: {activeWf.ceoOutput?.goal}
                        </p>
                      </div>

                      <div className="flex flex-wrap items-center gap-2.5 shrink-0">
                        <button
                          type="button"
                          onClick={() => setIsEditingScript((v) => !v)}
                          className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition cursor-pointer"
                        >
                          {isEditingScript ? 'ดูตัวอย่างบทความ' : 'แก้ไขเนื้อหาเอง'}
                        </button>

                        {activeWf.status === 'published' &&
                        activeWf.humanApproval?.publishedPostId ? (
                          <button
                            onClick={() =>
                              onOpenPublishedPost(
                                activeWf.humanApproval.publishedPostId!
                              )
                            }
                            className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-5 py-2.5 text-xs sm:text-sm font-bold text-white hover:bg-emerald-700 transition cursor-pointer shadow-xs"
                          >
                            <ExternalLink className="w-4 h-4" />
                            เผยแพร่แล้ว • เปิดดูบนเว็บจริง
                          </button>
                        ) : (
                          <button
                            onClick={handleApproveAndPublish}
                            disabled={publishing}
                            className="inline-flex items-center gap-2 rounded-xl bg-[#0a101d] px-5 py-2.5 text-xs sm:text-sm font-bold text-amber-300 hover:bg-slate-800 transition cursor-pointer shadow-xs disabled:opacity-50"
                          >
                            <CheckCircle2 className="w-4 h-4" />
                            {publishing
                              ? 'กำลังเผยแพร่...'
                              : 'อนุมัติ & เผยแพร่ขึ้นเว็บไซต์ทันที'}
                          </button>
                        )}
                      </div>
                    </div>

                    {/* UNIFIED MEDIA CO-WORK BAR: GENERATE OR INSERT IMAGE / VIDEO / AUDIO DIRECTLY INTO CONTENT */}
                    <div className="rounded-xl bg-slate-50/90 border border-slate-200/80 p-4 space-y-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <div className="text-xs font-bold text-slate-900">
                            สั่งทีม Agent สร้างสื่อประกอบและแทรกลงใน Content นี้โดยตรง (ไม่ต้องแยกทำคนละหน้า)
                          </div>
                          <div className="text-[11px] text-slate-500">
                            รูปภาพและวิดีโอที่สร้างหรือเลือก จะถูกตั้งเป็นปก/วิดีโอหลัก และแทรกอยู่ในเนื้อหาบทความอัตโนมัติ
                          </div>
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          disabled={mediaBusy !== null}
                          onClick={() => handleGenerateRealVisual(undefined, true)}
                          className="inline-flex items-center gap-1.5 rounded-xl bg-white border border-slate-200 px-3.5 py-2 text-xs font-semibold text-slate-800 hover:border-slate-400 hover:bg-slate-50 transition cursor-pointer disabled:opacity-50"
                        >
                          {mediaBusy === 'image' ? (
                            <RefreshCw className="w-3.5 h-3.5 animate-spin text-sky-600" />
                          ) : (
                            <ImageIcon className="w-3.5 h-3.5 text-sky-600" />
                          )}
                          {mediaBusy === 'image'
                            ? '04 Visual กำลังวาดรูป...'
                            : 'สั่ง 04 Visual วาดรูปใส่ Content'}
                        </button>

                        <button
                          type="button"
                          disabled={mediaBusy !== null}
                          onClick={() => handleGenerateRealVideo(true)}
                          className="inline-flex items-center gap-1.5 rounded-xl bg-white border border-slate-200 px-3.5 py-2 text-xs font-semibold text-slate-800 hover:border-slate-400 hover:bg-slate-50 transition cursor-pointer disabled:opacity-50"
                        >
                          {mediaBusy === 'video' ? (
                            <RefreshCw className="w-3.5 h-3.5 animate-spin text-purple-600" />
                          ) : (
                            <Film className="w-3.5 h-3.5 text-purple-600" />
                          )}
                          {mediaBusy === 'video'
                            ? '05 Video กำลังสร้างคลิป MP4...'
                            : 'สั่ง 05 Video สร้างคลิปใส่ Content'}
                        </button>

                        <button
                          type="button"
                          disabled={mediaBusy !== null}
                          onClick={handleGenerateRealAudio}
                          className="inline-flex items-center gap-1.5 rounded-xl bg-white border border-slate-200 px-3.5 py-2 text-xs font-semibold text-slate-800 hover:border-slate-400 hover:bg-slate-50 transition cursor-pointer disabled:opacity-50"
                        >
                          {mediaBusy === 'audio' ? (
                            <RefreshCw className="w-3.5 h-3.5 animate-spin text-amber-600" />
                          ) : (
                            <Mic className="w-3.5 h-3.5 text-amber-600" />
                          )}
                          {mediaBusy === 'audio'
                            ? '06 Audio กำลังพากย์เสียง...'
                            : 'สั่ง 06 Audio สร้างเสียงพากย์'}
                        </button>

                        <button
                          type="button"
                          onClick={() => {
                            loadSharedMedia();
                            setShowMediaVault((v) => !v);
                          }}
                          className={`inline-flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-semibold transition cursor-pointer ${
                            showMediaVault
                              ? 'bg-[#0a101d] text-amber-300'
                              : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-50'
                          }`}
                        >
                          <FolderOpen className="w-3.5 h-3.5" />
                          เลือกจากคลังรูป & วิดีโอ AI ร่วม ({sharedAssets.length})
                        </button>
                      </div>

                      {/* Shared AI Media Vault Picker */}
                      {showMediaVault && (
                        <div className="pt-3 border-t border-slate-200/80 space-y-2.5">
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-bold text-slate-700">
                              คลังสื่อกลางจาก AI Chat & สตูดิโอภาพ/วิดีโอ — คลิกเพื่อนำมาใส่ในบทความนี้ทันที
                            </span>
                            <button
                              type="button"
                              onClick={() => setShowMediaVault(false)}
                              className="text-xs text-slate-400 hover:text-slate-700 cursor-pointer"
                            >
                              ปิดคลังสื่อ ✕
                            </button>
                          </div>

                          {sharedAssets.length === 0 ? (
                            <p className="text-xs text-slate-500 py-3">
                              ยังไม่มีรูปหรือวิดีโอในคลังกลาง กดปุ่มสั่ง 04 Visual หรือ 05 Video ด้านบนได้เลยครับ
                            </p>
                          ) : (
                            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2.5 max-h-64 overflow-y-auto pr-1">
                              {sharedAssets.slice(0, 16).map((asset) => (
                                <div
                                  key={asset.id}
                                  className="rounded-xl bg-white border border-slate-200/90 overflow-hidden flex flex-col justify-between"
                                >
                                  <div className="aspect-video bg-slate-950 relative overflow-hidden">
                                    {asset.mediaType === 'video' ? (
                                      <video
                                        src={asset.fileUrl}
                                        muted
                                        playsInline
                                        className="w-full h-full object-cover"
                                      />
                                    ) : (
                                      <img
                                        src={asset.fileUrl}
                                        alt={asset.thaiSummary || 'AI Media'}
                                        className="w-full h-full object-cover"
                                      />
                                    )}
                                    <span className="absolute top-1.5 left-1.5 rounded bg-black/70 px-1.5 py-0.5 text-[9.5px] font-bold text-white uppercase">
                                      {asset.mediaType}
                                    </span>
                                  </div>
                                  <div className="p-2 space-y-1.5">
                                    <div className="text-[10.5px] text-slate-600 truncate">
                                      {asset.thaiSummary || asset.prompt}
                                    </div>
                                    <div className="grid grid-cols-2 gap-1">
                                      <button
                                        type="button"
                                        onClick={() =>
                                          handleAttachSharedAsset(asset, 'both')
                                        }
                                        className="rounded-lg bg-[#0a101d] px-2 py-1 text-[10px] font-semibold text-amber-300 hover:bg-slate-800 cursor-pointer"
                                      >
                                        {asset.mediaType === 'video'
                                          ? 'ใช้วิดีโอ + แทรก'
                                          : 'ตั้งปก + แทรก'}
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() =>
                                          handleAttachSharedAsset(asset, 'inline')
                                        }
                                        className="rounded-lg border border-slate-200 bg-slate-50 px-2 py-1 text-[10px] font-semibold text-slate-700 hover:bg-slate-100 cursor-pointer"
                                      >
                                        + แทรกในเนื้อหา
                                      </button>
                                    </div>
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </div>

                    {/* Revision & QA Check Row */}
                    <div className="grid grid-cols-1 lg:grid-cols-12 gap-3 pt-1">
                      <div className="lg:col-span-8 flex flex-col sm:flex-row gap-2">
                        <input
                          type="text"
                          value={revisionNote}
                          onChange={(e) => setRevisionNote(e.target.value)}
                          placeholder="สั่ง CEO ปรับแก้เนื้อหาเพิ่มเติม เช่น ขอเพิ่มกรณีศึกษาโรงเรียนไทย หรือปรับภาษาให้กระชับขึ้น..."
                          className="flex-1 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-medium text-slate-800 focus:border-[#0a101d] focus:outline-none"
                        />
                        <button
                          onClick={handleRequestRevision}
                          disabled={revising}
                          className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-slate-50 px-4 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-100 cursor-pointer disabled:opacity-50 shrink-0"
                        >
                          <RefreshCw
                            className={`w-3.5 h-3.5 ${revising ? 'animate-spin' : ''}`}
                          />
                          {revising ? 'กำลังปรับปรุง...' : 'สั่ง AI ปรับแก้'}
                        </button>
                      </div>

                      <div className="lg:col-span-4 flex items-center justify-end gap-4">
                        <label className="inline-flex items-center gap-2 text-xs font-medium text-slate-700 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={publishAsFeatured}
                            onChange={(e) => setPublishAsFeatured(e.target.checked)}
                            className="accent-[#0a101d] rounded"
                          />
                          ปักหมุดเป็นบทความเด่นหน้าแรก
                        </label>
                      </div>
                    </div>
                  </div>

                  {/* Unified Content + Media Preview / Editor Card */}
                  <div className="rounded-2xl bg-white border border-slate-200/80 p-5 sm:p-6 shadow-2xs">
                    {isEditingScript ? (
                      <div className="space-y-3">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-bold text-slate-500">
                            โหมดแก้ไขหัวข้อและเนื้อหา Markdown (รองรับรูป `![คำอธิบาย](url)` และวิดีโอ `![วิดีโอ: คำอธิบาย](url)`)
                          </span>
                          <button
                            onClick={handleSaveInlineEdit}
                            className="rounded-xl bg-[#0a101d] px-4 py-2 text-xs font-semibold text-amber-300 cursor-pointer"
                          >
                            บันทึกการแก้ไข
                          </button>
                        </div>
                        <input
                          type="text"
                          value={editTitle}
                          onChange={(e) => setEditTitle(e.target.value)}
                          className="w-full rounded-xl border border-slate-200 px-3.5 py-2.5 text-sm font-bold text-slate-900 focus:border-[#0a101d] focus:outline-none"
                        />
                        <textarea
                          rows={12}
                          value={editArticle}
                          onChange={(e) => setEditArticle(e.target.value)}
                          className="w-full rounded-xl border border-slate-200 px-4 py-3 text-sm font-body text-slate-800 focus:border-[#0a101d] focus:outline-none"
                        />
                      </div>
                    ) : (
                      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                        <div className="lg:col-span-5 space-y-3">
                          <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                            สื่อหลักที่แนบกับ Content นี้
                          </div>
                          {selectedCoverUrl && (
                            <div className="space-y-1.5">
                              <img
                                src={selectedCoverUrl}
                                alt="AI Cover Visual"
                                className="w-full rounded-xl border border-slate-200/90 shadow-2xs"
                              />
                              <div className="flex items-center justify-between text-[11px] text-slate-500">
                                <span>
                                  {activeWf.visualOutput?.generatedRealImageUrl
                                    ? '✓ รูปปก AI จริง'
                                    : 'กราฟิกโครงสร้างหัวข้อ'}
                                </span>
                                {!editArticle.includes(selectedCoverUrl) && (
                                  <button
                                    type="button"
                                    onClick={async () => {
                                      const nextMd = embedMediaIntoMarkdown(
                                        editArticle,
                                        'image',
                                        selectedCoverUrl,
                                        editTitle
                                      );
                                      setEditArticle(nextMd);
                                      await persistArticleAndMediaToWorkflow(
                                        activeWf,
                                        editTitle,
                                        nextMd
                                      );
                                      notify('แทรกรูปปกลงในเนื้อหาบทความแล้ว');
                                    }}
                                    className="font-semibold text-sky-700 hover:underline cursor-pointer"
                                  >
                                    + แทรกรูปนี้ลงในเนื้อหา
                                  </button>
                                )}
                              </div>
                            </div>
                          )}

                          {selectedVideoUrl && (
                            <div className="space-y-1.5">
                              <video
                                controls
                                playsInline
                                src={selectedVideoUrl}
                                className="w-full rounded-xl border border-slate-200 bg-black aspect-video"
                              />
                              <div className="flex items-center justify-between text-[11px] text-slate-500">
                                <span>✓ วิดีโอ AI .MP4 แนบในบทความ</span>
                                {!editArticle.includes(selectedVideoUrl) && (
                                  <button
                                    type="button"
                                    onClick={async () => {
                                      const nextMd = embedMediaIntoMarkdown(
                                        editArticle,
                                        'video',
                                        selectedVideoUrl,
                                        editTitle
                                      );
                                      setEditArticle(nextMd);
                                      await persistArticleAndMediaToWorkflow(
                                        activeWf,
                                        editTitle,
                                        nextMd
                                      );
                                      notify('แทรกวิดีโอลงในเนื้อหาบทความแล้ว');
                                    }}
                                    className="font-semibold text-purple-700 hover:underline cursor-pointer"
                                  >
                                    + แทรกวิดีโอลงในเนื้อหา
                                  </button>
                                )}
                              </div>
                            </div>
                          )}

                          {selectedAudioUrl && (
                            <div className="rounded-xl bg-slate-50 border border-slate-200 p-3 space-y-1.5">
                              <div className="text-[11px] font-semibold text-slate-700">
                                ✓ เสียงพากย์ AI แนบในบทความ
                              </div>
                              <audio controls src={selectedAudioUrl} className="w-full" />
                            </div>
                          )}
                        </div>

                        <div className="lg:col-span-7 space-y-2">
                          <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                            ตัวอย่างเนื้อหาจริงที่จะแสดงบนเว็บไซต์ (รวมภาพและวิดีโอแทรกในบทความ)
                          </div>
                          <div className="max-h-[520px] overflow-y-auto pr-2 rounded-xl border border-slate-100 bg-slate-50/40 p-4">
                            {renderRichMarkdown(editArticle)}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* TAB 01: RESEARCH AGENT */}
              {activeAgentTab === 'research' && (
                <div className="rounded-2xl bg-white border border-slate-200/80 p-5 sm:p-6 space-y-4 shadow-2xs">
                  <div className="flex items-center justify-between">
                    <h3 className="text-base sm:text-lg font-bold text-slate-900 flex items-center gap-2">
                      <Search className="w-5 h-5 text-sky-600" />
                      01 Research Agent • นักวิจัยอัจฉริยะ
                    </h3>
                    <span className="text-xs text-slate-500">
                      แหล่งไอเดีย: {activeWf.inputSource}
                    </span>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="rounded-xl bg-slate-50/80 p-4 border border-slate-200/80">
                      <h4 className="font-bold text-xs uppercase tracking-wider text-slate-500 mb-2.5">
                        ประเด็นสำคัญ & Insight ที่ค้นพบ
                      </h4>
                      <ul className="space-y-2 text-xs text-slate-700 leading-relaxed">
                        {(activeWf.researchOutput?.deepInsights || []).map((item, i) => (
                          <li key={i} className="flex gap-2">
                            <span className="font-bold text-sky-600">•</span>
                            <span>{item}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                    <div className="rounded-xl bg-slate-50/80 p-4 border border-slate-200/80 space-y-3">
                      <h4 className="font-bold text-xs uppercase tracking-wider text-slate-500">
                        การวิเคราะห์แนวโน้ม & แหล่งข้อมูลอ้างอิง
                      </h4>
                      <p className="text-xs text-slate-700 leading-relaxed">
                        {activeWf.researchOutput?.trendAnalysis}
                      </p>
                      <div className="flex flex-wrap gap-1.5 pt-1">
                        {(activeWf.researchOutput?.kbSourcesUsed || []).map((kb, i) => (
                          <span
                            key={i}
                            className="rounded-full bg-white border border-slate-200 px-2.5 py-1 text-[11px] font-medium text-slate-700"
                          >
                            📚 {kb}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* TAB 02: IDEA & SCRIPT AGENT */}
              {activeAgentTab === 'script' && (
                <div className="rounded-2xl bg-white border border-slate-200/80 p-5 sm:p-6 space-y-5 shadow-2xs">
                  <h3 className="text-base sm:text-lg font-bold text-slate-900 flex items-center gap-2">
                    <Lightbulb className="w-5 h-5 text-amber-500" />
                    02 Idea & Script Agent • นักคิดและเขียนบท
                  </h3>

                  <div>
                    <div className="text-xs font-semibold text-slate-500 mb-2">
                      พาดหัวแนะนำ 3 มุมมอง (คลิกเพื่อใช้เป็นหัวข้อหลักของ Content):
                    </div>
                    <div className="space-y-1.5">
                      {(activeWf.scriptOutput?.titleSuggestions || []).map((t, i) => (
                        <button
                          key={i}
                          onClick={() => setEditTitle(t)}
                          className={`w-full text-left rounded-xl border px-3.5 py-2.5 text-xs font-semibold transition cursor-pointer ${
                            editTitle === t
                              ? 'border-[#0a101d] bg-slate-900/[0.04] text-slate-900'
                              : 'border-slate-200/80 hover:bg-slate-50 text-slate-700'
                          }`}
                        >
                          {i + 1}. {t}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="rounded-xl bg-slate-50/80 border border-slate-200/80 p-4">
                    <div className="text-xs font-bold text-slate-800 mb-1.5">
                      จุดประสงค์การเรียนรู้ (Learning Objectives):
                    </div>
                    <ul className="space-y-1 text-xs text-slate-600">
                      {(activeWf.scriptOutput?.learningObjectives || []).map((lo, i) => (
                        <li key={i}>✓ {lo}</li>
                      ))}
                    </ul>
                  </div>

                  <div className="rounded-xl bg-[#0a101d] text-slate-100 p-4">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs font-semibold text-amber-300">
                        สคริปต์บทพูดวิดีโอสั้น (Video / Reels / TikTok Script)
                      </span>
                      <button
                        onClick={() =>
                          copyText('vscript', activeWf.scriptOutput?.videoScript || '')
                        }
                        className="inline-flex items-center gap-1 rounded-lg bg-white/10 px-2.5 py-1 text-[11px] font-semibold hover:bg-white/20 cursor-pointer"
                      >
                        {copiedKey === 'vscript' ? (
                          <Check className="w-3 h-3 text-emerald-400" />
                        ) : (
                          <Copy className="w-3 h-3" />
                        )}
                        คัดลอกสคริปต์
                      </button>
                    </div>
                    <pre className="whitespace-pre-wrap text-xs font-body leading-relaxed text-slate-200">
                      {activeWf.scriptOutput?.videoScript}
                    </pre>
                  </div>
                </div>
              )}

              {/* TAB 03: CONTENT DESIGN AGENT */}
              {activeAgentTab === 'design' && (
                <div className="rounded-2xl bg-white border border-slate-200/80 p-5 sm:p-6 space-y-5 shadow-2xs">
                  <h3 className="text-base sm:text-lg font-bold text-slate-900 flex items-center gap-2">
                    <Palette className="w-5 h-5 text-emerald-600" />
                    03 Content Design Agent • โครงสร้างเนื้อหา & สไลด์
                  </h3>

                  <div className="rounded-xl bg-slate-50/70 border border-slate-200/80 p-5">
                    <div className="text-xs font-bold text-slate-600 mb-3">
                      แผนผังความคิด (Mind Map Structure)
                    </div>
                    <div className="flex flex-col items-center">
                      <div className="rounded-full bg-[#0a101d] px-6 py-2 text-xs sm:text-sm font-bold text-amber-300">
                        {activeWf.designOutput?.mindMapNodes?.center || activeWf.topic}
                      </div>
                      <div className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-3 w-full">
                        {(activeWf.designOutput?.mindMapNodes?.branches || []).map(
                          (b, idx) => (
                            <div
                              key={idx}
                              className="rounded-xl bg-white border border-slate-200/80 p-3.5"
                            >
                              <div className="font-bold text-xs text-slate-900 mb-1.5">
                                {idx + 1}. {b.title}
                              </div>
                              <ul className="space-y-1 text-xs text-slate-600">
                                {(b.items || []).map((it, j) => (
                                  <li key={j}>• {it}</li>
                                ))}
                              </ul>
                            </div>
                          )
                        )}
                      </div>
                    </div>
                  </div>

                  <div>
                    <div className="text-xs font-bold text-slate-600 mb-2">
                      โครงร่างสไลด์ / Infographic Carousel
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                      {(activeWf.designOutput?.slideDeckOutline || []).map((s, i) => (
                        <div
                          key={i}
                          className="rounded-xl border border-slate-200/80 p-3.5 bg-white"
                        >
                          <span className="rounded bg-[#0a101d] px-2 py-0.5 text-[10px] font-bold text-amber-300">
                            SLIDE {s.slide}
                          </span>
                          <div className="mt-2 font-bold text-xs text-slate-900">
                            {s.title}
                          </div>
                          <div className="mt-1 text-[11px] text-slate-500">
                            {s.bullet}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* TAB 04: VISUAL CREATOR AGENT */}
              {activeAgentTab === 'visual' && (
                <div className="rounded-2xl bg-white border border-slate-200/80 p-5 sm:p-6 space-y-5 shadow-2xs">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <h3 className="text-base sm:text-lg font-bold text-slate-900 flex items-center gap-2">
                        <ImageIcon className="w-5 h-5 text-sky-600" />
                        04 Visual Creator Agent • สร้างภาพประกอบและแทรกใน Content
                      </h3>
                      <p className="text-xs text-slate-500 mt-0.5">
                        เมื่อสร้างภาพเสร็จ ระบบจะตั้งเป็นภาพปกและฝังลงในเนื้อหาบทความให้อัตโนมัติ
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        disabled={mediaBusy === 'image'}
                        onClick={() => handleGenerateRealVisual(undefined, true)}
                        className="inline-flex items-center gap-1.5 rounded-xl bg-[#0a101d] px-4 py-2.5 text-xs font-semibold text-amber-300 hover:bg-slate-800 cursor-pointer disabled:opacity-50"
                      >
                        {mediaBusy === 'image' ? (
                          <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <Sparkles className="w-3.5 h-3.5" />
                        )}
                        {mediaBusy === 'image'
                          ? 'กำลังวาดภาพจริง...'
                          : 'สร้างภาพจริง & แทรกเข้า Content'}
                      </button>
                      {selectedCoverUrl && (
                        <a
                          href={selectedCoverUrl}
                          download
                          className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                        >
                          <Download className="w-3.5 h-3.5" /> ดาวน์โหลดภาพ
                        </a>
                      )}
                    </div>
                  </div>

                  {selectedCoverUrl && (
                    <div className="space-y-2">
                      <div className="overflow-hidden rounded-xl border border-slate-200 max-w-2xl">
                        <img
                          src={selectedCoverUrl}
                          alt="Generated Visual"
                          className="w-full"
                        />
                      </div>
                    </div>
                  )}

                  <div className="space-y-2.5">
                    <div className="text-xs font-bold text-slate-700">
                      ชุดคำสั่ง Image Prompts เฉพาะหัวข้อนี้ (กดสั่งวาดแทรกเข้าบทความได้ทุกรายการ):
                    </div>
                    {(activeWf.visualOutput?.imagePrompts || []).map((ip, idx) => (
                      <div
                        key={idx}
                        className="rounded-xl bg-slate-50/80 border border-slate-200/80 p-3.5 flex flex-col sm:flex-row sm:items-start justify-between gap-3"
                      >
                        <div>
                          <span className="rounded bg-slate-200/80 px-2 py-0.5 text-[10.5px] font-bold text-slate-800">
                            {ip.platform}
                          </span>
                          <p className="mt-1.5 text-xs text-slate-600 font-mono">
                            {ip.prompt}
                          </p>
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          <button
                            type="button"
                            disabled={mediaBusy === 'image'}
                            onClick={() => handleGenerateRealVisual(ip.prompt, true)}
                            className="rounded-lg bg-[#0a101d] px-3 py-1.5 text-xs font-semibold text-amber-300 hover:bg-slate-800 cursor-pointer disabled:opacity-50"
                          >
                            วาด & แทรกเข้า Content
                          </button>
                          <button
                            onClick={() => copyText(`img-${idx}`, ip.prompt)}
                            className="rounded-lg bg-white border border-slate-200 px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 cursor-pointer"
                          >
                            {copiedKey === `img-${idx}` ? 'คัดลอกแล้ว' : 'คัดลอก'}
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* TAB 05: VIDEO PRODUCTION AGENT */}
              {activeAgentTab === 'video' && (
                <div className="rounded-2xl bg-white border border-slate-200/80 p-5 sm:p-6 space-y-4 shadow-2xs">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <h3 className="text-base sm:text-lg font-bold text-slate-900 flex items-center gap-2">
                        <Film className="w-5 h-5 text-purple-600" />
                        05 Video Production Agent • สร้างวิดีโอและฝังลง Content
                      </h3>
                      <p className="text-xs text-slate-500 mt-0.5">
                        เรนเดอร์ไฟล์วิดีโอ .MP4 จาก Storyboard ด้วยโมเดลวิดีโอที่ดึงสดจาก API แล้วแนบเข้าบทความทันที
                      </p>
                    </div>
                    {onOpenFlowStudio && (
                      <button
                        type="button"
                        onClick={onOpenFlowStudio}
                        className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
                      >
                        <Clapperboard className="w-3.5 h-3.5 text-purple-600" />
                        เปิด Multi-Scene Studio
                      </button>
                    )}
                  </div>

                  <div className="rounded-xl bg-slate-50/90 border border-slate-200/80 p-4 space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <select
                          value={videoEngineChoice}
                          onChange={(e) => setVideoEngineChoice(e.target.value)}
                          className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-800"
                        >
                          <option value="">
                            อัตโนมัติ (ใช้โมเดลวิดีโอล่าสุดจาก Live API)
                          </option>
                          {liveVideoModels.map((m) => (
                            <option key={m.id} value={m.id}>
                              {m.label}
                            </option>
                          ))}
                        </select>
                        <select
                          value={videoAspectChoice}
                          onChange={(e) => setVideoAspectChoice(e.target.value as any)}
                          className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-800"
                        >
                          <option value="16:9">16:9 แนวนอน (Website / YouTube)</option>
                          <option value="9:16">9:16 แนวตั้ง (TikTok / Reels)</option>
                        </select>
                      </div>

                      <button
                        type="button"
                        disabled={mediaBusy === 'video'}
                        onClick={() => handleGenerateRealVideo(true)}
                        className="inline-flex items-center gap-1.5 rounded-xl bg-[#0a101d] px-4 py-2.5 text-xs font-semibold text-amber-300 hover:bg-slate-800 cursor-pointer disabled:opacity-50"
                      >
                        {mediaBusy === 'video' ? (
                          <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <Film className="w-3.5 h-3.5" />
                        )}
                        {mediaBusy === 'video'
                          ? 'กำลังเรนเดอร์ .MP4 (30–90 วินาที)...'
                          : 'สร้างวิดีโอ .MP4 & แทรกเข้า Content'}
                      </button>
                    </div>

                    {selectedVideoUrl && (
                      <div className="pt-2 space-y-2">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="text-xs font-semibold text-emerald-700">
                            ✓ วิดีโอ .MP4 แนบและฝังใน Content เรียบร้อยแล้ว
                          </span>
                          <a
                            href={selectedVideoUrl}
                            download
                            className="inline-flex items-center gap-1 rounded-lg bg-[#0a101d] px-3 py-1.5 text-xs font-semibold text-white"
                          >
                            <Download className="w-3.5 h-3.5" /> ดาวน์โหลด .MP4
                          </a>
                        </div>
                        <video
                          controls
                          playsInline
                          src={selectedVideoUrl}
                          className="w-full max-w-2xl rounded-xl border border-slate-200 bg-black aspect-video"
                        />
                      </div>
                    )}
                  </div>

                  <div className="overflow-x-auto rounded-xl border border-slate-200/80">
                    <table className="w-full text-left border-collapse text-xs">
                      <thead>
                        <tr className="bg-slate-900 text-white">
                          <th className="p-3">เวลา</th>
                          <th className="p-3">มุมกล้อง / ภาพ</th>
                          <th className="p-3">บทพูด</th>
                          <th className="p-3">ซับไตเติล</th>
                          <th className="p-3">B-Roll</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200/80">
                        {(activeWf.videoOutput?.scenes || []).map((sc, i) => (
                          <tr key={i} className="hover:bg-slate-50/70">
                            <td className="p-3 font-semibold text-slate-900 whitespace-nowrap">
                              {sc.time}
                            </td>
                            <td className="p-3 text-slate-600">{sc.visual}</td>
                            <td className="p-3 font-medium text-slate-900">
                              “{sc.dialogue}”
                            </td>
                            <td className="p-3 text-amber-800 font-medium">
                              {sc.subtitle}
                            </td>
                            <td className="p-3 text-slate-500">{sc.bRoll}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* TAB 06: AUDIO PRODUCTION AGENT */}
              {activeAgentTab === 'audio' && (
                <div className="rounded-2xl bg-white border border-slate-200/80 p-5 sm:p-6 space-y-4 shadow-2xs">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="text-base sm:text-lg font-bold text-slate-900 flex items-center gap-2">
                      <Mic className="w-5 h-5 text-amber-600" />
                      06 Audio Production Agent • เสียงพากย์ AI แนบบทความ
                    </h3>
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        disabled={mediaBusy === 'audio'}
                        onClick={handleGenerateRealAudio}
                        className="inline-flex items-center gap-1.5 rounded-xl bg-[#0a101d] px-4 py-2 text-xs font-semibold text-amber-300 hover:bg-slate-800 cursor-pointer disabled:opacity-50"
                      >
                        {mediaBusy === 'audio' ? (
                          <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <Mic className="w-3.5 h-3.5" />
                        )}
                        {mediaBusy === 'audio'
                          ? 'กำลังสังเคราะห์เสียง...'
                          : 'สร้างไฟล์เสียงพากย์แนบ Content'}
                      </button>
                      <button
                        onClick={() =>
                          toggleVoicePreview(
                            activeWf.audioOutput?.narrationScriptWithCues || ''
                          )
                        }
                        className={`inline-flex items-center gap-1.5 rounded-xl border px-3.5 py-2 text-xs font-semibold transition cursor-pointer ${
                          speaking
                            ? 'bg-rose-600 text-white border-rose-600'
                            : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
                        }`}
                      >
                        {speaking ? (
                          <Square className="w-3.5 h-3.5" />
                        ) : (
                          <Volume2 className="w-3.5 h-3.5" />
                        )}
                        {speaking ? 'หยุดฟัง' : 'ทดลองฟังเสียงอ่าน'}
                      </button>
                    </div>
                  </div>

                  {selectedAudioUrl && (
                    <div className="rounded-xl bg-slate-50 border border-slate-200 p-4 space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-semibold text-emerald-700">
                          ✓ ไฟล์เสียงพากย์พร้อมแนบกับ Content
                        </span>
                        <a
                          href={selectedAudioUrl}
                          download
                          className="inline-flex items-center gap-1 rounded-lg bg-[#0a101d] px-3 py-1 text-xs font-semibold text-white"
                        >
                          <Download className="w-3.5 h-3.5" /> ดาวน์โหลดเสียง
                        </a>
                      </div>
                      <audio controls src={selectedAudioUrl} className="w-full" />
                    </div>
                  )}

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                    <div className="rounded-xl bg-slate-50/80 p-3.5 border border-slate-200/80">
                      <div className="font-bold text-slate-800">โทนเสียงพากย์</div>
                      <p className="mt-1 text-slate-600">{activeWf.audioOutput?.voiceTone}</p>
                    </div>
                    <div className="rounded-xl bg-slate-50/80 p-3.5 border border-slate-200/80">
                      <div className="font-bold text-slate-800">ดนตรีประกอบ & Sound Effect</div>
                      <p className="mt-1 text-slate-600">{activeWf.audioOutput?.bgmStyle}</p>
                    </div>
                  </div>

                  <div className="rounded-xl bg-[#0a101d] text-white p-4">
                    <div className="text-xs font-semibold text-amber-300 mb-2">
                      บทพากย์พร้อมจุดเน้นจังหวะเสียง:
                    </div>
                    <p className="text-sm font-body leading-relaxed text-slate-200">
                      {activeWf.audioOutput?.narrationScriptWithCues}
                    </p>
                  </div>
                </div>
              )}

              {/* TAB 08: ANALYTICS & IMPROVEMENT AGENT */}
              {activeAgentTab === 'qa_analytics' && (
                <div className="rounded-2xl bg-white border border-slate-200/80 p-5 sm:p-6 space-y-5 shadow-2xs">
                  <h3 className="text-base sm:text-lg font-bold text-slate-900 flex items-center gap-2">
                    <BarChart3 className="w-5 h-5 text-teal-600" />
                    08 Analytics & Improvement Agent • วิเคราะห์ผลและพัฒนาต่อเนื่อง
                  </h3>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div className="rounded-xl bg-slate-50 border border-slate-200/80 p-4">
                      <div className="text-[11px] font-semibold text-slate-500">คาดการณ์การเข้าถึง</div>
                      <div className="mt-1 text-base font-bold text-slate-900">
                        {activeWf.analyticsOutput?.predictedReach}
                      </div>
                    </div>
                    <div className="rounded-xl bg-slate-50 border border-slate-200/80 p-4">
                      <div className="text-[11px] font-semibold text-slate-500">คาดการณ์การมีส่วนร่วม</div>
                      <div className="mt-1 text-sm font-bold text-slate-900">
                        {activeWf.analyticsOutput?.predictedEngagement}
                      </div>
                    </div>
                    <div className="rounded-xl bg-slate-50 border border-slate-200/80 p-4">
                      <div className="text-[11px] font-semibold text-slate-500">ความตรงกลุ่มผู้เรียน</div>
                      <div className="mt-1 text-sm font-bold text-slate-900">
                        {activeWf.analyticsOutput?.targetLearnerFit}
                      </div>
                    </div>
                  </div>

                  <div className="rounded-xl bg-slate-50/80 border border-slate-200/80 p-4 space-y-2">
                    <div className="text-xs font-bold text-slate-800">
                      แนวทางปรับปรุงและต่อยอดคอนเทนต์ถัดไป:
                    </div>
                    {(activeWf.analyticsOutput?.optimizationTips || []).map((tip, i) => (
                      <div key={i} className="text-xs text-slate-600">
                        • {tip}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* TAB PUBLISH & DISTRIBUTE: 8 CHANNELS */}
              {activeAgentTab === 'omnichannel' && (
                <div className="rounded-2xl bg-white border border-slate-200/80 p-5 sm:p-6 space-y-4 shadow-2xs">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <span className="text-[11px] font-bold uppercase tracking-wider text-rose-600">
                        PUBLISH & DISTRIBUTE • เผยแพร่สู่ทุกช่องทาง
                      </span>
                      <h3 className="text-base sm:text-lg font-bold text-slate-900 mt-0.5">
                        ชุดข้อความพร้อมกระจายสู่ Website, Social และ Newsletter ครบ 8 ช่องทาง
                      </h3>
                    </div>
                    {activeWf.status !== 'published' && (
                      <button
                        onClick={handleApproveAndPublish}
                        className="inline-flex items-center gap-1.5 rounded-xl bg-[#0a101d] px-4 py-2.5 text-xs font-semibold text-amber-300 hover:bg-slate-800 cursor-pointer"
                      >
                        <Send className="w-3.5 h-3.5" /> อนุมัติ & เผยแพร่ทุกช่องทาง
                      </button>
                    )}
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                    {[
                      {
                        name: 'YouTube',
                        content: `${activeWf.omnichannelOutput?.youtube?.title}\n\n${activeWf.omnichannelOutput?.youtube?.description}`,
                      },
                      {
                        name: 'Facebook',
                        content: `${activeWf.omnichannelOutput?.facebook?.post}\n\n💬 ${activeWf.omnichannelOutput?.facebook?.engagementQuestion}`,
                      },
                      {
                        name: 'TikTok',
                        content: `Hook: ${activeWf.omnichannelOutput?.tiktok?.hook}\n${activeWf.omnichannelOutput?.tiktok?.caption}\n${(activeWf.omnichannelOutput?.tiktok?.hashtags || []).join(' ')}`,
                      },
                      {
                        name: 'LINE OA',
                        content: `${activeWf.omnichannelOutput?.lineOa?.headline}\n${activeWf.omnichannelOutput?.lineOa?.broadcastMessage}`,
                      },
                      {
                        name: 'X (Twitter)',
                        content: (activeWf.omnichannelOutput?.xTwitter?.thread || []).join('\n\n'),
                      },
                      {
                        name: 'Instagram',
                        content: `${(activeWf.omnichannelOutput?.instagram?.carouselSlides || []).join('\n')}\n\n${activeWf.omnichannelOutput?.instagram?.caption}`,
                      },
                      {
                        name: 'Website / Blog',
                        content: `Slug: /${activeWf.omnichannelOutput?.websiteBlog?.slug}\nSEO Meta: ${activeWf.omnichannelOutput?.websiteBlog?.seoMeta}`,
                      },
                      {
                        name: 'Email / Newsletter',
                        content: `Subject: ${activeWf.omnichannelOutput?.emailNewsletter?.subject}\n\n${activeWf.omnichannelOutput?.emailNewsletter?.bodyIntro}`,
                      },
                    ].map((ch) => (
                      <div
                        key={ch.name}
                        className="rounded-xl border border-slate-200/80 p-4 bg-slate-50/60 flex flex-col justify-between"
                      >
                        <div>
                          <div className="flex items-center justify-between gap-2 mb-2">
                            <span className="text-xs font-bold text-slate-900">
                              {ch.name}
                            </span>
                            <button
                              onClick={() => copyText(ch.name, ch.content)}
                              className="inline-flex items-center gap-1 rounded-lg bg-white border border-slate-200 px-2.5 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-100 cursor-pointer"
                            >
                              {copiedKey === ch.name ? (
                                <Check className="w-3 h-3 text-emerald-600" />
                              ) : (
                                <Copy className="w-3 h-3" />
                              )}
                              {copiedKey === ch.name ? 'คัดลอกแล้ว' : 'คัดลอก'}
                            </button>
                          </div>
                          <pre className="whitespace-pre-wrap text-xs text-slate-600 font-body leading-relaxed">
                            {ch.content}
                          </pre>
                        </div>
                        {ch.name === 'Website / Blog' &&
                          activeWf.humanApproval?.publishedPostId && (
                            <button
                              onClick={() =>
                                onOpenPublishedPost(
                                  activeWf.humanApproval.publishedPostId!
                                )
                              }
                              className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-emerald-700 hover:underline cursor-pointer"
                            >
                              <Eye className="w-3.5 h-3.5" /> เปิดดูโพสต์จริงบนเว็บไซต์ →
                            </button>
                          )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* ===================================================================== */}
      {/* AI TOOLS ECOSYSTEM MATRIX (REFINED MINIMAL LUXURY BAR)                */}
      {/* ===================================================================== */}
      <div className="rounded-2xl bg-white border border-slate-200/80 p-5 shadow-2xs">
        <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-3">
          AI TOOLS ECOSYSTEM • เครื่องมือ AI ที่ทำงานร่วมกันในแต่ละ Agent ของ KOMKID BY KOMKRIT
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2.5">
          {AI_TOOLS_ECOSYSTEM.map((col) => (
            <div
              key={col.group}
              className="rounded-xl border border-slate-200/80 overflow-hidden bg-white"
            >
              <div
                className={`px-2.5 py-1.5 text-[10px] font-extrabold border-b ${col.accent}`}
              >
                {col.group}
              </div>
              <ul className="p-2.5 space-y-1 text-[11px] text-slate-600">
                {col.tools.map((tool) => (
                  <li key={tool} className="truncate">
                    • {tool}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>

      {/* ===================================================================== */}
      {/* BLUEPRINT REFERENCE MODAL (SHOWS BOTH UPLOADED ARCHITECTURE DIAGRAMS) */}
      {/* ===================================================================== */}
      {blueprintModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/75 backdrop-blur-xs p-4 overflow-y-auto"
          onClick={() => setBlueprintModalOpen(false)}
        >
          <div
            className="my-auto w-full max-w-5xl max-h-[90vh] overflow-y-auto rounded-2xl bg-white p-5 sm:p-6 shadow-2xl space-y-5"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-widest text-amber-600">
                  KOMKID ARCHITECTURE BLUEPRINTS
                </div>
                <h3 className="text-base sm:text-lg font-bold text-slate-900">
                  ผังสถาปัตยกรรมต้นฉบับ AGENT CEO (01–08) & AI Co-work 4 ธุรกิจหลัก
                </h3>
              </div>
              <button
                onClick={() => setBlueprintModalOpen(false)}
                className="p-1.5 rounded-full hover:bg-slate-100 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <div className="text-xs font-bold text-slate-700">
                  1. AI Content Creation Flow — AGENT CEO & 01–08 Specialized Agents
                </div>
                <img
                  src="/images/blueprint-8agent-flow.jpg"
                  alt="AI Content Creation Flow"
                  className="w-full rounded-xl border border-slate-200"
                />
              </div>
              <div className="space-y-1.5">
                <div className="text-xs font-bold text-slate-700">
                  2. KOM KID by Komkrit — AI Co-work & 4 Revenue Engines
                </div>
                <img
                  src="/images/blueprint-komkid-cowork.jpg"
                  alt="KOM KID AI Co-work"
                  className="w-full rounded-xl border border-slate-200"
                />
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
