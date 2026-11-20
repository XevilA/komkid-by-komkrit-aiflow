// ============================================================================
// CONTENT WORKSPACES — the single shared state every agent reads and writes.
// One workspace = one piece of content from idea to published post: brief,
// research, draft, media (cover / video / audio / inline), QA verdict,
// channel plans and the full activity log. Nothing lives only in a browser tab.
// ============================================================================
import crypto from 'node:crypto';
import { db } from './db.ts';

export type Category =
  | 'education'
  | 'innovation'
  | 'society'
  | 'international'
  | 'career'
  | 'ai-tech'
  | 'special';
export const CATEGORY_IDS: Category[] = [
  'education',
  'innovation',
  'society',
  'international',
  'career',
  'ai-tech',
  'special',
];

export interface Draft {
  title: string;
  subtitle: string;
  excerpt: string;
  content: string;
  category: Category;
  contentType: 'news' | 'article' | 'video' | 'course';
  tags: string[];
  slug: string;
  suggestedImagePrompt?: string;
  suggestedVideoPrompt?: string;
}

export interface MediaItem {
  url: string;
  assetId?: number | null;
  prompt?: string;
  caption?: string;
}

export interface ProjectMedia {
  cover?: MediaItem;
  video?: MediaItem;
  audio?: MediaItem;
  subtitles?: MediaItem;
  clips?: MediaItem[];
  inline: MediaItem[];
}

export interface ResearchNotes {
  query?: string;
  summary?: string;
  facts?: string[];
  angles?: string[];
  sources?: { title: string; uri: string }[];
  knowledgeUsed?: string[];
  subQueries?: string[];
  relatedPosts?: { id: number; title: string; slug: string }[];
  updatedAt?: string;
}

export interface QaReport {
  verdict?: 'pass' | 'revise' | 'block';
  scores?: { facts: number; language: number; brand: number; risk: number; overall: number };
  issues?: { severity: 'high' | 'medium' | 'low'; text: string }[];
  summary?: string;
  contentHash?: string;
  checkedAt?: string;
}

export interface ChannelState {
  variants?: Record<string, { title: string; content: string }>;
  results?: Record<string, { status: string; url: string; note: string; at: string }>;
}

export interface FactClaim {
  text: string;
  verdict: 'supported' | 'unsupported' | 'unverifiable';
  evidence: string;
}

export interface FactCheck {
  claims?: FactClaim[];
  neutrality?: { score: number; notes: string };
  verdict?: 'pass' | 'revise' | 'block';
  summary?: string;
  contentHash?: string;
  checkedAt?: string;
}

export interface VideoClip {
  title: string;
  durationSec: number;
  narration: string;
  visualPrompt: string;
  subtitle: string;
}

export interface Learning {
  summary?: string;
  whatWorked?: string[];
  toImprove?: string[];
  nextTopics?: string[];
  metrics?: Record<string, unknown>;
  at?: string;
}

export interface Approvals {
  /** Owner approved this exact article text (invalidated automatically when the text changes). */
  article?: { hash: string; at: string };
  release?: { at: string };
}

export type ProjectStatus = 'drafting' | 'ready' | 'published' | 'archived';

