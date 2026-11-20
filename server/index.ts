import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import multer from 'multer';
import { db, initDatabase, IS_SERVERLESS, DEFAULT_SITE_CONFIG } from './db.ts';
import {
  createBatch,
  summarizeBatch,
  listBatches,
  processBatch,
  cancelBatch,
  retryFailed,
  startBackground,
  resumeBatchesOnBoot,
  MAX_BATCH_ITEMS,
} from './batchRunner.ts';
import { createWorkflowRecord } from './workflowStore.ts';
import { deletePostCascade, deletePostRows } from './postsRepo.ts';
import { registerWorkspaceRoutes } from './workspaceRoutes.ts';
import { createLimiter } from './limits.ts';
import { registerChannelRoutes } from './channelRoutes.ts';
import { connectionStatus } from './channelConnect.ts';
import { detectSampleData, removeSampleData } from './sampleData.ts';
import { buildArticleShell, buildNotFoundShell } from './articleShell.ts';
import {
  validateSlug,
  uniqueSlug,
  isSlugTaken,
  setPostSlug,
  backfillPostSlugs,
  findPostIdBySlug,
} from './slug.ts';
import { getHealthSnapshot, resetHealth } from './aiRouter.ts';
import {
  configuredProviderSet,
  readProviderOrder,
  STANDARD_ORDER,
  ECONOMY_ORDER,
} from './aiEngine.ts';
import {
  executeMultiAgentWorkflow,
  assistPostContent,
  getProviderConfigs,
  testProviderConnection,
  chatWithRealModel,
  generateFlowStoryboardWithLlm,
  evaluateAndBuildMediaPrompt,
  draftContentFromChat,
  LlmProviderId,
} from './aiEngine.ts';
import {
  generateRealImage,
  generateRealVideo,
  generateRealAudio,
  stitchFlowScenesWithFfmpeg,
  UPLOADS_ROOT,
} from './mediaEngine.ts';
import { dispatchSingleChannelReal } from './publishEngine.ts';
import {
  verifyCredentials,
  isAdminPasswordConfigured,
  createAdminToken,
  verifyAdminToken,
  extractBearerToken,
  isRequestAdmin,
  requireAdminAuth,
  updateAdminCredentials,
  getClientIp,
  checkLoginRateLimit,
  recordLoginFailure,
  clearLoginFailures,
} from './auth.ts';
import {
  isCloudSyncEnabled,
  syncDatabaseBeforeRequest,
  persistDatabaseToCloud,
  uploadMediaToCloudBlob,
  deleteMediaFromCloudBlob,
} from './cloudSync.ts';
import {
  DiscoverableProvider,
  fetchAllConfiguredLiveModels,
  fetchSingleProviderLiveCatalog,
  invalidateModelCatalogCache,
} from './modelRegistry.ts';
import {
  SECRET_SETTING_KEYS,
  NEVER_EXPORT_SETTING_KEYS,
  decryptSecretValue,
  encryptSecretValue,
  isEncryptedSecret,
  maskSecretStrict,
  redactSecrets,
  sealSettingsVaultToken,
  unsealSettingsVaultWithMeta,
} from './secretVault.ts';

initDatabase();

const VAULT_COOKIE_NAME = 'komkrit_vault';
const VAULT_UPDATED_AT_KEY = '_vault_updated_at';

function getLocalVaultUpdatedAt(): number {
  const row = db
    .prepare('SELECT value FROM settings WHERE key = ?')
    .get(VAULT_UPDATED_AT_KEY) as { value: string } | undefined;
  const n = Number(row?.value || '0');
  return Number.isFinite(n) ? n : 0;
}

function hasAnyStoredApiSecret(): boolean {
  const rows = db.prepare('SELECT key, value FROM settings').all() as {
    key: string;
    value: string;
  }[];
  return rows.some(
    (r) => SECRET_SETTING_KEYS.has(r.key) && Boolean(String(r.value || '').trim())
  );
}

function exportEncryptedSettingsMap(): Record<string, string> {
  const rows = db.prepare('SELECT key, value FROM settings').all() as {
    key: string;
    value: string;
  }[];
  const map: Record<string, string> = {};
  for (const r of rows) {
    if (!r.key || NEVER_EXPORT_SETTING_KEYS.has(r.key)) continue;
    const raw = String(r.value ?? '').trim();
    if (SECRET_SETTING_KEYS.has(r.key)) {
      map[r.key] = raw ? encryptSecretValue(raw, r.key) : '';
    } else {
      map[r.key] = raw;
    }
  }
  return map;
}

function parseCookieToken(cookieHeader: string | undefined, name: string): string {
  if (!cookieHeader) return '';
  const parts = cookieHeader.split(';');
  for (const part of parts) {
    const eqIdx = part.indexOf('=');
    if (eqIdx === -1) continue;
    const k = part.slice(0, eqIdx).trim();
    if (k === name) {
      try {
        return decodeURIComponent(part.slice(eqIdx + 1).trim());
      } catch {
        return part.slice(eqIdx + 1).trim();
      }
    }
  }
  return '';
}

function writeSealedVaultCookie(
  req: express.Request,
  res: express.Response,
  sealedToken: string
) {
  // Only needed on stateless serverless runtimes; persistent Docker/VPS uses local encrypted SQLite
  if (!IS_SERVERLESS || !sealedToken) return;
  const isHttps =
    req.secure ||
    req.headers['x-forwarded-proto'] === 'https' ||
    IS_SERVERLESS;
  res.setHeader(
    'Set-Cookie',
    `${VAULT_COOKIE_NAME}=${encodeURIComponent(
      sealedToken
    )}; Path=/api; Max-Age=31536000; HttpOnly; SameSite=Strict${
      isHttps ? '; Secure' : ''
    }`
  );
}

function syncSettingsFromRequestVault(
  req: express.Request,
  _res: express.Response
) {
  if (!IS_SERVERLESS) return;
  const cookieVal = parseCookieToken(req.headers.cookie, VAULT_COOKIE_NAME);
  const parsed = unsealSettingsVaultWithMeta(cookieVal);
  if (!parsed) return;

  const localUpdatedAt = getLocalVaultUpdatedAt();
  const bestHasAnySecret = Object.entries(parsed.rows).some(
    ([k, v]) => SECRET_SETTING_KEYS.has(k) && Boolean(String(v || '').trim())
  );

  // Hydrate or upgrade this serverless container whenever incoming HttpOnly vault cookie is newer
  if (
    parsed.updatedAt > localUpdatedAt ||
    (localUpdatedAt === 0 && !hasAnyStoredApiSecret() && bestHasAnySecret)
  ) {
    const setStmt = db.prepare(
      'INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)'
    );
    for (const [k, v] of Object.entries(parsed.rows)) {
      if (!k || NEVER_EXPORT_SETTING_KEYS.has(k) || typeof v !== 'string') continue;
      const trimmed = v.trim();
      if (SECRET_SETTING_KEYS.has(k)) {
        const safeVal = trimmed
          ? isEncryptedSecret(trimmed)
            ? trimmed
            : encryptSecretValue(trimmed, k)
          : '';
        setStmt.run(k, safeVal);
      } else {
        setStmt.run(k, trimmed);
      }
    }
    const effectiveTs = parsed.updatedAt || Date.now();
    setStmt.run(VAULT_UPDATED_AT_KEY, String(effectiveTs));
    invalidateModelCatalogCache();
  }
}

const app = express();
app.disable('x-powered-by');
// Behind exactly one reverse proxy (Traefik / Vercel). `req.ip` then comes from the proxy, not from
// a header the visitor could forge, which is what the login limiter relies on.
app.set('trust proxy', Number(process.env.TRUST_PROXY_HOPS) || 1);

// Anonymous visitors may only send small JSON bodies; large imports are for signed-in admins.
const smallJson = express.json({ limit: '256kb' });
const largeJson = express.json({ limit: '50mb' });
app.use((req, res, next) => (isRequestAdmin(req) ? largeJson(req, res, next) : smallJson(req, res, next)));

// Global Security Headers & Error Secret-Redaction Shield
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(self), geolocation=()');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('X-Permitted-Cross-Domain-Policies', 'none');
  // Non-breaking CSP baseline: no plugins, no <base> hijack, only same-origin framing/forms.
  res.setHeader('Content-Security-Policy', "object-src 'none'; base-uri 'self'; frame-ancestors 'self'; form-action 'self'");
  if (String(_req.headers['x-forwarded-proto'] || _req.protocol) === 'https') {
    res.setHeader('Strict-Transport-Security', 'max-age=15552000; includeSubDomains');
  }

  const rawJson = res.json.bind(res);
  res.json = ((body: any) => {
    if (res.statusCode >= 400 && body && typeof body === 'object' && typeof body.error === 'string') {
      body = { ...body, error: redactSecrets(body.error) };
    }
    return rawJson(body);
  }) as any;
  next();
});

const UPLOADS_DIR = UPLOADS_ROOT;
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}
app.use(
  '/uploads',
  (_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'; media-src 'self'; img-src 'self'; sandbox");
    next();
  },
  express.static(UPLOADS_DIR)
);

const handleHealthCheck = (_req: express.Request, res: express.Response) => {
  res.json({
    ok: true,
    service: 'komkid-by-komkrit-aiflow',
    runtime: IS_SERVERLESS ? 'vercel-serverless' : 'node-server',
    cloudStorage: isCloudSyncEnabled() ? 'vercel-blob-encrypted-sqlite' : 'local-sqlite-disk',
    node: process.version,
    timestamp: new Date().toISOString(),
  });
};

app.get('/health', handleHealthCheck);
app.get('/api/health', handleHealthCheck);

// --- Cloud SQLite Sync Middleware (Permanent Persistence across Serverless Instances) ---
app.use('/api', async (req, res, next) => {
  if (req.path === '/health') return next();
  try {
    const isMutation =
      req.method === 'POST' ||
      req.method === 'PUT' ||
      req.method === 'DELETE' ||
      (req.method === 'GET' && req.query.incrementView === '1');

    await syncDatabaseBeforeRequest(isMutation);

    if (isMutation && req.path !== '/auth/login') {
      const origJson = res.json.bind(res);
      res.json = ((body: any) => {
        if (res.statusCode < 400) {
          persistDatabaseToCloud()
            .catch((err) => console.error('Cloud DB persist error:', redactSecrets(String(err))))
            .finally(() => origJson(body));
          return res;
        }
        return origJson(body);
      }) as any;
    }
    next();
  } catch (err) {
    console.error('Cloud DB sync error:', redactSecrets(String(err)));
    next();
  }
});

// --- Central Security Gatekeeper: Protect ALL Admin, Write & AI Endpoints ---
app.use('/api', (req, res, next) => {
  const p = req.path;
  const m = req.method.toUpperCase();

  // Publicly accessible endpoints for normal website visitors:
  if (m === 'GET' && p === '/health') return next();
  if (p === '/auth/login' || p === '/auth/me') return next();
  if (m === 'GET' && (p === '/posts' || /^\/posts\/\d+$/.test(p))) return next();
  if (m === 'GET' && /^\/posts\/by-slug\/[^/]+$/.test(p)) return next();
  if (m === 'GET' && p === '/channels/oauth/callback') return next(); // signed state proves the admin started it
  if (m === 'POST' && /^\/posts\/\d+\/comments$/.test(p)) return next();
  if (m === 'GET' && p === '/pillars') return next();
  if (m === 'GET' && (p === '/site-config' || p === '/projects')) return next();
  if (m === 'POST' && (p === '/subscribers' || p === '/contacts' || p === '/surveys')) {
    return next();
  }

  // Every other /api/* route requires valid Admin Authentication
  return requireAdminAuth(req, res, () => {
    syncSettingsFromRequestVault(req, res);
    next();
  });
});

// --- Admin Authentication Endpoints ---
app.post('/api/auth/login', (req, res) => {
  const ip = getClientIp(req);
  const rate = checkLoginRateLimit(ip);
  if (!rate.allowed) {
    res.setHeader('Retry-After', String(rate.retryAfterSec));
    res.status(429).json({
      error: `พยายามเข้าสู่ระบบหลายครั้งเกินไป กรุณารอ ${Math.ceil(rate.retryAfterSec / 60)} นาทีแล้วลองใหม่`,
    });
    return;
  }

  if (!isAdminPasswordConfigured()) {
    res.status(503).json({
      error:
        'ยังไม่ได้ตั้งค่ารหัสผ่านผู้ดูแล กรุณากำหนด ADMIN_PASSWORD (และ ADMIN_USERNAME) ใน Environment Variables ของโฮสต์ แล้ว deploy ใหม่',
    });
    return;
  }
  const { username = '', password = '' } = req.body || {};
  if (!verifyCredentials(String(username), String(password))) {
    recordLoginFailure(ip);
    res.status(401).json({ error: 'ชื่อผู้ใช้งานหรือรหัสผ่านไม่ถูกต้อง' });
    return;
  }
  clearLoginFailures(ip);
  const { token, expiresAt } = createAdminToken(String(username).trim());
  res.json({ ok: true, token, username: String(username).trim(), expiresAt });
});

app.get('/api/auth/me', (req, res) => {
  const check = verifyAdminToken(extractBearerToken(req));
  if (!check.valid) {
    res.status(401).json({ authenticated: false });
    return;
  }
  res.json({ authenticated: true, username: check.username });
});

app.put('/api/auth/password', (req, res) => {
  const { currentPassword = '', newUsername = '', newPassword = '' } = req.body || {};
  const check = verifyAdminToken(extractBearerToken(req));
  if (!check.valid || !verifyCredentials(check.username || 'admin', String(currentPassword))) {
    res.status(400).json({ error: 'รหัสผ่านปัจจุบันไม่ถูกต้อง' });
    return;
  }
  if (!String(newPassword).trim() || String(newPassword).trim().length < 6) {
    res.status(400).json({ error: 'รหัสผ่านใหม่ต้องมีอย่างน้อย 6 ตัวอักษร' });
    return;
  }
  updateAdminCredentials(String(newUsername || check.username || 'admin'), String(newPassword));
  const { token, expiresAt } = createAdminToken(
    String(newUsername || check.username || 'admin').trim()
  );
  res.json({ ok: true, token, expiresAt });
});

const ALLOWED_UPLOAD_EXTS = new Set([
  '.jpg',
  '.jpeg',
  '.png',
  '.webp',
  '.gif',
  '.mp4',
  '.webm',
  '.mov',
  '.mp3',
  '.wav',
  '.m4a',
  '.ogg',
]);

const ALLOWED_UPLOAD_MIMES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'video/mp4',
  'video/webm',
  'video/quicktime',
  'audio/mpeg',
  'audio/mp3',
  'audio/wav',
  'audio/x-wav',
  'audio/mp4',
  'audio/ogg',
]);

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOADS_DIR),
  filename: (_req, file, cb) => {
    const rawExt = path.extname(file.originalname || '.jpg').toLowerCase();
    const safeExt = ALLOWED_UPLOAD_EXTS.has(rawExt) ? rawExt : '.bin';
    cb(null, `komkrit-${Date.now()}-${Math.round(Math.random() * 1e5)}${safeExt}`);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 100 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase();
    const mime = (file.mimetype || '').toLowerCase();
    if (ALLOWED_UPLOAD_EXTS.has(ext) && ALLOWED_UPLOAD_MIMES.has(mime)) {
      cb(null, true);
    } else {
      cb(new Error('ชนิดไฟล์ไม่ได้รับอนุญาต (รองรับเฉพาะภาพ JPG/PNG/WebP/GIF, วิดีโอ MP4/WebM และเสียง MP3/WAV เท่านั้น)'));
    }
  },
});

function maskSecret(val?: string): string {
  return maskSecretStrict(val);
}

