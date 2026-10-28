import React, { useEffect, useState } from 'react';
import {
  Plus,
  Search,
  Edit3,
  Trash2,
  Eye,
  Star,
  Upload,
  Sparkles,
  Image as ImageIcon,
  CheckCircle2,
  ArrowLeft,
  AlertTriangle,
  KeyRound,
  Video,
  FileText,
  GraduationCap,
  Newspaper,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import {
  Post,
  CategoryId,
  ContentType,
  PostStatus,
  CATEGORIES,
} from '../types';
import { api, formatThaiDate, formatViews } from '../api';

interface Props {
  posts: Post[];
  initialEditPost?: Post | null;
  openCreateImmediately?: boolean;
  onClearInitialEdit?: () => void;
  onRefresh: () => Promise<void>;
  onPreviewPost: (id: number) => void;
  onOpenSettings?: () => void;
}

const PRESET_IMAGES = [
  { label: 'ภาพการศึกษา & AI', url: '/images/thumb-ai-edu.jpg' },
  { label: 'ภาพอาจารย์คมกฤชบรรยาย', url: '/images/featured-speaker.jpg' },
  { label: 'ภาพห้องเรียน & โรงเรียน', url: '/images/thumb-school.jpg' },
  { label: 'ภาพเมืองภูเก็ต & การเรียนรู้', url: '/images/thumb-phuket.jpg' },
  { label: 'ภาพเทคโนโลยีอนาคต', url: '/images/thumb-agentic.jpg' },
];

const CONTENT_TYPES: { id: ContentType; label: string; icon: React.ReactNode }[] = [
  { id: 'news', label: 'ข่าวประชาสัมพันธ์', icon: <Newspaper className="w-4 h-4" /> },
  { id: 'article', label: 'บทความ / ความรู้', icon: <FileText className="w-4 h-4" /> },
  { id: 'video', label: 'คลิปวิดีโอ', icon: <Video className="w-4 h-4" /> },
  { id: 'course', label: 'คอร์ส / งานอบรม', icon: <GraduationCap className="w-4 h-4" /> },
];

export const PostCrudManager: React.FC<Props> = ({
  posts,
  initialEditPost,
  openCreateImmediately,
  onClearInitialEdit,
  onRefresh,
  onPreviewPost,
  onOpenSettings,
}) => {
  const [search, setSearch] = useState('');
  const [quickFilter, setQuickFilter] = useState<'all' | 'published' | 'draft' | 'video'>('all');

  // Full-page clean editor mode (no accidental close on outside click!)
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [showExtraFields, setShowExtraFields] = useState(false);

  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadingVideo, setUploadingVideo] = useState(false);
  const [deleteConfirmId, setDeleteConfirmId] = useState<number | null>(null);

  const [form, setForm] = useState({
    title: '',
    subtitle: '',
    excerpt: '',
    content: '',
    category: 'education' as CategoryId,
    contentType: 'news' as ContentType,
    coverImage: '/images/thumb-ai-edu.jpg',
    videoUrl: '',
    audioUrl: '',
    tagsText: 'คมคิด by KOMKRIT, การศึกษา',
    author: 'คมกฤช (Komkrit)',
    status: 'published' as PostStatus,
    isFeatured: false,
  });

  useEffect(() => {
    if (initialEditPost) {
      openEdit(initialEditPost);
      onClearInitialEdit?.();
    } else if (openCreateImmediately) {
      openCreate();
      onClearInitialEdit?.();
    }
  }, [initialEditPost, openCreateImmediately]);

  const showToast = (msg: string) => {
    setSuccessMsg(msg);
    setTimeout(() => {
      setSuccessMsg((prev) => (prev === msg ? null : prev));
    }, 4500);
  };

  const openCreate = () => {
    setEditingId(null);
    setErrorMsg(null);
    setShowExtraFields(false);
    setForm({
      title: '',
      subtitle: '',
      excerpt: '',
      content: '',
      category: 'education',
      contentType: 'news',
      coverImage: '/images/thumb-ai-edu.jpg',
      videoUrl: '',
      audioUrl: '',
      tagsText: 'คมคิด by KOMKRIT, ข่าวการศึกษา',
      author: 'คมกฤช (Komkrit)',
      status: 'published',
      isFeatured: false,
    });
    setEditorOpen(true);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const openEdit = (p: Post) => {
    setEditingId(p.id);
    setErrorMsg(null);
    setShowExtraFields(Boolean(p.videoUrl || p.subtitle));
    setForm({
      title: p.title,
      subtitle: p.subtitle || '',
      excerpt: p.excerpt || '',
      content: p.content || '',
      category: p.category,
      contentType: p.contentType,
      coverImage: p.coverImage || '/images/thumb-ai-edu.jpg',
      videoUrl: p.videoUrl || '',
      audioUrl: p.audioUrl || '',
      tagsText: (p.tags || []).join(', '),
      author: p.author || 'คมกฤช (Komkrit)',
      status: p.status,
      isFeatured: p.isFeatured,
    });
    setEditorOpen(true);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const savePostWithStatus = async (targetStatus: PostStatus) => {
    if (!form.title.trim()) {
      setErrorMsg('กรุณาพิมพ์ "หัวข้อข่าว / ชื่อเรื่อง" ก่อนกดบันทึกครับ');
      return;
    }
    if (!form.content.trim()) {
      setErrorMsg('กรุณาพิมพ์ "เนื้อหาข่าว / บทความ" ก่อนกดบันทึกครับ');
      return;
    }

    setSaving(true);
    setErrorMsg(null);
    try {
      const cleanPlain = form.content.replace(/[#>*_`]/g, '').replace(/\s+/g, ' ').trim();
      const payload: Partial<Post> = {
        title: form.title.trim(),
        subtitle: form.subtitle.trim(),
        excerpt: form.excerpt.trim() || cleanPlain.slice(0, 170),
        content: form.content,
        category: form.category,
        contentType: form.contentType,
        coverImage: form.coverImage || '/images/thumb-ai-edu.jpg',
        videoUrl: form.videoUrl.trim(),
        audioUrl: form.audioUrl.trim(),
        tags: form.tagsText
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean),
        author: form.author.trim() || 'คมกฤช (Komkrit)',
        status: targetStatus,
        isFeatured: form.isFeatured,
      };

      if (editingId) {
        await api.updatePost(editingId, payload);
        await onRefresh();
        setEditorOpen(false);
        showToast('บันทึกการแก้ไขข่าวเรียบร้อยแล้ว! ข้อมูลอัปเดตบนหน้าเว็บทันที');
      } else {
        await api.createPost(payload);
        await onRefresh();
        setEditorOpen(false);
        showToast(
          targetStatus === 'published'
            ? 'ลงข่าวใหม่เรียบร้อยแล้ว! ข่าวขึ้นแสดงบนหน้าเว็บทันที'
            : 'บันทึกข่าวเก็บไว้เรียบร้อยแล้ว (ยังไม่แสดงบนหน้าเว็บ)'
        );
      }
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err) {
      setErrorMsg((err as Error).message || 'เกิดข้อผิดพลาดในการบันทึกข้อมูล กรุณาลองใหม่อีกครั้ง');
    } finally {
      setSaving(false);
    }
  };

  const handleUploadFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setErrorMsg(null);
    try {
      const url = await api.uploadImage(file);
      setForm((prev) => ({ ...prev, coverImage: url }));
    } catch (err) {
      setErrorMsg((err as Error).message);
    } finally {
      setUploading(false);
    }
  };

  const handleUploadVideoFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingVideo(true);
    setErrorMsg(null);
    try {
      const url = await api.uploadFile(file);
      setForm((prev) => ({ ...prev, videoUrl: url, contentType: 'video' }));
    } catch (err) {
      setErrorMsg((err as Error).message);
    } finally {
      setUploadingVideo(false);
    }
  };

  const handleAiGenerateFull = async () => {
    if (!form.title.trim()) {
      setErrorMsg('กรุณาพิมพ์หัวข้อข่าวด้านล่างก่อน แล้วค่อยกดปุ่มให้ AI ช่วยเขียนครับ');
      return;
    }
    setAiLoading(true);
    setErrorMsg(null);
    try {
      const res = await api.aiAssistPost({
        title: form.title,
        category: form.category,
        mode: 'generate_full',
      });
      setForm((prev) => ({
        ...prev,
        subtitle: res.subtitle || prev.subtitle,
        excerpt: res.excerpt || prev.excerpt,
        content: res.content || prev.content,
        tagsText: Array.isArray(res.tags) ? res.tags.join(', ') : prev.tagsText,
        coverImage: res.coverImage || prev.coverImage,
      }));
    } catch (err) {
      setErrorMsg((err as Error).message);
    } finally {
      setAiLoading(false);
    }
  };

  const handleAiGenerateCover = async () => {
    setAiLoading(true);
    setErrorMsg(null);
    try {
      const res = await api.aiAssistPost({
        title: form.title || 'คมคิด by KOMKRIT การศึกษายุค AI',
        category: form.category,
        mode: 'generate_real_image',
      });
      if (res.coverImage) {
        setForm((prev) => ({ ...prev, coverImage: res.coverImage }));
      }
    } catch (err) {
      setErrorMsg((err as Error).message);
    } finally {
      setAiLoading(false);
    }
  };

  const handleToggleFeatured = async (post: Post) => {
    setBusyId(post.id);
    setErrorMsg(null);
    try {
      await api.updatePost(post.id, { isFeatured: !post.isFeatured });
      await onRefresh();
      showToast(
        !post.isFeatured
          ? `ตั้ง "${post.title}" เป็นข่าวเด่นหน้าแรกแล้ว`
          : 'ยกเลิกการตั้งเป็นข่าวเด่นหน้าแรกแล้ว'
      );
    } catch (err) {
      setErrorMsg((err as Error).message);
    } finally {
      setBusyId(null);
    }
  };

  const handleToggleStatus = async (post: Post) => {
    setBusyId(post.id);
    setErrorMsg(null);
    try {
      const nextStatus: PostStatus =
        post.status === 'published' ? 'draft' : 'published';
      await api.updatePost(post.id, { status: nextStatus });
      await onRefresh();
      showToast(
        nextStatus === 'published'
          ? `เปิดแสดงข่าว "${post.title}" บนหน้าเว็บแล้ว`
          : `ซ่อนข่าว "${post.title}" ออกจากหน้าเว็บชั่วคราวแล้ว`
      );
    } catch (err) {
      setErrorMsg((err as Error).message);
    } finally {
      setBusyId(null);
    }
  };

  const handleConfirmDelete = async (id: number) => {
    setBusyId(id);
    setErrorMsg(null);
    try {
      await api.deletePost(id);
      setDeleteConfirmId(null);
      await onRefresh();
      showToast('ลบข่าวออกจากเว็บไซต์เรียบร้อยแล้ว');
    } catch (err) {
      setErrorMsg((err as Error).message);
    } finally {
      setBusyId(null);
    }
  };

  const filtered = posts.filter((p) => {
    if (quickFilter === 'published' && p.status !== 'published') return false;
    if (quickFilter === 'draft' && p.status !== 'draft') return false;
    if (quickFilter === 'video' && p.contentType !== 'video' && !p.videoUrl) return false;
    if (search.trim()) {
      const q = search.toLowerCase();
      return (
        p.title.toLowerCase().includes(q) ||
        p.excerpt.toLowerCase().includes(q) ||
        p.content.toLowerCase().includes(q)
      );
    }
    return true;
  });

  // ============================================================================
  // VIEW 1: SIMPLE FULL-PAGE WRITE / EDIT SCREEN (ELDER-FRIENDLY, LARGE FONTS!)
  // ============================================================================
  if (editorOpen) {
    return (
      <div className="max-w-4xl mx-auto space-y-5">
        {/* Back button + Clear Heading */}
        <div className="flex flex-wrap items-center justify-between gap-3 bg-white rounded-2xl p-5 border border-slate-200 shadow-2xs">
          <div>
            <button
              type="button"
              onClick={() => setEditorOpen(false)}
              className="inline-flex items-center gap-2 text-sm font-bold text-slate-600 hover:text-[#0d2546] mb-1.5 cursor-pointer"
            >
              <ArrowLeft className="w-4 h-4" />
              กลับไปหน้ารายการข่าวทั้งหมด
            </button>
            <h2 className="text-xl sm:text-2xl font-extrabold text-[#0d2546]">
              {editingId ? '✏️ แก้ไขข่าว / บทความ' : '➕ ลงข่าว / เขียนบทความใหม่'}
            </h2>
          </div>

          <button
            type="button"
            disabled={saving}
            onClick={() => savePostWithStatus('published')}
            className="inline-flex items-center gap-2 rounded-2xl bg-emerald-600 px-6 py-3.5 text-base font-extrabold text-white hover:bg-emerald-700 shadow-sm transition cursor-pointer disabled:opacity-50"
          >
            <CheckCircle2 className="w-5 h-5" />
            {saving
              ? 'กำลังบันทึก...'
              : editingId
              ? 'บันทึกการแก้ไข'
              : 'ลงข่าวขึ้นหน้าเว็บ'}
          </button>
        </div>

        {errorMsg && (
          <div className="rounded-2xl bg-rose-50 border-2 border-rose-300 p-4 text-sm sm:text-base text-rose-900 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2.5 font-bold">
              <AlertTriangle className="w-5 h-5 text-rose-600 shrink-0" />
              <span>{errorMsg}</span>
            </div>
            {onOpenSettings && errorMsg.includes('API Key') && (
              <button
                type="button"
                onClick={() => {
                  setEditorOpen(false);
                  onOpenSettings();
                }}
                className="inline-flex items-center gap-1.5 rounded-xl bg-[#0d2546] px-4 py-2 text-sm font-bold text-amber-300 hover:bg-[#193d6e] cursor-pointer"
              >
                <KeyRound className="w-4 h-4" /> ไปหน้าตั้งค่าคีย์ AI
              </button>
            )}
          </div>
        )}

        <div className="bg-white rounded-2xl border border-slate-200 p-5 sm:p-7 space-y-7 shadow-2xs">
          {/* STEP 1: HEADLINE */}
          <div className="space-y-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <label className="text-base sm:text-lg font-extrabold text-[#0d2546]">
                1. หัวข้อข่าว หรือ ชื่อบทความ <span className="text-rose-600">*</span>
              </label>
              <button
                type="button"
                disabled={aiLoading}
                onClick={handleAiGenerateFull}
                className="inline-flex items-center gap-2 rounded-xl bg-amber-400 px-4 py-2 text-sm font-extrabold text-[#0b1f3a] hover:bg-amber-300 transition cursor-pointer disabled:opacity-50"
              >
                <Sparkles className="w-4 h-4" />
                {aiLoading ? 'AI กำลังเขียนเนื้อหาให้...' : '✨ ให้ AI ช่วยเขียนเนื้อหาจากหัวข้อนี้'}
              </button>
            </div>
            <input
              type="text"
              required
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              placeholder="พิมพ์ชื่อหัวข้อข่าวที่นี่..."
              className="w-full rounded-2xl border-2 border-slate-200 px-4 py-3.5 text-base sm:text-lg font-bold text-[#0d2546] placeholder:font-normal placeholder:text-slate-400 focus:border-[#0d2546] focus:outline-none"
            />
          </div>

          {/* STEP 2: TYPE & CATEGORY (BIG EASY BUTTONS) */}
          <div className="space-y-4">
            <div>
              <label className="block text-base sm:text-lg font-extrabold text-[#0d2546] mb-2.5">
                2. ประเภทและหมวดหมู่ของข่าว
              </label>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                {CONTENT_TYPES.map((ct) => {
                  const selected = form.contentType === ct.id;
                  return (
                    <button
                      key={ct.id}
                      type="button"
                      onClick={() => setForm({ ...form, contentType: ct.id })}
                      className={`flex items-center justify-center gap-2 rounded-xl border-2 px-3 py-3 text-sm font-extrabold transition cursor-pointer ${
                        selected
                          ? 'border-[#0d2546] bg-[#0d2546] text-white shadow-xs'
                          : 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100'
                      }`}
                    >
                      {ct.icon}
                      {ct.label}
                    </button>
                  );
                })}
              </div>
            </div>

            <div>
              <span className="block text-sm font-bold text-slate-600 mb-2">
                เลือกหมวดหมู่ที่จะแสดงบนหน้าเว็บ:
              </span>
              <div className="flex flex-wrap gap-2">
                {CATEGORIES.map((c) => {
                  const selected = form.category === c.id;
                  return (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => setForm({ ...form, category: c.id })}
                      className={`rounded-xl px-4 py-2.5 text-sm font-bold transition cursor-pointer border-2 ${
                        selected
                          ? 'text-white border-transparent shadow-xs'
                          : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                      }`}
                      style={selected ? { backgroundColor: c.color } : undefined}
                    >
                      {c.nameTh}
                    </button>
                  );
                })}
              </div>
            </div>

            <label className="inline-flex items-center gap-3 rounded-xl border-2 border-amber-300 bg-amber-50 px-4 py-3 text-sm sm:text-base font-extrabold text-amber-950 cursor-pointer">
              <input
                type="checkbox"
                checked={form.isFeatured}
                onChange={(e) => setForm({ ...form, isFeatured: e.target.checked })}
                className="h-5 w-5 accent-[#0d2546]"
              />
              ⭐ ตั้งเป็น "ข่าวเด่นพิเศษ" แสดงกรอบใหญ่สุดบนหน้าแรก
            </label>
          </div>

          {/* STEP 3: COVER PHOTO */}
          <div className="space-y-3 rounded-2xl bg-slate-50 border border-slate-200 p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <label className="text-base sm:text-lg font-extrabold text-[#0d2546]">
                3. รูปภาพหน้าปกข่าว
              </label>
              <div className="flex flex-wrap gap-2">
                <label className="inline-flex items-center gap-2 rounded-xl bg-[#0d2546] px-5 py-3 text-sm sm:text-base font-extrabold text-white hover:bg-[#193d6e] cursor-pointer shadow-xs">
                  <Upload className="w-5 h-5 text-amber-300" />
                  {uploading ? 'กำลังอัปโหลดรูป...' : '📷 เลือกรูปจากเครื่อง / มือถือ'}
                  <input
                    type="file"
                    accept="image/*"
                    onChange={handleUploadFile}
                    className="hidden"
                  />
                </label>

                <button
                  type="button"
                  disabled={aiLoading}
                  onClick={handleAiGenerateCover}
                  className="inline-flex items-center gap-2 rounded-xl border-2 border-slate-300 bg-white px-4 py-3 text-sm font-bold text-[#0d2546] hover:bg-slate-100 cursor-pointer disabled:opacity-50"
                >
                  <ImageIcon className="w-4 h-4 text-amber-600" />
                  ให้ AI วาดรูปปกให้
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-12 gap-4 items-center pt-1">
              <div className="sm:col-span-5">
                <img
                  src={form.coverImage}
                  alt="ตัวอย่างรูปหน้าปก"
                  className="h-44 w-full rounded-2xl object-cover border-2 border-white shadow-sm bg-[#0d2546]"
                />
              </div>
              <div className="sm:col-span-7 space-y-2.5">
                <div className="text-sm font-bold text-slate-600">
                  หรือกดเลือกจากรูปภาพมาตรฐานด้านล่างได้ทันที:
                </div>
                <div className="flex flex-wrap gap-2">
                  {PRESET_IMAGES.map((img) => {
                    const active = form.coverImage === img.url;
                    return (
                      <button
                        key={img.url}
                        type="button"
                        onClick={() => setForm({ ...form, coverImage: img.url })}
                        className={`rounded-xl border-2 px-3.5 py-2 text-sm font-bold transition cursor-pointer ${
                          active
                            ? 'border-[#0d2546] bg-[#0d2546] text-white'
                            : 'border-slate-200 bg-white text-slate-700 hover:border-amber-400'
                        }`}
                      >
                        {img.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>

          {/* VIDEO LINK (Shown automatically if contentType === 'video') */}
          {form.contentType === 'video' && (
            <div className="rounded-2xl bg-rose-50/70 border border-rose-200 p-5 space-y-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <label className="text-base font-extrabold text-rose-950">
                  🎬 ลิงก์คลิป YouTube หรืออัปโหลดไฟล์วิดีโอจากเครื่อง
                </label>
                <label className="inline-flex items-center gap-1.5 rounded-xl bg-rose-700 px-4 py-2 text-sm font-bold text-white hover:bg-rose-800 cursor-pointer">
                  <Upload className="w-4 h-4" />
                  {uploadingVideo ? 'กำลังอัปโหลดวิดีโอ...' : 'เลือกไฟล์วิดีโอ (.MP4)'}
                  <input
                    type="file"
                    accept="video/*"
                    onChange={handleUploadVideoFile}
                    className="hidden"
                  />
                </label>
              </div>
              <input
                type="text"
                value={form.videoUrl}
                onChange={(e) => setForm({ ...form, videoUrl: e.target.value })}
                placeholder="วางลิงก์ YouTube เช่น https://www.youtube.com/watch?v=..."
                className="w-full rounded-xl border-2 border-rose-200 bg-white px-4 py-3 text-base focus:border-rose-500 focus:outline-none"
              />
            </div>
          )}

          {/* STEP 4: MAIN CONTENT */}
          <div className="space-y-2.5">
            <label className="block text-base sm:text-lg font-extrabold text-[#0d2546]">
              4. เนื้อหาข่าว / รายละเอียดบทความ <span className="text-rose-600">*</span>
            </label>
            <p className="text-sm text-slate-500">
              พิมพ์ข้อความตามปกติได้เลยครับ กดขึ้นบรรทัดใหม่เพื่อแบ่งย่อหน้า ระบบจัดหน้าให้อัตโนมัติ
            </p>
            <textarea
              rows={12}
              required
              value={form.content}
              onChange={(e) => setForm({ ...form, content: e.target.value })}
              placeholder="พิมพ์เนื้อหาข่าวหรือบทความที่นี่..."
              className="w-full rounded-2xl border-2 border-slate-200 px-4 py-4 text-base sm:text-lg font-body leading-relaxed text-slate-800 focus:border-[#0d2546] focus:outline-none"
            />
          </div>

          {/* OPTIONAL EXTRA FIELDS (Tucked neatly away!) */}
          <div className="border-t border-slate-100 pt-4">
            <button
              type="button"
              onClick={() => setShowExtraFields((v) => !v)}
              className="inline-flex items-center gap-2 text-sm font-bold text-slate-600 hover:text-[#0d2546] cursor-pointer"
            >
              {showExtraFields ? (
                <ChevronUp className="w-4 h-4" />
              ) : (
                <ChevronDown className="w-4 h-4" />
              )}
              ตัวเลือกเสริม (คำโปรยย่อ / ลิงก์วิดีโอเพิ่มเติม / ชื่อผู้เขียน) — ไม่กรอกก็ได้
            </button>

            {showExtraFields && (
              <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-4 rounded-2xl bg-slate-50 p-4 border border-slate-200">
                <div className="sm:col-span-2">
                  <label className="block text-sm font-bold text-slate-700 mb-1">
                    คำโปรยสั้นๆ หน้าแรก (ถ้าเว้นว่าง ระบบดึงจากเนื้อหาข่าวให้อัตโนมัติ)
                  </label>
                  <textarea
                    rows={2}
                    value={form.excerpt}
                    onChange={(e) => setForm({ ...form, excerpt: e.target.value })}
                    placeholder="สรุปสั้นๆ 1-2 บรรทัด..."
                    className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm focus:border-[#0d2546] focus:outline-none"
                  />
                </div>
                {form.contentType !== 'video' && (
                  <div>
                    <label className="block text-sm font-bold text-slate-700 mb-1">
                      แนบลิงก์วิดีโอ YouTube (ถ้ามี)
                    </label>
                    <input
                      type="text"
                      value={form.videoUrl}
                      onChange={(e) => setForm({ ...form, videoUrl: e.target.value })}
                      placeholder="https://www.youtube.com/watch?v=..."
                      className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm focus:border-[#0d2546] focus:outline-none"
                    />
                  </div>
                )}
                <div>
                  <label className="block text-sm font-bold text-slate-700 mb-1">
                    ชื่อผู้เขียน
                  </label>
                  <input
                    type="text"
                    value={form.author}
                    onChange={(e) => setForm({ ...form, author: e.target.value })}
                    className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm focus:border-[#0d2546] focus:outline-none"
                  />
                </div>
              </div>
            )}
          </div>

          {/* HUGE CLEAR SAVE BUTTONS AT BOTTOM */}
          <div className="pt-5 border-t-2 border-slate-100 flex flex-wrap items-center justify-between gap-3">
            <button
              type="button"
              onClick={() => setEditorOpen(false)}
              className="rounded-2xl border-2 border-slate-200 px-6 py-3.5 text-base font-bold text-slate-600 hover:bg-slate-50 cursor-pointer"
            >
              ยกเลิก
            </button>

            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                disabled={saving}
                onClick={() => savePostWithStatus('draft')}
                className="rounded-2xl border-2 border-slate-300 bg-white px-5 py-3.5 text-sm sm:text-base font-bold text-slate-700 hover:bg-slate-100 cursor-pointer disabled:opacity-50"
              >
                บันทึกเก็บไว้ก่อน (ยังไม่แสดงหน้าเว็บ)
              </button>

              <button
                type="button"
                disabled={saving}
                onClick={() => savePostWithStatus('published')}
                className="inline-flex items-center gap-2 rounded-2xl bg-emerald-600 px-8 py-3.5 text-base sm:text-lg font-extrabold text-white hover:bg-emerald-700 shadow-md transition cursor-pointer disabled:opacity-50"
              >
                <CheckCircle2 className="w-5 h-5" />
                {saving
                  ? 'กำลังบันทึก...'
                  : editingId
                  ? 'บันทึกการแก้ไขและแสดงบนเว็บ'
                  : 'บันทึกและลงหน้าเว็บทันที'}
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ============================================================================
  // VIEW 2: NEWS & ARTICLES LIST (LARGE BUTTONS, ZERO JARGON!)
  // ============================================================================
  return (
    <div className="space-y-5">
      {/* Big Success Notification */}
      {successMsg && (
        <div className="rounded-2xl bg-emerald-600 text-white px-5 py-4 shadow-md flex items-center gap-3 text-base font-extrabold">
          <CheckCircle2 className="w-6 h-6 text-amber-300 shrink-0" />
          <span>{successMsg}</span>
        </div>
      )}

      {errorMsg && (
        <div className="rounded-2xl bg-rose-50 border-2 border-rose-300 px-5 py-4 text-base font-bold text-rose-800 flex items-center gap-3">
          <AlertTriangle className="w-5 h-5 text-rose-600 shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}

      {/* Main Action Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white rounded-2xl p-5 sm:p-6 border border-slate-200 shadow-2xs">
        <div>
          <h2 className="text-xl sm:text-2xl font-extrabold text-[#0d2546]">
            📰 ข่าวสารและบทความบนเว็บไซต์ ({posts.length} เรื่อง)
          </h2>
          <p className="text-sm text-slate-500 mt-1">
            กดปุ่มสีเขียวด้านขวาเพื่อลงข่าวใหม่ หรือกดปุ่ม "แก้ไขข่าว" ในรายการที่ต้องการแก้ได้เลยครับ
          </p>
        </div>
        <button
          onClick={openCreate}
          className="inline-flex items-center justify-center gap-2.5 rounded-2xl bg-emerald-600 px-6 py-4 text-base sm:text-lg font-extrabold text-white hover:bg-emerald-700 shadow-md transition cursor-pointer shrink-0"
        >
          <Plus className="w-6 h-6" />
          ลงข่าว / เขียนบทความใหม่
        </button>
      </div>

      {/* Simple Search & Filter Tabs */}
      <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3 bg-white rounded-2xl p-4 border border-slate-200">
        <div className="relative flex-1">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="พิมพ์ค้นหาชื่อข่าว หรือบทความ..."
            className="w-full rounded-xl border-2 border-slate-200 pl-10 pr-4 py-2.5 text-base focus:border-[#0d2546] focus:outline-none"
          />
          <Search className="w-5 h-5 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
        </div>

        <div className="flex flex-wrap gap-2">
          {[
            { id: 'all', label: `ทั้งหมด (${posts.length})` },
            {
              id: 'published',
              label: `แสดงบนเว็บ (${posts.filter((p) => p.status === 'published').length})`,
            },
            {
              id: 'draft',
              label: `ซ่อนไว้ (${posts.filter((p) => p.status === 'draft').length})`,
            },
            {
              id: 'video',
              label: `คลิปวิดีโอ (${posts.filter((p) => p.contentType === 'video' || Boolean(p.videoUrl)).length})`,
            },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setQuickFilter(tab.id as any)}
              className={`rounded-xl px-4 py-2.5 text-sm font-extrabold transition cursor-pointer ${
                quickFilter === tab.id
                  ? 'bg-[#0d2546] text-white'
                  : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Posts List with Large, Clear Thai Action Buttons */}
      <div className="space-y-3.5">
        {filtered.length === 0 ? (
          <div className="rounded-2xl bg-white p-12 text-center border border-slate-200 space-y-3">
            <p className="text-slate-600 text-base font-bold">ยังไม่มีข่าวในหมวดที่เลือก</p>
            <button
              onClick={openCreate}
              className="inline-flex items-center gap-2 rounded-2xl bg-emerald-600 px-6 py-3 text-base font-extrabold text-white cursor-pointer"
            >
              <Plus className="w-5 h-5" /> ลงข่าวเรื่องแรกเลย
            </button>
          </div>
        ) : (
          filtered.map((post) => {
            const cat =
              CATEGORIES.find((c) => c.id === post.category) || CATEGORIES[0];
            const isBusy = busyId === post.id;
            return (
              <div
                key={post.id}
                className={`rounded-2xl bg-white border-2 p-4 sm:p-5 shadow-2xs transition flex flex-col lg:flex-row lg:items-center justify-between gap-4 ${
                  post.isFeatured ? 'border-amber-400' : 'border-slate-200/90'
                } ${isBusy ? 'opacity-60 pointer-events-none' : ''}`}
              >
                <div className="flex items-start sm:items-center gap-4 min-w-0">
                  <img
                    src={post.coverImage}
                    alt={post.title}
                    className="h-24 w-32 sm:w-36 rounded-xl object-cover shrink-0 bg-[#0d2546]"
                  />
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className="rounded-lg px-3 py-1 text-xs font-extrabold text-white"
                        style={{ backgroundColor: cat.color }}
                      >
                        {cat.nameTh}
                      </span>
                      {post.isFeatured && (
                        <span className="rounded-lg bg-amber-100 px-3 py-1 text-xs font-extrabold text-amber-900">
                          ⭐ ข่าวเด่นหน้าแรก
                        </span>
                      )}
                      {post.status === 'draft' && (
                        <span className="rounded-lg bg-slate-200 px-3 py-1 text-xs font-extrabold text-slate-700">
                          ซ่อนไว้ (ยังไม่แสดงหน้าเว็บ)
                        </span>
                      )}
                    </div>

                    <h3 className="font-extrabold text-[#0d2546] text-base sm:text-lg line-clamp-1">
                      {post.title}
                    </h3>
                    <p className="text-sm text-slate-500 line-clamp-1 font-body">
                      {post.excerpt}
                    </p>
                    <div className="flex flex-wrap items-center gap-3 text-xs sm:text-sm text-slate-400 font-medium">
                      <span>ลงเมื่อ: {formatThaiDate(post.createdAt)}</span>
                      <span>• คนอ่าน {formatViews(post.views)} ครั้ง</span>
                    </div>
                  </div>
                </div>

                {/* Big Labeled Thai Buttons */}
                <div className="flex flex-wrap items-center gap-2.5 shrink-0 border-t lg:border-t-0 pt-3 lg:pt-0 border-slate-100">
                  <button
                    onClick={() => openEdit(post)}
                    className="inline-flex items-center gap-1.5 rounded-xl bg-[#0d2546] px-4 py-2.5 text-sm font-extrabold text-white hover:bg-[#193d6e] cursor-pointer shadow-2xs"
                  >
                    <Edit3 className="w-4 h-4 text-amber-300" /> แก้ไขข่าว
                  </button>

                  <button
                    onClick={() => onPreviewPost(post.id)}
                    className="inline-flex items-center gap-1.5 rounded-xl bg-slate-100 px-3.5 py-2.5 text-sm font-bold text-slate-700 hover:bg-slate-200 cursor-pointer"
                  >
                    <Eye className="w-4 h-4" /> เปิดอ่าน
                  </button>

                  <button
                    onClick={() => handleToggleStatus(post)}
                    className={`rounded-xl px-3.5 py-2.5 text-sm font-bold transition cursor-pointer ${
                      post.status === 'published'
                        ? 'bg-emerald-100 text-emerald-900 hover:bg-emerald-200'
                        : 'bg-slate-200 text-slate-700 hover:bg-slate-300'
                    }`}
                  >
                    {post.status === 'published' ? '🟢 แสดงบนเว็บ' : '⚪ กดเพื่อแสดงบนเว็บ'}
                  </button>

                  <button
                    onClick={() => handleToggleFeatured(post)}
                    className={`inline-flex items-center gap-1 rounded-xl px-3 py-2.5 text-sm font-bold transition cursor-pointer ${
                      post.isFeatured
                        ? 'bg-amber-100 text-amber-900'
                        : 'bg-slate-100 text-slate-600 hover:bg-amber-50 hover:text-amber-800'
                    }`}
                  >
                    <Star
                      className={`w-4 h-4 ${
                        post.isFeatured ? 'fill-amber-500 text-amber-500' : ''
                      }`}
                    />
                    {post.isFeatured ? 'ข่าวเด่น' : 'ตั้งเป็นเด่น'}
                  </button>

                  {deleteConfirmId === post.id ? (
                    <div className="flex items-center gap-1.5 bg-rose-50 border border-rose-200 rounded-xl p-1">
                      <button
                        onClick={() => handleConfirmDelete(post.id)}
                        className="rounded-lg bg-rose-600 px-3 py-2 text-sm font-extrabold text-white cursor-pointer"
                      >
                        ยืนยันลบข่าวนี้
                      </button>
                      <button
                        onClick={() => setDeleteConfirmId(null)}
                        className="rounded-lg bg-white px-3 py-2 text-sm font-bold text-slate-700 cursor-pointer"
                      >
                        ไม่ลบ
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setDeleteConfirmId(post.id)}
                      className="inline-flex items-center gap-1 rounded-xl bg-rose-50 px-3 py-2.5 text-sm font-bold text-rose-700 hover:bg-rose-600 hover:text-white transition cursor-pointer"
                    >
                      <Trash2 className="w-4 h-4" /> ลบ
                    </button>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