export interface ProjectRecord {
  id: number;
  title: string;
  brief: string;
  status: ProjectStatus;
  postId: number | null;
  workflowId: number | null;
  draft: Draft;
  media: ProjectMedia;
  research: ResearchNotes;
  qa: QaReport;
  channels: ChannelState;
  factCheck: FactCheck;
  videoPlan: { clips: VideoClip[]; updatedAt?: string };
  learning: Learning;
  approvals: Approvals;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectEvent {
  id: number;
  projectId: number;
  createdAt: string;
  role: 'user' | 'ceo' | 'agent' | 'system';
  agent: string;
  kind: 'message' | 'action' | 'result' | 'error' | 'confirm';
  content: string;
  data: any;
}

export const EMPTY_DRAFT: Draft = {
  title: '',
  subtitle: '',
  excerpt: '',
  content: '',
  category: 'education',
  contentType: 'article',
  tags: [],
  slug: '',
};

function parse<T>(raw: unknown, fallback: T): T {
  try {
    const v = JSON.parse(String(raw || ''));
    return v && typeof v === 'object' ? ({ ...fallback, ...v } as T) : fallback;
  } catch {
    return fallback;
  }
}

function mapProject(r: any): ProjectRecord {
  const media = parse<ProjectMedia>(r.media_json, { inline: [] });
  if (!Array.isArray(media.inline)) media.inline = [];
  let extra: any = {};
  try {
    extra = JSON.parse(r.extra_json || '{}');
  } catch {
    extra = {};
  }
  return {
    id: r.id,
    title: r.title || '',
    brief: r.brief || '',
    status: r.status,
    postId: r.post_id ?? null,
    workflowId: r.workflow_id ?? null,
    draft: parse<Draft>(r.draft_json, { ...EMPTY_DRAFT }),
    media,
    research: parse<ResearchNotes>(r.research_json, {}),
    qa: parse<QaReport>(r.qa_json, {}),
    channels: parse<ChannelState>(r.channels_json, {}),
    factCheck: (extra.factCheck && typeof extra.factCheck === 'object' ? extra.factCheck : {}) as FactCheck,
    videoPlan: { clips: Array.isArray(extra.videoPlan?.clips) ? extra.videoPlan.clips : [], updatedAt: extra.videoPlan?.updatedAt },
    learning: (extra.learning && typeof extra.learning === 'object' ? extra.learning : {}) as Learning,
    approvals: (extra.approvals && typeof extra.approvals === 'object' ? extra.approvals : {}) as Approvals,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export function getProject(id: number): ProjectRecord | null {
  const r = db.prepare('SELECT * FROM content_projects WHERE id = ?').get(id);
  return r ? mapProject(r) : null;
}

export function listProjects(limit = 50): (Omit<ProjectRecord, 'research' | 'qa' | 'channels' | 'media'> & {
  hasCover: boolean;
  hasVideo: boolean;
  hasAudio: boolean;
  wordCount: number;
})[] {
  const rows = db
    .prepare('SELECT * FROM content_projects WHERE status != ? ORDER BY updated_at DESC, id DESC LIMIT ?')
    .all('archived', limit);
  return rows.map((r) => {
    const p = mapProject(r);
    const { research: _r, qa: _q, channels: _c, media, ...rest } = p;
    return {
      ...rest,
      hasCover: Boolean(media.cover?.url),
      hasVideo: Boolean(media.video?.url),
      hasAudio: Boolean(media.audio?.url),
      wordCount: p.draft.content.replace(/\s+/g, '').length,
    };
  });
}

export function saveProject(p: ProjectRecord): ProjectRecord {
  const now = new Date().toISOString();
  db.prepare(
    `UPDATE content_projects SET
       title = ?, brief = ?, status = ?, post_id = ?, workflow_id = ?,
       draft_json = ?, media_json = ?, research_json = ?, qa_json = ?, channels_json = ?, extra_json = ?, updated_at = ?
     WHERE id = ?`
  ).run(
    p.title,
    p.brief,
    p.status,
    p.postId,
    p.workflowId,
    JSON.stringify(p.draft),
    JSON.stringify(p.media),
    JSON.stringify(p.research),
    JSON.stringify(p.qa),
    JSON.stringify(p.channels),
    JSON.stringify({ factCheck: p.factCheck, videoPlan: p.videoPlan, learning: p.learning, approvals: p.approvals }),
    now,
    p.id
  );
  return { ...p, updatedAt: now };
}

export function createProject(input: { title?: string; brief?: string }): ProjectRecord {
  const now = new Date().toISOString();
  const res = db
    .prepare(
      `INSERT INTO content_projects (title, brief, status, created_at, updated_at) VALUES (?, ?, 'drafting', ?, ?)`
    )
    .run(String(input.title || '').trim().slice(0, 200), String(input.brief || '').trim().slice(0, 4000), now, now);
  return getProject(Number(res.lastInsertRowid))!;
}

export function deleteProject(id: number): boolean {
  db.prepare('DELETE FROM project_events WHERE project_id = ?').run(id);
  return db.prepare('DELETE FROM content_projects WHERE id = ?').run(id).changes > 0;
}

export function appendEvent(
  projectId: number,
  e: Omit<ProjectEvent, 'id' | 'projectId' | 'createdAt' | 'data'> & { data?: unknown }
): ProjectEvent {
  const now = new Date().toISOString();
  const res = db
    .prepare(
      `INSERT INTO project_events (project_id, created_at, role, agent, kind, content, data_json)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(projectId, now, e.role, e.agent || '', e.kind, e.content.slice(0, 8000), JSON.stringify(e.data ?? {}));
  return {
    id: Number(res.lastInsertRowid),
    projectId,
    createdAt: now,
    role: e.role,
    agent: e.agent || '',
    kind: e.kind,
    content: e.content,
    data: e.data ?? {},
  };
}

export function getEvents(projectId: number, afterId = 0, limit = 200): ProjectEvent[] {
  const rows = db
    .prepare('SELECT * FROM project_events WHERE project_id = ? AND id > ? ORDER BY id ASC LIMIT ?')
    .all(projectId, afterId, limit) as any[];
  return rows.map((r) => ({
    id: r.id,
    projectId: r.project_id,
    createdAt: r.created_at,
    role: r.role,
    agent: r.agent,
    kind: r.kind,
    content: r.content,
    data: (() => {
      try {
        return JSON.parse(r.data_json || '{}');
      } catch {
        return {};
      }
    })(),
  }));
}

/** Fingerprint of everything that is published; QA results become stale when it changes. */
export function contentHash(p: Pick<ProjectRecord, 'draft' | 'media'>): string {
  return crypto
    .createHash('sha1')
    .update(
      JSON.stringify([
        p.draft.title,
        p.draft.subtitle,
        p.draft.excerpt,
        p.draft.content,
        p.media.cover?.url || '',
        p.media.video?.url || '',
        p.media.audio?.url || '',
      ])
    )
    .digest('hex')
    .slice(0, 16);
}

/** A project built from an existing post, so published content can be revised by the agents. */
export function createProjectFromPost(postId: number): ProjectRecord {
  const row = db.prepare('SELECT * FROM posts WHERE id = ?').get(postId) as any;
  if (!row) throw new Error('ไม่พบบทความที่ต้องการนำมาแก้ไข');
  const existing = db
    .prepare("SELECT id FROM content_projects WHERE post_id = ? AND status != 'archived' ORDER BY id DESC LIMIT 1")
    .get(postId) as { id: number } | undefined;
  if (existing) return getProject(existing.id)!;

  let tags: string[] = [];
  try {
    tags = JSON.parse(row.tags_json || '[]');
  } catch {
    tags = [];
  }
  const p = createProject({ title: row.title, brief: `แก้ไขบทความที่มีอยู่: ${row.title}` });
  p.postId = postId;
  p.status = row.status === 'published' ? 'published' : 'drafting';
  p.draft = {
    title: row.title,
    subtitle: row.subtitle || '',
    excerpt: row.excerpt || '',
    content: row.content || '',
    category: CATEGORY_IDS.includes(row.category) ? row.category : 'education',
    contentType: ['news', 'article', 'video', 'course'].includes(row.content_type) ? row.content_type : 'article',
    tags,
    slug: row.slug || '',
  };
  p.media = {
    cover: row.cover_image ? { url: row.cover_image } : undefined,
    video: row.video_url ? { url: row.video_url } : undefined,
    audio: row.audio_url ? { url: row.audio_url } : undefined,
    inline: [],
  };
  return saveProject(p);
}

/** A project seeded from an 8-agent campaign (article, prompts and any generated media). */
export function createProjectFromWorkflow(workflowId: number): ProjectRecord {
  const row = db.prepare('SELECT * FROM ai_workflows WHERE id = ?').get(workflowId) as any;
  if (!row) throw new Error('ไม่พบแคมเปญที่ต้องการนำเข้า');
  const existing = db
    .prepare("SELECT id FROM content_projects WHERE workflow_id = ? AND status != 'archived' ORDER BY id DESC LIMIT 1")
    .get(workflowId) as { id: number } | undefined;
  if (existing) return getProject(existing.id)!;

  const j = (v: unknown) => {
    try {
      return JSON.parse(String(v || '{}'));
    } catch {
      return {};
    }
  };
  const script = j(row.script_json);
  const visual = j(row.visual_json);
  const video = j(row.video_json);
  const audio = j(row.audio_json);
  const research = j(row.research_json);
  const p = createProject({ title: script.selectedTitle || row.topic, brief: row.topic });
  p.workflowId = workflowId;
  p.draft = {
    title: String(script.selectedTitle || row.topic),
    subtitle: String(script.subtitle || ''),
    excerpt: String(script.excerpt || ''),
    content: String(script.fullArticleMarkdown || ''),
    category: CATEGORY_IDS.includes(row.category) ? row.category : 'education',
    contentType: 'article',
    tags: ['คมคิด by KOMKRIT'],
    slug: '',
    suggestedImagePrompt: visual?.imagePrompts?.[0]?.prompt || '',
  };
  const cover = visual?.generatedRealImageUrl || '';
  p.media = {
    cover: cover ? { url: cover } : undefined,
    video: video?.generatedVideoUrl ? { url: String(video.generatedVideoUrl) } : undefined,
    audio: audio?.generatedAudioUrl ? { url: String(audio.generatedAudioUrl) } : undefined,
    inline: [],
  };
  p.research = {
    summary: String(research.trendAnalysis || ''),
    facts: Array.isArray(research.keyFacts) ? research.keyFacts.map(String) : [],
    angles: Array.isArray(research.deepInsights) ? research.deepInsights.map(String) : [],
    knowledgeUsed: Array.isArray(research.kbSourcesUsed) ? research.kbSourcesUsed.map(String) : [],
    updatedAt: new Date().toISOString(),
  };
  return saveProject(p);
}

// ============================================================================
// APPROVAL GATES and the 11-step flow view
// ============================================================================
/** Fingerprint of the article text only (media changes do not void an article approval). */
export function articleHash(p: Pick<ProjectRecord, 'draft'>): string {
  return crypto
    .createHash('sha1')
    .update(JSON.stringify([p.draft.title, p.draft.subtitle, p.draft.content]))
    .digest('hex')
    .slice(0, 16);
}

export function articleApproved(p: ProjectRecord): boolean {
  return Boolean(p.approvals.article && p.approvals.article.hash === articleHash(p) && p.draft.content);
}

export interface FlowStep {
  n: number;
  id: string;
  label: string;
  status: 'done' | 'current' | 'todo' | 'optional';
  detail: string;
}

/** Where this piece of content is in the 11-step Content AI workflow. */
export function computeFlow(p: ProjectRecord): FlowStep[] {
  const hasDraft = Boolean(p.draft.title && p.draft.content);
  const fcFresh = Boolean(p.factCheck.verdict && p.factCheck.contentHash === articleHash(p));
  const approved = articleApproved(p);
  const produced = Boolean(p.media.video || p.media.audio);
  const published = p.status === 'published';
  const defs: { id: string; label: string; done: boolean; detail: string; optional?: boolean }[] = [
    { id: 'owner', label: 'เจ้าของช่องสั่งงาน', done: Boolean(p.brief || hasDraft), detail: p.brief ? p.brief.slice(0, 60) : '' },
    { id: 'ceo', label: 'CEO วางแผนและแจกงาน', done: Boolean(p.brief || hasDraft), detail: '' },
    { id: 'research', label: 'Deep Research', done: Boolean(p.research.summary), detail: p.research.sources?.length ? `แหล่งอ้างอิง ${p.research.sources.length}` : '' },
    { id: 'writer', label: 'Content Writer', done: hasDraft, detail: hasDraft ? `${p.draft.content.replace(/\s+/g, '').length.toLocaleString()} ตัวอักษร` : '' },
    { id: 'factcheck', label: 'Fact-check', done: fcFresh, detail: fcFresh ? (p.factCheck.verdict === 'pass' ? 'ผ่าน' : p.factCheck.verdict === 'revise' ? 'ควรแก้' : 'ไม่ควรเผยแพร่') : '' },
    { id: 'approve_article', label: 'เจ้าของช่องอนุมัติบทความ', done: approved, detail: approved ? 'อนุมัติแล้ว' : 'รอการอนุมัติ' },
    { id: 'video_script', label: 'Video Script (2-3 คลิป)', done: p.videoPlan.clips.length > 0, detail: p.videoPlan.clips.length ? `${p.videoPlan.clips.length} คลิป` : '', optional: true },
    { id: 'production', label: 'Avatar Production (วิดีโอ เสียง คำบรรยาย)', done: produced, detail: [p.media.video && 'วิดีโอ', p.media.audio && 'เสียง', p.media.subtitles && 'คำบรรยาย'].filter(Boolean).join(' ') as string, optional: true },
    { id: 'approve_release', label: 'ตรวจและอนุมัติก่อนเผยแพร่', done: published || Boolean(p.approvals.release), detail: '' },
    { id: 'publish', label: 'Publishing', done: published, detail: published && p.draft.slug ? `/articles/${p.draft.slug}` : '' },
    { id: 'analytics', label: 'Analytics & Learning', done: Boolean(p.learning.summary), detail: p.learning.at ? 'วิเคราะห์แล้ว' : '' },
  ];
  let currentSet = false;
  return defs.map((d, i) => {
    let status: FlowStep['status'];
    if (d.done) status = 'done';
    else if (!currentSet && !d.optional) {
      status = 'current';
      currentSet = true;
    } else status = d.optional ? 'optional' : 'todo';
    return { n: i + 1, id: d.id, label: d.label, status, detail: d.detail };
  });
}

export function recentLearnings(limit = 5): { summary: string; actions: string[]; createdAt: string }[] {
  const rows = db.prepare('SELECT summary, actions_json, created_at FROM ai_learnings ORDER BY id DESC LIMIT ?').all(limit) as any[];
  return rows.map((r) => {
    let actions: string[] = [];
    try {
      actions = JSON.parse(r.actions_json || '[]');
    } catch {
      actions = [];
    }
    return { summary: r.summary, actions, createdAt: r.created_at };
  });
}

export function saveLearning(projectId: number, summary: string, actions: string[]) {
  db.prepare('INSERT INTO ai_learnings (project_id, created_at, summary, actions_json) VALUES (?, ?, ?, ?)').run(
    projectId,
    new Date().toISOString(),
    summary,
    JSON.stringify(actions)
  );
}
