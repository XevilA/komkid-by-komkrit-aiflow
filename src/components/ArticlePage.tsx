import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Check, Link2, Pencil, Volume2, VolumeX } from 'lucide-react';
import { CATEGORIES, Post, PostComment } from '../types';
import { api, formatThaiDate, formatViews } from '../api';
import { getYoutubeEmbedUrl, isVideoMediaUrl, renderRichMarkdown } from './RichContent';

interface Props {
  slug: string;
  allPosts: Post[];
  isAdmin: boolean;
  brandTitle: string;
  brandSub: string;
  onNavigate: (path: string, opts?: { replace?: boolean }) => void;
  onEditInAdmin: (post: Post) => void;
  onCommentsUpdated: () => void;
}

const ROLES = ['ครู / บุคลากรทางการศึกษา', 'นักเรียน / นักศึกษา', 'ผู้ปกครอง', 'ผู้สนใจทั่วไป'];

function setMeta(name: string, content: string, attr: 'name' | 'property' = 'name') {
  let el = document.head.querySelector<HTMLMetaElement>(`meta[${attr}="${name}"]`);
  if (!el) {
    el = document.createElement('meta');
    el.setAttribute(attr, name);
    document.head.appendChild(el);
  }
  el.setAttribute('content', content);
}

export const ArticlePage: React.FC<Props> = ({
  slug,
  allPosts,
  isAdmin,
  brandTitle,
  brandSub,
  onNavigate,
  onEditInAdmin,
  onCommentsUpdated,
}) => {
  const [post, setPost] = useState<Post | null>(null);
  const [comments, setComments] = useState<PostComment[]>([]);
  const [state, setState] = useState<'loading' | 'ready' | 'missing' | 'error'>('loading');
  const [speaking, setSpeaking] = useState(false);
  const [copied, setCopied] = useState(false);

  const [authorName, setAuthorName] = useState('');
  const [authorRole, setAuthorRole] = useState(ROLES[0]);
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [commentError, setCommentError] = useState('');

  useEffect(() => {
    let cancelled = false;
    setState('loading');
    setPost(null);
    window.scrollTo({ top: 0 });
    api
      .getPostBySlug(slug, true)
      .then((res) => {
        if (cancelled) return;
        const { comments: cs, canonical, ...rest } = res;
        setPost(rest as Post);
        setComments(cs);
        setState('ready');
        // an old address or a numeric id: show the canonical URL without adding a history entry
        if (!canonical && rest.slug) onNavigate(`/articles/${encodeURIComponent(rest.slug)}`, { replace: true });
      })
      .catch((e: Error) => {
        if (cancelled) return;
        setState(/ไม่พบ|404/.test(e.message) ? 'missing' : 'error');
      });
    return () => {
      cancelled = true;
      if ('speechSynthesis' in window) window.speechSynthesis.cancel();
      setSpeaking(false);
    };
  }, [slug]);

  // Title + share metadata for in-app navigation (the server renders the same for first loads)
  useEffect(() => {
    if (!post) return;
    const site = `${brandTitle} ${brandSub}`.trim();
    document.title = `${post.title} | ${site}`;
    setMeta('description', post.excerpt || '');
    setMeta('og:title', post.title, 'property');
    setMeta('og:description', post.excerpt || '', 'property');
    setMeta('og:image', new URL(post.coverImage, window.location.origin).toString(), 'property');
    return () => {
      document.title = site;
    };
  }, [post, brandTitle, brandSub]);

  const related = useMemo(
    () =>
      post
        ? allPosts
            .filter((p) => p.id !== post.id && p.status === 'published')
            .sort((a, b) => Number(b.category === post.category) - Number(a.category === post.category))
            .slice(0, 3)
        : [],
    [allPosts, post]
  );

  const toggleSpeak = useCallback(() => {
    if (!post || !('speechSynthesis' in window)) return;
    if (speaking) {
      window.speechSynthesis.cancel();
      setSpeaking(false);
      return;
    }
    const plain = post.content.replace(/!\[[^\]]*\]\([^)]+\)/g, '').replace(/[#>*_`]/g, '');
    const u = new SpeechSynthesisUtterance(`${post.title}. ${post.subtitle || ''}. ${plain}`);
    u.lang = 'th-TH';
    u.onend = () => setSpeaking(false);
    u.onerror = () => setSpeaking(false);
    setSpeaking(true);
    window.speechSynthesis.speak(u);
  }, [post, speaking]);

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard unavailable */
    }
  };

  const submitComment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!post || !message.trim()) return;
    setSubmitting(true);
    setCommentError('');
    try {
      const created = await api.addComment(post.id, {
        authorName: authorName.trim() || 'ผู้อ่านทั่วไป',
        authorRole,
        message: message.trim(),
        rating: 5,
      });
      setComments((prev) => [created, ...prev]);
      setMessage('');
      onCommentsUpdated();
    } catch (err) {
      setCommentError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  const cat = CATEGORIES.find((c) => c.id === post?.category) || CATEGORIES[0];
  const yt = getYoutubeEmbedUrl(post?.videoUrl);
  const directVideo = Boolean(
    post?.videoUrl && !yt && (isVideoMediaUrl(post.videoUrl) || post.videoUrl.startsWith('/uploads/'))
  );

  return (
    <div className="min-h-screen bg-white text-slate-900 font-body">
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-4 sm:px-6">
          <a
            href="/"
            onClick={(e) => {
              e.preventDefault();
              onNavigate('/');
            }}
            className="flex items-center gap-2.5"
          >
            <img src="/images/avatar-komkrit.png" alt="" className="h-7 w-7 rounded-full" />
            <span className="text-sm font-semibold tracking-tight">
              {brandTitle} <span className="font-normal text-slate-500">{brandSub}</span>
            </span>
          </a>
          <nav className="flex items-center gap-1 text-sm">
            <a
              href="/"
              onClick={(e) => {
                e.preventDefault();
                onNavigate('/');
              }}
              className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-slate-600 hover:bg-slate-100 hover:text-slate-900"
            >
              <ArrowLeft className="h-4 w-4" /> หน้าแรก
            </a>
          </nav>
        </div>
      </header>

      {state === 'loading' && (
        <div className="mx-auto max-w-3xl px-4 py-24 text-center text-sm text-slate-500">กำลังโหลดบทความ</div>
      )}

      {(state === 'missing' || state === 'error') && (
        <div className="mx-auto max-w-xl px-4 py-24 text-center">
          <h1 className="text-xl font-semibold">
            {state === 'missing' ? 'ไม่พบบทความนี้' : 'โหลดบทความไม่สำเร็จ'}
          </h1>
          <p className="mt-2 text-sm text-slate-600">
            {state === 'missing'
              ? 'ลิงก์อาจไม่ถูกต้อง หรือบทความถูกลบ/ยังไม่เผยแพร่'
              : 'กรุณาตรวจสอบการเชื่อมต่อแล้วลองใหม่อีกครั้ง'}
          </p>
          <button
            onClick={() => onNavigate('/')}
            className="mt-6 rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 cursor-pointer"
          >
            กลับหน้าแรก
          </button>
        </div>
      )}

      {state === 'ready' && post && (
        <>
          {post.status !== 'published' && (
            <div className="border-b border-slate-200 bg-slate-50 px-4 py-2 text-center text-xs text-slate-600">
              บทความนี้ยังไม่เผยแพร่ เห็นได้เฉพาะผู้ดูแลระบบ
            </div>
          )}
          <main className="mx-auto max-w-3xl px-4 sm:px-6 pt-10 pb-16">
            <div className="text-xs font-medium uppercase tracking-wider text-slate-500">{cat.nameTh}</div>
            <h1 className="mt-3 text-3xl sm:text-4xl font-semibold leading-tight tracking-tight">{post.title}</h1>
            {post.subtitle && <p className="mt-3 text-lg text-slate-600 leading-relaxed">{post.subtitle}</p>}

            <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-2 border-y border-slate-200 py-3 text-sm text-slate-500">
              <span className="font-medium text-slate-800">{post.author}</span>
              <span>{formatThaiDate(post.createdAt)}</span>
              <span>อ่านแล้ว {formatViews(post.views)} ครั้ง</span>
              <span className="ml-auto flex items-center gap-1">
                {'speechSynthesis' in window && (
                  <button
                    onClick={toggleSpeak}
                    className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 hover:bg-slate-100 cursor-pointer"
                  >
                    {speaking ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
                    {speaking ? 'หยุดอ่าน' : 'ฟังบทความ'}
                  </button>
                )}
                <button
                  onClick={copyLink}
                  className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 hover:bg-slate-100 cursor-pointer"
                >
                  {copied ? <Check className="h-4 w-4" /> : <Link2 className="h-4 w-4" />}
                  {copied ? 'คัดลอกแล้ว' : 'คัดลอกลิงก์'}
                </button>
                {isAdmin && (
                  <button
                    onClick={() => onEditInAdmin(post)}
                    className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-slate-900 hover:bg-slate-100 cursor-pointer"
                  >
                    <Pencil className="h-4 w-4" /> แก้ไข
                  </button>
                )}
              </span>
            </div>

            <div className="mt-8">
              {yt ? (
                <div className="aspect-video w-full overflow-hidden rounded-md bg-black">
                  <iframe
                    src={yt}
                    title={post.title}
                    className="h-full w-full"
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                    allowFullScreen
                  />
                </div>
              ) : directVideo ? (
                <video
                  controls
                  playsInline
                  src={post.videoUrl}
                  poster={post.coverImage}
                  className="aspect-video w-full rounded-md bg-black"
                />
              ) : (
                <img
                  src={post.coverImage}
                  alt=""
                  className="w-full rounded-md border border-slate-200 object-cover max-h-[28rem]"
                />
              )}
            </div>

            {post.audioUrl && (
              <div className="mt-6 rounded-md border border-slate-200 p-3">
                <div className="mb-1.5 text-xs font-medium text-slate-600">ฟังบทความแบบเสียง</div>
                <audio controls src={post.audioUrl} className="w-full" />
              </div>
            )}

            <article className="mt-8">{renderRichMarkdown(post.content)}</article>

            {post.tags.length > 0 && (
              <div className="mt-10 flex flex-wrap gap-x-4 gap-y-1 border-t border-slate-200 pt-4 text-sm text-slate-500">
                {post.tags.map((t) => (
                  <span key={t}>#{t}</span>
                ))}
              </div>
            )}

            <section className="mt-14 border-t border-slate-200 pt-8" aria-labelledby="comments-h">
              <h2 id="comments-h" className="text-lg font-semibold">
                ความคิดเห็น ({comments.length})
              </h2>
              <form onSubmit={submitComment} className="mt-4 space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <input
                    value={authorName}
                    onChange={(e) => setAuthorName(e.target.value)}
                    maxLength={80}
                    placeholder="ชื่อ (ไม่บังคับ)"
                    className="rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-slate-900 focus:outline-none"
                  />
                  <select
                    value={authorRole}
                    onChange={(e) => setAuthorRole(e.target.value)}
                    className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm focus:border-slate-900 focus:outline-none"
                  >
                    {ROLES.map((r) => (
                      <option key={r}>{r}</option>
                    ))}
                  </select>
                </div>
                <textarea
                  required
                  rows={3}
                  value={message}
                  maxLength={1500}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder="แลกเปลี่ยนความคิดเห็น"
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-slate-900 focus:outline-none"
                />
                {commentError && <p className="text-sm text-rose-700">{commentError}</p>}
                <button
                  type="submit"
                  disabled={submitting || !message.trim()}
                  className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50 cursor-pointer"
                >
                  {submitting ? 'กำลังส่ง' : 'ส่งความคิดเห็น'}
                </button>
              </form>
              <ul className="mt-6 divide-y divide-slate-100">
                {comments.map((c) => (
                  <li key={c.id} className="py-4">
                    <div className="flex flex-wrap items-baseline gap-x-2 text-sm">
                      <span className="font-medium">{c.authorName}</span>
                      <span className="text-slate-500">{c.authorRole}</span>
                      <span className="text-slate-400">{formatThaiDate(c.createdAt)}</span>
                    </div>
                    <p className="mt-1 text-sm leading-relaxed text-slate-700 whitespace-pre-wrap break-words">
                      {c.message}
                    </p>
                  </li>
                ))}
              </ul>
            </section>

            {related.length > 0 && (
              <section className="mt-14 border-t border-slate-200 pt-8">
                <h2 className="text-lg font-semibold">บทความที่เกี่ยวข้อง</h2>
                <ul className="mt-4 divide-y divide-slate-100">
                  {related.map((r) => (
                    <li key={r.id}>
                      <a
                        href={`/articles/${encodeURIComponent(r.slug)}`}
                        onClick={(e) => {
                          e.preventDefault();
                          onNavigate(`/articles/${encodeURIComponent(r.slug)}`);
                        }}
                        className="block py-3 hover:bg-slate-50"
                      >
                        <div className="font-medium">{r.title}</div>
                        <div className="mt-0.5 line-clamp-2 text-sm text-slate-500">{r.excerpt}</div>
                      </a>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </main>
        </>
      )}

      <footer className="border-t border-slate-200 py-8 text-center text-xs text-slate-500">
        {brandTitle} {brandSub}
      </footer>
    </div>
  );
};
