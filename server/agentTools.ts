// ============================================================================
// AGENT SKILLS — every capability of the team as a typed tool.
// Each tool reads and writes the shared workspace, so research feeds the draft,
// the draft feeds the visuals, and everything made is what actually gets published.
// ============================================================================
import fs from 'node:fs';
import path from 'node:path';
import { GoogleGenAI } from '@google/genai';
import { db, IS_SERVERLESS } from './db.ts';
import {
  callRealLlm,
  extractStrictJson,
  configuredProviderSet,
  type LlmProviderId,
} from './aiEngine.ts';
import {
  generateRealImage,
  generateRealVideo,
  generateRealAudio,
  getSettingValue,
  stitchFlowScenesWithFfmpeg,
  UPLOADS_ROOT,
} from './mediaEngine.ts';
import { resolveLatestModel } from './modelRegistry.ts';
import { searchKnowledge } from './knowledge.ts';
import { dispatchSingleChannelReal } from './publishEngine.ts';
import { validateSlug, uniqueSlug, isSlugTaken, setPostSlug, slugify } from './slug.ts';
import {
  CATEGORY_IDS,
  articleApproved,
  articleHash,
  recentLearnings,
  saveLearning,
  contentHash,
  createProjectFromPost,
  createProjectFromWorkflow,
  saveProject,
  type Category,
  type Draft,
  type ProjectRecord,
} from './workspaces.ts';

export interface Capabilities {
  llm: boolean;
  image: boolean;
  video: boolean;
  audio: boolean;
  webSearch: boolean;
  channels: { key: string; name: string }[];
  serverless: boolean;
}

export function getCapabilities(): Capabilities {
  const gemini = Boolean(
    getSettingValue('gemini_api_key', 'GEMINI_API_KEY') || getSettingValue('gemini_api_key', 'GOOGLE_API_KEY')
  );
  const openai = Boolean(getSettingValue('openai_api_key', 'OPENAI_API_KEY'));
  const eleven = Boolean(getSettingValue('elevenlabs_api_key', 'ELEVENLABS_API_KEY'));
  const vertex = Boolean(getSettingValue('vertex_project_id', 'GOOGLE_CLOUD_PROJECT'));
  const channels = (db
    .prepare(
      "SELECT channel_key, channel_name, access_token, webhook_url FROM channel_configs WHERE enabled = 1 AND channel_key != 'website_blog'"
    )
    .all() as any[])
    .filter((c) => String(c.access_token || '').trim() || String(c.webhook_url || '').trim())
    .map((c) => ({ key: String(c.channel_key), name: String(c.channel_name) }));
  return {
    llm: configuredProviderSet().size > 0,
    image: gemini || openai,
    video: (gemini || vertex) && !IS_SERVERLESS,
    audio: gemini || openai || eleven,
    webSearch: gemini,
    channels,
    serverless: IS_SERVERLESS,
  };
}

export interface ToolContext {
  project: ProjectRecord;
  provider?: LlmProviderId;
  model?: string;
  userMessage: string;
  /** True only when the user asked to publish (or pressed the Publish button). */
  publishAllowed: boolean;
  caps: Capabilities;
  log: (text: string, data?: unknown) => void;
}

export interface ToolResult {
  ok: boolean;
  summary: string;
  data?: unknown;
  /** Stop the run here and show this question to the user. */
  question?: string;
  /** Destructive action waiting for an explicit human confirmation. */
  confirm?: { action: string; label: string; payload: Record<string, unknown> };
}

export interface ToolDef {
  name: string;
  agent: 'research' | 'writer' | 'visual' | 'video' | 'audio' | 'qa' | 'factcheck' | 'script' | 'analytics' | 'publisher' | 'ceo';
  description: string;
  args: string;
  run: (ctx: ToolContext, args: Record<string, any>) => Promise<ToolResult>;
}

const BRAND_RULES = `น้ำเสียง: ภาษาไทยสุภาพ ชัดเจน เป็นทางการแต่เข้าถึงง่าย เน้นสาระและตัวอย่างใช้งานจริง
ห้ามใช้อีโมจิ ห้ามใช้ภาษาโฆษณาเกินจริง ห้ามแต่งตัวเลข สถิติ ชื่อบุคคล หรือแหล่งอ้างอิงที่ไม่มีในข้อมูลที่ให้
หากข้อมูลไม่พอให้เขียนอย่างระมัดระวังและไม่ยืนยันเกินหลักฐาน`;

function brandContext(query: string): string {
  const kb = searchKnowledge(query, 5);
  return kb.map((k, i) => `[KB-${i + 1}] ${k.title}: ${k.summary}\n${k.content.slice(0, 700)}`).join('\n\n');
}

async function llmJson(
  ctx: ToolContext,
  system: string,
  user: string,
  validate?: (o: any) => void,
  tier: 'standard' | 'economy' = 'standard'
) {
  const res = await callRealLlm({
    provider: ctx.provider,
    model: ctx.model,
    systemInstruction: system,
    messages: [{ role: 'user', content: user }],
    temperature: 0.5,
    jsonMode: true,
    tier,
    validate: (t) => {
      const o = extractStrictJson(t);
      validate?.(o);
    },
  });
  return { data: extractStrictJson(res.text), engine: res.engineLabel };
}

const str = (v: unknown, max = 20000) => String(v ?? '').trim().slice(0, max);
const cat = (v: unknown, fallback: Category): Category =>
  CATEGORY_IDS.includes(v as Category) ? (v as Category) : fallback;

function normalizeTags(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return Array.from(new Set(v.map((t) => str(t, 40)).filter(Boolean))).slice(0, 8);
}

function mediaLines(markdown: string): string[] {
  return markdown.split('\n').map((l) => l.trim()).filter((l) => /^!\[[^\]]*\]\(.+\)$/.test(l));
}

/** Inserts a media line after the paragraph following the Nth "##" heading (or at the end). */
export function insertMediaAfterSection(markdown: string, mediaMd: string, section = 2): string {
  const lines = markdown.split('\n');
  const headings = lines.map((l, i) => (l.trim().startsWith('## ') ? i : -1)).filter((i) => i >= 0);
  let at = lines.length;
  const h = headings[Math.min(Math.max(section, 1), headings.length) - 1];
  if (h !== undefined) {
    let i = h + 1;
    while (i < lines.length && !lines[i].trim()) i++;
    // skip the first paragraph under the heading
    while (i < lines.length && lines[i].trim() && !lines[i].trim().startsWith('## ')) i++;
    at = i;
  }
  lines.splice(at, 0, '', mediaMd, '');
  return lines.join('\n').replace(/\n{3,}/g, '\n\n');
}

