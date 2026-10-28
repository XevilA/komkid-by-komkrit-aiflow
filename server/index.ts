import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import multer from 'multer';
import { db, initDatabase, IS_SERVERLESS } from './db.ts';
import {
  executeMultiAgentWorkflow,
  assistPostContent,
  getProviderConfigs,
  testProviderConnection,
  chatWithRealModel,
  generateFlowStoryboardWithLlm,
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
  createAdminToken,
  verifyAdminToken,
  extractBearerToken,
  isRequestAdmin,
  requireAdminAuth,
  updateAdminCredentials,
} from './auth.ts';
import {
  isCloudSyncEnabled,
  syncDatabaseBeforeRequest,
  persistDatabaseToCloud,
  uploadMediaToCloudBlob,
} from './cloudSync.ts';

initDatabase();

const app = express();
app.use(express.json({ limit: '50mb' }));

const UPLOADS_DIR = UPLOADS_ROOT;
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}
app.use('/uploads', express.static(UPLOADS_DIR));

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    service: 'komkid-by-komkrit-aiflow',
    runtime: IS_SERVERLESS ? 'vercel-serverless' : 'node-server',
    cloudStorage: isCloudSyncEnabled() ? 'vercel-blob-encrypted-sqlite' : 'local-sqlite-disk',
    node: process.version,
    timestamp: new Date().toISOString(),
  });
});

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
            .catch((err) => console.error('Cloud DB persist error:', err))
            .finally(() => origJson(body));
          return res;
        }
        return origJson(body);
      }) as any;
    }
    next();
  } catch (err) {
    console.error('Cloud DB sync error:', err);
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
  if (m === 'POST' && /^\/posts\/\d+\/comments$/.test(p)) return next();
  if (m === 'GET' && p === '/pillars') return next();
  if (m === 'POST' && (p === '/subscribers' || p === '/contacts' || p === '/surveys')) {
    return next();
  }

  // Every other /api/* route requires valid Admin Authentication
  return requireAdminAuth(req, res, next);
});

// --- Admin Authentication Endpoints ---
app.post('/api/auth/login', (req, res) => {
  const { username = '', password = '' } = req.body || {};
  if (!verifyCredentials(String(username), String(password))) {
    res.status(401).json({ error: 'ชื่อผู้ใช้งานหรือรหัสผ่านไม่ถูกต้อง' });
    return;
  }
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

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOADS_DIR),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname || '.jpg') || '.jpg';
    cb(null, `komkrit-${Date.now()}-${Math.round(Math.random() * 1e5)}${ext}`);
  },
});
const upload = multer({ storage, limits: { fileSize: 100 * 1024 * 1024 } });

