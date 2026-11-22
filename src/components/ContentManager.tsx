import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Download, ExternalLink, Search, Upload } from 'lucide-react';
import { api, formatThaiDate, formatViews } from '../api';
import { CATEGORIES, CategoryId, ContentType, Post, PostStatus, SampleDataReport } from '../types';
import { renderRichMarkdown } from './RichContent';
import { Button, Card, ConfirmDialog, Field, Input, Notice, Select, StatusText, Textarea } from './ui';

interface Props {
  posts: Post[];
  initialEditPost: Post | null;
  prefillNewPost?: Partial<Post> | null;
  openCreateImmediately?: boolean;
  onClearInitialEdit: () => void;
  onRefresh: () => Promise<void>;
  onPreviewPost: (id: number) => void;
  onOpenSettings: () => void;
  onEditWithCeo: (postId: number) => void;
  onWriteWithCeo: () => void;
}

const PAGE_SIZE = 15;
const TYPE_LABEL: Record<ContentType, string> = {
  news: 'ข่าว',
  article: 'บทความ',
  video: 'วิดีโอ',
  course: 'หลักสูตร',
};

interface FormState {
  title: string;
  subtitle: string;
  excerpt: string;
  slug: string;
  content: string;
  category: CategoryId;
  contentType: ContentType;
  coverImage: string;
  videoUrl: string;
  audioUrl: string;
  tags: string;
  author: string;
  status: PostStatus;
  isFeatured: boolean;
}

const EMPTY: FormState = {
  title: '',
  subtitle: '',
  excerpt: '',
  slug: '',
  content: '',
  category: 'education',
  contentType: 'article',
  coverImage: '/images/thumb-ai-edu.jpg',
  videoUrl: '',
  audioUrl: '',
  tags: '',
  author: 'คมกฤช (Komkrit)',
  status: 'draft',
  isFeatured: false,
};

