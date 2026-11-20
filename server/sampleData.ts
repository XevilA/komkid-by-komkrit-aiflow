// ============================================================================
// SAMPLE DATA — what older installs were pre-filled with (demo articles, made-up
// people, invented statistics, example social accounts). A real site must not
// carry any of it. New installs are no longer seeded; on existing installs the
// admin can review and remove exactly these records (and nothing else).
// ============================================================================
import { db } from './db.ts';
import { deletePostRows } from './postsRepo.ts';

export const SAMPLE_POST_TITLES: string[] = [
  'การศึกษาไทย ในยุค AI',
  'AI เปลี่ยนการศึกษาได้จริงหรือ? โอกาสและความท้าทายสำหรับอนาคตการเรียนรู้ของไทย',
  'โรงเรียนเอกชนไทย-เมียนมา โมเดลการศึกษาสู่การพัฒนาอาชีพและโรงเรียนยุคใหม่',
  'ภูเก็ต ศูนย์กลางการเรียนรู้ตลอดชีวิต (Lifelong Learning Center)',
  'AI Agentic : อนาคตของการทำงานและการศึกษา',
  '[วิดีโอพิเศษ] คิดต่างอย่างสร้างสรรค์: พลิกโฉมคอนเทนต์การศึกษาด้วยระบบ AI Multi-Agent',
  'Workshop: AI for Education & Multi-Agent Content Studio สำหรับผู้บริหารและครูยุคใหม่',
  'การศึกษาที่ดี สร้างคนที่ดี สร้างสังคมที่ดีได้: พลังความร่วมมือของชุมชนและโรงเรียน',
];
export const SAMPLE_COMMENT_AUTHORS: string[] = [
  'อ.สายชล วัฒนากุล',
  'คุณพิมพ์ชนก (ผู้ปกครอง ม.ต้น)',
  'ธนภัทร ศรีสุวรรณ',
];
export const SAMPLE_KB_TITLES: string[] = [
  'Brand Guideline & Tone of Voice: คมคิด by KOMKRIT',
  'กรอบมาตรฐานการศึกษาและนโยบายรัฐ (สพฐ. / สช. OPEC / มาตรฐานสมรรถนะ)',
  'โครงการพิเศษ: โรงเรียนภาษาและอาชีพ ไทย-เมียนมา & Phuket Lifelong Learning',
  'จริยธรรม กฎหมาย PDPA และความเสี่ยงด้านสื่อการศึกษา',
  'งานวิจัยแนวโน้ม AI Agentic ในระบบการศึกษาโลก 2025-2030',
];
export const SAMPLE_SUBSCRIBER_EMAILS: string[] = [
  'teacher.somchai@school.ac.th',
  'nicha.parent@gmail.com',
];
export const SAMPLE_SURVEY_RESPONDENTS: string[] = [
  'ผอ.กิตติพงศ์ รัตนโชติ',
  'คุณศิริพร ใจดี',
];
export const SAMPLE_CAMPAIGN_TOPIC_PREFIX = '5 ทักษะสำคัญของครูไทยยุค AI Copilot: เปล';
export const SAMPLE_PILLAR_KEYS: string[] = [
  'views',
  'products',
  'sponsors',
  'business',
  'community',
];
export const SAMPLE_PILLAR_METRICS: string[] = [
  '148.5K Views',
  '12 รายการ',
  '6 แบรนด์',
  '9 โครงการ',
  '3,420 คน',
];
export const SAMPLE_CHANNEL_HANDLES: Record<string, string> = {
  youtube: 'https://www.youtube.com/watch?v=VxQwQ9vQkkc',
  facebook: 'https://facebook.com/komkidbykomkrit',
  tiktok: 'https://tiktok.com/@komkidbykomkrit',
  line_oa: '@komkidbykomkrit',
  x_twitter: 'https://x.com/komkidbykomkrit',
  instagram: 'https://instagram.com/komkidbykomkrit',
  website_blog: 'http://localhost:3000',
  email_newsletter: 'newsletter@komkrit.com',
};

const ph = (n: number) => Array(n).fill('?').join(',');

export interface SampleReport {
  posts: { id: number; title: string; views: number }[];
  comments: number;
  knowledge: number;
  subscribers: number;
  surveys: number;
  campaigns: number;
  publishLogs: number;
  pillarsWithInventedMetrics: number;
  channelsWithExampleHandles: number;
  total: number;
}