async function groundedSearch(
  query: string
): Promise<{ text: string; sources: { title: string; uri: string }[] } | null> {
  const key =
    getSettingValue('gemini_api_key', 'GEMINI_API_KEY') || getSettingValue('gemini_api_key', 'GOOGLE_API_KEY');
  if (!key) return null;
  try {
    const model = await resolveLatestModel({
      provider: 'gemini',
      capability: 'text',
      requestedModel: getSettingValue('gemini_model'),
      apiKeyOverride: key,
    });
    const ai = new GoogleGenAI({ apiKey: key });
    const r: any = await ai.models.generateContent({
      model,
      contents: `ค้นหาข้อมูลล่าสุดที่เชื่อถือได้เกี่ยวกับ: ${query}\nสรุปข้อเท็จจริงสำคัญเป็นภาษาไทยพร้อมระบุแหล่งที่มา ห้ามเดา`,
      config: { tools: [{ googleSearch: {} }] } as any,
    });
    const chunks: any[] = r?.candidates?.[0]?.groundingMetadata?.groundingChunks || [];
    const sources = chunks
      .map((c) => ({ title: str(c?.web?.title, 160), uri: str(c?.web?.uri, 500) }))
      .filter((s) => /^https?:\/\//.test(s.uri));
    const text = str(r?.text, 6000);
    return text ? { text, sources } : null;
  } catch {
    return null; // research continues with the knowledge base only
  }
}

function requireDraft(ctx: ToolContext): Draft | null {
  const d = ctx.project.draft;
  return d.title && d.content ? d : null;
}

function vttTime(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  const pad = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${pad(h)}:${pad(m)}:${pad(s)}.000`;
}

// --- upsert the real post from the workspace ----------------------------------
export function upsertPostFromProject(
  project: ProjectRecord,
  status: 'draft' | 'published'
): { postId: number; slug: string; created: boolean } {
  const d = project.draft;
  const now = new Date().toISOString();
  const cover = project.media.cover?.url || '/images/thumb-ai-edu.jpg';
  const video = project.media.video?.url || '';
  const audio = project.media.audio?.url || '';
  const contentType = video ? 'video' : d.contentType;
  const tags = JSON.stringify(d.tags);
  const excerpt =
    d.excerpt ||
    d.content.replace(/!\[[^\]]*\]\([^)]+\)/g, '').replace(/[#>*_`]/g, '').replace(/\s+/g, ' ').trim().slice(0, 180);

  let postId = project.postId;
  const exists = postId ? db.prepare('SELECT id, slug FROM posts WHERE id = ?').get(postId) : null;
  if (!exists) postId = null;

  let slug = d.slug;
  if (slug && (validateSlug(slug) || isSlugTaken(db, slug, postId ?? undefined))) slug = '';
  if (!slug) slug = uniqueSlug(d.slug || d.title, (c) => isSlugTaken(db, c, postId ?? undefined));

  if (postId) {
    db.prepare(
      `UPDATE posts SET title = ?, subtitle = ?, excerpt = ?, content = ?, category = ?, content_type = ?,
         cover_image = ?, video_url = ?, audio_url = ?, tags_json = ?, status = ?, updated_at = ? WHERE id = ?`
    ).run(d.title, d.subtitle, excerpt, d.content, d.category, contentType, cover, video, audio, tags, status, now, postId);
    setPostSlug(db, postId, slug);
    return { postId, slug, created: false };
  }
  const res = db
    .prepare(
      `INSERT INTO posts (
        title, subtitle, excerpt, content, category, content_type, cover_image, video_url, audio_url,
        tags_json, author, status, is_featured, views, ai_workflow_id, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'คมกฤช (Komkrit)', ?, 0, 0, ?, ?, ?)`
    )
    .run(d.title, d.subtitle, excerpt, d.content, d.category, contentType, cover, video, audio, tags, status, project.workflowId, now, now);
  postId = Number(res.lastInsertRowid);
  setPostSlug(db, postId, slug);
  return { postId, slug, created: true };
}

