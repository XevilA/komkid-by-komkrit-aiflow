// ============================================================================
// ARTICLE SHELL — server-rendered <head> + crawlable body for /articles/:slug
// The React app still renders the page; this gives search engines and link
// previews (LINE, Facebook, X) the title, description, image and article text.
// ============================================================================

export interface ShellPost {
  title: string;
  subtitle?: string;
  excerpt: string;
  content: string;
  coverImage: string;
  slug: string;
  author: string;
  category: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

export function escapeHtml(s: string): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function absoluteUrl(base: string, u: string): string {
  if (!u) return '';
  if (/^https?:\/\//i.test(u)) return u;
  return `${base}${u.startsWith('/') ? '' : '/'}${u}`;
}

/** Markdown -> plain readable text for crawlers (no HTML is ever emitted from user content). */
export function markdownToPlain(md: string): string {
  return String(md || '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^#{1,6}\s*/gm, '')
    .replace(/[*_`>~]/g, '')
    .replace(/\r/g, '')
    .trim();
}

function jsonLdSafe(obj: unknown): string {
  return JSON.stringify(obj).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026');
}

export function buildArticleShell(template: string, post: ShellPost, base: string, siteName: string): string {
  const url = `${base}/articles/${encodeURIComponent(post.slug)}`;
  const title = `${post.title} | ${siteName}`;
  const description = (post.excerpt || markdownToPlain(post.content).slice(0, 160)).replace(/\s+/g, ' ').slice(0, 200);
  const image = absoluteUrl(base, post.coverImage);

  const head = [
    `<title>${escapeHtml(title)}</title>`,
    `<meta name="description" content="${escapeHtml(description)}" />`,
    `<link rel="canonical" href="${escapeHtml(url)}" />`,
    `<meta property="og:type" content="article" />`,
    `<meta property="og:site_name" content="${escapeHtml(siteName)}" />`,
    `<meta property="og:title" content="${escapeHtml(post.title)}" />`,
    `<meta property="og:description" content="${escapeHtml(description)}" />`,
    `<meta property="og:url" content="${escapeHtml(url)}" />`,
    image ? `<meta property="og:image" content="${escapeHtml(image)}" />` : '',
    `<meta name="twitter:card" content="${image ? 'summary_large_image' : 'summary'}" />`,
    `<meta name="twitter:title" content="${escapeHtml(post.title)}" />`,
    `<meta name="twitter:description" content="${escapeHtml(description)}" />`,
    image ? `<meta name="twitter:image" content="${escapeHtml(image)}" />` : '',
    `<meta property="article:published_time" content="${escapeHtml(post.createdAt)}" />`,
    `<meta property="article:modified_time" content="${escapeHtml(post.updatedAt)}" />`,
    `<script type="application/ld+json">${jsonLdSafe({
      '@context': 'https://schema.org',
      '@type': 'Article',
      headline: post.title,
      description,
      image: image ? [image] : undefined,
      datePublished: post.createdAt,
      dateModified: post.updatedAt,
      author: { '@type': 'Person', name: post.author },
      mainEntityOfPage: url,
      keywords: post.tags.join(', '),
    })}</script>`,
  ]
    .filter(Boolean)
    .join('\n    ');

  const paragraphs = markdownToPlain(post.content)
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .slice(0, 60)
    .map((p) => `<p>${escapeHtml(p).replace(/\n/g, '<br />')}</p>`)
    .join('');
  const body = `<main data-seo-fallback><article><h1>${escapeHtml(post.title)}</h1>${
    post.subtitle ? `<p>${escapeHtml(post.subtitle)}</p>` : ''
  }${paragraphs}</article></main>`;

  let html = template.replace(/<title>[\s\S]*?<\/title>/i, '');
  html = html.replace(/<meta\s+name=["']description["'][^>]*>/i, '');
  html = html.replace(/<\/head>/i, `    ${head}\n  </head>`);
  html = html.replace(/<div id="root">\s*<\/div>/i, `<div id="root">${body}</div>`);
  return html;
}

export function buildNotFoundShell(template: string, siteName: string): string {
  let html = template.replace(/<title>[\s\S]*?<\/title>/i, `<title>ไม่พบบทความ | ${escapeHtml(siteName)}</title>`);
  html = html.replace(/<\/head>/i, `    <meta name="robots" content="noindex" />\n  </head>`);
  return html;
}