function suggestSlug(title: string): string {
  return title
    .normalize('NFC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\p{M}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

function fromPost(p: Partial<Post>): FormState {
  return {
    title: p.title || '',
    subtitle: p.subtitle || '',
    excerpt: p.excerpt || '',
    slug: p.slug || '',
    content: p.content || '',
    category: (p.category as CategoryId) || 'education',
    contentType: (p.contentType as ContentType) || 'article',
    coverImage: p.coverImage || '/images/thumb-ai-edu.jpg',
    videoUrl: p.videoUrl || '',
    audioUrl: p.audioUrl || '',
    tags: (p.tags || []).join(', '),
    author: p.author || 'คมกฤช (Komkrit)',
    status: (p.status as PostStatus) || 'draft',
    isFeatured: Boolean(p.isFeatured),
  };
}

export const ContentManager: React.FC<Props> = ({
  posts,
  initialEditPost,
  prefillNewPost,
  openCreateImmediately,
  onClearInitialEdit,
  onRefresh,
  onPreviewPost,
  onOpenSettings,
  onEditWithCeo,
  onWriteWithCeo,
}) => {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | PostStatus>('all');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [sort, setSort] = useState<'newest' | 'oldest' | 'views' | 'title'>('newest');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<number[]>([]);
  const [notice, setNotice] = useState<{ type: 'ok' | 'error'; text: string } | null>(null);

  const [editing, setEditing] = useState<'none' | 'new' | number>('none');
  const [form, setForm] = useState<FormState>(EMPTY);
  const [slugTouched, setSlugTouched] = useState(false);
  const [preview, setPreview] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [uploading, setUploading] = useState<string | null>(null);

  const [deleteTarget, setDeleteTarget] = useState<Post | null>(null);
  const [bulkDelete, setBulkDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [sample, setSample] = useState<SampleDataReport | null>(null);
  const [sampleOpen, setSampleOpen] = useState(false);
  const [dialogError, setDialogError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const importRef = useRef<HTMLInputElement>(null);
  const uploadTarget = useRef<'coverImage' | 'videoUrl' | 'audioUrl'>('coverImage');

  useEffect(() => {
    api.getSampleData().then(setSample).catch(() => setSample(null));
  }, [posts.length]);

  const removeSample = async () => {
    setBusy(true);
    setDialogError('');
    try {
      const out = await api.removeSampleData();
      setSample(null);
      setSampleOpen(false);
      await onRefresh();
      say('ok', `ลบข้อมูลตัวอย่างแล้ว ${out.removed.total} รายการ`);
    } catch (e) {
      setDialogError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const say = (type: 'ok' | 'error', text: string) => {
    setNotice({ type, text });
    if (type === 'ok') setTimeout(() => setNotice(null), 4000);
  };

  const openNew = (seed?: Partial<Post>) => {
    setForm(seed ? fromPost({ ...seed, status: seed.status || 'draft' }) : EMPTY);
    setSlugTouched(Boolean(seed?.slug));
    setPreview(false);
    setFormError('');
    setEditing('new');
    window.scrollTo({ top: 0 });
  };
  const openEdit = (p: Post) => {
    setForm(fromPost(p));
    setSlugTouched(true);
    setPreview(false);
    setFormError('');
    setEditing(p.id);
    window.scrollTo({ top: 0 });
  };

  useEffect(() => {
    if (initialEditPost) {
      openEdit(initialEditPost);
      onClearInitialEdit();
    }
  }, [initialEditPost]);
  useEffect(() => {
    if (prefillNewPost) {
      openNew(prefillNewPost);
      onClearInitialEdit();
    }
  }, [prefillNewPost]);
  useEffect(() => {
    if (openCreateImmediately && !initialEditPost) {
      openNew();
      onClearInitialEdit();
    }
  }, [openCreateImmediately]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let list = posts.filter((p) => {
      if (statusFilter !== 'all' && p.status !== statusFilter) return false;
      if (categoryFilter !== 'all' && p.category !== categoryFilter) return false;
      if (q && !`${p.title} ${p.subtitle} ${p.excerpt} ${p.slug} ${p.tags.join(' ')}`.toLowerCase().includes(q)) return false;
      return true;
    });
    list = [...list].sort((a, b) =>
      sort === 'oldest'
        ? a.createdAt.localeCompare(b.createdAt)
        : sort === 'views'
        ? b.views - a.views
        : sort === 'title'
        ? a.title.localeCompare(b.title, 'th')
        : b.createdAt.localeCompare(a.createdAt)
    );
    return list;
  }, [posts, search, statusFilter, categoryFilter, sort]);

  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const current = Math.min(page, pages);
  const rows = filtered.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE);
  const allOnPage = rows.length > 0 && rows.every((r) => selected.includes(r.id));

  // ------------------------------------------------------------ actions
  const save = async (close: boolean) => {
    setFormError('');
    if (!form.title.trim()) return setFormError('กรุณาระบุชื่อเรื่อง');
    if (!form.content.trim()) return setFormError('กรุณาระบุเนื้อหา');
    setSaving(true);
    try {
      const payload = {
        title: form.title.trim(),
        subtitle: form.subtitle.trim(),
        excerpt: form.excerpt.trim(),
        content: form.content,
        slug: form.slug.trim() || undefined,
        category: form.category,
        contentType: form.contentType,
        coverImage: form.coverImage || '/images/thumb-ai-edu.jpg',
        videoUrl: form.videoUrl.trim(),
        audioUrl: form.audioUrl.trim(),
        tags: form.tags.split(',').map((t) => t.trim()).filter(Boolean),
        author: form.author.trim() || 'คมกฤช (Komkrit)',
        status: form.status,
        isFeatured: form.isFeatured,
      } as Partial<Post>;
      const saved = editing === 'new' ? await api.createPost(payload) : await api.updatePost(editing as number, payload);
      await onRefresh();
      say('ok', editing === 'new' ? 'สร้างบทความแล้ว' : 'บันทึกการแก้ไขแล้ว');
      if (close) setEditing('none');
      else {
        setEditing(saved.id);
        setForm((f) => ({ ...f, slug: saved.slug }));
        setSlugTouched(true);
      }
    } catch (e) {
      setFormError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const doDelete = async () => {
    if (!deleteTarget) return;
    setBusy(true);
    setDialogError('');
    try {
      const out = await api.deletePost(deleteTarget.id);
      await onRefresh();
      setSelected((s) => s.filter((x) => x !== deleteTarget.id));
      setDeleteTarget(null);
      if (editing === deleteTarget.id) setEditing('none');
      say('ok', `ลบ "${out.title}" แล้ว${out.removedComments ? ` (รวมความคิดเห็น ${out.removedComments} รายการ)` : ''}`);
    } catch (e) {
      setDialogError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const doBulk = async (action: 'publish' | 'draft' | 'delete') => {
    setBusy(true);
    setDialogError('');
    try {
      const out = await api.bulkPostsAction({ ids: selected, action });
      await onRefresh();
      setSelected([]);
      setBulkDelete(false);
      say('ok', `${action === 'delete' ? 'ลบ' : action === 'publish' ? 'เผยแพร่' : 'ตั้งเป็นฉบับร่าง'} ${out.affected} รายการแล้ว`);
    } catch (e) {
      setDialogError((e as Error).message);
      if (action !== 'delete') say('error', (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const duplicate = async (p: Post) => {
    try {
      await api.duplicatePost(p.id);
      await onRefresh();
      say('ok', `ทำสำเนา "${p.title}" เป็นฉบับร่างแล้ว`);
    } catch (e) {
      say('error', (e as Error).message);
    }
  };

  const upload = async (file: File | undefined) => {
    if (!file) return;
    const key = uploadTarget.current;
    setUploading(key);
    try {
      const url = key === 'videoUrl' ? await api.uploadVideo(file) : await api.uploadFile(file);
      setForm((f) => ({ ...f, [key]: url }));
    } catch (e) {
      setFormError((e as Error).message);
    } finally {
      setUploading(null);
      if (fileRef.current) fileRef.current.value = '';
    }
  };
  const pickFile = (key: 'coverImage' | 'videoUrl' | 'audioUrl') => {
    uploadTarget.current = key;
    if (fileRef.current) {
      fileRef.current.accept = key === 'coverImage' ? 'image/*' : key === 'videoUrl' ? 'video/*' : 'audio/*';
      fileRef.current.click();
    }
  };

  const exportBackup = async () => {
    try {
      const backup = await api.exportDatabaseBackup();
      const url = URL.createObjectURL(new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `backup-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      say('error', (e as Error).message);
    }
  };
  const importBackup = async (file: File | undefined) => {
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      await api.importDatabaseBackup(data);
      await onRefresh();
      say('ok', 'นำเข้าข้อมูลสำรองแล้ว');
    } catch (e) {
      say('error', `นำเข้าไม่สำเร็จ: ${(e as Error).message}`);
    } finally {
      if (importRef.current) importRef.current.value = '';
    }
  };

  const catName = (id: string) => CATEGORIES.find((c) => c.id === id)?.nameTh || id;

  // ------------------------------------------------------------ editor
  if (editing !== 'none') {
    const isNew = editing === 'new';
    const existing = isNew ? null : posts.find((p) => p.id === editing) || null;
    const slugValue = form.slug || suggestSlug(form.title);
    return (
      <div className="space-y-4">
        <input ref={fileRef} type="file" className="hidden" onChange={(e) => upload(e.target.files?.[0])} />
        <div className="flex flex-wrap items-center justify-between gap-3">
          <button onClick={() => setEditing('none')} className="inline-flex items-center gap-1.5 text-sm text-slate-600 hover:text-slate-900 cursor-pointer">
            <ArrowLeft className="h-4 w-4" /> กลับไปรายการ
          </button>
          <div className="flex flex-wrap gap-2">
            {existing && (
              <>
                <Button size="sm" onClick={() => onEditWithCeo(existing.id)}>
                  แก้ไขร่วมกับ CEO
                </Button>
                <Button size="sm" variant="danger" onClick={() => setDeleteTarget(existing)}>
                  ลบ
                </Button>
              </>
            )}
            <Button size="sm" disabled={saving} onClick={() => save(false)}>
              {saving ? 'กำลังบันทึก' : 'บันทึก'}
            </Button>
            <Button size="sm" variant="primary" disabled={saving} onClick={() => save(true)}>
              บันทึกและปิด
            </Button>
          </div>
        </div>
        {formError && <Notice tone="error">{formError}</Notice>}

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
          <Card className="space-y-4 p-5">
            <Field label="ชื่อเรื่อง">
              <Input
                value={form.title}
                maxLength={200}
                onChange={(e) => {
                  const title = e.target.value;
                  setForm((f) => ({ ...f, title, slug: slugTouched ? f.slug : suggestSlug(title) }));
                }}
              />
            </Field>
            <Field label="คำโปรย">
              <Input value={form.subtitle} maxLength={300} onChange={(e) => setForm({ ...form, subtitle: e.target.value })} />
            </Field>
            <Field label="สรุปสั้น (แสดงในรายการและตอนแชร์ลิงก์)">
              <Textarea rows={2} value={form.excerpt} maxLength={300} onChange={(e) => setForm({ ...form, excerpt: e.target.value })} />
            </Field>
            <div>
              <div className="mb-1 flex items-center justify-between">
                <span className="text-xs font-medium text-slate-700">เนื้อหา (Markdown: ## หัวข้อ, - รายการ, ![คำบรรยาย](ลิงก์รูป))</span>
                <div className="flex gap-1">
                  <Button size="sm" variant={preview ? 'secondary' : 'primary'} onClick={() => setPreview(false)}>
                    แก้ไข
                  </Button>
                  <Button size="sm" variant={preview ? 'primary' : 'secondary'} onClick={() => setPreview(true)}>
                    ตัวอย่าง
                  </Button>
                </div>
              </div>
              {preview ? (
                <div className="max-h-[36rem] overflow-y-auto rounded-md border border-slate-200 p-5">{renderRichMarkdown(form.content)}</div>
              ) : (
                <Textarea rows={22} value={form.content} maxLength={60000} onChange={(e) => setForm({ ...form, content: e.target.value })} className="font-mono text-[13px] leading-relaxed" />
              )}
            </div>
          </Card>

          <div className="space-y-4">
            <Card className="space-y-4 p-5">
              <Field label="สถานะ">
                <Select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as PostStatus })}>
                  <option value="draft">ฉบับร่าง (ไม่แสดงบนเว็บ)</option>
                  <option value="published">เผยแพร่</option>
                </Select>
              </Field>
              <Field label="ที่อยู่บทความ (slug)" hint={`/articles/${slugValue || '...'}`}>
                <Input
                  value={form.slug}
                  maxLength={100}
                  placeholder={suggestSlug(form.title) || 'สร้างจากชื่อเรื่องอัตโนมัติ'}
                  onChange={(e) => {
                    setSlugTouched(true);
                    setForm({ ...form, slug: e.target.value.toLowerCase() });
                  }}
                />
              </Field>
              <Field label="หมวดหมู่">
                <Select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value as CategoryId })}>
                  {CATEGORIES.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.nameTh}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="ประเภท">
                <Select value={form.contentType} onChange={(e) => setForm({ ...form, contentType: e.target.value as ContentType })}>
                  {(Object.keys(TYPE_LABEL) as ContentType[]).map((t) => (
                    <option key={t} value={t}>
                      {TYPE_LABEL[t]}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="แท็ก (คั่นด้วยจุลภาค)">
                <Input value={form.tags} onChange={(e) => setForm({ ...form, tags: e.target.value })} />
              </Field>
              <Field label="ผู้เขียน">
                <Input value={form.author} onChange={(e) => setForm({ ...form, author: e.target.value })} />
              </Field>
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input type="checkbox" className="accent-brand-600" checked={form.isFeatured} onChange={(e) => setForm({ ...form, isFeatured: e.target.checked })} />
                ปักหมุดเป็นบทความเด่นหน้าแรก
              </label>
            </Card>

            <Card className="space-y-4 p-5">
              {(
                [
                  ['coverImage', 'รูปปก'],
                  ['videoUrl', 'วิดีโอ (ลิงก์ YouTube หรืออัปโหลด)'],
                  ['audioUrl', 'เสียงบรรยาย'],
                ] as const
              ).map(([key, label]) => (
                <Field key={key} label={label}>
                  <div className="flex gap-2">
                    <Input value={form[key]} onChange={(e) => setForm({ ...form, [key]: e.target.value })} placeholder="https://... หรืออัปโหลด" />
                    <Button size="sm" onClick={() => pickFile(key)} disabled={uploading !== null} aria-label={`อัปโหลด${label}`}>
                      <Upload className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                  {key === 'coverImage' && form.coverImage && <img src={form.coverImage} alt="" className="mt-2 w-full rounded-md border border-slate-200" />}
                </Field>
              ))}
              {uploading && <p className="text-xs text-slate-500">กำลังอัปโหลด</p>}
            </Card>
          </div>
        </div>
        <ConfirmDialog
          open={Boolean(deleteTarget)}
          title="ลบบทความ"
          danger
          busy={busy}
          error={dialogError}
          confirmLabel="ลบถาวร"
          message={deleteTarget && <>ลบ <strong>{deleteTarget.title}</strong> ถาวร พร้อมความคิดเห็นทั้งหมดของบทความนี้ ไม่สามารถกู้คืนได้</>}
          onConfirm={doDelete}
          onCancel={() => {
            setDeleteTarget(null);
            setDialogError('');
          }}
        />
      </div>
    );
  }

  // ------------------------------------------------------------ list
  return (
    <div className="space-y-4">
      <input ref={importRef} type="file" accept="application/json" className="hidden" onChange={(e) => importBackup(e.target.files?.[0])} />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm text-slate-600">
            ทั้งหมด {posts.length} รายการ, เผยแพร่ {posts.filter((p) => p.status === 'published').length}, ฉบับร่าง {posts.filter((p) => p.status === 'draft').length}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={exportBackup}>
            <Download className="h-3.5 w-3.5" /> สำรองข้อมูล
          </Button>
          <Button size="sm" onClick={() => importRef.current?.click()}>
            <Upload className="h-3.5 w-3.5" /> นำเข้า
          </Button>
          <Button size="sm" onClick={() => openNew()}>
            เขียนเอง
          </Button>
          <Button size="sm" variant="primary" onClick={onWriteWithCeo}>
            สั่ง CEO เขียน
          </Button>
        </div>
      </div>

      {notice && <Notice tone={notice.type === 'ok' ? 'ok' : 'error'}>{notice.text}</Notice>}

      {sample && sample.total > 0 && (
        <div className="flex flex-col justify-between gap-3 rounded-md border border-amber-300 bg-amber-50 p-4 sm:flex-row sm:items-center">
          <div>
            <div className="text-sm font-medium text-slate-900">พบข้อมูลตัวอย่างที่ติดมากับระบบตอนติดตั้ง ({sample.total} รายการ)</div>
            <p className="mt-0.5 text-sm text-slate-600">
              เป็นบทความสาธิต ความคิดเห็น รายชื่อ และตัวเลขสมมติ ไม่ใช่ข้อมูลจริงของคุณ ควรลบออกก่อนใช้งานจริง ระบบจะลบเฉพาะรายการที่ตรงกับข้อมูลตัวอย่างเท่านั้น
              สิ่งที่คุณเขียนหรือแก้ไขเองจะไม่ถูกแตะ
            </p>
          </div>
          <Button variant="primary" onClick={() => setSampleOpen(true)} className="shrink-0">
            ตรวจดูและลบ
          </Button>
        </div>
      )}

      <ConfirmDialog
        open={sampleOpen}
        title="ลบข้อมูลตัวอย่าง"
        danger
        busy={busy}
        error={dialogError}
        confirmLabel="ลบข้อมูลตัวอย่างทั้งหมด"
        message={
          sample && (
            <div className="space-y-2">
              <p>รายการที่จะถูกลบถาวร (ไม่สามารถกู้คืนได้):</p>
              <ul className="list-disc space-y-0.5 pl-5">
                {sample.posts.length > 0 && <li>บทความสาธิต {sample.posts.length} เรื่อง พร้อมยอดเข้าชมสมมติ</li>}
                {sample.comments > 0 && <li>ความคิดเห็นสมมติ {sample.comments} รายการ</li>}
                {sample.knowledge > 0 && <li>คลังความรู้ตัวอย่าง {sample.knowledge} รายการ</li>}
                {sample.subscribers > 0 && <li>รายชื่อสมาชิกสมมติ {sample.subscribers} รายชื่อ</li>}
                {sample.surveys > 0 && <li>แบบสอบถามสมมติ {sample.surveys} รายการ</li>}
                {sample.campaigns > 0 && <li>แคมเปญ AI ตัวอย่าง {sample.campaigns} รายการ</li>}
                {sample.publishLogs > 0 && <li>ประวัติการเผยแพร่สมมติ {sample.publishLogs} รายการ</li>}
                {sample.pillarsWithInventedMetrics > 0 && <li>ตัวเลขสมมติในโมเดลธุรกิจหน้าแรก {sample.pillarsWithInventedMetrics} รายการ (จะถูกล้างค่า)</li>}
                {sample.channelsWithExampleHandles > 0 && <li>ลิงก์บัญชีโซเชียลตัวอย่าง {sample.channelsWithExampleHandles} ช่องทาง (จะถูกล้างค่า)</li>}
              </ul>
            </div>
          )
        }
        onConfirm={removeSample}
        onCancel={() => {
          setSampleOpen(false);
          setDialogError('');
        }}
      />

      <Card className="p-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[14rem] flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <Input
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              placeholder="ค้นหาชื่อเรื่อง สรุป slug หรือแท็ก"
              className="pl-9"
            />
          </div>
          <Select value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value as any); setPage(1); }} className="w-auto" aria-label="สถานะ">
            <option value="all">ทุกสถานะ</option>
            <option value="published">เผยแพร่</option>
            <option value="draft">ฉบับร่าง</option>
          </Select>
          <Select value={categoryFilter} onChange={(e) => { setCategoryFilter(e.target.value); setPage(1); }} className="w-auto" aria-label="หมวดหมู่">
            <option value="all">ทุกหมวดหมู่</option>
            {CATEGORIES.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nameTh}
              </option>
            ))}
          </Select>
          <Select value={sort} onChange={(e) => setSort(e.target.value as any)} className="w-auto" aria-label="เรียงลำดับ">
            <option value="newest">ใหม่สุด</option>
            <option value="oldest">เก่าสุด</option>
            <option value="views">เข้าชมมากสุด</option>
            <option value="title">ชื่อ ก-ฮ</option>
          </Select>
        </div>
      </Card>

      {selected.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-slate-300 bg-slate-50 px-3 py-2 text-sm">
          <span className="text-slate-700">เลือก {selected.length} รายการ</span>
          <Button size="sm" disabled={busy} onClick={() => doBulk('publish')}>เผยแพร่</Button>
          <Button size="sm" disabled={busy} onClick={() => doBulk('draft')}>ตั้งเป็นฉบับร่าง</Button>
          <Button size="sm" variant="danger" disabled={busy} onClick={() => setBulkDelete(true)}>ลบ</Button>
          <button onClick={() => setSelected([])} className="ml-auto text-xs text-slate-500 underline cursor-pointer">ยกเลิกการเลือก</button>
        </div>
      )}

      <Card className="overflow-hidden">
        <div className="hidden grid-cols-[2rem_minmax(0,1fr)_7rem_6rem_6.5rem_4.5rem_15rem] items-center gap-3 border-b border-slate-200 bg-slate-50 px-4 py-2.5 text-xs font-medium text-slate-500 xl:grid">
          <input type="checkbox" aria-label="เลือกทั้งหมดในหน้านี้" className="accent-brand-600" checked={allOnPage} onChange={(e) => setSelected(e.target.checked ? Array.from(new Set([...selected, ...rows.map((r) => r.id)])) : selected.filter((id) => !rows.some((r) => r.id === id)))} />
          <span>เรื่อง</span>
          <span>หมวดหมู่</span>
          <span>สถานะ</span>
          <span>วันที่</span>
          <span className="text-right">เข้าชม</span>
          <span className="text-right">จัดการ</span>
        </div>
        {rows.length === 0 && <div className="px-4 py-12 text-center text-sm text-slate-500">ไม่พบเนื้อหาตามเงื่อนไขที่เลือก</div>}
        <ul className="divide-y divide-slate-100">
          {rows.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center gap-x-4 gap-y-1.5 px-4 py-3 xl:grid xl:grid-cols-[2rem_minmax(0,1fr)_7rem_6rem_6.5rem_4.5rem_15rem] xl:gap-3">
              <input type="checkbox" aria-label={`เลือก ${p.title}`} className="accent-brand-600" checked={selected.includes(p.id)} onChange={(e) => setSelected(e.target.checked ? [...selected, p.id] : selected.filter((x) => x !== p.id))} />
              <div className="min-w-0 flex-1 basis-[12rem]">
                <button onClick={() => openEdit(p)} className="block max-w-full truncate text-left text-sm font-medium text-slate-900 hover:underline cursor-pointer">
                  {p.title}
                </button>
                <div className="mt-0.5 truncate font-mono text-xs text-slate-400">/articles/{p.slug}</div>
              </div>
              <span className="text-sm text-slate-600">{catName(p.category)}</span>
              <StatusText tone={p.status === 'published' ? 'ok' : 'neutral'}>{p.status === 'published' ? 'เผยแพร่' : 'ฉบับร่าง'}</StatusText>
              <span className="text-sm text-slate-500">{formatThaiDate(p.createdAt)}</span>
              <span className="text-sm text-slate-500 xl:text-right">{formatViews(p.views)}</span>
              <div className="flex w-full flex-wrap justify-end gap-1 xl:w-auto">
                <Button size="sm" variant="ghost" onClick={() => onPreviewPost(p.id)} aria-label="ดูหน้าบทความ"><ExternalLink className="h-3.5 w-3.5" /></Button>
                <Button size="sm" variant="ghost" onClick={() => openEdit(p)}>แก้ไข</Button>
                <Button size="sm" variant="ghost" onClick={() => onEditWithCeo(p.id)}>CEO</Button>
                <Button size="sm" variant="ghost" onClick={() => duplicate(p)}>สำเนา</Button>
                <Button size="sm" variant="ghost" className="text-rose-700 hover:bg-rose-50" onClick={() => setDeleteTarget(p)}>ลบ</Button>
              </div>
            </li>
          ))}
        </ul>
      </Card>

      {pages > 1 && (
        <div className="flex items-center justify-between text-sm text-slate-600">
          <span>หน้า {current} จาก {pages} ({filtered.length} รายการ)</span>
          <div className="flex gap-2">
            <Button size="sm" disabled={current <= 1} onClick={() => setPage(current - 1)}>ก่อนหน้า</Button>
            <Button size="sm" disabled={current >= pages} onClick={() => setPage(current + 1)}>ถัดไป</Button>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="ลบบทความ"
        danger
        busy={busy}
        error={dialogError}
        confirmLabel="ลบถาวร"
        message={deleteTarget && <>ลบ <strong>{deleteTarget.title}</strong> ถาวร พร้อมความคิดเห็นทั้งหมดของบทความนี้ ไม่สามารถกู้คืนได้</>}
        onConfirm={doDelete}
        onCancel={() => {
          setDeleteTarget(null);
          setDialogError('');
        }}
      />
      <ConfirmDialog
        open={bulkDelete}
        title={`ลบ ${selected.length} บทความ`}
        danger
        busy={busy}
        error={dialogError}
        confirmLabel="ลบถาวรทั้งหมด"
        message={`ลบบทความที่เลือก ${selected.length} รายการ พร้อมความคิดเห็นทั้งหมด ไม่สามารถกู้คืนได้`}
        onConfirm={() => doBulk('delete')}
        onCancel={() => {
          setBulkDelete(false);
          setDialogError('');
        }}
      />
      <p className="text-xs text-slate-400">
        ต้องการให้ AI ช่วยเขียนหรือสร้างสื่อ? ใช้ปุ่ม "สั่ง CEO เขียน" หรือ "CEO" ที่แต่ละรายการ{' '}
        <button onClick={onOpenSettings} className="underline cursor-pointer">ตั้งค่าคีย์ AI</button>
      </p>
    </div>
  );
};