// ============================================================================
// THE SKILLS
// ============================================================================
export const TOOLS: ToolDef[] = [
  {
    name: 'research',
    agent: 'research',
    description:
      'ค้นคว้าประเด็นจากฐานความรู้ขององค์กร บทความเดิม และ (ถ้ามี) การค้นเว็บแบบอ้างอิงแหล่งที่มา แล้วสรุปข้อเท็จจริง มุมมอง และช่องว่างของข้อมูล ผลจะถูกใช้ต่อโดยนักเขียนและ QA',
    args: '{ "query": "หัวข้อที่ต้องการค้นคว้า (ไม่ใส่ = ใช้โจทย์ของโปรเจกต์)" }',
    run: async (ctx, args) => {
      const q = str(args.query) || ctx.project.brief || ctx.project.draft.title;
      if (!q) return { ok: false, summary: 'ยังไม่มีหัวข้อให้ค้นคว้า' };
      const kb = searchKnowledge(q, 6);
      const like = `%${q.slice(0, 40)}%`;
      const related = db
        .prepare(
          "SELECT id, title, slug FROM posts WHERE status = 'published' AND (title LIKE ? OR tags_json LIKE ?) ORDER BY created_at DESC LIMIT 5"
        )
        .all(like, like) as { id: number; title: string; slug: string }[];
      // Deep research: split the topic into distinct sub-questions and search each one
      let queries = [q];
      let web: { text: string; sources: { title: string; uri: string }[] } | null = null;
      if (ctx.caps.webSearch) {
        try {
          const plan = await llmJson(
            ctx,
            `คุณคือ Research Agent วางแผนการค้นคว้าเชิงลึก แตกหัวข้อเป็นคำถามย่อย 2-3 ข้อที่ต่างมุมกัน (ข้อมูล/สถิติล่าสุด, ตัวอย่างจริง, ข้อโต้แย้งหรือข้อจำกัด)
ตอบ JSON: {"queries":["คำถามย่อย"]}`,
            `หัวข้อ: ${q}`,
            undefined,
            'economy'
          );
          queries = [q, ...(Array.isArray(plan.data.queries) ? plan.data.queries.map((x: unknown) => str(x, 200)).filter(Boolean).slice(0, 3) : [])];
        } catch {
          queries = [q];
        }
        const found = await Promise.all(queries.map((x) => groundedSearch(x)));
        const hits = found.map((f, i) => (f ? { q: queries[i], f } : null)).filter(Boolean) as { q: string; f: { text: string; sources: { title: string; uri: string }[] } }[];
        if (hits.length) {
          const seen = new Set<string>();
          web = {
            text: hits.map((h) => `ผลค้นหาคำถาม "${h.q}":\n${h.f.text}`).join('\n\n'),
            sources: hits.flatMap((h) => h.f.sources).filter((x) => (seen.has(x.uri) ? false : (seen.add(x.uri), true))),
          };
        }
      }

      const material = [
        kb.length ? `ฐานความรู้:\n${kb.map((k, i) => `[KB-${i + 1}] ${k.title}: ${k.summary}\n${k.content.slice(0, 800)}`).join('\n\n')}` : '',
        related.length ? `บทความที่เผยแพร่แล้ว:\n${related.map((r) => `- ${r.title}`).join('\n')}` : '',
        web ? `ผลค้นเว็บ:\n${web.text}` : '',
      ]
        .filter(Boolean)
        .join('\n\n');

      const { data } = await llmJson(
        ctx,
        `คุณคือ Research Agent ของ "คมคิด by KOMKRIT" ทำหน้าที่สรุปข้อมูลให้ทีมเขียน
ใช้เฉพาะข้อมูลในหัวข้อ "วัตถุดิบ" ห้ามเพิ่มข้อเท็จจริง ตัวเลข หรือแหล่งอ้างอิงที่ไม่มีอยู่ในวัตถุดิบ
${BRAND_RULES}
ตอบ JSON: {"summary":"สรุปประเด็น 3-5 ประโยค","facts":["ข้อเท็จจริงที่อ้างอิงได้"],"angles":["มุมมองที่น่าเขียน"],"gaps":["ข้อมูลที่ยังขาด"]}`,
        `หัวข้อ: ${q}\n\nวัตถุดิบ:\n${material || '(ไม่มีข้อมูลในฐานความรู้ที่เกี่ยวข้อง)'}`,
        (o) => {
          if (typeof o.summary !== 'string' || !o.summary.trim()) throw new Error('ผลลัพธ์ไม่ครบ: ไม่มีสรุป');
        },
        'economy'
      );
      ctx.project.research = {
        query: q,
        subQueries: queries.length > 1 ? queries : undefined,
        summary: str(data.summary, 1500),
        facts: (Array.isArray(data.facts) ? data.facts : []).map((f: unknown) => str(f, 300)).slice(0, 10),
        angles: (Array.isArray(data.angles) ? data.angles : []).map((f: unknown) => str(f, 300)).slice(0, 6),
        sources: web?.sources.slice(0, 12) || [],
        knowledgeUsed: kb.map((k) => k.title),
        relatedPosts: related,
        updatedAt: new Date().toISOString(),
      };
      ctx.project.title = ctx.project.title || q.slice(0, 120);
      saveProject(ctx.project);
      return {
        ok: true,
        summary: `ค้นคว้า "${q}" แล้ว: ใช้ฐานความรู้ ${kb.length} รายการ, บทความเดิมที่เกี่ยวข้อง ${related.length}, แหล่งเว็บ ${web?.sources.length ?? 0}${ctx.caps.webSearch ? '' : ' (ยังไม่ได้เปิดการค้นเว็บ ต้องใช้ Gemini API Key)'}`,
        data: ctx.project.research,
      };
    },
  },

  {
    name: 'write_draft',
    agent: 'writer',
    description:
      'เขียนบทความ/ข่าวฉบับเต็มใหม่ทั้งชิ้น โดยใช้ผลค้นคว้าและฐานความรู้ ได้ชื่อเรื่อง คำโปรย สรุป หมวดหมู่ แท็ก slug และ prompt แนะนำสำหรับภาพปก/วิดีโอ',
    args: '{ "instruction": "โจทย์/มุมมอง/กลุ่มผู้อ่าน", "format": "news | article | social" }',
    run: async (ctx, args) => {
      const instruction = str(args.instruction) || ctx.project.brief;
      if (!instruction && !ctx.project.research.summary) return { ok: false, summary: 'ยังไม่มีโจทย์สำหรับเขียน' };
      const r = ctx.project.research;
      const format =
        args.format === 'news'
          ? 'ข่าวประชาสัมพันธ์/ข่าวความรู้ ที่น่าเชื่อถือ กระชับ'
          : args.format === 'social'
          ? 'คอนเทนต์สั้น กระชับ อ่านจบเร็ว'
          : 'บทความให้ความรู้เชิงลึก แบ่งหัวข้อย่อยชัดเจน มีตัวอย่างนำไปใช้ได้จริง';
      const { data } = await llmJson(
        ctx,
        `คุณคือ Writer Agent (บรรณาธิการ) ของ "คมคิด by KOMKRIT" เขียนเนื้อหาภาษาไทยฉบับเต็มตามรูปแบบ: ${format}
${BRAND_RULES}
เนื้อหาเป็น Markdown ใช้หัวข้อ ## และ ### ไม่ใส่หัวเรื่อง (#) ซ้ำในเนื้อหา
category ต้องเป็นหนึ่งใน: ${CATEGORY_IDS.join(', ')}; contentType เป็น "news" หรือ "article"
slug เป็นภาษาอังกฤษตัวพิมพ์เล็ก คั่นด้วย - ไม่เกิน 60 ตัวอักษร
ตอบ JSON: {"title":"","subtitle":"","excerpt":"สรุป 2 ประโยค ไม่เกิน 160 ตัวอักษร","category":"","contentType":"","content":"","tags":["..."],"slug":"","suggestedImagePrompt":"English editorial 16:9 cover photo prompt","suggestedVideoPrompt":"English 8-second video prompt"}`,
        `โจทย์: ${instruction}
${ctx.project.draft.content ? 'หมายเหตุ: มีฉบับร่างเดิมอยู่แล้ว ให้เขียนใหม่ตามโจทย์นี้' : ''}
ผลค้นคว้า: ${r.summary || '-'}
ข้อเท็จจริงที่ใช้อ้างอิงได้:\n${(r.facts || []).map((f) => `- ${f}`).join('\n') || '-'}
มุมมองที่แนะนำ:\n${(r.angles || []).map((f) => `- ${f}`).join('\n') || '-'}

${brandContext(instruction)}`,
        (o) => {
          if (typeof o.title !== 'string' || !o.title.trim() || typeof o.content !== 'string' || o.content.trim().length < 300) {
            throw new Error('ผลลัพธ์ไม่ครบ: ขาดชื่อเรื่องหรือเนื้อหาสั้นเกินไป');
          }
        }
      );
      const draft: Draft = {
        title: str(data.title, 200),
        subtitle: str(data.subtitle, 300),
        excerpt: str(data.excerpt, 300),
        content: str(data.content, 60000),
        category: cat(data.category, ctx.project.draft.category),
        contentType: data.contentType === 'news' ? 'news' : 'article',
        tags: normalizeTags(data.tags),
        slug: slugify(str(data.slug, 100), 60),
        suggestedImagePrompt: str(data.suggestedImagePrompt, 800),
        suggestedVideoPrompt: str(data.suggestedVideoPrompt, 800),
      };
      ctx.project.draft = draft;
      ctx.project.media.inline = [];
      ctx.project.title = draft.title;
      ctx.project.status = 'drafting';
      ctx.project.qa = {};
      saveProject(ctx.project);
      return { ok: true, summary: `เขียนฉบับร่าง "${draft.title}" แล้ว (${draft.content.replace(/\s+/g, '').length} ตัวอักษร, หมวด ${draft.category})` };
    },
  },

  {
    name: 'revise_draft',
    agent: 'writer',
    description:
      'แก้ไขฉบับร่างปัจจุบันตามคำสั่ง (ปรับน้ำเสียง ย่อ/ขยาย เพิ่มกรณีศึกษา แก้ข้อผิดพลาดที่ QA พบ) โดยคงรูป วิดีโอ และโครงเรื่องเดิมไว้',
    args: '{ "instruction": "สิ่งที่ต้องแก้ไข" }',
    run: async (ctx, args) => {
      const d = requireDraft(ctx);
      if (!d) return { ok: false, summary: 'ยังไม่มีฉบับร่างให้แก้ไข ให้ใช้ write_draft ก่อน' };
      const instruction = str(args.instruction);
      if (!instruction) return { ok: false, summary: 'ไม่ได้ระบุสิ่งที่ต้องแก้ไข' };
      const qaIssues = (ctx.project.qa.issues || []).map((i) => `- [${i.severity}] ${i.text}`).join('\n');
      const { data } = await llmJson(
        ctx,
        `คุณคือ Writer Agent แก้ไขบทความที่มีอยู่ตามคำสั่ง
${BRAND_RULES}
กฎเหล็ก: คงข้อเท็จจริงเดิม และต้องคงบรรทัดรูป/วิดีโอแบบ Markdown ทุกบรรทัดที่ขึ้นต้นด้วย ![ ไว้ครบ ไม่แก้ URL
ตอบ JSON เป็นฉบับเต็มหลังแก้: {"title":"","subtitle":"","excerpt":"","content":"","tags":["..."]}`,
        `คำสั่งแก้ไข: ${instruction}\n${qaIssues ? `ประเด็นที่ QA แจ้งไว้:\n${qaIssues}\n` : ''}\nฉบับปัจจุบัน:\n${JSON.stringify({ title: d.title, subtitle: d.subtitle, excerpt: d.excerpt, content: d.content, tags: d.tags })}`,
        (o) => {
          if (typeof o.content !== 'string' || o.content.trim().length < 200) throw new Error('ผลลัพธ์ไม่ครบ: เนื้อหาสั้นเกินไป');
        }
      );
      let content = str(data.content, 60000);
      // never lose media that was already placed in the article
      for (const line of mediaLines(d.content)) {
        if (!content.includes(line)) content = `${content}\n\n${line}`;
      }
      ctx.project.draft = {
        ...d,
        title: str(data.title, 200) || d.title,
        subtitle: str(data.subtitle, 300) || d.subtitle,
        excerpt: str(data.excerpt, 300) || d.excerpt,
        content,
        tags: normalizeTags(data.tags).length ? normalizeTags(data.tags) : d.tags,
      };
      ctx.project.title = ctx.project.draft.title;
      ctx.project.qa = {};
      saveProject(ctx.project);
      return { ok: true, summary: `แก้ไขฉบับร่างตามคำสั่งแล้ว: ${instruction.slice(0, 80)}` };
    },
  },

  {
    name: 'generate_cover',
    agent: 'visual',
    description: 'สร้างรูปปกบทความด้วย AI แล้วตั้งเป็นรูปปกของโปรเจกต์ (ใช้ผู้ให้บริการภาพที่ใช้ได้และสลับอัตโนมัติ)',
    args: '{ "prompt": "English prompt (ไม่ใส่ = สร้างจากเนื้อหา)" }',
    run: async (ctx, args) => {
      if (!ctx.caps.image) return { ok: false, summary: 'ยังไม่ได้ตั้งค่าคีย์สำหรับสร้างภาพ (ต้องมี Gemini หรือ OpenAI)' };
      const d = ctx.project.draft;
      const prompt =
        str(args.prompt, 900) ||
        d.suggestedImagePrompt ||
        `Editorial 16:9 cover photograph for an article titled "${d.title || ctx.project.brief}", modern Thai education context, natural light, clean composition, no text`;
      const asset: any = await generateRealImage({
        prompt,
        aspectRatio: '16:9',
        workflowId: ctx.project.workflowId,
        thaiSummary: d.title,
        reviewStatus: 'approved',
      });
      ctx.project.media.cover = { url: asset.fileUrl, assetId: asset.id, prompt };
      ctx.project.qa = {};
      saveProject(ctx.project);
      return { ok: true, summary: 'สร้างรูปปกแล้วและตั้งเป็นรูปปกของบทความ', data: { url: asset.fileUrl } };
    },
  },

  {
    name: 'generate_inline_image',
    agent: 'visual',
    description: 'สร้างภาพประกอบและแทรกลงในเนื้อหาบทความ ณ ตำแหน่งหลังหัวข้อย่อยที่ระบุ',
    args: '{ "prompt": "English prompt", "caption": "คำบรรยายภาพภาษาไทย", "afterSection": 2 }',
    run: async (ctx, args) => {
      if (!ctx.caps.image) return { ok: false, summary: 'ยังไม่ได้ตั้งค่าคีย์สำหรับสร้างภาพ' };
      const d = requireDraft(ctx);
      if (!d) return { ok: false, summary: 'ยังไม่มีเนื้อหาให้แทรกภาพ' };
      const caption = str(args.caption, 160) || 'ภาพประกอบเนื้อหา';
      const prompt = str(args.prompt, 900) || `Editorial illustration supporting the section of an article about "${d.title}", clean modern style, no text`;
      const asset: any = await generateRealImage({
        prompt,
        aspectRatio: '16:9',
        workflowId: ctx.project.workflowId,
        thaiSummary: caption,
        reviewStatus: 'approved',
      });
      d.content = insertMediaAfterSection(d.content, `![${caption}](${asset.fileUrl})`, Number(args.afterSection) || 2);
      ctx.project.media.inline.push({ url: asset.fileUrl, assetId: asset.id, prompt, caption });
      ctx.project.qa = {};
      saveProject(ctx.project);
      return { ok: true, summary: `แทรกภาพประกอบ "${caption}" ลงในเนื้อหาแล้ว` };
    },
  },

  {
    name: 'generate_video',
    agent: 'video',
    description:
      'สร้างวิดีโอสั้นประกอบบทความด้วย AI (ใช้เวลานานและมีค่าใช้จ่ายสูง ให้ใช้เมื่อผู้ใช้ขอวิดีโอชัดเจนเท่านั้น) แล้วแนบเป็นวิดีโอหลักของบทความ',
    args: '{ "prompt": "English video prompt (ไม่ใส่ = ใช้ prompt ที่นักเขียนแนะนำ)" }',
    run: async (ctx, args) => {
      if (!/วิดีโอ|วีดีโอ|vdo|video|คลิป/i.test(ctx.userMessage)) {
        return { ok: false, summary: 'ข้ามการสร้างวิดีโอ เพราะผู้ใช้ยังไม่ได้ขอวิดีโอ (ค่าใช้จ่ายสูง) หากต้องการให้บอกได้เลย' };
      }
      if (!articleApproved(ctx.project)) {
        return { ok: false, summary: 'รอเจ้าของช่องอนุมัติบทความก่อน จึงจะผลิตวิดีโอได้ (กดปุ่ม "อนุมัติบทความ" ในแท็บตรวจสอบ)' };
      }
      if (!ctx.caps.video) {
        return {
          ok: false,
          summary: ctx.caps.serverless
            ? 'สร้างวิดีโอไม่ได้บนโฮสต์แบบ Serverless (จำกัดเวลา 60 วินาที) กรุณาใช้เซิร์ฟเวอร์ VPS'
            : 'ยังไม่ได้ตั้งค่าคีย์สำหรับสร้างวิดีโอ (ต้องมี Gemini API Key หรือ Vertex)',
        };
      }
      const d = ctx.project.draft;
      const prompt =
        str(args.prompt, 900) ||
        d.suggestedVideoPrompt ||
        `Cinematic 8-second establishing shot illustrating "${d.title || ctx.project.brief}", Thai education setting, natural light, smooth camera movement, no text`;
      const asset: any = await generateRealVideo({
        prompt,
        aspectRatio: '16:9',
        durationSec: 8,
        resolution: '720p',
        workflowId: ctx.project.workflowId,
        thaiSummary: d.title,
        reviewStatus: 'approved',
      });
      ctx.project.media.video = { url: asset.fileUrl, assetId: asset.id, prompt };
      ctx.project.draft.contentType = 'video';
      ctx.project.qa = {};
      saveProject(ctx.project);
      return { ok: true, summary: 'สร้างวิดีโอแล้วและแนบเป็นวิดีโอหลักของบทความ (จะถูกเผยแพร่พร้อมบทความอัตโนมัติ)', data: { url: asset.fileUrl } };
    },
  },

  {
    name: 'generate_voice',
    agent: 'audio',
    description: 'สร้างเสียงบรรยายภาษาไทยของบทความด้วย AI TTS แล้วแนบเป็นไฟล์เสียงของบทความ',
    args: '{ "script": "ข้อความที่จะอ่าน (ไม่ใส่ = ใช้ชื่อเรื่อง+สรุป+ต้นบทความ)" }',
    run: async (ctx, args) => {
      if (!/เสียง|พากย์|บรรยาย|audio|voice|tts/i.test(ctx.userMessage)) {
        return { ok: false, summary: 'ข้ามการสร้างเสียง เพราะผู้ใช้ยังไม่ได้ขอเสียงบรรยาย' };
      }
      if (!articleApproved(ctx.project)) {
        return { ok: false, summary: 'รอเจ้าของช่องอนุมัติบทความก่อน จึงจะผลิตเสียงบรรยายได้ (กดปุ่ม "อนุมัติบทความ" ในแท็บตรวจสอบ)' };
      }
      if (!ctx.caps.audio) return { ok: false, summary: 'ยังไม่ได้ตั้งค่าคีย์สำหรับสร้างเสียง' };
      const d = requireDraft(ctx);
      if (!d) return { ok: false, summary: 'ยังไม่มีเนื้อหาให้บรรยาย' };
      const script =
        str(args.script, 3500) ||
        `${d.title}. ${d.excerpt}. ${d.content.replace(/!\[[^\]]*\]\([^)]+\)/g, '').replace(/[#>*_`]/g, '').slice(0, 1800)}`;
      const asset: any = await generateRealAudio({ text: script, workflowId: ctx.project.workflowId });
      ctx.project.media.audio = { url: asset.fileUrl, assetId: asset.id };
      ctx.project.qa = {};
      saveProject(ctx.project);
      return { ok: true, summary: 'สร้างเสียงบรรยายแล้วและแนบกับบทความ' };
    },
  },

  {
    name: 'attach_media',
    agent: 'visual',
    description: 'นำไฟล์ที่มีอยู่แล้วในคลังสื่อ AI มาแนบกับโปรเจกต์ (เป็นรูปปก / วิดีโอ / เสียง)',
    args: '{ "assetId": 12, "as": "cover | video | audio" }',
    run: async (ctx, args) => {
      const row = db.prepare('SELECT * FROM ai_media_assets WHERE id = ?').get(Number(args.assetId)) as any;
      if (!row) return { ok: false, summary: 'ไม่พบไฟล์ในคลังสื่อ' };
      const item = { url: String(row.file_url), assetId: Number(row.id), prompt: String(row.prompt || '') };
      const as = String(args.as || (row.media_type === 'video' ? 'video' : row.media_type === 'audio' ? 'audio' : 'cover'));
      if (as === 'video') ctx.project.media.video = item;
      else if (as === 'audio') ctx.project.media.audio = item;
      else ctx.project.media.cover = item;
      ctx.project.qa = {};
      saveProject(ctx.project);
      return { ok: true, summary: `แนบไฟล์จากคลังสื่อเป็น ${as} แล้ว` };
    },
  },

  {
    name: 'qa_check',
    agent: 'qa',
    description: 'ตรวจคุณภาพฉบับร่าง 4 ด้าน (ความถูกต้องของข้อเท็จจริง ภาษา แบรนด์ ความเสี่ยง) เทียบกับผลค้นคว้าและฐานความรู้ แล้วให้คำตัดสิน',
    args: '{}',
    run: async (ctx) => {
      const d = requireDraft(ctx);
      if (!d) return { ok: false, summary: 'ยังไม่มีฉบับร่างให้ตรวจ' };
      const r = ctx.project.research;
      const { data } = await llmJson(
        ctx,
        `คุณคือ QA Agent ตรวจบทความก่อนเผยแพร่อย่างเข้มงวดและเป็นธรรม
