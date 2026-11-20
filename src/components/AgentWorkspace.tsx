import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ExternalLink, Loader2, Plus, SendHorizontal, Trash2, Upload } from 'lucide-react';
import { api } from '../api';
import {
  CATEGORIES,
  CategoryId,
  WsCapabilities,
  WsEvent,
  WsListItem,
  WsSnapshot,
  Workspace,
} from '../types';
import { renderRichMarkdown } from './RichContent';
import { Button, Card, ConfirmDialog, Field, Input, Modal, Notice, Select, StatusText, Tabs, Textarea } from './ui';

interface Props {
  /** Open a workspace for an existing post / campaign (from other screens). */
  request: { kind: 'post' | 'workflow'; id: number } | null;
  onRequestHandled: () => void;
  onRefreshAll: () => Promise<void>;
  onOpenSettings: () => void;
  onPreviewPost: (postId: number) => void;
}

const AGENT_LABEL: Record<string, string> = {
  ceo: 'CEO',
  research: 'ค้นคว้า',
  writer: 'นักเขียน',
  visual: 'ภาพ',
  video: 'วิดีโอ',
  audio: 'เสียง',
  qa: 'ตรวจคุณภาพ',
  publisher: 'เผยแพร่',
};

const TOOL_LABEL: Record<string, string> = {
  research: 'ค้นคว้าข้อมูล',
  write_draft: 'เขียนฉบับร่าง',
  revise_draft: 'แก้ไขฉบับร่าง',
  generate_cover: 'สร้างรูปปก',
  generate_inline_image: 'สร้างภาพประกอบ',
  generate_video: 'สร้างวิดีโอ',
  generate_voice: 'สร้างเสียงบรรยาย',
  attach_media: 'แนบสื่อจากคลัง',
  qa_check: 'ตรวจคุณภาพ',
  optimize_seo: 'เตรียมข้อมูลค้นหา',
  save_post: 'บันทึกบทความ',
  publish_channels: 'โพสต์ลงช่องทาง',
  find_posts: 'ค้นหาบทความ',
  load_post: 'โหลดบทความ',
  import_campaign: 'นำเข้าแคมเปญ',
  delete_post: 'เตรียมลบบทความ',
};

const STARTERS = [
  'ช่วยเขียนบทความเรื่อง AI ช่วยครูลดงานเอกสาร',
  'ร่างข่าวประชาสัมพันธ์เกี่ยวกับโครงการภาษาและอาชีพไทย-เมียนมา',
  'สรุปแนวโน้มการศึกษายุคใหม่สำหรับผู้ปกครองเป็นบทความสั้น',
];

const STATUS_TEXT: Record<Workspace['status'], { text: string; tone: 'neutral' | 'ok' | 'warn' }> = {
  drafting: { text: 'ฉบับร่าง', tone: 'neutral' },
  ready: { text: 'พร้อมเผยแพร่', tone: 'warn' },
  published: { text: 'เผยแพร่แล้ว', tone: 'ok' },
  archived: { text: 'เก็บถาวร', tone: 'neutral' },
};

type PanelTab = 'content' | 'media' | 'review' | 'publish';

function mergeEvents(prev: WsEvent[], next: WsEvent[]): WsEvent[] {
  if (next.length === 0) return prev;
  const seen = new Set(prev.map((e) => e.id));
  return [...prev, ...next.filter((e) => !seen.has(e.id))];
}

