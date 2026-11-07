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
  Film,
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
  Copy,
  Download,
  CheckSquare,
  Square,
  ArrowUpDown,
} from 'lucide-react';
import {
  AiMediaAsset,
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
  prefillNewPost?: Partial<Post> | null;
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
  prefillNewPost,
  openCreateImmediately,
  onClearInitialEdit,
  onRefresh,
  onPreviewPost,
  onOpenSettings,
}) => {
  const [search, setSearch] = useState('');
  const [quickFilter, setQuickFilter] = useState<'all' | 'published' | 'draft' | 'video'>('all');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [sortBy, setSortBy] = useState<'newest' | 'oldest' | 'views_desc' | 'updated_desc' | 'title_asc'>('newest');
  const [pageSize, setPageSize] = useState<number>(20);
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [bulkCategoryTarget, setBulkCategoryTarget] = useState<CategoryId>('education');
  const [bulkDeleteConfirm, setBulkDeleteConfirm] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);

  // Full-page clean editor mode (no accidental close on outside click!)
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [showExtraFields, setShowExtraFields] = useState(false);
  const [previewContentRich, setPreviewContentRich] = useState(false);
  const [aiMediaAssets, setAiMediaAssets] = useState<AiMediaAsset[]>([]);

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

  const loadSharedAiMedia = async () => {
    try {
      const items = await api.getMediaAssets();
      setAiMediaAssets(
        items.filter((m) => m.mediaType === 'image' || m.mediaType === 'video')
      );
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    if (editorOpen) {
      loadSharedAiMedia();
    }
  }, [editorOpen]);

  useEffect(() => {
    if (initialEditPost) {
      openEdit(initialEditPost);
      onClearInitialEdit?.();
    } else if (prefillNewPost) {
      setEditingId(null);
      setErrorMsg(null);
      setPreviewContentRich(false);
      setShowExtraFields(Boolean(prefillNewPost.videoUrl || prefillNewPost.subtitle));
      setForm({
        title: prefillNewPost.title || '',
        subtitle: prefillNewPost.subtitle || '',
        excerpt: prefillNewPost.excerpt || '',
        content: prefillNewPost.content || '',
        category: prefillNewPost.category || 'education',
        contentType:
          prefillNewPost.contentType ||
          (prefillNewPost.videoUrl ? 'video' : 'news'),
        coverImage: prefillNewPost.coverImage || '/images/thumb-ai-edu.jpg',
        videoUrl: prefillNewPost.videoUrl || '',
        audioUrl: prefillNewPost.audioUrl || '',
        tagsText:
          Array.isArray(prefillNewPost.tags) && prefillNewPost.tags.length > 0
            ? prefillNewPost.tags.join(', ')
            : 'คมคิด by KOMKRIT, ข่าวการศึกษา',
        author: prefillNewPost.author || 'คมกฤช (Komkrit)',
        status: prefillNewPost.status || 'published',
        isFeatured: Boolean(prefillNewPost.isFeatured),
      });
      setEditorOpen(true);
      window.scrollTo({ top: 0, behavior: 'smooth' });
      onClearInitialEdit?.();
    } else if (openCreateImmediately) {
      openCreate();
      onClearInitialEdit?.();
    }
  }, [initialEditPost, prefillNewPost, openCreateImmediately]);

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
    setPreviewContentRich(false);
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
    setPreviewContentRich(false);
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

  const insertMediaIntoContent = (asset: AiMediaAsset) => {
    const cleanLabel = (asset.thaiSummary || form.title || 'สื่อประกอบเนื้อหา')
      .replace(/[\[\]\n]/g, ' ')
      .trim();
    const mdTag =
      asset.mediaType === 'video'
        ? `![วิดีโอ: ${cleanLabel}](${asset.fileUrl})`
        : `![${cleanLabel}](${asset.fileUrl})`;
    setForm((prev) => ({
      ...prev,
      content: prev.content.trim()
        ? `${prev.content.trim()}\n\n${mdTag}\n\n`
        : `${mdTag}\n\n`,
      coverImage:
        asset.mediaType === 'image' && prev.coverImage === '/images/thumb-ai-edu.jpg'
          ? asset.fileUrl
          : prev.coverImage,
      videoUrl:
        asset.mediaType === 'video' && !prev.videoUrl ? asset.fileUrl : prev.videoUrl,
    }));
    showToast(
      asset.mediaType === 'video'
        ? 'แทรกวิดีโอ AI เข้าไปในเนื้อหาบทความเรียบร้อยแล้ว!'
        : 'แทรกรูปภาพ AI เข้าไปในเนื้อหาบทความเรียบร้อยแล้ว!'
    );
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
      const cleanPlain = form.content
        .replace(/!\[[^\]]*\]\([^)]+\)/g, '')
        .replace(/[#>*_`]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
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
      await loadSharedAiMedia();
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
      setSelectedIds((prev) => prev.filter((x) => x !== id));
      await onRefresh();
      showToast('ลบข่าวออกจากเว็บไซต์เรียบร้อยแล้ว');
    } catch (err) {
      setErrorMsg((err as Error).message);
    } finally {
      setBusyId(null);
    }
  };

  const handleDuplicatePost = async (post: Post) => {
    setBusyId(post.id);
    setErrorMsg(null);
    try {
      const cloned = await api.duplicatePost(post.id);
      await onRefresh();
      showToast(`คัดลอก "${cloned.title}" เป็นฉบับร่างเรียบร้อยแล้ว`);
    } catch (err) {
      setErrorMsg((err as Error).message);
    } finally {
      setBusyId(null);
    }
  };

  const handleBulkAction = async (
    action: 'publish' | 'draft' | 'delete' | 'category',
    category?: string
  ) => {
    if (selectedIds.length === 0) return;
    setBulkBusy(true);
    setErrorMsg(null);
    try {
      const res = await api.bulkPostsAction({
        ids: selectedIds,
        action,
        category,
      });
      setBulkDeleteConfirm(false);
      setSelectedIds([]);
      await onRefresh();
      const actionLabel =
        action === 'publish'
          ? 'เปิดแสดงบนเว็บ'
          : action === 'draft'
          ? 'ซ่อนเป็นฉบับร่าง'
          : action === 'category'
          ? 'ย้ายหมวดหมู่'
          : 'ลบถาวร';
      showToast(`ดำเนินการ "${actionLabel}" สำเร็จจำนวน ${res.affected} เรื่อง!`);
    } catch (err) {
      setErrorMsg((err as Error).message);
    } finally {
      setBulkBusy(false);
    }
  };

  const handleExportPostsCsv = () => {
    const header = 'id,title,category,contentType,status,isFeatured,views,author,createdAt\n';
    const rows = posts
      .map(
        (p) =>
          `${p.id},"${(p.title || '').replace(/"/g, '""')}","${p.category}","${p.contentType}","${p.status}",${p.isFeatured ? 1 : 0},${p.views},"${(p.author || '').replace(/"/g, '""')}","${p.createdAt}"`
      )
      .join('\n');
    const blob = new Blob(['\uFEFF' + header + rows], {
      type: 'text/csv;charset=utf-8;',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `komkrit-posts-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleExportBackupJson = async () => {
    setErrorMsg(null);
    try {
      const snap = await api.exportCmsBackup();
      const blob = new Blob([JSON.stringify(snap, null, 2)], {
        type: 'application/json;charset=utf-8;',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `komkrit-cms-backup-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      showToast('ดาวน์โหลดไฟล์สำรองข้อมูล CMS (JSON Backup) เรียบร้อยแล้ว');
    } catch (err) {
      setErrorMsg((err as Error).message);
    }
  };

  const handleImportBackupJson = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setErrorMsg(null);
    try {
      const raw = await file.text();
      const parsed = JSON.parse(raw);
      const dataObj = parsed?.data || (Array.isArray(parsed) ? { posts: parsed } : parsed);
      const res = await api.importCmsBackup({ data: dataObj, mode: 'merge' });
      await onRefresh();
      showToast(
        `นำเข้าข้อมูลสำเร็จ (เพิ่มข่าว/บทความ ${res.importedPosts} เรื่อง, คลังความรู้ ${res.importedKnowledge} รายการ)`
      );
    } catch (err) {
      setErrorMsg(`นำเข้าไฟล์ JSON ไม่สำเร็จ: ${(err as Error).message}`);
    } finally {
      e.target.value = '';
    }
  };

  const filtered = posts
    .filter((p) => {
      if (quickFilter === 'published' && p.status !== 'published') return false;
      if (quickFilter === 'draft' && p.status !== 'draft') return false;
      if (quickFilter === 'video' && p.contentType !== 'video' && !p.videoUrl) return false;
      if (categoryFilter !== 'all' && p.category !== categoryFilter) return false;
      if (search.trim()) {
        const q = search.toLowerCase();
        return (
          p.title.toLowerCase().includes(q) ||
          p.excerpt.toLowerCase().includes(q) ||
          p.content.toLowerCase().includes(q) ||
          (p.tags || []).some((t) => t.toLowerCase().includes(q))
        );
      }
      return true;
    })
    .sort((a, b) => {
      if (sortBy === 'oldest') {
        return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
      }
      if (sortBy === 'views_desc') {
        return (b.views || 0) - (a.views || 0);
      }
      if (sortBy === 'updated_desc') {
        return new Date(b.updatedAt || b.createdAt).getTime() - new Date(a.updatedAt || a.createdAt).getTime();
      }
      if (sortBy === 'title_asc') {
        return a.title.localeCompare(b.title, 'th');
      }
      if (a.isFeatured !== b.isFeatured) return a.isFeatured ? -1 : 1;
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(currentPage, totalPages);
  const paginatedPosts = filtered.slice((safePage - 1) * pageSize, safePage * pageSize);

  const toggleSelectOne = (id: number) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const allFilteredSelected =
    filtered.length > 0 && filtered.every((p) => selectedIds.includes(p.id));

  const toggleSelectAllFiltered = () => {
    if (allFilteredSelected) {
      const filteredSet = new Set(filtered.map((p) => p.id));
      setSelectedIds((prev) => prev.filter((id) => !filteredSet.has(id)));
    } else {
      const merged = new Set([...selectedIds, ...filtered.map((p) => p.id)]);
      setSelectedIds(Array.from(merged));
    }
  };

  // ============================================================================
  // VIEW 1: SIMPLE FULL-PAGE WRITE / EDIT SCREEN (ELDER-FRIENDLY, LARGE FONTS!)
  // ============================================================================
  if (editorOpen) {
    return (
      <div className="max-w-4xl mx-auto space-y-5">
        {successMsg && (
          <div className="rounded-2xl bg-emerald-600 text-white px-5 py-3.5 shadow-md flex items-center gap-3 text-sm sm:text-base font-extrabold">
            <CheckCircle2 className="w-5 h-5 text-amber-300 shrink-0" />
            <span>{successMsg}</span>
          </div>
        )}

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

          {/* STEP 3: COVER PHOTO + SHARED AI AGENT MEDIA LIBRARY */}
          <div className="space-y-4 rounded-2xl bg-slate-50 border border-slate-200 p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <label className="text-base sm:text-lg font-extrabold text-[#0d2546]">
                3. รูปภาพหน้าปก & คลังรูป/วิดีโอจากทีม AI Agent
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

            {/* SHARED AI MEDIA PICKER (Put AI-generated images & videos directly into Content!) */}
            {aiMediaAssets.length > 0 && (
              <div className="pt-3 border-t border-slate-200 space-y-2.5">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-sm font-extrabold text-[#0d2546] flex items-center gap-1.5">
                    <Sparkles className="w-4 h-4 text-amber-500" />
                    คลังรูปภาพ & วิดีโอที่ AI Agent สร้างไว้ ({aiMediaAssets.length} รายการ) — กดเลือกใส่ Content ได้ทันที:
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 max-h-72 overflow-y-auto pr-1">
                  {aiMediaAssets.slice(0, 12).map((asset) => (
                    <div
                      key={asset.id}
                      className="rounded-xl border border-slate-200 bg-white p-2.5 space-y-2 shadow-2xs"
                    >
                      <div className="relative aspect-video rounded-lg bg-slate-900 overflow-hidden">
                        {asset.mediaType === 'video' ? (
                          <video
                            src={asset.fileUrl}
                            className="h-full w-full object-cover"
                            muted
                            playsInline
                          />
                        ) : (
                          <img
                            src={asset.fileUrl}
                            alt={asset.thaiSummary || 'AI Media'}
                            className="h-full w-full object-cover"
                          />
                        )}
                        <span
                          className={`absolute top-1.5 left-1.5 rounded-md px-2 py-0.5 text-[10px] font-extrabold text-white ${
                            asset.mediaType === 'video' ? 'bg-indigo-600' : 'bg-amber-600'
                          }`}
                        >
                          {asset.mediaType === 'video' ? 'VDO' : 'รูป AI'}
                        </span>
                      </div>
                      <div className="text-xs font-bold text-slate-700 line-clamp-1">
                        {asset.thaiSummary || asset.prompt}
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {asset.mediaType === 'image' ? (
                          <button
                            type="button"
                            onClick={() => {
                              setForm((prev) => ({ ...prev, coverImage: asset.fileUrl }));
                              showToast('ตั้งรูป AI นี้เป็นรูปหน้าปกข่าวแล้ว!');
                            }}
                            className="flex-1 rounded-lg bg-[#0d2546] px-2 py-1.5 text-[11px] font-extrabold text-white hover:bg-[#193d6e] cursor-pointer"
                          >
                            ตั้งเป็นรูปปก
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => {
                              setForm((prev) => ({
                                ...prev,
                                videoUrl: asset.fileUrl,
                                contentType: 'video',
                              }));
                              showToast('แนบวิดีโอ AI เป็นวิดีโอหลักของข่าวนี้แล้ว!');
                            }}
                            className="flex-1 rounded-lg bg-indigo-600 px-2 py-1.5 text-[11px] font-extrabold text-white hover:bg-indigo-700 cursor-pointer"
                          >
                            ใช้เป็นวิดีโอหลัก
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => insertMediaIntoContent(asset)}
                          className="flex-1 rounded-lg bg-emerald-600 px-2 py-1.5 text-[11px] font-extrabold text-white hover:bg-emerald-700 cursor-pointer"
                        >
                          + แทรกในเนื้อหา
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* VIDEO LINK (Shown when contentType === 'video' OR when videoUrl is attached) */}
          {(form.contentType === 'video' || Boolean(form.videoUrl)) && (
            <div className="rounded-2xl bg-rose-50/70 border border-rose-200 p-5 space-y-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <label className="text-base font-extrabold text-rose-950 flex items-center gap-1.5">
                  <Film className="w-5 h-5 text-rose-600" />
                  วิดีโอประกอบ Content นี้ (ลิงก์ YouTube / ไฟล์วิดีโอ AI)
                </label>
                <div className="flex items-center gap-2">
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
                  {form.videoUrl && (
                    <button
                      type="button"
                      onClick={() => setForm({ ...form, videoUrl: '' })}
                      className="rounded-xl bg-white border border-rose-200 px-3 py-2 text-xs font-bold text-rose-700 hover:bg-rose-100 cursor-pointer"
                    >
                      เอาวิดีโอออก
                    </button>
                  )}
                </div>
              </div>
              <input
                type="text"
                value={form.videoUrl}
                onChange={(e) => setForm({ ...form, videoUrl: e.target.value })}
                placeholder="วางลิงก์ YouTube หรือเลือกวิดีโอจากคลัง AI ด้านบน..."
                className="w-full rounded-xl border-2 border-rose-200 bg-white px-4 py-3 text-base focus:border-rose-500 focus:outline-none"
              />
            </div>
          )}

          {/* STEP 4: MAIN CONTENT + RICH INLINE MEDIA PREVIEW */}
          <div className="space-y-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <label className="text-base sm:text-lg font-extrabold text-[#0d2546]">
                4. เนื้อหาข่าว / รายละเอียดบทความ <span className="text-rose-600">*</span>
              </label>
              <button
                type="button"
                onClick={() => setPreviewContentRich((v) => !v)}
                className="inline-flex items-center gap-1.5 rounded-xl border-2 border-[#0d2546] bg-white px-3.5 py-1.5 text-xs sm:text-sm font-extrabold text-[#0d2546] hover:bg-slate-50 cursor-pointer"
              >
                <Eye className="w-4 h-4" />
                {previewContentRich
                  ? 'กลับไปแก้ไขข้อความ'
                  : 'ดูตัวอย่างหน้าอ่านจริง (พร้อมรูป/วิดีโอที่แทรก)'}
              </button>
            </div>
            <p className="text-sm text-slate-500">
              พิมพ์ข้อความตามปกติ หรือกดปุ่ม <strong>“+ แทรกในเนื้อหา”</strong> จากคลังรูป/วิดีโอ AI ด้านบนเพื่อวางภาพและคลิปแทรกในบทความได้เลยครับ
            </p>
            {previewContentRich ? (
              <div className="rounded-2xl border-2 border-[#0d2546]/20 bg-[#fcfdff] p-5 sm:p-6 space-y-3">
                <div className="text-xs font-extrabold text-amber-700">
                  👁️ ตัวอย่างการแสดงผลจริงบนหน้าเว็บ:
                </div>
                <div>{renderRichMarkdown(form.content || '*(ยังไม่มีเนื้อหา)*')}</div>
              </div>
            ) : (
              <textarea
                rows={12}
                required
                value={form.content}
                onChange={(e) => setForm({ ...form, content: e.target.value })}
                placeholder="พิมพ์เนื้อหาข่าวหรือบทความที่นี่..."
                className="w-full rounded-2xl border-2 border-slate-200 px-4 py-4 text-base sm:text-lg font-body leading-relaxed text-slate-800 focus:border-[#0d2546] focus:outline-none"
              />
            )}
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
                {form.contentType !== 'video' && !form.videoUrl && (
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
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 bg-white rounded-2xl p-5 sm:p-6 border border-slate-200 shadow-2xs">
        <div>
          <h2 className="text-xl sm:text-2xl font-extrabold text-[#0d2546]">
            📰 ข่าวสารและบทความบนเว็บไซต์ ({posts.length} เรื่อง)
          </h2>
          <p className="text-sm text-slate-500 mt-1">
            ระบบจัดการเนื้อหาระดับ Production — รองรับค้นหา, กรองหมวดหมู่, คัดลอกข่าว, จัดการหลายรายการ (Bulk Actions) และสำรองข้อมูล JSON/CSV
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2.5 shrink-0">
          <button
            type="button"
            onClick={handleExportPostsCsv}
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-xs sm:text-sm font-bold text-slate-700 hover:bg-slate-100 cursor-pointer"
          >
            <Download className="w-4 h-4 text-[#0d2546]" /> ส่งออก CSV
          </button>
          <button
            type="button"
            onClick={handleExportBackupJson}
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-xs sm:text-sm font-bold text-slate-700 hover:bg-slate-100 cursor-pointer"
          >
            <Download className="w-4 h-4 text-emerald-700" /> Backup JSON
          </button>
          <label className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-xs sm:text-sm font-bold text-slate-700 hover:bg-slate-100 cursor-pointer">
            <Upload className="w-4 h-4 text-amber-600" /> นำเข้า JSON
            <input
              type="file"
              accept=".json,application/json"
              onChange={handleImportBackupJson}
              className="hidden"
            />
          </label>
          <button
            onClick={openCreate}
            className="inline-flex items-center justify-center gap-2 rounded-2xl bg-emerald-600 px-5 py-3 text-sm sm:text-base font-extrabold text-white hover:bg-emerald-700 shadow-md transition cursor-pointer"
          >
            <Plus className="w-5 h-5" />
            ลงข่าว / เขียนบทความใหม่
          </button>
        </div>
      </div>

      {/* Search, Category Filter, Sort & Quick Filter Tabs */}
      <div className="bg-white rounded-2xl p-4 border border-slate-200 space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
          <div className="relative md:col-span-5">
            <input
              type="text"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setCurrentPage(1);
              }}
              placeholder="พิมพ์ค้นหาชื่อข่าว, เนื้อหา หรือแท็ก..."
              className="w-full rounded-xl border-2 border-slate-200 pl-10 pr-4 py-2.5 text-sm sm:text-base focus:border-[#0d2546] focus:outline-none"
            />
            <Search className="w-5 h-5 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
          </div>

          <div className="md:col-span-4">
            <select
              value={categoryFilter}
              onChange={(e) => {
                setCategoryFilter(e.target.value);
                setCurrentPage(1);
              }}
              className="w-full rounded-xl border-2 border-slate-200 px-3.5 py-2.5 text-sm font-bold text-[#0d2546] bg-white focus:border-[#0d2546] focus:outline-none"
            >
              <option value="all">ทุกหมวดหมู่ ({posts.length})</option>
              {CATEGORIES.map((c) => (
                <option key={c.id} value={c.id}>
                  หมวด: {c.nameTh} ({posts.filter((p) => p.category === c.id).length})
                </option>
              ))}
            </select>
          </div>

          <div className="md:col-span-3 flex items-center gap-2">
            <ArrowUpDown className="w-4 h-4 text-slate-400 shrink-0" />
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as any)}
              className="w-full rounded-xl border-2 border-slate-200 px-3 py-2.5 text-sm font-bold text-slate-700 bg-white focus:border-[#0d2546] focus:outline-none"
            >
              <option value="newest">เรียง: ใหม่ล่าสุด + ข่าวเด่น</option>
              <option value="updated_desc">เรียง: แก้ไขล่าสุด</option>
              <option value="views_desc">เรียง: ยอดอ่านสูงสุด</option>
              <option value="oldest">เรียง: เก่าสุดก่อน</option>
              <option value="title_asc">เรียง: ชื่อ ก-ฮ / A-Z</option>
            </select>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
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
                onClick={() => {
                  setQuickFilter(tab.id as any);
                  setCurrentPage(1);
                }}
                className={`rounded-xl px-4 py-2 text-xs sm:text-sm font-extrabold transition cursor-pointer ${
                  quickFilter === tab.id
                    ? 'bg-[#0d2546] text-white'
                    : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={toggleSelectAllFiltered}
              className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-extrabold text-[#0d2546] hover:bg-slate-100 cursor-pointer"
            >
              {allFilteredSelected ? (
                <CheckSquare className="w-4 h-4 text-emerald-600" />
              ) : (
                <Square className="w-4 h-4 text-slate-400" />
              )}
              {allFilteredSelected
                ? `ยกเลิกเลือกทั้งหมด (${filtered.length})`
                : `เลือกทั้งหมดในหน้านี้ (${filtered.length})`}
            </button>
          </div>
        </div>
      </div>

      {/* Production Bulk Actions Toolbar */}
      {selectedIds.length > 0 && (
        <div className="rounded-2xl bg-[#0d2546] text-white p-4 shadow-md flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-sm font-extrabold">
            <CheckSquare className="w-5 h-5 text-amber-300" />
            <span>เลือกไว้ {selectedIds.length} รายการ</span>
            <button
              type="button"
              onClick={() => setSelectedIds([])}
              className="ml-2 text-xs text-slate-300 underline hover:text-white cursor-pointer"
            >
              ล้างที่เลือก
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={bulkBusy}
              onClick={() => handleBulkAction('publish')}
              className="rounded-xl bg-emerald-500 px-3.5 py-2 text-xs font-extrabold text-white hover:bg-emerald-600 cursor-pointer disabled:opacity-50"
            >
              🟢 เปิดแสดงบนเว็บทั้งหมด
            </button>
            <button
              type="button"
              disabled={bulkBusy}
              onClick={() => handleBulkAction('draft')}
              className="rounded-xl bg-slate-700 px-3.5 py-2 text-xs font-extrabold text-white hover:bg-slate-600 cursor-pointer disabled:opacity-50"
            >
              ⚪ ซ่อนเป็นฉบับร่างทั้งหมด
            </button>

            <div className="flex items-center gap-1 bg-white/10 rounded-xl p-1">
              <select
                value={bulkCategoryTarget}
                onChange={(e) => setBulkCategoryTarget(e.target.value as CategoryId)}
                className="rounded-lg bg-[#0a1930] text-white px-2.5 py-1.5 text-xs font-bold"
              >
                {CATEGORIES.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.nameTh}
                  </option>
                ))}
              </select>
              <button
                type="button"
                disabled={bulkBusy}
                onClick={() => handleBulkAction('category', bulkCategoryTarget)}
                className="rounded-lg bg-amber-400 px-2.5 py-1.5 text-xs font-extrabold text-[#0b1e38] hover:brightness-105 cursor-pointer disabled:opacity-50"
              >
                ย้ายหมวด
              </button>
            </div>

            {bulkDeleteConfirm ? (
              <div className="flex items-center gap-1.5 bg-rose-900/80 border border-rose-400 rounded-xl p-1">
                <button
                  type="button"
                  disabled={bulkBusy}
                  onClick={() => handleBulkAction('delete')}
                  className="rounded-lg bg-rose-500 px-3 py-1.5 text-xs font-extrabold text-white cursor-pointer"
                >
                  ยืนยันลบ {selectedIds.length} เรื่อง
                </button>
                <button
                  type="button"
                  onClick={() => setBulkDeleteConfirm(false)}
                  className="rounded-lg bg-white/15 px-2.5 py-1.5 text-xs font-bold text-white cursor-pointer"
                >
                  ยกเลิก
                </button>
              </div>
            ) : (
              <button
                type="button"
                disabled={bulkBusy}
                onClick={() => setBulkDeleteConfirm(true)}
                className="rounded-xl bg-rose-600 px-3.5 py-2 text-xs font-extrabold text-white hover:bg-rose-700 cursor-pointer disabled:opacity-50"
              >
                🗑️ ลบที่เลือก
              </button>
            )}
          </div>
        </div>
      )}

      {/* Posts List with Large, Clear Thai Action Buttons */}
      <div className="space-y-3.5">
        {paginatedPosts.length === 0 ? (
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
          paginatedPosts.map((post) => {
            const cat =
              CATEGORIES.find((c) => c.id === post.category) || CATEGORIES[0];
            const isBusy = busyId === post.id;
            const isSelected = selectedIds.includes(post.id);
            return (
              <div
                key={post.id}
                className={`rounded-2xl bg-white border-2 p-4 sm:p-5 shadow-2xs transition flex flex-col lg:flex-row lg:items-center justify-between gap-4 ${
                  isSelected
                    ? 'border-[#0d2546] bg-sky-50/20'
                    : post.isFeatured
                    ? 'border-amber-400'
                    : 'border-slate-200/90'
                } ${isBusy ? 'opacity-60 pointer-events-none' : ''}`}
              >
                <div className="flex items-start sm:items-center gap-3.5 min-w-0">
                  <button
                    type="button"
                    onClick={() => toggleSelectOne(post.id)}
                    className="mt-1 sm:mt-0 text-slate-400 hover:text-[#0d2546] cursor-pointer shrink-0"
                    title="เลือกรายการนี้"
                  >
                    {isSelected ? (
                      <CheckSquare className="w-5 h-5 text-[#0d2546]" />
                    ) : (
                      <Square className="w-5 h-5" />
                    )}
                  </button>
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
                <div className="flex flex-wrap items-center gap-2 shrink-0 border-t lg:border-t-0 pt-3 lg:pt-0 border-slate-100">
                  <button
                    onClick={() => openEdit(post)}
                    className="inline-flex items-center gap-1.5 rounded-xl bg-[#0d2546] px-4 py-2.5 text-sm font-extrabold text-white hover:bg-[#193d6e] cursor-pointer shadow-2xs"
                  >
                    <Edit3 className="w-4 h-4 text-amber-300" /> แก้ไขข่าว
                  </button>

                  <button
                    onClick={() => handleDuplicatePost(post)}
                    className="inline-flex items-center gap-1.5 rounded-xl bg-slate-100 px-3.5 py-2.5 text-sm font-bold text-slate-700 hover:bg-slate-200 cursor-pointer"
                    title="คัดลอกข่าวนี้เป็นฉบับร่าง"
                  >
                    <Copy className="w-4 h-4" /> คัดลอก
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

      {/* Pagination Bar */}
      {filtered.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 bg-white rounded-2xl p-4 border border-slate-200 text-xs sm:text-sm">
          <div className="text-slate-600 font-bold">
            แสดง {(safePage - 1) * pageSize + 1}–
            {Math.min(safePage * pageSize, filtered.length)} จากทั้งหมด {filtered.length} เรื่อง
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={pageSize}
              onChange={(e) => {
                setPageSize(Number(e.target.value));
                setCurrentPage(1);
              }}
              className="rounded-xl border border-slate-200 px-3 py-1.5 text-xs font-bold text-slate-700"
            >
              <option value={10}>10 เรื่อง / หน้า</option>
              <option value={20}>20 เรื่อง / หน้า</option>
              <option value={50}>50 เรื่อง / หน้า</option>
              <option value={200}>ทั้งหมด (200)</option>
            </select>

            <button
              type="button"
              disabled={safePage <= 1}
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              className="rounded-xl border border-slate-200 px-3 py-1.5 font-bold text-slate-700 hover:bg-slate-100 disabled:opacity-40 cursor-pointer"
            >
              ← ก่อนหน้า
            </button>
            <span className="font-extrabold text-[#0d2546] px-2">
              หน้า {safePage} / {totalPages}
            </span>
            <button
              type="button"
              disabled={safePage >= totalPages}
              onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
              className="rounded-xl border border-slate-200 px-3 py-1.5 font-bold text-slate-700 hover:bg-slate-100 disabled:opacity-40 cursor-pointer"
            >
              ถัดไป →
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
