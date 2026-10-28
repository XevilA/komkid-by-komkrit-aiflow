import React, { useEffect, useState } from 'react';
import {
  Bot,
  Film,
  Image as ImageIcon,
  Mic,
  Send,
  Sparkles,
  Trash2,
  RefreshCw,
  Download,
  FilePlus2,
  Clapperboard,
  KeyRound,
  Layers,
  CheckCircle2,
  Upload,
  Wand2,
  BrainCircuit,
} from 'lucide-react';
import {
  AiChatMessage,
  AiEngineSettings,
  AiMediaAsset,
  FlowProject,
  LlmProviderId,
} from '../types';
import { api } from '../api';
import { renderRichMarkdown } from './ArticleReaderModal';

interface Props {
  onRefreshAll: () => Promise<void>;
  onOpenSettings: () => void;
  onOpenPost: (postId: number) => void;
}

const CHAT_PROVIDERS: {
  id: Exclude<LlmProviderId, 'auto'>;
  name: string;
  badgeColor: string;
  models: string[];
}[] = [
  {
    id: 'gemini',
    name: 'Google Gemini',
    badgeColor: 'bg-sky-600',
    models: ['gemini-3.8-flash', 'gemini-4-argon', 'gemini-3.5-flash-lite'],
  },
  {
    id: 'claude',
    name: 'Anthropic Claude',
    badgeColor: 'bg-amber-700',
    models: [
      'claude-sonnet-4-20250514',
      'claude-opus-4-20250514',
      'claude-3-7-sonnet-latest',
      'claude-3-5-haiku-latest',
    ],
  },
  {
    id: 'deepseek',
    name: 'DeepSeek (V3 & R1)',
    badgeColor: 'bg-indigo-600',
    models: ['deepseek-chat', 'deepseek-reasoner'],
  },
  {
    id: 'openai',
    name: 'OpenAI ChatGPT',
    badgeColor: 'bg-emerald-600',
    models: ['gpt-4.1', 'gpt-4o', 'gpt-4o-mini', 'o3-mini'],
  },
];

