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
  RefreshCw,
  FolderOpen,
  X,
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
  { label: 'การศึกษาและเทคโนโลยี AI', url: '/images/thumb-ai-edu.jpg' },
  { label: 'การบรรยายพิเศษโดยผู้บริหาร', url: '/images/featured-speaker.jpg' },
  { label: 'การพัฒนาสถานศึกษา', url: '/images/thumb-school.jpg' },
  { label: 'การเรียนรู้ตลอดชีวิต', url: '/images/thumb-phuket.jpg' },
  { label: 'นวัตกรรมดิจิทัล', url: '/images/thumb-agentic.jpg' },
];

const CONTENT_TYPES: { id: ContentType; label: string; icon: React.ReactNode }[] = [
  { id: 'news', label: 'ข่าวประชาสัมพันธ์', icon: <Newspaper className="w-3.5 h-3.5" /> },
  { id: 'article', label: 'บทความวิชาการ', icon: <FileText className="w-3.5 h-3.5" /> },
  { id: 'video', label: 'สื่อวิดีโอ', icon: <Video className="w-3.5 h-3.5" /> },
  { id: 'course', label: 'หลักสูตรอบรม', icon: <GraduationCap className="w-3.5 h-3.5" /> },
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
  const [quickFilter, setQuickFilter] = useState<
    'all' | 'published' | 'draft' | 'featured' | 'video'
  >('all');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [sortBy, setSortBy] = useState<
    'newest' | 'oldest' | 'views_desc' | 'title_asc'
  >('newest');
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(12);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkDeleteConfirm, setBulkDeleteConfirm] = useState(false);
  const [importingBackup, setImportingBackup] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingPost, setEditingPost] = useState<Post | null>(null);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadingVideo, setUploadingVideo] = useState(false);
  const [generatingAiImage, setGeneratingAiImage] = useState(false);
  const [aiImagePrompt, setAiImagePrompt] = useState('');
  const [writingWithAi, setWritingWithAi] = useState(false);
  const [aiWritePrompt, setAiWritePrompt] = useState('');
  const [showAiWriterBox, setShowAiWriterBox] = useState(false);
  const [showAiGalleryPicker, setShowAiGalleryPicker] = useState(false);
  const [aiMediaLibrary, setAiMediaLibrary] = useState<AiMediaAsset[]>([]);
  const [showAdvancedFields, setShowAdvancedFields] = useState(false);
  const [editorPreviewMode, setEditorPreviewMode] = useState<'write' | 'preview'>(
    'write'
  );
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);

  const [form, setForm] = useState({
    title: '',
    subtitle: '',
    excerpt: '',
    content: '',
    category: 'ai-tech' as CategoryId,
    contentType: 'news' as ContentType,
    coverImage: '/images/thumb-ai-edu.jpg',
    videoUrl: '',
    audioUrl: '',
    tagsInput: 'คมคิด by KOMKRIT, การศึกษาไทย',
    author: 'คมกฤช (Komkrit)',
    status: 'published' as PostStatus,
    isFeatured: false,
  });

  const showToast = (msg: string) => {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(null), 4000);
  };

  const loadAiMediaLibrary = async () => {
    try {
      const list = await api.getMediaAssets();
      setAiMediaLibrary(
        list.filter((a) => a.mediaType === 'image' || a.mediaType === 'video')
      );
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    if (editorOpen) {
      loadAiMediaLibrary();
    }
  }, [editorOpen]);

  useEffect(() => {
    if (initialEditPost) {
      openEdit(initialEditPost);
      if (onClearInitialEdit) onClearInitialEdit();
    }
  }, [initialEditPost]);

  useEffect(() => {
    if (prefillNewPost) {
      setEditingPost(null);
      setErrorMsg(null);
      setAiImagePrompt('');
      setEditorPreviewMode('write');
      setForm({
        title: prefillNewPost.title || '',
        subtitle: prefillNewPost.subtitle || '',
        excerpt: prefillNewPost.excerpt || '',
        content: prefillNewPost.content || '',
        category: (prefillNewPost.category as CategoryId) || 'ai-tech',
        contentType: (prefillNewPost.contentType as ContentType) || 'news',
        coverImage: prefillNewPost.coverImage || '/images/thumb-ai-edu.jpg',
        videoUrl: prefillNewPost.videoUrl || '',
        audioUrl: prefillNewPost.audioUrl || '',
        tagsInput: (
          prefillNewPost.tags || ['คมคิด by KOMKRIT', 'การศึกษาไทย']
        ).join(', '),
        author: prefillNewPost.author || 'คมกฤช (Komkrit)',
        status: (prefillNewPost.status as PostStatus) || 'published',
        isFeatured: Boolean(prefillNewPost.isFeatured),
      });
      setEditorOpen(true);
      if (onClearInitialEdit) onClearInitialEdit();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }, [prefillNewPost]);

  useEffect(() => {
    if (openCreateImmediately && !initialEditPost) {
      openCreate();
      if (onClearInitialEdit) onClearInitialEdit();
    }
  }, [openCreateImmediately]);

  const openCreate = () => {
    setEditingPost(null);
    setErrorMsg(null);
    setAiImagePrompt('');
    setAiWritePrompt('');
    setShowAiWriterBox(false);
    setShowAdvancedFields(false);
    setEditorPreviewMode('write');
    setForm({
      title: '',
      subtitle: '',
      excerpt: '',
      content: '',
      category: 'ai-tech',
      contentType: 'news',
      coverImage: '/images/thumb-ai-edu.jpg',
      videoUrl: '',
      audioUrl: '',
      tagsInput: 'คมคิด by KOMKRIT, การศึกษาไทย',
      author: 'คมกฤช (Komkrit)',
      status: 'published',
      isFeatured: false,
    });
    setEditorOpen(true);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const openEdit = (p: Post) => {
    setEditingPost(p);
    setErrorMsg(null);
    setAiImagePrompt('');
    setAiWritePrompt('');
    setShowAiWriterBox(false);
    setShowAdvancedFields(Boolean(p.subtitle || p.audioUrl));
    setEditorPreviewMode('write');
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
      tagsInput: (p.tags || []).join(', '),
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
        ? 'แทรกวิดีโอลงในเนื้อหาเรียบร้อยแล้ว'
        : 'แทรกรูปภาพลงในเนื้อหาเรียบร้อยแล้ว'
    );
  };

  const handleSave = async (overrideStatus?: PostStatus) => {
    if (!form.title.trim()) {
      setErrorMsg('กรุณาระบุหัวข้อเนื้อหาก่อนบันทึก');
      return;
    }
    setSaving(true);
    setErrorMsg(null);
    const finalStatus = overrideStatus || form.status;
    try {
      const autoExcerpt =
        form.excerpt.trim() ||
        form.content
          .replace(/!\[[^\]]*\]\([^)]+\)/g, '')
          .replace(/[#>*_`]/g, '')
          .trim()
          .slice(0, 170) ||
        form.title.trim();

      const payload: Partial<Post> = {
        title: form.title.trim(),
        subtitle: form.subtitle.trim(),
        excerpt: autoExcerpt,
        content: form.content.trim() || form.title.trim(),
        category: form.category,
        contentType: form.contentType,
        coverImage: form.coverImage.trim() || '/images/thumb-ai-edu.jpg',
        videoUrl: form.videoUrl.trim(),
        audioUrl: form.audioUrl.trim(),
        tags: form.tagsInput
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean),
        author: form.author.trim() || 'คมกฤช (Komkrit)',
        status: finalStatus,
        isFeatured: form.isFeatured,
      };

      if (editingPost) {
        await api.updatePost(editingPost.id, payload);
        showToast(
          finalStatus === 'published'
            ? 'บันทึกและเผยแพร่เนื้อหาเรียบร้อยแล้ว'
            : 'บันทึกเป็นฉบับร่างเรียบร้อยแล้ว'
        );
      } else {
        await api.createPost(payload);
        showToast(
          finalStatus === 'published'
            ? 'สร้างและเผยแพร่เนื้อหาใหม่เรียบร้อยแล้ว'
            : 'บันทึกเนื้อหาใหม่เป็นฉบับร่างเรียบร้อยแล้ว'
        );
      }
      setEditorOpen(false);
      await onRefresh();
    } catch (err) {
      setErrorMsg((err as Error).message || 'เกิดข้อผิดพลาดในการบันทึกข้อมูล');
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
      showToast('อัปโหลดรูปภาพปกเรียบร้อยแล้ว');
    } catch (err) {
      setErrorMsg((err as Error).message || 'อัปโหลดรูปภาพไม่สำเร็จ');
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
      const url = await api.uploadVideo(file);
      setForm((prev) => ({
        ...prev,
        videoUrl: url,
        contentType: 'video',
      }));
      showToast('อัปโหลดไฟล์วิดีโอเรียบร้อยแล้ว');
    } catch (err) {
      setErrorMsg((err as Error).message || 'อัปโหลดวิดีโอไม่สำเร็จ');
    } finally {
      setUploadingVideo(false);
    }
  };

  const handleAiWriteArticle = async () => {
    const topicToWrite = aiWritePrompt.trim() || form.title.trim();
    if (!topicToWrite) {
      setErrorMsg('กรุณาระบุหัวข้อหรือประเด็นที่ต้องการให้ AI ร่างเนื้อหา');
      return;
    }
    setWritingWithAi(true);
    setErrorMsg(null);
    try {
      const draft = await api.draftContentFromChat({
        ideaText: topicToWrite,
        contentFormat: form.contentType === 'news' ? 'news' : 'article',
      });
      setForm((prev) => ({
        ...prev,
        title: draft.title || prev.title,
        subtitle: draft.subtitle || prev.subtitle,
        excerpt: draft.excerpt || prev.excerpt,
        content: draft.content || prev.content,
        category: draft.category || prev.category,
        tagsInput: (draft.tags || []).join(', ') || prev.tagsInput,
      }));
      setShowAiWriterBox(false);
      showToast('ร่างเนื้อหาด้วย AI เรียบร้อยแล้ว สามารถตรวจสอบและแก้ไขได้ทันที');
    } catch (err) {
      setErrorMsg((err as Error).message);
    } finally {
      setWritingWithAi(false);
    }
  };

  const handleGenerateAiCover = async () => {
    const promptText =
      aiImagePrompt.trim() ||
      form.title.trim() ||
      'Modern Thai classroom with AI technology and warm teacher guiding students';
    setGeneratingAiImage(true);
    setErrorMsg(null);
    try {
      const asset = await api.generateRealImage({
        prompt: promptText,
        provider: 'gemini',
        aspectRatio: '16:9',
      });
      setForm((prev) => ({ ...prev, coverImage: asset.fileUrl }));
      await loadAiMediaLibrary();
      showToast(`สร้างรูปภาพปกด้วย AI (${asset.engine}) สำเร็จ`);
    } catch (err) {
      setErrorMsg((err as Error).message);
    } finally {
      setGeneratingAiImage(false);
    }
  };

  const handleToggleStatus = async (post: Post) => {
    setBusyId(post.id);
    setErrorMsg(null);
    try {
      const next: PostStatus = post.status === 'published' ? 'draft' : 'published';
      await api.updatePost(post.id, { status: next });
      await onRefresh();
      showToast(
        next === 'published'
          ? `เปลี่ยนสถานะ "${post.title}" เป็นเผยแพร่แล้ว`
          : `เปลี่ยนสถานะ "${post.title}" เป็นฉบับร่างแล้ว`
      );
    } catch (err) {
      setErrorMsg((err as Error).message);
    } finally {
      setBusyId(null);
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
          ? `ปักหมุด "${post.title}" เป็นเนื้อหาแนะนำแล้ว`
          : `ยกเลิกปักหมุด "${post.title}" แล้ว`
      );
    } catch (err) {
      setErrorMsg((err as Error).message);
    } finally {
      setBusyId(null);
    }
  };

  const executeDelete = async (post: Post) => {
    setBusyId(post.id);
    setErrorMsg(null);
    try {
      await api.deletePost(post.id);
      setConfirmDeleteId(null);
      await onRefresh();
      showToast(`ลบเนื้อหา "${post.title}" เรียบร้อยแล้ว`);
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
      showToast(`ทำสำเนา "${cloned.title}" เป็นฉบับร่างเรียบร้อยแล้ว`);
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
          ? 'เผยแพร่เนื้อหา'
          : action === 'draft'
          ? 'เปลี่ยนเป็นฉบับร่าง'
          : action === 'category'
          ? 'ย้ายหมวดหมู่'
          : 'ลบข้อมูลถาวร';
      showToast(`ดำเนินการ "${actionLabel}" สำเร็จ ${res.affected} รายการ`);
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
      const backup = await api.exportDatabaseBackup();
      const blob = new Blob([JSON.stringify(backup, null, 2)], {
        type: 'application/json;charset=utf-8;',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `komkrit-full-backup-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      showToast('ส่งออกไฟล์สำรองฐานข้อมูล (.JSON) สำเร็จ');
    } catch (err) {
      setErrorMsg((err as Error).message);
    }
  };

  const handleImportBackupJsonFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImportingBackup(true);
    setErrorMsg(null);
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      const payload = parsed?.data ? parsed.data : parsed;
      const res = await api.importDatabaseBackup({
        mode: 'merge',
        data: payload,
      });
      await onRefresh();
      showToast(`นำเข้าข้อมูลสำเร็จ (เพิ่ม/อัปเดต ${res.restoredPosts} รายการ)`);
    } catch (err) {
      setErrorMsg((err as Error).message || 'ไฟล์สำรองข้อมูลไม่ถูกต้อง');
    } finally {
      setImportingBackup(false);
      e.target.value = '';
    }
  };

  const filtered = posts
    .filter((p) => {
      const matchSearch =
        !search.trim() ||
        p.title.toLowerCase().includes(search.toLowerCase()) ||
        p.excerpt.toLowerCase().includes(search.toLowerCase()) ||
        (p.tags || []).some((t) => t.toLowerCase().includes(search.toLowerCase()));
      if (!matchSearch) return false;

      if (categoryFilter !== 'all' && p.category !== categoryFilter) return false;

      if (quickFilter === 'published') return p.status === 'published';
      if (quickFilter === 'draft') return p.status === 'draft';
      if (quickFilter === 'featured') return Boolean(p.isFeatured);
      if (quickFilter === 'video')
        return p.contentType === 'video' || Boolean(p.videoUrl);
      return true;
    })
    .sort((a, b) => {
      if (sortBy === 'oldest') return a.id - b.id;
      if (sortBy === 'views_desc') return (b.views || 0) - (a.views || 0);
      if (sortBy === 'title_asc') return a.title.localeCompare(b.title, 'th');
      return b.id - a.id;
    });

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(currentPage, totalPages);
  const paginatedPosts = filtered.slice(
    (safePage - 1) * pageSize,
    safePage * pageSize
  );

  const toggleSelectId = (id: number) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  const toggleSelectAllFiltered = () => {
    const currentIds = paginatedPosts.map((p) => p.id);
    const allSelected =
      currentIds.length > 0 && currentIds.every((id) => selectedIds.includes(id));
    if (allSelected) {
      setSelectedIds((prev) => prev.filter((id) => !currentIds.includes(id)));
    } else {
      setSelectedIds((prev) => Array.from(new Set([...prev, ...currentIds])));
    }
  };

  const publishedCount = posts.filter((p) => p.status === 'published').length;
  const draftCount = posts.filter((p) => p.status === 'draft').length;
  const featuredCount = posts.filter((p) => p.isFeatured).length;

  // =========================================================================
  // FORMAL 2-COLUMN EDITORIAL FORM VIEW
  // =========================================================================
  if (editorOpen) {
    return (
      <div className="space-y-5">
        {/* Top Action Bar */}
        <div className="rounded-lg bg-white border border-slate-200 px-4 sm:px-6 py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-2xs">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setEditorOpen(false)}
              className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition cursor-pointer"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              กลับสู่รายการเนื้อหา
            </button>
            <div>
              <h2 className="text-sm sm:text-base font-bold text-slate-900">
                {editingPost
                  ? `แก้ไขเนื้อหา #${editingPost.id}`
                  : 'สร้างเนื้อหาใหม่'}
              </h2>
              <p className="text-xs text-slate-500">
                กำหนดรายละเอียดเนื้อหา สื่อประกอบ และสถานะการเผยแพร่
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={saving}
              onClick={() => handleSave('draft')}
              className="rounded-md border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition cursor-pointer disabled:opacity-50"
            >
              บันทึกฉบับร่าง
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={() => handleSave('published')}
              className="inline-flex items-center gap-1.5 rounded-md bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800 transition cursor-pointer disabled:opacity-50"
            >
              <CheckCircle2 className="w-3.5 h-3.5 text-amber-400" />
              {saving ? 'กำลังบันทึก...' : 'บันทึกและเผยแพร่'}
            </button>
          </div>
        </div>

        {/* Error Alert */}
        {errorMsg && (
          <div className="rounded-lg bg-rose-50 border border-rose-200 p-4 flex flex-wrap items-center justify-between gap-3 text-xs text-rose-800">
            <div className="flex items-center gap-2 font-medium">
              <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
              <span>{errorMsg}</span>
            </div>
            {errorMsg.includes('API Key') && onOpenSettings && (
              <button
                type="button"
                onClick={onOpenSettings}
                className="inline-flex items-center gap-1.5 rounded-md bg-rose-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-rose-800 cursor-pointer"
              >
                <KeyRound className="w-3.5 h-3.5" /> ตั้งค่า API Key
              </button>
            )}
          </div>
        )}

        {/* 2-Column Editorial Workspace */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
          {/* Left Column (8 Cols): Main Article Content */}
          <div className="lg:col-span-8 space-y-5">
            <div className="rounded-lg bg-white border border-slate-200 p-5 space-y-4 shadow-2xs">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                  หัวข้อเนื้อหา / ชื่อเรื่อง <span className="text-rose-600">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={form.title}
                  onChange={(e) => setForm({ ...form, title: e.target.value })}
                  placeholder="ระบุหัวข้อข่าว บทความ หรือชื่อหลักสูตร"
                  className="w-full rounded-md border border-slate-300 px-3.5 py-2.5 text-sm sm:text-base font-semibold text-slate-900 focus:border-slate-900 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                  บทคัดย่อ / คำโปรยสรุป (Excerpt)
                </label>
                <textarea
                  rows={2}
                  value={form.excerpt}
                  onChange={(e) => setForm({ ...form, excerpt: e.target.value })}
                  placeholder="สรุปใจความสำคัญ 1-2 ประโยคสำหรับแสดงในหน้ารวมบทความ (หากเว้นว่างระบบจะดึงจากเนื้อหาอัตโนมัติ)"
                  className="w-full rounded-md border border-slate-300 px-3.5 py-2 text-xs sm:text-sm text-slate-800 focus:border-slate-900 focus:outline-none"
                />
              </div>

              {/* Content Editor Header & AI Co-work Tools */}
              <div className="pt-2 border-t border-slate-100 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <label className="text-xs font-semibold text-slate-700">
                    เนื้อหาหลัก (รองรับ Markdown, รูปภาพ และวิดีโอ)
                  </label>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => setShowAiWriterBox((v) => !v)}
                      className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
                    >
                      <Sparkles className="w-3.5 h-3.5 text-amber-600" />
                      ให้ AI ช่วยร่างเนื้อหา
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowAiGalleryPicker((v) => !v)}
                      className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
                    >
                      <FolderOpen className="w-3.5 h-3.5 text-slate-500" />
                      คลังสื่อ AI ({aiMediaLibrary.length})
                    </button>
                    <div className="inline-flex rounded-md border border-slate-200 bg-slate-100 p-0.5">
                      <button
                        type="button"
                        onClick={() => setEditorPreviewMode('write')}
                        className={`rounded px-2.5 py-1 text-xs font-semibold cursor-pointer ${
                          editorPreviewMode === 'write'
                            ? 'bg-white text-slate-900 shadow-2xs'
                            : 'text-slate-600'
                        }`}
                      >
                        แก้ไข
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditorPreviewMode('preview')}
                        className={`rounded px-2.5 py-1 text-xs font-semibold cursor-pointer ${
                          editorPreviewMode === 'preview'
                            ? 'bg-white text-slate-900 shadow-2xs'
                            : 'text-slate-600'
                        }`}
                      >
                        ดูตัวอย่าง
                      </button>
                    </div>
                  </div>
                </div>

                {/* Inline AI Content Generator */}
                {showAiWriterBox && (
                  <div className="rounded-md bg-slate-50 border border-slate-200 p-3.5 space-y-2.5">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-slate-800">
                        ระบุประเด็นที่ต้องการให้ AI ร่างบทความหรือข่าวประชาสัมพันธ์
                      </span>
                      <button
                        type="button"
                        onClick={() => setShowAiWriterBox(false)}
                        className="text-slate-400 hover:text-slate-600 cursor-pointer"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                    <div className="flex flex-col sm:flex-row gap-2">
                      <input
                        type="text"
                        value={aiWritePrompt}
                        onChange={(e) => setAiWritePrompt(e.target.value)}
                        placeholder={
                          form.title ||
                          'เช่น แนวทางบูรณาการ AI ในสถานศึกษาเพื่อลดภาระงานเอกสารของครู'
                        }
                        className="flex-1 rounded-md border border-slate-300 bg-white px-3 py-2 text-xs sm:text-sm focus:border-slate-900 focus:outline-none"
                      />
                      <button
                        type="button"
                        disabled={writingWithAi}
                        onClick={handleAiWriteArticle}
                        className="inline-flex items-center justify-center gap-1.5 rounded-md bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800 cursor-pointer disabled:opacity-50 shrink-0"
                      >
                        {writingWithAi ? (
                          <>
                            <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                            กำลังประมวลผล...
                          </>
                        ) : (
                          <>
                            <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                            สร้างร่างเนื้อหา
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                )}

                {/* Inline AI Media Picker Tray */}
                {showAiGalleryPicker && (
                  <div className="rounded-md bg-slate-50 border border-slate-200 p-3.5 space-y-2.5">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-slate-800">
                        เลือกสื่อจากคลัง AI เพื่อตั้งเป็นปกหรือแทรกในเนื้อหา
                      </span>
                      <button
                        type="button"
                        onClick={() => setShowAiGalleryPicker(false)}
                        className="text-xs font-medium text-slate-500 hover:text-slate-800 cursor-pointer"
                      >
                        ปิดหน้าต่าง
                      </button>
                    </div>
                    {aiMediaLibrary.length === 0 ? (
                      <p className="text-xs text-slate-500 py-2">
                        ยังไม่มีสื่อในคลัง สามารถกดสร้างภาพปกด้วย AI ทางคอลัมน์ด้านขวาได้ทันที
                      </p>
                    ) : (
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 max-h-60 overflow-y-auto pr-1">
                        {aiMediaLibrary.slice(0, 12).map((asset) => (
                          <div
                            key={asset.id}
                            className="rounded-md border border-slate-200 bg-white p-2 space-y-1.5"
                          >
                            <div className="relative aspect-video rounded bg-slate-900 overflow-hidden">
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
                                  alt={asset.thaiSummary || asset.prompt}
                                  className="h-full w-full object-cover"
                                />
                              )}
                              <span className="absolute top-1 left-1 rounded bg-slate-900/80 px-1.5 py-0.5 text-[10px] font-semibold text-white">
                                {asset.mediaType === 'video' ? 'VIDEO' : 'IMAGE'}
                              </span>
                            </div>
                            <div className="text-[11px] font-medium text-slate-700 line-clamp-1">
                              {asset.thaiSummary || asset.prompt}
                            </div>
                            <div className="flex gap-1">
                              {asset.mediaType === 'image' ? (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setForm((prev) => ({
                                      ...prev,
                                      coverImage: asset.fileUrl,
                                    }));
                                    showToast('ตั้งเป็นรูปภาพปกเรียบร้อยแล้ว');
                                  }}
                                  className="flex-1 rounded bg-slate-900 px-2 py-1 text-[10px] font-semibold text-white hover:bg-slate-800 cursor-pointer"
                                >
                                  ตั้งเป็นปก
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
                                    showToast('กำหนดเป็นวิดีโอหลักเรียบร้อยแล้ว');
                                  }}
                                  className="flex-1 rounded bg-slate-900 px-2 py-1 text-[10px] font-semibold text-white hover:bg-slate-800 cursor-pointer"
                                >
                                  ตั้งเป็นวิดีโอหลัก
                                </button>
                              )}
                              <button
                                type="button"
                                onClick={() => insertMediaIntoContent(asset)}
                                className="flex-1 rounded border border-slate-300 bg-white px-2 py-1 text-[10px] font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
                              >
                                แทรกในเนื้อหา
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {editorPreviewMode === 'write' ? (
                  <textarea
                    rows={14}
                    value={form.content}
                    onChange={(e) => setForm({ ...form, content: e.target.value })}
                    placeholder="พิมพ์เนื้อหาบทความที่นี่... (รองรับหัวข้อ ##, รายการ -, ตัวหนา **ข้อความ** และการแทรกสื่อ)"
                    className="w-full rounded-md border border-slate-300 p-3.5 text-sm leading-relaxed text-slate-900 font-body focus:border-slate-900 focus:outline-none"
                  />
                ) : (
                  <div className="rounded-md border border-slate-200 bg-slate-50/50 p-5 min-h-[320px] prose prose-slate max-w-none text-sm leading-relaxed">
                    {form.content.trim() ? (
                      renderRichMarkdown(form.content)
                    ) : (
                      <p className="text-slate-400">ยังไม่มีเนื้อหาสำหรับแสดงตัวอย่าง</p>
                    )}
                  </div>
                )}
              </div>

              {/* Advanced Metadata Toggle */}
              <div className="pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowAdvancedFields((v) => !v)}
                  className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-600 hover:text-slate-900 cursor-pointer"
                >
                  {showAdvancedFields ? (
                    <ChevronUp className="w-3.5 h-3.5" />
                  ) : (
                    <ChevronDown className="w-3.5 h-3.5" />
                  )}
                  ข้อมูลเพิ่มเติม (คำโปรยรอง, ผู้เขียน, ป้ายกำกับ Tags, ไฟล์เสียง)
                </button>

                {showAdvancedFields && (
                  <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3.5 pt-3 border-t border-slate-100">
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">
                        คำโปรยรอง (Subtitle)
                      </label>
                      <input
                        type="text"
                        value={form.subtitle}
                        onChange={(e) =>
                          setForm({ ...form, subtitle: e.target.value })
                        }
                        className="w-full rounded-md border border-slate-300 px-3 py-1.5 text-xs sm:text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">
                        ชื่อผู้เขียน (Author)
                      </label>
                      <input
                        type="text"
                        value={form.author}
                        onChange={(e) => setForm({ ...form, author: e.target.value })}
                        className="w-full rounded-md border border-slate-300 px-3 py-1.5 text-xs sm:text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">
                        ป้ายกำกับ (Tags คั่นด้วยเครื่องหมายจุลภาค ,)
                      </label>
                      <input
                        type="text"
                        value={form.tagsInput}
                        onChange={(e) =>
                          setForm({ ...form, tagsInput: e.target.value })
                        }
                        className="w-full rounded-md border border-slate-300 px-3 py-1.5 text-xs sm:text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">
                        URL ไฟล์เสียงบรรยาย (Audio URL)
                      </label>
                      <input
                        type="text"
                        value={form.audioUrl}
                        onChange={(e) =>
                          setForm({ ...form, audioUrl: e.target.value })
                        }
                        placeholder="/uploads/ai-...wav"
                        className="w-full rounded-md border border-slate-300 px-3 py-1.5 text-xs sm:text-sm"
                      />
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Right Column (4 Cols): Publishing Settings & Media Attachments */}
          <div className="lg:col-span-4 space-y-5">
            {/* Classification & Status Box */}
            <div className="rounded-lg bg-white border border-slate-200 p-5 space-y-4 shadow-2xs">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 border-b border-slate-100 pb-2.5">
                การจำแนกประเภทและสถานะ
              </h3>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                  ประเภทเนื้อหา
                </label>
                <div className="grid grid-cols-2 gap-1.5">
                  {CONTENT_TYPES.map((ct) => {
                    const active = form.contentType === ct.id;
                    return (
                      <button
                        key={ct.id}
                        type="button"
                        onClick={() => setForm({ ...form, contentType: ct.id })}
                        className={`flex items-center gap-1.5 rounded-md px-2.5 py-2 text-xs font-semibold border transition cursor-pointer ${
                          active
                            ? 'bg-slate-900 text-white border-slate-900'
                            : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                        }`}
                      >
                        {ct.icon}
                        <span className="truncate">{ct.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                  หมวดหมู่หลัก
                </label>
                <select
                  value={form.category}
                  onChange={(e) =>
                    setForm({ ...form, category: e.target.value as CategoryId })
                  }
                  className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-xs sm:text-sm font-medium text-slate-800 focus:border-slate-900 focus:outline-none"
                >
                  {CATEGORIES.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.nameTh}
                    </option>
                  ))}
                </select>
              </div>

              <div className="pt-2 border-t border-slate-100">
                <label className="flex items-center gap-2.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={form.isFeatured}
                    onChange={(e) =>
                      setForm({ ...form, isFeatured: e.target.checked })
                    }
                    className="h-4 w-4 rounded border-slate-300 accent-slate-900"
                  />
                  <span className="text-xs font-semibold text-slate-800">
                    ปักหมุดเป็นเนื้อหาเด่นหน้าแรก (Featured)
                  </span>
                </label>
              </div>
            </div>

            {/* Cover Image Box */}
            <div className="rounded-lg bg-white border border-slate-200 p-5 space-y-3.5 shadow-2xs">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 border-b border-slate-100 pb-2.5 flex items-center justify-between">
                <span>รูปภาพหน้าปก (Cover Image)</span>
                <ImageIcon className="w-3.5 h-3.5 text-slate-400" />
              </h3>

              <div className="aspect-video w-full rounded-md overflow-hidden border border-slate-200 bg-slate-100">
                <img
                  src={form.coverImage}
                  alt="Cover preview"
                  className="h-full w-full object-cover"
                  onError={(e) => {
                    (e.target as HTMLImageElement).src = '/images/thumb-ai-edu.jpg';
                  }}
                />
              </div>

              <div className="flex flex-col gap-2">
                <label className="w-full inline-flex items-center justify-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer">
                  <Upload className="w-3.5 h-3.5" />
                  {uploading ? 'กำลังอัปโหลด...' : 'อัปโหลดรูปภาพจากเครื่อง'}
                  <input
                    type="file"
                    accept="image/*"
                    onChange={handleUploadFile}
                    className="hidden"
                  />
                </label>

                <select
                  value=""
                  onChange={(e) => {
                    if (e.target.value) {
                      setForm({ ...form, coverImage: e.target.value });
                    }
                  }}
                  className="w-full rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs text-slate-700"
                >
                  <option value="">-- หรือเลือกภาพมาตรฐานของระบบ --</option>
                  {PRESET_IMAGES.map((img) => (
                    <option key={img.url} value={img.url}>
                      {img.label}
                    </option>
                  ))}
                </select>
              </div>

              {/* AI Cover Generator */}
              <div className="pt-3 border-t border-slate-100 space-y-2">
                <label className="block text-[11px] font-semibold text-slate-600">
                  สร้างภาพหน้าปกใหม่ด้วย AI
                </label>
                <input
                  type="text"
                  value={aiImagePrompt}
                  onChange={(e) => setAiImagePrompt(e.target.value)}
                  placeholder="ระบุคำอธิบายภาพ (หรือเว้นว่างเพื่ออ้างอิงตามหัวข้อ)"
                  className="w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-xs focus:border-slate-900 focus:outline-none"
                />
                <button
                  type="button"
                  disabled={generatingAiImage}
                  onClick={handleGenerateAiCover}
                  className="w-full inline-flex items-center justify-center gap-1.5 rounded-md bg-slate-900 px-3 py-2 text-xs font-semibold text-white hover:bg-slate-800 cursor-pointer disabled:opacity-50"
                >
                  <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                  {generatingAiImage ? 'กำลังสร้างภาพปก...' : 'สั่ง AI วาดภาพหน้าปก'}
                </button>
              </div>
            </div>

            {/* Video Attachment Box */}
            <div className="rounded-lg bg-white border border-slate-200 p-5 space-y-3 shadow-2xs">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 border-b border-slate-100 pb-2.5 flex items-center justify-between">
                <span>สื่อวิดีโอประกอบ (ถ้ามี)</span>
                <Film className="w-3.5 h-3.5 text-slate-400" />
              </h3>

              <input
                type="text"
                value={form.videoUrl}
                onChange={(e) => setForm({ ...form, videoUrl: e.target.value })}
                placeholder="URL YouTube หรือไฟล์วิดีโอ (.mp4)"
                className="w-full rounded-md border border-slate-300 px-3 py-1.5 text-xs focus:border-slate-900 focus:outline-none"
              />

              <div className="flex items-center gap-2">
                <label className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer">
                  <Upload className="w-3.5 h-3.5" />
                  {uploadingVideo ? 'กำลังอัปโหลด...' : 'อัปโหลดไฟล์ .MP4'}
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
                    className="rounded-md border border-rose-200 bg-rose-50 px-2.5 py-1.5 text-xs font-semibold text-rose-700 hover:bg-rose-100 cursor-pointer"
                  >
                    ล้างค่า
                  </button>
                )}
              </div>

              {form.videoUrl && form.videoUrl.startsWith('/uploads/') && (
                <video
                  src={form.videoUrl}
                  controls
                  playsInline
                  className="w-full rounded-md bg-black max-h-40"
                />
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // =========================================================================
  // FORMAL CMS LIST & ENTERPRISE DATA TABLE VIEW
  // =========================================================================
  return (
    <div className="space-y-4">
      {/* Toast Notification */}
      {toastMsg && (
        <div className="rounded-lg bg-emerald-50 border border-emerald-200 px-4 py-3 text-xs sm:text-sm font-medium text-emerald-900 flex items-center justify-between shadow-2xs">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>{toastMsg}</span>
          </div>
          <button
            type="button"
            onClick={() => setToastMsg(null)}
            className="text-emerald-700 hover:text-emerald-900 text-xs font-semibold cursor-pointer"
          >
            ปิด
          </button>
        </div>
      )}

      {errorMsg && (
        <div className="rounded-lg bg-rose-50 border border-rose-200 px-4 py-3 text-xs sm:text-sm font-medium text-rose-900 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
            <span>{errorMsg}</span>
          </div>
          <button
            type="button"
            onClick={() => setErrorMsg(null)}
            className="text-rose-700 hover:text-rose-900 text-xs font-semibold cursor-pointer"
          >
            ปิด
          </button>
        </div>
      )}

      {/* Control & Filter Panel */}
      <div className="rounded-lg bg-white border border-slate-200 p-4 sm:p-5 space-y-4 shadow-2xs">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3.5 border-b border-slate-100">
          <div>
            <h2 className="text-sm sm:text-base font-bold text-slate-900">
              ทะเบียนเนื้อหาและบทความเว็บไซต์
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              บริหารจัดการข่าวประชาสัมพันธ์ บทความวิชาการ สื่อวิดีโอ และหลักสูตรทั้งหมด
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handleExportPostsCsv}
              className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 transition cursor-pointer"
            >
              <Download className="w-3.5 h-3.5 text-slate-500" />
              ส่งออก CSV
            </button>
            <button
              type="button"
              onClick={handleExportBackupJson}
              className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 transition cursor-pointer"
            >
              <Download className="w-3.5 h-3.5 text-slate-500" />
              สำรองฐานข้อมูล
            </button>
            <label className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 transition cursor-pointer">
              <Upload className="w-3.5 h-3.5 text-slate-500" />
              {importingBackup ? 'กำลังนำเข้า...' : 'นำเข้าข้อมูล'}
              <input
                type="file"
                accept="application/json,.json"
                onChange={handleImportBackupJsonFile}
                className="hidden"
              />
            </label>
            <button
              type="button"
              onClick={openCreate}
              className="inline-flex items-center gap-1.5 rounded-md bg-slate-900 px-3.5 py-2 text-xs font-semibold text-white hover:bg-slate-800 transition cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5 text-amber-400" />
              สร้างเนื้อหาใหม่
            </button>
          </div>
        </div>

        {/* Filter & Search Bar */}
        <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-center">
          <div className="md:col-span-5 relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setCurrentPage(1);
              }}
              placeholder="ค้นหาตามชื่อเรื่อง คำสำคัญ หรือป้ายกำกับ..."
              className="w-full rounded-md border border-slate-300 bg-white pl-9 pr-3 py-2 text-xs sm:text-sm text-slate-900 focus:border-slate-900 focus:outline-none"
            />
          </div>

          <div className="md:col-span-4 flex items-center gap-1 overflow-x-auto no-scrollbar">
            {[
              { id: 'all', label: `ทั้งหมด (${posts.length})` },
              { id: 'published', label: `เผยแพร่ (${publishedCount})` },
              { id: 'draft', label: `ฉบับร่าง (${draftCount})` },
              { id: 'featured', label: `ปักหมุด (${featuredCount})` },
            ].map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => {
                  setQuickFilter(tab.id as any);
                  setCurrentPage(1);
                }}
                className={`rounded-md px-2.5 py-1.5 text-xs font-semibold shrink-0 transition cursor-pointer ${
                  quickFilter === tab.id
                    ? 'bg-slate-900 text-white'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200/70'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div className="md:col-span-3 grid grid-cols-2 gap-2">
            <select
              value={categoryFilter}
              onChange={(e) => {
                setCategoryFilter(e.target.value);
                setCurrentPage(1);
              }}
              className="rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700"
            >
              <option value="all">ทุกหมวดหมู่</option>
              {CATEGORIES.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nameTh}
                </option>
              ))}
            </select>

            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as any)}
              className="rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700"
            >
              <option value="newest">ล่าสุดก่อน</option>
              <option value="oldest">เก่าสุดก่อน</option>
              <option value="views_desc">ยอดเข้าชมสูงสุด</option>
              <option value="title_asc">เรียงตาม ก-ฮ</option>
            </select>
          </div>
        </div>

        {/* Bulk Action Bar */}
        {selectedIds.length > 0 && (
          <div className="rounded-md bg-slate-900 text-white px-4 py-2.5 flex flex-wrap items-center justify-between gap-2 text-xs">
            <span className="font-semibold">
              เลือกแล้ว {selectedIds.length} รายการ
            </span>
            <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                disabled={bulkBusy}
                onClick={() => handleBulkAction('publish')}
                className="rounded bg-emerald-600 px-2.5 py-1 font-semibold hover:bg-emerald-700 cursor-pointer"
              >
                เผยแพร่ที่เลือก
              </button>
              <button
                type="button"
                disabled={bulkBusy}
                onClick={() => handleBulkAction('draft')}
                className="rounded bg-slate-700 px-2.5 py-1 font-semibold hover:bg-slate-600 cursor-pointer"
              >
                เปลี่ยนเป็นฉบับร่าง
              </button>
              <select
                defaultValue=""
                disabled={bulkBusy}
                onChange={(e) => {
                  if (e.target.value) {
                    handleBulkAction('category', e.target.value);
                    e.target.value = '';
                  }
                }}
                className="rounded bg-slate-800 border border-slate-700 px-2 py-1 text-white font-medium"
              >
                <option value="">ย้ายหมวดหมู่...</option>
                {CATEGORIES.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.nameTh}
                  </option>
                ))}
              </select>
              {bulkDeleteConfirm ? (
                <div className="inline-flex items-center gap-1 bg-rose-950 border border-rose-700 rounded px-2 py-0.5">
                  <button
                    type="button"
                    disabled={bulkBusy}
                    onClick={() => handleBulkAction('delete')}
                    className="font-bold text-rose-300 hover:text-white cursor-pointer"
                  >
                    ยืนยันลบ ({selectedIds.length})
                  </button>
                  <button
                    type="button"
                    onClick={() => setBulkDeleteConfirm(false)}
                    className="text-slate-300 ml-1 cursor-pointer"
                  >
                    ยกเลิก
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  disabled={bulkBusy}
                  onClick={() => setBulkDeleteConfirm(true)}
                  className="rounded bg-rose-600 px-2.5 py-1 font-semibold hover:bg-rose-700 cursor-pointer"
                >
                  ลบที่เลือก
                </button>
              )}
              <button
                type="button"
                onClick={() => setSelectedIds([])}
                className="text-slate-300 hover:text-white px-2 py-1 cursor-pointer"
              >
                ยกเลิกการเลือก
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Empty State */}
      {filtered.length === 0 ? (
        <div className="rounded-lg bg-white border border-slate-200 p-10 text-center space-y-2">
          <p className="text-sm font-semibold text-slate-700">
            ไม่พบรายการเนื้อหาที่ตรงกับเงื่อนไขการค้นหา
          </p>
          <p className="text-xs text-slate-500">
            ลองปรับตัวกรองหมวดหมู่ หรือคลิกปุ่มสร้างเนื้อหาใหม่ด้านบน
          </p>
        </div>
      ) : (
        <>
          {/* DESKTOP DATA TABLE (md and up) */}
          <div className="hidden md:block rounded-lg bg-white border border-slate-200 shadow-2xs overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                    <th className="py-3 pl-4 pr-2 w-9">
                      <button
                        type="button"
                        onClick={toggleSelectAllFiltered}
                        className="text-slate-400 hover:text-slate-700 cursor-pointer flex items-center"
                      >
                        {paginatedPosts.length > 0 &&
                        paginatedPosts.every((p) => selectedIds.includes(p.id)) ? (
                          <CheckSquare className="w-4 h-4 text-slate-900" />
                        ) : (
                          <Square className="w-4 h-4" />
                        )}
                      </button>
                    </th>
                    <th className="py-3 px-3">เนื้อหา / หัวข้อ</th>
                    <th className="py-3 px-3 w-36">หมวดหมู่</th>
                    <th className="py-3 px-3 w-28">สถานะ</th>
                    <th className="py-3 px-3 w-28">สถิติ / วันที่</th>
                    <th className="py-3 pl-3 pr-4 text-right w-56">การจัดการ</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 text-xs">
                  {paginatedPosts.map((p) => {
                    const cat = CATEGORIES.find((c) => c.id === p.category);
                    const isPublished = p.status === 'published';
                    const isSelected = selectedIds.includes(p.id);
                    const isConfirming = confirmDeleteId === p.id;

                    return (
                      <tr
                        key={p.id}
                        className={`hover:bg-slate-50/80 transition ${
                          isSelected ? 'bg-slate-50' : ''
                        }`}
                      >
                        <td className="py-3 pl-4 pr-2 align-middle">
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => toggleSelectId(p.id)}
                            className="h-4 w-4 rounded border-slate-300 accent-slate-900 cursor-pointer"
                          />
                        </td>
                        <td className="py-3 px-3 align-middle">
                          <div className="flex items-center gap-3">
                            <img
                              src={p.coverImage}
                              alt={p.title}
                              className="h-11 w-16 rounded object-cover border border-slate-200 bg-slate-100 shrink-0"
                              onError={(e) => {
                                (e.target as HTMLImageElement).src =
                                  '/images/thumb-ai-edu.jpg';
                              }}
                            />
                            <div className="min-w-0">
                              <div className="flex items-center gap-1.5">
                                {p.isFeatured && (
                                  <span className="inline-flex items-center gap-0.5 rounded bg-amber-50 border border-amber-200 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800 shrink-0">
                                    <Star className="w-2.5 h-2.5 fill-amber-500 text-amber-500" />
                                    แนะนำ
                                  </span>
                                )}
                                <button
                                  type="button"
                                  onClick={() => openEdit(p)}
                                  className="font-semibold text-slate-900 hover:text-slate-700 text-left line-clamp-1 cursor-pointer"
                                >
                                  {p.title}
                                </button>
                              </div>
                              <p className="text-[11px] text-slate-500 line-clamp-1 mt-0.5">
                                {p.excerpt}
                              </p>
                            </div>
                          </div>
                        </td>
                        <td className="py-3 px-3 align-middle">
                          <span className="inline-block rounded bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-700">
                            {cat?.nameTh || 'ทั่วไป'}
                          </span>
                          <div className="text-[10px] text-slate-400 mt-0.5">
                            {CONTENT_TYPES.find((c) => c.id === p.contentType)
                              ?.label || p.contentType}
                          </div>
                        </td>
                        <td className="py-3 px-3 align-middle">
                          <button
                            type="button"
                            disabled={busyId === p.id}
                            onClick={() => handleToggleStatus(p)}
                            title="คลิกเพื่อสลับสถานะ"
                            className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-semibold cursor-pointer ${
                              isPublished
                                ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                                : 'bg-slate-100 text-slate-600 border border-slate-200'
                            }`}
                          >
                            <span
                              className={`h-1.5 w-1.5 rounded-full ${
                                isPublished ? 'bg-emerald-600' : 'bg-slate-400'
                              }`}
                            />
                            {isPublished ? 'เผยแพร่แล้ว' : 'ฉบับร่าง'}
                          </button>
                        </td>
                        <td className="py-3 px-3 align-middle text-[11px] text-slate-600">
                          <div className="font-medium text-slate-800">
                            {formatViews(p.views)} ครั้ง
                          </div>
                          <div className="text-slate-400">
                            {formatThaiDate(p.createdAt)}
                          </div>
                        </td>
                        <td className="py-3 pl-3 pr-4 align-middle text-right">
                          {isConfirming ? (
                            <div className="inline-flex items-center gap-1.5 bg-rose-50 border border-rose-200 rounded-md px-2 py-1">
                              <span className="text-[11px] font-semibold text-rose-800">
                                ยืนยันลบ?
                              </span>
                              <button
                                type="button"
                                onClick={() => executeDelete(p)}
                                className="rounded bg-rose-600 px-2 py-0.5 text-[11px] font-semibold text-white hover:bg-rose-700 cursor-pointer"
                              >
                                ลบ
                              </button>
                              <button
                                type="button"
                                onClick={() => setConfirmDeleteId(null)}
                                className="text-[11px] font-medium text-slate-600 hover:text-slate-900 cursor-pointer"
                              >
                                ยกเลิก
                              </button>
                            </div>
                          ) : (
                            <div className="inline-flex items-center justify-end gap-1">
                              <button
                                type="button"
                                onClick={() => openEdit(p)}
                                className="rounded border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
                              >
                                แก้ไข
                              </button>
                              <button
                                type="button"
                                onClick={() => onPreviewPost(p.id)}
                                title="ดูตัวอย่างหน้าเว็บ"
                                className="rounded border border-slate-200 bg-white p-1.5 text-slate-600 hover:bg-slate-50 cursor-pointer"
                              >
                                <Eye className="w-3.5 h-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={() => handleToggleFeatured(p)}
                                title={
                                  p.isFeatured
                                    ? 'ยกเลิกปักหมุด'
                                    : 'ปักหมุดเป็นเนื้อหาแนะนำ'
                                }
                                className={`rounded border p-1.5 cursor-pointer ${
                                  p.isFeatured
                                    ? 'border-amber-300 bg-amber-50 text-amber-600'
                                    : 'border-slate-200 bg-white text-slate-400 hover:text-slate-700'
                                }`}
                              >
                                <Star className="w-3.5 h-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={() => handleDuplicatePost(p)}
                                title="ทำสำเนา"
                                className="rounded border border-slate-200 bg-white p-1.5 text-slate-600 hover:bg-slate-50 cursor-pointer"
                              >
                                <Copy className="w-3.5 h-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={() => setConfirmDeleteId(p.id)}
                                title="ลบเนื้อหา"
                                className="rounded border border-slate-200 bg-white p-1.5 text-rose-600 hover:bg-rose-50 hover:border-rose-200 cursor-pointer"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* MOBILE CARD LIST (< md) */}
          <div className="md:hidden space-y-2.5">
            {paginatedPosts.map((p) => {
              const cat = CATEGORIES.find((c) => c.id === p.category);
              const isPublished = p.status === 'published';
              const isConfirming = confirmDeleteId === p.id;

              return (
                <div
                  key={p.id}
                  className="rounded-lg bg-white border border-slate-200 p-3.5 space-y-3 shadow-2xs"
                >
                  <div className="flex items-start gap-3">
                    <img
                      src={p.coverImage}
                      alt={p.title}
                      className="h-14 w-20 rounded object-cover border border-slate-200 shrink-0"
                      onError={(e) => {
                        (e.target as HTMLImageElement).src =
                          '/images/thumb-ai-edu.jpg';
                      }}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5 mb-1">
                        <span
                          className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                            isPublished
                              ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                              : 'bg-slate-100 text-slate-600'
                          }`}
                        >
                          {isPublished ? 'เผยแพร่แล้ว' : 'ฉบับร่าง'}
                        </span>
                        <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600">
                          {cat?.nameTh || 'ทั่วไป'}
                        </span>
                      </div>
                      <h3 className="text-xs font-bold text-slate-900 line-clamp-2">
                        {p.title}
                      </h3>
                      <div className="text-[11px] text-slate-400 mt-0.5">
                        {formatThaiDate(p.createdAt)} • {formatViews(p.views)} ครั้ง
                      </div>
                    </div>
                  </div>

                  {isConfirming ? (
                    <div className="flex items-center justify-between rounded bg-rose-50 border border-rose-200 px-3 py-2 text-xs">
                      <span className="font-semibold text-rose-800">
                        ยืนยันการลบรายการนี้?
                      </span>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => executeDelete(p)}
                          className="rounded bg-rose-600 px-2.5 py-1 font-semibold text-white"
                        >
                          ยืนยันลบ
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteId(null)}
                          className="rounded border border-slate-300 bg-white px-2.5 py-1 font-medium text-slate-700"
                        >
                          ยกเลิก
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="pt-2.5 border-t border-slate-100 flex items-center justify-between gap-1.5">
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => openEdit(p)}
                          className="inline-flex items-center gap-1 rounded border border-slate-300 bg-white px-2.5 py-1 text-xs font-semibold text-slate-800"
                        >
                          <Edit3 className="w-3 h-3" /> แก้ไข
                        </button>
                        <button
                          type="button"
                          onClick={() => onPreviewPost(p.id)}
                          className="inline-flex items-center gap-1 rounded border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-600"
                        >
                          <Eye className="w-3 h-3" /> ดูหน้าเว็บ
                        </button>
                        <button
                          type="button"
                          onClick={() => handleToggleStatus(p)}
                          className="rounded border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-600"
                        >
                          {isPublished ? 'ซ่อน' : 'เผยแพร่'}
                        </button>
                      </div>
                      <button
                        type="button"
                        onClick={() => setConfirmDeleteId(p.id)}
                        className="p-1.5 text-rose-600 hover:bg-rose-50 rounded"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}

      {/* Pagination Bar */}
      {filtered.length > 0 && (
        <div className="rounded-lg bg-white border border-slate-200 px-4 py-3 flex flex-wrap items-center justify-between gap-3 text-xs text-slate-600">
          <div>
            แสดงรายการที่ {(safePage - 1) * pageSize + 1} ถึง{' '}
            {Math.min(safePage * pageSize, filtered.length)} จากทั้งหมด{' '}
            <strong className="text-slate-900">{filtered.length}</strong> รายการ
          </div>

          <div className="flex items-center gap-2">
            <select
              value={pageSize}
              onChange={(e) => {
                setPageSize(Number(e.target.value));
                setCurrentPage(1);
              }}
              className="rounded border border-slate-300 bg-white px-2 py-1 text-xs font-medium"
            >
              <option value={8}>8 รายการ/หน้า</option>
              <option value={12}>12 รายการ/หน้า</option>
              <option value={24}>24 รายการ/หน้า</option>
              <option value={100}>100 รายการ/หน้า</option>
            </select>

            <button
              type="button"
              disabled={safePage <= 1}
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              className="rounded border border-slate-300 bg-white px-2.5 py-1 font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40 cursor-pointer"
            >
              ก่อนหน้า
            </button>
            <span className="font-semibold text-slate-900 px-1.5">
              หน้า {safePage} / {totalPages}
            </span>
            <button
              type="button"
              disabled={safePage >= totalPages}
              onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
              className="rounded border border-slate-300 bg-white px-2.5 py-1 font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40 cursor-pointer"
            >
              ถัดไป
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