export const AgentWorkspace: React.FC<Props> = ({
  request,
  onRequestHandled,
  onRefreshAll,
  onOpenSettings,
  onPreviewPost,
}) => {
  const [list, setList] = useState<WsListItem[]>([]);
  const [caps, setCaps] = useState<WsCapabilities | null>(null);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [project, setProject] = useState<Workspace | null>(null);
  const [events, setEvents] = useState<WsEvent[]>([]);
  const [running, setRunning] = useState(false);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [mobileView, setMobileView] = useState<'chat' | 'content'>('chat');
  const [tab, setTab] = useState<PanelTab>('content');
  const [previewMode, setPreviewMode] = useState(false);
  const [publishOpen, setPublishOpen] = useState(false);
  const [publishChannels, setPublishChannels] = useState<string[]>([]);
  const [forcePublish, setForcePublish] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [saveState, setSaveState] = useState<'saved' | 'dirty' | 'saving' | 'error'>('saved');
  const [uploading, setUploading] = useState<'cover' | 'video' | 'audio' | null>(null);

  // local editable copy of the draft (so typing is never overwritten by polling)
  const [form, setForm] = useState({
    title: '',
    subtitle: '',
    excerpt: '',
    content: '',
    slug: '',
    category: 'education' as CategoryId,
    contentType: 'article' as 'news' | 'article' | 'video' | 'course',
    tags: '',
  });
  const dirtyRef = useRef(false);
  const lastEventId = useRef(0);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const uploadKind = useRef<'cover' | 'video' | 'audio'>('cover');

  const loadList = useCallback(async () => {
    try {
      const res = await api.listWorkspaces();
      setList(res.workspaces);
      setCaps(res.capabilities);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  const applySnapshot = useCallback((snap: WsSnapshot, replaceEvents = false) => {
    setProject(snap.project);
    setRunning(snap.running);
    setEvents((prev) => (replaceEvents ? snap.events : mergeEvents(prev, snap.events)));
    const max = snap.events.reduce((m, e) => Math.max(m, e.id), replaceEvents ? 0 : lastEventId.current);
    lastEventId.current = max;
    if (!dirtyRef.current) {
      const d = snap.project.draft;
      setForm({
        title: d.title,
        subtitle: d.subtitle,
        excerpt: d.excerpt,
        content: d.content,
        slug: d.slug,
        category: d.category,
        contentType: d.contentType,
        tags: d.tags.join(', '),
      });
    }
  }, []);

  const openWorkspace = useCallback(
    async (id: number) => {
      setError('');
      dirtyRef.current = false;
      lastEventId.current = 0;
      setActiveId(id);
      try {
        const snap = await api.getWorkspace(id, 0);
        applySnapshot(snap, true);
        setSaveState('saved');
      } catch (e) {
        setError((e as Error).message);
      }
    },
    [applySnapshot]
  );

  useEffect(() => {
    loadList();
  }, [loadList]);

  // open from other screens (edit a post with the CEO, continue a campaign)
  useEffect(() => {
    if (!request) return;
    (async () => {
      try {
        const snap = await api.createWorkspace(
          request.kind === 'post' ? { fromPostId: request.id } : { fromWorkflowId: request.id }
        );
        await loadList();
        await openWorkspace(snap.project.id);
      } catch (e) {
        setError((e as Error).message);
      } finally {
        onRequestHandled();
      }
    })();
  }, [request]);

  // while the team works, follow its progress
  useEffect(() => {
    if (!running || activeId === null) return;
    const t = setInterval(async () => {
      try {
        const snap = await api.getWorkspace(activeId, lastEventId.current);
        applySnapshot(snap);
        if (!snap.running) {
          loadList();
          onRefreshAll();
        }
      } catch {
        /* transient network error: keep polling */
      }
    }, 1200);
    return () => clearInterval(t);
  }, [running, activeId, applySnapshot, loadList, onRefreshAll]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [events.length, running]);

  // auto-save manual edits
  useEffect(() => {
    if (!dirtyRef.current || activeId === null || running) return;
    setSaveState('dirty');
    const t = setTimeout(async () => {
      setSaveState('saving');
      try {
        const snap = await api.updateWorkspace(activeId, {
          draft: {
            title: form.title,
            subtitle: form.subtitle,
            excerpt: form.excerpt,
            content: form.content,
            slug: form.slug,
            category: form.category,
            contentType: form.contentType,
            tags: form.tags.split(',').map((x) => x.trim()).filter(Boolean),
          },
        });
        dirtyRef.current = false;
        setProject(snap.project);
        setSaveState('saved');
        setError('');
      } catch (e) {
        setSaveState('error');
        setError((e as Error).message);
      }
    }, 900);
    return () => clearTimeout(t);
  }, [form, activeId, running]);

  const edit = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) => {
    dirtyRef.current = true;
    setForm((f) => ({ ...f, [key]: value }));
  };

  const ensureWorkspace = async (brief: string): Promise<number> => {
    if (activeId !== null) return activeId;
    const snap = await api.createWorkspace({ brief });
    await loadList();
    setActiveId(snap.project.id);
    applySnapshot(snap, true);
    return snap.project.id;
  };

  const send = async (text: string) => {
    const message = text.trim();
    if (!message || sending || running) return;
    setSending(true);
    setError('');
    try {
      if (dirtyRef.current && activeId !== null) {
        // make sure the team works on exactly what the human sees
        await api.updateWorkspace(activeId, {
          draft: { ...form, tags: form.tags.split(',').map((x) => x.trim()).filter(Boolean) },
        });
        dirtyRef.current = false;
      }
      const id = await ensureWorkspace(message);
      setInput('');
      const snap = await api.sendWorkspaceMessage(id, message);
      applySnapshot(snap);
      setMobileView('chat');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSending(false);
    }
  };

  const startNew = async () => {
    setActiveId(null);
    setProject(null);
    setEvents([]);
    setRunning(false);
    dirtyRef.current = false;
    lastEventId.current = 0;
    setInput('');
    setError('');
  };

  const runPublish = async (status: 'draft' | 'published') => {
    if (activeId === null) return;
    setError('');
    try {
      if (dirtyRef.current) {
        await api.updateWorkspace(activeId, {
          draft: { ...form, tags: form.tags.split(',').map((x) => x.trim()).filter(Boolean) },
        });
        dirtyRef.current = false;
      }
      const snap = await api.publishWorkspace(activeId, {
        status,
        channels: status === 'published' ? publishChannels : [],
        force: forcePublish,
      });
      applySnapshot(snap);
      setPublishOpen(false);
      setForcePublish(false);
      setMobileView('chat');
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const confirm = async (eventId: number) => {
    if (activeId === null) return;
    try {
      const out = await api.confirmWorkspaceAction(activeId, eventId);
      applySnapshot(out);
      onRefreshAll();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const removeWorkspace = async () => {
    if (activeId === null) return;
    try {
      await api.deleteWorkspace(activeId);
      setDeleteOpen(false);
      await startNew();
      loadList();
    } catch (e) {
      setError((e as Error).message);
      setDeleteOpen(false);
    }
  };

  const setMedia = async (kind: 'cover' | 'video' | 'audio', url: string | null) => {
    if (activeId === null) return;
    try {
      const snap = await api.updateWorkspace(activeId, { media: { [kind]: url } });
      setProject(snap.project);
      setError('');
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const onFile = async (file: File | undefined) => {
    if (!file || activeId === null) return;
    const kind = uploadKind.current;
    setUploading(kind);
    try {
      const url = kind === 'video' ? await api.uploadVideo(file) : await api.uploadFile(file);
      await setMedia(kind, url);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setUploading(null);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const pickFile = (kind: 'cover' | 'video' | 'audio') => {
    uploadKind.current = kind;
    if (fileRef.current) {
      fileRef.current.accept = kind === 'cover' ? 'image/*' : kind === 'video' ? 'video/*' : 'audio/*';
      fileRef.current.click();
    }
  };

  const lastAction = useMemo(() => {
    if (!running) return '';
    const a = [...events].reverse().find((e) => e.kind === 'action' && e.data?.tool);
    return a ? TOOL_LABEL[a.data.tool] || a.data.tool : 'กำลังวางแผน';
  }, [events, running]);

  const visibleEvents = events.filter((e) => e.kind !== 'action' || e.agent === 'ceo');
  const pendingConfirm = events.find((e) => e.kind === 'confirm' && !e.data?.done);
  const qa = project?.qa;
  const published = project?.status === 'published';
  const publicUrl = project?.postId && project.draft.slug ? `/articles/${encodeURIComponent(project.draft.slug)}` : '';
  const hasDraft = Boolean(form.title.trim() && form.content.trim());

  // ---------------------------------------------------------------- render
  return (
    <div className="flex h-[calc(100vh-8.5rem)] min-h-[34rem] flex-col gap-3">
      <input ref={fileRef} type="file" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} />

      {caps && !caps.llm && (
        <Notice tone="error">
          ยังไม่ได้ตั้งค่า API Key ของ AI ค่ายใดเลย ทีมจึงยังทำงานไม่ได้{' '}
          <button onClick={onOpenSettings} className="underline cursor-pointer">
            ตั้งค่าคีย์
          </button>
        </Notice>
      )}
      {error && <Notice tone="error">{error}</Notice>}

      <div className="flex gap-1 lg:hidden">
        {(['chat', 'content'] as const).map((v) => (
          <Button key={v} size="sm" variant={mobileView === v ? 'primary' : 'secondary'} onClick={() => setMobileView(v)}>
            {v === 'chat' ? 'สั่งงาน CEO' : 'เนื้อหา'}
          </Button>
        ))}
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 lg:grid-cols-[minmax(22rem,0.9fr)_minmax(0,1.3fr)]">
        {/* ------------------------------------------------ conversation */}
        <Card className={`${mobileView === 'chat' ? 'flex' : 'hidden'} min-h-0 flex-col lg:flex`}>
          <div className="flex items-center gap-2 border-b border-slate-200 px-4 py-3">
            <Select
              aria-label="เลือกงาน"
              value={activeId ?? ''}
              onChange={(e) => (e.target.value ? openWorkspace(Number(e.target.value)) : startNew())}
              className="flex-1"
            >
              <option value="">งานใหม่</option>
              {list.map((w) => (
                <option key={w.id} value={w.id}>
                  {(w.title || w.brief || `งาน #${w.id}`).slice(0, 48)} ({STATUS_TEXT[w.status].text})
                </option>
              ))}
            </Select>
            <Button size="sm" onClick={startNew} title="เริ่มงานใหม่">
              <Plus className="h-3.5 w-3.5" /> ใหม่
            </Button>
            {activeId !== null && (
              <Button size="sm" variant="ghost" onClick={() => setDeleteOpen(true)} aria-label="ลบงานนี้" title="ลบงานนี้">
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>

          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4">
            {events.length === 0 && (
              <div className="py-6">
                <h2 className="text-lg font-semibold text-slate-900">สั่งงานทีม AI</h2>
                <p className="mt-1 text-sm leading-relaxed text-slate-600">
                  CEO จะวางแผน ค้นคว้า เขียน ทำภาพ ตรวจคุณภาพ และเผยแพร่ให้ โดยทุกอย่างอยู่ในงานเดียวกัน
                  ภาพและวิดีโอที่ทำไว้จะถูกแนบไปกับบทความตอนเผยแพร่โดยอัตโนมัติ
                </p>
                {caps && (
                  <p className="mt-3 text-xs text-slate-500">
                    พร้อมใช้งาน: เขียนบทความ
                    {caps.webSearch ? ', ค้นเว็บ' : ''}
                    {caps.image ? ', สร้างภาพ' : ''}
                    {caps.audio ? ', สร้างเสียง' : ''}
                    {caps.video ? ', สร้างวิดีโอ' : ''}
                    {caps.channels.length ? `, โพสต์ ${caps.channels.length} ช่องทาง` : ''}
                    {!caps.video && ' (ยังไม่พร้อม: วิดีโอ)'}
                  </p>
                )}
                <div className="mt-4 space-y-2">
                  {STARTERS.map((s) => (
                    <button
                      key={s}
                      onClick={() => setInput(s)}
                      className="block w-full rounded-md border border-slate-200 px-3 py-2 text-left text-sm text-slate-700 hover:border-slate-400 cursor-pointer"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {visibleEvents.map((e) => {
              if (e.role === 'user') {
                return (
                  <div key={e.id} className="flex justify-end">
                    <div className="max-w-[88%] whitespace-pre-wrap rounded-lg bg-slate-900 px-3.5 py-2.5 text-sm text-white">
                      {e.content}
                    </div>
                  </div>
                );
              }
              if (e.kind === 'confirm') {
                return (
                  <div key={e.id} className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-slate-800">
                    <div className="font-medium">ต้องการยืนยันจากคุณ</div>
                    <div className="mt-1">{e.content}</div>
                    {!e.data?.done && (
                      <div className="mt-2 flex gap-2">
                        <Button size="sm" variant="danger" onClick={() => confirm(e.id)}>
                          ยืนยัน
                        </Button>
                      </div>
                    )}
                    {e.data?.done && <div className="mt-1 text-xs text-slate-500">ดำเนินการแล้ว</div>}
                  </div>
                );
              }
              if (e.role === 'ceo' && e.kind === 'message') {
                return (
                  <div key={e.id} className="text-sm leading-relaxed text-slate-800">
                    <div className="mb-0.5 text-xs font-medium text-slate-500">CEO</div>
                    <div className="whitespace-pre-wrap">{e.content}</div>
                  </div>
                );
              }
              if (e.role === 'ceo' && e.kind === 'action') {
                return (
                  <div key={e.id} className="text-xs italic text-slate-500">
                    {e.content}
                  </div>
                );
              }
              return (
                <div
                  key={e.id}
                  className={`border-l-2 pl-3 text-xs leading-relaxed ${
                    e.kind === 'error' ? 'border-rose-400 text-rose-800' : 'border-slate-300 text-slate-600'
                  }`}
                >
                  <span className="font-medium">{AGENT_LABEL[e.agent] || e.agent || 'ระบบ'}</span>
                  {e.kind === 'error' ? ' ไม่สำเร็จ: ' : ': '}
                  {e.content}
                </div>
              );
            })}

            {running && (
              <div className="flex items-center gap-2 text-sm text-slate-600">
                <Loader2 className="h-4 w-4 animate-spin" />
                <span>ทีมกำลังทำงาน: {lastAction}</span>
              </div>
            )}
            <div ref={chatEndRef} />
          </div>

          <form
            className="border-t border-slate-200 p-3"
            onSubmit={(e) => {
              e.preventDefault();
              send(input);
            }}
          >
            <div className="flex items-end gap-2">
              <Textarea
                value={input}
                rows={2}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                    e.preventDefault();
                    send(input);
                  }
                }}
                placeholder={
                  project?.draft.content
                    ? 'สั่งต่อ เช่น "ปรับให้กระชับขึ้น" "ทำรูปปก" "เผยแพร่เลย"'
                    : 'พิมพ์โจทย์ เช่น "ช่วยเขียนบทความเรื่อง..."'
                }
                disabled={running}
                className="resize-none"
              />
              <Button type="submit" variant="primary" disabled={!input.trim() || sending || running} aria-label="ส่ง">
                <SendHorizontal className="h-4 w-4" />
              </Button>
            </div>
            <p className="mt-1.5 text-xs text-slate-400">Enter เพื่อส่ง, Shift+Enter ขึ้นบรรทัดใหม่</p>
          </form>
        </Card>

        {/* ------------------------------------------------ content panel */}
        <Card className={`${mobileView === 'content' ? 'flex' : 'hidden'} min-h-0 flex-col lg:flex`}>
          {!project ? (
            <div className="flex flex-1 items-center justify-center p-8 text-center text-sm text-slate-500">
              เนื้อหาที่ทีมเขียนจะแสดงและแก้ไขได้ที่นี่
            </div>
          ) : (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-4 py-3">
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold text-slate-900">
                    {form.title || project.brief.slice(0, 60) || `งาน #${project.id}`}
                  </div>
                  <div className="mt-0.5 flex items-center gap-3">
                    <StatusText tone={STATUS_TEXT[project.status].tone}>{STATUS_TEXT[project.status].text}</StatusText>
                    <span className="text-xs text-slate-400">
                      {saveState === 'saving' ? 'กำลังบันทึก' : saveState === 'dirty' ? 'มีการแก้ไข' : saveState === 'error' ? 'บันทึกไม่สำเร็จ' : 'บันทึกแล้ว'}
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {publicUrl && (
                    <Button size="sm" variant="ghost" onClick={() => project.postId && onPreviewPost(project.postId)}>
                      <ExternalLink className="h-3.5 w-3.5" /> ดูหน้าบทความ
                    </Button>
                  )}
                  <Button size="sm" disabled={!hasDraft || running} onClick={() => runPublish('draft')}>
                    บันทึกฉบับร่าง
                  </Button>
                  <Button
                    size="sm"
                    variant="primary"
                    disabled={!hasDraft || running}
                    onClick={() => {
                      setPublishChannels([]);
                      setForcePublish(false);
                      setPublishOpen(true);
                    }}
                  >
                    {published ? 'เผยแพร่การแก้ไข' : 'เผยแพร่'}
                  </Button>
                </div>
              </div>

              <div className="px-4 pt-3">
                <Tabs
                  value={tab}
                  onChange={(t) => setTab(t as PanelTab)}
                  tabs={[
                    { id: 'content', label: 'เนื้อหา' },
                    { id: 'media', label: 'สื่อ' },
                    { id: 'review', label: 'ตรวจสอบ' },
                    { id: 'publish', label: 'เผยแพร่' },
                  ]}
                />
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
                {tab === 'content' && (
                  <div className="space-y-4">
                    {!hasDraft && !form.title && (
                      <p className="text-sm text-slate-500">ยังไม่มีเนื้อหา สั่งให้ CEO เขียน หรือพิมพ์เองที่นี่ได้เลย</p>
                    )}
                    <Field label="ชื่อเรื่อง">
                      <Input value={form.title} maxLength={200} onChange={(e) => edit('title', e.target.value)} disabled={running} />
                    </Field>
                    <Field label="คำโปรย">
                      <Input value={form.subtitle} maxLength={300} onChange={(e) => edit('subtitle', e.target.value)} disabled={running} />
                    </Field>
                    <Field label="สรุปสั้น (ใช้แสดงในรายการและตอนแชร์)">
                      <Textarea rows={2} value={form.excerpt} maxLength={300} onChange={(e) => edit('excerpt', e.target.value)} disabled={running} />
                    </Field>
                    <div>
                      <div className="mb-1 flex items-center justify-between">
                        <span className="text-xs font-medium text-slate-700">เนื้อหา (Markdown)</span>
                        <div className="flex gap-1">
                          <Button size="sm" variant={previewMode ? 'secondary' : 'primary'} onClick={() => setPreviewMode(false)}>
                            แก้ไข
                          </Button>
                          <Button size="sm" variant={previewMode ? 'primary' : 'secondary'} onClick={() => setPreviewMode(true)}>
                            ตัวอย่าง
                          </Button>
                        </div>
                      </div>
                      {previewMode ? (
                        <div className="max-h-[32rem] overflow-y-auto rounded-md border border-slate-200 p-5">
                          {project.media.cover && <img src={project.media.cover.url} alt="" className="mb-5 w-full rounded-md border border-slate-200" />}
                          <h1 className="text-2xl font-semibold text-slate-900">{form.title}</h1>
                          {form.subtitle && <p className="mt-1 text-slate-600">{form.subtitle}</p>}
                          <div className="mt-4">{renderRichMarkdown(form.content)}</div>
                        </div>
                      ) : (
                        <Textarea
                          rows={18}
                          value={form.content}
                          maxLength={60000}
                          onChange={(e) => edit('content', e.target.value)}
                          disabled={running}
                          className="font-mono text-[13px] leading-relaxed"
                        />
                      )}
                      <div className="mt-1 text-xs text-slate-400">{form.content.replace(/\s+/g, '').length.toLocaleString()} ตัวอักษร</div>
                    </div>
                  </div>
                )}

                {tab === 'media' && (
                  <div className="space-y-5">
                    <p className="text-sm text-slate-600">
                      สื่อที่แนบตรงนี้คือสิ่งที่จะถูกเผยแพร่พร้อมบทความ ทั้งที่ทีม AI สร้างและที่คุณอัปโหลดเอง
                    </p>
                    {(['cover', 'video', 'audio'] as const).map((kind) => {
                      const item = project.media[kind];
                      const label = kind === 'cover' ? 'รูปปก' : kind === 'video' ? 'วิดีโอ' : 'เสียงบรรยาย';
                      const askAi =
                        kind === 'cover'
                          ? { text: 'สร้างรูปปกด้วย AI', msg: 'สร้างรูปปกให้บทความนี้', ok: caps?.image }
                          : kind === 'video'
                          ? { text: 'สร้างวิดีโอด้วย AI', msg: 'สร้างวิดีโอสั้นประกอบบทความนี้', ok: caps?.video }
                          : { text: 'สร้างเสียงบรรยายด้วย AI', msg: 'สร้างเสียงบรรยายของบทความนี้', ok: caps?.audio };
                      return (
                        <div key={kind} className="rounded-md border border-slate-200 p-3">
                          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                            <span className="text-sm font-medium text-slate-900">{label}</span>
                            <div className="flex flex-wrap gap-1.5">
                              <Button size="sm" onClick={() => pickFile(kind)} disabled={running || uploading !== null}>
                                <Upload className="h-3.5 w-3.5" /> {uploading === kind ? 'กำลังอัปโหลด' : 'อัปโหลด'}
                              </Button>
                              <Button
                                size="sm"
                                disabled={!askAi.ok || running || !hasDraft}
                                title={askAi.ok ? '' : 'ยังใช้ไม่ได้ในระบบนี้ (ขาดคีย์หรือโฮสต์ไม่รองรับ)'}
                                onClick={() => send(askAi.msg)}
                              >
                                {askAi.text}
                              </Button>
                              {item && (
                                <Button size="sm" variant="ghost" onClick={() => setMedia(kind, null)} disabled={running}>
                                  นำออก
                                </Button>
                              )}
                            </div>
                          </div>
                          {item ? (
                            kind === 'cover' ? (
                              <img src={item.url} alt="" className="max-h-56 rounded-md border border-slate-200" />
                            ) : kind === 'video' ? (
                              <video src={item.url} controls className="max-h-64 rounded-md bg-black" />
                            ) : (
                              <audio src={item.url} controls className="w-full" />
                            )
                          ) : (
                            <p className="text-xs text-slate-500">ยังไม่มี{label}</p>
                          )}
                        </div>
                      );
                    })}
                    {project.media.inline.length > 0 && (
                      <div className="rounded-md border border-slate-200 p-3">
                        <div className="mb-2 text-sm font-medium text-slate-900">ภาพประกอบในเนื้อหา ({project.media.inline.length})</div>
                        <div className="grid grid-cols-3 gap-2">
                          {project.media.inline.map((m) => (
                            <img key={m.url} src={m.url} alt={m.caption || ''} className="aspect-video w-full rounded border border-slate-200 object-cover" />
                          ))}
                        </div>
                      </div>
                    )}
                    <Button size="sm" disabled={!caps?.image || running || !hasDraft} onClick={() => send('สร้างภาพประกอบแทรกในเนื้อหา 1 ภาพ')}>
                      ให้ CEO แทรกภาพประกอบในเนื้อหา
                    </Button>
                  </div>
                )}

                {tab === 'review' && (
                  <div className="space-y-5">
                    <div>
                      <div className="mb-2 flex items-center justify-between">
                        <h3 className="text-sm font-semibold text-slate-900">ผลตรวจคุณภาพ</h3>
                        <Button size="sm" disabled={!hasDraft || running} onClick={() => send('ตรวจคุณภาพบทความนี้ให้หน่อย')}>
                          ให้ CEO ตรวจใหม่
                        </Button>
                      </div>
                      {qa?.verdict ? (
                        <div className="space-y-3">
                          <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm text-slate-700">
                            <span>
                              ผล:{' '}
                              <strong>{qa.verdict === 'pass' ? 'ผ่าน' : qa.verdict === 'revise' ? 'ควรแก้ไข' : 'ไม่ควรเผยแพร่'}</strong>
                            </span>
                            {qa.scores && (
                              <>
                                <span>รวม {qa.scores.overall}/100</span>
                                <span>ข้อเท็จจริง {qa.scores.facts}</span>
                                <span>ภาษา {qa.scores.language}</span>
                                <span>แบรนด์ {qa.scores.brand}</span>
                                <span>ความเสี่ยง {qa.scores.risk}</span>
                              </>
                            )}
                          </div>
                          {qa.summary && <p className="text-sm text-slate-600">{qa.summary}</p>}
                          {qa.issues && qa.issues.length > 0 && (
                            <ul className="space-y-1.5">
                              {qa.issues.map((i, idx) => (
                                <li key={idx} className="text-sm text-slate-700">
                                  <span className="mr-2 text-xs font-medium text-slate-500">
                                    {i.severity === 'high' ? 'สำคัญ' : i.severity === 'medium' ? 'ปานกลาง' : 'เล็กน้อย'}
                                  </span>
                                  {i.text}
                                </li>
                              ))}
                            </ul>
                          )}
                          {qa.issues && qa.issues.length > 0 && (
                            <Button size="sm" disabled={running} onClick={() => send('แก้ไขประเด็นที่ QA พบทั้งหมด')}>
                              ให้ CEO แก้ตามผลตรวจ
                            </Button>
                          )}
                        </div>
                      ) : (
                        <p className="text-sm text-slate-500">
                          ยังไม่ได้ตรวจ (หรือเนื้อหาถูกแก้ไขหลังตรวจครั้งล่าสุด) ระบบจะตรวจให้อัตโนมัติตอนเผยแพร่
                        </p>
                      )}
                    </div>

                    <div>
                      <div className="mb-2 flex items-center justify-between">
                        <h3 className="text-sm font-semibold text-slate-900">ผลค้นคว้า</h3>
                        <Button size="sm" disabled={running || !(project.brief || form.title)} onClick={() => send(`ค้นคว้าข้อมูลเพิ่มเติมเกี่ยวกับ ${form.title || project.brief}`)}>
                          ให้ CEO ค้นคว้าเพิ่ม
                        </Button>
                      </div>
                      {project.research.summary ? (
                        <div className="space-y-2 text-sm text-slate-700">
                          <p>{project.research.summary}</p>
                          {project.research.facts && project.research.facts.length > 0 && (
                            <ul className="list-disc space-y-1 pl-5">
                              {project.research.facts.map((f, i) => (
                                <li key={i}>{f}</li>
                              ))}
                            </ul>
                          )}
                          {project.research.sources && project.research.sources.length > 0 && (
                            <div className="text-xs text-slate-500">
                              แหล่งอ้างอิง:{' '}
                              {project.research.sources.map((s) => (
                                <a key={s.uri} href={s.uri} target="_blank" rel="noopener noreferrer" className="mr-3 underline">
                                  {s.title || s.uri}
                                </a>
                              ))}
                            </div>
                          )}
                          {project.research.knowledgeUsed && project.research.knowledgeUsed.length > 0 && (
                            <div className="text-xs text-slate-500">ฐานความรู้ที่ใช้: {project.research.knowledgeUsed.join(', ')}</div>
                          )}
                        </div>
                      ) : (
                        <p className="text-sm text-slate-500">ยังไม่มีผลค้นคว้า</p>
                      )}
                    </div>
                  </div>
                )}

                {tab === 'publish' && (
                  <div className="space-y-4">
                    <Field label="ที่อยู่บทความ (slug)" hint={`ตัวอย่าง: /articles/${form.slug || 'ชื่อ-บทความ'}  ใช้ตัวอักษร ตัวเลข และ - เท่านั้น เว้นว่างให้ระบบตั้งให้`}>
                      <Input value={form.slug} maxLength={100} onChange={(e) => edit('slug', e.target.value.toLowerCase())} disabled={running} />
                    </Field>
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                      <Field label="หมวดหมู่">
                        <Select value={form.category} onChange={(e) => edit('category', e.target.value as CategoryId)} disabled={running}>
                          {CATEGORIES.map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.nameTh}
                            </option>
                          ))}
                        </Select>
                      </Field>
                      <Field label="ประเภทเนื้อหา">
                        <Select value={form.contentType} onChange={(e) => edit('contentType', e.target.value as any)} disabled={running}>
                          <option value="article">บทความ</option>
                          <option value="news">ข่าว</option>
                          <option value="video">วิดีโอ</option>
                          <option value="course">หลักสูตร</option>
                        </Select>
                      </Field>
                    </div>
                    <Field label="แท็ก (คั่นด้วยเครื่องหมายจุลภาค)">
                      <Input value={form.tags} onChange={(e) => edit('tags', e.target.value)} disabled={running} />
                    </Field>
                    {publicUrl && (
                      <p className="text-sm text-slate-700">
                        เผยแพร่ที่{' '}
                        <a href={publicUrl} target="_blank" rel="noopener noreferrer" className="underline">
                          {publicUrl}
                        </a>
                      </p>
                    )}
                    {project.channels.results && Object.keys(project.channels.results).length > 0 && (
                      <div>
                        <h3 className="mb-1 text-sm font-semibold text-slate-900">ผลโพสต์ลงช่องทาง</h3>
                        <ul className="space-y-1 text-sm text-slate-700">
                          {Object.entries(project.channels.results).map(([k, r]) => (
                            <li key={k}>
                              {k}: {r.status === 'published' ? 'สำเร็จ' : 'ไม่สำเร็จ'} — {r.note}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </>
          )}
        </Card>
      </div>

      <Modal
        open={publishOpen}
        title={published ? 'เผยแพร่การแก้ไข' : 'เผยแพร่บทความ'}
        onClose={() => setPublishOpen(false)}
        footer={
          <>
            <Button onClick={() => setPublishOpen(false)}>ยกเลิก</Button>
            <Button variant="primary" onClick={() => runPublish('published')}>
              ให้ CEO เผยแพร่
            </Button>
          </>
        }
      >
        <div className="space-y-4 text-sm text-slate-700">
          <p>CEO จะดำเนินการตามลำดับนี้ให้ครบในครั้งเดียว</p>
          <ol className="list-decimal space-y-1 pl-5">
            <li>ตรวจสื่อ: ถ้ายังไม่มีรูปปกจะสร้างให้ (เมื่อระบบรองรับ)</li>
            <li>ตรวจคุณภาพ 4 ด้าน และแก้ไขอัตโนมัติถ้าพบประเด็น</li>
            <li>เตรียม slug คำโปรย และแท็กถ้ายังไม่ครบ</li>
            <li>
              บันทึกขึ้นเว็บไซต์ พร้อมแนบ{[project?.media.cover && 'รูปปก', project?.media.video && 'วิดีโอ', project?.media.audio && 'เสียงบรรยาย'].filter(Boolean).join(' ') || 'สื่อทั้งหมดที่ทำไว้'}
            </li>
          </ol>
          {caps && caps.channels.length > 0 && (
            <div>
              <div className="mb-1 font-medium text-slate-900">โพสต์ลงช่องทางอื่นด้วย (ไม่บังคับ)</div>
              {caps.channels.map((c) => (
                <label key={c.key} className="flex items-center gap-2 py-0.5">
                  <input
                    type="checkbox"
                    className="accent-slate-900"
                    checked={publishChannels.includes(c.key)}
                    onChange={(e) =>
                      setPublishChannels((prev) => (e.target.checked ? [...prev, c.key] : prev.filter((x) => x !== c.key)))
                    }
                  />
                  {c.name}
                </label>
              ))}
            </div>
          )}
          {qa?.verdict === 'block' && (
            <label className="flex items-start gap-2 rounded-md border border-rose-200 bg-rose-50 p-3 text-rose-800">
              <input type="checkbox" className="mt-0.5 accent-slate-900" checked={forcePublish} onChange={(e) => setForcePublish(e.target.checked)} />
              <span>QA ประเมินว่ามีความเสี่ยงสูง ฉันตรวจสอบแล้วและยืนยันให้เผยแพร่ต่อ</span>
            </label>
          )}
        </div>
      </Modal>

      <ConfirmDialog
        open={deleteOpen}
        title="ลบงานนี้"
        message="ลบงานนี้ออกจากรายการพร้อมประวัติการสั่งงาน บทความที่เผยแพร่ไปแล้วจะไม่ถูกลบ"
        confirmLabel="ลบงาน"
        danger
        onConfirm={removeWorkspace}
        onCancel={() => setDeleteOpen(false)}
      />
    </div>
  );
};