export const FlowAndChatStudio: React.FC<Props> = ({
  onRefreshAll,
  onOpenSettings,
  onOpenPost,
}) => {
  const [subTab, setSubTab] = useState<'flow' | 'direct_media' | 'chat'>('flow');
  const [settings, setSettings] = useState<AiEngineSettings | null>(null);
  const [errorBanner, setErrorBanner] = useState<string | null>(null);
  const [successBanner, setSuccessBanner] = useState<string | null>(null);

  // ---------------- MULTI-LLM CHAT STATE ----------------
  const [chatProvider, setChatProvider] =
    useState<Exclude<LlmProviderId, 'auto'>>('gemini');
  const [chatModel, setChatModel] = useState('gemini-3.8-flash');
  const [useKb, setUseKb] = useState(true);
  const [chatMessages, setChatMessages] = useState<AiChatMessage[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [chatSending, setChatSending] = useState(false);
  const [arenaRunning, setArenaRunning] = useState(false);
  const [arenaResults, setArenaResults] = useState<
    { provider: string; engineLabel: string; reply: string; latencyMs?: number; error?: string }[]
  >([]);

  // ---------------- GOOGLE FLOW STUDIO STATE ----------------
  const [flowProjects, setFlowProjects] = useState<FlowProject[]>([]);
  const [selectedFlowId, setSelectedFlowId] = useState<number | null>(null);
  const [flowTitle, setFlowTitle] = useState('');
  const [flowConcept, setFlowConcept] = useState('');
  const [flowScenesCount, setFlowScenesCount] = useState(3);
  const [flowAspect, setFlowAspect] = useState<'16:9' | '9:16'>('16:9');
  const [flowRes, setFlowRes] = useState<'720p' | '1080p' | '4k'>('720p');
  const [flowEngine, setFlowEngine] = useState<
    | 'gemini-omni-1.1-flash'
    | 'veo-3.1-generate-001'
    | 'veo-3.1-fast-generate-001'
    | 'veo-3.0-generate-001'
  >('gemini-omni-1.1-flash');
  const [creatingFlow, setCreatingFlow] = useState(false);
  const [busySceneKey, setBusySceneKey] = useState<string | null>(null);
  const [assemblingFlow, setAssemblingFlow] = useState(false);
  const [generatingFlowVo, setGeneratingFlowVo] = useState(false);

  // ---------------- DIRECT VEO / IMAGE / TTS MEDIA LAB STATE ----------------
  const [mediaAssets, setMediaAssets] = useState<AiMediaAsset[]>([]);
  const [directVidPrompt, setDirectVidPrompt] = useState('');
  const [directVidEngine, setDirectVidEngine] = useState<
    | 'gemini-omni-1.1-flash'
    | 'veo-3.1-generate-001'
    | 'veo-3.1-fast-generate-001'
    | 'veo-3.0-generate-001'
  >('gemini-omni-1.1-flash');
  const [directVidAspect, setDirectVidAspect] = useState<'16:9' | '9:16'>('16:9');
  const [directVidDuration, setDirectVidDuration] = useState(6);
  const [directVidRes, setDirectVidRes] = useState<'720p' | '1080p' | '4k'>('720p');
  const [directFirstFrame, setDirectFirstFrame] = useState('');
  const [directLastFrame, setDirectLastFrame] = useState('');
  const [directVidLoading, setDirectVidLoading] = useState(false);

  const [directImgPrompt, setDirectImgPrompt] = useState('');
  const [directImgProvider, setDirectImgProvider] = useState<'gemini' | 'openai'>('gemini');
  const [directImgModel, setDirectImgModel] = useState('gemini-nano-banana-2.1');
  const [directImgAspect, setDirectImgAspect] = useState<'16:9' | '9:16' | '1:1'>('16:9');
  const [directImgLoading, setDirectImgLoading] = useState(false);

  const [directTtsText, setDirectTtsText] = useState('');
  const [directTtsProvider, setDirectTtsProvider] = useState<
    'gemini' | 'elevenlabs' | 'openai'
  >('gemini');
  const [directTtsVoice, setDirectTtsVoice] = useState('Kore');
  const [directTtsLoading, setDirectTtsLoading] = useState(false);

  const sessionId = `komkrit-${chatProvider}`;

  const loadStudioData = async () => {
    const [st, fp, ma] = await Promise.all([
      api.getAiSettings(),
      api.getFlowProjects(),
      api.getMediaAssets(),
    ]);
    setSettings(st);
    setFlowProjects(fp);
    if (fp.length > 0 && !selectedFlowId) {
      setSelectedFlowId(fp[0].id);
    }
    setMediaAssets(ma);
  };

  useEffect(() => {
    loadStudioData();
  }, []);

  useEffect(() => {
    api.getChatHistory(sessionId).then(setChatMessages).catch(() => {});
    const meta = CHAT_PROVIDERS.find((p) => p.id === chatProvider);
    if (meta) {
      setChatModel(meta.models[0]);
    }
  }, [chatProvider]);

  const activeFlow =
    flowProjects.find((p) => p.id === selectedFlowId) || flowProjects[0] || null;

  // ---------------- HANDLERS: MULTI-LLM CHAT ----------------
  const handleSendChat = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatInput.trim()) return;
    setErrorBanner(null);
    setChatSending(true);
    try {
      await api.sendChatMessage({
        sessionId,
        provider: chatProvider,
        model: chatModel,
        message: chatInput.trim(),
        useKnowledgeBase: useKb,
      });
      setChatInput('');
      const updated = await api.getChatHistory(sessionId);
      setChatMessages(updated);
    } catch (err) {
      setErrorBanner((err as Error).message);
    } finally {
      setChatSending(false);
    }
  };

  const handleRun4ModelArena = async () => {
    if (!chatInput.trim()) {
      setErrorBanner('กรุณาพิมพ์คำถามในช่องแชทก่อนกดเปรียบเทียบ 4 โมเดลพร้อมกัน');
      return;
    }
    setErrorBanner(null);
    setArenaRunning(true);
    setArenaResults([]);
    const promptToTest = chatInput.trim();

    const tasks = CHAT_PROVIDERS.map(async (prov) => {
      try {
        const res = await api.sendChatMessage({
          sessionId: `arena-${prov.id}-${Date.now()}`,
          provider: prov.id,
          model: prov.models[0],
          message: promptToTest,
          useKnowledgeBase: useKb,
        });
        return {
          provider: prov.name,
          engineLabel: res.engineLabel,
          reply: res.reply,
          latencyMs: res.latencyMs,
        };
      } catch (e) {
        return {
          provider: prov.name,
          engineLabel: `${prov.name} (${prov.models[0]})`,
          reply: '',
          error: (e as Error).message,
        };
      }
    });

    const settled = await Promise.all(tasks);
    setArenaResults(settled);
    setArenaRunning(false);
  };

  const handlePublishTextToCrud = async (contentMarkdown: string, sourceLabel: string) => {
    const firstLine =
      contentMarkdown
        .split('\n')
        .map((l) => l.replace(/^#+\s*/, '').trim())
        .find((l) => l.length > 5) || 'บทความจาก AI Chat Studio';
    const created = await api.createPost({
      title: firstLine.slice(0, 110),
      subtitle: `สังเคราะห์ร่วมกับ ${sourceLabel}`,
      excerpt: contentMarkdown.replace(/[#>*_`]/g, '').slice(0, 180),
      content: contentMarkdown,
      category: 'ai-tech',
      contentType: 'article',
      status: 'published',
      tags: ['AI Chat Studio', sourceLabel, 'คมคิด by KOMKRIT'],
    });
    await onRefreshAll();
    setSuccessBanner(`สร้างโพสต์ใหม่ขึ้นหน้าเว็บไซต์สำเร็จ! (Post #${created.id})`);
    onOpenPost(created.id);
  };

  // ---------------- HANDLERS: GOOGLE FLOW FILMMAKING ----------------
  const handleCreateFlowProject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!flowTitle.trim() || !flowConcept.trim()) return;
    setErrorBanner(null);
    setCreatingFlow(true);
    try {
      const created = await api.createFlowProject({
        title: flowTitle.trim(),
        concept: flowConcept.trim(),
        sceneCount: flowScenesCount,
        aspectRatio: flowAspect,
        resolution: flowRes,
        videoEngine: flowEngine,
      });
      const fp = await api.getFlowProjects();
      setFlowProjects(fp);
      setSelectedFlowId(created.id);
      setFlowTitle('');
      setFlowConcept('');
      setSuccessBanner(
        `AI Director ออกแบบ Storyboard ${created.scenes.length} ฉากสำเร็จ! พร้อมสร้างภาพ Keyframe และเรนเดอร์วิดีโอ Veo / Omni จริง`
      );
    } catch (err) {
      setErrorBanner((err as Error).message);
    } finally {
      setCreatingFlow(false);
    }
  };

  const handleGenerateSceneFrame = async (
    projectId: number,
    sceneIdx: number,
    which: 'first' | 'last',
    prompt: string
  ) => {
    setErrorBanner(null);
    setBusySceneKey(`frame-${sceneIdx}-${which}`);
    try {
      const updated = await api.generateFlowSceneFrame(projectId, sceneIdx, {
        which,
        customPrompt: prompt,
      });
      setFlowProjects((prev) =>
        prev.map((p) => (p.id === updated.id ? updated : p))
      );
      await loadStudioData();
    } catch (err) {
      setErrorBanner((err as Error).message);
    } finally {
      setBusySceneKey(null);
    }
  };

  const handleRenderSceneVideo = async (
    projectId: number,
    sceneIdx: number,
    mode: 'keyframes' | 'text_only' | 'extend_prev',
    motionPrompt: string
  ) => {
    setErrorBanner(null);
    setBusySceneKey(`video-${sceneIdx}-${mode}`);
    try {
      const updated = await api.generateFlowSceneVideo(projectId, sceneIdx, {
        mode,
        customMotionPrompt: motionPrompt,
      });
      setFlowProjects((prev) =>
        prev.map((p) => (p.id === updated.id ? updated : p))
      );
      await loadStudioData();
      setSuccessBanner(`เรนเดอร์คลิปวิดีโอ .mp4 ฉากที่ ${sceneIdx + 1} สำเร็จ!`);
    } catch (err) {
      setErrorBanner((err as Error).message);
    } finally {
      setBusySceneKey(null);
    }
  };

  const handleGenerateFlowVoiceover = async (projectId: number) => {
    setErrorBanner(null);
    setGeneratingFlowVo(true);
    try {
      const updated = await api.generateFlowVoiceover(projectId, {
        provider: 'gemini',
        voice: 'Kore',
      });
      setFlowProjects((prev) =>
        prev.map((p) => (p.id === updated.id ? updated : p))
      );
      await loadStudioData();
      setSuccessBanner('สร้างเสียงพากย์ภาษาไทยรวมทุกฉากด้วย Gemini 3.8 Flash TTS สำเร็จ!');
    } catch (err) {
      setErrorBanner((err as Error).message);
    } finally {
      setGeneratingFlowVo(false);
    }
  };

  const handleAssembleMasterFilm = async (projectId: number) => {
    setErrorBanner(null);
    setAssemblingFlow(true);
    try {
      const updated = await api.assembleFlowMasterFilm(projectId, true);
      setFlowProjects((prev) =>
        prev.map((p) => (p.id === updated.id ? updated : p))
      );
      await loadStudioData();
      setSuccessBanner(
        'ตัดต่อรวมภาพยนตร์ Master .MP4 ด้วย FFmpeg พร้อมผสมเสียงพากย์สำเร็จ!'
      );
    } catch (err) {
      setErrorBanner((err as Error).message);
    } finally {
      setAssemblingFlow(false);
    }
  };

  const handlePublishFlowVideoToWebsite = async (proj: FlowProject) => {
    const videoUrl =
      proj.masterVideoUrl ||
      proj.scenes.find((s) => s.videoClipUrl)?.videoClipUrl ||
      '';
    if (!videoUrl) {
      setErrorBanner('กรุณาเรนเดอร์คลิปวิดีโออย่างน้อย 1 ฉากก่อนเผยแพร่ขึ้นหน้าเว็บ');
      return;
    }
    const cover =
      proj.scenes.find((s) => s.firstFrameUrl)?.firstFrameUrl ||
      '/images/featured-speaker.jpg';
    const fullNarration = proj.scenes
      .map((s) => `### ฉากที่ ${s.sceneNumber}: ${s.title}\n${s.narrationThai}`)
      .join('\n\n');

    const created = await api.createPost({
      title: proj.title,
      subtitle: `ผลิตด้วย Google Flow & ${proj.videoEngine}`,
      excerpt: proj.concept.slice(0, 180),
      content: `## ${proj.title}\n\n${proj.concept}\n\n${fullNarration}`,
      category: 'ai-tech',
      contentType: 'video',
      coverImage: cover,
      videoUrl,
      audioUrl: proj.voiceoverAudioUrl || '',
      status: 'published',
      tags: ['Google Flow', 'Google Veo', 'คมคิด by KOMKRIT'],
    });
    await onRefreshAll();
    onOpenPost(created.id);
  };

  // ---------------- HANDLERS: DIRECT VEO / IMAGE / TTS ----------------
  const handleDirectVideoGen = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!directVidPrompt.trim()) return;
    setErrorBanner(null);
    setDirectVidLoading(true);
    try {
      const asset = await api.generateRealVideo({
        prompt: directVidPrompt.trim(),
        engine: directVidEngine,
        aspectRatio: directVidAspect,
        durationSec: directVidDuration,
        resolution: directVidRes,
        firstFrameUrl: directFirstFrame || undefined,
        lastFrameUrl:
          directFirstFrame && directLastFrame ? directLastFrame : undefined,
      });
      await loadStudioData();
      setSuccessBanner(`สร้างไฟล์วิดีโอจริง ${asset.fileUrl} สำเร็จ!`);
    } catch (err) {
      setErrorBanner((err as Error).message);
    } finally {
      setDirectVidLoading(false);
    }
  };

  const handleDirectImageGen = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!directImgPrompt.trim()) return;
    setErrorBanner(null);
    setDirectImgLoading(true);
    try {
      const asset = await api.generateRealImage({
        prompt: directImgPrompt.trim(),
        provider: directImgProvider,
        model: directImgModel,
        aspectRatio: directImgAspect,
      });
      await loadStudioData();
      setSuccessBanner(`สร้างรูปภาพ AI จริง ${asset.fileUrl} สำเร็จ!`);
    } catch (err) {
      setErrorBanner((err as Error).message);
    } finally {
      setDirectImgLoading(false);
    }
  };

  const handleDirectTtsGen = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!directTtsText.trim()) return;
    setErrorBanner(null);
    setDirectTtsLoading(true);
    try {
      const asset = await api.generateRealAudio({
        text: directTtsText.trim(),
        provider: directTtsProvider,
        voice: directTtsVoice,
      });
      await loadStudioData();
      setSuccessBanner(`สร้างไฟล์เสียงพากย์จริง ${asset.fileUrl} สำเร็จ!`);
    } catch (err) {
      setErrorBanner((err as Error).message);
    } finally {
      setDirectTtsLoading(false);
    }
  };

  const activeKeyCount = [
    settings?.hasGeminiKey,
    settings?.hasClaudeKey,
    settings?.hasDeepseekKey,
    settings?.hasOpenaiKey,
  ].filter(Boolean).length;

  return (
    <div className="space-y-5">
      {/* STUDIO HEADER */}
      <div className="rounded-2xl bg-gradient-to-r from-[#091a32] via-[#13325c] to-[#0d2546] p-5 sm:p-6 text-white shadow-md border border-[#244e86]">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full bg-emerald-400 px-3 py-0.5 text-[11px] font-extrabold text-[#081b33]">
              100% REAL LIVE API • ZERO MOCKUP • GOOGLE FLOW & VEO + 4 CHAT LLMs
            </div>
            <h2 className="mt-2 text-xl sm:text-2xl font-extrabold">
              Google Flow & Veo Filmmaking Studio + Multi-LLM Chat Hub
            </h2>
            <p className="text-xs sm:text-sm text-slate-300 mt-0.5">
              เชื่อมต่อ API จริงโดยตรง: <strong>Google Veo 3.1 / Gemini Omni 1.1 Flash Video</strong>,{' '}
              <strong>Google Flow Multi-Scene + FFmpeg</strong>, <strong>Claude</strong>,{' '}
              <strong>DeepSeek (V3/R1)</strong>, <strong>ChatGPT</strong> และ <strong>Gemini</strong>
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={onOpenSettings}
              className="inline-flex items-center gap-1.5 rounded-xl bg-[#f59e0b] px-4 py-2.5 text-xs font-extrabold text-[#0b1e38] hover:brightness-105 transition cursor-pointer"
            >
              <KeyRound className="w-4 h-4" />
              ตั้งค่า API Keys ({activeKeyCount}/4 Chat Providers พร้อมใช้)
            </button>
          </div>
        </div>

        {/* SUB-NAVIGATION TABS */}
        <div className="mt-4 flex flex-wrap gap-2">
          <button
            onClick={() => setSubTab('flow')}
            className={`inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-xs font-extrabold transition cursor-pointer ${
              subTab === 'flow'
                ? 'bg-white text-[#0d2546] shadow-sm'
                : 'bg-white/10 text-slate-200 hover:bg-white/20'
            }`}
          >
            <Clapperboard className="w-4 h-4 text-amber-500" />
            1. Google Flow Filmmaking Studio (Multi-Scene + Veo)
          </button>
          <button
            onClick={() => setSubTab('direct_media')}
            className={`inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-xs font-extrabold transition cursor-pointer ${
              subTab === 'direct_media'
                ? 'bg-white text-[#0d2546] shadow-sm'
                : 'bg-white/10 text-slate-200 hover:bg-white/20'
            }`}
          >
            <Film className="w-4 h-4 text-rose-500" />
            2. Google Veo Video • Nano Banana Image • TTS Audio Lab
          </button>
          <button
            onClick={() => setSubTab('chat')}
            className={`inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-xs font-extrabold transition cursor-pointer ${
              subTab === 'chat'
                ? 'bg-white text-[#0d2546] shadow-sm'
                : 'bg-white/10 text-slate-200 hover:bg-white/20'
            }`}
          >
            <Bot className="w-4 h-4 text-emerald-500" />
            3. Real Multi-LLM Chat (Claude • DeepSeek • ChatGPT • Gemini)
          </button>
        </div>
      </div>

      {/* BANNERS */}
      {errorBanner && (
        <div className="rounded-2xl bg-rose-50 border-2 border-rose-300 p-4 text-xs font-bold text-rose-900 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>⚠️ ข้อผิดพลาดจาก API จริง: {errorBanner}</div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={onOpenSettings}
              className="rounded-lg bg-rose-700 px-3 py-1.5 text-white hover:bg-rose-800 cursor-pointer"
            >
              ไปหน้าตั้งค่า API Keys
            </button>
            <button
              onClick={() => setErrorBanner(null)}
              className="rounded-lg border border-rose-300 px-2.5 py-1.5 text-rose-700 cursor-pointer"
            >
              ปิด
            </button>
          </div>
        </div>
      )}

      {successBanner && (
        <div className="rounded-2xl bg-emerald-50 border border-emerald-300 p-3.5 text-xs font-bold text-emerald-900 flex items-center justify-between">
          <span className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            {successBanner}
          </span>
          <button
            onClick={() => setSuccessBanner(null)}
            className="text-emerald-700 hover:underline cursor-pointer"
          >
            ปิด
          </button>
        </div>
      )}

      {/* ==================================================================== */}
      {/* TAB 1: GOOGLE FLOW MULTI-SCENE FILMMAKING STUDIO                     */}
      {/* ==================================================================== */}
      {subTab === 'flow' && (
        <div className="space-y-5">
          {/* Create New Google Flow Project Form */}
          <form
            onSubmit={handleCreateFlowProject}
            className="rounded-2xl bg-white border border-slate-200 p-5 shadow-2xs space-y-4"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-base font-extrabold text-[#0d2546] flex items-center gap-2">
                <Clapperboard className="w-5 h-5 text-[#e88d14]" />
                สร้างโปรเจกต์ภาพยนตร์ใหม่ด้วย Google Flow Workflow (AI Storyboard → Keyframe Ingredients → Veo/Omni Video → FFmpeg Master)
              </h3>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
              <div className="md:col-span-5">
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  ชื่อโปรเจกต์วิดีโอ *
                </label>
                <input
                  type="text"
                  required
                  value={flowTitle}
                  onChange={(e) => setFlowTitle(e.target.value)}
                  placeholder="เช่น ห้องเรียนไทยยุค AI: เมื่อครูมีเวลาดูแลหัวใจเด็กมากขึ้น"
                  className="w-full rounded-xl border border-slate-200 px-3.5 py-2 text-sm font-semibold focus:border-[#f59e0b] focus:outline-none"
                />
              </div>
              <div className="md:col-span-7">
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  แนวคิดเรื่องราว / บทสรุปที่ต้องการสื่อสาร *
                </label>
                <input
                  type="text"
                  required
                  value={flowConcept}
                  onChange={(e) => setFlowConcept(e.target.value)}
                  placeholder="เช่น เปรียบเทียบห้องเรียนแบบเดิมกับห้องเรียน Active Learning ที่มี AI ช่วยครูออกแบบสื่อ..."
                  className="w-full rounded-xl border border-slate-200 px-3.5 py-2 text-sm focus:border-[#f59e0b] focus:outline-none"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 items-end">
              <div>
                <label className="block text-[11px] font-bold text-slate-600 mb-1">
                  Video Generation Engine
                </label>
                <select
                  value={flowEngine}
                  onChange={(e) => setFlowEngine(e.target.value as any)}
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-bold"
                >
                  <option value="gemini-omni-1.1-flash">
                    Gemini Omni 1.1 Flash (Google AI Studio API Key)
                  </option>
                  <option value="veo-3.1-generate-001">
                    Google Veo 3.1 GA (Vertex AI: veo-3.1-generate-001)
                  </option>
                  <option value="veo-3.1-fast-generate-001">
                    Google Veo 3.1 Fast (Vertex AI: veo-3.1-fast-generate-001)
                  </option>
                  <option value="veo-3.0-generate-001">
                    Google Veo 3.0 GA (Vertex AI: veo-3.0-generate-001)
                  </option>
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-bold text-slate-600 mb-1">
                  จำนวนฉาก (Scenes)
                </label>
                <select
                  value={flowScenesCount}
                  onChange={(e) => setFlowScenesCount(Number(e.target.value))}
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-bold"
                >
                  <option value={2}>2 ฉาก (~12 วินาที)</option>
                  <option value={3}>3 ฉาก (~18 วินาที)</option>
                  <option value={4}>4 ฉาก (~24 วินาที)</option>
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-bold text-slate-600 mb-1">
                  สัดส่วนวิดีโอ (Aspect Ratio)
                </label>
                <select
                  value={flowAspect}
                  onChange={(e) => setFlowAspect(e.target.value as any)}
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-bold"
                >
                  <option value="16:9">16:9 แนวนอน (YouTube / Web)</option>
                  <option value="9:16">9:16 แนวตั้ง (TikTok / Reels / Shorts)</option>
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-bold text-slate-600 mb-1">
                  ความละเอียด (Resolution)
                </label>
                <select
                  value={flowRes}
                  onChange={(e) => setFlowRes(e.target.value as any)}
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-bold"
                >
                  <option value="720p">720p HD (รวดเร็ว)</option>
                  <option value="1080p">1080p Full HD</option>
                  <option value="4k">4K Ultra HD</option>
                </select>
              </div>

              <button
                type="submit"
                disabled={creatingFlow}
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#0d2546] py-2.5 px-4 text-xs font-extrabold text-amber-300 hover:bg-[#163b6d] transition cursor-pointer disabled:opacity-60"
              >
                {creatingFlow ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    AI กำลังวางฉาก...
                  </>
                ) : (
                  <>
                    <Sparkles className="w-4 h-4" />
                    สร้าง Storyboard จริง
                  </>
                )}
              </button>
            </div>
          </form>

          {/* Active Flow Project Timeline Canvas */}
          {flowProjects.length > 0 && (
            <div className="grid grid-cols-1 xl:grid-cols-12 gap-5 items-start">
              {/* Left Project List */}
              <div className="xl:col-span-3 rounded-2xl bg-white border border-slate-200 p-4 space-y-2.5">
                <h4 className="text-xs font-extrabold text-[#0d2546]">
                  โปรเจกต์ Google Flow ({flowProjects.length})
                </h4>
                {flowProjects.map((fp) => (
                  <div
                    key={fp.id}
                    onClick={() => setSelectedFlowId(fp.id)}
                    className={`rounded-xl border p-3 cursor-pointer transition ${
                      activeFlow?.id === fp.id
                        ? 'border-[#f59e0b] bg-amber-50/60'
                        : 'border-slate-200 hover:bg-slate-50'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[10px] font-extrabold text-sky-800 bg-sky-100 rounded-full px-2 py-0.5">
                        {fp.aspectRatio} • {fp.resolution}
                      </span>
                      <button
                        onClick={async (e) => {
                          e.stopPropagation();
                          await api.deleteFlowProject(fp.id);
                          await loadStudioData();
                        }}
                        className="text-slate-400 hover:text-rose-600 cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                    <div className="mt-1 text-xs font-bold text-[#0d2546] line-clamp-2">
                      {fp.title}
                    </div>
                    <div className="mt-1 text-[10.5px] text-slate-500">
                      Engine: {fp.videoEngine}
                    </div>
                  </div>
                ))}
              </div>

              {/* Right Scene-by-Scene Canvas & Master Film Output */}
              {activeFlow && (
                <div className="xl:col-span-9 space-y-4">
                  {/* Master Film Control Bar */}
                  <div className="rounded-2xl bg-white border border-slate-200 p-5 shadow-2xs space-y-4">
                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
                      <div>
                        <span className="text-[11px] font-extrabold text-amber-700">
                          GOOGLE FLOW PROJECT #{activeFlow.id} • ENGINE: {activeFlow.videoEngine}
                        </span>
                        <h3 className="text-lg font-extrabold text-[#0d2546]">
                          {activeFlow.title}
                        </h3>
                        <p className="text-xs text-slate-600">{activeFlow.concept}</p>
                      </div>

                      <div className="flex flex-wrap gap-2">
                        <button
                          onClick={() => handleGenerateFlowVoiceover(activeFlow.id)}
                          disabled={generatingFlowVo}
                          className="inline-flex items-center gap-1.5 rounded-xl bg-amber-100 px-3.5 py-2 text-xs font-extrabold text-amber-950 hover:bg-amber-200 cursor-pointer disabled:opacity-50"
                        >
                          <Mic className="w-3.5 h-3.5" />
                          {generatingFlowVo
                            ? 'กำลังพากย์เสียง TTS...'
                            : '1. สร้างเสียงพากย์ไทยรวม (Gemini 3.8 TTS)'}
                        </button>
                        <button
                          onClick={() => handleAssembleMasterFilm(activeFlow.id)}
                          disabled={assemblingFlow}
                          className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-3.5 py-2 text-xs font-extrabold text-white hover:bg-emerald-700 cursor-pointer disabled:opacity-50"
                        >
                          <Layers className="w-3.5 h-3.5" />
                          {assemblingFlow
                            ? 'กำลังตัดต่อด้วย FFmpeg...'
                            : '2. ตัดต่อรวมทุกฉากเป็น Master .MP4 (FFmpeg)'}
                        </button>
                        <button
                          onClick={() => handlePublishFlowVideoToWebsite(activeFlow)}
                          className="inline-flex items-center gap-1.5 rounded-xl bg-[#0d2546] px-3.5 py-2 text-xs font-extrabold text-amber-300 hover:bg-[#173c6e] cursor-pointer"
                        >
                          <FilePlus2 className="w-3.5 h-3.5" />
                          เผยแพร่ขึ้นหน้าเว็บหลัก
                        </button>
                      </div>
                    </div>

                    {/* Master Voiceover & Master Stitched MP4 Preview */}
                    {(activeFlow.voiceoverAudioUrl || activeFlow.masterVideoUrl) && (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2 border-t border-slate-100">
                        {activeFlow.voiceoverAudioUrl && (
                          <div className="rounded-xl bg-amber-50/70 border border-amber-200 p-3">
                            <div className="text-xs font-extrabold text-amber-950 mb-1.5">
                              🎙️ เสียงพากย์หลักรวมทุกฉาก (Real TTS Audio)
                            </div>
                            <audio
                              controls
                              src={activeFlow.voiceoverAudioUrl}
                              className="w-full h-9"
                            />
                          </div>
                        )}
                        {activeFlow.masterVideoUrl && (
                          <div className="rounded-xl bg-emerald-50/70 border border-emerald-300 p-3">
                            <div className="flex items-center justify-between mb-1.5">
                              <span className="text-xs font-extrabold text-emerald-950">
                                🎬 ภาพยนตร์ Master Film (.MP4 Stitched)
                              </span>
                              <a
                                href={activeFlow.masterVideoUrl}
                                download
                                className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-800 hover:underline"
                              >
                                <Download className="w-3.5 h-3.5" /> ดาวน์โหลด .MP4
                              </a>
                            </div>
                            <video
                              controls
                              src={activeFlow.masterVideoUrl}
                              className="w-full rounded-lg bg-black max-h-60"
                            />
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Scene Cards */}
                  <div className="space-y-4">
                    {activeFlow.scenes.map((sc, idx) => (
                      <div
                        key={sc.id || idx}
                        className="rounded-2xl bg-white border border-slate-200 p-5 shadow-2xs space-y-3"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex items-center gap-2">
                            <span className="rounded-full bg-[#0d2546] px-3 py-0.5 text-xs font-extrabold text-amber-300">
                              SCENE {sc.sceneNumber} ({sc.durationSec}s)
                            </span>
                            <h4 className="font-extrabold text-sm text-[#0d2546]">
                              {sc.title}
                            </h4>
                          </div>
                        </div>

                        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                          {/* Start Frame Ingredient */}
                          <div className="rounded-xl border border-slate-200 p-3 space-y-2 bg-slate-50/60">
                            <div className="text-xs font-extrabold text-[#0d2546]">
                              1. First Frame Ingredient (&lt;FIRST_FRAME&gt;)
                            </div>
                            {sc.firstFrameUrl ? (
                              <img
                                src={sc.firstFrameUrl}
                                alt="First frame"
                                className="w-full h-36 object-cover rounded-lg border border-slate-200 bg-slate-900"
                              />
                            ) : (
                              <div className="h-36 rounded-lg border border-dashed border-slate-300 flex items-center justify-center text-[11px] text-slate-400">
                                ยังไม่ได้สร้างภาพต้นฉาก
                              </div>
                            )}
                            <textarea
                              rows={2}
                              value={sc.firstFramePrompt}
                              onChange={(e) => {
                                const next = [...activeFlow.scenes];
                                next[idx] = { ...sc, firstFramePrompt: e.target.value };
                                setFlowProjects((prev) =>
                                  prev.map((p) =>
                                    p.id === activeFlow.id ? { ...p, scenes: next } : p
                                  )
                                );
                              }}
                              className="w-full rounded-lg border border-slate-200 bg-white p-2 text-[11px]"
                            />
                            <div className="flex gap-1.5">
                              <button
                                type="button"
                                disabled={busySceneKey === `frame-${idx}-first`}
                                onClick={() =>
                                  handleGenerateSceneFrame(
                                    activeFlow.id,
                                    idx,
                                    'first',
                                    sc.firstFramePrompt
                                  )
                                }
                                className="flex-1 rounded-lg bg-sky-700 py-1.5 text-[11px] font-extrabold text-white hover:bg-sky-800 cursor-pointer disabled:opacity-50"
                              >
                                {busySceneKey === `frame-${idx}-first`
                                  ? 'กำลังวาดภาพจริง...'
                                  : 'สร้างด้วย Nano Banana 2.1'}
                              </button>
                              <label className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-[11px] font-bold text-slate-700 cursor-pointer hover:bg-slate-100">
                                <Upload className="w-3.5 h-3.5 inline" />
                                <input
                                  type="file"
                                  accept="image/*"
                                  className="hidden"
                                  onChange={async (e) => {
                                    const f = e.target.files?.[0];
                                    if (!f) return;
                                    const url = await api.uploadFile(f);
                                    const next = [...activeFlow.scenes];
                                    next[idx] = { ...sc, firstFrameUrl: url };
                                    const up = await api.updateFlowProject(activeFlow.id, {
                                      scenes: next,
                                    });
                                    setFlowProjects((prev) =>
                                      prev.map((p) => (p.id === up.id ? up : p))
                                    );
                                  }}
                                />
                              </label>
                            </div>
                          </div>

                          {/* End Frame Transition Ingredient */}
                          <div className="rounded-xl border border-slate-200 p-3 space-y-2 bg-slate-50/60">
                            <div className="text-xs font-extrabold text-[#0d2546]">
                              2. Last Frame Transition (&lt;LAST_FRAME&gt; Optional)
                            </div>
                            {sc.lastFrameUrl ? (
                              <img
                                src={sc.lastFrameUrl}
                                alt="Last frame"
                                className="w-full h-36 object-cover rounded-lg border border-slate-200 bg-slate-900"
                              />
                            ) : (
                              <div className="h-36 rounded-lg border border-dashed border-slate-300 flex items-center justify-center text-[11px] text-slate-400 text-center px-2">
                                (ทางเลือก) สร้างภาพท้ายฉากเพื่อบังคับ Flow Frame-to-Frame Transition
                              </div>
                            )}
                            <textarea
                              rows={2}
                              value={sc.lastFramePrompt}
                              onChange={(e) => {
                                const next = [...activeFlow.scenes];
                                next[idx] = { ...sc, lastFramePrompt: e.target.value };
                                setFlowProjects((prev) =>
                                  prev.map((p) =>
                                    p.id === activeFlow.id ? { ...p, scenes: next } : p
                                  )
                                );
                              }}
                              className="w-full rounded-lg border border-slate-200 bg-white p-2 text-[11px]"
                            />
                            <button
                              type="button"
                              disabled={busySceneKey === `frame-${idx}-last`}
                              onClick={() =>
                                handleGenerateSceneFrame(
                                  activeFlow.id,
                                  idx,
                                  'last',
                                  sc.lastFramePrompt
                                )
                              }
                              className="w-full rounded-lg bg-indigo-700 py-1.5 text-[11px] font-extrabold text-white hover:bg-indigo-800 cursor-pointer disabled:opacity-50"
                            >
                              {busySceneKey === `frame-${idx}-last`
                                ? 'กำลังวาดภาพท้ายฉาก...'
                                : 'สร้าง Last Frame (Nano Banana 2.1)'}
                            </button>
                          </div>

                          {/* Veo / Omni Video Clip Output */}
                          <div className="rounded-xl border-2 border-[#0d2546]/20 p-3 space-y-2 bg-amber-50/30">
                            <div className="flex items-center justify-between">
                              <span className="text-xs font-extrabold text-[#0d2546]">
                                3. Veo / Omni Scene Video (.MP4)
                              </span>
                              {sc.videoClipUrl && (
                                <a
                                  href={sc.videoClipUrl}
                                  download
                                  className="text-[11px] font-bold text-emerald-700 hover:underline"
                                >
                                  ดาวน์โหลด
                                </a>
                              )}
                            </div>

                            {sc.videoClipUrl ? (
                              <video
                                controls
                                src={sc.videoClipUrl}
                                className="w-full h-36 rounded-lg bg-black object-contain"
                              />
                            ) : (
                              <div className="h-36 rounded-lg border border-dashed border-amber-400/70 bg-white flex items-center justify-center text-[11px] text-slate-500 text-center px-3">
                                กดปุ่มด้านล่างเพื่อเรนเดอร์วิดีโอ .mp4 จริงจาก{' '}
                                {activeFlow.videoEngine}
                              </div>
                            )}

                            <textarea
                              rows={2}
                              value={sc.videoMotionPrompt}
                              onChange={(e) => {
                                const next = [...activeFlow.scenes];
                                next[idx] = { ...sc, videoMotionPrompt: e.target.value };
                                setFlowProjects((prev) =>
                                  prev.map((p) =>
                                    p.id === activeFlow.id ? { ...p, scenes: next } : p
                                  )
                                );
                              }}
                              className="w-full rounded-lg border border-slate-200 bg-white p-2 text-[11px]"
                            />

                            <div className="flex flex-wrap gap-1.5">
                              <button
                                type="button"
                                disabled={Boolean(busySceneKey?.startsWith(`video-${idx}`))}
                                onClick={() =>
                                  handleRenderSceneVideo(
                                    activeFlow.id,
                                    idx,
                                    sc.firstFrameUrl ? 'keyframes' : 'text_only',
                                    sc.videoMotionPrompt
                                  )
                                }
                                className="flex-1 rounded-lg bg-gradient-to-r from-[#f59e0b] to-[#ea8810] py-1.5 px-2 text-[11px] font-extrabold text-[#0b1e38] hover:brightness-105 cursor-pointer disabled:opacity-50"
                              >
                                {busySceneKey === `video-${idx}-keyframes` ||
                                busySceneKey === `video-${idx}-text_only`
                                  ? 'กำลังเรนเดอร์ .MP4 จริง...'
                                  : sc.firstFrameUrl
                                  ? '🎬 เรนเดอร์จาก Keyframe'
                                  : '🎬 เรนเดอร์ Text-to-Video'}
                              </button>

                              {idx > 0 && activeFlow.scenes[idx - 1]?.videoClipUrl && (
                                <button
                                  type="button"
                                  disabled={Boolean(busySceneKey?.startsWith(`video-${idx}`))}
                                  onClick={() =>
                                    handleRenderSceneVideo(
                                      activeFlow.id,
                                      idx,
                                      'extend_prev',
                                      sc.videoMotionPrompt
                                    )
                                  }
                                  className="rounded-lg bg-[#0d2546] py-1.5 px-2.5 text-[11px] font-extrabold text-amber-300 cursor-pointer disabled:opacity-50"
                                  title="Google Flow Scene Extension: ขยายวิดีโอต่อเนื่องจากฉากก่อนหน้า"
                                >
                                  Extend ฉากก่อน
                                </button>
                              )}
                            </div>
                          </div>
                        </div>

                        <div className="text-xs text-slate-600 bg-slate-50 rounded-xl px-3 py-2 border border-slate-200/70">
                          <strong>บทพากย์ฉากนี้:</strong> {sc.narrationThai}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ==================================================================== */}
      {/* TAB 2: DIRECT GOOGLE VEO VIDEO / NANO BANANA IMAGE / TTS AUDIO LAB   */}
      {/* ==================================================================== */}
      {subTab === 'direct_media' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
            {/* 1. Direct Google Veo / Gemini Omni Video Card */}
            <form
              onSubmit={handleDirectVideoGen}
              className="rounded-2xl bg-white border border-slate-200 p-5 shadow-2xs space-y-3"
            >
              <div className="flex items-center gap-2 text-sm font-extrabold text-[#0d2546]">
                <Film className="w-4 h-4 text-rose-600" />
                สร้างวิดีโอ .MP4 จริง (Google Veo / Omni Video)
              </div>
              <select
                value={directVidEngine}
                onChange={(e) => setDirectVidEngine(e.target.value as any)}
                className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-bold"
              >
                <option value="gemini-omni-1.1-flash">
                  Gemini Omni 1.1 Flash (ใช้ GEMINI_API_KEY)
                </option>
                <option value="veo-3.1-generate-001">
                  Google Veo 3.1 GA (Vertex AI: veo-3.1-generate-001)
                </option>
                <option value="veo-3.1-fast-generate-001">
                  Google Veo 3.1 Fast (Vertex AI: veo-3.1-fast-generate-001)
                </option>
              </select>
              <textarea
                rows={3}
                required
                value={directVidPrompt}
                onChange={(e) => setDirectVidPrompt(e.target.value)}
                placeholder="บรรยายฉากวิดีโอ เช่น Cinematic wide shot of an inspiring Thai educator teaching students with holographic AI mind maps, warm golden sunlight..."
                className="w-full rounded-xl border border-slate-200 p-3 text-xs"
              />
              <div className="grid grid-cols-3 gap-2">
                <select
                  value={directVidAspect}
                  onChange={(e) => setDirectVidAspect(e.target.value as any)}
                  className="rounded-lg border border-slate-200 px-2 py-1.5 text-xs font-bold"
                >
                  <option value="16:9">16:9</option>
                  <option value="9:16">9:16</option>
                </select>
                <select
                  value={directVidRes}
                  onChange={(e) => setDirectVidRes(e.target.value as any)}
                  className="rounded-lg border border-slate-200 px-2 py-1.5 text-xs font-bold"
                >
                  <option value="720p">720p</option>
                  <option value="1080p">1080p</option>
                  <option value="4k">4K</option>
                </select>
                <select
                  value={directVidDuration}
                  onChange={(e) => setDirectVidDuration(Number(e.target.value))}
                  className="rounded-lg border border-slate-200 px-2 py-1.5 text-xs font-bold"
                >
                  <option value={5}>5 วินาที</option>
                  <option value={6}>6 วินาที</option>
                  <option value={8}>8 วินาที</option>
                  <option value={10}>10 วินาที</option>
                </select>
              </div>
              <div className="grid grid-cols-2 gap-2 text-[11px]">
                <input
                  type="text"
                  value={directFirstFrame}
                  onChange={(e) => setDirectFirstFrame(e.target.value)}
                  placeholder="First Frame URL (ไม่บังคับ)"
                  className="rounded-lg border border-slate-200 px-2.5 py-1.5"
                />
                <input
                  type="text"
                  value={directLastFrame}
                  onChange={(e) => setDirectLastFrame(e.target.value)}
                  placeholder="Last Frame URL (ไม่บังคับ)"
                  className="rounded-lg border border-slate-200 px-2.5 py-1.5"
                />
              </div>
              <button
                type="submit"
                disabled={directVidLoading}
                className="w-full rounded-xl bg-rose-600 py-2.5 text-xs font-extrabold text-white hover:bg-rose-700 cursor-pointer disabled:opacity-50"
              >
                {directVidLoading
                  ? 'กำลังสร้างวิดีโอ .MP4 จริง (ใช้เวลา ~30-90 วินาที)...'
                  : 'สร้างวิดีโอ .MP4 จริงทันที'}
              </button>
            </form>

            {/* 2. Direct Real Image Generator Card */}
            <form
              onSubmit={handleDirectImageGen}
              className="rounded-2xl bg-white border border-slate-200 p-5 shadow-2xs space-y-3"
            >
              <div className="flex items-center gap-2 text-sm font-extrabold text-[#0d2546]">
                <ImageIcon className="w-4 h-4 text-sky-600" />
                สร้างรูปภาพ .PNG จริง (Nano Banana 2.1 / DALL-E 3)
              </div>
              <div className="grid grid-cols-2 gap-2">
                <select
                  value={directImgProvider}
                  onChange={(e) => {
                    const p = e.target.value as 'gemini' | 'openai';
                    setDirectImgProvider(p);
                    setDirectImgModel(
                      p === 'gemini' ? 'gemini-nano-banana-2.1' : 'dall-e-3'
                    );
                  }}
                  className="rounded-xl border border-slate-200 bg-slate-50 px-2.5 py-2 text-xs font-bold"
                >
                  <option value="gemini">Google Gemini Image</option>
                  <option value="openai">OpenAI Images</option>
                </select>
                <select
                  value={directImgModel}
                  onChange={(e) => setDirectImgModel(e.target.value)}
                  className="rounded-xl border border-slate-200 bg-slate-50 px-2.5 py-2 text-xs font-bold"
                >
                  {directImgProvider === 'gemini' ? (
                    <>
                      <option value="gemini-nano-banana-2.1">gemini-nano-banana-2.1</option>
                      <option value="gemini-3-pro-image">gemini-3-pro-image</option>
                    </>
                  ) : (
                    <>
                      <option value="dall-e-3">dall-e-3</option>
                      <option value="gpt-image-1">gpt-image-1</option>
                    </>
                  )}
                </select>
              </div>
              <textarea
                rows={4}
                required
                value={directImgPrompt}
                onChange={(e) => setDirectImgPrompt(e.target.value)}
                placeholder="Prompt ภาษาอังกฤษหรือไทย เช่น Modern Thai lifelong learning center in Phuket, deep navy and warm gold architectural accents, photorealistic..."
                className="w-full rounded-xl border border-slate-200 p-3 text-xs"
              />
              <select
                value={directImgAspect}
                onChange={(e) => setDirectImgAspect(e.target.value as any)}
                className="w-full rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-bold"
              >
                <option value="16:9">16:9 (ภาพปกบทความ / YouTube)</option>
                <option value="1:1">1:1 (Instagram / Facebook Square)</option>
                <option value="9:16">9:16 (Stories / Reels / TikTok)</option>
              </select>
              <button
                type="submit"
                disabled={directImgLoading}
                className="w-full rounded-xl bg-sky-700 py-2.5 text-xs font-extrabold text-white hover:bg-sky-800 cursor-pointer disabled:opacity-50"
              >
                {directImgLoading ? 'กำลังสร้างไฟล์ภาพจริง...' : 'สร้างรูปภาพ AI จริงทันที'}
              </button>
            </form>

            {/* 3. Direct Real Audio TTS Card */}
            <form
              onSubmit={handleDirectTtsGen}
              className="rounded-2xl bg-white border border-slate-200 p-5 shadow-2xs space-y-3"
            >
              <div className="flex items-center gap-2 text-sm font-extrabold text-[#0d2546]">
                <Mic className="w-4 h-4 text-amber-600" />
                สร้างเสียงพากย์จริง (Gemini 3.8 TTS / ElevenLabs / OpenAI)
              </div>
              <div className="grid grid-cols-2 gap-2">
                <select
                  value={directTtsProvider}
                  onChange={(e) => {
                    const p = e.target.value as any;
                    setDirectTtsProvider(p);
                    setDirectTtsVoice(
                      p === 'gemini'
                        ? 'Kore'
                        : p === 'openai'
                        ? 'alloy'
                        : 'JBFqnCBsd6RMkjVDRZzb'
                    );
                  }}
                  className="rounded-xl border border-slate-200 bg-slate-50 px-2.5 py-2 text-xs font-bold"
                >
                  <option value="gemini">Gemini 3.8 Flash TTS (รองรับไทย)</option>
                  <option value="elevenlabs">ElevenLabs Multilingual v2</option>
                  <option value="openai">OpenAI gpt-4o-mini-tts</option>
                </select>
                <input
                  type="text"
                  value={directTtsVoice}
                  onChange={(e) => setDirectTtsVoice(e.target.value)}
                  placeholder="Voice (เช่น Kore, Orus, Puck)"
                  className="rounded-xl border border-slate-200 px-2.5 py-2 text-xs font-bold"
                />
              </div>
              <textarea
                rows={5}
                required
                value={directTtsText}
                onChange={(e) => setDirectTtsText(e.target.value)}
                placeholder="พิมพ์บทพากย์ภาษาไทยหรืออังกฤษ เช่น สวัสดีครับชาวคมคิด วันนี้เราจะมาสำรวจแนวทางการใช้ AI ยกระดับห้องเรียนไทย..."
                className="w-full rounded-xl border border-slate-200 p-3 text-xs"
              />
              <button
                type="submit"
                disabled={directTtsLoading}
                className="w-full rounded-xl bg-amber-500 py-2.5 text-xs font-extrabold text-[#0b1e38] hover:brightness-105 cursor-pointer disabled:opacity-50"
              >
                {directTtsLoading ? 'กำลังสังเคราะห์ไฟล์เสียงจริง...' : 'สร้างไฟล์เสียง .WAV/.MP3 จริง'}
              </button>
            </form>
          </div>

          {/* Generated Real Media Assets Gallery */}
          <div className="rounded-2xl bg-white border border-slate-200 p-5 shadow-2xs space-y-4">
            <h3 className="text-base font-extrabold text-[#0d2546]">
              คลังไฟล์สื่อ AI ที่สร้างจริงในระบบ ({mediaAssets.length} ไฟล์ใน /uploads/)
            </h3>
            {mediaAssets.length === 0 ? (
              <p className="text-xs text-slate-400 py-6 text-center">
                ยังไม่มีไฟล์สื่อที่สร้าง กดสั่งสร้างวิดีโอ รูปภาพ หรือเสียงด้านบนได้เลยครับ
              </p>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {mediaAssets.map((a) => (
                  <div
                    key={a.id}
                    className="rounded-xl border border-slate-200 p-3 space-y-2 flex flex-col justify-between"
                  >
                    <div className="space-y-2">
                      <div className="flex items-center justify-between text-[10.5px]">
                        <span className="rounded-full bg-[#0d2546] text-amber-300 px-2.5 py-0.5 font-extrabold uppercase">
                          {a.mediaType} • {a.model}
                        </span>
                        <button
                          onClick={async () => {
                            await api.deleteMediaAsset(a.id);
                            await loadStudioData();
                          }}
                          className="text-slate-400 hover:text-rose-600 cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>

                      {a.mediaType === 'video' && (
                        <video
                          controls
                          src={a.fileUrl}
                          className="w-full h-40 rounded-lg bg-black object-contain"
                        />
                      )}
                      {a.mediaType === 'image' && (
                        <img
                          src={a.fileUrl}
                          alt={a.prompt}
                          className="w-full h-40 rounded-lg object-cover bg-slate-100"
                        />
                      )}
                      {a.mediaType === 'audio' && (
                        <div className="py-4">
                          <audio controls src={a.fileUrl} className="w-full" />
                        </div>
                      )}

                      <p className="text-[11px] text-slate-600 line-clamp-2">{a.prompt}</p>
                    </div>

                    <div className="pt-2 border-t border-slate-100 flex items-center justify-between text-[11px]">
                      <a
                        href={a.fileUrl}
                        download
                        className="font-bold text-sky-700 hover:underline inline-flex items-center gap-1"
                      >
                        <Download className="w-3 h-3" /> ดาวน์โหลดไฟล์จริง
                      </a>
                      <button
                        onClick={() => {
                          if (a.mediaType === 'image') {
                            setDirectFirstFrame(a.fileUrl);
                            setSuccessBanner('นำ URL รูปภาพไปใส่เป็น First Frame สำหรับสร้างวิดีโอแล้ว!');
                          }
                        }}
                        className={`font-bold text-amber-700 hover:underline cursor-pointer ${
                          a.mediaType !== 'image' ? 'hidden' : ''
                        }`}
                      >
                        ใช้เป็น First Frame →
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ==================================================================== */}
      {/* TAB 3: REAL MULTI-LLM INTERACTIVE CHAT (CLAUDE, DEEPSEEK, GPT, GEMINI) */}
      {/* ==================================================================== */}
      {subTab === 'chat' && (
        <div className="space-y-4">
          {/* Provider Switcher Bar */}
          <div className="rounded-2xl bg-white border border-slate-200 p-4 shadow-2xs flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              {CHAT_PROVIDERS.map((p) => {
                const active = chatProvider === p.id;
                const hasKey =
                  (p.id === 'gemini' && settings?.hasGeminiKey) ||
                  (p.id === 'claude' && settings?.hasClaudeKey) ||
                  (p.id === 'deepseek' && settings?.hasDeepseekKey) ||
                  (p.id === 'openai' && settings?.hasOpenaiKey);
                return (
                  <button
                    key={p.id}
                    onClick={() => setChatProvider(p.id)}
                    className={`inline-flex items-center gap-2 rounded-xl px-3.5 py-2 text-xs font-extrabold transition cursor-pointer ${
                      active
                        ? 'bg-[#0d2546] text-amber-300 shadow-xs'
                        : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                    }`}
                  >
                    <span
                      className={`h-2 w-2 rounded-full ${
                        hasKey ? 'bg-emerald-400' : 'bg-rose-400'
                      }`}
                    />
                    {p.name}
                  </button>
                );
              })}
            </div>

            <div className="flex flex-wrap items-center gap-2.5">
              <select
                value={chatModel}
                onChange={(e) => setChatModel(e.target.value)}
                className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-bold text-[#0d2546]"
              >
                {(
                  CHAT_PROVIDERS.find((p) => p.id === chatProvider)?.models || []
                ).map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>

              <label className="inline-flex items-center gap-1.5 text-xs font-bold text-[#0d2546] cursor-pointer">
                <input
                  type="checkbox"
                  checked={useKb}
                  onChange={(e) => setUseKb(e.target.checked)}
                  className="accent-emerald-600"
                />
                เชื่อมฐานความรู้ คมคิด (RAG)
              </label>

              <button
                onClick={async () => {
                  await api.clearChatHistory(sessionId);
                  setChatMessages([]);
                  setArenaResults([]);
                }}
                className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-[11px] font-bold text-slate-500 hover:text-rose-600 cursor-pointer"
              >
                ล้างประวัติแชท
              </button>
            </div>
          </div>

          {/* 4-Model Side-by-Side Arena Output (if triggered) */}
          {arenaResults.length > 0 && (
            <div className="rounded-2xl bg-slate-900 p-4 text-white space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-extrabold text-amber-300 flex items-center gap-1.5">
                  <BrainCircuit className="w-4 h-4" />
                  ผลลัพธ์การประชัน 4 โมเดลจริงพร้อมกัน (Gemini • Claude • DeepSeek • ChatGPT)
                </span>
                <button
                  onClick={() => setArenaResults([])}
                  className="text-xs text-slate-400 hover:text-white cursor-pointer"
                >
                  ซ่อนตารางเปรียบเทียบ
                </button>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {arenaResults.map((ar, i) => (
                  <div
                    key={i}
                    className="rounded-xl bg-white/10 border border-white/15 p-3.5 space-y-2"
                  >
                    <div className="flex items-center justify-between text-xs font-extrabold text-amber-300">
                      <span>{ar.engineLabel}</span>
                      {ar.latencyMs && (
                        <span className="text-[10.5px] text-emerald-300">
                          {ar.latencyMs} ms
                        </span>
                      )}
                    </div>
                    {ar.error ? (
                      <div className="text-xs text-rose-300">{ar.error}</div>
                    ) : (
                      <>
                        <div className="text-xs text-slate-100 whitespace-pre-wrap max-h-60 overflow-y-auto leading-relaxed">
                          {ar.reply}
                        </div>
                        <button
                          onClick={() =>
                            handlePublishTextToCrud(ar.reply, ar.engineLabel)
                          }
                          className="rounded-lg bg-amber-400 px-2.5 py-1 text-[11px] font-extrabold text-[#0b1e38] cursor-pointer"
                        >
                          นำคำตอบนี้ไปสร้างโพสต์หน้าเว็บ →
                        </button>
                      </>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Chat Conversation Box */}
          <div className="rounded-2xl bg-white border border-slate-200 shadow-2xs overflow-hidden flex flex-col h-[540px]">
            <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-4">
              {chatMessages.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-center text-slate-400 space-y-2">
                  <Bot className="w-10 h-10 text-[#0d2546]/30" />
                  <div className="text-sm font-bold text-[#0d2546]">
                    สนทนาสดกับ {CHAT_PROVIDERS.find((p) => p.id === chatProvider)?.name} ({chatModel})
                  </div>
                  <p className="text-xs max-w-md">
                    ทุกข้อความส่งตรงถึง API จริง 100% (ไม่มีข้อความจำลอง) สามารถสั่งวิเคราะห์นโยบาย ร่างบทความ สคริปต์วิดีโอ หรือกดปุ่มประชัน 4 โมเดลพร้อมกันได้ทันที
                  </p>
                </div>
              ) : (
                chatMessages.map((m) => (
                  <div
                    key={m.id}
                    className={`flex ${
                      m.role === 'user' ? 'justify-end' : 'justify-start'
                    }`}
                  >
                    <div
                      className={`max-w-3xl rounded-2xl px-4 py-3 text-sm ${
                        m.role === 'user'
                          ? 'bg-[#0d2546] text-white'
                          : 'bg-slate-50 border border-slate-200 text-slate-800'
                      }`}
                    >
                      {m.role === 'assistant' && (
                        <div className="flex items-center justify-between gap-4 mb-1.5 text-[11px] font-extrabold text-amber-700">
                          <span>
                            🤖 {m.provider.toUpperCase()} ({m.model})
                          </span>
                          {m.latencyMs ? <span>{m.latencyMs} ms</span> : null}
                        </div>
                      )}

                      {m.reasoning && (
                        <details className="mb-2 rounded-xl bg-indigo-50 border border-indigo-200 p-2.5 text-xs text-indigo-950">
                          <summary className="font-extrabold cursor-pointer">
                            🧠 ดูการคิดวิเคราะห์เชิงลึก (Reasoning Chain-of-Thought)
                          </summary>
                          <div className="mt-1.5 whitespace-pre-wrap text-[11.5px] text-slate-700">
                            {m.reasoning}
                          </div>
                        </details>
                      )}

                      {m.role === 'assistant' ? (
                        <div className="text-xs sm:text-sm">
                          {renderRichMarkdown(m.content)}
                        </div>
                      ) : (
                        <div className="whitespace-pre-wrap">{m.content}</div>
                      )}

                      {m.role === 'assistant' && (
                        <div className="mt-2.5 pt-2 border-t border-slate-200/80 flex justify-end">
                          <button
                            onClick={() =>
                              handlePublishTextToCrud(
                                m.content,
                                `${m.provider} (${m.model})`
                              )
                            }
                            className="inline-flex items-center gap-1 rounded-lg bg-[#0d2546]/10 px-2.5 py-1 text-[11px] font-extrabold text-[#0d2546] hover:bg-[#0d2546] hover:text-white transition cursor-pointer"
                          >
                            <FilePlus2 className="w-3.5 h-3.5" />
                            สร้างเป็นโพสต์ CRUD บนเว็บไซต์
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>

            {/* Chat Input Footer */}
            <form
              onSubmit={handleSendChat}
              className="border-t border-slate-200 bg-slate-50 p-3 flex flex-col sm:flex-row gap-2"
            >
              <input
                type="text"
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                placeholder={`พิมพ์ข้อความถึง ${chatProvider.toUpperCase()} (${chatModel})...`}
                className="flex-1 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm focus:border-[#f59e0b] focus:outline-none"
              />
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={arenaRunning || chatSending}
                  onClick={handleRun4ModelArena}
                  className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-indigo-700 px-3.5 py-2.5 text-xs font-extrabold text-white hover:bg-indigo-800 cursor-pointer disabled:opacity-50"
                  title="ยิงคำถามนี้ไปยัง Gemini, Claude, DeepSeek และ ChatGPT พร้อมกันเพื่อเทียบคำตอบจริง"
                >
                  <Wand2 className="w-3.5 h-3.5" />
                  {arenaRunning ? 'กำลังเทียบ 4 API...' : 'เทียบ 4 โมเดลพร้อมกัน'}
                </button>
                <button
                  type="submit"
                  disabled={chatSending || arenaRunning}
                  className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-[#0d2546] px-5 py-2.5 text-xs font-extrabold text-amber-300 hover:bg-[#173d70] cursor-pointer disabled:opacity-50"
                >
                  <Send className="w-3.5 h-3.5" />
                  {chatSending ? 'กำลังเรียก API...' : 'ส่งข้อความ'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
