import { DatabaseSync } from 'node:sqlite';
import { ensureSlugSchema, backfillPostSlugs } from './slug.ts';
import path from 'node:path';
import fs from 'node:fs';
import {
  SECRET_SETTING_KEYS,
  encryptSecretValue,
  isEncryptedSecret,
} from './secretVault.ts';

// Automatically load .env if present (Node 22 native loadEnvFile)
const ENV_PATH = path.resolve(process.cwd(), '.env');
if (fs.existsSync(ENV_PATH) && typeof process.loadEnvFile === 'function') {
  try {
    process.loadEnvFile(ENV_PATH);
  } catch {
    // ignore malformed .env
  }
}

export const IS_SERVERLESS = Boolean(
  process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME
);

export const DATA_DIR = IS_SERVERLESS
  ? '/tmp/komkrit-data'
  : process.env.DATA_DIR || path.resolve(process.cwd(), 'data');
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

export const DB_PATH = path.join(DATA_DIR, 'komkrit.db');
export let db = new DatabaseSync(DB_PATH);

function applyPragmas(database: DatabaseSync) {
  // Safe journal mode for external/exFAT volumes as well as Serverless /tmp
  database.exec(`
    PRAGMA journal_mode = ${IS_SERVERLESS ? 'DELETE' : 'MEMORY'};
    PRAGMA synchronous = NORMAL;
    PRAGMA foreign_keys = ON;
  `);
}

applyPragmas(db);

