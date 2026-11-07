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
  FilePlus2,
} from 'lucide-react';
import {
  AiEngineSettings,
  AiMediaAsset,
  LiveModelOption,
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

  const [ideaBrief, setIdeaBrief] = useState('');
  const [evaluating, setEvaluating] = useState(false);
  const [assessmentThai, setAssessmentThai] = useState('');
  const [thaiSummary, setThaiSummary] = useState('');
  const [suggestedTitle, setSuggestedTitle] = useState('');

  const [imgFullPrompt, setImgFullPrompt] = useState('');
  const [imgProvider, setImgProvider] = useState<'gemini' | 'openai'>('gemini');
  const [imgAspect, setImgAspect] = useState<'16:9' | '9:16' | '1:1'>('16:9');
  const [imgGenerating, setImgGenerating] = useState(false);

  const [vidFullPrompt, setVidFullPrompt] = useState('');
  const [vidEngine, setVidEngine] = useState<string>('');
  const [vidAspect, setVidAspect] = useState<'16:9' | '9:16'>('16:9');
  const [vidDuration, setVidDuration] = useState(6);
  const [vidFirstFrameUrl, setVidFirstFrameUrl] = useState('');
  const [vidGenerating, setVidGenerating] = useState(false);
  const [uploadingFrame, setUploadingFrame] = useState(false);
  const [liveVideoModels, setLiveVideoModels] = useState<LiveModelOption[]>([]);

  const [activeRecheckAsset, setActiveRecheckAsset] = useState<AiMediaAsset | null>(
    null
  );
  const [zoomAsset, setZoomAsset] = useState<AiMediaAsset | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);
  const [reviewBusyId, setReviewBusyId] = useState<number | null>(null);
  const [writingNewsForAssetId, setWritingNewsForAssetId] = useState<number | null>(
    null
  );

  const recheckRef = useRef<HTMLDivElement | null>(null);

  const showToast = (msg: string) => {
    setSuccessBanner(msg);
    setTimeout(() => setSuccessBanner(null), 5000);
  };

  const loadData = async () => {
    try {
      const [st, list, lm] = await Promise.all([
        api.getAiSettings(),
        api.getMediaAssets(),
        api.getLiveModels().catch(() => null),
      ]);
      setSettings(st);
      setAssets(list);
      if (st && !st.hasGeminiKey && st.hasOpenaiKey) {
        setImgProvider('openai');
      }
      if (lm) {
        const merged: LiveModelOption[] = [];
        const seen = new Set<string>();
        for (const m of [
          ...(lm.providers?.gemini?.videoModels || []),
          ...(lm.providers?.vertex_veo?.videoModels || []),
        ]) {
          if (!seen.has(m.id)) {
            seen.add(m.id);
            merged.push(m);
          }
        }
        setLiveVideoModels(merged);
      }
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  useEffect(() => {
    if (incomingHandoff) {
      setActiveTab(incomingHandoff.target);
      setAssessmentThai(incomingHandoff.assessmentThai);
      setThaiSummary(incomingHandoff.thaiSummary);
      setSuggestedTitle(incomingHandoff.suggestedPostTitle || '');
      if (incomingHandoff.target === 'image') {
        setImgFullPrompt(incomingHandoff.fullPrompt);
        setImgAspect(incomingHandoff.aspectRatio);
      } else {
        setVidFullPrompt(incomingHandoff.fullPrompt);
        setVidAspect(incomingHandoff.aspectRatio === '9:16' ? '9:16' : '16:9');
      }
      showToast(
        incomingHandoff.target === 'image'
          ? 'รับข้อมูล Full Prompt จากหน้าสนทนาเรียบร้อยแล้ว พร้อมสั่งสร้างภาพทันที'
          : 'รับข้อมูล Full Prompt จากหน้าสนทนาเรียบร้อยแล้ว พร้อมสั่งสร้างวิดีโอทันที'
      );
      if (onClearHandoff) onClearHandoff();
    }
  }, [incomingHandoff]);

  const handleEvaluateIdea = async (target: 'image' | 'video') => {
    if (!ideaBrief.trim()) {
      setErrorBanner('กรุณาระบุแนวคิดหรือรายละเอียดสื่อที่ต้องการให้ AI วิเคราะห์');
      return;
    }
    setErrorBanner(null);
    setEvaluating(true);
    try {
      const res = await api.evaluateMediaPrompt({
        userIdea: ideaBrief.trim(),
        target,
        aspectRatio: target === 'image' ? imgAspect : vidAspect,
      });
      setAssessmentThai(res.assessmentThai);
      setThaiSummary(res.thaiSummary || res.visualSummaryThai || '');
      setSuggestedTitle(res.suggestedPostTitle);
      if (target === 'image') {
        setImgFullPrompt(res.fullPrompt);
      } else {
        setVidFullPrompt(res.fullPrompt);
      }
      showToast('วิเคราะห์แนวคิดและเรียบเรียง Full Prompt สำเร็จ');
    } catch (err) {
      setErrorBanner((err as Error).message);
    } finally {
      setEvaluating(false);
    }
  };

  const handleGenerateImage = async () => {
    const finalPrompt = imgFullPrompt.trim() || ideaBrief.trim();
    if (!finalPrompt) {
      setErrorBanner('กรุณาระบุคำสั่งสร้างภาพ (Prompt) ก่อนดำเนินการ');
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
      showToast('สร้างภาพประกอบสำเร็จ กรุณาตรวจสอบตัวอย่างผลงาน');
      setTimeout(() => {
        recheckRef.current?.scrollIntoView({ behavior: 'smooth' });
      }, 150);
    } catch (err) {
      setErrorBanner((err as Error).message);
    } finally {
      setImgGenerating(false);
    }
  };

  const handleGenerateVideo = async () => {
    const finalPrompt = vidFullPrompt.trim() || ideaBrief.trim();
    if (!finalPrompt) {
      setErrorBanner('กรุณาระบุคำสั่งสร้างวิดีโอ (Prompt) ก่อนดำเนินการ');
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
      showToast('สร้างสื่อวิดีโอสำเร็จ กรุณาตรวจสอบตัวอย่างผลงาน');
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
      showToast('อัปโหลดภาพต้นแบบสำหรับฉากเปิดเรียบร้อยแล้ว');
    } catch (err) {
      setErrorBanner((err as Error).message);
    } finally {
      setUploadingFrame(false);
    }
  };

  const handleApproveAsset = async (asset: AiMediaAsset) => {
    setReviewBusyId(asset.id);
    setErrorBanner(null);
    try {
      await api.reviewMediaAsset(asset.id, 'approved');
      if (activeRecheckAsset?.id === asset.id) {
        setActiveRecheckAsset({ ...asset, reviewStatus: 'approved' });
      }
      await loadData();
      showToast('อนุมัติและจัดเก็บผลงานในคลังสื่อเรียบร้อยแล้ว');
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
      showToast('ลบไฟล์สื่อออกจากระบบเรียบร้อยแล้ว');
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
    const caption = (suggestedTitle || asset.thaiSummary || 'สื่อประกอบเนื้อหา').replace(
      /[\[\]]/g,
      ''
    );
    const inlineMarkdown =
      asset.mediaType === 'video'
        ? `![วิดีโอ: ${caption}](${asset.fileUrl})\n\n`
        : `![${caption}](${asset.fileUrl})\n\n`;
    onOpenInPostEditor({
      title: suggestedTitle || asset.thaiSummary || '',
      content: inlineMarkdown,
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
      const caption = (asset.thaiSummary || draft.title || 'สื่อประกอบเนื้อหา').replace(
        /[\[\]]/g,
        ''
      );
      const mediaTag =
        asset.mediaType === 'video'
          ? `![วิดีโอ: ${caption}](${asset.fileUrl})`
          : `![${caption}](${asset.fileUrl})`;
      const enrichedContent = draft.content.includes(asset.fileUrl)
        ? draft.content
        : `${draft.content.trim()}\n\n${mediaTag}`;
      onOpenInPostEditor({
        title: draft.title,
        subtitle: draft.subtitle,
        excerpt: draft.excerpt,
        content: enrichedContent,
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
    showToast('นำคำสั่ง Prompt กลับมาที่แบบฟอร์มแล้ว สามารถปรับแก้และสร้างใหม่ได้ทันที');
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
    <div className="space-y-5">
      {/* Studio Header & Segmented Mode Navigation */}
      <div className="rounded-lg bg-white border border-slate-200 p-4 sm:p-5 space-y-4 shadow-2xs">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3.5 border-b border-slate-100">
          <div>
            <h2 className="text-sm sm:text-base font-bold text-slate-900">
              สตูดิโอผลิตสื่อภาพนิ่งและวิดีโอด้วย AI
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              วิเคราะห์คำสั่ง Prompt มาตรฐานองค์กร สร้างสื่อประกอบเนื้อหา และบริหารจัดการคลังสื่อดิจิทัล
            </p>
          </div>
          <button
            type="button"
            onClick={onGoToChat}
            className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition cursor-pointer shrink-0"
          >
            <MessageSquare className="w-3.5 h-3.5 text-slate-500" />
            เปิดหน้าผู้ช่วย AI (Co-Work Chat)
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          <button
            type="button"
            onClick={() => setActiveTab('image')}
            className={`flex items-center justify-center gap-2 rounded-md px-4 py-2.5 text-xs sm:text-sm font-semibold border transition cursor-pointer ${
              activeTab === 'image'
                ? 'bg-slate-900 text-white border-slate-900'
                : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
            }`}
          >
            <ImageIcon className="w-4 h-4 text-amber-400" />
            1. สร้างภาพนิ่ง (Image Generation)
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('video')}
            className={`flex items-center justify-center gap-2 rounded-md px-4 py-2.5 text-xs sm:text-sm font-semibold border transition cursor-pointer ${
              activeTab === 'video'
                ? 'bg-slate-900 text-white border-slate-900'
                : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
            }`}
          >
            <Film className="w-4 h-4 text-amber-400" />
            2. สร้างสื่อวิดีโอ (Video Production)
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('flow')}
            className={`flex items-center justify-center gap-2 rounded-md px-4 py-2.5 text-xs sm:text-sm font-semibold border transition cursor-pointer ${
              activeTab === 'flow'
                ? 'bg-slate-900 text-white border-slate-900'
                : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
            }`}
          >
            <Clapperboard className="w-4 h-4 text-amber-400" />
            3. สตอรีบอร์ดหลายฉาก (Multi-Scene Flow)
          </button>
        </div>
      </div>

      {/* Notifications */}
      {errorBanner && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 flex flex-wrap items-center justify-between gap-3 text-xs text-rose-900">
          <div className="flex items-center gap-2 font-medium">
            <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
            <span>{errorBanner}</span>
          </div>
          <div className="flex items-center gap-2">
            {errorBanner.includes('API Key') && (
              <button
                type="button"
                onClick={onOpenSettings}
                className="inline-flex items-center gap-1 rounded-md bg-rose-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-rose-800 cursor-pointer"
              >
                <KeyRound className="w-3.5 h-3.5" /> ตั้งค่า API Key
              </button>
            )}
            <button
              type="button"
              onClick={() => setErrorBanner(null)}
              className="text-rose-700 hover:text-rose-900 font-semibold cursor-pointer"
            >
              ปิด
            </button>
          </div>
        </div>
      )}

      {successBanner && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 flex items-center justify-between gap-3 text-xs text-emerald-900">
          <div className="flex items-center gap-2 font-medium">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>{successBanner}</span>
          </div>
          <button
            type="button"
            onClick={() => setSuccessBanner(null)}
            className="text-emerald-700 hover:text-emerald-900 font-semibold cursor-pointer"
          >
            ปิด
          </button>
        </div>
      )}

      {/* ===================================================================== */}
      {/* ACTIVE OUTPUT INSPECTION & QUALITY REVIEW PANEL                       */}
      {/* ===================================================================== */}
      <div ref={recheckRef}>
        {activeRecheckAsset && (
          <div className="rounded-lg border border-slate-300 bg-white p-5 shadow-xs space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-slate-100">
              <div>
                <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                  <Eye className="w-3.5 h-3.5 text-amber-600" />
                  การตรวจสอบคุณภาพผลงาน (Quality Inspection)
                </span>
                <h3 className="text-sm sm:text-base font-bold text-slate-900 mt-0.5">
                  {activeRecheckAsset.mediaType === 'video'
                    ? 'ตัวอย่างสื่อวิดีโอที่สร้างเสร็จสมบูรณ์'
                    : 'ตัวอย่างภาพประกอบที่สร้างเสร็จสมบูรณ์'}
                </h3>
              </div>

              <div className="flex items-center gap-2">
                {activeRecheckAsset.reviewStatus === 'approved' ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 border border-emerald-200 px-2.5 py-0.5 text-xs font-semibold text-emerald-800">
                    <CheckCircle2 className="w-3.5 h-3.5" /> อนุมัติเก็บในคลังแล้ว
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 border border-amber-200 px-2.5 py-0.5 text-xs font-semibold text-amber-800">
                    รอการตรวจสอบ
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => setActiveRecheckAsset(null)}
                  className="rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50 cursor-pointer"
                >
                  ซ่อนหน้าต่าง
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
              <div className="lg:col-span-7 rounded-md overflow-hidden bg-slate-950 border border-slate-200 flex items-center justify-center">
                {activeRecheckAsset.mediaType === 'video' ? (
                  <video
                    src={activeRecheckAsset.fileUrl}
                    controls
                    autoPlay
                    playsInline
                    className="w-full max-h-[420px]"
                  />
                ) : (
                  <img
                    src={activeRecheckAsset.fileUrl}
                    alt={activeRecheckAsset.thaiSummary || activeRecheckAsset.prompt}
                    onClick={() => setZoomAsset(activeRecheckAsset)}
                    className="w-full max-h-[420px] object-contain cursor-zoom-in"
                  />
                )}
              </div>

              <div className="lg:col-span-5 space-y-4">
                <div className="rounded-md bg-slate-50 border border-slate-200 p-3.5 space-y-1.5 text-xs">
                  <div className="text-slate-500">
                    โมเดลประมวลผล:{' '}
                    <strong className="text-slate-800">
                      {activeRecheckAsset.engine}
                    </strong>{' '}
                    ({activeRecheckAsset.aspectRatio})
                  </div>
                  {activeRecheckAsset.thaiSummary && (
                    <div className="font-semibold text-slate-900">
                      สรุปเนื้อหา: {activeRecheckAsset.thaiSummary}
                    </div>
                  )}
                  <div className="text-slate-600 line-clamp-3">
                    Prompt: {activeRecheckAsset.prompt}
                  </div>
                </div>

                <div className="space-y-2">
                  <button
                    type="button"
                    disabled={writingNewsForAssetId === activeRecheckAsset.id}
                    onClick={() => handleAiWriteNewsWithAsset(activeRecheckAsset)}
                    className="w-full inline-flex items-center justify-center gap-2 rounded-md bg-slate-900 px-4 py-2.5 text-xs font-semibold text-white hover:bg-slate-800 cursor-pointer disabled:opacity-50"
                  >
                    {writingNewsForAssetId === activeRecheckAsset.id ? (
                      <>
                        <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                        กำลังร่างบทความประกอบสื่อ...
                      </>
                    ) : (
                      <>
                        <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                        ให้ AI ร่างบทความพร้อมแนบสื่อนี้
                      </>
                    )}
                  </button>

                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      disabled={reviewBusyId === activeRecheckAsset.id}
                      onClick={() => handleApproveAsset(activeRecheckAsset)}
                      className="inline-flex items-center justify-center gap-1.5 rounded-md bg-emerald-600 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-700 cursor-pointer disabled:opacity-50"
                    >
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      อนุมัติเก็บในคลัง
                    </button>

                    <button
                      type="button"
                      onClick={() => handleSendAssetToPostEditor(activeRecheckAsset)}
                      className="inline-flex items-center justify-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
                    >
                      <Newspaper className="w-3.5 h-3.5" />
                      เปิดในหน้าสร้างเนื้อหา
                    </button>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => handleReviseFromAsset(activeRecheckAsset)}
                      className="inline-flex items-center justify-center gap-1.5 rounded-md border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 cursor-pointer"
                    >
                      <RefreshCw className="w-3.5 h-3.5" />
                      แก้ไข Prompt และสร้างใหม่
                    </button>

                    <button
                      type="button"
                      disabled={reviewBusyId === activeRecheckAsset.id}
                      onClick={() => handleDeleteAsset(activeRecheckAsset)}
                      className="inline-flex items-center justify-center gap-1.5 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700 hover:bg-rose-100 cursor-pointer disabled:opacity-50"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      ลบไฟล์นี้
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ===================================================================== */}
      {/* TAB 1: IMAGE GENERATION STUDIO                                        */}
      {/* ===================================================================== */}
      {activeTab === 'image' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
          {/* Step 1: Prompt Analysis */}
          <div className="lg:col-span-5 rounded-lg bg-white border border-slate-200 p-5 space-y-4 shadow-2xs">
            <div className="border-b border-slate-100 pb-3">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                ขั้นตอนที่ 1 • การวิเคราะห์แนวคิด
              </div>
              <h3 className="text-sm font-bold text-slate-900 mt-0.5">
                ระบุแนวคิดภาพประกอบเพื่อให้ AI เรียบเรียง Full Prompt
              </h3>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                แนวคิดหรือรายละเอียดภาพที่ต้องการ (ภาษาไทยหรือภาษาอังกฤษ)
              </label>
              <textarea
                rows={4}
                value={ideaBrief}
                onChange={(e) => setIdeaBrief(e.target.value)}
                placeholder="เช่น ภาพห้องเรียนยุคใหม่ในประเทศไทย ครูและนักเรียนกำลังใช้แท็บเล็ตเรียนรู้ร่วมกับระบบ AI บรรยากาศอบอุ่นเป็นทางการ"
                className="w-full rounded-md border border-slate-300 p-3 text-xs sm:text-sm text-slate-900 focus:border-slate-900 focus:outline-none"
              />
            </div>

            <button
              type="button"
              disabled={evaluating}
              onClick={() => handleEvaluateIdea('image')}
              className="w-full inline-flex items-center justify-center gap-2 rounded-md border border-slate-300 bg-slate-50 px-4 py-2.5 text-xs font-semibold text-slate-800 hover:bg-slate-100 transition cursor-pointer disabled:opacity-50"
            >
              {evaluating ? (
                <>
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  กำลังวิเคราะห์องค์ประกอบภาพ...
                </>
              ) : (
                <>
                  <Wand2 className="w-3.5 h-3.5 text-amber-600" />
                  วิเคราะห์แนวคิดและสร้าง Full Prompt
                </>
              )}
            </button>

            {assessmentThai && (
              <div className="rounded-md bg-slate-50 border border-slate-200 p-3.5 space-y-1 text-xs">
                <div className="font-semibold text-slate-800">
                  ผลการวิเคราะห์องค์ประกอบภาพ:
                </div>
                <p className="text-slate-600 leading-relaxed">{assessmentThai}</p>
              </div>
            )}
          </div>

          {/* Step 2: Model Configuration & Execution */}
          <div className="lg:col-span-7 rounded-lg bg-white border border-slate-200 p-5 space-y-4 shadow-2xs">
            <div className="border-b border-slate-100 pb-3">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                ขั้นตอนที่ 2 • การตั้งค่าโมเดลและสั่งผลิตภาพ
              </div>
              <h3 className="text-sm font-bold text-slate-900 mt-0.5">
                ตรวจสอบ Full Prompt และกำหนดสัดส่วนภาพ
              </h3>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                คำสั่งสร้างภาพฉบับสมบูรณ์ (Full Prompt)
              </label>
              <textarea
                rows={4}
                value={imgFullPrompt}
                onChange={(e) => setImgFullPrompt(e.target.value)}
                placeholder="Full Prompt จากขั้นตอนที่ 1 จะแสดงที่นี่ หรือสามารถพิมพ์คำสั่งโดยตรงได้ทันที"
                className="w-full rounded-md border border-slate-300 p-3 text-xs sm:text-sm text-slate-900 focus:border-slate-900 focus:outline-none"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                  ผู้ให้บริการโมเดลภาพ (Image Provider)
                </label>
                <select
                  value={imgProvider}
                  onChange={(e) =>
                    setImgProvider(e.target.value as 'gemini' | 'openai')
                  }
                  className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-xs sm:text-sm font-medium text-slate-800"
                >
                  <option value="gemini">
                    Google Gemini Image / Imagen{' '}
                    {settings?.hasGeminiKey ? '(เชื่อมต่อแล้ว)' : '(ยังไม่ตั้งค่าคีย์)'}
                  </option>
                  <option value="openai">
                    OpenAI Image (gpt-image-1){' '}
                    {settings?.hasOpenaiKey ? '(เชื่อมต่อแล้ว)' : '(ยังไม่ตั้งค่าคีย์)'}
                  </option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                  สัดส่วนภาพ (Aspect Ratio)
                </label>
                <select
                  value={imgAspect}
                  onChange={(e) => setImgAspect(e.target.value as any)}
                  className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-xs sm:text-sm font-medium text-slate-800"
                >
                  <option value="16:9">16:9 แนวนอน (หน้าปกบทความ / เว็บไซต์)</option>
                  <option value="1:1">1:1 จัตุรัส (สื่อโซเชียลมีเดีย)</option>
                  <option value="9:16">9:16 แนวตั้ง (สอตรี / โปสเตอร์)</option>
                </select>
              </div>
            </div>

            <button
              type="button"
              disabled={imgGenerating}
              onClick={handleGenerateImage}
              className="w-full inline-flex items-center justify-center gap-2 rounded-md bg-slate-900 px-5 py-3 text-xs sm:text-sm font-semibold text-white hover:bg-slate-800 transition cursor-pointer disabled:opacity-50"
            >
              {imgGenerating ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin text-amber-400" />
                  กำลังประมวลผลและสร้างภาพ...
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4 text-amber-400" />
                  ดำเนินการสร้างภาพประกอบ
                </>
              )}
            </button>
          </div>
        </div>
      )}

      {/* ===================================================================== */}
      {/* TAB 2: VIDEO GENERATION STUDIO                                        */}
      {/* ===================================================================== */}
      {activeTab === 'video' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
          {/* Step 1: Video Concept Analysis */}
          <div className="lg:col-span-5 rounded-lg bg-white border border-slate-200 p-5 space-y-4 shadow-2xs">
            <div className="border-b border-slate-100 pb-3">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                ขั้นตอนที่ 1 • การออกแบบฉากและมุมกล้อง
              </div>
              <h3 className="text-sm font-bold text-slate-900 mt-0.5">
                ระบุแนวคิดวิดีโอเพื่อให้ AI เรียบเรียง Video Prompt
              </h3>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                รายละเอียดฉากและการเคลื่อนไหวที่ต้องการ
              </label>
              <textarea
                rows={4}
                value={ideaBrief}
                onChange={(e) => setIdeaBrief(e.target.value)}
                placeholder="เช่น ภาพมุมกว้างโดรนบินผ่านโรงเรียนทันสมัยในจังหวัดภูเก็ต แสงเช้าตรู่ บรรยากาศสร้างแรงบันดาลใจทางการศึกษา"
                className="w-full rounded-md border border-slate-300 p-3 text-xs sm:text-sm text-slate-900 focus:border-slate-900 focus:outline-none"
              />
            </div>

            <button
              type="button"
              disabled={evaluating}
              onClick={() => handleEvaluateIdea('video')}
              className="w-full inline-flex items-center justify-center gap-2 rounded-md border border-slate-300 bg-slate-50 px-4 py-2.5 text-xs font-semibold text-slate-800 hover:bg-slate-100 transition cursor-pointer disabled:opacity-50"
            >
              {evaluating ? (
                <>
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  กำลังออกแบบมุมกล้องและแสง...
                </>
              ) : (
                <>
                  <Wand2 className="w-3.5 h-3.5 text-amber-600" />
                  วิเคราะห์แนวคิดและสร้าง Video Prompt
                </>
              )}
            </button>

            {assessmentThai && (
              <div className="rounded-md bg-slate-50 border border-slate-200 p-3.5 space-y-1 text-xs">
                <div className="font-semibold text-slate-800">
                  ผลการวิเคราะห์การกำกับภาพ:
                </div>
                <p className="text-slate-600 leading-relaxed">{assessmentThai}</p>
              </div>
            )}
          </div>

          {/* Step 2: Video Engine & Execution */}
          <div className="lg:col-span-7 rounded-lg bg-white border border-slate-200 p-5 space-y-4 shadow-2xs">
            <div className="border-b border-slate-100 pb-3">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                ขั้นตอนที่ 2 • การตั้งค่าโมเดลวิดีโอและเรนเดอร์
              </div>
              <h3 className="text-sm font-bold text-slate-900 mt-0.5">
                ตรวจสอบ Video Prompt และกำหนดค่าการเรนเดอร์
              </h3>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                คำสั่งสร้างวิดีโอฉบับสมบูรณ์ (Full Video Prompt)
              </label>
              <textarea
                rows={4}
                value={vidFullPrompt}
                onChange={(e) => setVidFullPrompt(e.target.value)}
                placeholder="Video Prompt จากขั้นตอนที่ 1 จะแสดงที่นี่ หรือสามารถพิมพ์คำสั่งโดยตรงได้"
                className="w-full rounded-md border border-slate-300 p-3 text-xs sm:text-sm text-slate-900 focus:border-slate-900 focus:outline-none"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  โมเดลวิดีโอ (Video Engine)
                </label>
                <select
                  value={vidEngine}
                  onChange={(e) => setVidEngine(e.target.value)}
                  className="w-full rounded-md border border-slate-300 bg-white px-2.5 py-2 text-xs font-medium text-slate-800"
                >
                  <option value="">อัตโนมัติ (ใช้รุ่นล่าสุดจาก API)</option>
                  {liveVideoModels.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  สัดส่วนวิดีโอ
                </label>
                <select
                  value={vidAspect}
                  onChange={(e) => setVidAspect(e.target.value as any)}
                  className="w-full rounded-md border border-slate-300 bg-white px-2.5 py-2 text-xs font-medium text-slate-800"
                >
                  <option value="16:9">16:9 แนวนอน (YouTube / เว็บไซต์)</option>
                  <option value="9:16">9:16 แนวตั้ง (Reels / TikTok)</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  ความยาวคลิป
                </label>
                <select
                  value={vidDuration}
                  onChange={(e) => setVidDuration(Number(e.target.value))}
                  className="w-full rounded-md border border-slate-300 bg-white px-2.5 py-2 text-xs font-medium text-slate-800"
                >
                  <option value={4}>4 วินาที</option>
                  <option value={6}>6 วินาที (มาตรฐาน)</option>
                  <option value={8}>8 วินาที</option>
                </select>
              </div>
            </div>

            {/* Optional Starting Frame */}
            <div className="rounded-md bg-slate-50 border border-slate-200 p-3.5 space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <label className="text-xs font-semibold text-slate-700">
                  ภาพต้นแบบสำหรับฉากเปิด (Image-to-Video • ไม่บังคับ)
                </label>
                <label className="inline-flex items-center gap-1.5 rounded border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 cursor-pointer">
                  <Upload className="w-3.5 h-3.5" />
                  {uploadingFrame ? 'กำลังอัปโหลด...' : 'อัปโหลดภาพต้นแบบ'}
                  <input
                    type="file"
                    accept="image/*"
                    onChange={handleUploadFirstFrame}
                    className="hidden"
                  />
                </label>
              </div>

              <select
                value={vidFirstFrameUrl}
                onChange={(e) => setVidFirstFrameUrl(e.target.value)}
                className="w-full rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-700"
              >
                <option value="">-- ไม่ใช้ภาพต้นแบบ (สร้างจากข้อความล้วน) --</option>
                {approvedImages.slice(0, 15).map((img) => (
                  <option key={img.id} value={img.fileUrl}>
                    ภาพจากคลัง #{img.id}: {(img.thaiSummary || img.prompt).slice(0, 60)}
                  </option>
                ))}
              </select>
            </div>

            <button
              type="button"
              disabled={vidGenerating}
              onClick={handleGenerateVideo}
              className="w-full inline-flex items-center justify-center gap-2 rounded-md bg-slate-900 px-5 py-3 text-xs sm:text-sm font-semibold text-white hover:bg-slate-800 transition cursor-pointer disabled:opacity-50"
            >
              {vidGenerating ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin text-amber-400" />
                  กำลังเรนเดอร์ไฟล์วิดีโอ .MP4 (ใช้เวลาประมาณ 20–60 วินาที)...
                </>
              ) : (
                <>
                  <Film className="w-4 h-4 text-amber-400" />
                  ดำเนินการเรนเดอร์วิดีโอ
                </>
              )}
            </button>
          </div>
        </div>
      )}

      {/* ===================================================================== */}
      {/* TAB 3: MULTI-SCENE STORYBOARD FLOW STUDIO                             */}
      {/* ===================================================================== */}
      {activeTab === 'flow' && (
        <FlowAndChatStudio
          onRefreshAll={onRefreshAll}
          onOpenSettings={onOpenSettings}
          onOpenPost={onPreviewPost}
        />
      )}

      {/* ===================================================================== */}
      {/* MEDIA ASSET REGISTRY & ARCHIVE                                        */}
      {/* ===================================================================== */}
      <div className="rounded-lg bg-white border border-slate-200 p-5 space-y-4 shadow-2xs">
        <div className="flex flex-wrap items-center justify-between gap-3 pb-3.5 border-b border-slate-100">
          <div>
            <h3 className="text-sm sm:text-base font-bold text-slate-900">
              คลังสื่อดิจิทัลที่สร้างด้วย AI ({approvedAssets.length} รายการ)
            </h3>
            <p className="text-xs text-slate-500">
              จัดการไฟล์ภาพนิ่งและวิดีโอสำหรับนำไปประกอบบทความหรือเผยแพร่บนโซเชียลมีเดีย
              {pendingReviewAssets.length > 0 &&
                ` • รอการตรวจสอบ ${pendingReviewAssets.length} รายการ`}
            </p>
          </div>

          <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-md">
            {[
              { id: 'all', label: 'ทั้งหมด' },
              { id: 'image', label: 'เฉพาะรูปภาพ' },
              { id: 'video', label: 'เฉพาะวิดีโอ' },
            ].map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => setGalleryFilter(f.id as any)}
                className={`rounded px-3 py-1 text-xs font-semibold transition cursor-pointer ${
                  galleryFilter === f.id
                    ? 'bg-white text-slate-900 shadow-2xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        {approvedAssets.length === 0 ? (
          <div className="rounded-md bg-slate-50 border border-slate-200 p-8 text-center text-xs text-slate-500">
            ยังไม่มีไฟล์สื่อในคลังสำหรับหมวดหมู่นี้
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {approvedAssets.map((item) => {
              const isPending = item.reviewStatus === 'pending_review';
              const isConfirmingDel = confirmDeleteId === item.id;

              return (
                <div
                  key={item.id}
                  className="rounded-lg border border-slate-200 bg-white overflow-hidden flex flex-col justify-between shadow-2xs"
                >
                  <div>
                    <div className="relative aspect-video bg-slate-950 overflow-hidden">
                      {item.mediaType === 'video' ? (
                        <video
                          src={item.fileUrl}
                          controls
                          playsInline
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <img
                          src={item.fileUrl}
                          alt={item.thaiSummary || item.prompt}
                          onClick={() => setZoomAsset(item)}
                          className="h-full w-full object-cover cursor-zoom-in hover:scale-[1.01] transition"
                        />
                      )}
                      <div className="absolute top-2 left-2 flex items-center gap-1.5">
                        <span className="rounded bg-slate-900/85 px-2 py-0.5 text-[10px] font-semibold text-white">
                          {item.mediaType === 'video' ? 'VIDEO' : 'IMAGE'} •{' '}
                          {item.aspectRatio}
                        </span>
                        {isPending && (
                          <span className="rounded bg-amber-500 px-2 py-0.5 text-[10px] font-semibold text-slate-950">
                            รอตรวจสอบ
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="p-3.5 space-y-1">
                      <div className="text-[11px] text-slate-400">
                        {item.engine} • {formatThaiDate(item.createdAt)}
                      </div>
                      <div className="text-xs font-semibold text-slate-900 line-clamp-2">
                        {item.thaiSummary || item.prompt}
                      </div>
                    </div>
                  </div>

                  <div className="p-3.5 pt-0 space-y-1.5">
                    {isConfirmingDel ? (
                      <div className="rounded bg-rose-50 border border-rose-200 p-2 flex items-center justify-between text-xs">
                        <span className="font-semibold text-rose-800">
                          ยืนยันลบไฟล์นี้?
                        </span>
                        <div className="flex gap-1.5">
                          <button
                            type="button"
                            onClick={() => handleDeleteAsset(item)}
                            className="rounded bg-rose-600 px-2.5 py-1 font-semibold text-white cursor-pointer"
                          >
                            ยืนยัน
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmDeleteId(null)}
                            className="rounded border border-slate-300 bg-white px-2 py-1 text-slate-600 cursor-pointer"
                          >
                            ยกเลิก
                          </button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <div className="grid grid-cols-2 gap-1.5">
                          <button
                            type="button"
                            disabled={writingNewsForAssetId === item.id}
                            onClick={() => handleAiWriteNewsWithAsset(item)}
                            className="inline-flex items-center justify-center gap-1 rounded bg-slate-900 px-2.5 py-1.5 text-[11px] font-semibold text-white hover:bg-slate-800 cursor-pointer disabled:opacity-50"
                          >
                            <Sparkles className="w-3 h-3 text-amber-400" />
                            {writingNewsForAssetId === item.id
                              ? 'กำลังร่าง...'
                              : 'AI ร่างบทความ'}
                          </button>

                          <button
                            type="button"
                            onClick={() => handleSendAssetToPostEditor(item)}
                            className="inline-flex items-center justify-center gap-1 rounded border border-slate-300 bg-white px-2.5 py-1.5 text-[11px] font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
                          >
                            <FilePlus2 className="w-3 h-3" />
                            แนบลงเนื้อหา
                          </button>
                        </div>

                        <div className="flex items-center justify-between pt-1.5 border-t border-slate-100 text-[11px]">
                          <div className="flex items-center gap-2">
                            {isPending && (
                              <button
                                type="button"
                                onClick={() => handleApproveAsset(item)}
                                className="font-semibold text-emerald-700 hover:underline cursor-pointer"
                              >
                                อนุมัติ
                              </button>
                            )}
                            <a
                              href={item.fileUrl}
                              download
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-1 text-slate-600 hover:text-slate-900"
                            >
                              <Download className="w-3 h-3" /> ดาวน์โหลด
                            </a>
                          </div>

                          <button
                            type="button"
                            onClick={() => setConfirmDeleteId(item.id)}
                            className="text-rose-600 hover:text-rose-800 cursor-pointer p-1"
                            title="ลบไฟล์"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Fullscreen Lightbox Modal */}
      {zoomAsset && (
        <div
          className="fixed inset-0 z-50 bg-slate-950/85 flex items-center justify-center p-4"
          onClick={() => setZoomAsset(null)}
        >
          <div
            className="max-w-4xl w-full space-y-3"
            onClick={(e) => e.stopPropagation()}
          >
            <img
              src={zoomAsset.fileUrl}
              alt={zoomAsset.thaiSummary || zoomAsset.prompt}
              className="w-full max-h-[78vh] object-contain rounded-lg bg-black border border-slate-800"
            />
            <div className="flex flex-wrap items-center justify-between gap-2 bg-slate-900 border border-slate-800 rounded-lg px-4 py-3 text-xs text-white">
              <span className="truncate max-w-lg text-slate-300">
                {zoomAsset.thaiSummary || zoomAsset.prompt}
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    const target = zoomAsset;
                    setZoomAsset(null);
                    handleSendAssetToPostEditor(target);
                  }}
                  className="rounded bg-emerald-600 px-3 py-1.5 font-semibold text-white hover:bg-emerald-700 cursor-pointer"
                >
                  นำไปสร้างเนื้อหา
                </button>
                <button
                  type="button"
                  onClick={() => setZoomAsset(null)}
                  className="rounded bg-slate-800 px-3 py-1.5 font-semibold text-slate-200 hover:bg-slate-700 cursor-pointer"
                >
                  ปิดหน้าต่าง
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