ตรวจ 4 ด้าน ให้คะแนน 0-100: facts (ข้อเท็จจริงมีหลักฐานรองรับจากข้อมูลที่ให้ ไม่มีตัวเลข/ชื่อที่แต่งขึ้น), language (ภาษาไทยถูกต้อง อ่านลื่น), brand (ตรงน้ำเสียงแบรนด์ ไม่มีอีโมจิ/ภาษาโฆษณาเกินจริง), risk (ไม่มีเนื้อหาหมิ่นเหม่ ละเมิด หรือชี้นำเกินจริง)
ตอบ JSON: {"scores":{"facts":0,"language":0,"brand":0,"risk":0},"issues":[{"severity":"high|medium|low","text":"ปัญหาที่เจาะจงและแก้ได้"}],"summary":"สรุป 1-2 ประโยค"}`,
        `บทความ:\n${JSON.stringify({ title: d.title, subtitle: d.subtitle, excerpt: d.excerpt, content: d.content })}\n\nข้อเท็จจริงจากผลค้นคว้า:\n${(r.facts || []).map((f) => `- ${f}`).join('\n') || '-'}\n\n${brandContext(d.title)}`,
        (o) => {
          if (!o.scores || typeof o.scores.facts !== 'number') throw new Error('ผลลัพธ์ไม่ครบ: ไม่มีคะแนน');
        },
        'economy'
      );
      const n = (v: unknown) => Math.max(0, Math.min(100, Math.round(Number(v) || 0)));
      const scores = {
        facts: n(data.scores.facts),
        language: n(data.scores.language),
        brand: n(data.scores.brand),
        risk: n(data.scores.risk),
        overall: 0,
      };
      scores.overall = Math.round((scores.facts + scores.language + scores.brand + scores.risk) / 4);
      const issues = (Array.isArray(data.issues) ? data.issues : [])
        .map((i: any) => ({
          severity: (['high', 'medium', 'low'].includes(i?.severity) ? i.severity : 'low') as 'high' | 'medium' | 'low',
          text: str(i?.text, 400),
        }))
        .filter((i: { text: string }) => i.text)
        .slice(0, 8);
      const verdict: 'pass' | 'revise' | 'block' =
        scores.risk < 50 || issues.some((i: { severity: string }) => i.severity === 'high' && scores.risk < 70)
          ? 'block'
          : scores.overall < 70 || issues.some((i: { severity: string }) => i.severity === 'high')
          ? 'revise'
          : 'pass';
      ctx.project.qa = {
        verdict,
        scores,
        issues,
        summary: str(data.summary, 400),
        contentHash: contentHash(ctx.project),
        checkedAt: new Date().toISOString(),
      };
      saveProject(ctx.project);
      return {
        ok: true,
        summary: `QA: ${verdict === 'pass' ? 'ผ่าน' : verdict === 'revise' ? 'ควรแก้ไข' : 'ไม่ควรเผยแพร่'} (รวม ${scores.overall}/100, ประเด็น ${issues.length})`,
        data: ctx.project.qa,
      };
    },
  },

  {
    name: 'optimize_seo',
    agent: 'publisher',
    description: 'กำหนด slug (ภาษาอังกฤษ ไม่ซ้ำ) คำโปรยสำหรับค้นหา และแท็ก ให้พร้อมเผยแพร่',
    args: '{}',
    run: async (ctx) => {
      const d = requireDraft(ctx);
      if (!d) return { ok: false, summary: 'ยังไม่มีฉบับร่าง' };
      const { data } = await llmJson(
        ctx,
        `คุณคือ Publisher Agent เตรียมข้อมูลการค้นหา