export function exportDatabaseSnapshotBuffer(): Buffer {
  const snapPath = path.join(DATA_DIR, `snap-${Date.now()}-${Math.round(Math.random() * 1e5)}.db`);
  try {
    if (fs.existsSync(snapPath)) fs.unlinkSync(snapPath);
    const escaped = snapPath.replace(/'/g, "''");
    db.exec(`VACUUM INTO '${escaped}'`);
    return fs.readFileSync(snapPath);
  } finally {
    try {
      if (fs.existsSync(snapPath)) fs.unlinkSync(snapPath);
    } catch {
      // ignore
    }
  }
}

export function reloadDatabaseFromSnapshotBuffer(sqliteBytes: Buffer): void {
  try {
    db.close();
  } catch {
    // ignore
  }
  fs.writeFileSync(DB_PATH, sqliteBytes);
  db = new DatabaseSync(DB_PATH);
  applyPragmas(db);
  initDatabase();
}

export function initDatabase() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS posts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      subtitle TEXT DEFAULT '',
      excerpt TEXT NOT NULL,
      content TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT 'education',
      content_type TEXT NOT NULL DEFAULT 'article',
      cover_image TEXT NOT NULL DEFAULT '/images/thumb-ai-edu.jpg',
      video_url TEXT DEFAULT '',
      tags_json TEXT NOT NULL DEFAULT '[]',
      author TEXT NOT NULL DEFAULT 'คมกฤช (Komkrit)',
      status TEXT NOT NULL DEFAULT 'published',
      is_featured INTEGER NOT NULL DEFAULT 0,
      views INTEGER NOT NULL DEFAULT 0,
      ai_workflow_id INTEGER DEFAULT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS comments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      post_id INTEGER NOT NULL,
      author_name TEXT NOT NULL,
      author_role TEXT NOT NULL DEFAULT 'ผู้สนใจทั่วไป',
      message TEXT NOT NULL,
      rating INTEGER NOT NULL DEFAULT 5,
      created_at TEXT NOT NULL,
      FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS knowledge_base (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      category TEXT NOT NULL,
      summary TEXT NOT NULL,
      content TEXT NOT NULL,
      source_ref TEXT DEFAULT '',
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS business_pillars (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      pillar_index INTEGER NOT NULL,
      pillar_key TEXT NOT NULL,
      title TEXT NOT NULL,
      subtitle TEXT NOT NULL,
      description TEXT NOT NULL,
      metric_label TEXT NOT NULL,
      metric_value TEXT NOT NULL,
      status_badge TEXT DEFAULT '',
      action_url TEXT DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS ai_workflows (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      topic TEXT NOT NULL,
      input_source TEXT NOT NULL,
      category TEXT NOT NULL,
      target_audience TEXT NOT NULL,
      business_pillar TEXT NOT NULL,
      flow_mode TEXT NOT NULL DEFAULT 'full_8agent',
      engine_used TEXT NOT NULL DEFAULT 'Komkrit Multi-Agent Engine',
      status TEXT NOT NULL DEFAULT 'pending_approval',
      ceo_json TEXT NOT NULL DEFAULT '{}',
      research_json TEXT NOT NULL DEFAULT '{}',
      script_json TEXT NOT NULL DEFAULT '{}',
      design_json TEXT NOT NULL DEFAULT '{}',
      visual_json TEXT NOT NULL DEFAULT '{}',
      video_json TEXT NOT NULL DEFAULT '{}',
      audio_json TEXT NOT NULL DEFAULT '{}',
      qa_json TEXT NOT NULL DEFAULT '{}',
      analytics_json TEXT NOT NULL DEFAULT '{}',
      omnichannel_json TEXT NOT NULL DEFAULT '{}',
      approval_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS subscribers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL UNIQUE,
      name TEXT DEFAULT '',
      role TEXT DEFAULT 'ผู้สนใจทั่วไป',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS contacts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      subject TEXT NOT NULL,
      message TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'unread',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS channel_configs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      channel_key TEXT NOT NULL UNIQUE,
      channel_name TEXT NOT NULL,
      handle_or_url TEXT DEFAULT '',
      enabled INTEGER NOT NULL DEFAULT 1,
      auto_publish INTEGER NOT NULL DEFAULT 1,
      access_token TEXT DEFAULT '',
      target_id TEXT DEFAULT '',
      webhook_url TEXT DEFAULT '',
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS publish_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      workflow_id INTEGER DEFAULT NULL,
      post_id INTEGER DEFAULT NULL,
      channel_key TEXT NOT NULL,
      channel_name TEXT NOT NULL,
      title TEXT NOT NULL,
      content_preview TEXT NOT NULL,
      mode TEXT NOT NULL DEFAULT 'live_api',
      status TEXT NOT NULL DEFAULT 'published',
      scheduled_at TEXT DEFAULT NULL,
      external_url TEXT DEFAULT '',
      response_note TEXT DEFAULT '',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS audience_surveys (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      respondent_name TEXT NOT NULL,
      respondent_role TEXT NOT NULL,
      school_or_org TEXT DEFAULT '',
      preferred_channel TEXT DEFAULT 'Website / Blog',
      requested_topic TEXT NOT NULL,
      satisfaction_score INTEGER NOT NULL DEFAULT 5,
      feedback_detail TEXT DEFAULT '',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS ai_chat_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      provider TEXT NOT NULL,
      model TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      reasoning TEXT DEFAULT '',
      latency_ms INTEGER DEFAULT 0,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS ai_media_assets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      media_type TEXT NOT NULL,
      provider TEXT NOT NULL,
      model TEXT NOT NULL,
      prompt TEXT NOT NULL,
      file_url TEXT NOT NULL,
      mime_type TEXT NOT NULL DEFAULT '',
      aspect_ratio TEXT DEFAULT '',
      duration_sec INTEGER DEFAULT 0,
      resolution TEXT DEFAULT '',
      interaction_id TEXT DEFAULT '',
      workflow_id INTEGER DEFAULT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS flow_projects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      concept TEXT NOT NULL,
      aspect_ratio TEXT NOT NULL DEFAULT '16:9',
      resolution TEXT NOT NULL DEFAULT '720p',
      video_engine TEXT NOT NULL DEFAULT '',
      scenes_json TEXT NOT NULL DEFAULT '[]',
      master_video_url TEXT DEFAULT '',
      voiceover_audio_url TEXT DEFAULT '',
      status TEXT NOT NULL DEFAULT 'draft',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS site_config (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      config_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS special_projects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      badge_label TEXT NOT NULL DEFAULT 'โครงการพิเศษ',
      title TEXT NOT NULL,
      subtitle TEXT DEFAULT '',
      description TEXT NOT NULL DEFAULT '',
      highlights_json TEXT NOT NULL DEFAULT '[]',
      tags_json TEXT NOT NULL DEFAULT '[]',
      cta_label TEXT NOT NULL DEFAULT 'ดูรายละเอียด',
      cta_url TEXT DEFAULT '',
      status TEXT NOT NULL DEFAULT 'active',
      sort_order INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS ai_call_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at TEXT NOT NULL,
      provider TEXT NOT NULL,
      model TEXT DEFAULT '',
      tier TEXT DEFAULT 'standard',
      ok INTEGER NOT NULL DEFAULT 0,
      latency_ms INTEGER DEFAULT 0,
      error TEXT DEFAULT '',
      error_kind TEXT DEFAULT '',
      failed_over_from TEXT DEFAULT '',
      batch_id INTEGER,
      input_tokens INTEGER DEFAULT 0,
      output_tokens INTEGER DEFAULT 0,
      cached_tokens INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS ai_cache (
      cache_key TEXT PRIMARY KEY,
      response_text TEXT NOT NULL,
      provider TEXT DEFAULT '',
      model TEXT DEFAULT '',
      hits INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      last_hit_at TEXT
    );

    CREATE TABLE IF NOT EXISTS ai_batches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'queued',
      mode TEXT NOT NULL DEFAULT 'economy',
      options_json TEXT NOT NULL DEFAULT '{}',
      kb_json TEXT NOT NULL DEFAULT '[]',
      total INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      finished_at TEXT
    );

    CREATE TABLE IF NOT EXISTS ai_batch_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      batch_id INTEGER NOT NULL,
      idx INTEGER NOT NULL DEFAULT 0,
      topic TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      attempts INTEGER NOT NULL DEFAULT 0,
      workflow_id INTEGER,
      error TEXT DEFAULT '',
      provider TEXT DEFAULT '',
      model TEXT DEFAULT '',
      tier TEXT DEFAULT '',
      cache_hit INTEGER NOT NULL DEFAULT 0,
      failed_over INTEGER NOT NULL DEFAULT 0,
      input_tokens INTEGER DEFAULT 0,
      output_tokens INTEGER DEFAULT 0,
      cached_tokens INTEGER DEFAULT 0,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_ai_call_log_created ON ai_call_log(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_ai_batch_items_batch ON ai_batch_items(batch_id, status, idx);

    CREATE TABLE IF NOT EXISTS content_projects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL DEFAULT '',
      brief TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'drafting',
      post_id INTEGER,
      workflow_id INTEGER,
      draft_json TEXT NOT NULL DEFAULT '{}',
      media_json TEXT NOT NULL DEFAULT '{}',
      research_json TEXT NOT NULL DEFAULT '{}',
      qa_json TEXT NOT NULL DEFAULT '{}',
      channels_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS project_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      role TEXT NOT NULL,
      agent TEXT NOT NULL DEFAULT '',
      kind TEXT NOT NULL DEFAULT 'message',
      content TEXT NOT NULL DEFAULT '',
      data_json TEXT NOT NULL DEFAULT '{}'
    );

    CREATE INDEX IF NOT EXISTS idx_project_events_project ON project_events(project_id, id);

    CREATE INDEX IF NOT EXISTS idx_posts_status_created ON posts(status, is_featured DESC, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_posts_category ON posts(category, content_type);
    CREATE INDEX IF NOT EXISTS idx_comments_post_id ON comments(post_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_knowledge_category ON knowledge_base(category, is_active);
    CREATE INDEX IF NOT EXISTS idx_contacts_status ON contacts(status, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_publish_logs_status ON publish_logs(status, scheduled_at);
  `);

  // Safe schema migration: add audio_url to posts if missing
  try {
    const cols = db.prepare("PRAGMA table_info('posts')").all() as { name: string }[];
    if (!cols.some((c) => c.name === 'audio_url')) {
      db.exec("ALTER TABLE posts ADD COLUMN audio_url TEXT DEFAULT ''");
    }
  } catch {
    // ignore
  }

  // Safe schema migration: add review_status & thai_summary to ai_media_assets if missing
  try {
    const mCols = db.prepare("PRAGMA table_info('ai_media_assets')").all() as { name: string }[];
    if (!mCols.some((c) => c.name === 'review_status')) {
      db.exec("ALTER TABLE ai_media_assets ADD COLUMN review_status TEXT DEFAULT 'approved'");
    }
    if (!mCols.some((c) => c.name === 'thai_summary')) {
      db.exec("ALTER TABLE ai_media_assets ADD COLUMN thai_summary TEXT DEFAULT ''");
    }
  } catch {
    // ignore
  }

  // Strictly purge any legacy simulated / sandbox_ready logs
  db.exec("DELETE FROM publish_logs WHERE mode = 'sandbox_ready' OR response_note LIKE '%จำลอง%'");

  // One-time migration to switch legacy hardcoded model defaults to dynamic API Auto-Latest ('')
  try {
    const migrated = db
      .prepare("SELECT value FROM settings WHERE key = 'dynamic_model_discovery_v1'")
      .get() as { value: string } | undefined;
    if (!migrated) {
      db.exec(`
        UPDATE settings SET value = ''
        WHERE key IN (
          'gemini_model', 'gemini_image_model', 'gemini_video_model',
          'claude_model', 'deepseek_model', 'openai_model',
          'vertex_veo_model', 'local_model'
        );
        INSERT OR REPLACE INTO settings (key, value) VALUES ('dynamic_model_discovery_v1', '1');
      `);
    }
  } catch {
    // ignore if settings table is freshly created
  }

  seedIfEmpty();
  seedOmnichannelIfEmpty();
  seedSiteContentIfEmpty();
  try {
    const cols = db.prepare("PRAGMA table_info('channel_configs')").all() as { name: string }[];
    const add = (name: string, ddl: string) => {
      if (!cols.some((c) => c.name === name)) db.exec(`ALTER TABLE channel_configs ADD COLUMN ${ddl}`);
    };
    add('refresh_token', "refresh_token TEXT DEFAULT ''");
    add('token_expires_at', "token_expires_at TEXT DEFAULT ''");
    add('account_name', "account_name TEXT DEFAULT ''");
    add('connection_mode', "connection_mode TEXT DEFAULT ''");
    add('last_verified_at', "last_verified_at TEXT DEFAULT ''");
  } catch {
    /* table not ready yet */
  }
  try {
    const cols = db.prepare("PRAGMA table_info('content_projects')").all() as { name: string }[];
    if (!cols.some((c) => c.name === 'extra_json')) {
      db.exec("ALTER TABLE content_projects ADD COLUMN extra_json TEXT NOT NULL DEFAULT '{}'");
    }
  } catch {
    /* table not ready yet */
  }
  db.exec(`CREATE TABLE IF NOT EXISTS ai_learnings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER,
    created_at TEXT NOT NULL,
    summary TEXT NOT NULL,
    actions_json TEXT NOT NULL DEFAULT '[]'
  )`);
  db.exec(`CREATE TABLE IF NOT EXISTS oauth_pending (
    nonce TEXT PRIMARY KEY,
    channel_key TEXT NOT NULL,
    payload_enc TEXT NOT NULL,
    expires_at TEXT NOT NULL
  )`);
  ensureSlugSchema(db);
  backfillPostSlugs(db);
  upgradePlaintextSecretsToAes256Gcm();
}

export const DEFAULT_SITE_CONFIG = {
  brandTitle: 'คมคิด',
  brandSub: 'by KOMKRIT',
  slogan: 'คิดต่างอย่างสร้างสรรค์',
  heroSubtitle: 'บทความ • ความรู้ • ไอเดีย • เพื่อการพัฒนาคนและสังคม',
  heroQuote: 'การศึกษา คือรากฐานของการพัฒนาคน และการสร้างอนาคตที่ดีกว่า',
  heroSignature: 'Komkrit',
  heroImageUrl: '/images/hero-komkrit.jpg',
  authorName: 'คมกฤช (Komkrit)',
  authorRole: 'ผู้ก่อตั้ง คมคิด by KOMKRIT',
  authorBio: 'คิดต่างอย่างสร้างสรรค์ เพื่อการพัฒนาคน สังคม และอนาคตที่ดีกว่า',
  authorQuote: 'ทุกความคิดที่แตกต่าง คือจุดเริ่มต้นของการเปลี่ยนแปลง และการสร้างสิ่งที่ดีกว่า',
  authorImageUrl: '/images/author-komkrit.jpg',
  aboutVision: 'การศึกษาที่ดี สร้างคนที่ดี สร้างสังคมที่ดีได้',
  aboutStory:
    'คมคิด by KOMKRIT คือพื้นที่แห่งความคิด ความรู้ และนวัตกรรมที่มุ่งเชื่อมโยงโลกของการศึกษา เทคโนโลยี AI การพัฒนาอาชีพ และความร่วมมือระดับนานาชาติเข้าด้วยกัน เพื่อสร้างโอกาสที่จับต้องได้จริงให้กับผู้เรียน ครู โรงเรียน และสังคมไทย',
  featuredVideoUrl: 'https://www.youtube.com/watch?v=VxQwQ9vQkkc',
  featuredVideoTitle: 'คิดต่างอย่างสร้างสรรค์: มุมมองใหม่ด้านการศึกษา เทคโนโลยี และการพัฒนาสังคมไทย',
  featuredVideoDesc:
    'เจาะลึกแนวคิดการนำเทคโนโลยีและ AI มาช่วยยกระดับการเรียนรู้ของครู นักเรียน และผู้เรียนทุกช่วงวัย เพื่อสร้างโอกาสทางการศึกษาที่เข้าถึงได้จริง',
  contactEmail: 'contact@komkid.in.th',
  contactLocation: 'จังหวัดภูเก็ต ประเทศไทย',
  socialX: '',
  socialYoutube: 'https://www.youtube.com/watch?v=VxQwQ9vQkkc',
  socialFacebook: '',
  socialInstagram: '',
  socialLineOa: '',
  primaryDomain: 'komkid.in.th',
  domains: [
    'komkid.in.th',
    'www.komkid.in.th',
    'api.komkid.in.th',
    'aiflow-wheat.vercel.app',
  ],
  seoTitle: 'คมคิด by KOMKRIT — คิดต่างอย่างสร้างสรรค์ เพื่อการศึกษาและสังคม',
  seoDescription:
    'แพลตฟอร์มบทความ ความรู้ นวัตกรรมการศึกษา AI และหลักสูตรพัฒนาทักษะแห่งอนาคต โดย คมกฤช (Komkrit)',
};

function seedSiteContentIfEmpty() {
  const now = new Date().toISOString();
  const cfgRow = db.prepare('SELECT id FROM site_config WHERE id = 1').get();
  if (!cfgRow) {
    db.prepare('INSERT INTO site_config (id, config_json, updated_at) VALUES (1, ?, ?)').run(
      JSON.stringify(DEFAULT_SITE_CONFIG),
      now
    );
  }

  const projCount = (
    db.prepare('SELECT COUNT(*) AS c FROM special_projects').get() as { c: number }
  ).c;
  if (projCount === 0) {
    db.prepare(
      `INSERT INTO special_projects (
        badge_label, title, subtitle, description, highlights_json, tags_json,
        cta_label, cta_url, status, sort_order, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', 1, ?, ?)`
    ).run(
      'โครงการพิเศษ',
      'โรงเรียนภาษาและอาชีพ ไทย-เมียนมา',
      'Thai-Myanmar Language and Vocational School',
      'โครงการความร่วมมือด้านการพัฒนาทักษะภาษาและวิชาชีพ เพื่อยกระดับมาตรฐานกำลังคนอาเซียน เชื่อมโยงโอกาสการเรียนรู้และการทำงานอย่างยั่งยืนระหว่างไทยและเมียนมา',
      JSON.stringify([
        'หลักสูตรภาษาไทย-อังกฤษ-เมียนมา เพื่อการทำงานและบริการมาตรฐานสากล',
        'หลักสูตรวิชาชีพเฉพาะทางที่เชื่อมโยงกับสถานประกอบการจริง',
        'เครือข่ายความร่วมมือโรงเรียนและภาคเอกชนไทย-เมียนมา',
      ]),
      JSON.stringify(['หลักสูตรภาษาและอาชีพ', 'ความร่วมมือไทย-เมียนมา']),
      'ดูรายละเอียด',
      '',
      now,
      now
    );
  }
}

function upgradePlaintextSecretsToAes256Gcm() {
  try {
    const rows = db.prepare('SELECT key, value FROM settings').all() as {
      key: string;
      value: string;
    }[];
    const upd = db.prepare('UPDATE settings SET value = ? WHERE key = ?');
    for (const r of rows) {
      if (SECRET_SETTING_KEYS.has(r.key) && r.value && r.value.trim() && !isEncryptedSecret(r.value)) {
        upd.run(encryptSecretValue(r.value, r.key), r.key);
      }
    }
    const chRows = db
      .prepare("SELECT id, channel_key, access_token FROM channel_configs WHERE access_token != ''")
      .all() as { id: number; channel_key: string; access_token: string }[];
    const updCh = db.prepare('UPDATE channel_configs SET access_token = ? WHERE id = ?');
    for (const ch of chRows) {
      if (ch.access_token && ch.access_token.trim() && !isEncryptedSecret(ch.access_token)) {
        updCh.run(
          encryptSecretValue(ch.access_token, `channel:${ch.channel_key}`),
          ch.id
        );
      }
    }
  } catch {
    // ignore migration errors on initial creation
  }
}

function seedOmnichannelIfEmpty() {
  const chCount = (db.prepare('SELECT COUNT(*) as c FROM channel_configs').get() as any).c;
  if (chCount === 0) {
    const now = new Date().toISOString();
    const ins = db.prepare(`
      INSERT INTO channel_configs (
        channel_key, channel_name, handle_or_url, enabled, auto_publish,
        access_token, target_id, webhook_url, updated_at
      ) VALUES (?, ?, '', 1, 0, '', '', '', ?)
    `);
    for (const [key, name] of [
      ['youtube', 'YouTube'],
      ['facebook', 'Facebook'],
      ['tiktok', 'TikTok'],
      ['line_oa', 'LINE OA'],
      ['x_twitter', 'X (Twitter)'],
      ['instagram', 'Instagram'],
      ['website_blog', 'Website / Blog'],
      ['email_newsletter', 'Email / Newsletter'],
    ]) {
      ins.run(key, name, now);
    }
  }
}

function seedIfEmpty() {
  const seededFlag = db
    .prepare("SELECT value FROM settings WHERE key = 'initial_seed_done'")
    .get() as { value: string } | undefined;
  if (seededFlag?.value === '1') return;

  const countRow = db.prepare('SELECT COUNT(*) as cnt FROM posts').get() as { cnt: number };
  if (countRow && countRow.cnt > 0) {
    db.prepare(
      "INSERT OR REPLACE INTO settings (key, value) VALUES ('initial_seed_done', '1')"
    ).run();
    return;
  }

  db.prepare(
    "INSERT OR REPLACE INTO settings (key, value) VALUES ('initial_seed_done', '1')"
  ).run();

  // No demo content: a new site starts empty. Articles, people and statistics must be real.
  const setSetting = db.prepare(`INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)`);
  setSetting.run('ai_provider', 'auto');
  setSetting.run('gemini_model', '');
  setSetting.run('gemini_api_key', process.env.GEMINI_API_KEY || '');
  setSetting.run('local_endpoint', 'http://localhost:1234/v1');
  setSetting.run('local_model', '');
  setSetting.run('dynamic_model_discovery_v1', '1');
}
