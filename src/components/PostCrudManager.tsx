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
  X,
  CheckCircle2,
  FileText,
  Video,
  GraduationCap,
  Newspaper,
  KeyRound,
  AlertTriangle,
  Mic,
} from 'lucide-react';
import {
  Post,
  CategoryId,
  ContentType,
  PostStatus,
  CATEGORIES,
} from '../types';
import { api, formatThaiDate, formatViews } from '../api';
import { renderRichMarkdown } from './ArticleReaderModal';

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
  { label: 'AI & การศึกษา', url: '/images/thumb-ai-edu.jpg' },
  { label: 'บรรยายพิเศษ Komkrit', url: '/images/featured-speaker.jpg' },
  { label: 'โรงเรียน & อาชีพ', url: '/images/thumb-school.jpg' },
  { label: 'ภูเก็ต Lifelong Learning', url: '/images/thumb-phuket.jpg' },
  { label: 'AI Agentic', url: '/images/thumb-agentic.jpg' },
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
  const [filterCat, setFilterCat] = useState<string>('all');
  const [filterType, setFilterType] = useState<string>('all');
  const [filterStatus, setFilterStatus] = useState<string>('all');

  const [editorOpen, setEditorOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [previewTab, setPreviewTab] = useState<'write' | 'preview'>('write');
  const [saving, setSaving] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadingVideo, setUploadingVideo] = useState(false);
  const [uploadingAudio, setUploadingAudio] = useState(false);
  const [deleteConfirmId, setDeleteConfirmId] = useState<number | null>(null);

  const [form, setForm] = useState({
    title: '',
    subtitle: '',
    excerpt: '',
    content: '',
    category: 'education' as CategoryId,
    contentType: 'article' as ContentType,
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

  const openCreate = () => {
    setEditingId(null);
    setAiError(null);
    setForm({
      title: '',
      subtitle: '',
      excerpt: '',
      content: '',
      category: 'education',
      contentType: 'article',
      coverImage: '/images/thumb-ai-edu.jpg',
      videoUrl: '',
      audioUrl: '',
      tagsText: 'คมคิด by KOMKRIT, คิดต่างอย่างสร้างสรรค์',
      author: 'คมกฤช (Komkrit)',
      status: 'published',
      isFeatured: false,
    });
    setPreviewTab('write');
    setEditorOpen(true);
  };

  const openEdit = (p: Post) => {
    setEditingId(p.id);
    setAiError(null);
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
    setPreviewTab('write');
    setEditorOpen(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.title.trim()) return;
    setSaving(true);
    try {
      const payload: Partial<Post> = {
        title: form.title.trim(),
        subtitle: form.subtitle.trim(),
        excerpt:
          form.excerpt.trim() ||
          form.content.replace(/[#>*_`]/g, '').slice(0, 170),
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
        status: form.status,
        isFeatured: form.isFeatured,
      };

      if (editingId) {
        await api.updatePost(editingId, payload);
      } else {
        await api.createPost(payload);
      }
      await onRefresh();
      setEditorOpen(false);
    } finally {
      setSaving(false);
    }
  };

  const handleUploadFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const url = await api.uploadImage(file);
      setForm((prev) => ({ ...prev, coverImage: url }));
    } catch (err) {
      setAiError((err as Error).message);
    } finally {
      setUploading(false);
    }
  };

  const handleUploadVideoFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingVideo(true);
    try {
      const url = await api.uploadFile(file);
      setForm((prev) => ({ ...prev, videoUrl: url, contentType: 'video' }));
    } catch (err) {
      setAiError((err as Error).message);
    } finally {
      setUploadingVideo(false);
    }
  };

  const handleUploadAudioFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingAudio(true);
    try {
      const url = await api.uploadFile(file);
      setForm((prev) => ({ ...prev, audioUrl: url }));
    } catch (err) {
      setAiError((err as Error).message);
    } finally {
      setUploadingAudio(false);
    }
  };

  const handleAiGenerateFull = async () => {
    if (!form.title.trim()) {
      setAiError('กรุณาพิมพ์หัวข้อบทความ/ข่าวสารก่อนเพื่อให้ AI จริงช่วยเขียนเนื้อหาครับ');
      return;
    }
    setAiLoading(true);
    setAiError(null);
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
      setAiError((err as Error).message);
    } finally {
      setAiLoading(false);
    }
  };

  const handleAiGenerateCover = async () => {
    setAiLoading(true);
    setAiError(null);
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
      setAiError((err as Error).message);
    } finally {
      setAiLoading(false);
    }
  };

  const handleToggleFeatured = async (post: Post) => {
    await api.updatePost(post.id, { isFeatured: !post.isFeatured });
    await onRefresh();
  };

  const handleToggleStatus = async (post: Post) => {
    const nextStatus: PostStatus =
      post.status === 'published' ? 'draft' : 'published';
    await api.updatePost(post.id, { status: nextStatus });
    await onRefresh();
  };

  const handleConfirmDelete = async (id: number) => {
    await api.deletePost(id);
    setDeleteConfirmId(null);
    await onRefresh();
  };

  const insertMarkdownSnippet = (snippet: string) => {
    setForm((prev) => ({
      ...prev,
      content: prev.content ? `${prev.content}\n${snippet}` : snippet,
    }));
  };

  const filtered = posts.filter((p) => {
    if (filterCat !== 'all' && p.category !== filterCat) return false;
    if (filterType !== 'all' && p.contentType !== filterType) return false;
    if (filterStatus !== 'all' && p.status !== filterStatus) return false;
    if (search.trim()) {
      const q = search.toLowerCase();
      return (
        p.title.toLowerCase().includes(q) ||
        p.excerpt.toLowerCase().includes(q) ||
        p.tags.some((t) => t.toLowerCase().includes(q))
      );
    }
    return true;
  });

  const getTypeBadge = (t: ContentType) => {
    switch (t) {
      case 'news':
        return { label: 'ข่าวสาร', icon: <Newspaper className="w-3 h-3" />, cls: 'bg-sky-100 text-sky-900' };
      case 'video':
        return { label: 'วิดีโอ', icon: <Video className="w-3 h-3" />, cls: 'bg-rose-100 text-rose-900' };
      case 'course':
        return { label: 'คอร์ส/เวิร์กช็อป', icon: <GraduationCap className="w-3 h-3" />, cls: 'bg-purple-100 text-purple-900' };
      default:
        return { label: 'บทความ/ความรู้', icon: <FileText className="w-3 h-3" />, cls: 'bg-emerald-100 text-emerald-900' };
    }
  };

  return (
    <div className="space-y-5">
      {/* Header Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white rounded-2xl p-5 border border-slate-200/80 shadow-2xs">
        <div>
          <h2 className="text-xl font-extrabold text-[#0d2546]">
            ระบบจัดการข่าวสาร ความรู้ และโพสต์ (Full CRUD CMS)
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            สร้าง (Create) • อ่าน/ค้นหา (Read) • แก้ไข (Update) • ลบ (Delete) • ตั้งบทความพิเศษหน้าแรกแบบเรียลไทม์
          </p>
        </div>
        <button
          onClick={openCreate}
          className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#0d2546] px-4 py-2.5 text-sm font-bold text-white hover:bg-[#183d6e] shadow-xs transition cursor-pointer"
        >
          <Plus className="w-4 h-4 text-[#fbbf24]" />
          สร้างข่าวสาร / บทความใหม่
        </button>
      </div>

      {/* Filters */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 bg-white rounded-2xl p-4 border border-slate-200/80">
        <div className="sm:col-span-2 relative">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="ค้นหาชื่อโพสต์, เนื้อหา, แท็ก..."
            className="w-full rounded-xl border border-slate-200 pl-9 pr-3.5 py-2 text-sm focus:border-[#f59e0b] focus:outline-none"
          />
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
        </div>

        <select
          value={filterCat}
          onChange={(e) => setFilterCat(e.target.value)}
          className="rounded-xl border border-slate-200 px-3 py-2 text-sm focus:border-[#f59e0b] focus:outline-none"
        >
          <option value="all">ทุกหมวดหมู่ (7 หมวด)</option>
          {CATEGORIES.map((c) => (
            <option key={c.id} value={c.id}>
              {c.nameTh}
            </option>
          ))}
        </select>

        <select
          value={filterType}
          onChange={(e) => setFilterType(e.target.value)}
          className="rounded-xl border border-slate-200 px-3 py-2 text-sm focus:border-[#f59e0b] focus:outline-none"
        >
          <option value="all">ทุกประเภทโพสต์</option>
          <option value="article">บทความ / ความรู้</option>
          <option value="news">ข่าวสาร</option>
          <option value="video">วิดีโอ</option>
          <option value="course">คอร์ส / เวิร์กช็อป</option>
        </select>

        <select
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value)}
          className="rounded-xl border border-slate-200 px-3 py-2 text-sm focus:border-[#f59e0b] focus:outline-none"
        >
          <option value="all">ทุกสถานะ ({posts.length})</option>
          <option value="published">เผยแพร่แล้ว (Published)</option>
          <option value="draft">ฉบับร่าง (Draft)</option>
        </select>
      </div>

      {/* Posts List */}
      <div className="space-y-3">
        {filtered.length === 0 ? (
          <div className="rounded-2xl bg-white p-12 text-center border border-slate-200">
            <p className="text-slate-500 text-sm">ไม่พบรายการโพสต์ตามตัวกรองที่เลือก</p>
            <button
              onClick={openCreate}
              className="mt-3 inline-flex items-center gap-1.5 rounded-xl bg-[#f59e0b] px-4 py-2 text-xs font-extrabold text-[#0d2546] cursor-pointer"
            >
              <Plus className="w-4 h-4" /> สร้างโพสต์แรกเลย
            </button>
          </div>
        ) : (
          filtered.map((post) => {
            const cat =
              CATEGORIES.find((c) => c.id === post.category) || CATEGORIES[0];
            const typeMeta = getTypeBadge(post.contentType);
            return (
              <div
                key={post.id}
                className="rounded-2xl bg-white border border-slate-200/80 p-4 shadow-2xs hover:shadow-xs transition flex flex-col md:flex-row md:items-center justify-between gap-4"
              >
                <div className="flex items-start sm:items-center gap-3.5 min-w-0">
                  <img
                    src={post.coverImage}
                    alt={post.title}
                    className="h-20 w-28 sm:w-32 rounded-xl object-cover shrink-0 bg-[#0d2546]"
                  />
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5 mb-1">
                      <span
                        className="rounded-full px-2.5 py-0.5 text-[10.5px] font-bold text-white"
                        style={{ backgroundColor: cat.color }}
                      >
                        {cat.nameTh}
                      </span>
                      <span
                        className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[10.5px] font-bold ${typeMeta.cls}`}
                      >
                        {typeMeta.icon} {typeMeta.label}
                      </span>
                      {post.isFeatured && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2.5 py-0.5 text-[10.5px] font-extrabold text-amber-900">
                          ★ บทความพิเศษหน้าแรก
                        </span>
                      )}
                      {post.aiWorkflowId && (
                        <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-[10px] font-bold text-indigo-800">
                          🤖 AI Multi-Agent
                        </span>
                      )}
                    </div>

                    <h3 className="font-extrabold text-[#0d2546] text-sm sm:text-base line-clamp-1">
                      {post.title}
                    </h3>
                    <p className="text-xs text-slate-500 line-clamp-1 font-body mt-0.5">
                      {post.excerpt}
                    </p>
                    <div className="mt-1.5 flex flex-wrap items-center gap-3 text-[11px] text-slate-400">
                      <span>วันที่: {formatThaiDate(post.createdAt)}</span>
                      <span>👁 {formatViews(post.views)} วิว</span>
                      <span>💬 {post.commentsCount} ความเห็น</span>
                    </div>
                  </div>
                </div>

                {/* Action Buttons */}
                <div className="flex flex-wrap items-center gap-2 shrink-0 border-t md:border-t-0 pt-3 md:pt-0 border-slate-100">
                  <button
                    onClick={() => handleToggleStatus(post)}
                    className={`rounded-lg px-2.5 py-1.5 text-xs font-bold transition cursor-pointer ${
                      post.status === 'published'
                        ? 'bg-emerald-100 text-emerald-900 hover:bg-emerald-200'
                        : 'bg-slate-200 text-slate-700 hover:bg-slate-300'
                    }`}
                    title="คลิกเพื่อสลับสถานะ เผยแพร่ / ฉบับร่าง"
                  >
                    {post.status === 'published' ? '● เผยแพร่แล้ว' : '○ ฉบับร่าง'}
                  </button>

                  <button
                    onClick={() => handleToggleFeatured(post)}
                    className={`rounded-lg p-2 transition cursor-pointer ${
                      post.isFeatured
                        ? 'bg-amber-100 text-amber-700'
                        : 'bg-slate-100 text-slate-400 hover:text-amber-600'
                    }`}
                    title="ตั้งเป็นบทความเด่น (Featured Hero)"
                  >
                    <Star
                      className={`w-4 h-4 ${
                        post.isFeatured ? 'fill-amber-500 text-amber-500' : ''
                      }`}
                    />
                  </button>

                  <button
                    onClick={() => onPreviewPost(post.id)}
                    className="inline-flex items-center gap-1 rounded-lg bg-slate-100 px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-200 cursor-pointer"
                  >
                    <Eye className="w-3.5 h-3.5" /> ดูหน้าเว็บ
                  </button>

                  <button
                    onClick={() => openEdit(post)}
                    className="inline-flex items-center gap-1 rounded-lg bg-[#0d2546] px-3 py-1.5 text-xs font-bold text-white hover:bg-[#193d6e] cursor-pointer"
                  >
                    <Edit3 className="w-3.5 h-3.5" /> แก้ไข
                  </button>

                  {deleteConfirmId === post.id ? (
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => handleConfirmDelete(post.id)}
                        className="rounded-lg bg-rose-600 px-2.5 py-1.5 text-xs font-bold text-white cursor-pointer"
                      >
                        ยืนยันลบ
                      </button>
                      <button
                        onClick={() => setDeleteConfirmId(null)}
                        className="rounded-lg bg-slate-200 px-2 py-1.5 text-xs font-bold text-slate-700 cursor-pointer"
                      >
                        ยกเลิก
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setDeleteConfirmId(post.id)}
                      className="rounded-lg bg-rose-50 p-2 text-rose-600 hover:bg-rose-600 hover:text-white transition cursor-pointer"
                      title="ลบโพสต์"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* CREATE / EDIT MODAL */}
      {editorOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 backdrop-blur-xs p-2 sm:p-5 overflow-y-auto"
          onClick={() => setEditorOpen(false)}
        >
          <div
            className="my-auto w-full max-w-4xl max-h-[93vh] overflow-y-auto rounded-2xl bg-white shadow-2xl border border-slate-200"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="sticky top-0 z-20 flex items-center justify-between bg-white px-5 py-4 border-b border-slate-100">
              <div>
                <h3 className="text-lg font-extrabold text-[#0d2546]">
                  {editingId
                    ? `แก้ไขโพสต์ #${editingId}`
                    : 'สร้างข่าวสาร / ความรู้ / โพสต์ใหม่'}
                </h3>
                <p className="text-xs text-slate-500">
                  บันทึกข้อมูลลงฐานข้อมูล SQLite พร้อมอัปเดตหน้าเว็บ Responsive ทันที
                </p>
              </div>
              <button
                onClick={() => setEditorOpen(false)}
                className="rounded-full p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSave} className="p-5 sm:p-6 space-y-4">
              {aiError && (
                <div className="rounded-xl bg-rose-50 border border-rose-200 p-3 text-xs text-rose-900 flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
                    <span className="font-semibold">{aiError}</span>
                  </div>
                  {onOpenSettings && (
                    <button
                      type="button"
                      onClick={() => {
                        setEditorOpen(false);
                        onOpenSettings();
                      }}
                      className="inline-flex items-center gap-1 rounded-lg bg-[#0d2546] px-3 py-1.5 text-[11px] font-extrabold text-amber-300 hover:bg-[#193d6e] cursor-pointer"
                    >
                      <KeyRound className="w-3.5 h-3.5" /> ไปตั้งค่า API Keys
                    </button>
                  )}
                </div>
              )}

              {/* Title + AI Quick Assist */}
              <div>
                <div className="flex flex-wrap items-center justify-between gap-2 mb-1.5">
                  <label className="text-xs font-extrabold text-[#0d2546]">
                    หัวข้อข่าวสาร / บทความ (Title) *
                  </label>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <button
                      type="button"
                      disabled={aiLoading}
                      onClick={handleAiGenerateFull}
                      className="inline-flex items-center gap-1 rounded-full bg-gradient-to-r from-[#f59e0b] to-[#d97706] px-3 py-1 text-[11px] font-extrabold text-[#0b1f3a] hover:brightness-105 cursor-pointer disabled:opacity-50"
                    >
                      <Sparkles className="w-3 h-3" />
                      {aiLoading ? 'AI จริงกำลังทำงาน...' : 'ให้ AI จริงช่วยเขียนเนื้อหาเต็มจากหัวข้อ'}
                    </button>
                    <button
                      type="button"
                      disabled={aiLoading}
                      onClick={handleAiGenerateCover}
                      className="inline-flex items-center gap-1 rounded-full bg-[#0d2546] px-3 py-1 text-[11px] font-bold text-amber-300 hover:bg-[#193d6e] cursor-pointer disabled:opacity-50"
                    >
                      <ImageIcon className="w-3 h-3" />
                      สร้างภาพปกจริงด้วย AI (Nano Banana 2.1 / DALL-E)
                    </button>
                  </div>
                </div>
                <input
                  type="text"
                  required
                  value={form.title}
                  onChange={(e) => setForm({ ...form, title: e.target.value })}
                  placeholder="เช่น แนวทางพัฒนาทักษะภาษาและ AI สำหรับนักเรียนไทยยุคใหม่"
                  className="w-full rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold focus:border-[#f59e0b] focus:outline-none"
                />
              </div>

              {/* Subtitle */}
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  หัวข้อรอง / คำโปรยนำ (Subtitle)
                </label>
                <input
                  type="text"
                  value={form.subtitle}
                  onChange={(e) => setForm({ ...form, subtitle: e.target.value })}
                  placeholder="ประโยคขยายความสั้นๆ ใต้หัวข้อหลัก"
                  className="w-full rounded-xl border border-slate-200 px-4 py-2 text-sm focus:border-[#f59e0b] focus:outline-none"
                />
              </div>

              {/* Category, Type, Status, Featured */}
              <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    หมวดหมู่
                  </label>
                  <select
                    value={form.category}
                    onChange={(e) =>
                      setForm({ ...form, category: e.target.value as CategoryId })
                    }
                    className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:border-[#f59e0b] focus:outline-none"
                  >
                    {CATEGORIES.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.nameTh}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    ประเภทโพสต์
                  </label>
                  <select
                    value={form.contentType}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        contentType: e.target.value as ContentType,
                      })
                    }
                    className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:border-[#f59e0b] focus:outline-none"
                  >
                    <option value="article">บทความ / ความรู้</option>
                    <option value="news">ข่าวสาร</option>
                    <option value="video">วิดีโอ</option>
                    <option value="course">คอร์ส / เวิร์กช็อป</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    สถานะเผยแพร่
                  </label>
                  <select
                    value={form.status}
                    onChange={(e) =>
                      setForm({ ...form, status: e.target.value as PostStatus })
                    }
                    className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:border-[#f59e0b] focus:outline-none"
                  >
                    <option value="published">เผยแพร่ทันที (Published)</option>
                    <option value="draft">บันทึกฉบับร่าง (Draft)</option>
                  </select>
                </div>

                <div className="flex items-end">
                  <label className="flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50/70 px-3 py-2 text-xs font-bold text-amber-950 w-full cursor-pointer">
                    <input
                      type="checkbox"
                      checked={form.isFeatured}
                      onChange={(e) =>
                        setForm({ ...form, isFeatured: e.target.checked })
                      }
                      className="rounded accent-[#0d2546]"
                    />
                    ตั้งเป็นบทความพิเศษเด่น
                  </label>
                </div>
              </div>

              {/* Cover Image Upload & Gallery */}
              <div className="rounded-xl bg-slate-50 border border-slate-200/80 p-4 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <label className="text-xs font-extrabold text-[#0d2546]">
                    รูปภาพหน้าปก (อัปโหลดจากเครื่อง / เลือกเทมเพลต / URL / AI Infographic)
                  </label>
                  <label className="inline-flex items-center gap-1.5 rounded-lg bg-[#0d2546] px-3 py-1.5 text-xs font-bold text-white hover:bg-[#193d6e] cursor-pointer">
                    <Upload className="w-3.5 h-3.5" />
                    {uploading ? 'กำลังอัปโหลด...' : 'อัปโหลดรูปจากเครื่อง'}
                    <input
                      type="file"
                      accept="image/*"
                      onChange={handleUploadFile}
                      className="hidden"
                    />
                  </label>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 items-center">
                  <div className="sm:col-span-4">
                    <img
                      src={form.coverImage}
                      alt="Cover preview"
                      className="h-28 w-full rounded-xl object-cover border border-slate-200 bg-[#0d2546]"
                    />
                  </div>
                  <div className="sm:col-span-8 space-y-2">
                    <input
                      type="text"
                      value={
                        form.coverImage.startsWith('data:image/svg')
                          ? '[AI Generated SVG Infographic Cover]'
                          : form.coverImage
                      }
                      onChange={(e) =>
                        setForm({ ...form, coverImage: e.target.value })
                      }
                      placeholder="วางลิงก์รูปภาพ หรือเลือกจากด้านล่าง..."
                      className="w-full rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs focus:border-[#f59e0b] focus:outline-none"
                    />
                    <div className="flex flex-wrap gap-1.5">
                      {PRESET_IMAGES.map((img) => (
                        <button
                          key={img.url}
                          type="button"
                          onClick={() =>
                            setForm({ ...form, coverImage: img.url })
                          }
                          className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-700 hover:border-[#f59e0b] cursor-pointer"
                        >
                          {img.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </div>

              {/* Excerpt */}
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  เนื้อหาย่อสำหรับแสดงในการ์ดหน้าแรก (Excerpt)
                </label>
                <textarea
                  rows={2}
                  value={form.excerpt}
                  onChange={(e) => setForm({ ...form, excerpt: e.target.value })}
                  placeholder="สรุปใจความสำคัญ 1-2 ประโยค..."
                  className="w-full rounded-xl border border-slate-200 px-3.5 py-2 text-sm focus:border-[#f59e0b] focus:outline-none"
                />
              </div>

              {/* Content Editor + Live Preview */}
              <div>
                <div className="flex flex-wrap items-center justify-between gap-2 mb-1.5">
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setPreviewTab('write')}
                      className={`rounded-lg px-3 py-1 text-xs font-bold cursor-pointer ${
                        previewTab === 'write'
                          ? 'bg-[#0d2546] text-white'
                          : 'bg-slate-100 text-slate-600'
                      }`}
                    >
                      เขียนเนื้อหา (Editor)
                    </button>
                    <button
                      type="button"
                      onClick={() => setPreviewTab('preview')}
                      className={`rounded-lg px-3 py-1 text-xs font-bold cursor-pointer ${
                        previewTab === 'preview'
                          ? 'bg-[#f59e0b] text-[#0d2546]'
                          : 'bg-slate-100 text-slate-600'
                      }`}
                    >
                      ดูตัวอย่างจริง (Live Preview)
                    </button>
                  </div>

                  {previewTab === 'write' && (
                    <div className="flex items-center gap-1 text-[11px]">
                      <button
                        type="button"
                        onClick={() => insertMarkdownSnippet('## หัวข้อหลักใหม่')}
                        className="rounded bg-slate-100 px-2 py-1 font-bold hover:bg-slate-200 cursor-pointer"
                      >
                        + หัวข้อ H2
                      </button>
                      <button
                        type="button"
                        onClick={() => insertMarkdownSnippet('- ประเด็นสำคัญ...')}
                        className="rounded bg-slate-100 px-2 py-1 font-bold hover:bg-slate-200 cursor-pointer"
                      >
                        + รายการ
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          insertMarkdownSnippet('> "คำคมหรือข้อคิดสำคัญจาก Komkrit"')
                        }
                        className="rounded bg-slate-100 px-2 py-1 font-bold hover:bg-slate-200 cursor-pointer"
                      >
                        + คำคมเด่น
                      </button>
                    </div>
                  )}
                </div>

                {previewTab === 'write' ? (
                  <textarea
                    rows={9}
                    required
                    value={form.content}
                    onChange={(e) =>
                      setForm({ ...form, content: e.target.value })
                    }
                    placeholder="พิมพ์เนื้อหาข่าวสารหรือความรู้ที่นี่ รองรับ ## หัวข้อ, - รายการย่อย, > คำคม, **ตัวหนา**..."
                    className="w-full rounded-xl border border-slate-200 px-4 py-3 text-sm font-body leading-relaxed focus:border-[#f59e0b] focus:outline-none"
                  />
                ) : (
                  <div className="min-h-[220px] rounded-xl border border-slate-200 bg-[#fcfdff] p-5">
                    {form.content ? (
                      renderRichMarkdown(form.content)
                    ) : (
                      <p className="text-sm text-slate-400">ยังไม่มีเนื้อหาสำหรับแสดงตัวอย่าง</p>
                    )}
                  </div>
                )}
              </div>

              {/* Video URL, Audio URL & Tags */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-xs font-bold text-slate-700">
                      วิดีโอ (.MP4 จาก Veo/Flow หรือ YouTube)
                    </label>
                    <label className="text-[11px] font-bold text-[#0d2546] hover:underline cursor-pointer">
                      {uploadingVideo ? 'อัปโหลด...' : '+ อัปโหลด .MP4'}
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
                    onChange={(e) =>
                      setForm({ ...form, videoUrl: e.target.value })
                    }
                    placeholder="/uploads/videos/... หรือ YouTube URL"
                    className="w-full rounded-xl border border-slate-200 px-3.5 py-2 text-xs focus:border-[#f59e0b] focus:outline-none"
                  />
                </div>
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-xs font-bold text-slate-700 flex items-center gap-1">
                      <Mic className="w-3 h-3 text-amber-600" /> ไฟล์เสียงพากย์ (.WAV/.MP3)
                    </label>
                    <label className="text-[11px] font-bold text-[#0d2546] hover:underline cursor-pointer">
                      {uploadingAudio ? 'อัปโหลด...' : '+ อัปโหลดเสียง'}
                      <input
                        type="file"
                        accept="audio/*"
                        onChange={handleUploadAudioFile}
                        className="hidden"
                      />
                    </label>
                  </div>
                  <input
                    type="text"
                    value={form.audioUrl}
                    onChange={(e) =>
                      setForm({ ...form, audioUrl: e.target.value })
                    }
                    placeholder="/uploads/audio/... (ไม่บังคับ)"
                    className="w-full rounded-xl border border-slate-200 px-3.5 py-2 text-xs focus:border-[#f59e0b] focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    แท็ก (คั่นด้วยเครื่องหมายจุลภาค ,)
                  </label>
                  <input
                    type="text"
                    value={form.tagsText}
                    onChange={(e) =>
                      setForm({ ...form, tagsText: e.target.value })
                    }
                    placeholder="การศึกษา, AI, คมคิด by KOMKRIT"
                    className="w-full rounded-xl border border-slate-200 px-3.5 py-2 text-xs focus:border-[#f59e0b] focus:outline-none"
                  />
                </div>
              </div>

              {/* Submit Footer */}
              <div className="pt-3 border-t border-slate-100 flex items-center justify-end gap-2.5">
                <button
                  type="button"
                  onClick={() => setEditorOpen(false)}
                  className="rounded-xl border border-slate-200 px-5 py-2.5 text-sm font-bold text-slate-600 hover:bg-slate-50 cursor-pointer"
                >
                  ยกเลิก
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="inline-flex items-center gap-2 rounded-xl bg-[#0d2546] px-6 py-2.5 text-sm font-extrabold text-white hover:bg-[#193d6e] transition cursor-pointer disabled:opacity-50"
                >
                  <CheckCircle2 className="w-4 h-4 text-[#fbbf24]" />
                  {saving
                    ? 'กำลังบันทึก...'
                    : editingId
                    ? 'บันทึกการแก้ไขโพสต์'
                    : 'เผยแพร่โพสต์ขึ้นเว็บไซต์'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