function maskSecret(val?: string): string {
  const s = (val || '').trim();
  if (!s) return '';
  if (s.length <= 10) return '••••••••';
  return `${s.slice(0, 6)}••••••••${s.slice(-4)}`;
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
  } = req.body;

  if (!title || !String(title).trim()) {
    res.status(400).json({ error: 'กรุณาระบุหัวข้อบทความ/โพสต์' });
    return;
  }

  if (isFeatured) {
    db.prepare('UPDATE posts SET is_featured = 0').run();
  }

  const now = new Date().toISOString();
  const autoExcerpt =
    excerpt && String(excerpt).trim()
      ? String(excerpt).trim()
      : String(content).replace(/[#>*_`]/g, '').slice(0, 180);

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

  const created = db
    .prepare(`SELECT p.*, 0 AS comments_count FROM posts p WHERE p.id = ?`)
    .get(Number(result.lastInsertRowid));
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
  } = req.body;

  const nextFeatured =
    typeof isFeatured === 'boolean' ? (isFeatured ? 1 : 0) : existing.is_featured;

  if (nextFeatured === 1 && existing.is_featured === 0) {
    db.prepare('UPDATE posts SET is_featured = 0').run();
  }

  const tagsJson = Array.isArray(tags) ? JSON.stringify(tags) : existing.tags_json;
  const now = new Date().toISOString();

  db.prepare(
    `UPDATE posts SET
      title = ?, subtitle = ?, excerpt = ?, content = ?, category = ?,
      content_type = ?, cover_image = ?, video_url = ?, audio_url = ?, tags_json = ?,
      author = ?, status = ?, is_featured = ?, updated_at = ?
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
    now,
    id
  );

  const updated = db
    .prepare(
      `SELECT p.*, (SELECT COUNT(*) FROM comments c WHERE c.post_id = p.id) AS comments_count
       FROM posts p WHERE p.id = ?`
    )
    .get(id);
  res.json(mapPostRow(updated));
});

app.delete('/api/posts/:id', (req, res) => {
  const id = Number(req.params.id);
  db.prepare('DELETE FROM comments WHERE post_id = ?').run(id);
  db.prepare('DELETE FROM posts WHERE id = ?').run(id);
  res.json({ ok: true });
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

app.post('/api/posts/:id/comments', (req, res) => {
  const postId = Number(req.params.id);
  const {
    authorName = 'ผู้ติดตามคมคิด',
    authorRole = 'ผู้สนใจทั่วไป',
    message = '',
    rating = 5,
  } = req.body;
  if (!String(message).trim()) {
    res.status(400).json({ error: 'กรุณาพิมพ์ความคิดเห็น' });
    return;
  }
  const now = new Date().toISOString();
  const r = db
    .prepare(
      `INSERT INTO comments (post_id, author_name, author_role, message, rating, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(
      postId,
      String(authorName).trim() || 'ผู้ติดตามคมคิด',
      String(authorRole),
      String(message).trim(),
      Math.min(5, Math.max(1, Number(rating) || 5)),
      now
    );

  res.status(201).json({
    id: Number(r.lastInsertRowid),
    postId,
    authorName: String(authorName).trim() || 'ผู้ติดตามคมคิด',
    authorRole,
    message: String(message).trim(),
    rating: Number(rating) || 5,
    createdAt: now,
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

app.put('/api/pillars/:id', (req, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare('SELECT * FROM business_pillars WHERE id = ?').get(id) as any;
  if (!existing) {
    res.status(404).json({ error: 'ไม่พบข้อมูลเสาหลักธุรกิจ' });
    return;
  }
  const {
    title = existing.title,
    subtitle = existing.subtitle,
    description = existing.description,
    metricLabel = existing.metric_label,
    metricValue = existing.metric_value,
    statusBadge = existing.status_badge,
  } = req.body;
  db.prepare(
    `UPDATE business_pillars SET title = ?, subtitle = ?, description = ?, metric_label = ?, metric_value = ?, status_badge = ? WHERE id = ?`
  ).run(title, subtitle, description, metricLabel, metricValue, statusBadge, id);
  res.json({ ok: true });
});

// ============================================================================
// REAL MULTI-LLM INTERACTIVE CHAT (GEMINI / CLAUDE / DEEPSEEK / CHATGPT)
// ============================================================================
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
      provider = 'gemini',
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
      createdAt: a.created_at,
    }))
  );
});

app.delete('/api/ai/media/:id', (req, res) => {
  db.prepare('DELETE FROM ai_media_assets WHERE id = ?').run(Number(req.params.id));
  res.json({ ok: true });
});