slug: ภาษาอังกฤษตัวพิมพ์เล็ก คั่นด้วย - สื่อความหมายเรื่องนี้ ไม่เกิน 60 ตัวอักษร
excerpt: ภาษาไทย 1-2 ประโยค ไม่เกิน 160 ตัวอักษร ไม่ซ้ำชื่อเรื่อง
tags: 3-6 แท็กภาษาไทยสั้น
ตอบ JSON: {"slug":"","excerpt":"","tags":["..."]}`,
        `ชื่อเรื่อง: ${d.title}\nคำโปรยเดิม: ${d.excerpt}\nเนื้อหา(ย่อ): ${d.content.slice(0, 1500)}`,
        undefined,
        'economy'
      );
      let slug = slugify(str(data.slug, 100), 60);
      if (!slug || validateSlug(slug)) slug = slugify(d.title);
      slug = uniqueSlug(slug, (c) => isSlugTaken(db, c, ctx.project.postId ?? undefined));
      d.slug = slug;
      d.excerpt = str(data.excerpt, 200) || d.excerpt;
      const tags = normalizeTags(data.tags);
      if (tags.length) d.tags = tags;
      saveProject(ctx.project);
      return { ok: true, summary: `ตั้ง slug เป็น /articles/${slug}` };
    },
  },

  {
    name: 'save_post',
    agent: 'publisher',
    description:
      'บันทึกหรือเผยแพร่บทความขึ้นเว็บไซต์จากโปรเจกต์ โดยแนบรูปปก วิดีโอ เสียง และรูปในเนื้อหาที่ทำไว้ทั้งหมดอัตโนมัติ status = "draft" (ฉบับร่าง) หรือ "published" (เผยแพร่ ต้องเป็นคำสั่งของผู้ใช้เท่านั้น)',
    args: '{ "status": "draft | published" }',
    run: async (ctx, args) => {
      const status = args.status === 'published' ? 'published' : 'draft';
      if (status === 'published' && !ctx.publishAllowed) {
        return { ok: false, summary: 'ยังไม่เผยแพร่ เพราะผู้ใช้ยังไม่ได้สั่งให้เผยแพร่ (บันทึกเป็นฉบับร่างได้)' };
      }
      const d = requireDraft(ctx);
      if (!d) return { ok: false, summary: 'ยังไม่มีฉบับร่างที่พร้อมบันทึก' };
      const out = upsertPostFromProject(ctx.project, status);
      ctx.project.postId = out.postId;
      ctx.project.draft.slug = out.slug;
      ctx.project.status = status === 'published' ? 'published' : 'drafting';
      saveProject(ctx.project);
      const attached = [
        ctx.project.media.cover ? 'รูปปก' : '',
        ctx.project.media.video ? 'วิดีโอ' : '',
        ctx.project.media.audio ? 'เสียงบรรยาย' : '',
        ctx.project.media.inline.length ? `ภาพในเนื้อหา ${ctx.project.media.inline.length}` : '',
      ].filter(Boolean);
      return {
        ok: true,
        summary: `${status === 'published' ? 'เผยแพร่' : 'บันทึกฉบับร่าง'}${out.created ? '' : ' (อัปเดตบทความเดิม)'} → /articles/${out.slug} แนบ: ${attached.join(', ') || 'ไม่มีสื่อ'}`,
        data: { postId: out.postId, slug: out.slug, url: `/articles/${encodeURIComponent(out.slug)}` },
      };
    },
  },

  {
    name: 'publish_channels',
    agent: 'publisher',
    description: 'ปรับเนื้อหาให้เหมาะกับแต่ละช่องทาง (เช่น Facebook, X, LINE) แล้วโพสต์ผ่านช่องทางที่ตั้งค่าไว้จริง ต้องเผยแพร่บทความบนเว็บแล้ว และผู้ใช้ต้องสั่งโพสต์',
    args: '{ "channels": ["channel_key", ...] (ไม่ใส่ = ทุกช่องที่ตั้งค่าไว้) }',
    run: async (ctx, args) => {
      if (!ctx.publishAllowed) return { ok: false, summary: 'ยังไม่โพสต์ลงช่องทาง เพราะผู้ใช้ยังไม่ได้สั่ง' };
      if (!ctx.project.postId || ctx.project.status !== 'published') {
        return { ok: false, summary: 'ต้องเผยแพร่บทความบนเว็บไซต์ก่อน จึงจะโพสต์ลงช่องทางอื่นได้' };
      }
      const wanted: string[] = Array.isArray(args.channels) && args.channels.length ? args.channels.map(String) : ctx.caps.channels.map((c) => c.key);
      const targets = ctx.caps.channels.filter((c) => wanted.includes(c.key));
      if (targets.length === 0) return { ok: false, summary: 'ยังไม่มีช่องทางที่ตั้งค่าไว้ (ตั้งค่าได้ที่เมนู ช่องทางเผยแพร่)' };
      const d = ctx.project.draft;
      const url = `/articles/${encodeURIComponent(d.slug)}`;
      const { data } = await llmJson(
        ctx,
        `คุณคือ Publisher Agent ปรับข้อความให้เหมาะกับแต่ละช่องทาง ภาษาไทย สุภาพ กระชับ ไม่ใช้อีโมจิ ไม่เกินจริง
