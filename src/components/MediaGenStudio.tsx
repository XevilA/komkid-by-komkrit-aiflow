import React, { useEffect, useRef, useState } from 'react';
import {
  Image as ImageIcon,
  Film,
  Sparkles,
  Wand2,
  CheckCircle2,
  Trash2,
  RefreshCw,
  Newspaper,
  Download,
  Eye,
  Upload,
  AlertTriangle,
  KeyRound,
  Clapperboard,
  X,
  MessageSquare,
} from 'lucide-react';
import {
  AiEngineSettings,
  AiMediaAsset,
  Post,
} from '../types';
import { api, formatThaiDate } from '../api';
import { MediaAgentHandoff } from './AiChatStudio';
import { FlowAndChatStudio } from './FlowAndChatStudio';

interface Props {
  incomingHandoff?: MediaAgentHandoff | null;
  onClearHandoff?: () => void;
  onRefreshAll: () => Promise<void>;
  onOpenSettings: () => void;
  onPreviewPost: (postId: number) => void;
  onOpenInPostEditor: (draft: Partial<Post>) => void;
  onGoToChat: () => void;
}

export const MediaGenStudio: React.FC<Props> = ({
  incomingHandoff,
  onClearHandoff,
  onRefreshAll,
  onOpenSettings,
  onPreviewPost,
  onOpenInPostEditor,
  onGoToChat,
}) => {
  const [activeTab, setActiveTab] = useState<'image' | 'video' | 'flow'>('image');
  const [settings, setSettings] = useState<AiEngineSettings | null>(null);
  const [assets, setAssets] = useState<AiMediaAsset[]>([]);
  const [galleryFilter, setGalleryFilter] = useState<'all' | 'image' | 'video'>('all');

  const [errorBanner, setErrorBanner] = useState<string | null>(null);
  const [successBanner, setSuccessBanner] = useState<string | null>(null);

  // ---------------- SHARED AI PROMPT EVALUATOR STATE ----------------
  const [ideaBrief, setIdeaBrief] = useState('');
  const [evaluating, setEvaluating] = useState(false);
  const [assessmentThai, setAssessmentThai] = useState('');
  const [thaiSummary, setThaiSummary] = useState('');
  const [suggestedTitle, setSuggestedTitle] = useState('');

  // ---------------- IMAGE AGENT STATE ----------------
  const [imgFullPrompt, setImgFullPrompt] = useState('');
  const [imgProvider, setImgProvider] = useState<'gemini' | 'openai'>('gemini');
  const [imgAspect, setImgAspect] = useState<'16:9' | '1:1' | '9:16'>('16:9');
  const [imgGenerating, setImgGenerating] = useState(false);

  // ---------------- VIDEO AGENT STATE ----------------
  const [vidFullPrompt, setVidFullPrompt] = useState('');
  const [vidEngine, setVidEngine] = useState<
    | 'gemini-omni-1.1-flash'
    | 'veo-3.1-generate-001'
    | 'veo-3.1-fast-generate-001'
  >('gemini-omni-1.1-flash');
  const [vidAspect, setVidAspect] = useState<'16:9' | '9:16'>('16:9');
  const [vidDuration, setVidDuration] = useState<number>(6);
  const [vidFirstFrameUrl, setVidFirstFrameUrl] = useState<string>('');
  const [uploadingFrame, setUploadingFrame] = useState(false);
  const [vidGenerating, setVidGenerating] = useState(false);

  // ---------------- RECHECK & PREVIEW STATE ----------------
  const [activeRecheckAsset, setActiveRecheckAsset] = useState<AiMediaAsset | null>(null);
  const [zoomAsset, setZoomAsset] = useState<AiMediaAsset | null>(null);
  const [reviewBusyId, setReviewBusyId] = useState<number | null>(null);
  const [writingNewsForAssetId, setWritingNewsForAssetId] = useState<number | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);

  const recheckRef = useRef<HTMLDivElement | null>(null);

  const showToast = (msg: string) => {
    setSuccessBanner(msg);
    setTimeout(() => {
      setSuccessBanner((prev) => (prev === msg ? null : prev));
    }, 5000);
  };

  const loadData = async () => {
    try {
      const [st, ma] = await Promise.all([api.getAiSettings(), api.getMediaAssets()]);
      setSettings(st);
      setAssets(ma);
      // Auto-select default image provider based on configured key
      if (!st.hasGeminiKey && st.hasOpenaiKey) {
        setImgProvider('openai');
      }
      // Surface newest pending_review item if no active recheck item is open
      const newestPending = ma.find(
        (a) =>
          (a.mediaType === 'image' || a.mediaType === 'video') &&
          a.reviewStatus === 'pending_review'
      );
      if (newestPending && !activeRecheckAsset) {
        setActiveRecheckAsset(newestPending);
      }
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  // Receive Full Prompt Handoff from AI Chat Page!
  useEffect(() => {
    if (!incomingHandoff) return;
    setAssessmentThai(incomingHandoff.assessmentThai || '');
    setThaiSummary(incomingHandoff.thaiSummary || '');
    setSuggestedTitle(incomingHandoff.suggestedPostTitle || '');
    if (incomingHandoff.target === 'video') {
      setActiveTab('video');
      setVidFullPrompt(incomingHandoff.fullPrompt);
      setVidAspect(incomingHandoff.aspectRatio === '9:16' ? '9:16' : '16:9');
    } else {
      setActiveTab('image');
      setImgFullPrompt(incomingHandoff.fullPrompt);
      setImgAspect(incomingHandoff.aspectRatio || '16:9');
    }
    showToast('รับ Full Prompt จากห้องแชท AI เรียบร้อย! ตรวจสอบแล้วกดสั่ง Agent สร้างได้เลยครับ');
    onClearHandoff?.();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [incomingHandoff]);

  // Step 1: AI Evaluates Thai Brief & Writes Full Prompt
  const handleEvaluateBrief = async (target: 'image' | 'video') => {
    const currentPrompt = target === 'image' ? imgFullPrompt : vidFullPrompt;
    const textToEval = ideaBrief.trim() || currentPrompt.trim();
    if (!textToEval) {
      setErrorBanner('กรุณาพิมพ์บอกสิ่งที่อยากได้เป็นภาษาไทยสั้นๆ ในช่องที่ 1 ก่อนครับ');
      return;
    }
    setErrorBanner(null);
    setEvaluating(true);
    try {
      const res = await api.evaluateMediaPrompt({
        target,
        ideaText: textToEval,
        aspectRatio: target === 'image' ? imgAspect : vidAspect,
      });
      setAssessmentThai(res.assessmentThai);
      setThaiSummary(res.visualSummaryThai);
      setSuggestedTitle(res.suggestedPostTitle);
      if (target === 'image') {
        setImgFullPrompt(res.fullPrompt);
        setImgAspect(res.recommendedAspectRatio || '16:9');
      } else {
        setVidFullPrompt(res.fullPrompt);
        setVidAspect(res.recommendedAspectRatio === '9:16' ? '9:16' : '16:9');
      }
      showToast('AI ประเมินแนวคิดและเขียน Full Prompt ระดับมืออาชีพให้แล้ว!');
    } catch (err) {
      setErrorBanner((err as Error).message);
    } finally {
      setEvaluating(false);
    }
  };

  // Step 2A: Run Real Image Agent
  const handleGenerateImage = async () => {
    const finalPrompt = imgFullPrompt.trim() || ideaBrief.trim();
    if (!finalPrompt) {
      setErrorBanner('กรุณาใส่รายละเอียดภาพ หรือกดให้ AI เขียน Full Prompt ก่อนครับ');
      return;
    }
    setErrorBanner(null);
    setImgGenerating(true);
    try {
      const created = await api.generateRealImage({
        prompt: finalPrompt,
        provider: imgProvider,
        aspectRatio: imgAspect,
        thaiSummary: thaiSummary || ideaBrief.trim() || finalPrompt.slice(0, 100),
      });
      setActiveRecheckAsset(created);
      await loadData();
      await onRefreshAll();
      showToast('สร้างรูปภาพเสร็จแล้ว! กรุณาตรวจดูตัวอย่างด้านล่างว่าชอบหรือไม่');
      setTimeout(() => {
        recheckRef.current?.scrollIntoView({ behavior: 'smooth' });
      }, 150);
    } catch (err) {
      setErrorBanner((err as Error).message);
    } finally {
      setImgGenerating(false);
    }
  };

  // Step 2B: Run Real Video Agent
  const handleGenerateVideo = async () => {
    const finalPrompt = vidFullPrompt.trim() || ideaBrief.trim();
    if (!finalPrompt) {
      setErrorBanner('กรุณาใส่รายละเอียดวิดีโอ หรือกดให้ AI เขียน Full Prompt ก่อนครับ');
      return;
    }
    setErrorBanner(null);
    setVidGenerating(true);
    try {
      const created = await api.generateRealVideo({
        prompt: finalPrompt,
        engine: vidEngine,
        aspectRatio: vidAspect,
        durationSec: vidDuration,
        resolution: '720p',
        firstFrameUrl: vidFirstFrameUrl || undefined,
        thaiSummary: thaiSummary || ideaBrief.trim() || finalPrompt.slice(0, 100),
      });
      setActiveRecheckAsset(created);
      await loadData();
      await onRefreshAll();
      showToast('สร้างวิดีโอเสร็จแล้ว! กรุณาเปิดเล่นดูตัวอย่างด้านล่างว่าชอบหรือไม่');
      setTimeout(() => {
        recheckRef.current?.scrollIntoView({ behavior: 'smooth' });
      }, 150);
    } catch (err) {
      setErrorBanner((err as Error).message);
    } finally {
      setVidGenerating(false);
    }
  };

  const handleUploadFirstFrame = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingFrame(true);
    setErrorBanner(null);
    try {
      const url = await api.uploadImage(file);
      setVidFirstFrameUrl(url);
      showToast('อัปโหลดภาพต้นแบบสำหรับฉากเปิดวิดีโอเรียบร้อยแล้ว');
    } catch (err) {
      setErrorBanner((err as Error).message);
    } finally {
      setUploadingFrame(false);
    }
  };

  // Step 3: Recheck Preview Actions (Like/Approve, Write News with AI, Revise, Delete)
  const handleApproveAsset = async (asset: AiMediaAsset) => {
    setReviewBusyId(asset.id);
    setErrorBanner(null);
    try {
      await api.reviewMediaAsset(asset.id, 'approved');
      if (activeRecheckAsset?.id === asset.id) {
        setActiveRecheckAsset({ ...asset, reviewStatus: 'approved' });
      }
      await loadData();
      showToast('อนุมัติเก็บผลงานไว้ในคลังเรียบร้อยแล้ว!');
    } catch (err) {
      setErrorBanner((err as Error).message);
    } finally {
      setReviewBusyId(null);
    }
  };

  const handleDeleteAsset = async (asset: AiMediaAsset) => {
    setReviewBusyId(asset.id);
    setErrorBanner(null);
    try {
      await api.deleteMediaAsset(asset.id);
      if (activeRecheckAsset?.id === asset.id) {
        setActiveRecheckAsset(null);
      }
      if (zoomAsset?.id === asset.id) {
        setZoomAsset(null);
      }
      setConfirmDeleteId(null);
      await loadData();
      await onRefreshAll();
      showToast('ลบไฟล์ผลงานนี้ออกจากระบบถาวรเรียบร้อยแล้ว');
    } catch (err) {
      setErrorBanner((err as Error).message);
    } finally {
      setReviewBusyId(null);
    }
  };

  const handleSendAssetToPostEditor = async (asset: AiMediaAsset) => {
    if (asset.reviewStatus === 'pending_review') {
      await api.reviewMediaAsset(asset.id, 'approved').catch(() => {});
    }
    onOpenInPostEditor({
      title: suggestedTitle || asset.thaiSummary || '',
      coverImage:
        asset.mediaType === 'image' ? asset.fileUrl : '/images/thumb-ai-edu.jpg',
      videoUrl: asset.mediaType === 'video' ? asset.fileUrl : '',
      contentType: asset.mediaType === 'video' ? 'video' : 'news',
    });
  };

  const handleAiWriteNewsWithAsset = async (asset: AiMediaAsset) => {
    setWritingNewsForAssetId(asset.id);
    setErrorBanner(null);
    try {
      if (asset.reviewStatus === 'pending_review') {
        await api.reviewMediaAsset(asset.id, 'approved').catch(() => {});
      }
      const draft = await api.draftContentFromChat({
        ideaText:
          suggestedTitle ||
          asset.thaiSummary ||
          `เขียนข่าวและบทความให้ความรู้ประกอบสื่อหัวข้อ: ${asset.prompt}`,
        contentFormat: 'news',
      });
      onOpenInPostEditor({
        title: draft.title,
        subtitle: draft.subtitle,
        excerpt: draft.excerpt,
        content: draft.content,
        category: draft.category,
        contentType: asset.mediaType === 'video' ? 'video' : draft.contentType,
        coverImage:
          asset.mediaType === 'image' ? asset.fileUrl : '/images/thumb-ai-edu.jpg',
        videoUrl: asset.mediaType === 'video' ? asset.fileUrl : '',
        tags: draft.tags,
      });
    } catch (err) {
      setErrorBanner((err as Error).message);
    } finally {
      setWritingNewsForAssetId(null);
    }
  };

  const handleReviseFromAsset = (asset: AiMediaAsset) => {
    if (asset.mediaType === 'video') {
      setActiveTab('video');
      setVidFullPrompt(asset.prompt);
    } else {
      setActiveTab('image');
      setImgFullPrompt(asset.prompt);
    }
    setThaiSummary(asset.thaiSummary || '');
    window.scrollTo({ top: 0, behavior: 'smooth' });
    showToast('โหลด Full Prompt กลับมาให้แก้ไขด้านบนแล้วครับ ปรับข้อความแล้วกดสั่งสร้างใหม่ได้เลย');
  };

  const pendingReviewAssets = assets.filter(
    (a) =>
      (a.mediaType === 'image' || a.mediaType === 'video') &&
      a.reviewStatus === 'pending_review'
  );

  const approvedAssets = assets.filter((a) => {
    if (a.mediaType !== 'image' && a.mediaType !== 'video') return false;
    if (galleryFilter !== 'all' && a.mediaType !== galleryFilter) return false;
    return true;
  });

  const approvedImages = assets.filter((a) => a.mediaType === 'image');

  return (
    <div className="space-y-6">
      {/* Top Mode Switcher (3 Large Plain-Thai Buttons) */}
      <div className="rounded-3xl bg-white border border-slate-200 p-4 sm:p-5 shadow-xs space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-xl sm:text-2xl font-extrabold text-[#0d2546]">
              สตูดิโอสร้างรูปภาพ & วิดีโอ AI (พร้อมระบบตรวจดูตัวอย่างก่อนใช้งาน)
            </h2>
            <p className="text-sm sm:text-base text-slate-600">
              ให้ AI ช่วยประเมินและเขียน Full Prompt ระดับมืออาชีพ → สั่ง Agent สร้างจริง → ดูตัวอย่างว่าชอบไหม หรือลบทิ้งได้ทันที
            </p>
          </div>
          <button
            type="button"
            onClick={onGoToChat}
            className="inline-flex items-center gap-2 rounded-2xl border-2 border-[#0d2546] bg-slate-50 px-4 py-2.5 text-sm font-extrabold text-[#0d2546] hover:bg-amber-50 cursor-pointer"
          >
            <MessageSquare className="w-4 h-4" />
            ไปคุยปรึกษาไอเดียในหน้า AI Chat
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <button
            type="button"
            onClick={() => setActiveTab('image')}
            className={`flex items-center justify-center gap-2.5 rounded-2xl px-5 py-4 text-base font-extrabold border-2 transition cursor-pointer ${
              activeTab === 'image'
                ? 'bg-[#0d2546] text-white border-[#0d2546] shadow-sm'
                : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
            }`}
          >
            <ImageIcon className="w-5 h-5 text-amber-400" />
            1. สร้างรูปภาพ AI (Image Gen)
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('video')}
            className={`flex items-center justify-center gap-2.5 rounded-2xl px-5 py-4 text-base font-extrabold border-2 transition cursor-pointer ${
              activeTab === 'video'
                ? 'bg-[#0d2546] text-white border-[#0d2546] shadow-sm'
                : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
            }`}
          >
            <Film className="w-5 h-5 text-amber-400" />
            2. สร้างวิดีโอ AI (VDO Gen)
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('flow')}
            className={`flex items-center justify-center gap-2.5 rounded-2xl px-5 py-4 text-base font-extrabold border-2 transition cursor-pointer ${
              activeTab === 'flow'
                ? 'bg-[#0d2546] text-white border-[#0d2546] shadow-sm'
                : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
            }`}
          >
            <Clapperboard className="w-5 h-5 text-amber-400" />
            3. หนังสั้นหลายฉาก (Google Flow)
          </button>
        </div>
      </div>

      {/* Notifications */}
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
                className="inline-flex items-center gap-1.5 rounded-xl bg-rose-700 px-4 py-2 text-xs sm:text-sm font-extrabold text-white hover:bg-rose-800 cursor-pointer"
              >
                <KeyRound className="w-4 h-4" /> ตั้งค่าคีย์ AI
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

      {/* ===================================================================== */}
      {/* RECHECK & PREVIEW PANEL (SHOWN PROMINENTLY WHENEVER GENERATED!)       */}
      {/* ===================================================================== */}
      <div ref={recheckRef}>
        {activeRecheckAsset && (
          <div className="rounded-3xl border-4 border-emerald-500 bg-white p-5 sm:p-7 shadow-lg space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-100 px-3.5 py-1 text-xs font-extrabold text-emerald-900">
                  <Eye className="w-4 h-4" /> ตรวจดูตัวอย่างก่อนตัดสินใจ (Recheck & Preview)
                </span>
                <h3 className="text-xl sm:text-2xl font-extrabold text-[#0d2546] mt-1">
                  {activeRecheckAsset.mediaType === 'video'
                    ? '🎬 วิดีโอสร้างเสร็จแล้ว — ลองกดเล่นดูว่าชอบไหมครับ?'
                    : '🎨 รูปภาพสร้างเสร็จแล้ว — ตรวจดูความสวยงามว่าชอบไหมครับ?'}
                </h3>
              </div>

              <div className="flex items-center gap-2">
                {activeRecheckAsset.reviewStatus === 'approved' ? (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-600 px-4 py-1.5 text-sm font-extrabold text-white">
                    <CheckCircle2 className="w-4 h-4" /> เก็บไว้ในคลังแล้ว
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-100 px-4 py-1.5 text-sm font-extrabold text-amber-900">
                    รอคุณตัดสินใจ (ชอบ หรือ ลบทิ้ง)
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => setActiveRecheckAsset(null)}
                  className="rounded-xl bg-slate-100 px-3 py-2 text-sm font-bold text-slate-600 hover:bg-slate-200 cursor-pointer"
                >
                  ซ่อนหน้าต่างนี้
                </button>
              </div>
            </div>

            {/* Large Preview Stage */}
            <div className="rounded-2xl bg-slate-950 p-3 sm:p-4 flex items-center justify-center overflow-hidden">
              {activeRecheckAsset.mediaType === 'video' ? (
                <video
                  src={activeRecheckAsset.fileUrl}
                  controls
                  autoPlay
                  className="max-h-[480px] w-auto rounded-xl"
                />
              ) : (
                <img
                  src={activeRecheckAsset.fileUrl}
                  alt={activeRecheckAsset.thaiSummary || 'AI Generated Image'}
                  onClick={() => setZoomAsset(activeRecheckAsset)}
                  className="max-h-[480px] w-auto object-contain rounded-xl cursor-zoom-in"
                />
              )}
            </div>

            <div className="rounded-2xl bg-slate-50 border border-slate-200 p-4 space-y-1">
              {activeRecheckAsset.thaiSummary && (
                <div className="text-base font-extrabold text-[#0d2546]">
                  สรุปผลงาน: {activeRecheckAsset.thaiSummary}
                </div>
              )}
              <div className="text-xs sm:text-sm text-slate-600 line-clamp-2">
                Prompt ที่ใช้: {activeRecheckAsset.prompt}
              </div>
            </div>

            {/* Big Elder-Friendly Decision Buttons */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <button
                type="button"
                disabled={reviewBusyId === activeRecheckAsset.id}
                onClick={() => handleApproveAsset(activeRecheckAsset)}
                className="flex items-center justify-center gap-2 rounded-2xl bg-emerald-600 px-4 py-4 text-base font-extrabold text-white hover:bg-emerald-700 cursor-pointer shadow-sm disabled:opacity-50"
              >
                <CheckCircle2 className="w-5 h-5" />
                ชอบ! เก็บไว้ในคลัง
              </button>

              <button
                type="button"
                disabled={writingNewsForAssetId === activeRecheckAsset.id}
                onClick={() => handleAiWriteNewsWithAsset(activeRecheckAsset)}
                className="flex items-center justify-center gap-2 rounded-2xl bg-[#0d2546] px-4 py-4 text-base font-extrabold text-white hover:bg-[#163a6b] cursor-pointer shadow-sm disabled:opacity-50"
              >
                {writingNewsForAssetId === activeRecheckAsset.id ? (
                  <>
                    <RefreshCw className="w-5 h-5 animate-spin text-amber-300" />
                    AI กำลังเขียนข่าวให้...
                  </>
                ) : (
                  <>
                    <Newspaper className="w-5 h-5 text-amber-300" />
                    ชอบ! ให้ AI เขียนข่าวพร้อมรูป/คลิปนี้
                  </>
                )}
              </button>

              <button
                type="button"
                onClick={() => handleReviseFromAsset(activeRecheckAsset)}
                className="flex items-center justify-center gap-2 rounded-2xl border-2 border-amber-400 bg-amber-50 px-4 py-4 text-base font-extrabold text-amber-950 hover:bg-amber-100 cursor-pointer"
              >
                <RefreshCw className="w-5 h-5" />
                ปรับแก้ Prompt สร้างใหม่
              </button>

              <button
                type="button"
                disabled={reviewBusyId === activeRecheckAsset.id}
                onClick={() => handleDeleteAsset(activeRecheckAsset)}
                className="flex items-center justify-center gap-2 rounded-2xl border-2 border-rose-300 bg-rose-50 px-4 py-4 text-base font-extrabold text-rose-700 hover:bg-rose-600 hover:text-white transition cursor-pointer disabled:opacity-50"
              >
                <Trash2 className="w-5 h-5" />
                ไม่ชอบ — ลบทิ้งทันที
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Other Pending Review Queue Strip (if multiple items awaiting decision) */}
      {pendingReviewAssets.length > 1 && (
        <div className="rounded-2xl bg-amber-50 border border-amber-300 p-4 space-y-2.5">
          <div className="text-sm font-extrabold text-amber-950">
            ผลงานที่รอคุณตรวจดูว่าชอบหรือไม่ ({pendingReviewAssets.length} รายการ):
          </div>
          <div className="flex flex-wrap gap-2.5">
            {pendingReviewAssets.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setActiveRecheckAsset(item)}
                className={`inline-flex items-center gap-2 rounded-xl px-3.5 py-2 text-xs sm:text-sm font-extrabold border cursor-pointer ${
                  activeRecheckAsset?.id === item.id
                    ? 'bg-[#0d2546] text-white border-[#0d2546]'
                    : 'bg-white text-slate-800 border-amber-300 hover:bg-amber-100'
                }`}
              >
                {item.mediaType === 'video' ? (
                  <Film className="w-4 h-4" />
                ) : (
                  <ImageIcon className="w-4 h-4" />
                )}
                {item.thaiSummary?.slice(0, 35) || item.prompt.slice(0, 35)}...
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ===================================================================== */}
      {/* TAB 1: IMAGE GENERATOR (AI EVALUATOR + FULL PROMPT + REAL AGENT)      */}
      {/* ===================================================================== */}
      {activeTab === 'image' && (
        <div className="rounded-3xl bg-white border border-slate-200 p-5 sm:p-7 shadow-xs space-y-6">
          {/* Step 1 */}
          <div className="space-y-3">
            <div className="flex items-center gap-2.5">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[#0d2546] text-amber-300 font-extrabold text-sm">
                1
              </span>
              <h3 className="text-lg sm:text-xl font-extrabold text-[#0d2546]">
                บอกรูปภาพที่อยากได้ (พิมพ์ภาษาไทยง่ายๆ ได้เลย)
              </h3>
            </div>
            <div className="flex flex-col sm:flex-row gap-3">
              <input
                type="text"
                value={ideaBrief}
                onChange={(e) => setIdeaBrief(e.target.value)}
                placeholder="เช่น ภาพครูไทยยุคใหม่ใช้แท็บเล็ตสอนเด็กนักเรียนในห้องเรียนที่อบอุ่น ทันสมัย"
                className="flex-1 rounded-2xl border-2 border-slate-300 px-4 py-3.5 text-base text-slate-800 focus:border-[#0d2546] focus:outline-none"
              />
              <button
                type="button"
                onClick={() => handleEvaluateBrief('image')}
                disabled={evaluating}
                className="inline-flex items-center justify-center gap-2 rounded-2xl bg-amber-400 px-5 py-3.5 text-base font-extrabold text-[#0d2546] hover:bg-amber-300 transition cursor-pointer shrink-0 disabled:opacity-50"
              >
                {evaluating ? (
                  <>
                    <RefreshCw className="w-5 h-5 animate-spin" />
                    AI กำลังประเมิน...
                  </>
                ) : (
                  <>
                    <Wand2 className="w-5 h-5" />
                    ให้ AI ประเมิน & เขียน Full Prompt
                  </>
                )}
              </button>
            </div>
          </div>

          {/* AI Assessment Display */}
          {assessmentThai && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="rounded-2xl bg-amber-50/70 border border-amber-200 p-4">
                <div className="text-sm font-extrabold text-amber-950 mb-1">
                  💡 AI ประเมินแนวคิดภาพ:
                </div>
                <p className="text-sm sm:text-base text-slate-800 leading-relaxed">
                  {assessmentThai}
                </p>
              </div>
              {thaiSummary && (
                <div className="rounded-2xl bg-sky-50/70 border border-sky-200 p-4">
                  <div className="text-sm font-extrabold text-sky-950 mb-1">
                    🖼️ ลักษณะภาพที่จะได้:
                  </div>
                  <p className="text-sm sm:text-base text-slate-800 leading-relaxed">
                    {thaiSummary}
                  </p>
                </div>
              )}
            </div>
          )}

          {/* Step 2: Full Prompt & Settings */}
          <div className="space-y-4 pt-2 border-t border-slate-100">
            <div className="flex items-center gap-2.5">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[#0d2546] text-amber-300 font-extrabold text-sm">
                2
              </span>
              <h3 className="text-lg sm:text-xl font-extrabold text-[#0d2546]">
                ตรวจดู Full Prompt และเลือกขนาดรูปภาพ
              </h3>
            </div>

            <textarea
              rows={4}
              value={imgFullPrompt}
              onChange={(e) => setImgFullPrompt(e.target.value)}
              placeholder="Full Prompt สำหรับส่งให้ Agent สร้างรูปภาพ (กดปุ่มสีเหลืองด้านบนเพื่อให้ AI เขียนให้ หรือพิมพ์เองได้เลยครับ)"
              className="w-full rounded-2xl border-2 border-slate-300 p-4 text-base text-slate-800 focus:border-[#0d2546] focus:outline-none"
            />

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-extrabold text-slate-700 mb-2">
                  สัดส่วนรูปภาพ:
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {(
                    [
                      { id: '16:9', label: 'แนวนอน 16:9', sub: 'ปกข่าวหน้าเว็บ' },
                      { id: '1:1', label: 'จัตุรัส 1:1', sub: 'โพสต์โซเชียล' },
                      { id: '9:16', label: 'แนวตั้ง 9:16', sub: 'จอมือถือ' },
                    ] as const
                  ).map((a) => (
                    <button
                      key={a.id}
                      type="button"
                      onClick={() => setImgAspect(a.id)}
                      className={`rounded-xl p-3 text-left border-2 transition cursor-pointer ${
                        imgAspect === a.id
                          ? 'bg-[#0d2546] text-white border-[#0d2546]'
                          : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                      }`}
                    >
                      <div className="text-sm font-extrabold">{a.label}</div>
                      <div
                        className={`text-xs ${
                          imgAspect === a.id ? 'text-amber-300' : 'text-slate-500'
                        }`}
                      >
                        {a.sub}
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-sm font-extrabold text-slate-700 mb-2">
                  ค่าย Agent วาดรูปภาพ:
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setImgProvider('gemini')}
                    className={`rounded-xl p-3 text-left border-2 transition cursor-pointer ${
                      imgProvider === 'gemini'
                        ? 'bg-[#0d2546] text-white border-[#0d2546]'
                        : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                    }`}
                  >
                    <div className="text-sm font-extrabold">Google Gemini</div>
                    <div
                      className={`text-xs ${
                        imgProvider === 'gemini' ? 'text-amber-300' : 'text-slate-500'
                      }`}
                    >
                      Nano Banana 2.1
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => setImgProvider('openai')}
                    className={`rounded-xl p-3 text-left border-2 transition cursor-pointer ${
                      imgProvider === 'openai'
                        ? 'bg-[#0d2546] text-white border-[#0d2546]'
                        : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                    }`}
                  >
                    <div className="text-sm font-extrabold">OpenAI Image</div>
                    <div
                      className={`text-xs ${
                        imgProvider === 'openai' ? 'text-amber-300' : 'text-slate-500'
                      }`}
                    >
                      DALL-E 3 / GPT-Image
                    </div>
                  </button>
                </div>
              </div>
            </div>

            <div className="pt-2">
              <button
                type="button"
                onClick={handleGenerateImage}
                disabled={imgGenerating}
                className="w-full sm:w-auto inline-flex items-center justify-center gap-3 rounded-2xl bg-emerald-600 px-8 py-4 text-lg font-extrabold text-white hover:bg-emerald-700 transition cursor-pointer shadow-md disabled:opacity-50"
              >
                {imgGenerating ? (
                  <>
                    <RefreshCw className="w-6 h-6 animate-spin" />
                    Agent กำลังสร้างรูปภาพจริงให้ครับ...
                  </>
                ) : (
                  <>
                    <Sparkles className="w-6 h-6" />
                    สั่ง Agent สร้างรูปภาพจริง (พร้อมดูตัวอย่างก่อนตัดสินใจ)
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ===================================================================== */}
      {/* TAB 2: VIDEO GENERATOR (AI EVALUATOR + FULL PROMPT + GOOGLE VEO/OMNI) */}
      {/* ===================================================================== */}
      {activeTab === 'video' && (
        <div className="rounded-3xl bg-white border border-slate-200 p-5 sm:p-7 shadow-xs space-y-6">
          {/* Step 1 */}
          <div className="space-y-3">
            <div className="flex items-center gap-2.5">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[#0d2546] text-amber-300 font-extrabold text-sm">
                1
              </span>
              <h3 className="text-lg sm:text-xl font-extrabold text-[#0d2546]">
                บอกคลิปวิดีโอที่อยากได้ (พิมพ์ภาษาไทยง่ายๆ ได้เลย)
              </h3>
            </div>
            <div className="flex flex-col sm:flex-row gap-3">
              <input
                type="text"
                value={ideaBrief}
                onChange={(e) => setIdeaBrief(e.target.value)}
                placeholder="เช่น คลิปเปิดรายการข่าวการศึกษา บรรยากาศห้องสมุดอนาคต มีแสงอุ่นส่องผ่านหน้าต่าง กล้องแพนช้าๆ"
                className="flex-1 rounded-2xl border-2 border-slate-300 px-4 py-3.5 text-base text-slate-800 focus:border-[#0d2546] focus:outline-none"
              />
              <button
                type="button"
                onClick={() => handleEvaluateBrief('video')}
                disabled={evaluating}
                className="inline-flex items-center justify-center gap-2 rounded-2xl bg-amber-400 px-5 py-3.5 text-base font-extrabold text-[#0d2546] hover:bg-amber-300 transition cursor-pointer shrink-0 disabled:opacity-50"
              >
                {evaluating ? (
                  <>
                    <RefreshCw className="w-5 h-5 animate-spin" />
                    AI กำลังประเมิน...
                  </>
                ) : (
                  <>
                    <Wand2 className="w-5 h-5" />
                    ให้ AI ประเมิน & เขียน Full Video Prompt
                  </>
                )}
              </button>
            </div>
          </div>

          {assessmentThai && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="rounded-2xl bg-amber-50/70 border border-amber-200 p-4">
                <div className="text-sm font-extrabold text-amber-950 mb-1">
                  💡 AI ประเมินแนวคิดวิดีโอ:
                </div>
                <p className="text-sm sm:text-base text-slate-800 leading-relaxed">
                  {assessmentThai}
                </p>
              </div>
              {thaiSummary && (
                <div className="rounded-2xl bg-sky-50/70 border border-sky-200 p-4">
                  <div className="text-sm font-extrabold text-sky-950 mb-1">
                    🎬 ฉากวิดีโอที่จะได้:
                  </div>
                  <p className="text-sm sm:text-base text-slate-800 leading-relaxed">
                    {thaiSummary}
                  </p>
                </div>
              )}
            </div>
          )}

          {/* Step 2: Full Video Prompt & Options */}
          <div className="space-y-4 pt-2 border-t border-slate-100">
            <div className="flex items-center gap-2.5">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[#0d2546] text-amber-300 font-extrabold text-sm">
                2
              </span>
              <h3 className="text-lg sm:text-xl font-extrabold text-[#0d2546]">
                ตรวจดู Full Video Prompt และตั้งค่าคลิปวิดีโอ
              </h3>
            </div>

            <textarea
              rows={4}
              value={vidFullPrompt}
              onChange={(e) => setVidFullPrompt(e.target.value)}
              placeholder="Full Video Prompt สำหรับส่งให้ Agent วิดีโอ (กดปุ่มสีเหลืองด้านบนเพื่อให้ AI เขียนให้ หรือพิมพ์เองได้เลยครับ)"
              className="w-full rounded-2xl border-2 border-slate-300 p-4 text-base text-slate-800 focus:border-[#0d2546] focus:outline-none"
            />

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-extrabold text-slate-700 mb-2">
                  สัดส่วนวิดีโอ:
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setVidAspect('16:9')}
                    className={`rounded-xl p-3 text-left border-2 cursor-pointer ${
                      vidAspect === '16:9'
                        ? 'bg-[#0d2546] text-white border-[#0d2546]'
                        : 'bg-slate-50 text-slate-700 border-slate-200'
                    }`}
                  >
                    <div className="text-sm font-extrabold">แนวนอน 16:9</div>
                    <div
                      className={`text-xs ${
                        vidAspect === '16:9' ? 'text-amber-300' : 'text-slate-500'
                      }`}
                    >
                      ลงเว็บ / YouTube
                    </div>
                  </button>
                  <button
                    type="button"
                    onClick={() => setVidAspect('9:16')}
                    className={`rounded-xl p-3 text-left border-2 cursor-pointer ${
                      vidAspect === '9:16'
                        ? 'bg-[#0d2546] text-white border-[#0d2546]'
                        : 'bg-slate-50 text-slate-700 border-slate-200'
                    }`}
                  >
                    <div className="text-sm font-extrabold">แนวตั้ง 9:16</div>
                    <div
                      className={`text-xs ${
                        vidAspect === '9:16' ? 'text-amber-300' : 'text-slate-500'
                      }`}
                    >
                      TikTok / Reels
                    </div>
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-sm font-extrabold text-slate-700 mb-2">
                  ระบบสร้างวิดีโอ (Video Agent):
                </label>
                <select
                  value={vidEngine}
                  onChange={(e) => setVidEngine(e.target.value as any)}
                  className="w-full rounded-xl border-2 border-slate-300 px-3.5 py-3 text-sm font-extrabold text-[#0d2546] bg-white"
                >
                  <option value="gemini-omni-1.1-flash">
                    Google Video (Gemini Omni 1.1 — ใช้คีย์ Gemini เดียว)
                  </option>
                  <option value="veo-3.1-generate-001">
                    Google Veo 3.1 (Vertex AI คุณภาพสูงสุด)
                  </option>
                  <option value="veo-3.1-fast-generate-001">
                    Google Veo 3.1 Fast (Vertex AI ความเร็วสูง)
                  </option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-extrabold text-slate-700 mb-2">
                  ความยาวคลิป:
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {[5, 6, 8].map((sec) => (
                    <button
                      key={sec}
                      type="button"
                      onClick={() => setVidDuration(sec)}
                      className={`rounded-xl py-3 text-sm font-extrabold border-2 cursor-pointer ${
                        vidDuration === sec
                          ? 'bg-[#0d2546] text-white border-[#0d2546]'
                          : 'bg-slate-50 text-slate-700 border-slate-200'
                      }`}
                    >
                      {sec} วินาที
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Optional Starting Image (Image-to-Video!) */}
            <div className="rounded-2xl bg-slate-50 border border-slate-200 p-4 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-sm font-extrabold text-[#0d2546]">
                  ภาพต้นแบบฉากแรก (ไม่บังคับ — ถ้าใส่ AI จะสร้างวิดีโอเคลื่อนไหวต่อจากภาพนี้):
                </div>
                {vidFirstFrameUrl && (
                  <button
                    type="button"
                    onClick={() => setVidFirstFrameUrl('')}
                    className="text-xs font-extrabold text-rose-600 hover:underline cursor-pointer"
                  >
                    เอาภาพต้นแบบออก
                  </button>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <label className="inline-flex items-center gap-2 rounded-xl border-2 border-slate-300 bg-white px-4 py-2.5 text-sm font-extrabold text-[#0d2546] hover:bg-slate-100 cursor-pointer">
                  <Upload className="w-4 h-4" />
                  {uploadingFrame ? 'กำลังอัปโหลด...' : 'เลือกรูปจากเครื่อง'}
                  <input
                    type="file"
                    accept="image/*"
                    onChange={handleUploadFirstFrame}
                    className="hidden"
                  />
                </label>

                {approvedImages.slice(0, 5).map((img) => (
                  <button
                    key={img.id}
                    type="button"
                    onClick={() => setVidFirstFrameUrl(img.fileUrl)}
                    title="ใช้รูป AI นี้เป็นภาพเริ่มต้นวิดีโอ"
                    className={`h-12 w-20 rounded-xl overflow-hidden border-2 cursor-pointer ${
                      vidFirstFrameUrl === img.fileUrl
                        ? 'border-amber-500 ring-2 ring-amber-400'
                        : 'border-slate-200 opacity-80 hover:opacity-100'
                    }`}
                  >
                    <img
                      src={img.fileUrl}
                      alt=""
                      className="h-full w-full object-cover"
                    />
                  </button>
                ))}
              </div>

              {vidFirstFrameUrl && (
                <div className="flex items-center gap-3 pt-1">
                  <img
                    src={vidFirstFrameUrl}
                    alt="Selected first frame"
                    className="h-20 w-36 object-cover rounded-xl border border-slate-300"
                  />
                  <span className="text-xs sm:text-sm font-bold text-emerald-700">
                    ✓ เลือกภาพต้นแบบสำหรับสร้างวิดีโอแล้ว
                  </span>
                </div>
              )}
            </div>

            <div className="pt-2">
              <button
                type="button"
                onClick={handleGenerateVideo}
                disabled={vidGenerating}
                className="w-full sm:w-auto inline-flex items-center justify-center gap-3 rounded-2xl bg-emerald-600 px-8 py-4 text-lg font-extrabold text-white hover:bg-emerald-700 transition cursor-pointer shadow-md disabled:opacity-50"
              >
                {vidGenerating ? (
                  <>
                    <RefreshCw className="w-6 h-6 animate-spin" />
                    Agent กำลังสร้างวิดีโอจริง (รอประมาณ 30-90 วินาที)...
                  </>
                ) : (
                  <>
                    <Film className="w-6 h-6" />
                    สั่ง Agent สร้างวิดีโอจริง (พร้อมดูตัวอย่างก่อนตัดสินใจ)
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ===================================================================== */}
      {/* TAB 3: MULTI-SCENE GOOGLE FLOW FILMMAKING STUDIO                      */}
      {/* ===================================================================== */}
      {activeTab === 'flow' && (
        <FlowAndChatStudio
          onRefreshAll={async () => {
            await loadData();
            await onRefreshAll();
          }}
          onOpenSettings={onOpenSettings}
          onOpenPost={onPreviewPost}
        />
      )}

      {/* ===================================================================== */}
      {/* SAVED MEDIA GALLERY (RE-PREVIEW, USE IN NEWS, DOWNLOAD, OR DELETE)    */}
      {/* ===================================================================== */}
      {activeTab !== 'flow' && (
        <div className="rounded-3xl bg-white border border-slate-200 p-5 sm:p-6 shadow-xs space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-lg sm:text-xl font-extrabold text-[#0d2546]">
                คลังรูปภาพและวิดีโอ AI ของคุณ ({approvedAssets.length} รายการ)
              </h3>
              <p className="text-sm text-slate-500">
                กดเปิดดูตัวอย่างใหญ่ นำไปใช้ตั้งเป็นปกข่าว/ลงบทความ หรือลบรูปและคลิปที่ไม่ต้องการทิ้งได้ทุกเมื่อ
              </p>
            </div>

            <div className="flex items-center gap-2">
              {(
                [
                  { id: 'all', label: 'ทั้งหมด' },
                  { id: 'image', label: 'รูปภาพ' },
                  { id: 'video', label: 'วิดีโอ' },
                ] as const
              ).map((f) => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => setGalleryFilter(f.id)}
                  className={`rounded-xl px-4 py-2 text-sm font-extrabold cursor-pointer ${
                    galleryFilter === f.id
                      ? 'bg-[#0d2546] text-white'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>

          {approvedAssets.length === 0 ? (
            <div className="rounded-2xl bg-slate-50 border border-dashed border-slate-300 p-10 text-center text-base text-slate-500">
              ยังไม่มีรูปภาพหรือวิดีโอในคลัง ลองสั่ง Agent สร้างผลงานชิ้นแรกด้านบนได้เลยครับ
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {approvedAssets.map((item) => (
                <div
                  key={item.id}
                  className="rounded-2xl border border-slate-200 bg-slate-50/60 overflow-hidden flex flex-col justify-between"
                >
                  <div>
                    <div className="relative aspect-video bg-slate-900 flex items-center justify-center overflow-hidden">
                      {item.mediaType === 'video' ? (
                        <video
                          src={item.fileUrl}
                          controls
                          className="h-full w-full object-contain"
                        />
                      ) : (
                        <img
                          src={item.fileUrl}
                          alt={item.thaiSummary || item.prompt}
                          onClick={() => setZoomAsset(item)}
                          className="h-full w-full object-cover cursor-zoom-in"
                        />
                      )}
                      <span
                        className={`absolute top-2.5 left-2.5 rounded-full px-2.5 py-0.5 text-[11px] font-extrabold text-white ${
                          item.mediaType === 'video' ? 'bg-indigo-600' : 'bg-amber-600'
                        }`}
                      >
                        {item.mediaType === 'video' ? 'วิดีโอ AI' : 'รูปภาพ AI'}
                      </span>
                      {item.reviewStatus === 'pending_review' && (
                        <span className="absolute top-2.5 right-2.5 rounded-full bg-amber-400 px-2.5 py-0.5 text-[11px] font-extrabold text-[#0d2546]">
                          รอตรวจ
                        </span>
                      )}
                    </div>

                    <div className="p-3.5 space-y-1">
                      <div className="text-sm font-extrabold text-[#0d2546] line-clamp-1">
                        {item.thaiSummary || item.prompt}
                      </div>
                      <div className="text-xs text-slate-500">
                        {formatThaiDate(item.createdAt)} • {item.aspectRatio || '16:9'}
                      </div>
                    </div>
                  </div>

                  <div className="p-3 pt-0 space-y-2">
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setActiveRecheckAsset(item);
                          recheckRef.current?.scrollIntoView({ behavior: 'smooth' });
                        }}
                        className="flex items-center justify-center gap-1.5 rounded-xl bg-white border border-slate-300 px-3 py-2 text-xs sm:text-sm font-extrabold text-[#0d2546] hover:bg-slate-100 cursor-pointer"
                      >
                        <Eye className="w-4 h-4" /> ดูตัวอย่าง
                      </button>

                      <button
                        type="button"
                        onClick={() => handleSendAssetToPostEditor(item)}
                        className="flex items-center justify-center gap-1.5 rounded-xl bg-[#0d2546] px-3 py-2 text-xs sm:text-sm font-extrabold text-white hover:bg-[#163a6b] cursor-pointer"
                      >
                        <Newspaper className="w-4 h-4 text-amber-300" /> นำไปลงข่าว
                      </button>
                    </div>

                    <div className="flex items-center justify-between gap-2">
                      <a
                        href={item.fileUrl}
                        download
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-xs font-bold text-slate-600 hover:text-[#0d2546]"
                      >
                        <Download className="w-3.5 h-3.5" /> ดาวน์โหลดไฟล์
                      </a>

                      {confirmDeleteId === item.id ? (
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            disabled={reviewBusyId === item.id}
                            onClick={() => handleDeleteAsset(item)}
                            className="rounded-lg bg-rose-600 px-2.5 py-1 text-xs font-extrabold text-white cursor-pointer"
                          >
                            ยืนยันลบ
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmDeleteId(null)}
                            className="rounded-lg bg-slate-200 px-2 py-1 text-xs font-bold text-slate-700 cursor-pointer"
                          >
                            ยกเลิก
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteId(item.id)}
                          className="inline-flex items-center gap-1 text-xs font-bold text-rose-600 hover:underline cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" /> ลบทิ้ง
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Fullscreen Image Zoom Lightbox */}
      {zoomAsset && (
        <div
          onClick={() => setZoomAsset(null)}
          className="fixed inset-0 z-50 bg-slate-950/85 p-4 flex flex-col items-center justify-center"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="max-w-5xl w-full flex flex-col items-center gap-4"
          >
            <img
              src={zoomAsset.fileUrl}
              alt={zoomAsset.thaiSummary || 'Preview'}
              className="max-h-[80vh] w-auto rounded-2xl shadow-2xl"
            />
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => {
                  setZoomAsset(null);
                  handleSendAssetToPostEditor(zoomAsset);
                }}
                className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-5 py-2.5 text-sm font-extrabold text-white hover:bg-emerald-700 cursor-pointer"
              >
                <Newspaper className="w-4 h-4" /> ชอบ! นำรูปนี้ไปลงข่าว
              </button>
              <button
                type="button"
                onClick={() => handleDeleteAsset(zoomAsset)}
                className="inline-flex items-center gap-2 rounded-xl bg-rose-600 px-5 py-2.5 text-sm font-extrabold text-white hover:bg-rose-700 cursor-pointer"
              >
                <Trash2 className="w-4 h-4" /> ไม่ชอบ — ลบทิ้งทันที
              </button>
              <button
                type="button"
                onClick={() => setZoomAsset(null)}
                className="inline-flex items-center gap-1.5 rounded-xl bg-white px-5 py-2.5 text-sm font-extrabold text-slate-800 cursor-pointer"
              >
                <X className="w-4 h-4" /> ปิดหน้าต่าง
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