app.post('/api/ai/image/generate', async (req, res) => {
  try {
    const { prompt, provider, model, aspectRatio, imageSize, workflowId } = req.body;
    const asset = await generateRealImage({
      prompt: String(prompt || ''),
      provider,
      model,
      aspectRatio,
      imageSize,
      workflowId: workflowId ? Number(workflowId) : null,
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
    const { text, provider, voice, style, workflowId } = req.body;
    const asset = await generateRealAudio({
      text: String(text || ''),
      provider,
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
      videoEngine = 'gemini-omni-1.1-flash',
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
      model: imageModel || 'gemini-nano-banana-2.1',
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

    const now = new Date().toISOString();
    const initialApproval = {
      isAccurate: true,
      isAppropriate: true,
      isOnBrand: true,
      isReady: false,
      reviewerNote: '',
      publishedPostId: null,
    };

    const insertRes = db
      .prepare(
        `INSERT INTO ai_workflows (
          topic, input_source, category, target_audience, business_pillar,
          flow_mode, engine_used, status,
          ceo_json, research_json, script_json, design_json, visual_json,
          video_json, audio_json, qa_json, analytics_json, omnichannel_json, approval_json,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending_approval', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        String(topic).trim(),
        String(inputSource),
        String(category),
        String(targetAudience),
        String(businessPillar),
        flowMode === 'core_3agent' ? 'core_3agent' : 'full_8agent',
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
        JSON.stringify(initialApproval),
        now,
        now
      );

    const created = db
      .prepare('SELECT * FROM ai_workflows WHERE id = ?')
      .get(Number(insertRes.lastInsertRowid));
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
    const finalVideoUrl = wf.videoOutput?.generatedVideoUrl || '';
    const finalAudioUrl = wf.audioOutput?.generatedAudioUrl || '';

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

app.post('/api/subscribers', (req, res) => {
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

app.post('/api/contacts', (req, res) => {
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

app.put('/api/contacts/:id/read', (req, res) => {
  db.prepare("UPDATE contacts SET status = 'read' WHERE id = ?").run(Number(req.params.id));
  res.json({ ok: true });
});

app.delete('/api/contacts/:id', (req, res) => {
  db.prepare('DELETE FROM contacts WHERE id = ?').run(Number(req.params.id));
  res.json({ ok: true });
});

// ============================================================================
// AI ENGINE VAULT & MULTI-PROVIDER SETTINGS (GEMINI, CLAUDE, DEEPSEEK, CHATGPT, VEO)
// ============================================================================
app.get('/api/settings/ai', (_req, res) => {
  const cfg = getProviderConfigs();
  res.json({
    provider: cfg.defaultProvider,
    // Google Gemini + Nano Banana + Omni Video + TTS
    geminiModel: cfg.gemini.model,
    geminiImageModel: cfg.gemini.imageModel,
    geminiVideoModel: cfg.gemini.videoModel,
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
  const b = req.body || {};
  const set = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');
  const saveStr = (settingKey: string, val: unknown) => {
    if (typeof val === 'string') {
      set.run(settingKey, val.trim());
    }
  };
  const saveSecret = (settingKey: string, val: unknown) => {
    if (typeof val === 'string' && val !== '__KEEP__') {
      set.run(settingKey, val.trim());
    }
  };

  saveStr('ai_provider', b.provider);
  saveStr('gemini_model', b.geminiModel);
  saveStr('gemini_image_model', b.geminiImageModel);
  saveStr('gemini_video_model', b.geminiVideoModel);
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
  saveStr('elevenlabs_voice_id', b.elevenlabsVoiceId);

  saveSecret('resend_api_key', b.resendApiKey);
  saveStr('resend_from_email', b.resendFromEmail);

  saveStr('local_endpoint', b.localEndpoint);
  saveStr('local_model', b.localModel);
  saveSecret('local_api_key', b.localApiKey);

  res.json({ ok: true });
});

app.post('/api/settings/test-provider', async (req, res) => {
  try {
    const { provider, model, apiKey } = req.body;
    const result = await testProviderConnection({
      provider,
      model,
      apiKey,
    });
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

// ============================================================================
// OMNICHANNEL PUBLISH & DISTRIBUTE (8 CHANNELS — 100% REAL API / WEBHOOK / DB)
// ============================================================================
app.get('/api/channels', (_req, res) => {
  const resendGlobalKey = getProviderConfigs().resend.apiKey;
  const rows = db
    .prepare('SELECT * FROM channel_configs ORDER BY id ASC')
    .all()
    .map((c: any) => {
      const tok =
        String(c.access_token || '').trim() ||
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

  const nextToken =
    typeof accessToken === 'string' && accessToken !== '__KEEP__'
      ? accessToken.trim()
      : existing.access_token;

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

app.get('/api/publish/logs', (_req, res) => {
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

app.delete('/api/publish/logs/:id', (req, res) => {
  db.prepare('DELETE FROM publish_logs WHERE id = ?').run(Number(req.params.id));
  res.json({ ok: true });
});

// Background Real Scheduler Worker: Executes due scheduled posts automatically
setInterval(async () => {
  try {
    const nowIso = new Date().toISOString().slice(0, 16); // matches datetime-local YYYY-MM-DDTHH:mm
    const dueRows = db
      .prepare(
        "SELECT * FROM publish_logs WHERE status = 'scheduled' AND scheduled_at IS NOT NULL AND scheduled_at <= ?"
      )
      .all(nowIso) as any[];

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
  } catch {
    // ignore scheduler tick error
  }
}, 30_000);

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

app.post('/api/surveys', (req, res) => {
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

app.delete('/api/surveys/:id', (req, res) => {
  db.prepare('DELETE FROM audience_surveys WHERE id = ?').run(Number(req.params.id));
  res.json({ ok: true });
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
      `\n🚀 คมคิด by KOMKRIT WebApp & Real Multi-LLM + Google Veo/Flow Studio running at http://0.0.0.0:${port}\n`
    );
  });
}

if (!IS_SERVERLESS) {
  startServer();
}

export { app };
export default app;