${BRAND_RULES}
ตอบ JSON: {"variants":{"<channel_key>":{"title":"","content":""}}} โดยต้องมีครบทุก channel_key ที่ขอ`,
        `ช่องทาง: ${targets.map((t) => `${t.key} (${t.name})`).join(', ')}\nบทความ: ${d.title}\nสรุป: ${d.excerpt}\nเนื้อหาย่อ: ${d.content.slice(0, 1800)}\nลิงก์บทความ: ${url}`,
        (o) => {
          if (!o.variants || typeof o.variants !== 'object') throw new Error('ผลลัพธ์ไม่ครบ');
        },
        'economy'
      );
      const results: Record<string, { status: string; url: string; note: string; at: string }> = {};
      const variants: Record<string, { title: string; content: string }> = {};
      for (const t of targets) {
        const v = data.variants?.[t.key];
        const title = str(v?.title, 200) || d.title;
        const content = str(v?.content, 4000) || d.excerpt;
        variants[t.key] = { title, content };
        const out = await dispatchSingleChannelReal({
          channelKey: t.key,
          title,
          content,
          category: d.category,
          coverImage: ctx.project.media.cover?.url || '',
          videoUrl: ctx.project.media.video?.url || '',
          audioUrl: ctx.project.media.audio?.url || '',
          workflowId: ctx.project.workflowId,
          postId: ctx.project.postId,
        });
        results[t.key] = { status: out.status, url: out.externalUrl, note: out.responseNote, at: new Date().toISOString() };
      }
      ctx.project.channels = { variants, results };
      saveProject(ctx.project);
      const ok = Object.values(results).filter((r) => r.status === 'published').length;
      return {
        ok: ok > 0,
        summary: `โพสต์ลงช่องทางสำเร็จ ${ok}/${targets.length}${ok < targets.length ? ' (ดูรายละเอียดที่ผลลัพธ์แต่ละช่อง)' : ''}`,
        data: results,
      };
    },
  },

  {
    name: 'fact_check',
    agent: 'factcheck',
    description:
      'Fact-check Agent: แยกข้ออ้างที่ตรวจสอบได้ในบทความ (ตัวเลข ชื่อ วันที่ งานวิจัย) แล้วตรวจทีละข้อกับผลค้นคว้า แหล่งอ้างอิง และฐานความรู้ พร้อมประเมินความเป็นกลาง ข้อที่ไม่มีหลักฐานจะถูกระบุว่า "ตรวจสอบไม่ได้" ไม่ใช่ "ถูกต้อง"',
    args: '{}',
    run: async (ctx) => {
      const d = requireDraft(ctx);
      if (!d) return { ok: false, summary: 'ยังไม่มีฉบับร่างให้ตรวจข้อเท็จจริง' };
      const r = ctx.project.research;
      const evidence = [
        (r.facts || []).length ? `ข้อเท็จจริงจากผลค้นคว้า:\n${(r.facts || []).map((f) => `- ${f}`).join('\n')}` : '',
        r.summary ? `สรุปผลค้นคว้า: ${r.summary}` : '',
        (r.sources || []).length ? `แหล่งอ้างอิง:\n${(r.sources || []).map((s) => `- ${s.title} ${s.uri}`).join('\n')}` : '',
        brandContext(d.title),
      ]
        .filter(Boolean)
        .join('\n\n');
      const { data } = await llmJson(
        ctx,
        `คุณคือ Fact-check Agent ตรวจข้อเท็จจริงอย่างเข้มงวดและเป็นกลาง
1) แยกเฉพาะ "ข้ออ้างที่ตรวจสอบได้" ในบทความ (ตัวเลข สถิติ ชื่อบุคคล/หน่วยงาน วันที่ ผลงานวิจัย ข้ออ้างเชิงเหตุและผล) ไม่เกิน 12 ข้อ
2) ตัดสินแต่ละข้อจากหลักฐานที่ให้เท่านั้น:
   supported = มีหลักฐานในข้อมูลที่ให้สนับสนุนโดยตรง (ระบุหลักฐานสั้นๆ)
   unverifiable = ไม่มีหลักฐานทั้งสนับสนุนและขัดแย้ง (ห้ามเดาว่าถูก)
   unsupported = ขัดแย้งกับหลักฐาน หรืออ้างตัวเลข/แหล่งที่ไม่ปรากฏเลยและดูเป็นการแต่งขึ้น
3) ประเมินความเป็นกลาง 0-100 (ไม่ชี้นำ ไม่โฆษณาเกินจริง ไม่มีอคติ) พร้อมหมายเหตุ
ตอบ JSON: {"claims":[{"text":"","verdict":"supported|unverifiable|unsupported","evidence":""}],"neutrality":{"score":0,"notes":""},"summary":""}`,
        `บทความ:\n${JSON.stringify({ title: d.title, content: d.content })}\n\nหลักฐานที่มี:\n${evidence}`,
        (o) => {
          if (!Array.isArray(o.claims) || !o.neutrality) throw new Error('ผลลัพธ์ไม่ครบ: ไม่มีรายการข้ออ้าง');
        },
        'economy'
      );
      const claims = (data.claims as any[])
        .map((c) => ({
          text: str(c?.text, 300),
          verdict: (['supported', 'unverifiable', 'unsupported'].includes(c?.verdict) ? c.verdict : 'unverifiable') as 'supported' | 'unverifiable' | 'unsupported',
          evidence: str(c?.evidence, 300),
        }))
        .filter((c) => c.text)
        .slice(0, 12);
      const neutrality = { score: Math.max(0, Math.min(100, Math.round(Number(data.neutrality?.score) || 0))), notes: str(data.neutrality?.notes, 300) };
      const unsupported = claims.filter((c) => c.verdict === 'unsupported').length;
      const verdict: 'pass' | 'revise' | 'block' = unsupported >= 3 || neutrality.score < 50 ? 'block' : unsupported >= 1 || neutrality.score < 70 ? 'revise' : 'pass';
      ctx.project.factCheck = { claims, neutrality, verdict, summary: str(data.summary, 400), contentHash: articleHash(ctx.project), checkedAt: new Date().toISOString() };
      saveProject(ctx.project);
      const counts = (v: string) => claims.filter((c) => c.verdict === v).length;
      return {
        ok: true,
        summary: `${verdict === 'pass' ? 'ผ่าน' : verdict === 'revise' ? 'ควรแก้ไข' : 'ไม่ควรเผยแพร่'} (ข้ออ้าง ${claims.length}: ยืนยันได้ ${counts('supported')}, ตรวจสอบไม่ได้ ${counts('unverifiable')}, ขัดแย้ง ${unsupported}; ความเป็นกลาง ${neutrality.score}/100)`,
        data: ctx.project.factCheck,
      };
    },
  },

  {
    name: 'video_script',
    agent: 'script',
    description: 'Video Script Agent: แปลงบทความที่อนุมัติแล้วเป็นสคริปต์วิดีโอสั้น 2-3 คลิป (บทพูด คำบรรยายบนจอ และ prompt ภาพ) เพื่อนำไปผลิตต่อ',
    args: '{}',
    run: async (ctx) => {
      const d = requireDraft(ctx);
      if (!d) return { ok: false, summary: 'ยังไม่มีบทความให้แปลงเป็นสคริปต์' };
      const { data } = await llmJson(
        ctx,
        `คุณคือ Video Script Agent แปลงบทความเป็นสคริปต์วิดีโอสั้น 2-3 คลิป เล่าต่อเนื่องกัน (เปิดประเด็น, สาระหลัก, ข้อสรุปและชวนอ่านต่อ)