function mapPostRow(r: any) {
  let tags: string[] = [];
  try {
    tags = JSON.parse(r.tags_json || '[]');
  } catch {
    tags = [];
  }
  return {
    id: r.id,
    slug: r.slug || '',
    title: r.title,
    subtitle: r.subtitle || '',
    excerpt: r.excerpt,
    content: r.content,
    category: r.category,
    contentType: r.content_type,
    coverImage: r.cover_image,
    videoUrl: r.video_url || '',
    audioUrl: r.audio_url || '',
    tags,
    author: r.author,
    status: r.status,
    isFeatured: Boolean(r.is_featured),
    views: Number(r.views || 0),
    commentsCount: Number(r.comments_count || 0),
    aiWorkflowId: r.ai_workflow_id ?? null,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function mapWorkflowRow(r: any) {
  const safeParse = (s: string, fallback: any = {}) => {
    try {
      return JSON.parse(s || '{}');
    } catch {
      return fallback;
    }
  };
  return {
    id: r.id,
    topic: r.topic,
    inputSource: r.input_source,
    category: r.category,
    targetAudience: r.target_audience,
    businessPillar: r.business_pillar,
    flowMode: r.flow_mode,
    engineUsed: r.engine_used,
    status: r.status,
    ceoOutput: safeParse(r.ceo_json),
    researchOutput: safeParse(r.research_json),
    scriptOutput: safeParse(r.script_json),
    designOutput: safeParse(r.design_json),
    visualOutput: safeParse(r.visual_json),
    videoOutput: safeParse(r.video_json),
    audioOutput: safeParse(r.audio_json),
    qaOutput: safeParse(r.qa_json),
    analyticsOutput: safeParse(r.analytics_json),
    omnichannelOutput: safeParse(r.omnichannel_json),
    humanApproval: safeParse(r.approval_json),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function mapFlowProjectRow(r: any) {
  let scenes: any[] = [];
  try {
    scenes = JSON.parse(r.scenes_json || '[]');
  } catch {
    scenes = [];
  }
  return {
    id: r.id,
    title: r.title,
    concept: r.concept,
    aspectRatio: r.aspect_ratio,
    resolution: r.resolution,
    videoEngine: r.video_engine,
    scenes,
    masterVideoUrl: r.master_video_url || '',
    voiceoverAudioUrl: r.voiceover_audio_url || '',
    status: r.status,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

// --- Upload Endpoint (Images, MP4 Videos, Audio) ---
app.post('/api/upload', upload.single('file'), async (req, res) => {
  if (!req.file) {
    res.status(400).json({ error: 'ไม่พบไฟล์ที่อัปโหลด' });
    return;
  }
  const fileBuffer = fs.readFileSync(req.file.path);
  const cloudUrl = await uploadMediaToCloudBlob(
    fileBuffer,
    req.file.filename,
    req.file.mimetype
  );
  if (cloudUrl) {
    res.json({ url: cloudUrl });
    return;
  }
  if (
    IS_SERVERLESS &&
    req.file.mimetype.startsWith('image/') &&
    req.file.size <= 4 * 1024 * 1024
  ) {
    res.json({ url: `data:${req.file.mimetype};base64,${fileBuffer.toString('base64')}` });
    return;
  }
  res.json({ url: `/uploads/${req.file.filename}` });
});

// --- Dashboard Stats ---
app.get('/api/stats', (_req, res) => {
  const postsTotal = (db.prepare('SELECT COUNT(*) as c FROM posts').get() as any).c;
  const postsPublished = (
    db.prepare("SELECT COUNT(*) as c FROM posts WHERE status = 'published'").get() as any
  ).c;
  const totalViews =
    (db.prepare('SELECT COALESCE(SUM(views), 0) as v FROM posts').get() as any).v || 0;
  const totalComments = (db.prepare('SELECT COUNT(*) as c FROM comments').get() as any).c;
  const totalWorkflows = (
    db.prepare('SELECT COUNT(*) as c FROM ai_workflows').get() as any
  ).c;
  const pendingApprovals = (
    db
      .prepare(
        "SELECT COUNT(*) as c FROM ai_workflows WHERE status IN ('pending_approval', 'revision_requested')"
      )
      .get() as any
  ).c;
  const totalSubscribers = (
    db.prepare('SELECT COUNT(*) as c FROM subscribers').get() as any
  ).c;
  const unreadContacts = (
    db.prepare("SELECT COUNT(*) as c FROM contacts WHERE status = 'unread'").get() as any
  ).c;
  const kbCount = (db.prepare('SELECT COUNT(*) as c FROM knowledge_base').get() as any).c;
  const mediaAssetsCount = (
    db.prepare('SELECT COUNT(*) as c FROM ai_media_assets').get() as any
  ).c;

  res.json({
    postsTotal,
    postsPublished,
    totalViews,
    totalComments,
    totalWorkflows,
    pendingApprovals,
    totalSubscribers,
    unreadContacts,
    kbCount,
    mediaAssetsCount,
  });
});

// --- Posts CRUD ---
app.get('/api/posts', (req, res) => {
  backfillPostSlugs(db);
  const { category, type, status, q } = req.query;
  const conditions: string[] = [];
  const params: any[] = [];
  const isAdmin = isRequestAdmin(req);

  if (category && category !== 'all') {
    conditions.push('p.category = ?');
    params.push(String(category));
  }
  if (type && type !== 'all') {
    conditions.push('p.content_type = ?');
    params.push(String(type));
  }
  if (!isAdmin) {
    conditions.push("p.status = 'published'");
  } else if (status && status !== 'all') {
    conditions.push('p.status = ?');
    params.push(String(status));
  }
  if (q && String(q).trim()) {
    const term = `%${String(q).trim()}%`;
    conditions.push(
      '(p.title LIKE ? OR p.subtitle LIKE ? OR p.excerpt LIKE ? OR p.content LIKE ? OR p.tags_json LIKE ?)'
    );
    params.push(term, term, term, term, term);
  }

  const whereSql = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const sql = `
    SELECT p.*,
      (SELECT COUNT(*) FROM comments c WHERE c.post_id = p.id) AS comments_count
    FROM posts p
    ${whereSql}
    ORDER BY p.is_featured DESC, p.created_at DESC, p.id DESC
  `;
  const rows = db.prepare(sql).all(...params);
  res.json(rows.map(mapPostRow));
});

const POST_STATUSES = ['published', 'draft', 'archived'];

app.get('/api/posts/by-slug/:slug', (req, res) => {
  backfillPostSlugs(db);
  let slug = '';
  try {
    slug = decodeURIComponent(String(req.params.slug || '')).normalize('NFC');
  } catch {
    res.status(400).json({ error: 'slug ไม่ถูกต้อง' });
    return;
  }
  // numeric ids are accepted too (short links) and resolve to the canonical slug
  const found = /^\d+$/.test(slug)
    ? { postId: Number(slug), canonical: false }
    : findPostIdBySlug(db, slug);
  const row = found
    ? (db
        .prepare(
          `SELECT p.*, (SELECT COUNT(*) FROM comments c WHERE c.post_id = p.id) AS comments_count
           FROM posts p WHERE p.id = ?`
        )
        .get(found.postId) as any)
    : null;
  if (!row || (!isRequestAdmin(req) && row.status !== 'published')) {
    res.status(404).json({ error: 'ไม่พบบทความที่ต้องการ' });
    return;
  }
  if (req.query.incrementView === '1') {
    db.prepare('UPDATE posts SET views = views + 1 WHERE id = ?').run(row.id);
    row.views = Number(row.views || 0) + 1;
  }
  const comments = db
    .prepare('SELECT * FROM comments WHERE post_id = ? ORDER BY created_at DESC, id DESC')
    .all(row.id)
    .map((c: any) => ({
      id: c.id,
      postId: c.post_id,
      authorName: c.author_name,
      authorRole: c.author_role,
      message: c.message,
      rating: c.rating,
      createdAt: c.created_at,
    }));
  res.json({ ...mapPostRow(row), canonical: row.slug === slug, comments });
});

app.get('/api/posts/:id', (req, res) => {
  const id = Number(req.params.id);
  if (req.query.incrementView === '1') {
    db.prepare('UPDATE posts SET views = views + 1 WHERE id = ?').run(id);
  }
  const row = db
    .prepare(
      `SELECT p.*, (SELECT COUNT(*) FROM comments c WHERE c.post_id = p.id) AS comments_count
       FROM posts p WHERE p.id = ?`
    )
    .get(id) as any;
  if (!row || (!isRequestAdmin(req) && row.status !== 'published')) {
    res.status(404).json({ error: 'ไม่พบบทความ' });
    return;
  }
  const comments = db
    .prepare('SELECT * FROM comments WHERE post_id = ? ORDER BY created_at DESC, id DESC')
    .all(id)
    .map((c: any) => ({
      id: c.id,
      postId: c.post_id,
      authorName: c.author_name,
      authorRole: c.author_role,
      message: c.message,
      rating: c.rating,
      createdAt: c.created_at,
    }));

  res.json({ post: mapPostRow(row), comments });
});

app.post('/api/posts', (req, res) => {
  const {
    title,
    subtitle = '',
    excerpt = '',
    content = '',
    category = 'education',
    contentType = 'article',
    coverImage = '/images/thumb-ai-edu.jpg',
    videoUrl = '',
    audioUrl = '',
    tags = [],
    author = 'คมกฤช (Komkrit)',
    status = 'published',
    isFeatured = false,
    slug: slugInput = '',
  } = req.body;

  if (!title || !String(title).trim()) {
    res.status(400).json({ error: 'กรุณาระบุหัวข้อบทความ/โพสต์' });
    return;
  }
  if (!POST_STATUSES.includes(String(status))) {
    res.status(400).json({ error: 'สถานะบทความไม่ถูกต้อง' });
    return;
  }
  const wantedSlug = String(slugInput || '').trim().normalize('NFC').toLowerCase();
  if (wantedSlug) {
    const slugErr = validateSlug(wantedSlug);
    if (slugErr) {
      res.status(400).json({ error: slugErr });
      return;
    }
    if (isSlugTaken(db, wantedSlug)) {
      res.status(409).json({ error: `slug "${wantedSlug}" ถูกใช้แล้ว กรุณาใช้ชื่ออื่น` });
      return;
    }
  }

  if (isFeatured) {
    db.prepare('UPDATE posts SET is_featured = 0').run();
  }

  const now = new Date().toISOString();
  const autoExcerpt =
    excerpt && String(excerpt).trim()
      ? String(excerpt).trim()
      : String(content)
          .replace(/!\[[^\]]*\]\([^)]+\)/g, '')
          .replace(/[#>*_`]/g, '')
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, 180);

  const result = db
    .prepare(
      `INSERT INTO posts (
        title, subtitle, excerpt, content, category, content_type, cover_image,
        video_url, audio_url, tags_json, author, status, is_featured, views, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`
    )
    .run(
      String(title).trim(),
      String(subtitle),
      autoExcerpt,
      String(content),
      String(category),
      String(contentType),
      String(coverImage || '/images/thumb-ai-edu.jpg'),
      String(videoUrl || ''),
      String(audioUrl || ''),
      JSON.stringify(Array.isArray(tags) ? tags : []),
      String(author || 'คมกฤช (Komkrit)'),
      String(status),
      isFeatured ? 1 : 0,
      now,
      now
    );

  const newPostId = Number(result.lastInsertRowid);
  setPostSlug(
    db,
    newPostId,
    wantedSlug || uniqueSlug(String(title), (c) => isSlugTaken(db, c, newPostId))
  );
  const created = db
    .prepare(`SELECT p.*, 0 AS comments_count FROM posts p WHERE p.id = ?`)
    .get(newPostId);
  res.status(201).json(mapPostRow(created));
});

app.put('/api/posts/:id', (req, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare('SELECT * FROM posts WHERE id = ?').get(id) as any;
  if (!existing) {
    res.status(404).json({ error: 'ไม่พบบทความที่ต้องการแก้ไข' });
    return;
  }

  const {
    title = existing.title,
    subtitle = existing.subtitle,
    excerpt = existing.excerpt,
    content = existing.content,
    category = existing.category,
    contentType = existing.content_type,
    coverImage = existing.cover_image,
    videoUrl = existing.video_url,
    audioUrl = existing.audio_url || '',
    tags,
    author = existing.author,
    status = existing.status,
    isFeatured,
    views,
    slug: slugInput,
  } = req.body;

  if (!POST_STATUSES.includes(String(status))) {
    res.status(400).json({ error: 'สถานะบทความไม่ถูกต้อง' });
    return;
  }
  if (!String(title).trim()) {
    res.status(400).json({ error: 'กรุณาระบุหัวข้อบทความ/โพสต์' });
    return;
  }
  let nextSlug = '';
  if (typeof slugInput === 'string' && slugInput.trim()) {
    nextSlug = slugInput.trim().normalize('NFC').toLowerCase();
    if (nextSlug !== existing.slug) {
      const slugErr = validateSlug(nextSlug);
      if (slugErr) {
        res.status(400).json({ error: slugErr });
        return;
      }
      if (isSlugTaken(db, nextSlug, id)) {
        res.status(409).json({ error: `slug "${nextSlug}" ถูกใช้แล้ว กรุณาใช้ชื่ออื่น` });
        return;
      }
    }
  }

  const nextFeatured =
    typeof isFeatured === 'boolean' ? (isFeatured ? 1 : 0) : existing.is_featured;
  const nextViews =
    typeof views === 'number' && Number.isFinite(views) && views >= 0
      ? Math.floor(views)
      : Number(existing.views || 0);

  if (nextFeatured === 1 && existing.is_featured === 0) {
    db.prepare('UPDATE posts SET is_featured = 0').run();
  }

  const tagsJson = Array.isArray(tags) ? JSON.stringify(tags) : existing.tags_json;
  const now = new Date().toISOString();

  db.prepare(
    `UPDATE posts SET
      title = ?, subtitle = ?, excerpt = ?, content = ?, category = ?,
      content_type = ?, cover_image = ?, video_url = ?, audio_url = ?, tags_json = ?,
      author = ?, status = ?, is_featured = ?, views = ?, updated_at = ?
     WHERE id = ?`
  ).run(
    String(title).trim(),
    String(subtitle),
    String(excerpt),
    String(content),
    String(category),
    String(contentType),
    String(coverImage),
    String(videoUrl || ''),
    String(audioUrl || ''),
    tagsJson,
    String(author),
    String(status),
    nextFeatured,
    nextViews,
    now,
    id
  );

  if (nextSlug && nextSlug !== existing.slug) {
    setPostSlug(db, id, nextSlug);
  }
  const updated = db
    .prepare(
      `SELECT p.*, (SELECT COUNT(*) FROM comments c WHERE c.post_id = p.id) AS comments_count
       FROM posts p WHERE p.id = ?`
    )
    .get(id);
  res.json(mapPostRow(updated));
});

app.post('/api/posts/:id/duplicate', (req, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare('SELECT * FROM posts WHERE id = ?').get(id) as any;
  if (!existing) {
    res.status(404).json({ error: 'ไม่พบบทความที่ต้องการคัดลอก' });
    return;
  }
  const now = new Date().toISOString();
  const copyTitle = `${String(existing.title).trim()} (สำเนา)`;
  const r = db
    .prepare(
      `INSERT INTO posts (
        title, subtitle, excerpt, content, category, content_type, cover_image,
        video_url, audio_url, tags_json, author, status, is_featured, views, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', 0, 0, ?, ?)`
    )
    .run(
      copyTitle,
      String(existing.subtitle || ''),
      String(existing.excerpt || ''),
      String(existing.content || ''),
      String(existing.category || 'education'),
      String(existing.content_type || 'article'),
      String(existing.cover_image || '/images/thumb-ai-edu.jpg'),
      String(existing.video_url || ''),
      String(existing.audio_url || ''),
      String(existing.tags_json || '[]'),
      String(existing.author || 'คมกฤช (Komkrit)'),
      now,
      now
    );
  const created = db
    .prepare(`SELECT p.*, 0 AS comments_count FROM posts p WHERE p.id = ?`)
    .get(Number(r.lastInsertRowid));
  res.status(201).json(mapPostRow(created));
});

app.post('/api/posts/bulk', (req, res) => {
  const { ids, action, category } = req.body || {};
  if (!Array.isArray(ids) || ids.length === 0) {
    res.status(400).json({ error: 'กรุณาเลือกรายการข่าวอย่างน้อย 1 รายการ' });
    return;
  }
  const cleanIds = ids
    .map((x: unknown) => Number(x))
    .filter((n: number) => Number.isInteger(n) && n > 0);
  if (cleanIds.length === 0) {
    res.status(400).json({ error: 'รหัสรายการไม่ถูกต้อง' });
    return;
  }

  const now = new Date().toISOString();
  db.exec('BEGIN IMMEDIATE');
  try {
    if (action === 'publish' || action === 'draft') {
      const targetStatus = action === 'publish' ? 'published' : 'draft';
      const stmt = db.prepare('UPDATE posts SET status = ?, updated_at = ? WHERE id = ?');
      for (const pid of cleanIds) {
        stmt.run(targetStatus, now, pid);
      }
    } else if (action === 'category' && category) {
      const stmt = db.prepare('UPDATE posts SET category = ?, updated_at = ? WHERE id = ?');
      for (const pid of cleanIds) {
        stmt.run(String(category), now, pid);
      }
    } else if (action === 'delete') {
      for (const pid of cleanIds) deletePostRows(pid);
    } else {
      db.exec('ROLLBACK');
      res.status(400).json({ error: 'คำสั่งจัดการหลายรายการ (bulk action) ไม่ถูกต้อง' });
      return;
    }
    db.exec('COMMIT');
    res.json({ ok: true, affected: cleanIds.length, action });
  } catch (err) {
    try {
      db.exec('ROLLBACK');
    } catch {
      // ignore
    }
    res.status(500).json({ error: (err as Error).message });
  }
});

app.delete('/api/posts/:id', (req, res) => {
  const id = Number(req.params.id);
  try {
    const out = deletePostCascade(id);
    if (!out) {
      res.status(404).json({ error: 'ไม่พบบทความที่ต้องการลบ (อาจถูกลบไปแล้ว)' });
      return;
    }
    res.json({ ok: true, deletedId: id, title: out.title, removedComments: out.removedComments });
  } catch {
    res.status(500).json({ error: 'ลบบทความไม่สำเร็จ ข้อมูลยังคงอยู่ครบ กรุณาลองใหม่' });
  }
});

// --- Comments & Audience Feedback ---
app.get('/api/comments', (_req, res) => {
  const rows = db
    .prepare(
      `SELECT c.*, p.title AS post_title
       FROM comments c
       LEFT JOIN posts p ON p.id = c.post_id
       ORDER BY c.created_at DESC, c.id DESC`
    )
    .all()
    .map((c: any) => ({
      id: c.id,
      postId: c.post_id,
      postTitle: c.post_title || 'บทความ',
      authorName: c.author_name,
      authorRole: c.author_role,
      message: c.message,
      rating: c.rating,
      createdAt: c.created_at,
    }));
  res.json(rows);
});

const publicWriteLimiter = createLimiter({
  max: 12,
  windowMs: 10 * 60 * 1000,
  message: 'ส่งข้อมูลถี่เกินไป กรุณารอสักครู่แล้วลองใหม่',
});
const COMMENT_ROLES = ['ครู / บุคลากรทางการศึกษา', 'นักเรียน / นักศึกษา', 'นักเรียน', 'ผู้ปกครอง', 'ผู้สนใจทั่วไป'];

app.post('/api/posts/:id/comments', publicWriteLimiter, (req, res) => {
  const postId = Number(req.params.id);
  const post = db.prepare('SELECT id, status FROM posts WHERE id = ?').get(postId) as
    | { id: number; status: string }
    | undefined;
  if (!post || (post.status !== 'published' && !isRequestAdmin(req))) {
    res.status(404).json({ error: 'ไม่พบบทความที่ต้องการแสดงความคิดเห็น' });
    return;
  }
  const { authorName = '', authorRole = '', message = '', rating = 5 } = req.body || {};
  const name = String(authorName).replace(/\s+/g, ' ').trim().slice(0, 80) || 'ผู้อ่านทั่วไป';
  const role = COMMENT_ROLES.includes(String(authorRole)) ? String(authorRole) : 'ผู้สนใจทั่วไป';
  const text = String(message).trim();
  if (!text) {
    res.status(400).json({ error: 'กรุณาพิมพ์ความคิดเห็น' });
    return;
  }
  if (text.length > 1500) {
    res.status(400).json({ error: 'ความคิดเห็นยาวเกิน 1,500 ตัวอักษร' });
    return;
  }
  const stars = Math.min(5, Math.max(1, Math.floor(Number(rating)) || 5));
  const now = new Date().toISOString();
  const r = db
    .prepare(
      `INSERT INTO comments (post_id, author_name, author_role, message, rating, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(postId, name, role, text, stars, now);

  res.status(201).json({
    id: Number(r.lastInsertRowid),
    postId,
    authorName: name,
    authorRole: role,
    message: text,
    rating: stars,
    createdAt: now,
  });
});

app.put('/api/comments/:id', (req, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare('SELECT * FROM comments WHERE id = ?').get(id) as any;
  if (!existing) {
    res.status(404).json({ error: 'ไม่พบความคิดเห็นที่ต้องการแก้ไข' });
    return;
  }
  const {
    authorName = existing.author_name,
    authorRole = existing.author_role,
    message = existing.message,
    rating = existing.rating,
  } = req.body || {};

  if (!String(message).trim()) {
    res.status(400).json({ error: 'กรุณาระบุข้อความความคิดเห็น' });
    return;
  }

  const cleanRating = Math.min(5, Math.max(1, Number(rating) || existing.rating || 5));
  db.prepare(
    `UPDATE comments SET author_name = ?, author_role = ?, message = ?, rating = ? WHERE id = ?`
  ).run(
    String(authorName).trim() || 'ผู้ติดตามคมคิด',
    String(authorRole).trim() || 'ผู้สนใจทั่วไป',
    String(message).trim(),
    cleanRating,
    id
  );

  res.json({
    id,
    postId: existing.post_id,
    authorName: String(authorName).trim() || 'ผู้ติดตามคมคิด',
    authorRole: String(authorRole).trim() || 'ผู้สนใจทั่วไป',
    message: String(message).trim(),
    rating: cleanRating,
    createdAt: existing.created_at,
  });
});

app.delete('/api/comments/:id', (req, res) => {
  db.prepare('DELETE FROM comments WHERE id = ?').run(Number(req.params.id));
  res.json({ ok: true });
});

// --- Knowledge Base CRUD ---
app.get('/api/knowledge', (_req, res) => {
  const rows = db
    .prepare('SELECT * FROM knowledge_base ORDER BY id DESC')
    .all()
    .map((k: any) => ({
      id: k.id,
      title: k.title,
      category: k.category,
      summary: k.summary,
      content: k.content,
      sourceRef: k.source_ref,
      isActive: Boolean(k.is_active),
      createdAt: k.created_at,
    }));
  res.json(rows);
});

app.post('/api/knowledge', (req, res) => {
  const {
    title,
    category = 'research',
    summary = '',
    content = '',
    sourceRef = '',
    isActive = true,
  } = req.body;
  if (!title || !String(title).trim()) {
    res.status(400).json({ error: 'กรุณาระบุชื่อรายการฐานความรู้' });
    return;
  }
  const now = new Date().toISOString();
  const r = db
    .prepare(
      `INSERT INTO knowledge_base (title, category, summary, content, source_ref, is_active, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      String(title).trim(),
      String(category),
      String(summary),
      String(content),
      String(sourceRef),
      isActive ? 1 : 0,
      now
    );
  res.status(201).json({
    id: Number(r.lastInsertRowid),
    title: String(title).trim(),
    category,
    summary,
    content,
    sourceRef,
    isActive: Boolean(isActive),
    createdAt: now,
  });
});

app.put('/api/knowledge/:id', (req, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare('SELECT * FROM knowledge_base WHERE id = ?').get(id) as any;
  if (!existing) {
    res.status(404).json({ error: 'ไม่พบฐานความรู้' });
    return;
  }
  const {
    title = existing.title,
    category = existing.category,
    summary = existing.summary,
    content = existing.content,
    sourceRef = existing.source_ref,
    isActive,
  } = req.body;
  const activeInt =
    typeof isActive === 'boolean' ? (isActive ? 1 : 0) : existing.is_active;

  db.prepare(
    `UPDATE knowledge_base SET title = ?, category = ?, summary = ?, content = ?, source_ref = ?, is_active = ? WHERE id = ?`
  ).run(
    String(title).trim(),
    String(category),
    String(summary),
    String(content),
    String(sourceRef),
    activeInt,
    id
  );
  res.json({
    id,
    title: String(title).trim(),
    category,
    summary,
    content,
    sourceRef,
    isActive: Boolean(activeInt),
    createdAt: existing.created_at,
  });
});

app.delete('/api/knowledge/:id', (req, res) => {
  db.prepare('DELETE FROM knowledge_base WHERE id = ?').run(Number(req.params.id));
  res.json({ ok: true });
});

// --- 5-Pillar Business Model ---
app.get('/api/pillars', (_req, res) => {
  const rows = db
    .prepare('SELECT * FROM business_pillars ORDER BY pillar_index ASC')
    .all()
    .map((p: any) => ({
      id: p.id,
      pillarIndex: p.pillar_index,
      pillarKey: p.pillar_key,
      title: p.title,
      subtitle: p.subtitle,
      description: p.description,
      metricLabel: p.metric_label,
      metricValue: p.metric_value,
      statusBadge: p.status_badge,
      actionUrl: p.action_url,
    }));
  res.json(rows);
});

app.post('/api/pillars', (req, res) => {
  const {
    pillarIndex,
    pillarKey = `pillar_${Date.now()}`,
    title,
    subtitle = '',
    description = '',
    metricLabel = 'ตัวชี้วัดหลัก (KPI)',
    metricValue = '100%',
    statusBadge = 'กำลังดำเนินการ',
    actionUrl = '',
  } = req.body || {};

  if (!title || !String(title).trim()) {
    res.status(400).json({ error: 'กรุณาระบุชื่อเสาหลักธุรกิจ' });
    return;
  }

  const maxIdxRow = db
    .prepare('SELECT COALESCE(MAX(pillar_index), 0) AS max_idx FROM business_pillars')
    .get() as any;
  const nextIndex =
    typeof pillarIndex === 'number' && Number.isFinite(pillarIndex)
      ? Math.floor(pillarIndex)
      : Number(maxIdxRow?.max_idx || 0) + 1;

  const r = db
    .prepare(
      `INSERT INTO business_pillars (
        pillar_index, pillar_key, title, subtitle, description,
        metric_label, metric_value, status_badge, action_url
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      nextIndex,
      String(pillarKey).trim() || `pillar_${nextIndex}`,
      String(title).trim(),
      String(subtitle).trim(),
      String(description).trim(),
      String(metricLabel).trim(),
      String(metricValue).trim(),
      String(statusBadge).trim(),
      String(actionUrl).trim()
    );

  res.status(201).json({
    id: Number(r.lastInsertRowid),
    pillarIndex: nextIndex,
    pillarKey: String(pillarKey).trim() || `pillar_${nextIndex}`,
    title: String(title).trim(),
    subtitle: String(subtitle).trim(),
    description: String(description).trim(),
    metricLabel: String(metricLabel).trim(),
    metricValue: String(metricValue).trim(),
    statusBadge: String(statusBadge).trim(),
    actionUrl: String(actionUrl).trim(),
  });
});

app.put('/api/pillars/:id', (req, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare('SELECT * FROM business_pillars WHERE id = ?').get(id) as any;
  if (!existing) {
    res.status(404).json({ error: 'ไม่พบข้อมูลเสาหลักธุรกิจ' });
    return;
  }
  const {
    pillarIndex = existing.pillar_index,
    pillarKey = existing.pillar_key,
    title = existing.title,
    subtitle = existing.subtitle,
    description = existing.description,
    metricLabel = existing.metric_label,
    metricValue = existing.metric_value,
    statusBadge = existing.status_badge,
    actionUrl = existing.action_url || '',
  } = req.body;
  db.prepare(
    `UPDATE business_pillars SET
      pillar_index = ?, pillar_key = ?, title = ?, subtitle = ?, description = ?,
      metric_label = ?, metric_value = ?, status_badge = ?, action_url = ?
     WHERE id = ?`
  ).run(
    Number(pillarIndex) || existing.pillar_index,
    String(pillarKey || existing.pillar_key),
    String(title).trim(),
    String(subtitle),
    String(description),
    String(metricLabel),
    String(metricValue),
    String(statusBadge || ''),
    String(actionUrl || ''),
    id
  );
  res.json({
    ok: true,
    id,
    pillarIndex: Number(pillarIndex) || existing.pillar_index,
    pillarKey: String(pillarKey || existing.pillar_key),
    title: String(title).trim(),
    subtitle: String(subtitle),
    description: String(description),
    metricLabel: String(metricLabel),
    metricValue: String(metricValue),
    statusBadge: String(statusBadge || ''),
    actionUrl: String(actionUrl || ''),
  });
});

app.delete('/api/pillars/:id', (req, res) => {
  const id = Number(req.params.id);
  db.prepare('DELETE FROM business_pillars WHERE id = ?').run(id);
  res.json({ ok: true });
});

// ============================================================================
// REAL MULTI-LLM INTERACTIVE CHAT (GEMINI / CLAUDE / DEEPSEEK / CHATGPT)
// ============================================================================
app.get('/api/ai/chat-sessions', (_req, res) => {
  const rows = db
    .prepare(
      `SELECT
        session_id,
        COUNT(*) AS message_count,
        MAX(created_at) AS updated_at,
        MAX(provider) AS provider,
        (SELECT content FROM ai_chat_messages m2 WHERE m2.session_id = m1.session_id AND m2.role = 'user' ORDER BY m2.id ASC LIMIT 1) AS first_user_msg,
        (SELECT content FROM ai_chat_messages m3 WHERE m3.session_id = m1.session_id ORDER BY m3.id DESC LIMIT 1) AS last_msg
      FROM ai_chat_messages m1
      GROUP BY session_id
      ORDER BY MAX(id) DESC
      LIMIT 40`
    )
    .all()
    .map((r: any) => ({
      sessionId: r.session_id,
      title: String(r.first_user_msg || 'หัวข้อสนทนาใหม่').slice(0, 70),
      lastMessage: String(r.last_msg || '').slice(0, 100),
      messageCount: Number(r.message_count || 0),
      provider: r.provider || 'gemini',
      updatedAt: r.updated_at,
    }));
  res.json(rows);
});

app.get('/api/ai/chat/:sessionId', (req, res) => {
  const sessionId = String(req.params.sessionId || 'default');
  const rows = db
    .prepare('SELECT * FROM ai_chat_messages WHERE session_id = ? ORDER BY id ASC')
    .all(sessionId)
    .map((m: any) => ({
      id: m.id,
      sessionId: m.session_id,
      provider: m.provider,
      model: m.model,
      role: m.role,
      content: m.content,
      reasoning: m.reasoning || '',
      latencyMs: m.latency_ms || 0,
      createdAt: m.created_at,
    }));
  res.json(rows);
});

app.post('/api/ai/chat', async (req, res) => {
  try {
    const {
      sessionId = 'default',
      provider = 'auto',
      model,
      message,
      useKnowledgeBase = true,
    } = req.body;

    const reply = await chatWithRealModel({
      sessionId: String(sessionId),
      provider: provider as any,
      model: model ? String(model) : undefined,
      message: String(message || ''),
      useKnowledgeBase: Boolean(useKnowledgeBase),
    });

    res.json(reply);
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

app.delete('/api/ai/chat/:sessionId', (req, res) => {
  const sessionId = String(req.params.sessionId || 'default');
  db.prepare('DELETE FROM ai_chat_messages WHERE session_id = ?').run(sessionId);
  res.json({ ok: true });
});

app.post('/api/ai/evaluate-prompt', async (req, res) => {
  try {
    const { target = 'image', sessionId, ideaText, aspectRatio, provider, model } = req.body || {};
    const evaluated = await evaluateAndBuildMediaPrompt({
      target: target === 'video' ? 'video' : 'image',
      sessionId: sessionId ? String(sessionId) : undefined,
      ideaText: ideaText ? String(ideaText) : undefined,
      aspectRatio,
      provider,
      model,
    });
    res.json(evaluated);
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

app.post('/api/ai/draft-from-chat', async (req, res) => {
  try {
    const { sessionId, ideaText, contentFormat, category, provider, model } = req.body || {};
    const draft = await draftContentFromChat({
      sessionId: sessionId ? String(sessionId) : undefined,
      ideaText: ideaText ? String(ideaText) : undefined,
      contentFormat,
      category,
      provider,
      model,
    });
    res.json(draft);
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

// ============================================================================
// REAL MEDIA GENERATION (IMAGES, GOOGLE VEO / OMNI VIDEOS, GEMINI 3.8 TTS AUDIO)
// ============================================================================
app.get('/api/ai/media', (req, res) => {
  const { type } = req.query;
  const rows = type
    ? db
        .prepare('SELECT * FROM ai_media_assets WHERE media_type = ? ORDER BY id DESC LIMIT 60')
        .all(String(type))
    : db.prepare('SELECT * FROM ai_media_assets ORDER BY id DESC LIMIT 80').all();

  res.json(
    rows.map((a: any) => ({
      id: a.id,
      mediaType: a.media_type,
      provider: a.provider,
      model: a.model,
      prompt: a.prompt,
      fileUrl: a.file_url,
      mimeType: a.mime_type,
      aspectRatio: a.aspect_ratio,
      durationSec: a.duration_sec,
      resolution: a.resolution,
      interactionId: a.interaction_id,
      workflowId: a.workflow_id,
      reviewStatus: a.review_status || 'approved',
      thaiSummary: a.thai_summary || '',
      createdAt: a.created_at,
    }))
  );
});

app.put('/api/ai/media/:id/review', (req, res) => {
  const id = Number(req.params.id);
  const reviewStatus = req.body?.reviewStatus === 'pending_review' ? 'pending_review' : 'approved';
  db.prepare('UPDATE ai_media_assets SET review_status = ? WHERE id = ?').run(reviewStatus, id);
  res.json({ ok: true, id, reviewStatus });
});

app.delete('/api/ai/media/:id', async (req, res) => {
  const id = Number(req.params.id);
  const existing = db
    .prepare('SELECT file_url FROM ai_media_assets WHERE id = ?')
    .get(id) as { file_url?: string } | undefined;

  if (existing?.file_url) {
    if (existing.file_url.includes('blob.vercel-storage.com')) {
      await deleteMediaFromCloudBlob(existing.file_url);
    } else if (existing.file_url.startsWith('/uploads/')) {
      const abs = path.join(UPLOADS_ROOT, existing.file_url.replace(/^\/uploads\//, ''));
      if (fs.existsSync(abs)) {
        try {
          fs.unlinkSync(abs);
        } catch {
          // ignore
        }
      }
    }
  }

  db.prepare('DELETE FROM ai_media_assets WHERE id = ?').run(id);
  res.json({ ok: true });
});

app.post('/api/ai/image/generate', async (req, res) => {
  try {
    const {
      prompt,
      provider,
      model,
      aspectRatio,
      imageSize,
      workflowId,
      thaiSummary,
      reviewStatus,
    } = req.body;
    const asset = await generateRealImage({
      prompt: String(prompt || ''),
      provider,
      model,
      aspectRatio,
      imageSize,
      workflowId: workflowId ? Number(workflowId) : null,
      thaiSummary: thaiSummary ? String(thaiSummary) : '',
      reviewStatus: reviewStatus === 'approved' ? 'approved' : 'pending_review',
    });

    // If linked to an AI workflow, attach the real generated image URL directly to visualOutput
    if (workflowId) {
      const wfRow = db
        .prepare('SELECT visual_json FROM ai_workflows WHERE id = ?')
        .get(Number(workflowId)) as any;
      if (wfRow) {
        const vj = JSON.parse(wfRow.visual_json || '{}');
        vj.generatedRealImageUrl = asset.fileUrl;
        vj.generatedSvgDataUrl = asset.fileUrl;
        db.prepare('UPDATE ai_workflows SET visual_json = ?, updated_at = ? WHERE id = ?').run(
          JSON.stringify(vj),
          new Date().toISOString(),
          Number(workflowId)
        );
      }
    }

    res.status(201).json(asset);
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

app.post('/api/ai/video/generate', async (req, res) => {
  try {
    const {
      prompt,
      engine,
      aspectRatio,
      durationSec,
      resolution,
      firstFrameUrl,
      lastFrameUrl,
      referenceImageUrls,
      extendVideoUrl,
      stripAudio,
      previousInteractionId,
      workflowId,
      thaiSummary,
    } = req.body;

    const asset = await generateRealVideo({
      prompt: String(prompt || ''),
      engine,
      aspectRatio,
      durationSec: durationSec ? Number(durationSec) : undefined,
      resolution,
      firstFrameUrl,
      lastFrameUrl,
      referenceImageUrls,
      extendVideoUrl,
      stripAudio: Boolean(stripAudio),
      previousInteractionId,
      workflowId: workflowId ? Number(workflowId) : null,
      thaiSummary: thaiSummary ? String(thaiSummary) : '',
      reviewStatus: 'pending_review',
    });

    if (workflowId) {
      const wfRow = db
        .prepare('SELECT video_json FROM ai_workflows WHERE id = ?')
        .get(Number(workflowId)) as any;
      if (wfRow) {
        const vidJ = JSON.parse(wfRow.video_json || '{}');
        vidJ.generatedVideoUrl = asset.fileUrl;
        vidJ.generatedVideoModel = asset.model;
        vidJ.interactionId = asset.interactionId;
        db.prepare('UPDATE ai_workflows SET video_json = ?, updated_at = ? WHERE id = ?').run(
          JSON.stringify(vidJ),
          new Date().toISOString(),
          Number(workflowId)
        );
      }
    }

    res.status(201).json(asset);
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

app.post('/api/ai/audio/generate', async (req, res) => {
  try {
    const { text, provider, model, voice, style, workflowId } = req.body;
    const asset = await generateRealAudio({
      text: String(text || ''),
      provider,
      model: model ? String(model) : undefined,
      voice,
      style,
      workflowId: workflowId ? Number(workflowId) : null,
    });

    if (workflowId) {
      const wfRow = db
        .prepare('SELECT audio_json FROM ai_workflows WHERE id = ?')
        .get(Number(workflowId)) as any;
      if (wfRow) {
        const audJ = JSON.parse(wfRow.audio_json || '{}');
        audJ.generatedAudioUrl = asset.fileUrl;
        audJ.generatedAudioModel = asset.model;
        db.prepare('UPDATE ai_workflows SET audio_json = ?, updated_at = ? WHERE id = ?').run(
          JSON.stringify(audJ),
          new Date().toISOString(),
          Number(workflowId)
        );
      }
    }

    res.status(201).json(asset);
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

// ============================================================================
// GOOGLE FLOW FILMMAKING STUDIO (STORYBOARD -> KEYFRAMES -> VEO CLIPS -> FFMPEG MASTER)
// ============================================================================
app.get('/api/ai/flow/projects', (_req, res) => {
  const rows = db
    .prepare('SELECT * FROM flow_projects ORDER BY updated_at DESC, id DESC')
    .all();
  res.json(rows.map(mapFlowProjectRow));
});

app.post('/api/ai/flow/projects', async (req, res) => {
  try {
    const {
      title,
      concept,
      sceneCount = 3,
      aspectRatio = '16:9',
      resolution = '720p',
      videoEngine = '',
      llmProvider,
      llmModel,
    } = req.body;

    if (!title || !concept) {
      res.status(400).json({ error: 'กรุณาระบุชื่อโปรเจกต์และแนวคิดภาพยนตร์สำหรับ Google Flow' });
      return;
    }

    const storyboard = await generateFlowStoryboardWithLlm({
      title: String(title).trim(),
      concept: String(concept).trim(),
      sceneCount: Number(sceneCount) || 3,
      aspectRatio,
      provider: llmProvider,
      model: llmModel,
    });

    const now = new Date().toISOString();
    const r = db
      .prepare(
        `INSERT INTO flow_projects (
          title, concept, aspect_ratio, resolution, video_engine,
          scenes_json, master_video_url, voiceover_audio_url, status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, '', '', 'storyboard_ready', ?, ?)`
      )
      .run(
        String(title).trim(),
        String(concept).trim(),
        String(aspectRatio),
        String(resolution),
        String(videoEngine),
        JSON.stringify(storyboard.scenes),
        now,
        now
      );

    const created = db
      .prepare('SELECT * FROM flow_projects WHERE id = ?')
      .get(Number(r.lastInsertRowid));
    res.status(201).json(mapFlowProjectRow(created));
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

app.put('/api/ai/flow/projects/:id', (req, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare('SELECT * FROM flow_projects WHERE id = ?').get(id) as any;
  if (!existing) {
    res.status(404).json({ error: 'ไม่พบโปรเจกต์ Google Flow' });
    return;
  }
  const mapped = mapFlowProjectRow(existing);
  const {
    title = mapped.title,
    aspectRatio = mapped.aspectRatio,
    resolution = mapped.resolution,
    videoEngine = mapped.videoEngine,
    scenes = mapped.scenes,
  } = req.body;

  const now = new Date().toISOString();
  db.prepare(
    `UPDATE flow_projects SET
      title = ?, aspect_ratio = ?, resolution = ?, video_engine = ?, scenes_json = ?, updated_at = ?
     WHERE id = ?`
  ).run(
    String(title),
    String(aspectRatio),
    String(resolution),
    String(videoEngine),
    JSON.stringify(scenes),
    now,
    id
  );

  const updated = db.prepare('SELECT * FROM flow_projects WHERE id = ?').get(id);
  res.json(mapFlowProjectRow(updated));
});

app.post('/api/ai/flow/projects/:id/scene/:sceneIdx/frame', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const sceneIdx = Number(req.params.sceneIdx);
    const { which = 'first', customPrompt, imageModel } = req.body;

    const existing = db.prepare('SELECT * FROM flow_projects WHERE id = ?').get(id) as any;
    if (!existing) {
      res.status(404).json({ error: 'ไม่พบโปรเจกต์ Google Flow' });
      return;
    }
    const proj = mapFlowProjectRow(existing);
    const scene = proj.scenes[sceneIdx];
    if (!scene) {
      res.status(404).json({ error: 'ไม่พบฉากที่ระบุ' });
      return;
    }

    const promptToUse =
      customPrompt ||
      (which === 'last' ? scene.lastFramePrompt : scene.firstFramePrompt);

    const imgAsset = await generateRealImage({
      prompt: promptToUse,
      provider: 'gemini',
      model: imageModel || undefined,
      aspectRatio: proj.aspectRatio,
    });

    if (which === 'last') {
      scene.lastFrameUrl = imgAsset.fileUrl;
      if (customPrompt) scene.lastFramePrompt = customPrompt;
    } else {
      scene.firstFrameUrl = imgAsset.fileUrl;
      if (customPrompt) scene.firstFramePrompt = customPrompt;
    }

    const now = new Date().toISOString();
    db.prepare('UPDATE flow_projects SET scenes_json = ?, updated_at = ? WHERE id = ?').run(
      JSON.stringify(proj.scenes),
      now,
      id
    );

    const updated = db.prepare('SELECT * FROM flow_projects WHERE id = ?').get(id);
    res.json(mapFlowProjectRow(updated));
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

app.post('/api/ai/flow/projects/:id/scene/:sceneIdx/video', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const sceneIdx = Number(req.params.sceneIdx);
    const { mode = 'keyframes', customMotionPrompt } = req.body;

    const existing = db.prepare('SELECT * FROM flow_projects WHERE id = ?').get(id) as any;
    if (!existing) {
      res.status(404).json({ error: 'ไม่พบโปรเจกต์ Google Flow' });
      return;
    }
    const proj = mapFlowProjectRow(existing);
    const scene = proj.scenes[sceneIdx];
    if (!scene) {
      res.status(404).json({ error: 'ไม่พบฉากที่ระบุ' });
      return;
    }

    const motionPrompt = customMotionPrompt || scene.videoMotionPrompt;
    const prevScene = sceneIdx > 0 ? proj.scenes[sceneIdx - 1] : null;

    const vidAsset = await generateRealVideo({
      prompt: motionPrompt,
      engine: proj.videoEngine,
      aspectRatio: proj.aspectRatio,
      durationSec: scene.durationSec || 6,
      resolution: proj.resolution,
      firstFrameUrl: mode === 'keyframes' ? scene.firstFrameUrl || undefined : undefined,
      lastFrameUrl:
        mode === 'keyframes' && scene.firstFrameUrl && scene.lastFrameUrl
          ? scene.lastFrameUrl
          : undefined,
      extendVideoUrl:
        mode === 'extend_prev' && prevScene?.videoClipUrl
          ? prevScene.videoClipUrl
          : undefined,
    });

    scene.videoClipUrl = vidAsset.fileUrl;
    scene.interactionId = vidAsset.interactionId;
    if (customMotionPrompt) scene.videoMotionPrompt = customMotionPrompt;

    const now = new Date().toISOString();
    db.prepare(
      "UPDATE flow_projects SET scenes_json = ?, status = 'clips_rendering', updated_at = ? WHERE id = ?"
    ).run(JSON.stringify(proj.scenes), now, id);

    const updated = db.prepare('SELECT * FROM flow_projects WHERE id = ?').get(id);
    res.json(mapFlowProjectRow(updated));
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

app.post('/api/ai/flow/projects/:id/voiceover', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { voice = 'Kore', provider } = req.body;
    const existing = db.prepare('SELECT * FROM flow_projects WHERE id = ?').get(id) as any;
    if (!existing) {
      res.status(404).json({ error: 'ไม่พบโปรเจกต์ Google Flow' });
      return;
    }
    const proj = mapFlowProjectRow(existing);
    const fullNarration = proj.scenes
      .map((s: any) => s.narrationThai)
      .filter(Boolean)
      .join(' ... ');

    if (!fullNarration.trim()) {
      res.status(400).json({ error: 'ไม่มีบทพากย์ภาษาไทยในฉากสำหรับสร้างเสียง' });
      return;
    }

    const audioAsset = await generateRealAudio({
      text: fullNarration,
      provider,
      voice,
    });

    const now = new Date().toISOString();
    db.prepare(
      'UPDATE flow_projects SET voiceover_audio_url = ?, updated_at = ? WHERE id = ?'
    ).run(audioAsset.fileUrl, now, id);

    const updated = db.prepare('SELECT * FROM flow_projects WHERE id = ?').get(id);
    res.json(mapFlowProjectRow(updated));
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

app.post('/api/ai/flow/projects/:id/assemble', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { includeVoiceover = true } = req.body;
    const existing = db.prepare('SELECT * FROM flow_projects WHERE id = ?').get(id) as any;
    if (!existing) {
      res.status(404).json({ error: 'ไม่พบโปรเจกต์ Google Flow' });
      return;
    }
    const proj = mapFlowProjectRow(existing);
    const clipUrls = proj.scenes
      .map((s: any) => s.videoClipUrl)
      .filter((u: string) => Boolean(u && u.trim()));

    const stitched = await stitchFlowScenesWithFfmpeg({
      sceneVideoUrls: clipUrls,
      aspectRatio: proj.aspectRatio,
      voiceoverAudioUrl: includeVoiceover ? proj.voiceoverAudioUrl : undefined,
      projectTitle: proj.title,
    });

    const now = new Date().toISOString();
    db.prepare(
      "UPDATE flow_projects SET master_video_url = ?, status = 'completed', updated_at = ? WHERE id = ?"
    ).run(stitched.masterVideoUrl, now, id);

    const updated = db.prepare('SELECT * FROM flow_projects WHERE id = ?').get(id);
    res.json(mapFlowProjectRow(updated));
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

app.delete('/api/ai/flow/projects/:id', (req, res) => {
  db.prepare('DELETE FROM flow_projects WHERE id = ?').run(Number(req.params.id));
  res.json({ ok: true });
});

// ============================================================================
// MULTI-AGENT AI WORKFLOWS (100% REAL API — NO MOCKUPS!)
// ============================================================================
app.get('/api/ai/workflows', (_req, res) => {
  const rows = db
    .prepare('SELECT * FROM ai_workflows ORDER BY updated_at DESC, id DESC')
    .all();
  res.json(rows.map(mapWorkflowRow));
});

app.post('/api/ai/workflows/run', async (req, res) => {
  try {
    const {
      topic,
      inputSource = 'แนวโน้มการศึกษา (Trend & Research)',
      category = 'ai-tech',
      targetAudience = 'ครู / บุคลากรทางการศึกษา',
      businessPillar = '1. VIEWS | ยอดวิว',
      flowMode = 'full_8agent',
      provider,
      model,
      autoGenerateCoverImage = false,
    } = req.body;

    if (!topic || !String(topic).trim()) {
      res.status(400).json({ error: 'กรุณาระบุหัวข้อหรือโจทย์สำหรับสั่งการ CEO Agent' });
      return;
    }

    const result = await executeMultiAgentWorkflow({
      topic: String(topic).trim(),
      inputSource: String(inputSource),
      category: String(category),
      targetAudience: String(targetAudience),
      businessPillar: String(businessPillar),
      flowMode: flowMode === 'core_3agent' ? 'core_3agent' : 'full_8agent',
      provider: provider as LlmProviderId | undefined,
      model: model ? String(model) : undefined,
      autoGenerateCoverImage: Boolean(autoGenerateCoverImage),
    });

    const newId = createWorkflowRecord(
      {
        topic: String(topic).trim(),
        inputSource: String(inputSource),
        category: String(category),
        targetAudience: String(targetAudience),
        businessPillar: String(businessPillar),
        flowMode: flowMode === 'core_3agent' ? 'core_3agent' : 'full_8agent',
      },
      result
    );
    const created = db.prepare('SELECT * FROM ai_workflows WHERE id = ?').get(newId);
    res.status(201).json(mapWorkflowRow(created));
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

app.put('/api/ai/workflows/:id', (req, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare('SELECT * FROM ai_workflows WHERE id = ?').get(id) as any;
  if (!existing) {
    res.status(404).json({ error: 'ไม่พบแคมเปญ AI' });
    return;
  }

  const mapped = mapWorkflowRow(existing);
  const {
    status = mapped.status,
    scriptOutput = mapped.scriptOutput,
    visualOutput = mapped.visualOutput,
    videoOutput = mapped.videoOutput,
    audioOutput = mapped.audioOutput,
    humanApproval = mapped.humanApproval,
    omnichannelOutput = mapped.omnichannelOutput,
  } = req.body;

  const now = new Date().toISOString();
  db.prepare(
    `UPDATE ai_workflows SET
      status = ?, script_json = ?, visual_json = ?, video_json = ?, audio_json = ?,
      approval_json = ?, omnichannel_json = ?, updated_at = ?
     WHERE id = ?`
  ).run(
    status,
    JSON.stringify(scriptOutput),
    JSON.stringify(visualOutput),
    JSON.stringify(videoOutput),
    JSON.stringify(audioOutput),
    JSON.stringify(humanApproval),
    JSON.stringify(omnichannelOutput),
    now,
    id
  );

  const updated = db.prepare('SELECT * FROM ai_workflows WHERE id = ?').get(id);
  res.json(mapWorkflowRow(updated));
});

app.post('/api/ai/workflows/:id/revision', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const existing = db.prepare('SELECT * FROM ai_workflows WHERE id = ?').get(id) as any;
    if (!existing) {
      res.status(404).json({ error: 'ไม่พบแคมเปญ AI' });
      return;
    }
    const { revisionNote = '', provider, model } = req.body;
    const result = await executeMultiAgentWorkflow({
      topic: existing.topic,
      inputSource: existing.input_source,
      category: existing.category,
      targetAudience: existing.target_audience,
      businessPillar: existing.business_pillar,
      flowMode: existing.flow_mode,
      provider,
      model,
      revisionNote: String(revisionNote),
    });

    const now = new Date().toISOString();
    const approval = {
      isAccurate: true,
      isAppropriate: true,
      isOnBrand: true,
      isReady: true,
      reviewerNote: `ปรับปรุงด้วย AI จริงตามคำแนะนำแล้ว: ${revisionNote}`,
      publishedPostId: null,
    };

    db.prepare(
      `UPDATE ai_workflows SET
        engine_used = ?, status = 'pending_approval',
        ceo_json = ?, research_json = ?, script_json = ?, design_json = ?, visual_json = ?,
        video_json = ?, audio_json = ?, qa_json = ?, analytics_json = ?, omnichannel_json = ?,
        approval_json = ?, updated_at = ?
       WHERE id = ?`
    ).run(
      result.engineUsed,
      JSON.stringify(result.ceoOutput),
      JSON.stringify(result.researchOutput),
      JSON.stringify(result.scriptOutput),
      JSON.stringify(result.designOutput),
      JSON.stringify(result.visualOutput),
      JSON.stringify(result.videoOutput),
      JSON.stringify(result.audioOutput),
      JSON.stringify(result.qaOutput),
      JSON.stringify(result.analyticsOutput),
      JSON.stringify(result.omnichannelOutput),
      JSON.stringify(approval),
      now,
      id
    );

    const updated = db.prepare('SELECT * FROM ai_workflows WHERE id = ?').get(id);
    res.json(mapWorkflowRow(updated));
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

app.post('/api/ai/workflows/:id/approve-publish', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const existing = db.prepare('SELECT * FROM ai_workflows WHERE id = ?').get(id) as any;
    if (!existing) {
      res.status(404).json({ error: 'ไม่พบแคมเปญ AI' });
      return;
    }

    const wf = mapWorkflowRow(existing);
    const {
      customTitle,
      customContent,
      coverImageChoice,
      videoUrlChoice,
      audioUrlChoice,
      isFeatured = false,
      reviewerNote = 'อนุมัติโดย Human Approval พร้อมเผยแพร่ขึ้นเว็บไซต์หลัก',
      channelsToPublish = ['Website / Blog'],
    } = req.body;

    const finalTitle = customTitle || wf.scriptOutput.selectedTitle || wf.topic;
    const finalContent = customContent || wf.scriptOutput.fullArticleMarkdown;
    const finalCover =
      coverImageChoice ||
      wf.visualOutput?.generatedRealImageUrl ||
      wf.visualOutput?.generatedSvgDataUrl ||
      '/images/thumb-ai-edu.jpg';
    const finalVideoUrl =
      (typeof videoUrlChoice === 'string' && videoUrlChoice.trim()) ||
      wf.videoOutput?.generatedVideoUrl ||
      '';
    const finalAudioUrl =
      (typeof audioUrlChoice === 'string' && audioUrlChoice.trim()) ||
      wf.audioOutput?.generatedAudioUrl ||
      '';

    if (isFeatured) {
      db.prepare('UPDATE posts SET is_featured = 0').run();
    }

    const now = new Date().toISOString();
    const postRes = db
      .prepare(
        `INSERT INTO posts (
          title, subtitle, excerpt, content, category, content_type, cover_image,
          video_url, audio_url, tags_json, author, status, is_featured, views, ai_workflow_id, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'คมกฤช (Komkrit) • AI+Human', 'published', ?, 1, ?, ?, ?)`
      )
      .run(
        finalTitle,
        wf.scriptOutput.subtitle || '',
        wf.scriptOutput.excerpt || finalTitle,
        finalContent,
        wf.category || 'ai-tech',
        finalVideoUrl ? 'video' : 'article',
        finalCover,
        finalVideoUrl,
        finalAudioUrl,
        JSON.stringify(['AI Multi-Agent', 'คมคิด by KOMKRIT', wf.targetAudience]),
        isFeatured ? 1 : 0,
        id,
        now,
        now
      );

    const publishedPostId = Number(postRes.lastInsertRowid);

    // Execute REAL omnichannel dispatch for selected channels (NO fake sandbox_ready!)
    const channelNameMap: Record<string, string> = {
      YouTube: 'youtube',
      Facebook: 'facebook',
      TikTok: 'tiktok',
      'LINE OA': 'line_oa',
      'X (Twitter)': 'x_twitter',
      Instagram: 'instagram',
      'Website / Blog': 'website_blog',
      'Email / Newsletter': 'email_newsletter',
    };

    const succeededChannelNames: string[] = [];
    const logIns = db.prepare(`
      INSERT INTO publish_logs (
        workflow_id, post_id, channel_key, channel_name, title, content_preview,
        mode, status, external_url, response_note, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const chName of channelsToPublish) {
      const chKey = channelNameMap[chName] || chName;
      if (chKey === 'website_blog') {
        succeededChannelNames.push('Website / Blog');
        logIns.run(
          id,
          publishedPostId,
          'website_blog',
          'Website / Blog',
          finalTitle,
          (wf.scriptOutput.excerpt || finalTitle).slice(0, 200),
          'internal_live',
          'published',
          `/?post=${publishedPostId}`,
          `เผยแพร่ขึ้นหน้าเว็บไซต์หลักจริงสำเร็จ (Post #${publishedPostId})`,
          now
        );
        continue;
      }

      // Only auto-dispatch external channels that actually have real API tokens or webhooks configured
      const cfg = db
        .prepare('SELECT * FROM channel_configs WHERE channel_key = ?')
        .get(chKey) as any;
      const hasRealCreds =
        Boolean(cfg?.access_token?.trim()) ||
        Boolean(cfg?.webhook_url?.trim()) ||
        (chKey === 'email_newsletter' &&
          Boolean(getProviderConfigs().resend.apiKey));

      if (!hasRealCreds) {
        continue;
      }

      const outcome = await dispatchSingleChannelReal({
        channelKey: chKey,
        title: finalTitle,
        content: wf.scriptOutput.excerpt || finalContent.slice(0, 1000),
        category: wf.category || 'ai-tech',
        coverImage: finalCover,
        videoUrl: finalVideoUrl,
        audioUrl: finalAudioUrl,
        workflowId: id,
        postId: publishedPostId,
      });

      logIns.run(
        id,
        publishedPostId,
        outcome.channelKey,
        outcome.channelName,
        finalTitle,
        (wf.scriptOutput.excerpt || finalTitle).slice(0, 200),
        outcome.mode,
        outcome.status,
        outcome.externalUrl,
        outcome.responseNote,
        now
      );

      if (outcome.status === 'published') {
        succeededChannelNames.push(outcome.channelName);
      }
    }

    const nextApproval = {
      isAccurate: true,
      isAppropriate: true,
      isOnBrand: true,
      isReady: true,
      reviewerNote,
      approvedAt: now,
      publishedPostId,
    };
    const nextOmni = {
      ...wf.omnichannelOutput,
      publishedChannels: succeededChannelNames,
    };

    db.prepare(
      `UPDATE ai_workflows SET status = 'published', approval_json = ?, omnichannel_json = ?, updated_at = ? WHERE id = ?`
    ).run(JSON.stringify(nextApproval), JSON.stringify(nextOmni), now, id);

    const updatedWf = db.prepare('SELECT * FROM ai_workflows WHERE id = ?').get(id);
    const createdPost = db
      .prepare('SELECT p.*, 0 AS comments_count FROM posts p WHERE p.id = ?')
      .get(publishedPostId);

    res.json({
      workflow: mapWorkflowRow(updatedWf),
      post: mapPostRow(createdPost),
    });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

app.delete('/api/ai/workflows/:id', (req, res) => {
  db.prepare('DELETE FROM ai_workflows WHERE id = ?').run(Number(req.params.id));
  res.json({ ok: true });
});

app.post('/api/ai/assist', async (req, res) => {
  try {
    const result = await assistPostContent(req.body);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

// --- Subscribers & Contacts ---
app.get('/api/subscribers', (_req, res) => {
  const rows = db
    .prepare('SELECT * FROM subscribers ORDER BY created_at DESC')
    .all()
    .map((s: any) => ({
      id: s.id,
      email: s.email,
      name: s.name,
      role: s.role,
      createdAt: s.created_at,
    }));
  res.json(rows);
});

app.post('/api/subscribers', publicWriteLimiter, (req, res) => {
  const { email, name = '', role = 'ผู้สนใจทั่วไป' } = req.body;
  if (!email || !String(email).includes('@')) {
    res.status(400).json({ error: 'กรุณากรอกอีเมลให้ถูกต้อง' });
    return;
  }
  const now = new Date().toISOString();
  db.prepare(
    `INSERT OR IGNORE INTO subscribers (email, name, role, created_at) VALUES (?, ?, ?, ?)`
  ).run(String(email).trim().toLowerCase(), String(name).trim(), String(role), now);
  res.status(201).json({ ok: true });
});

app.put('/api/subscribers/:id', (req, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare('SELECT * FROM subscribers WHERE id = ?').get(id) as any;
  if (!existing) {
    res.status(404).json({ error: 'ไม่พบรายชื่อสมาชิกที่ต้องการแก้ไข' });
    return;
  }
  const {
    email = existing.email,
    name = existing.name,
    role = existing.role,
  } = req.body || {};

  const cleanEmail = String(email).trim().toLowerCase();
  if (!cleanEmail || !cleanEmail.includes('@')) {
    res.status(400).json({ error: 'กรุณากรอกอีเมลให้ถูกต้อง' });
    return;
  }

  db.prepare(
    `UPDATE subscribers SET email = ?, name = ?, role = ? WHERE id = ?`
  ).run(cleanEmail, String(name).trim(), String(role).trim() || 'ผู้สนใจทั่วไป', id);

  res.json({
    ok: true,
    id,
    email: cleanEmail,
    name: String(name).trim(),
    role: String(role).trim() || 'ผู้สนใจทั่วไป',
    createdAt: existing.created_at,
  });
});

app.delete('/api/subscribers/:id', (req, res) => {
  db.prepare('DELETE FROM subscribers WHERE id = ?').run(Number(req.params.id));
  res.json({ ok: true });
});

app.get('/api/contacts', (_req, res) => {
  const rows = db
    .prepare('SELECT * FROM contacts ORDER BY created_at DESC')
    .all()
    .map((c: any) => ({
      id: c.id,
      name: c.name,
      email: c.email,
      subject: c.subject,
      message: c.message,
      status: c.status,
      createdAt: c.created_at,
    }));
  res.json(rows);
});

app.post('/api/contacts', publicWriteLimiter, (req, res) => {
  const { name, email, subject = 'ติดต่อทั่วไป', message } = req.body;
  if (!name || !email || !message) {
    res.status(400).json({ error: 'กรุณากรอกข้อมูลชื่อ อีเมล และข้อความให้ครบถ้วน' });
    return;
  }
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO contacts (name, email, subject, message, status, created_at) VALUES (?, ?, ?, ?, 'unread', ?)`
  ).run(
    String(name).trim(),
    String(email).trim(),
    String(subject).trim(),
    String(message).trim(),
    now
  );
  res.status(201).json({ ok: true });
});

app.put('/api/contacts/:id', (req, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare('SELECT * FROM contacts WHERE id = ?').get(id) as any;
  if (!existing) {
    res.status(404).json({ error: 'ไม่พบข้อความติดต่อที่ต้องการแก้ไข' });
    return;
  }
  const {
    name = existing.name,
    email = existing.email,
    subject = existing.subject,
    message = existing.message,
    status = existing.status,
  } = req.body || {};

  db.prepare(
    `UPDATE contacts SET name = ?, email = ?, subject = ?, message = ?, status = ? WHERE id = ?`
  ).run(
    String(name).trim(),
    String(email).trim(),
    String(subject).trim(),
    String(message).trim(),
    String(status).trim() || 'read',
    id
  );

  res.json({
    ok: true,
    id,
    name: String(name).trim(),
    email: String(email).trim(),
    subject: String(subject).trim(),
    message: String(message).trim(),
    status: String(status).trim() || 'read',
    createdAt: existing.created_at,
  });
});

app.put('/api/contacts/:id/read', (req, res) => {
  db.prepare("UPDATE contacts SET status = 'read' WHERE id = ?").run(Number(req.params.id));
  res.json({ ok: true });
});

app.delete('/api/contacts/:id', (req, res) => {
  db.prepare('DELETE FROM contacts WHERE id = ?').run(Number(req.params.id));
  res.json({ ok: true });
});

// ============================================================================
// LIVE API MODEL DISCOVERY (ZERO HARDCODED MODELS!)
// ============================================================================
app.get('/api/ai/models', async (req, res) => {
  try {
    const forceRefresh = req.query.refresh === '1' || req.query.refresh === 'true';
    const catalog = await fetchAllConfiguredLiveModels(forceRefresh);
    res.json(catalog);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

app.post('/api/ai/models/provider', async (req, res) => {
  try {
    const { provider, apiKey, endpoint, projectId, location } = req.body || {};
    if (!provider) {
      res.status(400).json({ error: 'กรุณาระบุชื่อค่าย AI (provider)' });
      return;
    }
    const catalog = await fetchSingleProviderLiveCatalog({
      provider: provider as DiscoverableProvider,
      apiKey: typeof apiKey === 'string' && apiKey !== '__KEEP__' ? apiKey : undefined,
      endpoint: typeof endpoint === 'string' ? endpoint : undefined,
      projectId: typeof projectId === 'string' ? projectId : undefined,
      location: typeof location === 'string' ? location : undefined,
      forceRefresh: true,
    });
    res.json(catalog);
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

// ============================================================================
// AI ENGINE VAULT & MULTI-PROVIDER SETTINGS (GEMINI, CLAUDE, DEEPSEEK, CHATGPT, VEO)
// ============================================================================
app.get('/api/settings/ai', (req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.setHeader('Pragma', 'no-cache');
  const cfg = getProviderConfigs();
  const localUpdatedAt = getLocalVaultUpdatedAt();
  const hasAnyKey = hasAnyStoredApiSecret();
  const effectiveTs = localUpdatedAt || (hasAnyKey ? Date.now() : 0);
  if (IS_SERVERLESS && effectiveTs > 0) {
    const sealedVault = sealSettingsVaultToken(exportEncryptedSettingsMap(), effectiveTs);
    writeSealedVaultCookie(req, res, sealedVault);
  }
  res.json({
    provider: cfg.defaultProvider,
    encryptedAtRest: true,
    encryptionStandard: 'AES-256-GCM',
    vaultUpdatedAt: effectiveTs,
    // Google Gemini + Image + Video + TTS (All Live API Model Discovery)
    geminiModel: cfg.gemini.model,
    geminiImageModel: cfg.gemini.imageModel,
    geminiVideoModel: cfg.gemini.videoModel,
    geminiTtsModel: cfg.gemini.ttsModel,
    hasGeminiKey: Boolean(cfg.gemini.apiKey),
    geminiKeyMasked: maskSecret(cfg.gemini.apiKey),
    // Anthropic Claude
    claudeModel: cfg.claude.model,
    hasClaudeKey: Boolean(cfg.claude.apiKey),
    claudeKeyMasked: maskSecret(cfg.claude.apiKey),
    // DeepSeek
    deepseekModel: cfg.deepseek.model,
    hasDeepseekKey: Boolean(cfg.deepseek.apiKey),
    deepseekKeyMasked: maskSecret(cfg.deepseek.apiKey),
    // OpenAI ChatGPT
    openaiModel: cfg.openai.model,
    hasOpenaiKey: Boolean(cfg.openai.apiKey),
    openaiKeyMasked: maskSecret(cfg.openai.apiKey),
    // Google Cloud Vertex AI Veo Enterprise
    vertexProjectId: cfg.vertexVeo.projectId,
    vertexLocation: cfg.vertexVeo.location,
    vertexVeoModel: cfg.vertexVeo.veoModel,
    hasVertexToken: Boolean(cfg.vertexVeo.accessToken),
    vertexTokenMasked: maskSecret(cfg.vertexVeo.accessToken),
    // ElevenLabs & Resend
    hasElevenlabsKey: Boolean(cfg.elevenlabs.apiKey),
    elevenlabsKeyMasked: maskSecret(cfg.elevenlabs.apiKey),
    elevenlabsModel: cfg.elevenlabs.model,
    elevenlabsVoiceId: cfg.elevenlabs.voiceId,
    hasResendKey: Boolean(cfg.resend.apiKey),
    resendKeyMasked: maskSecret(cfg.resend.apiKey),
    resendFromEmail: cfg.resend.fromEmail,
    // Custom OpenAI-compatible Server
    localEndpoint: cfg.localOpenAi.endpoint,
    localModel: cfg.localOpenAi.model,
    hasLocalKey: Boolean(cfg.localOpenAi.apiKey),
  });
});

app.put('/api/settings/ai', (req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.setHeader('Pragma', 'no-cache');
  const b = req.body || {};
  const set = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');
  const saveStr = (settingKey: string, val: unknown) => {
    if (typeof val === 'string') {
      set.run(settingKey, val.trim());
    }
  };
  const saveSecret = (settingKey: string, val: unknown) => {
    if (typeof val !== 'string') return;
    const trimmed = val.trim();
    if (trimmed === '__KEEP__' || trimmed === '') {
      // Never accidentally wipe a saved encrypted secret with a blank input
      return;
    }
    if (trimmed === '__CLEAR__') {
      set.run(settingKey, '');
      return;
    }
    set.run(settingKey, encryptSecretValue(trimmed, settingKey));
  };

  saveStr('ai_provider', b.provider);
  saveStr('gemini_model', b.geminiModel);
  saveStr('gemini_image_model', b.geminiImageModel);
  saveStr('gemini_video_model', b.geminiVideoModel);
  saveStr('gemini_tts_model', b.geminiTtsModel);
  saveSecret('gemini_api_key', b.geminiApiKey);

  saveStr('claude_model', b.claudeModel);
  saveSecret('claude_api_key', b.claudeApiKey);

  saveStr('deepseek_model', b.deepseekModel);
  saveSecret('deepseek_api_key', b.deepseekApiKey);

  saveStr('openai_model', b.openaiModel);
  saveSecret('openai_api_key', b.openaiApiKey);

  saveStr('vertex_project_id', b.vertexProjectId);
  saveStr('vertex_location', b.vertexLocation);
  saveStr('vertex_veo_model', b.vertexVeoModel);
  saveSecret('vertex_access_token', b.vertexAccessToken);

  saveSecret('elevenlabs_api_key', b.elevenlabsApiKey);
  saveStr('elevenlabs_model', b.elevenlabsModel);
  saveStr('elevenlabs_voice_id', b.elevenlabsVoiceId);

  saveSecret('resend_api_key', b.resendApiKey);
  saveStr('resend_from_email', b.resendFromEmail);

  saveStr('local_endpoint', b.localEndpoint);
  saveStr('local_model', b.localModel);
  saveSecret('local_api_key', b.localApiKey);

  const updatedAt = Date.now();
  set.run(VAULT_UPDATED_AT_KEY, String(updatedAt));

  invalidateModelCatalogCache();
  if (IS_SERVERLESS) {
    const sealedVault = sealSettingsVaultToken(exportEncryptedSettingsMap(), updatedAt);
    writeSealedVaultCookie(req, res, sealedVault);
  }
  res.json({ ok: true, encryptedAtRest: true, vaultUpdatedAt: updatedAt });
});

app.post('/api/settings/test-provider', async (req, res) => {
  const { provider, model, apiKey } = req.body || {};
  try {
    const result = await testProviderConnection({
      provider,
      model,
      apiKey,
    });
    res.json(result);
  } catch (err) {
    res
      .status(400)
      .json({ error: redactSecrets((err as Error).message, [String(apiKey || '')]) });
  }
});

app.post('/api/settings/test-extra', async (req, res) => {
  const { service, apiKey } = req.body || {};
  try {
    const cfg = getProviderConfigs();
    const startedAt = Date.now();

    if (service === 'elevenlabs') {
      const key = String(apiKey || '').trim() || cfg.elevenlabs.apiKey;
      if (!key) {
        res.status(400).json({ error: 'กรุณาใส่ ElevenLabs API Key ก่อนทดสอบ' });
        return;
      }
      const r = await fetch('https://api.elevenlabs.io/v1/user', {
        headers: { 'xi-api-key': key },
      });
      if (!r.ok) {
        res.status(400).json({ error: `ElevenLabs API ตอบกลับ HTTP ${r.status} (ตรวจสอบคีย์อีกครั้ง)` });
        return;
      }
      const u = (await r.json()) as any;
      const quotaUsed = u?.subscription?.character_count ?? 0;
      const quotaLimit = u?.subscription?.character_limit ?? '?';
      res.json({
        ok: true,
        latencyMs: Date.now() - startedAt,
        detail: `เชื่อมต่อ ElevenLabs สำเร็จ (โควต้าตัวอักษร: ${quotaUsed}/${quotaLimit})`,
      });
      return;
    }

    if (service === 'resend') {
      const key = String(apiKey || '').trim() || cfg.resend.apiKey;
      if (!key) {
        res.status(400).json({ error: 'กรุณาใส่ Resend API Key (re_...) ก่อนทดสอบ' });
        return;
      }
      const r = await fetch('https://api.resend.com/domains', {
        headers: { Authorization: `Bearer ${key}` },
      });
      if (!r.ok) {
        res.status(400).json({ error: `Resend API ตอบกลับ HTTP ${r.status} (ตรวจสอบคีย์อีกครั้ง)` });
        return;
      }
      const d = (await r.json()) as any;
      const domainCount = Array.isArray(d?.data) ? d.data.length : 0;
      res.json({
        ok: true,
        latencyMs: Date.now() - startedAt,
        detail: `เชื่อมต่อ Resend Email API สำเร็จ (โดเมนยืนยันแล้ว ${domainCount} รายการ)`,
      });
      return;
    }

    res.status(400).json({ error: 'ไม่รู้จักบริการที่ต้องการทดสอบ' });
  } catch (err) {
    res
      .status(400)
      .json({ error: redactSecrets((err as Error).message, [String(apiKey || '')]) });
  }
});

// ============================================================================
// OMNICHANNEL PUBLISH & DISTRIBUTE (8 CHANNELS — 100% REAL API / WEBHOOK / DB)
// ============================================================================
registerChannelRoutes(app);

app.get('/api/channels', (_req, res) => {
  res.setHeader('Cache-Control', 'no-store, private');
  const resendGlobalKey = getProviderConfigs().resend.apiKey;
  const rows = db
    .prepare('SELECT * FROM channel_configs ORDER BY id ASC')
    .all()
    .map((c: any) => {
      const decryptedTok = decryptSecretValue(c.access_token, `channel:${c.channel_key}`);
      const tok =
        decryptedTok ||
        (c.channel_key === 'email_newsletter' ? resendGlobalKey : '');
      return {
        id: c.id,
        channelKey: c.channel_key,
        channelName: c.channel_name,
        handleOrUrl: c.handle_or_url || '',
        enabled: Boolean(c.enabled),
        autoPublishOnApprove: Boolean(c.auto_publish),
        hasAccessToken: Boolean(tok),
        accessTokenMasked: maskSecret(tok),
        targetId: c.target_id || '',
        webhookUrl: c.webhook_url || '',
        updatedAt: c.updated_at,
        accountName: c.account_name || '',
        connectionMode: c.connection_mode || '',
        lastVerifiedAt: c.last_verified_at || '',
        connected: connectionStatus(c.channel_key).connected,
      };
    });
  res.json(rows);
});

app.put('/api/channels/:key', (req, res) => {
  const key = String(req.params.key);
  const existing = db
    .prepare('SELECT * FROM channel_configs WHERE channel_key = ?')
    .get(key) as any;
  if (!existing) {
    res.status(404).json({ error: 'ไม่พบช่องทางนี้' });
    return;
  }
  const {
    handleOrUrl = existing.handle_or_url,
    enabled,
    autoPublishOnApprove,
    accessToken,
    targetId = existing.target_id,
    webhookUrl = existing.webhook_url,
  } = req.body;

  let nextToken = existing.access_token;
  if (typeof accessToken === 'string') {
    const trimmed = accessToken.trim();
    if (trimmed === '__CLEAR__') {
      nextToken = '';
    } else if (trimmed !== '__KEEP__' && trimmed !== '') {
      nextToken = encryptSecretValue(trimmed, `channel:${key}`);
    }
  }

  const now = new Date().toISOString();
  db.prepare(
    `UPDATE channel_configs SET
      handle_or_url = ?, enabled = ?, auto_publish = ?,
      access_token = ?, target_id = ?, webhook_url = ?, updated_at = ?
     WHERE channel_key = ?`
  ).run(
    String(handleOrUrl),
    typeof enabled === 'boolean' ? (enabled ? 1 : 0) : existing.enabled,
    typeof autoPublishOnApprove === 'boolean'
      ? autoPublishOnApprove
        ? 1
        : 0
      : existing.auto_publish,
    nextToken,
    String(targetId),
    String(webhookUrl),
    now,
    key
  );
  res.json({ ok: true });
});

async function processDueScheduledPublishes(): Promise<boolean> {
  const nowIso = new Date().toISOString().slice(0, 16); // matches datetime-local YYYY-MM-DDTHH:mm
  const dueRows = db
    .prepare(
      "SELECT * FROM publish_logs WHERE status = 'scheduled' AND scheduled_at IS NOT NULL AND scheduled_at <= ?"
    )
    .all(nowIso) as any[];

  if (dueRows.length === 0) return false;

  for (const row of dueRows) {
    const outcome = await dispatchSingleChannelReal({
      channelKey: row.channel_key,
      title: row.title,
      content: row.content_preview,
      category: 'education',
      coverImage: '/images/thumb-ai-edu.jpg',
      videoUrl: '',
      workflowId: row.workflow_id,
      postId: row.post_id,
    });

    db.prepare(
      `UPDATE publish_logs SET mode = ?, status = ?, external_url = ?, response_note = ? WHERE id = ?`
    ).run(
      outcome.mode,
      outcome.status,
      outcome.externalUrl,
      outcome.responseNote,
      row.id
    );
  }
  return true;
}

app.get('/api/publish/logs', async (_req, res) => {
  try {
    const mutated = await processDueScheduledPublishes();
    if (mutated) {
      await persistDatabaseToCloud();
    }
  } catch {
    // ignore scheduler tick error
  }

  const rows = db
    .prepare('SELECT * FROM publish_logs ORDER BY created_at DESC, id DESC LIMIT 100')
    .all()
    .map((l: any) => ({
      id: l.id,
      workflowId: l.workflow_id,
      postId: l.post_id,
      channelKey: l.channel_key,
      channelName: l.channel_name,
      title: l.title,
      contentPreview: l.content_preview,
      mode: l.mode,
      status: l.status,
      scheduledAt: l.scheduled_at,
      externalUrl: l.external_url || '',
      responseNote: l.response_note || '',
      createdAt: l.created_at,
    }));
  res.json(rows);
});

app.post('/api/publish/dispatch', async (req, res) => {
  try {
    const {
      channels = [],
      title,
      content,
      category = 'education',
      coverImage = '/images/thumb-ai-edu.jpg',
      videoUrl = '',
      audioUrl = '',
      workflowId = null,
      postId = null,
      scheduledAt = null,
    } = req.body;

    if (!title || !Array.isArray(channels) || channels.length === 0) {
      res.status(400).json({ error: 'กรุณาระบุหัวข้อและเลือกอย่างน้อย 1 ช่องทางเผยแพร่' });
      return;
    }

    const now = new Date().toISOString();
    const isScheduled = Boolean(scheduledAt && String(scheduledAt).trim());
    let createdOrLinkedPostId = postId ? Number(postId) : null;

    const results: any[] = [];

    for (const chKey of channels) {
      const cfg = db
        .prepare('SELECT * FROM channel_configs WHERE channel_key = ?')
        .get(String(chKey)) as any;
      const chName = cfg ? cfg.channel_name : String(chKey);

      if (isScheduled) {
        const ins = db
          .prepare(
            `INSERT INTO publish_logs (
              workflow_id, post_id, channel_key, channel_name, title, content_preview,
              mode, status, scheduled_at, external_url, response_note, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, 'live_api', 'scheduled', ?, '', ?, ?)`
          )
          .run(
            workflowId,
            createdOrLinkedPostId,
            String(chKey),
            chName,
            String(title).trim(),
            String(content || title),
            String(scheduledAt),
            `ตั้งเวลาเผยแพร่จริงอัตโนมัติไปยัง ${chName} เวลา ${scheduledAt}`,
            now
          );

        results.push({
          id: Number(ins.lastInsertRowid),
          channelKey: chKey,
          channelName: chName,
          mode: 'live_api',
          status: 'scheduled',
          externalUrl: '',
          responseNote: `ตั้งเวลาเผยแพร่จริงเวลา ${scheduledAt}`,
        });
        continue;
      }

      const outcome = await dispatchSingleChannelReal({
        channelKey: String(chKey),
        title: String(title).trim(),
        content: String(content || title),
        category: String(category),
        coverImage: String(coverImage),
        videoUrl: String(videoUrl || ''),
        audioUrl: String(audioUrl || ''),
        workflowId: workflowId ? Number(workflowId) : null,
        postId: createdOrLinkedPostId,
      });

      if (outcome.createdPostId && !createdOrLinkedPostId) {
        createdOrLinkedPostId = outcome.createdPostId;
      }

      const ins = db
        .prepare(
          `INSERT INTO publish_logs (
            workflow_id, post_id, channel_key, channel_name, title, content_preview,
            mode, status, scheduled_at, external_url, response_note, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)`
        )
        .run(
          workflowId,
          createdOrLinkedPostId,
          outcome.channelKey,
          outcome.channelName,
          String(title).trim(),
          String(content || title).slice(0, 260),
          outcome.mode,
          outcome.status,
          outcome.externalUrl,
          outcome.responseNote,
          now
        );

      results.push({
        id: Number(ins.lastInsertRowid),
        ...outcome,
      });
    }

    res.status(201).json({
      ok: true,
      postId: createdOrLinkedPostId,
      dispatched: results,
    });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

app.put('/api/publish/logs/:id', (req, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare('SELECT * FROM publish_logs WHERE id = ?').get(id) as any;
  if (!existing) {
    res.status(404).json({ error: 'ไม่พบประวัติการเผยแพร่ที่ต้องการแก้ไข' });
    return;
  }
  const {
    title = existing.title,
    contentPreview = existing.content_preview,
    status = existing.status,
    scheduledAt = existing.scheduled_at,
    responseNote = existing.response_note,
  } = req.body || {};

  db.prepare(
    `UPDATE publish_logs SET title = ?, content_preview = ?, status = ?, scheduled_at = ?, response_note = ? WHERE id = ?`
  ).run(
    String(title).trim(),
    String(contentPreview || ''),
    String(status || existing.status),
    scheduledAt ? String(scheduledAt) : null,
    String(responseNote || existing.response_note || ''),
    id
  );
  res.json({ ok: true, id });
});

app.delete('/api/publish/logs/:id', (req, res) => {
  db.prepare('DELETE FROM publish_logs WHERE id = ?').run(Number(req.params.id));
  res.json({ ok: true });
});

// Background Real Scheduler Worker: Executes due scheduled posts automatically on persistent Node servers
if (!IS_SERVERLESS) {
  const schedTimer = setInterval(async () => {
    try {
      await processDueScheduledPublishes();
    } catch {
      // ignore scheduler tick error
    }
  }, 30_000);
  if (typeof schedTimer.unref === 'function') {
    schedTimer.unref();
  }
}

// --- AUDIENCE SURVEYS & SCHOOL FEEDBACK LOOP ---
app.get('/api/surveys', (_req, res) => {
  const rows = db
    .prepare('SELECT * FROM audience_surveys ORDER BY created_at DESC, id DESC')
    .all()
    .map((s: any) => ({
      id: s.id,
      respondentName: s.respondent_name,
      respondentRole: s.respondent_role,
      schoolOrOrg: s.school_or_org || '',
      preferredChannel: s.preferred_channel || 'Website / Blog',
      requestedTopic: s.requested_topic,
      satisfactionScore: s.satisfaction_score,
      feedbackDetail: s.feedback_detail || '',
      createdAt: s.created_at,
    }));
  res.json(rows);
});

app.post('/api/surveys', publicWriteLimiter, (req, res) => {
  const {
    respondentName = 'ผู้ร่วมตอบแบบสำรวจ',
    respondentRole = 'ครู / บุคลากรทางการศึกษา',
    schoolOrOrg = '',
    preferredChannel = 'LINE OA',
    requestedTopic = '',
    satisfactionScore = 5,
    feedbackDetail = '',
  } = req.body;

  if (!String(requestedTopic).trim()) {
    res.status(400).json({ error: 'กรุณาระบุหัวข้อหรือสิ่งที่อยากให้ คมคิด นำเสนอ' });
    return;
  }

  const now = new Date().toISOString();
  const r = db
    .prepare(
      `INSERT INTO audience_surveys (
        respondent_name, respondent_role, school_or_org, preferred_channel,
        requested_topic, satisfaction_score, feedback_detail, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      String(respondentName).trim() || 'ผู้ร่วมตอบแบบสำรวจ',
      String(respondentRole),
      String(schoolOrOrg).trim(),
      String(preferredChannel),
      String(requestedTopic).trim(),
      Math.min(5, Math.max(1, Number(satisfactionScore) || 5)),
      String(feedbackDetail).trim(),
      now
    );

  res.status(201).json({ id: Number(r.lastInsertRowid), ok: true });
});

app.put('/api/surveys/:id', (req, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare('SELECT * FROM audience_surveys WHERE id = ?').get(id) as any;
  if (!existing) {
    res.status(404).json({ error: 'ไม่พบข้อมูลแบบสำรวจที่ต้องการแก้ไข' });
    return;
  }
  const {
    respondentName = existing.respondent_name,
    respondentRole = existing.respondent_role,
    schoolOrOrg = existing.school_or_org,
    preferredChannel = existing.preferred_channel,
    requestedTopic = existing.requested_topic,
    satisfactionScore = existing.satisfaction_score,
    feedbackDetail = existing.feedback_detail,
  } = req.body || {};

  if (!String(requestedTopic).trim()) {
    res.status(400).json({ error: 'กรุณาระบุหัวข้อที่ต้องการนำเสนอ' });
    return;
  }

  const cleanScore = Math.min(5, Math.max(1, Number(satisfactionScore) || existing.satisfaction_score || 5));
  db.prepare(
    `UPDATE audience_surveys SET
      respondent_name = ?, respondent_role = ?, school_or_org = ?,
      preferred_channel = ?, requested_topic = ?, satisfaction_score = ?, feedback_detail = ?
     WHERE id = ?`
  ).run(
    String(respondentName).trim() || 'ผู้ร่วมตอบแบบสำรวจ',
    String(respondentRole).trim(),
    String(schoolOrOrg || '').trim(),
    String(preferredChannel || 'LINE OA').trim(),
    String(requestedTopic).trim(),
    cleanScore,
    String(feedbackDetail || '').trim(),
    id
  );

  res.json({
    ok: true,
    id,
    respondentName: String(respondentName).trim() || 'ผู้ร่วมตอบแบบสำรวจ',
    respondentRole: String(respondentRole).trim(),
    schoolOrOrg: String(schoolOrOrg || '').trim(),
    preferredChannel: String(preferredChannel || 'LINE OA').trim(),
    requestedTopic: String(requestedTopic).trim(),
    satisfactionScore: cleanScore,
    feedbackDetail: String(feedbackDetail || '').trim(),
    createdAt: existing.created_at,
  });
});

app.delete('/api/surveys/:id', (req, res) => {
  db.prepare('DELETE FROM audience_surveys WHERE id = ?').run(Number(req.params.id));
  res.json({ ok: true });
});

// --- PRODUCTION CMS BACKUP & RESTORE (JSON SNAPSHOT EXPORT / IMPORT) ---
app.get('/api/admin/export-json', (_req, res) => {
  const posts = db.prepare('SELECT * FROM posts ORDER BY id ASC').all().map(mapPostRow);
  const comments = db.prepare('SELECT * FROM comments ORDER BY id ASC').all();
  const knowledge = db.prepare('SELECT * FROM knowledge_base ORDER BY id ASC').all();
  const pillars = db.prepare('SELECT * FROM business_pillars ORDER BY pillar_index ASC').all();
  const subscribers = db.prepare('SELECT * FROM subscribers ORDER BY id ASC').all();
  const contacts = db.prepare('SELECT * FROM contacts ORDER BY id ASC').all();
  const surveys = db.prepare('SELECT * FROM audience_surveys ORDER BY id ASC').all();

  res.json({
    version: 'komkid-prod-cms-v1',
    exportedAt: new Date().toISOString(),
    counts: {
      posts: posts.length,
      comments: comments.length,
      knowledge: knowledge.length,
      pillars: pillars.length,
      subscribers: subscribers.length,
      contacts: contacts.length,
      surveys: surveys.length,
    },
    data: {
      posts,
      comments,
      knowledge,
      pillars,
      subscribers,
      contacts,
      surveys,
    },
  });
});

app.post('/api/admin/import-json', (req, res) => {
  const { data, mode = 'merge' } = req.body || {};
  if (!data || typeof data !== 'object') {
    res.status(400).json({ error: 'รูปแบบไฟล์สำรองข้อมูล (JSON Backup) ไม่ถูกต้อง' });
    return;
  }

  let importedPosts = 0;
  let importedKnowledge = 0;
  const now = new Date().toISOString();

  db.exec('BEGIN IMMEDIATE');
  try {
    if (mode === 'replace') {
      if (Array.isArray(data.posts)) {
        db.exec('DELETE FROM comments; DELETE FROM posts;');
      }
      if (Array.isArray(data.knowledge)) {
        db.exec('DELETE FROM knowledge_base;');
      }
    }

    if (Array.isArray(data.posts)) {
      const insPost = db.prepare(
        `INSERT INTO posts (
          title, subtitle, excerpt, content, category, content_type, cover_image,
          video_url, audio_url, tags_json, author, status, is_featured, views, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );
      for (const p of data.posts) {
        if (!p || !p.title) continue;
        insPost.run(
          String(p.title).trim(),
          String(p.subtitle || ''),
          String(p.excerpt || p.title),
          String(p.content || ''),
          String(p.category || 'education'),
          String(p.contentType || p.content_type || 'article'),
          String(p.coverImage || p.cover_image || '/images/thumb-ai-edu.jpg'),
          String(p.videoUrl || p.video_url || ''),
          String(p.audioUrl || p.audio_url || ''),
          Array.isArray(p.tags) ? JSON.stringify(p.tags) : String(p.tags_json || '[]'),
          String(p.author || 'คมกฤช (Komkrit)'),
          String(p.status || 'published'),
          p.isFeatured || p.is_featured ? 1 : 0,
          Number(p.views || 1),
          String(p.createdAt || p.created_at || now),
          now
        );
        importedPosts++;
      }
    }

    if (Array.isArray(data.knowledge)) {
      const insKb = db.prepare(
        `INSERT INTO knowledge_base (title, category, summary, content, source_ref, is_active, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      );
      for (const k of data.knowledge) {
        if (!k || !k.title) continue;
        insKb.run(
          String(k.title).trim(),
          String(k.category || 'research'),
          String(k.summary || ''),
          String(k.content || ''),
          String(k.sourceRef || k.source_ref || ''),
          k.isActive === false || k.is_active === 0 ? 0 : 1,
          String(k.createdAt || k.created_at || now)
        );
        importedKnowledge++;
      }
    }

    db.exec('COMMIT');
    res.json({
      ok: true,
      importedPosts,
      importedKnowledge,
    });
  } catch (err) {
    try {
      db.exec('ROLLBACK');
    } catch {
      // ignore
    }
    res.status(500).json({ error: (err as Error).message });
  }
});

// Sample data that older installs were pre-filled with (admin reviews, then removes on request)
app.get('/api/admin/sample-data', (_req, res) => {
  res.json(detectSampleData());
});
app.post('/api/admin/sample-data/remove', (req, res) => {
  if (req.body?.confirm !== true) {
    res.status(400).json({ error: 'ต้องยืนยันการลบข้อมูลตัวอย่าง' });
    return;
  }
  try {
    res.json({ ok: true, removed: removeSampleData() });
  } catch {
    res.status(500).json({ error: 'ลบข้อมูลตัวอย่างไม่สำเร็จ ข้อมูลยังอยู่ครบ กรุณาลองใหม่' });
  }
});

registerWorkspaceRoutes(app);

// ============================================================================
// AI ROUTING HEALTH (automatic failover) & BATCH RUNS (economy mode)
// ============================================================================
const PROVIDER_LABELS: Record<string, string> = {
  gemini: 'Google Gemini',
  openai: 'OpenAI ChatGPT',
  claude: 'Anthropic Claude',
  deepseek: 'DeepSeek',
  openai_compatible: 'เซิร์ฟเวอร์ภายใน (OpenAI-Compatible)',
};

function readRoutingConfig() {
  const enabledRow = db.prepare("SELECT value FROM settings WHERE key = 'ai_failover_enabled'").get() as
    | { value: string }
    | undefined;
  return {
    failoverEnabled: enabledRow?.value !== '0',
    fallbackOrder: readProviderOrder('ai_fallback_order', STANDARD_ORDER),
    economyOrder: readProviderOrder('ai_economy_order', ECONOMY_ORDER),
  };
}

app.get('/api/ai/health', (_req, res) => {
  const configured = configuredProviderSet();
  const snap = new Map(getHealthSnapshot().map((h) => [h.provider, h]));
  const now = Date.now();
  const providers = Object.keys(PROVIDER_LABELS).map((id) => {
    const h = snap.get(id);
    const isConfigured = configured.has(id as any);
    const cooling = Boolean(h && h.openUntil > now);
    return {
      id,
      label: PROVIDER_LABELS[id],
      configured: isConfigured,
      state: !isConfigured ? 'unconfigured' : cooling ? 'cooldown' : h?.consecutiveFailures ? 'degraded' : 'ok',
      cooldownRemainingSec: cooling ? Math.ceil((h!.openUntil - now) / 1000) : 0,
      consecutiveFailures: h?.consecutiveFailures || 0,
      lastError: h?.lastError || '',
      lastErrorKind: h?.lastKind || '',
      lastErrorAt: h?.lastErrorAt ? new Date(h.lastErrorAt).toISOString() : null,
      lastOkAt: h?.lastOkAt ? new Date(h.lastOkAt).toISOString() : null,
    };
  });
  const day = db
    .prepare(
      `SELECT COUNT(*) AS calls, SUM(ok = 0) AS failures,
              SUM(ok = 1 AND failed_over_from != '') AS failovers,
              SUM(input_tokens) AS input_tokens, SUM(output_tokens) AS output_tokens,
              SUM(cached_tokens) AS cached_tokens
       FROM ai_call_log WHERE created_at > datetime('now','-1 day')`
    )
    .get() as any;
  const recent = db
    .prepare(
      `SELECT created_at, provider, model, tier, ok, error, error_kind, failed_over_from
       FROM ai_call_log WHERE ok = 0 OR failed_over_from != '' ORDER BY id DESC LIMIT 8`
    )
    .all();
  res.json({
    ...readRoutingConfig(),
    providers,
    last24h: {
      calls: day.calls || 0,
      failures: day.failures || 0,
      failovers: day.failovers || 0,
      inputTokens: day.input_tokens || 0,
      outputTokens: day.output_tokens || 0,
      cachedInputTokens: day.cached_tokens || 0,
    },
    recentEvents: recent,
  });
});

app.post('/api/ai/health/reset', (req, res) => {
  const provider = req.body?.provider ? String(req.body.provider) : undefined;
  if (provider && !PROVIDER_LABELS[provider]) {
    res.status(400).json({ error: 'ไม่รู้จักค่าย AI ที่ระบุ' });
    return;
  }
  resetHealth(provider);
  res.json({ ok: true });
});

app.put('/api/ai/routing', (req, res) => {
  const b = req.body || {};
  const valid = Object.keys(PROVIDER_LABELS);
  const cleanOrder = (v: unknown): string[] | null => {
    if (v === undefined) return null;
    if (!Array.isArray(v)) throw new Error('ลำดับค่ายต้องเป็นรายการ');
    const list = v.map(String);
    const bad = list.find((x) => !valid.includes(x));
    if (bad) throw new Error(`ไม่รู้จักค่าย AI: ${bad}`);
    return Array.from(new Set(list));
  };
  try {
    const fb = cleanOrder(b.fallbackOrder);
    const eco = cleanOrder(b.economyOrder);
    const set = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');
    if (fb) set.run('ai_fallback_order', JSON.stringify(fb));
    if (eco) set.run('ai_economy_order', JSON.stringify(eco));
    if (typeof b.failoverEnabled === 'boolean') {
      set.run('ai_failover_enabled', b.failoverEnabled ? '1' : '0');
    }
    res.json(readRoutingConfig());
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

app.get('/api/ai/batches', (_req, res) => {
  res.json({
    maxItems: MAX_BATCH_ITEMS,
    backgroundCapable: !IS_SERVERLESS,
    batches: listBatches(20),
  });
});

app.post('/api/ai/batches', (req, res) => {
  try {
    const b = req.body || {};
    const { id, duplicates } = createBatch({
      name: b.name,
      topics: b.topics,
      options: {
        mode: b.mode,
        concurrency: b.concurrency,
        category: b.category,
        inputSource: b.inputSource,
        targetAudience: b.targetAudience,
        businessPillar: b.businessPillar,
        flowMode: b.flowMode,
        provider: b.provider,
        autoGenerateCoverImage: b.autoGenerateCoverImage,
      },
    });
    startBackground(id); // no-op on serverless: the UI drives /process slices there
    res.status(201).json({ ...summarizeBatch(id), duplicatesRemoved: duplicates });
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

app.get('/api/ai/batches/:id', (req, res) => {
  const s2 = summarizeBatch(Number(req.params.id));
  if (!s2) {
    res.status(404).json({ error: 'ไม่พบ Batch ที่ต้องการ' });
    return;
  }
  res.json(s2);
});

app.post('/api/ai/batches/:id/process', async (req, res) => {
  try {
    const id = Number(req.params.id);
    // Serverless functions are time-limited, so work in short slices the UI keeps calling.
    const budgetMs = IS_SERVERLESS
      ? Math.min(Number(req.body?.budgetMs) || 40000, 45000)
      : Math.min(Number(req.body?.budgetMs) || 20000, 120000);
    res.json(await processBatch(id, { budgetMs }));
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

app.post('/api/ai/batches/:id/cancel', (req, res) => {
  try {
    res.json(cancelBatch(Number(req.params.id)));
  } catch (err) {
    res.status(404).json({ error: (err as Error).message });
  }
});

app.post('/api/ai/batches/:id/retry-failed', (req, res) => {
  try {
    const id = Number(req.params.id);
    const out = retryFailed(id);
    startBackground(id);
    res.json(out);
  } catch (err) {
    res.status(404).json({ error: (err as Error).message });
  }
});

// ============================================================================
// SITE CMS CONFIG, SPECIAL PROJECTS CRUD & LIVE DOMAIN/DNS VERIFICATION
// ============================================================================
const SITE_TEXT_LIMITS: Record<string, number> = {
  brandTitle: 80, brandSub: 80, slogan: 200, heroSubtitle: 300, heroQuote: 400,
  heroSignature: 80, authorName: 120, authorRole: 200, authorBio: 600,
  authorQuote: 400, aboutVision: 400, aboutStory: 3000, featuredVideoTitle: 300,
  featuredVideoDesc: 1000, contactLocation: 200, seoTitle: 200, seoDescription: 400,
};
// URL fields: absolute http(s) only (blocks javascript:/data: schemes).
const SITE_URL_FIELDS = [
  'featuredVideoUrl', 'socialX', 'socialYoutube', 'socialFacebook',
  'socialInstagram', 'socialLineOa',
];
// Image fields: absolute http(s) or a same-site path.
const SITE_IMAGE_FIELDS = ['heroImageUrl', 'authorImageUrl'];
const HOSTNAME_RE =
  /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

function cleanHttpUrl(v: unknown, allowRelative = false): string | null {
  const raw = String(v ?? '').trim();
  if (!raw) return '';
  if (raw.length > 2000) return null;
  if (allowRelative && /^\/(?!\/)[^\s]*$/.test(raw)) return raw;
  try {
    const u = new URL(raw);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.toString() : null;
  } catch {
    return null;
  }
}

function cleanHostname(v: unknown): string {
  return String(v ?? '')
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/[\/?#].*$/, '')
    .replace(/\.$/, '')
    .toLowerCase();
}

function readSiteConfigRecord() {
  const row = db
    .prepare('SELECT config_json, updated_at FROM site_config WHERE id = 1')
    .get() as { config_json: string; updated_at: string } | undefined;
  let parsed: Record<string, any> = {};
  try {
    parsed = row?.config_json ? JSON.parse(row.config_json) : {};
  } catch {
    parsed = {};
  }
  const merged: Record<string, any> = { ...DEFAULT_SITE_CONFIG };
  for (const k of Object.keys(DEFAULT_SITE_CONFIG)) {
    if (parsed[k] !== undefined && parsed[k] !== null) merged[k] = parsed[k];
  }
  if (!Array.isArray(merged.domains)) merged.domains = DEFAULT_SITE_CONFIG.domains;
  return { ...merged, updatedAt: row?.updated_at || new Date().toISOString() } as typeof DEFAULT_SITE_CONFIG & {
    updatedAt: string;
  };
}

/** Validates an admin payload; returns the cleaned partial config or a Thai error message. */
function sanitizeSiteConfigInput(
  incoming: Record<string, any>
): { ok: true; value: Record<string, any> } | { ok: false; error: string } {
  const out: Record<string, any> = {};
  for (const [k, max] of Object.entries(SITE_TEXT_LIMITS)) {
    if (incoming[k] === undefined) continue;
    const v = String(incoming[k] ?? '').trim();
    if (v.length > max) return { ok: false, error: `ฟิลด์ ${k} ยาวเกิน ${max} ตัวอักษร` };
    out[k] = v;
  }
  for (const k of SITE_URL_FIELDS) {
    if (incoming[k] === undefined) continue;
    const v = cleanHttpUrl(incoming[k]);
    if (v === null) return { ok: false, error: `ลิงก์ ${k} ต้องขึ้นต้นด้วย http:// หรือ https://` };
    out[k] = v;
  }
  for (const k of SITE_IMAGE_FIELDS) {
    if (incoming[k] === undefined) continue;
    const v = cleanHttpUrl(incoming[k], true);
    if (v === null) return { ok: false, error: `ที่อยู่รูป ${k} ไม่ถูกต้อง` };
    out[k] = v;
  }
  if (incoming.contactEmail !== undefined) {
    const e = String(incoming.contactEmail ?? '').trim();
    if (e && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) {
      return { ok: false, error: 'รูปแบบอีเมลติดต่อไม่ถูกต้อง' };
    }
    out.contactEmail = e;
  }
  if (incoming.primaryDomain !== undefined) {
    const d = cleanHostname(incoming.primaryDomain);
    if (!HOSTNAME_RE.test(d)) return { ok: false, error: 'โดเมนหลักไม่ถูกต้อง' };
    out.primaryDomain = d;
  }
  if (incoming.domains !== undefined) {
    if (!Array.isArray(incoming.domains)) return { ok: false, error: 'domains ต้องเป็นรายการ' };
    const list = Array.from(new Set(incoming.domains.map(cleanHostname).filter(Boolean)));
    if (list.length > 20) return { ok: false, error: 'เพิ่มโดเมนได้ไม่เกิน 20 รายการ' };
    const bad = list.find((d) => !HOSTNAME_RE.test(d));
    if (bad) return { ok: false, error: `โดเมน "${bad}" ไม่ถูกต้อง` };
    out.domains = list;
  }
  return { ok: true, value: out };
}

function cleanStringList(v: unknown, maxItems: number, maxLen: number): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((x) => String(x ?? '').trim().slice(0, maxLen))
    .filter(Boolean)
    .slice(0, maxItems);
}

const PROJECT_STATUSES = ['active', 'draft', 'archived'];

function mapSpecialProjectRow(r: any) {
  let highlights: string[] = [];
  let tags: string[] = [];
  try {
    highlights = JSON.parse(r.highlights_json || '[]');
  } catch {
    highlights = [];
  }
  try {
    tags = JSON.parse(r.tags_json || '[]');
  } catch {
    tags = [];
  }
  return {
    id: r.id,
    badgeLabel: r.badge_label || 'โครงการพิเศษ',
    title: r.title,
    subtitle: r.subtitle || '',
    description: r.description || '',
    highlights: Array.isArray(highlights) ? highlights : [],
    tags: Array.isArray(tags) ? tags : [],
    ctaLabel: r.cta_label || 'ดูรายละเอียด',
    ctaUrl: r.cta_url || '',
    status: r.status || 'active',
    sortOrder: Number(r.sort_order || 1),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

/** Merges a request body over a base project and validates it. */
function buildProjectInput(
  b: Record<string, any>,
  base: ReturnType<typeof mapSpecialProjectRow> | null
): { ok: true; value: any } | { ok: false; error: string } {
  const pick = (k: string, d: any) => (b[k] !== undefined ? b[k] : base ? (base as any)[k] : d);
  const title = String(pick('title', '')).trim();
  if (!title) return { ok: false, error: 'กรุณาระบุชื่อโครงการ' };
  if (title.length > 200) return { ok: false, error: 'ชื่อโครงการยาวเกิน 200 ตัวอักษร' };
  const status = String(pick('status', 'active')).trim() || 'active';
  if (!PROJECT_STATUSES.includes(status)) return { ok: false, error: 'สถานะโครงการไม่ถูกต้อง' };
  const ctaUrl = cleanHttpUrl(pick('ctaUrl', ''));
  if (ctaUrl === null) return { ok: false, error: 'ลิงก์ปุ่มต้องขึ้นต้นด้วย http:// หรือ https://' };
  const description = String(pick('description', '')).trim();
  if (description.length > 5000) return { ok: false, error: 'รายละเอียดยาวเกิน 5000 ตัวอักษร' };
  return {
    ok: true,
    value: {
      badgeLabel: (String(pick('badgeLabel', '')).trim() || 'โครงการพิเศษ').slice(0, 60),
      title,
      subtitle: String(pick('subtitle', '')).trim().slice(0, 300),
      description,
      highlights: cleanStringList(pick('highlights', []), 12, 300),
      tags: cleanStringList(pick('tags', []), 12, 60),
      ctaLabel: (String(pick('ctaLabel', '')).trim() || 'ดูรายละเอียด').slice(0, 60),
      ctaUrl,
      status,
      sortOrder: Math.max(1, Math.min(9999, Math.floor(Number(pick('sortOrder', 1))) || 1)),
    },
  };
}

app.get('/api/site-config', (_req, res) => {
  res.json(readSiteConfigRecord());
});

app.put('/api/site-config', (req, res) => {
  const checked = sanitizeSiteConfigInput(req.body || {});
  if (!checked.ok) {
    res.status(400).json({ error: checked.error });
    return;
  }
  const { updatedAt: _ignored, ...current } = readSiteConfigRecord();
  const next = { ...current, ...checked.value };
  // Keep the primary domain inside the managed list so status checks always cover it.
  if (!next.domains.includes(next.primaryDomain)) {
    next.domains = [next.primaryDomain, ...next.domains];
  }
  const now = new Date().toISOString();
  db.prepare(
    'INSERT OR REPLACE INTO site_config (id, config_json, updated_at) VALUES (1, ?, ?)'
  ).run(JSON.stringify(next), now);
  res.json({ ...next, updatedAt: now });
});

app.get('/api/projects', (req, res) => {
  const isAdmin = isRequestAdmin(req);
  const rows = db
    .prepare(
      isAdmin
        ? 'SELECT * FROM special_projects ORDER BY sort_order ASC, id DESC'
        : "SELECT * FROM special_projects WHERE status = 'active' ORDER BY sort_order ASC, id DESC"
    )
    .all();
  res.json(rows.map(mapSpecialProjectRow));
});

app.post('/api/projects', (req, res) => {
  const checked = buildProjectInput(req.body || {}, null);
  if (!checked.ok) {
    res.status(400).json({ error: checked.error });
    return;
  }
  const v = checked.value;
  const now = new Date().toISOString();
  const info = db
    .prepare(
      `INSERT INTO special_projects (
        badge_label, title, subtitle, description, highlights_json, tags_json,
        cta_label, cta_url, status, sort_order, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      v.badgeLabel, v.title, v.subtitle, v.description,
      JSON.stringify(v.highlights), JSON.stringify(v.tags),
      v.ctaLabel, v.ctaUrl, v.status, v.sortOrder, now, now
    );
  const created = db
    .prepare('SELECT * FROM special_projects WHERE id = ?')
    .get(Number(info.lastInsertRowid));
  res.status(201).json(mapSpecialProjectRow(created));
});

app.put('/api/projects/:id', (req, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare('SELECT * FROM special_projects WHERE id = ?').get(id) as any;
  if (!existing) {
    res.status(404).json({ error: 'ไม่พบโครงการที่ต้องการแก้ไข' });
    return;
  }
  const checked = buildProjectInput(req.body || {}, mapSpecialProjectRow(existing));
  if (!checked.ok) {
    res.status(400).json({ error: checked.error });
    return;
  }
  const v = checked.value;
  db.prepare(
    `UPDATE special_projects SET
      badge_label = ?, title = ?, subtitle = ?, description = ?,
      highlights_json = ?, tags_json = ?, cta_label = ?, cta_url = ?,
      status = ?, sort_order = ?, updated_at = ?
     WHERE id = ?`
  ).run(
    v.badgeLabel, v.title, v.subtitle, v.description,
    JSON.stringify(v.highlights), JSON.stringify(v.tags),
    v.ctaLabel, v.ctaUrl, v.status, v.sortOrder, new Date().toISOString(), id
  );
  res.json(mapSpecialProjectRow(db.prepare('SELECT * FROM special_projects WHERE id = ?').get(id)));
});

app.delete('/api/projects/:id', (req, res) => {
  const info = db.prepare('DELETE FROM special_projects WHERE id = ?').run(Number(req.params.id));
  if (!info.changes) {
    res.status(404).json({ error: 'ไม่พบโครงการที่ต้องการลบ' });
    return;
  }
  res.json({ ok: true });
});

/** True for loopback / private / link-local / reserved IPv4 ranges (SSRF guard). */
function isNonPublicIPv4(ip: string): boolean {
  const o = ip.split('.').map(Number);
  if (o.length !== 4 || o.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
  const [a, b] = o;
  return (
    a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0)
  );
}

function dnsTargets() {
  return {
    vpsIp: process.env.DNS_TARGET_VPS_IP || '5.183.33.183',
    vercelIp: process.env.DNS_TARGET_VERCEL_IP || '76.76.21.21',
    vercelCname: process.env.DNS_TARGET_VERCEL_CNAME || 'cname.vercel-dns.com',
  };
}

app.get('/api/domains/status', async (_req, res) => {
  const dns = await import('node:dns/promises');
  const cfg = readSiteConfigRecord();
  const targets = dnsTargets();
  const list = Array.from(
    new Set([cfg.primaryDomain, ...(cfg.domains || [])].filter(Boolean))
  ).slice(0, 20);
  const checkedAt = new Date().toISOString();

  const results = await Promise.all(
    list.map(async (domain) => {
      const [ips, cn] = await Promise.all([
        dns.resolve4(domain).catch(() => [] as string[]),
        dns.resolveCname(domain).catch(() => [] as string[]),
      ]);
      const dnsConnected = ips.length > 0 || cn.length > 0;
      const publicOnly = ips.length > 0 && ips.every((ip) => !isNonPublicIPv4(ip));

      let target: 'vps' | 'vercel' | 'other' | 'none' = 'none';
      if (dnsConnected) {
        if (ips.includes(targets.vpsIp)) target = 'vps';
        else if (
          ips.includes(targets.vercelIp) ||
          cn.some((c) => c.toLowerCase().includes('vercel'))
        )
          target = 'vercel';
        else target = 'other';
      }

      let httpsReachable = false;
      let httpStatus: number | null = null;
      // Only probe hosts that resolve exclusively to public addresses.
      if (dnsConnected && (publicOnly || (ips.length === 0 && cn.length > 0))) {
        const ac = new AbortController();
        const timer = setTimeout(() => ac.abort(), 4000);
        try {
          let probe = await fetch(`https://${domain}/api/health`, {
            method: 'GET',
            redirect: 'manual',
            signal: ac.signal,
          });
          if (probe.status === 404 || probe.status === 405) {
            probe = await fetch(`https://${domain}/`, {
              method: 'HEAD',
              redirect: 'manual',
              signal: ac.signal,
            });
          }
          httpStatus = probe.status;
          httpsReachable = probe.status >= 200 && probe.status < 400;
        } catch {
          httpsReachable = false;
        } finally {
          clearTimeout(timer);
        }
      }

      return {
        domain,
        isPrimary: domain === cfg.primaryDomain,
        resolvedIps: ips,
        cnames: cn,
        dnsConnected,
        target,
        httpsReachable,
        httpStatus,
        checkedAt,
      };
    })
  );

  res.json({
    primaryDomain: cfg.primaryDomain,
    checkedAt,
    recommendedTargets: targets,
    results,
  });
});

function xmlEscape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// --- Article page shell: real <head> (title/OG/canonical/JSON-LD), 404 and 301 for old slugs ---
let indexTemplateCache = '';
async function loadIndexTemplate(req: express.Request): Promise<string> {
  if (indexTemplateCache) return indexTemplateCache;
  const local = path.resolve(process.cwd(), 'dist', 'index.html');
  try {
    if (fs.existsSync(local)) {
      indexTemplateCache = fs.readFileSync(local, 'utf8');
      return indexTemplateCache;
    }
  } catch {
    /* try the network fallback */
  }
  try {
    // Serverless fallback: the static build is served from the same origin.
    const proto = String(req.headers['x-forwarded-proto'] || 'https').split(',')[0];
    const host = String(req.headers['x-forwarded-host'] || req.headers.host || '');
    if (host) {
      const r = await fetch(`${proto}://${host}/index.html`);
      if (r.ok) {
        const html = await r.text();
        if (/<div id="root">/.test(html)) {
          indexTemplateCache = html;
          return html;
        }
      }
    }
  } catch {
    /* fall through */
  }
  return '';
}

app.get('/articles/:slug', async (req, res, next) => {
  const template = await loadIndexTemplate(req);
  if (!template) return next(); // dev server (Vite) renders the page itself
  const cfg = readSiteConfigRecord();
  const siteName = `${cfg.brandTitle} ${cfg.brandSub}`.trim();
  res.setHeader('Content-Type', 'text/html; charset=utf-8');

  let slug = '';
  try {
    slug = decodeURIComponent(String(req.params.slug || '')).normalize('NFC');
  } catch {
    res.status(404).send(buildNotFoundShell(template, siteName));
    return;
  }
  backfillPostSlugs(db);
  const found = /^\d+$/.test(slug)
    ? { postId: Number(slug), canonical: false }
    : findPostIdBySlug(db, slug);
  const row = found ? (db.prepare('SELECT * FROM posts WHERE id = ?').get(found.postId) as any) : null;
  if (!row || row.status !== 'published') {
    res.status(404).send(buildNotFoundShell(template, siteName));
    return;
  }
  if (!found!.canonical) {
    const qs = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
    res.redirect(301, `/articles/${encodeURIComponent(row.slug)}${qs}`);
    return;
  }
  const post = mapPostRow(row);
  const base = `https://${cfg.primaryDomain}`;
  res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=60, stale-while-revalidate=300');
  res.status(200).send(
    buildArticleShell(
      template,
      {
        title: post.title,
        subtitle: post.subtitle,
        excerpt: post.excerpt,
        content: post.content,
        coverImage: post.coverImage,
        slug: post.slug,
        author: post.author,
        category: post.category,
        tags: post.tags,
        createdAt: post.createdAt,
        updatedAt: post.updatedAt,
      },
      base,
      siteName
    )
  );
});

app.get('/robots.txt', (_req, res) => {
  const cfg = readSiteConfigRecord();
  const base = `https://${cfg.primaryDomain}`;
  res.type('text/plain').send(
    `User-agent: *\nAllow: /\nDisallow: /admin\nDisallow: /api/\nSitemap: ${base}/sitemap.xml\n`
  );
});

app.get('/sitemap.xml', (_req, res) => {
  const cfg = readSiteConfigRecord();
  const base = `https://${cfg.primaryDomain}`;
  backfillPostSlugs(db);
  const published = db
    .prepare("SELECT id, slug, updated_at FROM posts WHERE status = 'published' ORDER BY created_at DESC")
    .all() as { id: number; slug: string; updated_at: string }[];
  const urls = [
    `<url><loc>${xmlEscape(base)}/</loc><changefreq>daily</changefreq><priority>1.0</priority></url>`,
    ...published.map(
      (p) =>
        `<url><loc>${xmlEscape(`${base}/articles/${encodeURIComponent(p.slug)}`)}</loc><lastmod>${(p.updated_at || new Date().toISOString()).slice(0, 10)}</lastmod><priority>0.8</priority></url>`
    ),
  ].join('\n');
  res
    .type('application/xml')
    .send(
      `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>`
    );
});

// --- Serve Frontend via Vite (Dev) or Static Dist (Prod) ---
async function startServer() {
  const port = Number(process.env.PORT || 3000);
  const isProd = process.env.NODE_ENV === 'production';

  if (!isProd) {
    const vitePkg = 'vite';
    const { createServer: createViteServer } = await import(vitePkg);
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('/{*splat}', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(port, '0.0.0.0', () => {
    console.log(
      `\nคมคิด by KOMKRIT WebApp & Real Multi-LLM + Google Veo/Flow Studio running at http://0.0.0.0:${port}\n`
    );
  });
}

if (!IS_SERVERLESS) {
  startServer();
  resumeBatchesOnBoot();
}

export { app };
export default app;
