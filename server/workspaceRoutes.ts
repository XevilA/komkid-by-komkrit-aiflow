import type { Express, Request, Response } from 'express';
import { IS_SERVERLESS } from './db.ts';
import {
  CATEGORY_IDS,
  appendEvent,
  articleHash,
  computeFlow,
  createProject,
  createProjectFromPost,
  createProjectFromWorkflow,
  deleteProject,
  getEvents,
  getProject,
  listProjects,
  saveProject,
  type Category,
} from './workspaces.ts';
import { confirmAction, isProjectRunning, publishProject, runCeo, hasPublishIntent } from './ceoAgent.ts';
import { getCapabilities } from './agentTools.ts';
import { validateSlug } from './slug.ts';
import type { LlmProviderId } from './aiEngine.ts';

const PROVIDERS = ['auto', 'gemini', 'claude', 'deepseek', 'openai', 'openai_compatible'];
const CONTENT_TYPES = ['news', 'article', 'video', 'course'];

function safeMediaUrl(v: unknown): string | null {
  const u = String(v ?? '').trim();
  if (!u) return '';
  if (u.length > 2000) return null;
  if (/^https?:\/\//i.test(u) || (u.startsWith('/') && !u.startsWith('//'))) return u;
  return null;
}

function providerOf(v: unknown): LlmProviderId | undefined {
  return typeof v === 'string' && PROVIDERS.includes(v) ? (v as LlmProviderId) : undefined;
}

function snapshot(id: number, after = 0) {
  const project = getProject(id);
  if (!project) return null;
  return { project, flow: computeFlow(project), events: getEvents(id, after, 300), running: isProjectRunning(id) };
}

export function registerWorkspaceRoutes(app: Express) {
  app.get('/api/workspaces/capabilities', (_req, res) => {
    res.json(getCapabilities());
  });

  app.get('/api/workspaces', (_req, res) => {
    res.json({ workspaces: listProjects(60), capabilities: getCapabilities() });
  });

  app.post('/api/workspaces', (req, res) => {
    try {
      const b = req.body || {};
      if (b.fromPostId !== undefined) return void res.status(201).json(snapshot(createProjectFromPost(Number(b.fromPostId)).id));
      if (b.fromWorkflowId !== undefined) {
        return void res.status(201).json(snapshot(createProjectFromWorkflow(Number(b.fromWorkflowId)).id));
      }
      const p = createProject({ title: b.title, brief: b.brief });
      res.status(201).json(snapshot(p.id));
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  app.get('/api/workspaces/:id', (req, res) => {
    const s = snapshot(Number(req.params.id), Number(req.query.after) || 0);
    if (!s) return void res.status(404).json({ error: 'ไม่พบโปรเจกต์' });
    res.json(s);
  });

  // Manual edits by the human: the editor writes to the same shared state the agents use.
  app.put('/api/workspaces/:id', (req, res) => {
    const p = getProject(Number(req.params.id));
    if (!p) return void res.status(404).json({ error: 'ไม่พบโปรเจกต์' });
    if (isProjectRunning(p.id)) return void res.status(409).json({ error: 'ทีมกำลังทำงานอยู่ กรุณารอให้เสร็จก่อนแก้ไข' });
    const b = req.body || {};
    const d = b.draft && typeof b.draft === 'object' ? b.draft : {};

    const text = (v: unknown, max: number, label: string) => {
      const s = String(v ?? '');
      if (s.length > max) throw new Error(`${label} ยาวเกิน ${max} ตัวอักษร`);
      return s;
    };
    try {
      let changed = false;
      if (typeof b.brief === 'string') p.brief = text(b.brief, 4000, 'โจทย์');
      if (d.title !== undefined) { p.draft.title = text(d.title, 200, 'ชื่อเรื่อง').trim(); changed = true; }
      if (d.subtitle !== undefined) { p.draft.subtitle = text(d.subtitle, 300, 'คำโปรย').trim(); changed = true; }
      if (d.excerpt !== undefined) { p.draft.excerpt = text(d.excerpt, 300, 'สรุป').trim(); changed = true; }
      if (d.content !== undefined) { p.draft.content = text(d.content, 60000, 'เนื้อหา'); changed = true; }
      if (d.category !== undefined) {
        if (!CATEGORY_IDS.includes(d.category)) throw new Error('หมวดหมู่ไม่ถูกต้อง');
        p.draft.category = d.category as Category;
        changed = true;
      }
      if (d.contentType !== undefined) {
        if (!CONTENT_TYPES.includes(d.contentType)) throw new Error('ประเภทเนื้อหาไม่ถูกต้อง');
        p.draft.contentType = d.contentType;
        changed = true;
      }
      if (d.tags !== undefined) {
        if (!Array.isArray(d.tags)) throw new Error('แท็กต้องเป็นรายการ');
        p.draft.tags = Array.from(new Set(d.tags.map((t: unknown) => String(t).trim().slice(0, 40)).filter(Boolean))).slice(0, 10) as string[];
        changed = true;
      }
      if (d.slug !== undefined) {
        const slug = String(d.slug).trim().normalize('NFC').toLowerCase();
        if (slug) {
          const err = validateSlug(slug);
          if (err) throw new Error(err);
        }
        p.draft.slug = slug;
        changed = true;
      }
      if (b.media && typeof b.media === 'object') {
        for (const key of ['cover', 'video', 'audio'] as const) {
          if (b.media[key] === undefined) continue;
          if (b.media[key] === null || b.media[key] === '') {
            delete p.media[key];
          } else {
            const url = safeMediaUrl(b.media[key]);
            if (url === null) throw new Error(`ที่อยู่ไฟล์ ${key} ต้องเป็น http(s) หรือพาธของเว็บไซต์`);
            p.media[key] = { ...(p.media[key] || {}), url };
          }
          changed = true;
        }
      }
      if (p.draft.title) p.title = p.draft.title;
      if (changed) p.qa = {}; // checks no longer apply to different content
      res.json(snapshot(saveProject(p).id));
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  app.delete('/api/workspaces/:id', (req, res) => {
    const id = Number(req.params.id);
    if (isProjectRunning(id)) return void res.status(409).json({ error: 'ทีมกำลังทำงานอยู่ กรุณารอให้เสร็จก่อนลบ' });
    if (!deleteProject(id)) return void res.status(404).json({ error: 'ไม่พบโปรเจกต์' });
    res.json({ ok: true });
  });

  const kickOff = async (res: Response, id: number, job: () => Promise<unknown>) => {
    try {
      if (IS_SERVERLESS) {
        // serverless cannot keep working after the response: do it within this request
        const out = await job();
        return void res.json({ ...snapshot(id), result: out ?? null });
      }
      void job().catch((err) =>
        appendEvent(id, { role: 'ceo', agent: 'ceo', kind: 'error', content: String((err as Error).message).slice(0, 400) })
      );
      // let the job register its run lock before the first poll
      await new Promise((r) => setTimeout(r, 30));
      res.status(202).json(snapshot(id));
    } catch (err) {
      res.status(409).json({ error: (err as Error).message });
    }
  };

  app.post('/api/workspaces/:id/message', async (req: Request, res: Response) => {
    const id = Number(req.params.id);
    if (!getProject(id)) return void res.status(404).json({ error: 'ไม่พบโปรเจกต์' });
    const message = String(req.body?.message ?? '').trim();
    if (!message) return void res.status(400).json({ error: 'กรุณาพิมพ์คำสั่ง' });
    if (message.length > 4000) return void res.status(400).json({ error: 'คำสั่งยาวเกิน 4000 ตัวอักษร' });
    if (isProjectRunning(id)) return void res.status(409).json({ error: 'ทีมกำลังทำงานอยู่ กรุณารอให้เสร็จก่อน' });
    await kickOff(res, id, () =>
      runCeo({
        projectId: id,
        message,
        provider: providerOf(req.body?.provider),
        model: typeof req.body?.model === 'string' ? req.body.model.slice(0, 120) : undefined,
        publishAllowed: hasPublishIntent(message),
      })
    );
  });

  app.post('/api/workspaces/:id/publish', async (req: Request, res: Response) => {
    const id = Number(req.params.id);
    if (!getProject(id)) return void res.status(404).json({ error: 'ไม่พบโปรเจกต์' });
    if (isProjectRunning(id)) return void res.status(409).json({ error: 'ทีมกำลังทำงานอยู่ กรุณารอให้เสร็จก่อน' });
    const channels = Array.isArray(req.body?.channels) ? req.body.channels.map(String).slice(0, 12) : [];
    await kickOff(res, id, () =>
      publishProject({
        projectId: id,
        status: req.body?.status === 'draft' ? 'draft' : 'published',
        channels,
        force: req.body?.force === true,
        provider: providerOf(req.body?.provider),
      })
    );
  });

  // Owner approval gate: the approval is bound to this exact article text and lapses if it changes.
  app.post('/api/workspaces/:id/approve', (req: Request, res: Response) => {
    const p = getProject(Number(req.params.id));
    if (!p) return void res.status(404).json({ error: 'ไม่พบโปรเจกต์' });
    if (isProjectRunning(p.id)) return void res.status(409).json({ error: 'ทีมกำลังทำงานอยู่ กรุณารอให้เสร็จก่อน' });
    if (req.body?.gate !== 'article') return void res.status(400).json({ error: 'จุดอนุมัติไม่ถูกต้อง' });
    if (req.body?.revoke === true) {
      delete p.approvals.article;
      saveProject(p);
      appendEvent(p.id, { role: 'system', agent: 'ceo', kind: 'message', content: 'เจ้าของช่องยกเลิกการอนุมัติบทความ' });
      return void res.json(snapshot(p.id));
    }
    if (!p.draft.title || !p.draft.content) return void res.status(400).json({ error: 'ยังไม่มีบทความให้อนุมัติ' });
    p.approvals.article = { hash: articleHash(p), at: new Date().toISOString() };
    saveProject(p);
    appendEvent(p.id, {
      role: 'system',
      agent: 'ceo',
      kind: 'message',
      content: 'เจ้าของช่องอนุมัติบทความแล้ว ทีมผลิตวิดีโอ เสียง และคำบรรยายต่อได้',
    });
    res.json(snapshot(p.id));
  });

  app.post('/api/workspaces/:id/confirm', (req, res) => {
    const out = confirmAction(Number(req.params.id), Number(req.body?.eventId));
    res.status(out.ok ? 200 : 400).json({ ...out, ...snapshot(Number(req.params.id)) });
  });
}