${BRAND_RULES}
แต่ละคลิป: title, durationSec (6-10), narration (บทพูดภาษาไทย ไม่เกิน 260 ตัวอักษร ใช้เฉพาะสิ่งที่มีในบทความ), subtitle (คำบรรยายบนจอ 1-2 บรรทัดสั้น), visualPrompt (English: ผู้นำเสนอหรือฉากประกอบที่สื่อความหมาย ไม่มีตัวอักษรในภาพ)
ตอบ JSON: {"clips":[{"title":"","durationSec":8,"narration":"","subtitle":"","visualPrompt":""}]}`,
        `บทความ:\n${JSON.stringify({ title: d.title, excerpt: d.excerpt, content: d.content.slice(0, 6000) })}`,
        (o) => {
          if (!Array.isArray(o.clips) || o.clips.length < 1) throw new Error('ผลลัพธ์ไม่ครบ: ไม่มีคลิป');
        }
      );
      const clips = (data.clips as any[]).slice(0, 3).map((c, i) => ({
        title: str(c?.title, 120) || `คลิป ${i + 1}`,
        durationSec: Math.max(4, Math.min(10, Math.round(Number(c?.durationSec) || 8))),
        narration: str(c?.narration, 300),
        subtitle: str(c?.subtitle, 200) || str(c?.narration, 120),
        visualPrompt: str(c?.visualPrompt, 600),
      }));
      ctx.project.videoPlan = { clips, updatedAt: new Date().toISOString() };
      saveProject(ctx.project);
      return { ok: true, summary: `เขียนสคริปต์วิดีโอ ${clips.length} คลิป (รวม ${clips.reduce((a, c) => a + c.durationSec, 0)} วินาที)`, data: clips };
    },
  },

  {
    name: 'produce_clips',
    agent: 'video',
    description:
      'Avatar Production: ผลิตคลิปตามสคริปต์ (วิดีโอ AI ต่อคลิป + เสียงบรรยายไทย + ไฟล์คำบรรยาย .vtt) แล้วตัดต่อรวมเป็นวิดีโอเดียวแนบกับบทความ ใช้เมื่อผู้ใช้ขอชัดเจน ต้องอนุมัติบทความแล้ว และต้องมีสคริปต์ (video_script) ก่อน',
    args: '{}',
    run: async (ctx) => {
      if (!/วิดีโอ|วีดีโอ|vdo|video|คลิป|ผลิต/i.test(ctx.userMessage)) {
        return { ok: false, summary: 'ข้ามการผลิตคลิป เพราะผู้ใช้ยังไม่ได้ขอ (ค่าใช้จ่ายสูง)' };
      }
      if (!articleApproved(ctx.project)) {
        return { ok: false, summary: 'รอเจ้าของช่องอนุมัติบทความก่อน จึงจะผลิตคลิปได้ (กดปุ่ม "อนุมัติบทความ" ในแท็บตรวจสอบ)' };
      }
      const clips = ctx.project.videoPlan.clips;
      if (clips.length === 0) return { ok: false, summary: 'ยังไม่มีสคริปต์วิดีโอ ให้ video_script ก่อน' };
      if (!ctx.caps.video) {
        return {
          ok: false,
          summary: ctx.caps.serverless
            ? 'ผลิตวิดีโอไม่ได้บนโฮสต์แบบ Serverless (จำกัดเวลา 60 วินาที) กรุณาใช้เซิร์ฟเวอร์ VPS'
            : 'ยังไม่ได้ตั้งค่าคีย์สำหรับสร้างวิดีโอ (ต้องมี Gemini API Key หรือ Vertex)',
        };
      }
      const made: { url: string; assetId: number | null; caption: string }[] = [];
      for (let i = 0; i < clips.length; i++) {
        const c = clips[i];
        ctx.log(`ผลิตคลิป ${i + 1}/${clips.length}`);
        const asset: any = await generateRealVideo({
          prompt: `${c.visualPrompt}. Professional presenter-style educational explainer, natural light, no on-screen text.`,
          aspectRatio: '16:9',
          durationSec: c.durationSec,
          resolution: '720p',
          workflowId: ctx.project.workflowId,
          thaiSummary: c.title,
          reviewStatus: 'approved',
        });
        made.push({ url: asset.fileUrl, assetId: asset.id, caption: c.title });
      }
      let voiceUrl = '';
      let voiceNote = '';
      if (ctx.caps.audio) {
        try {
          const voice: any = await generateRealAudio({ text: clips.map((c) => c.narration).join(' '), workflowId: ctx.project.workflowId });
          voiceUrl = voice.fileUrl;
          ctx.project.media.audio = { url: voice.fileUrl, assetId: voice.id };
        } catch (e) {
          voiceNote = ` (สร้างเสียงบรรยายไม่สำเร็จ: ${(e as Error).message.slice(0, 80)})`;
        }
      } else voiceNote = ' (ยังไม่ได้ตั้งค่าคีย์สร้างเสียง จึงไม่มีเสียงบรรยาย)';

      let master = made[0].url;
      let stitchNote = '';
      if (made.length > 1) {
        try {
          const st = await stitchFlowScenesWithFfmpeg({
            sceneVideoUrls: made.map((m) => m.url),
            aspectRatio: '16:9',
            voiceoverAudioUrl: voiceUrl || undefined,
            projectTitle: ctx.project.draft.title,
          });
          master = st.masterVideoUrl;
        } catch (e) {
          stitchNote = ` (ตัดต่อรวมไม่สำเร็จ ใช้คลิปแรกเป็นวิดีโอหลัก: ${(e as Error).message.slice(0, 80)})`;
        }
      }

      // subtitles (WebVTT): each clip's subtitle text spread across its duration
      let t = 0;
      const cues = clips
        .map((c, i) => {
          const start = t;
          t += c.durationSec;
          return `${i + 1}\n${vttTime(start)} --> ${vttTime(t)}\n${c.subtitle || c.narration}\n`;
        })
        .join('\n');
      const dir = path.join(UPLOADS_ROOT, 'subtitles');
      fs.mkdirSync(dir, { recursive: true });
      const fname = `ws${ctx.project.id}-${Date.now()}.vtt`;
      fs.writeFileSync(path.join(dir, fname), `WEBVTT\n\n${cues}`, 'utf8');

      ctx.project.media.clips = made.map((m) => ({ url: m.url, assetId: m.assetId, caption: m.caption }));
      ctx.project.media.video = { url: master, prompt: 'produce_clips' };
      ctx.project.media.subtitles = { url: `/uploads/subtitles/${fname}` };
      ctx.project.draft.contentType = 'video';
      ctx.project.qa = {};
      saveProject(ctx.project);
      return { ok: true, summary: `ผลิต ${made.length} คลิปเรียบร้อย แนบวิดีโอหลัก คำบรรยาย${voiceUrl ? ' และเสียงบรรยาย' : ''}${voiceNote}${stitchNote}`, data: { master } };
    },
  },

  {
    name: 'analyze_performance',
    agent: 'analytics',
    description:
      'Analytics & Learning Agent: วิเคราะห์ผลงานจากข้อมูลจริงในระบบ (ยอดเข้าชม ความคิดเห็นและคะแนน ผลโพสต์แต่ละช่องทาง เทียบกับบทความอื่น) สรุปบทเรียนและแนวทางครั้งต่อไป และส่งกลับให้ CEO ใช้วางแผนงานถัดไป ใช้ได้เมื่อเผยแพร่แล้ว',
    args: '{}',
    run: async (ctx) => {
      const p = ctx.project;
      if (!p.postId) return { ok: false, summary: 'บทความนี้ยังไม่ได้เผยแพร่ จึงยังไม่มีข้อมูลผลลัพธ์ให้วิเคราะห์' };
      const post = db.prepare('SELECT id, title, views, created_at, category FROM posts WHERE id = ?').get(p.postId) as any;
      if (!post) return { ok: false, summary: 'ไม่พบบทความที่เผยแพร่' };
      const cm = db
        .prepare('SELECT COUNT(*) AS n, AVG(rating) AS avg FROM comments WHERE post_id = ?')
        .get(p.postId) as { n: number; avg: number | null };
      const comments = db
        .prepare('SELECT message, rating FROM comments WHERE post_id = ? ORDER BY id DESC LIMIT 10')
        .all(p.postId) as { message: string; rating: number }[];
      const top = db
        .prepare("SELECT title, views, category FROM posts WHERE status = 'published' ORDER BY views DESC LIMIT 5")
        .all();
      const peer = db
        .prepare("SELECT AVG(views) AS avgViews, COUNT(*) AS n FROM posts WHERE status = 'published' AND category = ? AND id != ?")
        .get(post.category, p.postId) as { avgViews: number | null; n: number };
      const channelResults = p.channels.results || {};
      const metrics = {
        views: Number(post.views || 0),
        daysOnline: Math.max(1, Math.round((Date.now() - new Date(post.created_at).getTime()) / 86400000)),
        comments: Number(cm.n || 0),
        avgRating: cm.avg ? Math.round(cm.avg * 10) / 10 : null,
        sameCategoryAvgViews: peer.avgViews ? Math.round(peer.avgViews) : null,
        sameCategoryPosts: peer.n,
        channels: Object.fromEntries(Object.entries(channelResults).map(([k, v]) => [k, v.status])),
      };
      if (metrics.views === 0 && metrics.comments === 0 && Object.keys(metrics.channels).length === 0) {
        return { ok: false, summary: 'ยังมีข้อมูลผลลัพธ์ไม่พอให้วิเคราะห์ (ยังไม่มียอดเข้าชม ความคิดเห็น หรือผลโพสต์ช่องทาง) ลองใหม่เมื่อบทความออนไลน์มาสักระยะ' };
      }
      const { data } = await llmJson(
        ctx,
        `คุณคือ Analytics & Learning Agent สรุปบทเรียนจากผลงานจริงเพื่อส่งกลับไปให้ CEO วางแผนงานถัดไป
