// server/index.ts
import express from "express";
import path4 from "node:path";
import fs4 from "node:fs";
import multer from "multer";

// server/db.ts
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import fs from "node:fs";

// server/secretVault.ts
import crypto from "node:crypto";
import zlib from "node:zlib";
var ENC_PREFIX = "enc:v1:";
var SEALED_VAULT_PREFIX = "kvault1.";
var SECRET_SETTING_KEYS = /* @__PURE__ */ new Set([
  "gemini_api_key",
  "claude_api_key",
  "deepseek_api_key",
  "openai_api_key",
  "vertex_access_token",
  "elevenlabs_api_key",
  "resend_api_key",
  "local_api_key"
]);
function getMasterSeedMaterial() {
  const parts = [
    process.env.VAULT_MASTER_KEY || "",
    process.env.BLOB_READ_WRITE_TOKEN || "",
    process.env.ADMIN_AUTH_SECRET || "",
    "komkid-by-komkrit-aes256gcm-vault-v1"
  ];
  return parts.join("|");
}
function deriveSubkey(purpose) {
  const ikm = Buffer.from(getMasterSeedMaterial(), "utf8");
  const salt = Buffer.from("komkid-by-komkrit-hkdf-salt-2026", "utf8");
  const info = Buffer.from(`komkid:${purpose}`, "utf8");
  return Buffer.from(crypto.hkdfSync("sha256", ikm, salt, info, 32));
}
function isEncryptedSecret(val) {
  return typeof val === "string" && val.startsWith(ENC_PREFIX);
}
function encryptSecretValue(plain, fieldName) {
  const clean = (plain || "").trim();
  if (!clean) return "";
  if (isEncryptedSecret(clean)) return clean;
  const key = deriveSubkey("field-encryption-v1");
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(`field:${fieldName}`, "utf8"));
  const encrypted = Buffer.concat([cipher.update(clean, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${ENC_PREFIX}${iv.toString("base64url")}:${tag.toString("base64url")}:${encrypted.toString("base64url")}`;
}
function decryptSecretValue(stored, fieldName) {
  const raw = (stored || "").trim();
  if (!raw) return "";
  if (!raw.startsWith(ENC_PREFIX)) {
    return raw;
  }
  const body = raw.slice(ENC_PREFIX.length);
  const parts = body.split(":");
  if (parts.length !== 3) return "";
  try {
    const iv = Buffer.from(parts[0], "base64url");
    const tag = Buffer.from(parts[1], "base64url");
    const ciphertext = Buffer.from(parts[2], "base64url");
    const key = deriveSubkey("field-encryption-v1");
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAAD(Buffer.from(`field:${fieldName}`, "utf8"));
    decipher.setAuthTag(tag);
    const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return decrypted.toString("utf8");
  } catch {
    return "";
  }
}
function sealSettingsVaultToken(settingsRows, updatedAt = Date.now()) {
  const payload = JSON.stringify({
    v: 1,
    iat: updatedAt,
    updatedAt,
    rows: settingsRows
  });
  const compressed = zlib.gzipSync(Buffer.from(payload, "utf8"));
  const key = deriveSubkey("stateless-sealed-vault-v1");
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from("komkid-sealed-vault-v1", "utf8"));
  const encrypted = Buffer.concat([cipher.update(compressed), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${SEALED_VAULT_PREFIX}${iv.toString("base64url")}.${tag.toString("base64url")}.${encrypted.toString("base64url")}`;
}
function unsealSettingsVaultWithMeta(token) {
  const raw = (token || "").trim();
  if (!raw || !raw.startsWith(SEALED_VAULT_PREFIX)) return null;
  const parts = raw.slice(SEALED_VAULT_PREFIX.length).split(".");
  if (parts.length !== 3) return null;
  try {
    const iv = Buffer.from(parts[0], "base64url");
    const tag = Buffer.from(parts[1], "base64url");
    const ciphertext = Buffer.from(parts[2], "base64url");
    const key = deriveSubkey("stateless-sealed-vault-v1");
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAAD(Buffer.from("komkid-sealed-vault-v1", "utf8"));
    decipher.setAuthTag(tag);
    const compressed = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    const jsonStr = zlib.gunzipSync(compressed).toString("utf8");
    const parsed = JSON.parse(jsonStr);
    if (parsed && typeof parsed.rows === "object" && parsed.rows !== null) {
      const ts = Number(parsed.updatedAt || parsed.iat || 0);
      return {
        updatedAt: Number.isFinite(ts) ? ts : 0,
        rows: parsed.rows
      };
    }
    return null;
  } catch {
    return null;
  }
}
function maskSecretStrict(val) {
  const s = (val || "").trim();
  if (!s) return "";
  if (s.length <= 12) return "\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022";
  return `${s.slice(0, 4)}\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022${s.slice(-4)}`;
}
function redactSecrets(message, knownSecrets = []) {
  let out = String(message || "");
  for (const sec of knownSecrets) {
    const clean = (sec || "").trim();
    if (clean.length >= 8) {
      out = out.split(clean).join("[REDACTED_KEY]");
    }
  }
  out = out.replace(/\bsk-[A-Za-z0-9_-]{12,}\b/g, "sk-\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022[REDACTED]");
  out = out.replace(/\bAIza[A-Za-z0-9_-]{20,}\b/g, "AIza\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022[REDACTED]");
  out = out.replace(/\bre_[A-Za-z0-9_]{12,}\b/g, "re_\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022[REDACTED]");
  out = out.replace(/\bvercel_blob_rw_[A-Za-z0-9_]{10,}\b/g, "[REDACTED_BLOB_TOKEN]");
  return out;
}

// server/db.ts
var ENV_PATH = path.resolve(process.cwd(), ".env");
if (fs.existsSync(ENV_PATH) && typeof process.loadEnvFile === "function") {
  try {
    process.loadEnvFile(ENV_PATH);
  } catch {
  }
}
var IS_SERVERLESS = Boolean(
  process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME
);
var DATA_DIR = IS_SERVERLESS ? "/tmp/komkrit-data" : path.resolve(process.cwd(), "data");
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}
var DB_PATH = path.join(DATA_DIR, "komkrit.db");
var db = new DatabaseSync(DB_PATH);
function applyPragmas(database) {
  database.exec(`
    PRAGMA journal_mode = ${IS_SERVERLESS ? "DELETE" : "MEMORY"};
    PRAGMA synchronous = NORMAL;
    PRAGMA foreign_keys = ON;
  `);
}
applyPragmas(db);
function exportDatabaseSnapshotBuffer() {
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
    }
  }
}
function reloadDatabaseFromSnapshotBuffer(sqliteBytes) {
  try {
    db.close();
  } catch {
  }
  fs.writeFileSync(DB_PATH, sqliteBytes);
  db = new DatabaseSync(DB_PATH);
  applyPragmas(db);
  initDatabase();
}
function initDatabase() {
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
      author TEXT NOT NULL DEFAULT '\u0E04\u0E21\u0E01\u0E24\u0E0A (Komkrit)',
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
      author_role TEXT NOT NULL DEFAULT '\u0E1C\u0E39\u0E49\u0E2A\u0E19\u0E43\u0E08\u0E17\u0E31\u0E48\u0E27\u0E44\u0E1B',
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
      role TEXT DEFAULT '\u0E1C\u0E39\u0E49\u0E2A\u0E19\u0E43\u0E08\u0E17\u0E31\u0E48\u0E27\u0E44\u0E1B',
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

    CREATE INDEX IF NOT EXISTS idx_posts_status_created ON posts(status, is_featured DESC, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_posts_category ON posts(category, content_type);
    CREATE INDEX IF NOT EXISTS idx_comments_post_id ON comments(post_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_knowledge_category ON knowledge_base(category, is_active);
    CREATE INDEX IF NOT EXISTS idx_contacts_status ON contacts(status, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_publish_logs_status ON publish_logs(status, scheduled_at);
  `);
  try {
    const cols = db.prepare("PRAGMA table_info('posts')").all();
    if (!cols.some((c) => c.name === "audio_url")) {
      db.exec("ALTER TABLE posts ADD COLUMN audio_url TEXT DEFAULT ''");
    }
  } catch {
  }
  try {
    const mCols = db.prepare("PRAGMA table_info('ai_media_assets')").all();
    if (!mCols.some((c) => c.name === "review_status")) {
      db.exec("ALTER TABLE ai_media_assets ADD COLUMN review_status TEXT DEFAULT 'approved'");
    }
    if (!mCols.some((c) => c.name === "thai_summary")) {
      db.exec("ALTER TABLE ai_media_assets ADD COLUMN thai_summary TEXT DEFAULT ''");
    }
  } catch {
  }
  db.exec("DELETE FROM publish_logs WHERE mode = 'sandbox_ready' OR response_note LIKE '%\u0E08\u0E33\u0E25\u0E2D\u0E07%'");
  try {
    const migrated = db.prepare("SELECT value FROM settings WHERE key = 'dynamic_model_discovery_v1'").get();
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
  }
  seedIfEmpty();
  seedOmnichannelIfEmpty();
  upgradePlaintextSecretsToAes256Gcm();
}
function upgradePlaintextSecretsToAes256Gcm() {
  try {
    const rows = db.prepare("SELECT key, value FROM settings").all();
    const upd = db.prepare("UPDATE settings SET value = ? WHERE key = ?");
    for (const r of rows) {
      if (SECRET_SETTING_KEYS.has(r.key) && r.value && r.value.trim() && !isEncryptedSecret(r.value)) {
        upd.run(encryptSecretValue(r.value, r.key), r.key);
      }
    }
    const chRows = db.prepare("SELECT id, channel_key, access_token FROM channel_configs WHERE access_token != ''").all();
    const updCh = db.prepare("UPDATE channel_configs SET access_token = ? WHERE id = ?");
    for (const ch of chRows) {
      if (ch.access_token && ch.access_token.trim() && !isEncryptedSecret(ch.access_token)) {
        updCh.run(
          encryptSecretValue(ch.access_token, `channel:${ch.channel_key}`),
          ch.id
        );
      }
    }
  } catch {
  }
}
function seedOmnichannelIfEmpty() {
  const chCount = db.prepare("SELECT COUNT(*) as c FROM channel_configs").get().c;
  if (chCount === 0) {
    const now = "2025-09-16T08:00:00.000Z";
    const ins = db.prepare(`
      INSERT INTO channel_configs (
        channel_key, channel_name, handle_or_url, enabled, auto_publish,
        access_token, target_id, webhook_url, updated_at
      ) VALUES (?, ?, ?, 1, 1, '', '', '', ?)
    `);
    ins.run("youtube", "YouTube", "https://www.youtube.com/watch?v=VxQwQ9vQkkc", now);
    ins.run("facebook", "Facebook", "https://facebook.com/komkidbykomkrit", now);
    ins.run("tiktok", "TikTok", "https://tiktok.com/@komkidbykomkrit", now);
    ins.run("line_oa", "LINE OA", "@komkidbykomkrit", now);
    ins.run("x_twitter", "X (Twitter)", "https://x.com/komkidbykomkrit", now);
    ins.run("instagram", "Instagram", "https://instagram.com/komkidbykomkrit", now);
    ins.run("website_blog", "Website / Blog", "http://localhost:3000", now);
    ins.run("email_newsletter", "Email / Newsletter", "newsletter@komkrit.com", now);
    const logIns = db.prepare(`
      INSERT INTO publish_logs (
        workflow_id, post_id, channel_key, channel_name, title, content_preview,
        mode, status, external_url, response_note, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'published', ?, ?, ?)
    `);
    logIns.run(
      null,
      1,
      "website_blog",
      "Website / Blog",
      "\u0E01\u0E32\u0E23\u0E28\u0E36\u0E01\u0E29\u0E32\u0E44\u0E17\u0E22 \u0E43\u0E19\u0E22\u0E38\u0E04 AI",
      "\u0E40\u0E08\u0E32\u0E30\u0E25\u0E36\u0E01\u0E08\u0E38\u0E14\u0E40\u0E1B\u0E25\u0E35\u0E48\u0E22\u0E19\u0E04\u0E23\u0E31\u0E49\u0E07\u0E2A\u0E33\u0E04\u0E31\u0E0D\u0E02\u0E2D\u0E07\u0E23\u0E30\u0E1A\u0E1A\u0E01\u0E32\u0E23\u0E28\u0E36\u0E01\u0E29\u0E32\u0E44\u0E17\u0E22 \u0E42\u0E2D\u0E01\u0E32\u0E2A \u0E04\u0E27\u0E32\u0E21\u0E17\u0E49\u0E32\u0E17\u0E32\u0E22 \u0E41\u0E25\u0E30\u0E41\u0E19\u0E27\u0E17\u0E32\u0E07\u0E01\u0E32\u0E23\u0E1E\u0E31\u0E12\u0E19\u0E32",
      "internal_live",
      "/?post=1",
      "\u0E40\u0E1C\u0E22\u0E41\u0E1E\u0E23\u0E48\u0E02\u0E36\u0E49\u0E19\u0E2B\u0E19\u0E49\u0E32\u0E40\u0E27\u0E47\u0E1A\u0E44\u0E0B\u0E15\u0E4C\u0E2B\u0E25\u0E31\u0E01\u0E40\u0E23\u0E35\u0E22\u0E1A\u0E23\u0E49\u0E2D\u0E22\u0E41\u0E25\u0E49\u0E27 (Featured Hero)",
      "2025-09-15T09:05:00.000Z"
    );
    logIns.run(
      null,
      6,
      "youtube",
      "YouTube",
      "\u0E04\u0E34\u0E14\u0E15\u0E48\u0E32\u0E07\u0E2D\u0E22\u0E48\u0E32\u0E07\u0E2A\u0E23\u0E49\u0E32\u0E07\u0E2A\u0E23\u0E23\u0E04\u0E4C: \u0E1E\u0E25\u0E34\u0E01\u0E42\u0E09\u0E21\u0E04\u0E2D\u0E19\u0E40\u0E17\u0E19\u0E15\u0E4C\u0E01\u0E32\u0E23\u0E28\u0E36\u0E01\u0E29\u0E32\u0E14\u0E49\u0E27\u0E22\u0E23\u0E30\u0E1A\u0E1A AI Multi-Agent",
      "\u0E27\u0E34\u0E14\u0E35\u0E42\u0E2D\u0E40\u0E08\u0E32\u0E30\u0E25\u0E36\u0E01\u0E41\u0E19\u0E27\u0E04\u0E34\u0E14 AI + Human = Greater Impact \u0E42\u0E14\u0E22 \u0E04\u0E21\u0E04\u0E34\u0E14 by KOMKRIT",
      "internal_live",
      "https://www.youtube.com/watch?v=VxQwQ9vQkkc",
      "\u0E40\u0E0A\u0E37\u0E48\u0E2D\u0E21\u0E15\u0E48\u0E2D\u0E25\u0E34\u0E07\u0E01\u0E4C\u0E27\u0E34\u0E14\u0E35\u0E42\u0E2D YouTube \u0E08\u0E23\u0E34\u0E07\u0E02\u0E36\u0E49\u0E19\u0E23\u0E30\u0E1A\u0E1A\u0E2A\u0E33\u0E40\u0E23\u0E47\u0E08",
      "2025-09-14T16:10:00.000Z"
    );
  }
  const svCount = db.prepare("SELECT COUNT(*) as c FROM audience_surveys").get().c;
  if (svCount === 0) {
    const svIns = db.prepare(`
      INSERT INTO audience_surveys (
        respondent_name, respondent_role, school_or_org, preferred_channel,
        requested_topic, satisfaction_score, feedback_detail, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    svIns.run(
      "\u0E1C\u0E2D.\u0E01\u0E34\u0E15\u0E15\u0E34\u0E1E\u0E07\u0E28\u0E4C \u0E23\u0E31\u0E15\u0E19\u0E42\u0E0A\u0E15\u0E34",
      "\u0E04\u0E23\u0E39 / \u0E1A\u0E38\u0E04\u0E25\u0E32\u0E01\u0E23\u0E17\u0E32\u0E07\u0E01\u0E32\u0E23\u0E28\u0E36\u0E01\u0E29\u0E32",
      "\u0E42\u0E23\u0E07\u0E40\u0E23\u0E35\u0E22\u0E19\u0E40\u0E17\u0E28\u0E1A\u0E32\u0E25\u0E15\u0E49\u0E19\u0E41\u0E1A\u0E1A \u0E08.\u0E20\u0E39\u0E40\u0E01\u0E47\u0E15",
      "LINE OA",
      "\u0E41\u0E19\u0E27\u0E17\u0E32\u0E07\u0E01\u0E32\u0E23\u0E19\u0E33 AI \u0E21\u0E32\u0E0A\u0E48\u0E27\u0E22\u0E04\u0E23\u0E39\u0E27\u0E32\u0E07\u0E41\u0E1C\u0E19\u0E01\u0E32\u0E23\u0E2A\u0E2D\u0E19\u0E2A\u0E2D\u0E07\u0E20\u0E32\u0E29\u0E32 (\u0E44\u0E17\u0E22-\u0E2D\u0E31\u0E07\u0E01\u0E24\u0E29-\u0E40\u0E21\u0E35\u0E22\u0E19\u0E21\u0E32) \u0E2A\u0E33\u0E2B\u0E23\u0E31\u0E1A\u0E42\u0E23\u0E07\u0E40\u0E23\u0E35\u0E22\u0E19\u0E43\u0E19\u0E1E\u0E37\u0E49\u0E19\u0E17\u0E35\u0E48\u0E40\u0E28\u0E23\u0E29\u0E10\u0E01\u0E34\u0E08\u0E1E\u0E34\u0E40\u0E28\u0E29",
      5,
      "\u0E40\u0E19\u0E37\u0E49\u0E2D\u0E2B\u0E32\u0E02\u0E2D\u0E07\u0E04\u0E21\u0E04\u0E34\u0E14\u0E19\u0E33\u0E44\u0E1B\u0E43\u0E0A\u0E49\u0E1B\u0E23\u0E30\u0E0A\u0E38\u0E21\u0E04\u0E23\u0E39\u0E44\u0E14\u0E49\u0E08\u0E23\u0E34\u0E07 \u0E2D\u0E22\u0E32\u0E01\u0E43\u0E2B\u0E49\u0E21\u0E35\u0E2D\u0E34\u0E19\u0E42\u0E1F\u0E01\u0E23\u0E32\u0E1F\u0E34\u0E01\u0E2A\u0E23\u0E38\u0E1B\u0E2A\u0E31\u0E49\u0E19\u0E2A\u0E48\u0E07\u0E17\u0E32\u0E07 LINE OA \u0E17\u0E38\u0E01\u0E2A\u0E31\u0E1B\u0E14\u0E32\u0E2B\u0E4C\u0E04\u0E23\u0E31\u0E1A",
      "2025-09-15T15:30:00.000Z"
    );
    svIns.run(
      "\u0E04\u0E38\u0E13\u0E28\u0E34\u0E23\u0E34\u0E1E\u0E23 \u0E43\u0E08\u0E14\u0E35",
      "\u0E1C\u0E39\u0E49\u0E1B\u0E01\u0E04\u0E23\u0E2D\u0E07",
      "\u0E40\u0E04\u0E23\u0E37\u0E2D\u0E02\u0E48\u0E32\u0E22\u0E1C\u0E39\u0E49\u0E1B\u0E01\u0E04\u0E23\u0E2D\u0E07\u0E21\u0E31\u0E18\u0E22\u0E21\u0E28\u0E36\u0E01\u0E29\u0E32",
      "Facebook",
      "\u0E27\u0E34\u0E18\u0E35\u0E40\u0E15\u0E23\u0E35\u0E22\u0E21\u0E17\u0E31\u0E01\u0E29\u0E30\u0E2D\u0E32\u0E0A\u0E35\u0E1E\u0E41\u0E25\u0E30\u0E20\u0E32\u0E29\u0E32\u0E43\u0E2B\u0E49\u0E25\u0E39\u0E01\u0E2B\u0E25\u0E32\u0E19\u0E01\u0E49\u0E32\u0E27\u0E17\u0E31\u0E19\u0E22\u0E38\u0E04 AI \u0E42\u0E14\u0E22\u0E44\u0E21\u0E48\u0E40\u0E04\u0E23\u0E35\u0E22\u0E14\u0E40\u0E01\u0E34\u0E19\u0E44\u0E1B",
      5,
      "\u0E15\u0E34\u0E14\u0E15\u0E32\u0E21\u0E2D\u0E48\u0E32\u0E19\u0E17\u0E32\u0E07 Facebook \u0E41\u0E25\u0E30\u0E40\u0E27\u0E47\u0E1A\u0E44\u0E0B\u0E15\u0E4C\u0E15\u0E25\u0E2D\u0E14\u0E04\u0E48\u0E30 \u0E2D\u0E48\u0E32\u0E19\u0E40\u0E02\u0E49\u0E32\u0E43\u0E08\u0E07\u0E48\u0E32\u0E22\u0E41\u0E25\u0E30\u0E40\u0E2B\u0E47\u0E19\u0E20\u0E32\u0E1E\u0E2D\u0E19\u0E32\u0E04\u0E15\u0E0A\u0E31\u0E14\u0E40\u0E08\u0E19",
      "2025-09-16T08:45:00.000Z"
    );
  }
}
function seedIfEmpty() {
  const seededFlag = db.prepare("SELECT value FROM settings WHERE key = 'initial_seed_done'").get();
  if (seededFlag?.value === "1") return;
  const countRow = db.prepare("SELECT COUNT(*) as cnt FROM posts").get();
  if (countRow && countRow.cnt > 0) {
    db.prepare(
      "INSERT OR REPLACE INTO settings (key, value) VALUES ('initial_seed_done', '1')"
    ).run();
    return;
  }
  db.prepare(
    "INSERT OR REPLACE INTO settings (key, value) VALUES ('initial_seed_done', '1')"
  ).run();
  const insertPost = db.prepare(`
    INSERT INTO posts (
      title, subtitle, excerpt, content, category, content_type, cover_image,
      video_url, tags_json, author, status, is_featured, views, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  insertPost.run(
    "\u0E01\u0E32\u0E23\u0E28\u0E36\u0E01\u0E29\u0E32\u0E44\u0E17\u0E22 \u0E43\u0E19\u0E22\u0E38\u0E04 AI",
    "\u0E42\u0E2D\u0E01\u0E32\u0E2A \u0E04\u0E27\u0E32\u0E21\u0E17\u0E49\u0E32\u0E17\u0E32\u0E22 \u0E41\u0E25\u0E30\u0E41\u0E19\u0E27\u0E17\u0E32\u0E07\u0E01\u0E32\u0E23\u0E1E\u0E31\u0E12\u0E19\u0E32",
    "\u0E40\u0E08\u0E32\u0E30\u0E25\u0E36\u0E01\u0E08\u0E38\u0E14\u0E40\u0E1B\u0E25\u0E35\u0E48\u0E22\u0E19\u0E04\u0E23\u0E31\u0E49\u0E07\u0E2A\u0E33\u0E04\u0E31\u0E0D\u0E02\u0E2D\u0E07\u0E23\u0E30\u0E1A\u0E1A\u0E01\u0E32\u0E23\u0E28\u0E36\u0E01\u0E29\u0E32\u0E44\u0E17\u0E22 \u0E40\u0E21\u0E37\u0E48\u0E2D AI \u0E44\u0E21\u0E48\u0E44\u0E14\u0E49\u0E40\u0E1B\u0E47\u0E19\u0E40\u0E1E\u0E35\u0E22\u0E07\u0E40\u0E04\u0E23\u0E37\u0E48\u0E2D\u0E07\u0E21\u0E37\u0E2D\u0E0A\u0E48\u0E27\u0E22\u0E2A\u0E2D\u0E19 \u0E41\u0E15\u0E48\u0E04\u0E37\u0E2D\u0E42\u0E04\u0E23\u0E07\u0E2A\u0E23\u0E49\u0E32\u0E07\u0E1E\u0E37\u0E49\u0E19\u0E10\u0E32\u0E19\u0E43\u0E2B\u0E21\u0E48\u0E43\u0E19\u0E01\u0E32\u0E23\u0E1E\u0E31\u0E12\u0E19\u0E32\u0E1C\u0E39\u0E49\u0E40\u0E23\u0E35\u0E22\u0E19 \u0E04\u0E23\u0E39 \u0E41\u0E25\u0E30\u0E1C\u0E39\u0E49\u0E1A\u0E23\u0E34\u0E2B\u0E32\u0E23\u0E2A\u0E16\u0E32\u0E19\u0E28\u0E36\u0E01\u0E29\u0E32\u0E43\u0E2B\u0E49\u0E01\u0E49\u0E32\u0E27\u0E17\u0E31\u0E19\u0E42\u0E25\u0E01\u0E2D\u0E19\u0E32\u0E04\u0E15",
    `## \u0E01\u0E32\u0E23\u0E28\u0E36\u0E01\u0E29\u0E32\u0E44\u0E17\u0E22\u0E01\u0E33\u0E25\u0E31\u0E07\u0E22\u0E37\u0E19\u0E2D\u0E22\u0E39\u0E48\u0E1A\u0E19\u0E08\u0E38\u0E14\u0E40\u0E1B\u0E25\u0E35\u0E48\u0E22\u0E19\u0E04\u0E23\u0E31\u0E49\u0E07\u0E1B\u0E23\u0E30\u0E27\u0E31\u0E15\u0E34\u0E28\u0E32\u0E2A\u0E15\u0E23\u0E4C

\u0E40\u0E21\u0E37\u0E48\u0E2D\u0E40\u0E17\u0E04\u0E42\u0E19\u0E42\u0E25\u0E22\u0E35\u0E1B\u0E31\u0E0D\u0E0D\u0E32\u0E1B\u0E23\u0E30\u0E14\u0E34\u0E29\u0E10\u0E4C (Artificial Intelligence) \u0E01\u0E49\u0E32\u0E27\u0E40\u0E02\u0E49\u0E32\u0E2A\u0E39\u0E48\u0E22\u0E38\u0E04 **Generative & Agentic AI** \u0E04\u0E33\u0E16\u0E32\u0E21\u0E2A\u0E33\u0E04\u0E31\u0E0D\u0E44\u0E21\u0E48\u0E43\u0E0A\u0E48 "\u0E40\u0E23\u0E32\u0E08\u0E30\u0E2D\u0E19\u0E38\u0E0D\u0E32\u0E15\u0E43\u0E2B\u0E49\u0E19\u0E31\u0E01\u0E40\u0E23\u0E35\u0E22\u0E19\u0E43\u0E0A\u0E49 AI \u0E2B\u0E23\u0E37\u0E2D\u0E44\u0E21\u0E48" \u0E2D\u0E35\u0E01\u0E15\u0E48\u0E2D\u0E44\u0E1B \u0E41\u0E15\u0E48\u0E04\u0E37\u0E2D **"\u0E40\u0E23\u0E32\u0E08\u0E30\u0E2D\u0E2D\u0E01\u0E41\u0E1A\u0E1A\u0E23\u0E30\u0E1A\u0E1A\u0E01\u0E32\u0E23\u0E40\u0E23\u0E35\u0E22\u0E19\u0E23\u0E39\u0E49\u0E43\u0E2B\u0E21\u0E48\u0E2D\u0E22\u0E48\u0E32\u0E07\u0E44\u0E23 \u0E43\u0E2B\u0E49\u0E21\u0E19\u0E38\u0E29\u0E22\u0E4C\u0E17\u0E33\u0E07\u0E32\u0E19\u0E23\u0E48\u0E27\u0E21\u0E01\u0E31\u0E1A AI \u0E44\u0E14\u0E49\u0E2D\u0E22\u0E48\u0E32\u0E07\u0E2A\u0E23\u0E49\u0E32\u0E07\u0E2A\u0E23\u0E23\u0E04\u0E4C\u0E41\u0E25\u0E30\u0E21\u0E35\u0E08\u0E23\u0E34\u0E22\u0E18\u0E23\u0E23\u0E21"**

### 1. \u0E42\u0E2D\u0E01\u0E32\u0E2A\u0E43\u0E2B\u0E21\u0E48\u0E02\u0E2D\u0E07\u0E01\u0E32\u0E23\u0E28\u0E36\u0E01\u0E29\u0E32\u0E44\u0E17\u0E22 (Opportunities)
- **Personalized Learning \u0E23\u0E32\u0E22\u0E1A\u0E38\u0E04\u0E04\u0E25:** AI \u0E0A\u0E48\u0E27\u0E22\u0E27\u0E34\u0E40\u0E04\u0E23\u0E32\u0E30\u0E2B\u0E4C\u0E08\u0E38\u0E14\u0E41\u0E02\u0E47\u0E07\u0E41\u0E25\u0E30\u0E0A\u0E48\u0E2D\u0E07\u0E27\u0E48\u0E32\u0E07\u0E01\u0E32\u0E23\u0E40\u0E23\u0E35\u0E22\u0E19\u0E23\u0E39\u0E49\u0E02\u0E2D\u0E07\u0E19\u0E31\u0E01\u0E40\u0E23\u0E35\u0E22\u0E19\u0E41\u0E15\u0E48\u0E25\u0E30\u0E04\u0E19 \u0E17\u0E33\u0E43\u0E2B\u0E49\u0E04\u0E23\u0E39\u0E2A\u0E32\u0E21\u0E32\u0E23\u0E16\u0E14\u0E39\u0E41\u0E25\u0E40\u0E14\u0E47\u0E01\u0E17\u0E35\u0E48\u0E21\u0E35\u0E04\u0E27\u0E32\u0E21\u0E40\u0E23\u0E47\u0E27\u0E43\u0E19\u0E01\u0E32\u0E23\u0E40\u0E23\u0E35\u0E22\u0E19\u0E23\u0E39\u0E49\u0E15\u0E48\u0E32\u0E07\u0E01\u0E31\u0E19\u0E44\u0E14\u0E49\u0E2D\u0E22\u0E48\u0E32\u0E07\u0E17\u0E31\u0E48\u0E27\u0E16\u0E36\u0E07
- **\u0E25\u0E14\u0E20\u0E32\u0E23\u0E30\u0E07\u0E32\u0E19\u0E40\u0E2D\u0E01\u0E2A\u0E32\u0E23\u0E02\u0E2D\u0E07\u0E04\u0E23\u0E39:** \u0E23\u0E30\u0E1A\u0E1A AI Agent \u0E0A\u0E48\u0E27\u0E22\u0E23\u0E48\u0E32\u0E07\u0E41\u0E1C\u0E19\u0E01\u0E32\u0E23\u0E2A\u0E2D\u0E19 \u0E2D\u0E2D\u0E01\u0E41\u0E1A\u0E1A\u0E2A\u0E37\u0E48\u0E2D\u0E2D\u0E34\u0E19\u0E42\u0E1F\u0E01\u0E23\u0E32\u0E1F\u0E34\u0E01 \u0E41\u0E25\u0E30\u0E1B\u0E23\u0E30\u0E40\u0E21\u0E34\u0E19\u0E1C\u0E25\u0E40\u0E1A\u0E37\u0E49\u0E2D\u0E07\u0E15\u0E49\u0E19 \u0E04\u0E37\u0E19\u0E40\u0E27\u0E25\u0E32\u0E43\u0E2B\u0E49\u0E04\u0E23\u0E39\u0E44\u0E14\u0E49\u0E17\u0E33\u0E2B\u0E19\u0E49\u0E32\u0E17\u0E35\u0E48 "\u0E42\u0E04\u0E49\u0E0A\u0E0A\u0E35\u0E27\u0E34\u0E15\u0E41\u0E25\u0E30\u0E1C\u0E39\u0E49\u0E2D\u0E2D\u0E01\u0E41\u0E1A\u0E1A\u0E41\u0E23\u0E07\u0E1A\u0E31\u0E19\u0E14\u0E32\u0E25\u0E43\u0E08"
- **\u0E40\u0E1B\u0E34\u0E14\u0E42\u0E2D\u0E01\u0E32\u0E2A\u0E43\u0E2B\u0E49\u0E42\u0E23\u0E07\u0E40\u0E23\u0E35\u0E22\u0E19\u0E02\u0E19\u0E32\u0E14\u0E40\u0E25\u0E47\u0E01\u0E41\u0E25\u0E30\u0E1E\u0E37\u0E49\u0E19\u0E17\u0E35\u0E48\u0E2B\u0E48\u0E32\u0E07\u0E44\u0E01\u0E25:** \u0E40\u0E02\u0E49\u0E32\u0E16\u0E36\u0E07\u0E2D\u0E07\u0E04\u0E4C\u0E04\u0E27\u0E32\u0E21\u0E23\u0E39\u0E49\u0E23\u0E30\u0E14\u0E31\u0E1A\u0E2A\u0E32\u0E01\u0E25 \u0E25\u0E14\u0E04\u0E27\u0E32\u0E21\u0E40\u0E2B\u0E25\u0E37\u0E48\u0E2D\u0E21\u0E25\u0E49\u0E33\u0E17\u0E32\u0E07\u0E01\u0E32\u0E23\u0E28\u0E36\u0E01\u0E29\u0E32\u0E2D\u0E22\u0E48\u0E32\u0E07\u0E40\u0E1B\u0E47\u0E19\u0E23\u0E39\u0E1B\u0E18\u0E23\u0E23\u0E21

### 2. \u0E04\u0E27\u0E32\u0E21\u0E17\u0E49\u0E32\u0E17\u0E32\u0E22\u0E17\u0E35\u0E48\u0E15\u0E49\u0E2D\u0E07\u0E01\u0E49\u0E32\u0E27\u0E02\u0E49\u0E32\u0E21 (Challenges)
- **\u0E17\u0E31\u0E01\u0E29\u0E30\u0E01\u0E32\u0E23\u0E04\u0E34\u0E14\u0E27\u0E34\u0E40\u0E04\u0E23\u0E32\u0E30\u0E2B\u0E4C (Critical Thinking):** \u0E2B\u0E32\u0E01\u0E1C\u0E39\u0E49\u0E40\u0E23\u0E35\u0E22\u0E19\u0E43\u0E0A\u0E49 AI \u0E40\u0E1E\u0E37\u0E48\u0E2D\u0E2B\u0E32\u0E04\u0E33\u0E15\u0E2D\u0E1A\u0E2A\u0E33\u0E40\u0E23\u0E47\u0E08\u0E23\u0E39\u0E1B\u0E42\u0E14\u0E22\u0E44\u0E21\u0E48\u0E1C\u0E48\u0E32\u0E19\u0E01\u0E23\u0E30\u0E1A\u0E27\u0E19\u0E01\u0E32\u0E23\u0E15\u0E31\u0E49\u0E07\u0E04\u0E33\u0E16\u0E32\u0E21\u0E41\u0E25\u0E30\u0E15\u0E23\u0E27\u0E08\u0E2A\u0E2D\u0E1A\u0E02\u0E49\u0E2D\u0E40\u0E17\u0E47\u0E08\u0E08\u0E23\u0E34\u0E07 (Fact-Checking) \u0E08\u0E30\u0E17\u0E33\u0E43\u0E2B\u0E49\u0E17\u0E31\u0E01\u0E29\u0E30\u0E01\u0E32\u0E23\u0E04\u0E34\u0E14\u0E40\u0E0A\u0E34\u0E07\u0E25\u0E36\u0E01\u0E16\u0E14\u0E16\u0E2D\u0E22
- **\u0E04\u0E27\u0E32\u0E21\u0E1E\u0E23\u0E49\u0E2D\u0E21\u0E02\u0E2D\u0E07\u0E2B\u0E25\u0E31\u0E01\u0E2A\u0E39\u0E15\u0E23\u0E41\u0E25\u0E30\u0E21\u0E32\u0E15\u0E23\u0E10\u0E32\u0E19:** \u0E01\u0E32\u0E23\u0E1B\u0E23\u0E31\u0E1A\u0E15\u0E31\u0E27\u0E02\u0E2D\u0E07\u0E01\u0E23\u0E2D\u0E1A\u0E21\u0E32\u0E15\u0E23\u0E10\u0E32\u0E19\u0E01\u0E32\u0E23\u0E28\u0E36\u0E01\u0E29\u0E32 (\u0E2A\u0E1E\u0E10., \u0E2A\u0E0A./OPEC, \u0E2D\u0E32\u0E0A\u0E35\u0E27\u0E28\u0E36\u0E01\u0E29\u0E32) \u0E15\u0E49\u0E2D\u0E07\u0E22\u0E37\u0E14\u0E2B\u0E22\u0E38\u0E48\u0E19\u0E41\u0E25\u0E30\u0E40\u0E19\u0E49\u0E19\u0E2A\u0E21\u0E23\u0E23\u0E16\u0E19\u0E30\u0E08\u0E23\u0E34\u0E07\u0E21\u0E32\u0E01\u0E01\u0E27\u0E48\u0E32\u0E01\u0E32\u0E23\u0E17\u0E48\u0E2D\u0E07\u0E08\u0E33
- **\u0E08\u0E23\u0E34\u0E22\u0E18\u0E23\u0E23\u0E21\u0E41\u0E25\u0E30\u0E04\u0E27\u0E32\u0E21\u0E1B\u0E25\u0E2D\u0E14\u0E20\u0E31\u0E22\u0E17\u0E32\u0E07\u0E14\u0E34\u0E08\u0E34\u0E17\u0E31\u0E25:** \u0E01\u0E32\u0E23\u0E04\u0E38\u0E49\u0E21\u0E04\u0E23\u0E2D\u0E07\u0E02\u0E49\u0E2D\u0E21\u0E39\u0E25\u0E1C\u0E39\u0E49\u0E40\u0E23\u0E35\u0E22\u0E19\u0E41\u0E25\u0E30\u0E01\u0E32\u0E23\u0E23\u0E39\u0E49\u0E40\u0E17\u0E48\u0E32\u0E17\u0E31\u0E19\u0E2D\u0E04\u0E15\u0E34\u0E02\u0E2D\u0E07\u0E2D\u0E31\u0E25\u0E01\u0E2D\u0E23\u0E34\u0E17\u0E36\u0E21

### 3. \u0E41\u0E19\u0E27\u0E17\u0E32\u0E07\u0E01\u0E32\u0E23\u0E1E\u0E31\u0E12\u0E19\u0E32\u0E2D\u0E22\u0E48\u0E32\u0E07\u0E22\u0E31\u0E48\u0E07\u0E22\u0E37\u0E19\u0E15\u0E32\u0E21\u0E41\u0E19\u0E27\u0E04\u0E34\u0E14 "\u0E04\u0E34\u0E14\u0E15\u0E48\u0E32\u0E07\u0E2D\u0E22\u0E48\u0E32\u0E07\u0E2A\u0E23\u0E49\u0E32\u0E07\u0E2A\u0E23\u0E23\u0E04\u0E4C"
1. **\u0E40\u0E1B\u0E25\u0E35\u0E48\u0E22\u0E19\u0E2B\u0E49\u0E2D\u0E07\u0E40\u0E23\u0E35\u0E22\u0E19\u0E08\u0E32\u0E01 Content-Based \u0E2A\u0E39\u0E48 Problem & Project-Based** \u0E43\u0E2B\u0E49\u0E1C\u0E39\u0E49\u0E40\u0E23\u0E35\u0E22\u0E19\u0E43\u0E0A\u0E49 AI \u0E40\u0E1B\u0E47\u0E19\u0E1C\u0E39\u0E49\u0E0A\u0E48\u0E27\u0E22\u0E27\u0E34\u0E08\u0E31\u0E22\u0E41\u0E25\u0E30\u0E2A\u0E23\u0E49\u0E32\u0E07\u0E19\u0E27\u0E31\u0E15\u0E01\u0E23\u0E23\u0E21\u0E41\u0E01\u0E49\u0E1B\u0E31\u0E0D\u0E2B\u0E32\u0E08\u0E23\u0E34\u0E07\u0E43\u0E19\u0E0A\u0E38\u0E21\u0E0A\u0E19
2. **\u0E22\u0E01\u0E23\u0E30\u0E14\u0E31\u0E1A\u0E04\u0E23\u0E39\u0E2A\u0E39\u0E48 Learning Designer** \u0E1E\u0E31\u0E12\u0E19\u0E32\u0E17\u0E31\u0E01\u0E29\u0E30\u0E01\u0E32\u0E23\u0E43\u0E0A\u0E49 Multi-Agent AI \u0E43\u0E19\u0E01\u0E32\u0E23\u0E2D\u0E2D\u0E01\u0E41\u0E1A\u0E1A\u0E2A\u0E37\u0E48\u0E2D\u0E01\u0E32\u0E23\u0E2A\u0E2D\u0E19\u0E04\u0E38\u0E13\u0E20\u0E32\u0E1E\u0E2A\u0E39\u0E07
3. **\u0E40\u0E0A\u0E37\u0E48\u0E2D\u0E21\u0E42\u0E22\u0E07\u0E01\u0E32\u0E23\u0E28\u0E36\u0E01\u0E29\u0E32\u0E01\u0E31\u0E1A\u0E2D\u0E32\u0E0A\u0E35\u0E1E\u0E08\u0E23\u0E34\u0E07\u0E41\u0E25\u0E30\u0E17\u0E31\u0E01\u0E29\u0E30\u0E15\u0E25\u0E2D\u0E14\u0E0A\u0E35\u0E27\u0E34\u0E15 (Lifelong Learning)** \u0E40\u0E1E\u0E37\u0E48\u0E2D\u0E43\u0E2B\u0E49\u0E1C\u0E39\u0E49\u0E40\u0E23\u0E35\u0E22\u0E19\u0E1E\u0E23\u0E49\u0E2D\u0E21\u0E40\u0E15\u0E34\u0E1A\u0E42\u0E15\u0E43\u0E19\u0E42\u0E25\u0E01\u0E01\u0E32\u0E23\u0E17\u0E33\u0E07\u0E32\u0E19\u0E22\u0E38\u0E04\u0E43\u0E2B\u0E21\u0E48

> "\u0E01\u0E32\u0E23\u0E28\u0E36\u0E01\u0E29\u0E32 \u0E04\u0E37\u0E2D\u0E23\u0E32\u0E01\u0E10\u0E32\u0E19\u0E02\u0E2D\u0E07\u0E01\u0E32\u0E23\u0E1E\u0E31\u0E12\u0E19\u0E32\u0E04\u0E19 \u0E41\u0E25\u0E30\u0E01\u0E32\u0E23\u0E2A\u0E23\u0E49\u0E32\u0E07\u0E2D\u0E19\u0E32\u0E04\u0E15\u0E17\u0E35\u0E48\u0E14\u0E35\u0E01\u0E27\u0E48\u0E32 \u2014 \u0E40\u0E21\u0E37\u0E48\u0E2D AI \u0E1C\u0E2A\u0E32\u0E19\u0E01\u0E31\u0E1A\u0E2B\u0E31\u0E27\u0E43\u0E08\u0E02\u0E2D\u0E07\u0E04\u0E27\u0E32\u0E21\u0E40\u0E1B\u0E47\u0E19\u0E04\u0E23\u0E39 \u0E1C\u0E25\u0E25\u0E31\u0E1E\u0E18\u0E4C\u0E04\u0E37\u0E2D\u0E42\u0E2D\u0E01\u0E32\u0E2A\u0E17\u0E35\u0E48\u0E22\u0E34\u0E48\u0E07\u0E43\u0E2B\u0E0D\u0E48\u0E01\u0E27\u0E48\u0E32\u0E40\u0E14\u0E34\u0E21"`,
    "special",
    "article",
    "/images/featured-speaker.jpg",
    "https://www.youtube.com/watch?v=VxQwQ9vQkkc",
    JSON.stringify(["\u0E01\u0E32\u0E23\u0E28\u0E36\u0E01\u0E29\u0E32\u0E44\u0E17\u0E22", "AI \u0E40\u0E1E\u0E37\u0E48\u0E2D\u0E01\u0E32\u0E23\u0E28\u0E36\u0E01\u0E29\u0E32", "\u0E1A\u0E17\u0E04\u0E27\u0E32\u0E21\u0E1E\u0E34\u0E40\u0E28\u0E29", "\u0E19\u0E42\u0E22\u0E1A\u0E32\u0E22\u0E01\u0E32\u0E23\u0E28\u0E36\u0E01\u0E29\u0E32"]),
    "\u0E04\u0E21\u0E01\u0E24\u0E0A (Komkrit)",
    "published",
    1,
    3850,
    "2025-09-15T09:00:00.000Z",
    "2025-09-15T09:00:00.000Z"
  );
  insertPost.run(
    "AI \u0E40\u0E1B\u0E25\u0E35\u0E48\u0E22\u0E19\u0E01\u0E32\u0E23\u0E28\u0E36\u0E01\u0E29\u0E32\u0E44\u0E14\u0E49\u0E08\u0E23\u0E34\u0E07\u0E2B\u0E23\u0E37\u0E2D? \u0E42\u0E2D\u0E01\u0E32\u0E2A\u0E41\u0E25\u0E30\u0E04\u0E27\u0E32\u0E21\u0E17\u0E49\u0E32\u0E17\u0E32\u0E22\u0E2A\u0E33\u0E2B\u0E23\u0E31\u0E1A\u0E2D\u0E19\u0E32\u0E04\u0E15\u0E01\u0E32\u0E23\u0E40\u0E23\u0E35\u0E22\u0E19\u0E23\u0E39\u0E49\u0E02\u0E2D\u0E07\u0E44\u0E17\u0E22",
    "\u0E21\u0E38\u0E21\u0E21\u0E2D\u0E07\u0E40\u0E0A\u0E34\u0E07\u0E1B\u0E0F\u0E34\u0E1A\u0E31\u0E15\u0E34\u0E08\u0E32\u0E01\u0E2B\u0E49\u0E2D\u0E07\u0E40\u0E23\u0E35\u0E22\u0E19\u0E08\u0E23\u0E34\u0E07\u0E2A\u0E39\u0E48\u0E19\u0E42\u0E22\u0E1A\u0E32\u0E22\u0E23\u0E30\u0E14\u0E31\u0E1A\u0E1B\u0E23\u0E30\u0E40\u0E17\u0E28",
    "\u0E27\u0E34\u0E40\u0E04\u0E23\u0E32\u0E30\u0E2B\u0E4C\u0E40\u0E08\u0E32\u0E30\u0E25\u0E36\u0E01\u0E27\u0E48\u0E32 AI \u0E01\u0E31\u0E1A\u0E01\u0E32\u0E23\u0E28\u0E36\u0E01\u0E29\u0E32\u0E44\u0E17\u0E22\u0E08\u0E30\u0E2A\u0E23\u0E49\u0E32\u0E07\u0E01\u0E32\u0E23\u0E40\u0E1B\u0E25\u0E35\u0E48\u0E22\u0E19\u0E41\u0E1B\u0E25\u0E07\u0E40\u0E0A\u0E34\u0E07\u0E42\u0E04\u0E23\u0E07\u0E2A\u0E23\u0E49\u0E32\u0E07\u0E44\u0E14\u0E49\u0E08\u0E23\u0E34\u0E07\u0E40\u0E1E\u0E35\u0E22\u0E07\u0E43\u0E14 \u0E1E\u0E23\u0E49\u0E2D\u0E21\u0E01\u0E23\u0E13\u0E35\u0E28\u0E36\u0E01\u0E29\u0E32\u0E01\u0E32\u0E23\u0E1B\u0E23\u0E30\u0E22\u0E38\u0E01\u0E15\u0E4C\u0E43\u0E0A\u0E49\u0E43\u0E19\u0E42\u0E23\u0E07\u0E40\u0E23\u0E35\u0E22\u0E19\u0E22\u0E38\u0E04\u0E43\u0E2B\u0E21\u0E48",
    `## AI \u0E01\u0E31\u0E1A\u0E01\u0E32\u0E23\u0E28\u0E36\u0E01\u0E29\u0E32: \u0E08\u0E32\u0E01\u0E01\u0E23\u0E30\u0E41\u0E2A\u0E15\u0E37\u0E48\u0E19\u0E15\u0E31\u0E27\u0E2A\u0E39\u0E48\u0E01\u0E32\u0E23\u0E25\u0E07\u0E21\u0E37\u0E2D\u0E17\u0E33\u0E08\u0E23\u0E34\u0E07

\u0E43\u0E19\u0E0A\u0E48\u0E27\u0E07\u0E44\u0E21\u0E48\u0E01\u0E35\u0E48\u0E1B\u0E35\u0E17\u0E35\u0E48\u0E1C\u0E48\u0E32\u0E19\u0E21\u0E32 \u0E40\u0E23\u0E32\u0E44\u0E14\u0E49\u0E40\u0E2B\u0E47\u0E19\u0E42\u0E23\u0E07\u0E40\u0E23\u0E35\u0E22\u0E19\u0E41\u0E25\u0E30\u0E2A\u0E16\u0E32\u0E1A\u0E31\u0E19\u0E01\u0E32\u0E23\u0E28\u0E36\u0E01\u0E29\u0E32\u0E17\u0E31\u0E48\u0E27\u0E42\u0E25\u0E01\u0E19\u0E33 AI \u0E40\u0E02\u0E49\u0E32\u0E21\u0E32\u0E1B\u0E23\u0E31\u0E1A\u0E43\u0E0A\u0E49\u0E43\u0E19\u0E2B\u0E49\u0E2D\u0E07\u0E40\u0E23\u0E35\u0E22\u0E19 \u0E2A\u0E33\u0E2B\u0E23\u0E31\u0E1A\u0E1B\u0E23\u0E30\u0E40\u0E17\u0E28\u0E44\u0E17\u0E22 \u0E42\u0E2D\u0E01\u0E32\u0E2A\u0E17\u0E35\u0E48\u0E41\u0E17\u0E49\u0E08\u0E23\u0E34\u0E07\u0E2D\u0E22\u0E39\u0E48\u0E17\u0E35\u0E48\u0E01\u0E32\u0E23\u0E40\u0E1B\u0E25\u0E35\u0E48\u0E22\u0E19\u0E1C\u0E48\u0E32\u0E19\u0E08\u0E32\u0E01 **"\u0E01\u0E32\u0E23\u0E40\u0E23\u0E35\u0E22\u0E19\u0E40\u0E1E\u0E37\u0E48\u0E2D\u0E2A\u0E2D\u0E1A"** \u0E44\u0E1B\u0E2A\u0E39\u0E48 **"\u0E01\u0E32\u0E23\u0E40\u0E23\u0E35\u0E22\u0E19\u0E23\u0E39\u0E49\u0E40\u0E1E\u0E37\u0E48\u0E2D\u0E2A\u0E23\u0E49\u0E32\u0E07\u0E04\u0E38\u0E13\u0E04\u0E48\u0E32"**

### \u0E1B\u0E23\u0E30\u0E40\u0E14\u0E47\u0E19\u0E2A\u0E33\u0E04\u0E31\u0E0D\u0E17\u0E35\u0E48\u0E1C\u0E39\u0E49\u0E1A\u0E23\u0E34\u0E2B\u0E32\u0E23\u0E41\u0E25\u0E30\u0E04\u0E23\u0E39\u0E15\u0E49\u0E2D\u0E07\u0E40\u0E15\u0E23\u0E35\u0E22\u0E21\u0E1E\u0E23\u0E49\u0E2D\u0E21
- **AI Literacy \u0E2A\u0E33\u0E2B\u0E23\u0E31\u0E1A\u0E17\u0E38\u0E01\u0E23\u0E30\u0E14\u0E31\u0E1A\u0E0A\u0E31\u0E49\u0E19:** \u0E2A\u0E2D\u0E19\u0E43\u0E2B\u0E49\u0E1C\u0E39\u0E49\u0E40\u0E23\u0E35\u0E22\u0E19\u0E40\u0E02\u0E49\u0E32\u0E43\u0E08\u0E2B\u0E25\u0E31\u0E01\u0E01\u0E32\u0E23\u0E17\u0E33\u0E07\u0E32\u0E19 \u0E02\u0E49\u0E2D\u0E08\u0E33\u0E01\u0E31\u0E14 \u0E41\u0E25\u0E30\u0E01\u0E32\u0E23\u0E15\u0E31\u0E49\u0E07\u0E04\u0E33\u0E16\u0E32\u0E21 (Prompting & Inquiry) \u0E2D\u0E22\u0E48\u0E32\u0E07\u0E21\u0E35\u0E27\u0E34\u0E08\u0E32\u0E23\u0E13\u0E0D\u0E32\u0E13
- **\u0E01\u0E32\u0E23\u0E1B\u0E23\u0E30\u0E40\u0E21\u0E34\u0E19\u0E1C\u0E25\u0E23\u0E39\u0E1B\u0E41\u0E1A\u0E1A\u0E43\u0E2B\u0E21\u0E48 (Authentic Assessment):** \u0E27\u0E31\u0E14\u0E1C\u0E25\u0E08\u0E32\u0E01\u0E01\u0E23\u0E30\u0E1A\u0E27\u0E19\u0E01\u0E32\u0E23\u0E04\u0E34\u0E14 \u0E01\u0E32\u0E23\u0E19\u0E33\u0E40\u0E2A\u0E19\u0E2D \u0E41\u0E25\u0E30\u0E01\u0E32\u0E23\u0E41\u0E01\u0E49\u0E1B\u0E31\u0E0D\u0E2B\u0E32 \u0E41\u0E17\u0E19\u0E01\u0E32\u0E23\u0E15\u0E23\u0E27\u0E08\u0E40\u0E09\u0E1E\u0E32\u0E30\u0E0A\u0E34\u0E49\u0E19\u0E07\u0E32\u0E19\u0E1B\u0E25\u0E32\u0E22\u0E17\u0E32\u0E07
- **\u0E04\u0E27\u0E32\u0E21\u0E23\u0E48\u0E27\u0E21\u0E21\u0E37\u0E2D\u0E23\u0E30\u0E2B\u0E27\u0E48\u0E32\u0E07\u0E1A\u0E49\u0E32\u0E19 \u0E42\u0E23\u0E07\u0E40\u0E23\u0E35\u0E22\u0E19 \u0E41\u0E25\u0E30\u0E2A\u0E31\u0E07\u0E04\u0E21:** \u0E2A\u0E23\u0E49\u0E32\u0E07\u0E19\u0E34\u0E40\u0E27\u0E28\u0E01\u0E32\u0E23\u0E40\u0E23\u0E35\u0E22\u0E19\u0E23\u0E39\u0E49\u0E17\u0E35\u0E48\u0E1B\u0E25\u0E2D\u0E14\u0E20\u0E31\u0E22\u0E41\u0E25\u0E30\u0E2A\u0E48\u0E07\u0E40\u0E2A\u0E23\u0E34\u0E21\u0E04\u0E27\u0E32\u0E21\u0E04\u0E34\u0E14\u0E2A\u0E23\u0E49\u0E32\u0E07\u0E2A\u0E23\u0E23\u0E04\u0E4C

\u0E17\u0E38\u0E01\u0E04\u0E27\u0E32\u0E21\u0E04\u0E34\u0E14\u0E17\u0E35\u0E48\u0E41\u0E15\u0E01\u0E15\u0E48\u0E32\u0E07 \u0E04\u0E37\u0E2D\u0E08\u0E38\u0E14\u0E40\u0E23\u0E34\u0E48\u0E21\u0E15\u0E49\u0E19\u0E02\u0E2D\u0E07\u0E01\u0E32\u0E23\u0E40\u0E1B\u0E25\u0E35\u0E48\u0E22\u0E19\u0E41\u0E1B\u0E25\u0E07\u0E41\u0E25\u0E30\u0E01\u0E32\u0E23\u0E2A\u0E23\u0E49\u0E32\u0E07\u0E2A\u0E34\u0E48\u0E07\u0E17\u0E35\u0E48\u0E14\u0E35\u0E01\u0E27\u0E48\u0E32\u0E43\u0E2B\u0E49\u0E01\u0E31\u0E1A\u0E40\u0E22\u0E32\u0E27\u0E0A\u0E19\u0E44\u0E17\u0E22`,
    "ai-tech",
    "article",
    "/images/thumb-ai-edu.jpg",
    "",
    JSON.stringify(["AI & \u0E01\u0E32\u0E23\u0E28\u0E36\u0E01\u0E29\u0E32", "\u0E2D\u0E19\u0E32\u0E04\u0E15\u0E01\u0E32\u0E23\u0E40\u0E23\u0E35\u0E22\u0E19\u0E23\u0E39\u0E49", "EdTech"]),
    "\u0E04\u0E21\u0E01\u0E24\u0E0A (Komkrit)",
    "published",
    0,
    2410,
    "2025-09-13T10:30:00.000Z",
    "2025-09-13T10:30:00.000Z"
  );
  insertPost.run(
    "\u0E42\u0E23\u0E07\u0E40\u0E23\u0E35\u0E22\u0E19\u0E40\u0E2D\u0E01\u0E0A\u0E19\u0E44\u0E17\u0E22-\u0E40\u0E21\u0E35\u0E22\u0E19\u0E21\u0E32 \u0E42\u0E21\u0E40\u0E14\u0E25\u0E01\u0E32\u0E23\u0E28\u0E36\u0E01\u0E29\u0E32\u0E2A\u0E39\u0E48\u0E01\u0E32\u0E23\u0E1E\u0E31\u0E12\u0E19\u0E32\u0E2D\u0E32\u0E0A\u0E35\u0E1E\u0E41\u0E25\u0E30\u0E42\u0E23\u0E07\u0E40\u0E23\u0E35\u0E22\u0E19\u0E22\u0E38\u0E04\u0E43\u0E2B\u0E21\u0E48",
    "\u0E40\u0E0A\u0E37\u0E48\u0E2D\u0E21\u0E2A\u0E30\u0E1E\u0E32\u0E19\u0E20\u0E32\u0E29\u0E32 \u0E17\u0E31\u0E01\u0E29\u0E30\u0E2D\u0E32\u0E0A\u0E35\u0E1E \u0E41\u0E25\u0E30\u0E04\u0E27\u0E32\u0E21\u0E23\u0E48\u0E27\u0E21\u0E21\u0E37\u0E2D\u0E02\u0E49\u0E32\u0E21\u0E1E\u0E23\u0E21\u0E41\u0E14\u0E19",
    "\u0E16\u0E2D\u0E14\u0E1A\u0E17\u0E40\u0E23\u0E35\u0E22\u0E19\u0E01\u0E32\u0E23\u0E1E\u0E31\u0E12\u0E19\u0E32\u0E42\u0E23\u0E07\u0E40\u0E23\u0E35\u0E22\u0E19\u0E20\u0E32\u0E29\u0E32\u0E41\u0E25\u0E30\u0E2D\u0E32\u0E0A\u0E35\u0E1E \u0E44\u0E17\u0E22-\u0E40\u0E21\u0E35\u0E22\u0E19\u0E21\u0E32 \u0E41\u0E25\u0E30\u0E01\u0E32\u0E23\u0E1B\u0E23\u0E31\u0E1A\u0E15\u0E31\u0E27\u0E02\u0E2D\u0E07\u0E42\u0E23\u0E07\u0E40\u0E23\u0E35\u0E22\u0E19\u0E40\u0E2D\u0E01\u0E0A\u0E19-\u0E42\u0E23\u0E07\u0E40\u0E23\u0E35\u0E22\u0E19\u0E02\u0E19\u0E32\u0E14\u0E40\u0E25\u0E47\u0E01\u0E43\u0E19\u0E42\u0E25\u0E01\u0E01\u0E32\u0E23\u0E28\u0E36\u0E01\u0E29\u0E32\u0E22\u0E38\u0E04\u0E43\u0E2B\u0E21\u0E48\u0E40\u0E1E\u0E37\u0E48\u0E2D\u0E2A\u0E23\u0E49\u0E32\u0E07\u0E17\u0E31\u0E01\u0E29\u0E30\u0E17\u0E35\u0E48\u0E15\u0E25\u0E32\u0E14\u0E07\u0E32\u0E19\u0E15\u0E49\u0E2D\u0E07\u0E01\u0E32\u0E23\u0E08\u0E23\u0E34\u0E07",
    `## \u0E42\u0E21\u0E40\u0E14\u0E25\u0E01\u0E32\u0E23\u0E28\u0E36\u0E01\u0E29\u0E32\u0E17\u0E35\u0E48\u0E15\u0E2D\u0E1A\u0E42\u0E08\u0E17\u0E22\u0E4C\u0E0A\u0E35\u0E27\u0E34\u0E15\u0E08\u0E23\u0E34\u0E07\u0E41\u0E25\u0E30\u0E40\u0E28\u0E23\u0E29\u0E10\u0E01\u0E34\u0E08\u0E23\u0E30\u0E14\u0E31\u0E1A\u0E20\u0E39\u0E21\u0E34\u0E20\u0E32\u0E04

\u0E43\u0E19\u0E42\u0E25\u0E01\u0E01\u0E32\u0E23\u0E28\u0E36\u0E01\u0E29\u0E32\u0E22\u0E38\u0E04\u0E43\u0E2B\u0E21\u0E48 \u0E42\u0E23\u0E07\u0E40\u0E23\u0E35\u0E22\u0E19\u0E44\u0E21\u0E48\u0E44\u0E14\u0E49\u0E21\u0E35\u0E2B\u0E19\u0E49\u0E32\u0E17\u0E35\u0E48\u0E40\u0E1E\u0E35\u0E22\u0E07\u0E2A\u0E48\u0E07\u0E15\u0E48\u0E2D\u0E43\u0E1A\u0E1B\u0E23\u0E34\u0E0D\u0E0D\u0E32 \u0E41\u0E15\u0E48\u0E04\u0E37\u0E2D **"\u0E1E\u0E37\u0E49\u0E19\u0E17\u0E35\u0E48\u0E1A\u0E48\u0E21\u0E40\u0E1E\u0E32\u0E30\u0E17\u0E31\u0E01\u0E29\u0E30\u0E0A\u0E35\u0E27\u0E34\u0E15 \u0E20\u0E32\u0E29\u0E32 \u0E41\u0E25\u0E30\u0E2D\u0E32\u0E0A\u0E35\u0E1E"** \u0E17\u0E35\u0E48\u0E2A\u0E32\u0E21\u0E32\u0E23\u0E16\u0E22\u0E01\u0E23\u0E30\u0E14\u0E31\u0E1A\u0E04\u0E38\u0E13\u0E20\u0E32\u0E1E\u0E0A\u0E35\u0E27\u0E34\u0E15\u0E02\u0E2D\u0E07\u0E1C\u0E39\u0E49\u0E40\u0E23\u0E35\u0E22\u0E19\u0E41\u0E25\u0E30\u0E04\u0E23\u0E2D\u0E1A\u0E04\u0E23\u0E31\u0E27\u0E44\u0E14\u0E49\u0E17\u0E31\u0E19\u0E17\u0E35

### \u0E08\u0E38\u0E14\u0E40\u0E14\u0E48\u0E19\u0E02\u0E2D\u0E07\u0E42\u0E21\u0E40\u0E14\u0E25\u0E42\u0E23\u0E07\u0E40\u0E23\u0E35\u0E22\u0E19\u0E20\u0E32\u0E29\u0E32\u0E41\u0E25\u0E30\u0E2D\u0E32\u0E0A\u0E35\u0E1E \u0E44\u0E17\u0E22-\u0E40\u0E21\u0E35\u0E22\u0E19\u0E21\u0E32
1. **\u0E2B\u0E25\u0E31\u0E01\u0E2A\u0E39\u0E15\u0E23\u0E20\u0E32\u0E29\u0E32\u0E41\u0E25\u0E30\u0E2D\u0E32\u0E0A\u0E35\u0E1E\u0E40\u0E0A\u0E34\u0E07\u0E1B\u0E0F\u0E34\u0E1A\u0E31\u0E15\u0E34 (Language & Vocational Integration):** \u0E1A\u0E39\u0E23\u0E13\u0E32\u0E01\u0E32\u0E23\u0E20\u0E32\u0E29\u0E32\u0E44\u0E17\u0E22 \u0E20\u0E32\u0E29\u0E32\u0E2D\u0E31\u0E07\u0E01\u0E24\u0E29 \u0E20\u0E32\u0E29\u0E32\u0E40\u0E21\u0E35\u0E22\u0E19\u0E21\u0E32 \u0E40\u0E02\u0E49\u0E32\u0E01\u0E31\u0E1A\u0E17\u0E31\u0E01\u0E29\u0E30\u0E27\u0E34\u0E0A\u0E32\u0E0A\u0E35\u0E1E\u0E1A\u0E23\u0E34\u0E01\u0E32\u0E23 \u0E14\u0E34\u0E08\u0E34\u0E17\u0E31\u0E25 \u0E41\u0E25\u0E30\u0E01\u0E32\u0E23\u0E1A\u0E23\u0E34\u0E2B\u0E32\u0E23\u0E08\u0E31\u0E14\u0E01\u0E32\u0E23
2. **\u0E04\u0E27\u0E32\u0E21\u0E23\u0E48\u0E27\u0E21\u0E21\u0E37\u0E2D\u0E44\u0E17\u0E22-\u0E40\u0E21\u0E35\u0E22\u0E19\u0E21\u0E32\u0E2D\u0E22\u0E48\u0E32\u0E07\u0E2A\u0E23\u0E49\u0E32\u0E07\u0E2A\u0E23\u0E23\u0E04\u0E4C:** \u0E2A\u0E23\u0E49\u0E32\u0E07\u0E04\u0E27\u0E32\u0E21\u0E40\u0E02\u0E49\u0E32\u0E43\u0E08\u0E17\u0E32\u0E07\u0E27\u0E31\u0E12\u0E19\u0E18\u0E23\u0E23\u0E21 \u0E21\u0E32\u0E15\u0E23\u0E10\u0E32\u0E19\u0E41\u0E23\u0E07\u0E07\u0E32\u0E19\u0E17\u0E35\u0E48\u0E21\u0E35\u0E17\u0E31\u0E01\u0E29\u0E30 \u0E41\u0E25\u0E30\u0E40\u0E04\u0E23\u0E37\u0E2D\u0E02\u0E48\u0E32\u0E22\u0E1E\u0E31\u0E19\u0E18\u0E21\u0E34\u0E15\u0E23\u0E2A\u0E16\u0E32\u0E19\u0E1B\u0E23\u0E30\u0E01\u0E2D\u0E1A\u0E01\u0E32\u0E23
3. **\u0E17\u0E32\u0E07\u0E23\u0E2D\u0E14\u0E02\u0E2D\u0E07\u0E42\u0E23\u0E07\u0E40\u0E23\u0E35\u0E22\u0E19\u0E02\u0E19\u0E32\u0E14\u0E40\u0E25\u0E47\u0E01\u0E41\u0E25\u0E30\u0E42\u0E23\u0E07\u0E40\u0E23\u0E35\u0E22\u0E19\u0E40\u0E2D\u0E01\u0E0A\u0E19:** \u0E01\u0E32\u0E23\u0E2A\u0E23\u0E49\u0E32\u0E07\u0E2D\u0E31\u0E15\u0E25\u0E31\u0E01\u0E29\u0E13\u0E4C\u0E40\u0E09\u0E1E\u0E32\u0E30\u0E17\u0E32\u0E07 (Niche Positioning) \u0E17\u0E35\u0E48\u0E22\u0E37\u0E14\u0E2B\u0E22\u0E38\u0E48\u0E19 \u0E17\u0E31\u0E19\u0E2A\u0E21\u0E31\u0E22 \u0E41\u0E25\u0E30\u0E40\u0E0A\u0E37\u0E48\u0E2D\u0E21\u0E15\u0E23\u0E07\u0E2A\u0E39\u0E48\u0E42\u0E2D\u0E01\u0E32\u0E2A\u0E01\u0E32\u0E23\u0E17\u0E33\u0E07\u0E32\u0E19\u0E23\u0E30\u0E14\u0E31\u0E1A\u0E2A\u0E32\u0E01\u0E25`,
    "education",
    "article",
    "/images/thumb-school.jpg",
    "",
    JSON.stringify(["\u0E01\u0E32\u0E23\u0E28\u0E36\u0E01\u0E29\u0E32", "\u0E44\u0E17\u0E22-\u0E40\u0E21\u0E35\u0E22\u0E19\u0E21\u0E32", "\u0E1E\u0E31\u0E12\u0E19\u0E32\u0E2D\u0E32\u0E0A\u0E35\u0E1E", "\u0E42\u0E23\u0E07\u0E40\u0E23\u0E35\u0E22\u0E19\u0E40\u0E2D\u0E01\u0E0A\u0E19"]),
    "\u0E04\u0E21\u0E01\u0E24\u0E0A (Komkrit)",
    "published",
    0,
    1820,
    "2025-09-11T08:15:00.000Z",
    "2025-09-11T08:15:00.000Z"
  );
  insertPost.run(
    "\u0E20\u0E39\u0E40\u0E01\u0E47\u0E15 \u0E28\u0E39\u0E19\u0E22\u0E4C\u0E01\u0E25\u0E32\u0E07\u0E01\u0E32\u0E23\u0E40\u0E23\u0E35\u0E22\u0E19\u0E23\u0E39\u0E49\u0E15\u0E25\u0E2D\u0E14\u0E0A\u0E35\u0E27\u0E34\u0E15 (Lifelong Learning Center)",
    "\u0E08\u0E32\u0E01\u0E40\u0E21\u0E37\u0E2D\u0E07\u0E17\u0E48\u0E2D\u0E07\u0E40\u0E17\u0E35\u0E48\u0E22\u0E27\u0E23\u0E30\u0E14\u0E31\u0E1A\u0E42\u0E25\u0E01 \u0E2A\u0E39\u0E48\u0E15\u0E49\u0E19\u0E41\u0E1A\u0E1A\u0E19\u0E34\u0E40\u0E27\u0E28\u0E01\u0E32\u0E23\u0E40\u0E23\u0E35\u0E22\u0E19\u0E23\u0E39\u0E49\u0E19\u0E32\u0E19\u0E32\u0E0A\u0E32\u0E15\u0E34",
    "\u0E28\u0E31\u0E01\u0E22\u0E20\u0E32\u0E1E\u0E02\u0E2D\u0E07\u0E08\u0E31\u0E07\u0E2B\u0E27\u0E31\u0E14\u0E20\u0E39\u0E40\u0E01\u0E47\u0E15\u0E43\u0E19\u0E01\u0E32\u0E23\u0E01\u0E49\u0E32\u0E27\u0E02\u0E36\u0E49\u0E19\u0E40\u0E1B\u0E47\u0E19\u0E28\u0E39\u0E19\u0E22\u0E4C\u0E01\u0E25\u0E32\u0E07\u0E01\u0E32\u0E23\u0E40\u0E23\u0E35\u0E22\u0E19\u0E23\u0E39\u0E49\u0E15\u0E25\u0E2D\u0E14\u0E0A\u0E35\u0E27\u0E34\u0E15 (Lifelong Learning Hub) \u0E17\u0E35\u0E48\u0E40\u0E0A\u0E37\u0E48\u0E2D\u0E21\u0E42\u0E22\u0E07\u0E01\u0E32\u0E23\u0E17\u0E48\u0E2D\u0E07\u0E40\u0E17\u0E35\u0E48\u0E22\u0E27 \u0E19\u0E27\u0E31\u0E15\u0E01\u0E23\u0E23\u0E21 \u0E14\u0E34\u0E08\u0E34\u0E17\u0E31\u0E25 \u0E41\u0E25\u0E30\u0E1C\u0E39\u0E49\u0E40\u0E23\u0E35\u0E22\u0E19\u0E08\u0E32\u0E01\u0E17\u0E31\u0E48\u0E27\u0E42\u0E25\u0E01",
    `## \u0E17\u0E33\u0E44\u0E21 "\u0E20\u0E39\u0E40\u0E01\u0E47\u0E15" \u0E08\u0E36\u0E07\u0E21\u0E35\u0E28\u0E31\u0E01\u0E22\u0E20\u0E32\u0E1E\u0E40\u0E1B\u0E47\u0E19 Lifelong Learning Center \u0E23\u0E30\u0E14\u0E31\u0E1A\u0E19\u0E32\u0E19\u0E32\u0E0A\u0E32\u0E15\u0E34?

\u0E20\u0E39\u0E40\u0E01\u0E47\u0E15\u0E44\u0E21\u0E48\u0E44\u0E14\u0E49\u0E21\u0E35\u0E40\u0E1E\u0E35\u0E22\u0E07\u0E17\u0E23\u0E31\u0E1E\u0E22\u0E32\u0E01\u0E23\u0E18\u0E23\u0E23\u0E21\u0E0A\u0E32\u0E15\u0E34\u0E41\u0E25\u0E30\u0E2D\u0E38\u0E15\u0E2A\u0E32\u0E2B\u0E01\u0E23\u0E23\u0E21\u0E01\u0E32\u0E23\u0E17\u0E48\u0E2D\u0E07\u0E40\u0E17\u0E35\u0E48\u0E22\u0E27\u0E23\u0E30\u0E14\u0E31\u0E1A\u0E42\u0E25\u0E01\u0E40\u0E17\u0E48\u0E32\u0E19\u0E31\u0E49\u0E19 \u0E41\u0E15\u0E48\u0E22\u0E31\u0E07\u0E40\u0E1B\u0E47\u0E19\u0E08\u0E38\u0E14\u0E15\u0E31\u0E14\u0E02\u0E2D\u0E07\u0E1E\u0E2B\u0E38\u0E27\u0E31\u0E12\u0E19\u0E18\u0E23\u0E23\u0E21 \u0E40\u0E04\u0E23\u0E37\u0E2D\u0E02\u0E48\u0E32\u0E22\u0E42\u0E23\u0E07\u0E40\u0E23\u0E35\u0E22\u0E19\u0E19\u0E32\u0E19\u0E32\u0E0A\u0E32\u0E15\u0E34 \u0E1C\u0E39\u0E49\u0E1B\u0E23\u0E30\u0E01\u0E2D\u0E1A\u0E01\u0E32\u0E23\u0E23\u0E38\u0E48\u0E19\u0E43\u0E2B\u0E21\u0E48 \u0E41\u0E25\u0E30\u0E0A\u0E38\u0E21\u0E0A\u0E19\u0E14\u0E34\u0E08\u0E34\u0E17\u0E31\u0E25\u0E08\u0E32\u0E01\u0E17\u0E31\u0E48\u0E27\u0E42\u0E25\u0E01

### 4 \u0E40\u0E2A\u0E32\u0E2B\u0E25\u0E31\u0E01\u0E43\u0E19\u0E01\u0E32\u0E23\u0E02\u0E31\u0E1A\u0E40\u0E04\u0E25\u0E37\u0E48\u0E2D\u0E19 Phuket Lifelong Learning Center
- **Hospitality & Service Innovation:** \u0E22\u0E01\u0E23\u0E30\u0E14\u0E31\u0E1A\u0E17\u0E31\u0E01\u0E29\u0E30\u0E01\u0E32\u0E23\u0E1A\u0E23\u0E34\u0E01\u0E32\u0E23\u0E41\u0E25\u0E30\u0E01\u0E32\u0E23\u0E08\u0E31\u0E14\u0E01\u0E32\u0E23\u0E21\u0E32\u0E15\u0E23\u0E10\u0E32\u0E19\u0E42\u0E25\u0E01
- **Multilingual & Cross-Cultural Hub:** \u0E28\u0E39\u0E19\u0E22\u0E4C\u0E01\u0E25\u0E32\u0E07\u0E01\u0E32\u0E23\u0E40\u0E23\u0E35\u0E22\u0E19\u0E23\u0E39\u0E49\u0E20\u0E32\u0E29\u0E32\u0E41\u0E25\u0E30\u0E17\u0E31\u0E01\u0E29\u0E30\u0E2A\u0E37\u0E48\u0E2D\u0E2A\u0E32\u0E23\u0E02\u0E49\u0E32\u0E21\u0E27\u0E31\u0E12\u0E19\u0E18\u0E23\u0E23\u0E21
- **Digital Nomad & AI Upskilling:** \u0E1E\u0E37\u0E49\u0E19\u0E17\u0E35\u0E48\u0E08\u0E31\u0E14\u0E40\u0E27\u0E34\u0E23\u0E4C\u0E01\u0E0A\u0E47\u0E2D\u0E1B \u0E2A\u0E31\u0E21\u0E21\u0E19\u0E32 \u0E41\u0E25\u0E30\u0E41\u0E25\u0E01\u0E40\u0E1B\u0E25\u0E35\u0E48\u0E22\u0E19\u0E2D\u0E07\u0E04\u0E4C\u0E04\u0E27\u0E32\u0E21\u0E23\u0E39\u0E49\u0E14\u0E49\u0E32\u0E19\u0E40\u0E17\u0E04\u0E42\u0E19\u0E42\u0E25\u0E22\u0E35\u0E41\u0E25\u0E30\u0E18\u0E38\u0E23\u0E01\u0E34\u0E08\u0E2A\u0E23\u0E49\u0E32\u0E07\u0E2A\u0E23\u0E23\u0E04\u0E4C
- **Community Learning Spaces:** \u0E40\u0E1B\u0E34\u0E14\u0E1E\u0E37\u0E49\u0E19\u0E17\u0E35\u0E48\u0E01\u0E32\u0E23\u0E40\u0E23\u0E35\u0E22\u0E19\u0E23\u0E39\u0E49\u0E2A\u0E33\u0E2B\u0E23\u0E31\u0E1A\u0E04\u0E19\u0E17\u0E38\u0E01\u0E0A\u0E48\u0E27\u0E07\u0E27\u0E31\u0E22 \u0E15\u0E31\u0E49\u0E07\u0E41\u0E15\u0E48\u0E40\u0E22\u0E32\u0E27\u0E0A\u0E19 \u0E27\u0E31\u0E22\u0E17\u0E33\u0E07\u0E32\u0E19 \u0E44\u0E1B\u0E08\u0E19\u0E16\u0E36\u0E07\u0E1C\u0E39\u0E49\u0E2A\u0E39\u0E07\u0E2D\u0E32\u0E22\u0E38`,
    "international",
    "article",
    "/images/thumb-phuket.jpg",
    "",
    JSON.stringify(["\u0E20\u0E39\u0E40\u0E01\u0E47\u0E15", "Lifelong Learning", "\u0E15\u0E48\u0E32\u0E07\u0E1B\u0E23\u0E30\u0E40\u0E17\u0E28", "\u0E40\u0E21\u0E37\u0E2D\u0E07\u0E41\u0E2B\u0E48\u0E07\u0E01\u0E32\u0E23\u0E40\u0E23\u0E35\u0E22\u0E19\u0E23\u0E39\u0E49"]),
    "\u0E04\u0E21\u0E01\u0E24\u0E0A (Komkrit)",
    "published",
    0,
    1260,
    "2025-09-09T14:00:00.000Z",
    "2025-09-09T14:00:00.000Z"
  );
  insertPost.run(
    "AI Agentic : \u0E2D\u0E19\u0E32\u0E04\u0E15\u0E02\u0E2D\u0E07\u0E01\u0E32\u0E23\u0E17\u0E33\u0E07\u0E32\u0E19\u0E41\u0E25\u0E30\u0E01\u0E32\u0E23\u0E28\u0E36\u0E01\u0E29\u0E32",
    "\u0E40\u0E21\u0E37\u0E48\u0E2D AI \u0E17\u0E33\u0E07\u0E32\u0E19\u0E40\u0E1B\u0E47\u0E19\u0E17\u0E35\u0E21 (Multi-Agent Ecosystem) \u0E40\u0E1E\u0E37\u0E48\u0E2D\u0E2A\u0E23\u0E49\u0E32\u0E07\u0E1C\u0E25\u0E25\u0E31\u0E1E\u0E18\u0E4C\u0E04\u0E38\u0E13\u0E20\u0E32\u0E1E\u0E2A\u0E39\u0E07",
    "\u0E17\u0E33\u0E04\u0E27\u0E32\u0E21\u0E23\u0E39\u0E49\u0E08\u0E31\u0E01\u0E23\u0E30\u0E1A\u0E1A Multi-Agent AI \u0E15\u0E31\u0E49\u0E07\u0E41\u0E15\u0E48 CEO Agent, Research Agent, Content & QA Agent \u0E44\u0E1B\u0E08\u0E19\u0E16\u0E36\u0E07\u0E01\u0E32\u0E23\u0E21\u0E35\u0E21\u0E19\u0E38\u0E29\u0E22\u0E4C\u0E40\u0E1B\u0E47\u0E19\u0E1C\u0E39\u0E49\u0E15\u0E23\u0E27\u0E08\u0E2A\u0E2D\u0E1A\u0E41\u0E25\u0E30\u0E15\u0E31\u0E14\u0E2A\u0E34\u0E19\u0E43\u0E08 (Human-in-the-Loop)",
    `## \u0E08\u0E32\u0E01 Chatbot \u0E2A\u0E39\u0E48\u0E23\u0E30\u0E1A\u0E1A Multi-Agent AI \u0E17\u0E35\u0E48\u0E17\u0E33\u0E07\u0E32\u0E19\u0E40\u0E1B\u0E47\u0E19\u0E17\u0E35\u0E21

\u0E01\u0E49\u0E32\u0E27\u0E15\u0E48\u0E2D\u0E44\u0E1B\u0E02\u0E2D\u0E07\u0E1B\u0E31\u0E0D\u0E0D\u0E32\u0E1B\u0E23\u0E30\u0E14\u0E34\u0E29\u0E10\u0E4C\u0E04\u0E37\u0E2D **Agentic AI** \u2014 \u0E23\u0E30\u0E1A\u0E1A\u0E17\u0E35\u0E48 AI \u0E41\u0E15\u0E48\u0E25\u0E30\u0E15\u0E31\u0E27\u0E44\u0E14\u0E49\u0E23\u0E31\u0E1A\u0E1A\u0E17\u0E1A\u0E32\u0E17\u0E40\u0E09\u0E1E\u0E32\u0E30\u0E17\u0E32\u0E07 \u0E17\u0E33\u0E07\u0E32\u0E19\u0E1B\u0E23\u0E30\u0E2A\u0E32\u0E19\u0E01\u0E31\u0E19\u0E2D\u0E22\u0E48\u0E32\u0E07\u0E40\u0E1B\u0E47\u0E19\u0E23\u0E30\u0E1A\u0E1A\u0E20\u0E32\u0E22\u0E43\u0E15\u0E49\u0E01\u0E32\u0E23\u0E01\u0E33\u0E01\u0E31\u0E1A\u0E14\u0E39\u0E41\u0E25\u0E02\u0E2D\u0E07\u0E21\u0E19\u0E38\u0E29\u0E22\u0E4C (**AI + Human = Greater Impact**)

### \u0E42\u0E04\u0E23\u0E07\u0E2A\u0E23\u0E49\u0E32\u0E07\u0E01\u0E32\u0E23\u0E17\u0E33\u0E07\u0E32\u0E19\u0E41\u0E1A\u0E1A Multi-Agent \u0E02\u0E2D\u0E07 \u0E04\u0E21\u0E04\u0E34\u0E14 by KOMKRIT
- **CEO Agent (Command Center):** \u0E27\u0E34\u0E40\u0E04\u0E23\u0E32\u0E30\u0E2B\u0E4C\u0E42\u0E08\u0E17\u0E22\u0E4C \u0E27\u0E32\u0E07\u0E01\u0E25\u0E22\u0E38\u0E17\u0E18\u0E4C \u0E41\u0E25\u0E30\u0E01\u0E23\u0E30\u0E08\u0E32\u0E22\u0E07\u0E32\u0E19\u0E43\u0E2B\u0E49\u0E17\u0E35\u0E21 Agent \u0E2D\u0E31\u0E15\u0E42\u0E19\u0E21\u0E31\u0E15\u0E34
- **Content & Research Agent:** \u0E04\u0E49\u0E19\u0E04\u0E27\u0E49\u0E32\u0E02\u0E49\u0E2D\u0E21\u0E39\u0E25\u0E40\u0E0A\u0E34\u0E07\u0E25\u0E36\u0E01\u0E08\u0E32\u0E01\u0E10\u0E32\u0E19\u0E04\u0E27\u0E32\u0E21\u0E23\u0E39\u0E49 (Knowledge Base) \u0E27\u0E34\u0E40\u0E04\u0E23\u0E32\u0E30\u0E2B\u0E4C\u0E41\u0E19\u0E27\u0E42\u0E19\u0E49\u0E21 \u0E41\u0E25\u0E30\u0E40\u0E02\u0E35\u0E22\u0E19\u0E2A\u0E04\u0E23\u0E34\u0E1B\u0E15\u0E4C/\u0E1A\u0E17\u0E04\u0E27\u0E32\u0E21
- **Creative & Production Agents:** \u0E2D\u0E2D\u0E01\u0E41\u0E1A\u0E1A\u0E42\u0E04\u0E23\u0E07\u0E2A\u0E23\u0E49\u0E32\u0E07\u0E20\u0E32\u0E1E \u0E2D\u0E34\u0E19\u0E42\u0E1F\u0E01\u0E23\u0E32\u0E1F\u0E34\u0E01 \u0E2A\u0E15\u0E2D\u0E23\u0E35\u0E48\u0E1A\u0E2D\u0E23\u0E4C\u0E14\u0E27\u0E34\u0E14\u0E35\u0E42\u0E2D \u0E41\u0E25\u0E30\u0E1A\u0E17\u0E1E\u0E32\u0E01\u0E22\u0E4C\u0E40\u0E2A\u0E35\u0E22\u0E07
- **QA Agent (Quality Assurance):** \u0E15\u0E23\u0E27\u0E08\u0E2A\u0E2D\u0E1A\u0E04\u0E27\u0E32\u0E21\u0E16\u0E39\u0E01\u0E15\u0E49\u0E2D\u0E07 (Fact Check), \u0E20\u0E32\u0E29\u0E32 (Language), \u0E20\u0E32\u0E1E\u0E25\u0E31\u0E01\u0E29\u0E13\u0E4C\u0E41\u0E1A\u0E23\u0E19\u0E14\u0E4C (Brand) \u0E41\u0E25\u0E30\u0E04\u0E27\u0E32\u0E21\u0E40\u0E2A\u0E35\u0E48\u0E22\u0E07 (Risk)
- **Human Approval:** \u0E21\u0E19\u0E38\u0E29\u0E22\u0E4C\u0E22\u0E31\u0E07\u0E04\u0E07\u0E40\u0E1B\u0E47\u0E19\u0E2B\u0E31\u0E27\u0E43\u0E08\u0E2A\u0E33\u0E04\u0E31\u0E0D\u0E43\u0E19\u0E01\u0E32\u0E23\u0E15\u0E23\u0E27\u0E08\u0E2A\u0E2D\u0E1A \u0E2D\u0E19\u0E38\u0E21\u0E31\u0E15\u0E34 \u0E41\u0E25\u0E30\u0E40\u0E15\u0E34\u0E21\u0E40\u0E15\u0E47\u0E21\u0E08\u0E34\u0E15\u0E27\u0E34\u0E0D\u0E0D\u0E32\u0E13\u0E02\u0E2D\u0E07\u0E40\u0E19\u0E37\u0E49\u0E2D\u0E2B\u0E32\u0E01\u0E48\u0E2D\u0E19\u0E40\u0E1C\u0E22\u0E41\u0E1E\u0E23\u0E48\u0E2A\u0E39\u0E48\u0E17\u0E38\u0E01\u0E0A\u0E48\u0E2D\u0E07\u0E17\u0E32\u0E07`,
    "innovation",
    "article",
    "/images/thumb-agentic.jpg",
    "https://www.youtube.com/watch?v=VxQwQ9vQkkc",
    JSON.stringify(["AI Agentic", "\u0E19\u0E27\u0E31\u0E15\u0E01\u0E23\u0E23\u0E21", "Multi-Agent", "\u0E2D\u0E19\u0E32\u0E04\u0E15\u0E01\u0E32\u0E23\u0E17\u0E33\u0E07\u0E32\u0E19"]),
    "\u0E04\u0E21\u0E01\u0E24\u0E0A (Komkrit)",
    "published",
    0,
    1432,
    "2025-09-07T11:20:00.000Z",
    "2025-09-07T11:20:00.000Z"
  );
  insertPost.run(
    "[\u0E27\u0E34\u0E14\u0E35\u0E42\u0E2D\u0E1E\u0E34\u0E40\u0E28\u0E29] \u0E04\u0E34\u0E14\u0E15\u0E48\u0E32\u0E07\u0E2D\u0E22\u0E48\u0E32\u0E07\u0E2A\u0E23\u0E49\u0E32\u0E07\u0E2A\u0E23\u0E23\u0E04\u0E4C: \u0E1E\u0E25\u0E34\u0E01\u0E42\u0E09\u0E21\u0E04\u0E2D\u0E19\u0E40\u0E17\u0E19\u0E15\u0E4C\u0E01\u0E32\u0E23\u0E28\u0E36\u0E01\u0E29\u0E32\u0E14\u0E49\u0E27\u0E22\u0E23\u0E30\u0E1A\u0E1A AI Multi-Agent",
    "\u0E40\u0E08\u0E32\u0E30\u0E25\u0E36\u0E01\u0E40\u0E1A\u0E37\u0E49\u0E2D\u0E07\u0E2B\u0E25\u0E31\u0E07\u0E01\u0E32\u0E23\u0E17\u0E33\u0E07\u0E32\u0E19 AI + Human = Greater Impact",
    "\u0E23\u0E31\u0E1A\u0E0A\u0E21\u0E41\u0E19\u0E27\u0E04\u0E34\u0E14\u0E01\u0E32\u0E23\u0E1B\u0E23\u0E30\u0E22\u0E38\u0E01\u0E15\u0E4C\u0E43\u0E0A\u0E49 AI Content Creation Flow \u0E40\u0E1E\u0E37\u0E48\u0E2D\u0E2A\u0E23\u0E49\u0E32\u0E07\u0E2A\u0E37\u0E48\u0E2D\u0E04\u0E27\u0E32\u0E21\u0E23\u0E39\u0E49\u0E04\u0E38\u0E13\u0E20\u0E32\u0E1E\u0E2A\u0E39\u0E07\u0E2A\u0E33\u0E2B\u0E23\u0E31\u0E1A\u0E04\u0E23\u0E39 \u0E1C\u0E39\u0E49\u0E1A\u0E23\u0E34\u0E2B\u0E32\u0E23\u0E2A\u0E16\u0E32\u0E19\u0E28\u0E36\u0E01\u0E29\u0E32 \u0E41\u0E25\u0E30\u0E1C\u0E39\u0E49\u0E40\u0E23\u0E35\u0E22\u0E19\u0E22\u0E38\u0E04\u0E43\u0E2B\u0E21\u0E48",
    `## \u0E27\u0E34\u0E14\u0E35\u0E42\u0E2D\u0E40\u0E08\u0E32\u0E30\u0E25\u0E36\u0E01: \u0E23\u0E30\u0E1A\u0E1A Agent \u0E2D\u0E31\u0E08\u0E09\u0E23\u0E34\u0E22\u0E30 \u0E2A\u0E23\u0E49\u0E32\u0E07\u0E04\u0E2D\u0E19\u0E40\u0E17\u0E19\u0E15\u0E4C\u0E01\u0E32\u0E23\u0E28\u0E36\u0E01\u0E29\u0E32\u0E04\u0E23\u0E1A\u0E27\u0E07\u0E08\u0E23

\u0E43\u0E19\u0E27\u0E34\u0E14\u0E35\u0E42\u0E2D\u0E15\u0E2D\u0E19\u0E19\u0E35\u0E49 \u0E04\u0E38\u0E13\u0E04\u0E21\u0E01\u0E24\u0E0A (Komkrit) \u0E1E\u0E32\u0E2A\u0E33\u0E23\u0E27\u0E08\u0E41\u0E19\u0E27\u0E04\u0E34\u0E14\u0E01\u0E32\u0E23\u0E1C\u0E2A\u0E32\u0E19\u0E1E\u0E25\u0E31\u0E07\u0E02\u0E2D\u0E07 **Multi-Agent AI** \u0E40\u0E02\u0E49\u0E32\u0E01\u0E31\u0E1A\u0E1B\u0E23\u0E30\u0E2A\u0E1A\u0E01\u0E32\u0E23\u0E13\u0E4C\u0E08\u0E23\u0E34\u0E07\u0E14\u0E49\u0E32\u0E19\u0E01\u0E32\u0E23\u0E1A\u0E23\u0E34\u0E2B\u0E32\u0E23\u0E01\u0E32\u0E23\u0E28\u0E36\u0E01\u0E29\u0E32 \u0E40\u0E1E\u0E37\u0E48\u0E2D\u0E2A\u0E23\u0E49\u0E32\u0E07\u0E40\u0E19\u0E37\u0E49\u0E2D\u0E2B\u0E32\u0E17\u0E35\u0E48\u0E17\u0E31\u0E49\u0E07\u0E16\u0E39\u0E01\u0E15\u0E49\u0E2D\u0E07 \u0E25\u0E36\u0E01\u0E0B\u0E36\u0E49\u0E07 \u0E40\u0E02\u0E49\u0E32\u0E43\u0E08\u0E07\u0E48\u0E32\u0E22 \u0E41\u0E25\u0E30\u0E2A\u0E23\u0E49\u0E32\u0E07\u0E1C\u0E25\u0E01\u0E23\u0E30\u0E17\u0E1A\u0E40\u0E0A\u0E34\u0E07\u0E1A\u0E27\u0E01\u0E15\u0E48\u0E2D\u0E2A\u0E31\u0E07\u0E04\u0E21

### \u0E44\u0E2E\u0E44\u0E25\u0E15\u0E4C\u0E2A\u0E33\u0E04\u0E31\u0E0D\u0E43\u0E19\u0E27\u0E34\u0E14\u0E35\u0E42\u0E2D
- \u0E27\u0E34\u0E18\u0E35\u0E40\u0E1B\u0E25\u0E35\u0E48\u0E22\u0E19\u0E44\u0E2D\u0E40\u0E14\u0E35\u0E22\u0E41\u0E25\u0E30\u0E07\u0E32\u0E19\u0E27\u0E34\u0E08\u0E31\u0E22\u0E43\u0E2B\u0E49\u0E01\u0E25\u0E32\u0E22\u0E40\u0E1B\u0E47\u0E19\u0E1A\u0E17\u0E04\u0E27\u0E32\u0E21 \u0E27\u0E34\u0E14\u0E35\u0E42\u0E2D\u0E2A\u0E31\u0E49\u0E19 \u0E41\u0E25\u0E30\u0E2A\u0E37\u0E48\u0E2D\u0E01\u0E32\u0E23\u0E2A\u0E2D\u0E19\u0E43\u0E19\u0E17\u0E35\u0E48\u0E40\u0E14\u0E35\u0E22\u0E27
- \u0E17\u0E33\u0E44\u0E21\u0E15\u0E49\u0E2D\u0E07\u0E21\u0E35 **QA Agent** \u0E41\u0E25\u0E30 **Human Approval** \u0E01\u0E48\u0E2D\u0E19\u0E40\u0E1C\u0E22\u0E41\u0E1E\u0E23\u0E48\u0E17\u0E38\u0E01\u0E04\u0E23\u0E31\u0E49\u0E07
- \u0E42\u0E21\u0E40\u0E14\u0E25\u0E18\u0E38\u0E23\u0E01\u0E34\u0E08\u0E04\u0E27\u0E32\u0E21\u0E23\u0E39\u0E49 **KOMKID 5-Pillar Business Model** (Content \u2192 Audience \u2192 Trust)`,
    "ai-tech",
    "video",
    "/images/featured-speaker.jpg",
    "https://www.youtube.com/watch?v=VxQwQ9vQkkc",
    JSON.stringify(["\u0E27\u0E34\u0E14\u0E35\u0E42\u0E2D", "AI Multi-Agent", "\u0E04\u0E21\u0E04\u0E34\u0E14 by KOMKRIT"]),
    "\u0E04\u0E21\u0E01\u0E24\u0E0A (Komkrit)",
    "published",
    0,
    2940,
    "2025-09-14T16:00:00.000Z",
    "2025-09-14T16:00:00.000Z"
  );
  insertPost.run(
    "Workshop: AI for Education & Multi-Agent Content Studio \u0E2A\u0E33\u0E2B\u0E23\u0E31\u0E1A\u0E1C\u0E39\u0E49\u0E1A\u0E23\u0E34\u0E2B\u0E32\u0E23\u0E41\u0E25\u0E30\u0E04\u0E23\u0E39\u0E22\u0E38\u0E04\u0E43\u0E2B\u0E21\u0E48",
    "\u0E2B\u0E25\u0E31\u0E01\u0E2A\u0E39\u0E15\u0E23\u0E40\u0E02\u0E49\u0E21\u0E02\u0E49\u0E19 \u0E25\u0E07\u0E21\u0E37\u0E2D\u0E2A\u0E23\u0E49\u0E32\u0E07\u0E23\u0E30\u0E1A\u0E1A\u0E1C\u0E39\u0E49\u0E0A\u0E48\u0E27\u0E22 AI \u0E1B\u0E23\u0E30\u0E08\u0E33\u0E42\u0E23\u0E07\u0E40\u0E23\u0E35\u0E22\u0E19\u0E20\u0E32\u0E22\u0E43\u0E19 1 \u0E27\u0E31\u0E19",
    "\u0E40\u0E27\u0E34\u0E23\u0E4C\u0E01\u0E0A\u0E47\u0E2D\u0E1B\u0E40\u0E0A\u0E34\u0E07\u0E1B\u0E0F\u0E34\u0E1A\u0E31\u0E15\u0E34\u0E01\u0E32\u0E23 \u0E2D\u0E2D\u0E01\u0E41\u0E1A\u0E1A\u0E2B\u0E25\u0E31\u0E01\u0E2A\u0E39\u0E15\u0E23 \u0E2A\u0E37\u0E48\u0E2D\u0E01\u0E32\u0E23\u0E2A\u0E2D\u0E19 \u0E41\u0E25\u0E30\u0E23\u0E30\u0E1A\u0E1A\u0E2A\u0E37\u0E48\u0E2D\u0E2A\u0E32\u0E23\u0E2D\u0E07\u0E04\u0E4C\u0E01\u0E23\u0E01\u0E32\u0E23\u0E28\u0E36\u0E01\u0E29\u0E32\u0E14\u0E49\u0E27\u0E22 AI \u0E2D\u0E22\u0E48\u0E32\u0E07\u0E21\u0E35\u0E21\u0E32\u0E15\u0E23\u0E10\u0E32\u0E19\u0E41\u0E25\u0E30\u0E08\u0E23\u0E34\u0E22\u0E18\u0E23\u0E23\u0E21",
    `## \u0E22\u0E01\u0E23\u0E30\u0E14\u0E31\u0E1A\u0E17\u0E35\u0E21\u0E04\u0E23\u0E39\u0E41\u0E25\u0E30\u0E1A\u0E38\u0E04\u0E25\u0E32\u0E01\u0E23\u0E17\u0E32\u0E07\u0E01\u0E32\u0E23\u0E28\u0E36\u0E01\u0E29\u0E32\u0E14\u0E49\u0E27\u0E22 AI \u0E40\u0E0A\u0E34\u0E07\u0E01\u0E25\u0E22\u0E38\u0E17\u0E18\u0E4C

\u0E2B\u0E25\u0E31\u0E01\u0E2A\u0E39\u0E15\u0E23\u0E40\u0E27\u0E34\u0E23\u0E4C\u0E01\u0E0A\u0E47\u0E2D\u0E1B\u0E17\u0E35\u0E48\u0E2D\u0E2D\u0E01\u0E41\u0E1A\u0E1A\u0E21\u0E32\u0E40\u0E1E\u0E37\u0E48\u0E2D\u0E1C\u0E39\u0E49\u0E1A\u0E23\u0E34\u0E2B\u0E32\u0E23\u0E2A\u0E16\u0E32\u0E19\u0E28\u0E36\u0E01\u0E29\u0E32 \u0E04\u0E23\u0E39 \u0E41\u0E25\u0E30\u0E17\u0E35\u0E21\u0E1C\u0E25\u0E34\u0E15\u0E2A\u0E37\u0E48\u0E2D\u0E01\u0E32\u0E23\u0E28\u0E36\u0E01\u0E29\u0E32\u0E42\u0E14\u0E22\u0E40\u0E09\u0E1E\u0E32\u0E30 \u0E40\u0E19\u0E49\u0E19\u0E01\u0E32\u0E23\u0E19\u0E33\u0E44\u0E1B\u0E43\u0E0A\u0E49\u0E07\u0E32\u0E19\u0E44\u0E14\u0E49\u0E08\u0E23\u0E34\u0E07\u0E17\u0E31\u0E19\u0E17\u0E35

### \u0E2A\u0E34\u0E48\u0E07\u0E17\u0E35\u0E48\u0E1C\u0E39\u0E49\u0E40\u0E02\u0E49\u0E32\u0E2D\u0E1A\u0E23\u0E21\u0E08\u0E30\u0E44\u0E14\u0E49\u0E23\u0E31\u0E1A
1. **\u0E01\u0E32\u0E23\u0E2A\u0E23\u0E49\u0E32\u0E07\u0E10\u0E32\u0E19\u0E04\u0E27\u0E32\u0E21\u0E23\u0E39\u0E49\u0E02\u0E2D\u0E07\u0E42\u0E23\u0E07\u0E40\u0E23\u0E35\u0E22\u0E19 (School Knowledge Base)** \u0E40\u0E1E\u0E37\u0E48\u0E2D\u0E43\u0E2B\u0E49 AI \u0E15\u0E2D\u0E1A\u0E41\u0E25\u0E30\u0E2A\u0E23\u0E49\u0E32\u0E07\u0E2A\u0E37\u0E48\u0E2D\u0E15\u0E23\u0E07\u0E15\u0E32\u0E21\u0E1A\u0E23\u0E34\u0E1A\u0E17\u0E2B\u0E25\u0E31\u0E01\u0E2A\u0E39\u0E15\u0E23\u0E08\u0E23\u0E34\u0E07
2. **\u0E01\u0E32\u0E23\u0E27\u0E32\u0E07\u0E23\u0E30\u0E1A\u0E1A Multi-Agent Workflow** \u0E15\u0E31\u0E49\u0E07\u0E41\u0E15\u0E48\u0E07\u0E32\u0E19\u0E27\u0E34\u0E08\u0E31\u0E22 \u0E2D\u0E2D\u0E01\u0E41\u0E1A\u0E1A\u0E41\u0E1C\u0E19\u0E01\u0E32\u0E23\u0E2A\u0E2D\u0E19 \u0E2A\u0E23\u0E49\u0E32\u0E07\u0E2D\u0E34\u0E19\u0E42\u0E1F\u0E01\u0E23\u0E32\u0E1F\u0E34\u0E01 \u0E44\u0E1B\u0E08\u0E19\u0E16\u0E36\u0E07\u0E01\u0E32\u0E23\u0E15\u0E23\u0E27\u0E08\u0E04\u0E38\u0E13\u0E20\u0E32\u0E1E (QA)
3. **Workshop \u0E25\u0E07\u0E21\u0E37\u0E2D\u0E1B\u0E0F\u0E34\u0E1A\u0E31\u0E15\u0E34\u0E08\u0E23\u0E34\u0E07** \u0E1E\u0E23\u0E49\u0E2D\u0E21\u0E40\u0E17\u0E21\u0E40\u0E1E\u0E25\u0E15\u0E04\u0E33\u0E2A\u0E31\u0E48\u0E07\u0E41\u0E25\u0E30\u0E41\u0E19\u0E27\u0E17\u0E32\u0E07\u0E08\u0E23\u0E34\u0E22\u0E18\u0E23\u0E23\u0E21\u0E01\u0E32\u0E23\u0E43\u0E0A\u0E49 AI \u0E43\u0E19\u0E2A\u0E16\u0E32\u0E19\u0E28\u0E36\u0E01\u0E29\u0E32`,
    "career",
    "course",
    "/images/thumb-ai-edu.jpg",
    "",
    JSON.stringify(["\u0E40\u0E27\u0E34\u0E23\u0E4C\u0E01\u0E0A\u0E47\u0E2D\u0E1B", "AI for Education", "\u0E1E\u0E31\u0E12\u0E19\u0E32\u0E04\u0E23\u0E39", "\u0E2D\u0E32\u0E0A\u0E35\u0E1E & \u0E01\u0E32\u0E23\u0E1E\u0E31\u0E12\u0E19\u0E32"]),
    "\u0E04\u0E21\u0E01\u0E24\u0E0A (Komkrit)",
    "published",
    0,
    980,
    "2025-09-10T09:00:00.000Z",
    "2025-09-10T09:00:00.000Z"
  );
  insertPost.run(
    "\u0E01\u0E32\u0E23\u0E28\u0E36\u0E01\u0E29\u0E32\u0E17\u0E35\u0E48\u0E14\u0E35 \u0E2A\u0E23\u0E49\u0E32\u0E07\u0E04\u0E19\u0E17\u0E35\u0E48\u0E14\u0E35 \u0E2A\u0E23\u0E49\u0E32\u0E07\u0E2A\u0E31\u0E07\u0E04\u0E21\u0E17\u0E35\u0E48\u0E14\u0E35\u0E44\u0E14\u0E49: \u0E1E\u0E25\u0E31\u0E07\u0E04\u0E27\u0E32\u0E21\u0E23\u0E48\u0E27\u0E21\u0E21\u0E37\u0E2D\u0E02\u0E2D\u0E07\u0E0A\u0E38\u0E21\u0E0A\u0E19\u0E41\u0E25\u0E30\u0E42\u0E23\u0E07\u0E40\u0E23\u0E35\u0E22\u0E19",
    "\u0E40\u0E21\u0E37\u0E48\u0E2D\u0E01\u0E32\u0E23\u0E1E\u0E31\u0E12\u0E19\u0E32\u0E04\u0E19\u0E44\u0E21\u0E48\u0E43\u0E0A\u0E48\u0E2B\u0E19\u0E49\u0E32\u0E17\u0E35\u0E48\u0E02\u0E2D\u0E07\u0E42\u0E23\u0E07\u0E40\u0E23\u0E35\u0E22\u0E19\u0E40\u0E1E\u0E35\u0E22\u0E07\u0E25\u0E33\u0E1E\u0E31\u0E07",
    "\u0E21\u0E38\u0E21\u0E21\u0E2D\u0E07\u0E14\u0E49\u0E32\u0E19\u0E01\u0E32\u0E23\u0E1E\u0E31\u0E12\u0E19\u0E32\u0E2A\u0E31\u0E07\u0E04\u0E21\u0E1C\u0E48\u0E32\u0E19\u0E40\u0E04\u0E23\u0E37\u0E2D\u0E02\u0E48\u0E32\u0E22\u0E1C\u0E39\u0E49\u0E1B\u0E01\u0E04\u0E23\u0E2D\u0E07 \u0E0A\u0E38\u0E21\u0E0A\u0E19 \u0E17\u0E49\u0E2D\u0E07\u0E16\u0E34\u0E48\u0E19 \u0E41\u0E25\u0E30\u0E20\u0E32\u0E04\u0E18\u0E38\u0E23\u0E01\u0E34\u0E08 \u0E40\u0E1E\u0E37\u0E48\u0E2D\u0E2A\u0E23\u0E49\u0E32\u0E07\u0E1E\u0E37\u0E49\u0E19\u0E17\u0E35\u0E48\u0E1B\u0E25\u0E2D\u0E14\u0E20\u0E31\u0E22\u0E41\u0E25\u0E30\u0E42\u0E2D\u0E01\u0E32\u0E2A\u0E17\u0E35\u0E48\u0E40\u0E17\u0E48\u0E32\u0E40\u0E17\u0E35\u0E22\u0E21\u0E43\u0E2B\u0E49\u0E40\u0E22\u0E32\u0E27\u0E0A\u0E19\u0E17\u0E38\u0E01\u0E04\u0E19",
    `## Better Education \xB7 Better People \xB7 A Better Society

\u0E2A\u0E31\u0E07\u0E04\u0E21\u0E17\u0E35\u0E48\u0E40\u0E02\u0E49\u0E21\u0E41\u0E02\u0E47\u0E07\u0E40\u0E23\u0E34\u0E48\u0E21\u0E15\u0E49\u0E19\u0E08\u0E32\u0E01\u0E01\u0E32\u0E23\u0E40\u0E1B\u0E34\u0E14\u0E1E\u0E37\u0E49\u0E19\u0E17\u0E35\u0E48\u0E43\u0E2B\u0E49\u0E04\u0E19\u0E23\u0E38\u0E48\u0E19\u0E43\u0E2B\u0E21\u0E48\u0E44\u0E14\u0E49\u0E04\u0E49\u0E19\u0E1E\u0E1A\u0E28\u0E31\u0E01\u0E22\u0E20\u0E32\u0E1E\u0E02\u0E2D\u0E07\u0E15\u0E19\u0E40\u0E2D\u0E07 \u0E40\u0E21\u0E37\u0E48\u0E2D\u0E42\u0E23\u0E07\u0E40\u0E23\u0E35\u0E22\u0E19 \u0E0A\u0E38\u0E21\u0E0A\u0E19 \u0E1C\u0E39\u0E49\u0E1B\u0E01\u0E04\u0E23\u0E2D\u0E07 \u0E41\u0E25\u0E30\u0E20\u0E32\u0E04\u0E2A\u0E48\u0E27\u0E19\u0E15\u0E48\u0E32\u0E07\u0E46 \u0E08\u0E31\u0E1A\u0E21\u0E37\u0E2D\u0E01\u0E31\u0E19 \u0E01\u0E32\u0E23\u0E28\u0E36\u0E01\u0E29\u0E32\u0E08\u0E30\u0E44\u0E21\u0E48\u0E43\u0E0A\u0E48\u0E40\u0E23\u0E37\u0E48\u0E2D\u0E07\u0E43\u0E19\u0E2B\u0E49\u0E2D\u0E07\u0E2A\u0E35\u0E48\u0E40\u0E2B\u0E25\u0E35\u0E48\u0E22\u0E21\u0E2D\u0E35\u0E01\u0E15\u0E48\u0E2D\u0E44\u0E1B \u0E41\u0E15\u0E48\u0E04\u0E37\u0E2D\u0E01\u0E32\u0E23\u0E40\u0E23\u0E35\u0E22\u0E19\u0E23\u0E39\u0E49\u0E15\u0E25\u0E2D\u0E14\u0E0A\u0E35\u0E27\u0E34\u0E15\u0E17\u0E35\u0E48\u0E2B\u0E25\u0E48\u0E2D\u0E2B\u0E25\u0E2D\u0E21\u0E1E\u0E25\u0E40\u0E21\u0E37\u0E2D\u0E07\u0E04\u0E38\u0E13\u0E20\u0E32\u0E1E\u0E2A\u0E39\u0E48\u0E2D\u0E19\u0E32\u0E04\u0E15`,
    "society",
    "article",
    "/images/thumb-phuket.jpg",
    "",
    JSON.stringify(["\u0E2A\u0E31\u0E07\u0E04\u0E21", "\u0E1E\u0E31\u0E12\u0E19\u0E32\u0E04\u0E19", "\u0E0A\u0E38\u0E21\u0E0A\u0E19\u0E41\u0E2B\u0E48\u0E07\u0E01\u0E32\u0E23\u0E40\u0E23\u0E35\u0E22\u0E19\u0E23\u0E39\u0E49"]),
    "\u0E04\u0E21\u0E01\u0E24\u0E0A (Komkrit)",
    "published",
    0,
    1150,
    "2025-09-05T10:00:00.000Z",
    "2025-09-05T10:00:00.000Z"
  );
  const insertComment = db.prepare(`
    INSERT INTO comments (post_id, author_name, author_role, message, rating, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  insertComment.run(
    1,
    "\u0E2D.\u0E2A\u0E32\u0E22\u0E0A\u0E25 \u0E27\u0E31\u0E12\u0E19\u0E32\u0E01\u0E38\u0E25",
    "\u0E04\u0E23\u0E39 / \u0E1A\u0E38\u0E04\u0E25\u0E32\u0E01\u0E23\u0E17\u0E32\u0E07\u0E01\u0E32\u0E23\u0E28\u0E36\u0E01\u0E29\u0E32",
    "\u0E40\u0E2B\u0E47\u0E19\u0E14\u0E49\u0E27\u0E22\u0E2D\u0E22\u0E48\u0E32\u0E07\u0E22\u0E34\u0E48\u0E07\u0E04\u0E23\u0E31\u0E1A\u0E40\u0E23\u0E37\u0E48\u0E2D\u0E07\u0E01\u0E32\u0E23\u0E04\u0E37\u0E19\u0E40\u0E27\u0E25\u0E32\u0E43\u0E2B\u0E49\u0E04\u0E23\u0E39\u0E21\u0E32\u0E40\u0E1B\u0E47\u0E19 Learning Designer \u0E1A\u0E17\u0E04\u0E27\u0E32\u0E21\u0E2A\u0E23\u0E38\u0E1B\u0E0A\u0E31\u0E14\u0E40\u0E08\u0E19\u0E41\u0E25\u0E30\u0E19\u0E33\u0E44\u0E1B\u0E04\u0E38\u0E22\u0E15\u0E48\u0E2D\u0E43\u0E19\u0E17\u0E35\u0E48\u0E1B\u0E23\u0E30\u0E0A\u0E38\u0E21\u0E27\u0E34\u0E0A\u0E32\u0E01\u0E32\u0E23\u0E42\u0E23\u0E07\u0E40\u0E23\u0E35\u0E22\u0E19\u0E44\u0E14\u0E49\u0E40\u0E25\u0E22\u0E04\u0E23\u0E31\u0E1A",
    5,
    "2025-09-15T14:20:00.000Z"
  );
  insertComment.run(
    1,
    "\u0E04\u0E38\u0E13\u0E1E\u0E34\u0E21\u0E1E\u0E4C\u0E0A\u0E19\u0E01 (\u0E1C\u0E39\u0E49\u0E1B\u0E01\u0E04\u0E23\u0E2D\u0E07 \u0E21.\u0E15\u0E49\u0E19)",
    "\u0E1C\u0E39\u0E49\u0E1B\u0E01\u0E04\u0E23\u0E2D\u0E07",
    "\u0E2D\u0E48\u0E32\u0E19\u0E40\u0E02\u0E49\u0E32\u0E43\u0E08\u0E07\u0E48\u0E32\u0E22\u0E21\u0E32\u0E01\u0E04\u0E48\u0E30 \u0E17\u0E33\u0E43\u0E2B\u0E49\u0E1C\u0E39\u0E49\u0E1B\u0E01\u0E04\u0E23\u0E2D\u0E07\u0E40\u0E02\u0E49\u0E32\u0E43\u0E08\u0E27\u0E48\u0E32\u0E04\u0E27\u0E23\u0E41\u0E19\u0E30\u0E19\u0E33\u0E25\u0E39\u0E01\u0E43\u0E2B\u0E49\u0E43\u0E0A\u0E49 AI \u0E40\u0E1E\u0E37\u0E48\u0E2D\u0E15\u0E31\u0E49\u0E07\u0E04\u0E33\u0E16\u0E32\u0E21\u0E41\u0E25\u0E30\u0E04\u0E34\u0E14\u0E27\u0E34\u0E40\u0E04\u0E23\u0E32\u0E30\u0E2B\u0E4C \u0E44\u0E21\u0E48\u0E43\u0E0A\u0E48\u0E41\u0E04\u0E48\u0E25\u0E2D\u0E01\u0E04\u0E33\u0E15\u0E2D\u0E1A",
    5,
    "2025-09-16T09:10:00.000Z"
  );
  insertComment.run(
    2,
    "\u0E18\u0E19\u0E20\u0E31\u0E17\u0E23 \u0E28\u0E23\u0E35\u0E2A\u0E38\u0E27\u0E23\u0E23\u0E13",
    "\u0E19\u0E31\u0E01\u0E40\u0E23\u0E35\u0E22\u0E19",
    "\u0E0A\u0E2D\u0E1A\u0E41\u0E19\u0E27\u0E04\u0E34\u0E14 Authentic Assessment \u0E21\u0E32\u0E01\u0E04\u0E23\u0E31\u0E1A \u0E2D\u0E22\u0E32\u0E01\u0E43\u0E2B\u0E49\u0E2B\u0E49\u0E2D\u0E07\u0E40\u0E23\u0E35\u0E22\u0E19\u0E40\u0E19\u0E49\u0E19\u0E17\u0E33\u0E42\u0E1B\u0E23\u0E40\u0E08\u0E01\u0E15\u0E4C\u0E41\u0E01\u0E49\u0E1B\u0E31\u0E0D\u0E2B\u0E32\u0E08\u0E23\u0E34\u0E07\u0E41\u0E1A\u0E1A\u0E19\u0E35\u0E49\u0E40\u0E22\u0E2D\u0E30\u0E46",
    5,
    "2025-09-14T18:45:00.000Z"
  );
  const insertKb = db.prepare(`
    INSERT INTO knowledge_base (title, category, summary, content, source_ref, is_active, created_at)
    VALUES (?, ?, ?, ?, ?, 1, ?)
  `);
  insertKb.run(
    "Brand Guideline & Tone of Voice: \u0E04\u0E21\u0E04\u0E34\u0E14 by KOMKRIT",
    "brand_guideline",
    '\u0E2D\u0E31\u0E15\u0E25\u0E31\u0E01\u0E29\u0E13\u0E4C \u0E19\u0E49\u0E33\u0E40\u0E2A\u0E35\u0E22\u0E07 \u0E41\u0E25\u0E30\u0E1B\u0E23\u0E31\u0E0A\u0E0D\u0E32\u0E2B\u0E25\u0E31\u0E01 "\u0E04\u0E34\u0E14\u0E15\u0E48\u0E32\u0E07\u0E2D\u0E22\u0E48\u0E32\u0E07\u0E2A\u0E23\u0E49\u0E32\u0E07\u0E2A\u0E23\u0E23\u0E04\u0E4C \u0E40\u0E1E\u0E37\u0E48\u0E2D\u0E01\u0E32\u0E23\u0E28\u0E36\u0E01\u0E29\u0E32 \u0E40\u0E1E\u0E37\u0E48\u0E2D\u0E2A\u0E31\u0E07\u0E04\u0E21 \u0E40\u0E1E\u0E37\u0E48\u0E2D\u0E2D\u0E19\u0E32\u0E04\u0E15\u0E17\u0E35\u0E48\u0E14\u0E35\u0E01\u0E27\u0E48\u0E32"',
    '\u0E19\u0E49\u0E33\u0E40\u0E2A\u0E35\u0E22\u0E07\u0E2D\u0E1A\u0E2D\u0E38\u0E48\u0E19 \u0E2A\u0E38\u0E20\u0E32\u0E1E \u0E25\u0E36\u0E01\u0E0B\u0E36\u0E49\u0E07\u0E41\u0E15\u0E48\u0E40\u0E02\u0E49\u0E32\u0E43\u0E08\u0E07\u0E48\u0E32\u0E22 \u0E21\u0E35\u0E27\u0E34\u0E2A\u0E31\u0E22\u0E17\u0E31\u0E28\u0E19\u0E4C\u0E40\u0E0A\u0E34\u0E07\u0E1A\u0E23\u0E34\u0E2B\u0E32\u0E23\u0E41\u0E25\u0E30\u0E2B\u0E31\u0E27\u0E43\u0E08\u0E02\u0E2D\u0E07\u0E19\u0E31\u0E01\u0E01\u0E32\u0E23\u0E28\u0E36\u0E01\u0E29\u0E32 \u0E40\u0E19\u0E49\u0E19\u0E01\u0E32\u0E23\u0E43\u0E2B\u0E49\u0E17\u0E32\u0E07\u0E2D\u0E2D\u0E01\u0E40\u0E0A\u0E34\u0E07\u0E2A\u0E23\u0E49\u0E32\u0E07\u0E2A\u0E23\u0E23\u0E04\u0E4C (Solution-Oriented) \u0E43\u0E0A\u0E49\u0E04\u0E33\u0E02\u0E27\u0E31\u0E0D\u0E2B\u0E25\u0E31\u0E01: "\u0E04\u0E34\u0E14\u0E15\u0E48\u0E32\u0E07\u0E2D\u0E22\u0E48\u0E32\u0E07\u0E2A\u0E23\u0E49\u0E32\u0E07\u0E2A\u0E23\u0E23\u0E04\u0E4C" \u0E41\u0E25\u0E30 "\u0E01\u0E32\u0E23\u0E28\u0E36\u0E01\u0E29\u0E32\u0E17\u0E35\u0E48\u0E14\u0E35 \u0E2A\u0E23\u0E49\u0E32\u0E07\u0E04\u0E19\u0E17\u0E35\u0E48\u0E14\u0E35 \u0E2A\u0E23\u0E49\u0E32\u0E07\u0E2A\u0E31\u0E07\u0E04\u0E21\u0E17\u0E35\u0E48\u0E14\u0E35\u0E44\u0E14\u0E49 (Better Education \xB7 Better People \xB7 A Better Society)"',
    "Komkrit Brand Playbook 2025",
    "2025-09-01T08:00:00.000Z"
  );
  insertKb.run(
    "\u0E01\u0E23\u0E2D\u0E1A\u0E21\u0E32\u0E15\u0E23\u0E10\u0E32\u0E19\u0E01\u0E32\u0E23\u0E28\u0E36\u0E01\u0E29\u0E32\u0E41\u0E25\u0E30\u0E19\u0E42\u0E22\u0E1A\u0E32\u0E22\u0E23\u0E31\u0E10 (\u0E2A\u0E1E\u0E10. / \u0E2A\u0E0A. OPEC / \u0E21\u0E32\u0E15\u0E23\u0E10\u0E32\u0E19\u0E2A\u0E21\u0E23\u0E23\u0E16\u0E19\u0E30)",
    "policy",
    "\u0E41\u0E19\u0E27\u0E17\u0E32\u0E07\u0E01\u0E32\u0E23\u0E08\u0E31\u0E14\u0E01\u0E32\u0E23\u0E40\u0E23\u0E35\u0E22\u0E19\u0E23\u0E39\u0E49\u0E10\u0E32\u0E19\u0E2A\u0E21\u0E23\u0E23\u0E16\u0E19\u0E30 \u0E01\u0E32\u0E23\u0E1B\u0E23\u0E30\u0E01\u0E31\u0E19\u0E04\u0E38\u0E13\u0E20\u0E32\u0E1E\u0E01\u0E32\u0E23\u0E28\u0E36\u0E01\u0E29\u0E32 \u0E41\u0E25\u0E30\u0E04\u0E27\u0E32\u0E21\u0E22\u0E37\u0E14\u0E2B\u0E22\u0E38\u0E48\u0E19\u0E02\u0E2D\u0E07\u0E2A\u0E16\u0E32\u0E19\u0E28\u0E36\u0E01\u0E29\u0E32\u0E40\u0E2D\u0E01\u0E0A\u0E19",
    "\u0E21\u0E38\u0E48\u0E07\u0E40\u0E19\u0E49\u0E19\u0E2A\u0E21\u0E23\u0E23\u0E16\u0E19\u0E30\u0E2A\u0E33\u0E04\u0E31\u0E0D\u0E02\u0E2D\u0E07\u0E1C\u0E39\u0E49\u0E40\u0E23\u0E35\u0E22\u0E19\u0E22\u0E38\u0E04\u0E14\u0E34\u0E08\u0E34\u0E17\u0E31\u0E25 \u0E44\u0E14\u0E49\u0E41\u0E01\u0E48 \u0E01\u0E32\u0E23\u0E04\u0E34\u0E14\u0E02\u0E31\u0E49\u0E19\u0E2A\u0E39\u0E07 \u0E01\u0E32\u0E23\u0E2A\u0E37\u0E48\u0E2D\u0E2A\u0E32\u0E23\u0E2B\u0E25\u0E32\u0E22\u0E20\u0E32\u0E29\u0E32 \u0E01\u0E32\u0E23\u0E23\u0E39\u0E49\u0E40\u0E17\u0E48\u0E32\u0E17\u0E31\u0E19\u0E40\u0E17\u0E04\u0E42\u0E19\u0E42\u0E25\u0E22\u0E35 AI \u0E01\u0E32\u0E23\u0E17\u0E33\u0E07\u0E32\u0E19\u0E23\u0E48\u0E27\u0E21\u0E01\u0E31\u0E1A\u0E1C\u0E39\u0E49\u0E2D\u0E37\u0E48\u0E19\u0E02\u0E49\u0E32\u0E21\u0E27\u0E31\u0E12\u0E19\u0E18\u0E23\u0E23\u0E21 \u0E41\u0E25\u0E30\u0E01\u0E32\u0E23\u0E40\u0E0A\u0E37\u0E48\u0E2D\u0E21\u0E42\u0E22\u0E07\u0E2B\u0E25\u0E31\u0E01\u0E2A\u0E39\u0E15\u0E23\u0E2A\u0E16\u0E32\u0E19\u0E28\u0E36\u0E01\u0E29\u0E32\u0E01\u0E31\u0E1A\u0E17\u0E31\u0E01\u0E29\u0E30\u0E2D\u0E32\u0E0A\u0E35\u0E1E\u0E43\u0E19\u0E17\u0E49\u0E2D\u0E07\u0E16\u0E34\u0E48\u0E19",
    "\u0E19\u0E42\u0E22\u0E1A\u0E32\u0E22\u0E01\u0E32\u0E23\u0E28\u0E36\u0E01\u0E29\u0E32 \u0E2A\u0E1E\u0E10. / \u0E2A\u0E0A. (OPEC)",
    "2025-09-02T08:00:00.000Z"
  );
  insertKb.run(
    "\u0E42\u0E04\u0E23\u0E07\u0E01\u0E32\u0E23\u0E1E\u0E34\u0E40\u0E28\u0E29: \u0E42\u0E23\u0E07\u0E40\u0E23\u0E35\u0E22\u0E19\u0E20\u0E32\u0E29\u0E32\u0E41\u0E25\u0E30\u0E2D\u0E32\u0E0A\u0E35\u0E1E \u0E44\u0E17\u0E22-\u0E40\u0E21\u0E35\u0E22\u0E19\u0E21\u0E32 & Phuket Lifelong Learning",
    "komkrit_vision",
    "\u0E15\u0E49\u0E19\u0E41\u0E1A\u0E1A\u0E01\u0E32\u0E23\u0E1E\u0E31\u0E12\u0E19\u0E32\u0E17\u0E31\u0E01\u0E29\u0E30\u0E20\u0E32\u0E29\u0E32\u0E41\u0E25\u0E30\u0E27\u0E34\u0E0A\u0E32\u0E0A\u0E35\u0E1E\u0E02\u0E49\u0E32\u0E21\u0E1E\u0E23\u0E21\u0E41\u0E14\u0E19 \u0E41\u0E25\u0E30\u0E01\u0E32\u0E23\u0E02\u0E31\u0E1A\u0E40\u0E04\u0E25\u0E37\u0E48\u0E2D\u0E19\u0E20\u0E39\u0E40\u0E01\u0E47\u0E15\u0E2A\u0E39\u0E48\u0E28\u0E39\u0E19\u0E22\u0E4C\u0E01\u0E25\u0E32\u0E07\u0E01\u0E32\u0E23\u0E40\u0E23\u0E35\u0E22\u0E19\u0E23\u0E39\u0E49\u0E15\u0E25\u0E2D\u0E14\u0E0A\u0E35\u0E27\u0E34\u0E15",
    "\u0E1A\u0E39\u0E23\u0E13\u0E32\u0E01\u0E32\u0E23\u0E2B\u0E25\u0E31\u0E01\u0E2A\u0E39\u0E15\u0E23\u0E20\u0E32\u0E29\u0E32 (\u0E44\u0E17\u0E22-\u0E40\u0E21\u0E35\u0E22\u0E19\u0E21\u0E32-\u0E2D\u0E31\u0E07\u0E01\u0E24\u0E29) \u0E04\u0E39\u0E48\u0E01\u0E31\u0E1A\u0E17\u0E31\u0E01\u0E29\u0E30\u0E27\u0E34\u0E0A\u0E32\u0E0A\u0E35\u0E1E\u0E1A\u0E23\u0E34\u0E01\u0E32\u0E23 \u0E14\u0E34\u0E08\u0E34\u0E17\u0E31\u0E25 \u0E41\u0E25\u0E30\u0E01\u0E32\u0E23\u0E40\u0E1B\u0E47\u0E19\u0E1C\u0E39\u0E49\u0E1B\u0E23\u0E30\u0E01\u0E2D\u0E1A\u0E01\u0E32\u0E23 \u0E1E\u0E23\u0E49\u0E2D\u0E21\u0E22\u0E01\u0E23\u0E30\u0E14\u0E31\u0E1A\u0E08\u0E31\u0E07\u0E2B\u0E27\u0E31\u0E14\u0E20\u0E39\u0E40\u0E01\u0E47\u0E15\u0E43\u0E2B\u0E49\u0E40\u0E1B\u0E47\u0E19 Lifelong Learning Hub \u0E17\u0E35\u0E48\u0E40\u0E0A\u0E37\u0E48\u0E2D\u0E21\u0E04\u0E19\u0E17\u0E38\u0E01\u0E40\u0E08\u0E40\u0E19\u0E2D\u0E40\u0E23\u0E0A\u0E31\u0E19",
    "Komkrit Special Initiative Archive",
    "2025-09-03T08:00:00.000Z"
  );
  insertKb.run(
    "\u0E08\u0E23\u0E34\u0E22\u0E18\u0E23\u0E23\u0E21 \u0E01\u0E0E\u0E2B\u0E21\u0E32\u0E22 PDPA \u0E41\u0E25\u0E30\u0E04\u0E27\u0E32\u0E21\u0E40\u0E2A\u0E35\u0E48\u0E22\u0E07\u0E14\u0E49\u0E32\u0E19\u0E2A\u0E37\u0E48\u0E2D\u0E01\u0E32\u0E23\u0E28\u0E36\u0E01\u0E29\u0E32",
    "regulation",
    "\u0E2B\u0E25\u0E31\u0E01\u0E40\u0E01\u0E13\u0E11\u0E4C\u0E01\u0E32\u0E23\u0E15\u0E23\u0E27\u0E08\u0E2A\u0E2D\u0E1A\u0E04\u0E27\u0E32\u0E21\u0E40\u0E2A\u0E35\u0E48\u0E22\u0E07\u0E14\u0E49\u0E32\u0E19\u0E02\u0E49\u0E2D\u0E21\u0E39\u0E25\u0E2A\u0E48\u0E27\u0E19\u0E1A\u0E38\u0E04\u0E04\u0E25\u0E1C\u0E39\u0E49\u0E40\u0E23\u0E35\u0E22\u0E19 \u0E25\u0E34\u0E02\u0E2A\u0E34\u0E17\u0E18\u0E34\u0E4C \u0E41\u0E25\u0E30\u0E08\u0E23\u0E34\u0E22\u0E18\u0E23\u0E23\u0E21\u0E01\u0E32\u0E23\u0E43\u0E0A\u0E49 AI \u0E2A\u0E33\u0E2B\u0E23\u0E31\u0E1A QA Agent",
    "\u0E2B\u0E49\u0E32\u0E21\u0E40\u0E1B\u0E34\u0E14\u0E40\u0E1C\u0E22\u0E02\u0E49\u0E2D\u0E21\u0E39\u0E25\u0E2A\u0E48\u0E27\u0E19\u0E1A\u0E38\u0E04\u0E04\u0E25\u0E02\u0E2D\u0E07\u0E19\u0E31\u0E01\u0E40\u0E23\u0E35\u0E22\u0E19\u0E41\u0E25\u0E30\u0E40\u0E22\u0E32\u0E27\u0E0A\u0E19 (PDPA), \u0E23\u0E30\u0E1A\u0E38\u0E41\u0E2B\u0E25\u0E48\u0E07\u0E2D\u0E49\u0E32\u0E07\u0E2D\u0E34\u0E07\u0E17\u0E32\u0E07\u0E27\u0E34\u0E0A\u0E32\u0E01\u0E32\u0E23\u0E17\u0E35\u0E48\u0E15\u0E23\u0E27\u0E08\u0E2A\u0E2D\u0E1A\u0E44\u0E14\u0E49, \u0E2B\u0E25\u0E35\u0E01\u0E40\u0E25\u0E35\u0E48\u0E22\u0E07\u0E2D\u0E04\u0E15\u0E34\u0E17\u0E32\u0E07\u0E40\u0E0A\u0E37\u0E49\u0E2D\u0E0A\u0E32\u0E15\u0E34\u0E41\u0E25\u0E30\u0E20\u0E32\u0E29\u0E32, \u0E41\u0E25\u0E30\u0E15\u0E23\u0E27\u0E08\u0E2A\u0E2D\u0E1A\u0E04\u0E27\u0E32\u0E21\u0E16\u0E39\u0E01\u0E15\u0E49\u0E2D\u0E07\u0E02\u0E2D\u0E07\u0E02\u0E49\u0E2D\u0E21\u0E39\u0E25\u0E19\u0E42\u0E22\u0E1A\u0E32\u0E22\u0E01\u0E48\u0E2D\u0E19\u0E40\u0E1C\u0E22\u0E41\u0E1E\u0E23\u0E48\u0E17\u0E38\u0E01\u0E04\u0E23\u0E31\u0E49\u0E07",
    "PDPA & Educational Media Ethics Standard",
    "2025-09-04T08:00:00.000Z"
  );
  insertKb.run(
    "\u0E07\u0E32\u0E19\u0E27\u0E34\u0E08\u0E31\u0E22\u0E41\u0E19\u0E27\u0E42\u0E19\u0E49\u0E21 AI Agentic \u0E43\u0E19\u0E23\u0E30\u0E1A\u0E1A\u0E01\u0E32\u0E23\u0E28\u0E36\u0E01\u0E29\u0E32\u0E42\u0E25\u0E01 2025-2030",
    "research",
    "\u0E02\u0E49\u0E2D\u0E21\u0E39\u0E25\u0E40\u0E0A\u0E34\u0E07\u0E25\u0E36\u0E01\u0E14\u0E49\u0E32\u0E19\u0E01\u0E32\u0E23\u0E43\u0E0A\u0E49 AI Tutor, Learning Copilot \u0E2A\u0E33\u0E2B\u0E23\u0E31\u0E1A\u0E04\u0E23\u0E39 \u0E41\u0E25\u0E30\u0E01\u0E32\u0E23\u0E27\u0E31\u0E14\u0E1C\u0E25\u0E41\u0E1A\u0E1A Authentic Assessment",
    "\u0E1C\u0E25\u0E2A\u0E33\u0E23\u0E27\u0E08\u0E0A\u0E35\u0E49\u0E27\u0E48\u0E32\u0E01\u0E32\u0E23\u0E19\u0E33 AI Copilot \u0E21\u0E32\u0E0A\u0E48\u0E27\u0E22\u0E04\u0E23\u0E39\u0E2D\u0E2D\u0E01\u0E41\u0E1A\u0E1A\u0E2A\u0E37\u0E48\u0E2D\u0E41\u0E25\u0E30\u0E07\u0E32\u0E19\u0E18\u0E38\u0E23\u0E01\u0E32\u0E23\u0E0A\u0E48\u0E27\u0E22\u0E25\u0E14\u0E40\u0E27\u0E25\u0E32\u0E40\u0E15\u0E23\u0E35\u0E22\u0E21\u0E07\u0E32\u0E19\u0E44\u0E14\u0E49 35-45% \u0E41\u0E25\u0E30\u0E40\u0E1E\u0E34\u0E48\u0E21\u0E40\u0E27\u0E25\u0E32\u0E01\u0E32\u0E23\u0E43\u0E2B\u0E49\u0E04\u0E33\u0E1B\u0E23\u0E36\u0E01\u0E29\u0E32\u0E23\u0E32\u0E22\u0E1A\u0E38\u0E04\u0E04\u0E25\u0E41\u0E01\u0E48\u0E1C\u0E39\u0E49\u0E40\u0E23\u0E35\u0E22\u0E19\u0E2D\u0E22\u0E48\u0E32\u0E07\u0E21\u0E35\u0E19\u0E31\u0E22\u0E2A\u0E33\u0E04\u0E31\u0E0D \u0E40\u0E21\u0E37\u0E48\u0E2D\u0E21\u0E35\u0E23\u0E30\u0E1A\u0E1A Human-in-the-Loop \u0E01\u0E33\u0E01\u0E31\u0E1A\u0E04\u0E38\u0E13\u0E20\u0E32\u0E1E",
    "UNESCO & Global EdTech Trend Synthesis",
    "2025-09-05T08:00:00.000Z"
  );
  const insertPillar = db.prepare(`
    INSERT INTO business_pillars (
      pillar_index, pillar_key, title, subtitle, description,
      metric_label, metric_value, status_badge, action_url
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  insertPillar.run(
    1,
    "views",
    "1. VIEWS | \u0E22\u0E2D\u0E14\u0E27\u0E34\u0E27",
    "YouTube \u2022 TikTok \u2022 Facebook \u2022 Ads",
    "\u0E2A\u0E23\u0E49\u0E32\u0E07\u0E01\u0E32\u0E23\u0E23\u0E31\u0E1A\u0E23\u0E39\u0E49\u0E41\u0E25\u0E30\u0E02\u0E22\u0E32\u0E22\u0E10\u0E32\u0E19\u0E1C\u0E39\u0E49\u0E0A\u0E21\u0E1C\u0E48\u0E32\u0E19\u0E04\u0E2D\u0E19\u0E40\u0E17\u0E19\u0E15\u0E4C\u0E04\u0E38\u0E13\u0E20\u0E32\u0E1E\u0E2A\u0E39\u0E07\u0E1A\u0E19\u0E17\u0E38\u0E01\u0E41\u0E1E\u0E25\u0E15\u0E1F\u0E2D\u0E23\u0E4C\u0E21 \u0E40\u0E1B\u0E25\u0E35\u0E48\u0E22\u0E19\u0E04\u0E27\u0E32\u0E21\u0E23\u0E39\u0E49\u0E43\u0E2B\u0E49\u0E40\u0E02\u0E49\u0E32\u0E16\u0E36\u0E07\u0E1C\u0E39\u0E49\u0E04\u0E19\u0E27\u0E07\u0E01\u0E27\u0E49\u0E32\u0E07",
    "\u0E22\u0E2D\u0E14\u0E01\u0E32\u0E23\u0E40\u0E02\u0E49\u0E32\u0E16\u0E36\u0E07\u0E23\u0E27\u0E21/\u0E40\u0E14\u0E37\u0E2D\u0E19",
    "148.5K Views",
    "CORE",
    ""
  );
  insertPillar.run(
    2,
    "products",
    "2. PRODUCTS | \u0E2A\u0E34\u0E19\u0E04\u0E49\u0E32",
    "\u0E2A\u0E34\u0E19\u0E04\u0E49\u0E32\u0E02\u0E2D\u0E07\u0E40\u0E23\u0E32\u0E40\u0E2D\u0E07 \u2022 \u0E2A\u0E34\u0E19\u0E04\u0E49\u0E32\u0E1E\u0E31\u0E19\u0E18\u0E21\u0E34\u0E15\u0E23 \u2022 Affiliate",
    "\u0E1E\u0E31\u0E12\u0E19\u0E32 e-Book \u0E04\u0E39\u0E48\u0E21\u0E37\u0E2D\u0E19\u0E27\u0E31\u0E15\u0E01\u0E23\u0E23\u0E21\u0E01\u0E32\u0E23\u0E28\u0E36\u0E01\u0E29\u0E32 \u0E04\u0E2D\u0E23\u0E4C\u0E2A\u0E2D\u0E2D\u0E19\u0E44\u0E25\u0E19\u0E4C \u0E40\u0E17\u0E21\u0E40\u0E1E\u0E25\u0E15 AI \u0E2A\u0E33\u0E2B\u0E23\u0E31\u0E1A\u0E04\u0E23\u0E39 \u0E41\u0E25\u0E30\u0E04\u0E31\u0E14\u0E2A\u0E23\u0E23\u0E2A\u0E37\u0E48\u0E2D\u0E04\u0E38\u0E13\u0E20\u0E32\u0E1E\u0E08\u0E32\u0E01\u0E1E\u0E31\u0E19\u0E18\u0E21\u0E34\u0E15\u0E23",
    "\u0E1C\u0E25\u0E34\u0E15\u0E20\u0E31\u0E13\u0E11\u0E4C & \u0E04\u0E2D\u0E23\u0E4C\u0E2A\u0E1E\u0E23\u0E49\u0E2D\u0E21\u0E43\u0E0A\u0E49",
    "12 \u0E23\u0E32\u0E22\u0E01\u0E32\u0E23",
    "UPDATED",
    ""
  );
  insertPillar.run(
    3,
    "sponsors",
    "3. SPONSORS | \u0E2A\u0E1B\u0E2D\u0E19\u0E40\u0E0B\u0E2D\u0E23\u0E4C",
    "Brand Partnership \u2022 Sponsored Content",
    "\u0E23\u0E48\u0E27\u0E21\u0E21\u0E37\u0E2D\u0E01\u0E31\u0E1A\u0E2D\u0E07\u0E04\u0E4C\u0E01\u0E23\u0E0A\u0E31\u0E49\u0E19\u0E19\u0E33\u0E14\u0E49\u0E32\u0E19 EdTech \u0E2A\u0E16\u0E32\u0E1A\u0E31\u0E19\u0E01\u0E32\u0E23\u0E28\u0E36\u0E01\u0E29\u0E32 \u0E41\u0E25\u0E30\u0E41\u0E1A\u0E23\u0E19\u0E14\u0E4C\u0E17\u0E35\u0E48\u0E21\u0E35\u0E27\u0E34\u0E2A\u0E31\u0E22\u0E17\u0E31\u0E28\u0E19\u0E4C\u0E1E\u0E31\u0E12\u0E19\u0E32\u0E04\u0E19\u0E41\u0E25\u0E30\u0E2A\u0E31\u0E07\u0E04\u0E21\u0E2D\u0E22\u0E48\u0E32\u0E07\u0E22\u0E31\u0E48\u0E07\u0E22\u0E37\u0E19",
    "\u0E1E\u0E31\u0E19\u0E18\u0E21\u0E34\u0E15\u0E23\u0E2D\u0E07\u0E04\u0E4C\u0E01\u0E23",
    "6 \u0E41\u0E1A\u0E23\u0E19\u0E14\u0E4C",
    "ACTIVE",
    ""
  );
  insertPillar.run(
    4,
    "business",
    "4. BUSINESS | \u0E18\u0E38\u0E23\u0E01\u0E34\u0E08",
    "Consulting \u2022 Workshop \u2022 AI for Education",
    "\u0E17\u0E35\u0E48\u0E1B\u0E23\u0E36\u0E01\u0E29\u0E32\u0E1A\u0E23\u0E34\u0E2B\u0E32\u0E23\u0E2A\u0E16\u0E32\u0E19\u0E28\u0E36\u0E01\u0E29\u0E32 \u0E2D\u0E1A\u0E23\u0E21\u0E40\u0E0A\u0E34\u0E07\u0E1B\u0E0F\u0E34\u0E1A\u0E31\u0E15\u0E34\u0E01\u0E32\u0E23 AI Multi-Agent \u0E2A\u0E33\u0E2B\u0E23\u0E31\u0E1A\u0E42\u0E23\u0E07\u0E40\u0E23\u0E35\u0E22\u0E19 \u0E41\u0E25\u0E30\u0E42\u0E04\u0E23\u0E07\u0E01\u0E32\u0E23\u0E42\u0E23\u0E07\u0E40\u0E23\u0E35\u0E22\u0E19\u0E20\u0E32\u0E29\u0E32-\u0E2D\u0E32\u0E0A\u0E35\u0E1E",
    "\u0E40\u0E27\u0E34\u0E23\u0E4C\u0E01\u0E0A\u0E47\u0E2D\u0E1B & \u0E17\u0E35\u0E48\u0E1B\u0E23\u0E36\u0E01\u0E29\u0E32",
    "9 \u0E42\u0E04\u0E23\u0E07\u0E01\u0E32\u0E23",
    "GROWTH",
    ""
  );
  insertPillar.run(
    5,
    "community",
    "5. COMMUNITY | \u0E0A\u0E38\u0E21\u0E0A\u0E19",
    "\u0E2A\u0E21\u0E32\u0E0A\u0E34\u0E01\u0E23\u0E30\u0E14\u0E31\u0E1A VIP \u2022 \u0E41\u0E1F\u0E19\u0E04\u0E25\u0E31\u0E1A \u2022 Networking",
    "\u0E40\u0E04\u0E23\u0E37\u0E2D\u0E02\u0E48\u0E32\u0E22\u0E19\u0E31\u0E01\u0E01\u0E32\u0E23\u0E28\u0E36\u0E01\u0E29\u0E32 \u0E1C\u0E39\u0E49\u0E1A\u0E23\u0E34\u0E2B\u0E32\u0E23 \u0E04\u0E23\u0E39 \u0E1C\u0E39\u0E49\u0E1B\u0E01\u0E04\u0E23\u0E2D\u0E07 \u0E41\u0E25\u0E30\u0E04\u0E19\u0E23\u0E38\u0E48\u0E19\u0E43\u0E2B\u0E21\u0E48\u0E17\u0E35\u0E48\u0E21\u0E32\u0E23\u0E48\u0E27\u0E21\u0E40\u0E23\u0E35\u0E22\u0E19\u0E23\u0E39\u0E49 \u0E1E\u0E31\u0E12\u0E19\u0E32 \u0E41\u0E25\u0E30\u0E40\u0E15\u0E34\u0E1A\u0E42\u0E15\u0E44\u0E1B\u0E14\u0E49\u0E27\u0E22\u0E01\u0E31\u0E19",
    "\u0E2A\u0E21\u0E32\u0E0A\u0E34\u0E01\u0E40\u0E04\u0E23\u0E37\u0E2D\u0E02\u0E48\u0E32\u0E22\u0E04\u0E21\u0E04\u0E34\u0E14",
    "3,420 \u0E04\u0E19",
    "NEW",
    ""
  );
  const now = "2025-09-16T10:00:00.000Z";
  db.prepare(`
    INSERT INTO ai_workflows (
      topic, input_source, category, target_audience, business_pillar,
      flow_mode, engine_used, status,
      ceo_json, research_json, script_json, design_json, visual_json,
      video_json, audio_json, qa_json, analytics_json, omnichannel_json, approval_json,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    "5 \u0E17\u0E31\u0E01\u0E29\u0E30\u0E2A\u0E33\u0E04\u0E31\u0E0D\u0E02\u0E2D\u0E07\u0E04\u0E23\u0E39\u0E44\u0E17\u0E22\u0E22\u0E38\u0E04 AI Copilot: \u0E40\u0E1B\u0E25\u0E35\u0E48\u0E22\u0E19\u0E20\u0E32\u0E23\u0E30\u0E07\u0E32\u0E19\u0E40\u0E2D\u0E01\u0E2A\u0E32\u0E23\u0E40\u0E1B\u0E47\u0E19\u0E1E\u0E25\u0E31\u0E07\u0E2A\u0E23\u0E49\u0E32\u0E07\u0E41\u0E23\u0E07\u0E1A\u0E31\u0E19\u0E14\u0E32\u0E25\u0E43\u0E08",
    "\u0E1B\u0E31\u0E0D\u0E2B\u0E32/\u0E04\u0E27\u0E32\u0E21\u0E15\u0E49\u0E2D\u0E07\u0E01\u0E32\u0E23\u0E02\u0E2D\u0E07\u0E1C\u0E39\u0E49\u0E40\u0E23\u0E35\u0E22\u0E19/\u0E04\u0E23\u0E39/\u0E42\u0E23\u0E07\u0E40\u0E23\u0E35\u0E22\u0E19",
    "ai-tech",
    "\u0E04\u0E23\u0E39 / \u0E1A\u0E38\u0E04\u0E25\u0E32\u0E01\u0E23\u0E17\u0E32\u0E07\u0E01\u0E32\u0E23\u0E28\u0E36\u0E01\u0E29\u0E32",
    "4. BUSINESS | \u0E18\u0E38\u0E23\u0E01\u0E34\u0E08 (Workshop & AI for Education)",
    "full_8agent",
    "Komkrit Multi-Agent Ecosystem",
    "pending_approval",
    JSON.stringify({
      goal: "\u0E2A\u0E23\u0E49\u0E32\u0E07\u0E04\u0E2D\u0E19\u0E40\u0E17\u0E19\u0E15\u0E4C\u0E40\u0E23\u0E37\u0E2D\u0E18\u0E07\u0E17\u0E35\u0E48\u0E0A\u0E48\u0E27\u0E22\u0E43\u0E2B\u0E49\u0E04\u0E23\u0E39\u0E44\u0E17\u0E22\u0E40\u0E2B\u0E47\u0E19\u0E41\u0E19\u0E27\u0E17\u0E32\u0E07\u0E43\u0E0A\u0E49 AI \u0E25\u0E14\u0E20\u0E32\u0E23\u0E30\u0E07\u0E32\u0E19\u0E40\u0E2D\u0E01\u0E2A\u0E32\u0E23\u0E2D\u0E22\u0E48\u0E32\u0E07\u0E40\u0E1B\u0E47\u0E19\u0E23\u0E39\u0E1B\u0E18\u0E23\u0E23\u0E21 \u0E41\u0E25\u0E30\u0E15\u0E48\u0E2D\u0E22\u0E2D\u0E14\u0E2A\u0E39\u0E48\u0E40\u0E27\u0E34\u0E23\u0E4C\u0E01\u0E0A\u0E47\u0E2D\u0E1B AI for Education",
      strategy: "\u0E43\u0E0A\u0E49\u0E42\u0E04\u0E23\u0E07\u0E2A\u0E23\u0E49\u0E32\u0E07 Empathy \u2192 Insight \u2192 5 Actionable Skills \u2192 \u0E15\u0E31\u0E27\u0E2D\u0E22\u0E48\u0E32\u0E07\u0E08\u0E23\u0E34\u0E07\u0E43\u0E19\u0E2B\u0E49\u0E2D\u0E07\u0E40\u0E23\u0E35\u0E22\u0E19 \u0E14\u0E49\u0E27\u0E22\u0E19\u0E49\u0E33\u0E40\u0E2A\u0E35\u0E22\u0E07\u0E2D\u0E1A\u0E2D\u0E38\u0E48\u0E19\u0E41\u0E25\u0E30\u0E43\u0E2B\u0E49\u0E40\u0E01\u0E35\u0E22\u0E23\u0E15\u0E34\u0E27\u0E34\u0E0A\u0E32\u0E0A\u0E35\u0E1E\u0E04\u0E23\u0E39",
      keyMessage: "AI \u0E44\u0E21\u0E48\u0E44\u0E14\u0E49\u0E21\u0E32\u0E41\u0E17\u0E19\u0E17\u0E35\u0E48\u0E2B\u0E31\u0E27\u0E43\u0E08\u0E02\u0E2D\u0E07\u0E04\u0E27\u0E32\u0E21\u0E40\u0E1B\u0E47\u0E19\u0E04\u0E23\u0E39 \u0E41\u0E15\u0E48\u0E21\u0E32\u0E0A\u0E48\u0E27\u0E22\u0E04\u0E37\u0E19\u0E40\u0E27\u0E25\u0E32\u0E43\u0E2B\u0E49\u0E04\u0E23\u0E39\u0E44\u0E14\u0E49\u0E14\u0E39\u0E41\u0E25\u0E25\u0E39\u0E01\u0E28\u0E34\u0E29\u0E22\u0E4C\u0E2D\u0E22\u0E48\u0E32\u0E07\u0E40\u0E15\u0E47\u0E21\u0E28\u0E31\u0E01\u0E22\u0E20\u0E32\u0E1E",
      kpiTargets: ["\u0E2D\u0E31\u0E15\u0E23\u0E32\u0E2D\u0E48\u0E32\u0E19\u0E08\u0E1A > 68%", "\u0E41\u0E0A\u0E23\u0E4C\u0E15\u0E48\u0E2D\u0E43\u0E19\u0E01\u0E25\u0E38\u0E48\u0E21\u0E04\u0E23\u0E39 > 300 \u0E04\u0E23\u0E31\u0E49\u0E07", "\u0E1C\u0E39\u0E49\u0E2A\u0E19\u0E43\u0E08\u0E25\u0E07\u0E17\u0E30\u0E40\u0E1A\u0E35\u0E22\u0E19\u0E23\u0E31\u0E1A\u0E02\u0E48\u0E32\u0E27\u0E2A\u0E32\u0E23/\u0E40\u0E27\u0E34\u0E23\u0E4C\u0E01\u0E0A\u0E47\u0E2D\u0E1B > 45 \u0E04\u0E19"],
      agentAssignments: [
        { agent: "01 Research Agent", mission: "\u0E2A\u0E31\u0E07\u0E40\u0E04\u0E23\u0E32\u0E30\u0E2B\u0E4C\u0E02\u0E49\u0E2D\u0E21\u0E39\u0E25\u0E40\u0E27\u0E25\u0E32\u0E17\u0E33\u0E07\u0E32\u0E19\u0E04\u0E23\u0E39\u0E44\u0E17\u0E22\u0E41\u0E25\u0E30\u0E41\u0E19\u0E27\u0E42\u0E19\u0E49\u0E21 AI Copilot \u0E08\u0E32\u0E01\u0E10\u0E32\u0E19\u0E04\u0E27\u0E32\u0E21\u0E23\u0E39\u0E49" },
        { agent: "02 Idea & Script Agent", mission: "\u0E40\u0E02\u0E35\u0E22\u0E19\u0E1A\u0E17\u0E04\u0E27\u0E32\u0E21\u0E09\u0E1A\u0E31\u0E1A\u0E40\u0E15\u0E47\u0E21 + \u0E2A\u0E04\u0E23\u0E34\u0E1B\u0E15\u0E4C\u0E04\u0E25\u0E34\u0E1B\u0E2A\u0E31\u0E49\u0E19 90 \u0E27\u0E34\u0E19\u0E32\u0E17\u0E35" },
        { agent: "03-06 Creative & Production", mission: "\u0E27\u0E32\u0E07\u0E42\u0E04\u0E23\u0E07\u0E2A\u0E44\u0E25\u0E14\u0E4C \u0E2D\u0E34\u0E19\u0E42\u0E1F\u0E01\u0E23\u0E32\u0E1F\u0E34\u0E01 \u0E2A\u0E15\u0E2D\u0E23\u0E35\u0E48\u0E1A\u0E2D\u0E23\u0E4C\u0E14 \u0E41\u0E25\u0E30\u0E1A\u0E17\u0E1E\u0E32\u0E01\u0E22\u0E4C\u0E40\u0E2A\u0E35\u0E22\u0E07" },
        { agent: "07 QA Agent", mission: "\u0E15\u0E23\u0E27\u0E08 Fact Check, \u0E20\u0E32\u0E29\u0E32, Brand Tone \u0E41\u0E25\u0E30 PDPA Risk \u0E01\u0E48\u0E2D\u0E19\u0E2A\u0E48\u0E07 Human Approval" }
      ]
    }),
    JSON.stringify({
      deepInsights: [
        "\u0E04\u0E23\u0E39\u0E44\u0E17\u0E22\u0E43\u0E0A\u0E49\u0E40\u0E27\u0E25\u0E32\u0E01\u0E31\u0E1A\u0E07\u0E32\u0E19\u0E40\u0E2D\u0E01\u0E2A\u0E32\u0E23\u0E41\u0E25\u0E30\u0E1B\u0E23\u0E30\u0E40\u0E21\u0E34\u0E19\u0E1C\u0E25\u0E18\u0E38\u0E23\u0E01\u0E32\u0E23\u0E40\u0E09\u0E25\u0E35\u0E48\u0E22\u0E21\u0E32\u0E01\u0E01\u0E27\u0E48\u0E32 30-40% \u0E02\u0E2D\u0E07\u0E40\u0E27\u0E25\u0E32\u0E17\u0E33\u0E07\u0E32\u0E19\u0E2A\u0E31\u0E1B\u0E14\u0E32\u0E2B\u0E4C\u0E25\u0E30 50 \u0E0A\u0E31\u0E48\u0E27\u0E42\u0E21\u0E07",
        "\u0E01\u0E32\u0E23\u0E43\u0E0A\u0E49 AI \u0E0A\u0E48\u0E27\u0E22\u0E23\u0E48\u0E32\u0E07\u0E41\u0E1C\u0E19\u0E01\u0E32\u0E23\u0E08\u0E31\u0E14\u0E01\u0E32\u0E23\u0E40\u0E23\u0E35\u0E22\u0E19\u0E23\u0E39\u0E49\u0E10\u0E32\u0E19\u0E2A\u0E21\u0E23\u0E23\u0E16\u0E19\u0E30\u0E41\u0E25\u0E30\u0E43\u0E1A\u0E07\u0E32\u0E19\u0E23\u0E32\u0E22\u0E1A\u0E38\u0E04\u0E04\u0E25\u0E0A\u0E48\u0E27\u0E22\u0E1B\u0E23\u0E30\u0E2B\u0E22\u0E31\u0E14\u0E40\u0E27\u0E25\u0E32\u0E40\u0E15\u0E23\u0E35\u0E22\u0E21\u0E2A\u0E2D\u0E19\u0E44\u0E14\u0E49\u0E01\u0E27\u0E48\u0E32 40%",
        "\u0E2B\u0E31\u0E27\u0E43\u0E08\u0E2A\u0E33\u0E04\u0E31\u0E0D\u0E04\u0E37\u0E2D\u0E01\u0E32\u0E23\u0E21\u0E35\u0E04\u0E25\u0E31\u0E07\u0E04\u0E27\u0E32\u0E21\u0E23\u0E39\u0E49\u0E42\u0E23\u0E07\u0E40\u0E23\u0E35\u0E22\u0E19 (School Knowledge Base) \u0E40\u0E1E\u0E37\u0E48\u0E2D\u0E43\u0E2B\u0E49\u0E40\u0E19\u0E37\u0E49\u0E2D\u0E2B\u0E32\u0E41\u0E21\u0E48\u0E19\u0E22\u0E33\u0E15\u0E32\u0E21\u0E2B\u0E25\u0E31\u0E01\u0E2A\u0E39\u0E15\u0E23 \u0E2A\u0E1E\u0E10./\u0E2A\u0E0A."
      ],
      keyFacts: [
        "\u0E17\u0E31\u0E01\u0E29\u0E30\u0E01\u0E32\u0E23\u0E15\u0E31\u0E49\u0E07\u0E42\u0E08\u0E17\u0E22\u0E4C (Instructional Prompting) \u0E2A\u0E33\u0E04\u0E31\u0E0D\u0E01\u0E27\u0E48\u0E32\u0E01\u0E32\u0E23\u0E08\u0E33\u0E40\u0E04\u0E23\u0E37\u0E48\u0E2D\u0E07\u0E21\u0E37\u0E2D",
        "\u0E15\u0E49\u0E2D\u0E07\u0E22\u0E36\u0E14\u0E2B\u0E25\u0E31\u0E01 PDPA \u0E44\u0E21\u0E48\u0E19\u0E33\u0E02\u0E49\u0E2D\u0E21\u0E39\u0E25\u0E2A\u0E48\u0E27\u0E19\u0E1A\u0E38\u0E04\u0E04\u0E25\u0E02\u0E2D\u0E07\u0E19\u0E31\u0E01\u0E40\u0E23\u0E35\u0E22\u0E19\u0E02\u0E36\u0E49\u0E19\u0E23\u0E30\u0E1A\u0E1A\u0E2A\u0E32\u0E18\u0E32\u0E23\u0E13\u0E30\u0E42\u0E14\u0E22\u0E44\u0E21\u0E48\u0E1B\u0E34\u0E14\u0E1A\u0E31\u0E07\u0E15\u0E31\u0E27\u0E15\u0E19"
      ],
      trendAnalysis: "\u0E41\u0E19\u0E27\u0E42\u0E19\u0E49\u0E21\u0E1B\u0E35 2568-2570 \u0E42\u0E23\u0E07\u0E40\u0E23\u0E35\u0E22\u0E19\u0E0A\u0E31\u0E49\u0E19\u0E19\u0E33\u0E01\u0E33\u0E25\u0E31\u0E07\u0E40\u0E1B\u0E25\u0E35\u0E48\u0E22\u0E19\u0E08\u0E32\u0E01\u0E01\u0E32\u0E23\u0E2D\u0E1A\u0E23\u0E21\u0E40\u0E04\u0E23\u0E37\u0E48\u0E2D\u0E07\u0E21\u0E37\u0E2D\u0E40\u0E14\u0E35\u0E48\u0E22\u0E27 \u0E44\u0E1B\u0E2A\u0E39\u0E48\u0E01\u0E32\u0E23\u0E27\u0E32\u0E07\u0E23\u0E30\u0E1A\u0E1A Multi-Agent Workflow \u0E1B\u0E23\u0E30\u0E08\u0E33\u0E2B\u0E21\u0E27\u0E14\u0E27\u0E34\u0E0A\u0E32",
      references: ["\u0E01\u0E23\u0E2D\u0E1A\u0E21\u0E32\u0E15\u0E23\u0E10\u0E32\u0E19\u0E01\u0E32\u0E23\u0E28\u0E36\u0E01\u0E29\u0E32 \u0E2A\u0E1E\u0E10. / \u0E2A\u0E0A. (OPEC)", "UNESCO Guidance for Generative AI in Education", "Komkrit Brand Playbook 2025"],
      kbSourcesUsed: ["Brand Guideline & Tone of Voice: \u0E04\u0E21\u0E04\u0E34\u0E14 by KOMKRIT", "\u0E07\u0E32\u0E19\u0E27\u0E34\u0E08\u0E31\u0E22\u0E41\u0E19\u0E27\u0E42\u0E19\u0E49\u0E21 AI Agentic \u0E43\u0E19\u0E23\u0E30\u0E1A\u0E1A\u0E01\u0E32\u0E23\u0E28\u0E36\u0E01\u0E29\u0E32\u0E42\u0E25\u0E01 2025-2030"]
    }),
    JSON.stringify({
      titleSuggestions: [
        "5 \u0E17\u0E31\u0E01\u0E29\u0E30\u0E2A\u0E33\u0E04\u0E31\u0E0D\u0E02\u0E2D\u0E07\u0E04\u0E23\u0E39\u0E44\u0E17\u0E22\u0E22\u0E38\u0E04 AI Copilot: \u0E40\u0E1B\u0E25\u0E35\u0E48\u0E22\u0E19\u0E20\u0E32\u0E23\u0E30\u0E07\u0E32\u0E19\u0E40\u0E2D\u0E01\u0E2A\u0E32\u0E23\u0E40\u0E1B\u0E47\u0E19\u0E1E\u0E25\u0E31\u0E07\u0E2A\u0E23\u0E49\u0E32\u0E07\u0E41\u0E23\u0E07\u0E1A\u0E31\u0E19\u0E14\u0E32\u0E25\u0E43\u0E08",
        "\u0E40\u0E21\u0E37\u0E48\u0E2D AI \u0E04\u0E37\u0E19\u0E40\u0E27\u0E25\u0E32\u0E43\u0E2B\u0E49\u0E2B\u0E49\u0E2D\u0E07\u0E40\u0E23\u0E35\u0E22\u0E19: \u0E04\u0E39\u0E48\u0E21\u0E37\u0E2D\u0E22\u0E01\u0E23\u0E30\u0E14\u0E31\u0E1A\u0E04\u0E23\u0E39\u0E44\u0E17\u0E22\u0E2A\u0E39\u0E48 Learning Designer \u0E22\u0E38\u0E04\u0E43\u0E2B\u0E21\u0E48",
        "\u0E04\u0E23\u0E39\u0E22\u0E38\u0E04 AI \u0E44\u0E21\u0E48\u0E15\u0E49\u0E2D\u0E07\u0E40\u0E2B\u0E19\u0E37\u0E48\u0E2D\u0E22\u0E04\u0E19\u0E40\u0E14\u0E35\u0E22\u0E27: \u0E27\u0E34\u0E18\u0E35\u0E08\u0E31\u0E14\u0E17\u0E35\u0E21\u0E1C\u0E39\u0E49\u0E0A\u0E48\u0E27\u0E22 AI \u0E1B\u0E23\u0E30\u0E08\u0E33\u0E2B\u0E49\u0E2D\u0E07\u0E40\u0E23\u0E35\u0E22\u0E19\u0E2D\u0E22\u0E48\u0E32\u0E07\u0E21\u0E37\u0E2D\u0E2D\u0E32\u0E0A\u0E35\u0E1E"
      ],
      selectedTitle: "5 \u0E17\u0E31\u0E01\u0E29\u0E30\u0E2A\u0E33\u0E04\u0E31\u0E0D\u0E02\u0E2D\u0E07\u0E04\u0E23\u0E39\u0E44\u0E17\u0E22\u0E22\u0E38\u0E04 AI Copilot: \u0E40\u0E1B\u0E25\u0E35\u0E48\u0E22\u0E19\u0E20\u0E32\u0E23\u0E30\u0E07\u0E32\u0E19\u0E40\u0E2D\u0E01\u0E2A\u0E32\u0E23\u0E40\u0E1B\u0E47\u0E19\u0E1E\u0E25\u0E31\u0E07\u0E2A\u0E23\u0E49\u0E32\u0E07\u0E41\u0E23\u0E07\u0E1A\u0E31\u0E19\u0E14\u0E32\u0E25\u0E43\u0E08",
      subtitle: "\u0E41\u0E19\u0E27\u0E17\u0E32\u0E07\u0E1B\u0E0F\u0E34\u0E1A\u0E31\u0E15\u0E34\u0E08\u0E23\u0E34\u0E07\u0E40\u0E1E\u0E37\u0E48\u0E2D\u0E04\u0E37\u0E19\u0E40\u0E27\u0E25\u0E32\u0E43\u0E2B\u0E49\u0E04\u0E23\u0E39\u0E01\u0E25\u0E31\u0E1A\u0E21\u0E32\u0E2A\u0E23\u0E49\u0E32\u0E07\u0E41\u0E23\u0E07\u0E1A\u0E31\u0E19\u0E14\u0E32\u0E25\u0E43\u0E08\u0E43\u0E2B\u0E49\u0E1C\u0E39\u0E49\u0E40\u0E23\u0E35\u0E22\u0E19",
      excerpt: "\u0E40\u0E08\u0E32\u0E30\u0E25\u0E36\u0E01 5 \u0E17\u0E31\u0E01\u0E29\u0E30\u0E2A\u0E33\u0E04\u0E31\u0E0D\u0E17\u0E35\u0E48\u0E08\u0E30\u0E0A\u0E48\u0E27\u0E22\u0E43\u0E2B\u0E49\u0E04\u0E23\u0E39\u0E41\u0E25\u0E30\u0E1A\u0E38\u0E04\u0E25\u0E32\u0E01\u0E23\u0E17\u0E32\u0E07\u0E01\u0E32\u0E23\u0E28\u0E36\u0E01\u0E29\u0E32\u0E43\u0E0A\u0E49 AI \u0E40\u0E1B\u0E47\u0E19\u0E1C\u0E39\u0E49\u0E0A\u0E48\u0E27\u0E22\u0E25\u0E14\u0E07\u0E32\u0E19\u0E40\u0E2D\u0E01\u0E2A\u0E32\u0E23 \u0E2D\u0E2D\u0E01\u0E41\u0E1A\u0E1A\u0E2A\u0E37\u0E48\u0E2D\u0E01\u0E32\u0E23\u0E2A\u0E2D\u0E19\u0E40\u0E09\u0E1E\u0E32\u0E30\u0E1A\u0E38\u0E04\u0E04\u0E25 \u0E41\u0E25\u0E30\u0E23\u0E31\u0E01\u0E29\u0E32\u0E21\u0E32\u0E15\u0E23\u0E10\u0E32\u0E19\u0E08\u0E23\u0E34\u0E22\u0E18\u0E23\u0E23\u0E21\u0E2D\u0E22\u0E48\u0E32\u0E07\u0E21\u0E37\u0E2D\u0E2D\u0E32\u0E0A\u0E35\u0E1E",
      learningObjectives: [
        "\u0E40\u0E02\u0E49\u0E32\u0E43\u0E08\u0E1A\u0E17\u0E1A\u0E32\u0E17\u0E43\u0E2B\u0E21\u0E48\u0E02\u0E2D\u0E07\u0E04\u0E23\u0E39\u0E43\u0E19\u0E10\u0E32\u0E19\u0E30 Learning Designer \u0E17\u0E35\u0E48\u0E17\u0E33\u0E07\u0E32\u0E19\u0E23\u0E48\u0E27\u0E21\u0E01\u0E31\u0E1A AI Copilot",
        "\u0E1B\u0E23\u0E30\u0E22\u0E38\u0E01\u0E15\u0E4C\u0E43\u0E0A\u0E49 5 \u0E17\u0E31\u0E01\u0E29\u0E30\u0E2B\u0E25\u0E31\u0E01\u0E43\u0E19\u0E01\u0E32\u0E23\u0E25\u0E14\u0E40\u0E27\u0E25\u0E32\u0E17\u0E33\u0E40\u0E2D\u0E01\u0E2A\u0E32\u0E23\u0E41\u0E25\u0E30\u0E40\u0E1E\u0E34\u0E48\u0E21\u0E04\u0E38\u0E13\u0E20\u0E32\u0E1E\u0E41\u0E1C\u0E19\u0E01\u0E32\u0E23\u0E2A\u0E2D\u0E19",
        "\u0E15\u0E23\u0E30\u0E2B\u0E19\u0E31\u0E01\u0E16\u0E36\u0E07\u0E01\u0E32\u0E23\u0E15\u0E23\u0E27\u0E08\u0E2A\u0E2D\u0E1A\u0E04\u0E27\u0E32\u0E21\u0E16\u0E39\u0E01\u0E15\u0E49\u0E2D\u0E07 (Fact Check) \u0E41\u0E25\u0E30\u0E04\u0E38\u0E49\u0E21\u0E04\u0E23\u0E2D\u0E07\u0E02\u0E49\u0E2D\u0E21\u0E39\u0E25\u0E1C\u0E39\u0E49\u0E40\u0E23\u0E35\u0E22\u0E19 (PDPA)"
      ],
      fullArticleMarkdown: `## \u0E40\u0E21\u0E37\u0E48\u0E2D AI \u0E44\u0E21\u0E48\u0E44\u0E14\u0E49\u0E21\u0E32\u0E41\u0E17\u0E19\u0E04\u0E23\u0E39 \u0E41\u0E15\u0E48\u0E21\u0E32 "\u0E04\u0E37\u0E19\u0E40\u0E27\u0E25\u0E32" \u0E43\u0E2B\u0E49\u0E2B\u0E31\u0E27\u0E43\u0E08\u0E02\u0E2D\u0E07\u0E04\u0E27\u0E32\u0E21\u0E40\u0E1B\u0E47\u0E19\u0E04\u0E23\u0E39

\u0E2A\u0E34\u0E48\u0E07\u0E2B\u0E19\u0E36\u0E48\u0E07\u0E17\u0E35\u0E48\u0E1C\u0E21\u0E44\u0E14\u0E49\u0E23\u0E31\u0E1A\u0E1F\u0E31\u0E07\u0E08\u0E32\u0E01\u0E04\u0E38\u0E13\u0E04\u0E23\u0E39\u0E41\u0E25\u0E30\u0E1C\u0E39\u0E49\u0E1A\u0E23\u0E34\u0E2B\u0E32\u0E23\u0E2A\u0E16\u0E32\u0E19\u0E28\u0E36\u0E01\u0E29\u0E32\u0E17\u0E31\u0E48\u0E27\u0E1B\u0E23\u0E30\u0E40\u0E17\u0E28\u0E40\u0E2A\u0E21\u0E2D \u0E04\u0E37\u0E2D\u0E04\u0E27\u0E32\u0E21\u0E15\u0E31\u0E49\u0E07\u0E43\u0E08\u0E2D\u0E22\u0E32\u0E01\u0E17\u0E38\u0E48\u0E21\u0E40\u0E17\u0E40\u0E27\u0E25\u0E32\u0E14\u0E39\u0E41\u0E25\u0E25\u0E39\u0E01\u0E28\u0E34\u0E29\u0E22\u0E4C\u0E41\u0E15\u0E48\u0E25\u0E30\u0E04\u0E19\u0E2D\u0E22\u0E48\u0E32\u0E07\u0E43\u0E01\u0E25\u0E49\u0E0A\u0E34\u0E14 \u0E41\u0E15\u0E48\u0E01\u0E25\u0E31\u0E1A\u0E15\u0E49\u0E2D\u0E07\u0E41\u0E1A\u0E01\u0E23\u0E31\u0E1A\u0E20\u0E32\u0E23\u0E30\u0E07\u0E32\u0E19\u0E40\u0E2D\u0E01\u0E2A\u0E32\u0E23\u0E41\u0E25\u0E30\u0E01\u0E32\u0E23\u0E40\u0E15\u0E23\u0E35\u0E22\u0E21\u0E2A\u0E37\u0E48\u0E2D\u0E17\u0E35\u0E48\u0E01\u0E34\u0E19\u0E40\u0E27\u0E25\u0E32\u0E21\u0E2B\u0E32\u0E28\u0E32\u0E25

\u0E27\u0E31\u0E19\u0E19\u0E35\u0E49\u0E40\u0E17\u0E04\u0E42\u0E19\u0E42\u0E25\u0E22\u0E35 **AI Copilot \u0E41\u0E25\u0E30\u0E23\u0E30\u0E1A\u0E1A Multi-Agent** \u0E01\u0E49\u0E32\u0E27\u0E21\u0E32\u0E16\u0E36\u0E07\u0E08\u0E38\u0E14\u0E17\u0E35\u0E48\u0E2A\u0E32\u0E21\u0E32\u0E23\u0E16\u0E40\u0E1B\u0E47\u0E19\u0E1C\u0E39\u0E49\u0E0A\u0E48\u0E27\u0E22\u0E21\u0E37\u0E2D\u0E02\u0E27\u0E32\u0E02\u0E2D\u0E07\u0E04\u0E38\u0E13\u0E04\u0E23\u0E39\u0E44\u0E14\u0E49\u0E08\u0E23\u0E34\u0E07 \u0E2B\u0E32\u0E01\u0E40\u0E23\u0E32\u0E1E\u0E31\u0E12\u0E19\u0E32 **5 \u0E17\u0E31\u0E01\u0E29\u0E30\u0E2A\u0E33\u0E04\u0E31\u0E0D** \u0E15\u0E48\u0E2D\u0E44\u0E1B\u0E19\u0E35\u0E49:

### 1. \u0E17\u0E31\u0E01\u0E29\u0E30\u0E01\u0E32\u0E23\u0E2D\u0E2D\u0E01\u0E41\u0E1A\u0E1A\u0E42\u0E08\u0E17\u0E22\u0E4C\u0E01\u0E32\u0E23\u0E40\u0E23\u0E35\u0E22\u0E19\u0E23\u0E39\u0E49 (Instructional Prompting)
\u0E40\u0E1B\u0E25\u0E35\u0E48\u0E22\u0E19\u0E08\u0E32\u0E01\u0E01\u0E32\u0E23\u0E2A\u0E31\u0E48\u0E07\u0E43\u0E2B\u0E49 AI "\u0E40\u0E02\u0E35\u0E22\u0E19\u0E40\u0E19\u0E37\u0E49\u0E2D\u0E2B\u0E32\u0E17\u0E31\u0E48\u0E27\u0E44\u0E1B" \u0E40\u0E1B\u0E47\u0E19\u0E01\u0E32\u0E23\u0E01\u0E33\u0E2B\u0E19\u0E14\u0E1A\u0E23\u0E34\u0E1A\u0E17\u0E23\u0E30\u0E14\u0E31\u0E1A\u0E0A\u0E31\u0E49\u0E19 \u0E08\u0E38\u0E14\u0E1B\u0E23\u0E30\u0E2A\u0E07\u0E04\u0E4C\u0E01\u0E32\u0E23\u0E40\u0E23\u0E35\u0E22\u0E19\u0E23\u0E39\u0E49 \u0E41\u0E25\u0E30\u0E2A\u0E21\u0E23\u0E23\u0E16\u0E19\u0E30\u0E17\u0E35\u0E48\u0E15\u0E49\u0E2D\u0E07\u0E01\u0E32\u0E23\u0E27\u0E31\u0E14\u0E1C\u0E25\u0E2D\u0E22\u0E48\u0E32\u0E07\u0E0A\u0E31\u0E14\u0E40\u0E08\u0E19

### 2. \u0E17\u0E31\u0E01\u0E29\u0E30\u0E01\u0E32\u0E23\u0E1B\u0E23\u0E31\u0E1A\u0E40\u0E19\u0E37\u0E49\u0E2D\u0E2B\u0E32\u0E23\u0E32\u0E22\u0E1A\u0E38\u0E04\u0E04\u0E25 (Personalized Differentiation)
\u0E43\u0E0A\u0E49 AI \u0E0A\u0E48\u0E27\u0E22\u0E1B\u0E23\u0E31\u0E1A\u0E23\u0E30\u0E14\u0E31\u0E1A\u0E04\u0E27\u0E32\u0E21\u0E22\u0E32\u0E01\u0E07\u0E48\u0E32\u0E22\u0E02\u0E2D\u0E07\u0E43\u0E1A\u0E07\u0E32\u0E19\u0E41\u0E25\u0E30\u0E01\u0E23\u0E13\u0E35\u0E28\u0E36\u0E01\u0E29\u0E32\u0E43\u0E2B\u0E49\u0E40\u0E2B\u0E21\u0E32\u0E30\u0E01\u0E31\u0E1A\u0E1C\u0E39\u0E49\u0E40\u0E23\u0E35\u0E22\u0E19\u0E17\u0E35\u0E48\u0E21\u0E35\u0E1E\u0E37\u0E49\u0E19\u0E10\u0E32\u0E19\u0E41\u0E15\u0E01\u0E15\u0E48\u0E32\u0E07\u0E01\u0E31\u0E19\u0E43\u0E19\u0E2B\u0E49\u0E2D\u0E07\u0E40\u0E14\u0E35\u0E22\u0E27

### 3. \u0E17\u0E31\u0E01\u0E29\u0E30\u0E01\u0E32\u0E23\u0E40\u0E1B\u0E25\u0E35\u0E48\u0E22\u0E19\u0E40\u0E19\u0E37\u0E49\u0E2D\u0E2B\u0E32\u0E40\u0E1B\u0E47\u0E19\u0E2A\u0E37\u0E48\u0E2D\u0E20\u0E32\u0E1E\u0E41\u0E25\u0E30\u0E01\u0E34\u0E08\u0E01\u0E23\u0E23\u0E21 (Visual & Activity Design)
\u0E22\u0E48\u0E2D\u0E22\u0E1A\u0E17\u0E40\u0E23\u0E35\u0E22\u0E19\u0E0B\u0E31\u0E1A\u0E0B\u0E49\u0E2D\u0E19\u0E43\u0E2B\u0E49\u0E01\u0E25\u0E32\u0E22\u0E40\u0E1B\u0E47\u0E19\u0E41\u0E1C\u0E19\u0E1C\u0E31\u0E07\u0E04\u0E27\u0E32\u0E21\u0E04\u0E34\u0E14 (Mind Map) \u0E2D\u0E34\u0E19\u0E42\u0E1F\u0E01\u0E23\u0E32\u0E1F\u0E34\u0E01 \u0E41\u0E25\u0E30\u0E42\u0E08\u0E17\u0E22\u0E4C Project-Based Learning

### 4. \u0E17\u0E31\u0E01\u0E29\u0E30\u0E01\u0E32\u0E23\u0E15\u0E23\u0E27\u0E08\u0E2A\u0E2D\u0E1A\u0E04\u0E27\u0E32\u0E21\u0E16\u0E39\u0E01\u0E15\u0E49\u0E2D\u0E07\u0E41\u0E25\u0E30\u0E2D\u0E04\u0E15\u0E34 (Fact-Checking & QA Mindset)
\u0E04\u0E23\u0E39\u0E15\u0E49\u0E2D\u0E07\u0E40\u0E1B\u0E47\u0E19\u0E1C\u0E39\u0E49\u0E15\u0E23\u0E27\u0E08\u0E17\u0E32\u0E19\u0E02\u0E49\u0E2D\u0E40\u0E17\u0E47\u0E08\u0E08\u0E23\u0E34\u0E07 \u0E04\u0E27\u0E32\u0E21\u0E40\u0E2B\u0E21\u0E32\u0E30\u0E2A\u0E21\u0E17\u0E32\u0E07\u0E20\u0E32\u0E29\u0E32 \u0E41\u0E25\u0E30\u0E04\u0E27\u0E32\u0E21\u0E2A\u0E2D\u0E14\u0E04\u0E25\u0E49\u0E2D\u0E07\u0E01\u0E31\u0E1A\u0E1A\u0E23\u0E34\u0E1A\u0E17\u0E2A\u0E31\u0E07\u0E04\u0E21\u0E44\u0E17\u0E22\u0E01\u0E48\u0E2D\u0E19\u0E19\u0E33\u0E44\u0E1B\u0E43\u0E0A\u0E49\u0E08\u0E23\u0E34\u0E07\u0E40\u0E2A\u0E21\u0E2D

### 5. \u0E17\u0E31\u0E01\u0E29\u0E30\u0E08\u0E23\u0E34\u0E22\u0E18\u0E23\u0E23\u0E21\u0E41\u0E25\u0E30\u0E01\u0E32\u0E23\u0E1B\u0E01\u0E1B\u0E49\u0E2D\u0E07\u0E02\u0E49\u0E2D\u0E21\u0E39\u0E25\u0E1C\u0E39\u0E49\u0E40\u0E23\u0E35\u0E22\u0E19 (AI Ethics & PDPA)
\u0E2A\u0E23\u0E49\u0E32\u0E07\u0E01\u0E15\u0E34\u0E01\u0E32\u0E01\u0E32\u0E23\u0E43\u0E0A\u0E49 AI \u0E43\u0E19\u0E2B\u0E49\u0E2D\u0E07\u0E40\u0E23\u0E35\u0E22\u0E19\u0E2D\u0E22\u0E48\u0E32\u0E07\u0E42\u0E1B\u0E23\u0E48\u0E07\u0E43\u0E2A \u0E44\u0E21\u0E48\u0E19\u0E33\u0E02\u0E49\u0E2D\u0E21\u0E39\u0E25\u0E23\u0E30\u0E1A\u0E38\u0E15\u0E31\u0E27\u0E15\u0E19\u0E02\u0E2D\u0E07\u0E19\u0E31\u0E01\u0E40\u0E23\u0E35\u0E22\u0E19\u0E40\u0E02\u0E49\u0E32\u0E2A\u0E39\u0E48\u0E23\u0E30\u0E1A\u0E1A\u0E20\u0E32\u0E22\u0E19\u0E2D\u0E01 \u0E41\u0E25\u0E30\u0E2A\u0E2D\u0E19\u0E43\u0E2B\u0E49\u0E40\u0E14\u0E47\u0E01\u0E43\u0E0A\u0E49 AI \u0E40\u0E1E\u0E37\u0E48\u0E2D\u0E15\u0E48\u0E2D\u0E22\u0E2D\u0E14\u0E04\u0E27\u0E32\u0E21\u0E04\u0E34\u0E14 \u0E44\u0E21\u0E48\u0E43\u0E0A\u0E48\u0E41\u0E17\u0E19\u0E04\u0E27\u0E32\u0E21\u0E04\u0E34\u0E14

> "\u0E17\u0E38\u0E01\u0E04\u0E27\u0E32\u0E21\u0E04\u0E34\u0E14\u0E17\u0E35\u0E48\u0E41\u0E15\u0E01\u0E15\u0E48\u0E32\u0E07 \u0E04\u0E37\u0E2D\u0E08\u0E38\u0E14\u0E40\u0E23\u0E34\u0E48\u0E21\u0E15\u0E49\u0E19\u0E02\u0E2D\u0E07\u0E01\u0E32\u0E23\u0E40\u0E1B\u0E25\u0E35\u0E48\u0E22\u0E19\u0E41\u0E1B\u0E25\u0E07 \u2014 \u0E40\u0E21\u0E37\u0E48\u0E2D\u0E04\u0E23\u0E39\u0E21\u0E35\u0E40\u0E04\u0E23\u0E37\u0E48\u0E2D\u0E07\u0E21\u0E37\u0E2D\u0E17\u0E35\u0E48\u0E43\u0E0A\u0E48 \u0E2B\u0E49\u0E2D\u0E07\u0E40\u0E23\u0E35\u0E22\u0E19\u0E44\u0E17\u0E22\u0E08\u0E30\u0E40\u0E15\u0E47\u0E21\u0E44\u0E1B\u0E14\u0E49\u0E27\u0E22\u0E1E\u0E25\u0E31\u0E07\u0E41\u0E2B\u0E48\u0E07\u0E01\u0E32\u0E23\u0E2A\u0E23\u0E49\u0E32\u0E07\u0E2A\u0E23\u0E23\u0E04\u0E4C"`,
      videoScript: `[0:00-0:12 Hook] \u0E04\u0E38\u0E13\u0E04\u0E23\u0E39\u0E04\u0E23\u0E31\u0E1A... \u0E08\u0E30\u0E14\u0E35\u0E41\u0E04\u0E48\u0E44\u0E2B\u0E19\u0E16\u0E49\u0E32\u0E07\u0E32\u0E19\u0E40\u0E2D\u0E01\u0E2A\u0E32\u0E23\u0E17\u0E35\u0E48\u0E40\u0E04\u0E22\u0E43\u0E0A\u0E49\u0E40\u0E27\u0E25\u0E32 3 \u0E0A\u0E31\u0E48\u0E27\u0E42\u0E21\u0E07 \u0E40\u0E2A\u0E23\u0E47\u0E08\u0E25\u0E07\u0E43\u0E19 20 \u0E19\u0E32\u0E17\u0E35 \u0E41\u0E25\u0E49\u0E27\u0E40\u0E23\u0E32\u0E44\u0E14\u0E49\u0E40\u0E27\u0E25\u0E32\u0E40\u0E2B\u0E25\u0E48\u0E32\u0E19\u0E31\u0E49\u0E19\u0E01\u0E25\u0E31\u0E1A\u0E44\u0E1B\u0E04\u0E38\u0E22\u0E41\u0E25\u0E30\u0E14\u0E39\u0E41\u0E25\u0E25\u0E39\u0E01\u0E28\u0E34\u0E29\u0E22\u0E4C\u0E08\u0E23\u0E34\u0E07\u0E46?
[0:12-0:45 Core] \u0E27\u0E31\u0E19\u0E19\u0E35\u0E49 \u0E04\u0E21\u0E04\u0E34\u0E14 by KOMKRIT \u0E2A\u0E23\u0E38\u0E1B 5 \u0E17\u0E31\u0E01\u0E29\u0E30\u0E04\u0E23\u0E39\u0E22\u0E38\u0E04 AI Copilot \u0E15\u0E31\u0E49\u0E07\u0E41\u0E15\u0E48\u0E01\u0E32\u0E23\u0E15\u0E31\u0E49\u0E07\u0E42\u0E08\u0E17\u0E22\u0E4C\u0E15\u0E32\u0E21\u0E2A\u0E21\u0E23\u0E23\u0E16\u0E19\u0E30 \u0E01\u0E32\u0E23\u0E2D\u0E2D\u0E01\u0E41\u0E1A\u0E1A\u0E43\u0E1A\u0E07\u0E32\u0E19\u0E23\u0E32\u0E22\u0E1A\u0E38\u0E04\u0E04\u0E25 \u0E44\u0E1B\u0E08\u0E19\u0E16\u0E36\u0E07\u0E01\u0E32\u0E23\u0E15\u0E23\u0E27\u0E08\u0E17\u0E32\u0E19\u0E04\u0E38\u0E13\u0E20\u0E32\u0E1E\u0E41\u0E25\u0E30 PDPA...
[0:45-0:60 CTA] \u0E40\u0E1E\u0E23\u0E32\u0E30 AI \u0E44\u0E21\u0E48\u0E44\u0E14\u0E49\u0E21\u0E32\u0E41\u0E17\u0E19\u0E04\u0E23\u0E39 \u0E41\u0E15\u0E48\u0E21\u0E32\u0E04\u0E37\u0E19\u0E1E\u0E25\u0E31\u0E07\u0E43\u0E2B\u0E49\u0E04\u0E23\u0E39\u0E2A\u0E23\u0E49\u0E32\u0E07\u0E2D\u0E19\u0E32\u0E04\u0E15\u0E17\u0E35\u0E48\u0E14\u0E35\u0E01\u0E27\u0E48\u0E32 \u0E2D\u0E48\u0E32\u0E19\u0E1A\u0E17\u0E04\u0E27\u0E32\u0E21\u0E09\u0E1A\u0E31\u0E1A\u0E40\u0E15\u0E47\u0E21\u0E44\u0E14\u0E49\u0E17\u0E35\u0E48\u0E40\u0E27\u0E47\u0E1A\u0E44\u0E0B\u0E15\u0E4C \u0E04\u0E21\u0E04\u0E34\u0E14 by KOMKRIT \u0E04\u0E23\u0E31\u0E1A`,
      socialHook: 'AI \u0E44\u0E21\u0E48\u0E44\u0E14\u0E49\u0E21\u0E32\u0E41\u0E17\u0E19\u0E17\u0E35\u0E48\u0E2B\u0E31\u0E27\u0E43\u0E08\u0E02\u0E2D\u0E07\u0E04\u0E27\u0E32\u0E21\u0E40\u0E1B\u0E47\u0E19\u0E04\u0E23\u0E39... \u0E41\u0E15\u0E48\u0E21\u0E32\u0E0A\u0E48\u0E27\u0E22 "\u0E04\u0E37\u0E19\u0E40\u0E27\u0E25\u0E32" \u0E43\u0E2B\u0E49\u0E04\u0E23\u0E39\u0E44\u0E14\u0E49\u0E2A\u0E23\u0E49\u0E32\u0E07\u0E41\u0E23\u0E07\u0E1A\u0E31\u0E19\u0E14\u0E32\u0E25\u0E43\u0E08\u0E43\u0E2B\u0E49\u0E25\u0E39\u0E01\u0E28\u0E34\u0E29\u0E22\u0E4C\u0E2D\u0E22\u0E48\u0E32\u0E07\u0E40\u0E15\u0E47\u0E21\u0E17\u0E35\u0E48 \u{1F4A1} \u0E2A\u0E23\u0E38\u0E1B 5 \u0E17\u0E31\u0E01\u0E29\u0E30\u0E2A\u0E33\u0E04\u0E31\u0E0D\u0E02\u0E2D\u0E07\u0E04\u0E23\u0E39\u0E44\u0E17\u0E22\u0E22\u0E38\u0E04 AI Copilot'
    }),
    JSON.stringify({
      contentStructure: ["\u0E1A\u0E17\u0E19\u0E33\u0E2A\u0E30\u0E17\u0E49\u0E2D\u0E19\u0E1B\u0E31\u0E0D\u0E2B\u0E32\u0E08\u0E23\u0E34\u0E07\u0E02\u0E2D\u0E07\u0E04\u0E23\u0E39", "\u0E01\u0E23\u0E2D\u0E1A\u0E41\u0E19\u0E27\u0E04\u0E34\u0E14 AI + Human", "\u0E40\u0E08\u0E32\u0E30\u0E25\u0E36\u0E01 5 \u0E17\u0E31\u0E01\u0E29\u0E30\u0E1E\u0E23\u0E49\u0E2D\u0E21\u0E27\u0E34\u0E18\u0E35\u0E25\u0E07\u0E21\u0E37\u0E2D\u0E17\u0E33", "\u0E02\u0E49\u0E2D\u0E04\u0E34\u0E14\u0E2A\u0E48\u0E07\u0E17\u0E49\u0E32\u0E22\u0E08\u0E32\u0E01 Komkrit & CTA"],
      brandTone: "Navy & Warm Amber (#0f294a / #f59e0b) \u0E2A\u0E38\u0E20\u0E32\u0E1E \u0E25\u0E36\u0E01\u0E0B\u0E36\u0E49\u0E07 \u0E2A\u0E23\u0E49\u0E32\u0E07\u0E41\u0E23\u0E07\u0E1A\u0E31\u0E19\u0E14\u0E32\u0E25\u0E43\u0E08",
      mindMapNodes: {
        center: "5 \u0E17\u0E31\u0E01\u0E29\u0E30\u0E04\u0E23\u0E39\u0E22\u0E38\u0E04 AI Copilot",
        branches: [
          { title: "\u0E01\u0E32\u0E23\u0E2D\u0E2D\u0E01\u0E41\u0E1A\u0E1A\u0E2A\u0E2D\u0E19", items: ["Instructional Prompting", "Personalized Worksheet"] },
          { title: "\u0E2A\u0E37\u0E48\u0E2D\u0E2A\u0E23\u0E49\u0E32\u0E07\u0E2A\u0E23\u0E23\u0E04\u0E4C", items: ["Mind Map & Infographic", "Project-Based Activity"] },
          { title: "\u0E04\u0E38\u0E13\u0E20\u0E32\u0E1E & \u0E08\u0E23\u0E34\u0E22\u0E18\u0E23\u0E23\u0E21", items: ["Fact Check \u0E42\u0E14\u0E22\u0E04\u0E23\u0E39", "\u0E04\u0E38\u0E49\u0E21\u0E04\u0E23\u0E2D\u0E07\u0E02\u0E49\u0E2D\u0E21\u0E39\u0E25 PDPA"] }
        ]
      },
      slideDeckOutline: [
        { slide: 1, title: "\u0E04\u0E37\u0E19\u0E40\u0E27\u0E25\u0E32\u0E43\u0E2B\u0E49\u0E2B\u0E49\u0E2D\u0E07\u0E40\u0E23\u0E35\u0E22\u0E19\u0E44\u0E17\u0E22\u0E14\u0E49\u0E27\u0E22 AI Copilot", bullet: "\u0E17\u0E33\u0E44\u0E21\u0E04\u0E23\u0E39\u0E22\u0E38\u0E04\u0E43\u0E2B\u0E21\u0E48\u0E04\u0E37\u0E2D Learning Designer" },
        { slide: 2, title: "\u0E17\u0E31\u0E01\u0E29\u0E30\u0E17\u0E35\u0E48 1-2: \u0E15\u0E31\u0E49\u0E07\u0E42\u0E08\u0E17\u0E22\u0E4C\u0E41\u0E21\u0E48\u0E19\u0E22\u0E33 & \u0E14\u0E39\u0E41\u0E25\u0E23\u0E32\u0E22\u0E1A\u0E38\u0E04\u0E04\u0E25", bullet: "\u0E25\u0E14\u0E40\u0E27\u0E25\u0E32\u0E40\u0E15\u0E23\u0E35\u0E22\u0E21\u0E41\u0E1C\u0E19\u0E01\u0E32\u0E23\u0E2A\u0E2D\u0E19 40%" },
        { slide: 3, title: "\u0E17\u0E31\u0E01\u0E29\u0E30\u0E17\u0E35\u0E48 3: \u0E40\u0E1B\u0E25\u0E35\u0E48\u0E22\u0E19\u0E1A\u0E17\u0E40\u0E23\u0E35\u0E22\u0E19\u0E40\u0E1B\u0E47\u0E19\u0E20\u0E32\u0E1E\u0E41\u0E25\u0E30\u0E01\u0E34\u0E08\u0E01\u0E23\u0E23\u0E21", bullet: "\u0E40\u0E0A\u0E37\u0E48\u0E2D\u0E21\u0E42\u0E22\u0E07\u0E1B\u0E31\u0E0D\u0E2B\u0E32\u0E08\u0E23\u0E34\u0E07\u0E43\u0E19\u0E0A\u0E38\u0E21\u0E0A\u0E19" },
        { slide: 4, title: "\u0E17\u0E31\u0E01\u0E29\u0E30\u0E17\u0E35\u0E48 4-5: QA & \u0E08\u0E23\u0E34\u0E22\u0E18\u0E23\u0E23\u0E21 PDPA", bullet: "AI + Human = Greater Impact" }
      ],
      instructionalDesign: "\u0E43\u0E0A\u0E49\u0E42\u0E21\u0E40\u0E14\u0E25 Micro-Learning \u0E2D\u0E48\u0E32\u0E19\u0E08\u0E1A\u0E43\u0E19 4 \u0E19\u0E32\u0E17\u0E35 \u0E1E\u0E23\u0E49\u0E2D\u0E21 Checklist \u0E43\u0E2B\u0E49\u0E04\u0E23\u0E39\u0E19\u0E33\u0E44\u0E1B\u0E17\u0E14\u0E25\u0E2D\u0E07\u0E43\u0E19\u0E04\u0E32\u0E1A\u0E40\u0E23\u0E35\u0E22\u0E19\u0E16\u0E31\u0E14\u0E44\u0E1B\u0E44\u0E14\u0E49\u0E17\u0E31\u0E19\u0E17\u0E35"
    }),
    JSON.stringify({
      imagePrompts: [
        { platform: "Gemini Nano Banana 2.1", prompt: "Modern Thai classroom where an inspiring educator mentors smiling students with clean holographic AI learning mind-maps, deep navy and warm golden lighting, editorial photography" },
        { platform: "Canva AI / Infographic", prompt: "Clean executive educational infographic in Thai style, navy blue #0f294a and amber gold #f59e0b, 5 circular icons around central lightbulb-pencil emblem" }
      ],
      infographicHeadline: "5 \u0E17\u0E31\u0E01\u0E29\u0E30\u0E04\u0E23\u0E39\u0E44\u0E17\u0E22\u0E22\u0E38\u0E04 AI COPILOT",
      infographicSubpoints: ["1. \u0E2D\u0E2D\u0E01\u0E41\u0E1A\u0E1A\u0E42\u0E08\u0E17\u0E22\u0E4C\u0E41\u0E21\u0E48\u0E19\u0E22\u0E33", "2. \u0E1B\u0E23\u0E31\u0E1A\u0E43\u0E1A\u0E07\u0E32\u0E19\u0E23\u0E32\u0E22\u0E1A\u0E38\u0E04\u0E04\u0E25", "3. \u0E2A\u0E23\u0E49\u0E32\u0E07\u0E2A\u0E37\u0E48\u0E2D\u0E20\u0E32\u0E1E & \u0E01\u0E34\u0E08\u0E01\u0E23\u0E23\u0E21", "4. \u0E15\u0E23\u0E27\u0E08\u0E17\u0E32\u0E19\u0E04\u0E27\u0E32\u0E21\u0E16\u0E39\u0E01\u0E15\u0E49\u0E2D\u0E07", "5. \u0E08\u0E23\u0E34\u0E22\u0E18\u0E23\u0E23\u0E21 & PDPA"],
      generatedSvgDataUrl: "",
      recommendedTools: ["Gemini Nano Banana 2.1", "Canva AI", "Midjourney", "Figma"]
    }),
    JSON.stringify({
      duration: "60 \u0E27\u0E34\u0E19\u0E32\u0E17\u0E35 (Reels / TikTok / YouTube Shorts)",
      avatarStyle: "Komkrit Smart Casual Navy Blazer \u0E1E\u0E23\u0E49\u0E2D\u0E21\u0E2D\u0E34\u0E19\u0E42\u0E1F\u0E01\u0E23\u0E32\u0E1F\u0E34\u0E01\u0E1B\u0E23\u0E30\u0E01\u0E2D\u0E1A\u0E14\u0E49\u0E32\u0E19\u0E02\u0E49\u0E32\u0E07",
      scenes: [
        { time: "00:00 - 00:10", visual: "Medium Shot \u0E04\u0E38\u0E13\u0E04\u0E21\u0E01\u0E24\u0E0A + \u0E15\u0E31\u0E27\u0E40\u0E25\u0E02 40% \u0E1A\u0E19\u0E2B\u0E19\u0E49\u0E32\u0E08\u0E2D", dialogue: "\u0E08\u0E30\u0E14\u0E35\u0E41\u0E04\u0E48\u0E44\u0E2B\u0E19\u0E04\u0E23\u0E31\u0E1A \u0E16\u0E49\u0E32\u0E40\u0E23\u0E32\u0E25\u0E14\u0E40\u0E27\u0E25\u0E32\u0E07\u0E32\u0E19\u0E40\u0E2D\u0E01\u0E2A\u0E32\u0E23\u0E04\u0E23\u0E39\u0E25\u0E07\u0E44\u0E14\u0E49\u0E40\u0E01\u0E37\u0E2D\u0E1A\u0E04\u0E23\u0E36\u0E48\u0E07?", subtitle: "\u0E04\u0E37\u0E19\u0E40\u0E27\u0E25\u0E32 40% \u0E43\u0E2B\u0E49\u0E2B\u0E49\u0E2D\u0E07\u0E40\u0E23\u0E35\u0E22\u0E19\u0E44\u0E17\u0E22 \u{1F4A1}", bRoll: "\u0E20\u0E32\u0E1E\u0E04\u0E23\u0E39\u0E40\u0E15\u0E23\u0E35\u0E22\u0E21\u0E40\u0E2D\u0E01\u0E2A\u0E32\u0E23\u0E01\u0E2D\u0E07\u0E42\u0E15\u0E40\u0E1B\u0E25\u0E35\u0E48\u0E22\u0E19\u0E40\u0E1B\u0E47\u0E19\u0E23\u0E2D\u0E22\u0E22\u0E34\u0E49\u0E21\u0E43\u0E19\u0E2B\u0E49\u0E2D\u0E07\u0E40\u0E23\u0E35\u0E22\u0E19" },
        { time: "00:10 - 00:42", visual: "Pop-up 5 Icons \u0E40\u0E23\u0E35\u0E22\u0E07\u0E15\u0E32\u0E21\u0E08\u0E31\u0E07\u0E2B\u0E27\u0E30\u0E1E\u0E39\u0E14", dialogue: "\u0E14\u0E49\u0E27\u0E22 5 \u0E17\u0E31\u0E01\u0E29\u0E30 AI Copilot \u0E15\u0E31\u0E49\u0E07\u0E41\u0E15\u0E48\u0E01\u0E32\u0E23\u0E15\u0E31\u0E49\u0E07\u0E42\u0E08\u0E17\u0E22\u0E4C\u0E2A\u0E21\u0E23\u0E23\u0E16\u0E19\u0E30 \u0E2D\u0E2D\u0E01\u0E41\u0E1A\u0E1A\u0E2A\u0E37\u0E48\u0E2D\u0E23\u0E32\u0E22\u0E1A\u0E38\u0E04\u0E04\u0E25 \u0E44\u0E1B\u0E08\u0E19\u0E16\u0E36\u0E07\u0E01\u0E32\u0E23\u0E15\u0E23\u0E27\u0E08 QA \u0E41\u0E25\u0E30 PDPA", subtitle: "5 \u0E17\u0E31\u0E01\u0E29\u0E30\u0E2A\u0E33\u0E04\u0E31\u0E0D\u0E04\u0E23\u0E39\u0E22\u0E38\u0E04 AI Copilot", bRoll: "\u0E2B\u0E19\u0E49\u0E32\u0E08\u0E2D\u0E23\u0E30\u0E1A\u0E1A Multi-Agent AI \u0E17\u0E33\u0E07\u0E32\u0E19\u0E40\u0E1B\u0E47\u0E19\u0E17\u0E35\u0E21" },
        { time: "00:42 - 01:00", visual: "\u0E42\u0E25\u0E42\u0E01\u0E49 \u0E04\u0E21\u0E04\u0E34\u0E14 by KOMKRIT + \u0E25\u0E34\u0E07\u0E01\u0E4C\u0E1A\u0E17\u0E04\u0E27\u0E32\u0E21", dialogue: "\u0E40\u0E1E\u0E23\u0E32\u0E30 AI \u0E44\u0E21\u0E48\u0E44\u0E14\u0E49\u0E21\u0E32\u0E41\u0E17\u0E19\u0E04\u0E23\u0E39 \u0E41\u0E15\u0E48\u0E21\u0E32\u0E40\u0E2A\u0E23\u0E34\u0E21\u0E1E\u0E25\u0E31\u0E07\u0E43\u0E2B\u0E49\u0E04\u0E23\u0E39\u0E2A\u0E23\u0E49\u0E32\u0E07\u0E04\u0E19\u0E04\u0E38\u0E13\u0E20\u0E32\u0E1E \u0E2D\u0E48\u0E32\u0E19\u0E09\u0E1A\u0E31\u0E1A\u0E40\u0E15\u0E47\u0E21\u0E44\u0E14\u0E49\u0E17\u0E35\u0E48 \u0E04\u0E21\u0E04\u0E34\u0E14 by KOMKRIT \u0E04\u0E23\u0E31\u0E1A", subtitle: "\u0E2D\u0E48\u0E32\u0E19\u0E15\u0E48\u0E2D\u0E17\u0E35\u0E48 \u0E04\u0E21\u0E04\u0E34\u0E14 by KOMKRIT \u2192", bRoll: "\u0E20\u0E32\u0E1E\u0E19\u0E31\u0E01\u0E40\u0E23\u0E35\u0E22\u0E19\u0E17\u0E33\u0E01\u0E34\u0E08\u0E01\u0E23\u0E23\u0E21\u0E01\u0E25\u0E38\u0E48\u0E21\u0E2D\u0E22\u0E48\u0E32\u0E07\u0E21\u0E35\u0E04\u0E27\u0E32\u0E21\u0E2A\u0E38\u0E02" }
      ],
      recommendedTools: ["Gemini Omni 1.1 Flash", "HeyGen (AI Avatar)", "CapCut", "Descript"]
    }),
    JSON.stringify({
      voiceTone: "\u0E19\u0E49\u0E33\u0E40\u0E2A\u0E35\u0E22\u0E07\u0E2D\u0E1A\u0E2D\u0E38\u0E48\u0E19 \u0E2A\u0E38\u0E20\u0E32\u0E1E \u0E21\u0E31\u0E48\u0E19\u0E43\u0E08 \u0E08\u0E31\u0E07\u0E2B\u0E27\u0E30\u0E01\u0E23\u0E30\u0E0A\u0E31\u0E1A (115 \u0E04\u0E33/\u0E19\u0E32\u0E17\u0E35)",
      narrationScriptWithCues: "[\u0E19\u0E49\u0E33\u0E40\u0E2A\u0E35\u0E22\u0E07\u0E2D\u0E1A\u0E2D\u0E38\u0E48\u0E19 \u0E0A\u0E27\u0E19\u0E04\u0E34\u0E14] \u0E04\u0E38\u0E13\u0E04\u0E23\u0E39\u0E04\u0E23\u0E31\u0E1A... \u0E08\u0E30\u0E14\u0E35\u0E41\u0E04\u0E48\u0E44\u0E2B\u0E19\u0E16\u0E49\u0E32\u0E07\u0E32\u0E19\u0E40\u0E2D\u0E01\u0E2A\u0E32\u0E23\u0E17\u0E35\u0E48\u0E40\u0E04\u0E22\u0E43\u0E0A\u0E49\u0E40\u0E27\u0E25\u0E32\u0E2B\u0E25\u0E32\u0E22\u0E0A\u0E31\u0E48\u0E27\u0E42\u0E21\u0E07 \u0E40\u0E2A\u0E23\u0E47\u0E08\u0E25\u0E07\u0E2D\u0E22\u0E48\u0E32\u0E07\u0E21\u0E35\u0E04\u0E38\u0E13\u0E20\u0E32\u0E1E\u0E43\u0E19\u0E44\u0E21\u0E48\u0E01\u0E35\u0E48\u0E19\u0E32\u0E17\u0E35 [\u0E40\u0E27\u0E49\u0E19\u0E08\u0E31\u0E07\u0E2B\u0E27\u0E30 0.8 \u0E27\u0E34\u0E19\u0E32\u0E17\u0E35] \u0E41\u0E25\u0E49\u0E27\u0E40\u0E23\u0E32\u0E44\u0E14\u0E49\u0E40\u0E27\u0E25\u0E32\u0E40\u0E2B\u0E25\u0E48\u0E32\u0E19\u0E31\u0E49\u0E19\u0E01\u0E25\u0E31\u0E1A\u0E44\u0E1B\u0E14\u0E39\u0E41\u0E25\u0E25\u0E39\u0E01\u0E28\u0E34\u0E29\u0E22\u0E4C\u0E08\u0E23\u0E34\u0E07\u0E46? [\u0E40\u0E19\u0E49\u0E19\u0E40\u0E2A\u0E35\u0E22\u0E07\u0E2A\u0E23\u0E49\u0E32\u0E07\u0E1E\u0E25\u0E31\u0E07] \u0E40\u0E1E\u0E23\u0E32\u0E30 AI \u0E44\u0E21\u0E48\u0E44\u0E14\u0E49\u0E21\u0E32\u0E41\u0E17\u0E19\u0E2B\u0E31\u0E27\u0E43\u0E08\u0E02\u0E2D\u0E07\u0E04\u0E27\u0E32\u0E21\u0E40\u0E1B\u0E47\u0E19\u0E04\u0E23\u0E39 \u0E41\u0E15\u0E48\u0E21\u0E32\u0E40\u0E1B\u0E47\u0E19\u0E1C\u0E39\u0E49\u0E0A\u0E48\u0E27\u0E22\u0E04\u0E37\u0E19\u0E40\u0E27\u0E25\u0E32\u0E43\u0E2B\u0E49\u0E2B\u0E49\u0E2D\u0E07\u0E40\u0E23\u0E35\u0E22\u0E19\u0E44\u0E17\u0E22\u0E04\u0E23\u0E31\u0E1A",
      bgmStyle: "Inspiring Acoustic Piano & Soft Ambient Corporate (-22 LUFS)",
      soundEffects: ["Soft Whoosh \u0E15\u0E2D\u0E19\u0E02\u0E36\u0E49\u0E19\u0E2B\u0E31\u0E27\u0E02\u0E49\u0E2D 1-5", "Warm Chime \u0E15\u0E2D\u0E19\u0E02\u0E36\u0E49\u0E19\u0E2A\u0E42\u0E25\u0E41\u0E01\u0E19 \u0E04\u0E34\u0E14\u0E15\u0E48\u0E32\u0E07\u0E2D\u0E22\u0E48\u0E32\u0E07\u0E2A\u0E23\u0E49\u0E32\u0E07\u0E2A\u0E23\u0E23\u0E04\u0E4C"],
      recommendedTools: ["Gemini 3.8 Flash TTS", "ElevenLabs", "Adobe Podcast", "Auphonic"]
    }),
    JSON.stringify({
      factCheckScore: 95,
      factCheckNote: "\u0E02\u0E49\u0E2D\u0E21\u0E39\u0E25\u0E2A\u0E2D\u0E14\u0E04\u0E25\u0E49\u0E2D\u0E07\u0E01\u0E31\u0E1A\u0E41\u0E19\u0E27\u0E17\u0E32\u0E07 UNESCO \u0E41\u0E25\u0E30\u0E01\u0E23\u0E2D\u0E1A\u0E2A\u0E21\u0E23\u0E23\u0E16\u0E19\u0E30\u0E01\u0E32\u0E23\u0E28\u0E36\u0E01\u0E29\u0E32\u0E44\u0E17\u0E22 \u0E21\u0E35\u0E01\u0E32\u0E23\u0E2D\u0E49\u0E32\u0E07\u0E2D\u0E34\u0E07\u0E10\u0E32\u0E19\u0E04\u0E27\u0E32\u0E21\u0E23\u0E39\u0E49\u0E04\u0E23\u0E1A\u0E16\u0E49\u0E27\u0E19",
      languageScore: 96,
      languageNote: "\u0E20\u0E32\u0E29\u0E32\u0E44\u0E17\u0E22\u0E2A\u0E25\u0E30\u0E2A\u0E25\u0E27\u0E22 \u0E2A\u0E30\u0E01\u0E14\u0E16\u0E39\u0E01\u0E15\u0E49\u0E2D\u0E07 \u0E42\u0E04\u0E23\u0E07\u0E2A\u0E23\u0E49\u0E32\u0E07\u0E22\u0E48\u0E2D\u0E2B\u0E19\u0E49\u0E32\u0E2D\u0E48\u0E32\u0E19\u0E07\u0E48\u0E32\u0E22\u0E17\u0E31\u0E49\u0E07\u0E1A\u0E19\u0E04\u0E2D\u0E21\u0E1E\u0E34\u0E27\u0E40\u0E15\u0E2D\u0E23\u0E4C\u0E41\u0E25\u0E30\u0E21\u0E37\u0E2D\u0E16\u0E37\u0E2D",
      brandScore: 98,
      brandNote: '\u0E15\u0E23\u0E07\u0E15\u0E32\u0E21\u0E2D\u0E31\u0E15\u0E25\u0E31\u0E01\u0E29\u0E13\u0E4C "\u0E04\u0E21\u0E04\u0E34\u0E14 by KOMKRIT" \u0E43\u0E2B\u0E49\u0E40\u0E01\u0E35\u0E22\u0E23\u0E15\u0E34\u0E27\u0E34\u0E0A\u0E32\u0E0A\u0E35\u0E1E\u0E04\u0E23\u0E39\u0E41\u0E25\u0E30\u0E0A\u0E35\u0E49\u0E17\u0E32\u0E07\u0E2D\u0E2D\u0E01\u0E40\u0E0A\u0E34\u0E07\u0E2A\u0E23\u0E49\u0E32\u0E07\u0E2A\u0E23\u0E23\u0E04\u0E4C',
      riskScore: 97,
      riskNote: "\u0E1B\u0E25\u0E2D\u0E14\u0E20\u0E31\u0E22 100% \u0E21\u0E35\u0E01\u0E32\u0E23\u0E40\u0E19\u0E49\u0E19\u0E22\u0E49\u0E33\u0E40\u0E23\u0E37\u0E48\u0E2D\u0E07 PDPA \u0E41\u0E25\u0E30\u0E01\u0E32\u0E23\u0E15\u0E23\u0E27\u0E08\u0E2A\u0E2D\u0E1A\u0E42\u0E14\u0E22\u0E21\u0E19\u0E38\u0E29\u0E22\u0E4C\u0E2D\u0E22\u0E48\u0E32\u0E07\u0E0A\u0E31\u0E14\u0E40\u0E08\u0E19",
      overallScore: 97,
      verdict: "\u0E1C\u0E48\u0E32\u0E19",
      improvements: ["\u0E2A\u0E32\u0E21\u0E32\u0E23\u0E16\u0E40\u0E1E\u0E34\u0E48\u0E21\u0E25\u0E34\u0E07\u0E01\u0E4C\u0E25\u0E07\u0E17\u0E30\u0E40\u0E1A\u0E35\u0E22\u0E19 Workshop AI for Education \u0E17\u0E49\u0E32\u0E22\u0E1A\u0E17\u0E04\u0E27\u0E32\u0E21\u0E40\u0E1E\u0E37\u0E48\u0E2D\u0E40\u0E0A\u0E37\u0E48\u0E2D\u0E21\u0E2A\u0E39\u0E48 Pillar \u0E17\u0E35\u0E48 4"]
    }),
    JSON.stringify({
      predictedReach: "18,500 - 26,000 \u0E01\u0E32\u0E23\u0E21\u0E2D\u0E07\u0E40\u0E2B\u0E47\u0E19\u0E43\u0E19 7 \u0E27\u0E31\u0E19\u0E41\u0E23\u0E01",
      predictedEngagement: "\u0E2D\u0E31\u0E15\u0E23\u0E32\u0E01\u0E32\u0E23\u0E41\u0E0A\u0E23\u0E4C\u0E2A\u0E39\u0E07\u0E43\u0E19\u0E01\u0E25\u0E38\u0E48\u0E21\u0E04\u0E23\u0E39\u0E41\u0E25\u0E30\u0E1C\u0E39\u0E49\u0E1A\u0E23\u0E34\u0E2B\u0E32\u0E23\u0E2A\u0E16\u0E32\u0E19\u0E28\u0E36\u0E01\u0E29\u0E32 (\u0E04\u0E32\u0E14\u0E01\u0E32\u0E23\u0E13\u0E4C CTR 6.4%)",
      targetLearnerFit: "\u0E15\u0E23\u0E07\u0E01\u0E25\u0E38\u0E48\u0E21\u0E04\u0E23\u0E39 \u0E1A\u0E38\u0E04\u0E25\u0E32\u0E01\u0E23\u0E17\u0E32\u0E07\u0E01\u0E32\u0E23\u0E28\u0E36\u0E01\u0E29\u0E32 \u0E41\u0E25\u0E30\u0E1C\u0E39\u0E49\u0E1A\u0E23\u0E34\u0E2B\u0E32\u0E23\u0E42\u0E23\u0E07\u0E40\u0E23\u0E35\u0E22\u0E19 96%",
      abHeadlines: [
        "A: 5 \u0E17\u0E31\u0E01\u0E29\u0E30\u0E2A\u0E33\u0E04\u0E31\u0E0D\u0E02\u0E2D\u0E07\u0E04\u0E23\u0E39\u0E44\u0E17\u0E22\u0E22\u0E38\u0E04 AI Copilot: \u0E40\u0E1B\u0E25\u0E35\u0E48\u0E22\u0E19\u0E20\u0E32\u0E23\u0E30\u0E07\u0E32\u0E19\u0E40\u0E2D\u0E01\u0E2A\u0E32\u0E23\u0E40\u0E1B\u0E47\u0E19\u0E1E\u0E25\u0E31\u0E07\u0E2A\u0E23\u0E49\u0E32\u0E07\u0E41\u0E23\u0E07\u0E1A\u0E31\u0E19\u0E14\u0E32\u0E25\u0E43\u0E08",
        "B: \u0E04\u0E37\u0E19\u0E40\u0E27\u0E25\u0E32\u0E43\u0E2B\u0E49\u0E2B\u0E49\u0E2D\u0E07\u0E40\u0E23\u0E35\u0E22\u0E19! 5 \u0E17\u0E31\u0E01\u0E29\u0E30\u0E43\u0E0A\u0E49 AI \u0E40\u0E1B\u0E47\u0E19\u0E1C\u0E39\u0E49\u0E0A\u0E48\u0E27\u0E22\u0E04\u0E23\u0E39\u0E2D\u0E22\u0E48\u0E32\u0E07\u0E21\u0E37\u0E2D\u0E2D\u0E32\u0E0A\u0E35\u0E1E\u0E41\u0E25\u0E30\u0E1B\u0E25\u0E2D\u0E14\u0E20\u0E31\u0E22"
      ],
      optimizationTips: [
        "\u0E42\u0E1E\u0E2A\u0E15\u0E4C\u0E0A\u0E48\u0E27\u0E07\u0E40\u0E27\u0E25\u0E32 19:30 - 21:00 \u0E19. \u0E0B\u0E36\u0E48\u0E07\u0E40\u0E1B\u0E47\u0E19\u0E0A\u0E48\u0E27\u0E07\u0E17\u0E35\u0E48\u0E04\u0E23\u0E39\u0E41\u0E25\u0E30\u0E1C\u0E39\u0E49\u0E1B\u0E01\u0E04\u0E23\u0E2D\u0E07\u0E2D\u0E48\u0E32\u0E19\u0E1A\u0E17\u0E04\u0E27\u0E32\u0E21\u0E40\u0E0A\u0E34\u0E07\u0E25\u0E36\u0E01\u0E21\u0E32\u0E01\u0E17\u0E35\u0E48\u0E2A\u0E38\u0E14",
        "\u0E41\u0E19\u0E1A\u0E20\u0E32\u0E1E\u0E2D\u0E34\u0E19\u0E42\u0E1F\u0E01\u0E23\u0E32\u0E1F\u0E34\u0E01\u0E2A\u0E23\u0E38\u0E1B 5 \u0E02\u0E49\u0E2D\u0E04\u0E27\u0E1A\u0E04\u0E39\u0E48\u0E01\u0E31\u0E1A\u0E25\u0E34\u0E07\u0E01\u0E4C\u0E1A\u0E17\u0E04\u0E27\u0E32\u0E21\u0E40\u0E27\u0E47\u0E1A\u0E44\u0E0B\u0E15\u0E4C\u0E43\u0E19 LINE OA \u0E41\u0E25\u0E30 Facebook"
      ]
    }),
    JSON.stringify({
      youtube: {
        title: "5 \u0E17\u0E31\u0E01\u0E29\u0E30\u0E04\u0E23\u0E39\u0E44\u0E17\u0E22\u0E22\u0E38\u0E04 AI Copilot \u0E04\u0E37\u0E19\u0E40\u0E27\u0E25\u0E32\u0E43\u0E2B\u0E49\u0E2B\u0E49\u0E2D\u0E07\u0E40\u0E23\u0E35\u0E22\u0E19 | \u0E04\u0E21\u0E04\u0E34\u0E14 by KOMKRIT",
        description: "\u0E40\u0E08\u0E32\u0E30\u0E25\u0E36\u0E01\u0E27\u0E34\u0E18\u0E35\u0E43\u0E0A\u0E49 AI \u0E40\u0E1B\u0E47\u0E19\u0E1C\u0E39\u0E49\u0E0A\u0E48\u0E27\u0E22\u0E25\u0E14\u0E07\u0E32\u0E19\u0E40\u0E2D\u0E01\u0E2A\u0E32\u0E23\u0E41\u0E25\u0E30\u0E22\u0E01\u0E23\u0E30\u0E14\u0E31\u0E1A\u0E01\u0E32\u0E23\u0E2A\u0E2D\u0E19 \u0E1E\u0E23\u0E49\u0E2D\u0E21\u0E2B\u0E25\u0E31\u0E01 QA & PDPA \u0E2A\u0E33\u0E2B\u0E23\u0E31\u0E1A\u0E42\u0E23\u0E07\u0E40\u0E23\u0E35\u0E22\u0E19\u0E22\u0E38\u0E04\u0E43\u0E2B\u0E21\u0E48",
        tags: ["\u0E04\u0E21\u0E04\u0E34\u0E14byKOMKRIT", "AI\u0E40\u0E1E\u0E37\u0E48\u0E2D\u0E01\u0E32\u0E23\u0E28\u0E36\u0E01\u0E29\u0E32", "\u0E1E\u0E31\u0E12\u0E19\u0E32\u0E04\u0E23\u0E39", "EdTechThailand"]
      },
      facebook: {
        post: '\u{1F4A1} AI \u0E44\u0E21\u0E48\u0E44\u0E14\u0E49\u0E21\u0E32\u0E41\u0E17\u0E19\u0E17\u0E35\u0E48\u0E2B\u0E31\u0E27\u0E43\u0E08\u0E02\u0E2D\u0E07\u0E04\u0E27\u0E32\u0E21\u0E40\u0E1B\u0E47\u0E19\u0E04\u0E23\u0E39... \u0E41\u0E15\u0E48\u0E21\u0E32\u0E0A\u0E48\u0E27\u0E22 "\u0E04\u0E37\u0E19\u0E40\u0E27\u0E25\u0E32" \u0E43\u0E2B\u0E49\u0E04\u0E23\u0E39\u0E44\u0E14\u0E49\u0E2A\u0E23\u0E49\u0E32\u0E07\u0E41\u0E23\u0E07\u0E1A\u0E31\u0E19\u0E14\u0E32\u0E25\u0E43\u0E08\u0E43\u0E2B\u0E49\u0E25\u0E39\u0E01\u0E28\u0E34\u0E29\u0E22\u0E4C\n\n\u0E0A\u0E27\u0E19\u0E2D\u0E48\u0E32\u0E19 5 \u0E17\u0E31\u0E01\u0E29\u0E30\u0E2A\u0E33\u0E04\u0E31\u0E0D\u0E02\u0E2D\u0E07\u0E04\u0E23\u0E39\u0E44\u0E17\u0E22\u0E22\u0E38\u0E04 AI Copilot \u0E17\u0E35\u0E48\u0E40\u0E1B\u0E25\u0E35\u0E48\u0E22\u0E19\u0E07\u0E32\u0E19\u0E40\u0E2D\u0E01\u0E2A\u0E32\u0E23\u0E2B\u0E19\u0E31\u0E01\u0E46 \u0E43\u0E2B\u0E49\u0E40\u0E1B\u0E47\u0E19\u0E2A\u0E37\u0E48\u0E2D\u0E01\u0E32\u0E23\u0E2A\u0E2D\u0E19\u0E04\u0E38\u0E13\u0E20\u0E32\u0E1E\u0E2A\u0E39\u0E07 \u0E1E\u0E23\u0E49\u0E2D\u0E21\u0E41\u0E19\u0E27\u0E17\u0E32\u0E07\u0E08\u0E23\u0E34\u0E22\u0E18\u0E23\u0E23\u0E21\u0E41\u0E25\u0E30 PDPA \u0E17\u0E35\u0E48\u0E42\u0E23\u0E07\u0E40\u0E23\u0E35\u0E22\u0E19\u0E19\u0E33\u0E44\u0E1B\u0E43\u0E0A\u0E49\u0E44\u0E14\u0E49\u0E17\u0E31\u0E19\u0E17\u0E35\u0E04\u0E23\u0E31\u0E1A',
        engagementQuestion: "\u0E04\u0E38\u0E13\u0E04\u0E23\u0E39\u0E04\u0E34\u0E14\u0E27\u0E48\u0E32\u0E07\u0E32\u0E19\u0E2A\u0E48\u0E27\u0E19\u0E44\u0E2B\u0E19\u0E43\u0E19\u0E42\u0E23\u0E07\u0E40\u0E23\u0E35\u0E22\u0E19\u0E17\u0E35\u0E48\u0E2D\u0E22\u0E32\u0E01\u0E43\u0E2B\u0E49 AI \u0E40\u0E02\u0E49\u0E32\u0E21\u0E32\u0E0A\u0E48\u0E27\u0E22\u0E41\u0E1A\u0E48\u0E07\u0E40\u0E1A\u0E32\u0E20\u0E32\u0E23\u0E30\u0E21\u0E32\u0E01\u0E17\u0E35\u0E48\u0E2A\u0E38\u0E14\u0E04\u0E23\u0E31\u0E1A? \u0E21\u0E32\u0E41\u0E25\u0E01\u0E40\u0E1B\u0E25\u0E35\u0E48\u0E22\u0E19\u0E01\u0E31\u0E19\u0E43\u0E15\u0E49\u0E42\u0E1E\u0E2A\u0E15\u0E4C\u0E19\u0E35\u0E49\u0E44\u0E14\u0E49\u0E40\u0E25\u0E22\u0E04\u0E23\u0E31\u0E1A \u{1F447}"
      },
      tiktok: {
        hook: "\u0E25\u0E14\u0E40\u0E27\u0E25\u0E32\u0E07\u0E32\u0E19\u0E40\u0E2D\u0E01\u0E2A\u0E32\u0E23\u0E04\u0E23\u0E39\u0E25\u0E07 40% \u0E14\u0E49\u0E27\u0E22 5 \u0E17\u0E31\u0E01\u0E29\u0E30 AI Copilot \u0E19\u0E35\u0E49!",
        caption: "\u0E04\u0E37\u0E19\u0E40\u0E27\u0E25\u0E32\u0E43\u0E2B\u0E49\u0E04\u0E23\u0E39\u0E01\u0E25\u0E31\u0E1A\u0E21\u0E32\u0E2A\u0E23\u0E49\u0E32\u0E07\u0E41\u0E23\u0E07\u0E1A\u0E31\u0E19\u0E14\u0E32\u0E25\u0E43\u0E08\u0E43\u0E2B\u0E49\u0E40\u0E14\u0E47\u0E01\u0E46 #\u0E04\u0E21\u0E04\u0E34\u0E14byKOMKRIT #\u0E04\u0E34\u0E14\u0E15\u0E48\u0E32\u0E07\u0E2D\u0E22\u0E48\u0E32\u0E07\u0E2A\u0E23\u0E49\u0E32\u0E07\u0E2A\u0E23\u0E23\u0E04\u0E4C",
        hashtags: ["#\u0E04\u0E21\u0E04\u0E34\u0E14byKOMKRIT", "#AI\u0E01\u0E32\u0E23\u0E28\u0E36\u0E01\u0E29\u0E32", "#\u0E04\u0E23\u0E39\u0E44\u0E17\u0E22\u0E22\u0E38\u0E04\u0E43\u0E2B\u0E21\u0E48", "#EdTech"]
      },
      lineOa: {
        headline: "\u{1F4DA} \u0E1A\u0E17\u0E04\u0E27\u0E32\u0E21\u0E43\u0E2B\u0E21\u0E48: 5 \u0E17\u0E31\u0E01\u0E29\u0E30\u0E04\u0E23\u0E39\u0E44\u0E17\u0E22\u0E22\u0E38\u0E04 AI Copilot",
        broadcastMessage: "\u0E2A\u0E27\u0E31\u0E2A\u0E14\u0E35\u0E04\u0E23\u0E31\u0E1A\u0E0A\u0E32\u0E27\u0E04\u0E21\u0E04\u0E34\u0E14! \u0E27\u0E31\u0E19\u0E19\u0E35\u0E49\u0E1C\u0E21\u0E2A\u0E23\u0E38\u0E1B\u0E41\u0E19\u0E27\u0E17\u0E32\u0E07\u0E43\u0E0A\u0E49 AI \u0E0A\u0E48\u0E27\u0E22\u0E25\u0E14\u0E20\u0E32\u0E23\u0E30\u0E07\u0E32\u0E19\u0E40\u0E2D\u0E01\u0E2A\u0E32\u0E23\u0E04\u0E23\u0E39\u0E41\u0E25\u0E30\u0E2D\u0E2D\u0E01\u0E41\u0E1A\u0E1A\u0E43\u0E1A\u0E07\u0E32\u0E19\u0E23\u0E32\u0E22\u0E1A\u0E38\u0E04\u0E04\u0E25\u0E2D\u0E22\u0E48\u0E32\u0E07\u0E1B\u0E25\u0E2D\u0E14\u0E20\u0E31\u0E22\u0E15\u0E32\u0E21\u0E2B\u0E25\u0E31\u0E01 PDPA \u0E2D\u0E48\u0E32\u0E19\u0E09\u0E1A\u0E31\u0E1A\u0E40\u0E15\u0E47\u0E21\u0E1E\u0E23\u0E49\u0E2D\u0E21\u0E2D\u0E34\u0E19\u0E42\u0E1F\u0E01\u0E23\u0E32\u0E1F\u0E34\u0E01\u0E44\u0E14\u0E49\u0E40\u0E25\u0E22\u0E04\u0E23\u0E31\u0E1A \u2192"
      },
      xTwitter: {
        thread: [
          '1/ \u0E04\u0E33\u0E16\u0E32\u0E21\u0E02\u0E2D\u0E07\u0E01\u0E32\u0E23\u0E28\u0E36\u0E01\u0E29\u0E32\u0E44\u0E17\u0E22\u0E27\u0E31\u0E19\u0E19\u0E35\u0E49\u0E44\u0E21\u0E48\u0E43\u0E0A\u0E48 "\u0E08\u0E30\u0E43\u0E2B\u0E49\u0E43\u0E0A\u0E49 AI \u0E44\u0E2B\u0E21" \u0E41\u0E15\u0E48\u0E04\u0E37\u0E2D "\u0E08\u0E30\u0E15\u0E34\u0E14\u0E2D\u0E32\u0E27\u0E38\u0E18\u0E43\u0E2B\u0E49\u0E04\u0E23\u0E39\u0E43\u0E0A\u0E49 AI \u0E04\u0E37\u0E19\u0E40\u0E27\u0E25\u0E32\u0E2A\u0E39\u0E48\u0E2B\u0E49\u0E2D\u0E07\u0E40\u0E23\u0E35\u0E22\u0E19\u0E2D\u0E22\u0E48\u0E32\u0E07\u0E44\u0E23" \u{1F9F5}\u{1F447}',
          "2/ 5 \u0E17\u0E31\u0E01\u0E29\u0E30\u0E2A\u0E33\u0E04\u0E31\u0E0D\u0E02\u0E2D\u0E07\u0E04\u0E23\u0E39\u0E22\u0E38\u0E04 AI Copilot: (1) Instructional Prompting (2) \u0E43\u0E1A\u0E07\u0E32\u0E19\u0E23\u0E32\u0E22\u0E1A\u0E38\u0E04\u0E04\u0E25 (3) \u0E40\u0E1B\u0E25\u0E35\u0E48\u0E22\u0E19\u0E40\u0E19\u0E37\u0E49\u0E2D\u0E2B\u0E32\u0E40\u0E1B\u0E47\u0E19\u0E20\u0E32\u0E1E/\u0E42\u0E1B\u0E23\u0E40\u0E08\u0E01\u0E15\u0E4C (4) \u0E15\u0E23\u0E27\u0E08 Fact Check (5) \u0E08\u0E23\u0E34\u0E22\u0E18\u0E23\u0E23\u0E21 & PDPA",
          "3/ \u0E40\u0E1E\u0E23\u0E32\u0E30 AI + Human = Greater Impact \u0E2D\u0E48\u0E32\u0E19\u0E1A\u0E17\u0E04\u0E27\u0E32\u0E21\u0E40\u0E15\u0E47\u0E21\u0E44\u0E14\u0E49\u0E17\u0E35\u0E48\u0E40\u0E27\u0E47\u0E1A\u0E44\u0E0B\u0E15\u0E4C \u0E04\u0E21\u0E04\u0E34\u0E14 by KOMKRIT \u0E04\u0E23\u0E31\u0E1A #\u0E04\u0E21\u0E04\u0E34\u0E14byKOMKRIT"
        ]
      },
      instagram: {
        carouselSlides: [
          "Slide 1: 5 \u0E17\u0E31\u0E01\u0E29\u0E30\u0E04\u0E23\u0E39\u0E44\u0E17\u0E22\u0E22\u0E38\u0E04 AI COPILOT \u0E04\u0E37\u0E19\u0E40\u0E27\u0E25\u0E32\u0E43\u0E2B\u0E49\u0E2B\u0E49\u0E2D\u0E07\u0E40\u0E23\u0E35\u0E22\u0E19",
          "Slide 2: 1. \u0E15\u0E31\u0E49\u0E07\u0E42\u0E08\u0E17\u0E22\u0E4C\u0E15\u0E32\u0E21\u0E2A\u0E21\u0E23\u0E23\u0E16\u0E19\u0E30 & 2. \u0E2D\u0E2D\u0E01\u0E41\u0E1A\u0E1A\u0E43\u0E1A\u0E07\u0E32\u0E19\u0E23\u0E32\u0E22\u0E1A\u0E38\u0E04\u0E04\u0E25",
          "Slide 3: 3. \u0E2A\u0E23\u0E49\u0E32\u0E07\u0E2A\u0E37\u0E48\u0E2D\u0E20\u0E32\u0E1E & 4. \u0E04\u0E23\u0E39\u0E15\u0E23\u0E27\u0E08\u0E17\u0E32\u0E19\u0E04\u0E27\u0E32\u0E21\u0E16\u0E39\u0E01\u0E15\u0E49\u0E2D\u0E07 (QA)",
          "Slide 4: 5. \u0E22\u0E36\u0E14\u0E21\u0E31\u0E48\u0E19\u0E08\u0E23\u0E34\u0E22\u0E18\u0E23\u0E23\u0E21 & PDPA \u2014 AI + Human = Greater Impact"
        ],
        caption: "\u0E04\u0E34\u0E14\u0E15\u0E48\u0E32\u0E07\u0E2D\u0E22\u0E48\u0E32\u0E07\u0E2A\u0E23\u0E49\u0E32\u0E07\u0E2A\u0E23\u0E23\u0E04\u0E4C \u0E40\u0E1E\u0E37\u0E48\u0E2D\u0E01\u0E32\u0E23\u0E28\u0E36\u0E01\u0E29\u0E32 \u0E40\u0E1E\u0E37\u0E48\u0E2D\u0E2A\u0E31\u0E07\u0E04\u0E21 \u0E40\u0E1E\u0E37\u0E48\u0E2D\u0E2D\u0E19\u0E32\u0E04\u0E15\u0E17\u0E35\u0E48\u0E14\u0E35\u0E01\u0E27\u0E48\u0E32 \u2728 \u0E2D\u0E48\u0E32\u0E19\u0E09\u0E1A\u0E31\u0E1A\u0E40\u0E15\u0E47\u0E21\u0E44\u0E14\u0E49\u0E17\u0E35\u0E48\u0E25\u0E34\u0E07\u0E01\u0E4C\u0E2B\u0E19\u0E49\u0E32\u0E42\u0E1B\u0E23\u0E44\u0E1F\u0E25\u0E4C"
      },
      websiteBlog: {
        slug: "5-ai-copilot-skills-for-thai-teachers",
        seoMeta: "5 \u0E17\u0E31\u0E01\u0E29\u0E30\u0E2A\u0E33\u0E04\u0E31\u0E0D\u0E02\u0E2D\u0E07\u0E04\u0E23\u0E39\u0E44\u0E17\u0E22\u0E22\u0E38\u0E04 AI Copilot \u0E25\u0E14\u0E07\u0E32\u0E19\u0E40\u0E2D\u0E01\u0E2A\u0E32\u0E23 \u0E40\u0E1E\u0E34\u0E48\u0E21\u0E04\u0E38\u0E13\u0E20\u0E32\u0E1E\u0E01\u0E32\u0E23\u0E2A\u0E2D\u0E19 \u0E42\u0E14\u0E22 \u0E04\u0E21\u0E04\u0E34\u0E14 by KOMKRIT"
      },
      emailNewsletter: {
        subject: "[\u0E04\u0E21\u0E04\u0E34\u0E14 Newsletter] 5 \u0E17\u0E31\u0E01\u0E29\u0E30\u0E04\u0E23\u0E39\u0E44\u0E17\u0E22\u0E22\u0E38\u0E04 AI Copilot: \u0E04\u0E37\u0E19\u0E40\u0E27\u0E25\u0E32\u0E43\u0E2B\u0E49\u0E2B\u0E31\u0E27\u0E43\u0E08\u0E02\u0E2D\u0E07\u0E04\u0E27\u0E32\u0E21\u0E40\u0E1B\u0E47\u0E19\u0E04\u0E23\u0E39",
        previewText: "\u0E41\u0E19\u0E27\u0E17\u0E32\u0E07\u0E1B\u0E0F\u0E34\u0E1A\u0E31\u0E15\u0E34\u0E08\u0E23\u0E34\u0E07\u0E43\u0E19\u0E01\u0E32\u0E23\u0E19\u0E33 AI \u0E21\u0E32\u0E0A\u0E48\u0E27\u0E22\u0E25\u0E14\u0E20\u0E32\u0E23\u0E30\u0E07\u0E32\u0E19\u0E40\u0E2D\u0E01\u0E2A\u0E32\u0E23\u0E41\u0E25\u0E30\u0E2D\u0E2D\u0E01\u0E41\u0E1A\u0E1A\u0E01\u0E32\u0E23\u0E40\u0E23\u0E35\u0E22\u0E19\u0E23\u0E39\u0E49\u0E23\u0E32\u0E22\u0E1A\u0E38\u0E04\u0E04\u0E25",
        bodyIntro: "\u0E2A\u0E27\u0E31\u0E2A\u0E14\u0E35\u0E04\u0E23\u0E31\u0E1A\u0E01\u0E31\u0E25\u0E22\u0E32\u0E13\u0E21\u0E34\u0E15\u0E23\u0E17\u0E32\u0E07\u0E01\u0E32\u0E23\u0E28\u0E36\u0E01\u0E29\u0E32\u0E17\u0E38\u0E01\u0E17\u0E48\u0E32\u0E19 \u0E2A\u0E31\u0E1B\u0E14\u0E32\u0E2B\u0E4C\u0E19\u0E35\u0E49\u0E1C\u0E21\u0E02\u0E2D\u0E19\u0E33\u0E40\u0E2A\u0E19\u0E2D\u0E21\u0E38\u0E21\u0E21\u0E2D\u0E07\u0E40\u0E0A\u0E34\u0E07\u0E1B\u0E0F\u0E34\u0E1A\u0E31\u0E15\u0E34\u0E17\u0E35\u0E48\u0E08\u0E30\u0E0A\u0E48\u0E27\u0E22\u0E43\u0E2B\u0E49\u0E04\u0E38\u0E13\u0E04\u0E23\u0E39\u0E43\u0E0A\u0E49 AI \u0E2D\u0E22\u0E48\u0E32\u0E07\u0E2A\u0E1A\u0E32\u0E22\u0E43\u0E08\u0E41\u0E25\u0E30\u0E17\u0E23\u0E07\u0E1E\u0E25\u0E31\u0E07..."
      },
      publishedChannels: []
    }),
    JSON.stringify({
      isAccurate: true,
      isAppropriate: true,
      isOnBrand: true,
      isReady: false,
      reviewerNote: "\u0E23\u0E2D\u0E1C\u0E39\u0E49\u0E1A\u0E23\u0E34\u0E2B\u0E32\u0E23 (Human Approval) \u0E01\u0E14\u0E2D\u0E19\u0E38\u0E21\u0E31\u0E15\u0E34\u0E40\u0E1E\u0E37\u0E48\u0E2D\u0E40\u0E1C\u0E22\u0E41\u0E1E\u0E23\u0E48\u0E02\u0E36\u0E49\u0E19\u0E2B\u0E19\u0E49\u0E32\u0E40\u0E27\u0E47\u0E1A\u0E44\u0E0B\u0E15\u0E4C\u0E2B\u0E25\u0E31\u0E01\u0E17\u0E31\u0E19\u0E17\u0E35",
      publishedPostId: null
    }),
    now,
    now
  );
  db.prepare(`INSERT INTO subscribers (email, name, role, created_at) VALUES (?, ?, ?, ?)`).run(
    "teacher.somchai@school.ac.th",
    "\u0E1C\u0E2D.\u0E2A\u0E21\u0E0A\u0E32\u0E22 \u0E40\u0E01\u0E35\u0E22\u0E23\u0E15\u0E34\u0E40\u0E08\u0E23\u0E34\u0E0D",
    "\u0E04\u0E23\u0E39 / \u0E1A\u0E38\u0E04\u0E25\u0E32\u0E01\u0E23\u0E17\u0E32\u0E07\u0E01\u0E32\u0E23\u0E28\u0E36\u0E01\u0E29\u0E32",
    "2025-09-10T08:00:00.000Z"
  );
  db.prepare(`INSERT INTO subscribers (email, name, role, created_at) VALUES (?, ?, ?, ?)`).run(
    "nicha.parent@gmail.com",
    "\u0E04\u0E38\u0E13\u0E13\u0E34\u0E0A\u0E32 \u0E27\u0E07\u0E28\u0E4C\u0E2A\u0E27\u0E31\u0E2A\u0E14\u0E34\u0E4C",
    "\u0E1C\u0E39\u0E49\u0E1B\u0E01\u0E04\u0E23\u0E2D\u0E07",
    "2025-09-12T11:30:00.000Z"
  );
  const setSetting = db.prepare(`INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)`);
  setSetting.run("ai_provider", "auto");
  setSetting.run("gemini_model", "");
  setSetting.run("gemini_api_key", process.env.GEMINI_API_KEY || "");
  setSetting.run("local_endpoint", "http://localhost:1234/v1");
  setSetting.run("local_model", "");
  setSetting.run("dynamic_model_discovery_v1", "1");
}

// server/aiEngine.ts
import { GoogleGenAI as GoogleGenAI2 } from "@google/genai";

// server/mediaEngine.ts
import fs2 from "node:fs";
import path2 from "node:path";
import { execFile as execFile2 } from "node:child_process";
import { promisify as promisify2 } from "node:util";
import { GoogleGenAI } from "@google/genai";

// server/cloudSync.ts
import crypto2 from "node:crypto";
var BLOB_API_BASE = "https://blob.vercel-storage.com";
var STATE_PREFIX = "state/komkrit-db-";
var currentLoadedBlobPath = "";
var lastCheckAt = 0;
var blobWriteSuspended = false;
var blobSuspendedRetryAfter = 0;
var hasUnsyncedLocalMutations = false;
function getBlobToken() {
  return (process.env.BLOB_READ_WRITE_TOKEN || "").trim();
}
function isCloudSyncEnabled() {
  return IS_SERVERLESS && Boolean(getBlobToken());
}
function deriveEncryptionKey(token) {
  return crypto2.createHash("sha256").update(`komkrit-sqlite-v1:${token}`).digest();
}
function encryptBuffer(plain, token) {
  const key = deriveEncryptionKey(token);
  const iv = crypto2.randomBytes(12);
  const cipher = crypto2.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(plain), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]);
}
function decryptBuffer(packed, token) {
  if (packed.length < 29) {
    throw new Error("Invalid encrypted DB snapshot");
  }
  const key = deriveEncryptionKey(token);
  const iv = packed.subarray(0, 12);
  const tag = packed.subarray(12, 28);
  const ciphertext = packed.subarray(28);
  const decipher = crypto2.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}
async function listStateBlobs(token) {
  const res = await fetch(
    `${BLOB_API_BASE}?prefix=${encodeURIComponent(STATE_PREFIX)}&limit=20`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        "x-api-version": "7"
      },
      cache: "no-store"
    }
  );
  if (!res.ok) return [];
  const data = await res.json();
  const blobs = Array.isArray(data.blobs) ? data.blobs : [];
  blobs.sort((a, b) => b.pathname > a.pathname ? 1 : -1);
  return blobs;
}
async function deleteOldStateBlobs(token, urlsToDelete) {
  if (urlsToDelete.length === 0) return;
  try {
    await fetch(`${BLOB_API_BASE}/delete`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "x-api-version": "7",
        "content-type": "application/json"
      },
      body: JSON.stringify({ urls: urlsToDelete })
    });
  } catch {
  }
}
async function syncDatabaseBeforeRequest(forceCheck = false) {
  if (!isCloudSyncEnabled()) return;
  if (hasUnsyncedLocalMutations && blobWriteSuspended) {
    return;
  }
  const token = getBlobToken();
  const now = Date.now();
  if (!forceCheck && currentLoadedBlobPath && now - lastCheckAt < 3e4) {
    return;
  }
  lastCheckAt = now;
  const blobs = await listStateBlobs(token);
  if (blobs.length === 0) {
    if (!currentLoadedBlobPath && !blobWriteSuspended) {
      await persistDatabaseToCloud();
    }
    return;
  }
  const newest = blobs[0];
  if (newest.pathname === currentLoadedBlobPath) {
    return;
  }
  const dl = await fetch(newest.url, { cache: "no-store" });
  if (!dl.ok) return;
  const encryptedBytes = Buffer.from(await dl.arrayBuffer());
  const sqliteBytes = decryptBuffer(encryptedBytes, token);
  let memVaultTs = 0;
  let memSettingsRows = [];
  try {
    const tsRow = db.prepare("SELECT value FROM settings WHERE key = '_vault_updated_at'").get();
    memVaultTs = Number(tsRow?.value || "0") || 0;
    if (memVaultTs > 0) {
      memSettingsRows = db.prepare("SELECT key, value FROM settings").all();
    }
  } catch {
  }
  reloadDatabaseFromSnapshotBuffer(sqliteBytes);
  if (memVaultTs > 0 && memSettingsRows.length > 0) {
    try {
      const snapTsRow = db.prepare("SELECT value FROM settings WHERE key = '_vault_updated_at'").get();
      const snapVaultTs = Number(snapTsRow?.value || "0") || 0;
      if (memVaultTs > snapVaultTs) {
        const setStmt = db.prepare(
          "INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)"
        );
        for (const r of memSettingsRows) {
          setStmt.run(r.key, r.value);
        }
      }
    } catch {
    }
  }
  currentLoadedBlobPath = newest.pathname;
  hasUnsyncedLocalMutations = false;
}
async function persistDatabaseToCloud() {
  if (!isCloudSyncEnabled()) return true;
  const now = Date.now();
  hasUnsyncedLocalMutations = true;
  if (blobWriteSuspended && now < blobSuspendedRetryAfter) {
    return false;
  }
  const token = getBlobToken();
  const sqliteBytes = exportDatabaseSnapshotBuffer();
  const encryptedBytes = encryptBuffer(sqliteBytes, token);
  const ts = String(now).padStart(15, "0");
  const rand = crypto2.randomBytes(3).toString("hex");
  const pathname = `${STATE_PREFIX}${ts}-${rand}.enc`;
  const putRes = await fetch(`${BLOB_API_BASE}/${pathname}`, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${token}`,
      "x-api-version": "7",
      "x-content-type": "application/octet-stream",
      "x-add-random-suffix": "0",
      "x-cache-control-max-age": "0"
    },
    body: new Uint8Array(encryptedBytes)
  });
  if (putRes.ok) {
    blobWriteSuspended = false;
    blobSuspendedRetryAfter = 0;
    hasUnsyncedLocalMutations = false;
    currentLoadedBlobPath = pathname;
    lastCheckAt = Date.now();
    const blobs = await listStateBlobs(token);
    if (blobs.length > 2) {
      const oldUrls = blobs.slice(2).map((b) => b.url);
      await deleteOldStateBlobs(token, oldUrls);
    }
    return true;
  }
  blobWriteSuspended = true;
  blobSuspendedRetryAfter = Date.now() + 5 * 60 * 1e3;
  return false;
}
async function uploadMediaToCloudBlob(buffer, filename, mimeType) {
  const token = getBlobToken();
  if (!IS_SERVERLESS || !token) return null;
  const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, "-");
  const pathname = `media/${Date.now()}-${safeName}`;
  const res = await fetch(`${BLOB_API_BASE}/${pathname}`, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${token}`,
      "x-api-version": "7",
      "x-content-type": mimeType || "application/octet-stream",
      "x-add-random-suffix": "0"
    },
    body: new Uint8Array(buffer)
  });
  if (!res.ok) return null;
  const data = await res.json();
  return data.url || null;
}
async function deleteMediaFromCloudBlob(blobUrl) {
  const token = getBlobToken();
  if (!token || !blobUrl || !blobUrl.includes("blob.vercel-storage.com")) return;
  try {
    await fetch(`${BLOB_API_BASE}/delete`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "x-api-version": "7",
        "content-type": "application/json"
      },
      body: JSON.stringify({ urls: [blobUrl] })
    });
  } catch {
  }
}

// server/modelRegistry.ts
import { execFile } from "node:child_process";
import { promisify } from "node:util";
var execFileAsync = promisify(execFile);
var CACHE_TTL_MS = 3 * 60 * 1e3;
var catalogCache = /* @__PURE__ */ new Map();
function invalidateModelCatalogCache(provider) {
  if (!provider) {
    catalogCache.clear();
    return;
  }
  for (const key of catalogCache.keys()) {
    if (key.startsWith(`${provider}:`)) {
      catalogCache.delete(key);
    }
  }
}
function fingerprintSecret(secret) {
  if (!secret) return "none";
  let hash = 2166136261;
  for (let i = 0; i < secret.length; i++) {
    hash ^= secret.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}
function sanitizeSecretInError(raw, secret) {
  let msg = String(raw || "\u0E44\u0E21\u0E48\u0E2A\u0E32\u0E21\u0E32\u0E23\u0E16\u0E14\u0E36\u0E07\u0E23\u0E32\u0E22\u0E0A\u0E37\u0E48\u0E2D\u0E42\u0E21\u0E40\u0E14\u0E25\u0E08\u0E32\u0E01 API \u0E44\u0E14\u0E49");
  if (secret && secret.trim().length > 6) {
    msg = msg.split(secret.trim()).join("***");
  }
  return msg;
}
function emptyCatalog(provider, connected = false, error) {
  return {
    provider,
    connected,
    fetchedAt: (/* @__PURE__ */ new Date()).toISOString(),
    ...error ? { error } : {},
    textModels: [],
    imageModels: [],
    videoModels: [],
    ttsModels: [],
    voices: []
  };
}
function scoreModelRecency(id) {
  const lower = id.toLowerCase();
  const verMatch = lower.match(/(?:^|[-_])(\d+(?:\.\d+)?)(?:[-_]|$)/) || lower.match(/(\d+(?:\.\d+)?)/);
  const majorMinor = verMatch ? parseFloat(verMatch[1]) : 0;
  let dateScore = 0;
  const isoDate = lower.match(/(20\d{2})-(\d{2})-(\d{2})/);
  const compactDate = lower.match(/(20\d{2})(\d{2})(\d{2})/);
  if (isoDate) {
    dateScore = parseInt(`${isoDate[1]}${isoDate[2]}${isoDate[3]}`, 10) / 1e9;
  } else if (compactDate) {
    dateScore = parseInt(`${compactDate[1]}${compactDate[2]}${compactDate[3]}`, 10) / 1e9;
  }
  let tierAdjust = 0;
  if (/-flash\b/.test(lower) && !/lite|8b/.test(lower)) tierAdjust += 0.04;
  if (/-pro\b/.test(lower)) tierAdjust += 0.03;
  if (/latest/.test(lower)) tierAdjust += 0.02;
  if (/lite|mini|nano|8b/.test(lower)) tierAdjust -= 0.02;
  if (/exp|tuning|legacy|001$/.test(lower)) tierAdjust -= 0.03;
  return majorMinor * 10 + tierAdjust + dateScore;
}
async function fetchGeminiLiveCatalog(apiKeyOverride, forceRefresh = false) {
  const apiKey = apiKeyOverride?.trim() || getSettingValue("gemini_api_key", "GEMINI_API_KEY") || getSettingValue("gemini_api_key", "GOOGLE_API_KEY");
  if (!apiKey) {
    return emptyCatalog("gemini", false);
  }
  const cacheKey = `gemini:${fingerprintSecret(apiKey)}`;
  if (!forceRefresh) {
    const hit = catalogCache.get(cacheKey);
    if (hit && hit.expiresAt > Date.now()) return hit.catalog;
  }
  try {
    const allRawModels = [];
    let pageToken = "";
    for (let page = 0; page < 4; page++) {
      const url = new URL("https://generativelanguage.googleapis.com/v1beta/models");
      url.searchParams.set("pageSize", "200");
      if (pageToken) url.searchParams.set("pageToken", pageToken);
      const resp = await fetch(url.toString(), {
        headers: { "x-goog-api-key": apiKey },
        signal: AbortSignal.timeout(1e4)
      });
      const data = await resp.json();
      if (!resp.ok) {
        throw new Error(
          data?.error?.message || `Google Gemini Models API HTTP ${resp.status}`
        );
      }
      if (Array.isArray(data?.models)) {
        allRawModels.push(...data.models);
      }
      if (data?.nextPageToken) {
        pageToken = String(data.nextPageToken);
      } else {
        break;
      }
    }
    const textModels = [];
    const imageModels = [];
    const videoModels = [];
    const ttsModels = [];
    const seen = /* @__PURE__ */ new Set();
    for (const raw of allRawModels) {
      const rawName = String(raw?.name || "");
      const id = rawName.replace(/^models\//, "").trim();
      if (!id || seen.has(id)) continue;
      seen.add(id);
      const methods = Array.isArray(raw?.supportedGenerationMethods) ? raw.supportedGenerationMethods.map(String) : [];
      const displayName = String(raw?.displayName || "").trim();
      const label = displayName && displayName.toLowerCase() !== id.toLowerCase() ? `${displayName} (${id})` : id;
      if (/^(embedding|text-embedding|gemini-embedding|aqa|chat-bison|text-bison|codechat-bison|learnlm|gemma-)/i.test(
        id
      )) {
        continue;
      }
      if (methods.length > 0 && methods.every((m) => m === "embedContent" || m === "countTokens" || m === "embedText")) {
        continue;
      }
      const item = {
        id,
        label,
        supportedMethods: methods
      };
      const isVideo = methods.includes("predictLongRunning") || /(^veo|-video|omni)/i.test(id);
      const isTts = /(tts|speech)/i.test(id);
      const isImage = !isVideo && !isTts && (/(^imagen|-image|banana)/i.test(id) || methods.includes("predict") && !/embed|veo|video|tts|audio/i.test(id));
      if (isVideo) {
        videoModels.push(item);
      } else if (isImage) {
        imageModels.push(item);
      } else if (isTts) {
        ttsModels.push(item);
      } else if ((methods.includes("generateContent") || methods.includes("createInteraction")) && !/(native-audio|live-|robotics|computer-use)/i.test(id)) {
        textModels.push(item);
      }
    }
    const byNewest = (a, b) => scoreModelRecency(b.id) - scoreModelRecency(a.id);
    textModels.sort(byNewest);
    imageModels.sort(byNewest);
    videoModels.sort(byNewest);
    ttsModels.sort(byNewest);
    const catalog = {
      provider: "gemini",
      connected: true,
      fetchedAt: (/* @__PURE__ */ new Date()).toISOString(),
      textModels,
      imageModels,
      videoModels,
      ttsModels
    };
    catalogCache.set(cacheKey, {
      expiresAt: Date.now() + CACHE_TTL_MS,
      catalog
    });
    return catalog;
  } catch (err) {
    return emptyCatalog(
      "gemini",
      true,
      sanitizeSecretInError(err.message, apiKey)
    );
  }
}
async function getGeminiModelMethods(apiKey, modelId) {
  const cat = await fetchGeminiLiveCatalog(apiKey, false);
  const all = [
    ...cat.textModels,
    ...cat.imageModels,
    ...cat.videoModels,
    ...cat.ttsModels
  ];
  const found = all.find((m) => m.id === modelId);
  return found?.supportedMethods || [];
}
async function fetchClaudeLiveCatalog(apiKeyOverride, forceRefresh = false) {
  const apiKey = apiKeyOverride?.trim() || getSettingValue("claude_api_key", "ANTHROPIC_API_KEY");
  if (!apiKey) {
    return emptyCatalog("claude", false);
  }
  const cacheKey = `claude:${fingerprintSecret(apiKey)}`;
  if (!forceRefresh) {
    const hit = catalogCache.get(cacheKey);
    if (hit && hit.expiresAt > Date.now()) return hit.catalog;
  }
  try {
    const resp = await fetch("https://api.anthropic.com/v1/models?limit=100", {
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01"
      },
      signal: AbortSignal.timeout(1e4)
    });
    const data = await resp.json();
    if (!resp.ok) {
      throw new Error(
        data?.error?.message || `Anthropic Models API HTTP ${resp.status}`
      );
    }
    const list = Array.isArray(data?.data) ? data.data : [];
    list.sort((a, b) => {
      const ta = Date.parse(String(a?.created_at || "")) || 0;
      const tb = Date.parse(String(b?.created_at || "")) || 0;
      return tb - ta;
    });
    const textModels = list.filter((m) => m?.id).map((m) => {
      const id = String(m.id).trim();
      const name = String(m.display_name || "").trim();
      return {
        id,
        label: name && name.toLowerCase() !== id.toLowerCase() ? `${name} (${id})` : id,
        createdAt: m.created_at
      };
    });
    const catalog = {
      provider: "claude",
      connected: true,
      fetchedAt: (/* @__PURE__ */ new Date()).toISOString(),
      textModels,
      imageModels: [],
      videoModels: [],
      ttsModels: []
    };
    catalogCache.set(cacheKey, { expiresAt: Date.now() + CACHE_TTL_MS, catalog });
    return catalog;
  } catch (err) {
    return emptyCatalog(
      "claude",
      true,
      sanitizeSecretInError(err.message, apiKey)
    );
  }
}
async function fetchDeepSeekLiveCatalog(apiKeyOverride, forceRefresh = false) {
  const apiKey = apiKeyOverride?.trim() || getSettingValue("deepseek_api_key", "DEEPSEEK_API_KEY");
  if (!apiKey) {
    return emptyCatalog("deepseek", false);
  }
  const cacheKey = `deepseek:${fingerprintSecret(apiKey)}`;
  if (!forceRefresh) {
    const hit = catalogCache.get(cacheKey);
    if (hit && hit.expiresAt > Date.now()) return hit.catalog;
  }
  try {
    const resp = await fetch("https://api.deepseek.com/models", {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(1e4)
    });
    const data = await resp.json();
    if (!resp.ok) {
      throw new Error(
        data?.error?.message || `DeepSeek Models API HTTP ${resp.status}`
      );
    }
    const list = Array.isArray(data?.data) ? data.data : [];
    list.sort((a, b) => (Number(b?.created) || 0) - (Number(a?.created) || 0));
    const textModels = list.filter((m) => m?.id).map((m) => ({
      id: String(m.id).trim(),
      label: String(m.id).trim(),
      createdAt: m.created
    }));
    const catalog = {
      provider: "deepseek",
      connected: true,
      fetchedAt: (/* @__PURE__ */ new Date()).toISOString(),
      textModels,
      imageModels: [],
      videoModels: [],
      ttsModels: []
    };
    catalogCache.set(cacheKey, { expiresAt: Date.now() + CACHE_TTL_MS, catalog });
    return catalog;
  } catch (err) {
    return emptyCatalog(
      "deepseek",
      true,
      sanitizeSecretInError(err.message, apiKey)
    );
  }
}
async function fetchOpenAiLiveCatalog(apiKeyOverride, forceRefresh = false) {
  const apiKey = apiKeyOverride?.trim() || getSettingValue("openai_api_key", "OPENAI_API_KEY");
  if (!apiKey) {
    return emptyCatalog("openai", false);
  }
  const cacheKey = `openai:${fingerprintSecret(apiKey)}`;
  if (!forceRefresh) {
    const hit = catalogCache.get(cacheKey);
    if (hit && hit.expiresAt > Date.now()) return hit.catalog;
  }
  try {
    const resp = await fetch("https://api.openai.com/v1/models", {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(1e4)
    });
    const data = await resp.json();
    if (!resp.ok) {
      throw new Error(
        data?.error?.message || `OpenAI Models API HTTP ${resp.status}`
      );
    }
    const list = Array.isArray(data?.data) ? data.data : [];
    list.sort((a, b) => (Number(b?.created) || 0) - (Number(a?.created) || 0));
    const textModels = [];
    const imageModels = [];
    const ttsModels = [];
    const seen = /* @__PURE__ */ new Set();
    for (const m of list) {
      const id = String(m?.id || "").trim();
      if (!id || seen.has(id)) continue;
      seen.add(id);
      if (id.startsWith("ft:")) continue;
      const option = {
        id,
        label: id,
        createdAt: m.created
      };
      if (/(image|dall-e)/i.test(id)) {
        imageModels.push(option);
      } else if (/(^tts-|tts$|-tts)/i.test(id)) {
        ttsModels.push(option);
      } else if (/^(gpt-|o[1-9]|chatgpt-)/i.test(id) && !/(realtime|audio|transcribe|diarize|whisper|embedding|moderation|instruct|babbage|davinci|codex|computer-use|search|deep-research)/i.test(
        id
      )) {
        textModels.push(option);
      }
    }
    textModels.sort((a, b) => {
      const aPro = /-pro(\b|-)/i.test(a.id) ? 1 : 0;
      const bPro = /-pro(\b|-)/i.test(b.id) ? 1 : 0;
      if (aPro !== bPro) return aPro - bPro;
      return (Number(b.createdAt) || 0) - (Number(a.createdAt) || 0);
    });
    const catalog = {
      provider: "openai",
      connected: true,
      fetchedAt: (/* @__PURE__ */ new Date()).toISOString(),
      textModels,
      imageModels,
      videoModels: [],
      ttsModels
    };
    catalogCache.set(cacheKey, { expiresAt: Date.now() + CACHE_TTL_MS, catalog });
    return catalog;
  } catch (err) {
    return emptyCatalog(
      "openai",
      true,
      sanitizeSecretInError(err.message, apiKey)
    );
  }
}
async function resolveVertexTokenForDiscovery(overrideToken) {
  if (overrideToken?.trim()) return overrideToken.trim();
  const configured = getSettingValue("vertex_access_token", "GOOGLE_OAUTH_ACCESS_TOKEN");
  if (configured) return configured;
  if (!IS_SERVERLESS) {
    try {
      const { stdout } = await execFileAsync(
        "gcloud",
        ["auth", "application-default", "print-access-token"],
        { timeout: 3500 }
      );
      if (stdout && stdout.trim().length > 20) return stdout.trim();
    } catch {
    }
  }
  return "";
}
async function fetchVertexVeoLiveCatalog(params, forceRefresh = false) {
  const projectId = params?.projectId?.trim() || getSettingValue("vertex_project_id", "GOOGLE_CLOUD_PROJECT");
  const location = params?.location?.trim() || getSettingValue("vertex_location", "GOOGLE_CLOUD_LOCATION") || "us-central1";
  const accessToken = projectId ? await resolveVertexTokenForDiscovery(params?.accessToken) : "";
  if (!projectId || !accessToken) {
    const geminiCat = await fetchGeminiLiveCatalog(void 0, forceRefresh);
    if (geminiCat.connected && geminiCat.videoModels.length > 0) {
      return {
        provider: "vertex_veo",
        connected: true,
        fetchedAt: geminiCat.fetchedAt,
        textModels: [],
        imageModels: [],
        videoModels: geminiCat.videoModels,
        ttsModels: []
      };
    }
    return emptyCatalog("vertex_veo", false);
  }
  const cacheKey = `vertex_veo:${projectId}:${location}:${fingerprintSecret(accessToken)}`;
  if (!forceRefresh) {
    const hit = catalogCache.get(cacheKey);
    if (hit && hit.expiresAt > Date.now()) return hit.catalog;
  }
  try {
    const url = `https://${location}-aiplatform.googleapis.com/v1beta1/publishers/google/models?pageSize=100`;
    const resp = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(1e4)
    });
    const data = await resp.json();
    if (!resp.ok) {
      throw new Error(
        data?.error?.message || `Vertex AI Publisher Models HTTP ${resp.status}`
      );
    }
    const rawModels = Array.isArray(data?.publisherModels) ? data.publisherModels : [];
    const videoModels = [];
    const seen = /* @__PURE__ */ new Set();
    for (const m of rawModels) {
      const rawName = String(m?.name || "");
      const id = rawName.replace(/^publishers\/google\/models\//, "").trim();
      if (!id || seen.has(id)) continue;
      if (/(^veo|video)/i.test(id)) {
        seen.add(id);
        videoModels.push({
          id,
          label: id
        });
      }
    }
    const geminiCat = await fetchGeminiLiveCatalog(void 0, false);
    for (const vm of geminiCat.videoModels) {
      if (!seen.has(vm.id)) {
        seen.add(vm.id);
        videoModels.push(vm);
      }
    }
    videoModels.sort((a, b) => scoreModelRecency(b.id) - scoreModelRecency(a.id));
    const catalog = {
      provider: "vertex_veo",
      connected: true,
      fetchedAt: (/* @__PURE__ */ new Date()).toISOString(),
      textModels: [],
      imageModels: [],
      videoModels,
      ttsModels: []
    };
    catalogCache.set(cacheKey, { expiresAt: Date.now() + CACHE_TTL_MS, catalog });
    return catalog;
  } catch (err) {
    return emptyCatalog(
      "vertex_veo",
      true,
      sanitizeSecretInError(err.message, accessToken)
    );
  }
}
async function fetchElevenLabsLiveCatalog(apiKeyOverride, forceRefresh = false) {
  const apiKey = apiKeyOverride?.trim() || getSettingValue("elevenlabs_api_key", "ELEVENLABS_API_KEY");
  if (!apiKey) {
    return emptyCatalog("elevenlabs", false);
  }
  const cacheKey = `elevenlabs:${fingerprintSecret(apiKey)}`;
  if (!forceRefresh) {
    const hit = catalogCache.get(cacheKey);
    if (hit && hit.expiresAt > Date.now()) return hit.catalog;
  }
  try {
    const [modelsResp, voicesResp] = await Promise.all([
      fetch("https://api.elevenlabs.io/v1/models", {
        headers: { "xi-api-key": apiKey },
        signal: AbortSignal.timeout(1e4)
      }),
      fetch("https://api.elevenlabs.io/v1/voices", {
        headers: { "xi-api-key": apiKey },
        signal: AbortSignal.timeout(1e4)
      })
    ]);
    if (!modelsResp.ok) {
      throw new Error(`ElevenLabs Models API HTTP ${modelsResp.status}`);
    }
    const rawModels = await modelsResp.json();
    const ttsList = (Array.isArray(rawModels) ? rawModels : []).filter(
      (m) => m?.model_id && m?.can_do_text_to_speech !== false
    );
    ttsList.sort((a, b) => {
      const aTh = Array.isArray(a?.languages) && a.languages.some((l) => l?.language_id === "th") ? 1 : 0;
      const bTh = Array.isArray(b?.languages) && b.languages.some((l) => l?.language_id === "th") ? 1 : 0;
      if (bTh !== aTh) return bTh - aTh;
      return scoreModelRecency(String(b.model_id)) - scoreModelRecency(String(a.model_id));
    });
    const ttsModels = ttsList.map((m) => ({
      id: String(m.model_id).trim(),
      label: m.name ? `${m.name} (${m.model_id})` : String(m.model_id)
    }));
    let voices = [];
    if (voicesResp.ok) {
      const vData = await voicesResp.json();
      const rawVoices = Array.isArray(vData?.voices) ? vData.voices : [];
      voices = rawVoices.filter((v) => v?.voice_id).map((v) => ({
        id: String(v.voice_id).trim(),
        label: v.name ? `${v.name}${v.category ? ` \u2022 ${v.category}` : ""}` : String(v.voice_id)
      }));
    }
    const catalog = {
      provider: "elevenlabs",
      connected: true,
      fetchedAt: (/* @__PURE__ */ new Date()).toISOString(),
      textModels: [],
      imageModels: [],
      videoModels: [],
      ttsModels,
      voices
    };
    catalogCache.set(cacheKey, { expiresAt: Date.now() + CACHE_TTL_MS, catalog });
    return catalog;
  } catch (err) {
    return emptyCatalog(
      "elevenlabs",
      true,
      sanitizeSecretInError(err.message, apiKey)
    );
  }
}
async function fetchOpenAiCompatibleLiveCatalog(params, forceRefresh = false, explicitProbe = false) {
  const endpoint = (params?.endpoint?.trim() || getSettingValue("local_endpoint")).replace(/\/$/, "");
  const apiKey = params?.apiKey?.trim() || getSettingValue("local_api_key");
  if (!endpoint) {
    return emptyCatalog("openai_compatible", false);
  }
  if (IS_SERVERLESS && !explicitProbe && /^https?:\/\/(localhost|127\.0\.0\.1)\b/i.test(endpoint)) {
    return emptyCatalog("openai_compatible", false);
  }
  const cacheKey = `openai_compatible:${endpoint}:${fingerprintSecret(apiKey)}`;
  if (!forceRefresh) {
    const hit = catalogCache.get(cacheKey);
    if (hit && hit.expiresAt > Date.now()) return hit.catalog;
  }
  try {
    const headers = {};
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
    const resp = await fetch(`${endpoint}/models`, {
      headers,
      signal: AbortSignal.timeout(3500)
    });
    if (!resp.ok) {
      throw new Error(`HTTP ${resp.status}`);
    }
    const data = await resp.json();
    const rawList = Array.isArray(data?.data) ? data.data : Array.isArray(data?.models) ? data.models : [];
    const textModels = rawList.map((m) => String(m?.id || m?.name || "").trim()).filter(Boolean).map((id) => ({ id, label: id }));
    const catalog = {
      provider: "openai_compatible",
      connected: textModels.length > 0,
      fetchedAt: (/* @__PURE__ */ new Date()).toISOString(),
      textModels,
      imageModels: [],
      videoModels: [],
      ttsModels: []
    };
    catalogCache.set(cacheKey, { expiresAt: Date.now() + CACHE_TTL_MS, catalog });
    return catalog;
  } catch (err) {
    return emptyCatalog(
      "openai_compatible",
      false,
      sanitizeSecretInError(err.message, apiKey)
    );
  }
}
async function fetchAllConfiguredLiveModels(forceRefresh = false) {
  const [
    gemini,
    claude,
    deepseek,
    openai,
    vertexVeo,
    elevenlabs,
    openaiCompatible
  ] = await Promise.all([
    fetchGeminiLiveCatalog(void 0, forceRefresh),
    fetchClaudeLiveCatalog(void 0, forceRefresh),
    fetchDeepSeekLiveCatalog(void 0, forceRefresh),
    fetchOpenAiLiveCatalog(void 0, forceRefresh),
    fetchVertexVeoLiveCatalog(void 0, forceRefresh),
    fetchElevenLabsLiveCatalog(void 0, forceRefresh),
    fetchOpenAiCompatibleLiveCatalog(void 0, forceRefresh, false)
  ]);
  return {
    fetchedAt: (/* @__PURE__ */ new Date()).toISOString(),
    providers: {
      gemini,
      claude,
      deepseek,
      openai,
      vertex_veo: vertexVeo,
      elevenlabs,
      openai_compatible: openaiCompatible
    }
  };
}
async function fetchSingleProviderLiveCatalog(params) {
  const force = params.forceRefresh ?? true;
  switch (params.provider) {
    case "gemini":
      return fetchGeminiLiveCatalog(params.apiKey, force);
    case "claude":
      return fetchClaudeLiveCatalog(params.apiKey, force);
    case "deepseek":
      return fetchDeepSeekLiveCatalog(params.apiKey, force);
    case "openai":
      return fetchOpenAiLiveCatalog(params.apiKey, force);
    case "vertex_veo":
      return fetchVertexVeoLiveCatalog(
        {
          projectId: params.projectId,
          location: params.location,
          accessToken: params.apiKey
        },
        force
      );
    case "elevenlabs":
      return fetchElevenLabsLiveCatalog(params.apiKey, force);
    case "openai_compatible":
      return fetchOpenAiCompatibleLiveCatalog(
        { endpoint: params.endpoint, apiKey: params.apiKey },
        force,
        true
      );
  }
}
async function resolveLatestModel(params) {
  const candidate = (params.requestedModel || "").trim();
  const normalizedCandidate = candidate === "auto" || candidate === "auto_latest" ? "" : candidate;
  const catalog = await fetchSingleProviderLiveCatalog({
    provider: params.provider,
    apiKey: params.apiKeyOverride,
    forceRefresh: false
  });
  const bucket = params.capability === "image" ? catalog.imageModels : params.capability === "video" ? catalog.videoModels : params.capability === "tts" ? catalog.ttsModels : catalog.textModels;
  if (normalizedCandidate && bucket.some((m) => m.id === normalizedCandidate)) {
    return normalizedCandidate;
  }
  if (bucket.length > 0) {
    return bucket[0].id;
  }
  if (normalizedCandidate) {
    return normalizedCandidate;
  }
  const detail = catalog.error ? ` (${catalog.error})` : "";
  throw new Error(
    `\u0E44\u0E21\u0E48\u0E1E\u0E1A\u0E23\u0E32\u0E22\u0E0A\u0E37\u0E48\u0E2D\u0E42\u0E21\u0E40\u0E14\u0E25\u0E1B\u0E23\u0E30\u0E40\u0E20\u0E17 ${params.capability} \u0E08\u0E32\u0E01 API \u0E02\u0E2D\u0E07\u0E04\u0E48\u0E32\u0E22 ${params.provider} \u0E42\u0E14\u0E22\u0E15\u0E23\u0E07${detail} \u2014 \u0E01\u0E23\u0E38\u0E13\u0E32\u0E15\u0E23\u0E27\u0E08\u0E2A\u0E2D\u0E1A\u0E27\u0E48\u0E32 API Key \u0E21\u0E35\u0E2A\u0E34\u0E17\u0E18\u0E34\u0E4C\u0E40\u0E02\u0E49\u0E32\u0E16\u0E36\u0E07\u0E42\u0E21\u0E40\u0E14\u0E25\u0E1B\u0E23\u0E30\u0E40\u0E20\u0E17\u0E19\u0E35\u0E49`
  );
}
async function resolveLatestElevenLabsVoice(requestedVoiceId, apiKeyOverride) {
  const candidate = (requestedVoiceId || "").trim();
  const catalog = await fetchElevenLabsLiveCatalog(apiKeyOverride, false);
  const voices = catalog.voices || [];
  if (candidate && voices.some((v) => v.id === candidate)) {
    return candidate;
  }
  if (voices.length > 0) {
    return voices[0].id;
  }
  if (candidate) {
    return candidate;
  }
  throw new Error("\u0E44\u0E21\u0E48\u0E1E\u0E1A\u0E23\u0E32\u0E22\u0E01\u0E32\u0E23\u0E40\u0E2A\u0E35\u0E22\u0E07\u0E1E\u0E32\u0E01\u0E22\u0E4C (Voices) \u0E08\u0E32\u0E01 ElevenLabs API");
}

// server/mediaEngine.ts
var execFileAsync2 = promisify2(execFile2);
var UPLOADS_ROOT = IS_SERVERLESS ? "/tmp/komkrit-uploads" : path2.resolve(process.cwd(), "uploads");
var IMAGES_DIR = path2.join(UPLOADS_ROOT, "images");
var VIDEOS_DIR = path2.join(UPLOADS_ROOT, "videos");
var AUDIO_DIR = path2.join(UPLOADS_ROOT, "audio");
for (const dir of [UPLOADS_ROOT, IMAGES_DIR, VIDEOS_DIR, AUDIO_DIR]) {
  if (!fs2.existsSync(dir)) {
    fs2.mkdirSync(dir, { recursive: true });
  }
}
function getSettingValue(key, envFallback) {
  const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(key);
  if (row && row.value && row.value.trim()) {
    const raw = row.value.trim();
    const val = SECRET_SETTING_KEYS.has(key) ? decryptSecretValue(raw, key) : raw;
    if (val) return val;
  }
  if (envFallback && process.env[envFallback]?.trim()) {
    return process.env[envFallback].trim();
  }
  return "";
}
async function resolveLocalAssetPath(urlOrPath) {
  if (!urlOrPath) return null;
  const clean = urlOrPath.trim();
  if (!clean) return null;
  if (clean.startsWith("data:")) {
    const match = clean.match(/^data:([^;]+);base64,(.+)$/);
    if (match) {
      const mime = match[1];
      const ext = mime.includes("png") ? "png" : mime.includes("webp") ? "webp" : "jpg";
      const tmpPath = path2.join(IMAGES_DIR, `inline-${Date.now()}-${Math.round(Math.random() * 1e4)}.${ext}`);
      fs2.writeFileSync(tmpPath, Buffer.from(match[2], "base64"));
      return tmpPath;
    }
  }
  if (clean.startsWith("https://") || clean.startsWith("http://")) {
    try {
      const parsed = new URL(clean);
      const base = path2.basename(parsed.pathname) || `remote-${Date.now()}.bin`;
      const targetDir = base.endsWith(".mp4") || base.endsWith(".mov") ? VIDEOS_DIR : base.endsWith(".mp3") || base.endsWith(".wav") ? AUDIO_DIR : IMAGES_DIR;
      const cachedPath = path2.join(targetDir, base);
      if (fs2.existsSync(cachedPath)) return cachedPath;
      const dl = await fetch(clean);
      if (dl.ok) {
        fs2.writeFileSync(cachedPath, Buffer.from(await dl.arrayBuffer()));
        return cachedPath;
      }
    } catch {
      return null;
    }
  }
  if (clean.startsWith("/uploads/")) {
    const abs = path2.join(UPLOADS_ROOT, clean.replace(/^\/uploads\//, ""));
    if (fs2.existsSync(abs)) return abs;
  }
  if (clean.startsWith("/images/")) {
    const pubAbs = path2.resolve(process.cwd(), "public", clean.replace(/^\//, ""));
    if (fs2.existsSync(pubAbs)) return pubAbs;
    const distAbs = path2.resolve(process.cwd(), "dist", clean.replace(/^\//, ""));
    if (fs2.existsSync(distAbs)) return distAbs;
  }
  if (fs2.existsSync(clean)) {
    return clean;
  }
  return null;
}
function guessMimeType(filePath, fallback) {
  const ext = path2.extname(filePath).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".webp") return "image/webp";
  if (ext === ".mp4") return "video/mp4";
  if (ext === ".mov") return "video/quicktime";
  if (ext === ".wav") return "audio/wav";
  if (ext === ".mp3") return "audio/mpeg";
  return fallback;
}
function normalizeGeminiFileUri(uri) {
  if (!uri) return "";
  const match = uri.match(/files\/([a-zA-Z0-9_-]+)/);
  if (match) {
    return `https://generativelanguage.googleapis.com/files/${match[1]}`;
  }
  return uri.split("?")[0];
}
async function uploadLocalFileToGemini(ai, localPath, defaultMime) {
  const mimeType = guessMimeType(localPath, defaultMime);
  let uploaded = await ai.files.upload({
    file: localPath,
    config: { mimeType }
  });
  let attempts = 0;
  while (uploaded.state === "PROCESSING" && attempts < 45) {
    await new Promise((r) => setTimeout(r, 2e3));
    if (uploaded.name) {
      uploaded = await ai.files.get({ name: uploaded.name });
    }
    attempts++;
  }
  if (uploaded.state === "FAILED") {
    throw new Error(`\u0E2D\u0E31\u0E1B\u0E42\u0E2B\u0E25\u0E14\u0E44\u0E1F\u0E25\u0E4C\u0E2D\u0E49\u0E32\u0E07\u0E2D\u0E34\u0E07\u0E44\u0E1B\u0E22\u0E31\u0E07 Gemini Files API \u0E44\u0E21\u0E48\u0E2A\u0E33\u0E40\u0E23\u0E47\u0E08 (${path2.basename(localPath)})`);
  }
  const uri = normalizeGeminiFileUri(uploaded.uri);
  if (!uri) {
    throw new Error("\u0E44\u0E21\u0E48\u0E44\u0E14\u0E49\u0E23\u0E31\u0E1A File URI \u0E08\u0E32\u0E01 Gemini Files API");
  }
  return { uri, mimeType: uploaded.mimeType || mimeType };
}
async function recordMediaAsset(params) {
  let finalFileUrl = params.fileUrl;
  if (IS_SERVERLESS && finalFileUrl.startsWith("/uploads/")) {
    const abs = path2.join(UPLOADS_ROOT, finalFileUrl.replace(/^\/uploads\//, ""));
    if (fs2.existsSync(abs)) {
      const buf = fs2.readFileSync(abs);
      const cloudUrl = await uploadMediaToCloudBlob(buf, path2.basename(abs), params.mimeType);
      if (cloudUrl) {
        finalFileUrl = cloudUrl;
      } else if (params.mediaType === "image" && buf.length <= 4 * 1024 * 1024) {
        finalFileUrl = `data:${params.mimeType};base64,${buf.toString("base64")}`;
      }
    }
  }
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const reviewStatus = params.reviewStatus || "pending_review";
  const thaiSummary = params.thaiSummary || "";
  const res = db.prepare(
    `INSERT INTO ai_media_assets (
        media_type, provider, model, prompt, file_url, mime_type,
        aspect_ratio, duration_sec, resolution, interaction_id, workflow_id,
        review_status, thai_summary, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    params.mediaType,
    params.provider,
    params.model,
    params.prompt,
    finalFileUrl,
    params.mimeType,
    params.aspectRatio || "",
    params.durationSec || 0,
    params.resolution || "",
    params.interactionId || "",
    params.workflowId ?? null,
    reviewStatus,
    thaiSummary,
    now
  );
  return {
    id: Number(res.lastInsertRowid),
    ...params,
    fileUrl: finalFileUrl,
    reviewStatus,
    thaiSummary,
    createdAt: now
  };
}
async function generateRealImage(params) {
  const prompt = params.prompt?.trim();
  if (!prompt) {
    throw new Error("\u0E01\u0E23\u0E38\u0E13\u0E32\u0E23\u0E30\u0E1A\u0E38 Prompt \u0E2A\u0E33\u0E2B\u0E23\u0E31\u0E1A\u0E2A\u0E23\u0E49\u0E32\u0E07\u0E23\u0E39\u0E1B\u0E20\u0E32\u0E1E");
  }
  const geminiKey = getSettingValue("gemini_api_key", "GEMINI_API_KEY") || getSettingValue("gemini_api_key", "GOOGLE_API_KEY");
  const openaiKey = getSettingValue("openai_api_key", "OPENAI_API_KEY");
  const chosenProvider = params.provider || (geminiKey ? "gemini" : openaiKey ? "openai" : "gemini");
  if (chosenProvider === "gemini") {
    if (!geminiKey) {
      throw new Error(
        '\u0E22\u0E31\u0E07\u0E44\u0E21\u0E48\u0E44\u0E14\u0E49\u0E15\u0E31\u0E49\u0E07\u0E04\u0E48\u0E32 Google Gemini API Key \u0E2A\u0E33\u0E2B\u0E23\u0E31\u0E1A\u0E2A\u0E23\u0E49\u0E32\u0E07\u0E20\u0E32\u0E1E\u0E08\u0E23\u0E34\u0E07 \u2014 \u0E01\u0E23\u0E38\u0E13\u0E32\u0E43\u0E2A\u0E48\u0E04\u0E35\u0E22\u0E4C\u0E43\u0E19\u0E40\u0E21\u0E19\u0E39 "\u0E15\u0E31\u0E49\u0E07\u0E04\u0E48\u0E32 API Keys & Providers"'
      );
    }
    const model2 = await resolveLatestModel({
      provider: "gemini",
      capability: "image",
      requestedModel: params.model || getSettingValue("gemini_image_model"),
      apiKeyOverride: geminiKey
    });
    const methods = await getGeminiModelMethods(geminiKey, model2);
    const aspectRatio = params.aspectRatio || "16:9";
    const ai = new GoogleGenAI({ apiKey: geminiKey });
    let imgBuffer2 = null;
    let ext = "png";
    let mimeType = "image/png";
    let interactionId = "";
    if (methods.includes("predict") || /^imagen/i.test(model2)) {
      const imResp = await ai.models.generateImages({
        model: model2,
        prompt,
        config: {
          numberOfImages: 1,
          aspectRatio,
          outputMimeType: "image/png"
        }
      });
      const b64 = imResp?.generatedImages?.[0]?.image?.imageBytes;
      if (b64) {
        imgBuffer2 = Buffer.from(b64, "base64");
      }
    } else if (methods.includes("generateContent")) {
      let genResp;
      try {
        genResp = await ai.models.generateContent({
          model: model2,
          contents: `${prompt} (Aspect ratio: ${aspectRatio})`,
          config: {
            responseModalities: ["TEXT", "IMAGE"],
            imageConfig: { aspectRatio }
          }
        });
      } catch {
        genResp = await ai.models.generateContent({
          model: model2,
          contents: `${prompt} (Aspect ratio: ${aspectRatio})`,
          config: {
            responseModalities: ["TEXT", "IMAGE"]
          }
        });
      }
      const parts = genResp?.candidates?.[0]?.content?.parts || [];
      const imgPart = parts.find((p) => p?.inlineData?.data);
      if (imgPart?.inlineData?.data) {
        mimeType = imgPart.inlineData.mimeType || "image/png";
        if (mimeType.includes("jpeg") || mimeType.includes("jpg")) ext = "jpg";
        else if (mimeType.includes("webp")) ext = "webp";
        imgBuffer2 = Buffer.from(imgPart.inlineData.data, "base64");
      }
    } else {
      const interaction = await ai.interactions.create({
        model: model2,
        input: prompt,
        response_format: {
          type: "image",
          aspect_ratio: aspectRatio,
          image_size: params.imageSize || "1K",
          mime_type: "image/png"
        }
      });
      interactionId = interaction.id || "";
      const outImg = interaction.output_image;
      mimeType = outImg?.mime_type || "image/png";
      if (mimeType.includes("jpeg") || mimeType.includes("jpg")) {
        ext = "jpg";
      }
      if (outImg?.data) {
        imgBuffer2 = Buffer.from(outImg.data, "base64");
      } else if (outImg?.uri) {
        const r = await fetch(outImg.uri, {
          headers: { "x-goog-api-key": geminiKey }
        });
        if (!r.ok) {
          throw new Error(`\u0E14\u0E32\u0E27\u0E19\u0E4C\u0E42\u0E2B\u0E25\u0E14\u0E23\u0E39\u0E1B\u0E20\u0E32\u0E1E\u0E08\u0E32\u0E01 Gemini URI \u0E44\u0E21\u0E48\u0E2A\u0E33\u0E40\u0E23\u0E47\u0E08 (HTTP ${r.status})`);
        }
        imgBuffer2 = Buffer.from(await r.arrayBuffer());
      }
    }
    if (!imgBuffer2 || imgBuffer2.length === 0) {
      throw new Error(
        `\u0E42\u0E21\u0E40\u0E14\u0E25 ${model2} \u0E44\u0E21\u0E48\u0E44\u0E14\u0E49\u0E2A\u0E48\u0E07\u0E02\u0E49\u0E2D\u0E21\u0E39\u0E25\u0E23\u0E39\u0E1B\u0E20\u0E32\u0E1E\u0E01\u0E25\u0E31\u0E1A\u0E21\u0E32 \u0E01\u0E23\u0E38\u0E13\u0E32\u0E15\u0E23\u0E27\u0E08\u0E2A\u0E2D\u0E1A\u0E2A\u0E34\u0E17\u0E18\u0E34\u0E4C API Key \u0E2B\u0E23\u0E37\u0E2D\u0E40\u0E25\u0E37\u0E2D\u0E01\u0E42\u0E21\u0E40\u0E14\u0E25\u0E23\u0E39\u0E1B\u0E20\u0E32\u0E1E\u0E2D\u0E37\u0E48\u0E19\u0E08\u0E32\u0E01\u0E23\u0E32\u0E22\u0E01\u0E32\u0E23\u0E25\u0E48\u0E32\u0E2A\u0E38\u0E14`
      );
    }
    const filename2 = `gemini-img-${Date.now()}-${Math.round(Math.random() * 1e4)}.${ext}`;
    const absPath = path2.join(IMAGES_DIR, filename2);
    fs2.writeFileSync(absPath, imgBuffer2);
    const fileUrl2 = `/uploads/images/${filename2}`;
    return await recordMediaAsset({
      mediaType: "image",
      provider: "gemini",
      model: model2,
      prompt,
      fileUrl: fileUrl2,
      mimeType,
      aspectRatio,
      interactionId,
      workflowId: params.workflowId ?? null,
      thaiSummary: params.thaiSummary,
      reviewStatus: params.reviewStatus
    });
  }
  if (!openaiKey) {
    throw new Error(
      '\u0E22\u0E31\u0E07\u0E44\u0E21\u0E48\u0E44\u0E14\u0E49\u0E15\u0E31\u0E49\u0E07\u0E04\u0E48\u0E32 OpenAI API Key \u0E2A\u0E33\u0E2B\u0E23\u0E31\u0E1A\u0E2A\u0E23\u0E49\u0E32\u0E07\u0E20\u0E32\u0E1E\u0E08\u0E23\u0E34\u0E07 \u2014 \u0E01\u0E23\u0E38\u0E13\u0E32\u0E43\u0E2A\u0E48\u0E04\u0E35\u0E22\u0E4C\u0E43\u0E19\u0E40\u0E21\u0E19\u0E39 "\u0E15\u0E31\u0E49\u0E07\u0E04\u0E48\u0E32 API Keys & Providers"'
    );
  }
  const model = await resolveLatestModel({
    provider: "openai",
    capability: "image",
    requestedModel: params.model || getSettingValue("openai_image_model"),
    apiKeyOverride: openaiKey
  });
  const isLegacyDalle = /^dall-e/i.test(model);
  const legacySize = params.aspectRatio === "9:16" ? "1024x1792" : params.aspectRatio === "1:1" ? "1024x1024" : "1792x1024";
  const modernSize = params.aspectRatio === "9:16" ? "1024x1536" : params.aspectRatio === "1:1" ? "1024x1024" : "1536x1024";
  const bodyPayload = {
    model,
    prompt,
    n: 1,
    size: isLegacyDalle ? legacySize : modernSize
  };
  if (isLegacyDalle) {
    bodyPayload.response_format = "b64_json";
  }
  let data = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    const resp = await fetch("https://api.openai.com/v1/images/generations", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${openaiKey}`
      },
      body: JSON.stringify(bodyPayload)
    });
    data = await resp.json();
    if (resp.ok) break;
    const errMsg = String(data?.error?.message || "");
    if (/response_format/i.test(errMsg) && "response_format" in bodyPayload) {
      delete bodyPayload.response_format;
      continue;
    }
    if (/size/i.test(errMsg) && bodyPayload.size !== "1024x1024") {
      bodyPayload.size = "1024x1024";
      continue;
    }
    throw new Error(errMsg || `OpenAI Images API Error (HTTP ${resp.status})`);
  }
  const item = data?.data?.[0];
  let imgBuffer;
  if (item?.b64_json) {
    imgBuffer = Buffer.from(item.b64_json, "base64");
  } else if (item?.url) {
    const imgResp = await fetch(item.url);
    imgBuffer = Buffer.from(await imgResp.arrayBuffer());
  } else {
    throw new Error("\u0E44\u0E21\u0E48\u0E44\u0E14\u0E49\u0E23\u0E31\u0E1A\u0E02\u0E49\u0E2D\u0E21\u0E39\u0E25\u0E23\u0E39\u0E1B\u0E20\u0E32\u0E1E\u0E08\u0E32\u0E01 OpenAI Images API");
  }
  const filename = `openai-img-${Date.now()}-${Math.round(Math.random() * 1e4)}.png`;
  fs2.writeFileSync(path2.join(IMAGES_DIR, filename), imgBuffer);
  const fileUrl = `/uploads/images/${filename}`;
  return await recordMediaAsset({
    mediaType: "image",
    provider: "openai",
    model,
    prompt,
    fileUrl,
    mimeType: "image/png",
    aspectRatio: params.aspectRatio || "16:9",
    workflowId: params.workflowId ?? null,
    thaiSummary: params.thaiSummary,
    reviewStatus: params.reviewStatus
  });
}
async function getVertexAccessToken() {
  const configuredToken = getSettingValue("vertex_access_token", "GOOGLE_OAUTH_ACCESS_TOKEN");
  if (configuredToken) return configuredToken;
  try {
    const metaRes = await fetch(
      "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token",
      {
        headers: { "Metadata-Flavor": "Google" },
        signal: AbortSignal.timeout(1500)
      }
    );
    if (metaRes.ok) {
      const metaJson = await metaRes.json();
      if (metaJson?.access_token) return String(metaJson.access_token);
    }
  } catch {
  }
  try {
    const { stdout } = await execFileAsync2("gcloud", ["auth", "application-default", "print-access-token"], {
      timeout: 6e3
    });
    if (stdout && stdout.trim().length > 20) return stdout.trim();
  } catch {
  }
  try {
    const { stdout } = await execFileAsync2("gcloud", ["auth", "print-access-token"], {
      timeout: 6e3
    });
    if (stdout && stdout.trim().length > 20) return stdout.trim();
  } catch {
  }
  return "";
}
async function generateRealVideo(params) {
  const prompt = params.prompt?.trim();
  if (!prompt) {
    throw new Error("\u0E01\u0E23\u0E38\u0E13\u0E32\u0E23\u0E30\u0E1A\u0E38 Prompt \u0E2A\u0E33\u0E2B\u0E23\u0E31\u0E1A\u0E2A\u0E23\u0E49\u0E32\u0E07\u0E27\u0E34\u0E14\u0E35\u0E42\u0E2D\u0E08\u0E23\u0E34\u0E07");
  }
  const projectId = getSettingValue("vertex_project_id", "GOOGLE_CLOUD_PROJECT");
  const location = getSettingValue("vertex_location", "GOOGLE_CLOUD_LOCATION") || "us-central1";
  const accessToken = projectId ? await getVertexAccessToken() : "";
  const geminiKey = getSettingValue("gemini_api_key", "GEMINI_API_KEY") || getSettingValue("gemini_api_key", "GOOGLE_API_KEY");
  if (!geminiKey && (!projectId || !accessToken)) {
    throw new Error(
      '\u0E22\u0E31\u0E07\u0E44\u0E21\u0E48\u0E44\u0E14\u0E49\u0E43\u0E2A\u0E48\u0E04\u0E35\u0E22\u0E4C\u0E2A\u0E33\u0E2B\u0E23\u0E31\u0E1A\u0E2A\u0E23\u0E49\u0E32\u0E07\u0E27\u0E34\u0E14\u0E35\u0E42\u0E2D\u0E08\u0E23\u0E34\u0E07 \u2014 \u0E01\u0E23\u0E38\u0E13\u0E32\u0E44\u0E1B\u0E17\u0E35\u0E48\u0E1B\u0E38\u0E48\u0E21 "\u0E40\u0E0A\u0E37\u0E48\u0E2D\u0E21\u0E15\u0E48\u0E2D\u0E04\u0E35\u0E22\u0E4C AI" \u0E40\u0E1E\u0E37\u0E48\u0E2D\u0E43\u0E2A\u0E48 GEMINI_API_KEY (\u0E14\u0E36\u0E07\u0E42\u0E21\u0E40\u0E14\u0E25\u0E27\u0E34\u0E14\u0E35\u0E42\u0E2D\u0E25\u0E48\u0E32\u0E2A\u0E38\u0E14\u0E2D\u0E31\u0E15\u0E42\u0E19\u0E21\u0E31\u0E15\u0E34) \u0E2B\u0E23\u0E37\u0E2D\u0E43\u0E2A\u0E48 GCP Project ID + Vertex Token \u0E04\u0E23\u0E31\u0E1A'
    );
  }
  const requestedEngine = params.engine?.trim() || getSettingValue("gemini_video_model") || getSettingValue("vertex_veo_model");
  const engine = geminiKey ? await resolveLatestModel({
    provider: "gemini",
    capability: "video",
    requestedModel: requestedEngine,
    apiKeyOverride: geminiKey
  }) : await resolveLatestModel({
    provider: "vertex_veo",
    capability: "video",
    requestedModel: requestedEngine,
    apiKeyOverride: accessToken
  });
  const geminiMethods = geminiKey ? await getGeminiModelMethods(geminiKey, engine) : [];
  const isLongRunningVeo = geminiMethods.includes("predictLongRunning") || /^veo/i.test(engine);
  const aspectRatio = params.aspectRatio || "16:9";
  const resolution = params.resolution || "720p";
  const durationSec = Math.min(10, Math.max(3, Math.round(Number(params.durationSec) || 6)));
  if (isLongRunningVeo) {
    const geminiKeyForVeo = geminiKey;
    if ((!projectId || !accessToken) && geminiKeyForVeo) {
      const ai2 = new GoogleGenAI({
        apiKey: geminiKeyForVeo,
        httpOptions: { timeout: 6e5 }
      });
      const firstAbs3 = await resolveLocalAssetPath(params.firstFrameUrl);
      const lastAbs3 = await resolveLocalAssetPath(params.lastFrameUrl);
      const sourcePayload = { prompt };
      if (firstAbs3) {
        sourcePayload.image = {
          imageBytes: fs2.readFileSync(firstAbs3).toString("base64"),
          mimeType: guessMimeType(firstAbs3, "image/png")
        };
      }
      const configPayload = {
        numberOfVideos: 1,
        aspectRatio
      };
      if (lastAbs3) {
        configPayload.lastFrame = {
          imageBytes: fs2.readFileSync(lastAbs3).toString("base64"),
          mimeType: guessMimeType(lastAbs3, "image/png")
        };
      }
      let operation = await ai2.models.generateVideos({
        model: engine,
        source: sourcePayload,
        config: configPayload
      });
      const pollIntervalMs = IS_SERVERLESS ? 4e3 : 6e3;
      const maxPolls = IS_SERVERLESS ? 13 : 90;
      let polls = 0;
      while (!operation.done && polls < maxPolls) {
        await new Promise((r) => setTimeout(r, pollIntervalMs));
        operation = await ai2.operations.getVideosOperation({ operation });
        polls++;
      }
      if (!operation.done) {
        throw new Error("Google Veo \u0E01\u0E33\u0E25\u0E31\u0E07\u0E1B\u0E23\u0E30\u0E21\u0E27\u0E25\u0E1C\u0E25\u0E40\u0E01\u0E34\u0E19\u0E40\u0E27\u0E25\u0E32\u0E17\u0E35\u0E48\u0E01\u0E33\u0E2B\u0E19\u0E14 \u0E01\u0E23\u0E38\u0E13\u0E32\u0E25\u0E2D\u0E07\u0E04\u0E27\u0E32\u0E21\u0E25\u0E30\u0E40\u0E2D\u0E35\u0E22\u0E14 720p \u0E2B\u0E23\u0E37\u0E2D\u0E40\u0E25\u0E37\u0E2D\u0E01\u0E42\u0E21\u0E40\u0E14\u0E25\u0E27\u0E34\u0E14\u0E35\u0E42\u0E2D\u0E41\u0E1A\u0E1A Fast \u0E08\u0E32\u0E01\u0E23\u0E32\u0E22\u0E01\u0E32\u0E23\u0E25\u0E48\u0E32\u0E2A\u0E38\u0E14");
      }
      if (operation.error) {
        throw new Error(operation.error.message || JSON.stringify(operation.error));
      }
      const genVid = operation.response?.generatedVideos?.[0]?.video;
      if (!genVid) {
        throw new Error("Google Veo \u0E1B\u0E23\u0E30\u0E21\u0E27\u0E25\u0E1C\u0E25\u0E40\u0E2A\u0E23\u0E47\u0E08\u0E41\u0E15\u0E48\u0E44\u0E21\u0E48\u0E1E\u0E1A\u0E44\u0E1F\u0E25\u0E4C\u0E27\u0E34\u0E14\u0E35\u0E42\u0E2D\u0E43\u0E19\u0E1C\u0E25\u0E25\u0E31\u0E1E\u0E18\u0E4C");
      }
      const filename3 = `veo-${Date.now()}-${Math.round(Math.random() * 1e4)}.mp4`;
      const outAbsPath3 = path2.join(VIDEOS_DIR, filename3);
      if (genVid.videoBytes) {
        fs2.writeFileSync(outAbsPath3, Buffer.from(genVid.videoBytes, "base64"));
      } else if (genVid.uri) {
        const dl = await fetch(genVid.uri, {
          headers: { "x-goog-api-key": geminiKeyForVeo }
        });
        if (!dl.ok) {
          throw new Error(`\u0E14\u0E32\u0E27\u0E19\u0E4C\u0E42\u0E2B\u0E25\u0E14\u0E44\u0E1F\u0E25\u0E4C\u0E27\u0E34\u0E14\u0E35\u0E42\u0E2D Veo \u0E44\u0E21\u0E48\u0E2A\u0E33\u0E40\u0E23\u0E47\u0E08 (HTTP ${dl.status})`);
        }
        fs2.writeFileSync(outAbsPath3, Buffer.from(await dl.arrayBuffer()));
      } else {
        throw new Error("\u0E44\u0E21\u0E48\u0E1E\u0E1A\u0E02\u0E49\u0E2D\u0E21\u0E39\u0E25\u0E27\u0E34\u0E14\u0E35\u0E42\u0E2D\u0E08\u0E32\u0E01 Google Veo API");
      }
      return recordMediaAsset({
        mediaType: "video",
        provider: "google-veo-gemini-api",
        model: engine,
        prompt,
        fileUrl: `/uploads/videos/${filename3}`,
        mimeType: "video/mp4",
        aspectRatio,
        durationSec,
        resolution,
        interactionId: operation.name || "",
        workflowId: params.workflowId ?? null,
        thaiSummary: params.thaiSummary,
        reviewStatus: params.reviewStatus
      });
    }
    if (!projectId || !accessToken) {
      throw new Error(
        `\u0E22\u0E31\u0E07\u0E44\u0E21\u0E48\u0E44\u0E14\u0E49\u0E43\u0E2A\u0E48\u0E04\u0E35\u0E22\u0E4C\u0E2A\u0E33\u0E2B\u0E23\u0E31\u0E1A\u0E2A\u0E23\u0E49\u0E32\u0E07\u0E27\u0E34\u0E14\u0E35\u0E42\u0E2D Google Veo ("${engine}") \u2014 \u0E01\u0E23\u0E38\u0E13\u0E32\u0E44\u0E1B\u0E17\u0E35\u0E48\u0E1B\u0E38\u0E48\u0E21 "\u0E40\u0E0A\u0E37\u0E48\u0E2D\u0E21\u0E15\u0E48\u0E2D\u0E04\u0E35\u0E22\u0E4C AI" \u0E40\u0E1E\u0E37\u0E48\u0E2D\u0E43\u0E2A\u0E48 GEMINI_API_KEY (\u0E43\u0E0A\u0E49\u0E44\u0E14\u0E49\u0E17\u0E31\u0E19\u0E17\u0E35) \u0E2B\u0E23\u0E37\u0E2D\u0E43\u0E2A\u0E48 GCP Project ID + Vertex Token \u0E04\u0E23\u0E31\u0E1A`
      );
    }
    const instance = { prompt };
    const firstAbs2 = await resolveLocalAssetPath(params.firstFrameUrl);
    if (firstAbs2) {
      instance.image = {
        bytesBase64Encoded: fs2.readFileSync(firstAbs2).toString("base64"),
        mimeType: guessMimeType(firstAbs2, "image/png")
      };
    }
    const lastAbs2 = await resolveLocalAssetPath(params.lastFrameUrl);
    if (lastAbs2) {
      instance.lastFrame = {
        bytesBase64Encoded: fs2.readFileSync(lastAbs2).toString("base64"),
        mimeType: guessMimeType(lastAbs2, "image/png")
      };
    }
    const endpointBase = `https://${location}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${location}/publishers/google/models/${engine}`;
    const startResp = await fetch(`${endpointBase}:predictLongRunning`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`
      },
      body: JSON.stringify({
        instances: [instance],
        parameters: {
          aspectRatio,
          sampleCount: 1,
          durationSeconds: durationSec >= 7 ? 8 : durationSec >= 5 ? 6 : 4,
          resolution: resolution === "1080p" ? "1080p" : "720p",
          generateAudio: true
        }
      })
    });
    const startJson = await startResp.json();
    if (!startResp.ok) {
      throw new Error(
        startJson?.error?.message || `Google Veo Vertex AI Error (HTTP ${startResp.status})`
      );
    }
    const operationName = startJson?.name;
    if (!operationName) {
      throw new Error("\u0E44\u0E21\u0E48\u0E44\u0E14\u0E49\u0E23\u0E31\u0E1A Operation Name \u0E08\u0E32\u0E01 Google Veo predictLongRunning");
    }
    let opDone = false;
    let opResult = null;
    for (let poll = 0; poll < 75; poll++) {
      await new Promise((r) => setTimeout(r, 8e3));
      const pollResp = await fetch(`${endpointBase}:fetchPredictOperation`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`
        },
        body: JSON.stringify({ operationName })
      });
      const pollJson = await pollResp.json();
      if (!pollResp.ok) {
        throw new Error(
          pollJson?.error?.message || `Veo Polling Error (HTTP ${pollResp.status})`
        );
      }
      if (pollJson.done) {
        opDone = true;
        opResult = pollJson;
        break;
      }
    }
    if (!opDone || !opResult) {
      throw new Error("Google Veo \u0E43\u0E0A\u0E49\u0E40\u0E27\u0E25\u0E32\u0E1B\u0E23\u0E30\u0E21\u0E27\u0E25\u0E1C\u0E25\u0E40\u0E01\u0E34\u0E19\u0E01\u0E33\u0E2B\u0E19\u0E14 (Timeout)");
    }
    if (opResult.error) {
      throw new Error(opResult.error.message || JSON.stringify(opResult.error));
    }
    const vidObj = opResult?.response?.videos?.[0] || opResult?.response?.generatedVideos?.[0]?.video;
    if (!vidObj) {
      throw new Error("Google Veo \u0E1B\u0E23\u0E30\u0E21\u0E27\u0E25\u0E1C\u0E25\u0E40\u0E2A\u0E23\u0E47\u0E08\u0E41\u0E15\u0E48\u0E44\u0E21\u0E48\u0E1E\u0E1A\u0E44\u0E1F\u0E25\u0E4C\u0E27\u0E34\u0E14\u0E35\u0E42\u0E2D\u0E43\u0E19\u0E1C\u0E25\u0E25\u0E31\u0E1E\u0E18\u0E4C");
    }
    const filename2 = `veo-${Date.now()}-${Math.round(Math.random() * 1e4)}.mp4`;
    const outAbsPath2 = path2.join(VIDEOS_DIR, filename2);
    if (vidObj.bytesBase64Encoded) {
      fs2.writeFileSync(outAbsPath2, Buffer.from(vidObj.bytesBase64Encoded, "base64"));
    } else if (vidObj.gcsUri || vidObj.uri) {
      const rawUri = vidObj.gcsUri || vidObj.uri;
      const httpUrl = rawUri.startsWith("gs://") ? `https://storage.googleapis.com/${rawUri.slice(5)}` : rawUri;
      const dl = await fetch(httpUrl, {
        headers: { Authorization: `Bearer ${accessToken}` }
      });
      if (!dl.ok) {
        throw new Error(`\u0E14\u0E32\u0E27\u0E19\u0E4C\u0E42\u0E2B\u0E25\u0E14\u0E44\u0E1F\u0E25\u0E4C\u0E27\u0E34\u0E14\u0E35\u0E42\u0E2D Veo \u0E08\u0E32\u0E01 ${rawUri} \u0E44\u0E21\u0E48\u0E2A\u0E33\u0E40\u0E23\u0E47\u0E08 (HTTP ${dl.status})`);
      }
      fs2.writeFileSync(outAbsPath2, Buffer.from(await dl.arrayBuffer()));
    } else {
      throw new Error("\u0E44\u0E21\u0E48\u0E1E\u0E1A bytesBase64Encoded \u0E2B\u0E23\u0E37\u0E2D URI \u0E43\u0E19\u0E1C\u0E25\u0E25\u0E31\u0E1E\u0E18\u0E4C\u0E08\u0E32\u0E01 Google Veo");
    }
    return recordMediaAsset({
      mediaType: "video",
      provider: "google-veo-vertex",
      model: engine,
      prompt,
      fileUrl: `/uploads/videos/${filename2}`,
      mimeType: "video/mp4",
      aspectRatio,
      durationSec,
      resolution,
      interactionId: operationName,
      workflowId: params.workflowId ?? null,
      thaiSummary: params.thaiSummary,
      reviewStatus: params.reviewStatus
    });
  }
  if (!geminiKey) {
    throw new Error(
      '\u0E22\u0E31\u0E07\u0E44\u0E21\u0E48\u0E44\u0E14\u0E49\u0E15\u0E31\u0E49\u0E07\u0E04\u0E48\u0E32 Google Gemini API Key \u0E2A\u0E33\u0E2B\u0E23\u0E31\u0E1A\u0E2A\u0E23\u0E49\u0E32\u0E07\u0E27\u0E34\u0E14\u0E35\u0E42\u0E2D\u0E08\u0E23\u0E34\u0E07 \u2014 \u0E01\u0E23\u0E38\u0E13\u0E32\u0E43\u0E2A\u0E48\u0E04\u0E35\u0E22\u0E4C\u0E43\u0E19\u0E40\u0E21\u0E19\u0E39 "\u0E15\u0E31\u0E49\u0E07\u0E04\u0E48\u0E32 API Keys & Providers"'
    );
  }
  if (params.lastFrameUrl && !params.firstFrameUrl) {
    throw new Error("\u0E01\u0E32\u0E23\u0E01\u0E33\u0E2B\u0E19\u0E14 Last Frame Transition \u0E15\u0E49\u0E2D\u0E07\u0E23\u0E30\u0E1A\u0E38 First Frame (\u0E20\u0E32\u0E1E\u0E40\u0E23\u0E34\u0E48\u0E21\u0E15\u0E49\u0E19) \u0E04\u0E39\u0E48\u0E01\u0E31\u0E19\u0E40\u0E2A\u0E21\u0E2D");
  }
  const ai = new GoogleGenAI({
    apiKey: geminiKey,
    httpOptions: { timeout: 6e5 }
  });
  const inputParts = [];
  const firstAbs = await resolveLocalAssetPath(params.firstFrameUrl);
  let firstUploaded = null;
  if (firstAbs) {
    firstUploaded = await uploadLocalFileToGemini(ai, firstAbs, "image/png");
    inputParts.push({
      type: "image",
      uri: firstUploaded.uri,
      mime_type: firstUploaded.mimeType
    });
  }
  const lastAbs = await resolveLocalAssetPath(params.lastFrameUrl);
  if (lastAbs && firstUploaded) {
    if (lastAbs === firstAbs) {
      inputParts.push({
        type: "image",
        uri: firstUploaded.uri,
        mime_type: firstUploaded.mimeType
      });
    } else {
      const lastUploaded = await uploadLocalFileToGemini(ai, lastAbs, "image/png");
      inputParts.push({
        type: "image",
        uri: lastUploaded.uri,
        mime_type: lastUploaded.mimeType
      });
    }
  }
  const refUrls = Array.isArray(params.referenceImageUrls) ? params.referenceImageUrls.filter(Boolean) : [];
  const uploadedRefCount = [];
  for (const rUrl of refUrls) {
    const refAbs = await resolveLocalAssetPath(rUrl);
    if (refAbs) {
      const up = await uploadLocalFileToGemini(ai, refAbs, "image/png");
      inputParts.push({
        type: "image",
        uri: up.uri,
        mime_type: up.mimeType
      });
      uploadedRefCount.push(1);
    }
  }
  const extendAbs = await resolveLocalAssetPath(params.extendVideoUrl);
  let tempStrippedVideo = null;
  try {
    if (extendAbs) {
      let targetVideoPath = extendAbs;
      if (params.stripAudio) {
        tempStrippedVideo = path2.join(
          VIDEOS_DIR,
          `temp-stripped-${Date.now()}-${Math.round(Math.random() * 1e4)}.mp4`
        );
        await execFileAsync2("ffmpeg", [
          "-y",
          "-i",
          extendAbs,
          "-c:v",
          "copy",
          "-an",
          tempStrippedVideo
        ]);
        targetVideoPath = tempStrippedVideo;
      }
      const extUp = await uploadLocalFileToGemini(ai, targetVideoPath, "video/mp4");
      inputParts.push({
        type: "video",
        uri: extUp.uri,
        mime_type: extUp.mimeType
      });
    }
  } finally {
    if (tempStrippedVideo && fs2.existsSync(tempStrippedVideo)) {
      try {
        fs2.unlinkSync(tempStrippedVideo);
      } catch {
      }
    }
  }
  let formattedPrompt = prompt;
  if (!prompt.includes("[# Sources") && !prompt.includes("[# References")) {
    if (extendAbs) {
      const sourcesTag = "[# Sources <VIDEO_0>@Video1]";
      if (uploadedRefCount.length > 0) {
        const startImgIdx = (lastAbs ? 2 : firstAbs ? 1 : 0) + 1;
        const refs = uploadedRefCount.map((_, idx) => `<IMAGE_REF_${idx}>@Image${startImgIdx + idx}`).join(" ");
        formattedPrompt = `${sourcesTag} [# References ${refs}] ${prompt}`;
      } else {
        formattedPrompt = `${sourcesTag} ${prompt}`;
      }
    } else if (firstAbs && lastAbs) {
      if (!prompt.includes("<FIRST_FRAME>") && !prompt.includes("<LAST_FRAME>")) {
        formattedPrompt = `<FIRST_FRAME> <LAST_FRAME> ${prompt}`;
      }
    } else if (firstAbs) {
      if (!prompt.includes("<FIRST_FRAME>")) {
        formattedPrompt = `<FIRST_FRAME> ${prompt}`;
      }
    }
  }
  inputParts.push({
    type: "text",
    text: formattedPrompt
  });
  const videoResponseFormat = {
    type: "video",
    delivery: "uri",
    duration: `${durationSec}s`,
    resolution
  };
  if (!extendAbs) {
    videoResponseFormat.aspect_ratio = aspectRatio;
  }
  const createPayload = {
    model: engine,
    input: inputParts,
    response_format: videoResponseFormat
  };
  if (params.previousInteractionId) {
    createPayload.previous_interaction_id = params.previousInteractionId;
  }
  const interaction = await ai.interactions.create(createPayload);
  const outVid = interaction.output_video;
  if (!outVid || !outVid.uri && !outVid.data) {
    throw new Error(
      "\u0E42\u0E21\u0E40\u0E14\u0E25\u0E27\u0E34\u0E14\u0E35\u0E42\u0E2D\u0E44\u0E21\u0E48\u0E44\u0E14\u0E49\u0E2A\u0E48\u0E07\u0E44\u0E1F\u0E25\u0E4C\u0E27\u0E34\u0E14\u0E35\u0E42\u0E2D\u0E01\u0E25\u0E31\u0E1A\u0E21\u0E32 \u0E01\u0E23\u0E38\u0E13\u0E32\u0E15\u0E23\u0E27\u0E08\u0E2A\u0E2D\u0E1A\u0E2A\u0E34\u0E17\u0E18\u0E34\u0E4C\u0E42\u0E04\u0E27\u0E15\u0E49\u0E32\u0E27\u0E34\u0E14\u0E35\u0E42\u0E2D\u0E02\u0E2D\u0E07 GEMINI_API_KEY \u0E2B\u0E23\u0E37\u0E2D\u0E1B\u0E23\u0E31\u0E1A Prompt"
    );
  }
  const filename = `omni-flow-${Date.now()}-${Math.round(Math.random() * 1e4)}.mp4`;
  const outAbsPath = path2.join(VIDEOS_DIR, filename);
  if (outVid.data) {
    fs2.writeFileSync(outAbsPath, Buffer.from(outVid.data, "base64"));
  } else if (outVid.uri) {
    try {
      await ai.files.download({
        file: outVid.uri,
        downloadPath: outAbsPath
      });
    } catch {
      const dlResp = await fetch(outVid.uri, {
        headers: { "x-goog-api-key": geminiKey }
      });
      if (!dlResp.ok) {
        throw new Error(`\u0E14\u0E32\u0E27\u0E19\u0E4C\u0E42\u0E2B\u0E25\u0E14\u0E44\u0E1F\u0E25\u0E4C\u0E27\u0E34\u0E14\u0E35\u0E42\u0E2D\u0E08\u0E32\u0E01 Gemini API \u0E44\u0E21\u0E48\u0E2A\u0E33\u0E40\u0E23\u0E47\u0E08 (HTTP ${dlResp.status})`);
      }
      fs2.writeFileSync(outAbsPath, Buffer.from(await dlResp.arrayBuffer()));
    }
  }
  return recordMediaAsset({
    mediaType: "video",
    provider: "google-gemini-video",
    model: engine,
    prompt,
    fileUrl: `/uploads/videos/${filename}`,
    mimeType: "video/mp4",
    aspectRatio,
    durationSec,
    resolution,
    interactionId: interaction.id || "",
    workflowId: params.workflowId ?? null,
    thaiSummary: params.thaiSummary,
    reviewStatus: params.reviewStatus
  });
}
async function stitchFlowScenesWithFfmpeg(params) {
  const resolvedList = await Promise.all(
    params.sceneVideoUrls.map((u) => resolveLocalAssetPath(u))
  );
  const localPaths = resolvedList.filter((p) => Boolean(p && fs2.existsSync(p)));
  if (localPaths.length === 0) {
    throw new Error("\u0E22\u0E31\u0E07\u0E44\u0E21\u0E48\u0E21\u0E35\u0E04\u0E25\u0E34\u0E1B\u0E27\u0E34\u0E14\u0E35\u0E42\u0E2D\u0E09\u0E32\u0E01\u0E17\u0E35\u0E48\u0E2A\u0E23\u0E49\u0E32\u0E07\u0E40\u0E2A\u0E23\u0E47\u0E08\u0E2A\u0E33\u0E2B\u0E23\u0E31\u0E1A\u0E19\u0E33\u0E21\u0E32\u0E15\u0E31\u0E14\u0E15\u0E48\u0E2D\u0E23\u0E27\u0E21 (Assemble Film)");
  }
  try {
    await execFileAsync2("ffmpeg", ["-version"], { timeout: 4e3 });
  } catch {
    throw new Error(
      "\u0E40\u0E0B\u0E34\u0E23\u0E4C\u0E1F\u0E40\u0E27\u0E2D\u0E23\u0E4C Serverless \u0E1B\u0E31\u0E08\u0E08\u0E38\u0E1A\u0E31\u0E19\u0E44\u0E21\u0E48\u0E21\u0E35\u0E42\u0E1B\u0E23\u0E41\u0E01\u0E23\u0E21 FFmpeg \u0E15\u0E34\u0E14\u0E15\u0E31\u0E49\u0E07\u0E2A\u0E33\u0E2B\u0E23\u0E31\u0E1A\u0E23\u0E27\u0E21\u0E2B\u0E25\u0E32\u0E22\u0E09\u0E32\u0E01 (\u0E2A\u0E32\u0E21\u0E32\u0E23\u0E16\u0E14\u0E32\u0E27\u0E19\u0E4C\u0E42\u0E2B\u0E25\u0E14\u0E2B\u0E23\u0E37\u0E2D\u0E43\u0E0A\u0E49\u0E04\u0E25\u0E34\u0E1B\u0E27\u0E34\u0E14\u0E35\u0E42\u0E2D\u0E41\u0E15\u0E48\u0E25\u0E30\u0E09\u0E32\u0E01\u0E08\u0E32\u0E01\u0E04\u0E25\u0E31\u0E07\u0E2A\u0E37\u0E48\u0E2D\u0E44\u0E14\u0E49\u0E17\u0E31\u0E19\u0E17\u0E35\u0E04\u0E23\u0E31\u0E1A)"
    );
  }
  const isPortrait = params.aspectRatio === "9:16";
  const targetW = isPortrait ? 720 : 1280;
  const targetH = isPortrait ? 1280 : 720;
  const normalizedFiles = [];
  const concatListPath = path2.join(VIDEOS_DIR, `concat-list-${Date.now()}.txt`);
  const stitchedRawPath = path2.join(VIDEOS_DIR, `flow-stitched-${Date.now()}.mp4`);
  const finalFilename = `flow-master-${Date.now()}-${Math.round(Math.random() * 1e4)}.mp4`;
  const finalOutPath = path2.join(VIDEOS_DIR, finalFilename);
  try {
    for (let i = 0; i < localPaths.length; i++) {
      const src = localPaths[i];
      const normPath = path2.join(VIDEOS_DIR, `temp-norm-${Date.now()}-${i}.mp4`);
      let hasAudio = false;
      try {
        const { stdout } = await execFileAsync2("ffprobe", [
          "-v",
          "error",
          "-select_streams",
          "a",
          "-show_entries",
          "stream=codec_type",
          "-of",
          "csv=p=0",
          src
        ]);
        hasAudio = stdout.trim().length > 0;
      } catch {
        hasAudio = false;
      }
      const vf = `scale=${targetW}:${targetH}:force_original_aspect_ratio=decrease,pad=${targetW}:${targetH}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30,format=yuv420p`;
      if (hasAudio) {
        await execFileAsync2("ffmpeg", [
          "-y",
          "-i",
          src,
          "-vf",
          vf,
          "-c:v",
          "libx264",
          "-preset",
          "fast",
          "-crf",
          "21",
          "-c:a",
          "aac",
          "-ar",
          "44100",
          "-ac",
          "2",
          normPath
        ]);
      } else {
        await execFileAsync2("ffmpeg", [
          "-y",
          "-f",
          "lavfi",
          "-i",
          "anullsrc=channel_layout=stereo:sample_rate=44100",
          "-i",
          src,
          "-shortest",
          "-vf",
          vf,
          "-c:v",
          "libx264",
          "-preset",
          "fast",
          "-crf",
          "21",
          "-c:a",
          "aac",
          "-map",
          "1:v:0",
          "-map",
          "0:a:0",
          normPath
        ]);
      }
      normalizedFiles.push(normPath);
    }
    const listBody = normalizedFiles.map((f) => `file '${f.replace(/'/g, "'\\''")}'`).join("\n");
    fs2.writeFileSync(concatListPath, listBody, "utf-8");
    const voiceoverAbs = await resolveLocalAssetPath(params.voiceoverAudioUrl);
    if (voiceoverAbs && fs2.existsSync(voiceoverAbs)) {
      await execFileAsync2("ffmpeg", [
        "-y",
        "-f",
        "concat",
        "-safe",
        "0",
        "-i",
        concatListPath,
        "-c",
        "copy",
        stitchedRawPath
      ]);
      await execFileAsync2("ffmpeg", [
        "-y",
        "-i",
        stitchedRawPath,
        "-i",
        voiceoverAbs,
        "-filter_complex",
        "[0:a]volume=0.25[bg];[1:a]volume=1.0[vo];[bg][vo]amix=inputs=2:duration=longest:dropout_transition=2[aout]",
        "-map",
        "0:v:0",
        "-map",
        "[aout]",
        "-c:v",
        "copy",
        "-c:a",
        "aac",
        "-shortest",
        finalOutPath
      ]);
    } else {
      await execFileAsync2("ffmpeg", [
        "-y",
        "-f",
        "concat",
        "-safe",
        "0",
        "-i",
        concatListPath,
        "-c",
        "copy",
        finalOutPath
      ]);
    }
    const masterAsset = await recordMediaAsset({
      mediaType: "video",
      provider: "google-flow-ffmpeg",
      model: "flow-master-timeline",
      prompt: params.projectTitle || `Google Flow Master Film (${localPaths.length} scenes)`,
      fileUrl: `/uploads/videos/${finalFilename}`,
      mimeType: "video/mp4",
      aspectRatio: params.aspectRatio || "16:9"
    });
    return {
      masterVideoUrl: masterAsset.fileUrl,
      clipCount: localPaths.length
    };
  } finally {
    for (const f of [...normalizedFiles, concatListPath, stitchedRawPath]) {
      if (fs2.existsSync(f)) {
        try {
          fs2.unlinkSync(f);
        } catch {
        }
      }
    }
  }
}
function wrapPcm16InWavHeader(pcmData, sampleRate = 24e3, numChannels = 1) {
  if (pcmData.length >= 4 && pcmData.subarray(0, 4).toString("ascii") === "RIFF") {
    return pcmData;
  }
  const bitsPerSample = 16;
  const byteRate = sampleRate * numChannels * bitsPerSample / 8;
  const blockAlign = numChannels * bitsPerSample / 8;
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcmData.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(numChannels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcmData.length, 40);
  return Buffer.concat([header, pcmData]);
}
async function generateRealAudio(params) {
  const rawText = params.text?.trim();
  if (!rawText) {
    throw new Error("\u0E01\u0E23\u0E38\u0E13\u0E32\u0E23\u0E30\u0E1A\u0E38\u0E02\u0E49\u0E2D\u0E04\u0E27\u0E32\u0E21\u0E1A\u0E17\u0E1E\u0E32\u0E01\u0E22\u0E4C\u0E2A\u0E33\u0E2B\u0E23\u0E31\u0E1A\u0E2A\u0E23\u0E49\u0E32\u0E07\u0E40\u0E2A\u0E35\u0E22\u0E07\u0E08\u0E23\u0E34\u0E07");
  }
  const cleanTranscript = rawText.replace(/\[[^\]]*\]/g, " ").replace(/\s+/g, " ").trim();
  const geminiKey = getSettingValue("gemini_api_key", "GEMINI_API_KEY") || getSettingValue("gemini_api_key", "GOOGLE_API_KEY");
  const openaiKey = getSettingValue("openai_api_key", "OPENAI_API_KEY");
  const elevenKey = getSettingValue("elevenlabs_api_key", "ELEVENLABS_API_KEY");
  const chosenProvider = params.provider || (geminiKey ? "gemini" : elevenKey ? "elevenlabs" : openaiKey ? "openai" : "gemini");
  if (chosenProvider === "gemini") {
    if (!geminiKey) {
      throw new Error(
        "\u0E22\u0E31\u0E07\u0E44\u0E21\u0E48\u0E44\u0E14\u0E49\u0E15\u0E31\u0E49\u0E07\u0E04\u0E48\u0E32 Google Gemini API Key \u0E2A\u0E33\u0E2B\u0E23\u0E31\u0E1A\u0E2A\u0E23\u0E49\u0E32\u0E07\u0E40\u0E2A\u0E35\u0E22\u0E07\u0E1E\u0E32\u0E01\u0E22\u0E4C\u0E08\u0E23\u0E34\u0E07 \u2014 \u0E01\u0E23\u0E38\u0E13\u0E32\u0E43\u0E2A\u0E48\u0E04\u0E35\u0E22\u0E4C\u0E43\u0E19\u0E2B\u0E19\u0E49\u0E32\u0E15\u0E31\u0E49\u0E07\u0E04\u0E48\u0E32 API Keys"
      );
    }
    const ttsModel2 = await resolveLatestModel({
      provider: "gemini",
      capability: "tts",
      requestedModel: params.model || getSettingValue("gemini_tts_model"),
      apiKeyOverride: geminiKey
    });
    const methods = await getGeminiModelMethods(geminiKey, ttsModel2);
    const ai = new GoogleGenAI({ apiKey: geminiKey });
    const voiceName = params.voice || "Kore";
    const deliveryStyle = params.style || "warm, articulate, inspiring Thai educator and executive speaker";
    let audioBuffer2 = null;
    let interactionId = "";
    if (methods.includes("generateContent")) {
      const ttsResp = await ai.models.generateContent({
        model: ttsModel2,
        contents: [{ parts: [{ text: cleanTranscript }] }],
        config: {
          responseModalities: ["AUDIO"],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName }
            }
          }
        }
      });
      const inline = ttsResp?.candidates?.[0]?.content?.parts?.find(
        (p) => p?.inlineData?.data
      )?.inlineData;
      if (inline?.data) {
        const rawBuf = Buffer.from(inline.data, "base64");
        const rateMatch = String(inline.mimeType || "").match(/rate=(\d+)/i);
        const sampleRate = rateMatch ? parseInt(rateMatch[1], 10) : 24e3;
        audioBuffer2 = wrapPcm16InWavHeader(rawBuf, sampleRate, 1);
      }
    } else {
      const interaction = await ai.interactions.create({
        model: ttsModel2,
        input: [
          {
            type: "user_input",
            content: [
              {
                type: "text",
                text: cleanTranscript,
                annotations: [
                  {
                    type: "speech_metadata",
                    speaker: "Komkrit",
                    style: deliveryStyle
                  }
                ]
              }
            ]
          }
        ],
        response_format: { type: "audio" },
        generation_config: {
          speech_config: {
            speakers: [{ speaker: "Komkrit", voice: voiceName }]
          }
        }
      });
      interactionId = interaction.id || "";
      const outAudio = interaction.output_audio;
      if (outAudio?.data) {
        audioBuffer2 = wrapPcm16InWavHeader(Buffer.from(outAudio.data, "base64"), 24e3, 1);
      }
    }
    if (!audioBuffer2 || audioBuffer2.length === 0) {
      throw new Error(`Google Gemini TTS (${ttsModel2}) \u0E44\u0E21\u0E48\u0E44\u0E14\u0E49\u0E2A\u0E48\u0E07\u0E02\u0E49\u0E2D\u0E21\u0E39\u0E25\u0E40\u0E2A\u0E35\u0E22\u0E07\u0E01\u0E25\u0E31\u0E1A\u0E21\u0E32`);
    }
    const filename2 = `tts-gemini-${Date.now()}-${Math.round(Math.random() * 1e4)}.wav`;
    fs2.writeFileSync(path2.join(AUDIO_DIR, filename2), audioBuffer2);
    const fileUrl2 = `/uploads/audio/${filename2}`;
    return recordMediaAsset({
      mediaType: "audio",
      provider: "gemini",
      model: `${ttsModel2} (${voiceName})`,
      prompt: cleanTranscript.slice(0, 300),
      fileUrl: fileUrl2,
      mimeType: "audio/wav",
      interactionId,
      workflowId: params.workflowId ?? null
    });
  }
  if (chosenProvider === "elevenlabs") {
    if (!elevenKey) {
      throw new Error(
        "\u0E22\u0E31\u0E07\u0E44\u0E21\u0E48\u0E44\u0E14\u0E49\u0E15\u0E31\u0E49\u0E07\u0E04\u0E48\u0E32 ElevenLabs API Key \u0E2A\u0E33\u0E2B\u0E23\u0E31\u0E1A\u0E2A\u0E23\u0E49\u0E32\u0E07\u0E40\u0E2A\u0E35\u0E22\u0E07\u0E1E\u0E32\u0E01\u0E22\u0E4C\u0E08\u0E23\u0E34\u0E07 \u2014 \u0E01\u0E23\u0E38\u0E13\u0E32\u0E43\u0E2A\u0E48\u0E04\u0E35\u0E22\u0E4C\u0E43\u0E19\u0E2B\u0E19\u0E49\u0E32\u0E15\u0E31\u0E49\u0E07\u0E04\u0E48\u0E32 API Keys"
      );
    }
    const ttsModel2 = await resolveLatestModel({
      provider: "elevenlabs",
      capability: "tts",
      requestedModel: params.model || getSettingValue("elevenlabs_model"),
      apiKeyOverride: elevenKey
    });
    const voiceId = await resolveLatestElevenLabsVoice(
      params.voice || getSettingValue("elevenlabs_voice_id"),
      elevenKey
    );
    const resp2 = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "xi-api-key": elevenKey
      },
      body: JSON.stringify({
        text: cleanTranscript,
        model_id: ttsModel2
      })
    });
    if (!resp2.ok) {
      const errTxt = await resp2.text();
      throw new Error(`ElevenLabs TTS API Error (HTTP ${resp2.status}): ${errTxt.slice(0, 200)}`);
    }
    const audioBuffer2 = Buffer.from(await resp2.arrayBuffer());
    const filename2 = `tts-eleven-${Date.now()}-${Math.round(Math.random() * 1e4)}.mp3`;
    fs2.writeFileSync(path2.join(AUDIO_DIR, filename2), audioBuffer2);
    const fileUrl2 = `/uploads/audio/${filename2}`;
    return recordMediaAsset({
      mediaType: "audio",
      provider: "elevenlabs",
      model: `${ttsModel2} (${voiceId})`,
      prompt: cleanTranscript.slice(0, 300),
      fileUrl: fileUrl2,
      mimeType: "audio/mpeg",
      workflowId: params.workflowId ?? null
    });
  }
  if (!openaiKey) {
    throw new Error(
      "\u0E22\u0E31\u0E07\u0E44\u0E21\u0E48\u0E44\u0E14\u0E49\u0E15\u0E31\u0E49\u0E07\u0E04\u0E48\u0E32 OpenAI API Key \u0E2A\u0E33\u0E2B\u0E23\u0E31\u0E1A\u0E2A\u0E23\u0E49\u0E32\u0E07\u0E40\u0E2A\u0E35\u0E22\u0E07\u0E1E\u0E32\u0E01\u0E22\u0E4C\u0E08\u0E23\u0E34\u0E07 \u2014 \u0E01\u0E23\u0E38\u0E13\u0E32\u0E43\u0E2A\u0E48\u0E04\u0E35\u0E22\u0E4C\u0E43\u0E19\u0E2B\u0E19\u0E49\u0E32\u0E15\u0E31\u0E49\u0E07\u0E04\u0E48\u0E32 API Keys"
    );
  }
  const ttsModel = await resolveLatestModel({
    provider: "openai",
    capability: "tts",
    requestedModel: params.model || getSettingValue("openai_tts_model"),
    apiKeyOverride: openaiKey
  });
  const voice = params.voice || "alloy";
  const resp = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${openaiKey}`
    },
    body: JSON.stringify({
      model: ttsModel,
      voice,
      input: cleanTranscript,
      response_format: "mp3"
    })
  });
  if (!resp.ok) {
    const errTxt = await resp.text();
    throw new Error(`OpenAI TTS API Error (HTTP ${resp.status}): ${errTxt.slice(0, 200)}`);
  }
  const audioBuffer = Buffer.from(await resp.arrayBuffer());
  const filename = `tts-openai-${Date.now()}-${Math.round(Math.random() * 1e4)}.mp3`;
  fs2.writeFileSync(path2.join(AUDIO_DIR, filename), audioBuffer);
  const fileUrl = `/uploads/audio/${filename}`;
  return recordMediaAsset({
    mediaType: "audio",
    provider: "openai",
    model: `${ttsModel} (${voice})`,
    prompt: cleanTranscript.slice(0, 300),
    fileUrl,
    mimeType: "audio/mpeg",
    workflowId: params.workflowId ?? null
  });
}

// server/aiEngine.ts
function getProviderConfigs() {
  const geminiKey = getSettingValue("gemini_api_key", "GEMINI_API_KEY") || getSettingValue("gemini_api_key", "GOOGLE_API_KEY");
  const claudeKey = getSettingValue("claude_api_key", "ANTHROPIC_API_KEY");
  const deepseekKey = getSettingValue("deepseek_api_key", "DEEPSEEK_API_KEY");
  const openaiKey = getSettingValue("openai_api_key", "OPENAI_API_KEY");
  const elevenlabsKey = getSettingValue("elevenlabs_api_key", "ELEVENLABS_API_KEY");
  const resendKey = getSettingValue("resend_api_key", "RESEND_API_KEY");
  return {
    defaultProvider: getSettingValue("ai_provider") || "auto",
    gemini: {
      apiKey: geminiKey,
      model: getSettingValue("gemini_model"),
      imageModel: getSettingValue("gemini_image_model"),
      videoModel: getSettingValue("gemini_video_model"),
      ttsModel: getSettingValue("gemini_tts_model")
    },
    claude: {
      apiKey: claudeKey,
      model: getSettingValue("claude_model")
    },
    deepseek: {
      apiKey: deepseekKey,
      model: getSettingValue("deepseek_model")
    },
    openai: {
      apiKey: openaiKey,
      model: getSettingValue("openai_model")
    },
    localOpenAi: {
      endpoint: getSettingValue("local_endpoint") || "http://localhost:1234/v1",
      model: getSettingValue("local_model"),
      apiKey: getSettingValue("local_api_key") || ""
    },
    vertexVeo: {
      projectId: getSettingValue("vertex_project_id", "GOOGLE_CLOUD_PROJECT"),
      location: getSettingValue("vertex_location", "GOOGLE_CLOUD_LOCATION") || "us-central1",
      accessToken: getSettingValue("vertex_access_token", "GOOGLE_OAUTH_ACCESS_TOKEN"),
      veoModel: getSettingValue("vertex_veo_model")
    },
    elevenlabs: {
      apiKey: elevenlabsKey,
      model: getSettingValue("elevenlabs_model"),
      voiceId: getSettingValue("elevenlabs_voice_id")
    },
    resend: {
      apiKey: resendKey,
      fromEmail: getSettingValue("resend_from_email") || "onboarding@resend.dev"
    }
  };
}
function resolveActiveProvider(requested) {
  const cfg = getProviderConfigs();
  const target = requested || cfg.defaultProvider || "auto";
  if (target !== "auto") {
    return target;
  }
  if (cfg.defaultProvider === "gemini" && cfg.gemini.apiKey) return "gemini";
  if (cfg.defaultProvider === "openai" && cfg.openai.apiKey) return "openai";
  if (cfg.defaultProvider === "claude" && cfg.claude.apiKey) return "claude";
  if (cfg.defaultProvider === "deepseek" && cfg.deepseek.apiKey) return "deepseek";
  if (cfg.gemini.apiKey) return "gemini";
  if (cfg.openai.apiKey) return "openai";
  if (cfg.claude.apiKey) return "claude";
  if (cfg.deepseek.apiKey) return "deepseek";
  throw new Error(
    '\u0E22\u0E31\u0E07\u0E44\u0E21\u0E48\u0E44\u0E14\u0E49\u0E15\u0E31\u0E49\u0E07\u0E04\u0E48\u0E32 API Key \u0E08\u0E23\u0E34\u0E07\u0E2A\u0E33\u0E2B\u0E23\u0E31\u0E1A AI (\u0E23\u0E2D\u0E07\u0E23\u0E31\u0E1A Google Gemini, OpenAI ChatGPT, Anthropic Claude \u0E41\u0E25\u0E30 DeepSeek) \u2014 \u0E01\u0E23\u0E38\u0E13\u0E32\u0E44\u0E1B\u0E17\u0E35\u0E48\u0E40\u0E21\u0E19\u0E39 "\u0E15\u0E31\u0E49\u0E07\u0E04\u0E48\u0E32\u0E04\u0E35\u0E22\u0E4C AI" \u0E40\u0E1E\u0E37\u0E48\u0E2D\u0E1A\u0E31\u0E19\u0E17\u0E36\u0E01\u0E04\u0E35\u0E22\u0E4C\u0E08\u0E23\u0E34\u0E07\u0E01\u0E48\u0E2D\u0E19\u0E43\u0E0A\u0E49\u0E07\u0E32\u0E19\u0E04\u0E23\u0E31\u0E1A'
  );
}
function getActiveKnowledgeContext(topic) {
  const rows = db.prepare(
    "SELECT title, category, summary, content, source_ref FROM knowledge_base WHERE is_active = 1 ORDER BY id ASC"
  ).all();
  const lower = topic.toLowerCase();
  const scored = rows.map((r) => {
    let score = r.category === "brand_guideline" ? 10 : 1;
    const words = lower.split(/\s+/).filter((w) => w.length > 1);
    for (const w of words) {
      if (r.title.toLowerCase().includes(w) || r.summary.toLowerCase().includes(w) || r.content.toLowerCase().includes(w)) {
        score += 4;
      }
    }
    return { ...r, score };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, 6);
}
function sanitizeApiError(rawMsg, secret) {
  let msg = String(rawMsg || "\u0E40\u0E01\u0E34\u0E14\u0E02\u0E49\u0E2D\u0E1C\u0E34\u0E14\u0E1E\u0E25\u0E32\u0E14\u0E43\u0E19\u0E01\u0E32\u0E23\u0E40\u0E0A\u0E37\u0E48\u0E2D\u0E21\u0E15\u0E48\u0E2D API");
  if (secret && secret.trim().length > 6) {
    msg = msg.split(secret.trim()).join("***");
  }
  return msg;
}
async function callRealLlm(params) {
  const cfg = getProviderConfigs();
  const provider = params.provider && params.provider !== "auto" ? params.provider : resolveActiveProvider(params.provider);
  const startedAt = Date.now();
  if (provider === "gemini") {
    const apiKey = params.apiKeyOverride?.trim() || cfg.gemini.apiKey;
    if (!apiKey) {
      throw new Error(
        '\u0E22\u0E31\u0E07\u0E44\u0E21\u0E48\u0E44\u0E14\u0E49\u0E43\u0E2A\u0E48 Google Gemini API Key \u2014 \u0E01\u0E23\u0E38\u0E13\u0E32\u0E44\u0E1B\u0E17\u0E35\u0E48\u0E1B\u0E38\u0E48\u0E21 "\u0E40\u0E0A\u0E37\u0E48\u0E2D\u0E21\u0E15\u0E48\u0E2D\u0E04\u0E35\u0E22\u0E4C AI" \u0E40\u0E1E\u0E37\u0E48\u0E2D\u0E27\u0E32\u0E07\u0E04\u0E35\u0E22\u0E4C\u0E41\u0E25\u0E30\u0E01\u0E14\u0E1A\u0E31\u0E19\u0E17\u0E36\u0E01\u0E01\u0E48\u0E2D\u0E19\u0E43\u0E0A\u0E49\u0E07\u0E32\u0E19\u0E04\u0E23\u0E31\u0E1A'
      );
    }
    try {
      const model = await resolveLatestModel({
        provider: "gemini",
        capability: "text",
        requestedModel: params.model || cfg.gemini.model,
        apiKeyOverride: apiKey
      });
      const methods = await getGeminiModelMethods(apiKey, model);
      const supportsGenerateContent = methods.length === 0 || methods.includes("generateContent");
      const ai = new GoogleGenAI2({ apiKey });
      if (!supportsGenerateContent) {
        const inputPayload = params.messages.length === 1 && params.messages[0].role === "user" ? params.messages[0].content : params.messages.map((m) => ({
          type: m.role === "assistant" ? "model_output" : "user_input",
          content: [{ type: "text", text: m.content }]
        }));
        const createReq = {
          model,
          input: inputPayload
        };
        if (params.systemInstruction) {
          createReq.system_instruction = params.systemInstruction;
        }
        if (params.jsonMode) {
          createReq.response_format = {
            type: "text",
            mime_type: "application/json"
          };
        }
        const interaction = await ai.interactions.create(createReq);
        const text3 = (interaction.output_text || "").trim();
        if (!text3) {
          throw new Error(`Google Gemini (${model}) \u0E15\u0E2D\u0E1A\u0E01\u0E25\u0E31\u0E1A\u0E40\u0E1B\u0E47\u0E19\u0E04\u0E48\u0E32\u0E27\u0E48\u0E32\u0E07`);
        }
        return {
          text: text3,
          provider: "gemini",
          model,
          engineLabel: `Google Gemini (${model})`,
          latencyMs: Date.now() - startedAt
        };
      }
      let genResp;
      try {
        genResp = await ai.models.generateContent({
          model,
          contents: params.messages.map((m) => ({
            role: m.role === "assistant" ? "model" : "user",
            parts: [{ text: m.content }]
          })),
          config: {
            ...params.systemInstruction ? { systemInstruction: params.systemInstruction } : {},
            ...typeof params.temperature === "number" ? { temperature: params.temperature } : {},
            ...params.jsonMode ? { responseMimeType: "application/json" } : {}
          }
        });
      } catch (firstErr) {
        const errMsg = String(firstErr?.message || "");
        if (/temperature|responseMimeType|JSON|Developer instruction|systemInstruction/i.test(errMsg)) {
          const fallbackMessages = params.messages.map((m, idx) => ({
            role: m.role === "assistant" ? "model" : "user",
            parts: [
              {
                text: idx === 0 && m.role === "user" && params.systemInstruction ? `${params.systemInstruction}

${m.content}` : m.content
              }
            ]
          }));
          genResp = await ai.models.generateContent({
            model,
            contents: fallbackMessages
          });
        } else {
          throw firstErr;
        }
      }
      const text2 = (genResp.text || "").trim();
      if (!text2) {
        throw new Error(`Google Gemini (${model}) \u0E15\u0E2D\u0E1A\u0E01\u0E25\u0E31\u0E1A\u0E40\u0E1B\u0E47\u0E19\u0E04\u0E48\u0E32\u0E27\u0E48\u0E32\u0E07`);
      }
      return {
        text: text2,
        provider: "gemini",
        model,
        engineLabel: `Google Gemini (${model})`,
        latencyMs: Date.now() - startedAt
      };
    } catch (err) {
      throw new Error(sanitizeApiError(err.message, apiKey));
    }
  }
  if (provider === "claude") {
    const apiKey = params.apiKeyOverride?.trim() || cfg.claude.apiKey;
    if (!apiKey) {
      throw new Error(
        '\u0E22\u0E31\u0E07\u0E44\u0E21\u0E48\u0E44\u0E14\u0E49\u0E43\u0E2A\u0E48 Anthropic Claude API Key \u2014 \u0E01\u0E23\u0E38\u0E13\u0E32\u0E15\u0E31\u0E49\u0E07\u0E04\u0E48\u0E32\u0E43\u0E19\u0E2B\u0E19\u0E49\u0E32 "\u0E15\u0E31\u0E49\u0E07\u0E04\u0E48\u0E32 API Keys & Providers"'
      );
    }
    const model = await resolveLatestModel({
      provider: "claude",
      capability: "text",
      requestedModel: params.model || cfg.claude.model,
      apiKeyOverride: apiKey
    });
    const body = {
      model,
      max_tokens: 8192,
      messages: params.messages.map((m) => ({
        role: m.role,
        content: m.content
      }))
    };
    if (params.systemInstruction) {
      body.system = params.systemInstruction;
    }
    if (typeof params.temperature === "number") {
      body.temperature = params.temperature;
    }
    let data2 = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      const resp = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01"
        },
        body: JSON.stringify(body)
      });
      data2 = await resp.json();
      if (resp.ok) break;
      const errMsg = String(data2?.error?.message || "");
      if (/temperature/i.test(errMsg) && "temperature" in body) {
        delete body.temperature;
        continue;
      }
      if (/max_tokens/i.test(errMsg) && body.max_tokens > 4096) {
        body.max_tokens = 4096;
        continue;
      }
      throw new Error(errMsg || `Anthropic Claude API Error (HTTP ${resp.status})`);
    }
    const blocks = Array.isArray(data2?.content) ? data2.content : [];
    const text2 = blocks.filter((b) => b.type === "text").map((b) => b.text).join("\n").trim();
    const thinking = blocks.filter((b) => b.type === "thinking").map((b) => b.thinking).join("\n").trim();
    if (!text2) {
      throw new Error(`Anthropic Claude (${model}) \u0E44\u0E21\u0E48\u0E44\u0E14\u0E49\u0E2A\u0E48\u0E07\u0E02\u0E49\u0E2D\u0E04\u0E27\u0E32\u0E21\u0E15\u0E2D\u0E1A\u0E01\u0E25\u0E31\u0E1A`);
    }
    return {
      text: text2,
      reasoning: thinking || void 0,
      provider: "claude",
      model,
      engineLabel: `Anthropic Claude (${model})`,
      latencyMs: Date.now() - startedAt
    };
  }
  if (provider === "deepseek") {
    const apiKey = params.apiKeyOverride?.trim() || cfg.deepseek.apiKey;
    if (!apiKey) {
      throw new Error(
        '\u0E22\u0E31\u0E07\u0E44\u0E21\u0E48\u0E44\u0E14\u0E49\u0E43\u0E2A\u0E48 DeepSeek API Key \u2014 \u0E01\u0E23\u0E38\u0E13\u0E32\u0E15\u0E31\u0E49\u0E07\u0E04\u0E48\u0E32\u0E43\u0E19\u0E2B\u0E19\u0E49\u0E32 "\u0E15\u0E31\u0E49\u0E07\u0E04\u0E48\u0E32 API Keys & Providers"'
      );
    }
    const model = await resolveLatestModel({
      provider: "deepseek",
      capability: "text",
      requestedModel: params.model || cfg.deepseek.model,
      apiKeyOverride: apiKey
    });
    const isReasoner = /reasoner/i.test(model);
    const apiMessages2 = [];
    if (params.systemInstruction) {
      apiMessages2.push({ role: "system", content: params.systemInstruction });
    }
    for (const m of params.messages) {
      apiMessages2.push({ role: m.role, content: m.content });
    }
    const body = {
      model,
      messages: apiMessages2,
      max_tokens: 8192
    };
    if (!isReasoner && typeof params.temperature === "number") {
      body.temperature = params.temperature;
    }
    if (params.jsonMode && !isReasoner) {
      body.response_format = { type: "json_object" };
    }
    let data2 = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      const resp = await fetch("https://api.deepseek.com/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`
        },
        body: JSON.stringify(body)
      });
      data2 = await resp.json();
      if (resp.ok) break;
      const errMsg = String(data2?.error?.message || "");
      if (/temperature/i.test(errMsg) && "temperature" in body) {
        delete body.temperature;
        continue;
      }
      if (/response_format/i.test(errMsg) && "response_format" in body) {
        delete body.response_format;
        continue;
      }
      if (/max_tokens/i.test(errMsg) && body.max_tokens > 4096) {
        body.max_tokens = 4096;
        continue;
      }
      throw new Error(errMsg || `DeepSeek API Error (HTTP ${resp.status})`);
    }
    const msg = data2?.choices?.[0]?.message;
    const text2 = (msg?.content || "").trim();
    const reasoning = (msg?.reasoning_content || "").trim();
    if (!text2) {
      throw new Error(`DeepSeek (${model}) \u0E44\u0E21\u0E48\u0E44\u0E14\u0E49\u0E2A\u0E48\u0E07\u0E02\u0E49\u0E2D\u0E04\u0E27\u0E32\u0E21\u0E15\u0E2D\u0E1A\u0E01\u0E25\u0E31\u0E1A`);
    }
    return {
      text: text2,
      reasoning: reasoning || void 0,
      provider: "deepseek",
      model,
      engineLabel: `DeepSeek (${model})`,
      latencyMs: Date.now() - startedAt
    };
  }
  if (provider === "openai") {
    const apiKey = params.apiKeyOverride?.trim() || cfg.openai.apiKey;
    if (!apiKey) {
      throw new Error(
        '\u0E22\u0E31\u0E07\u0E44\u0E21\u0E48\u0E44\u0E14\u0E49\u0E43\u0E2A\u0E48 OpenAI (ChatGPT) API Key \u2014 \u0E01\u0E23\u0E38\u0E13\u0E32\u0E15\u0E31\u0E49\u0E07\u0E04\u0E48\u0E32\u0E43\u0E19\u0E2B\u0E19\u0E49\u0E32 "\u0E15\u0E31\u0E49\u0E07\u0E04\u0E48\u0E32 API Keys & Providers"'
      );
    }
    const model = await resolveLatestModel({
      provider: "openai",
      capability: "text",
      requestedModel: params.model || cfg.openai.model,
      apiKeyOverride: apiKey
    });
    const isReasoningSeries = /^o\d/i.test(model);
    const apiMessages2 = [];
    if (params.systemInstruction) {
      const sysContent = params.jsonMode && !/json/i.test(params.systemInstruction) ? `${params.systemInstruction}
Return valid JSON.` : params.systemInstruction;
      apiMessages2.push({
        role: isReasoningSeries ? "developer" : "system",
        content: sysContent
      });
    } else if (params.jsonMode) {
      apiMessages2.push({
        role: isReasoningSeries ? "developer" : "system",
        content: "Respond strictly with valid JSON."
      });
    }
    for (const m of params.messages) {
      apiMessages2.push({ role: m.role, content: m.content });
    }
    const body = {
      model,
      messages: apiMessages2
    };
    if (params.jsonMode && !isReasoningSeries) {
      body.response_format = { type: "json_object" };
    }
    let data2 = null;
    let usedResponsesApi = false;
    for (let attempt = 0; attempt < 4; attempt++) {
      const resp = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`
        },
        body: JSON.stringify(body)
      });
      data2 = await resp.json();
      if (resp.ok) break;
      const errMsg = String(data2?.error?.message || "");
      if (/v1\/responses|not a chat model|not supported in the v1\/chat\/completions/i.test(errMsg)) {
        const respBody = {
          model,
          input: params.messages.map((m) => ({
            role: m.role,
            content: m.content
          }))
        };
        if (params.systemInstruction) {
          respBody.instructions = params.jsonMode && !/json/i.test(params.systemInstruction) ? `${params.systemInstruction}
Return valid JSON.` : params.systemInstruction;
        }
        const r2 = await fetch("https://api.openai.com/v1/responses", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`
          },
          body: JSON.stringify(respBody)
        });
        const d2 = await r2.json();
        if (!r2.ok) {
          throw new Error(
            d2?.error?.message || `OpenAI Responses API Error (HTTP ${r2.status})`
          );
        }
        data2 = d2;
        usedResponsesApi = true;
        break;
      }
      if (/temperature/i.test(errMsg) && "temperature" in body) {
        delete body.temperature;
        continue;
      }
      if (/response_format/i.test(errMsg) && "response_format" in body) {
        delete body.response_format;
        continue;
      }
      if (/role.*system|developer/i.test(errMsg) && Array.isArray(body.messages)) {
        const hasSys = body.messages.some((m) => m.role === "system");
        if (hasSys) {
          body.messages = body.messages.map(
            (m) => m.role === "system" ? { ...m, role: "developer" } : m
          );
          continue;
        }
      }
      throw new Error(
        errMsg || `OpenAI ChatGPT API Error (HTTP ${resp.status})`
      );
    }
    let text2 = "";
    if (usedResponsesApi) {
      if (typeof data2?.output_text === "string" && data2.output_text.trim()) {
        text2 = data2.output_text.trim();
      } else if (Array.isArray(data2?.output)) {
        const parts = [];
        for (const item of data2.output) {
          if (Array.isArray(item?.content)) {
            for (const c of item.content) {
              if (typeof c?.text === "string") parts.push(c.text);
            }
          }
        }
        text2 = parts.join("\n").trim();
      }
    } else {
      const rawContent = data2?.choices?.[0]?.message?.content;
      if (typeof rawContent === "string") {
        text2 = rawContent.trim();
      } else if (Array.isArray(rawContent)) {
        text2 = rawContent.map((p) => typeof p?.text === "string" ? p.text : "").join("\n").trim();
      }
    }
    if (!text2) {
      const refusal = data2?.choices?.[0]?.message?.refusal;
      throw new Error(
        refusal ? `OpenAI (${model}) \u0E1B\u0E0F\u0E34\u0E40\u0E2A\u0E18\u0E04\u0E33\u0E02\u0E2D: ${refusal}` : `OpenAI ChatGPT (${model}) \u0E44\u0E21\u0E48\u0E44\u0E14\u0E49\u0E2A\u0E48\u0E07\u0E02\u0E49\u0E2D\u0E04\u0E27\u0E32\u0E21\u0E15\u0E2D\u0E1A\u0E01\u0E25\u0E31\u0E1A`
      );
    }
    return {
      text: text2,
      provider: "openai",
      model,
      engineLabel: `OpenAI ChatGPT (${model})`,
      latencyMs: Date.now() - startedAt
    };
  }
  const endpoint = cfg.localOpenAi.endpoint.replace(/\/$/, "");
  const localKey = params.apiKeyOverride?.trim() || cfg.localOpenAi.apiKey;
  const localModel = await resolveLatestModel({
    provider: "openai_compatible",
    capability: "text",
    requestedModel: params.model || cfg.localOpenAi.model,
    apiKeyOverride: localKey
  });
  const headers = { "Content-Type": "application/json" };
  if (localKey) {
    headers.Authorization = `Bearer ${localKey}`;
  }
  const apiMessages = [];
  if (params.systemInstruction) {
    apiMessages.push({ role: "system", content: params.systemInstruction });
  }
  for (const m of params.messages) {
    apiMessages.push({ role: m.role, content: m.content });
  }
  const compatBody = {
    model: localModel,
    messages: apiMessages
  };
  if (typeof params.temperature === "number") {
    compatBody.temperature = params.temperature;
  }
  let data = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    const resp = await fetch(`${endpoint}/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify(compatBody)
    });
    if (resp.ok) {
      data = await resp.json();
      break;
    }
    const errText = await resp.text();
    if (/temperature/i.test(errText) && "temperature" in compatBody) {
      delete compatBody.temperature;
      continue;
    }
    throw new Error(
      `OpenAI-Compatible Server (${endpoint}) \u0E15\u0E2D\u0E1A\u0E01\u0E25\u0E31\u0E1A HTTP ${resp.status}: ${errText.slice(0, 200)}`
    );
  }
  const text = (data?.choices?.[0]?.message?.content || "").trim();
  if (!text) {
    throw new Error(`OpenAI-Compatible Server (${localModel}) \u0E44\u0E21\u0E48\u0E44\u0E14\u0E49\u0E2A\u0E48\u0E07\u0E02\u0E49\u0E2D\u0E04\u0E27\u0E32\u0E21\u0E15\u0E2D\u0E1A\u0E01\u0E25\u0E31\u0E1A`);
  }
  return {
    text,
    provider: "openai_compatible",
    model: localModel,
    engineLabel: `OpenAI-Compatible (${localModel})`,
    latencyMs: Date.now() - startedAt
  };
}
function extractStrictJson(rawText) {
  const cleaned = rawText.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/\s*```$/i, "").trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const firstBrace = cleaned.indexOf("{");
    const lastBrace = cleaned.lastIndexOf("}");
    if (firstBrace !== -1 && lastBrace > firstBrace) {
      return JSON.parse(cleaned.slice(firstBrace, lastBrace + 1));
    }
    throw new Error("\u0E42\u0E21\u0E40\u0E14\u0E25 AI \u0E15\u0E2D\u0E1A\u0E01\u0E25\u0E31\u0E1A\u0E44\u0E21\u0E48\u0E43\u0E0A\u0E48\u0E23\u0E39\u0E1B\u0E41\u0E1A\u0E1A JSON \u0E17\u0E35\u0E48\u0E16\u0E39\u0E01\u0E15\u0E49\u0E2D\u0E07 \u0E01\u0E23\u0E38\u0E13\u0E32\u0E25\u0E2D\u0E07\u0E2A\u0E31\u0E48\u0E07\u0E07\u0E32\u0E19\u0E2D\u0E35\u0E01\u0E04\u0E23\u0E31\u0E49\u0E07");
  }
}
async function testProviderConnection(params) {
  const res = await callRealLlm({
    provider: params.provider,
    model: params.model,
    apiKeyOverride: params.apiKey,
    systemInstruction: "You are an API connectivity verifier. Reply concisely in Thai.",
    messages: [
      {
        role: "user",
        content: "\u0E22\u0E37\u0E19\u0E22\u0E31\u0E19\u0E01\u0E32\u0E23\u0E40\u0E0A\u0E37\u0E48\u0E2D\u0E21\u0E15\u0E48\u0E2D\u0E23\u0E30\u0E1A\u0E1A \u0E04\u0E21\u0E04\u0E34\u0E14 by KOMKRIT \u0E2A\u0E31\u0E49\u0E19\u0E46 1 \u0E1B\u0E23\u0E30\u0E42\u0E22\u0E04"
      }
    ]
  });
  return {
    ok: true,
    provider: res.provider,
    model: res.model,
    engineLabel: res.engineLabel,
    latencyMs: res.latencyMs,
    sampleReply: res.text
  };
}
async function chatWithRealModel(params) {
  const userMsg = params.message?.trim();
  if (!userMsg) {
    throw new Error("\u0E01\u0E23\u0E38\u0E13\u0E32\u0E1E\u0E34\u0E21\u0E1E\u0E4C\u0E02\u0E49\u0E2D\u0E04\u0E27\u0E32\u0E21\u0E2A\u0E19\u0E17\u0E19\u0E32");
  }
  const historyRows = db.prepare(
    "SELECT role, content FROM ai_chat_messages WHERE session_id = ? ORDER BY id ASC LIMIT 24"
  ).all(params.sessionId);
  let systemInstruction = '\u0E04\u0E38\u0E13\u0E04\u0E37\u0E2D\u0E1C\u0E39\u0E49\u0E0A\u0E48\u0E27\u0E22 AI \u0E2D\u0E31\u0E08\u0E09\u0E23\u0E34\u0E22\u0E30\u0E1B\u0E23\u0E30\u0E08\u0E33\u0E2A\u0E15\u0E39\u0E14\u0E34\u0E42\u0E2D "\u0E04\u0E21\u0E04\u0E34\u0E14 by KOMKRIT" (\u0E2A\u0E42\u0E25\u0E41\u0E01\u0E19: \u0E04\u0E34\u0E14\u0E15\u0E48\u0E32\u0E07\u0E2D\u0E22\u0E48\u0E32\u0E07\u0E2A\u0E23\u0E49\u0E32\u0E07\u0E2A\u0E23\u0E23\u0E04\u0E4C \u0E40\u0E1E\u0E37\u0E48\u0E2D\u0E01\u0E32\u0E23\u0E28\u0E36\u0E01\u0E29\u0E32 \u0E40\u0E1E\u0E37\u0E48\u0E2D\u0E2A\u0E31\u0E07\u0E04\u0E21 \u0E40\u0E1E\u0E37\u0E48\u0E2D\u0E2D\u0E19\u0E32\u0E04\u0E15\u0E17\u0E35\u0E48\u0E14\u0E35\u0E01\u0E27\u0E48\u0E32) \u0E0A\u0E48\u0E27\u0E22\u0E27\u0E34\u0E40\u0E04\u0E23\u0E32\u0E30\u0E2B\u0E4C \u0E27\u0E34\u0E08\u0E31\u0E22 \u0E23\u0E48\u0E32\u0E07\u0E1A\u0E17\u0E04\u0E27\u0E32\u0E21 \u0E2A\u0E04\u0E23\u0E34\u0E1B\u0E15\u0E4C\u0E27\u0E34\u0E14\u0E35\u0E42\u0E2D \u0E41\u0E25\u0E30\u0E27\u0E32\u0E07\u0E01\u0E25\u0E22\u0E38\u0E17\u0E18\u0E4C\u0E2D\u0E22\u0E48\u0E32\u0E07\u0E40\u0E09\u0E35\u0E22\u0E1A\u0E04\u0E21 \u0E41\u0E21\u0E48\u0E19\u0E22\u0E33 \u0E41\u0E25\u0E30\u0E19\u0E33\u0E44\u0E1B\u0E43\u0E0A\u0E49\u0E07\u0E32\u0E19\u0E44\u0E14\u0E49\u0E08\u0E23\u0E34\u0E07';
  if (params.useKnowledgeBase !== false) {
    const kb = getActiveKnowledgeContext(userMsg);
    if (kb.length > 0) {
      const kbStr = kb.map((k, idx) => `[KB-${idx + 1}] ${k.title}: ${k.summary} \u2014 ${k.content}`).join("\n");
      systemInstruction += `

\u0E10\u0E32\u0E19\u0E04\u0E27\u0E32\u0E21\u0E23\u0E39\u0E49\u0E02\u0E2D\u0E07\u0E2D\u0E07\u0E04\u0E4C\u0E01\u0E23 (Knowledge Base):
${kbStr}`;
    }
  }
  const messages = [
    ...historyRows.map((h) => ({ role: h.role, content: h.content })),
    { role: "user", content: userMsg }
  ];
  const llmRes = await callRealLlm({
    provider: params.provider,
    model: params.model,
    systemInstruction,
    messages,
    temperature: 0.65
  });
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const ins = db.prepare(
    `INSERT INTO ai_chat_messages (
      session_id, provider, model, role, content, reasoning, latency_ms, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );
  ins.run(params.sessionId, llmRes.provider, llmRes.model, "user", userMsg, "", 0, now);
  const assistantRow = ins.run(
    params.sessionId,
    llmRes.provider,
    llmRes.model,
    "assistant",
    llmRes.text,
    llmRes.reasoning || "",
    llmRes.latencyMs,
    now
  );
  return {
    id: Number(assistantRow.lastInsertRowid),
    sessionId: params.sessionId,
    provider: llmRes.provider,
    model: llmRes.model,
    engineLabel: llmRes.engineLabel,
    reply: llmRes.text,
    reasoning: llmRes.reasoning || "",
    latencyMs: llmRes.latencyMs,
    createdAt: now
  };
}
async function generateFlowStoryboardWithLlm(params) {
  const count = Math.min(5, Math.max(2, Number(params.sceneCount) || 3));
  const kb = getActiveKnowledgeContext(`${params.title} ${params.concept}`);
  const kbText = kb.map((k) => `- ${k.title}: ${k.summary}`).join("\n");
  const systemInstruction = `\u0E04\u0E38\u0E13\u0E04\u0E37\u0E2D AI Film Director \u0E2A\u0E33\u0E2B\u0E23\u0E31\u0E1A\u0E23\u0E30\u0E1A\u0E1A Google Flow & Google Veo Filmmaking Studio \u0E02\u0E2D\u0E07 "\u0E04\u0E21\u0E04\u0E34\u0E14 by KOMKRIT"
\u0E08\u0E07\u0E2D\u0E2D\u0E01\u0E41\u0E1A\u0E1A Storyboard \u0E20\u0E32\u0E1E\u0E22\u0E19\u0E15\u0E23\u0E4C\u0E2A\u0E31\u0E49\u0E19\u0E08\u0E33\u0E19\u0E27\u0E19 ${count} \u0E09\u0E32\u0E01 (Scenes) \u0E17\u0E35\u0E48\u0E21\u0E35\u0E04\u0E27\u0E32\u0E21\u0E15\u0E48\u0E2D\u0E40\u0E19\u0E37\u0E48\u0E2D\u0E07\u0E01\u0E31\u0E19\u0E17\u0E31\u0E49\u0E07\u0E15\u0E31\u0E27\u0E25\u0E30\u0E04\u0E23 \u0E41\u0E2A\u0E07 \u0E2A\u0E35 \u0E41\u0E25\u0E30\u0E21\u0E38\u0E21\u0E01\u0E25\u0E49\u0E2D\u0E07
\u0E42\u0E14\u0E22\u0E41\u0E15\u0E48\u0E25\u0E30\u0E09\u0E32\u0E01\u0E15\u0E49\u0E2D\u0E07\u0E21\u0E35:
- firstFramePrompt (\u0E20\u0E32\u0E29\u0E32\u0E2D\u0E31\u0E07\u0E01\u0E24\u0E29 \u0E25\u0E30\u0E40\u0E2D\u0E35\u0E22\u0E14\u0E23\u0E30\u0E14\u0E31\u0E1A\u0E20\u0E32\u0E1E\u0E16\u0E48\u0E32\u0E22\u0E20\u0E32\u0E1E\u0E22\u0E19\u0E15\u0E23\u0E4C \u0E2A\u0E33\u0E2B\u0E23\u0E31\u0E1A\u0E2A\u0E23\u0E49\u0E32\u0E07\u0E20\u0E32\u0E1E Keyframe \u0E15\u0E49\u0E19\u0E09\u0E32\u0E01\u0E14\u0E49\u0E27\u0E22\u0E42\u0E21\u0E40\u0E14\u0E25 Google Gemini Image \u0E25\u0E48\u0E32\u0E2A\u0E38\u0E14)
- lastFramePrompt (\u0E20\u0E32\u0E29\u0E32\u0E2D\u0E31\u0E07\u0E01\u0E24\u0E29 \u0E2A\u0E33\u0E2B\u0E23\u0E31\u0E1A\u0E20\u0E32\u0E1E\u0E17\u0E49\u0E32\u0E22\u0E09\u0E32\u0E01\u0E40\u0E1E\u0E37\u0E48\u0E2D\u0E43\u0E2B\u0E49\u0E40\u0E01\u0E34\u0E14 Smooth Transition \u0E2B\u0E32\u0E01\u0E15\u0E49\u0E2D\u0E07\u0E01\u0E32\u0E23)
- videoMotionPrompt (\u0E20\u0E32\u0E29\u0E32\u0E2D\u0E31\u0E07\u0E01\u0E24\u0E29 \u0E23\u0E30\u0E1A\u0E38\u0E01\u0E32\u0E23\u0E40\u0E04\u0E25\u0E37\u0E48\u0E2D\u0E19\u0E01\u0E25\u0E49\u0E2D\u0E07 \u0E01\u0E32\u0E23\u0E02\u0E22\u0E31\u0E1A\u0E02\u0E2D\u0E07\u0E15\u0E31\u0E27\u0E41\u0E1A\u0E1A \u0E41\u0E2A\u0E07 \u0E41\u0E25\u0E30\u0E40\u0E2A\u0E35\u0E22\u0E07\u0E1A\u0E23\u0E23\u0E22\u0E32\u0E01\u0E32\u0E28 \u0E2A\u0E33\u0E2B\u0E23\u0E31\u0E1A\u0E2A\u0E48\u0E07\u0E40\u0E02\u0E49\u0E32 Google Veo / Google Flow Video)
- narrationThai (\u0E1A\u0E17\u0E1E\u0E32\u0E01\u0E22\u0E4C\u0E20\u0E32\u0E29\u0E32\u0E44\u0E17\u0E22\u0E2A\u0E33\u0E2B\u0E23\u0E31\u0E1A\u0E42\u0E21\u0E40\u0E14\u0E25 Google Gemini TTS \u0E25\u0E48\u0E32\u0E2A\u0E38\u0E14 \u0E04\u0E27\u0E32\u0E21\u0E22\u0E32\u0E27\u0E01\u0E23\u0E30\u0E0A\u0E31\u0E1A\u0E1E\u0E2D\u0E14\u0E35\u0E01\u0E31\u0E1A\u0E40\u0E27\u0E25\u0E32\u0E09\u0E32\u0E01)
\u0E15\u0E2D\u0E1A\u0E01\u0E25\u0E31\u0E1A\u0E40\u0E1B\u0E47\u0E19 JSON \u0E40\u0E17\u0E48\u0E32\u0E19\u0E31\u0E49\u0E19 \u0E2B\u0E49\u0E32\u0E21\u0E21\u0E35\u0E02\u0E49\u0E2D\u0E04\u0E27\u0E32\u0E21\u0E2D\u0E37\u0E48\u0E19\u0E19\u0E2D\u0E01 JSON`;
  const userPrompt = `\u0E0A\u0E37\u0E48\u0E2D\u0E42\u0E1B\u0E23\u0E40\u0E08\u0E01\u0E15\u0E4C\u0E27\u0E34\u0E14\u0E35\u0E42\u0E2D: ${params.title}
\u0E41\u0E19\u0E27\u0E04\u0E34\u0E14 / \u0E40\u0E19\u0E37\u0E49\u0E2D\u0E2B\u0E32\u0E2B\u0E25\u0E31\u0E01: ${params.concept}
\u0E2A\u0E31\u0E14\u0E2A\u0E48\u0E27\u0E19\u0E20\u0E32\u0E1E: ${params.aspectRatio || "16:9"}
\u0E08\u0E33\u0E19\u0E27\u0E19\u0E09\u0E32\u0E01: ${count} \u0E09\u0E32\u0E01
\u0E1A\u0E23\u0E34\u0E1A\u0E17\u0E41\u0E1A\u0E23\u0E19\u0E14\u0E4C \u0E04\u0E21\u0E04\u0E34\u0E14 by KOMKRIT:
${kbText}

\u0E15\u0E2D\u0E1A\u0E40\u0E1B\u0E47\u0E19 JSON \u0E23\u0E39\u0E1B\u0E41\u0E1A\u0E1A\u0E19\u0E35\u0E49\u0E40\u0E17\u0E48\u0E32\u0E19\u0E31\u0E49\u0E19:
{
  "scenes": [
    {
      "id": "scene-1",
      "sceneNumber": 1,
      "title": "\u0E0A\u0E37\u0E48\u0E2D\u0E09\u0E32\u0E01\u0E20\u0E32\u0E29\u0E32\u0E44\u0E17\u0E22",
      "durationSec": 6,
      "firstFramePrompt": "Detailed cinematic English image prompt for start frame...",
      "lastFramePrompt": "Detailed cinematic English image prompt for end frame...",
      "videoMotionPrompt": "Detailed English Veo/Flow camera & motion prompt with ambient sound...",
      "narrationThai": "\u0E1A\u0E17\u0E1E\u0E32\u0E01\u0E22\u0E4C\u0E40\u0E2A\u0E35\u0E22\u0E07\u0E20\u0E32\u0E29\u0E32\u0E44\u0E17\u0E22\u0E02\u0E2D\u0E07\u0E09\u0E32\u0E01\u0E19\u0E35\u0E49"
    }
  ]
}`;
  const res = await callRealLlm({
    provider: params.provider,
    model: params.model,
    systemInstruction,
    messages: [{ role: "user", content: userPrompt }],
    temperature: 0.65,
    jsonMode: true
  });
  const parsed = extractStrictJson(res.text);
  const rawScenes = Array.isArray(parsed?.scenes) ? parsed.scenes : [];
  if (rawScenes.length === 0) {
    throw new Error("AI Director \u0E44\u0E21\u0E48\u0E44\u0E14\u0E49\u0E2A\u0E23\u0E49\u0E32\u0E07\u0E23\u0E32\u0E22\u0E01\u0E32\u0E23\u0E09\u0E32\u0E01\u0E01\u0E25\u0E31\u0E1A\u0E21\u0E32 \u0E01\u0E23\u0E38\u0E13\u0E32\u0E25\u0E2D\u0E07\u0E43\u0E2B\u0E21\u0E48\u0E2D\u0E35\u0E01\u0E04\u0E23\u0E31\u0E49\u0E07");
  }
  const scenes = rawScenes.map((s, idx) => ({
    id: `scene-${idx + 1}-${Date.now()}`,
    sceneNumber: idx + 1,
    title: String(s.title || `\u0E09\u0E32\u0E01\u0E17\u0E35\u0E48 ${idx + 1}`),
    durationSec: Math.min(10, Math.max(4, Number(s.durationSec) || 6)),
    firstFramePrompt: String(s.firstFramePrompt || ""),
    lastFramePrompt: String(s.lastFramePrompt || ""),
    videoMotionPrompt: String(s.videoMotionPrompt || ""),
    narrationThai: String(s.narrationThai || ""),
    firstFrameUrl: "",
    lastFrameUrl: "",
    videoClipUrl: "",
    interactionId: ""
  }));
  return {
    engineLabel: res.engineLabel,
    scenes
  };
}
async function executeMultiAgentWorkflow(input) {
  const kbItems = getActiveKnowledgeContext(input.topic);
  const kbContextString = kbItems.map(
    (k, i) => `[KB-${i + 1}] ${k.title}: ${k.summary} \u2014 ${k.content} (\u0E41\u0E2B\u0E25\u0E48\u0E07\u0E2D\u0E49\u0E32\u0E07\u0E2D\u0E34\u0E07: ${k.source_ref})`
  ).join("\n");
  const categoryNames = {
    education: "\u0E01\u0E32\u0E23\u0E28\u0E36\u0E01\u0E29\u0E32",
    innovation: "\u0E19\u0E27\u0E31\u0E15\u0E01\u0E23\u0E23\u0E21",
    society: "\u0E2A\u0E31\u0E07\u0E04\u0E21",
    international: "\u0E15\u0E48\u0E32\u0E07\u0E1B\u0E23\u0E30\u0E40\u0E17\u0E28",
    career: "\u0E2D\u0E32\u0E0A\u0E35\u0E1E & \u0E01\u0E32\u0E23\u0E1E\u0E31\u0E12\u0E19\u0E32",
    "ai-tech": "AI & \u0E40\u0E17\u0E04\u0E42\u0E19\u0E42\u0E25\u0E22\u0E35",
    special: "\u0E1A\u0E17\u0E04\u0E27\u0E32\u0E21\u0E1E\u0E34\u0E40\u0E28\u0E29"
  };
  const catLabel = categoryNames[input.category] || "\u0E01\u0E32\u0E23\u0E28\u0E36\u0E01\u0E29\u0E32";
  const systemPrompt = `\u0E04\u0E38\u0E13\u0E04\u0E37\u0E2D\u0E23\u0E30\u0E1A\u0E1A Multi-Agent AI Content Creation Ecosystem \u0E02\u0E2D\u0E07 "\u0E04\u0E21\u0E04\u0E34\u0E14 by KOMKRIT" (\u0E2A\u0E42\u0E25\u0E41\u0E01\u0E19: "\u0E04\u0E34\u0E14\u0E15\u0E48\u0E32\u0E07\u0E2D\u0E22\u0E48\u0E32\u0E07\u0E2A\u0E23\u0E49\u0E32\u0E07\u0E2A\u0E23\u0E23\u0E04\u0E4C \u0E40\u0E1E\u0E37\u0E48\u0E2D\u0E01\u0E32\u0E23\u0E28\u0E36\u0E01\u0E29\u0E32 \u0E40\u0E1E\u0E37\u0E48\u0E2D\u0E2A\u0E31\u0E07\u0E04\u0E21 \u0E40\u0E1E\u0E37\u0E48\u0E2D\u0E2D\u0E19\u0E32\u0E04\u0E15\u0E17\u0E35\u0E48\u0E14\u0E35\u0E01\u0E27\u0E48\u0E32")
\u0E1B\u0E23\u0E30\u0E21\u0E27\u0E25\u0E1C\u0E25\u0E01\u0E32\u0E23\u0E17\u0E33\u0E07\u0E32\u0E19\u0E08\u0E23\u0E34\u0E07\u0E02\u0E2D\u0E07\u0E17\u0E35\u0E21 AI Agents \u0E17\u0E31\u0E49\u0E07\u0E2B\u0E21\u0E14 (CEO Agent, 01 Research Agent, 02 Idea & Script Agent, 03 Content Design Agent, 04 Visual Creator Agent, 05 Video Production Agent \u0E2A\u0E33\u0E2B\u0E23\u0E31\u0E1A Google Veo & Flow, 06 Audio Production Agent \u0E2A\u0E33\u0E2B\u0E23\u0E31\u0E1A AI Speech TTS, 07 QA Agent 4 \u0E21\u0E34\u0E15\u0E34 \u0E41\u0E25\u0E30 08 Analytics & Omnichannel 8 \u0E0A\u0E48\u0E2D\u0E07\u0E17\u0E32\u0E07)
\u0E42\u0E14\u0E22\u0E22\u0E36\u0E14\u0E02\u0E49\u0E2D\u0E21\u0E39\u0E25\u0E08\u0E32\u0E01\u0E10\u0E32\u0E19\u0E04\u0E27\u0E32\u0E21\u0E23\u0E39\u0E49 (Knowledge Base) \u0E14\u0E49\u0E32\u0E19\u0E25\u0E48\u0E32\u0E07\u0E2D\u0E22\u0E48\u0E32\u0E07\u0E40\u0E04\u0E23\u0E48\u0E07\u0E04\u0E23\u0E31\u0E14 \u0E40\u0E19\u0E37\u0E49\u0E2D\u0E2B\u0E32\u0E1A\u0E17\u0E04\u0E27\u0E32\u0E21 (fullArticleMarkdown) \u0E15\u0E49\u0E2D\u0E07\u0E40\u0E02\u0E35\u0E22\u0E19\u0E09\u0E1A\u0E31\u0E1A\u0E40\u0E15\u0E47\u0E21\u0E2D\u0E22\u0E48\u0E32\u0E07\u0E25\u0E30\u0E40\u0E2D\u0E35\u0E22\u0E14 \u0E25\u0E36\u0E01\u0E0B\u0E36\u0E49\u0E07 \u0E43\u0E0A\u0E49 Markdown \u0E2B\u0E31\u0E27\u0E02\u0E49\u0E2D ## \u0E41\u0E25\u0E30 ### \u0E1E\u0E23\u0E49\u0E2D\u0E21\u0E02\u0E49\u0E2D\u0E40\u0E2A\u0E19\u0E2D\u0E40\u0E0A\u0E34\u0E07\u0E1B\u0E0F\u0E34\u0E1A\u0E31\u0E15\u0E34\u0E08\u0E23\u0E34\u0E07
\u0E15\u0E2D\u0E1A\u0E01\u0E25\u0E31\u0E1A\u0E40\u0E1B\u0E47\u0E19 JSON Object \u0E17\u0E35\u0E48\u0E16\u0E39\u0E01\u0E15\u0E49\u0E2D\u0E07\u0E15\u0E32\u0E21\u0E42\u0E04\u0E23\u0E07\u0E2A\u0E23\u0E49\u0E32\u0E07\u0E17\u0E35\u0E48\u0E23\u0E30\u0E1A\u0E38\u0E40\u0E17\u0E48\u0E32\u0E19\u0E31\u0E49\u0E19 \u0E2B\u0E49\u0E32\u0E21\u0E04\u0E23\u0E2D\u0E1A\u0E02\u0E49\u0E2D\u0E04\u0E27\u0E32\u0E21\u0E2D\u0E18\u0E34\u0E1A\u0E32\u0E22\u0E2D\u0E37\u0E48\u0E19`;
  const userPrompt = `\u0E2B\u0E31\u0E27\u0E02\u0E49\u0E2D\u0E42\u0E08\u0E17\u0E22\u0E4C (Topic): ${input.topic}
\u0E41\u0E2B\u0E25\u0E48\u0E07\u0E17\u0E35\u0E48\u0E21\u0E32\u0E44\u0E2D\u0E40\u0E14\u0E35\u0E22 (Input Source): ${input.inputSource}
\u0E2B\u0E21\u0E27\u0E14\u0E2B\u0E21\u0E39\u0E48: ${catLabel}
\u0E01\u0E25\u0E38\u0E48\u0E21\u0E1C\u0E39\u0E49\u0E40\u0E23\u0E35\u0E22\u0E19/\u0E40\u0E1B\u0E49\u0E32\u0E2B\u0E21\u0E32\u0E22: ${input.targetAudience}
\u0E40\u0E2A\u0E32\u0E2B\u0E25\u0E31\u0E01\u0E18\u0E38\u0E23\u0E01\u0E34\u0E08 (KOMKID 5-Pillar): ${input.businessPillar}
\u0E42\u0E2B\u0E21\u0E14\u0E01\u0E32\u0E23\u0E17\u0E33\u0E07\u0E32\u0E19: ${input.flowMode}
${input.revisionNote ? `\u0E04\u0E33\u0E2A\u0E31\u0E48\u0E07\u0E41\u0E01\u0E49\u0E44\u0E02\u0E40\u0E1E\u0E34\u0E48\u0E21\u0E40\u0E15\u0E34\u0E21\u0E08\u0E32\u0E01\u0E1C\u0E39\u0E49\u0E1A\u0E23\u0E34\u0E2B\u0E32\u0E23 (Human Approval Revision Note): ${input.revisionNote}` : ""}

\u0E10\u0E32\u0E19\u0E04\u0E27\u0E32\u0E21\u0E23\u0E39\u0E49 (Knowledge Base):
${kbContextString}

\u0E08\u0E07\u0E2A\u0E48\u0E07\u0E04\u0E37\u0E19 JSON Object \u0E17\u0E35\u0E48\u0E21\u0E35\u0E42\u0E04\u0E23\u0E07\u0E2A\u0E23\u0E49\u0E32\u0E07\u0E41\u0E25\u0E30\u0E0A\u0E19\u0E34\u0E14\u0E02\u0E49\u0E2D\u0E21\u0E39\u0E25\u0E04\u0E23\u0E1A\u0E17\u0E38\u0E01\u0E1F\u0E34\u0E25\u0E14\u0E4C\u0E14\u0E31\u0E07\u0E19\u0E35\u0E49:
{
  "ceoOutput": {
    "goal": "string",
    "strategy": "string",
    "keyMessage": "string",
    "kpiTargets": ["string"],
    "agentAssignments": [{ "agent": "string", "mission": "string" }]
  },
  "researchOutput": {
    "deepInsights": ["string"],
    "keyFacts": ["string"],
    "trendAnalysis": "string",
    "references": ["string"],
    "kbSourcesUsed": ["string"]
  },
  "scriptOutput": {
    "titleSuggestions": ["string", "string", "string"],
    "selectedTitle": "string",
    "subtitle": "string",
    "excerpt": "string",
    "learningObjectives": ["string"],
    "fullArticleMarkdown": "Markdown \u0E1A\u0E17\u0E04\u0E27\u0E32\u0E21\u0E09\u0E1A\u0E31\u0E1A\u0E40\u0E15\u0E47\u0E21\u0E04\u0E27\u0E32\u0E21\u0E22\u0E32\u0E27\u0E2D\u0E22\u0E48\u0E32\u0E07\u0E19\u0E49\u0E2D\u0E22 4-6 \u0E2B\u0E31\u0E27\u0E02\u0E49\u0E2D\u0E22\u0E48\u0E2D\u0E22",
    "videoScript": "\u0E2A\u0E04\u0E23\u0E34\u0E1B\u0E15\u0E4C\u0E27\u0E34\u0E14\u0E35\u0E42\u0E2D\u0E04\u0E27\u0E32\u0E21\u0E22\u0E32\u0E27 60 \u0E27\u0E34\u0E19\u0E32\u0E17\u0E35 \u0E41\u0E1A\u0E48\u0E07\u0E0A\u0E48\u0E27\u0E07\u0E40\u0E27\u0E25\u0E32\u0E0A\u0E31\u0E14\u0E40\u0E08\u0E19",
    "socialHook": "string"
  },
  "designOutput": {
    "contentStructure": ["string"],
    "brandTone": "string",
    "mindMapNodes": {
      "center": "string",
      "branches": [{ "title": "string", "items": ["string", "string"] }]
    },
    "slideDeckOutline": [{ "slide": 1, "title": "string", "bullet": "string" }],
    "instructionalDesign": "string"
  },
  "visualOutput": {
    "imagePrompts": [
      { "platform": "Google Gemini Image (Auto-Latest)", "prompt": "Detailed English visual prompt..." },
      { "platform": "OpenAI Image (Auto-Latest)", "prompt": "Detailed English infographic/editorial prompt..." }
    ],
    "infographicHeadline": "string",
    "infographicSubpoints": ["string", "string", "string", "string"],
    "generatedSvgDataUrl": "",
    "recommendedTools": ["Google Gemini Image (Auto-Latest)", "OpenAI Image (Auto-Latest)"]
  },
  "videoOutput": {
    "duration": "string",
    "avatarStyle": "string",
    "scenes": [
      { "time": "00:00 - 00:10", "visual": "English/Thai Veo scene prompt", "dialogue": "string", "subtitle": "string", "bRoll": "string" }
    ],
    "recommendedTools": ["Google Flow", "Google Veo (Auto-Latest)", "Google Gemini Video (Auto-Latest)"]
  },
  "audioOutput": {
    "voiceTone": "string",
    "narrationScriptWithCues": "\u0E1A\u0E17\u0E1E\u0E32\u0E01\u0E22\u0E4C\u0E20\u0E32\u0E29\u0E32\u0E44\u0E17\u0E22\u0E1E\u0E23\u0E49\u0E2D\u0E21\u0E1C\u0E25\u0E34\u0E15\u0E40\u0E2A\u0E35\u0E22\u0E07\u0E14\u0E49\u0E27\u0E22 AI Speech TTS",
    "bgmStyle": "string",
    "soundEffects": ["string"],
    "recommendedTools": ["Google Gemini TTS (Auto-Latest)", "ElevenLabs (Auto-Latest)", "OpenAI TTS (Auto-Latest)"]
  },
  "qaOutput": {
    "factCheckScore": 95,
    "factCheckNote": "string",
    "languageScore": 96,
    "languageNote": "string",
    "brandScore": 97,
    "brandNote": "string",
    "riskScore": 98,
    "riskNote": "string",
    "overallScore": 96,
    "verdict": "\u0E1C\u0E48\u0E32\u0E19",
    "improvements": ["string"]
  },
  "analyticsOutput": {
    "predictedReach": "string",
    "predictedEngagement": "string",
    "targetLearnerFit": "string",
    "abHeadlines": ["string", "string"],
    "optimizationTips": ["string"]
  },
  "omnichannelOutput": {
    "youtube": { "title": "string", "description": "string", "tags": ["string"] },
    "facebook": { "post": "string", "engagementQuestion": "string" },
    "tiktok": { "hook": "string", "caption": "string", "hashtags": ["string"] },
    "lineOa": { "headline": "string", "broadcastMessage": "string" },
    "xTwitter": { "thread": ["string", "string"] },
    "instagram": { "carouselSlides": ["string"], "caption": "string" },
    "websiteBlog": { "slug": "string", "seoMeta": "string" },
    "emailNewsletter": { "subject": "string", "previewText": "string", "bodyIntro": "string" },
    "publishedChannels": []
  }
}`;
  const llmResult = await callRealLlm({
    provider: input.provider,
    model: input.model,
    systemInstruction: systemPrompt,
    messages: [{ role: "user", content: userPrompt }],
    temperature: 0.6,
    jsonMode: true
  });
  const parsed = extractStrictJson(llmResult.text);
  let generatedImageUrl = "";
  if (input.autoGenerateCoverImage) {
    const firstPrompt = parsed?.visualOutput?.imagePrompts?.[0]?.prompt || `Editorial educational photography for "${input.topic}", modern Thai learning environment, deep navy blue and warm golden lighting, high resolution`;
    const imgAsset = await generateRealImage({
      prompt: firstPrompt,
      aspectRatio: "16:9"
    });
    generatedImageUrl = imgAsset.fileUrl;
  }
  const visualOut = {
    imagePrompts: Array.isArray(parsed.visualOutput?.imagePrompts) ? parsed.visualOutput.imagePrompts : [],
    infographicHeadline: parsed.visualOutput?.infographicHeadline || input.topic,
    infographicSubpoints: Array.isArray(parsed.visualOutput?.infographicSubpoints) ? parsed.visualOutput.infographicSubpoints : [],
    generatedSvgDataUrl: generatedImageUrl,
    generatedRealImageUrl: generatedImageUrl,
    recommendedTools: parsed.visualOutput?.recommendedTools || [
      "Google Gemini Image (Auto-Latest)",
      "OpenAI Image (Auto-Latest)"
    ]
  };
  return {
    engineUsed: `${llmResult.engineLabel} \u2022 ${llmResult.latencyMs}ms`,
    ceoOutput: parsed.ceoOutput || {},
    researchOutput: parsed.researchOutput || {},
    scriptOutput: parsed.scriptOutput || {},
    designOutput: parsed.designOutput || {},
    visualOutput: visualOut,
    videoOutput: parsed.videoOutput || {},
    audioOutput: parsed.audioOutput || {},
    qaOutput: parsed.qaOutput || {},
    analyticsOutput: parsed.analyticsOutput || {},
    omnichannelOutput: {
      ...parsed.omnichannelOutput || {},
      publishedChannels: []
    }
  };
}
async function assistPostContent(params) {
  const categoryNames = {
    education: "\u0E01\u0E32\u0E23\u0E28\u0E36\u0E01\u0E29\u0E32",
    innovation: "\u0E19\u0E27\u0E31\u0E15\u0E01\u0E23\u0E23\u0E21",
    society: "\u0E2A\u0E31\u0E07\u0E04\u0E21",
    international: "\u0E15\u0E48\u0E32\u0E07\u0E1B\u0E23\u0E30\u0E40\u0E17\u0E28",
    career: "\u0E2D\u0E32\u0E0A\u0E35\u0E1E & \u0E01\u0E32\u0E23\u0E1E\u0E31\u0E12\u0E19\u0E32",
    "ai-tech": "AI & \u0E01\u0E32\u0E23\u0E28\u0E36\u0E01\u0E29\u0E32",
    special: "\u0E1A\u0E17\u0E04\u0E27\u0E32\u0E21\u0E1E\u0E34\u0E40\u0E28\u0E29"
  };
  const catLabel = categoryNames[params.category] || "\u0E01\u0E32\u0E23\u0E28\u0E36\u0E01\u0E29\u0E32";
  if (params.mode === "generate_real_image") {
    const prompt = `Editorial high-resolution cover photography illustrating "${params.title || "Modern Thai Education & AI Innovation"}" in category ${catLabel}, warm inspiring atmosphere, deep navy blue and golden amber visual accents, clean composition, 16:9`;
    const asset = await generateRealImage({
      prompt,
      aspectRatio: "16:9"
    });
    return {
      coverImage: asset.fileUrl,
      engineUsed: `${asset.provider} (${asset.model})`
    };
  }
  if (params.mode === "polish" && params.currentContent?.trim()) {
    const res = await callRealLlm({
      provider: params.provider,
      model: params.model,
      systemInstruction: '\u0E04\u0E38\u0E13\u0E04\u0E37\u0E2D\u0E1A\u0E23\u0E23\u0E13\u0E32\u0E18\u0E34\u0E01\u0E32\u0E23\u0E1A\u0E23\u0E34\u0E2B\u0E32\u0E23\u0E02\u0E2D\u0E07 "\u0E04\u0E21\u0E04\u0E34\u0E14 by KOMKRIT" \u0E08\u0E07\u0E40\u0E01\u0E25\u0E32\u0E41\u0E25\u0E30\u0E22\u0E01\u0E23\u0E30\u0E14\u0E31\u0E1A\u0E1A\u0E17\u0E04\u0E27\u0E32\u0E21\u0E20\u0E32\u0E29\u0E32\u0E44\u0E17\u0E22\u0E43\u0E2B\u0E49\u0E2A\u0E25\u0E30\u0E2A\u0E25\u0E27\u0E22 \u0E25\u0E36\u0E01\u0E0B\u0E36\u0E49\u0E07 \u0E19\u0E48\u0E32\u0E2D\u0E48\u0E32\u0E19 \u0E21\u0E35\u0E42\u0E04\u0E23\u0E07\u0E2A\u0E23\u0E49\u0E32\u0E07 Markdown \u0E17\u0E35\u0E48\u0E0A\u0E31\u0E14\u0E40\u0E08\u0E19 \u0E15\u0E2D\u0E1A\u0E40\u0E1B\u0E47\u0E19 JSON \u0E40\u0E17\u0E48\u0E32\u0E19\u0E31\u0E49\u0E19: {"subtitle":"...","excerpt":"...","content":"...","tags":["..."]}',
      messages: [
        {
          role: "user",
          content: `\u0E2B\u0E31\u0E27\u0E02\u0E49\u0E2D: ${params.title}
\u0E2B\u0E21\u0E27\u0E14\u0E2B\u0E21\u0E39\u0E48: ${catLabel}
\u0E40\u0E19\u0E37\u0E49\u0E2D\u0E2B\u0E32\u0E40\u0E14\u0E34\u0E21:
${params.currentContent}`
        }
      ],
      temperature: 0.5,
      jsonMode: true
    });
    const parsed = extractStrictJson(res.text);
    return {
      subtitle: parsed.subtitle || "",
      excerpt: parsed.excerpt || "",
      content: parsed.content || params.currentContent,
      tags: Array.isArray(parsed.tags) ? parsed.tags : [catLabel, "\u0E04\u0E21\u0E04\u0E34\u0E14 by KOMKRIT"],
      engineUsed: res.engineLabel
    };
  }
  const wf = await executeMultiAgentWorkflow({
    topic: params.title || "\u0E41\u0E19\u0E27\u0E17\u0E32\u0E07\u0E01\u0E32\u0E23\u0E1E\u0E31\u0E12\u0E19\u0E32\u0E01\u0E32\u0E23\u0E28\u0E36\u0E01\u0E29\u0E32\u0E22\u0E38\u0E04\u0E43\u0E2B\u0E21\u0E48",
    inputSource: "\u0E44\u0E2D\u0E40\u0E14\u0E35\u0E22\u0E08\u0E32\u0E01 Komkrit",
    category: params.category || "education",
    targetAudience: "\u0E1C\u0E39\u0E49\u0E2A\u0E19\u0E43\u0E08\u0E17\u0E31\u0E48\u0E27\u0E44\u0E1B\u0E41\u0E25\u0E30\u0E1A\u0E38\u0E04\u0E25\u0E32\u0E01\u0E23\u0E17\u0E32\u0E07\u0E01\u0E32\u0E23\u0E28\u0E36\u0E01\u0E29\u0E32",
    businessPillar: "1. VIEWS | \u0E22\u0E2D\u0E14\u0E27\u0E34\u0E27",
    flowMode: "core_3agent",
    provider: params.provider,
    model: params.model
  });
  return {
    subtitle: wf.scriptOutput.subtitle || "",
    excerpt: wf.scriptOutput.excerpt || "",
    content: wf.scriptOutput.fullArticleMarkdown || "",
    tags: [catLabel, "\u0E04\u0E21\u0E04\u0E34\u0E14 by KOMKRIT", "\u0E04\u0E34\u0E14\u0E15\u0E48\u0E32\u0E07\u0E2D\u0E22\u0E48\u0E32\u0E07\u0E2A\u0E23\u0E49\u0E32\u0E07\u0E2A\u0E23\u0E23\u0E04\u0E4C"],
    engineUsed: wf.engineUsed
  };
}
async function evaluateAndBuildMediaPrompt(params) {
  let conversationContext = "";
  if (params.sessionId) {
    const rows = db.prepare(
      "SELECT role, content FROM ai_chat_messages WHERE session_id = ? ORDER BY id DESC LIMIT 14"
    ).all(params.sessionId);
    if (rows.length > 0) {
      conversationContext = rows.reverse().map((r) => `${r.role === "user" ? "\u0E1C\u0E39\u0E49\u0E14\u0E39\u0E41\u0E25" : "AI"}: ${r.content}`).join("\n");
    }
  }
  const idea = (params.ideaText || "").trim();
  if (!conversationContext && !idea) {
    throw new Error("\u0E01\u0E23\u0E38\u0E13\u0E32\u0E1E\u0E34\u0E21\u0E1E\u0E4C\u0E1A\u0E2D\u0E01\u0E2A\u0E34\u0E48\u0E07\u0E17\u0E35\u0E48\u0E15\u0E49\u0E2D\u0E07\u0E01\u0E32\u0E23\u0E2A\u0E23\u0E49\u0E32\u0E07 \u0E2B\u0E23\u0E37\u0E2D\u0E04\u0E38\u0E22\u0E01\u0E31\u0E1A AI \u0E01\u0E48\u0E2D\u0E19\u0E43\u0E2B\u0E49\u0E1B\u0E23\u0E30\u0E40\u0E21\u0E34\u0E19 Prompt \u0E04\u0E23\u0E31\u0E1A");
  }
  const isVideo = params.target === "video";
  const defaultAspect = params.aspectRatio || "16:9";
  const systemInstruction = isVideo ? `\u0E04\u0E38\u0E13\u0E04\u0E37\u0E2D Creative Video Director & Prompt Engineer \u0E1B\u0E23\u0E30\u0E08\u0E33\u0E2A\u0E15\u0E39\u0E14\u0E34\u0E42\u0E2D "\u0E04\u0E21\u0E04\u0E34\u0E14 by KOMKRIT"
\u0E2B\u0E19\u0E49\u0E32\u0E17\u0E35\u0E48\u0E02\u0E2D\u0E07\u0E04\u0E38\u0E13\u0E04\u0E37\u0E2D:
1) \u0E1B\u0E23\u0E30\u0E40\u0E21\u0E34\u0E19\u0E04\u0E27\u0E32\u0E21\u0E15\u0E49\u0E2D\u0E07\u0E01\u0E32\u0E23\u0E02\u0E2D\u0E07\u0E1C\u0E39\u0E49\u0E43\u0E0A\u0E49\u0E08\u0E32\u0E01\u0E1A\u0E17\u0E2A\u0E19\u0E17\u0E19\u0E32\u0E2B\u0E23\u0E37\u0E2D\u0E44\u0E2D\u0E40\u0E14\u0E35\u0E22\u0E17\u0E35\u0E48\u0E43\u0E2B\u0E49\u0E21\u0E32 \u0E2D\u0E18\u0E34\u0E1A\u0E32\u0E22\u0E40\u0E1B\u0E47\u0E19\u0E20\u0E32\u0E29\u0E32\u0E44\u0E17\u0E22\u0E17\u0E35\u0E48\u0E2D\u0E48\u0E32\u0E19\u0E40\u0E02\u0E49\u0E32\u0E43\u0E08\u0E07\u0E48\u0E32\u0E22 \u0E2A\u0E38\u0E20\u0E32\u0E1E \u0E40\u0E2B\u0E21\u0E32\u0E30\u0E2A\u0E33\u0E2B\u0E23\u0E31\u0E1A\u0E1C\u0E39\u0E49\u0E1A\u0E23\u0E34\u0E2B\u0E32\u0E23/\u0E1C\u0E39\u0E49\u0E43\u0E2B\u0E0D\u0E48 (assessmentThai) \u0E27\u0E48\u0E32\u0E04\u0E25\u0E34\u0E1B\u0E19\u0E35\u0E49\u0E04\u0E27\u0E23\u0E40\u0E25\u0E48\u0E32\u0E20\u0E32\u0E1E\u0E2D\u0E22\u0E48\u0E32\u0E07\u0E44\u0E23\u0E43\u0E2B\u0E49\u0E14\u0E36\u0E07\u0E14\u0E39\u0E14\u0E41\u0E25\u0E30\u0E14\u0E39\u0E40\u0E1B\u0E47\u0E19\u0E21\u0E37\u0E2D\u0E2D\u0E32\u0E0A\u0E35\u0E1E
2) \u0E2A\u0E23\u0E38\u0E1B\u0E20\u0E32\u0E1E\u0E09\u0E32\u0E01\u0E27\u0E34\u0E14\u0E35\u0E42\u0E2D\u0E17\u0E35\u0E48\u0E08\u0E30\u0E2A\u0E23\u0E49\u0E32\u0E07\u0E40\u0E1B\u0E47\u0E19\u0E20\u0E32\u0E29\u0E32\u0E44\u0E17\u0E22\u0E2A\u0E31\u0E49\u0E19\u0E46 \u0E0A\u0E31\u0E14\u0E40\u0E08\u0E19 (visualSummaryThai)
3) \u0E40\u0E02\u0E35\u0E22\u0E19 Full Video Prompt \u0E20\u0E32\u0E29\u0E32\u0E2D\u0E31\u0E07\u0E01\u0E24\u0E29\u0E23\u0E30\u0E14\u0E31\u0E1A\u0E20\u0E32\u0E1E\u0E22\u0E19\u0E15\u0E23\u0E4C (fullPrompt) \u0E2A\u0E33\u0E2B\u0E23\u0E31\u0E1A\u0E2A\u0E48\u0E07\u0E43\u0E2B\u0E49 Google Veo / Gemini Video Agent \u0E42\u0E14\u0E22\u0E23\u0E30\u0E1A\u0E38\u0E04\u0E23\u0E1A\u0E16\u0E49\u0E27\u0E19: Subject, Action, Setting, Camera Movement (smooth dolly / tracking / cinematic pan), Lighting & Color Palette (warm inspiring light, deep navy & amber accents where appropriate), Ambient Sound & Pacing
4) \u0E41\u0E19\u0E30\u0E19\u0E33\u0E2A\u0E31\u0E14\u0E2A\u0E48\u0E27\u0E19\u0E20\u0E32\u0E1E (recommendedAspectRatio: "16:9" \u0E2A\u0E33\u0E2B\u0E23\u0E31\u0E1A\u0E40\u0E27\u0E47\u0E1A/YouTube \u0E2B\u0E23\u0E37\u0E2D "9:16" \u0E2A\u0E33\u0E2B\u0E23\u0E31\u0E1A\u0E04\u0E25\u0E34\u0E1B\u0E2A\u0E31\u0E49\u0E19\u0E21\u0E37\u0E2D\u0E16\u0E37\u0E2D) \u0E41\u0E25\u0E30\u0E2B\u0E31\u0E27\u0E02\u0E49\u0E2D\u0E02\u0E48\u0E32\u0E27\u0E17\u0E35\u0E48\u0E40\u0E02\u0E49\u0E32\u0E01\u0E31\u0E1A\u0E04\u0E25\u0E34\u0E1B\u0E19\u0E35\u0E49 (suggestedPostTitle)
\u0E15\u0E2D\u0E1A\u0E40\u0E1B\u0E47\u0E19 JSON \u0E40\u0E17\u0E48\u0E32\u0E19\u0E31\u0E49\u0E19\u0E15\u0E32\u0E21\u0E42\u0E04\u0E23\u0E07\u0E2A\u0E23\u0E49\u0E32\u0E07\u0E19\u0E35\u0E49:
{
  "assessmentThai": "...",
  "visualSummaryThai": "...",
  "fullPrompt": "...",
  "recommendedAspectRatio": "${defaultAspect}",
  "suggestedPostTitle": "..."
}` : `\u0E04\u0E38\u0E13\u0E04\u0E37\u0E2D Art Director & AI Image Prompt Engineer \u0E1B\u0E23\u0E30\u0E08\u0E33\u0E2A\u0E15\u0E39\u0E14\u0E34\u0E42\u0E2D "\u0E04\u0E21\u0E04\u0E34\u0E14 by KOMKRIT"
\u0E2B\u0E19\u0E49\u0E32\u0E17\u0E35\u0E48\u0E02\u0E2D\u0E07\u0E04\u0E38\u0E13\u0E04\u0E37\u0E2D:
1) \u0E1B\u0E23\u0E30\u0E40\u0E21\u0E34\u0E19\u0E04\u0E27\u0E32\u0E21\u0E15\u0E49\u0E2D\u0E07\u0E01\u0E32\u0E23\u0E02\u0E2D\u0E07\u0E1C\u0E39\u0E49\u0E43\u0E0A\u0E49\u0E08\u0E32\u0E01\u0E1A\u0E17\u0E2A\u0E19\u0E17\u0E19\u0E32\u0E2B\u0E23\u0E37\u0E2D\u0E44\u0E2D\u0E40\u0E14\u0E35\u0E22\u0E17\u0E35\u0E48\u0E43\u0E2B\u0E49\u0E21\u0E32 \u0E2D\u0E18\u0E34\u0E1A\u0E32\u0E22\u0E40\u0E1B\u0E47\u0E19\u0E20\u0E32\u0E29\u0E32\u0E44\u0E17\u0E22\u0E17\u0E35\u0E48\u0E2D\u0E48\u0E32\u0E19\u0E40\u0E02\u0E49\u0E32\u0E43\u0E08\u0E07\u0E48\u0E32\u0E22 \u0E2A\u0E38\u0E20\u0E32\u0E1E \u0E40\u0E2B\u0E21\u0E32\u0E30\u0E2A\u0E33\u0E2B\u0E23\u0E31\u0E1A\u0E1C\u0E39\u0E49\u0E1A\u0E23\u0E34\u0E2B\u0E32\u0E23/\u0E1C\u0E39\u0E49\u0E43\u0E2B\u0E0D\u0E48 (assessmentThai) \u0E27\u0E48\u0E32\u0E20\u0E32\u0E1E\u0E19\u0E35\u0E49\u0E04\u0E27\u0E23\u0E08\u0E31\u0E14\u0E2D\u0E07\u0E04\u0E4C\u0E1B\u0E23\u0E30\u0E01\u0E2D\u0E1A \u0E42\u0E17\u0E19\u0E41\u0E2A\u0E07 \u0E41\u0E25\u0E30\u0E2D\u0E32\u0E23\u0E21\u0E13\u0E4C\u0E2D\u0E22\u0E48\u0E32\u0E07\u0E44\u0E23\u0E43\u0E2B\u0E49\u0E19\u0E48\u0E32\u0E40\u0E0A\u0E37\u0E48\u0E2D\u0E16\u0E37\u0E2D\u0E41\u0E25\u0E30\u0E14\u0E36\u0E07\u0E14\u0E39\u0E14\u0E2A\u0E32\u0E22\u0E15\u0E32
2) \u0E2A\u0E23\u0E38\u0E1B\u0E20\u0E32\u0E1E\u0E17\u0E35\u0E48\u0E08\u0E30\u0E44\u0E14\u0E49\u0E40\u0E1B\u0E47\u0E19\u0E20\u0E32\u0E29\u0E32\u0E44\u0E17\u0E22\u0E2A\u0E31\u0E49\u0E19\u0E46 \u0E0A\u0E31\u0E14\u0E40\u0E08\u0E19 (visualSummaryThai)
3) \u0E40\u0E02\u0E35\u0E22\u0E19 Full Image Prompt \u0E20\u0E32\u0E29\u0E32\u0E2D\u0E31\u0E07\u0E01\u0E24\u0E29\u0E23\u0E30\u0E14\u0E31\u0E1A\u0E21\u0E37\u0E2D\u0E2D\u0E32\u0E0A\u0E35\u0E1E (fullPrompt) \u0E2A\u0E33\u0E2B\u0E23\u0E31\u0E1A\u0E2A\u0E48\u0E07\u0E43\u0E2B\u0E49 AI Image Agent (Google Gemini Image / OpenAI Image \u0E23\u0E38\u0E48\u0E19\u0E25\u0E48\u0E32\u0E2A\u0E38\u0E14) \u0E42\u0E14\u0E22\u0E23\u0E30\u0E1A\u0E38\u0E04\u0E23\u0E1A\u0E16\u0E49\u0E27\u0E19: Main Subject, Environment, Composition, Lighting, Color Harmony, Camera Lens / Editorial Photography Style, High Detail, No gibberish text
4) \u0E41\u0E19\u0E30\u0E19\u0E33\u0E2A\u0E31\u0E14\u0E2A\u0E48\u0E27\u0E19\u0E20\u0E32\u0E1E (recommendedAspectRatio: "16:9", "1:1" \u0E2B\u0E23\u0E37\u0E2D "9:16") \u0E41\u0E25\u0E30\u0E2B\u0E31\u0E27\u0E02\u0E49\u0E2D\u0E02\u0E48\u0E32\u0E27\u0E17\u0E35\u0E48\u0E40\u0E02\u0E49\u0E32\u0E01\u0E31\u0E1A\u0E20\u0E32\u0E1E\u0E19\u0E35\u0E49 (suggestedPostTitle)
\u0E15\u0E2D\u0E1A\u0E40\u0E1B\u0E47\u0E19 JSON \u0E40\u0E17\u0E48\u0E32\u0E19\u0E31\u0E49\u0E19\u0E15\u0E32\u0E21\u0E42\u0E04\u0E23\u0E07\u0E2A\u0E23\u0E49\u0E32\u0E07\u0E19\u0E35\u0E49:
{
  "assessmentThai": "...",
  "visualSummaryThai": "...",
  "fullPrompt": "...",
  "recommendedAspectRatio": "${defaultAspect}",
  "suggestedPostTitle": "..."
}`;
  const userPayload = [
    conversationContext ? `\u0E1A\u0E17\u0E2A\u0E19\u0E17\u0E19\u0E32\u0E25\u0E48\u0E32\u0E2A\u0E38\u0E14\u0E43\u0E19\u0E2B\u0E49\u0E2D\u0E07\u0E41\u0E0A\u0E17:
${conversationContext}` : "",
    idea ? `\u0E04\u0E33\u0E2A\u0E31\u0E48\u0E07/\u0E41\u0E19\u0E27\u0E04\u0E34\u0E14\u0E40\u0E1E\u0E34\u0E48\u0E21\u0E40\u0E15\u0E34\u0E21\u0E08\u0E32\u0E01\u0E1C\u0E39\u0E49\u0E14\u0E39\u0E41\u0E25:
${idea}` : "",
    `\u0E2A\u0E31\u0E14\u0E2A\u0E48\u0E27\u0E19\u0E17\u0E35\u0E48\u0E15\u0E49\u0E2D\u0E07\u0E01\u0E32\u0E23\u0E40\u0E1A\u0E37\u0E49\u0E2D\u0E07\u0E15\u0E49\u0E19: ${defaultAspect}`
  ].filter(Boolean).join("\n\n");
  const res = await callRealLlm({
    provider: params.provider,
    model: params.model,
    systemInstruction,
    messages: [{ role: "user", content: userPayload }],
    temperature: 0.55,
    jsonMode: true
  });
  const parsed = extractStrictJson(res.text);
  const recAspect = ["16:9", "9:16", "1:1"].includes(parsed.recommendedAspectRatio) ? parsed.recommendedAspectRatio : defaultAspect;
  return {
    target: params.target,
    assessmentThai: String(parsed.assessmentThai || "").trim() || "AI \u0E1B\u0E23\u0E30\u0E40\u0E21\u0E34\u0E19\u0E41\u0E19\u0E27\u0E04\u0E34\u0E14\u0E41\u0E25\u0E30\u0E2D\u0E2D\u0E01\u0E41\u0E1A\u0E1A\u0E2D\u0E07\u0E04\u0E4C\u0E1B\u0E23\u0E30\u0E01\u0E2D\u0E1A\u0E20\u0E32\u0E1E\u0E23\u0E30\u0E14\u0E31\u0E1A\u0E21\u0E37\u0E2D\u0E2D\u0E32\u0E0A\u0E35\u0E1E\u0E43\u0E2B\u0E49\u0E40\u0E23\u0E35\u0E22\u0E1A\u0E23\u0E49\u0E2D\u0E22\u0E41\u0E25\u0E49\u0E27",
    visualSummaryThai: String(parsed.visualSummaryThai || "").trim() || (isVideo ? "\u0E27\u0E34\u0E14\u0E35\u0E42\u0E2D\u0E04\u0E38\u0E13\u0E20\u0E32\u0E1E\u0E2A\u0E39\u0E07\u0E16\u0E48\u0E32\u0E22\u0E17\u0E2D\u0E14\u0E41\u0E19\u0E27\u0E04\u0E34\u0E14\u0E15\u0E32\u0E21\u0E17\u0E35\u0E48\u0E2A\u0E19\u0E17\u0E19\u0E32" : "\u0E20\u0E32\u0E1E\u0E1B\u0E23\u0E30\u0E01\u0E2D\u0E1A\u0E02\u0E48\u0E32\u0E27\u0E04\u0E38\u0E13\u0E20\u0E32\u0E1E\u0E2A\u0E39\u0E07\u0E15\u0E32\u0E21\u0E41\u0E19\u0E27\u0E04\u0E34\u0E14\u0E17\u0E35\u0E48\u0E2A\u0E19\u0E17\u0E19\u0E32"),
    fullPrompt: String(parsed.fullPrompt || "").trim(),
    recommendedAspectRatio: recAspect,
    suggestedPostTitle: String(parsed.suggestedPostTitle || "").trim(),
    engineUsed: res.engineLabel
  };
}
async function draftContentFromChat(params) {
  let conversationContext = "";
  if (params.sessionId) {
    const rows = db.prepare(
      "SELECT role, content FROM ai_chat_messages WHERE session_id = ? ORDER BY id DESC LIMIT 18"
    ).all(params.sessionId);
    if (rows.length > 0) {
      conversationContext = rows.reverse().map((r) => `${r.role === "user" ? "\u0E1C\u0E39\u0E49\u0E14\u0E39\u0E41\u0E25" : "AI"}: ${r.content}`).join("\n");
    }
  }
  const idea = (params.ideaText || "").trim();
  if (!conversationContext && !idea) {
    throw new Error("\u0E01\u0E23\u0E38\u0E13\u0E32\u0E1E\u0E34\u0E21\u0E1E\u0E4C\u0E2B\u0E31\u0E27\u0E02\u0E49\u0E2D\u0E02\u0E48\u0E32\u0E27/\u0E40\u0E19\u0E37\u0E49\u0E2D\u0E2B\u0E32\u0E17\u0E35\u0E48\u0E15\u0E49\u0E2D\u0E07\u0E01\u0E32\u0E23 \u0E2B\u0E23\u0E37\u0E2D\u0E04\u0E38\u0E22\u0E01\u0E31\u0E1A AI \u0E01\u0E48\u0E2D\u0E19\u0E2A\u0E31\u0E48\u0E07\u0E40\u0E02\u0E35\u0E22\u0E19\u0E02\u0E48\u0E32\u0E27\u0E04\u0E23\u0E31\u0E1A");
  }
  const kb = getActiveKnowledgeContext(idea || conversationContext.slice(-500));
  const kbStr = kb.length > 0 ? kb.map((k, i) => `[KB-${i + 1}] ${k.title}: ${k.summary}`).join("\n") : "";
  const formatDesc = params.contentFormat === "social_post" ? "\u0E04\u0E2D\u0E19\u0E40\u0E17\u0E19\u0E15\u0E4C\u0E2A\u0E31\u0E49\u0E19\u0E01\u0E23\u0E30\u0E0A\u0E31\u0E1A \u0E19\u0E48\u0E32\u0E41\u0E0A\u0E23\u0E4C \u0E2D\u0E48\u0E32\u0E19\u0E08\u0E1A\u0E44\u0E27 \u0E40\u0E2B\u0E21\u0E32\u0E30\u0E17\u0E31\u0E49\u0E07\u0E25\u0E07\u0E2B\u0E19\u0E49\u0E32\u0E40\u0E27\u0E47\u0E1A\u0E41\u0E25\u0E30\u0E42\u0E1E\u0E2A\u0E15\u0E4C\u0E42\u0E0B\u0E40\u0E0A\u0E35\u0E22\u0E25" : params.contentFormat === "article" ? "\u0E1A\u0E17\u0E04\u0E27\u0E32\u0E21\u0E27\u0E34\u0E40\u0E04\u0E23\u0E32\u0E30\u0E2B\u0E4C\u0E43\u0E2B\u0E49\u0E04\u0E27\u0E32\u0E21\u0E23\u0E39\u0E49\u0E25\u0E36\u0E01\u0E0B\u0E36\u0E49\u0E07 \u0E2D\u0E48\u0E32\u0E19\u0E40\u0E02\u0E49\u0E32\u0E43\u0E08\u0E07\u0E48\u0E32\u0E22 \u0E21\u0E35\u0E2B\u0E31\u0E27\u0E02\u0E49\u0E2D\u0E22\u0E48\u0E2D\u0E22\u0E0A\u0E31\u0E14\u0E40\u0E08\u0E19\u0E43\u0E19\u0E2A\u0E44\u0E15\u0E25\u0E4C \u0E04\u0E21\u0E04\u0E34\u0E14 by KOMKRIT" : "\u0E02\u0E48\u0E32\u0E27\u0E1B\u0E23\u0E30\u0E0A\u0E32\u0E2A\u0E31\u0E21\u0E1E\u0E31\u0E19\u0E18\u0E4C / \u0E02\u0E48\u0E32\u0E27\u0E2A\u0E32\u0E23\u0E04\u0E27\u0E32\u0E21\u0E23\u0E39\u0E49\u0E17\u0E35\u0E48\u0E19\u0E48\u0E32\u0E40\u0E0A\u0E37\u0E48\u0E2D\u0E16\u0E37\u0E2D \u0E2D\u0E48\u0E32\u0E19\u0E07\u0E48\u0E32\u0E22 \u0E0A\u0E31\u0E14\u0E40\u0E08\u0E19 \u0E1E\u0E23\u0E49\u0E2D\u0E21\u0E02\u0E36\u0E49\u0E19\u0E2B\u0E19\u0E49\u0E32\u0E40\u0E27\u0E47\u0E1A\u0E44\u0E0B\u0E15\u0E4C";
  const systemInstruction = `\u0E04\u0E38\u0E13\u0E04\u0E37\u0E2D\u0E1A\u0E23\u0E23\u0E13\u0E32\u0E18\u0E34\u0E01\u0E32\u0E23\u0E02\u0E48\u0E32\u0E27\u0E41\u0E25\u0E30\u0E19\u0E31\u0E01\u0E40\u0E02\u0E35\u0E22\u0E19\u0E04\u0E2D\u0E19\u0E40\u0E17\u0E19\u0E15\u0E4C\u0E21\u0E37\u0E2D\u0E2D\u0E32\u0E0A\u0E35\u0E1E\u0E1B\u0E23\u0E30\u0E08\u0E33\u0E40\u0E27\u0E47\u0E1A\u0E44\u0E0B\u0E15\u0E4C "\u0E04\u0E21\u0E04\u0E34\u0E14 by KOMKRIT" (\u0E04\u0E34\u0E14\u0E15\u0E48\u0E32\u0E07\u0E2D\u0E22\u0E48\u0E32\u0E07\u0E2A\u0E23\u0E49\u0E32\u0E07\u0E2A\u0E23\u0E23\u0E04\u0E4C)
\u0E08\u0E07\u0E40\u0E23\u0E35\u0E22\u0E1A\u0E40\u0E23\u0E35\u0E22\u0E07\u0E40\u0E19\u0E37\u0E49\u0E2D\u0E2B\u0E32\u0E20\u0E32\u0E29\u0E32\u0E44\u0E17\u0E22\u0E04\u0E38\u0E13\u0E20\u0E32\u0E1E\u0E2A\u0E39\u0E07\u0E15\u0E32\u0E21\u0E23\u0E39\u0E1B\u0E41\u0E1A\u0E1A "${formatDesc}" \u0E08\u0E32\u0E01\u0E1A\u0E17\u0E2A\u0E19\u0E17\u0E19\u0E32\u0E2B\u0E23\u0E37\u0E2D\u0E42\u0E08\u0E17\u0E22\u0E4C\u0E17\u0E35\u0E48\u0E44\u0E14\u0E49\u0E23\u0E31\u0E1A
${kbStr ? `
\u0E02\u0E49\u0E2D\u0E21\u0E39\u0E25\u0E2D\u0E49\u0E32\u0E07\u0E2D\u0E34\u0E07\u0E02\u0E2D\u0E07\u0E2D\u0E07\u0E04\u0E4C\u0E01\u0E23:
${kbStr}
` : ""}
\u0E01\u0E0E\u0E2A\u0E33\u0E04\u0E31\u0E0D:
- \u0E20\u0E32\u0E29\u0E32\u0E44\u0E17\u0E22\u0E2A\u0E25\u0E30\u0E2A\u0E25\u0E27\u0E22 \u0E2D\u0E48\u0E32\u0E19\u0E07\u0E48\u0E32\u0E22 \u0E15\u0E31\u0E27\u0E2D\u0E22\u0E48\u0E32\u0E07\u0E0A\u0E31\u0E14\u0E40\u0E08\u0E19 \u0E44\u0E21\u0E48\u0E43\u0E0A\u0E49\u0E28\u0E31\u0E1E\u0E17\u0E4C\u0E40\u0E17\u0E04\u0E19\u0E34\u0E04\u0E40\u0E01\u0E34\u0E19\u0E08\u0E33\u0E40\u0E1B\u0E47\u0E19
- category \u0E15\u0E49\u0E2D\u0E07\u0E40\u0E25\u0E37\u0E2D\u0E01 1 \u0E04\u0E48\u0E32\u0E17\u0E35\u0E48\u0E15\u0E23\u0E07\u0E17\u0E35\u0E48\u0E2A\u0E38\u0E14\u0E08\u0E32\u0E01: "education", "innovation", "society", "international", "career", "ai-tech", "special"
- contentType \u0E40\u0E25\u0E37\u0E2D\u0E01 "news" (\u0E16\u0E49\u0E32\u0E40\u0E1B\u0E47\u0E19\u0E02\u0E48\u0E32\u0E27\u0E2A\u0E32\u0E23/\u0E1B\u0E23\u0E30\u0E0A\u0E32\u0E2A\u0E31\u0E21\u0E1E\u0E31\u0E19\u0E18\u0E4C) \u0E2B\u0E23\u0E37\u0E2D "article" (\u0E16\u0E49\u0E32\u0E40\u0E1B\u0E47\u0E19\u0E1A\u0E17\u0E04\u0E27\u0E32\u0E21\u0E04\u0E27\u0E32\u0E21\u0E23\u0E39\u0E49/\u0E04\u0E2D\u0E19\u0E40\u0E17\u0E19\u0E15\u0E4C)
- suggestedImagePrompt \u0E40\u0E02\u0E35\u0E22\u0E19\u0E40\u0E1B\u0E47\u0E19\u0E20\u0E32\u0E29\u0E32\u0E2D\u0E31\u0E07\u0E01\u0E24\u0E29\u0E25\u0E30\u0E40\u0E2D\u0E35\u0E22\u0E14\u0E2A\u0E33\u0E2B\u0E23\u0E31\u0E1A\u0E43\u0E0A\u0E49\u0E2A\u0E31\u0E48\u0E07 AI \u0E2A\u0E23\u0E49\u0E32\u0E07\u0E20\u0E32\u0E1E\u0E1B\u0E01\u0E02\u0E48\u0E32\u0E27\u0E40\u0E23\u0E37\u0E48\u0E2D\u0E07\u0E19\u0E35\u0E49\u0E43\u0E19\u0E2A\u0E31\u0E14\u0E2A\u0E48\u0E27\u0E19 16:9
\u0E15\u0E2D\u0E1A\u0E40\u0E1B\u0E47\u0E19 JSON \u0E40\u0E17\u0E48\u0E32\u0E19\u0E31\u0E49\u0E19:
{
  "title": "\u0E1E\u0E32\u0E14\u0E2B\u0E31\u0E27\u0E02\u0E48\u0E32\u0E27/\u0E1A\u0E17\u0E04\u0E27\u0E32\u0E21\u0E04\u0E21\u0E0A\u0E31\u0E14",
  "subtitle": "\u0E04\u0E33\u0E42\u0E1B\u0E23\u0E22\u0E02\u0E22\u0E32\u0E22\u0E04\u0E27\u0E32\u0E21\u0E19\u0E48\u0E32\u0E2A\u0E19\u0E43\u0E08",
  "excerpt": "\u0E2A\u0E23\u0E38\u0E1B\u0E43\u0E08\u0E04\u0E27\u0E32\u0E21\u0E2A\u0E33\u0E04\u0E31\u0E0D 2-3 \u0E1B\u0E23\u0E30\u0E42\u0E22\u0E04",
  "category": "education",
  "contentType": "news",
  "content": "\u0E40\u0E19\u0E37\u0E49\u0E2D\u0E2B\u0E32\u0E02\u0E48\u0E32\u0E27\u0E2B\u0E23\u0E37\u0E2D\u0E1A\u0E17\u0E04\u0E27\u0E32\u0E21\u0E09\u0E1A\u0E31\u0E1A\u0E40\u0E15\u0E47\u0E21 \u0E41\u0E1A\u0E48\u0E07\u0E22\u0E48\u0E2D\u0E2B\u0E19\u0E49\u0E32\u0E41\u0E25\u0E30\u0E2B\u0E31\u0E27\u0E02\u0E49\u0E2D\u0E22\u0E48\u0E2D\u0E22\u0E43\u0E2B\u0E49\u0E2D\u0E48\u0E32\u0E19\u0E2A\u0E1A\u0E32\u0E22\u0E15\u0E32",
  "tags": ["\u0E04\u0E21\u0E04\u0E34\u0E14 by KOMKRIT", "..."],
  "suggestedImagePrompt": "Editorial 16:9 cover photography..."
}`;
  const userPayload = [
    conversationContext ? `\u0E1A\u0E17\u0E2A\u0E19\u0E17\u0E19\u0E32\u0E43\u0E19\u0E2B\u0E49\u0E2D\u0E07\u0E41\u0E0A\u0E17:
${conversationContext}` : "",
    idea ? `\u0E42\u0E08\u0E17\u0E22\u0E4C/\u0E04\u0E33\u0E2A\u0E31\u0E48\u0E07\u0E40\u0E1E\u0E34\u0E48\u0E21\u0E40\u0E15\u0E34\u0E21:
${idea}` : "",
    params.category ? `\u0E2B\u0E21\u0E27\u0E14\u0E2B\u0E21\u0E39\u0E48\u0E17\u0E35\u0E48\u0E15\u0E49\u0E2D\u0E07\u0E01\u0E32\u0E23: ${params.category}` : ""
  ].filter(Boolean).join("\n\n");
  const res = await callRealLlm({
    provider: params.provider,
    model: params.model,
    systemInstruction,
    messages: [{ role: "user", content: userPayload }],
    temperature: 0.6,
    jsonMode: true
  });
  const parsed = extractStrictJson(res.text);
  const validCategories = [
    "education",
    "innovation",
    "society",
    "international",
    "career",
    "ai-tech",
    "special"
  ];
  const category = validCategories.includes(parsed.category) ? parsed.category : params.category || "education";
  return {
    title: String(parsed.title || "\u0E02\u0E48\u0E32\u0E27\u0E43\u0E2B\u0E21\u0E48\u0E08\u0E32\u0E01 \u0E04\u0E21\u0E04\u0E34\u0E14 by KOMKRIT").trim(),
    subtitle: String(parsed.subtitle || "").trim(),
    excerpt: String(parsed.excerpt || "").trim(),
    category,
    contentType: parsed.contentType === "article" ? "article" : "news",
    content: String(parsed.content || "").trim(),
    tags: Array.isArray(parsed.tags) ? parsed.tags.map(String) : ["\u0E04\u0E21\u0E04\u0E34\u0E14 by KOMKRIT"],
    suggestedImagePrompt: String(parsed.suggestedImagePrompt || "").trim(),
    engineUsed: res.engineLabel
  };
}

// server/publishEngine.ts
import fs3 from "node:fs";
import path3 from "node:path";
async function resolveVideoBytes(videoUrl) {
  if (!videoUrl) return null;
  const clean = videoUrl.trim();
  if (!clean) return null;
  if (clean.startsWith("/uploads/")) {
    const abs = path3.join(UPLOADS_ROOT, clean.replace(/^\/uploads\//, ""));
    if (fs3.existsSync(abs)) return fs3.readFileSync(abs);
  }
  if (/^https?:\/\//i.test(clean)) {
    try {
      const resp = await fetch(clean);
      if (resp.ok) {
        return Buffer.from(await resp.arrayBuffer());
      }
    } catch {
      return null;
    }
  }
  return null;
}
async function dispatchSingleChannelReal(input) {
  const cfg = db.prepare("SELECT * FROM channel_configs WHERE channel_key = ?").get(input.channelKey);
  const chName = cfg ? String(cfg.channel_name) : input.channelKey;
  const token = decryptSecretValue(cfg?.access_token, `channel:${input.channelKey}`);
  const targetId = String(cfg?.target_id || "").trim();
  const webhookUrl = String(cfg?.webhook_url || "").trim();
  const now = (/* @__PURE__ */ new Date()).toISOString();
  if (input.channelKey === "website_blog") {
    let targetPostId = input.postId;
    if (!targetPostId) {
      const contentType = input.videoUrl ? "video" : "article";
      const pRes = db.prepare(
        `INSERT INTO posts (
            title, subtitle, excerpt, content, category, content_type, cover_image,
            video_url, audio_url, tags_json, author, status, is_featured, views, ai_workflow_id, created_at, updated_at
          ) VALUES (?, '', ?, ?, ?, ?, ?, ?, ?, '["\u0E04\u0E21\u0E04\u0E34\u0E14 by KOMKRIT","Omnichannel"]', '\u0E04\u0E21\u0E01\u0E24\u0E0A (Komkrit)', 'published', 0, 1, ?, ?, ?)`
      ).run(
        input.title.trim(),
        input.content.replace(/[#>*_`]/g, "").slice(0, 180),
        input.content,
        input.category || "education",
        contentType,
        input.coverImage || "/images/thumb-ai-edu.jpg",
        input.videoUrl || "",
        input.audioUrl || "",
        input.workflowId,
        now,
        now
      );
      targetPostId = Number(pRes.lastInsertRowid);
    }
    return {
      channelKey: "website_blog",
      channelName: chName,
      mode: "internal_live",
      status: "published",
      externalUrl: `/?post=${targetPostId}`,
      responseNote: `\u0E40\u0E1C\u0E22\u0E41\u0E1E\u0E23\u0E48\u0E02\u0E36\u0E49\u0E19\u0E10\u0E32\u0E19\u0E02\u0E49\u0E2D\u0E21\u0E39\u0E25\u0E40\u0E27\u0E47\u0E1A\u0E44\u0E0B\u0E15\u0E4C\u0E2B\u0E25\u0E31\u0E01\u0E08\u0E23\u0E34\u0E07\u0E2A\u0E33\u0E40\u0E23\u0E47\u0E08 (Post #${targetPostId})`,
      createdPostId: targetPostId
    };
  }
  if (webhookUrl && /^https?:\/\//i.test(webhookUrl)) {
    const whResp = await fetch(webhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...token ? { Authorization: `Bearer ${token}` } : {}
      },
      body: JSON.stringify({
        channelKey: input.channelKey,
        channelName: chName,
        title: input.title,
        content: input.content,
        category: input.category,
        coverImage: input.coverImage,
        videoUrl: input.videoUrl,
        audioUrl: input.audioUrl || "",
        timestamp: now
      })
    });
    if (!whResp.ok) {
      const errBody = await whResp.text();
      return {
        channelKey: input.channelKey,
        channelName: chName,
        mode: "webhook",
        status: "failed",
        externalUrl: "",
        responseNote: `Webhook \u0E15\u0E2D\u0E1A\u0E01\u0E25\u0E31\u0E1A\u0E02\u0E49\u0E2D\u0E1C\u0E34\u0E14\u0E1E\u0E25\u0E32\u0E14 HTTP ${whResp.status}: ${errBody.slice(0, 160)}`
      };
    }
    return {
      channelKey: input.channelKey,
      channelName: chName,
      mode: "webhook",
      status: "published",
      externalUrl: cfg?.handle_or_url || "",
      responseNote: `\u0E2A\u0E48\u0E07\u0E02\u0E49\u0E2D\u0E21\u0E39\u0E25\u0E08\u0E23\u0E34\u0E07\u0E1C\u0E48\u0E32\u0E19 Webhook \u0E2A\u0E33\u0E40\u0E23\u0E47\u0E08 (HTTP ${whResp.status})`
    };
  }
  if (input.channelKey === "email_newsletter") {
    const resendKey = token || getSettingValue("resend_api_key", "RESEND_API_KEY");
    const fromEmail = targetId || getSettingValue("resend_from_email", "RESEND_FROM_EMAIL") || "onboarding@resend.dev";
    if (!resendKey) {
      return {
        channelKey: "email_newsletter",
        channelName: chName,
        mode: "unconfigured",
        status: "failed",
        externalUrl: "",
        responseNote: "\u0E22\u0E31\u0E07\u0E44\u0E21\u0E48\u0E44\u0E14\u0E49\u0E15\u0E31\u0E49\u0E07\u0E04\u0E48\u0E32 Resend API Key (\u0E2B\u0E23\u0E37\u0E2D Webhook URL) \u0E2A\u0E33\u0E2B\u0E23\u0E31\u0E1A\u0E2A\u0E48\u0E07\u0E2D\u0E35\u0E40\u0E21\u0E25\u0E08\u0E23\u0E34\u0E07 \u2014 \u0E01\u0E23\u0E38\u0E13\u0E32\u0E01\u0E14\u0E44\u0E2D\u0E04\u0E2D\u0E19\u0E1F\u0E31\u0E19\u0E40\u0E1F\u0E37\u0E2D\u0E07\u0E02\u0E2D\u0E07\u0E0A\u0E48\u0E2D\u0E07\u0E17\u0E32\u0E07 Email / Newsletter \u0E40\u0E1E\u0E37\u0E48\u0E2D\u0E43\u0E2A\u0E48 API Key"
      };
    }
    const subs = db.prepare("SELECT email, name FROM subscribers ORDER BY id ASC").all();
    if (subs.length === 0) {
      return {
        channelKey: "email_newsletter",
        channelName: chName,
        mode: "live_api",
        status: "failed",
        externalUrl: "",
        responseNote: "\u0E44\u0E21\u0E48\u0E21\u0E35\u0E23\u0E32\u0E22\u0E0A\u0E37\u0E48\u0E2D\u0E2D\u0E35\u0E40\u0E21\u0E25\u0E2A\u0E21\u0E32\u0E0A\u0E34\u0E01\u0E43\u0E19\u0E15\u0E32\u0E23\u0E32\u0E07 Subscribers \u0E2A\u0E33\u0E2B\u0E23\u0E31\u0E1A\u0E08\u0E31\u0E14\u0E2A\u0E48\u0E07"
      };
    }
    const htmlBody = `
      <div style="font-family: 'Sarabun', sans-serif; max-width: 640px; margin: 0 auto; border: 1px solid #e2e8f0; border-radius: 16px; overflow: hidden;">
        <div style="background: #0d2546; color: #ffffff; padding: 24px;">
          <div style="color: #fbbf24; font-weight: bold; font-size: 13px;">\u0E04\u0E21\u0E04\u0E34\u0E14 by KOMKRIT \u2022 \u0E04\u0E34\u0E14\u0E15\u0E48\u0E32\u0E07\u0E2D\u0E22\u0E48\u0E32\u0E07\u0E2A\u0E23\u0E49\u0E32\u0E07\u0E2A\u0E23\u0E23\u0E04\u0E4C</div>
          <h1 style="margin: 8px 0 0; font-size: 22px;">${input.title}</h1>
        </div>
        <div style="padding: 24px; color: #1e293b; line-height: 1.7; white-space: pre-line;">${input.content}</div>
        <div style="background: #f8fafc; padding: 16px 24px; font-size: 12px; color: #64748b;">
          \u0E01\u0E32\u0E23\u0E28\u0E36\u0E01\u0E29\u0E32\u0E17\u0E35\u0E48\u0E14\u0E35 \u0E2A\u0E23\u0E49\u0E32\u0E07\u0E04\u0E19\u0E17\u0E35\u0E48\u0E14\u0E35 \u0E2A\u0E23\u0E49\u0E32\u0E07\u0E2A\u0E31\u0E07\u0E04\u0E21\u0E17\u0E35\u0E48\u0E14\u0E35\u0E44\u0E14\u0E49 \u2022 \u0E04\u0E21\u0E04\u0E34\u0E14 by KOMKRIT
        </div>
      </div>
    `;
    const resp = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${resendKey}`
      },
      body: JSON.stringify({
        from: fromEmail,
        to: subs.map((s) => s.email),
        subject: `[\u0E04\u0E21\u0E04\u0E34\u0E14 by KOMKRIT] ${input.title}`,
        html: htmlBody
      })
    });
    const data = await resp.json();
    if (!resp.ok) {
      return {
        channelKey: "email_newsletter",
        channelName: chName,
        mode: "live_api",
        status: "failed",
        externalUrl: "",
        responseNote: `Resend Email API Error (HTTP ${resp.status}): ${data?.message || JSON.stringify(data).slice(0, 160)}`
      };
    }
    return {
      channelKey: "email_newsletter",
      channelName: chName,
      mode: "live_api",
      status: "published",
      externalUrl: "",
      responseNote: `\u0E2A\u0E48\u0E07\u0E2D\u0E35\u0E40\u0E21\u0E25\u0E08\u0E23\u0E34\u0E07\u0E1C\u0E48\u0E32\u0E19 Resend API \u0E16\u0E36\u0E07\u0E2A\u0E21\u0E32\u0E0A\u0E34\u0E01 ${subs.length} \u0E04\u0E19\u0E2A\u0E33\u0E40\u0E23\u0E47\u0E08 (Email ID: ${data?.id || "OK"})`
    };
  }
  if (input.channelKey === "line_oa") {
    if (!token) {
      return {
        channelKey: "line_oa",
        channelName: chName,
        mode: "unconfigured",
        status: "failed",
        externalUrl: "",
        responseNote: "\u0E22\u0E31\u0E07\u0E44\u0E21\u0E48\u0E44\u0E14\u0E49\u0E43\u0E2A\u0E48 LINE Channel Access Token (\u0E2B\u0E23\u0E37\u0E2D Webhook URL) \u2014 \u0E01\u0E23\u0E38\u0E13\u0E32\u0E15\u0E31\u0E49\u0E07\u0E04\u0E48\u0E32\u0E04\u0E35\u0E22\u0E4C\u0E08\u0E23\u0E34\u0E07\u0E01\u0E48\u0E2D\u0E19\u0E22\u0E34\u0E07 Broadcast"
      };
    }
    const messages = [
      {
        type: "text",
        text: `\u{1F4CC} ${input.title}

${input.content.slice(0, 4500)}`
      }
    ];
    if (input.coverImage && /^https:\/\//i.test(input.coverImage)) {
      messages.push({
        type: "image",
        originalContentUrl: input.coverImage,
        previewImageUrl: input.coverImage
      });
    }
    const lineResp = await fetch("https://api.line.me/v2/bot/message/broadcast", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({ messages })
    });
    if (!lineResp.ok) {
      const errTxt = await lineResp.text();
      return {
        channelKey: "line_oa",
        channelName: chName,
        mode: "live_api",
        status: "failed",
        externalUrl: "",
        responseNote: `LINE Messaging API \u0E1B\u0E0F\u0E34\u0E40\u0E2A\u0E18\u0E04\u0E33\u0E02\u0E2D (HTTP ${lineResp.status}): ${errTxt.slice(0, 160)}`
      };
    }
    return {
      channelKey: "line_oa",
      channelName: chName,
      mode: "live_api",
      status: "published",
      externalUrl: "",
      responseNote: "\u0E2A\u0E48\u0E07 Broadcast \u0E08\u0E23\u0E34\u0E07\u0E1C\u0E48\u0E32\u0E19 LINE Messaging API \u0E2A\u0E33\u0E40\u0E23\u0E47\u0E08!"
    };
  }
  if (input.channelKey === "facebook") {
    if (!token || !targetId) {
      return {
        channelKey: "facebook",
        channelName: chName,
        mode: "unconfigured",
        status: "failed",
        externalUrl: "",
        responseNote: "\u0E22\u0E31\u0E07\u0E44\u0E21\u0E48\u0E44\u0E14\u0E49\u0E15\u0E31\u0E49\u0E07\u0E04\u0E48\u0E32 Facebook Page ID \u0E41\u0E25\u0E30 Page Access Token (\u0E2B\u0E23\u0E37\u0E2D Webhook URL) \u2014 \u0E01\u0E23\u0E38\u0E13\u0E32\u0E15\u0E31\u0E49\u0E07\u0E04\u0E48\u0E32\u0E04\u0E35\u0E22\u0E4C\u0E08\u0E23\u0E34\u0E07\u0E01\u0E48\u0E2D\u0E19\u0E42\u0E1E\u0E2A\u0E15\u0E4C"
      };
    }
    const fullMessage = `${input.title}

${input.content}`;
    const hasPublicVideo = /^https:\/\//i.test(input.videoUrl || "");
    const hasPublicPhoto = /^https:\/\//i.test(input.coverImage || "");
    const fbEndpoint = hasPublicVideo ? `https://graph-video.facebook.com/v21.0/${targetId}/videos` : hasPublicPhoto ? `https://graph.facebook.com/v21.0/${targetId}/photos` : `https://graph.facebook.com/v21.0/${targetId}/feed`;
    const fbPayload = hasPublicVideo ? {
      file_url: input.videoUrl,
      title: input.title,
      description: fullMessage,
      access_token: token
    } : hasPublicPhoto ? {
      url: input.coverImage,
      caption: fullMessage,
      access_token: token
    } : {
      message: fullMessage,
      access_token: token
    };
    const fbResp = await fetch(fbEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(fbPayload)
    });
    const fbData = await fbResp.json();
    if (!fbResp.ok) {
      return {
        channelKey: "facebook",
        channelName: chName,
        mode: "live_api",
        status: "failed",
        externalUrl: "",
        responseNote: `Facebook Graph API Error (HTTP ${fbResp.status}): ${fbData?.error?.message || "\u0E15\u0E23\u0E27\u0E08\u0E2A\u0E2D\u0E1A Page Access Token"}`
      };
    }
    const postIdOut = fbData?.post_id || fbData?.id;
    return {
      channelKey: "facebook",
      channelName: chName,
      mode: "live_api",
      status: "published",
      externalUrl: postIdOut ? `https://facebook.com/${postIdOut}` : "",
      responseNote: `\u0E42\u0E1E\u0E2A\u0E15\u0E4C\u0E02\u0E36\u0E49\u0E19 Facebook Page \u0E08\u0E23\u0E34\u0E07\u0E2A\u0E33\u0E40\u0E23\u0E47\u0E08 (Post ID: ${postIdOut})`
    };
  }
  if (input.channelKey === "instagram") {
    if (!token || !targetId) {
      return {
        channelKey: "instagram",
        channelName: chName,
        mode: "unconfigured",
        status: "failed",
        externalUrl: "",
        responseNote: "\u0E22\u0E31\u0E07\u0E44\u0E21\u0E48\u0E44\u0E14\u0E49\u0E15\u0E31\u0E49\u0E07\u0E04\u0E48\u0E32 Instagram Business Account ID \u0E41\u0E25\u0E30 Graph Access Token (\u0E2B\u0E23\u0E37\u0E2D Webhook URL)"
      };
    }
    const publicImage = /^https:\/\//i.test(input.coverImage) ? input.coverImage : "";
    const publicVideo = /^https:\/\//i.test(input.videoUrl) ? input.videoUrl : "";
    if (!publicImage && !publicVideo) {
      return {
        channelKey: "instagram",
        channelName: chName,
        mode: "live_api",
        status: "failed",
        externalUrl: "",
        responseNote: "Instagram Graph API \u0E01\u0E33\u0E2B\u0E19\u0E14\u0E43\u0E2B\u0E49\u0E15\u0E49\u0E2D\u0E07\u0E41\u0E19\u0E1A Public HTTPS Image/Video URL (\u0E2B\u0E23\u0E37\u0E2D\u0E2A\u0E48\u0E07\u0E1C\u0E48\u0E32\u0E19 Webhook)"
      };
    }
    const containerPayload = {
      caption: `${input.title}

${input.content}`.slice(0, 2150),
      access_token: token
    };
    if (publicVideo) {
      containerPayload.media_type = "REELS";
      containerPayload.video_url = publicVideo;
    } else {
      containerPayload.image_url = publicImage;
    }
    const step1 = await fetch(`https://graph.facebook.com/v21.0/${targetId}/media`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(containerPayload)
    });
    const s1Json = await step1.json();
    if (!step1.ok || !s1Json?.id) {
      return {
        channelKey: "instagram",
        channelName: chName,
        mode: "live_api",
        status: "failed",
        externalUrl: "",
        responseNote: `Instagram Media Container Error: ${s1Json?.error?.message || `HTTP ${step1.status}`}`
      };
    }
    const step2 = await fetch(`https://graph.facebook.com/v21.0/${targetId}/media_publish`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        creation_id: s1Json.id,
        access_token: token
      })
    });
    const s2Json = await step2.json();
    if (!step2.ok) {
      return {
        channelKey: "instagram",
        channelName: chName,
        mode: "live_api",
        status: "failed",
        externalUrl: "",
        responseNote: `Instagram Publish Error: ${s2Json?.error?.message || `HTTP ${step2.status}`}`
      };
    }
    return {
      channelKey: "instagram",
      channelName: chName,
      mode: "live_api",
      status: "published",
      externalUrl: cfg?.handle_or_url || "https://instagram.com",
      responseNote: `\u0E42\u0E1E\u0E2A\u0E15\u0E4C\u0E02\u0E36\u0E49\u0E19 Instagram \u0E08\u0E23\u0E34\u0E07\u0E2A\u0E33\u0E40\u0E23\u0E47\u0E08 (Media ID: ${s2Json?.id})`
    };
  }
  if (input.channelKey === "x_twitter") {
    const intentUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(
      `${input.title}

${input.content.slice(0, 190)} #\u0E04\u0E21\u0E04\u0E34\u0E14byKOMKRIT`
    )}`;
    if (!token) {
      return {
        channelKey: "x_twitter",
        channelName: chName,
        mode: "unconfigured",
        status: "failed",
        externalUrl: intentUrl,
        responseNote: '\u0E22\u0E31\u0E07\u0E44\u0E21\u0E48\u0E44\u0E14\u0E49\u0E43\u0E2A\u0E48 X API v2 OAuth2 User Access Token \u0E2A\u0E33\u0E2B\u0E23\u0E31\u0E1A\u0E42\u0E1E\u0E2A\u0E15\u0E4C\u0E2D\u0E31\u0E15\u0E42\u0E19\u0E21\u0E31\u0E15\u0E34 (\u0E2A\u0E32\u0E21\u0E32\u0E23\u0E16\u0E04\u0E25\u0E34\u0E01\u0E1B\u0E38\u0E48\u0E21 "\u0E40\u0E1B\u0E34\u0E14\u0E42\u0E1E\u0E2A\u0E15\u0E4C\u0E1A\u0E19 X.com" \u0E40\u0E1E\u0E37\u0E48\u0E2D\u0E17\u0E27\u0E35\u0E15\u0E14\u0E49\u0E27\u0E22\u0E15\u0E19\u0E40\u0E2D\u0E07\u0E44\u0E14\u0E49)'
      };
    }
    const tweetText = `${input.title}

${input.content}`.slice(0, 275);
    const xResp = await fetch("https://api.twitter.com/2/tweets", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({ text: tweetText })
    });
    const xData = await xResp.json();
    if (!xResp.ok) {
      return {
        channelKey: "x_twitter",
        channelName: chName,
        mode: "live_api",
        status: "failed",
        externalUrl: intentUrl,
        responseNote: `X API v2 Error (HTTP ${xResp.status}): ${xData?.detail || xData?.title || JSON.stringify(xData).slice(0, 150)}`
      };
    }
    const tweetId = xData?.data?.id;
    return {
      channelKey: "x_twitter",
      channelName: chName,
      mode: "live_api",
      status: "published",
      externalUrl: tweetId ? `https://x.com/i/web/status/${tweetId}` : intentUrl,
      responseNote: `\u0E42\u0E1E\u0E2A\u0E15\u0E4C\u0E02\u0E36\u0E49\u0E19 X (Twitter) \u0E08\u0E23\u0E34\u0E07\u0E1C\u0E48\u0E32\u0E19 API v2 \u0E2A\u0E33\u0E40\u0E23\u0E47\u0E08 (Tweet ID: ${tweetId})`
    };
  }
  if (input.channelKey === "youtube") {
    if (!token) {
      return {
        channelKey: "youtube",
        channelName: chName,
        mode: "unconfigured",
        status: "failed",
        externalUrl: "",
        responseNote: "\u0E22\u0E31\u0E07\u0E44\u0E21\u0E48\u0E44\u0E14\u0E49\u0E43\u0E2A\u0E48 Google OAuth2 Access Token (scope: youtube.upload) \u0E2B\u0E23\u0E37\u0E2D Webhook URL \u0E2A\u0E33\u0E2B\u0E23\u0E31\u0E1A\u0E2D\u0E31\u0E1B\u0E42\u0E2B\u0E25\u0E14\u0E27\u0E34\u0E14\u0E35\u0E42\u0E2D\u0E02\u0E36\u0E49\u0E19 YouTube \u0E08\u0E23\u0E34\u0E07"
      };
    }
    const videoBytes = await resolveVideoBytes(input.videoUrl);
    if (!videoBytes || videoBytes.length === 0) {
      return {
        channelKey: "youtube",
        channelName: chName,
        mode: "live_api",
        status: "failed",
        externalUrl: "",
        responseNote: "\u0E01\u0E32\u0E23\u0E2D\u0E31\u0E1B\u0E42\u0E2B\u0E25\u0E14\u0E02\u0E36\u0E49\u0E19 YouTube Data API v3 \u0E15\u0E49\u0E2D\u0E07\u0E41\u0E19\u0E1A\u0E44\u0E1F\u0E25\u0E4C\u0E27\u0E34\u0E14\u0E35\u0E42\u0E2D .mp4 \u0E08\u0E23\u0E34\u0E07 (\u0E2A\u0E32\u0E21\u0E32\u0E23\u0E16\u0E2A\u0E23\u0E49\u0E32\u0E07\u0E27\u0E34\u0E14\u0E35\u0E42\u0E2D\u0E08\u0E23\u0E34\u0E07\u0E08\u0E32\u0E01 Google Flow / Veo Studio \u0E41\u0E25\u0E49\u0E27\u0E40\u0E25\u0E37\u0E2D\u0E01\u0E41\u0E19\u0E1A\u0E44\u0E14\u0E49\u0E17\u0E31\u0E19\u0E17\u0E35)"
      };
    }
    const initResp = await fetch(
      "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json; charset=UTF-8",
          "X-Upload-Content-Length": String(videoBytes.length),
          "X-Upload-Content-Type": "video/mp4"
        },
        body: JSON.stringify({
          snippet: {
            title: input.title.slice(0, 95),
            description: input.content.slice(0, 4800),
            tags: ["\u0E04\u0E21\u0E04\u0E34\u0E14byKOMKRIT", "\u0E01\u0E32\u0E23\u0E28\u0E36\u0E01\u0E29\u0E32", "AI"],
            categoryId: "27"
            // Education
          },
          status: {
            privacyStatus: "public"
          }
        })
      }
    );
    if (!initResp.ok) {
      const errTxt = await initResp.text();
      return {
        channelKey: "youtube",
        channelName: chName,
        mode: "live_api",
        status: "failed",
        externalUrl: "",
        responseNote: `YouTube Upload Init Error (HTTP ${initResp.status}): ${errTxt.slice(0, 160)}`
      };
    }
    const uploadUrl = initResp.headers.get("location");
    if (!uploadUrl) {
      return {
        channelKey: "youtube",
        channelName: chName,
        mode: "live_api",
        status: "failed",
        externalUrl: "",
        responseNote: "\u0E44\u0E21\u0E48\u0E44\u0E14\u0E49\u0E23\u0E31\u0E1A Resumable Upload URL \u0E08\u0E32\u0E01 YouTube Data API v3"
      };
    }
    const putResp = await fetch(uploadUrl, {
      method: "PUT",
      headers: {
        "Content-Type": "video/mp4",
        "Content-Length": String(videoBytes.length)
      },
      body: new Uint8Array(videoBytes)
    });
    const ytJson = await putResp.json();
    if (!putResp.ok) {
      return {
        channelKey: "youtube",
        channelName: chName,
        mode: "live_api",
        status: "failed",
        externalUrl: "",
        responseNote: `YouTube Video Upload Error (HTTP ${putResp.status}): ${ytJson?.error?.message || "\u0E2D\u0E31\u0E1B\u0E42\u0E2B\u0E25\u0E14\u0E44\u0E21\u0E48\u0E2A\u0E33\u0E40\u0E23\u0E47\u0E08"}`
      };
    }
    return {
      channelKey: "youtube",
      channelName: chName,
      mode: "live_api",
      status: "published",
      externalUrl: ytJson?.id ? `https://www.youtube.com/watch?v=${ytJson.id}` : "",
      responseNote: `\u0E2D\u0E31\u0E1B\u0E42\u0E2B\u0E25\u0E14\u0E27\u0E34\u0E14\u0E35\u0E42\u0E2D .mp4 \u0E02\u0E36\u0E49\u0E19 YouTube \u0E08\u0E23\u0E34\u0E07\u0E2A\u0E33\u0E40\u0E23\u0E47\u0E08! (Video ID: ${ytJson?.id})`
    };
  }
  if (input.channelKey === "tiktok") {
    if (!token) {
      return {
        channelKey: "tiktok",
        channelName: chName,
        mode: "unconfigured",
        status: "failed",
        externalUrl: "",
        responseNote: "\u0E22\u0E31\u0E07\u0E44\u0E21\u0E48\u0E44\u0E14\u0E49\u0E43\u0E2A\u0E48 TikTok Content Posting API v2 Access Token (\u0E2B\u0E23\u0E37\u0E2D Webhook URL) \u0E2A\u0E33\u0E2B\u0E23\u0E31\u0E1A\u0E42\u0E1E\u0E2A\u0E15\u0E4C\u0E27\u0E34\u0E14\u0E35\u0E42\u0E2D\u0E08\u0E23\u0E34\u0E07"
      };
    }
    const videoBytes = await resolveVideoBytes(input.videoUrl);
    if (!videoBytes && !/^https:\/\//i.test(input.videoUrl)) {
      return {
        channelKey: "tiktok",
        channelName: chName,
        mode: "live_api",
        status: "failed",
        externalUrl: "",
        responseNote: "TikTok Content Posting API \u0E15\u0E49\u0E2D\u0E07\u0E21\u0E35\u0E44\u0E1F\u0E25\u0E4C\u0E27\u0E34\u0E14\u0E35\u0E42\u0E2D .mp4 \u0E08\u0E23\u0E34\u0E07 (\u0E2A\u0E23\u0E49\u0E32\u0E07\u0E08\u0E32\u0E01 Google Veo / Flow Studio \u0E01\u0E48\u0E2D\u0E19\u0E2A\u0E48\u0E07\u0E40\u0E1C\u0E22\u0E41\u0E1E\u0E23\u0E48)"
      };
    }
    if (videoBytes && videoBytes.length > 0) {
      const initResp = await fetch(
        "https://open.tiktokapis.com/v2/post/publish/video/init/",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json; charset=UTF-8"
          },
          body: JSON.stringify({
            post_info: {
              title: `${input.title} #\u0E04\u0E21\u0E04\u0E34\u0E14byKOMKRIT`.slice(0, 140),
              privacy_level: "PUBLIC_TO_EVERYONE"
            },
            source_info: {
              source: "FILE_UPLOAD",
              video_size: videoBytes.length,
              chunk_size: videoBytes.length,
              total_chunk_count: 1
            }
          })
        }
      );
      const initJson = await initResp.json();
      if (!initResp.ok || !initJson?.data?.upload_url) {
        return {
          channelKey: "tiktok",
          channelName: chName,
          mode: "live_api",
          status: "failed",
          externalUrl: "",
          responseNote: `TikTok API Init Error (HTTP ${initResp.status}): ${initJson?.error?.message || JSON.stringify(initJson).slice(0, 150)}`
        };
      }
      const putResp = await fetch(initJson.data.upload_url, {
        method: "PUT",
        headers: {
          "Content-Type": "video/mp4",
          "Content-Length": String(videoBytes.length),
          "Content-Range": `bytes 0-${videoBytes.length - 1}/${videoBytes.length}`
        },
        body: new Uint8Array(videoBytes)
      });
      if (!putResp.ok) {
        return {
          channelKey: "tiktok",
          channelName: chName,
          mode: "live_api",
          status: "failed",
          externalUrl: "",
          responseNote: `TikTok Video Upload Error (HTTP ${putResp.status})`
        };
      }
      return {
        channelKey: "tiktok",
        channelName: chName,
        mode: "live_api",
        status: "published",
        externalUrl: cfg?.handle_or_url || "https://tiktok.com",
        responseNote: `\u0E2D\u0E31\u0E1B\u0E42\u0E2B\u0E25\u0E14\u0E27\u0E34\u0E14\u0E35\u0E42\u0E2D\u0E02\u0E36\u0E49\u0E19 TikTok \u0E08\u0E23\u0E34\u0E07\u0E2A\u0E33\u0E40\u0E23\u0E47\u0E08! (Publish ID: ${initJson.data.publish_id})`
      };
    }
    const pullResp = await fetch(
      "https://open.tiktokapis.com/v2/post/publish/video/init/",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json; charset=UTF-8"
        },
        body: JSON.stringify({
          post_info: {
            title: `${input.title} #\u0E04\u0E21\u0E04\u0E34\u0E14byKOMKRIT`.slice(0, 140),
            privacy_level: "PUBLIC_TO_EVERYONE"
          },
          source_info: {
            source: "PULL_FROM_URL",
            video_url: input.videoUrl
          }
        })
      }
    );
    const pullJson = await pullResp.json();
    if (!pullResp.ok) {
      return {
        channelKey: "tiktok",
        channelName: chName,
        mode: "live_api",
        status: "failed",
        externalUrl: "",
        responseNote: `TikTok API Error (HTTP ${pullResp.status}): ${pullJson?.error?.message || "\u0E2A\u0E48\u0E07\u0E27\u0E34\u0E14\u0E35\u0E42\u0E2D\u0E44\u0E21\u0E48\u0E2A\u0E33\u0E40\u0E23\u0E47\u0E08"}`
      };
    }
    return {
      channelKey: "tiktok",
      channelName: chName,
      mode: "live_api",
      status: "published",
      externalUrl: cfg?.handle_or_url || "https://tiktok.com",
      responseNote: `\u0E42\u0E1E\u0E2A\u0E15\u0E4C\u0E27\u0E34\u0E14\u0E35\u0E42\u0E2D\u0E02\u0E36\u0E49\u0E19 TikTok \u0E08\u0E23\u0E34\u0E07\u0E2A\u0E33\u0E40\u0E23\u0E47\u0E08 (Publish ID: ${pullJson?.data?.publish_id})`
    };
  }
  return {
    channelKey: input.channelKey,
    channelName: chName,
    mode: "unconfigured",
    status: "failed",
    externalUrl: "",
    responseNote: `\u0E44\u0E21\u0E48\u0E1E\u0E1A\u0E01\u0E32\u0E23\u0E15\u0E31\u0E49\u0E07\u0E04\u0E48\u0E32 API \u0E2A\u0E33\u0E2B\u0E23\u0E31\u0E1A\u0E0A\u0E48\u0E2D\u0E07\u0E17\u0E32\u0E07 ${chName}`
  };
}

// server/auth.ts
import crypto3 from "node:crypto";
var TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1e3;
function getAuthSecret() {
  const configured = getSettingValue("admin_auth_secret", "ADMIN_AUTH_SECRET");
  if (configured) return configured;
  return `komkrit-admin-hmac-${process.env.VERCEL_PROJECT_ID || "local-secret-key-2026"}`;
}
function getAdminCredentials() {
  const rawUser = getSettingValue("admin_username", "ADMIN_USERNAME");
  const rawPass = getSettingValue("admin_password", "ADMIN_PASSWORD");
  const username = rawUser && rawUser !== "change-me-admin" ? rawUser : "admin";
  const password = rawPass && rawPass !== "change-me-strong-password" ? rawPass : "komkrit2026";
  return { username, password };
}
function safeEqual(a, b) {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) return false;
  return crypto3.timingSafeEqual(bufA, bufB);
}
function verifyCredentials(usernameInput, passwordInput) {
  const { username, password } = getAdminCredentials();
  return safeEqual(usernameInput.trim(), username) && safeEqual(passwordInput, password);
}
function createAdminToken(username) {
  const expiresAt = Date.now() + TOKEN_TTL_MS;
  const payload = Buffer.from(
    JSON.stringify({ u: username, exp: expiresAt }),
    "utf8"
  ).toString("base64url");
  const sig = crypto3.createHmac("sha256", getAuthSecret()).update(payload).digest("base64url");
  return {
    token: `${payload}.${sig}`,
    expiresAt
  };
}
function verifyAdminToken(token) {
  if (!token || !token.includes(".")) return { valid: false };
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return { valid: false };
  const expectedSig = crypto3.createHmac("sha256", getAuthSecret()).update(payload).digest("base64url");
  if (!safeEqual(sig, expectedSig)) return { valid: false };
  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (!parsed?.exp || Date.now() > Number(parsed.exp)) {
      return { valid: false };
    }
    return { valid: true, username: String(parsed.u || "admin") };
  } catch {
    return { valid: false };
  }
}
function extractBearerToken(req) {
  const header = req.headers.authorization || "";
  if (header.startsWith("Bearer ")) {
    return header.slice(7).trim();
  }
  return null;
}
function isRequestAdmin(req) {
  const token = extractBearerToken(req);
  return verifyAdminToken(token).valid;
}
function requireAdminAuth(req, res, next) {
  const token = extractBearerToken(req);
  const check = verifyAdminToken(token);
  if (!check.valid) {
    res.status(401).json({ error: "\u0E01\u0E23\u0E38\u0E13\u0E32\u0E40\u0E02\u0E49\u0E32\u0E2A\u0E39\u0E48\u0E23\u0E30\u0E1A\u0E1A\u0E1C\u0E39\u0E49\u0E14\u0E39\u0E41\u0E25 (Admin) \u0E01\u0E48\u0E2D\u0E19\u0E43\u0E0A\u0E49\u0E07\u0E32\u0E19\u0E2A\u0E48\u0E27\u0E19\u0E19\u0E35\u0E49" });
    return;
  }
  next();
}
function updateAdminCredentials(newUsername, newPassword) {
  const upsert = db.prepare(`
    INSERT INTO settings (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `);
  if (newUsername.trim()) {
    upsert.run("admin_username", newUsername.trim());
  }
  if (newPassword.trim()) {
    upsert.run("admin_password", newPassword.trim());
  }
}

// server/index.ts
initDatabase();
var VAULT_COOKIE_NAME = "komkrit_vault";
var VAULT_UPDATED_AT_KEY = "_vault_updated_at";
function getLocalVaultUpdatedAt() {
  const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(VAULT_UPDATED_AT_KEY);
  const n = Number(row?.value || "0");
  return Number.isFinite(n) ? n : 0;
}
function hasAnyStoredApiSecret() {
  const rows = db.prepare("SELECT key, value FROM settings").all();
  return rows.some(
    (r) => SECRET_SETTING_KEYS.has(r.key) && Boolean(String(r.value || "").trim())
  );
}
function exportEncryptedSettingsMap() {
  const rows = db.prepare("SELECT key, value FROM settings").all();
  const map = {};
  for (const r of rows) {
    if (!r.key || r.key === "dynamic_model_discovery_v1") continue;
    const raw = String(r.value ?? "").trim();
    if (SECRET_SETTING_KEYS.has(r.key)) {
      map[r.key] = raw ? encryptSecretValue(raw, r.key) : "";
    } else {
      map[r.key] = raw;
    }
  }
  return map;
}
function parseCookieToken(cookieHeader, name) {
  if (!cookieHeader) return "";
  const parts = cookieHeader.split(";");
  for (const part of parts) {
    const eqIdx = part.indexOf("=");
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
  return "";
}
function writeSealedVaultCookie(req, res, sealedToken) {
  if (!sealedToken) return;
  const isHttps = req.secure || req.headers["x-forwarded-proto"] === "https" || IS_SERVERLESS;
  res.setHeader(
    "Set-Cookie",
    `${VAULT_COOKIE_NAME}=${encodeURIComponent(
      sealedToken
    )}; Path=/api; Max-Age=31536000; HttpOnly; SameSite=Lax${isHttps ? "; Secure" : ""}`
  );
}
function syncSettingsFromRequestVault(req, res) {
  const headerVal = typeof req.headers["x-komkrit-sealed-vault"] === "string" ? req.headers["x-komkrit-sealed-vault"].trim() : "";
  const cookieVal = parseCookieToken(req.headers.cookie, VAULT_COOKIE_NAME);
  const candidates = [
    { source: "header", raw: headerVal, parsed: unsealSettingsVaultWithMeta(headerVal) },
    { source: "cookie", raw: cookieVal, parsed: unsealSettingsVaultWithMeta(cookieVal) }
  ].filter((c) => c.parsed !== null);
  if (candidates.length === 0) return;
  candidates.sort((a, b) => b.parsed.updatedAt - a.parsed.updatedAt);
  const best = candidates[0];
  const localUpdatedAt = getLocalVaultUpdatedAt();
  const bestHasAnySecret = Object.entries(best.parsed.rows).some(
    ([k, v]) => SECRET_SETTING_KEYS.has(k) && Boolean(String(v || "").trim())
  );
  if (best.parsed.updatedAt > localUpdatedAt || localUpdatedAt === 0 && !hasAnyStoredApiSecret() && bestHasAnySecret) {
    const setStmt = db.prepare(
      "INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)"
    );
    for (const [k, v] of Object.entries(best.parsed.rows)) {
      if (!k || typeof v !== "string") continue;
      const trimmed = v.trim();
      if (SECRET_SETTING_KEYS.has(k)) {
        const safeVal = trimmed ? isEncryptedSecret(trimmed) ? trimmed : encryptSecretValue(trimmed, k) : "";
        setStmt.run(k, safeVal);
      } else {
        setStmt.run(k, trimmed);
      }
    }
    const effectiveTs = best.parsed.updatedAt || Date.now();
    setStmt.run(VAULT_UPDATED_AT_KEY, String(effectiveTs));
    invalidateModelCatalogCache();
  }
  if (!cookieVal || best.source === "header" && cookieVal !== best.raw) {
    writeSealedVaultCookie(req, res, best.raw);
  }
}
var app = express();
app.use(express.json({ limit: "50mb" }));
var UPLOADS_DIR = UPLOADS_ROOT;
if (!fs4.existsSync(UPLOADS_DIR)) {
  fs4.mkdirSync(UPLOADS_DIR, { recursive: true });
}
app.use("/uploads", express.static(UPLOADS_DIR));
var handleHealthCheck = (_req, res) => {
  res.json({
    ok: true,
    service: "komkid-by-komkrit-aiflow",
    runtime: IS_SERVERLESS ? "vercel-serverless" : "node-server",
    cloudStorage: isCloudSyncEnabled() ? "vercel-blob-encrypted-sqlite" : "local-sqlite-disk",
    node: process.version,
    timestamp: (/* @__PURE__ */ new Date()).toISOString()
  });
};
app.get("/health", handleHealthCheck);
app.get("/api/health", handleHealthCheck);
app.use("/api", async (req, res, next) => {
  if (req.path === "/health") return next();
  try {
    const isMutation = req.method === "POST" || req.method === "PUT" || req.method === "DELETE" || req.method === "GET" && req.query.incrementView === "1";
    await syncDatabaseBeforeRequest(isMutation);
    if (isMutation && req.path !== "/auth/login") {
      const origJson = res.json.bind(res);
      res.json = ((body) => {
        if (res.statusCode < 400) {
          persistDatabaseToCloud().catch((err) => console.error("Cloud DB persist error:", err)).finally(() => origJson(body));
          return res;
        }
        return origJson(body);
      });
    }
    next();
  } catch (err) {
    console.error("Cloud DB sync error:", err);
    next();
  }
});
app.use("/api", (req, res, next) => {
  const p = req.path;
  const m = req.method.toUpperCase();
  if (m === "GET" && p === "/health") return next();
  if (p === "/auth/login" || p === "/auth/me") return next();
  if (m === "GET" && (p === "/posts" || /^\/posts\/\d+$/.test(p))) return next();
  if (m === "POST" && /^\/posts\/\d+\/comments$/.test(p)) return next();
  if (m === "GET" && p === "/pillars") return next();
  if (m === "POST" && (p === "/subscribers" || p === "/contacts" || p === "/surveys")) {
    return next();
  }
  return requireAdminAuth(req, res, () => {
    syncSettingsFromRequestVault(req, res);
    next();
  });
});
app.post("/api/auth/login", (req, res) => {
  const { username = "", password = "" } = req.body || {};
  if (!verifyCredentials(String(username), String(password))) {
    res.status(401).json({ error: "\u0E0A\u0E37\u0E48\u0E2D\u0E1C\u0E39\u0E49\u0E43\u0E0A\u0E49\u0E07\u0E32\u0E19\u0E2B\u0E23\u0E37\u0E2D\u0E23\u0E2B\u0E31\u0E2A\u0E1C\u0E48\u0E32\u0E19\u0E44\u0E21\u0E48\u0E16\u0E39\u0E01\u0E15\u0E49\u0E2D\u0E07" });
    return;
  }
  const { token, expiresAt } = createAdminToken(String(username).trim());
  res.json({ ok: true, token, username: String(username).trim(), expiresAt });
});
app.get("/api/auth/me", (req, res) => {
  const check = verifyAdminToken(extractBearerToken(req));
  if (!check.valid) {
    res.status(401).json({ authenticated: false });
    return;
  }
  res.json({ authenticated: true, username: check.username });
});
app.put("/api/auth/password", (req, res) => {
  const { currentPassword = "", newUsername = "", newPassword = "" } = req.body || {};
  const check = verifyAdminToken(extractBearerToken(req));
  if (!check.valid || !verifyCredentials(check.username || "admin", String(currentPassword))) {
    res.status(400).json({ error: "\u0E23\u0E2B\u0E31\u0E2A\u0E1C\u0E48\u0E32\u0E19\u0E1B\u0E31\u0E08\u0E08\u0E38\u0E1A\u0E31\u0E19\u0E44\u0E21\u0E48\u0E16\u0E39\u0E01\u0E15\u0E49\u0E2D\u0E07" });
    return;
  }
  if (!String(newPassword).trim() || String(newPassword).trim().length < 6) {
    res.status(400).json({ error: "\u0E23\u0E2B\u0E31\u0E2A\u0E1C\u0E48\u0E32\u0E19\u0E43\u0E2B\u0E21\u0E48\u0E15\u0E49\u0E2D\u0E07\u0E21\u0E35\u0E2D\u0E22\u0E48\u0E32\u0E07\u0E19\u0E49\u0E2D\u0E22 6 \u0E15\u0E31\u0E27\u0E2D\u0E31\u0E01\u0E29\u0E23" });
    return;
  }
  updateAdminCredentials(String(newUsername || check.username || "admin"), String(newPassword));
  const { token, expiresAt } = createAdminToken(
    String(newUsername || check.username || "admin").trim()
  );
  res.json({ ok: true, token, expiresAt });
});
var storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOADS_DIR),
  filename: (_req, file, cb) => {
    const ext = path4.extname(file.originalname || ".jpg") || ".jpg";
    cb(null, `komkrit-${Date.now()}-${Math.round(Math.random() * 1e5)}${ext}`);
  }
});
var upload = multer({ storage, limits: { fileSize: 100 * 1024 * 1024 } });
function maskSecret(val) {
  return maskSecretStrict(val);
}
function mapPostRow(r) {
  let tags = [];
  try {
    tags = JSON.parse(r.tags_json || "[]");
  } catch {
    tags = [];
  }
  return {
    id: r.id,
    title: r.title,
    subtitle: r.subtitle || "",
    excerpt: r.excerpt,
    content: r.content,
    category: r.category,
    contentType: r.content_type,
    coverImage: r.cover_image,
    videoUrl: r.video_url || "",
    audioUrl: r.audio_url || "",
    tags,
    author: r.author,
    status: r.status,
    isFeatured: Boolean(r.is_featured),
    views: Number(r.views || 0),
    commentsCount: Number(r.comments_count || 0),
    aiWorkflowId: r.ai_workflow_id ?? null,
    createdAt: r.created_at,
    updatedAt: r.updated_at
  };
}
function mapWorkflowRow(r) {
  const safeParse = (s, fallback = {}) => {
    try {
      return JSON.parse(s || "{}");
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
    updatedAt: r.updated_at
  };
}
function mapFlowProjectRow(r) {
  let scenes = [];
  try {
    scenes = JSON.parse(r.scenes_json || "[]");
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
    masterVideoUrl: r.master_video_url || "",
    voiceoverAudioUrl: r.voiceover_audio_url || "",
    status: r.status,
    createdAt: r.created_at,
    updatedAt: r.updated_at
  };
}
app.post("/api/upload", upload.single("file"), async (req, res) => {
  if (!req.file) {
    res.status(400).json({ error: "\u0E44\u0E21\u0E48\u0E1E\u0E1A\u0E44\u0E1F\u0E25\u0E4C\u0E17\u0E35\u0E48\u0E2D\u0E31\u0E1B\u0E42\u0E2B\u0E25\u0E14" });
    return;
  }
  const fileBuffer = fs4.readFileSync(req.file.path);
  const cloudUrl = await uploadMediaToCloudBlob(
    fileBuffer,
    req.file.filename,
    req.file.mimetype
  );
  if (cloudUrl) {
    res.json({ url: cloudUrl });
    return;
  }
  if (IS_SERVERLESS && req.file.mimetype.startsWith("image/") && req.file.size <= 4 * 1024 * 1024) {
    res.json({ url: `data:${req.file.mimetype};base64,${fileBuffer.toString("base64")}` });
    return;
  }
  res.json({ url: `/uploads/${req.file.filename}` });
});
app.get("/api/stats", (_req, res) => {
  const postsTotal = db.prepare("SELECT COUNT(*) as c FROM posts").get().c;
  const postsPublished = db.prepare("SELECT COUNT(*) as c FROM posts WHERE status = 'published'").get().c;
  const totalViews = db.prepare("SELECT COALESCE(SUM(views), 0) as v FROM posts").get().v || 0;
  const totalComments = db.prepare("SELECT COUNT(*) as c FROM comments").get().c;
  const totalWorkflows = db.prepare("SELECT COUNT(*) as c FROM ai_workflows").get().c;
  const pendingApprovals = db.prepare(
    "SELECT COUNT(*) as c FROM ai_workflows WHERE status IN ('pending_approval', 'revision_requested')"
  ).get().c;
  const totalSubscribers = db.prepare("SELECT COUNT(*) as c FROM subscribers").get().c;
  const unreadContacts = db.prepare("SELECT COUNT(*) as c FROM contacts WHERE status = 'unread'").get().c;
  const kbCount = db.prepare("SELECT COUNT(*) as c FROM knowledge_base").get().c;
  const mediaAssetsCount = db.prepare("SELECT COUNT(*) as c FROM ai_media_assets").get().c;
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
    mediaAssetsCount
  });
});
app.get("/api/posts", (req, res) => {
  const { category, type, status, q } = req.query;
  const conditions = [];
  const params = [];
  const isAdmin = isRequestAdmin(req);
  if (category && category !== "all") {
    conditions.push("p.category = ?");
    params.push(String(category));
  }
  if (type && type !== "all") {
    conditions.push("p.content_type = ?");
    params.push(String(type));
  }
  if (!isAdmin) {
    conditions.push("p.status = 'published'");
  } else if (status && status !== "all") {
    conditions.push("p.status = ?");
    params.push(String(status));
  }
  if (q && String(q).trim()) {
    const term = `%${String(q).trim()}%`;
    conditions.push(
      "(p.title LIKE ? OR p.subtitle LIKE ? OR p.excerpt LIKE ? OR p.content LIKE ? OR p.tags_json LIKE ?)"
    );
    params.push(term, term, term, term, term);
  }
  const whereSql = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
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
app.get("/api/posts/:id", (req, res) => {
  const id = Number(req.params.id);
  if (req.query.incrementView === "1") {
    db.prepare("UPDATE posts SET views = views + 1 WHERE id = ?").run(id);
  }
  const row = db.prepare(
    `SELECT p.*, (SELECT COUNT(*) FROM comments c WHERE c.post_id = p.id) AS comments_count
       FROM posts p WHERE p.id = ?`
  ).get(id);
  if (!row || !isRequestAdmin(req) && row.status !== "published") {
    res.status(404).json({ error: "\u0E44\u0E21\u0E48\u0E1E\u0E1A\u0E1A\u0E17\u0E04\u0E27\u0E32\u0E21" });
    return;
  }
  const comments = db.prepare("SELECT * FROM comments WHERE post_id = ? ORDER BY created_at DESC, id DESC").all(id).map((c) => ({
    id: c.id,
    postId: c.post_id,
    authorName: c.author_name,
    authorRole: c.author_role,
    message: c.message,
    rating: c.rating,
    createdAt: c.created_at
  }));
  res.json({ post: mapPostRow(row), comments });
});
app.post("/api/posts", (req, res) => {
  const {
    title,
    subtitle = "",
    excerpt = "",
    content = "",
    category = "education",
    contentType = "article",
    coverImage = "/images/thumb-ai-edu.jpg",
    videoUrl = "",
    audioUrl = "",
    tags = [],
    author = "\u0E04\u0E21\u0E01\u0E24\u0E0A (Komkrit)",
    status = "published",
    isFeatured = false
  } = req.body;
  if (!title || !String(title).trim()) {
    res.status(400).json({ error: "\u0E01\u0E23\u0E38\u0E13\u0E32\u0E23\u0E30\u0E1A\u0E38\u0E2B\u0E31\u0E27\u0E02\u0E49\u0E2D\u0E1A\u0E17\u0E04\u0E27\u0E32\u0E21/\u0E42\u0E1E\u0E2A\u0E15\u0E4C" });
    return;
  }
  if (isFeatured) {
    db.prepare("UPDATE posts SET is_featured = 0").run();
  }
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const autoExcerpt = excerpt && String(excerpt).trim() ? String(excerpt).trim() : String(content).replace(/!\[[^\]]*\]\([^)]+\)/g, "").replace(/[#>*_`]/g, "").replace(/\s+/g, " ").trim().slice(0, 180);
  const result = db.prepare(
    `INSERT INTO posts (
        title, subtitle, excerpt, content, category, content_type, cover_image,
        video_url, audio_url, tags_json, author, status, is_featured, views, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`
  ).run(
    String(title).trim(),
    String(subtitle),
    autoExcerpt,
    String(content),
    String(category),
    String(contentType),
    String(coverImage || "/images/thumb-ai-edu.jpg"),
    String(videoUrl || ""),
    String(audioUrl || ""),
    JSON.stringify(Array.isArray(tags) ? tags : []),
    String(author || "\u0E04\u0E21\u0E01\u0E24\u0E0A (Komkrit)"),
    String(status),
    isFeatured ? 1 : 0,
    now,
    now
  );
  const created = db.prepare(`SELECT p.*, 0 AS comments_count FROM posts p WHERE p.id = ?`).get(Number(result.lastInsertRowid));
  res.status(201).json(mapPostRow(created));
});
app.put("/api/posts/:id", (req, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare("SELECT * FROM posts WHERE id = ?").get(id);
  if (!existing) {
    res.status(404).json({ error: "\u0E44\u0E21\u0E48\u0E1E\u0E1A\u0E1A\u0E17\u0E04\u0E27\u0E32\u0E21\u0E17\u0E35\u0E48\u0E15\u0E49\u0E2D\u0E07\u0E01\u0E32\u0E23\u0E41\u0E01\u0E49\u0E44\u0E02" });
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
    audioUrl = existing.audio_url || "",
    tags,
    author = existing.author,
    status = existing.status,
    isFeatured,
    views
  } = req.body;
  const nextFeatured = typeof isFeatured === "boolean" ? isFeatured ? 1 : 0 : existing.is_featured;
  const nextViews = typeof views === "number" && Number.isFinite(views) && views >= 0 ? Math.floor(views) : Number(existing.views || 0);
  if (nextFeatured === 1 && existing.is_featured === 0) {
    db.prepare("UPDATE posts SET is_featured = 0").run();
  }
  const tagsJson = Array.isArray(tags) ? JSON.stringify(tags) : existing.tags_json;
  const now = (/* @__PURE__ */ new Date()).toISOString();
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
    String(videoUrl || ""),
    String(audioUrl || ""),
    tagsJson,
    String(author),
    String(status),
    nextFeatured,
    nextViews,
    now,
    id
  );
  const updated = db.prepare(
    `SELECT p.*, (SELECT COUNT(*) FROM comments c WHERE c.post_id = p.id) AS comments_count
       FROM posts p WHERE p.id = ?`
  ).get(id);
  res.json(mapPostRow(updated));
});
app.post("/api/posts/:id/duplicate", (req, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare("SELECT * FROM posts WHERE id = ?").get(id);
  if (!existing) {
    res.status(404).json({ error: "\u0E44\u0E21\u0E48\u0E1E\u0E1A\u0E1A\u0E17\u0E04\u0E27\u0E32\u0E21\u0E17\u0E35\u0E48\u0E15\u0E49\u0E2D\u0E07\u0E01\u0E32\u0E23\u0E04\u0E31\u0E14\u0E25\u0E2D\u0E01" });
    return;
  }
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const copyTitle = `${String(existing.title).trim()} (\u0E2A\u0E33\u0E40\u0E19\u0E32)`;
  const r = db.prepare(
    `INSERT INTO posts (
        title, subtitle, excerpt, content, category, content_type, cover_image,
        video_url, audio_url, tags_json, author, status, is_featured, views, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', 0, 0, ?, ?)`
  ).run(
    copyTitle,
    String(existing.subtitle || ""),
    String(existing.excerpt || ""),
    String(existing.content || ""),
    String(existing.category || "education"),
    String(existing.content_type || "article"),
    String(existing.cover_image || "/images/thumb-ai-edu.jpg"),
    String(existing.video_url || ""),
    String(existing.audio_url || ""),
    String(existing.tags_json || "[]"),
    String(existing.author || "\u0E04\u0E21\u0E01\u0E24\u0E0A (Komkrit)"),
    now,
    now
  );
  const created = db.prepare(`SELECT p.*, 0 AS comments_count FROM posts p WHERE p.id = ?`).get(Number(r.lastInsertRowid));
  res.status(201).json(mapPostRow(created));
});
app.post("/api/posts/bulk", (req, res) => {
  const { ids, action, category } = req.body || {};
  if (!Array.isArray(ids) || ids.length === 0) {
    res.status(400).json({ error: "\u0E01\u0E23\u0E38\u0E13\u0E32\u0E40\u0E25\u0E37\u0E2D\u0E01\u0E23\u0E32\u0E22\u0E01\u0E32\u0E23\u0E02\u0E48\u0E32\u0E27\u0E2D\u0E22\u0E48\u0E32\u0E07\u0E19\u0E49\u0E2D\u0E22 1 \u0E23\u0E32\u0E22\u0E01\u0E32\u0E23" });
    return;
  }
  const cleanIds = ids.map((x) => Number(x)).filter((n) => Number.isInteger(n) && n > 0);
  if (cleanIds.length === 0) {
    res.status(400).json({ error: "\u0E23\u0E2B\u0E31\u0E2A\u0E23\u0E32\u0E22\u0E01\u0E32\u0E23\u0E44\u0E21\u0E48\u0E16\u0E39\u0E01\u0E15\u0E49\u0E2D\u0E07" });
    return;
  }
  const now = (/* @__PURE__ */ new Date()).toISOString();
  db.exec("BEGIN IMMEDIATE");
  try {
    if (action === "publish" || action === "draft") {
      const targetStatus = action === "publish" ? "published" : "draft";
      const stmt = db.prepare("UPDATE posts SET status = ?, updated_at = ? WHERE id = ?");
      for (const pid of cleanIds) {
        stmt.run(targetStatus, now, pid);
      }
    } else if (action === "category" && category) {
      const stmt = db.prepare("UPDATE posts SET category = ?, updated_at = ? WHERE id = ?");
      for (const pid of cleanIds) {
        stmt.run(String(category), now, pid);
      }
    } else if (action === "delete") {
      const delComments = db.prepare("DELETE FROM comments WHERE post_id = ?");
      const delPost = db.prepare("DELETE FROM posts WHERE id = ?");
      for (const pid of cleanIds) {
        delComments.run(pid);
        delPost.run(pid);
      }
    } else {
      db.exec("ROLLBACK");
      res.status(400).json({ error: "\u0E04\u0E33\u0E2A\u0E31\u0E48\u0E07\u0E08\u0E31\u0E14\u0E01\u0E32\u0E23\u0E2B\u0E25\u0E32\u0E22\u0E23\u0E32\u0E22\u0E01\u0E32\u0E23 (bulk action) \u0E44\u0E21\u0E48\u0E16\u0E39\u0E01\u0E15\u0E49\u0E2D\u0E07" });
      return;
    }
    db.exec("COMMIT");
    res.json({ ok: true, affected: cleanIds.length, action });
  } catch (err) {
    try {
      db.exec("ROLLBACK");
    } catch {
    }
    res.status(500).json({ error: err.message });
  }
});
app.delete("/api/posts/:id", (req, res) => {
  const id = Number(req.params.id);
  db.prepare("DELETE FROM comments WHERE post_id = ?").run(id);
  db.prepare("DELETE FROM posts WHERE id = ?").run(id);
  res.json({ ok: true });
});
app.get("/api/comments", (_req, res) => {
  const rows = db.prepare(
    `SELECT c.*, p.title AS post_title
       FROM comments c
       LEFT JOIN posts p ON p.id = c.post_id
       ORDER BY c.created_at DESC, c.id DESC`
  ).all().map((c) => ({
    id: c.id,
    postId: c.post_id,
    postTitle: c.post_title || "\u0E1A\u0E17\u0E04\u0E27\u0E32\u0E21",
    authorName: c.author_name,
    authorRole: c.author_role,
    message: c.message,
    rating: c.rating,
    createdAt: c.created_at
  }));
  res.json(rows);
});
app.post("/api/posts/:id/comments", (req, res) => {
  const postId = Number(req.params.id);
  const {
    authorName = "\u0E1C\u0E39\u0E49\u0E15\u0E34\u0E14\u0E15\u0E32\u0E21\u0E04\u0E21\u0E04\u0E34\u0E14",
    authorRole = "\u0E1C\u0E39\u0E49\u0E2A\u0E19\u0E43\u0E08\u0E17\u0E31\u0E48\u0E27\u0E44\u0E1B",
    message = "",
    rating = 5
  } = req.body;
  if (!String(message).trim()) {
    res.status(400).json({ error: "\u0E01\u0E23\u0E38\u0E13\u0E32\u0E1E\u0E34\u0E21\u0E1E\u0E4C\u0E04\u0E27\u0E32\u0E21\u0E04\u0E34\u0E14\u0E40\u0E2B\u0E47\u0E19" });
    return;
  }
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const r = db.prepare(
    `INSERT INTO comments (post_id, author_name, author_role, message, rating, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
  ).run(
    postId,
    String(authorName).trim() || "\u0E1C\u0E39\u0E49\u0E15\u0E34\u0E14\u0E15\u0E32\u0E21\u0E04\u0E21\u0E04\u0E34\u0E14",
    String(authorRole),
    String(message).trim(),
    Math.min(5, Math.max(1, Number(rating) || 5)),
    now
  );
  res.status(201).json({
    id: Number(r.lastInsertRowid),
    postId,
    authorName: String(authorName).trim() || "\u0E1C\u0E39\u0E49\u0E15\u0E34\u0E14\u0E15\u0E32\u0E21\u0E04\u0E21\u0E04\u0E34\u0E14",
    authorRole,
    message: String(message).trim(),
    rating: Number(rating) || 5,
    createdAt: now
  });
});
app.put("/api/comments/:id", (req, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare("SELECT * FROM comments WHERE id = ?").get(id);
  if (!existing) {
    res.status(404).json({ error: "\u0E44\u0E21\u0E48\u0E1E\u0E1A\u0E04\u0E27\u0E32\u0E21\u0E04\u0E34\u0E14\u0E40\u0E2B\u0E47\u0E19\u0E17\u0E35\u0E48\u0E15\u0E49\u0E2D\u0E07\u0E01\u0E32\u0E23\u0E41\u0E01\u0E49\u0E44\u0E02" });
    return;
  }
  const {
    authorName = existing.author_name,
    authorRole = existing.author_role,
    message = existing.message,
    rating = existing.rating
  } = req.body || {};
  if (!String(message).trim()) {
    res.status(400).json({ error: "\u0E01\u0E23\u0E38\u0E13\u0E32\u0E23\u0E30\u0E1A\u0E38\u0E02\u0E49\u0E2D\u0E04\u0E27\u0E32\u0E21\u0E04\u0E27\u0E32\u0E21\u0E04\u0E34\u0E14\u0E40\u0E2B\u0E47\u0E19" });
    return;
  }
  const cleanRating = Math.min(5, Math.max(1, Number(rating) || existing.rating || 5));
  db.prepare(
    `UPDATE comments SET author_name = ?, author_role = ?, message = ?, rating = ? WHERE id = ?`
  ).run(
    String(authorName).trim() || "\u0E1C\u0E39\u0E49\u0E15\u0E34\u0E14\u0E15\u0E32\u0E21\u0E04\u0E21\u0E04\u0E34\u0E14",
    String(authorRole).trim() || "\u0E1C\u0E39\u0E49\u0E2A\u0E19\u0E43\u0E08\u0E17\u0E31\u0E48\u0E27\u0E44\u0E1B",
    String(message).trim(),
    cleanRating,
    id
  );
  res.json({
    id,
    postId: existing.post_id,
    authorName: String(authorName).trim() || "\u0E1C\u0E39\u0E49\u0E15\u0E34\u0E14\u0E15\u0E32\u0E21\u0E04\u0E21\u0E04\u0E34\u0E14",
    authorRole: String(authorRole).trim() || "\u0E1C\u0E39\u0E49\u0E2A\u0E19\u0E43\u0E08\u0E17\u0E31\u0E48\u0E27\u0E44\u0E1B",
    message: String(message).trim(),
    rating: cleanRating,
    createdAt: existing.created_at
  });
});
app.delete("/api/comments/:id", (req, res) => {
  db.prepare("DELETE FROM comments WHERE id = ?").run(Number(req.params.id));
  res.json({ ok: true });
});
app.get("/api/knowledge", (_req, res) => {
  const rows = db.prepare("SELECT * FROM knowledge_base ORDER BY id DESC").all().map((k) => ({
    id: k.id,
    title: k.title,
    category: k.category,
    summary: k.summary,
    content: k.content,
    sourceRef: k.source_ref,
    isActive: Boolean(k.is_active),
    createdAt: k.created_at
  }));
  res.json(rows);
});
app.post("/api/knowledge", (req, res) => {
  const {
    title,
    category = "research",
    summary = "",
    content = "",
    sourceRef = "",
    isActive = true
  } = req.body;
  if (!title || !String(title).trim()) {
    res.status(400).json({ error: "\u0E01\u0E23\u0E38\u0E13\u0E32\u0E23\u0E30\u0E1A\u0E38\u0E0A\u0E37\u0E48\u0E2D\u0E23\u0E32\u0E22\u0E01\u0E32\u0E23\u0E10\u0E32\u0E19\u0E04\u0E27\u0E32\u0E21\u0E23\u0E39\u0E49" });
    return;
  }
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const r = db.prepare(
    `INSERT INTO knowledge_base (title, category, summary, content, source_ref, is_active, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
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
    createdAt: now
  });
});
app.put("/api/knowledge/:id", (req, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare("SELECT * FROM knowledge_base WHERE id = ?").get(id);
  if (!existing) {
    res.status(404).json({ error: "\u0E44\u0E21\u0E48\u0E1E\u0E1A\u0E10\u0E32\u0E19\u0E04\u0E27\u0E32\u0E21\u0E23\u0E39\u0E49" });
    return;
  }
  const {
    title = existing.title,
    category = existing.category,
    summary = existing.summary,
    content = existing.content,
    sourceRef = existing.source_ref,
    isActive
  } = req.body;
  const activeInt = typeof isActive === "boolean" ? isActive ? 1 : 0 : existing.is_active;
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
    createdAt: existing.created_at
  });
});
app.delete("/api/knowledge/:id", (req, res) => {
  db.prepare("DELETE FROM knowledge_base WHERE id = ?").run(Number(req.params.id));
  res.json({ ok: true });
});
app.get("/api/pillars", (_req, res) => {
  const rows = db.prepare("SELECT * FROM business_pillars ORDER BY pillar_index ASC").all().map((p) => ({
    id: p.id,
    pillarIndex: p.pillar_index,
    pillarKey: p.pillar_key,
    title: p.title,
    subtitle: p.subtitle,
    description: p.description,
    metricLabel: p.metric_label,
    metricValue: p.metric_value,
    statusBadge: p.status_badge,
    actionUrl: p.action_url
  }));
  res.json(rows);
});
app.post("/api/pillars", (req, res) => {
  const {
    pillarIndex,
    pillarKey = `pillar_${Date.now()}`,
    title,
    subtitle = "",
    description = "",
    metricLabel = "\u0E15\u0E31\u0E27\u0E0A\u0E35\u0E49\u0E27\u0E31\u0E14\u0E2B\u0E25\u0E31\u0E01 (KPI)",
    metricValue = "100%",
    statusBadge = "\u0E01\u0E33\u0E25\u0E31\u0E07\u0E14\u0E33\u0E40\u0E19\u0E34\u0E19\u0E01\u0E32\u0E23",
    actionUrl = ""
  } = req.body || {};
  if (!title || !String(title).trim()) {
    res.status(400).json({ error: "\u0E01\u0E23\u0E38\u0E13\u0E32\u0E23\u0E30\u0E1A\u0E38\u0E0A\u0E37\u0E48\u0E2D\u0E40\u0E2A\u0E32\u0E2B\u0E25\u0E31\u0E01\u0E18\u0E38\u0E23\u0E01\u0E34\u0E08" });
    return;
  }
  const maxIdxRow = db.prepare("SELECT COALESCE(MAX(pillar_index), 0) AS max_idx FROM business_pillars").get();
  const nextIndex = typeof pillarIndex === "number" && Number.isFinite(pillarIndex) ? Math.floor(pillarIndex) : Number(maxIdxRow?.max_idx || 0) + 1;
  const r = db.prepare(
    `INSERT INTO business_pillars (
        pillar_index, pillar_key, title, subtitle, description,
        metric_label, metric_value, status_badge, action_url
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
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
    actionUrl: String(actionUrl).trim()
  });
});
app.put("/api/pillars/:id", (req, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare("SELECT * FROM business_pillars WHERE id = ?").get(id);
  if (!existing) {
    res.status(404).json({ error: "\u0E44\u0E21\u0E48\u0E1E\u0E1A\u0E02\u0E49\u0E2D\u0E21\u0E39\u0E25\u0E40\u0E2A\u0E32\u0E2B\u0E25\u0E31\u0E01\u0E18\u0E38\u0E23\u0E01\u0E34\u0E08" });
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
    actionUrl = existing.action_url || ""
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
    String(statusBadge || ""),
    String(actionUrl || ""),
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
    statusBadge: String(statusBadge || ""),
    actionUrl: String(actionUrl || "")
  });
});
app.delete("/api/pillars/:id", (req, res) => {
  const id = Number(req.params.id);
  db.prepare("DELETE FROM business_pillars WHERE id = ?").run(id);
  res.json({ ok: true });
});
app.get("/api/ai/chat-sessions", (_req, res) => {
  const rows = db.prepare(
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
  ).all().map((r) => ({
    sessionId: r.session_id,
    title: String(r.first_user_msg || "\u0E2B\u0E31\u0E27\u0E02\u0E49\u0E2D\u0E2A\u0E19\u0E17\u0E19\u0E32\u0E43\u0E2B\u0E21\u0E48").slice(0, 70),
    lastMessage: String(r.last_msg || "").slice(0, 100),
    messageCount: Number(r.message_count || 0),
    provider: r.provider || "gemini",
    updatedAt: r.updated_at
  }));
  res.json(rows);
});
app.get("/api/ai/chat/:sessionId", (req, res) => {
  const sessionId = String(req.params.sessionId || "default");
  const rows = db.prepare("SELECT * FROM ai_chat_messages WHERE session_id = ? ORDER BY id ASC").all(sessionId).map((m) => ({
    id: m.id,
    sessionId: m.session_id,
    provider: m.provider,
    model: m.model,
    role: m.role,
    content: m.content,
    reasoning: m.reasoning || "",
    latencyMs: m.latency_ms || 0,
    createdAt: m.created_at
  }));
  res.json(rows);
});
app.post("/api/ai/chat", async (req, res) => {
  try {
    const {
      sessionId = "default",
      provider = "auto",
      model,
      message,
      useKnowledgeBase = true
    } = req.body;
    const reply = await chatWithRealModel({
      sessionId: String(sessionId),
      provider,
      model: model ? String(model) : void 0,
      message: String(message || ""),
      useKnowledgeBase: Boolean(useKnowledgeBase)
    });
    res.json(reply);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});
app.delete("/api/ai/chat/:sessionId", (req, res) => {
  const sessionId = String(req.params.sessionId || "default");
  db.prepare("DELETE FROM ai_chat_messages WHERE session_id = ?").run(sessionId);
  res.json({ ok: true });
});
app.post("/api/ai/evaluate-prompt", async (req, res) => {
  try {
    const { target = "image", sessionId, ideaText, aspectRatio, provider, model } = req.body || {};
    const evaluated = await evaluateAndBuildMediaPrompt({
      target: target === "video" ? "video" : "image",
      sessionId: sessionId ? String(sessionId) : void 0,
      ideaText: ideaText ? String(ideaText) : void 0,
      aspectRatio,
      provider,
      model
    });
    res.json(evaluated);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});
app.post("/api/ai/draft-from-chat", async (req, res) => {
  try {
    const { sessionId, ideaText, contentFormat, category, provider, model } = req.body || {};
    const draft = await draftContentFromChat({
      sessionId: sessionId ? String(sessionId) : void 0,
      ideaText: ideaText ? String(ideaText) : void 0,
      contentFormat,
      category,
      provider,
      model
    });
    res.json(draft);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});
app.get("/api/ai/media", (req, res) => {
  const { type } = req.query;
  const rows = type ? db.prepare("SELECT * FROM ai_media_assets WHERE media_type = ? ORDER BY id DESC LIMIT 60").all(String(type)) : db.prepare("SELECT * FROM ai_media_assets ORDER BY id DESC LIMIT 80").all();
  res.json(
    rows.map((a) => ({
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
      reviewStatus: a.review_status || "approved",
      thaiSummary: a.thai_summary || "",
      createdAt: a.created_at
    }))
  );
});
app.put("/api/ai/media/:id/review", (req, res) => {
  const id = Number(req.params.id);
  const reviewStatus = req.body?.reviewStatus === "pending_review" ? "pending_review" : "approved";
  db.prepare("UPDATE ai_media_assets SET review_status = ? WHERE id = ?").run(reviewStatus, id);
  res.json({ ok: true, id, reviewStatus });
});
app.delete("/api/ai/media/:id", async (req, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare("SELECT file_url FROM ai_media_assets WHERE id = ?").get(id);
  if (existing?.file_url) {
    if (existing.file_url.includes("blob.vercel-storage.com")) {
      await deleteMediaFromCloudBlob(existing.file_url);
    } else if (existing.file_url.startsWith("/uploads/")) {
      const abs = path4.join(UPLOADS_ROOT, existing.file_url.replace(/^\/uploads\//, ""));
      if (fs4.existsSync(abs)) {
        try {
          fs4.unlinkSync(abs);
        } catch {
        }
      }
    }
  }
  db.prepare("DELETE FROM ai_media_assets WHERE id = ?").run(id);
  res.json({ ok: true });
});
app.post("/api/ai/image/generate", async (req, res) => {
  try {
    const {
      prompt,
      provider,
      model,
      aspectRatio,
      imageSize,
      workflowId,
      thaiSummary,
      reviewStatus
    } = req.body;
    const asset = await generateRealImage({
      prompt: String(prompt || ""),
      provider,
      model,
      aspectRatio,
      imageSize,
      workflowId: workflowId ? Number(workflowId) : null,
      thaiSummary: thaiSummary ? String(thaiSummary) : "",
      reviewStatus: reviewStatus === "approved" ? "approved" : "pending_review"
    });
    if (workflowId) {
      const wfRow = db.prepare("SELECT visual_json FROM ai_workflows WHERE id = ?").get(Number(workflowId));
      if (wfRow) {
        const vj = JSON.parse(wfRow.visual_json || "{}");
        vj.generatedRealImageUrl = asset.fileUrl;
        vj.generatedSvgDataUrl = asset.fileUrl;
        db.prepare("UPDATE ai_workflows SET visual_json = ?, updated_at = ? WHERE id = ?").run(
          JSON.stringify(vj),
          (/* @__PURE__ */ new Date()).toISOString(),
          Number(workflowId)
        );
      }
    }
    res.status(201).json(asset);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});
app.post("/api/ai/video/generate", async (req, res) => {
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
      thaiSummary
    } = req.body;
    const asset = await generateRealVideo({
      prompt: String(prompt || ""),
      engine,
      aspectRatio,
      durationSec: durationSec ? Number(durationSec) : void 0,
      resolution,
      firstFrameUrl,
      lastFrameUrl,
      referenceImageUrls,
      extendVideoUrl,
      stripAudio: Boolean(stripAudio),
      previousInteractionId,
      workflowId: workflowId ? Number(workflowId) : null,
      thaiSummary: thaiSummary ? String(thaiSummary) : "",
      reviewStatus: "pending_review"
    });
    if (workflowId) {
      const wfRow = db.prepare("SELECT video_json FROM ai_workflows WHERE id = ?").get(Number(workflowId));
      if (wfRow) {
        const vidJ = JSON.parse(wfRow.video_json || "{}");
        vidJ.generatedVideoUrl = asset.fileUrl;
        vidJ.generatedVideoModel = asset.model;
        vidJ.interactionId = asset.interactionId;
        db.prepare("UPDATE ai_workflows SET video_json = ?, updated_at = ? WHERE id = ?").run(
          JSON.stringify(vidJ),
          (/* @__PURE__ */ new Date()).toISOString(),
          Number(workflowId)
        );
      }
    }
    res.status(201).json(asset);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});
app.post("/api/ai/audio/generate", async (req, res) => {
  try {
    const { text, provider, model, voice, style, workflowId } = req.body;
    const asset = await generateRealAudio({
      text: String(text || ""),
      provider,
      model: model ? String(model) : void 0,
      voice,
      style,
      workflowId: workflowId ? Number(workflowId) : null
    });
    if (workflowId) {
      const wfRow = db.prepare("SELECT audio_json FROM ai_workflows WHERE id = ?").get(Number(workflowId));
      if (wfRow) {
        const audJ = JSON.parse(wfRow.audio_json || "{}");
        audJ.generatedAudioUrl = asset.fileUrl;
        audJ.generatedAudioModel = asset.model;
        db.prepare("UPDATE ai_workflows SET audio_json = ?, updated_at = ? WHERE id = ?").run(
          JSON.stringify(audJ),
          (/* @__PURE__ */ new Date()).toISOString(),
          Number(workflowId)
        );
      }
    }
    res.status(201).json(asset);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});
app.get("/api/ai/flow/projects", (_req, res) => {
  const rows = db.prepare("SELECT * FROM flow_projects ORDER BY updated_at DESC, id DESC").all();
  res.json(rows.map(mapFlowProjectRow));
});
app.post("/api/ai/flow/projects", async (req, res) => {
  try {
    const {
      title,
      concept,
      sceneCount = 3,
      aspectRatio = "16:9",
      resolution = "720p",
      videoEngine = "",
      llmProvider,
      llmModel
    } = req.body;
    if (!title || !concept) {
      res.status(400).json({ error: "\u0E01\u0E23\u0E38\u0E13\u0E32\u0E23\u0E30\u0E1A\u0E38\u0E0A\u0E37\u0E48\u0E2D\u0E42\u0E1B\u0E23\u0E40\u0E08\u0E01\u0E15\u0E4C\u0E41\u0E25\u0E30\u0E41\u0E19\u0E27\u0E04\u0E34\u0E14\u0E20\u0E32\u0E1E\u0E22\u0E19\u0E15\u0E23\u0E4C\u0E2A\u0E33\u0E2B\u0E23\u0E31\u0E1A Google Flow" });
      return;
    }
    const storyboard = await generateFlowStoryboardWithLlm({
      title: String(title).trim(),
      concept: String(concept).trim(),
      sceneCount: Number(sceneCount) || 3,
      aspectRatio,
      provider: llmProvider,
      model: llmModel
    });
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const r = db.prepare(
      `INSERT INTO flow_projects (
          title, concept, aspect_ratio, resolution, video_engine,
          scenes_json, master_video_url, voiceover_audio_url, status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, '', '', 'storyboard_ready', ?, ?)`
    ).run(
      String(title).trim(),
      String(concept).trim(),
      String(aspectRatio),
      String(resolution),
      String(videoEngine),
      JSON.stringify(storyboard.scenes),
      now,
      now
    );
    const created = db.prepare("SELECT * FROM flow_projects WHERE id = ?").get(Number(r.lastInsertRowid));
    res.status(201).json(mapFlowProjectRow(created));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});
app.put("/api/ai/flow/projects/:id", (req, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare("SELECT * FROM flow_projects WHERE id = ?").get(id);
  if (!existing) {
    res.status(404).json({ error: "\u0E44\u0E21\u0E48\u0E1E\u0E1A\u0E42\u0E1B\u0E23\u0E40\u0E08\u0E01\u0E15\u0E4C Google Flow" });
    return;
  }
  const mapped = mapFlowProjectRow(existing);
  const {
    title = mapped.title,
    aspectRatio = mapped.aspectRatio,
    resolution = mapped.resolution,
    videoEngine = mapped.videoEngine,
    scenes = mapped.scenes
  } = req.body;
  const now = (/* @__PURE__ */ new Date()).toISOString();
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
  const updated = db.prepare("SELECT * FROM flow_projects WHERE id = ?").get(id);
  res.json(mapFlowProjectRow(updated));
});
app.post("/api/ai/flow/projects/:id/scene/:sceneIdx/frame", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const sceneIdx = Number(req.params.sceneIdx);
    const { which = "first", customPrompt, imageModel } = req.body;
    const existing = db.prepare("SELECT * FROM flow_projects WHERE id = ?").get(id);
    if (!existing) {
      res.status(404).json({ error: "\u0E44\u0E21\u0E48\u0E1E\u0E1A\u0E42\u0E1B\u0E23\u0E40\u0E08\u0E01\u0E15\u0E4C Google Flow" });
      return;
    }
    const proj = mapFlowProjectRow(existing);
    const scene = proj.scenes[sceneIdx];
    if (!scene) {
      res.status(404).json({ error: "\u0E44\u0E21\u0E48\u0E1E\u0E1A\u0E09\u0E32\u0E01\u0E17\u0E35\u0E48\u0E23\u0E30\u0E1A\u0E38" });
      return;
    }
    const promptToUse = customPrompt || (which === "last" ? scene.lastFramePrompt : scene.firstFramePrompt);
    const imgAsset = await generateRealImage({
      prompt: promptToUse,
      provider: "gemini",
      model: imageModel || void 0,
      aspectRatio: proj.aspectRatio
    });
    if (which === "last") {
      scene.lastFrameUrl = imgAsset.fileUrl;
      if (customPrompt) scene.lastFramePrompt = customPrompt;
    } else {
      scene.firstFrameUrl = imgAsset.fileUrl;
      if (customPrompt) scene.firstFramePrompt = customPrompt;
    }
    const now = (/* @__PURE__ */ new Date()).toISOString();
    db.prepare("UPDATE flow_projects SET scenes_json = ?, updated_at = ? WHERE id = ?").run(
      JSON.stringify(proj.scenes),
      now,
      id
    );
    const updated = db.prepare("SELECT * FROM flow_projects WHERE id = ?").get(id);
    res.json(mapFlowProjectRow(updated));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});
app.post("/api/ai/flow/projects/:id/scene/:sceneIdx/video", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const sceneIdx = Number(req.params.sceneIdx);
    const { mode = "keyframes", customMotionPrompt } = req.body;
    const existing = db.prepare("SELECT * FROM flow_projects WHERE id = ?").get(id);
    if (!existing) {
      res.status(404).json({ error: "\u0E44\u0E21\u0E48\u0E1E\u0E1A\u0E42\u0E1B\u0E23\u0E40\u0E08\u0E01\u0E15\u0E4C Google Flow" });
      return;
    }
    const proj = mapFlowProjectRow(existing);
    const scene = proj.scenes[sceneIdx];
    if (!scene) {
      res.status(404).json({ error: "\u0E44\u0E21\u0E48\u0E1E\u0E1A\u0E09\u0E32\u0E01\u0E17\u0E35\u0E48\u0E23\u0E30\u0E1A\u0E38" });
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
      firstFrameUrl: mode === "keyframes" ? scene.firstFrameUrl || void 0 : void 0,
      lastFrameUrl: mode === "keyframes" && scene.firstFrameUrl && scene.lastFrameUrl ? scene.lastFrameUrl : void 0,
      extendVideoUrl: mode === "extend_prev" && prevScene?.videoClipUrl ? prevScene.videoClipUrl : void 0
    });
    scene.videoClipUrl = vidAsset.fileUrl;
    scene.interactionId = vidAsset.interactionId;
    if (customMotionPrompt) scene.videoMotionPrompt = customMotionPrompt;
    const now = (/* @__PURE__ */ new Date()).toISOString();
    db.prepare(
      "UPDATE flow_projects SET scenes_json = ?, status = 'clips_rendering', updated_at = ? WHERE id = ?"
    ).run(JSON.stringify(proj.scenes), now, id);
    const updated = db.prepare("SELECT * FROM flow_projects WHERE id = ?").get(id);
    res.json(mapFlowProjectRow(updated));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});
app.post("/api/ai/flow/projects/:id/voiceover", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { voice = "Kore", provider } = req.body;
    const existing = db.prepare("SELECT * FROM flow_projects WHERE id = ?").get(id);
    if (!existing) {
      res.status(404).json({ error: "\u0E44\u0E21\u0E48\u0E1E\u0E1A\u0E42\u0E1B\u0E23\u0E40\u0E08\u0E01\u0E15\u0E4C Google Flow" });
      return;
    }
    const proj = mapFlowProjectRow(existing);
    const fullNarration = proj.scenes.map((s) => s.narrationThai).filter(Boolean).join(" ... ");
    if (!fullNarration.trim()) {
      res.status(400).json({ error: "\u0E44\u0E21\u0E48\u0E21\u0E35\u0E1A\u0E17\u0E1E\u0E32\u0E01\u0E22\u0E4C\u0E20\u0E32\u0E29\u0E32\u0E44\u0E17\u0E22\u0E43\u0E19\u0E09\u0E32\u0E01\u0E2A\u0E33\u0E2B\u0E23\u0E31\u0E1A\u0E2A\u0E23\u0E49\u0E32\u0E07\u0E40\u0E2A\u0E35\u0E22\u0E07" });
      return;
    }
    const audioAsset = await generateRealAudio({
      text: fullNarration,
      provider,
      voice
    });
    const now = (/* @__PURE__ */ new Date()).toISOString();
    db.prepare(
      "UPDATE flow_projects SET voiceover_audio_url = ?, updated_at = ? WHERE id = ?"
    ).run(audioAsset.fileUrl, now, id);
    const updated = db.prepare("SELECT * FROM flow_projects WHERE id = ?").get(id);
    res.json(mapFlowProjectRow(updated));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});
app.post("/api/ai/flow/projects/:id/assemble", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { includeVoiceover = true } = req.body;
    const existing = db.prepare("SELECT * FROM flow_projects WHERE id = ?").get(id);
    if (!existing) {
      res.status(404).json({ error: "\u0E44\u0E21\u0E48\u0E1E\u0E1A\u0E42\u0E1B\u0E23\u0E40\u0E08\u0E01\u0E15\u0E4C Google Flow" });
      return;
    }
    const proj = mapFlowProjectRow(existing);
    const clipUrls = proj.scenes.map((s) => s.videoClipUrl).filter((u) => Boolean(u && u.trim()));
    const stitched = await stitchFlowScenesWithFfmpeg({
      sceneVideoUrls: clipUrls,
      aspectRatio: proj.aspectRatio,
      voiceoverAudioUrl: includeVoiceover ? proj.voiceoverAudioUrl : void 0,
      projectTitle: proj.title
    });
    const now = (/* @__PURE__ */ new Date()).toISOString();
    db.prepare(
      "UPDATE flow_projects SET master_video_url = ?, status = 'completed', updated_at = ? WHERE id = ?"
    ).run(stitched.masterVideoUrl, now, id);
    const updated = db.prepare("SELECT * FROM flow_projects WHERE id = ?").get(id);
    res.json(mapFlowProjectRow(updated));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});
app.delete("/api/ai/flow/projects/:id", (req, res) => {
  db.prepare("DELETE FROM flow_projects WHERE id = ?").run(Number(req.params.id));
  res.json({ ok: true });
});
app.get("/api/ai/workflows", (_req, res) => {
  const rows = db.prepare("SELECT * FROM ai_workflows ORDER BY updated_at DESC, id DESC").all();
  res.json(rows.map(mapWorkflowRow));
});
app.post("/api/ai/workflows/run", async (req, res) => {
  try {
    const {
      topic,
      inputSource = "\u0E41\u0E19\u0E27\u0E42\u0E19\u0E49\u0E21\u0E01\u0E32\u0E23\u0E28\u0E36\u0E01\u0E29\u0E32 (Trend & Research)",
      category = "ai-tech",
      targetAudience = "\u0E04\u0E23\u0E39 / \u0E1A\u0E38\u0E04\u0E25\u0E32\u0E01\u0E23\u0E17\u0E32\u0E07\u0E01\u0E32\u0E23\u0E28\u0E36\u0E01\u0E29\u0E32",
      businessPillar = "1. VIEWS | \u0E22\u0E2D\u0E14\u0E27\u0E34\u0E27",
      flowMode = "full_8agent",
      provider,
      model,
      autoGenerateCoverImage = false
    } = req.body;
    if (!topic || !String(topic).trim()) {
      res.status(400).json({ error: "\u0E01\u0E23\u0E38\u0E13\u0E32\u0E23\u0E30\u0E1A\u0E38\u0E2B\u0E31\u0E27\u0E02\u0E49\u0E2D\u0E2B\u0E23\u0E37\u0E2D\u0E42\u0E08\u0E17\u0E22\u0E4C\u0E2A\u0E33\u0E2B\u0E23\u0E31\u0E1A\u0E2A\u0E31\u0E48\u0E07\u0E01\u0E32\u0E23 CEO Agent" });
      return;
    }
    const result = await executeMultiAgentWorkflow({
      topic: String(topic).trim(),
      inputSource: String(inputSource),
      category: String(category),
      targetAudience: String(targetAudience),
      businessPillar: String(businessPillar),
      flowMode: flowMode === "core_3agent" ? "core_3agent" : "full_8agent",
      provider,
      model: model ? String(model) : void 0,
      autoGenerateCoverImage: Boolean(autoGenerateCoverImage)
    });
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const initialApproval = {
      isAccurate: true,
      isAppropriate: true,
      isOnBrand: true,
      isReady: false,
      reviewerNote: "",
      publishedPostId: null
    };
    const insertRes = db.prepare(
      `INSERT INTO ai_workflows (
          topic, input_source, category, target_audience, business_pillar,
          flow_mode, engine_used, status,
          ceo_json, research_json, script_json, design_json, visual_json,
          video_json, audio_json, qa_json, analytics_json, omnichannel_json, approval_json,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending_approval', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      String(topic).trim(),
      String(inputSource),
      String(category),
      String(targetAudience),
      String(businessPillar),
      flowMode === "core_3agent" ? "core_3agent" : "full_8agent",
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
    const created = db.prepare("SELECT * FROM ai_workflows WHERE id = ?").get(Number(insertRes.lastInsertRowid));
    res.status(201).json(mapWorkflowRow(created));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});
app.put("/api/ai/workflows/:id", (req, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare("SELECT * FROM ai_workflows WHERE id = ?").get(id);
  if (!existing) {
    res.status(404).json({ error: "\u0E44\u0E21\u0E48\u0E1E\u0E1A\u0E41\u0E04\u0E21\u0E40\u0E1B\u0E0D AI" });
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
    omnichannelOutput = mapped.omnichannelOutput
  } = req.body;
  const now = (/* @__PURE__ */ new Date()).toISOString();
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
  const updated = db.prepare("SELECT * FROM ai_workflows WHERE id = ?").get(id);
  res.json(mapWorkflowRow(updated));
});
app.post("/api/ai/workflows/:id/revision", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const existing = db.prepare("SELECT * FROM ai_workflows WHERE id = ?").get(id);
    if (!existing) {
      res.status(404).json({ error: "\u0E44\u0E21\u0E48\u0E1E\u0E1A\u0E41\u0E04\u0E21\u0E40\u0E1B\u0E0D AI" });
      return;
    }
    const { revisionNote = "", provider, model } = req.body;
    const result = await executeMultiAgentWorkflow({
      topic: existing.topic,
      inputSource: existing.input_source,
      category: existing.category,
      targetAudience: existing.target_audience,
      businessPillar: existing.business_pillar,
      flowMode: existing.flow_mode,
      provider,
      model,
      revisionNote: String(revisionNote)
    });
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const approval = {
      isAccurate: true,
      isAppropriate: true,
      isOnBrand: true,
      isReady: true,
      reviewerNote: `\u0E1B\u0E23\u0E31\u0E1A\u0E1B\u0E23\u0E38\u0E07\u0E14\u0E49\u0E27\u0E22 AI \u0E08\u0E23\u0E34\u0E07\u0E15\u0E32\u0E21\u0E04\u0E33\u0E41\u0E19\u0E30\u0E19\u0E33\u0E41\u0E25\u0E49\u0E27: ${revisionNote}`,
      publishedPostId: null
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
    const updated = db.prepare("SELECT * FROM ai_workflows WHERE id = ?").get(id);
    res.json(mapWorkflowRow(updated));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});
app.post("/api/ai/workflows/:id/approve-publish", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const existing = db.prepare("SELECT * FROM ai_workflows WHERE id = ?").get(id);
    if (!existing) {
      res.status(404).json({ error: "\u0E44\u0E21\u0E48\u0E1E\u0E1A\u0E41\u0E04\u0E21\u0E40\u0E1B\u0E0D AI" });
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
      reviewerNote = "\u0E2D\u0E19\u0E38\u0E21\u0E31\u0E15\u0E34\u0E42\u0E14\u0E22 Human Approval \u0E1E\u0E23\u0E49\u0E2D\u0E21\u0E40\u0E1C\u0E22\u0E41\u0E1E\u0E23\u0E48\u0E02\u0E36\u0E49\u0E19\u0E40\u0E27\u0E47\u0E1A\u0E44\u0E0B\u0E15\u0E4C\u0E2B\u0E25\u0E31\u0E01",
      channelsToPublish = ["Website / Blog"]
    } = req.body;
    const finalTitle = customTitle || wf.scriptOutput.selectedTitle || wf.topic;
    const finalContent = customContent || wf.scriptOutput.fullArticleMarkdown;
    const finalCover = coverImageChoice || wf.visualOutput?.generatedRealImageUrl || wf.visualOutput?.generatedSvgDataUrl || "/images/thumb-ai-edu.jpg";
    const finalVideoUrl = typeof videoUrlChoice === "string" && videoUrlChoice.trim() || wf.videoOutput?.generatedVideoUrl || "";
    const finalAudioUrl = typeof audioUrlChoice === "string" && audioUrlChoice.trim() || wf.audioOutput?.generatedAudioUrl || "";
    if (isFeatured) {
      db.prepare("UPDATE posts SET is_featured = 0").run();
    }
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const postRes = db.prepare(
      `INSERT INTO posts (
          title, subtitle, excerpt, content, category, content_type, cover_image,
          video_url, audio_url, tags_json, author, status, is_featured, views, ai_workflow_id, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '\u0E04\u0E21\u0E01\u0E24\u0E0A (Komkrit) \u2022 AI+Human', 'published', ?, 1, ?, ?, ?)`
    ).run(
      finalTitle,
      wf.scriptOutput.subtitle || "",
      wf.scriptOutput.excerpt || finalTitle,
      finalContent,
      wf.category || "ai-tech",
      finalVideoUrl ? "video" : "article",
      finalCover,
      finalVideoUrl,
      finalAudioUrl,
      JSON.stringify(["AI Multi-Agent", "\u0E04\u0E21\u0E04\u0E34\u0E14 by KOMKRIT", wf.targetAudience]),
      isFeatured ? 1 : 0,
      id,
      now,
      now
    );
    const publishedPostId = Number(postRes.lastInsertRowid);
    const channelNameMap = {
      YouTube: "youtube",
      Facebook: "facebook",
      TikTok: "tiktok",
      "LINE OA": "line_oa",
      "X (Twitter)": "x_twitter",
      Instagram: "instagram",
      "Website / Blog": "website_blog",
      "Email / Newsletter": "email_newsletter"
    };
    const succeededChannelNames = [];
    const logIns = db.prepare(`
      INSERT INTO publish_logs (
        workflow_id, post_id, channel_key, channel_name, title, content_preview,
        mode, status, external_url, response_note, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const chName of channelsToPublish) {
      const chKey = channelNameMap[chName] || chName;
      if (chKey === "website_blog") {
        succeededChannelNames.push("Website / Blog");
        logIns.run(
          id,
          publishedPostId,
          "website_blog",
          "Website / Blog",
          finalTitle,
          (wf.scriptOutput.excerpt || finalTitle).slice(0, 200),
          "internal_live",
          "published",
          `/?post=${publishedPostId}`,
          `\u0E40\u0E1C\u0E22\u0E41\u0E1E\u0E23\u0E48\u0E02\u0E36\u0E49\u0E19\u0E2B\u0E19\u0E49\u0E32\u0E40\u0E27\u0E47\u0E1A\u0E44\u0E0B\u0E15\u0E4C\u0E2B\u0E25\u0E31\u0E01\u0E08\u0E23\u0E34\u0E07\u0E2A\u0E33\u0E40\u0E23\u0E47\u0E08 (Post #${publishedPostId})`,
          now
        );
        continue;
      }
      const cfg = db.prepare("SELECT * FROM channel_configs WHERE channel_key = ?").get(chKey);
      const hasRealCreds = Boolean(cfg?.access_token?.trim()) || Boolean(cfg?.webhook_url?.trim()) || chKey === "email_newsletter" && Boolean(getProviderConfigs().resend.apiKey);
      if (!hasRealCreds) {
        continue;
      }
      const outcome = await dispatchSingleChannelReal({
        channelKey: chKey,
        title: finalTitle,
        content: wf.scriptOutput.excerpt || finalContent.slice(0, 1e3),
        category: wf.category || "ai-tech",
        coverImage: finalCover,
        videoUrl: finalVideoUrl,
        audioUrl: finalAudioUrl,
        workflowId: id,
        postId: publishedPostId
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
      if (outcome.status === "published") {
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
      publishedPostId
    };
    const nextOmni = {
      ...wf.omnichannelOutput,
      publishedChannels: succeededChannelNames
    };
    db.prepare(
      `UPDATE ai_workflows SET status = 'published', approval_json = ?, omnichannel_json = ?, updated_at = ? WHERE id = ?`
    ).run(JSON.stringify(nextApproval), JSON.stringify(nextOmni), now, id);
    const updatedWf = db.prepare("SELECT * FROM ai_workflows WHERE id = ?").get(id);
    const createdPost = db.prepare("SELECT p.*, 0 AS comments_count FROM posts p WHERE p.id = ?").get(publishedPostId);
    res.json({
      workflow: mapWorkflowRow(updatedWf),
      post: mapPostRow(createdPost)
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
app.delete("/api/ai/workflows/:id", (req, res) => {
  db.prepare("DELETE FROM ai_workflows WHERE id = ?").run(Number(req.params.id));
  res.json({ ok: true });
});
app.post("/api/ai/assist", async (req, res) => {
  try {
    const result = await assistPostContent(req.body);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});
app.get("/api/subscribers", (_req, res) => {
  const rows = db.prepare("SELECT * FROM subscribers ORDER BY created_at DESC").all().map((s) => ({
    id: s.id,
    email: s.email,
    name: s.name,
    role: s.role,
    createdAt: s.created_at
  }));
  res.json(rows);
});
app.post("/api/subscribers", (req, res) => {
  const { email, name = "", role = "\u0E1C\u0E39\u0E49\u0E2A\u0E19\u0E43\u0E08\u0E17\u0E31\u0E48\u0E27\u0E44\u0E1B" } = req.body;
  if (!email || !String(email).includes("@")) {
    res.status(400).json({ error: "\u0E01\u0E23\u0E38\u0E13\u0E32\u0E01\u0E23\u0E2D\u0E01\u0E2D\u0E35\u0E40\u0E21\u0E25\u0E43\u0E2B\u0E49\u0E16\u0E39\u0E01\u0E15\u0E49\u0E2D\u0E07" });
    return;
  }
  const now = (/* @__PURE__ */ new Date()).toISOString();
  db.prepare(
    `INSERT OR IGNORE INTO subscribers (email, name, role, created_at) VALUES (?, ?, ?, ?)`
  ).run(String(email).trim().toLowerCase(), String(name).trim(), String(role), now);
  res.status(201).json({ ok: true });
});
app.put("/api/subscribers/:id", (req, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare("SELECT * FROM subscribers WHERE id = ?").get(id);
  if (!existing) {
    res.status(404).json({ error: "\u0E44\u0E21\u0E48\u0E1E\u0E1A\u0E23\u0E32\u0E22\u0E0A\u0E37\u0E48\u0E2D\u0E2A\u0E21\u0E32\u0E0A\u0E34\u0E01\u0E17\u0E35\u0E48\u0E15\u0E49\u0E2D\u0E07\u0E01\u0E32\u0E23\u0E41\u0E01\u0E49\u0E44\u0E02" });
    return;
  }
  const {
    email = existing.email,
    name = existing.name,
    role = existing.role
  } = req.body || {};
  const cleanEmail = String(email).trim().toLowerCase();
  if (!cleanEmail || !cleanEmail.includes("@")) {
    res.status(400).json({ error: "\u0E01\u0E23\u0E38\u0E13\u0E32\u0E01\u0E23\u0E2D\u0E01\u0E2D\u0E35\u0E40\u0E21\u0E25\u0E43\u0E2B\u0E49\u0E16\u0E39\u0E01\u0E15\u0E49\u0E2D\u0E07" });
    return;
  }
  db.prepare(
    `UPDATE subscribers SET email = ?, name = ?, role = ? WHERE id = ?`
  ).run(cleanEmail, String(name).trim(), String(role).trim() || "\u0E1C\u0E39\u0E49\u0E2A\u0E19\u0E43\u0E08\u0E17\u0E31\u0E48\u0E27\u0E44\u0E1B", id);
  res.json({
    ok: true,
    id,
    email: cleanEmail,
    name: String(name).trim(),
    role: String(role).trim() || "\u0E1C\u0E39\u0E49\u0E2A\u0E19\u0E43\u0E08\u0E17\u0E31\u0E48\u0E27\u0E44\u0E1B",
    createdAt: existing.created_at
  });
});
app.delete("/api/subscribers/:id", (req, res) => {
  db.prepare("DELETE FROM subscribers WHERE id = ?").run(Number(req.params.id));
  res.json({ ok: true });
});
app.get("/api/contacts", (_req, res) => {
  const rows = db.prepare("SELECT * FROM contacts ORDER BY created_at DESC").all().map((c) => ({
    id: c.id,
    name: c.name,
    email: c.email,
    subject: c.subject,
    message: c.message,
    status: c.status,
    createdAt: c.created_at
  }));
  res.json(rows);
});
app.post("/api/contacts", (req, res) => {
  const { name, email, subject = "\u0E15\u0E34\u0E14\u0E15\u0E48\u0E2D\u0E17\u0E31\u0E48\u0E27\u0E44\u0E1B", message } = req.body;
  if (!name || !email || !message) {
    res.status(400).json({ error: "\u0E01\u0E23\u0E38\u0E13\u0E32\u0E01\u0E23\u0E2D\u0E01\u0E02\u0E49\u0E2D\u0E21\u0E39\u0E25\u0E0A\u0E37\u0E48\u0E2D \u0E2D\u0E35\u0E40\u0E21\u0E25 \u0E41\u0E25\u0E30\u0E02\u0E49\u0E2D\u0E04\u0E27\u0E32\u0E21\u0E43\u0E2B\u0E49\u0E04\u0E23\u0E1A\u0E16\u0E49\u0E27\u0E19" });
    return;
  }
  const now = (/* @__PURE__ */ new Date()).toISOString();
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
app.put("/api/contacts/:id", (req, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare("SELECT * FROM contacts WHERE id = ?").get(id);
  if (!existing) {
    res.status(404).json({ error: "\u0E44\u0E21\u0E48\u0E1E\u0E1A\u0E02\u0E49\u0E2D\u0E04\u0E27\u0E32\u0E21\u0E15\u0E34\u0E14\u0E15\u0E48\u0E2D\u0E17\u0E35\u0E48\u0E15\u0E49\u0E2D\u0E07\u0E01\u0E32\u0E23\u0E41\u0E01\u0E49\u0E44\u0E02" });
    return;
  }
  const {
    name = existing.name,
    email = existing.email,
    subject = existing.subject,
    message = existing.message,
    status = existing.status
  } = req.body || {};
  db.prepare(
    `UPDATE contacts SET name = ?, email = ?, subject = ?, message = ?, status = ? WHERE id = ?`
  ).run(
    String(name).trim(),
    String(email).trim(),
    String(subject).trim(),
    String(message).trim(),
    String(status).trim() || "read",
    id
  );
  res.json({
    ok: true,
    id,
    name: String(name).trim(),
    email: String(email).trim(),
    subject: String(subject).trim(),
    message: String(message).trim(),
    status: String(status).trim() || "read",
    createdAt: existing.created_at
  });
});
app.put("/api/contacts/:id/read", (req, res) => {
  db.prepare("UPDATE contacts SET status = 'read' WHERE id = ?").run(Number(req.params.id));
  res.json({ ok: true });
});
app.delete("/api/contacts/:id", (req, res) => {
  db.prepare("DELETE FROM contacts WHERE id = ?").run(Number(req.params.id));
  res.json({ ok: true });
});
app.get("/api/ai/models", async (req, res) => {
  try {
    const forceRefresh = req.query.refresh === "1" || req.query.refresh === "true";
    const catalog = await fetchAllConfiguredLiveModels(forceRefresh);
    res.json(catalog);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
app.post("/api/ai/models/provider", async (req, res) => {
  try {
    const { provider, apiKey, endpoint, projectId, location } = req.body || {};
    if (!provider) {
      res.status(400).json({ error: "\u0E01\u0E23\u0E38\u0E13\u0E32\u0E23\u0E30\u0E1A\u0E38\u0E0A\u0E37\u0E48\u0E2D\u0E04\u0E48\u0E32\u0E22 AI (provider)" });
      return;
    }
    const catalog = await fetchSingleProviderLiveCatalog({
      provider,
      apiKey: typeof apiKey === "string" && apiKey !== "__KEEP__" ? apiKey : void 0,
      endpoint: typeof endpoint === "string" ? endpoint : void 0,
      projectId: typeof projectId === "string" ? projectId : void 0,
      location: typeof location === "string" ? location : void 0,
      forceRefresh: true
    });
    res.json(catalog);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});
app.get("/api/settings/ai", (req, res) => {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, private");
  res.setHeader("Pragma", "no-cache");
  const cfg = getProviderConfigs();
  const localUpdatedAt = getLocalVaultUpdatedAt();
  const hasAnyKey = hasAnyStoredApiSecret();
  const effectiveTs = localUpdatedAt || (hasAnyKey ? Date.now() : 0);
  const sealedVault = effectiveTs > 0 ? sealSettingsVaultToken(exportEncryptedSettingsMap(), effectiveTs) : void 0;
  if (sealedVault) {
    writeSealedVaultCookie(req, res, sealedVault);
  }
  res.json({
    provider: cfg.defaultProvider,
    encryptedAtRest: true,
    encryptionStandard: "AES-256-GCM",
    ...sealedVault ? { sealedVault, vaultUpdatedAt: effectiveTs } : {},
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
    hasLocalKey: Boolean(cfg.localOpenAi.apiKey)
  });
});
app.put("/api/settings/ai", (req, res) => {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, private");
  res.setHeader("Pragma", "no-cache");
  const b = req.body || {};
  const set = db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)");
  const saveStr = (settingKey, val) => {
    if (typeof val === "string") {
      set.run(settingKey, val.trim());
    }
  };
  const saveSecret = (settingKey, val) => {
    if (typeof val !== "string") return;
    const trimmed = val.trim();
    if (trimmed === "__KEEP__" || trimmed === "") {
      return;
    }
    if (trimmed === "__CLEAR__") {
      set.run(settingKey, "");
      return;
    }
    set.run(settingKey, encryptSecretValue(trimmed, settingKey));
  };
  saveStr("ai_provider", b.provider);
  saveStr("gemini_model", b.geminiModel);
  saveStr("gemini_image_model", b.geminiImageModel);
  saveStr("gemini_video_model", b.geminiVideoModel);
  saveStr("gemini_tts_model", b.geminiTtsModel);
  saveSecret("gemini_api_key", b.geminiApiKey);
  saveStr("claude_model", b.claudeModel);
  saveSecret("claude_api_key", b.claudeApiKey);
  saveStr("deepseek_model", b.deepseekModel);
  saveSecret("deepseek_api_key", b.deepseekApiKey);
  saveStr("openai_model", b.openaiModel);
  saveSecret("openai_api_key", b.openaiApiKey);
  saveStr("vertex_project_id", b.vertexProjectId);
  saveStr("vertex_location", b.vertexLocation);
  saveStr("vertex_veo_model", b.vertexVeoModel);
  saveSecret("vertex_access_token", b.vertexAccessToken);
  saveSecret("elevenlabs_api_key", b.elevenlabsApiKey);
  saveStr("elevenlabs_model", b.elevenlabsModel);
  saveStr("elevenlabs_voice_id", b.elevenlabsVoiceId);
  saveSecret("resend_api_key", b.resendApiKey);
  saveStr("resend_from_email", b.resendFromEmail);
  saveStr("local_endpoint", b.localEndpoint);
  saveStr("local_model", b.localModel);
  saveSecret("local_api_key", b.localApiKey);
  const updatedAt = Date.now();
  set.run(VAULT_UPDATED_AT_KEY, String(updatedAt));
  invalidateModelCatalogCache();
  const sealedVault = sealSettingsVaultToken(exportEncryptedSettingsMap(), updatedAt);
  writeSealedVaultCookie(req, res, sealedVault);
  res.json({ ok: true, encryptedAtRest: true, vaultUpdatedAt: updatedAt, sealedVault });
});
app.post("/api/settings/test-provider", async (req, res) => {
  const { provider, model, apiKey } = req.body || {};
  try {
    const result = await testProviderConnection({
      provider,
      model,
      apiKey
    });
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: redactSecrets(err.message, [String(apiKey || "")]) });
  }
});
app.post("/api/settings/test-extra", async (req, res) => {
  const { service, apiKey } = req.body || {};
  try {
    const cfg = getProviderConfigs();
    const startedAt = Date.now();
    if (service === "elevenlabs") {
      const key = String(apiKey || "").trim() || cfg.elevenlabs.apiKey;
      if (!key) {
        res.status(400).json({ error: "\u0E01\u0E23\u0E38\u0E13\u0E32\u0E43\u0E2A\u0E48 ElevenLabs API Key \u0E01\u0E48\u0E2D\u0E19\u0E17\u0E14\u0E2A\u0E2D\u0E1A" });
        return;
      }
      const r = await fetch("https://api.elevenlabs.io/v1/user", {
        headers: { "xi-api-key": key }
      });
      if (!r.ok) {
        res.status(400).json({ error: `ElevenLabs API \u0E15\u0E2D\u0E1A\u0E01\u0E25\u0E31\u0E1A HTTP ${r.status} (\u0E15\u0E23\u0E27\u0E08\u0E2A\u0E2D\u0E1A\u0E04\u0E35\u0E22\u0E4C\u0E2D\u0E35\u0E01\u0E04\u0E23\u0E31\u0E49\u0E07)` });
        return;
      }
      const u = await r.json();
      const quotaUsed = u?.subscription?.character_count ?? 0;
      const quotaLimit = u?.subscription?.character_limit ?? "?";
      res.json({
        ok: true,
        latencyMs: Date.now() - startedAt,
        detail: `\u0E40\u0E0A\u0E37\u0E48\u0E2D\u0E21\u0E15\u0E48\u0E2D ElevenLabs \u0E2A\u0E33\u0E40\u0E23\u0E47\u0E08 (\u0E42\u0E04\u0E27\u0E15\u0E49\u0E32\u0E15\u0E31\u0E27\u0E2D\u0E31\u0E01\u0E29\u0E23: ${quotaUsed}/${quotaLimit})`
      });
      return;
    }
    if (service === "resend") {
      const key = String(apiKey || "").trim() || cfg.resend.apiKey;
      if (!key) {
        res.status(400).json({ error: "\u0E01\u0E23\u0E38\u0E13\u0E32\u0E43\u0E2A\u0E48 Resend API Key (re_...) \u0E01\u0E48\u0E2D\u0E19\u0E17\u0E14\u0E2A\u0E2D\u0E1A" });
        return;
      }
      const r = await fetch("https://api.resend.com/domains", {
        headers: { Authorization: `Bearer ${key}` }
      });
      if (!r.ok) {
        res.status(400).json({ error: `Resend API \u0E15\u0E2D\u0E1A\u0E01\u0E25\u0E31\u0E1A HTTP ${r.status} (\u0E15\u0E23\u0E27\u0E08\u0E2A\u0E2D\u0E1A\u0E04\u0E35\u0E22\u0E4C\u0E2D\u0E35\u0E01\u0E04\u0E23\u0E31\u0E49\u0E07)` });
        return;
      }
      const d = await r.json();
      const domainCount = Array.isArray(d?.data) ? d.data.length : 0;
      res.json({
        ok: true,
        latencyMs: Date.now() - startedAt,
        detail: `\u0E40\u0E0A\u0E37\u0E48\u0E2D\u0E21\u0E15\u0E48\u0E2D Resend Email API \u0E2A\u0E33\u0E40\u0E23\u0E47\u0E08 (\u0E42\u0E14\u0E40\u0E21\u0E19\u0E22\u0E37\u0E19\u0E22\u0E31\u0E19\u0E41\u0E25\u0E49\u0E27 ${domainCount} \u0E23\u0E32\u0E22\u0E01\u0E32\u0E23)`
      });
      return;
    }
    res.status(400).json({ error: "\u0E44\u0E21\u0E48\u0E23\u0E39\u0E49\u0E08\u0E31\u0E01\u0E1A\u0E23\u0E34\u0E01\u0E32\u0E23\u0E17\u0E35\u0E48\u0E15\u0E49\u0E2D\u0E07\u0E01\u0E32\u0E23\u0E17\u0E14\u0E2A\u0E2D\u0E1A" });
  } catch (err) {
    res.status(400).json({ error: redactSecrets(err.message, [String(apiKey || "")]) });
  }
});
app.get("/api/channels", (_req, res) => {
  res.setHeader("Cache-Control", "no-store, private");
  const resendGlobalKey = getProviderConfigs().resend.apiKey;
  const rows = db.prepare("SELECT * FROM channel_configs ORDER BY id ASC").all().map((c) => {
    const decryptedTok = decryptSecretValue(c.access_token, `channel:${c.channel_key}`);
    const tok = decryptedTok || (c.channel_key === "email_newsletter" ? resendGlobalKey : "");
    return {
      id: c.id,
      channelKey: c.channel_key,
      channelName: c.channel_name,
      handleOrUrl: c.handle_or_url || "",
      enabled: Boolean(c.enabled),
      autoPublishOnApprove: Boolean(c.auto_publish),
      hasAccessToken: Boolean(tok),
      accessTokenMasked: maskSecret(tok),
      targetId: c.target_id || "",
      webhookUrl: c.webhook_url || "",
      updatedAt: c.updated_at
    };
  });
  res.json(rows);
});
app.put("/api/channels/:key", (req, res) => {
  const key = String(req.params.key);
  const existing = db.prepare("SELECT * FROM channel_configs WHERE channel_key = ?").get(key);
  if (!existing) {
    res.status(404).json({ error: "\u0E44\u0E21\u0E48\u0E1E\u0E1A\u0E0A\u0E48\u0E2D\u0E07\u0E17\u0E32\u0E07\u0E19\u0E35\u0E49" });
    return;
  }
  const {
    handleOrUrl = existing.handle_or_url,
    enabled,
    autoPublishOnApprove,
    accessToken,
    targetId = existing.target_id,
    webhookUrl = existing.webhook_url
  } = req.body;
  let nextToken = existing.access_token;
  if (typeof accessToken === "string") {
    const trimmed = accessToken.trim();
    if (trimmed === "__CLEAR__") {
      nextToken = "";
    } else if (trimmed !== "__KEEP__" && trimmed !== "") {
      nextToken = encryptSecretValue(trimmed, `channel:${key}`);
    }
  }
  const now = (/* @__PURE__ */ new Date()).toISOString();
  db.prepare(
    `UPDATE channel_configs SET
      handle_or_url = ?, enabled = ?, auto_publish = ?,
      access_token = ?, target_id = ?, webhook_url = ?, updated_at = ?
     WHERE channel_key = ?`
  ).run(
    String(handleOrUrl),
    typeof enabled === "boolean" ? enabled ? 1 : 0 : existing.enabled,
    typeof autoPublishOnApprove === "boolean" ? autoPublishOnApprove ? 1 : 0 : existing.auto_publish,
    nextToken,
    String(targetId),
    String(webhookUrl),
    now,
    key
  );
  res.json({ ok: true });
});
async function processDueScheduledPublishes() {
  const nowIso = (/* @__PURE__ */ new Date()).toISOString().slice(0, 16);
  const dueRows = db.prepare(
    "SELECT * FROM publish_logs WHERE status = 'scheduled' AND scheduled_at IS NOT NULL AND scheduled_at <= ?"
  ).all(nowIso);
  if (dueRows.length === 0) return false;
  for (const row of dueRows) {
    const outcome = await dispatchSingleChannelReal({
      channelKey: row.channel_key,
      title: row.title,
      content: row.content_preview,
      category: "education",
      coverImage: "/images/thumb-ai-edu.jpg",
      videoUrl: "",
      workflowId: row.workflow_id,
      postId: row.post_id
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
app.get("/api/publish/logs", async (_req, res) => {
  try {
    const mutated = await processDueScheduledPublishes();
    if (mutated) {
      await persistDatabaseToCloud();
    }
  } catch {
  }
  const rows = db.prepare("SELECT * FROM publish_logs ORDER BY created_at DESC, id DESC LIMIT 100").all().map((l) => ({
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
    externalUrl: l.external_url || "",
    responseNote: l.response_note || "",
    createdAt: l.created_at
  }));
  res.json(rows);
});
app.post("/api/publish/dispatch", async (req, res) => {
  try {
    const {
      channels = [],
      title,
      content,
      category = "education",
      coverImage = "/images/thumb-ai-edu.jpg",
      videoUrl = "",
      audioUrl = "",
      workflowId = null,
      postId = null,
      scheduledAt = null
    } = req.body;
    if (!title || !Array.isArray(channels) || channels.length === 0) {
      res.status(400).json({ error: "\u0E01\u0E23\u0E38\u0E13\u0E32\u0E23\u0E30\u0E1A\u0E38\u0E2B\u0E31\u0E27\u0E02\u0E49\u0E2D\u0E41\u0E25\u0E30\u0E40\u0E25\u0E37\u0E2D\u0E01\u0E2D\u0E22\u0E48\u0E32\u0E07\u0E19\u0E49\u0E2D\u0E22 1 \u0E0A\u0E48\u0E2D\u0E07\u0E17\u0E32\u0E07\u0E40\u0E1C\u0E22\u0E41\u0E1E\u0E23\u0E48" });
      return;
    }
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const isScheduled = Boolean(scheduledAt && String(scheduledAt).trim());
    let createdOrLinkedPostId = postId ? Number(postId) : null;
    const results = [];
    for (const chKey of channels) {
      const cfg = db.prepare("SELECT * FROM channel_configs WHERE channel_key = ?").get(String(chKey));
      const chName = cfg ? cfg.channel_name : String(chKey);
      if (isScheduled) {
        const ins2 = db.prepare(
          `INSERT INTO publish_logs (
              workflow_id, post_id, channel_key, channel_name, title, content_preview,
              mode, status, scheduled_at, external_url, response_note, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, 'live_api', 'scheduled', ?, '', ?, ?)`
        ).run(
          workflowId,
          createdOrLinkedPostId,
          String(chKey),
          chName,
          String(title).trim(),
          String(content || title),
          String(scheduledAt),
          `\u0E15\u0E31\u0E49\u0E07\u0E40\u0E27\u0E25\u0E32\u0E40\u0E1C\u0E22\u0E41\u0E1E\u0E23\u0E48\u0E08\u0E23\u0E34\u0E07\u0E2D\u0E31\u0E15\u0E42\u0E19\u0E21\u0E31\u0E15\u0E34\u0E44\u0E1B\u0E22\u0E31\u0E07 ${chName} \u0E40\u0E27\u0E25\u0E32 ${scheduledAt}`,
          now
        );
        results.push({
          id: Number(ins2.lastInsertRowid),
          channelKey: chKey,
          channelName: chName,
          mode: "live_api",
          status: "scheduled",
          externalUrl: "",
          responseNote: `\u0E15\u0E31\u0E49\u0E07\u0E40\u0E27\u0E25\u0E32\u0E40\u0E1C\u0E22\u0E41\u0E1E\u0E23\u0E48\u0E08\u0E23\u0E34\u0E07\u0E40\u0E27\u0E25\u0E32 ${scheduledAt}`
        });
        continue;
      }
      const outcome = await dispatchSingleChannelReal({
        channelKey: String(chKey),
        title: String(title).trim(),
        content: String(content || title),
        category: String(category),
        coverImage: String(coverImage),
        videoUrl: String(videoUrl || ""),
        audioUrl: String(audioUrl || ""),
        workflowId: workflowId ? Number(workflowId) : null,
        postId: createdOrLinkedPostId
      });
      if (outcome.createdPostId && !createdOrLinkedPostId) {
        createdOrLinkedPostId = outcome.createdPostId;
      }
      const ins = db.prepare(
        `INSERT INTO publish_logs (
            workflow_id, post_id, channel_key, channel_name, title, content_preview,
            mode, status, scheduled_at, external_url, response_note, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)`
      ).run(
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
        ...outcome
      });
    }
    res.status(201).json({
      ok: true,
      postId: createdOrLinkedPostId,
      dispatched: results
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
app.put("/api/publish/logs/:id", (req, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare("SELECT * FROM publish_logs WHERE id = ?").get(id);
  if (!existing) {
    res.status(404).json({ error: "\u0E44\u0E21\u0E48\u0E1E\u0E1A\u0E1B\u0E23\u0E30\u0E27\u0E31\u0E15\u0E34\u0E01\u0E32\u0E23\u0E40\u0E1C\u0E22\u0E41\u0E1E\u0E23\u0E48\u0E17\u0E35\u0E48\u0E15\u0E49\u0E2D\u0E07\u0E01\u0E32\u0E23\u0E41\u0E01\u0E49\u0E44\u0E02" });
    return;
  }
  const {
    title = existing.title,
    contentPreview = existing.content_preview,
    status = existing.status,
    scheduledAt = existing.scheduled_at,
    responseNote = existing.response_note
  } = req.body || {};
  db.prepare(
    `UPDATE publish_logs SET title = ?, content_preview = ?, status = ?, scheduled_at = ?, response_note = ? WHERE id = ?`
  ).run(
    String(title).trim(),
    String(contentPreview || ""),
    String(status || existing.status),
    scheduledAt ? String(scheduledAt) : null,
    String(responseNote || existing.response_note || ""),
    id
  );
  res.json({ ok: true, id });
});
app.delete("/api/publish/logs/:id", (req, res) => {
  db.prepare("DELETE FROM publish_logs WHERE id = ?").run(Number(req.params.id));
  res.json({ ok: true });
});
if (!IS_SERVERLESS) {
  const schedTimer = setInterval(async () => {
    try {
      await processDueScheduledPublishes();
    } catch {
    }
  }, 3e4);
  if (typeof schedTimer.unref === "function") {
    schedTimer.unref();
  }
}
app.get("/api/surveys", (_req, res) => {
  const rows = db.prepare("SELECT * FROM audience_surveys ORDER BY created_at DESC, id DESC").all().map((s) => ({
    id: s.id,
    respondentName: s.respondent_name,
    respondentRole: s.respondent_role,
    schoolOrOrg: s.school_or_org || "",
    preferredChannel: s.preferred_channel || "Website / Blog",
    requestedTopic: s.requested_topic,
    satisfactionScore: s.satisfaction_score,
    feedbackDetail: s.feedback_detail || "",
    createdAt: s.created_at
  }));
  res.json(rows);
});
app.post("/api/surveys", (req, res) => {
  const {
    respondentName = "\u0E1C\u0E39\u0E49\u0E23\u0E48\u0E27\u0E21\u0E15\u0E2D\u0E1A\u0E41\u0E1A\u0E1A\u0E2A\u0E33\u0E23\u0E27\u0E08",
    respondentRole = "\u0E04\u0E23\u0E39 / \u0E1A\u0E38\u0E04\u0E25\u0E32\u0E01\u0E23\u0E17\u0E32\u0E07\u0E01\u0E32\u0E23\u0E28\u0E36\u0E01\u0E29\u0E32",
    schoolOrOrg = "",
    preferredChannel = "LINE OA",
    requestedTopic = "",
    satisfactionScore = 5,
    feedbackDetail = ""
  } = req.body;
  if (!String(requestedTopic).trim()) {
    res.status(400).json({ error: "\u0E01\u0E23\u0E38\u0E13\u0E32\u0E23\u0E30\u0E1A\u0E38\u0E2B\u0E31\u0E27\u0E02\u0E49\u0E2D\u0E2B\u0E23\u0E37\u0E2D\u0E2A\u0E34\u0E48\u0E07\u0E17\u0E35\u0E48\u0E2D\u0E22\u0E32\u0E01\u0E43\u0E2B\u0E49 \u0E04\u0E21\u0E04\u0E34\u0E14 \u0E19\u0E33\u0E40\u0E2A\u0E19\u0E2D" });
    return;
  }
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const r = db.prepare(
    `INSERT INTO audience_surveys (
        respondent_name, respondent_role, school_or_org, preferred_channel,
        requested_topic, satisfaction_score, feedback_detail, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    String(respondentName).trim() || "\u0E1C\u0E39\u0E49\u0E23\u0E48\u0E27\u0E21\u0E15\u0E2D\u0E1A\u0E41\u0E1A\u0E1A\u0E2A\u0E33\u0E23\u0E27\u0E08",
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
app.put("/api/surveys/:id", (req, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare("SELECT * FROM audience_surveys WHERE id = ?").get(id);
  if (!existing) {
    res.status(404).json({ error: "\u0E44\u0E21\u0E48\u0E1E\u0E1A\u0E02\u0E49\u0E2D\u0E21\u0E39\u0E25\u0E41\u0E1A\u0E1A\u0E2A\u0E33\u0E23\u0E27\u0E08\u0E17\u0E35\u0E48\u0E15\u0E49\u0E2D\u0E07\u0E01\u0E32\u0E23\u0E41\u0E01\u0E49\u0E44\u0E02" });
    return;
  }
  const {
    respondentName = existing.respondent_name,
    respondentRole = existing.respondent_role,
    schoolOrOrg = existing.school_or_org,
    preferredChannel = existing.preferred_channel,
    requestedTopic = existing.requested_topic,
    satisfactionScore = existing.satisfaction_score,
    feedbackDetail = existing.feedback_detail
  } = req.body || {};
  if (!String(requestedTopic).trim()) {
    res.status(400).json({ error: "\u0E01\u0E23\u0E38\u0E13\u0E32\u0E23\u0E30\u0E1A\u0E38\u0E2B\u0E31\u0E27\u0E02\u0E49\u0E2D\u0E17\u0E35\u0E48\u0E15\u0E49\u0E2D\u0E07\u0E01\u0E32\u0E23\u0E19\u0E33\u0E40\u0E2A\u0E19\u0E2D" });
    return;
  }
  const cleanScore = Math.min(5, Math.max(1, Number(satisfactionScore) || existing.satisfaction_score || 5));
  db.prepare(
    `UPDATE audience_surveys SET
      respondent_name = ?, respondent_role = ?, school_or_org = ?,
      preferred_channel = ?, requested_topic = ?, satisfaction_score = ?, feedback_detail = ?
     WHERE id = ?`
  ).run(
    String(respondentName).trim() || "\u0E1C\u0E39\u0E49\u0E23\u0E48\u0E27\u0E21\u0E15\u0E2D\u0E1A\u0E41\u0E1A\u0E1A\u0E2A\u0E33\u0E23\u0E27\u0E08",
    String(respondentRole).trim(),
    String(schoolOrOrg || "").trim(),
    String(preferredChannel || "LINE OA").trim(),
    String(requestedTopic).trim(),
    cleanScore,
    String(feedbackDetail || "").trim(),
    id
  );
  res.json({
    ok: true,
    id,
    respondentName: String(respondentName).trim() || "\u0E1C\u0E39\u0E49\u0E23\u0E48\u0E27\u0E21\u0E15\u0E2D\u0E1A\u0E41\u0E1A\u0E1A\u0E2A\u0E33\u0E23\u0E27\u0E08",
    respondentRole: String(respondentRole).trim(),
    schoolOrOrg: String(schoolOrOrg || "").trim(),
    preferredChannel: String(preferredChannel || "LINE OA").trim(),
    requestedTopic: String(requestedTopic).trim(),
    satisfactionScore: cleanScore,
    feedbackDetail: String(feedbackDetail || "").trim(),
    createdAt: existing.created_at
  });
});
app.delete("/api/surveys/:id", (req, res) => {
  db.prepare("DELETE FROM audience_surveys WHERE id = ?").run(Number(req.params.id));
  res.json({ ok: true });
});
app.get("/api/admin/export-json", (_req, res) => {
  const posts = db.prepare("SELECT * FROM posts ORDER BY id ASC").all().map(mapPostRow);
  const comments = db.prepare("SELECT * FROM comments ORDER BY id ASC").all();
  const knowledge = db.prepare("SELECT * FROM knowledge_base ORDER BY id ASC").all();
  const pillars = db.prepare("SELECT * FROM business_pillars ORDER BY pillar_index ASC").all();
  const subscribers = db.prepare("SELECT * FROM subscribers ORDER BY id ASC").all();
  const contacts = db.prepare("SELECT * FROM contacts ORDER BY id ASC").all();
  const surveys = db.prepare("SELECT * FROM audience_surveys ORDER BY id ASC").all();
  res.json({
    version: "komkid-prod-cms-v1",
    exportedAt: (/* @__PURE__ */ new Date()).toISOString(),
    counts: {
      posts: posts.length,
      comments: comments.length,
      knowledge: knowledge.length,
      pillars: pillars.length,
      subscribers: subscribers.length,
      contacts: contacts.length,
      surveys: surveys.length
    },
    data: {
      posts,
      comments,
      knowledge,
      pillars,
      subscribers,
      contacts,
      surveys
    }
  });
});
app.post("/api/admin/import-json", (req, res) => {
  const { data, mode = "merge" } = req.body || {};
  if (!data || typeof data !== "object") {
    res.status(400).json({ error: "\u0E23\u0E39\u0E1B\u0E41\u0E1A\u0E1A\u0E44\u0E1F\u0E25\u0E4C\u0E2A\u0E33\u0E23\u0E2D\u0E07\u0E02\u0E49\u0E2D\u0E21\u0E39\u0E25 (JSON Backup) \u0E44\u0E21\u0E48\u0E16\u0E39\u0E01\u0E15\u0E49\u0E2D\u0E07" });
    return;
  }
  let importedPosts = 0;
  let importedKnowledge = 0;
  const now = (/* @__PURE__ */ new Date()).toISOString();
  db.exec("BEGIN IMMEDIATE");
  try {
    if (mode === "replace") {
      if (Array.isArray(data.posts)) {
        db.exec("DELETE FROM comments; DELETE FROM posts;");
      }
      if (Array.isArray(data.knowledge)) {
        db.exec("DELETE FROM knowledge_base;");
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
          String(p.subtitle || ""),
          String(p.excerpt || p.title),
          String(p.content || ""),
          String(p.category || "education"),
          String(p.contentType || p.content_type || "article"),
          String(p.coverImage || p.cover_image || "/images/thumb-ai-edu.jpg"),
          String(p.videoUrl || p.video_url || ""),
          String(p.audioUrl || p.audio_url || ""),
          Array.isArray(p.tags) ? JSON.stringify(p.tags) : String(p.tags_json || "[]"),
          String(p.author || "\u0E04\u0E21\u0E01\u0E24\u0E0A (Komkrit)"),
          String(p.status || "published"),
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
          String(k.category || "research"),
          String(k.summary || ""),
          String(k.content || ""),
          String(k.sourceRef || k.source_ref || ""),
          k.isActive === false || k.is_active === 0 ? 0 : 1,
          String(k.createdAt || k.created_at || now)
        );
        importedKnowledge++;
      }
    }
    db.exec("COMMIT");
    res.json({
      ok: true,
      importedPosts,
      importedKnowledge
    });
  } catch (err) {
    try {
      db.exec("ROLLBACK");
    } catch {
    }
    res.status(500).json({ error: err.message });
  }
});
async function startServer() {
  const port = Number(process.env.PORT || 3e3);
  const isProd = process.env.NODE_ENV === "production";
  if (!isProd) {
    const vitePkg = "vite";
    const { createServer: createViteServer } = await import(vitePkg);
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa"
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path4.resolve(process.cwd(), "dist");
    app.use(express.static(distDir));
    app.get("/{*splat}", (_req, res) => {
      res.sendFile(path4.join(distDir, "index.html"));
    });
  }
  app.listen(port, "0.0.0.0", () => {
    console.log(
      `
\u{1F680} \u0E04\u0E21\u0E04\u0E34\u0E14 by KOMKRIT WebApp & Real Multi-LLM + Google Veo/Flow Studio running at http://0.0.0.0:${port}
`
    );
  });
}
if (!IS_SERVERLESS) {
  startServer();
}
var index_default = app;
export {
  app,
  index_default as default
};
