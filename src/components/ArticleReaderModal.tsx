import React, { useEffect, useState } from 'react';
import {
  X,
  Calendar,
  Eye,
  MessageSquare,
  Volume2,
  Square,
  Share2,
  Edit3,
  Star,
  Send,
  Tag,
  Check,
  PlayCircle,
} from 'lucide-react';
import { Post, PostComment, CATEGORIES } from '../types';
import { api, formatThaiDate, formatViews } from '../api';

interface Props {
  postId: number | null;
  onClose: () => void;
  canEdit?: boolean;
  onEditInAdmin?: (post: Post) => void;
  onCommentsUpdated: () => void;
}

function getYoutubeEmbedUrl(url?: string): string | null {
  if (!url) return null;
  const match = url.match(
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([A-Za-z0-9_-]{6,})/
  );
  return match ? `https://www.youtube.com/embed/${match[1]}` : null;
}

export function renderRichMarkdown(md: string) {
  const lines = md.split('\n');
  const elements: React.ReactNode[] = [];
  let key = 0;

  const formatInline = (text: string) => {
    const parts = text.split(/(\*\*[^*]+\*\*|\*[^*]+\*)/g);
    return parts.map((part, idx) => {
      if (part.startsWith('**') && part.endsWith('**')) {
        return (
          <strong key={idx} className="font-semibold text-[#0f294a]">
            {part.slice(2, -2)}
          </strong>
        );
      }
      if (part.startsWith('*') && part.endsWith('*')) {
        return (
          <em key={idx} className="italic text-[#1e40af]">
            {part.slice(1, -1)}
          </em>
        );
      }
      return <span key={idx}>{part}</span>;
    });
  };

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) {
      elements.push(<div key={key++} className="h-2.5" />);
      continue;
    }
    if (line.startsWith('## ')) {
      elements.push(
        <h2
          key={key++}
          className="mt-6 mb-3 text-xl sm:text-2xl font-bold text-[#0f294a] border-l-4 border-[#f59e0b] pl-3"
        >
          {line.slice(3)}
        </h2>
      );
    } else if (line.startsWith('### ')) {
      elements.push(
        <h3
          key={key++}
          className="mt-5 mb-2 text-lg sm:text-xl font-bold text-[#143661]"
        >
          {line.slice(4)}
        </h3>
      );
    } else if (line.startsWith('> ')) {
      elements.push(
        <blockquote
          key={key++}
          className="my-5 rounded-xl bg-gradient-to-r from-[#fef3c7]/70 to-[#f8fafc] border-l-4 border-[#f59e0b] p-4 text-[#0f294a] font-medium italic shadow-xs"
        >
          {formatInline(line.slice(2))}
        </blockquote>
      );
    } else if (line.startsWith('- ') || line.startsWith('• ')) {
      elements.push(
        <div key={key++} className="flex items-start gap-2.5 pl-2 my-1.5 font-body text-[16px] leading-relaxed text-slate-700">
          <span className="mt-2 h-2 w-2 rounded-full bg-[#f59e0b] shrink-0" />
          <div>{formatInline(line.slice(2))}</div>
        </div>
      );
    } else if (/^\d+\.\s/.test(line)) {
      const numMatch = line.match(/^(\d+)\.\s(.*)$/);
      elements.push(
        <div key={key++} className="flex items-start gap-2.5 pl-1 my-2 font-body text-[16px] leading-relaxed text-slate-700">
          <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#0f294a] text-xs font-bold text-[#fbbf24]">
            {numMatch ? numMatch[1] : '•'}
          </span>
          <div>{formatInline(numMatch ? numMatch[2] : line)}</div>
        </div>
      );
    } else {
      elements.push(
        <p key={key++} className="my-2 font-body text-[16.5px] leading-relaxed text-slate-700">
          {formatInline(line)}
        </p>
      );
    }
  }
  return elements;
}