ใช้เฉพาะตัวเลขและความคิดเห็นที่ให้ ห้ามแต่งตัวเลขหรือสาเหตุที่ไม่มีหลักฐาน ถ้าข้อมูลน้อยให้บอกว่ายังสรุปไม่ได้ชัด
${BRAND_RULES}
ตอบ JSON: {"summary":"สรุป 2-3 ประโยค","whatWorked":["..."],"toImprove":["..."],"nextTopics":["หัวข้อที่ควรทำต่อ พร้อมเหตุผลสั้นๆ"]}`,
        `บทความ: ${post.title}\nตัวชี้วัด: ${JSON.stringify(metrics)}\nบทความยอดนิยมของเว็บ: ${JSON.stringify(top)}\nความคิดเห็นล่าสุด:\n${comments.map((c) => `- (${c.rating}/5) ${c.message.slice(0, 200)}`).join('\n') || '-'}`,
        (o) => {
          if (typeof o.summary !== 'string' || !o.summary.trim()) throw new Error('ผลลัพธ์ไม่ครบ: ไม่มีสรุป');
        },
        'economy'
      );
      const list = (v: unknown) => (Array.isArray(v) ? v.map((x) => str(x, 240)).filter(Boolean).slice(0, 5) : []);
      p.learning = {
        summary: str(data.summary, 600),
        whatWorked: list(data.whatWorked),
        toImprove: list(data.toImprove),
        nextTopics: list(data.nextTopics),
        metrics,
        at: new Date().toISOString(),
      };
      saveProject(p);
      saveLearning(p.id, p.learning.summary || '', [...(p.learning.toImprove || []), ...(p.learning.nextTopics || [])]);
      return { ok: true, summary: `วิเคราะห์ผลงานแล้ว (เข้าชม ${metrics.views}, ความคิดเห็น ${metrics.comments}) และส่งบทเรียนกลับให้ CEO`, data: p.learning };
    },
  },

  {
    name: 'find_posts',
    agent: 'ceo',
    description: 'ค้นหาบทความที่มีอยู่แล้วในระบบจากชื่อ/เนื้อหา เพื่อนำมาแก้ไขหรืออ้างอิง',
    args: '{ "query": "คำค้น" }',
    run: async (_ctx, args) => {
      const q = `%${str(args.query, 80)}%`;
      const rows = db
        .prepare(
          'SELECT id, title, slug, status FROM posts WHERE title LIKE ? OR tags_json LIKE ? OR excerpt LIKE ? ORDER BY created_at DESC LIMIT 8'
        )
        .all(q, q, q);
      return { ok: true, summary: `พบ ${rows.length} บทความ`, data: rows };
    },
  },

  {
    name: 'load_post',
    agent: 'ceo',
    description: 'โหลดบทความที่มีอยู่แล้วเข้ามาเป็นฉบับร่างของโปรเจกต์นี้ เพื่อให้ทีมแก้ไข เพิ่มสื่อ และเผยแพร่ซ้ำ (ใช้ post id จาก find_posts)',
    args: '{ "postId": 12 }',
    run: async (ctx, args) => {
      const loaded = createProjectFromPost(Number(args.postId));
      loaded.id = ctx.project.id;
      // copy loaded state into the active workspace
      ctx.project.postId = loaded.postId;
      ctx.project.draft = loaded.draft;
      ctx.project.media = loaded.media;
      ctx.project.status = loaded.status;
      ctx.project.title = loaded.title;
      ctx.project.qa = {};
      saveProject(ctx.project);
      return { ok: true, summary: `โหลดบทความ "${loaded.title}" เข้าโปรเจกต์แล้ว พร้อมแก้ไข` };
    },
  },

  {
    name: 'import_campaign',
    agent: 'ceo',
    description: 'นำผลงานของแคมเปญ 8 Agent (เนื้อหา ผลค้นคว้า สื่อที่สร้างไว้) เข้ามาเป็นฉบับร่างของโปรเจกต์นี้ (ใช้ workflow id)',
    args: '{ "workflowId": 3 }',
    run: async (ctx, args) => {
      const imported = createProjectFromWorkflow(Number(args.workflowId));
      ctx.project.workflowId = imported.workflowId;
      ctx.project.draft = imported.draft;
      ctx.project.media = imported.media;
      ctx.project.research = imported.research;
      ctx.project.title = imported.title;
      ctx.project.qa = {};
      saveProject(ctx.project);
      return { ok: true, summary: `นำเข้าแคมเปญ "${imported.title}" แล้ว` };
    },
  },

  {
    name: 'delete_post',
    agent: 'ceo',
    description: 'ลบบทความออกจากเว็บไซต์ถาวร (ต้องให้ผู้ใช้กดยืนยันเสมอ ห้ามลบโดยไม่ได้รับคำสั่งชัดเจน)',
    args: '{ "postId": 12 }',
    run: async (_ctx, args) => {
      const id = Number(args.postId);
      const row = db.prepare('SELECT id, title FROM posts WHERE id = ?').get(id) as { id: number; title: string } | undefined;
      if (!row) return { ok: false, summary: 'ไม่พบบทความที่จะลบ' };
      return {
        ok: true,
        summary: `รอการยืนยันจากผู้ใช้เพื่อลบ "${row.title}"`,
        confirm: { action: 'delete_post', label: `ลบบทความ "${row.title}" ถาวร`, payload: { postId: id } },
      };
    },
  },

  {
    name: 'ask_user',
    agent: 'ceo',
    description: 'ถามผู้ใช้เมื่อข้อมูลสำคัญขาดจนตัดสินใจเองไม่ได้ (ถามให้น้อยที่สุด และถามข้อเดียวที่ชัดเจน)',
    args: '{ "question": "คำถาม" }',
    run: async (_ctx, args) => ({ ok: true, summary: 'ถามผู้ใช้', question: str(args.question, 400) }),
  },
];

export const TOOL_MAP = new Map(TOOLS.map((t) => [t.name, t]));

export function toolCatalog(caps: Capabilities): string {
  const avail: Record<string, boolean> = {
    generate_cover: caps.image,
    generate_inline_image: caps.image,
    generate_video: caps.video,
    generate_voice: caps.audio,
    publish_channels: caps.channels.length > 0,
  };
  return TOOLS.map(
    (t) =>
      `- ${t.name} [${t.agent}]${avail[t.name] === false ? ' (ยังใช้ไม่ได้: ไม่มีคีย์/โฮสต์ไม่รองรับ)' : ''}: ${t.description}\n  args: ${t.args}`
  ).join('\n');
}
