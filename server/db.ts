import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import fs from 'node:fs';

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
  : path.resolve(process.cwd(), 'data');
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
      video_engine TEXT NOT NULL DEFAULT 'gemini-omni-1.1-flash',
      scenes_json TEXT NOT NULL DEFAULT '[]',
      master_video_url TEXT DEFAULT '',
      voiceover_audio_url TEXT DEFAULT '',
      status TEXT NOT NULL DEFAULT 'draft',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
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

  seedIfEmpty();
  seedOmnichannelIfEmpty();
}

function seedOmnichannelIfEmpty() {
  const chCount = (db.prepare('SELECT COUNT(*) as c FROM channel_configs').get() as any).c;
  if (chCount === 0) {
    const now = '2025-09-16T08:00:00.000Z';
    const ins = db.prepare(`
      INSERT INTO channel_configs (
        channel_key, channel_name, handle_or_url, enabled, auto_publish,
        access_token, target_id, webhook_url, updated_at
      ) VALUES (?, ?, ?, 1, 1, '', '', '', ?)
    `);
    ins.run('youtube', 'YouTube', 'https://www.youtube.com/watch?v=VxQwQ9vQkkc', now);
    ins.run('facebook', 'Facebook', 'https://facebook.com/komkidbykomkrit', now);
    ins.run('tiktok', 'TikTok', 'https://tiktok.com/@komkidbykomkrit', now);
    ins.run('line_oa', 'LINE OA', '@komkidbykomkrit', now);
    ins.run('x_twitter', 'X (Twitter)', 'https://x.com/komkidbykomkrit', now);
    ins.run('instagram', 'Instagram', 'https://instagram.com/komkidbykomkrit', now);
    ins.run('website_blog', 'Website / Blog', 'http://localhost:3000', now);
    ins.run('email_newsletter', 'Email / Newsletter', 'newsletter@komkrit.com', now);

    const logIns = db.prepare(`
      INSERT INTO publish_logs (
        workflow_id, post_id, channel_key, channel_name, title, content_preview,
        mode, status, external_url, response_note, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'published', ?, ?, ?)
    `);
    logIns.run(
      null,
      1,
      'website_blog',
      'Website / Blog',
      'การศึกษาไทย ในยุค AI',
      'เจาะลึกจุดเปลี่ยนครั้งสำคัญของระบบการศึกษาไทย โอกาส ความท้าทาย และแนวทางการพัฒนา',
      'internal_live',
      '/?post=1',
      'เผยแพร่ขึ้นหน้าเว็บไซต์หลักเรียบร้อยแล้ว (Featured Hero)',
      '2025-09-15T09:05:00.000Z'
    );
    logIns.run(
      null,
      6,
      'youtube',
      'YouTube',
      'คิดต่างอย่างสร้างสรรค์: พลิกโฉมคอนเทนต์การศึกษาด้วยระบบ AI Multi-Agent',
      'วิดีโอเจาะลึกแนวคิด AI + Human = Greater Impact โดย คมคิด by KOMKRIT',
      'internal_live',
      'https://www.youtube.com/watch?v=VxQwQ9vQkkc',
      'เชื่อมต่อลิงก์วิดีโอ YouTube จริงขึ้นระบบสำเร็จ',
      '2025-09-14T16:10:00.000Z'
    );
  }

  const svCount = (db.prepare('SELECT COUNT(*) as c FROM audience_surveys').get() as any).c;
  if (svCount === 0) {
    const svIns = db.prepare(`
      INSERT INTO audience_surveys (
        respondent_name, respondent_role, school_or_org, preferred_channel,
        requested_topic, satisfaction_score, feedback_detail, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    svIns.run(
      'ผอ.กิตติพงศ์ รัตนโชติ',
      'ครู / บุคลากรทางการศึกษา',
      'โรงเรียนเทศบาลต้นแบบ จ.ภูเก็ต',
      'LINE OA',
      'แนวทางการนำ AI มาช่วยครูวางแผนการสอนสองภาษา (ไทย-อังกฤษ-เมียนมา) สำหรับโรงเรียนในพื้นที่เศรษฐกิจพิเศษ',
      5,
      'เนื้อหาของคมคิดนำไปใช้ประชุมครูได้จริง อยากให้มีอินโฟกราฟิกสรุปสั้นส่งทาง LINE OA ทุกสัปดาห์ครับ',
      '2025-09-15T15:30:00.000Z'
    );
    svIns.run(
      'คุณศิริพร ใจดี',
      'ผู้ปกครอง',
      'เครือข่ายผู้ปกครองมัธยมศึกษา',
      'Facebook',
      'วิธีเตรียมทักษะอาชีพและภาษาให้ลูกหลานก้าวทันยุค AI โดยไม่เครียดเกินไป',
      5,
      'ติดตามอ่านทาง Facebook และเว็บไซต์ตลอดค่ะ อ่านเข้าใจง่ายและเห็นภาพอนาคตชัดเจน',
      '2025-09-16T08:45:00.000Z'
    );
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

  const insertPost = db.prepare(`
    INSERT INTO posts (
      title, subtitle, excerpt, content, category, content_type, cover_image,
      video_url, tags_json, author, status, is_featured, views, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  // 1. Featured Special Article (Center Hero Card in Desktop & Mobile mockups!)
  insertPost.run(
    'การศึกษาไทย ในยุค AI',
    'โอกาส ความท้าทาย และแนวทางการพัฒนา',
    'เจาะลึกจุดเปลี่ยนครั้งสำคัญของระบบการศึกษาไทย เมื่อ AI ไม่ได้เป็นเพียงเครื่องมือช่วยสอน แต่คือโครงสร้างพื้นฐานใหม่ในการพัฒนาผู้เรียน ครู และผู้บริหารสถานศึกษาให้ก้าวทันโลกอนาคต',
    `## การศึกษาไทยกำลังยืนอยู่บนจุดเปลี่ยนครั้งประวัติศาสตร์

เมื่อเทคโนโลยีปัญญาประดิษฐ์ (Artificial Intelligence) ก้าวเข้าสู่ยุค **Generative & Agentic AI** คำถามสำคัญไม่ใช่ "เราจะอนุญาตให้นักเรียนใช้ AI หรือไม่" อีกต่อไป แต่คือ **"เราจะออกแบบระบบการเรียนรู้ใหม่อย่างไร ให้มนุษย์ทำงานร่วมกับ AI ได้อย่างสร้างสรรค์และมีจริยธรรม"**

### 1. โอกาสใหม่ของการศึกษาไทย (Opportunities)
- **Personalized Learning รายบุคคล:** AI ช่วยวิเคราะห์จุดแข็งและช่องว่างการเรียนรู้ของนักเรียนแต่ละคน ทำให้ครูสามารถดูแลเด็กที่มีความเร็วในการเรียนรู้ต่างกันได้อย่างทั่วถึง
- **ลดภาระงานเอกสารของครู:** ระบบ AI Agent ช่วยร่างแผนการสอน ออกแบบสื่ออินโฟกราฟิก และประเมินผลเบื้องต้น คืนเวลาให้ครูได้ทำหน้าที่ "โค้ชชีวิตและผู้ออกแบบแรงบันดาลใจ"
- **เปิดโอกาสให้โรงเรียนขนาดเล็กและพื้นที่ห่างไกล:** เข้าถึงองค์ความรู้ระดับสากล ลดความเหลื่อมล้ำทางการศึกษาอย่างเป็นรูปธรรม

### 2. ความท้าทายที่ต้องก้าวข้าม (Challenges)
- **ทักษะการคิดวิเคราะห์ (Critical Thinking):** หากผู้เรียนใช้ AI เพื่อหาคำตอบสำเร็จรูปโดยไม่ผ่านกระบวนการตั้งคำถามและตรวจสอบข้อเท็จจริง (Fact-Checking) จะทำให้ทักษะการคิดเชิงลึกถดถอย
- **ความพร้อมของหลักสูตรและมาตรฐาน:** การปรับตัวของกรอบมาตรฐานการศึกษา (สพฐ., สช./OPEC, อาชีวศึกษา) ต้องยืดหยุ่นและเน้นสมรรถนะจริงมากกว่าการท่องจำ
- **จริยธรรมและความปลอดภัยทางดิจิทัล:** การคุ้มครองข้อมูลผู้เรียนและการรู้เท่าทันอคติของอัลกอริทึม

### 3. แนวทางการพัฒนาอย่างยั่งยืนตามแนวคิด "คิดต่างอย่างสร้างสรรค์"
1. **เปลี่ยนห้องเรียนจาก Content-Based สู่ Problem & Project-Based** ให้ผู้เรียนใช้ AI เป็นผู้ช่วยวิจัยและสร้างนวัตกรรมแก้ปัญหาจริงในชุมชน
2. **ยกระดับครูสู่ Learning Designer** พัฒนาทักษะการใช้ Multi-Agent AI ในการออกแบบสื่อการสอนคุณภาพสูง
3. **เชื่อมโยงการศึกษากับอาชีพจริงและทักษะตลอดชีวิต (Lifelong Learning)** เพื่อให้ผู้เรียนพร้อมเติบโตในโลกการทำงานยุคใหม่

> "การศึกษา คือรากฐานของการพัฒนาคน และการสร้างอนาคตที่ดีกว่า — เมื่อ AI ผสานกับหัวใจของความเป็นครู ผลลัพธ์คือโอกาสที่ยิ่งใหญ่กว่าเดิม"`,
    'special',
    'article',
    '/images/featured-speaker.jpg',
    'https://www.youtube.com/watch?v=VxQwQ9vQkkc',
    JSON.stringify(['การศึกษาไทย', 'AI เพื่อการศึกษา', 'บทความพิเศษ', 'นโยบายการศึกษา']),
    'คมกฤช (Komkrit)',
    'published',
    1,
    3850,
    '2025-09-15T09:00:00.000Z',
    '2025-09-15T09:00:00.000Z'
  );

  // 2. Latest Article 1 (from Desktop & Mobile mockups)
  insertPost.run(
    'AI เปลี่ยนการศึกษาได้จริงหรือ? โอกาสและความท้าทายสำหรับอนาคตการเรียนรู้ของไทย',
    'มุมมองเชิงปฏิบัติจากห้องเรียนจริงสู่นโยบายระดับประเทศ',
    'วิเคราะห์เจาะลึกว่า AI กับการศึกษาไทยจะสร้างการเปลี่ยนแปลงเชิงโครงสร้างได้จริงเพียงใด พร้อมกรณีศึกษาการประยุกต์ใช้ในโรงเรียนยุคใหม่',
    `## AI กับการศึกษา: จากกระแสตื่นตัวสู่การลงมือทำจริง

ในช่วงไม่กี่ปีที่ผ่านมา เราได้เห็นโรงเรียนและสถาบันการศึกษาทั่วโลกนำ AI เข้ามาปรับใช้ในห้องเรียน สำหรับประเทศไทย โอกาสที่แท้จริงอยู่ที่การเปลี่ยนผ่านจาก **"การเรียนเพื่อสอบ"** ไปสู่ **"การเรียนรู้เพื่อสร้างคุณค่า"**

### ประเด็นสำคัญที่ผู้บริหารและครูต้องเตรียมพร้อม
- **AI Literacy สำหรับทุกระดับชั้น:** สอนให้ผู้เรียนเข้าใจหลักการทำงาน ข้อจำกัด และการตั้งคำถาม (Prompting & Inquiry) อย่างมีวิจารณญาณ
- **การประเมินผลรูปแบบใหม่ (Authentic Assessment):** วัดผลจากกระบวนการคิด การนำเสนอ และการแก้ปัญหา แทนการตรวจเฉพาะชิ้นงานปลายทาง
- **ความร่วมมือระหว่างบ้าน โรงเรียน และสังคม:** สร้างนิเวศการเรียนรู้ที่ปลอดภัยและส่งเสริมความคิดสร้างสรรค์

ทุกความคิดที่แตกต่าง คือจุดเริ่มต้นของการเปลี่ยนแปลงและการสร้างสิ่งที่ดีกว่าให้กับเยาวชนไทย`,
    'ai-tech',
    'article',
    '/images/thumb-ai-edu.jpg',
    '',
    JSON.stringify(['AI & การศึกษา', 'อนาคตการเรียนรู้', 'EdTech']),
    'คมกฤช (Komkrit)',
    'published',
    0,
    2410,
    '2025-09-13T10:30:00.000Z',
    '2025-09-13T10:30:00.000Z'
  );

  // 3. Latest Article 2 (Thai-Myanmar Vocational School & Small Schools)
  insertPost.run(
    'โรงเรียนเอกชนไทย-เมียนมา โมเดลการศึกษาสู่การพัฒนาอาชีพและโรงเรียนยุคใหม่',
    'เชื่อมสะพานภาษา ทักษะอาชีพ และความร่วมมือข้ามพรมแดน',
    'ถอดบทเรียนการพัฒนาโรงเรียนภาษาและอาชีพ ไทย-เมียนมา และการปรับตัวของโรงเรียนเอกชน-โรงเรียนขนาดเล็กในโลกการศึกษายุคใหม่เพื่อสร้างทักษะที่ตลาดงานต้องการจริง',
    `## โมเดลการศึกษาที่ตอบโจทย์ชีวิตจริงและเศรษฐกิจระดับภูมิภาค

ในโลกการศึกษายุคใหม่ โรงเรียนไม่ได้มีหน้าที่เพียงส่งต่อใบปริญญา แต่คือ **"พื้นที่บ่มเพาะทักษะชีวิต ภาษา และอาชีพ"** ที่สามารถยกระดับคุณภาพชีวิตของผู้เรียนและครอบครัวได้ทันที

### จุดเด่นของโมเดลโรงเรียนภาษาและอาชีพ ไทย-เมียนมา
1. **หลักสูตรภาษาและอาชีพเชิงปฏิบัติ (Language & Vocational Integration):** บูรณาการภาษาไทย ภาษาอังกฤษ ภาษาเมียนมา เข้ากับทักษะวิชาชีพบริการ ดิจิทัล และการบริหารจัดการ
2. **ความร่วมมือไทย-เมียนมาอย่างสร้างสรรค์:** สร้างความเข้าใจทางวัฒนธรรม มาตรฐานแรงงานที่มีทักษะ และเครือข่ายพันธมิตรสถานประกอบการ
3. **ทางรอดของโรงเรียนขนาดเล็กและโรงเรียนเอกชน:** การสร้างอัตลักษณ์เฉพาะทาง (Niche Positioning) ที่ยืดหยุ่น ทันสมัย และเชื่อมตรงสู่โอกาสการทำงานระดับสากล`,
    'education',
    'article',
    '/images/thumb-school.jpg',
    '',
    JSON.stringify(['การศึกษา', 'ไทย-เมียนมา', 'พัฒนาอาชีพ', 'โรงเรียนเอกชน']),
    'คมกฤช (Komkrit)',
    'published',
    0,
    1820,
    '2025-09-11T08:15:00.000Z',
    '2025-09-11T08:15:00.000Z'
  );

  // 4. Latest Article 3 (Phuket Lifelong Learning Center)
  insertPost.run(
    'ภูเก็ต ศูนย์กลางการเรียนรู้ตลอดชีวิต (Lifelong Learning Center)',
    'จากเมืองท่องเที่ยวระดับโลก สู่ต้นแบบนิเวศการเรียนรู้นานาชาติ',
    'ศักยภาพของจังหวัดภูเก็ตในการก้าวขึ้นเป็นศูนย์กลางการเรียนรู้ตลอดชีวิต (Lifelong Learning Hub) ที่เชื่อมโยงการท่องเที่ยว นวัตกรรม ดิจิทัล และผู้เรียนจากทั่วโลก',
    `## ทำไม "ภูเก็ต" จึงมีศักยภาพเป็น Lifelong Learning Center ระดับนานาชาติ?

ภูเก็ตไม่ได้มีเพียงทรัพยากรธรรมชาติและอุตสาหกรรมการท่องเที่ยวระดับโลกเท่านั้น แต่ยังเป็นจุดตัดของพหุวัฒนธรรม เครือข่ายโรงเรียนนานาชาติ ผู้ประกอบการรุ่นใหม่ และชุมชนดิจิทัลจากทั่วโลก

### 4 เสาหลักในการขับเคลื่อน Phuket Lifelong Learning Center
- **Hospitality & Service Innovation:** ยกระดับทักษะการบริการและการจัดการมาตรฐานโลก
- **Multilingual & Cross-Cultural Hub:** ศูนย์กลางการเรียนรู้ภาษาและทักษะสื่อสารข้ามวัฒนธรรม
- **Digital Nomad & AI Upskilling:** พื้นที่จัดเวิร์กช็อป สัมมนา และแลกเปลี่ยนองค์ความรู้ด้านเทคโนโลยีและธุรกิจสร้างสรรค์
- **Community Learning Spaces:** เปิดพื้นที่การเรียนรู้สำหรับคนทุกช่วงวัย ตั้งแต่เยาวชน วัยทำงาน ไปจนถึงผู้สูงอายุ`,
    'international',
    'article',
    '/images/thumb-phuket.jpg',
    '',
    JSON.stringify(['ภูเก็ต', 'Lifelong Learning', 'ต่างประเทศ', 'เมืองแห่งการเรียนรู้']),
    'คมกฤช (Komkrit)',
    'published',
    0,
    1260,
    '2025-09-09T14:00:00.000Z',
    '2025-09-09T14:00:00.000Z'
  );

  // 5. Latest Article 4 (AI Agentic)
  insertPost.run(
    'AI Agentic : อนาคตของการทำงานและการศึกษา',
    'เมื่อ AI ทำงานเป็นทีม (Multi-Agent Ecosystem) เพื่อสร้างผลลัพธ์คุณภาพสูง',
    'ทำความรู้จักระบบ Multi-Agent AI ตั้งแต่ CEO Agent, Research Agent, Content & QA Agent ไปจนถึงการมีมนุษย์เป็นผู้ตรวจสอบและตัดสินใจ (Human-in-the-Loop)',
    `## จาก Chatbot สู่ระบบ Multi-Agent AI ที่ทำงานเป็นทีม

ก้าวต่อไปของปัญญาประดิษฐ์คือ **Agentic AI** — ระบบที่ AI แต่ละตัวได้รับบทบาทเฉพาะทาง ทำงานประสานกันอย่างเป็นระบบภายใต้การกำกับดูแลของมนุษย์ (**AI + Human = Greater Impact**)

### โครงสร้างการทำงานแบบ Multi-Agent ของ คมคิด by KOMKRIT
- **CEO Agent (Command Center):** วิเคราะห์โจทย์ วางกลยุทธ์ และกระจายงานให้ทีม Agent อัตโนมัติ
- **Content & Research Agent:** ค้นคว้าข้อมูลเชิงลึกจากฐานความรู้ (Knowledge Base) วิเคราะห์แนวโน้ม และเขียนสคริปต์/บทความ
- **Creative & Production Agents:** ออกแบบโครงสร้างภาพ อินโฟกราฟิก สตอรี่บอร์ดวิดีโอ และบทพากย์เสียง
- **QA Agent (Quality Assurance):** ตรวจสอบความถูกต้อง (Fact Check), ภาษา (Language), ภาพลักษณ์แบรนด์ (Brand) และความเสี่ยง (Risk)
- **Human Approval:** มนุษย์ยังคงเป็นหัวใจสำคัญในการตรวจสอบ อนุมัติ และเติมเต็มจิตวิญญาณของเนื้อหาก่อนเผยแพร่สู่ทุกช่องทาง`,
    'innovation',
    'article',
    '/images/thumb-agentic.jpg',
    'https://www.youtube.com/watch?v=VxQwQ9vQkkc',
    JSON.stringify(['AI Agentic', 'นวัตกรรม', 'Multi-Agent', 'อนาคตการทำงาน']),
    'คมกฤช (Komkrit)',
    'published',
    0,
    1432,
    '2025-09-07T11:20:00.000Z',
    '2025-09-07T11:20:00.000Z'
  );

  // 6. Video Post (referencing the exact YouTube video from the LINE chat!)
  insertPost.run(
    '[วิดีโอพิเศษ] คิดต่างอย่างสร้างสรรค์: พลิกโฉมคอนเทนต์การศึกษาด้วยระบบ AI Multi-Agent',
    'เจาะลึกเบื้องหลังการทำงาน AI + Human = Greater Impact',
    'รับชมแนวคิดการประยุกต์ใช้ AI Content Creation Flow เพื่อสร้างสื่อความรู้คุณภาพสูงสำหรับครู ผู้บริหารสถานศึกษา และผู้เรียนยุคใหม่',
    `## วิดีโอเจาะลึก: ระบบ Agent อัจฉริยะ สร้างคอนเทนต์การศึกษาครบวงจร

ในวิดีโอตอนนี้ คุณคมกฤช (Komkrit) พาสำรวจแนวคิดการผสานพลังของ **Multi-Agent AI** เข้ากับประสบการณ์จริงด้านการบริหารการศึกษา เพื่อสร้างเนื้อหาที่ทั้งถูกต้อง ลึกซึ้ง เข้าใจง่าย และสร้างผลกระทบเชิงบวกต่อสังคม

### ไฮไลต์สำคัญในวิดีโอ
- วิธีเปลี่ยนไอเดียและงานวิจัยให้กลายเป็นบทความ วิดีโอสั้น และสื่อการสอนในที่เดียว
- ทำไมต้องมี **QA Agent** และ **Human Approval** ก่อนเผยแพร่ทุกครั้ง
- โมเดลธุรกิจความรู้ **KOMKID 5-Pillar Business Model** (Content → Audience → Trust)`,
    'ai-tech',
    'video',
    '/images/featured-speaker.jpg',
    'https://www.youtube.com/watch?v=VxQwQ9vQkkc',
    JSON.stringify(['วิดีโอ', 'AI Multi-Agent', 'คมคิด by KOMKRIT']),
    'คมกฤช (Komkrit)',
    'published',
    0,
    2940,
    '2025-09-14T16:00:00.000Z',
    '2025-09-14T16:00:00.000Z'
  );

  // 7. Course / Workshop Post
  insertPost.run(
    'Workshop: AI for Education & Multi-Agent Content Studio สำหรับผู้บริหารและครูยุคใหม่',
    'หลักสูตรเข้มข้น ลงมือสร้างระบบผู้ช่วย AI ประจำโรงเรียนภายใน 1 วัน',
    'เวิร์กช็อปเชิงปฏิบัติการ ออกแบบหลักสูตร สื่อการสอน และระบบสื่อสารองค์กรการศึกษาด้วย AI อย่างมีมาตรฐานและจริยธรรม',
    `## ยกระดับทีมครูและบุคลากรทางการศึกษาด้วย AI เชิงกลยุทธ์

หลักสูตรเวิร์กช็อปที่ออกแบบมาเพื่อผู้บริหารสถานศึกษา ครู และทีมผลิตสื่อการศึกษาโดยเฉพาะ เน้นการนำไปใช้งานได้จริงทันที

### สิ่งที่ผู้เข้าอบรมจะได้รับ
1. **การสร้างฐานความรู้ของโรงเรียน (School Knowledge Base)** เพื่อให้ AI ตอบและสร้างสื่อตรงตามบริบทหลักสูตรจริง
2. **การวางระบบ Multi-Agent Workflow** ตั้งแต่งานวิจัย ออกแบบแผนการสอน สร้างอินโฟกราฟิก ไปจนถึงการตรวจคุณภาพ (QA)
3. **Workshop ลงมือปฏิบัติจริง** พร้อมเทมเพลตคำสั่งและแนวทางจริยธรรมการใช้ AI ในสถานศึกษา`,
    'career',
    'course',
    '/images/thumb-ai-edu.jpg',
    '',
    JSON.stringify(['เวิร์กช็อป', 'AI for Education', 'พัฒนาครู', 'อาชีพ & การพัฒนา']),
    'คมกฤช (Komkrit)',
    'published',
    0,
    980,
    '2025-09-10T09:00:00.000Z',
    '2025-09-10T09:00:00.000Z'
  );

  // 8. Society Post
  insertPost.run(
    'การศึกษาที่ดี สร้างคนที่ดี สร้างสังคมที่ดีได้: พลังความร่วมมือของชุมชนและโรงเรียน',
    'เมื่อการพัฒนาคนไม่ใช่หน้าที่ของโรงเรียนเพียงลำพัง',
    'มุมมองด้านการพัฒนาสังคมผ่านเครือข่ายผู้ปกครอง ชุมชน ท้องถิ่น และภาคธุรกิจ เพื่อสร้างพื้นที่ปลอดภัยและโอกาสที่เท่าเทียมให้เยาวชนทุกคน',
    `## Better Education · Better People · A Better Society

สังคมที่เข้มแข็งเริ่มต้นจากการเปิดพื้นที่ให้คนรุ่นใหม่ได้ค้นพบศักยภาพของตนเอง เมื่อโรงเรียน ชุมชน ผู้ปกครอง และภาคส่วนต่างๆ จับมือกัน การศึกษาจะไม่ใช่เรื่องในห้องสี่เหลี่ยมอีกต่อไป แต่คือการเรียนรู้ตลอดชีวิตที่หล่อหลอมพลเมืองคุณภาพสู่อนาคต`,
    'society',
    'article',
    '/images/thumb-phuket.jpg',
    '',
    JSON.stringify(['สังคม', 'พัฒนาคน', 'ชุมชนแห่งการเรียนรู้']),
    'คมกฤช (Komkrit)',
    'published',
    0,
    1150,
    '2025-09-05T10:00:00.000Z',
    '2025-09-05T10:00:00.000Z'
  );

  // Seed Comments (Audience Feedback / เสียงสะท้อนจากผู้ชม)
  const insertComment = db.prepare(`
    INSERT INTO comments (post_id, author_name, author_role, message, rating, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  insertComment.run(
    1,
    'อ.สายชล วัฒนากุล',
    'ครู / บุคลากรทางการศึกษา',
    'เห็นด้วยอย่างยิ่งครับเรื่องการคืนเวลาให้ครูมาเป็น Learning Designer บทความสรุปชัดเจนและนำไปคุยต่อในที่ประชุมวิชาการโรงเรียนได้เลยครับ',
    5,
    '2025-09-15T14:20:00.000Z'
  );
  insertComment.run(
    1,
    'คุณพิมพ์ชนก (ผู้ปกครอง ม.ต้น)',
    'ผู้ปกครอง',
    'อ่านเข้าใจง่ายมากค่ะ ทำให้ผู้ปกครองเข้าใจว่าควรแนะนำลูกให้ใช้ AI เพื่อตั้งคำถามและคิดวิเคราะห์ ไม่ใช่แค่ลอกคำตอบ',
    5,
    '2025-09-16T09:10:00.000Z'
  );
  insertComment.run(
    2,
    'ธนภัทร ศรีสุวรรณ',
    'นักเรียน',
    'ชอบแนวคิด Authentic Assessment มากครับ อยากให้ห้องเรียนเน้นทำโปรเจกต์แก้ปัญหาจริงแบบนี้เยอะๆ',
    5,
    '2025-09-14T18:45:00.000Z'
  );

  // Seed Knowledge Base (ฐานความรู้ from LINE Image 5)
  const insertKb = db.prepare(`
    INSERT INTO knowledge_base (title, category, summary, content, source_ref, is_active, created_at)
    VALUES (?, ?, ?, ?, ?, 1, ?)
  `);
  insertKb.run(
    'Brand Guideline & Tone of Voice: คมคิด by KOMKRIT',
    'brand_guideline',
    'อัตลักษณ์ น้ำเสียง และปรัชญาหลัก "คิดต่างอย่างสร้างสรรค์ เพื่อการศึกษา เพื่อสังคม เพื่ออนาคตที่ดีกว่า"',
    'น้ำเสียงอบอุ่น สุภาพ ลึกซึ้งแต่เข้าใจง่าย มีวิสัยทัศน์เชิงบริหารและหัวใจของนักการศึกษา เน้นการให้ทางออกเชิงสร้างสรรค์ (Solution-Oriented) ใช้คำขวัญหลัก: "คิดต่างอย่างสร้างสรรค์" และ "การศึกษาที่ดี สร้างคนที่ดี สร้างสังคมที่ดีได้ (Better Education · Better People · A Better Society)"',
    'Komkrit Brand Playbook 2025',
    '2025-09-01T08:00:00.000Z'
  );
  insertKb.run(
    'กรอบมาตรฐานการศึกษาและนโยบายรัฐ (สพฐ. / สช. OPEC / มาตรฐานสมรรถนะ)',
    'policy',
    'แนวทางการจัดการเรียนรู้ฐานสมรรถนะ การประกันคุณภาพการศึกษา และความยืดหยุ่นของสถานศึกษาเอกชน',
    'มุ่งเน้นสมรรถนะสำคัญของผู้เรียนยุคดิจิทัล ได้แก่ การคิดขั้นสูง การสื่อสารหลายภาษา การรู้เท่าทันเทคโนโลยี AI การทำงานร่วมกับผู้อื่นข้ามวัฒนธรรม และการเชื่อมโยงหลักสูตรสถานศึกษากับทักษะอาชีพในท้องถิ่น',
    'นโยบายการศึกษา สพฐ. / สช. (OPEC)',
    '2025-09-02T08:00:00.000Z'
  );
  insertKb.run(
    'โครงการพิเศษ: โรงเรียนภาษาและอาชีพ ไทย-เมียนมา & Phuket Lifelong Learning',
    'komkrit_vision',
    'ต้นแบบการพัฒนาทักษะภาษาและวิชาชีพข้ามพรมแดน และการขับเคลื่อนภูเก็ตสู่ศูนย์กลางการเรียนรู้ตลอดชีวิต',
    'บูรณาการหลักสูตรภาษา (ไทย-เมียนมา-อังกฤษ) คู่กับทักษะวิชาชีพบริการ ดิจิทัล และการเป็นผู้ประกอบการ พร้อมยกระดับจังหวัดภูเก็ตให้เป็น Lifelong Learning Hub ที่เชื่อมคนทุกเจเนอเรชัน',
    'Komkrit Special Initiative Archive',
    '2025-09-03T08:00:00.000Z'
  );
  insertKb.run(
    'จริยธรรม กฎหมาย PDPA และความเสี่ยงด้านสื่อการศึกษา',
    'regulation',
    'หลักเกณฑ์การตรวจสอบความเสี่ยงด้านข้อมูลส่วนบุคคลผู้เรียน ลิขสิทธิ์ และจริยธรรมการใช้ AI สำหรับ QA Agent',
    'ห้ามเปิดเผยข้อมูลส่วนบุคคลของนักเรียนและเยาวชน (PDPA), ระบุแหล่งอ้างอิงทางวิชาการที่ตรวจสอบได้, หลีกเลี่ยงอคติทางเชื้อชาติและภาษา, และตรวจสอบความถูกต้องของข้อมูลนโยบายก่อนเผยแพร่ทุกครั้ง',
    'PDPA & Educational Media Ethics Standard',
    '2025-09-04T08:00:00.000Z'
  );
  insertKb.run(
    'งานวิจัยแนวโน้ม AI Agentic ในระบบการศึกษาโลก 2025-2030',
    'research',
    'ข้อมูลเชิงลึกด้านการใช้ AI Tutor, Learning Copilot สำหรับครู และการวัดผลแบบ Authentic Assessment',
    'ผลสำรวจชี้ว่าการนำ AI Copilot มาช่วยครูออกแบบสื่อและงานธุรการช่วยลดเวลาเตรียมงานได้ 35-45% และเพิ่มเวลาการให้คำปรึกษารายบุคคลแก่ผู้เรียนอย่างมีนัยสำคัญ เมื่อมีระบบ Human-in-the-Loop กำกับคุณภาพ',
    'UNESCO & Global EdTech Trend Synthesis',
    '2025-09-05T08:00:00.000Z'
  );

  // Seed KOMKID 5-Pillar Business Model (from LINE Image 4!)
  const insertPillar = db.prepare(`
    INSERT INTO business_pillars (
      pillar_index, pillar_key, title, subtitle, description,
      metric_label, metric_value, status_badge, action_url
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  insertPillar.run(
    1,
    'views',
    '1. VIEWS | ยอดวิว',
    'YouTube • TikTok • Facebook • Ads',
    'สร้างการรับรู้และขยายฐานผู้ชมผ่านคอนเทนต์คุณภาพสูงบนทุกแพลตฟอร์ม เปลี่ยนความรู้ให้เข้าถึงผู้คนวงกว้าง',
    'ยอดการเข้าถึงรวม/เดือน',
    '148.5K Views',
    'CORE',
    ''
  );
  insertPillar.run(
    2,
    'products',
    '2. PRODUCTS | สินค้า',
    'สินค้าของเราเอง • สินค้าพันธมิตร • Affiliate',
    'พัฒนา e-Book คู่มือนวัตกรรมการศึกษา คอร์สออนไลน์ เทมเพลต AI สำหรับครู และคัดสรรสื่อคุณภาพจากพันธมิตร',
    'ผลิตภัณฑ์ & คอร์สพร้อมใช้',
    '12 รายการ',
    'UPDATED',
    ''
  );
  insertPillar.run(
    3,
    'sponsors',
    '3. SPONSORS | สปอนเซอร์',
    'Brand Partnership • Sponsored Content',
    'ร่วมมือกับองค์กรชั้นนำด้าน EdTech สถาบันการศึกษา และแบรนด์ที่มีวิสัยทัศน์พัฒนาคนและสังคมอย่างยั่งยืน',
    'พันธมิตรองค์กร',
    '6 แบรนด์',
    'ACTIVE',
    ''
  );
  insertPillar.run(
    4,
    'business',
    '4. BUSINESS | ธุรกิจ',
    'Consulting • Workshop • AI for Education',
    'ที่ปรึกษาบริหารสถานศึกษา อบรมเชิงปฏิบัติการ AI Multi-Agent สำหรับโรงเรียน และโครงการโรงเรียนภาษา-อาชีพ',
    'เวิร์กช็อป & ที่ปรึกษา',
    '9 โครงการ',
    'GROWTH',
    ''
  );
  insertPillar.run(
    5,
    'community',
    '5. COMMUNITY | ชุมชน',
    'สมาชิกระดับ VIP • แฟนคลับ • Networking',
    'เครือข่ายนักการศึกษา ผู้บริหาร ครู ผู้ปกครอง และคนรุ่นใหม่ที่มาร่วมเรียนรู้ พัฒนา และเติบโตไปด้วยกัน',
    'สมาชิกเครือข่ายคมคิด',
    '3,420 คน',
    'NEW',
    ''
  );

  // Seed 1 complete showcase AI Workflow in pending_approval so user can inspect or approve immediately!
  const now = '2025-09-16T10:00:00.000Z';
  db.prepare(`
    INSERT INTO ai_workflows (
      topic, input_source, category, target_audience, business_pillar,
      flow_mode, engine_used, status,
      ceo_json, research_json, script_json, design_json, visual_json,
      video_json, audio_json, qa_json, analytics_json, omnichannel_json, approval_json,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    '5 ทักษะสำคัญของครูไทยยุค AI Copilot: เปลี่ยนภาระงานเอกสารเป็นพลังสร้างแรงบันดาลใจ',
    'ปัญหา/ความต้องการของผู้เรียน/ครู/โรงเรียน',
    'ai-tech',
    'ครู / บุคลากรทางการศึกษา',
    '4. BUSINESS | ธุรกิจ (Workshop & AI for Education)',
    'full_8agent',
    'Komkrit Multi-Agent Ecosystem',
    'pending_approval',
    JSON.stringify({
      goal: 'สร้างคอนเทนต์เรือธงที่ช่วยให้ครูไทยเห็นแนวทางใช้ AI ลดภาระงานเอกสารอย่างเป็นรูปธรรม และต่อยอดสู่เวิร์กช็อป AI for Education',
      strategy: 'ใช้โครงสร้าง Empathy → Insight → 5 Actionable Skills → ตัวอย่างจริงในห้องเรียน ด้วยน้ำเสียงอบอุ่นและให้เกียรติวิชาชีพครู',
      keyMessage: 'AI ไม่ได้มาแทนที่หัวใจของความเป็นครู แต่มาช่วยคืนเวลาให้ครูได้ดูแลลูกศิษย์อย่างเต็มศักยภาพ',
      kpiTargets: ['อัตราอ่านจบ > 68%', 'แชร์ต่อในกลุ่มครู > 300 ครั้ง', 'ผู้สนใจลงทะเบียนรับข่าวสาร/เวิร์กช็อป > 45 คน'],
      agentAssignments: [
        { agent: '01 Research Agent', mission: 'สังเคราะห์ข้อมูลเวลาทำงานครูไทยและแนวโน้ม AI Copilot จากฐานความรู้' },
        { agent: '02 Idea & Script Agent', mission: 'เขียนบทความฉบับเต็ม + สคริปต์คลิปสั้น 90 วินาที' },
        { agent: '03-06 Creative & Production', mission: 'วางโครงสไลด์ อินโฟกราฟิก สตอรี่บอร์ด และบทพากย์เสียง' },
        { agent: '07 QA Agent', mission: 'ตรวจ Fact Check, ภาษา, Brand Tone และ PDPA Risk ก่อนส่ง Human Approval' },
      ],
    }),
    JSON.stringify({
      deepInsights: [
        'ครูไทยใช้เวลากับงานเอกสารและประเมินผลธุรการเฉลี่ยมากกว่า 30-40% ของเวลาทำงานสัปดาห์ละ 50 ชั่วโมง',
        'การใช้ AI ช่วยร่างแผนการจัดการเรียนรู้ฐานสมรรถนะและใบงานรายบุคคลช่วยประหยัดเวลาเตรียมสอนได้กว่า 40%',
        'หัวใจสำคัญคือการมีคลังความรู้โรงเรียน (School Knowledge Base) เพื่อให้เนื้อหาแม่นยำตามหลักสูตร สพฐ./สช.',
      ],
      keyFacts: [
        'ทักษะการตั้งโจทย์ (Instructional Prompting) สำคัญกว่าการจำเครื่องมือ',
        'ต้องยึดหลัก PDPA ไม่นำข้อมูลส่วนบุคคลของนักเรียนขึ้นระบบสาธารณะโดยไม่ปิดบังตัวตน',
      ],
      trendAnalysis: 'แนวโน้มปี 2568-2570 โรงเรียนชั้นนำกำลังเปลี่ยนจากการอบรมเครื่องมือเดี่ยว ไปสู่การวางระบบ Multi-Agent Workflow ประจำหมวดวิชา',
      references: ['กรอบมาตรฐานการศึกษา สพฐ. / สช. (OPEC)', 'UNESCO Guidance for Generative AI in Education', 'Komkrit Brand Playbook 2025'],
      kbSourcesUsed: ['Brand Guideline & Tone of Voice: คมคิด by KOMKRIT', 'งานวิจัยแนวโน้ม AI Agentic ในระบบการศึกษาโลก 2025-2030'],
    }),
    JSON.stringify({
      titleSuggestions: [
        '5 ทักษะสำคัญของครูไทยยุค AI Copilot: เปลี่ยนภาระงานเอกสารเป็นพลังสร้างแรงบันดาลใจ',
        'เมื่อ AI คืนเวลาให้ห้องเรียน: คู่มือยกระดับครูไทยสู่ Learning Designer ยุคใหม่',
        'ครูยุค AI ไม่ต้องเหนื่อยคนเดียว: วิธีจัดทีมผู้ช่วย AI ประจำห้องเรียนอย่างมืออาชีพ',
      ],
      selectedTitle: '5 ทักษะสำคัญของครูไทยยุค AI Copilot: เปลี่ยนภาระงานเอกสารเป็นพลังสร้างแรงบันดาลใจ',
      subtitle: 'แนวทางปฏิบัติจริงเพื่อคืนเวลาให้ครูกลับมาสร้างแรงบันดาลใจให้ผู้เรียน',
      excerpt: 'เจาะลึก 5 ทักษะสำคัญที่จะช่วยให้ครูและบุคลากรทางการศึกษาใช้ AI เป็นผู้ช่วยลดงานเอกสาร ออกแบบสื่อการสอนเฉพาะบุคคล และรักษามาตรฐานจริยธรรมอย่างมืออาชีพ',
      learningObjectives: [
        'เข้าใจบทบาทใหม่ของครูในฐานะ Learning Designer ที่ทำงานร่วมกับ AI Copilot',
        'ประยุกต์ใช้ 5 ทักษะหลักในการลดเวลาทำเอกสารและเพิ่มคุณภาพแผนการสอน',
        'ตระหนักถึงการตรวจสอบความถูกต้อง (Fact Check) และคุ้มครองข้อมูลผู้เรียน (PDPA)',
      ],
      fullArticleMarkdown: `## เมื่อ AI ไม่ได้มาแทนครู แต่มา "คืนเวลา" ให้หัวใจของความเป็นครู\n\nสิ่งหนึ่งที่ผมได้รับฟังจากคุณครูและผู้บริหารสถานศึกษาทั่วประเทศเสมอ คือความตั้งใจอยากทุ่มเทเวลาดูแลลูกศิษย์แต่ละคนอย่างใกล้ชิด แต่กลับต้องแบกรับภาระงานเอกสารและการเตรียมสื่อที่กินเวลามหาศาล\n\nวันนี้เทคโนโลยี **AI Copilot และระบบ Multi-Agent** ก้าวมาถึงจุดที่สามารถเป็นผู้ช่วยมือขวาของคุณครูได้จริง หากเราพัฒนา **5 ทักษะสำคัญ** ต่อไปนี้:\n\n### 1. ทักษะการออกแบบโจทย์การเรียนรู้ (Instructional Prompting)\nเปลี่ยนจากการสั่งให้ AI "เขียนเนื้อหาทั่วไป" เป็นการกำหนดบริบทระดับชั้น จุดประสงค์การเรียนรู้ และสมรรถนะที่ต้องการวัดผลอย่างชัดเจน\n\n### 2. ทักษะการปรับเนื้อหารายบุคคล (Personalized Differentiation)\nใช้ AI ช่วยปรับระดับความยากง่ายของใบงานและกรณีศึกษาให้เหมาะกับผู้เรียนที่มีพื้นฐานแตกต่างกันในห้องเดียว\n\n### 3. ทักษะการเปลี่ยนเนื้อหาเป็นสื่อภาพและกิจกรรม (Visual & Activity Design)\nย่อยบทเรียนซับซ้อนให้กลายเป็นแผนผังความคิด (Mind Map) อินโฟกราฟิก และโจทย์ Project-Based Learning\n\n### 4. ทักษะการตรวจสอบความถูกต้องและอคติ (Fact-Checking & QA Mindset)\nครูต้องเป็นผู้ตรวจทานข้อเท็จจริง ความเหมาะสมทางภาษา และความสอดคล้องกับบริบทสังคมไทยก่อนนำไปใช้จริงเสมอ\n\n### 5. ทักษะจริยธรรมและการปกป้องข้อมูลผู้เรียน (AI Ethics & PDPA)\nสร้างกติกาการใช้ AI ในห้องเรียนอย่างโปร่งใส ไม่นำข้อมูลระบุตัวตนของนักเรียนเข้าสู่ระบบภายนอก และสอนให้เด็กใช้ AI เพื่อต่อยอดความคิด ไม่ใช่แทนความคิด\n\n> "ทุกความคิดที่แตกต่าง คือจุดเริ่มต้นของการเปลี่ยนแปลง — เมื่อครูมีเครื่องมือที่ใช่ ห้องเรียนไทยจะเต็มไปด้วยพลังแห่งการสร้างสรรค์"`,
      videoScript: `[0:00-0:12 Hook] คุณครูครับ... จะดีแค่ไหนถ้างานเอกสารที่เคยใช้เวลา 3 ชั่วโมง เสร็จลงใน 20 นาที แล้วเราได้เวลาเหล่านั้นกลับไปคุยและดูแลลูกศิษย์จริงๆ?\n[0:12-0:45 Core] วันนี้ คมคิด by KOMKRIT สรุป 5 ทักษะครูยุค AI Copilot ตั้งแต่การตั้งโจทย์ตามสมรรถนะ การออกแบบใบงานรายบุคคล ไปจนถึงการตรวจทานคุณภาพและ PDPA...\n[0:45-0:60 CTA] เพราะ AI ไม่ได้มาแทนครู แต่มาคืนพลังให้ครูสร้างอนาคตที่ดีกว่า อ่านบทความฉบับเต็มได้ที่เว็บไซต์ คมคิด by KOMKRIT ครับ`,
      socialHook: 'AI ไม่ได้มาแทนที่หัวใจของความเป็นครู... แต่มาช่วย "คืนเวลา" ให้ครูได้สร้างแรงบันดาลใจให้ลูกศิษย์อย่างเต็มที่ 💡 สรุป 5 ทักษะสำคัญของครูไทยยุค AI Copilot',
    }),
    JSON.stringify({
      contentStructure: ['บทนำสะท้อนปัญหาจริงของครู', 'กรอบแนวคิด AI + Human', 'เจาะลึก 5 ทักษะพร้อมวิธีลงมือทำ', 'ข้อคิดส่งท้ายจาก Komkrit & CTA'],
      brandTone: 'Navy & Warm Amber (#0f294a / #f59e0b) สุภาพ ลึกซึ้ง สร้างแรงบันดาลใจ',
      mindMapNodes: {
        center: '5 ทักษะครูยุค AI Copilot',
        branches: [
          { title: 'การออกแบบสอน', items: ['Instructional Prompting', 'Personalized Worksheet'] },
          { title: 'สื่อสร้างสรรค์', items: ['Mind Map & Infographic', 'Project-Based Activity'] },
          { title: 'คุณภาพ & จริยธรรม', items: ['Fact Check โดยครู', 'คุ้มครองข้อมูล PDPA'] },
        ],
      },
      slideDeckOutline: [
        { slide: 1, title: 'คืนเวลาให้ห้องเรียนไทยด้วย AI Copilot', bullet: 'ทำไมครูยุคใหม่คือ Learning Designer' },
        { slide: 2, title: 'ทักษะที่ 1-2: ตั้งโจทย์แม่นยำ & ดูแลรายบุคคล', bullet: 'ลดเวลาเตรียมแผนการสอน 40%' },
        { slide: 3, title: 'ทักษะที่ 3: เปลี่ยนบทเรียนเป็นภาพและกิจกรรม', bullet: 'เชื่อมโยงปัญหาจริงในชุมชน' },
        { slide: 4, title: 'ทักษะที่ 4-5: QA & จริยธรรม PDPA', bullet: 'AI + Human = Greater Impact' },
      ],
      instructionalDesign: 'ใช้โมเดล Micro-Learning อ่านจบใน 4 นาที พร้อม Checklist ให้ครูนำไปทดลองในคาบเรียนถัดไปได้ทันที',
    }),
    JSON.stringify({
      imagePrompts: [
        { platform: 'Gemini Nano Banana 2.1', prompt: 'Modern Thai classroom where an inspiring educator mentors smiling students with clean holographic AI learning mind-maps, deep navy and warm golden lighting, editorial photography' },
        { platform: 'Canva AI / Infographic', prompt: 'Clean executive educational infographic in Thai style, navy blue #0f294a and amber gold #f59e0b, 5 circular icons around central lightbulb-pencil emblem' },
      ],
      infographicHeadline: '5 ทักษะครูไทยยุค AI COPILOT',
      infographicSubpoints: ['1. ออกแบบโจทย์แม่นยำ', '2. ปรับใบงานรายบุคคล', '3. สร้างสื่อภาพ & กิจกรรม', '4. ตรวจทานความถูกต้อง', '5. จริยธรรม & PDPA'],
      generatedSvgDataUrl: '',
      recommendedTools: ['Gemini Nano Banana 2.1', 'Canva AI', 'Midjourney', 'Figma'],
    }),
    JSON.stringify({
      duration: '60 วินาที (Reels / TikTok / YouTube Shorts)',
      avatarStyle: 'Komkrit Smart Casual Navy Blazer พร้อมอินโฟกราฟิกประกอบด้านข้าง',
      scenes: [
        { time: '00:00 - 00:10', visual: 'Medium Shot คุณคมกฤช + ตัวเลข 40% บนหน้าจอ', dialogue: 'จะดีแค่ไหนครับ ถ้าเราลดเวลางานเอกสารครูลงได้เกือบครึ่ง?', subtitle: 'คืนเวลา 40% ให้ห้องเรียนไทย 💡', bRoll: 'ภาพครูเตรียมเอกสารกองโตเปลี่ยนเป็นรอยยิ้มในห้องเรียน' },
        { time: '00:10 - 00:42', visual: 'Pop-up 5 Icons เรียงตามจังหวะพูด', dialogue: 'ด้วย 5 ทักษะ AI Copilot ตั้งแต่การตั้งโจทย์สมรรถนะ ออกแบบสื่อรายบุคคล ไปจนถึงการตรวจ QA และ PDPA', subtitle: '5 ทักษะสำคัญครูยุค AI Copilot', bRoll: 'หน้าจอระบบ Multi-Agent AI ทำงานเป็นทีม' },
        { time: '00:42 - 01:00', visual: 'โลโก้ คมคิด by KOMKRIT + ลิงก์บทความ', dialogue: 'เพราะ AI ไม่ได้มาแทนครู แต่มาเสริมพลังให้ครูสร้างคนคุณภาพ อ่านฉบับเต็มได้ที่ คมคิด by KOMKRIT ครับ', subtitle: 'อ่านต่อที่ คมคิด by KOMKRIT →', bRoll: 'ภาพนักเรียนทำกิจกรรมกลุ่มอย่างมีความสุข' },
      ],
      recommendedTools: ['Gemini Omni 1.1 Flash', 'HeyGen (AI Avatar)', 'CapCut', 'Descript'],
    }),
    JSON.stringify({
      voiceTone: 'น้ำเสียงอบอุ่น สุภาพ มั่นใจ จังหวะกระชับ (115 คำ/นาที)',
      narrationScriptWithCues: '[น้ำเสียงอบอุ่น ชวนคิด] คุณครูครับ... จะดีแค่ไหนถ้างานเอกสารที่เคยใช้เวลาหลายชั่วโมง เสร็จลงอย่างมีคุณภาพในไม่กี่นาที [เว้นจังหวะ 0.8 วินาที] แล้วเราได้เวลาเหล่านั้นกลับไปดูแลลูกศิษย์จริงๆ? [เน้นเสียงสร้างพลัง] เพราะ AI ไม่ได้มาแทนหัวใจของความเป็นครู แต่มาเป็นผู้ช่วยคืนเวลาให้ห้องเรียนไทยครับ',
      bgmStyle: 'Inspiring Acoustic Piano & Soft Ambient Corporate (-22 LUFS)',
      soundEffects: ['Soft Whoosh ตอนขึ้นหัวข้อ 1-5', 'Warm Chime ตอนขึ้นสโลแกน คิดต่างอย่างสร้างสรรค์'],
      recommendedTools: ['Gemini 3.8 Flash TTS', 'ElevenLabs', 'Adobe Podcast', 'Auphonic'],
    }),
    JSON.stringify({
      factCheckScore: 95,
      factCheckNote: 'ข้อมูลสอดคล้องกับแนวทาง UNESCO และกรอบสมรรถนะการศึกษาไทย มีการอ้างอิงฐานความรู้ครบถ้วน',
      languageScore: 96,
      languageNote: 'ภาษาไทยสละสลวย สะกดถูกต้อง โครงสร้างย่อหน้าอ่านง่ายทั้งบนคอมพิวเตอร์และมือถือ',
      brandScore: 98,
      brandNote: 'ตรงตามอัตลักษณ์ "คมคิด by KOMKRIT" ให้เกียรติวิชาชีพครูและชี้ทางออกเชิงสร้างสรรค์',
      riskScore: 97,
      riskNote: 'ปลอดภัย 100% มีการเน้นย้ำเรื่อง PDPA และการตรวจสอบโดยมนุษย์อย่างชัดเจน',
      overallScore: 97,
      verdict: 'ผ่าน',
      improvements: ['สามารถเพิ่มลิงก์ลงทะเบียน Workshop AI for Education ท้ายบทความเพื่อเชื่อมสู่ Pillar ที่ 4'],
    }),
    JSON.stringify({
      predictedReach: '18,500 - 26,000 การมองเห็นใน 7 วันแรก',
      predictedEngagement: 'อัตราการแชร์สูงในกลุ่มครูและผู้บริหารสถานศึกษา (คาดการณ์ CTR 6.4%)',
      targetLearnerFit: 'ตรงกลุ่มครู บุคลากรทางการศึกษา และผู้บริหารโรงเรียน 96%',
      abHeadlines: [
        'A: 5 ทักษะสำคัญของครูไทยยุค AI Copilot: เปลี่ยนภาระงานเอกสารเป็นพลังสร้างแรงบันดาลใจ',
        'B: คืนเวลาให้ห้องเรียน! 5 ทักษะใช้ AI เป็นผู้ช่วยครูอย่างมืออาชีพและปลอดภัย',
      ],
      optimizationTips: [
        'โพสต์ช่วงเวลา 19:30 - 21:00 น. ซึ่งเป็นช่วงที่ครูและผู้ปกครองอ่านบทความเชิงลึกมากที่สุด',
        'แนบภาพอินโฟกราฟิกสรุป 5 ข้อควบคู่กับลิงก์บทความเว็บไซต์ใน LINE OA และ Facebook',
      ],
    }),
    JSON.stringify({
      youtube: {
        title: '5 ทักษะครูไทยยุค AI Copilot คืนเวลาให้ห้องเรียน | คมคิด by KOMKRIT',
        description: 'เจาะลึกวิธีใช้ AI เป็นผู้ช่วยลดงานเอกสารและยกระดับการสอน พร้อมหลัก QA & PDPA สำหรับโรงเรียนยุคใหม่',
        tags: ['คมคิดbyKOMKRIT', 'AIเพื่อการศึกษา', 'พัฒนาครู', 'EdTechThailand'],
      },
      facebook: {
        post: '💡 AI ไม่ได้มาแทนที่หัวใจของความเป็นครู... แต่มาช่วย "คืนเวลา" ให้ครูได้สร้างแรงบันดาลใจให้ลูกศิษย์\n\nชวนอ่าน 5 ทักษะสำคัญของครูไทยยุค AI Copilot ที่เปลี่ยนงานเอกสารหนักๆ ให้เป็นสื่อการสอนคุณภาพสูง พร้อมแนวทางจริยธรรมและ PDPA ที่โรงเรียนนำไปใช้ได้ทันทีครับ',
        engagementQuestion: 'คุณครูคิดว่างานส่วนไหนในโรงเรียนที่อยากให้ AI เข้ามาช่วยแบ่งเบาภาระมากที่สุดครับ? มาแลกเปลี่ยนกันใต้โพสต์นี้ได้เลยครับ 👇',
      },
      tiktok: {
        hook: 'ลดเวลางานเอกสารครูลง 40% ด้วย 5 ทักษะ AI Copilot นี้!',
        caption: 'คืนเวลาให้ครูกลับมาสร้างแรงบันดาลใจให้เด็กๆ #คมคิดbyKOMKRIT #คิดต่างอย่างสร้างสรรค์',
        hashtags: ['#คมคิดbyKOMKRIT', '#AIการศึกษา', '#ครูไทยยุคใหม่', '#EdTech'],
      },
      lineOa: {
        headline: '📚 บทความใหม่: 5 ทักษะครูไทยยุค AI Copilot',
        broadcastMessage: 'สวัสดีครับชาวคมคิด! วันนี้ผมสรุปแนวทางใช้ AI ช่วยลดภาระงานเอกสารครูและออกแบบใบงานรายบุคคลอย่างปลอดภัยตามหลัก PDPA อ่านฉบับเต็มพร้อมอินโฟกราฟิกได้เลยครับ →',
      },
      xTwitter: {
        thread: [
          '1/ คำถามของการศึกษาไทยวันนี้ไม่ใช่ "จะให้ใช้ AI ไหม" แต่คือ "จะติดอาวุธให้ครูใช้ AI คืนเวลาสู่ห้องเรียนอย่างไร" 🧵👇',
          '2/ 5 ทักษะสำคัญของครูยุค AI Copilot: (1) Instructional Prompting (2) ใบงานรายบุคคล (3) เปลี่ยนเนื้อหาเป็นภาพ/โปรเจกต์ (4) ตรวจ Fact Check (5) จริยธรรม & PDPA',
          '3/ เพราะ AI + Human = Greater Impact อ่านบทความเต็มได้ที่เว็บไซต์ คมคิด by KOMKRIT ครับ #คมคิดbyKOMKRIT',
        ],
      },
      instagram: {
        carouselSlides: [
          'Slide 1: 5 ทักษะครูไทยยุค AI COPILOT คืนเวลาให้ห้องเรียน',
          'Slide 2: 1. ตั้งโจทย์ตามสมรรถนะ & 2. ออกแบบใบงานรายบุคคล',
          'Slide 3: 3. สร้างสื่อภาพ & 4. ครูตรวจทานความถูกต้อง (QA)',
          'Slide 4: 5. ยึดมั่นจริยธรรม & PDPA — AI + Human = Greater Impact',
        ],
        caption: 'คิดต่างอย่างสร้างสรรค์ เพื่อการศึกษา เพื่อสังคม เพื่ออนาคตที่ดีกว่า ✨ อ่านฉบับเต็มได้ที่ลิงก์หน้าโปรไฟล์',
      },
      websiteBlog: {
        slug: '5-ai-copilot-skills-for-thai-teachers',
        seoMeta: '5 ทักษะสำคัญของครูไทยยุค AI Copilot ลดงานเอกสาร เพิ่มคุณภาพการสอน โดย คมคิด by KOMKRIT',
      },
      emailNewsletter: {
        subject: '[คมคิด Newsletter] 5 ทักษะครูไทยยุค AI Copilot: คืนเวลาให้หัวใจของความเป็นครู',
        previewText: 'แนวทางปฏิบัติจริงในการนำ AI มาช่วยลดภาระงานเอกสารและออกแบบการเรียนรู้รายบุคคล',
        bodyIntro: 'สวัสดีครับกัลยาณมิตรทางการศึกษาทุกท่าน สัปดาห์นี้ผมขอนำเสนอมุมมองเชิงปฏิบัติที่จะช่วยให้คุณครูใช้ AI อย่างสบายใจและทรงพลัง...',
      },
      publishedChannels: [],
    }),
    JSON.stringify({
      isAccurate: true,
      isAppropriate: true,
      isOnBrand: true,
      isReady: false,
      reviewerNote: 'รอผู้บริหาร (Human Approval) กดอนุมัติเพื่อเผยแพร่ขึ้นหน้าเว็บไซต์หลักทันที',
      publishedPostId: null,
    }),
    now,
    now
  );

  // Seed default subscribers & settings
  db.prepare(`INSERT INTO subscribers (email, name, role, created_at) VALUES (?, ?, ?, ?)`).run(
    'teacher.somchai@school.ac.th',
    'ผอ.สมชาย เกียรติเจริญ',
    'ครู / บุคลากรทางการศึกษา',
    '2025-09-10T08:00:00.000Z'
  );
  db.prepare(`INSERT INTO subscribers (email, name, role, created_at) VALUES (?, ?, ?, ?)`).run(
    'nicha.parent@gmail.com',
    'คุณณิชา วงศ์สวัสดิ์',
    'ผู้ปกครอง',
    '2025-09-12T11:30:00.000Z'
  );

  const setSetting = db.prepare(`INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)`);
  setSetting.run('ai_provider', 'auto');
  setSetting.run('gemini_model', 'gemini-3.8-flash');
  setSetting.run('gemini_api_key', process.env.GEMINI_API_KEY || '');
  setSetting.run('local_endpoint', 'http://localhost:1234/v1');
  setSetting.run('local_model', 'omni-o1x-pro');
}