export function detectSampleData(): SampleReport {
  const posts = db
    .prepare(`SELECT id, title, views FROM posts WHERE title IN (${ph(SAMPLE_POST_TITLES.length)})`)
    .all(...SAMPLE_POST_TITLES) as any[];
  const postIds = posts.map((p) => p.id);
  const comments = postIds.length
    ? Number((db.prepare(`SELECT COUNT(*) c FROM comments WHERE author_name IN (${ph(SAMPLE_COMMENT_AUTHORS.length)})`).get(...SAMPLE_COMMENT_AUTHORS) as any).c)
    : 0;
  const count = (sql: string, ...args: unknown[]) => Number((db.prepare(sql).get(...args as any[]) as any).c);
  const knowledge = count(`SELECT COUNT(*) c FROM knowledge_base WHERE title IN (${ph(SAMPLE_KB_TITLES.length)})`, ...SAMPLE_KB_TITLES);
  const subscribers = count(`SELECT COUNT(*) c FROM subscribers WHERE email IN (${ph(SAMPLE_SUBSCRIBER_EMAILS.length)})`, ...SAMPLE_SUBSCRIBER_EMAILS);
  const surveys = count(`SELECT COUNT(*) c FROM audience_surveys WHERE respondent_name IN (${ph(SAMPLE_SURVEY_RESPONDENTS.length)})`, ...SAMPLE_SURVEY_RESPONDENTS);
  const campaigns = count('SELECT COUNT(*) c FROM ai_workflows WHERE topic LIKE ?', `${SAMPLE_CAMPAIGN_TOPIC_PREFIX}%`);
  const publishLogs = count(
    "SELECT COUNT(*) c FROM publish_logs WHERE workflow_id IS NULL AND created_at IN ('2025-09-15T09:05:00.000Z','2025-09-14T16:10:00.000Z')"
  );
  const pillarsWithInventedMetrics = count(
    `SELECT COUNT(*) c FROM business_pillars WHERE pillar_key IN (${ph(SAMPLE_PILLAR_KEYS.length)}) AND metric_value IN (${ph(SAMPLE_PILLAR_METRICS.length)})`,
    ...SAMPLE_PILLAR_KEYS,
    ...SAMPLE_PILLAR_METRICS
  );
  let channelsWithExampleHandles = 0;
  for (const [key, handle] of Object.entries(SAMPLE_CHANNEL_HANDLES)) {
    channelsWithExampleHandles += count("SELECT COUNT(*) c FROM channel_configs WHERE channel_key = ? AND handle_or_url = ? AND access_token = ''", key, handle);
  }
  const total =
    posts.length + comments + knowledge + subscribers + surveys + campaigns + publishLogs + pillarsWithInventedMetrics + channelsWithExampleHandles;
  return { posts, comments, knowledge, subscribers, surveys, campaigns, publishLogs, pillarsWithInventedMetrics, channelsWithExampleHandles, total };
}

/** Removes the sample records. Anything the admin wrote or edited is left alone (matching is exact). */
export function removeSampleData(): SampleReport {
  const before = detectSampleData();
  db.exec('BEGIN');
  try {
    for (const p of before.posts) deletePostRows(p.id);
    db.prepare(`DELETE FROM comments WHERE author_name IN (${ph(SAMPLE_COMMENT_AUTHORS.length)}) AND post_id NOT IN (SELECT id FROM posts)`).run(...SAMPLE_COMMENT_AUTHORS);
    db.prepare(`DELETE FROM knowledge_base WHERE title IN (${ph(SAMPLE_KB_TITLES.length)})`).run(...SAMPLE_KB_TITLES);
    db.prepare(`DELETE FROM subscribers WHERE email IN (${ph(SAMPLE_SUBSCRIBER_EMAILS.length)})`).run(...SAMPLE_SUBSCRIBER_EMAILS);
    db.prepare(`DELETE FROM audience_surveys WHERE respondent_name IN (${ph(SAMPLE_SURVEY_RESPONDENTS.length)})`).run(...SAMPLE_SURVEY_RESPONDENTS);
    db.prepare('DELETE FROM ai_workflows WHERE topic LIKE ?').run(`${SAMPLE_CAMPAIGN_TOPIC_PREFIX}%`);
    db.prepare(
      "DELETE FROM publish_logs WHERE workflow_id IS NULL AND created_at IN ('2025-09-15T09:05:00.000Z','2025-09-14T16:10:00.000Z')"
    ).run();
    db.prepare(
      `UPDATE business_pillars SET metric_value = '', status_badge = '' WHERE pillar_key IN (${ph(SAMPLE_PILLAR_KEYS.length)}) AND metric_value IN (${ph(SAMPLE_PILLAR_METRICS.length)})`
    ).run(...SAMPLE_PILLAR_KEYS, ...SAMPLE_PILLAR_METRICS);
    for (const [key, handle] of Object.entries(SAMPLE_CHANNEL_HANDLES)) {
      db.prepare("UPDATE channel_configs SET handle_or_url = '' WHERE channel_key = ? AND handle_or_url = ? AND access_token = ''").run(key, handle);
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  return before;
}