export const ArticleReaderModal: React.FC<Props> = ({
  postId,
  onClose,
  canEdit = false,
  onEditInAdmin,
  onCommentsUpdated,
}) => {
  const [post, setPost] = useState<Post | null>(null);
  const [comments, setComments] = useState<PostComment[]>([]);
  const [loading, setLoading] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [copied, setCopied] = useState(false);

  // Comment form
  const [authorName, setAuthorName] = useState('');
  const [authorRole, setAuthorRole] = useState('ครู / บุคลากรทางการศึกษา');
  const [message, setMessage] = useState('');
  const [rating, setRating] = useState(5);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!postId) return;
    setLoading(true);
    api
      .getPostDetail(postId, true)
      .then((res) => {
        setPost(res.post);
        setComments(res.comments);
        onCommentsUpdated();
      })
      .finally(() => setLoading(false));

    return () => {
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        window.speechSynthesis.cancel();
      }
      setSpeaking(false);
    };
  }, [postId]);

  if (!postId) return null;

  const catMeta =
    CATEGORIES.find((c) => c.id === post?.category) || CATEGORIES[0];
  const ytEmbed = getYoutubeEmbedUrl(post?.videoUrl);
  const isDirectVideoFile = Boolean(
    post?.videoUrl &&
      !ytEmbed &&
      (/\.(mp4|webm|mov)(\?|$)/i.test(post.videoUrl) ||
        post.videoUrl.startsWith('/uploads/'))
  );

  const toggleSpeak = () => {
    if (!post || !('speechSynthesis' in window)) return;
    if (speaking) {
      window.speechSynthesis.cancel();
      setSpeaking(false);
      return;
    }
    const cleanText = `${post.title}. ${post.subtitle || ''}. ${post.content.replace(/[#>*_`]/g, '')}`;
    const utter = new SpeechSynthesisUtterance(cleanText);
    utter.lang = 'th-TH';
    utter.rate = 1.02;
    utter.onend = () => setSpeaking(false);
    utter.onerror = () => setSpeaking(false);
    setSpeaking(true);
    window.speechSynthesis.speak(utter);
  };

  const handleCopyShare = () => {
    const shareUrl = `${window.location.origin}/?post=${post?.id}`;
    navigator.clipboard?.writeText(shareUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleSubmitComment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!post || !message.trim()) return;
    setSubmitting(true);
    try {
      const created = await api.addComment(post.id, {
        authorName: authorName.trim() || 'ผู้ติดตามคมคิด',
        authorRole,
        message: message.trim(),
        rating,
      });
      setComments((prev) => [created, ...prev]);
      setMessage('');
      setPost((p) => (p ? { ...p, commentsCount: p.commentsCount + 1 } : p));
      onCommentsUpdated();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 backdrop-blur-xs p-2 sm:p-5 overflow-y-auto"
      onClick={onClose}
    >
      <div
        className="relative my-auto w-full max-w-4xl max-h-[92vh] overflow-y-auto rounded-2xl bg-white shadow-2xl border border-slate-200"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Sticky Top Bar */}
        <div className="sticky top-0 z-20 flex items-center justify-between gap-2 bg-white/95 backdrop-blur-md px-4 sm:px-6 py-3.5 border-b border-slate-100">
          <div className="flex items-center gap-2 flex-wrap">
            <span
              className="inline-flex items-center rounded-full px-3 py-1 text-xs font-bold text-white"
              style={{ backgroundColor: catMeta.color }}
            >
              {catMeta.nameTh}
            </span>
            {post?.aiWorkflowId && (
              <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2.5 py-1 text-[11px] font-semibold text-amber-900">
                ✨ สร้างร่วมกับทีม AI Multi-Agent
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {post && (
              <button
                onClick={toggleSpeak}
                className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition cursor-pointer ${
                  speaking
                    ? 'bg-rose-600 text-white'
                    : 'bg-slate-100 text-[#0f294a] hover:bg-amber-100'
                }`}
                title="ฟังเสียงอ่านบทความภาษาไทย"
              >
                {speaking ? <Square className="w-3.5 h-3.5" /> : <Volume2 className="w-3.5 h-3.5" />}
                <span className="hidden sm:inline">
                  {speaking ? 'หยุดฟังเสียง' : 'ฟังเสียงบทความ'}
                </span>
              </button>
            )}
            {post && canEdit && onEditInAdmin && (
              <button
                onClick={() => {
                  onClose();
                  onEditInAdmin(post);
                }}
                className="inline-flex items-center gap-1.5 rounded-full bg-[#0f294a]/10 px-3 py-1.5 text-xs font-semibold text-[#0f294a] hover:bg-[#0f294a] hover:text-white transition cursor-pointer"
              >
                <Edit3 className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">แก้ไขบทความ</span>
              </button>
            )}
            <button
              onClick={handleCopyShare}
              className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-200 transition cursor-pointer"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Share2 className="w-3.5 h-3.5" />}
              <span className="hidden sm:inline">{copied ? 'คัดลอกลิงก์แล้ว' : 'แชร์'}</span>
            </button>
            <button
              onClick={onClose}
              className="rounded-full p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-900 transition cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {loading || !post ? (
          <div className="p-16 text-center text-slate-500">กำลังโหลดเนื้อหา...</div>
        ) : (
          <div>
            {/* Cover / Video Banner */}
            {ytEmbed ? (
              <div className="aspect-video w-full bg-slate-950">
                <iframe
                  src={ytEmbed}
                  title={post.title}
                  className="h-full w-full"
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                  allowFullScreen
                />
              </div>
            ) : isDirectVideoFile ? (
              <div className="w-full bg-slate-950">
                <video
                  controls
                  playsInline
                  src={post.videoUrl}
                  poster={post.coverImage}
                  className="w-full max-h-[520px] aspect-video mx-auto bg-black"
                />
              </div>
            ) : (
              <div className="relative h-56 sm:h-80 w-full overflow-hidden bg-[#0f294a]">
                <img
                  src={post.coverImage}
                  alt={post.title}
                  className="h-full w-full object-cover"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-[#0b1f3a]/80 via-transparent to-transparent" />
              </div>
            )}

            <div className="p-5 sm:p-8">
              {/* Real AI Voiceover Audio Player Bar (when post.audioUrl exists) */}
              {post.audioUrl && (
                <div className="mb-5 rounded-xl bg-amber-50 border border-amber-200 p-3.5 space-y-1.5">
                  <div className="text-xs font-extrabold text-amber-950 flex items-center gap-1.5">
                    <Volume2 className="w-4 h-4 text-[#d97706]" />
                    เสียงบรรยายพากย์ไทยจาก AI TTS (Real Audio File)
                  </div>
                  <audio controls src={post.audioUrl} className="w-full h-9" />
                </div>
              )}
              {/* Title & Meta */}
              <h1 className="text-2xl sm:text-3xl font-extrabold text-[#0f294a] leading-snug">
                {post.title}
              </h1>
              {post.subtitle && (
                <p className="mt-2 text-base sm:text-lg font-medium text-[#d97706]">
                  {post.subtitle}
                </p>
              )}

              <div className="mt-4 flex flex-wrap items-center gap-4 border-b border-slate-100 pb-4 text-xs sm:text-sm text-slate-500">
                <div className="flex items-center gap-2">
                  <img
                    src="/images/avatar-komkrit.png"
                    alt="Komkrit"
                    className="h-7 w-7 rounded-full"
                  />
                  <span className="font-semibold text-[#0f294a]">{post.author}</span>
                </div>
                <span className="inline-flex items-center gap-1">
                  <Calendar className="w-3.5 h-3.5" />
                  {formatThaiDate(post.createdAt)}
                </span>
                <span className="inline-flex items-center gap-1">
                  <Eye className="w-3.5 h-3.5" />
                  {formatViews(post.views)} ครั้ง
                </span>
                <span className="inline-flex items-center gap-1">
                  <MessageSquare className="w-3.5 h-3.5" />
                  {comments.length} ความคิดเห็น
                </span>
                {post.videoUrl && !ytEmbed && (
                  <a
                    href={post.videoUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-rose-600 font-semibold hover:underline"
                  >
                    <PlayCircle className="w-4 h-4" /> ดูวิดีโอต้นฉบับ
                  </a>
                )}
              </div>

              {/* Body */}
              <article className="mt-6">{renderRichMarkdown(post.content)}</article>

              {/* Tags */}
              {post.tags && post.tags.length > 0 && (
                <div className="mt-8 flex flex-wrap items-center gap-2 pt-4 border-t border-slate-100">
                  <Tag className="w-4 h-4 text-slate-400" />
                  {post.tags.map((t, idx) => (
                    <span
                      key={idx}
                      className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700"
                    >
                      #{t}
                    </span>
                  ))}
                </div>
              )}

              {/* Audience Feedback & Comments Section (เสียงสะท้อนจากผู้ชม - Image 1) */}
              <div className="mt-10 rounded-2xl bg-[#f8fafd] border border-slate-200/80 p-5 sm:p-6">
                <div className="flex items-center justify-between flex-wrap gap-2 mb-4">
                  <div>
                    <h3 className="text-lg font-bold text-[#0f294a] flex items-center gap-2">
                      <MessageSquare className="w-5 h-5 text-[#f59e0b]" />
                      เสียงสะท้อนจากผู้ชม (Audience Feedback)
                    </h3>
                    <p className="text-xs text-slate-500">
                      ความคิดเห็นของคุณจะถูกส่งไปยังระบบ Analytics & Improvement Agent เพื่อพัฒนาคอนเทนต์ต่อไป
                    </p>
                  </div>
                  <span className="rounded-full bg-[#0f294a] px-3 py-1 text-xs font-semibold text-white">
                    {comments.length} ข้อเสนอแนะ
                  </span>
                </div>

                <form onSubmit={handleSubmitComment} className="space-y-3 mb-6">
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <input
                      type="text"
                      value={authorName}
                      onChange={(e) => setAuthorName(e.target.value)}
                      placeholder="ชื่อของคุณ (เช่น อ.วิภา / ผู้ปกครอง)"
                      className="rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-sm focus:border-[#f59e0b] focus:outline-none"
                    />
                    <select
                      value={authorRole}
                      onChange={(e) => setAuthorRole(e.target.value)}
                      className="rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-sm focus:border-[#f59e0b] focus:outline-none"
                    >
                      <option value="ครู / บุคลากรทางการศึกษา">ครู / บุคลากรทางการศึกษา</option>
                      <option value="นักเรียน">นักเรียน / นักศึกษา</option>
                      <option value="ผู้ปกครอง">ผู้ปกครอง</option>
                      <option value="ผู้สนใจทั่วไป">ผู้สนใจทั่วไป</option>
                    </select>
                    <div className="flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-sm">
                      <span className="text-xs text-slate-500 mr-1">ความพึงพอใจ:</span>
                      {[1, 2, 3, 4, 5].map((n) => (
                        <button
                          key={n}
                          type="button"
                          onClick={() => setRating(n)}
                          className="cursor-pointer"
                        >
                          <Star
                            className={`w-4 h-4 ${
                              n <= rating
                                ? 'fill-[#f59e0b] text-[#f59e0b]'
                                : 'text-slate-300'
                            }`}
                          />
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      required
                      value={message}
                      onChange={(e) => setMessage(e.target.value)}
                      placeholder="ร่วมแลกเปลี่ยนมุมมอง ข้อเสนอแนะ หรือสิ่งที่อยากให้ คมคิด นำเสนอ..."
                      className="flex-1 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm focus:border-[#f59e0b] focus:outline-none"
                    />
                    <button
                      type="submit"
                      disabled={submitting}
                      className="inline-flex items-center gap-1.5 rounded-xl bg-[#0f294a] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#193d6b] transition cursor-pointer disabled:opacity-50"
                    >
                      <Send className="w-4 h-4" />
                      ส่งความเห็น
                    </button>
                  </div>
                </form>

                <div className="space-y-3">
                  {comments.map((c) => (
                    <div
                      key={c.id}
                      className="rounded-xl bg-white p-3.5 border border-slate-100 shadow-2xs"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-sm text-[#0f294a]">
                            {c.authorName}
                          </span>
                          <span className="rounded-full bg-blue-50 px-2.5 py-0.5 text-[11px] font-medium text-blue-800">
                            {c.authorRole}
                          </span>
                        </div>
                        <div className="flex items-center gap-1 text-xs text-slate-400">
                          <span className="text-amber-500 font-bold">★ {c.rating}</span>
                          <span>• {formatThaiDate(c.createdAt)}</span>
                        </div>
                      </div>
                      <p className="mt-1.5 text-sm text-slate-700 font-body">
                        {c.message}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
