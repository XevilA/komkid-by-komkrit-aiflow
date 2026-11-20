// ============================================================================
// SLUGS — URL-safe, unique, Thai-friendly article addresses
//   /articles/<slug>   (old slugs keep redirecting after a rename)
// Pure helpers + small DB helpers that only need { prepare, exec }.
// ============================================================================

interface Sqlite {
  prepare(sql: string): any;
  exec(sql: string): void;
}

const MAX_SLUG_CHARS = 80;
/** Letters (incl. Thai), digits and combining marks (Thai vowels/tones), joined by single hyphens. */
export const SLUG_RE = /^[\p{L}\p{N}\p{M}]+(?:-[\p{L}\p{N}\p{M}]+)*$/u;
const RESERVED = new Set(['new', 'edit', 'admin', 'api', 'uploads', 'assets', 'images', 'null', 'undefined']);

export function slugify(input: string, maxChars = MAX_SLUG_CHARS): string {
  const cleaned = String(input || '')
    .normalize('NFC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\p{M}]+/gu, '-')
    .replace(/^-+|-+$/g, '');
  // cut by code points so a letter is never separated from its combining marks mid-way
  let out = Array.from(cleaned).slice(0, maxChars).join('');
  // do not end on a dangling hyphen
  out = out.replace(/-+$/g, '');
  return out;
}

/** Returns a Thai error message, or null when the slug is acceptable. */
export function validateSlug(slug: string): string | null {
  const s = String(slug || '');
  if (!s) return 'กรุณาระบุ slug';
  if ([...s].length > 100) return 'slug ยาวเกิน 100 ตัวอักษร';
  if (!SLUG_RE.test(s)) {
    return 'slug ใช้ได้เฉพาะตัวอักษร ตัวเลข และเครื่องหมาย - (ไม่มีช่องว่าง ไม่ขึ้นต้นหรือลงท้ายด้วย -)';
  }
  if (RESERVED.has(s)) return `slug "${s}" เป็นคำที่ระบบสงวนไว้`;
  if (/^\d+$/.test(s)) return 'slug ต้องไม่เป็นตัวเลขล้วน (สงวนไว้สำหรับรหัสบทความ)';
  return null;
}

export function uniqueSlug(base: string, isTaken: (candidate: string) => boolean): string {
  let root = slugify(base) || 'post';
  if (RESERVED.has(root) || /^\d+$/.test(root)) root = `post-${root}`;
  if (!isTaken(root)) return root;
  for (let n = 2; n < 10000; n++) {
    const suffix = `-${n}`;
    const trimmed = Array.from(root).slice(0, MAX_SLUG_CHARS - suffix.length).join('').replace(/-+$/g, '');
    const candidate = `${trimmed}${suffix}`;
    if (!isTaken(candidate)) return candidate;
  }
  return `${root}-${Date.now()}`;
}

// --- DB helpers --------------------------------------------------------------
export function ensureSlugSchema(db: Sqlite) {
  const cols = db.prepare("PRAGMA table_info('posts')").all() as { name: string }[];
  if (!cols.some((c) => c.name === 'slug')) {
    db.exec("ALTER TABLE posts ADD COLUMN slug TEXT DEFAULT ''");
  }
  db.exec(`
    CREATE TABLE IF NOT EXISTS post_slugs (
      slug TEXT PRIMARY KEY,
      post_id INTEGER NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_post_slugs_post ON post_slugs(post_id);
  `);
}

export function isSlugTaken(db: Sqlite, slug: string, exceptPostId?: number): boolean {
  const row = db
    .prepare('SELECT post_id FROM post_slugs WHERE slug = ?')
    .get(slug) as { post_id: number } | undefined;
  if (row && row.post_id !== exceptPostId) return true;
  const cur = db.prepare('SELECT id FROM posts WHERE slug = ?').get(slug) as { id: number } | undefined;
  return Boolean(cur && cur.id !== exceptPostId);
}

/** Points a post at a slug and remembers it, so every old address keeps resolving. */
export function setPostSlug(db: Sqlite, postId: number, slug: string) {
  db.prepare('UPDATE posts SET slug = ? WHERE id = ?').run(slug, postId);
  db.prepare(
    'INSERT OR REPLACE INTO post_slugs (slug, post_id, created_at) VALUES (?, ?, ?)'
  ).run(slug, postId, new Date().toISOString());
}

/** Gives a post a slug derived from its title when it has none. */
export function ensurePostSlug(db: Sqlite, postId: number): string {
  const row = db.prepare('SELECT id, title, slug FROM posts WHERE id = ?').get(postId) as
    | { id: number; title: string; slug: string }
    | undefined;
  if (!row) return '';
  if (row.slug) {
    // keep history table in sync for rows created before it existed
    db.prepare('INSERT OR IGNORE INTO post_slugs (slug, post_id, created_at) VALUES (?, ?, ?)').run(
      row.slug,
      postId,
      new Date().toISOString()
    );
    return row.slug;
  }
  const slug = uniqueSlug(row.title, (c) => isSlugTaken(db, c, postId));
  setPostSlug(db, postId, slug);
  return slug;
}

export function backfillPostSlugs(db: Sqlite): number {
  const rows = db
    .prepare("SELECT id FROM posts WHERE slug IS NULL OR slug = '' ORDER BY id ASC")
    .all() as { id: number }[];
  for (const r of rows) ensurePostSlug(db, r.id);
  // history rows for already-slugged posts
  db.exec(`
    INSERT OR IGNORE INTO post_slugs (slug, post_id, created_at)
    SELECT slug, id, datetime('now') FROM posts WHERE slug IS NOT NULL AND slug != ''
  `);
  return rows.length;
}

export function findPostIdBySlug(db: Sqlite, slug: string): { postId: number; canonical: boolean } | null {
  const cur = db.prepare('SELECT id FROM posts WHERE slug = ?').get(slug) as { id: number } | undefined;
  if (cur) return { postId: cur.id, canonical: true };
  const old = db.prepare('SELECT post_id FROM post_slugs WHERE slug = ?').get(slug) as
    | { post_id: number }
    | undefined;
  return old ? { postId: old.post_id, canonical: false } : null;
}
