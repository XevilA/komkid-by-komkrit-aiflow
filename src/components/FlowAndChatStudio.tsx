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
  AlertTriangle,
} from 'lucide-react';
import {
  AiChatMessage,
  AiEngineSettings,
  AiMediaAsset,
  FlowProject,
  LiveModelOption,
  LlmProviderId,
  UnifiedLiveModelsResponse,
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
}[] = [
  { id: 'gemini', name: 'Google Gemini' },
  { id: 'claude', name: 'Anthropic Claude' },
  { id: 'deepseek', name: 'DeepSeek' },
  { id: 'openai', name: 'OpenAI ChatGPT' },
];

export const FlowAndChatStudio: React.FC<Props> = ({
  onRefreshAll,
  onOpenSettings,
  onOpenPost,
}) => {
  const [subTab, setSubTab] = useState<'flow' | 'direct_media' | 'chat'>('flow');
  const [settings, setSettings] = useState<AiEngineSettings | null>(null);
  const [liveModels, setLiveModels] = useState<UnifiedLiveModelsResponse | null>(
    null
  );
  const [errorBanner, setErrorBanner] = useState<string | null>(null);
  const [successBanner, setSuccessBanner] = useState<string | null>(null);

  const [chatProvider, setChatProvider] =
    useState<Exclude<LlmProviderId, 'auto'>>('gemini');
  const [chatModel, setChatModel] = useState('');
  const [useKb, setUseKb] = useState(true);
  const [chatMessages, setChatMessages] = useState<AiChatMessage[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [chatSending, setChatSending] = useState(false);
  const [arenaRunning, setArenaRunning] = useState(false);
  const [arenaResults, setArenaResults] = useState<
    {
      provider: string;
      engineLabel: string;
      reply: string;
      latencyMs?: number;
      error?: string;
    }[]
  >([]);

  const [flowProjects, setFlowProjects] = useState<FlowProject[]>([]);
  const [selectedFlowId, setSelectedFlowId] = useState<number | null>(null);
  const [flowTitle, setFlowTitle] = useState('');
  const [flowConcept, setFlowConcept] = useState('');
  const [flowScenesCount, setFlowScenesCount] = useState(3);
  const [flowAspect, setFlowAspect] = useState<'16:9' | '9:16'>('16:9');
  const [flowRes, setFlowRes] = useState<'720p' | '1080p' | '4k'>('720p');
  const [flowEngine, setFlowEngine] = useState<string>('');
  const [creatingFlow, setCreatingFlow] = useState(false);
  const [busySceneKey, setBusySceneKey] = useState<string | null>(null);
  const [assemblingFlow, setAssemblingFlow] = useState(false);
  const [generatingFlowVo, setGeneratingFlowVo] = useState(false);

  const [mediaAssets, setMediaAssets] = useState<AiMediaAsset[]>([]);
  const [directVidPrompt, setDirectVidPrompt] = useState('');
  const [directVidEngine, setDirectVidEngine] = useState<string>('');
  const [directVidAspect, setDirectVidAspect] = useState<'16:9' | '9:16'>('16:9');
  const [directVidDuration, setDirectVidDuration] = useState(6);
  const [directVidRes, setDirectVidRes] = useState<'720p' | '1080p' | '4k'>(
    '720p'
  );
  const [directFirstFrame, setDirectFirstFrame] = useState('');
  const [directLastFrame, setDirectLastFrame] = useState('');
  const [directVidLoading, setDirectVidLoading] = useState(false);

  const [directImgPrompt, setDirectImgPrompt] = useState('');
  const [directImgProvider, setDirectImgProvider] = useState<'gemini' | 'openai'>(
    'gemini'
  );
  const [directImgModel, setDirectImgModel] = useState('');
  const [directImgAspect, setDirectImgAspect] = useState<'16:9' | '9:16' | '1:1'>(
    '16:9'
  );
  const [directImgLoading, setDirectImgLoading] = useState(false);

  const [directTtsText, setDirectTtsText] = useState('');
  const [directTtsProvider, setDirectTtsProvider] = useState<
    'gemini' | 'elevenlabs' | 'openai'
  >('gemini');
  const [directTtsVoice, setDirectTtsVoice] = useState('Kore');
  const [directTtsLoading, setDirectTtsLoading] = useState(false);

  const sessionId = `komkrit-${chatProvider}`;

  const loadStudioData = async () => {
    const [st, fp, ma, lm] = await Promise.all([
      api.getAiSettings(),
      api.getFlowProjects(),
      api.getMediaAssets(),
      api.getLiveModels().catch(() => null),
    ]);
    setSettings(st);
    setFlowProjects(fp);
    if (fp.length > 0 && !selectedFlowId) {
      setSelectedFlowId(fp[0].id);
    }
    setMediaAssets(ma);
    if (lm) {
      setLiveModels(lm);
    }
  };

  useEffect(() => {
    loadStudioData();
  }, []);

  useEffect(() => {
    api.getChatHistory(sessionId).then(setChatMessages).catch(() => {});
    const liveList = liveModels?.providers?.[chatProvider]?.textModels || [];
    setChatModel(liveList[0]?.id || '');
  }, [chatProvider, liveModels]);

  const combinedLiveVideoModels: LiveModelOption[] = React.useMemo(() => {
    const merged: LiveModelOption[] = [];
    const seen = new Set<string>();
    for (const m of [
      ...(liveModels?.providers.gemini?.videoModels || []),
      ...(liveModels?.providers.vertex_veo?.videoModels || []),
    ]) {
      if (!seen.has(m.id)) {
        seen.add(m.id);
        merged.push(m);
      }
    }
    return merged;
  }, [liveModels]);

  const activeFlow =
    flowProjects.find((p) => p.id === selectedFlowId) || flowProjects[0] || null;

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
      setErrorBanner('กรุณาระบุคำถามในช่องสนทนาก่อนดำเนินการเปรียบเทียบ');
      return;
    }
    setErrorBanner(null);
    setArenaRunning(true);
    setArenaResults([]);
    const promptToTest = chatInput.trim();

    const tasks = CHAT_PROVIDERS.map(async (prov) => {
      const liveFirstModel =
        liveModels?.providers?.[prov.id]?.textModels?.[0]?.id || undefined;
      try {
        const res = await api.sendChatMessage({
          sessionId: `arena-${prov.id}-${Date.now()}`,
          provider: prov.id,
          model: liveFirstModel,
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
          engineLabel: `${prov.name}${liveFirstModel ? ` (${liveFirstModel})` : ''}`,
          reply: '',
          error: (e as Error).message,
        };
      }
    });

    const settled = await Promise.all(tasks);
    setArenaResults(settled);
    setArenaRunning(false);
  };

  const handlePublishTextToCrud = async (
    contentMarkdown: string,
    sourceLabel: string
  ) => {
    const firstLine =
      contentMarkdown
        .split('\n')
        .map((l) => l.replace(/^#+\s*/, '').trim())
        .find((l) => l.length > 5) || 'บทความจากระบบผู้ช่วย AI';
    const created = await api.createPost({
      title: firstLine.slice(0, 110),
      subtitle: `เรียบเรียงร่วมกับ ${sourceLabel}`,
      excerpt: contentMarkdown.replace(/[#>*_`]/g, '').slice(0, 180),
      content: contentMarkdown,
      category: 'ai-tech',
      contentType: 'article',
      status: 'published',
      tags: ['AI Studio', sourceLabel, 'คมคิด by KOMKRIT'],
    });
    await onRefreshAll();
    setSuccessBanner(`สร้างและเผยแพร่เนื้อหาสำเร็จ (รหัสเนื้อหา #${created.id})`);
    onOpenPost(created.id);
  };

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
        `สร้างโครงร่างสตอรีบอร์ดจำนวน ${created.scenes.length} ฉากเรียบร้อยแล้ว`
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
      setSuccessBanner(`เรนเดอร์คลิปวิดีโอฉากที่ ${sceneIdx + 1} สำเร็จ`);
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
      setSuccessBanner('สังเคราะห์เสียงบรรยายภาษาไทยรวมทุกฉากสำเร็จ');
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
      setSuccessBanner('ตัดต่อรวมทุกฉากและผสมเสียงบรรยายเป็นไฟล์ .MP4 สำเร็จ');
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
      setErrorBanner('กรุณาเรนเดอร์คลิปวิดีโออย่างน้อย 1 ฉากก่อนเผยแพร่');
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
      subtitle: `ผลิตด้วยระบบ Multi-Scene Video (${proj.videoEngine})`,
      excerpt: proj.concept.slice(0, 180),
      content: `## ${proj.title}\n\n${proj.concept}\n\n${fullNarration}`,
      category: 'ai-tech',
      contentType: 'video',
      coverImage: cover,
      videoUrl,
      audioUrl: proj.voiceoverAudioUrl || '',
      status: 'published',
      tags: ['AI Video Production', 'คมคิด by KOMKRIT'],
    });
    await onRefreshAll();
    onOpenPost(created.id);
  };

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
      setSuccessBanner(`สร้างไฟล์วิดีโอ ${asset.fileUrl} สำเร็จ`);
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
      setSuccessBanner(`สร้างไฟล์รูปภาพ ${asset.fileUrl} สำเร็จ`);
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
      setSuccessBanner(`สังเคราะห์ไฟล์เสียงบรรยาย ${asset.fileUrl} สำเร็จ`);
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
      {/* Sub-Navigation Header */}
      <div className="rounded-lg bg-white border border-slate-200 p-4 sm:p-5 space-y-4 shadow-2xs">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-100">
          <div>
            <h3 className="text-sm sm:text-base font-bold text-slate-900">
              สตูดิโอตัดต่อวิดีโอหลายฉาก (Multi-Scene Flow) & ห้องปฏิบัติการสื่อ
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              วางโครงเรื่องรายฉาก สร้างภาพต้นฉาก-ท้ายฉาก เรนเดอร์วิดีโอ และรวมเสียงบรรยายด้วย FFmpeg
            </p>
          </div>
          <button
            type="button"
            onClick={onOpenSettings}
            className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer shrink-0"
          >
            <KeyRound className="w-3.5 h-3.5 text-slate-500" />
            ตั้งค่า API ({activeKeyCount}/4 ค่าย)
          </button>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setSubTab('flow')}
            className={`inline-flex items-center gap-1.5 rounded-md px-3.5 py-2 text-xs font-semibold border transition cursor-pointer ${
              subTab === 'flow'
                ? 'bg-slate-900 text-white border-slate-900'
                : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
            }`}
          >
            <Clapperboard className="w-3.5 h-3.5 text-amber-400" />
            1. สตอรีบอร์ดและตัดต่อหลายฉาก
          </button>
          <button
            type="button"
            onClick={() => setSubTab('direct_media')}
            className={`inline-flex items-center gap-1.5 rounded-md px-3.5 py-2 text-xs font-semibold border transition cursor-pointer ${
              subTab === 'direct_media'
                ? 'bg-slate-900 text-white border-slate-900'
                : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
            }`}
          >
            <Film className="w-3.5 h-3.5 text-amber-400" />
            2. สร้างวิดีโอ ภาพ และเสียงบรรยายโดยตรง
          </button>
          <button
            type="button"
            onClick={() => setSubTab('chat')}
            className={`inline-flex items-center gap-1.5 rounded-md px-3.5 py-2 text-xs font-semibold border transition cursor-pointer ${
              subTab === 'chat'
                ? 'bg-slate-900 text-white border-slate-900'
                : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
            }`}
          >
            <Bot className="w-3.5 h-3.5 text-amber-400" />
            3. เปรียบเทียบผลลัพธ์ 4 โมเดล (Multi-LLM Arena)
          </button>
        </div>
      </div>

      {/* Notifications */}
      {errorBanner && (
        <div className="rounded-lg bg-rose-50 border border-rose-200 p-3.5 text-xs font-medium text-rose-900 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
            <span>{errorBanner}</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onOpenSettings}
              className="rounded bg-rose-700 px-2.5 py-1 text-white font-semibold hover:bg-rose-800 cursor-pointer"
            >
              ตั้งค่า API Keys
            </button>
            <button
              type="button"
              onClick={() => setErrorBanner(null)}
              className="text-rose-700 font-semibold cursor-pointer"
            >
              ปิด
            </button>
          </div>
        </div>
      )}

      {successBanner && (
        <div className="rounded-lg bg-emerald-50 border border-emerald-200 p-3.5 text-xs font-medium text-emerald-900 flex items-center justify-between">
          <span className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            {successBanner}
          </span>
          <button
            type="button"
            onClick={() => setSuccessBanner(null)}
            className="text-emerald-700 font-semibold cursor-pointer"
          >
            ปิด
          </button>
        </div>
      )}

      {/* TAB 1: MULTI-SCENE FILMMAKING */}
      {subTab === 'flow' && (
        <div className="space-y-5">
          <form
            onSubmit={handleCreateFlowProject}
            className="rounded-lg bg-white border border-slate-200 p-5 shadow-2xs space-y-4"
          >
            <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500 border-b border-slate-100 pb-2.5">
              สร้างโปรเจกต์สตอรีบอร์ดวิดีโอใหม่
            </h4>

            <div className="grid grid-cols-1 md:grid-cols-12 gap-3.5">
              <div className="md:col-span-5">
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  ชื่อโปรเจกต์วิดีโอ <span className="text-rose-600">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={flowTitle}
                  onChange={(e) => setFlowTitle(e.target.value)}
                  placeholder="เช่น การประยุกต์ใช้ AI ในห้องเรียนยุคใหม่"
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-xs sm:text-sm focus:border-slate-900 focus:outline-none"
                />
              </div>
              <div className="md:col-span-7">
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  แนวคิดเรื่องราว / ประเด็นหลัก <span className="text-rose-600">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={flowConcept}
                  onChange={(e) => setFlowConcept(e.target.value)}
                  placeholder="ระบุโครงเรื่องเพื่อให้ AI แบ่งฉากและเขียนบทบรรยาย"
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-xs sm:text-sm focus:border-slate-900 focus:outline-none"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 items-end">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  โมเดลวิดีโอ
                </label>
                <select
                  value={flowEngine}
                  onChange={(e) => setFlowEngine(e.target.value)}
                  className="w-full rounded-md border border-slate-300 bg-white px-2.5 py-2 text-xs font-medium"
                >
                  <option value="">อัตโนมัติ (รุ่นล่าสุดจาก API)</option>
                  {combinedLiveVideoModels.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  จำนวนฉาก
                </label>
                <select
                  value={flowScenesCount}
                  onChange={(e) => setFlowScenesCount(Number(e.target.value))}
                  className="w-full rounded-md border border-slate-300 bg-white px-2.5 py-2 text-xs font-medium"
                >
                  <option value={2}>2 ฉาก (~12 วินาที)</option>
                  <option value={3}>3 ฉาก (~18 วินาที)</option>
                  <option value={4}>4 ฉาก (~24 วินาที)</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  สัดส่วนวิดีโอ
                </label>
                <select
                  value={flowAspect}
                  onChange={(e) => setFlowAspect(e.target.value as any)}
                  className="w-full rounded-md border border-slate-300 bg-white px-2.5 py-2 text-xs font-medium"
                >
                  <option value="16:9">16:9 แนวนอน</option>
                  <option value="9:16">9:16 แนวตั้ง</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  ความละเอียด
                </label>
                <select
                  value={flowRes}
                  onChange={(e) => setFlowRes(e.target.value as any)}
                  className="w-full rounded-md border border-slate-300 bg-white px-2.5 py-2 text-xs font-medium"
                >
                  <option value="720p">720p HD</option>
                  <option value="1080p">1080p Full HD</option>
                  <option value="4k">4K Ultra HD</option>
                </select>
              </div>

              <button
                type="submit"
                disabled={creatingFlow}
                className="inline-flex items-center justify-center gap-1.5 rounded-md bg-slate-900 py-2 px-4 text-xs font-semibold text-white hover:bg-slate-800 transition cursor-pointer disabled:opacity-60"
              >
                {creatingFlow ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    กำลังสร้างฉาก...
                  </>
                ) : (
                  <>
                    <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                    สร้างสตอรีบอร์ด
                  </>
                )}
              </button>
            </div>
          </form>

          {flowProjects.length > 0 && (
            <div className="grid grid-cols-1 xl:grid-cols-12 gap-5 items-start">
              <div className="xl:col-span-3 rounded-lg bg-white border border-slate-200 p-4 space-y-2.5 shadow-2xs">
                <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500 pb-1 border-b border-slate-100">
                  รายการโปรเจกต์ ({flowProjects.length})
                </h4>
                {flowProjects.map((fp) => (
                  <div
                    key={fp.id}
                    onClick={() => setSelectedFlowId(fp.id)}
                    className={`rounded-md border p-3 cursor-pointer transition ${
                      activeFlow?.id === fp.id
                        ? 'border-slate-900 bg-slate-50'
                        : 'border-slate-200 hover:bg-slate-50/60'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[10px] font-semibold text-slate-600 bg-slate-100 rounded px-1.5 py-0.5">
                        {fp.aspectRatio} • {fp.resolution}
                      </span>
                      <button
                        type="button"
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
                    <div className="mt-1.5 text-xs font-semibold text-slate-900 line-clamp-2">
                      {fp.title}
                    </div>
                    <div className="mt-0.5 text-[11px] text-slate-500 truncate">
                      {fp.videoEngine}
                    </div>
                  </div>
                ))}
              </div>

              {activeFlow && (
                <div className="xl:col-span-9 space-y-4">
                  <div className="rounded-lg bg-white border border-slate-200 p-5 shadow-2xs space-y-4">
                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 pb-3 border-b border-slate-100">
                      <div>
                        <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                          PROJECT #{activeFlow.id} • {activeFlow.videoEngine}
                        </span>
                        <h3 className="text-base font-bold text-slate-900 mt-0.5">
                          {activeFlow.title}
                        </h3>
                        <p className="text-xs text-slate-600">{activeFlow.concept}</p>
                      </div>

                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => handleGenerateFlowVoiceover(activeFlow.id)}
                          disabled={generatingFlowVo}
                          className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer disabled:opacity-50"
                        >
                          <Mic className="w-3.5 h-3.5 text-amber-600" />
                          {generatingFlowVo
                            ? 'กำลังสังเคราะห์เสียง...'
                            : '1. สร้างเสียงบรรยายรวม'}
                        </button>
                        <button
                          type="button"
                          onClick={() => handleAssembleMasterFilm(activeFlow.id)}
                          disabled={assemblingFlow}
                          className="inline-flex items-center gap-1.5 rounded-md bg-emerald-600 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-700 cursor-pointer disabled:opacity-50"
                        >
                          <Layers className="w-3.5 h-3.5" />
                          {assemblingFlow
                            ? 'กำลังตัดต่อด้วย FFmpeg...'
                            : '2. รวมทุกฉากเป็น Master .MP4'}
                        </button>
                        <button
                          type="button"
                          onClick={() => handlePublishFlowVideoToWebsite(activeFlow)}
                          className="inline-flex items-center gap-1.5 rounded-md bg-slate-900 px-3 py-2 text-xs font-semibold text-white hover:bg-slate-800 cursor-pointer"
                        >
                          <FilePlus2 className="w-3.5 h-3.5 text-amber-400" />
                          เผยแพร่ขึ้นหน้าเว็บ
                        </button>
                      </div>
                    </div>

                    {(activeFlow.voiceoverAudioUrl || activeFlow.masterVideoUrl) && (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {activeFlow.voiceoverAudioUrl && (
                          <div className="rounded-md bg-slate-50 border border-slate-200 p-3">
                            <div className="text-xs font-semibold text-slate-800 mb-1.5">
                              ไฟล์เสียงบรรยายรวมทุกฉาก
                            </div>
                            <audio
                              controls
                              src={activeFlow.voiceoverAudioUrl}
                              className="w-full h-9"
                            />
                          </div>
                        )}
                        {activeFlow.masterVideoUrl && (
                          <div className="rounded-md bg-slate-50 border border-slate-200 p-3">
                            <div className="flex items-center justify-between mb-1.5">
                              <span className="text-xs font-semibold text-slate-800">
                                วิดีโอฉบับสมบูรณ์ (Master .MP4)
                              </span>
                              <a
                                href={activeFlow.masterVideoUrl}
                                download
                                className="inline-flex items-center gap-1 text-xs font-semibold text-slate-700 hover:underline"
                              >
                                <Download className="w-3.5 h-3.5" /> ดาวน์โหลด
                              </a>
                            </div>
                            <video
                              controls
                              src={activeFlow.masterVideoUrl}
                              className="w-full rounded bg-black max-h-56"
                            />
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Scene Breakdown */}
                  <div className="space-y-3.5">
                    {activeFlow.scenes.map((sc, idx) => (
                      <div
                        key={sc.id || idx}
                        className="rounded-lg bg-white border border-slate-200 p-4 sm:p-5 shadow-2xs space-y-3.5"
                      >
                        <div className="flex items-center gap-2 border-b border-slate-100 pb-2.5">
                          <span className="rounded bg-slate-900 px-2.5 py-0.5 text-[11px] font-semibold text-white">
                            ฉากที่ {sc.sceneNumber} ({sc.durationSec} วินาที)
                          </span>
                          <h4 className="font-bold text-xs sm:text-sm text-slate-900">
                            {sc.title}
                          </h4>
                        </div>

                        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                          {/* First Frame */}
                          <div className="rounded-md border border-slate-200 p-3 space-y-2 bg-slate-50/50">
                            <div className="text-xs font-semibold text-slate-800">
                              1. ภาพต้นฉาก (First Frame)
                            </div>
                            {sc.firstFrameUrl ? (
                              <img
                                src={sc.firstFrameUrl}
                                alt="First frame"
                                className="w-full h-36 object-cover rounded border border-slate-200 bg-slate-900"
                              />
                            ) : (
                              <div className="h-36 rounded border border-dashed border-slate-300 flex items-center justify-center text-xs text-slate-400">
                                ยังไม่มีภาพต้นฉาก
                              </div>
                            )}
                            <textarea
                              rows={2}
                              value={sc.firstFramePrompt}
                              onChange={(e) => {
                                const next = [...activeFlow.scenes];
                                next[idx] = {
                                  ...sc,
                                  firstFramePrompt: e.target.value,
                                };
                                setFlowProjects((prev) =>
                                  prev.map((p) =>
                                    p.id === activeFlow.id
                                      ? { ...p, scenes: next }
                                      : p
                                  )
                                );
                              }}
                              className="w-full rounded border border-slate-300 bg-white p-2 text-xs"
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
                                className="flex-1 rounded bg-slate-900 py-1.5 text-xs font-semibold text-white hover:bg-slate-800 cursor-pointer disabled:opacity-50"
                              >
                                {busySceneKey === `frame-${idx}-first`
                                  ? 'กำลังสร้างภาพ...'
                                  : 'สร้างภาพต้นฉาก'}
                              </button>
                              <label className="rounded border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 cursor-pointer hover:bg-slate-50">
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
                                    const up = await api.updateFlowProject(
                                      activeFlow.id,
                                      { scenes: next }
                                    );
                                    setFlowProjects((prev) =>
                                      prev.map((p) => (p.id === up.id ? up : p))
                                    );
                                  }}
                                />
                              </label>
                            </div>
                          </div>

                          {/* Last Frame */}
                          <div className="rounded-md border border-slate-200 p-3 space-y-2 bg-slate-50/50">
                            <div className="text-xs font-semibold text-slate-800">
                              2. ภาพท้ายฉาก (Last Frame • ไม่บังคับ)
                            </div>
                            {sc.lastFrameUrl ? (
                              <img
                                src={sc.lastFrameUrl}
                                alt="Last frame"
                                className="w-full h-36 object-cover rounded border border-slate-200 bg-slate-900"
                              />
                            ) : (
                              <div className="h-36 rounded border border-dashed border-slate-300 flex items-center justify-center text-xs text-slate-400 text-center px-2">
                                กำหนดภาพท้ายฉากสำหรับการเปลี่ยนฉากแบบต่อเนื่อง
                              </div>
                            )}
                            <textarea
                              rows={2}
                              value={sc.lastFramePrompt}
                              onChange={(e) => {
                                const next = [...activeFlow.scenes];
                                next[idx] = {
                                  ...sc,
                                  lastFramePrompt: e.target.value,
                                };
                                setFlowProjects((prev) =>
                                  prev.map((p) =>
                                    p.id === activeFlow.id
                                      ? { ...p, scenes: next }
                                      : p
                                  )
                                );
                              }}
                              className="w-full rounded border border-slate-300 bg-white p-2 text-xs"
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
                              className="w-full rounded border border-slate-300 bg-white py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer disabled:opacity-50"
                            >
                              {busySceneKey === `frame-${idx}-last`
                                ? 'กำลังสร้างภาพ...'
                                : 'สร้างภาพท้ายฉาก'}
                            </button>
                          </div>

                          {/* Scene Video Clip */}
                          <div className="rounded-md border border-slate-200 p-3 space-y-2 bg-slate-50/50">
                            <div className="flex items-center justify-between">
                              <span className="text-xs font-semibold text-slate-800">
                                3. วิดีโอประจำฉาก (.MP4)
                              </span>
                              {sc.videoClipUrl && (
                                <a
                                  href={sc.videoClipUrl}
                                  download
                                  className="text-xs font-semibold text-slate-700 hover:underline"
                                >
                                  ดาวน์โหลด
                                </a>
                              )}
                            </div>

                            {sc.videoClipUrl ? (
                              <video
                                controls
                                src={sc.videoClipUrl}
                                className="w-full h-36 rounded bg-black object-contain"
                              />
                            ) : (
                              <div className="h-36 rounded border border-dashed border-slate-300 bg-white flex items-center justify-center text-xs text-slate-400 text-center px-3">
                                พร้อมเรนเดอร์คลิปวิดีโอสำหรับฉากนี้
                              </div>
                            )}

                            <textarea
                              rows={2}
                              value={sc.videoMotionPrompt}
                              onChange={(e) => {
                                const next = [...activeFlow.scenes];
                                next[idx] = {
                                  ...sc,
                                  videoMotionPrompt: e.target.value,
                                };
                                setFlowProjects((prev) =>
                                  prev.map((p) =>
                                    p.id === activeFlow.id
                                      ? { ...p, scenes: next }
                                      : p
                                  )
                                );
                              }}
                              className="w-full rounded border border-slate-300 bg-white p-2 text-xs"
                            />

                            <div className="flex flex-wrap gap-1.5">
                              <button
                                type="button"
                                disabled={Boolean(
                                  busySceneKey?.startsWith(`video-${idx}`)
                                )}
                                onClick={() =>
                                  handleRenderSceneVideo(
                                    activeFlow.id,
                                    idx,
                                    sc.firstFrameUrl ? 'keyframes' : 'text_only',
                                    sc.videoMotionPrompt
                                  )
                                }
                                className="flex-1 rounded bg-slate-900 py-1.5 px-2 text-xs font-semibold text-white hover:bg-slate-800 cursor-pointer disabled:opacity-50"
                              >
                                {busySceneKey === `video-${idx}-keyframes` ||
                                busySceneKey === `video-${idx}-text_only`
                                  ? 'กำลังเรนเดอร์...'
                                  : sc.firstFrameUrl
                                  ? 'เรนเดอร์จากภาพต้นฉาก'
                                  : 'เรนเดอร์จากข้อความ'}
                              </button>

                              {idx > 0 &&
                                activeFlow.scenes[idx - 1]?.videoClipUrl && (
                                  <button
                                    type="button"
                                    disabled={Boolean(
                                      busySceneKey?.startsWith(`video-${idx}`)
                                    )}
                                    onClick={() =>
                                      handleRenderSceneVideo(
                                        activeFlow.id,
                                        idx,
                                        'extend_prev',
                                        sc.videoMotionPrompt
                                      )
                                    }
                                    className="rounded border border-slate-300 bg-white py-1.5 px-2.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer disabled:opacity-50"
                                  >
                                    ต่อเนื่องฉากก่อน
                                  </button>
                                )}
                            </div>
                          </div>
                        </div>

                        <div className="text-xs text-slate-600 bg-slate-50 rounded-md px-3 py-2 border border-slate-200">
                          <strong className="text-slate-800">บทบรรยายประจำฉาก:</strong>{' '}
                          {sc.narrationThai}
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

      {/* TAB 2: DIRECT MEDIA GENERATION */}
      {subTab === 'direct_media' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          {/* Video Generator */}
          <form
            onSubmit={handleDirectVideoGen}
            className="rounded-lg bg-white border border-slate-200 p-5 shadow-2xs space-y-3"
          >
            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-500 border-b border-slate-100 pb-2.5">
              <Film className="w-4 h-4 text-slate-700" />
              สร้างไฟล์วิดีโอ (.MP4)
            </div>
            <select
              value={directVidEngine}
              onChange={(e) => setDirectVidEngine(e.target.value)}
              className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-medium"
            >
              <option value="">อัตโนมัติ (รุ่นล่าสุดจาก API)</option>
              {combinedLiveVideoModels.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
            <textarea
              rows={3}
              required
              value={directVidPrompt}
              onChange={(e) => setDirectVidPrompt(e.target.value)}
              placeholder="ระบุคำอธิบายฉากวิดีโอ..."
              className="w-full rounded-md border border-slate-300 p-2.5 text-xs"
            />
            <div className="grid grid-cols-3 gap-2">
              <select
                value={directVidAspect}
                onChange={(e) => setDirectVidAspect(e.target.value as any)}
                className="rounded-md border border-slate-300 bg-white px-2 py-1.5 text-xs"
              >
                <option value="16:9">16:9</option>
                <option value="9:16">9:16</option>
              </select>
              <select
                value={directVidRes}
                onChange={(e) => setDirectVidRes(e.target.value as any)}
                className="rounded-md border border-slate-300 bg-white px-2 py-1.5 text-xs"
              >
                <option value="720p">720p</option>
                <option value="1080p">1080p</option>
                <option value="4k">4K</option>
              </select>
              <select
                value={directVidDuration}
                onChange={(e) => setDirectVidDuration(Number(e.target.value))}
                className="rounded-md border border-slate-300 bg-white px-2 py-1.5 text-xs"
              >
                <option value={5}>5 วินาที</option>
                <option value={6}>6 วินาที</option>
                <option value={8}>8 วินาที</option>
              </select>
            </div>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <input
                type="text"
                value={directFirstFrame}
                onChange={(e) => setDirectFirstFrame(e.target.value)}
                placeholder="URL ภาพต้นฉาก (ถ้ามี)"
                className="rounded-md border border-slate-300 px-2.5 py-1.5"
              />
              <input
                type="text"
                value={directLastFrame}
                onChange={(e) => setDirectLastFrame(e.target.value)}
                placeholder="URL ภาพท้ายฉาก (ถ้ามี)"
                className="rounded-md border border-slate-300 px-2.5 py-1.5"
              />
            </div>
            <button
              type="submit"
              disabled={directVidLoading}
              className="w-full rounded-md bg-slate-900 py-2.5 text-xs font-semibold text-white hover:bg-slate-800 cursor-pointer disabled:opacity-50"
            >
              {directVidLoading ? 'กำลังเรนเดอร์วิดีโอ...' : 'ดำเนินการสร้างวิดีโอ'}
            </button>
          </form>

          {/* Image Generator */}
          <form
            onSubmit={handleDirectImageGen}
            className="rounded-lg bg-white border border-slate-200 p-5 shadow-2xs space-y-3"
          >
            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-500 border-b border-slate-100 pb-2.5">
              <ImageIcon className="w-4 h-4 text-slate-700" />
              สร้างไฟล์ภาพนิ่ง (.PNG)
            </div>
            <div className="grid grid-cols-2 gap-2">
              <select
                value={directImgProvider}
                onChange={(e) => {
                  const p = e.target.value as 'gemini' | 'openai';
                  setDirectImgProvider(p);
                  setDirectImgModel('');
                }}
                className="rounded-md border border-slate-300 bg-white px-2.5 py-2 text-xs font-medium"
              >
                <option value="gemini">Google Gemini Image</option>
                <option value="openai">OpenAI Images</option>
              </select>
              <select
                value={directImgModel}
                onChange={(e) => setDirectImgModel(e.target.value)}
                className="rounded-md border border-slate-300 bg-white px-2.5 py-2 text-xs font-medium"
              >
                <option value="">อัตโนมัติ (รุ่นล่าสุด)</option>
                {(
                  liveModels?.providers?.[directImgProvider]?.imageModels || []
                ).map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                  </option>
                ))}
              </select>
            </div>
            <textarea
              rows={4}
              required
              value={directImgPrompt}
              onChange={(e) => setDirectImgPrompt(e.target.value)}
              placeholder="ระบุคำอธิบายภาพ..."
              className="w-full rounded-md border border-slate-300 p-2.5 text-xs"
            />
            <select
              value={directImgAspect}
              onChange={(e) => setDirectImgAspect(e.target.value as any)}
              className="w-full rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs"
            >
              <option value="16:9">16:9 แนวนอน</option>
              <option value="1:1">1:1 จัตุรัส</option>
              <option value="9:16">9:16 แนวตั้ง</option>
            </select>
            <button
              type="submit"
              disabled={directImgLoading}
              className="w-full rounded-md bg-slate-900 py-2.5 text-xs font-semibold text-white hover:bg-slate-800 cursor-pointer disabled:opacity-50"
            >
              {directImgLoading ? 'กำลังสร้างไฟล์ภาพ...' : 'ดำเนินการสร้างรูปภาพ'}
            </button>
          </form>

          {/* Audio TTS Generator */}
          <form
            onSubmit={handleDirectTtsGen}
            className="rounded-lg bg-white border border-slate-200 p-5 shadow-2xs space-y-3"
          >
            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-500 border-b border-slate-100 pb-2.5">
              <Mic className="w-4 h-4 text-slate-700" />
              สังเคราะห์เสียงบรรยาย (TTS)
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
                className="rounded-md border border-slate-300 bg-white px-2.5 py-2 text-xs font-medium"
              >
                <option value="gemini">Google Gemini TTS</option>
                <option value="elevenlabs">ElevenLabs TTS</option>
                <option value="openai">OpenAI TTS</option>
              </select>
              <input
                type="text"
                value={directTtsVoice}
                onChange={(e) => setDirectTtsVoice(e.target.value)}
                placeholder="ชื่อเสียง (เช่น Kore)"
                className="rounded-md border border-slate-300 px-2.5 py-2 text-xs"
              />
            </div>
            <textarea
              rows={5}
              required
              value={directTtsText}
              onChange={(e) => setDirectTtsText(e.target.value)}
              placeholder="พิมพ์บทบรรยายภาษาไทยหรือภาษาอังกฤษ..."
              className="w-full rounded-md border border-slate-300 p-2.5 text-xs"
            />
            <button
              type="submit"
              disabled={directTtsLoading}
              className="w-full rounded-md bg-slate-900 py-2.5 text-xs font-semibold text-white hover:bg-slate-800 cursor-pointer disabled:opacity-50"
            >
              {directTtsLoading ? 'กำลังสังเคราะห์เสียง...' : 'สร้างไฟล์เสียงบรรยาย'}
            </button>
          </form>
        </div>
      )}

      {/* TAB 3: MULTI-LLM ARENA */}
      {subTab === 'chat' && (
        <div className="space-y-4">
          <div className="rounded-lg bg-white border border-slate-200 p-4 shadow-2xs flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-1.5">
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
                    type="button"
                    onClick={() => setChatProvider(p.id)}
                    className={`inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-xs font-semibold border transition cursor-pointer ${
                      active
                        ? 'bg-slate-900 text-white border-slate-900'
                        : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                    }`}
                  >
                    <span
                      className={`h-1.5 w-1.5 rounded-full ${
                        hasKey ? 'bg-emerald-500' : 'bg-slate-300'
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
                className="rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-800"
              >
                <option value="">อัตโนมัติ (รุ่นล่าสุดจาก API)</option>
                {(liveModels?.providers?.[chatProvider]?.textModels || []).map(
                  (m) => (
                    <option key={m.id} value={m.id}>
                      {m.label}
                    </option>
                  )
                )}
              </select>

              <label className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={useKb}
                  onChange={(e) => setUseKb(e.target.checked)}
                  className="accent-slate-900"
                />
                อ้างอิงคลังความรู้ (RAG)
              </label>

              <button
                type="button"
                onClick={async () => {
                  await api.clearChatHistory(sessionId);
                  setChatMessages([]);
                  setArenaResults([]);
                }}
                className="rounded-md border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:text-rose-600 cursor-pointer"
              >
                ล้างประวัติ
              </button>
            </div>
          </div>

          {arenaResults.length > 0 && (
            <div className="rounded-lg bg-white border border-slate-200 p-4 space-y-3 shadow-2xs">
              <div className="flex items-center justify-between border-b border-slate-100 pb-2.5">
                <span className="text-xs font-bold text-slate-900 flex items-center gap-1.5">
                  <BrainCircuit className="w-4 h-4 text-amber-600" />
                  ผลการเปรียบเทียบคำตอบจาก 4 ผู้ให้บริการ
                </span>
                <button
                  type="button"
                  onClick={() => setArenaResults([])}
                  className="text-xs text-slate-500 hover:text-slate-800 cursor-pointer"
                >
                  ซ่อนตารางเปรียบเทียบ
                </button>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {arenaResults.map((ar, i) => (
                  <div
                    key={i}
                    className="rounded-md bg-slate-50 border border-slate-200 p-3.5 space-y-2"
                  >
                    <div className="flex items-center justify-between text-xs font-semibold text-slate-900">
                      <span>{ar.engineLabel}</span>
                      {ar.latencyMs && (
                        <span className="text-[11px] text-slate-500">
                          {ar.latencyMs} ms
                        </span>
                      )}
                    </div>
                    {ar.error ? (
                      <div className="text-xs text-rose-600">{ar.error}</div>
                    ) : (
                      <>
                        <div className="text-xs text-slate-700 whitespace-pre-wrap max-h-56 overflow-y-auto leading-relaxed">
                          {ar.reply}
                        </div>
                        <button
                          type="button"
                          onClick={() =>
                            handlePublishTextToCrud(ar.reply, ar.engineLabel)
                          }
                          className="rounded bg-slate-900 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-slate-800 cursor-pointer"
                        >
                          นำไปสร้างเนื้อหาบนเว็บไซต์
                        </button>
                      </>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="rounded-lg bg-white border border-slate-200 shadow-2xs overflow-hidden flex flex-col h-[500px]">
            <div className="flex-1 overflow-y-auto p-4 space-y-3.5">
              {chatMessages.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-center text-slate-400 space-y-1.5">
                  <Bot className="w-8 h-8 text-slate-300" />
                  <div className="text-xs font-semibold text-slate-700">
                    พร้อมทดสอบคำสั่งกับ{' '}
                    {CHAT_PROVIDERS.find((p) => p.id === chatProvider)?.name}
                  </div>
                  <p className="text-xs text-slate-500 max-w-md">
                    พิมพ์คำสั่งด้านล่างเพื่อสนทนากับโมเดลที่เลือก หรือกดปุ่มเปรียบเทียบ 4 โมเดลพร้อมกัน
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
                      className={`max-w-3xl rounded-lg px-4 py-3 text-xs sm:text-sm ${
                        m.role === 'user'
                          ? 'bg-slate-900 text-white'
                          : 'bg-slate-50 border border-slate-200 text-slate-800'
                      }`}
                    >
                      {m.role === 'assistant' && (
                        <div className="flex items-center justify-between gap-4 mb-1.5 text-[11px] font-semibold text-slate-500">
                          <span>
                            {m.provider.toUpperCase()} ({m.model})
                          </span>
                          {m.latencyMs ? <span>{m.latencyMs} ms</span> : null}
                        </div>
                      )}
                      {m.role === 'assistant' ? (
                        <div>{renderRichMarkdown(m.content)}</div>
                      ) : (
                        <div className="whitespace-pre-wrap">{m.content}</div>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>

            <form
              onSubmit={handleSendChat}
              className="border-t border-slate-200 bg-slate-50 p-3 flex flex-col sm:flex-row gap-2"
            >
              <input
                type="text"
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                placeholder="พิมพ์คำถามหรือหัวข้อที่ต้องการวิเคราะห์..."
                className="flex-1 rounded-md border border-slate-300 bg-white px-3.5 py-2 text-xs sm:text-sm focus:border-slate-900 focus:outline-none"
              />
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={arenaRunning || chatSending}
                  onClick={handleRun4ModelArena}
                  className="inline-flex items-center justify-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer disabled:opacity-50"
                >
                  <Wand2 className="w-3.5 h-3.5 text-amber-600" />
                  {arenaRunning ? 'กำลังเปรียบเทียบ...' : 'เปรียบเทียบ 4 โมเดล'}
                </button>
                <button
                  type="submit"
                  disabled={chatSending || arenaRunning}
                  className="inline-flex items-center justify-center gap-1.5 rounded-md bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800 cursor-pointer disabled:opacity-50"
                >
                  <Send className="w-3.5 h-3.5" />
                  {chatSending ? 'กำลังส่ง...' : 'ส่งคำสั่ง'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
