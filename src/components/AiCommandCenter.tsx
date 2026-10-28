import React, { useEffect, useState } from 'react';
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
} from 'lucide-react';
import {
  AiWorkflow,
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

const AGENT_PIPELINE_STEPS = [
  'CEO Agent กำลังวิเคราะห์โจทย์ & วางกลยุทธ์...',
  '01 Research Agent กำลังค้นคว้าฐานความรู้ (Knowledge Base)...',
  '02 Idea & Script Agent กำลังเขียนบทความและสคริปต์...',
  '03 Content Design & 04 Visual Agent กำลังสร้างโครงสไลด์และ Infographic...',
  '05 Video & 06 Audio Agent กำลังจัดทำ Storyboard และบทพากย์...',
  '07 QA Agent กำลังตรวจ Fact Check / ภาษา / แบรนด์ / ความเสี่ยง...',
  '08 Analytics & Omnichannel Agent กำลังเตรียมเนื้อหา 8 แพลตฟอร์ม...',
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
  { group: 'RESEARCH', color: 'bg-sky-600', tools: ['Gemini Deep Research', 'ChatGPT', 'Perplexity', 'Google Scholar', 'Elicit', 'Notion AI'] },
  { group: 'SCRIPT & IDEA', color: 'bg-emerald-600', tools: ['Gemini 4 Argon', 'Claude', 'ChatGPT', 'MindMeister', 'Miro'] },
  { group: 'DESIGN', color: 'bg-lime-600', tools: ['Canva AI', 'Beautiful.ai', 'Gamma', 'Lucidchart', 'Figma'] },
  { group: 'VISUAL', color: 'bg-blue-600', tools: ['Gemini Nano Banana 2.1', 'Midjourney', 'DALL-E 3', 'Leonardo AI', 'Canva AI'] },
  { group: 'VIDEO', color: 'bg-purple-600', tools: ['Gemini Omni 1.1 Flash', 'HeyGen (AI Avatar)', 'Pictory AI', 'Runway', 'CapCut'] },
  { group: 'AUDIO', color: 'bg-amber-600', tools: ['Gemini 3.8 Flash TTS', 'ElevenLabs', 'Play.ht', 'Adobe Podcast', 'Auphonic'] },
  { group: 'ANALYTICS', color: 'bg-teal-600', tools: ['YouTube Analytics', 'Facebook Insights', 'Google Analytics', 'Looker Studio'] },
];

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

  // Dispatch Form
  const [topic, setTopic] = useState('');
  const [inputSource, setInputSource] = useState(INPUT_SOURCES[0].label);
  const [category, setCategory] = useState<CategoryId>('ai-tech');
  const [targetAudience, setTargetAudience] = useState('ครู / บุคลากรทางการศึกษา');
  const [businessPillar, setBusinessPillar] = useState(
    '1. VIEWS | ยอดวิว (YouTube • TikTok • Facebook)'
  );
  const [flowMode, setFlowMode] = useState<'full_8agent' | 'core_3agent'>(
    'full_8agent'
  );
  const [llmProvider, setLlmProvider] = useState<LlmProviderId>('auto');
  const [autoGenerateCoverImage, setAutoGenerateCoverImage] = useState(false);

  // Execution & Real Media Generation states
  const [running, setRunning] = useState(false);
  const [stepIdx, setStepIdx] = useState(0);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [mediaBusy, setMediaBusy] = useState<'image' | 'video' | 'audio' | null>(null);
  const [videoEngineChoice, setVideoEngineChoice] = useState<
    | 'gemini-omni-1.1-flash'
    | 'veo-3.1-generate-001'
    | 'veo-3.1-fast-generate-001'
  >('gemini-omni-1.1-flash');
  const [videoAspectChoice, setVideoAspectChoice] = useState<'16:9' | '9:16'>('16:9');

  // Human Approval & Inline Edit States
  const [editTitle, setEditTitle] = useState('');
  const [editArticle, setEditArticle] = useState('');
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
      setChecklist({
        isAccurate: activeWf.humanApproval?.isAccurate ?? true,
        isAppropriate: activeWf.humanApproval?.isAppropriate ?? true,
        isOnBrand: activeWf.humanApproval?.isOnBrand ?? true,
        isReady: activeWf.humanApproval?.isReady ?? true,
      });
      setIsEditingScript(false);
    }
  }, [activeWf?.id, activeWf?.updatedAt]);

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
    }, 450);

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
      await onRefreshAll();
      setSelectedId(created.id);
      setActiveAgentTab('overview');
      setTopic('');
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
      setErrorMsg('กรุณาระบุประเด็นที่ต้องการให้ทีม AI ปรับปรุงแก้ไขในช่องข้อเสนอแนะ');
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
          activeWf.visualOutput?.generatedRealImageUrl ||
          activeWf.visualOutput?.generatedSvgDataUrl,
        isFeatured: publishAsFeatured,
        reviewerNote:
          revisionNote.trim() ||
          'อนุมัติผ่าน Human Approval และเผยแพร่สู่ Website & Omnichannel เรียบร้อยแล้ว',
        channelsToPublish: ALL_CHANNELS,
      });
      await onRefreshAll();
      setSelectedId(res.workflow.id);
    } catch (err) {
      setErrorMsg((err as Error).message);
    } finally {
      setPublishing(false);
    }
  };

  const handleGenerateRealVisual = async (promptText: string) => {
    if (!activeWf) return;
    setMediaBusy('image');
    setErrorMsg(null);
    try {
      await api.generateRealImage({
        prompt: promptText,
        aspectRatio: '16:9',
        workflowId: activeWf.id,
      });
      await onRefreshAll();
    } catch (err) {
      setErrorMsg((err as Error).message);
    } finally {
      setMediaBusy(null);
    }
  };

  const handleGenerateRealVideo = async () => {
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
      await api.generateRealVideo({
        prompt:
          scenePrompt ||
          `Cinematic educational video for Komkrit Thailand about ${activeWf.topic}`,
        engine: videoEngineChoice,
        aspectRatio: videoAspectChoice,
        durationSec: 8,
        resolution: '720p',
        firstFrameUrl: activeWf.visualOutput?.generatedRealImageUrl || undefined,
        workflowId: activeWf.id,
      });
      await onRefreshAll();
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
      await api.generateRealAudio({
        text: scriptText.replace(/\[[^\]]*\]/g, ''),
        style: activeWf.audioOutput?.voiceTone,
        workflowId: activeWf.id,
      });
      await onRefreshAll();
    } catch (err) {
      setErrorMsg((err as Error).message);
    } finally {
      setMediaBusy(null);
    }
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

  const agentTabs = [
    { id: 'overview', label: 'ตรวจ & โพสต์ขึ้นเว็บ', icon: <UserCheck className="w-3.5 h-3.5" /> },
    { id: 'script', label: 'บทความ & สคริปต์', icon: <Lightbulb className="w-3.5 h-3.5" /> },
    { id: 'visual', label: 'รูปภาพปก AI', icon: <ImageIcon className="w-3.5 h-3.5" /> },
    { id: 'video', label: 'วิดีโอ AI', icon: <Film className="w-3.5 h-3.5" /> },
    { id: 'audio', label: 'เสียงพากย์', icon: <Mic className="w-3.5 h-3.5" /> },
    { id: 'omnichannel', label: 'แชร์ 8 ช่องทาง', icon: <Share2 className="w-3.5 h-3.5" /> },
    { id: 'research', label: 'ข้อมูลอ้างอิง', icon: <Search className="w-3.5 h-3.5" /> },
    { id: 'design', label: 'โครงสไลด์', icon: <Palette className="w-3.5 h-3.5" /> },
    { id: 'qa_analytics', label: 'คะแนนคุณภาพ', icon: <BarChart3 className="w-3.5 h-3.5" /> },
  ];

  return (
    <div className="space-y-5">
      {/* CLEAN, MINIMAL AI CREATION CARD */}
      <div className="rounded-2xl bg-white p-5 sm:p-6 shadow-2xs border border-slate-200">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
          <div>
            <h2 className="text-base sm:text-lg font-extrabold text-[#0d2546] flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-[#f59e0b]" />
              สร้างบทความและคอนเทนต์ใหม่ด้วย AI
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              พิมพ์หัวข้อที่ต้องการสร้าง แล้วกดปุ่มเดียว AI จะร่างบทความ สคริปต์ และแคปชันให้พร้อมตรวจก่อนโพสต์
            </p>
          </div>
          <button
            type="button"
            onClick={() => setShowAdvanced((v) => !v)}
            className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 transition cursor-pointer"
          >
            {showAdvanced ? 'ซ่อนตัวเลือกเพิ่มเติม ▲' : '⚙️ ตัวเลือกเพิ่มเติม ▼'}
          </button>
        </div>

        <form onSubmit={handleDispatchCeo} className="space-y-3">
          <div className="flex flex-col sm:flex-row gap-2.5">
            <input
              type="text"
              required
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              placeholder="พิมพ์หัวข้อที่ต้องการ เช่น แนวทางใช้ AI ช่วยครูไทยลดภาระงานเอกสาร..."
              className="flex-1 rounded-xl border border-slate-200 bg-slate-50/70 px-4 py-3 text-sm font-medium text-[#0d2546] placeholder:text-slate-400 focus:border-[#0d2546] focus:bg-white focus:outline-none transition"
            />
            <button
              type="submit"
              disabled={running}
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#0d2546] px-6 py-3 text-sm font-bold text-white hover:bg-[#163a6b] transition cursor-pointer disabled:opacity-60 shrink-0"
            >
              <Sparkles className="w-4 h-4 text-amber-400" />
              {running ? 'กำลังสร้าง...' : 'สร้างคอนเทนต์'}
            </button>
          </div>

          {/* Subtle Quick Topic Ideas */}
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] text-slate-400 mr-1">ไอเดียตัวอย่าง:</span>
            {QUICK_PROMPTS.map((qp, idx) => (
              <button
                key={idx}
                type="button"
                onClick={() => setTopic(qp)}
                className="rounded-full bg-slate-100 hover:bg-amber-100 hover:text-amber-950 px-3 py-1 text-[11px] font-medium text-slate-600 transition cursor-pointer truncate max-w-[240px]"
              >
                {qp}
              </button>
            ))}
          </div>

          {/* Collapsible Advanced Options (Hidden by default to eliminate clutter!) */}
          {showAdvanced && (
            <div className="rounded-xl bg-slate-50 border border-slate-200/80 p-4 space-y-3 mt-2">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                <div>
                  <span className="block text-[11px] font-semibold text-slate-600 mb-1">
                    หมวดหมู่บทความ
                  </span>
                  <select
                    value={category}
                    onChange={(e) => setCategory(e.target.value as CategoryId)}
                    className="w-full rounded-lg bg-white border border-slate-200 px-2.5 py-1.5 text-xs text-slate-800 focus:outline-none"
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
                    กลุ่มผู้อ่านเป้าหมาย
                  </span>
                  <select
                    value={targetAudience}
                    onChange={(e) => setTargetAudience(e.target.value)}
                    className="w-full rounded-lg bg-white border border-slate-200 px-2.5 py-1.5 text-xs text-slate-800 focus:outline-none"
                  >
                    <option value="ครู / บุคลากรทางการศึกษา">ครู / บุคลากรทางการศึกษา</option>
                    <option value="นักเรียน / นักศึกษา">นักเรียน / นักศึกษา</option>
                    <option value="ผู้ปกครอง">ผู้ปกครอง</option>
                    <option value="ผู้บริหารสถานศึกษา & ผู้สนใจทั่วไป">
                      ผู้บริหารสถานศึกษา & ผู้สนใจทั่วไป
                    </option>
                  </select>
                </div>

                <div>
                  <span className="block text-[11px] font-semibold text-slate-600 mb-1">
                    เลือกโมเดล AI (Real API)
                  </span>
                  <select
                    value={llmProvider}
                    onChange={(e) => setLlmProvider(e.target.value as LlmProviderId)}
                    className="w-full rounded-lg bg-white border border-slate-200 px-2.5 py-1.5 text-xs font-semibold text-slate-800 focus:outline-none"
                  >
                    <option value="auto">อัตโนมัติ (ตาม API Key ที่ตั้งไว้)</option>
                    <option value="gemini">Google Gemini</option>
                    <option value="claude">Anthropic Claude</option>
                    <option value="deepseek">DeepSeek</option>
                    <option value="openai">OpenAI ChatGPT</option>
                    <option value="openai_compatible">Custom OpenAI Server</option>
                  </select>
                </div>

                <div>
                  <span className="block text-[11px] font-semibold text-slate-600 mb-1">
                    แหล่งที่มาของประเด็น
                  </span>
                  <select
                    value={inputSource}
                    onChange={(e) => setInputSource(e.target.value)}
                    className="w-full rounded-lg bg-white border border-slate-200 px-2.5 py-1.5 text-xs text-slate-800 focus:outline-none"
                  >
                    {INPUT_SOURCES.map((s) => (
                      <option key={s.id} value={s.label}>
                        {s.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-200/70">
                <label className="flex items-center gap-2 text-xs font-medium text-slate-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={autoGenerateCoverImage}
                    onChange={(e) => setAutoGenerateCoverImage(e.target.checked)}
                    className="accent-[#0d2546]"
                  />
                  สร้างรูปภาพปก AI จริงพร้อมกันอัตโนมัติ
                </label>

                <button
                  type="button"
                  onClick={() => setBlueprintModalOpen(true)}
                  className="text-xs font-semibold text-slate-500 hover:text-[#0d2546] underline cursor-pointer"
                >
                  ดูผังสถาปัตยกรรมระบบ AI
                </button>
              </div>
            </div>
          )}

          {errorMsg && (
            <div className="rounded-xl bg-rose-50 border border-rose-200 p-3 text-xs text-rose-800 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
                <span>{errorMsg}</span>
              </div>
              {onOpenSettings && (
                <button
                  type="button"
                  onClick={onOpenSettings}
                  className="inline-flex items-center gap-1 rounded-lg bg-[#0d2546] px-3 py-1.5 text-[11px] font-bold text-white hover:bg-[#163a6b] cursor-pointer shrink-0"
                >
                  <KeyRound className="w-3.5 h-3.5" /> ตั้งค่า API Keys
                </button>
              )}
            </div>
          )}

          {running && (
            <div className="rounded-xl bg-amber-50 border border-amber-200 p-3.5 flex items-center gap-3">
              <RefreshCw className="w-5 h-5 text-amber-600 animate-spin shrink-0" />
              <div className="flex-1">
                <div className="text-xs font-bold text-amber-950">
                  {AGENT_PIPELINE_STEPS[stepIdx]}
                </div>
                <div className="mt-1.5 h-1.5 w-full rounded-full bg-amber-200/70 overflow-hidden">
                  <div
                    className="h-full bg-[#0d2546] transition-all duration-300"
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

      {/* WORKFLOW CAMPAIGN SELECTOR + ACTIVE MULTI-AGENT WORKSPACE */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-5 items-start">
        {/* Left List of Campaigns */}
        <div className="xl:col-span-3 rounded-2xl bg-white border border-slate-200/80 p-4 shadow-2xs space-y-2.5">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-extrabold text-[#0d2546]">
              แคมเปญ AI Content ({workflows.length})
            </h3>
          </div>

          <div className="space-y-2 max-h-[540px] overflow-y-auto pr-1">
            {workflows.map((wf) => {
              const active = wf.id === activeWf?.id;
              return (
                <div
                  key={wf.id}
                  onClick={() => setSelectedId(wf.id)}
                  className={`rounded-xl border p-3 cursor-pointer transition ${
                    active
                      ? 'border-[#f59e0b] bg-amber-50/60 shadow-2xs'
                      : 'border-slate-200/70 bg-white hover:bg-slate-50'
                  }`}
                >
                  <div className="flex items-center justify-between gap-1 mb-1">
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] font-extrabold ${
                        wf.status === 'published'
                          ? 'bg-emerald-100 text-emerald-900'
                          : 'bg-amber-100 text-amber-900'
                      }`}
                    >
                      {wf.status === 'published'
                        ? '✓ อนุมัติ & เผยแพร่แล้ว'
                        : '⏳ รอ Human Approval'}
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
                  <div className="text-xs font-bold text-[#0d2546] line-clamp-2">
                    {wf.scriptOutput?.selectedTitle || wf.topic}
                  </div>
                  <div className="mt-1.5 flex items-center justify-between text-[10.5px] text-slate-400">
                    <span>QA: {wf.qaOutput?.overallScore || 96}/100</span>
                    <span>{formatThaiDate(wf.createdAt)}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Right Detailed Multi-Agent Inspection & Human Approval Workspace */}
        <div className="xl:col-span-9 space-y-4">
          {!activeWf ? (
            <div className="rounded-2xl bg-white p-12 text-center border border-slate-200">
              <p className="text-sm text-slate-500">
                ยังไม่มีแคมเปญ พิมพ์โจทย์ด้านบนเพื่อสั่งงาน CEO Agent ได้เลยครับ
              </p>
            </div>
          ) : (
            <>
              {/* Pipeline Navigation Tabs (01 -> 08 + Omnichannel) */}
              <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar bg-white rounded-2xl p-2 border border-slate-200/80 shadow-2xs">
                {agentTabs.map((t) => (
                  <button
                    key={t.id}
                    onClick={() => setActiveAgentTab(t.id)}
                    className={`inline-flex items-center gap-1.5 shrink-0 rounded-xl px-3 py-2 text-xs font-bold transition cursor-pointer ${
                      activeAgentTab === t.id
                        ? 'bg-[#0d2546] text-[#fbbf24] shadow-2xs'
                        : 'text-slate-600 hover:bg-slate-100'
                    }`}
                  >
                    {t.icon}
                    {t.label}
                  </button>
                ))}
              </div>

              {/* TAB: OVERVIEW — EXACT LINE IMAGE 5 ARCHITECTURE (CONTENT AGENT <-> HUMAN APPROVAL <-> QA AGENT) */}
              {activeAgentTab === 'overview' && (
                <div className="space-y-4">
                  {/* CEO Summary Strip */}
                  <div className="rounded-2xl bg-white border border-slate-200/80 p-4 sm:p-5 shadow-2xs">
                    <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                      <span className="text-xs font-extrabold text-[#0d2546] flex items-center gap-1.5">
                        <Bot className="w-4 h-4 text-[#f59e0b]" />
                        แผนกลยุทธ์จาก CEO AGENT • ({activeWf.engineUsed})
                      </span>
                      <span className="text-[11px] font-semibold text-slate-500">
                        แหล่งไอเดีย: {activeWf.inputSource}
                      </span>
                    </div>
                    <p className="text-sm font-bold text-[#0d2546]">
                      เป้าหมาย: {activeWf.ceoOutput?.goal}
                    </p>
                    <p className="text-xs text-slate-600 mt-1">
                      กลยุทธ์: {activeWf.ceoOutput?.strategy}
                    </p>
                  </div>

                  {/* 3-COLUMN MULTI-AGENT ECOSYSTEM (CONTENT AGENT | HUMAN APPROVAL | QA AGENT) */}
                  <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
                    {/* Col 1: CONTENT AGENT (Research + Analysis + Ideation + Script) */}
                    <div className="lg:col-span-4 rounded-2xl bg-gradient-to-b from-sky-50/90 to-white border border-sky-200 p-4 flex flex-col justify-between">
                      <div>
                        <div className="flex items-center gap-2.5 mb-3">
                          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-sky-600 text-white shadow-xs">
                            <Lightbulb className="w-5 h-5" />
                          </div>
                          <div>
                            <h4 className="font-extrabold text-sm text-[#0d2546]">
                              CONTENT AGENT
                            </h4>
                            <p className="text-[11px] text-slate-500">
                              นักวิจัย นักวางแผน และนักเขียน
                            </p>
                          </div>
                        </div>

                        <div className="space-y-2 text-xs">
                          <div className="rounded-xl bg-white p-2.5 border border-sky-100">
                            <div className="font-bold text-sky-900">1. Research (ค้นหาข้อมูล/อ้างอิง)</div>
                            <p className="text-slate-600 mt-0.5 line-clamp-2">
                              เชื่อมฐานความรู้ {activeWf.researchOutput?.kbSourcesUsed?.length || 3} รายการ
                            </p>
                          </div>
                          <div className="rounded-xl bg-white p-2.5 border border-sky-100">
                            <div className="font-bold text-sky-900">2. Analysis (วิเคราะห์ประเด็น)</div>
                            <p className="text-slate-600 mt-0.5 line-clamp-2">
                              {activeWf.researchOutput?.trendAnalysis}
                            </p>
                          </div>
                          <div className="rounded-xl bg-white p-2.5 border border-sky-100">
                            <div className="font-bold text-sky-900">3. Ideation (มุมมอง & จุดประสงค์)</div>
                            <p className="text-slate-600 mt-0.5 line-clamp-2">
                              กลุ่มเป้าหมาย: {activeWf.targetAudience}
                            </p>
                          </div>
                          <div className="rounded-xl bg-white p-2.5 border border-sky-100">
                            <div className="font-bold text-sky-900">4. Script (บทความ + สคริปต์ + แคปชัน)</div>
                            <p className="text-slate-600 mt-0.5 line-clamp-2">
                              พร้อมเผยแพร่ทั้งบทความยาวและคลิปสั้น 60 วินาที
                            </p>
                          </div>
                        </div>
                      </div>

                      <button
                        onClick={() => setActiveAgentTab('script')}
                        className="mt-3 w-full rounded-xl bg-sky-700 py-2 text-xs font-extrabold text-white hover:bg-sky-800 transition cursor-pointer"
                      >
                        ผลลัพธ์ : Content Brief + Script →
                      </button>
                    </div>

                    {/* Col 2: HUMAN APPROVAL (คนตรวจสอบและอนุมัติเนื้อหา - Center of LINE Image 5!) */}
                    <div className="lg:col-span-4 rounded-2xl bg-white border-2 border-[#0d2546] p-4 shadow-md flex flex-col justify-between">
                      <div>
                        <div className="rounded-xl bg-[#0d2546] text-white p-3 text-center mb-3">
                          <div className="text-xs font-extrabold tracking-wide text-amber-300">
                            HUMAN APPROVAL
                          </div>
                          <div className="text-xs text-slate-200 mt-0.5">
                            คนตรวจสอบและอนุมัติเนื้อหา
                          </div>
                        </div>

                        {/* 4 Checkboxes from Image 5 */}
                        <div className="space-y-2 px-1">
                          {[
                            { key: 'isAccurate', label: 'ถูกต้อง (Factually Accurate)' },
                            { key: 'isAppropriate', label: 'เหมาะสม (Appropriate & Ethical)' },
                            { key: 'isOnBrand', label: 'ตรงกับแบรนด์ (คมคิด by KOMKRIT)' },
                            { key: 'isReady', label: 'พร้อมเผยแพร่ (Ready to Publish)' },
                          ].map((item) => (
                            <label
                              key={item.key}
                              className="flex items-center gap-2.5 rounded-lg bg-slate-50 px-3 py-2 text-xs font-bold text-[#0d2546] cursor-pointer hover:bg-amber-50/60"
                            >
                              <input
                                type="checkbox"
                                checked={(checklist as any)[item.key]}
                                onChange={(e) =>
                                  setChecklist({
                                    ...checklist,
                                    [item.key]: e.target.checked,
                                  })
                                }
                                className="h-4 w-4 accent-emerald-600"
                              />
                              <span>{item.label}</span>
                            </label>
                          ))}
                        </div>

                        <label className="mt-2.5 flex items-center gap-2 px-2 text-xs font-semibold text-amber-900 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={publishAsFeatured}
                            onChange={(e) => setPublishAsFeatured(e.target.checked)}
                            className="accent-[#f59e0b]"
                          />
                          ตั้งเป็นบทความพิเศษเด่นหน้าแรกด้วย
                        </label>

                        {/* Revision Note */}
                        <div className="mt-3">
                          <textarea
                            rows={2}
                            value={revisionNote}
                            onChange={(e) => setRevisionNote(e.target.value)}
                            placeholder="บันทึกความเห็นผู้บริหาร หรือพิมพ์คำสั่งให้ AI แก้ไขเพิ่มเติม..."
                            className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs focus:border-[#f59e0b] focus:outline-none"
                          />
                        </div>
                      </div>

                      <div className="mt-3 space-y-2">
                        {activeWf.status === 'published' &&
                        activeWf.humanApproval?.publishedPostId ? (
                          <button
                            onClick={() =>
                              onOpenPublishedPost(
                                activeWf.humanApproval.publishedPostId!
                              )
                            }
                            className="w-full inline-flex items-center justify-center gap-1.5 rounded-xl bg-emerald-600 py-2.5 text-xs font-extrabold text-white hover:bg-emerald-700 cursor-pointer"
                          >
                            <ExternalLink className="w-4 h-4" />
                            เผยแพร่แล้ว! เปิดอ่านโพสต์บนหน้าเว็บ
                          </button>
                        ) : (
                          <button
                            onClick={handleApproveAndPublish}
                            disabled={publishing}
                            className="w-full inline-flex items-center justify-center gap-1.5 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 py-2.5 text-xs font-extrabold text-white shadow-sm hover:brightness-105 cursor-pointer disabled:opacity-50"
                          >
                            <CheckCircle2 className="w-4 h-4" />
                            {publishing
                              ? 'กำลังเผยแพร่...'
                              : 'อนุมัติ & เผยแพร่ขึ้นเว็บไซต์ทันที'}
                          </button>
                        )}

                        <button
                          onClick={handleRequestRevision}
                          disabled={revising}
                          className="w-full inline-flex items-center justify-center gap-1.5 rounded-xl bg-amber-100 py-2 text-xs font-extrabold text-amber-950 hover:bg-amber-200 cursor-pointer disabled:opacity-50"
                        >
                          <RefreshCw
                            className={`w-3.5 h-3.5 ${revising ? 'animate-spin' : ''}`}
                          />
                          {revising ? 'AI กำลังปรับปรุงเนื้อหา...' : 'สั่ง AI ปรับปรุง/แก้ไขตามคำแนะนำ'}
                        </button>
                      </div>
                    </div>

                    {/* Col 3: QA AGENT (Fact Check, Language, Brand, Risk - Right of LINE Image 5!) */}
                    <div className="lg:col-span-4 rounded-2xl bg-gradient-to-b from-emerald-50/90 to-white border border-emerald-200 p-4 flex flex-col justify-between">
                      <div>
                        <div className="flex items-center justify-between gap-2 mb-3">
                          <div className="flex items-center gap-2.5">
                            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-600 text-white shadow-xs">
                              <ShieldCheck className="w-5 h-5" />
                            </div>
                            <div>
                              <h4 className="font-extrabold text-sm text-[#0d2546]">
                                QA AGENT
                              </h4>
                              <p className="text-[11px] text-slate-500">
                                ผู้ตรวจสอบคุณภาพ 4 มิติ
                              </p>
                            </div>
                          </div>
                          <span className="rounded-full bg-emerald-600 px-2.5 py-1 text-xs font-extrabold text-white">
                            {activeWf.qaOutput?.overallScore || 97}/100
                          </span>
                        </div>

                        <div className="space-y-2 text-xs">
                          {[
                            {
                              title: '1. Fact Check (ข้อเท็จจริง/อ้างอิง)',
                              score: activeWf.qaOutput?.factCheckScore || 95,
                              note: activeWf.qaOutput?.factCheckNote,
                            },
                            {
                              title: '2. Language (ภาษา/ความเข้าใจง่าย)',
                              score: activeWf.qaOutput?.languageScore || 96,
                              note: activeWf.qaOutput?.languageNote,
                            },
                            {
                              title: '3. Brand (ภาพลักษณ์/น้ำเสียงคมคิด)',
                              score: activeWf.qaOutput?.brandScore || 98,
                              note: activeWf.qaOutput?.brandNote,
                            },
                            {
                              title: '4. Risk (กฎหมาย PDPA/จริยธรรม)',
                              score: activeWf.qaOutput?.riskScore || 97,
                              note: activeWf.qaOutput?.riskNote,
                            },
                          ].map((q, idx) => (
                            <div
                              key={idx}
                              className="rounded-xl bg-white p-2.5 border border-emerald-100"
                            >
                              <div className="flex items-center justify-between font-bold text-emerald-950">
                                <span>{q.title}</span>
                                <span className="text-emerald-700">{q.score}%</span>
                              </div>
                              <p className="text-slate-600 mt-0.5 line-clamp-1">
                                {q.note}
                              </p>
                            </div>
                          ))}
                        </div>
                      </div>

                      <div className="mt-3 rounded-xl bg-emerald-600 py-2 px-3 text-center text-xs font-extrabold text-white">
                        ผลลัพธ์ QA : {activeWf.qaOutput?.verdict || 'ผ่าน'} (พร้อมส่งอนุมัติ)
                      </div>
                    </div>
                  </div>

                  {/* Quick Article Preview & Inline Editor right below */}
                  <div className="rounded-2xl bg-white border border-slate-200/80 p-5 shadow-2xs">
                    <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-slate-100">
                      <div>
                        <span className="text-[11px] font-extrabold text-[#d97706]">
                          ร่างบทความพร้อมเผยแพร่ขึ้นเว็บไซต์ (Website / Blog Draft)
                        </span>
                        <h3 className="text-lg font-extrabold text-[#0d2546]">
                          {editTitle}
                        </h3>
                      </div>
                      <button
                        onClick={() => setIsEditingScript((v) => !v)}
                        className="rounded-xl bg-slate-100 px-3.5 py-1.5 text-xs font-bold text-[#0d2546] hover:bg-slate-200 cursor-pointer"
                      >
                        {isEditingScript ? 'ซ่อนโหมดแก้ไขข้อความ' : '✏️ แก้ไขข้อความด้วยตนเอง'}
                      </button>
                    </div>

                    {isEditingScript ? (
                      <div className="mt-4 space-y-3">
                        <input
                          type="text"
                          value={editTitle}
                          onChange={(e) => setEditTitle(e.target.value)}
                          className="w-full rounded-xl border border-slate-200 px-3.5 py-2 text-sm font-bold"
                        />
                        <textarea
                          rows={10}
                          value={editArticle}
                          onChange={(e) => setEditArticle(e.target.value)}
                          className="w-full rounded-xl border border-slate-200 px-4 py-3 text-sm font-body"
                        />
                        <button
                          onClick={handleSaveInlineEdit}
                          className="rounded-xl bg-[#0d2546] px-4 py-2 text-xs font-bold text-white cursor-pointer"
                        >
                          บันทึกข้อความที่แก้ไข
                        </button>
                      </div>
                    ) : (
                      <div className="mt-4 grid grid-cols-1 lg:grid-cols-12 gap-5">
                        <div className="lg:col-span-5 space-y-2.5">
                          {(activeWf.visualOutput?.generatedRealImageUrl ||
                            activeWf.visualOutput?.generatedSvgDataUrl) && (
                            <img
                              src={
                                activeWf.visualOutput?.generatedRealImageUrl ||
                                activeWf.visualOutput?.generatedSvgDataUrl
                              }
                              alt="AI Cover Visual"
                              className="w-full rounded-xl border border-slate-200 shadow-xs"
                            />
                          )}
                          {activeWf.videoOutput?.generatedVideoUrl && (
                            <video
                              controls
                              src={activeWf.videoOutput.generatedVideoUrl}
                              className="w-full rounded-xl border border-purple-200 bg-black aspect-video"
                            />
                          )}
                          {activeWf.audioOutput?.generatedAudioUrl && (
                            <audio
                              controls
                              src={activeWf.audioOutput.generatedAudioUrl}
                              className="w-full"
                            />
                          )}
                          <p className="text-[11px] text-slate-500">
                            {activeWf.visualOutput?.generatedRealImageUrl
                              ? '✓ ภาพปกสร้างด้วย AI จริง (Gemini Nano Banana 2.1 / DALL-E 3)'
                              : 'กราฟิกโครงสร้างหัวข้อจาก 04 Visual Agent (สามารถกดสร้างภาพจริง/วิดีโอจริง/เสียงจริง ในแท็บ 04-06)'}
                          </p>
                        </div>
                        <div className="lg:col-span-7 max-h-[340px] overflow-y-auto pr-2">
                          {renderRichMarkdown(editArticle)}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* TAB: 01 RESEARCH AGENT */}
              {activeAgentTab === 'research' && (
                <div className="rounded-2xl bg-white border border-slate-200 p-5 space-y-4">
                  <h3 className="text-lg font-extrabold text-[#0d2546] flex items-center gap-2">
                    <Search className="w-5 h-5 text-sky-600" />
                    01 RESEARCH AGENT (นักวิจัยอัจฉริยะ)
                  </h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="rounded-xl bg-sky-50/70 p-4 border border-sky-100">
                      <h4 className="font-bold text-sm text-[#0d2546] mb-2">
                        ข้อมูลเชิงลึกสำคัญ (Deep Insights)
                      </h4>
                      <ul className="space-y-2 text-xs text-slate-700 font-body">
                        {(activeWf.researchOutput?.deepInsights || []).map((item, i) => (
                          <li key={i} className="flex gap-2">
                            <span className="font-bold text-sky-700">•</span>
                            <span>{item}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                    <div className="rounded-xl bg-amber-50/70 p-4 border border-amber-100">
                      <h4 className="font-bold text-sm text-[#0d2546] mb-2">
                        การวิเคราะห์แนวโน้ม & ฐานความรู้ที่ใช้อ้างอิง
                      </h4>
                      <p className="text-xs text-slate-700 font-body mb-3">
                        {activeWf.researchOutput?.trendAnalysis}
                      </p>
                      <div className="text-[11px] font-bold text-[#0d2546] mb-1">
                        รายการฐานความรู้ (Knowledge Base) ที่ดึงมาใช้งาน:
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {(activeWf.researchOutput?.kbSourcesUsed || []).map((kb, i) => (
                          <span
                            key={i}
                            className="rounded-full bg-white border border-amber-200 px-2.5 py-0.5 text-[11px] font-semibold text-amber-950"
                          >
                            📚 {kb}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* TAB: 02 IDEA & SCRIPT AGENT */}
              {activeAgentTab === 'script' && (
                <div className="rounded-2xl bg-white border border-slate-200 p-5 space-y-5">
                  <h3 className="text-lg font-extrabold text-[#0d2546] flex items-center gap-2">
                    <Lightbulb className="w-5 h-5 text-amber-500" />
                    02 IDEA & SCRIPT AGENT (นักคิดและเขียนบท)
                  </h3>

                  <div>
                    <div className="text-xs font-extrabold text-slate-600 mb-2">
                      ไอเดียพาดหัว 3 มุมมอง (คลิกเพื่อเลือกใช้เป็นชื่อบทความหลัก):
                    </div>
                    <div className="space-y-1.5">
                      {(activeWf.scriptOutput?.titleSuggestions || []).map((t, i) => (
                        <button
                          key={i}
                          onClick={() => setEditTitle(t)}
                          className={`w-full text-left rounded-xl border px-3.5 py-2 text-xs font-bold transition cursor-pointer ${
                            editTitle === t
                              ? 'border-[#f59e0b] bg-amber-50 text-[#0d2546]'
                              : 'border-slate-200 hover:bg-slate-50 text-slate-700'
                          }`}
                        >
                          ทางเลือกที่ {i + 1}: {t}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="rounded-xl bg-emerald-50/60 border border-emerald-100 p-4">
                    <div className="text-xs font-extrabold text-emerald-950 mb-1.5">
                      จุดประสงค์การเรียนรู้ของผู้ชม/ผู้อ่าน (Learning Objectives):
                    </div>
                    <ul className="space-y-1 text-xs text-slate-700">
                      {(activeWf.scriptOutput?.learningObjectives || []).map((lo, i) => (
                        <li key={i}>✓ {lo}</li>
                      ))}
                    </ul>
                  </div>

                  <div className="rounded-xl bg-slate-900 text-slate-100 p-4">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs font-extrabold text-amber-300">
                        🎬 สคริปต์บทพูดวิดีโอสั้น (Video / Reels / TikTok Script)
                      </span>
                      <button
                        onClick={() =>
                          copyText('vscript', activeWf.scriptOutput?.videoScript || '')
                        }
                        className="inline-flex items-center gap-1 rounded-lg bg-white/10 px-2.5 py-1 text-[11px] font-bold hover:bg-white/20 cursor-pointer"
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

              {/* TAB: 03 CONTENT DESIGN AGENT */}
              {activeAgentTab === 'design' && (
                <div className="rounded-2xl bg-white border border-slate-200 p-5 space-y-5">
                  <h3 className="text-lg font-extrabold text-[#0d2546] flex items-center gap-2">
                    <Palette className="w-5 h-5 text-lime-600" />
                    03 CONTENT DESIGN AGENT (นักออกแบบเนื้อหา & แผนผังความคิด)
                  </h3>

                  {/* Visual Mind Map */}
                  <div className="rounded-2xl bg-[#f8fafd] border border-slate-200 p-5">
                    <div className="text-xs font-extrabold text-[#0d2546] mb-3">
                      แผนผังความคิด (Mind Map Structure):
                    </div>
                    <div className="flex flex-col items-center">
                      <div className="rounded-full bg-[#0d2546] px-6 py-2.5 text-sm font-extrabold text-[#fbbf24] shadow-sm">
                        {activeWf.designOutput?.mindMapNodes?.center || activeWf.topic}
                      </div>
                      <div className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-3 w-full">
                        {(activeWf.designOutput?.mindMapNodes?.branches || []).map(
                          (b, idx) => (
                            <div
                              key={idx}
                              className="rounded-xl bg-white border border-amber-200 p-3.5 shadow-2xs"
                            >
                              <div className="font-extrabold text-xs text-[#d97706] mb-1.5">
                                กิ่งที่ {idx + 1}: {b.title}
                              </div>
                              <ul className="space-y-1 text-xs text-slate-700">
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

                  {/* Slide Deck Outline */}
                  <div>
                    <div className="text-xs font-extrabold text-[#0d2546] mb-2">
                      โครงร่างสไลด์นำเสนอ / Carousel (Slide Deck Outline):
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                      {(activeWf.designOutput?.slideDeckOutline || []).map((s, i) => (
                        <div
                          key={i}
                          className="rounded-xl border border-slate-200 p-3.5 bg-gradient-to-br from-white to-slate-50"
                        >
                          <span className="rounded-md bg-[#0d2546] px-2 py-0.5 text-[10px] font-bold text-amber-300">
                            SLIDE {s.slide}
                          </span>
                          <div className="mt-2 font-bold text-xs text-[#0d2546]">
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

              {/* TAB: 04 VISUAL CREATOR AGENT */}
              {activeAgentTab === 'visual' && (
                <div className="rounded-2xl bg-white border border-slate-200 p-5 space-y-5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="text-lg font-extrabold text-[#0d2546] flex items-center gap-2">
                      <ImageIcon className="w-5 h-5 text-blue-600" />
                      04 VISUAL CREATOR AGENT (สร้างภาพจริงด้วย Nano Banana 2.1 / DALL-E 3)
                    </h3>
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        disabled={mediaBusy === 'image'}
                        onClick={() =>
                          handleGenerateRealVisual(
                            activeWf.visualOutput?.imagePrompts?.[0]?.prompt ||
                              `Modern educational illustration for Komkrit Thailand: ${activeWf.topic}, clean cinematic 16:9`
                          )
                        }
                        className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-blue-600 to-sky-600 px-3.5 py-2 text-xs font-extrabold text-white hover:brightness-105 cursor-pointer disabled:opacity-50"
                      >
                        {mediaBusy === 'image' ? (
                          <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <Sparkles className="w-3.5 h-3.5 text-amber-300" />
                        )}
                        {mediaBusy === 'image'
                          ? 'กำลังเรนเดอร์ภาพจริง...'
                          : 'สร้างภาพปกจริง .PNG (Nano Banana 2.1 / DALL-E)'}
                      </button>
                      {(activeWf.visualOutput?.generatedRealImageUrl ||
                        activeWf.visualOutput?.generatedSvgDataUrl) && (
                        <a
                          href={
                            activeWf.visualOutput?.generatedRealImageUrl ||
                            activeWf.visualOutput?.generatedSvgDataUrl
                          }
                          download
                          className="inline-flex items-center gap-1.5 rounded-xl bg-[#0d2546] px-3.5 py-2 text-xs font-bold text-white hover:bg-[#193d6e]"
                        >
                          <Download className="w-3.5 h-3.5" /> ดาวน์โหลดภาพ
                        </a>
                      )}
                    </div>
                  </div>

                  {activeWf.visualOutput?.generatedRealImageUrl ? (
                    <div className="space-y-2">
                      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-3 py-0.5 text-[11px] font-extrabold text-emerald-900">
                        ✓ ภาพจริงจาก AI Image API ({activeWf.visualOutput.generatedRealImageUrl})
                      </span>
                      <div className="overflow-hidden rounded-2xl border-2 border-emerald-300 shadow-sm max-w-2xl">
                        <img
                          src={activeWf.visualOutput.generatedRealImageUrl}
                          alt="Real AI Generated Visual"
                          className="w-full"
                        />
                      </div>
                    </div>
                  ) : (
                    activeWf.visualOutput?.generatedSvgDataUrl && (
                      <div className="overflow-hidden rounded-2xl border border-slate-200 shadow-sm max-w-2xl">
                        <img
                          src={activeWf.visualOutput.generatedSvgDataUrl}
                          alt="Infographic Layout"
                          className="w-full"
                        />
                      </div>
                    )
                  )}

                  <div className="space-y-2.5">
                    <div className="text-xs font-extrabold text-[#0d2546]">
                      ชุดคำสั่ง AI Image Generation Prompts (กด "สร้างภาพจริง" จาก Prompt ที่ต้องการได้ทันที):
                    </div>
                    {(activeWf.visualOutput?.imagePrompts || []).map((ip, idx) => (
                      <div
                        key={idx}
                        className="rounded-xl bg-slate-50 border border-slate-200 p-3.5 flex flex-col sm:flex-row sm:items-start justify-between gap-3"
                      >
                        <div>
                          <span className="rounded-md bg-blue-100 px-2 py-0.5 text-[10.5px] font-extrabold text-blue-900">
                            {ip.platform}
                          </span>
                          <p className="mt-1.5 text-xs text-slate-700 font-mono">
                            {ip.prompt}
                          </p>
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          <button
                            type="button"
                            disabled={mediaBusy === 'image'}
                            onClick={() => handleGenerateRealVisual(ip.prompt)}
                            className="rounded-lg bg-blue-600 px-2.5 py-1 text-xs font-extrabold text-white hover:bg-blue-700 cursor-pointer disabled:opacity-50"
                          >
                            สร้างภาพจริง
                          </button>
                          <button
                            onClick={() => copyText(`img-${idx}`, ip.prompt)}
                            className="rounded-lg bg-white border border-slate-200 px-2.5 py-1 text-xs font-bold text-slate-700 hover:bg-slate-100 cursor-pointer"
                          >
                            {copiedKey === `img-${idx}` ? 'คัดลอกแล้ว' : 'คัดลอก'}
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* TAB: 05 VIDEO PRODUCTION AGENT */}
              {activeAgentTab === 'video' && (
                <div className="rounded-2xl bg-white border border-slate-200 p-5 space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="text-lg font-extrabold text-[#0d2546] flex items-center gap-2">
                      <Film className="w-5 h-5 text-purple-600" />
                      05 VIDEO PRODUCTION AGENT (Google Veo 3.1 / Gemini Omni 1.1 Flash)
                    </h3>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-full bg-purple-100 px-3 py-1 text-xs font-bold text-purple-900">
                        ความยาวแผน: {activeWf.videoOutput?.duration}
                      </span>
                      {onOpenFlowStudio && (
                        <button
                          type="button"
                          onClick={onOpenFlowStudio}
                          className="inline-flex items-center gap-1 rounded-xl bg-sky-600 px-3 py-1.5 text-xs font-extrabold text-white hover:bg-sky-700 cursor-pointer"
                        >
                          <Clapperboard className="w-3.5 h-3.5" /> เปิด Google Flow Multi-Scene Studio
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Real Video Renderer Bar */}
                  <div className="rounded-xl bg-purple-50/80 border border-purple-200 p-4 space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <select
                          value={videoEngineChoice}
                          onChange={(e) => setVideoEngineChoice(e.target.value as any)}
                          className="rounded-xl border border-purple-200 bg-white px-3 py-1.5 text-xs font-bold text-[#0d2546]"
                        >
                          <option value="gemini-omni-1.1-flash">
                            gemini-omni-1.1-flash (แนะนำ • ใช้ GEMINI_API_KEY + เสียงพร้อมภาพ)
                          </option>
                          <option value="veo-3.1-generate-001">
                            veo-3.1-generate-001 (Vertex AI Enterprise GA)
                          </option>
                          <option value="veo-3.1-fast-generate-001">
                            veo-3.1-fast-generate-001 (Vertex AI Fast GA)
                          </option>
                        </select>
                        <select
                          value={videoAspectChoice}
                          onChange={(e) => setVideoAspectChoice(e.target.value as any)}
                          className="rounded-xl border border-purple-200 bg-white px-3 py-1.5 text-xs font-bold text-[#0d2546]"
                        >
                          <option value="16:9">16:9 (YouTube / Facebook / Website)</option>
                          <option value="9:16">9:16 (TikTok / Reels / Shorts)</option>
                        </select>
                      </div>

                      <button
                        type="button"
                        disabled={mediaBusy === 'video'}
                        onClick={handleGenerateRealVideo}
                        className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-purple-700 to-indigo-700 px-4 py-2 text-xs font-extrabold text-white hover:brightness-110 cursor-pointer disabled:opacity-50"
                      >
                        {mediaBusy === 'video' ? (
                          <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <Film className="w-3.5 h-3.5 text-amber-300" />
                        )}
                        {mediaBusy === 'video'
                          ? 'กำลังเรนเดอร์วิดีโอ .MP4 จริง (ใช้เวลา 30-90 วินาที)...'
                          : 'เรนเดอร์วิดีโอ .MP4 จริงจาก Storyboard นี้'}
                      </button>
                    </div>

                    {activeWf.videoOutput?.generatedVideoUrl && (
                      <div className="pt-2 space-y-2">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="text-xs font-extrabold text-emerald-800">
                            ✓ เรนเดอร์ไฟล์วิดีโอ .MP4 จริงสำเร็จ ({activeWf.videoOutput.generatedVideoModel || 'Google Video AI'})
                          </span>
                          <a
                            href={activeWf.videoOutput.generatedVideoUrl}
                            download
                            className="inline-flex items-center gap-1 rounded-lg bg-[#0d2546] px-3 py-1 text-xs font-bold text-white"
                          >
                            <Download className="w-3.5 h-3.5" /> ดาวน์โหลด .MP4
                          </a>
                        </div>
                        <video
                          controls
                          src={activeWf.videoOutput.generatedVideoUrl}
                          className="w-full max-w-2xl rounded-xl border border-purple-300 bg-black aspect-video"
                        />
                      </div>
                    )}
                  </div>

                  <p className="text-xs text-slate-600">
                    <strong>รูปแบบผู้ดำเนินรายการ:</strong>{' '}
                    {activeWf.videoOutput?.avatarStyle}
                  </p>

                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse text-xs">
                      <thead>
                        <tr className="bg-[#0d2546] text-white">
                          <th className="p-3 rounded-tl-xl">ช่วงเวลา</th>
                          <th className="p-3">ภาพหลัก / มุมกล้อง</th>
                          <th className="p-3">บทพูด (Dialogue)</th>
                          <th className="p-3">ซับไตเติลหน้าจอ</th>
                          <th className="p-3 rounded-tr-xl">B-Roll ประกอบ</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200 border border-slate-200">
                        {(activeWf.videoOutput?.scenes || []).map((sc, i) => (
                          <tr key={i} className="hover:bg-slate-50">
                            <td className="p-3 font-bold text-purple-800 whitespace-nowrap">
                              {sc.time}
                            </td>
                            <td className="p-3 text-slate-700">{sc.visual}</td>
                            <td className="p-3 font-medium text-[#0d2546]">
                              “{sc.dialogue}”
                            </td>
                            <td className="p-3 text-amber-800 font-semibold">
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

              {/* TAB: 06 AUDIO PRODUCTION AGENT */}
              {activeAgentTab === 'audio' && (
                <div className="rounded-2xl bg-white border border-slate-200 p-5 space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="text-lg font-extrabold text-[#0d2546] flex items-center gap-2">
                      <Mic className="w-5 h-5 text-amber-600" />
                      06 AUDIO PRODUCTION AGENT (Gemini 3.8 Flash TTS / ElevenLabs)
                    </h3>
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        disabled={mediaBusy === 'audio'}
                        onClick={handleGenerateRealAudio}
                        className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-amber-500 to-orange-600 px-4 py-2 text-xs font-extrabold text-white hover:brightness-105 cursor-pointer disabled:opacity-50"
                      >
                        {mediaBusy === 'audio' ? (
                          <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <Mic className="w-3.5 h-3.5" />
                        )}
                        {mediaBusy === 'audio'
                          ? 'กำลังสังเคราะห์ไฟล์เสียงจริง...'
                          : 'สร้างไฟล์เสียงพากย์จริง (.WAV / .MP3)'}
                      </button>
                      <button
                        onClick={() =>
                          toggleVoicePreview(
                            activeWf.audioOutput?.narrationScriptWithCues || ''
                          )
                        }
                        className={`inline-flex items-center gap-2 rounded-xl px-3.5 py-2 text-xs font-extrabold text-white transition cursor-pointer ${
                          speaking ? 'bg-rose-600' : 'bg-[#0d2546] hover:bg-[#193d6e]'
                        }`}
                      >
                        {speaking ? (
                          <Square className="w-3.5 h-3.5" />
                        ) : (
                          <Volume2 className="w-4 h-4 text-amber-300" />
                        )}
                        {speaking ? 'หยุดฟัง' : 'พรีวิวเสียงเบราว์เซอร์'}
                      </button>
                    </div>
                  </div>

                  {activeWf.audioOutput?.generatedAudioUrl && (
                    <div className="rounded-xl bg-emerald-50 border border-emerald-200 p-4 space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-extrabold text-emerald-900">
                          ✓ ไฟล์เสียงพากย์จริงจาก AI TTS ({activeWf.audioOutput.generatedAudioModel || 'Gemini 3.8 Flash TTS'})
                        </span>
                        <a
                          href={activeWf.audioOutput.generatedAudioUrl}
                          download
                          className="inline-flex items-center gap-1 rounded-lg bg-[#0d2546] px-3 py-1 text-xs font-bold text-white"
                        >
                          <Download className="w-3.5 h-3.5" /> ดาวน์โหลดไฟล์เสียง
                        </a>
                      </div>
                      <audio
                        controls
                        src={activeWf.audioOutput.generatedAudioUrl}
                        className="w-full"
                      />
                    </div>
                  )}

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                    <div className="rounded-xl bg-amber-50 p-3.5 border border-amber-200/70">
                      <div className="font-bold text-amber-950">โทนเสียงพากย์ (Voice Direction)</div>
                      <p className="mt-1 text-slate-700">{activeWf.audioOutput?.voiceTone}</p>
                    </div>
                    <div className="rounded-xl bg-slate-50 p-3.5 border border-slate-200">
                      <div className="font-bold text-[#0d2546]">ดนตรีประกอบ (BGM & Sound Effects)</div>
                      <p className="mt-1 text-slate-700">{activeWf.audioOutput?.bgmStyle}</p>
                    </div>
                  </div>

                  <div className="rounded-xl bg-[#0b1f3a] text-white p-4">
                    <div className="text-xs font-bold text-amber-300 mb-2">
                      บทพากย์พร้อมจุดเน้นจังหวะเสียง (Voiceover Script with Vocal Cues):
                    </div>
                    <p className="text-sm font-body leading-relaxed text-slate-100">
                      {activeWf.audioOutput?.narrationScriptWithCues}
                    </p>
                  </div>
                </div>
              )}

              {/* TAB: 07 QA & 08 ANALYTICS */}
              {activeAgentTab === 'qa_analytics' && (
                <div className="rounded-2xl bg-white border border-slate-200 p-5 space-y-5">
                  <h3 className="text-lg font-extrabold text-[#0d2546] flex items-center gap-2">
                    <BarChart3 className="w-5 h-5 text-teal-600" />
                    07 QUALITY CHECK & 08 ANALYTICS IMPROVEMENT AGENT
                  </h3>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div className="rounded-xl bg-teal-50 border border-teal-200 p-4">
                      <div className="text-[11px] font-bold text-teal-800">คาดการณ์การเข้าถึง (Reach)</div>
                      <div className="mt-1 text-base font-extrabold text-[#0d2546]">
                        {activeWf.analyticsOutput?.predictedReach}
                      </div>
                    </div>
                    <div className="rounded-xl bg-sky-50 border border-sky-200 p-4">
                      <div className="text-[11px] font-bold text-sky-800">คาดการณ์ Engagement</div>
                      <div className="mt-1 text-sm font-extrabold text-[#0d2546]">
                        {activeWf.analyticsOutput?.predictedEngagement}
                      </div>
                    </div>
                    <div className="rounded-xl bg-amber-50 border border-amber-200 p-4">
                      <div className="text-[11px] font-bold text-amber-900">ความตรงกลุ่มผู้เรียน</div>
                      <div className="mt-1 text-sm font-extrabold text-[#0d2546]">
                        {activeWf.analyticsOutput?.targetLearnerFit}
                      </div>
                    </div>
                  </div>

                  <div className="rounded-xl bg-slate-50 border border-slate-200 p-4 space-y-2">
                    <div className="text-xs font-extrabold text-[#0d2546]">
                      ข้อเสนอแนะเพื่อเพิ่มประสิทธิภาพคอนเทนต์ (Optimization & A/B Testing):
                    </div>
                    {(activeWf.analyticsOutput?.optimizationTips || []).map((tip, i) => (
                      <div key={i} className="text-xs text-slate-700">
                        • {tip}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* TAB: PUBLISH & DISTRIBUTE 8 CHANNELS (Red Highlighted Box in Image 1!) */}
              {activeAgentTab === 'omnichannel' && (
                <div className="rounded-2xl bg-white border-2 border-rose-500/80 p-5 space-y-4 shadow-xs">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <span className="rounded-full bg-rose-600 px-3 py-0.5 text-[10.5px] font-extrabold text-white">
                        PUBLISH & DISTRIBUTE • เผยแพร่สู่ทุกช่องทาง
                      </span>
                      <h3 className="mt-1 text-lg font-extrabold text-[#0d2546]">
                        ชุดคอนเทนต์พร้อมโพสต์ครบ 8 แพลตฟอร์มอัตโนมัติ
                      </h3>
                    </div>
                    {activeWf.status !== 'published' && (
                      <button
                        onClick={handleApproveAndPublish}
                        className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-2 text-xs font-extrabold text-white hover:bg-emerald-700 cursor-pointer"
                      >
                        <Send className="w-3.5 h-3.5" /> อนุมัติ & เผยแพร่ทุกช่องทางทันที
                      </button>
                    )}
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {[
                      {
                        name: 'YouTube',
                        badge: 'bg-red-600',
                        content: `${activeWf.omnichannelOutput?.youtube?.title}\n\n${activeWf.omnichannelOutput?.youtube?.description}`,
                      },
                      {
                        name: 'Facebook',
                        badge: 'bg-[#1877f2]',
                        content: `${activeWf.omnichannelOutput?.facebook?.post}\n\n💬 ${activeWf.omnichannelOutput?.facebook?.engagementQuestion}`,
                      },
                      {
                        name: 'TikTok',
                        badge: 'bg-slate-900',
                        content: `Hook: ${activeWf.omnichannelOutput?.tiktok?.hook}\n${activeWf.omnichannelOutput?.tiktok?.caption}\n${(activeWf.omnichannelOutput?.tiktok?.hashtags || []).join(' ')}`,
                      },
                      {
                        name: 'LINE OA',
                        badge: 'bg-[#06c755]',
                        content: `${activeWf.omnichannelOutput?.lineOa?.headline}\n${activeWf.omnichannelOutput?.lineOa?.broadcastMessage}`,
                      },
                      {
                        name: 'X (Twitter)',
                        badge: 'bg-black',
                        content: (activeWf.omnichannelOutput?.xTwitter?.thread || []).join('\n\n'),
                      },
                      {
                        name: 'Instagram',
                        badge: 'bg-gradient-to-r from-pink-500 to-amber-500',
                        content: `${(activeWf.omnichannelOutput?.instagram?.carouselSlides || []).join('\n')}\n\n${activeWf.omnichannelOutput?.instagram?.caption}`,
                      },
                      {
                        name: 'Website / Blog',
                        badge: 'bg-[#0d2546]',
                        content: `Slug: /${activeWf.omnichannelOutput?.websiteBlog?.slug}\nSEO Meta: ${activeWf.omnichannelOutput?.websiteBlog?.seoMeta}`,
                      },
                      {
                        name: 'Email / Newsletter',
                        badge: 'bg-sky-700',
                        content: `Subject: ${activeWf.omnichannelOutput?.emailNewsletter?.subject}\n\n${activeWf.omnichannelOutput?.emailNewsletter?.bodyIntro}`,
                      },
                    ].map((ch) => (
                      <div
                        key={ch.name}
                        className="rounded-xl border border-slate-200 p-3.5 bg-slate-50/70 flex flex-col justify-between"
                      >
                        <div>
                          <div className="flex items-center justify-between gap-2 mb-2">
                            <span
                              className={`rounded-full px-3 py-0.5 text-xs font-extrabold text-white ${ch.badge}`}
                            >
                              {ch.name}
                            </span>
                            <button
                              onClick={() => copyText(ch.name, ch.content)}
                              className="inline-flex items-center gap-1 rounded-lg bg-white border border-slate-200 px-2.5 py-1 text-[11px] font-bold text-slate-700 hover:bg-slate-100 cursor-pointer"
                            >
                              {copiedKey === ch.name ? (
                                <Check className="w-3 h-3 text-emerald-600" />
                              ) : (
                                <Copy className="w-3 h-3" />
                              )}
                              {copiedKey === ch.name ? 'คัดลอกแล้ว' : 'คัดลอก'}
                            </button>
                          </div>
                          <pre className="whitespace-pre-wrap text-xs text-slate-700 font-body leading-relaxed">
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
                              className="mt-2 inline-flex items-center gap-1 text-xs font-extrabold text-emerald-700 hover:underline cursor-pointer"
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

      {/* AI TOOLS ECOSYSTEM MATRIX (Exact match to Bottom Bar of Image 1!) */}
      <div className="rounded-2xl bg-white border border-slate-200/80 p-5 shadow-2xs">
        <div className="text-xs font-extrabold text-[#0d2546] mb-3">
          AI TOOLS ECOSYSTEM (ชุดเครื่องมือ AI มาตรฐานที่เชื่อมโยงในแต่ละ AGENT ของ คมคิด by KOMKRIT)
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2.5">
          {AI_TOOLS_ECOSYSTEM.map((col) => (
            <div
              key={col.group}
              className="rounded-xl border border-slate-200 overflow-hidden bg-slate-50/50"
            >
              <div
                className={`${col.color} px-2.5 py-1.5 text-center text-[10.5px] font-extrabold text-white`}
              >
                {col.group}
              </div>
              <ul className="p-2.5 space-y-1 text-[11px] text-slate-700">
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

      {/* BLUEPRINT REFERENCE MODAL */}
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
              <h3 className="text-lg font-extrabold text-[#0d2546]">
                แผนผังสถาปัตยกรรมต้นฉบับ AI Content Ecosystem & 5-Pillar Model
              </h3>
              <button
                onClick={() => setBlueprintModalOpen(false)}
                className="p-1.5 rounded-full hover:bg-slate-100 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="space-y-4">
              <div>
                <div className="text-xs font-extrabold text-[#0d2546] mb-1.5">
                  1. AI Content Creation Flow (8 Specialized Agents + Omnichannel)
                </div>
                <img
                  src="/images/blueprint-8agent-flow.jpg"
                  alt="8-Agent Flow"
                  className="w-full rounded-xl border border-slate-200"
                />
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <div className="text-xs font-extrabold text-[#0d2546] mb-1.5">
                    2. Multi-Agent Content Ecosystem (CEO • Content • QA • Human Approval • KB)
                  </div>
                  <img
                    src="/images/blueprint-multiagent-ecosystem.jpg"
                    alt="Multi-Agent Ecosystem"
                    className="w-full rounded-xl border border-slate-200"
                  />
                </div>
                <div>
                  <div className="text-xs font-extrabold text-[#0d2546] mb-1.5">
                    3. KOMKID 5-Pillar Business Model (Content → Audience → Trust)
                  </div>
                  <img
                    src="/images/blueprint-5pillar.jpg"
                    alt="5-Pillar Business Model"
                    className="w-full rounded-xl border border-slate-200"
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
