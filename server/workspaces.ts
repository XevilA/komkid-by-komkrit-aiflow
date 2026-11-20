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
  inline: MediaItem[];
}

export interface ResearchNotes {
  query?: string;
  summary?: string;
  facts?: string[];
  angles?: string[];
  sources?: { title: string; uri: string }[];
  knowledgeUsed?: string[];
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
       draft_json = ?, media_json = ?, research_json = ?, qa_json = ?, channels_json = ?, updated_at = ?
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
