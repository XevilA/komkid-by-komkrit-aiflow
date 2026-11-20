import React from 'react';

/** Shared, dependency-free Markdown renderer. Emits React elements only — never raw HTML. */

export function isVideoMediaUrl(url?: string, altText?: string): boolean {
  if (!url) return false;
  const clean = url.trim();
  if (!clean) return false;
  if (clean.startsWith('data:video/')) return true;
  if (/\.(mp4|webm|mov)(\?|$|#)/i.test(clean)) return true;
  if (clean.includes('/uploads/videos/') || clean.includes('/videos/')) return true;
  if (altText && /^(video:|วิดีโอ:|คลิป:)/i.test(altText.trim())) return true;
  return false;
}

export function getYoutubeEmbedUrl(url?: string): string | null {
  if (!url) return null;
  const match = url.match(
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([A-Za-z0-9_-]{6,})/
  );
  return match ? `https://www.youtube.com/embed/${match[1]}` : null;
}

/** Only http(s), same-site paths and uploaded media may be used as media/link targets. */
export function safeUrl(url: string): string {
  const u = url.trim();
  if (/^(https?:)?\/\//i.test(u) || u.startsWith('/') || u.startsWith('data:image/') || u.startsWith('data:video/')) {
    return u;
  }
  return '';
}

function formatInline(text: string): React.ReactNode[] {
  // **bold**, *italic*, [label](url)
  const parts = text.split(/(\*\*[^*]+\*\*|\*[^*]+\*|\[[^\]]+\]\([^)]+\))/g);
  return parts.map((part, idx) => {
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
      return (
        <strong key={idx} className="font-semibold text-slate-900">
          {part.slice(2, -2)}
        </strong>
      );
    }
    if (part.startsWith('*') && part.endsWith('*') && part.length > 2) {
      return <em key={idx}>{part.slice(1, -1)}</em>;
    }
    const link = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
    if (link) {
      const href = safeUrl(link[2]);
      return href ? (
        <a
          key={idx}
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="underline underline-offset-2 text-slate-900 hover:text-slate-600"
        >
          {link[1]}
        </a>
      ) : (
        <span key={idx}>{link[1]}</span>
      );
    }
    return <span key={idx}>{part}</span>;
  });
}

export function renderRichMarkdown(md: string): React.ReactNode[] {
  const lines = String(md || '').split('\n');
  const elements: React.ReactNode[] = [];
  let key = 0;

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;

    const mediaMatch = line.match(/^!\[([^\]]*)\]\((.+)\)$/);
    if (mediaMatch) {
      const rawAlt = mediaMatch[1].trim();
      const mediaUrl = safeUrl(mediaMatch[2]);
      if (!mediaUrl) continue;
      const caption = rawAlt.replace(/^(video:|วิดีโอ:|คลิป:)\s*/i, '').trim();
      if (isVideoMediaUrl(mediaUrl, rawAlt)) {
        elements.push(
          <figure key={key++} className="my-8">
            <video
              src={mediaUrl}
              controls
              playsInline
              preload="metadata"
              className="w-full aspect-video rounded-md bg-black"
            />
            {caption && (
              <figcaption className="mt-2 text-center text-sm text-slate-500">{caption}</figcaption>
            )}
          </figure>
        );
      } else {
        elements.push(
          <figure key={key++} className="my-8">
            <img
              src={mediaUrl}
              alt={caption || 'ภาพประกอบ'}
              loading="lazy"
              className="w-full rounded-md border border-slate-200"
            />
            {caption && (
              <figcaption className="mt-2 text-center text-sm text-slate-500">{caption}</figcaption>
            )}
          </figure>
        );
      }
      continue;
    }

    if (line === '---' || line === '***') {
      elements.push(<hr key={key++} className="my-8 border-slate-200" />);
    } else if (line.startsWith('### ')) {
      elements.push(
        <h3 key={key++} className="mt-7 mb-2 text-lg font-semibold text-slate-900">
          {line.slice(4)}
        </h3>
      );
    } else if (line.startsWith('## ')) {
      elements.push(
        <h2 key={key++} className="mt-10 mb-3 text-xl sm:text-2xl font-semibold text-slate-900">
          {line.slice(3)}
        </h2>
      );
    } else if (line.startsWith('# ')) {
      elements.push(
        <h2 key={key++} className="mt-10 mb-3 text-xl sm:text-2xl font-semibold text-slate-900">
          {line.slice(2)}
        </h2>
      );
    } else if (line.startsWith('> ')) {
      elements.push(
        <blockquote
          key={key++}
          className="my-6 border-l-2 border-slate-300 pl-4 text-slate-700 italic"
        >
          {formatInline(line.slice(2))}
        </blockquote>
      );
    } else if (/^[-*•]\s/.test(line)) {
      elements.push(
        <div key={key++} className="flex items-start gap-3 my-1.5 pl-1 text-[17px] leading-[1.85] text-slate-800">
          <span className="mt-[0.85em] h-1 w-1 rounded-full bg-slate-500 shrink-0" />
          <div>{formatInline(line.slice(2))}</div>
        </div>
      );
    } else if (/^\d+\.\s/.test(line)) {
      const m = line.match(/^(\d+)\.\s(.*)$/);
      elements.push(
        <div key={key++} className="flex items-start gap-3 my-1.5 pl-1 text-[17px] leading-[1.85] text-slate-800">
          <span className="min-w-[1.4rem] text-slate-500 tabular-nums">{m ? m[1] : ''}.</span>
          <div>{formatInline(m ? m[2] : line)}</div>
        </div>
      );
    } else {
      elements.push(
        <p key={key++} className="my-4 text-[17px] leading-[1.85] text-slate-800">
          {formatInline(line)}
        </p>
      );
    }
  }
  return elements;
}
